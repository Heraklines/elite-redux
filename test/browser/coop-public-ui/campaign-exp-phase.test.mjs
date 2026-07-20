/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  allClientsAtCurrentCommandFrontier,
  allClientsAtOwnedCommandFrontier,
  clientsAwaitingTurnProgress,
  createAnimationProgressBudget,
  createBattlePromptAdvancer,
  driveBattleFallback,
  findRegisteredSurface,
  hasPassiveBattleProgressSurface,
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

  findLast(pattern, from = 0) {
    return this.events
      .slice(from)
      .toReversed()
      .find(event => pattern.test(event.text ?? ""));
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
        operationClass: "command",
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
  assert.equal(allClientsAtCurrentCommandFrontier(clients, { "seat-0": 0, "seat-1": 0 }), true);
});

test("a one-sided next-wave command does not preempt its partner's current learn-move continuation", () => {
  const host = fakeClient("host");
  host.publicSeat = 0;
  const guest = fakeClient("guest");
  guest.publicSeat = 1;
  const command = (localSeat, phaseInstance) => ({
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:command",
      operationClass: "command",
      phase: "CommandPhase",
      phaseInstance,
      uiMode: "COMMAND",
      localSeat,
      seatsWithInput: [localSeat],
      ready: { handlerActive: true },
    },
  });
  guest.evidence.events.push(command(1, 31));
  host.evidence.events.push({
    index: host.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "battle:message",
      operationClass: "battle-progress",
      phase: "LearnMovePhase",
      phaseInstance: 40,
      uiMode: "MESSAGE",
      localSeat: 0,
      seatsWithInput: [0],
      ready: { handlerActive: true, awaitingActionInput: true },
    },
  });
  const clients = [host, guest];
  const cursors = { host: 0, guest: 0 };

  assert.equal(
    allClientsAtCurrentCommandFrontier(clients, cursors),
    false,
    "the campaign must keep dispatching the host's visible continuation instead of blocking on command convergence",
  );

  host.evidence.events.push({
    ...command(0, 41),
    index: host.evidence.events.length,
  });
  assert.equal(
    allClientsAtCurrentCommandFrontier(clients, cursors),
    true,
    "only the host's later current command projection admits the shared frontier proof",
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
  assert.equal(
    resolveSurfaceOwner(rig, driver, cursors, new Map(), true),
    null,
    "a watcher may publish the addressed surface before the reciprocal owner projection",
  );
  renderer.evidence.events.push({
    index: renderer.evidence.events.length,
    kind: "browser-surface2",
    observation: { surfaceId: "egg:lapse", localSeat: 1, ownerSeat: 0 },
  });
  assert.throws(
    () => resolveSurfaceOwner(rig, driver, cursors, new Map(), true),
    /never reported an owner/u,
    "once both semantic mirrors exist, malformed owner evidence still fails loudly",
  );
});

test("a delayed reciprocal semantic owner supersedes the provisional watcher surface", () => {
  const watcher = fakeClient("watcher");
  const owner = fakeClient("owner");
  const rig = { host: watcher, clients: { watcher, owner } };
  const driver = {
    name: "mystery-encounter",
    present: /Start Phase MysteryEncounterPhase/u,
    v2SurfaceId: "mystery-encounter",
    owner: { role: "host" },
  };
  const cursors = { watcher: 0, owner: 0 };
  watcher.evidence.events.push({
    index: watcher.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "mystery-encounter",
      localSeat: 0,
      ownerSeat: 1,
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    },
  });
  assert.equal(resolveSurfaceOwner(rig, driver, cursors, new Map(), true), null);

  owner.evidence.events.push({
    index: owner.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "mystery-encounter",
      localSeat: 1,
      ownerSeat: 1,
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    },
  });
  assert.equal(resolveSurfaceOwner(rig, driver, cursors, new Map(), true)?.client, owner);
});

test("a stale prior-wave owner mirror cannot make a new one-sided reward projection look malformed", () => {
  const watcher = fakeClient("watcher");
  const owner = fakeClient("owner");
  const rig = { host: watcher, clients: { watcher, owner } };
  const driver = {
    name: "reward",
    present: /OWNER drives reward screen/u,
    v2SurfaceId: "reward-shop",
    owner: { marker: /OWNER drives reward screen/u },
  };
  const cursors = { watcher: 0, owner: 0 };
  owner.evidence.events.push({
    index: owner.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "reward-shop",
      address: { epoch: 9, wave: 1, turn: 2 },
      localSeat: 1,
      ownerSeat: 0,
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    },
  });
  watcher.evidence.events.push({
    index: watcher.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "reward-shop",
      address: { epoch: 9, wave: 2, turn: 1 },
      localSeat: 0,
      ownerSeat: 1,
      ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: false },
    },
  });

  assert.equal(
    resolveSurfaceOwner(rig, driver, cursors, new Map(), true),
    null,
    "different wave addresses are a provisional cross-wave race, not two malformed mirrors of one appearance",
  );

  owner.evidence.events.push({
    index: owner.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "reward-shop",
      address: { epoch: 9, wave: 2, turn: 1 },
      localSeat: 1,
      ownerSeat: 1,
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    },
  });
  assert.equal(resolveSurfaceOwner(rig, driver, cursors, new Map(), true)?.client, owner);
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

