/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Ephemeral HTTP host for the real save and P33 Worker modules used by public-browser CI.
 * Each invocation owns two in-memory SQLite databases. Nothing can reach staging or production,
 * while the browser still traverses the normal fetch/auth/GameData code paths.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import coopWorker from "../../../workers/er-coop-api/src/index";
import saveWorker from "../../../workers/er-save-api/src/index";

interface D1ResultLike {
  success: boolean;
  results: Record<string, unknown>[];
  meta: { changes: number; last_row_id?: number | bigint };
}

class SqliteD1Statement {
  private readonly db: DatabaseSync;
  private readonly sql: string;
  private readonly bindings: SQLInputValue[];

  public constructor(db: DatabaseSync, sql: string, bindings: SQLInputValue[] = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  public bind(...values: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.db, this.sql, values as SQLInputValue[]);
  }

  public async first<T>(): Promise<T | null> {
    return (this.statement().get(...this.bindings) as T | undefined) ?? null;
  }

  public async all<T extends Record<string, unknown>>(): Promise<D1ResultLike & { results: T[] }> {
    return {
      success: true,
      results: this.statement().all(...this.bindings) as T[],
      meta: { changes: 0 },
    };
  }

  public async run(): Promise<D1ResultLike> {
    return this.execute();
  }

  public execute(): D1ResultLike {
    const statement = this.statement();
    if (statement.columns().length > 0) {
      return {
        success: true,
        results: statement.all(...this.bindings) as Record<string, unknown>[],
        meta: { changes: 0 },
      };
    }
    const result = statement.run(...this.bindings);
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes), last_row_id: result.lastInsertRowid },
    };
  }

  private statement(): StatementSync {
    return this.db.prepare(this.sql);
  }
}

class SqliteD1Database {
  public readonly sqlite: DatabaseSync;

  public constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
  }

  public prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.sqlite, sql);
  }

  public async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }

  public async batch(statements: SqliteD1Statement[]): Promise<D1ResultLike[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(statement => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function database(schemaPath: string): SqliteD1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(process.cwd(), schemaPath), "utf8"));
  return new SqliteD1Database(sqlite);
}

async function nodeRequest(request: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const method = request.method ?? "GET";
  const init: RequestInit = {
    method,
    headers: request.headers as HeadersInit,
  };
  if (method !== "GET" && method !== "HEAD" && chunks.length > 0) {
    init.body = Buffer.concat(chunks);
  }
  return new Request(new URL(request.url ?? "/", origin), init);
}

async function writeNodeResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  target.end(Buffer.from(await response.arrayBuffer()));
}

function listen(port: number, dispatch: (request: Request) => Promise<Response>): ReturnType<typeof createServer> {
  const origin = `http://127.0.0.1:${port}`;
  const server = createServer((incoming, outgoing) => {
    nodeRequest(incoming, origin)
      .then(dispatch)
      .then(response => writeNodeResponse(response, outgoing))
      .catch(error => {
        outgoing.statusCode = 500;
        outgoing.end(error instanceof Error ? error.message : String(error));
      });
  });
  server.listen(port, "127.0.0.1", () => process.stdout.write(`Local Worker fixture listening at ${origin}\n`));
  return server;
}

// Cloudflare exposes a default edge cache; Node does not. The save Worker's public title-stats
// route uses only match/put, so an in-memory response cache preserves its real control flow.
const responseCache = new Map<string, Response>();
const defaultCache = {
  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const key = request instanceof Request ? request.url : String(request);
    return responseCache.get(key)?.clone();
  },
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const key = request instanceof Request ? request.url : String(request);
    responseCache.set(key, response.clone());
  },
};
Object.defineProperty(globalThis, "caches", {
  configurable: true,
  value: { default: defaultCache } as unknown as CacheStorage,
});

const saveDb = database("workers/er-save-api/schema.sql");
const coopDb = database("workers/er-coop-api/schema.sql");
const sessionSecret = "public-browser-local-session-secret-at-least-32-bytes";
const identitySecret = "public-browser-local-identity-secret-at-least-32-bytes";

