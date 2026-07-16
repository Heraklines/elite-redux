/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  allClientsAtOwnedCommandFrontier,
  clientsAwaitingTurnProgress,
  createAnimationProgressBudget,
  createBattlePromptAdvancer,
  driveBattleFallback,
  findRegisteredSurface,
  resolveSurfaceOwner,
  waitForOutcomeBounded,
} from "./campaign.mjs";
import { isActionableSemanticObservation, planNavigationStep } from "./campaign-nav.mjs";
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

test("an explicitly unblocked handler remains actionable when its enclosing phase is not awaiting narration", () => {
  const starter = {
    surfaceId: "starter-select",
    selectedOptionId: "cursor:0",
    ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: false },
  };
  assert.equal(isActionableSemanticObservation(starter, { requireExplicitUnblocked: true }), true);
  assert.deepEqual(planNavigationStep(starter, "cursor:0"), { kind: "submit" });
  assert.equal(
    isActionableSemanticObservation(
      { ...starter, ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: true } },
      { requireExplicitUnblocked: true },
    ),
    false,
  );
});

test("an active always-live command handler is actionable without an optional blocking field", () => {
  const command = {
    surfaceId: "command:command",
    selectedOptionId: "cursor:0",
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
  };
  assert.equal(isActionableSemanticObservation(command, { requireExplicitUnblocked: true }), true);
  assert.deepEqual(planNavigationStep(command, "cursor:0"), { kind: "submit" });

  const staleMessage = {
    ...command,
    surfaceId: "battle:message",
    ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: null },
  };
  assert.equal(isActionableSemanticObservation(staleMessage, { requireExplicitUnblocked: true }), false);
});

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

test("between-wave completion accepts both semantic command frontiers without legacy console lines", () => {
  const clients = [0, 1].map(seat => {
    const evidence = new FakeEvidence([`semantic-only-seat-${seat}`]);
    evidence.events.push({
      index: evidence.events.length,
      kind: "browser-surface2",
      observation: {
        surfaceId: "command:command",
        phase: "CommandPhase",
        uiMode: "COMMAND",
        localSeat: seat,
        seatsWithInput: [seat],
        ready: { handlerActive: true },
      },
    });
    return { label: `seat-${seat}`, publicSeat: seat, evidence };
  });

  assert.equal(
    clients.some(client => client.evidence.find(/CommandPhase .*-> LOCAL UI/u)),
    false,
  );
  assert.equal(allClientsAtOwnedCommandFrontier(clients, { "seat-0": 0, "seat-1": 0 }), true);
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

test("semantic owner remains driveable when its earlier legacy OWNER line is outside the cursor", () => {
  const authority = fakeClient("authority", ["OWNER drives reward screen"]);
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const driver = {
    name: "reward",
    present: /OWNER drives reward screen/u,
    v2SurfaceId: "reward-shop",
    owner: { marker: /OWNER drives reward screen/u },
  };
  const cursors = { authority: authority.evidence.events.length, renderer: 0 };
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "reward-shop",
      localSeat: 0,
      ownerSeat: 0,
      ready: { handlerActive: true, awaitingActionInput: true },
    },
  });

  assert.equal(
    resolveSurfaceOwner(rig, driver, cursors, new Map(), true)?.client,
    authority,
    "the visible semantic reward surface is the authoritative campaign appearance",
  );
});

test("semantic owner is not driven until the visible handler accepts input", () => {
  const authority = fakeClient("authority", ["OWNER drives reward screen"]);
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const driver = {
    name: "reward",
    present: /OWNER drives reward screen/u,
    v2SurfaceId: "reward-shop",
    owner: { marker: /OWNER drives reward screen/u },
  };
  const cursors = { authority: 0, renderer: 0 };
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "reward-shop",
      localSeat: 0,
      ownerSeat: 0,
      ready: { handlerActive: true, awaitingActionInput: false },
    },
  });
  assert.equal(resolveSurfaceOwner(rig, driver, cursors, new Map(), true), null);

  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "reward-shop",
      localSeat: 0,
      ownerSeat: 0,
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: true },
    },
  });
  assert.equal(resolveSurfaceOwner(rig, driver, cursors, new Map(), true), null);

  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "reward-shop",
      localSeat: 0,
      ownerSeat: 0,
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    },
  });
  assert.equal(resolveSurfaceOwner(rig, driver, cursors, new Map(), true)?.client, authority);
  const handled = new Map([["reward:authority", authority.evidence.events.at(-1).index]]);
  assert.equal(
    resolveSurfaceOwner(rig, driver, cursors, handled, true),
    null,
    "an already-driven semantic appearance waits for the phase to advance instead of becoming malformed",
  );
});

test("a registered reward waiting for handler readiness is not classified as an unknown surface", () => {
  const authority = fakeClient("authority", ["OWNER drives reward screen"]);
  const renderer = fakeClient("renderer", ["Start Phase SelectModifierPhase"]);
  const rig = { host: authority, clients: { authority, renderer } };
  const driver = {
    name: "reward",
    present: /OWNER drives reward screen/u,
    v2SurfaceId: "reward-shop",
    owner: { marker: /OWNER drives reward screen/u },
  };
  const cursors = { authority: 0, renderer: 0 };
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "reward-shop",
      localSeat: 0,
      ownerSeat: 0,
      ready: { handlerActive: true, awaitingActionInput: false },
    },
  });

  assert.equal(resolveSurfaceOwner(rig, driver, cursors, new Map(), true), null);
  assert.equal(
    findRegisteredSurface(rig, [driver], cursors),
    driver,
    "the campaign must wait under its bounded readiness deadline instead of spending the UNKNOWN timer",
  );
  const handled = new Map([["reward:authority", authority.evidence.events.at(-1).index]]);
  assert.equal(
    findRegisteredSurface(rig, [driver], cursors, handled),
    null,
    "historical evidence from a completed surface must not hide a later unknown phase",
  );
});