test("a legacy phase marker stops registering a semantic surface after a later phase supersedes it", () => {
  const authority = fakeClient("authority", [
    "Start Phase EggLapsePhase",
    "Start Phase SelectModifierPhase",
    "Start Phase NextEncounterPhase",
  ]);
  const renderer = fakeClient("renderer", [
    "Start Phase EggLapsePhase",
    "Start Phase SelectModifierPhase",
    "Start Phase CommandPhase",
  ]);
  const rig = { host: authority, clients: { authority, renderer } };
  const driver = {
    name: "egg",
    phase: /Start Phase EggLapsePhase/u,
    present: /Start Phase EggLapsePhase/u,
    v2SurfaceId: "egg:lapse",
    owner: { role: "host" },
  };

  assert.equal(
    findRegisteredSurface(rig, [driver], { authority: 0, renderer: 0 }),
    null,
    "a no-op egg phase must not mask the real later frontier for the rest of the deadline",
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
  const pushReward = (phaseInstance, surfaceGeneration = null) => {
    authority.evidence.events.push({
      index: authority.evidence.events.length,
      kind: "browser-surface2",
      observation: {
        surfaceId: "reward-shop",
        address,
        phaseInstance,
        surfaceGeneration,
        localSeat: 0,
        ownerSeat: 0,
        ready: { handlerActive: true, awaitingActionInput: false },
      },
    });
  };
  pushReward(11);
  const handled = new Map([["reward:authority", JSON.stringify(["reward-shop", 7, 1, 4, 11, null])]]);
  pushReward(11);
  assert.equal(findRegisteredSurface(rig, [driver], { authority: 0, renderer: 0 }, handled), null);

  pushReward(12);
  assert.equal(findRegisteredSurface(rig, [driver], { authority: 0, renderer: 0 }, handled), driver);

  const generationHandled = new Map([["reward:authority", JSON.stringify(["reward-shop", 7, 1, 4, 12, 1])]]);
  pushReward(12, 1);
  assert.equal(findRegisteredSurface(rig, [driver], { authority: 0, renderer: 0 }, generationHandled), null);
  pushReward(12, 2);
  assert.equal(
    findRegisteredSurface(rig, [driver], { authority: 0, renderer: 0 }, generationHandled),
    driver,
    "a new UI generation inside one phase object is a new actionable appearance",
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
  renderer.evidence.pushConsole("Start Phase BattleEndPhase");
  renderer.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 4, true, {
    epoch: 7,
    wave: 1,
    turn: 2,
  });
  assert.equal(
    await advance(),
    true,
    "the exact next-turn money prompt is drivable only after this browser observes BattleEndPhase",
  );
  authority.evidence.pushBattleReadiness("battle:exp", "ExpPhase", true, 2);
  assert.equal(await advance(), true);
  assert.equal(await advance(), false);

  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space", "Space"],
  );
  assert.deepEqual(
    renderer.presses.map(entry => entry.key),
    ["Space", "Space"],
  );
  assert.equal(stats.battleMessagePrompts, 3);
  assert.equal(stats.postBattleExpPrompts, 1);
  const advances = [...authority.evidence.events, ...renderer.evidence.events].filter(
    event => event.kind === "campaign-battle-prompt-advance",
  );
  assert.equal(advances.length, 4);
  assert.deepEqual(
    advances.map(event => [event.inputSeat, event.surfaceId, event.phaseInstance]),
    [
      ["authority", "battle:message", 1],
      ["authority", "battle:exp", 2],
      ["renderer", "battle:message", 1],
      ["renderer", "battle:message", 4],
    ],
  );
});

