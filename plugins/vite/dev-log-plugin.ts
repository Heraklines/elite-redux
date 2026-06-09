/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginOption } from "vite";

/** Filesystem-safe slug for triaging capture files (scenario / comment). */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Dev-server middleware for the LOCAL dev-tools "Send Logs" + Pass/Fail buttons.
 *
 * The in-game tools (src/dev-tools/local) POST to `POST /__devlog`. Nothing is
 * ever overwritten/lost — every capture is preserved:
 *
 *   - Full log captures (Send Logs):
 *       · `dev-logs/captures/<timestamp>.log` — a UNIQUE file per send (the
 *         durable record — never overwritten)
 *       · `dev-logs/latest.log`              — convenience copy of the newest
 *         capture (overwritten, for quick access)
 *       · `dev-logs/session.log`             — cumulative append of all captures,
 *         persists ACROSS dev-server restarts
 *   - Pass/Fail results (bodies starting "TEST RESULT:"):
 *       · `dev-logs/results.log`             — append-only verification ledger
 *
 * Only active in dev (`vite --mode development`, i.e. `npm run start:dev`);
 * never bundled into a production build. The `dev-logs/` dir is gitignored.
 */
export function devLogPlugin(): PluginOption {
  const DIR = resolve(process.cwd(), "dev-logs");
  const CAPTURES = resolve(DIR, "captures");
  const LATEST = resolve(DIR, "latest.log");
  const HISTORY = resolve(DIR, "session.log");
  const RESULTS = resolve(DIR, "results.log");

  return {
    name: "er-dev-log",
    apply: "serve",
    configureServer(server) {
      try {
        mkdirSync(CAPTURES, { recursive: true });
        // NOTE: do NOT wipe session.log / results.log on startup — they are
        // durable cumulative records across dev-server restarts.
        // biome-ignore lint/suspicious/noConsole: dev-only plugin status
        console.log(`[er-dev-log] capture endpoint ready → ${DIR} (captures/ + results.log preserved)`);
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: dev-only plugin status
        console.warn("[er-dev-log] failed to prepare dev-logs dir:", err);
      }

      server.middlewares.use("/__devlog", (req, res) => {
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
            const stamp = new Date().toISOString();
            if (body.startsWith("TEST RESULT:")) {
              // Pass/Fail ledger — append-only, never overwritten.
              appendFileSync(RESULTS, `[${stamp}] ${body.endsWith("\n") ? body : `${body}\n`}`);
            } else {
              // Full capture — AUTO-TRIAGED by scenario so it's easy to find later
              // (esp. after a memory reset). The client tags each report with a
              // "scenario: <label>" line and an optional "----- COMMENT -----"
              // block; we file the capture under captures/<scenario-slug>/ with a
              // comment slug in the filename.
              const safeStamp = stamp.replace(/[:.]/g, "-");
              const scenario = body.match(/^scenario:\s*(.+)$/m)?.[1] ?? "";
              const comment = body.match(/----- COMMENT -----\n([\s\S]*?)\n\n/)?.[1] ?? "";
              const scenarioSlug = slug(scenario) || "no-scenario";
              const commentSlug = slug(comment);
              const dir = resolve(CAPTURES, scenarioSlug);
              mkdirSync(dir, { recursive: true });
              const fileName = commentSlug ? `${safeStamp}__${commentSlug}.log` : `${safeStamp}.log`;
              writeFileSync(resolve(dir, fileName), body);
              writeFileSync(LATEST, `===== ${stamp} =====\n${body}\n`);
              appendFileSync(HISTORY, `\n===== ${stamp} =====\n${body}\n`);
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end('{"ok":true}');
          } catch (err) {
            res.statusCode = 500;
            res.end(`{"ok":false,"error":${JSON.stringify(String(err))}}`);
          }
        });
      });
    },
  };
}
