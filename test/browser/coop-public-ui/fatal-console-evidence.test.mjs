/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EvidenceSink, fatalCoopConsoleReason } from "./evidence.mjs";

const fatalLines = [
  "[coop:ASSERT] turn=3 CHECKSUM MISMATCH #1 (severity=log): authoritative payload failed",
  "[coop:checksum] turn=3 MISMATCH host=aaaa guest=bbbb assertion#1 -> heal-once safety net (stateSync)",
  "[coop:checksum] turn=3 ASSERTION-DIFF 2 field(s)",
  "[coop:checksum] turn=3 STRUCTURED APPLY FAILURE (1 section(s)) -> forcing heal-once/resync",
  "[coop-resync] turn=3 UNHEALED party.0.hp host=4 guest=3",
  "[coop:durability] recover cls=reward from=1 blocked=3 attempt=1/8 reason=gap",
  "[coop:durability] gap cls=reward got=3 have=1 -> request tail",
  "[coop:rendezvous] RENDEZVOUS RECOVERY EXHAUSTED point=cmd:3:2 kind=arrival attempts=3",
  "[coop:durability] apply REJECTED cls=reward seq=2 -> no ack (retriable)",
  "[coop:durability] outbound queue COLLAPSED (bounds count=1 bytes=2) -> resync owed",
  "[coop:durability] reconnect cls=reward OVERFLOW: ring evicted ops the peer needs (acked=0 deeper than ring) -> full snapshot at head=9",
  "[coop:durability] deferred continuation EXHAUSTED cls=reward from=1 blocked=2 attempts=4 deadlineMs=9000",
  "[coop:durability] operation continuation EXHAUSTED key=reward:2",
  "[coop:durability] recovery EXHAUSTED cls=reward from=1 blocked=3 attempts=8 reason=gap",
  "[coop:runtime] STALL WATCHDOG: asymmetric wait (local=30s peer=0s) -> recovering (cancel orphan waits)",
  "[coop:me] host await guest index missing; retaining selector and requesting durable replay",
  "[coop:resync] await stateSync start seq=8000001",
  "[coop:resync] guest requestStateSync turn=3 seq=7 START timeout=20000ms",
  "[coop:resync] turn=3 queueing full snapshot apply (blobLen=300)",
  "[coop:resync] turn=3 no snapshot received (timeout) -> keep current state, re-check next turn",
  "[coop:resync] turn=3 still-diverged host=aaaa guest=bbbb",
  "[coop:resync] turn=3 held resync wake did NOT converge reason=checkpoint host=aaaa guest=bbbb",
  "[coop:resync] turn=3 stateSync TIMEOUT/null seq=7",
  "[coop:replay] guest replacement transaction NOT converged checkpointApplied=true host=aaaa guest=bbbb",
  "[coop:reward] crossroads continuation recovery exhausted (deadline) wave=8 turn=1 revision=4",
  "[coop:runtime] shared session stopped safely: reward projection could not converge",
];

const benignLines = [
  "ordinary game checksum mismatch prose",
  "[coop:checksum] guest verify turn=3: MATCH host=guest=aaaa",
  "[coop:durability] apply DEFERRED cls=reward seq=2 -> no ack (boundary pending)",
  "[coop:durability] reconnect resend cls=reward unacked=1",
  "[coop:durability] operation delivery RETRY key=reward:2 attempt=1/8",
  "[coop:durability] resync cls=reward from=2 -> replay 0 entries",
  "[coop:resync] post-rejoin full resync request seq=9300001",
  "[coop:resync] turn=3 applying full snapshot (suppressResummon=false)",
  "[coop:resync] turn=3 ok (healed host=guest=aaaa)",
  "[coop:adopt] erMoneyStreaks host entries=2 -> restored (#837/#348)",
  "[coop:adopt] erMapState host nodes=3 travelTarget=- fragments=0 -> restored (#865/#841 item 1)",
  "[coop:rendezvous] RENDEZVOUS RECOVERY RETRY point=cmd:3:1 after 500ms",
  "[coop:rejoin] Partner reconnected",
];

function consoleMessage(text, type = "warn") {
  return {
    text: () => text,
    type: () => type,
    location: () => ({ url: "http://127.0.0.1:4173/game" }),
  };
}

async function withSink(run, allowedConsoleErrors = []) {
  const artifactDir = await mkdtemp(join(tmpdir(), "coop-fatal-evidence-"));
  const sink = new EvidenceSink("client", artifactDir, allowedConsoleErrors);
  const page = new EventEmitter();
  try {
    await sink.init();
    sink.attach(page);
    await run({ page, sink });
    await sink.flush();
  } finally {
    await rm(artifactDir, { recursive: true, force: true });
  }
}

test("classifies every current checksum, durability, resync, heal, and exhaustion proof", () => {
  for (const line of fatalLines) {
    assert.notEqual(fatalCoopConsoleReason(line), null, line);
  }
});

test("does not confuse healthy convergence, deferred readiness, reconnect, or rendezvous replay with desync", () => {
  for (const line of benignLines) {
    assert.equal(fatalCoopConsoleReason(line), null, line);
  }
});

test("EvidenceSink fails on warning-level recovery and an allowlisted checksum error", async () => {
  await withSink(
    async ({ page, sink }) => {
      page.emit("console", consoleMessage(fatalLines[6], "log"));
      page.emit("console", consoleMessage(fatalLines[0], "error"));
      assert.equal(sink.failures.length, 2);
      assert.deepEqual(
        sink.failures.map(event => event.kind),
        ["coop-fatal-console", "coop-fatal-console"],
      );
      assert.throws(() => sink.assertClean(), /2 fatal browser event\(s\)/u);
    },
    [/CHECKSUM MISMATCH/u],
  );
});

test("EvidenceSink exempts only the stateSync sequence explicitly introduced by hot rejoin", async () => {
  await withSink(async ({ page, sink }) => {
    page.emit("console", consoleMessage("[coop:resync] post-rejoin full resync request seq=9300001", "log"));
    page.emit(
      "console",
      consoleMessage("[coop:resync] guest requestStateSync turn=9300001 seq=1 START timeout=20000ms", "log"),
    );
    page.emit("console", consoleMessage("[coop:durability] resync cls=reward from=2 -> replay 0 entries", "log"));
    assert.equal(sink.failures.length, 0);
    assert.doesNotThrow(() => sink.assertClean());
  });
});

test("a different stateSync sequence still fails during a hot-rejoin window", async () => {
  await withSink(async ({ page, sink }) => {
    page.emit("console", consoleMessage("[coop:resync] post-rejoin full resync request seq=9300001", "log"));
    page.emit(
      "console",
      consoleMessage("[coop:resync] guest requestStateSync turn=3 seq=9 START timeout=20000ms", "log"),
    );
    assert.equal(sink.failures.length, 1);
    assert.equal(sink.failures[0].reason, "state resync attempt");
    assert.throws(() => sink.assertClean(), /1 fatal browser event\(s\)/u);
  });
});
