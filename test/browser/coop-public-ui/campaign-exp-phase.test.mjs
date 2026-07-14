/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  clientsAwaitingTurnProgress,
  createAnimationProgressBudget,
  createBattlePromptAdvancer,
  driveBattleFallback,
  waitForOutcomeBounded,
} from "./campaign.mjs";

class FakeEvidence {
  constructor(texts = []) {
    this.events = texts.map((text, index) => ({ index, text }));
  }

  find(pattern, from = 0) {
    return this.events.slice(from).find(event => pattern.test(event.text ?? ""));
  }

  findLastSemanticSurface(from = 0, surfaceId = null) {
    return this.events
      .slice(from)
      .toReversed()
      .find(
        event => event.kind === "browser-surface2" && (surfaceId == null || event.observation.surfaceId === surfaceId),
      );
  }

  record(kind, detail = {}) {
    const event = { index: this.events.length, kind, ...detail };
    this.events.push(event);
    return event;
  }

  pushConsole(text) {
    this.events.push({ index: this.events.length, text });
  }

  pushPhase(text, at, monotonicMs = 0) {
    this.events.push({ index: this.events.length, text, at, monotonicMs });
  }

  pushBattleReadiness(surfaceId, phase, awaitingActionInput, phaseInstance) {
    this.events.push({
      index: this.events.length,
      kind: "browser-surface2",
      observation: {
        surfaceId,
        phase,
        phaseInstance,
        uiMode: "MESSAGE",
        ready: { awaitingActionInput },
      },
    });
  }
}

function fakeClient(label, texts = []) {
  return {
    label,
    evidence: new FakeEvidence(texts),
    presses: [],
    sequences: [],
    async press(key, purpose) {
      this.presses.push({ key, purpose });
    },
    async sequence(keys, purpose) {
      this.sequences.push({ keys, purpose });
    },
  };
}

test("ready battle narration and EXP instances advance once each on the public authority", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const stats = { battleMessagePrompts: 0, postBattleExpPrompts: 0 };
  const advance = createBattlePromptAdvancer(rig, { authority: 0, renderer: 0 }, stats, "wave-1-turn-1");

  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", false, 1);
  assert.equal(await advance(), false, "typewriter-in-progress readiness must not consume the phase marker");
  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 1);
  assert.equal(await advance(), true);
  assert.equal(await advance(), false);
  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 1);
  assert.equal(await advance(), false, "a duplicate ready observation must not re-drive one phase instance");
  authority.evidence.pushBattleReadiness("battle:exp", "ExpPhase", true, 2);
  assert.equal(await advance(), true);
  assert.equal(await advance(), false);

  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space", "Space"],
  );
  assert.equal(renderer.presses.length, 0);
  assert.equal(stats.battleMessagePrompts, 1);
  assert.equal(stats.postBattleExpPrompts, 1);
  const advances = authority.evidence.events.filter(event => event.kind === "campaign-battle-prompt-advance");
  assert.equal(advances.length, 2);
  assert.deepEqual(
    advances.map(event => [event.surfaceId, event.phaseInstance]),
    [
      ["battle:message", 1],
      ["battle:exp", 2],
    ],
  );
});

test("the short outcome wait names a fully submitted turn as progress", async () => {
  const authority = fakeClient("authority", ["[coop:turn] host recorder: begin turn=1"]);
  const renderer = fakeClient("renderer", ["Start Phase TurnStartPhase"]);
  const rig = {
    host: authority,
    clients: { authority, renderer },
    config: { faintOwnerSeat: "renderer" },
  };

  assert.deepEqual(clientsAwaitingTurnProgress(rig, { authority: 0, renderer: 0 }), []);
  assert.deepEqual(await waitForOutcomeBounded(rig, { authority: 0, renderer: 0 }, 50, { stopOnTurnProgress: true }), {
    kind: "turn-progress",
  });
});

test("fallback input is sent only to the client whose command never entered the turn", async () => {
  const authority = fakeClient("authority", ["[coop:turn] host recorder: begin turn=1"]);
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const from = { authority: 0, renderer: 0 };

  assert.deepEqual(clientsAwaitingTurnProgress(rig, from), [renderer]);
  assert.deepEqual(await driveBattleFallback(rig, ["Space", "ArrowRight", "Space", "Space"], from, "fallback"), [
    renderer,
  ]);
  assert.equal(authority.sequences.length, 0);
  assert.deepEqual(renderer.sequences, [
    {
      keys: ["Space", "ArrowRight", "Space", "Space"],
      purpose: "fallback-renderer",
    },
  ]);
});

test("real animation progress extends the outcome wait but never crosses its hard ceiling", () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  let nowMs = 1_000;
  const budget = createAnimationProgressBudget(rig, { authority: 0, renderer: 0 }, 100, {
    now: () => nowMs,
    animationAllowanceMs: 200,
    hardCeilingMs: 500,
  });

  assert.equal(budget.deadline(), 1_100);
  authority.evidence.pushPhase("Start Phase MessagePhase", new Date(1_050).toISOString(), 50);
  assert.equal(budget.observe(), 1_100, "ordinary phases must not refresh the animation budget");

  authority.evidence.pushPhase("Start Phase MoveEffectPhase", new Date(1_080).toISOString(), 80);
  assert.equal(budget.observe(), 1_280);
  nowMs = 1_400;
  renderer.evidence.pushPhase("Start Phase CoopMoveAnimReplayPhase", new Date(1_450).toISOString(), 450);
  assert.equal(budget.observe(), 1_500, "a replay animation refresh is clamped to the immutable hard ceiling");
  authority.evidence.pushPhase("Start Phase MoveAnimPhase", new Date(1_490).toISOString(), 490);
  assert.equal(budget.observe(), 1_500, "later activity cannot push the ceiling forward");

  const records = [...authority.evidence.events, ...renderer.evidence.events].filter(
    event => event.kind === "campaign-animation-budget",
  );
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map(event => [event.phase, event.extensionApplied, event.hardCeilingReached]),
    [
      ["MoveEffectPhase", true, false],
      ["MoveAnimPhase", false, true],
      ["CoopMoveAnimReplayPhase", true, true],
    ],
  );
  assert.ok(records.every(event => event.phaseObservedAt && event.hardDeadlineAt));
});
