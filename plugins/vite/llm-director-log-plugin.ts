/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginOption } from "vite";

/**
 * Dev-server middleware that accepts POST /api/llm-log and appends each
 * payload as a JSON line to `llm-director-trace.jsonl` in the repo root.
 *
 * Browser-side `director-log.ts` POSTs every important event here so the
 * player can diagnose by reading a file instead of scrolling DevTools.
 *
 *   tail -f llm-director-trace.jsonl   # follow live during a run
 *
 * Only active in dev (`vite --mode development`); never bundled into the
 * production build.
 */
export function llmDirectorLogPlugin(): PluginOption {
  const LOG_FILE = resolve(process.cwd(), "llm-director-trace.jsonl");

  // Wipe the file at server start so each `pnpm start:dev` session begins
  // clean. The user's playtest is one continuous trace, not an ever-growing
  // append buffer they have to re-grep.
  return {
    name: "llm-director-log",
    apply: "serve",
    configureServer(server) {
      // Truncate (or create) the log file at server start.
      try {
        writeFileSync(LOG_FILE, "");
        // biome-ignore lint/suspicious/noConsole: dev-only plugin status
        console.log(`[llm-director-log] writing to ${LOG_FILE}`);
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: dev-only plugin status
        console.warn("[llm-director-log] failed to truncate log file:", err);
      }

      server.middlewares.use("/api/llm-log", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            // Validate the body parses as JSON before appending — keeps the
            // log file readable as JSONL even if the browser sends garbage.
            JSON.parse(body);
            appendFileSync(LOG_FILE, `${body}\n`);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end('{"ok":true}');
          } catch {
            res.statusCode = 400;
            res.end('{"ok":false,"error":"invalid json"}');
          }
        });
      });
    },
  };
}
