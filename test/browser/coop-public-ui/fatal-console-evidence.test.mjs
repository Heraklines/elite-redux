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
import {
  EvidenceSink,
  fatalCoopConsoleReason,
  isExpectedLocaleFallbackError,
  isExpectedMissingSystemSaveError,
  isExpectedUnavailableStagingTournamentError,
} from "./evidence.mjs";

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
  "[coop:relay] peer recv commandRequest fieldIndex=0 owner=guest turn=2 for a slot that is NOT ours -> DECLINE reply (host AI-falls-back, #693)",
  "[coop:relay] recv command DECLINE fieldIndex=0 turn=2 -> AI fallback",
  "[coop:runtime] STALL WATCHDOG: asymmetric wait (local=30s peer=0s) -> recovering (cancel orphan waits)",
  "[coop:me] host await guest index missing; retaining selector and requesting durable replay",
  "[coop:resync] await stateSync start seq=8000001",
  "[coop:resync] guest requestStateSync id=session:7 reason=turn-checksum e=1 wave=2 turn=3 START timeout=20000ms",
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
  // Delivery retry exhaustion is not a terminal: the exact continuation deadline remains
  // armed and the retained journal/resync path can still admit and ACK the operation.
  "[coop:durability] operation delivery retries exhausted key=reward:2 attempts=3; continuation deadline remains armed",
  "[coop:durability] resync cls=reward from=2 -> replay 0 entries",
  "[coop:resync] post-rejoin full resync request seq=9300001",
  "[coop:resync] turn=3 applying full snapshot (suppressResummon=false)",
  "[coop:resync] turn=3 ok (healed host=guest=aaaa)",
  "[coop:adopt] erMoneyStreaks host entries=2 -> restored (#837/#348)",
  "[coop:adopt] erMapState host nodes=3 travelTarget=- fragments=0 -> restored (#865/#841 item 1)",
  "[coop:rendezvous] RENDEZVOUS RECOVERY RETRY point=cmd:3:1 after 500ms",
  "[coop:rejoin] Partner reconnected",
  "[coop:checksum] PRESENTATION MISMATCH sections=movesName,abilitiesName - simulation compatible - movesName local=aaa peer=bbb abilitiesName local=ccc peer=ddd",
];

function consoleMessage(text, type = "warn") {
  return {
    text: () => text,
    type: () => type,
    location: () => ({ url: "http://127.0.0.1:4173/game" }),
  };
}

