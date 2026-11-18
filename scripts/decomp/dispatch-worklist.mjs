/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Emits the dispatch-key WORKLIST (never declarations) as JSON on stdout:
//   node scripts/decomp/dispatch-worklist.mjs > /tmp/dispatch-worklist.json
import { scanDispatchKeys } from "./dispatch-scan.mjs";

const scan = scanDispatchKeys(process.cwd());
process.stdout.write(`${JSON.stringify(scan, null, 2)}\n`);