test("registered surfaces deduplicate re-emissions by semantic identity, not evidence index", () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const driver = {
    name: "reward",
    present: /OWNER drives reward screen/u,
    v2SurfaceId: "reward-shop",
    owner: { marker: /OWNER drives reward screen/u },
  };
  const address = { epoch: 7, wave: 1, turn: 4 };
  const pushReward = phaseInstance => {
    authority.evidence.events.push({
      index: authority.evidence.events.length,
      kind: "browser-surface2",
      observation: {
        surfaceId: "reward-shop",
        address,
        phaseInstance,
        localSeat: 0,
        ownerSeat: 0,
        ready: { handlerActive: true, awaitingActionInput: false },
      },
    });
  };
  pushReward(11);
  const handled = new Map([["reward:authority", JSON.stringify(["reward-shop", 7, 1, 4, 11])]]);
  pushReward(11);
  assert.equal(findRegisteredSurface(rig, [driver], { authority: 0, renderer: 0 }, handled), null);

  pushReward(12);
  assert.equal(findRegisteredSurface(rig, [driver], { authority: 0, renderer: 0 }, handled), driver);
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

test("between-wave prompt advancement admits a live NextEncounter narration without an old command address", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const stats = { battleMessagePrompts: 0, postBattleExpPrompts: 0 };
  const from = { authority: 0, renderer: 0 };
  const advance = createBattlePromptAdvancer(rig, from, stats, "wave-2-between-wave", {
    requireSharedCommandAddress: false,
  });
  authority.evidence.pushBattleReadiness("battle:message", "NextEncounterPhase", true, 41, true, {
    epoch: 7,
    wave: 2,
    turn: 1,
  });
  renderer.evidence.pushBattleReadiness("battle:message", "NextEncounterPhase", true, 52, true, {
    epoch: 7,
    wave: 2,
    turn: 1,
  });

  assert.equal(await advance(), true);
  assert.equal(await advance(), true);
  assert.equal(await advance(), false, "each exact phase instance is driven once");
  assert.equal(stats.battleMessagePrompts, 2);
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
    client: authority,
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

test("the outcome wait drains already-buffered completion evidence at its deadline", async () => {
  const authority = fakeClient("authority", ["Start Phase SelectModifierPhase"]);
  const renderer = fakeClient("renderer", ["Start Phase SelectModifierPhase"]);
  const rig = {
    host: authority,
    clients: { authority, renderer },
    config: { faintOwnerSeat: "renderer" },
  };

  assert.deepEqual(await waitForOutcomeBounded(rig, { authority: 0, renderer: 0 }, 0), { kind: "reward" });
});

test("the campaign outcome wait accepts the first owned command frontier without waiting for its peer", async () => {
  const authority = fakeClient("authority", ["CommandPhase regression -> LOCAL UI"]);
  authority.publicSeat = 0;
  const renderer = fakeClient("renderer");
  renderer.publicSeat = 1;
  const rig = {
    host: authority,
    clients: { authority, renderer },
    config: { faintOwnerSeat: "renderer" },
  };

  assert.deepEqual(
    await waitForOutcomeBounded(rig, { authority: 0, renderer: 0 }, 50, {
      stopOnOwnedCommandFrontier: true,
    }),
    { kind: "command", client: authority },
  );
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

test("real phase and stream progress extend the outcome wait but never cross its hard ceiling", () => {
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
  assert.equal(budget.observe(), 1_250, "a new narration phase is causal queue progress");

  authority.evidence.pushPhase("Start Phase MoveEffectPhase", new Date(1_080).toISOString(), 80);
  assert.equal(budget.observe(), 1_280);
  authority.evidence.pushPhase("Start Phase FaintPhase", new Date(1_200).toISOString(), 200);
  assert.equal(budget.observe(), 1_400, "a later faint phase refreshes the stall deadline");
  authority.evidence.pushPhase("Start Phase ExpPhase", new Date(1_240).toISOString(), 240);
  assert.equal(budget.observe(), 1_440, "a later EXP phase refreshes the stall deadline");
  authority.evidence.pushPhase(
    "[coop:turn] host recorder: append turn=1 seq=8 k=hp total=9 live=true",
    new Date(1_250).toISOString(),
    250,
  );
  assert.equal(budget.observe(), 1_450, "new authoritative stream sequence is causal progress");
  nowMs = 1_400;
  renderer.evidence.pushPhase("Start Phase CoopMoveAnimReplayPhase", new Date(1_450).toISOString(), 450);
  assert.equal(budget.observe(), 1_500, "a replay animation refresh is clamped to the immutable hard ceiling");
  authority.evidence.pushPhase("Start Phase MoveAnimPhase", new Date(1_490).toISOString(), 490);
  assert.equal(budget.observe(), 1_500, "later activity cannot push the ceiling forward");

  const records = [...authority.evidence.events, ...renderer.evidence.events].filter(
    event => event.kind === "campaign-animation-budget",
  );
  assert.equal(records.length, 7);
  assert.deepEqual(
    records.map(event => [event.phase, event.extensionApplied, event.hardCeilingReached]),
    [
      ["MessagePhase", true, false],
      ["MoveEffectPhase", true, false],
      ["FaintPhase", true, false],
      ["ExpPhase", true, false],
      ["authority-stream", true, false],
      ["MoveAnimPhase", false, true],
      ["CoopMoveAnimReplayPhase", true, true],
    ],
  );
  assert.ok(records.every(event => event.phaseObservedAt && event.hardDeadlineAt));
});
