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
  resolveSurfaceOwner,
  waitForOutcomeBounded,
} from "./campaign.mjs";
import { DuoPublicUiRig, PublicUiClient } from "./public-ui-harness.mjs";

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

  findLastSurface(surface, from = 0) {
    return this.events
      .slice(from)
      .toReversed()
      .find(event => event.kind === "browser-surface" && event.observation.surface === surface);
  }

  async waitForCondition(predicate, { description = "condition" } = {}) {
    const result = predicate(this);
    if (result) {
      return result;
    }
    throw new Error(`timed out waiting for ${description}`);
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

  pushCommandSurface(address = { epoch: 7, wave: 1, turn: 1 }) {
    this.events.push({
      index: this.events.length,
      kind: "browser-surface",
      observation: { surface: "command", ...address },
    });
  }

  pushBattleReadiness(
    surfaceId,
    phase,
    awaitingActionInput,
    phaseInstance,
    handlerActive = true,
    address = { epoch: 7, wave: 1, turn: 1 },
  ) {
    this.events.push({
      index: this.events.length,
      kind: "browser-surface2",
      observation: {
        surfaceId,
        coop: true,
        phase,
        phaseInstance,
        uiMode: "MESSAGE",
        ownerModel: "local",
        localSeat: 0,
        seatsWithInput: [0],
        ready: { awaitingActionInput, handlerActive },
        address,
      },
    });
  }
}

test("owned semantic CommandPhase readiness survives a console-regex miss and enforces UI ownership", async () => {
  const evidence = new FakeEvidence(["[coop:battle] command surface opened for the local player"]);
  const commandSurface = {
    index: evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:command",
      phase: "CommandPhase",
      uiMode: "COMMAND",
      localSeat: 1,
      seatsWithInput: [1],
      ready: { handlerActive: true },
    },
  };
  evidence.events.push(commandSurface);
  const client = { publicSeat: 1, evidence, config: { timeoutMs: 1 } };

  assert.equal(evidence.find(/CommandPhase .*-> LOCAL UI/u), undefined, "the legacy console predicate must miss");
  assert.equal(await PublicUiClient.prototype.waitForLocalCommand.call(client, 0), commandSurface);

  const inactiveEvidence = new FakeEvidence(["[coop:runtime] shared session stopped safely: test terminal"]);
  inactiveEvidence.events.unshift({
    ...commandSurface,
    index: 0,
    observation: { ...commandSurface.observation, ready: { handlerActive: false } },
  });
  await assert.rejects(
    PublicUiClient.prototype.waitForLocalCommand.call(
      { publicSeat: 1, evidence: inactiveEvidence, config: { timeoutMs: 1 } },
      0,
    ),
    /shared session terminated before owned CommandPhase/u,
  );
});

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

test("phase presence waits for its declared semantic UI before judging owner evidence", () => {
  const authority = fakeClient("authority", ["Start Phase EggLapsePhase"]);
  const renderer = fakeClient("renderer", ["Start Phase EggLapsePhase"]);
  const rig = { host: authority, clients: { authority, renderer } };
  const driver = {
    name: "egg",
    present: /Start Phase EggLapsePhase/u,
    v2SurfaceId: "egg:lapse",
    owner: { role: "host" },
  };
  const cursors = { authority: 0, renderer: 0 };

  assert.equal(
    resolveSurfaceOwner(rig, driver, cursors, new Map(), true),
    null,
    "the preceding recall/message prompt must be driven before egg ownership is evaluated",
  );

  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: { surfaceId: "egg:lapse", localSeat: 0, ownerSeat: 1 },
  });
  assert.throws(
    () => resolveSurfaceOwner(rig, driver, cursors, new Map(), true),
    /never reported an owner/u,
    "once the semantic surface exists, malformed owner evidence still fails loudly",
  );
});

test("only ready active local battle narration and EXP instances advance once on each public client", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const stats = { battleMessagePrompts: 0, postBattleExpPrompts: 0 };
  authority.evidence.pushCommandSurface();
  renderer.evidence.pushCommandSurface();
  const advance = createBattlePromptAdvancer(rig, { authority: 0, renderer: 0 }, stats, "wave-1-turn-1");

  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", false, 1);
  assert.equal(await advance(), false, "typewriter-in-progress readiness must not consume the phase marker");
  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 1);
  assert.equal(await advance(), true);
  assert.equal(await advance(), false);
  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 1);
  assert.equal(await advance(), false, "a duplicate ready observation must not re-drive one phase instance");
  renderer.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 1);
  assert.equal(await advance(), true, "a renderer faint narration is a distinct human-action surface");
  assert.equal(await advance(), false);
  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 3, false);
  renderer.evidence.pushBattleReadiness("command:command", "CommandPhase", true, 2);
  assert.equal(await advance(), false, "inactive and non-battle surfaces must never receive fallback input");
  renderer.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 3, true, {
    epoch: 7,
    wave: 1,
    turn: 2,
  });
  assert.equal(await advance(), false, "a ready prompt from a different turn address must never receive input");
  authority.evidence.pushBattleReadiness("battle:exp", "ExpPhase", true, 2);
  assert.equal(await advance(), true);
  assert.equal(await advance(), false);

  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space", "Space"],
  );
  assert.deepEqual(
    renderer.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.equal(stats.battleMessagePrompts, 2);
  assert.equal(stats.postBattleExpPrompts, 1);
  const advances = [...authority.evidence.events, ...renderer.evidence.events].filter(
    event => event.kind === "campaign-battle-prompt-advance",
  );
  assert.equal(advances.length, 3);
  assert.deepEqual(
    advances.map(event => [event.inputSeat, event.surfaceId, event.phaseInstance]),
    [
      ["authority", "battle:message", 1],
      ["authority", "battle:exp", 2],
      ["renderer", "battle:message", 1],
    ],
  );
});

test("pre-command launch advances a readiness-proven SummonPhase prompt without inventing a command address", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const stats = {};
  const advance = createBattlePromptAdvancer(rig, { authority: 0, renderer: 0 }, stats, "fresh-wave-1-intro", {
    requireSharedCommandAddress: false,
  });

  authority.evidence.pushBattleReadiness("battle:message", "SummonPhase", true, 1);
  assert.equal(await advance(), true);
  assert.equal(await advance(), false, "one prompt generation must receive exactly one public action");
  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.equal(stats.battleMessagePrompts, 1);
});

test("the short public journey advances readiness-proven narration before polling the next outcome", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const clients = { authority, renderer };
  for (const client of Object.values(clients)) {
    client.evidence.pushCommandSurface();
    client.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 1);
    client.press = async function press(key, purpose) {
      this.presses.push({ key, purpose });
      this.evidence.pushConsole("CommandPhase regression -> LOCAL UI");
    };
  }
  const rig = {
    host: authority,
    clients,
    config: { faintOwnerSeat: "renderer", timeoutMs: 1_000 },
  };

  assert.deepEqual(await DuoPublicUiRig.prototype.waitForPostTurnOutcome.call(rig, { authority: 0, renderer: 0 }), {
    kind: "command",
  });
  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.deepEqual(
    renderer.presses.map(entry => entry.key),
    ["Space"],
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