/** An error-level console message whose source location is a specific resource URL. */
function errorAt(text, url) {
  return {
    text: () => text,
    type: () => "error",
    location: () => ({ url }),
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

test("only non-English locale JSON 404s are classified as expected i18next fallback probes", () => {
  const error = "Failed to load resource: the server responded with a status of 404 (Not Found)";
  for (const locale of ["de", "fr", "ja", "zh-Hans", "ar", "ru", "future-locale"]) {
    assert.equal(isExpectedLocaleFallbackError("error", error, `https://game.test/locales/${locale}/menu.json`), true);
  }
  assert.equal(isExpectedLocaleFallbackError("error", error, "https://game.test/locales/en/menu.json"), false);
  assert.equal(isExpectedLocaleFallbackError("error", error, "https://game.test/assets/missing.json"), false);
  assert.equal(isExpectedLocaleFallbackError("warning", error, "https://game.test/locales/de/menu.json"), false);
  assert.equal(
    isExpectedLocaleFallbackError(
      "error",
      "Failed to load resource: status of 500",
      "https://game.test/locales/de/menu.json",
    ),
    false,
  );
});

test("fresh/dirty account exempts ONLY the two exact missing save/session reads, nothing else", () => {
  const notFound = "Failed to load resource: the server responded with a status of 404 ()";
  const api = "https://er-save-api-staging.heraklines.workers.dev";
  // Track R cycle-11 dirty lane (run 29654429335): a freshly-registered dirty account has no system
  // save yet, so exactly these two reads legitimately 404. They are expected ONLY under the
  // fresh-account flag.
  for (const path of ["/savedata/system/get", "/savedata/session/get"]) {
    assert.equal(isExpectedMissingSystemSaveError("error", notFound, `${api}${path}`, true), true, path);
    // No flag (ordinary existing login account) => still fatal.
    assert.equal(isExpectedMissingSystemSaveError("error", notFound, `${api}${path}`, false), false, path);
  }
  assert.equal(isExpectedMissingSystemSaveError("error", "Session read failed (missing).", api, true), true);
  // STILL FATAL even with the flag: any OTHER endpoint's 404, a non-404 status, or a non-error level.
  assert.equal(
    isExpectedMissingSystemSaveError("error", notFound, `${api}/savedata/session/coop-cas-update`, true),
    false,
  );
  assert.equal(isExpectedMissingSystemSaveError("error", notFound, `${api}/savedata/updateall`, true), false);
  assert.equal(
    isExpectedMissingSystemSaveError(
      "error",
      "Failed to load resource: the server responded with a status of 500 ()",
      `${api}/savedata/system/get`,
      true,
    ),
    false,
  );
  assert.equal(isExpectedMissingSystemSaveError("warning", notFound, `${api}/savedata/system/get`, true), false);
});

test("only the unavailable staging tournament poll is non-fatal", () => {
  const notFound = "Failed to load resource: the server responded with a status of 404 ()";
  const staging = "https://er-save-api-staging.heraklines.workers.dev";
  assert.equal(isExpectedUnavailableStagingTournamentError("error", notFound, `${staging}/tournament/list`), true);
  assert.equal(
    isExpectedUnavailableStagingTournamentError(
      "error",
      notFound,
      "https://er-save-api.heraklines.workers.dev/tournament/list",
    ),
    false,
  );
  assert.equal(
    isExpectedUnavailableStagingTournamentError("error", notFound, `${staging}/savedata/session/get`),
    false,
  );
  assert.equal(
    isExpectedUnavailableStagingTournamentError(
      "error",
      "Failed to load resource: the server responded with a status of 500 ()",
      `${staging}/tournament/list`,
    ),
    false,
  );
  assert.equal(isExpectedUnavailableStagingTournamentError("warning", notFound, `${staging}/tournament/list`), false);
});

test("EvidenceSink exempts the two fresh-account save 404s but keeps every other 404/pageerror fatal", async () => {
  const notFound = "Failed to load resource: the server responded with a status of 404 ()";
  const api = "https://er-save-api-staging.heraklines.workers.dev";
  const artifactDir = await mkdtemp(join(tmpdir(), "coop-fresh-account-"));
  const sink = new EvidenceSink("client", artifactDir, [], 0, true);
  const page = new EventEmitter();
  try {
    await sink.init();
    sink.attach(page);
    // The two designed fresh-account reads: exempt (recorded expected, never a failure).
    page.emit("console", errorAt(notFound, `${api}/savedata/system/get`));
    page.emit("console", errorAt(notFound, `${api}/savedata/session/get`));
    assert.equal(sink.failures.length, 0);
    // A 404 on ANY OTHER endpoint stays fatal.
    page.emit("console", errorAt(notFound, `${api}/savedata/session/coop-cas-update`));
    assert.equal(sink.failures.length, 1);
    // A pageerror is always fatal, flag or not.
    page.emit("pageerror", new Error("TypeError: (t ?? []) is not iterable"));
    assert.equal(sink.failures.length, 2);
    assert.throws(() => sink.assertClean(), /2 fatal browser event\(s\)/u);
  } finally {
    // EventEmitter callbacks enqueue batched evidence writes synchronously but the file append itself is
    // serialized. Drain that queue before deleting the fixture directory; otherwise the 150 ms flush can
    // race cleanup and surface as an unrelated post-test ENOENT/unhandledRejection.
    await sink.flush();
    await rm(artifactDir, { recursive: true, force: true });
  }
});

test("without the fresh-account flag the same two save 404s stay fatal", async () => {
  const notFound = "Failed to load resource: the server responded with a status of 404 ()";
  const api = "https://er-save-api-staging.heraklines.workers.dev";
  const artifactDir = await mkdtemp(join(tmpdir(), "coop-existing-account-"));
  const sink = new EvidenceSink("client", artifactDir, [], 0, false);
  const page = new EventEmitter();
  try {
    await sink.init();
    sink.attach(page);
    page.emit("console", errorAt(notFound, `${api}/savedata/system/get`));
    assert.equal(sink.failures.length, 1);
  } finally {
    await sink.flush();
    await rm(artifactDir, { recursive: true, force: true });
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

test("EvidenceSink exempts only a stateSync ticket explicitly marked as hot rejoin", async () => {
  await withSink(async ({ page, sink }) => {
    page.emit("console", consoleMessage("[coop:resync] post-rejoin full resync request seq=9300001", "log"));
    page.emit(
      "console",
      consoleMessage(
        "[coop:resync] guest requestStateSync id=session:1 reason=rejoin e=1 wave=3 turn=1 START timeout=20000ms",
        "log",
      ),
    );
    page.emit("console", consoleMessage("[coop:durability] resync cls=reward from=2 -> replay 0 entries", "log"));
    assert.equal(sink.failures.length, 0);
    assert.doesNotThrow(() => sink.assertClean());
  });
});

test("a non-rejoin stateSync ticket still fails during a hot-rejoin window", async () => {
  await withSink(async ({ page, sink }) => {
    page.emit("console", consoleMessage("[coop:resync] post-rejoin full resync request seq=9300001", "log"));
    page.emit(
      "console",
      consoleMessage(
        "[coop:resync] guest requestStateSync id=session:9 reason=turn-checksum e=1 wave=3 turn=1 START timeout=20000ms",
        "log",
      ),
    );
    assert.equal(sink.failures.length, 1);
    assert.equal(sink.failures[0].reason, "state resync attempt");
    assert.throws(() => sink.assertClean(), /1 fatal browser event\(s\)/u);
  });
});

test("only an exact already-rendered paired GameOver may supersede normal shared teardown", async () => {
  await withSink(async ({ page, sink }) => {
    assert.throws(() => sink.expectSharedTerminalAfterPairedGameOver(0), /without exact GameOver evidence/u);
    page.emit("console", consoleMessage("Start Phase GameOverPhase", "log"));
    const gameOver = sink.events.find(event => /Start Phase GameOverPhase/u.test(event.text ?? ""));
    sink.expectSharedTerminalAfterPairedGameOver(gameOver.index);
    page.emit("console", consoleMessage("[coop:runtime] shared session stopped safely: game over", "log"));

    assert.equal(sink.failures.length, 0);
    assert.equal(sink.events.at(-1).kind, "expected-shared-terminal");
    assert.doesNotThrow(() => sink.assertClean());
  });
});

test("shared teardown remains fatal before the exact GameOver latch is armed", async () => {
  await withSink(async ({ page, sink }) => {
    page.emit("console", consoleMessage("[coop:runtime] shared session stopped safely: early teardown", "log"));
    assert.equal(sink.failures.length, 1);
    assert.equal(sink.failures[0].reason, "shared session terminated");
  });
});
