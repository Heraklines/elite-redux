/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import { watchForTerminal } from "./terminal-watchdog.mjs";

function fakeClient(label) {
  return {
    label,
    evidence: {
      events: [],
      record(kind, detail) {
        this.events.push({ kind, ...detail });
      },
    },
  };
}

test("the terminal watchdog waits for paired GameOver evidence before aborting a duo", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const watchdog = watchForTerminal([authority, renderer], { pollMs: 1 });
  let settled = false;
  watchdog.promise.catch(() => {
    settled = true;
  });

  authority.evidence.events.push({ text: "Start Phase GameOverPhase" });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(settled, false, "one peer's terminal cannot trigger browser teardown");

  renderer.evidence.events.push({ text: "Start Phase GameOverPhase" });
  await assert.rejects(watchdog.promise, /authority: Start Phase GameOverPhase/u);
  watchdog.stop();
});
