/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { webcrypto } from "node:crypto";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleP33SignalingRequest,
  type P33SignalingEnv,
  pruneP33Signaling,
} from "../../../../workers/er-coop-api/src/p33-signaling";

interface D1ResultLike {
  success: boolean;
  results: Record<string, unknown>[];
  meta: { changes: number; last_row_id?: number | bigint };
}

class SqliteD1Statement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private readonly bindings: SQLInputValue[];

  public constructor(database: DatabaseSync, sql: string, bindings: SQLInputValue[] = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  public bind(...values: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.database, this.sql, values as SQLInputValue[]);
  }

  public async first<T>(): Promise<T | null> {
    return (this.statement().get(...this.bindings) as unknown as T | undefined) ?? null;
  }

  public async all<T extends Record<string, unknown>>(): Promise<D1ResultLike & { results: T[] }> {
    return {
      success: true,
      results: this.statement().all(...this.bindings) as unknown as T[],
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
    return this.database.prepare(this.sql);
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
    return { count: 0, duration: 0 };
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

interface AnnounceResult {
  presenceId: string;
  pairingToken: string;
  identity: { accountId: string; displayName: string; canonicalUsername: string };
  pairing: PairingResult | null;
}

interface PairingResult {
  code: string;
  pairingId: string;
  transportRole: "offerer" | "answerer";
  connectionGeneration: number;
  account: { accountId: string; displayName: string; canonicalUsername: string };
  peer: { accountId: string; displayName: string; canonicalUsername: string; connectionGeneration: number };
}

const secret = "p33-signaling-worker-integration-secret-at-least-32-bytes";
const start = 1_800_000_000_000;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

async function ticket(
  accountId: string,
  displayName: string,
  ticketNonce: string,
  expiresAt = Date.now() + 60_000,
): Promise<string> {
  const canonicalUsername = displayName.toLowerCase();
  const body = base64Url(
    new TextEncoder().encode(
      JSON.stringify({ v: 1, sub: accountId, displayName, canonicalUsername, exp: expiresAt, nonce: ticketNonce }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `${body}.${base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))))}`;
}

function nonce(prefix: string): string {
  return `${prefix}${"A".repeat(Math.max(0, 24 - prefix.length))}`;
}

describe("P33 authenticated signaling Worker", () => {
  let sqlite: DatabaseSync;
  let database: SqliteD1Database;
  let env: P33SignalingEnv;

  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    vi.useFakeTimers();
    vi.setSystemTime(start);
    sqlite = new DatabaseSync(":memory:");
    database = new SqliteD1Database(sqlite);
    env = {
      DB: database as unknown as P33SignalingEnv["DB"],
      COOP_IDENTITY_SECRET: secret,
      ALLOWED_ORIGIN: "https://staging.example.test",
      PRESENCE_WINDOW_MS: "30000",
    };
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function call(
    path: string,
    options: { method?: "GET" | "POST"; body?: Record<string, unknown>; token?: string } = {},
  ): Promise<{ status: number; body: Record<string, any> }> {
    const headers = new Headers();
    if (options.body != null) {
      headers.set("Content-Type", "application/json");
    }
    if (options.token != null) {
      headers.set("Authorization", `Bearer ${options.token}`);
    }
    const response = await handleP33SignalingRequest(
      new Request(`https://coop.example.test${path}`, {
        method: options.method ?? (options.body == null ? "GET" : "POST"),
        headers,
        ...(options.body == null ? {} : { body: JSON.stringify(options.body) }),
      }),
      env,
    );
    expect(response).not.toBeNull();
    return {
      status: response!.status,
      body: (await response!.json()) as Record<string, any>,
    };
  }

  async function announce(
    accountId: string,
    displayName: string,
    ticketNonce: string,
    clientNonce: string,
  ): Promise<AnnounceResult> {
    const response = await call("/coop/v3/lobby/announce", {
      body: { ticket: await ticket(accountId, displayName, ticketNonce), clientNonce },
    });
    expect(response.status).toBe(200);
    return response.body as unknown as AnnounceResult;
  }

  async function pair(): Promise<{ alice: AnnounceResult; bob: AnnounceResult; code: string }> {
    const alice = await announce("er-account:11", "Alice", nonce("alice-ticket"), nonce("alice-client"));
    const bob = await announce("er-account:22", "Bob", nonce("bob-ticket"), nonce("bob-client"));
    expect(
      await call("/coop/v3/lobby/request", {
        body: { self: alice.presenceId, target: bob.presenceId },
        token: alice.pairingToken,
      }),
    ).toMatchObject({ status: 200, body: { ok: true } });
    const incoming = await call(`/coop/v3/lobby?self=${encodeURIComponent(bob.presenceId)}`, {
      token: bob.pairingToken,
    });
    expect(incoming.body.request).toMatchObject({
      id: alice.presenceId,
      accountId: "er-account:11",
      name: "Alice",
    });
    const accepted = await call("/coop/v3/lobby/respond", {
      body: { self: bob.presenceId, from: alice.presenceId, accept: true },
      token: bob.pairingToken,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      transportRole: "offerer",
      connectionGeneration: 0,
      account: { accountId: "er-account:22" },
      peer: { accountId: "er-account:11", connectionGeneration: 0 },
    });
    return { alice, bob, code: accepted.body.code as string };
  }

  it("binds immutable account identity once and rejects spoofed, duplicate, stale, or unauthenticated presence", async () => {
    const sharedTicket = await ticket("er-account:11", "Alice", nonce("single-ticket"));
    const first = await call("/coop/v3/lobby/announce", {
      body: { ticket: sharedTicket, clientNonce: nonce("single-client") },
    });
    expect(first).toMatchObject({
      status: 200,
      body: { identity: { accountId: "er-account:11", displayName: "Alice", canonicalUsername: "alice" } },
    });
    const retry = await call("/coop/v3/lobby/announce", {
      body: { ticket: sharedTicket, clientNonce: nonce("single-client") },
    });
    expect(retry.body).toMatchObject({ presenceId: first.body.presenceId, pairingToken: first.body.pairingToken });
    expect(
      await call("/coop/v3/lobby/announce", {
        body: { ticket: sharedTicket, clientNonce: nonce("rebound-client") },
      }),
    ).toMatchObject({ status: 401 });

    expect(
      await call("/coop/v3/lobby/announce", {
        body: {
          ticket: await ticket("er-account:11", "Forged Name", nonce("second-ticket")),
          clientNonce: nonce("second-client"),
        },
      }),
    ).toMatchObject({ status: 409 });
    expect(await call(`/coop/v3/lobby?self=${first.body.presenceId}`)).toMatchObject({ status: 401 });
    expect(await call(`/coop/v3/lobby?self=${first.body.presenceId}`, { token: nonce("wrong-token") })).toMatchObject({
      status: 401,
    });

    expect(
      await call("/coop/v3/lobby/announce", {
        body: {
          ticket: await ticket("er-account:33", "Expired", nonce("expired-ticket"), Date.now() - 1),
          clientNonce: nonce("expired-client"),
        },
      }),
    ).toMatchObject({ status: 401 });
  });

  it("pairs two authenticated accounts and fences all lobby and one-shot signal operations with bearer tokens", async () => {
    const { alice, bob, code } = await pair();
    const alicePairing = await call(`/coop/v3/lobby?self=${encodeURIComponent(alice.presenceId)}`, {
      token: alice.pairingToken,
    });
    expect(alicePairing.body.pairing).toMatchObject({
      code,
      transportRole: "answerer",
      account: { accountId: "er-account:11" },
      peer: { accountId: "er-account:22" },
    });
    expect(
      await call("/coop/v3/signal", { body: { code, signal: "offer-sdp" }, token: bob.pairingToken }),
    ).toMatchObject({ status: 200 });
    expect(await call(`/coop/v3/signal?code=${code}`, { token: alice.pairingToken })).toMatchObject({
      status: 200,
      body: { signal: "offer-sdp" },
    });
    expect(await call(`/coop/v3/signal?code=${code}`, { token: alice.pairingToken })).toMatchObject({
      status: 200,
      body: { signal: null },
    });
    expect(await call(`/coop/v3/signal?code=${code}`, { token: nonce("invalid-token") })).toMatchObject({
      status: 401,
    });
    expect(
      await call("/coop/v3/lobby/respond", {
        body: { self: bob.presenceId, from: alice.presenceId, accept: true },
        token: bob.pairingToken,
      }),
    ).toMatchObject({ status: 409 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM coop_runs_p33").get()).toEqual({ count: 1 });
  });

  it("keeps a live human join request actionable beyond the presence heartbeat window", async () => {
    const alice = await announce(
      "er-account:11",
      "Alice",
      nonce("alice-request-ticket"),
      nonce("alice-request-client"),
    );
    const bob = await announce("er-account:22", "Bob", nonce("bob-request-ticket"), nonce("bob-request-client"));
    expect(
      await call("/coop/v3/lobby/request", {
        body: { self: alice.presenceId, target: bob.presenceId },
        token: alice.pairingToken,
      }),
    ).toMatchObject({ status: 200 });

    // Reproduce the production browser delay: the request itself is older than the 12s
    // presence window, but the requester is still actively heartbeating. The old worker hid the
    // Accept row at this point and a queued Space landed on a newly rendered player row instead.
    vi.setSystemTime(start + 12_001);
    expect(
      await call(`/coop/v3/lobby?self=${encodeURIComponent(alice.presenceId)}`, {
        token: alice.pairingToken,
      }),
    ).toMatchObject({ status: 200 });
    const stillActionable = await call(`/coop/v3/lobby?self=${encodeURIComponent(bob.presenceId)}`, {
      token: bob.pairingToken,
    });
    expect(stillActionable.body.request).toMatchObject({ id: alice.presenceId, name: "Alice" });

    expect(
      await call("/coop/v3/lobby/respond", {
        body: { self: bob.presenceId, from: alice.presenceId, accept: true },
        token: bob.pairingToken,
      }),
    ).toMatchObject({ status: 200 });
  });

  it("reclaims a stale account-unique pair when both closed browsers explicitly pair again", async () => {
    const first = await pair();
    // Browser page teardown is not a reliable place for a fetch/beacon. Reproduce the server state
    // from the public journey: the discoverable lobby rows have gone, but the old run's account-unique
    // membership survived and both gameplay heartbeats are older than one full presence window.
    sqlite.prepare("DELETE FROM coop_lobby_p33 WHERE paired_code = ?").run(first.code);
    vi.setSystemTime(start + 12_001);

    const alice = await announce("er-account:11", "Alice", nonce("alice-cold-ticket"), nonce("alice-cold-client"));
    const bob = await announce("er-account:22", "Bob", nonce("bob-cold-ticket"), nonce("bob-cold-client"));
    expect(
      await call("/coop/v3/lobby/request", {
        body: { self: alice.presenceId, target: bob.presenceId },
        token: alice.pairingToken,
      }),
    ).toMatchObject({ status: 200 });
    const accepted = await call("/coop/v3/lobby/respond", {
      body: { self: bob.presenceId, from: alice.presenceId, accept: true },
      token: bob.pairingToken,
    });

    expect(accepted).toMatchObject({
      status: 200,
      body: {
        transportRole: "offerer",
        account: { accountId: "er-account:22" },
        peer: { accountId: "er-account:11" },
      },
    });
    expect(accepted.body.code).not.toBe(first.code);
    expect(sqlite.prepare("SELECT state FROM coop_runs_p33 WHERE code = ?").get(first.code)).toEqual({
      state: "ended",
    });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM coop_pair_members_p33 WHERE code = ?").get(accepted.body.code),
    ).toEqual({ count: 2 });
  });

  it("hot-rejoins only the same account, rotates its bearer, and increments exactly one connection generation", async () => {
    const { alice, bob, code } = await pair();
    expect(
      await call("/coop/v3/rejoin", {
        body: {
          code,
          ticket: await ticket("er-account:99", "Mallory", nonce("mallory-ticket")),
          clientNonce: nonce("mallory-client"),
        },
      }),
    ).toMatchObject({ status: 403 });

    const aliceRejoinTicket = await ticket("er-account:11", "Alice Renamed", nonce("alice-rejoin-ticket"));
    const rejoinBody = { code, ticket: aliceRejoinTicket, clientNonce: nonce("alice-rejoin-client") };
    const rebound = await call("/coop/v3/rejoin", { body: rejoinBody });
    expect(rebound).toMatchObject({
      status: 200,
      body: {
        identity: { accountId: "er-account:11", displayName: "Alice Renamed" },
        pairing: {
          transportRole: "answerer",
          connectionGeneration: 1,
          account: { accountId: "er-account:11", displayName: "Alice Renamed" },
          peer: { accountId: "er-account:22", connectionGeneration: 0 },
        },
      },
    });
    const retry = await call("/coop/v3/rejoin", { body: rejoinBody });
    expect(retry.body.pairing).toMatchObject({ connectionGeneration: 1 });
    expect(await call("/coop/v3/signal", { body: { code, signal: "stale" }, token: alice.pairingToken })).toMatchObject(
      { status: 401 },
    );
    expect(
      await call("/coop/v3/signal", {
        body: { code, signal: "fresh" },
        token: rebound.body.pairingToken as string,
      }),
    ).toMatchObject({ status: 200 });
    const peerView = await call(`/coop/v3/lobby?self=${encodeURIComponent(bob.presenceId)}`, {
      token: bob.pairingToken,
    });
    expect(peerView.body.pairing.peer).toMatchObject({
      accountId: "er-account:11",
      displayName: "Alice Renamed",
      connectionGeneration: 1,
    });
    expect(sqlite.prepare("SELECT offerer_generation, answerer_generation FROM coop_runs_p33").get()).toEqual({
      offerer_generation: 0,
      answerer_generation: 1,
    });
  });

  it("moves a missing peer into bounded grace and prunes expired authenticated state", async () => {
    const { alice, bob, code } = await pair();
    expect(await call("/coop/v3/leave", { body: { code }, token: alice.pairingToken })).toMatchObject({
      status: 200,
      body: { state: "grace" },
    });
    expect(await call("/coop/v3/heartbeat", { body: { code }, token: bob.pairingToken })).toMatchObject({
      status: 200,
      body: { state: "grace", bothPresent: false, partnerPresent: false },
    });

    vi.setSystemTime(start + 25 * 60 * 60_000);
    await pruneP33Signaling(env, Date.now(), 24 * 60 * 60_000);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM coop_runs_p33").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM coop_pair_members_p33").get()).toEqual({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM coop_ticket_bindings_p33").get()).toEqual({ count: 0 });
  });

  it("releases lobby membership only through the explicit post-terminal end route", async () => {
    const { alice, bob, code } = await pair();
    expect(await call("/coop/v3/end", { body: { code }, token: bob.pairingToken })).toMatchObject({
      status: 200,
      body: { ok: true, state: "ended" },
    });
    expect(await call("/coop/v3/heartbeat", { body: { code }, token: alice.pairingToken })).toMatchObject({
      status: 401,
    });
    const fresh = await announce(
      "er-account:11",
      "Alice",
      nonce("alice-after-end-ticket"),
      nonce("alice-after-end-client"),
    );
    expect(fresh.identity.accountId).toBe("er-account:11");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM coop_pair_members_p33").get()).toEqual({ count: 0 });
  });
});
