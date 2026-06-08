/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginOption } from "vite";

/**
 * Dev-server middleware for the LOCAL dev-tools "Send Logs" button.
 *
 * The in-game button (src/dev-tools/local) POSTs a plain-text snapshot of the
 * console ring buffer + current game state to `POST /__devlog`. This middleware
 * writes it to:
 *   - `dev-logs/latest.log`        — always the most recent capture (overwrite)
 *   - `dev-logs/session-<n>.log`   — appended history for this dev session
 *
 * The maintainer (or the AI agent fixing the bug) just reads `dev-logs/latest.log`
 * — a deterministic local path, no clipboard/Downloads juggling.
 *
 * Only active in dev (`vite --mode development`, i.e. `npm run start:dev`);
 * never bundled into a production build. The `dev-logs/` dir is gitignored.
 */
export function devLogPlugin(): PluginOption {
  const DIR = resolve(process.cwd(), "dev-logs");
  const LATEST = resolve(DIR, "latest.log");
  const HISTORY = resolve(DIR, "session.log");

  return {
    name: "er-dev-log",
    apply: "serve",
    configureServer(server) {
      try {
        mkdirSync(DIR, { recursive: true });
        // Start each dev session with a clean history file.
        writeFileSync(HISTORY, "");
        // biome-ignore lint/suspicious/noConsole: dev-only plugin status
        console.log(`[er-dev-log] capture endpoint ready → ${LATEST}`);
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
            const block = `\n===== ${stamp} =====\n${body}\n`;
            writeFileSync(LATEST, `===== ${stamp} =====\n${body}\n`);
            appendFileSync(HISTORY, block);
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