async function dispatchSaveWorker(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (
    request.method === "POST"
    && (url.pathname === "/__coop-fixture/fork-session" || url.pathname === "/__coop-fixture/session-status")
  ) {
    let body: { username?: unknown; slot?: unknown };
    try {
      body = (await request.json()) as { username?: unknown; slot?: unknown };
    } catch {
      return Response.json({ error: "invalid fixture request" }, { status: 400 });
    }
    const username = typeof body.username === "string" ? body.username.normalize("NFKC").toLowerCase() : "";
    const slot = body.slot;
    if (username.length === 0 || !Number.isSafeInteger(slot) || Number(slot) < 0 || Number(slot) > 4) {
      return Response.json({ error: "invalid fixture target" }, { status: 400 });
    }
    const row = saveDb.sqlite
      .prepare(
        `SELECT session_saves.data AS data
         FROM session_saves
         JOIN users ON users.id = session_saves.user_id
         WHERE users.username_lower = ? AND session_saves.slot = ?`,
      )
      .get(username, Number(slot)) as { data?: unknown } | undefined;
    if (typeof row?.data !== "string") {
      return Response.json({ error: "fixture session not found" }, { status: 404 });
    }
    if (url.pathname === "/__coop-fixture/session-status") {
      return Response.json({
        ok: true,
        slot,
        sha256: createHash("sha256").update(row.data).digest("hex"),
      });
    }
    let session: Record<string, unknown>;
    try {
      session = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "fixture session is not JSON" }, { status: 409 });
    }
    const coopRun = session.coopRun as { checkpointRevision?: unknown; runId?: unknown } | undefined;
    if (coopRun == null || !Number.isSafeInteger(coopRun.checkpointRevision) || typeof coopRun.runId !== "string") {
      return Response.json({ error: "fixture session is not a committed co-op checkpoint" }, { status: 409 });
    }
    const originalMoney = typeof session.money === "number" && Number.isFinite(session.money) ? session.money : 0;
    session.money = originalMoney + 1;
    const forked = JSON.stringify(session);
    const update = saveDb.sqlite
      .prepare(
        `UPDATE session_saves SET data = ?, updated_at = updated_at + 1
         WHERE user_id = (SELECT id FROM users WHERE username_lower = ?) AND slot = ? AND data = ?`,
      )
      .run(forked, username, Number(slot), row.data);
    if (Number(update.changes) !== 1) {
      return Response.json({ error: "fixture session changed before fork" }, { status: 409 });
    }
    return Response.json({
      ok: true,
      slot,
      runId: coopRun.runId,
      checkpointRevision: coopRun.checkpointRevision,
      mutation: "money-plus-one-same-revision",
      sha256: createHash("sha256").update(forked).digest("hex"),
    });
  }
  return saveWorker.fetch(request, {
    DB: saveDb,
    SESSION_SECRET: sessionSecret,
    COOP_IDENTITY_SECRET: identitySecret,
    COOP_IDENTITY_TTL_MS: "300000",
    ALLOWED_ORIGIN: "*",
  } as never);
}

const saveServer = listen(8788, dispatchSaveWorker);
const coopServer = listen(8789, request =>
  coopWorker.fetch(request, {
    DB: coopDb,
    COOP_IDENTITY_SECRET: identitySecret,
    ALLOWED_ORIGIN: "*",
    PRESENCE_WINDOW_MS: "30000",
    P33_REJOIN_GRACE_MS: "120000",
    RUN_TTL_MS: "86400000",
  } as never),
);

function shutdown(): void {
  saveServer.close();
  coopServer.close();
  saveDb.sqlite.close();
  coopDb.sqlite.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

if (process.env.COOP_LOCAL_WORKER_SMOKE === "1") {
  setTimeout(() => {
    Promise.all([fetch("http://127.0.0.1:8788/game/titlestats"), fetch("http://127.0.0.1:8789/coop/health")])
      .then(responses => {
        if (responses.some(response => !response.ok)) {
          throw new Error(`local Worker smoke returned ${responses.map(response => response.status).join(",")}`);
        }
        process.stdout.write("Local Worker fixture smoke passed\n");
        shutdown();
      })
      .catch(error => {
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
        shutdown();
        process.exitCode = 1;
      });
  }, 100);
}