test("battle prompt consumption survives helper recreation and stale ready surfaces never spend input", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const from = { authority: 0, renderer: 0 };
  const stats = { battleMessagePrompts: 0, postBattleExpPrompts: 0 };
  authority.evidence.pushCommandSurface();
  renderer.evidence.pushCommandSurface();
  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 31);

  const first = createBattlePromptAdvancer(rig, from, stats, "first-driver");
  assert.equal(await first(), true, "the visibly current prompt is driven once");
  assert.equal(authority.presses.length, 1);

  const recreated = createBattlePromptAdvancer(rig, from, stats, "recreated-driver");
  assert.equal(await recreated(), false, "a recreated helper must retain the session's consumed prompt ledger");
  assert.equal(authority.presses.length, 1, "the old prompt receives no second Space");

  // Append a non-ready semantic surface that supersedes an otherwise-ready historical prompt.
  // A fresh driver scans from the old cursor but must respect what the browser currently displays.
  authority.evidence.pushBattleReadiness("battle:message", "FaintPhase", false, 32);
  const afterSupersession = createBattlePromptAdvancer(rig, from, stats, "stale-driver");
  assert.equal(await afterSupersession(), false, "a superseded ready event is evidence, not current input authority");
  assert.equal(authority.presses.length, 1);

  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 33);
  assert.equal(await afterSupersession(), true, "a later visibly-current prompt generation remains drivable");
  assert.equal(authority.presses.length, 2);
});

test("an explicitly frozen battle prompt never spends public input", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const from = { authority: 0, renderer: 0 };
  const stats = { battleMessagePrompts: 0, postBattleExpPrompts: 0 };
  authority.evidence.pushCommandSurface();
  renderer.evidence.pushCommandSurface();
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "battle:message",
      coop: true,
      phase: "NextEncounterPhase",
      phaseInstance: 41,
      uiMode: "MESSAGE",
      ownerModel: "local",
      localSeat: 0,
      seatsWithInput: [0],
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: true },
      address: { epoch: 7, wave: 2, turn: 1 },
    },
  });

  const advance = createBattlePromptAdvancer(rig, from, stats, "next-wave-intro", {
    requireSharedCommandAddress: false,
  });
  assert.equal(await advance(), false);
  assert.equal(authority.presses.length, 0);
});

test("a non-actionable NextEncounter tween is known passive progress, but an armed prompt is not", () => {
  const authority = fakeClient("authority", ["Start Phase NextEncounterPhase"]);
  const renderer = fakeClient("renderer");
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "battle:message",
      operationClass: "battle-progress",
      phase: "NextEncounterPhase",
      ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: true },
    },
  });

  assert.equal(hasPassiveBattleProgressSurface([authority, renderer], { authority: 0, renderer: 0 }), true);

  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "battle:message",
      operationClass: "battle-progress",
      phase: "NextEncounterPhase",
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: true },
    },
  });
  assert.equal(
    hasPassiveBattleProgressSurface([authority, renderer], { authority: 0, renderer: 0 }),
    false,
    "an armed-but-frozen prompt is a real product failure, not passive animation",
  );
});

// Track R cycle 4 - the wave-3-turn-2 LevelUpPhase co-op deadlock (campaign run 29644735938,
// 3-wave animations-on-surface). The host wins wave 3, and the FIRST level-up of the run opens
// LevelUpPhase, which shows a level-up MESSAGE and then promptLevelUpStats - a TWO-step human-action
// panel (stat increments, then totals) that re-arms `awaitingActionInput` in place. The advancer
// authorizes exactly one Space per (surfaceId, phaseInstance) - "the semantic surface's prompt
// generation is the actionable identity". Pre-fix, promptLevelUpStats did NOT bump the message
// handler's prompt generation for its two sub-prompts, so the delta and totals sub-prompts collided
// onto ONE phaseInstance with the level-up message: the advancer pressed once and treated the rest as
// already consumed, so promptLevelUpStats never resolved, LevelUpPhase.end() never ran, and the host
// never reached CoopTurnCommitPhase (the guest looped requestTurnCommit -> host turnCommitPending
// forever). The product fix (MessageUiHandler.bumpPromptGeneration, called from
// BattleMessageUiHandler.promptLevelUpStats) gives each stat sub-prompt a DISTINCT generation, so the
// advancer drives all three. This engine-free contract pins that boundary from both sides.
test("a level-up stat panel's two sub-prompts each advance only when they carry distinct prompt generations", async () => {
  // POST-FIX: message (gen 10) -> delta stats (gen 11) -> totals stats (gen 12). Each distinct
  // generation is a separate advanceable stage, so the advancer drives all three.
  {
    const authority = fakeClient("authority");
    const renderer = fakeClient("renderer");
    const rig = { host: authority, clients: { authority, renderer } };
    const stats = { battleMessagePrompts: 0, postBattleExpPrompts: 0 };
    authority.evidence.pushCommandSurface();
    renderer.evidence.pushCommandSurface();
    const advance = createBattlePromptAdvancer(rig, { authority: 0, renderer: 0 }, stats, "wave-3-turn-2");
    authority.evidence.pushBattleReadiness("battle:message", "LevelUpPhase", true, 10);
    assert.equal(await advance(), true, "the level-up message advances");
    authority.evidence.pushBattleReadiness("battle:message", "LevelUpPhase", true, 11);
    assert.equal(await advance(), true, "the stat-increments sub-prompt is a distinct advanceable stage");
    authority.evidence.pushBattleReadiness("battle:message", "LevelUpPhase", true, 12);
    assert.equal(await advance(), true, "the stat-totals sub-prompt is a distinct advanceable stage");
    assert.equal(await advance(), false);
    assert.equal(stats.battleMessagePrompts, 3, "all three level-up prompts advance once each");
  }

  // PRE-FIX REPRODUCTION: without the generation bump, the delta and totals sub-prompts re-arm on the
  // SAME phaseInstance as the message. The advancer consumes that instance once and skips the rest -
  // promptLevelUpStats never resolves and the host parks in LevelUpPhase (the live deadlock).
  {
    const authority = fakeClient("authority");
    const renderer = fakeClient("renderer");
    const rig = { host: authority, clients: { authority, renderer } };
    const stats = { battleMessagePrompts: 0, postBattleExpPrompts: 0 };
    authority.evidence.pushCommandSurface();
    renderer.evidence.pushCommandSurface();
    const advance = createBattlePromptAdvancer(rig, { authority: 0, renderer: 0 }, stats, "wave-3-turn-2-park");
    authority.evidence.pushBattleReadiness("battle:message", "LevelUpPhase", true, 10);
    assert.equal(await advance(), true, "the level-up message advances");
    authority.evidence.pushBattleReadiness("battle:message", "LevelUpPhase", true, 10);
    assert.equal(await advance(), false, "a colliding-generation stat sub-prompt is NOT re-driven (the park)");
    authority.evidence.pushBattleReadiness("battle:message", "LevelUpPhase", true, 10);
    assert.equal(await advance(), false, "the totals sub-prompt also collides and is never advanced");
    assert.equal(stats.battleMessagePrompts, 1, "only the message advanced - the stat panel deadlocks");
  }
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

test("the short post-turn wait keeps both browsers alive until GameOver is paired", async () => {
  const authority = fakeClient("authority", ["Start Phase GameOverPhase"]);
  const renderer = fakeClient("renderer", ["Start Phase GameOverPhase"]);
  const rig = {
    clients: { authority, renderer },
    config: { faintOwnerSeat: "renderer", timeoutMs: 1_000 },
  };

  assert.deepEqual(await DuoPublicUiRig.prototype.waitForPostTurnOutcome.call(rig, { authority: 0, renderer: 0 }), {
    kind: "gameOver",
  });
  assert.equal(authority.evidence.events.at(-1).kind, "paired-game-over-proof");
  assert.equal(renderer.evidence.events.at(-1).kind, "paired-game-over-proof");
});

test("browser cleanup evidence is aggregated with the primary journey failure", () => {
  const rig = Object.assign(Object.create(DuoPublicUiRig.prototype), {
    clients: {
      authority: {
        evidence: {
          assertClean: () => {
            throw new Error("authority fatal");
          },
        },
      },
      renderer: {
        evidence: {
          assertClean: () => {
            throw new Error("renderer fatal");
          },
        },
      },
    },
  });

  const failure = rig.aggregateFailureWithBrowserEvidence(new Error("journey timeout"));
  assert.equal(failure.name, "AggregateError");
  assert.match(failure.message, /journey timeout/u);
  assert.match(failure.message, /authority fatal/u);
  assert.match(failure.message, /renderer fatal/u);
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

test("a newer semantic surface supersedes a transient command frontier and its legacy console line", async () => {
  const authority = fakeClient("authority", ["CommandPhase regression -> LOCAL UI"]);
  authority.publicSeat = 0;
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:command",
      phase: "CommandPhase",
      phaseInstance: 17,
      uiMode: "COMMAND",
      localSeat: 0,
      seatsWithInput: [0],
      ready: { handlerActive: true },
      address: { epoch: 7, wave: 1, turn: 4 },
    },
  });
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "battle:message",
      phase: "NextEncounterPhase",
      phaseInstance: 18,
      uiMode: "MESSAGE",
      localSeat: 0,
      seatsWithInput: [0],
      ready: { handlerActive: true, awaitingActionInput: true },
      address: { epoch: 7, wave: 2, turn: 1 },
    },
  });
  const renderer = fakeClient("renderer");
  renderer.publicSeat = 1;
  const rig = {
    host: authority,
    clients: { authority, renderer },
    config: { faintOwnerSeat: "renderer" },
  };

  assert.equal(
    await waitForOutcomeBounded(rig, { authority: 0, renderer: 0 }, 0, {
      stopOnOwnedCommandFrontier: true,
      singleSidedConfirmMs: 1,
    }),
    null,
    "a historical command must not become actionable after the visible UI advanced",
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
