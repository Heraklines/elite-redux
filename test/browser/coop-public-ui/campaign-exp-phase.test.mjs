/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  allClientsAtCurrentCommandFrontier,
  allClientsAtOwnedCommandFrontier,
  assertAsymmetricLearnMoveProjection,
  assertRetainedEvolutionPresentationParity,
  chooseUntriedRewardOption,
  classifyLearnMovePickerProgress,
  clientsAwaitingTurnProgress,
  createAnimationProgressBudget,
  createBattlePromptAdvancer,
  currentPairedBattleKind,
  driveBattleFallback,
  driveLearnMoveDecline,
  findRegisteredSurface,
  findSharedSuccessorWavePresentation,
  hasPassiveBattleProgressSurface,
  hasProvisionalCommandWatcherSurface,
  hasProvisionalMysteryNarrationSurface,
  isExplicitEmptyRewardShop,
  resetRewardRetrySurfaceLedger,
  resolveSurfaceOwner,
  waitForOutcomeBounded,
} from "./campaign.mjs";
import { isActionableSemanticObservation, planNavigationStep } from "./campaign-nav.mjs";
import { DuoPublicUiRig, PublicUiClient } from "./public-ui-harness.mjs";

const root = resolve(import.meta.dirname, "../../..");

test("learn-move accept pumps the finite native narration before requiring the Summary picker", () => {
  const address = { epoch: 19, wave: 1, turn: 2 };
  const base = {
    address,
    localSeat: 0,
    ownerSeat: null,
    seatsWithInput: [0],
    ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: null },
  };
  assert.equal(
    classifyLearnMovePickerProgress(
      { ...base, surfaceId: "battle:message", phase: "LearnMovePhase", uiMode: "MESSAGE" },
      address,
      0,
    ),
    "advance",
  );
  assert.equal(
    classifyLearnMovePickerProgress(
      {
        ...base,
        surfaceId: "learn-move:confirm",
        phase: "LearnMovePhase",
        uiMode: "SUMMARY",
        ownerSeat: 0,
      },
      address,
      0,
    ),
    "ready",
  );
  assert.equal(
    classifyLearnMovePickerProgress(
      {
        ...base,
        surfaceId: "battle:message",
        phase: "LearnMovePhase",
        uiMode: "MESSAGE",
        address: { ...address, turn: 3 },
      },
      address,
      0,
    ),
    "wait",
  );
});

class FakeEvidence {
  constructor(entries = []) {
    this.events = entries.map((entry, index) =>
      typeof entry === "string" ? { index, text: entry } : { index, ...entry },
    );
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

  pushOwnedCommandSurface(localSeat, address = { epoch: 7, wave: 1, turn: 1 }) {
    this.events.push({
      index: this.events.length,
      kind: "browser-surface2",
      observation: {
        surfaceId: "command:command",
        operationClass: "command",
        coop: true,
        phase: "CommandPhase",
        phaseInstance: 2,
        uiMode: "COMMAND",
        ownerModel: "seat",
        localSeat,
        seatsWithInput: [localSeat],
        ready: { handlerActive: true, inputBlocked: false },
        address,
      },
    });
  }

  pushBattleReadiness(
    surfaceId,
    phase,
    awaitingActionInput,
    phaseInstance,
    handlerActive = true,
    address = { epoch: 7, wave: 1, turn: 1 },
    uiMode = "MESSAGE",
  ) {
    this.events.push({
      index: this.events.length,
      kind: "browser-surface2",
      observation: {
        surfaceId,
        coop: true,
        phase,
        phaseInstance,
        uiMode,
        operationClass: "battle-progress",
        ownerModel: "local",
        localSeat: 0,
        seatsWithInput: [0],
        ready: { awaitingActionInput, handlerActive },
        address,
      },
    });
  }
}

function evolutionRig(hostLines, guestLines) {
  const host = { evidence: new FakeEvidence(hostLines) };
  const guest = { evidence: new FakeEvidence(guestLines) };
  return { host, guest, clients: { host, guest } };
}

test("retained evolution proof requires exact authority/renderer identity and depth coverage", () => {
  const lifecycle = (stage, role, toSpeciesId = 2) => ({
    kind: "browser-progression-event",
    observation: {
      stage,
      role,
      wave: 17,
      event: { k: "evolution", partySlot: 0, fromSpeciesId: 1, toSpeciesId },
    },
  });
  const authority = lifecycle("authority-recorded", "host");
  const renderer = lifecycle("renderer-completed", "guest");
  // Deliberately reverse the harness labels: the lifecycle role, not the account label, owns the proof.
  assert.deepEqual(
    assertRetainedEvolutionPresentationParity(evolutionRig([renderer], [authority]), { targetWaves: 30 }),
    {
      authority: ["17:0:1->2"],
      renderer: ["17:0:1->2"],
      required: true,
    },
  );
  assert.throws(
    () => assertRetainedEvolutionPresentationParity(evolutionRig([], [authority]), { targetWaves: 30 }),
    /presentation mismatch/u,
  );
  assert.throws(
    () =>
      assertRetainedEvolutionPresentationParity(
        evolutionRig([lifecycle("renderer-completed", "guest", 3)], [authority]),
        { targetWaves: 30 },
      ),
    /presentation mismatch/u,
  );
  assert.throws(
    () => assertRetainedEvolutionPresentationParity(evolutionRig([], []), { targetWaves: 30 }),
    /without exercising retained evolution/u,
  );
  assert.doesNotThrow(() => assertRetainedEvolutionPresentationParity(evolutionRig([], []), { targetWaves: 10 }));
});

test("battle-kind classification accepts a V2-only passive command watcher", () => {
  const owner = new FakeEvidence();
  owner.events.push({
    index: 0,
    kind: "browser-surface",
    observation: {
      surface: "command",
      wave: 5,
      battleType: "TRAINER",
      trainerBoss: false,
      bossEnemyCount: 0,
      maxBossSegments: 0,
    },
  });
  const watcher = new FakeEvidence();
  watcher.events.push(
    {
      index: 0,
      kind: "browser-surface",
      observation: {
        surface: "command",
        wave: 4,
        battleType: "WILD",
        trainerBoss: false,
        bossEnemyCount: 0,
        maxBossSegments: 0,
      },
    },
    {
      index: 1,
      kind: "browser-surface2",
      observation: {
        surfaceId: "command:watcher",
        operationClass: "command",
        address: { epoch: 7, wave: 5, turn: 1 },
      },
    },
  );

  assert.deepEqual(
    currentPairedBattleKind({ clients: { owner: { evidence: owner }, watcher: { evidence: watcher } } }, 5),
    { wave: 5, battleType: "TRAINER", trainerBoss: false, bossEnemyCount: 0, maxBossSegments: 0 },
  );
});

test("battle-kind classification still rejects current owner observations that disagree", () => {
  const evidence = battleType => {
    const sink = new FakeEvidence();
    sink.events.push({
      index: 0,
      kind: "browser-surface",
      observation: {
        surface: "command",
        wave: 5,
        battleType,
        trainerBoss: false,
        bossEnemyCount: 0,
        maxBossSegments: 0,
      },
    });
    return sink;
  };
  assert.throws(
    () =>
      currentPairedBattleKind(
        { clients: { first: { evidence: evidence("WILD") }, second: { evidence: evidence("TRAINER") } } },
        5,
      ),
    /battle kind diverged at wave 5/u,
  );
});

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

test("between-wave completion accepts a skip-to-fight Mystery owner and its exact watcher", () => {
  const address = { epoch: 73, wave: 2, turn: 1 };
  const digest = "fun-and-games-command";
  const owner = fakeClient("owner");
  owner.publicSeat = 0;
  owner.evidence.events.push({
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:fight",
      operationClass: "command",
      phase: "CommandPhase",
      uiMode: "FIGHT",
      address,
      stateDigest: digest,
      localSeat: 0,
      seatsWithInput: [0],
      ready: { handlerActive: true },
    },
  });
  const watcher = fakeClient("watcher");
  watcher.publicSeat = 1;
  watcher.evidence.events.push({
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:watcher",
      operationClass: "command",
      phase: "CoopReplayTurnPhase",
      uiMode: "MESSAGE",
      address,
      stateDigest: digest,
      localSeat: 1,
      seatsWithInput: [],
      ready: { handlerActive: false, awaitingActionInput: false, inputBlocked: true },
    },
  });

  const clients = [owner, watcher];
  const cursors = { owner: 0, watcher: 0 };
  assert.equal(allClientsAtOwnedCommandFrontier([owner], { owner: 0 }), true);
  assert.equal(allClientsAtCurrentCommandFrontier(clients, cursors), true);
});

test("between-wave completion accepts an exact partner-command wait after one half is wiped", () => {
  const waiting = fakeClient("waiting");
  waiting.publicSeat = 0;
  waiting.evidence.events.push({
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:watcher",
      operationClass: "command",
      phase: "CommandPhase",
      uiMode: "MESSAGE",
      localSeat: 0,
      ownerSeat: 1,
      seatsWithInput: [1],
      ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: null },
    },
  });
  const owner = fakeClient("owner");
  owner.publicSeat = 1;
  owner.evidence.events.push({
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:command",
      operationClass: "command",
      phase: "CommandPhase",
      uiMode: "COMMAND",
      localSeat: 1,
      seatsWithInput: [1],
      ready: { handlerActive: true },
    },
  });

  assert.equal(allClientsAtCurrentCommandFrontier([waiting, owner], { waiting: 0, owner: 0 }), true);
});

test("a partner-command watcher remains remote-owned when the generic message handler awaits input", () => {
  const waiting = fakeClient("waiting");
  waiting.publicSeat = 0;
  waiting.evidence.events.push({
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:watcher",
      operationClass: "command",
      phase: "CommandPhase",
      uiMode: "MESSAGE",
      localSeat: 0,
      ownerSeat: 1,
      seatsWithInput: [1],
      // The UI handler can report an armed MESSAGE callback even though the typed seat list proves that
      // only the partner may act. Run 30687253590 reached this exact healthy wave-5 frontier.
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: null },
    },
  });
  const owner = fakeClient("owner");
  owner.publicSeat = 1;
  owner.evidence.events.push({
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:command",
      operationClass: "command",
      phase: "CommandPhase",
      uiMode: "COMMAND",
      localSeat: 1,
      seatsWithInput: [1],
      ready: { handlerActive: true },
    },
  });

  const clients = [waiting, owner];
  const cursors = { waiting: 0, owner: 0 };
  assert.equal(hasProvisionalCommandWatcherSurface(clients, cursors), true);
  assert.equal(allClientsAtCurrentCommandFrontier(clients, cursors), true);
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

test("a projected learn-move decline accepts its committed successor without inventing a second confirmation", async () => {
  const owner = fakeClient("owner");
  const address = { epoch: 7, wave: 1, turn: 2 };
  const ownerEvent = {
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "learn-move:confirm",
      operationClass: "learn-move",
      ownerModel: "interaction",
      coop: true,
      address,
      localSeat: 1,
      ownerSeat: 1,
      seatsWithInput: [1],
      phase: "CoopReplayLearnMovePhase",
      phaseInstance: 24,
      surfaceGeneration: null,
      uiMode: "SUMMARY",
      ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
    },
  };
  owner.evidence.events.push(ownerEvent);
  owner.press = async (key, purpose) => {
    owner.presses.push({ key, purpose });
    if (key === "Backspace") {
      owner.evidence.events.push({
        index: owner.evidence.events.length,
        kind: "browser-surface2",
        observation: {
          surfaceId: "battle:message",
          operationClass: "battle-progress",
          ownerModel: "local",
          coop: true,
          address: { epoch: 7, wave: 2, turn: 1 },
          localSeat: 1,
          seatsWithInput: [1],
          phase: "NewBattlePhase",
          phaseInstance: 25,
          uiMode: "MESSAGE",
          ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: true },
        },
      });
    }
  };

  await driveLearnMoveDecline({ config: { timeoutMs: 50 } }, owner, {
    authority: ownerEvent.observation,
    ownerEvent,
  });

  assert.deepEqual(owner.presses, [{ key: "Backspace", purpose: "campaign-learn-move-decline-replacement" }]);
});

test("an ordinary learn-move decline confirms a fresh stop-teaching prompt exactly once", async () => {
  const owner = fakeClient("owner");
  const address = { epoch: 7, wave: 1, turn: 2 };
  const ownerEvent = {
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "learn-move:confirm",
      operationClass: "learn-move",
      ownerModel: "interaction",
      coop: true,
      address,
      localSeat: 0,
      ownerSeat: 0,
      seatsWithInput: [0],
      phase: "LearnMovePhase",
      phaseInstance: 30,
      surfaceGeneration: 1,
      uiMode: "SUMMARY",
      ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
    },
  };
  owner.evidence.events.push(ownerEvent);
  owner.press = async (key, purpose) => {
    owner.presses.push({ key, purpose });
    if (key === "Backspace") {
      owner.evidence.events.push({
        index: owner.evidence.events.length,
        kind: "browser-surface2",
        observation: {
          ...ownerEvent.observation,
          phaseInstance: 31,
          surfaceGeneration: 2,
          uiMode: "CONFIRM",
          selectedOptionId: "confirm:no",
          optionIds: ["confirm:yes", "confirm:no"],
          ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
        },
      });
    }
  };

  await driveLearnMoveDecline({ config: { timeoutMs: 50 } }, owner, {
    authority: ownerEvent.observation,
    ownerEvent,
  });

  assert.deepEqual(owner.presses, [
    { key: "Backspace", purpose: "campaign-learn-move-decline-replacement" },
    { key: "Space", purpose: "campaign-learn-move-stop:1" },
  ]);
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

test("a semantic-only reward target stops registering after a newer public surface supersedes it", () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const driver = {
    name: "reward-target",
    v2SurfaceId: "party:reward-target",
    semanticOnly: true,
    owner: { role: "host" },
  };
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: { surfaceId: "party:reward-target" },
  });
  assert.equal(findRegisteredSurface(rig, [driver], { authority: 0, renderer: 0 }), driver);

  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: { surfaceId: "battle:message", phase: "LearnMovePhase" },
  });
  assert.equal(
    findRegisteredSurface(rig, [driver], { authority: 0, renderer: 0 }),
    null,
    "historical target evidence must not mislabel a later learn-move/product stall",
  );
});

test("a stale semantic-only owner on one seat cannot hide the partner's current owner surface", () => {
  const host = fakeClient("host");
  host.publicSeat = 0;
  const guest = fakeClient("guest");
  guest.publicSeat = 1;
  const rig = { host, guest, clients: { host, guest } };
  const driver = {
    name: "reward-target",
    v2SurfaceId: "party:reward-target",
    semanticOnly: true,
    owner: { role: "host" },
  };
  host.evidence.events.push({
    index: host.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "party:reward-target",
      address: { epoch: 9, wave: 1, turn: 2 },
      localSeat: 0,
      ownerSeat: 0,
      ready: { handlerActive: true },
    },
  });
  host.evidence.events.push({
    index: host.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "reward-shop",
      address: { epoch: 9, wave: 6, turn: 1 },
      localSeat: 0,
      ownerSeat: 1,
      ready: { handlerActive: true, inputBlocked: true },
    },
  });
  guest.evidence.events.push({
    index: guest.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "party:reward-target",
      address: { epoch: 9, wave: 6, turn: 1 },
      localSeat: 1,
      ownerSeat: 1,
      ready: { handlerActive: true },
    },
  });

  assert.equal(
    resolveSurfaceOwner(rig, driver, { host: 0, guest: 0 }, new Map(), true)?.client,
    guest,
    "the resolver must skip a superseded local owner and continue to the partner's live owner",
  );
});

test("direct dispatch cannot re-drive a superseded semantic-only Revival owner", () => {
  const authority = fakeClient("authority");
  authority.publicSeat = 1;
  const renderer = fakeClient("renderer");
  renderer.publicSeat = 0;
  const rig = { host: authority, clients: { authority, renderer } };
  const driver = {
    name: "revival",
    v2SurfaceId: "revival:party",
    semanticOnly: true,
    owner: { role: "host" },
  };
  const cursors = { authority: 0, renderer: 0 };
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "revival:party",
      localSeat: 1,
      ownerSeat: 1,
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    },
  });
  assert.equal(resolveSurfaceOwner(rig, driver, cursors, new Map(), true)?.client, authority);

  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "reward-shop",
      localSeat: 1,
      ownerSeat: 1,
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    },
  });
  assert.equal(
    resolveSurfaceOwner(rig, driver, cursors, new Map(), true),
    null,
    "a wave-wide cursor cannot resurrect the completed Revival while the reward shop is current",
  );
});

test("a blocked current Mystery narration handoff is known provisional work only until actionable", () => {
  const owner = fakeClient("owner");
  const cursors = { owner: 0 };
  const observation = {
    surfaceId: "mystery-encounter:message",
    operationClass: "encounter-prompt",
    ownerModel: "interaction",
    coop: true,
    phase: "CoopReplayMePhase",
    uiMode: "MESSAGE",
    ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: true },
  };
  owner.evidence.events.push({ index: 0, kind: "browser-surface2", observation });
  assert.equal(hasProvisionalMysteryNarrationSurface([owner], cursors), true);

  owner.evidence.events.push({
    index: 1,
    kind: "browser-surface2",
    observation: {
      ...observation,
      phaseInstance: 2,
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    },
  });
  assert.equal(
    hasProvisionalMysteryNarrationSurface([owner], cursors),
    false,
    "the narration advancer, not the provisional exemption, owns a ready human prompt",
  );

  owner.evidence.events.push({
    index: 2,
    kind: "browser-surface2",
    observation: { surfaceId: "unknown:future-screen" },
  });
  assert.equal(hasProvisionalMysteryNarrationSurface([owner], cursors), false);
});

test("reward selection prioritizes visible sustain and never resubmits a declined option", () => {
  const authority = {
    selectedOptionId: "POKEBALL",
    optionIds: ["POKEBALL", "ER_UPGRADED_MAP", "BERRY", "RARE_CANDY", "SUPER_POTION", "REVIVE"],
  };
  assert.equal(chooseUntriedRewardOption(authority, new Set()), "REVIVE");
  assert.equal(chooseUntriedRewardOption(authority, new Set(["REVIVE"])), "SUPER_POTION");
  assert.equal(chooseUntriedRewardOption(authority, new Set(["REVIVE", "SUPER_POTION"])), "RARE_CANDY");
  assert.equal(chooseUntriedRewardOption(authority, new Set(["REVIVE", "SUPER_POTION", "RARE_CANDY"])), "BERRY");
  assert.equal(chooseUntriedRewardOption(authority, new Set(authority.optionIds)), null);
});

test("reward selection preserves stable visible order inside one utility tier", () => {
  assert.equal(
    chooseUntriedRewardOption(
      { selectedOptionId: "POKEBALL", optionIds: ["POKEBALL", "SITRUS_BERRY", "LUM_BERRY"] },
      new Set(),
    ),
    "SITRUS_BERRY",
  );
});

test("an explicit empty reward pool is a real Continue surface, not an exhausted or missing projection", () => {
  assert.equal(isExplicitEmptyRewardShop({ selectedOptionId: "cursor:0", optionIds: [], optionCount: 0 }), true);
  assert.equal(isExplicitEmptyRewardShop({ selectedOptionId: "cursor:0", optionIds: null, optionCount: null }), false);
  assert.equal(isExplicitEmptyRewardShop({ selectedOptionId: "REVIVE", optionIds: ["REVIVE"], optionCount: 1 }), false);
});

test("an exhausted party reward releases both nested appearances before selecting a second item", () => {
  const clients = [{ label: "authority" }, { label: "renderer" }];
  const handled = new Map([
    ["reward:authority", "reward-one"],
    ["reward:renderer", "reward-one-watcher"],
    ["reward-target:authority", "party-one"],
    ["reward-target:renderer", "party-one-watcher"],
    ["mystery-encounter:authority", "unrelated-surface"],
  ]);

  resetRewardRetrySurfaceLedger(handled, clients);

  assert.deepEqual([...handled], [["mystery-encounter:authority", "unrelated-surface"]]);
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

test("a replacement phase supersedes a lagging semantic battle prompt before the party mirror arrives", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const stats = { battleMessagePrompts: 0, postBattleExpPrompts: 0 };
  const advance = createBattlePromptAdvancer(rig, { authority: 0, renderer: 0 }, stats, "wave-4-turn-2");

  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 24);
  authority.evidence.pushConsole("Start Phase SwitchPhase");

  assert.equal(await advance(), false);
  assert.deepEqual(authority.presses, [], "the stale prompt key must not enter the replacement party UI");
  assert.equal(stats.battleMessagePrompts, 0);
});

test("authority and retained-renderer evolution prompts are driven once through EVOLUTION_SCENE", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const stats = { battleMessagePrompts: 0, postBattleEvolutionPrompts: 0 };
  authority.evidence.pushCommandSurface();
  renderer.evidence.pushCommandSurface();
  const advance = createBattlePromptAdvancer(rig, { authority: 0, renderer: 0 }, stats, "post-wave-evolution");

  authority.evidence.pushBattleReadiness(
    "battle:evolution",
    "EvolutionPhase",
    false,
    70,
    true,
    { epoch: 7, wave: 1, turn: 1 },
    "EVOLUTION_SCENE",
  );
  assert.equal(await advance(), false, "the evolution animation is passive until its exact prompt is armed");

  authority.evidence.pushBattleReadiness(
    "battle:evolution",
    "EvolutionPhase",
    true,
    71,
    true,
    { epoch: 7, wave: 1, turn: 1 },
    "EVOLUTION_SCENE",
  );
  assert.equal(await advance(), true, "the authority's completed evolution prompt is actionable");
  assert.equal(await advance(), false, "one authority prompt generation receives exactly one Action");

  renderer.evidence.pushBattleReadiness(
    "battle:evolution",
    "CoopWaveProgressionReplayPhase",
    true,
    81,
    true,
    { epoch: 7, wave: 1, turn: 2 },
    "EVOLUTION_SCENE",
  );
  assert.equal(
    await advance(),
    false,
    "a successor-address evolution prompt is inert until this browser observes BattleEndPhase",
  );
  renderer.evidence.pushConsole("Start Phase BattleEndPhase");
  renderer.evidence.pushBattleReadiness(
    "battle:evolution",
    "CoopWaveProgressionReplayPhase",
    true,
    82,
    true,
    { epoch: 7, wave: 1, turn: 2 },
    "EVOLUTION_SCENE",
  );
  assert.equal(
    await advance(),
    true,
    "the retained renderer's exact next-turn completion prompt is actionable after BattleEndPhase",
  );
  assert.equal(await advance(), false, "one renderer prompt generation receives exactly one Action");
  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.deepEqual(
    renderer.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.equal(stats.postBattleEvolutionPrompts, 2);
});

test("a staggered sequential command frontier waits for current semantic address convergence", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const stats = { battleMessagePrompts: 0, postBattleExpPrompts: 0 };

  // Reproduce depth run 30500538258: the authority's last legacy command marker is from turn 1,
  // while its current partner-wait message is already at turn 4. The renderer is still at turn 3.
  authority.evidence.pushCommandSurface({ epoch: 7, wave: 3, turn: 1 });
  renderer.evidence.pushCommandSurface({ epoch: 7, wave: 3, turn: 3 });
  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 71, true, {
    epoch: 7,
    wave: 3,
    turn: 4,
  });
  renderer.evidence.pushOwnedCommandSurface(1, { epoch: 7, wave: 3, turn: 3 });

  const advance = createBattlePromptAdvancer(rig, { authority: 0, renderer: 0 }, stats, "staggered-frontier");
  assert.equal(await advance(), false, "a normal one-browser-ahead frontier must wait instead of throwing or guessing");
  assert.equal(authority.presses.length, 0, "no public input is spent before the two current addresses converge");

  renderer.evidence.pushOwnedCommandSurface(1, { epoch: 7, wave: 3, turn: 4 });
  assert.equal(await advance(), true, "the exact current turn becomes actionable once both semantic mirrors agree");
  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.equal(renderer.presses.length, 0, "the command-menu owner is left to the sequential command driver");
});

test("successor-address faint narration advances only after the browser observes its structural FaintPhase", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const from = { authority: 0, renderer: 0 };
  authority.evidence.pushCommandSurface();
  renderer.evidence.pushCommandSurface();
  const advance = createBattlePromptAdvancer(rig, from, {}, "post-turn-faint", {
    expectedCommandAddress: "7:1:1",
  });

  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 20, true, {
    epoch: 7,
    wave: 1,
    turn: 2,
  });
  assert.equal(await advance(), false, "an unexplained future-turn message must stay fail-closed");

  authority.evidence.pushConsole("Start Phase FaintPhase");
  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 21, true, {
    epoch: 7,
    wave: 1,
    turn: 2,
  });
  assert.equal(await advance(), true, "the exact structural faint narration is human-actionable");
  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.equal(await advance(), false, "one faint prompt generation receives exactly one action");
});

test("paired immediate-successor command control authorizes its current turn-start message", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const from = { authority: 0, renderer: 0 };
  authority.evidence.pushCommandSurface({ epoch: 7, wave: 2, turn: 1 });
  renderer.evidence.pushCommandSurface({ epoch: 7, wave: 2, turn: 1 });
  const advance = createBattlePromptAdvancer(rig, from, {}, "post-turn-command-frontier", {
    expectedCommandAddress: "7:2:1",
  });

  authority.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 30, true, {
    epoch: 7,
    wave: 2,
    turn: 2,
  });
  assert.equal(await advance(), false, "one browser advancing early cannot authorize a future-turn prompt");

  renderer.evidence.pushBattleReadiness("command:watcher", "CoopReplayTurnPhase", false, 31, true, {
    epoch: 7,
    wave: 2,
    turn: 2,
  });
  assert.equal(
    await advance(),
    true,
    "the exact current N+1 message is actionable once its peer is the paired N+1 command watcher",
  );
  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.deepEqual(renderer.presses, [], "the passive command watcher never receives speculative input");
  assert.equal(await advance(), false, "the successor prompt generation receives one action only");
});

test("successor-address trainer victory survives authority-first human input skew", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const pressOrder = [];
  authority.press = async function press(key, purpose) {
    this.presses.push({ key, purpose });
    pressOrder.push(this.label);
  };
  renderer.press = async function press(key, purpose) {
    this.presses.push({ key, purpose });
    pressOrder.push(this.label);
  };
  const rig = { host: authority, clients: { authority, renderer }, trainerVictoryStaggerMs: 0 };
  const from = { authority: 0, renderer: 0 };
  authority.evidence.pushCommandSurface({ epoch: 7, wave: 5, turn: 5 });
  renderer.evidence.pushCommandSurface({ epoch: 7, wave: 5, turn: 5 });
  const advance = createBattlePromptAdvancer(rig, from, {}, "post-turn-trainer-victory", {
    expectedCommandAddress: "7:5:5",
  });

  authority.evidence.pushBattleReadiness("battle:message", "TrainerVictoryPhase", true, 30, true, {
    epoch: 7,
    wave: 5,
    turn: 6,
  });
  assert.equal(await advance(), false, "an unexplained future-turn trainer message must stay fail-closed");

  authority.evidence.pushConsole("Start Phase BattleEndPhase");
  authority.evidence.pushBattleReadiness("battle:message", "TrainerVictoryPhase", true, 31, true, {
    epoch: 7,
    wave: 5,
    turn: 6,
  });
  assert.equal(await advance(), false, "one-sided trainer victory cannot advance while its partner is parked");

  // The authoritative renderer never executes BattleEndPhase. Its exact signed trainer-victory-open
  // projection starts TrainerVictoryPhase directly; requiring a local structural marker would make the
  // real two-browser driver ignore a healthy actionable prompt forever.
  renderer.evidence.pushBattleReadiness("battle:message", "TrainerVictoryPhase", true, 31, true, {
    epoch: 7,
    wave: 5,
    turn: 6,
  });
  assert.equal(await advance(), true, "the exact paired trainer-victory prompts survive a staggered drive");
  assert.deepEqual(pressOrder, ["authority", "renderer"], "the journey reproduces authority-first human skew");
  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.deepEqual(
    renderer.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.equal(await advance(), false, "the paired trainer-victory generation receives exactly one action per browser");
});

test("successor-address trainer settlement drains money and modifier reward prompts", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const from = { authority: 0, renderer: 0 };
  authority.evidence.pushCommandSurface({ epoch: 7, wave: 5, turn: 5 });
  renderer.evidence.pushCommandSurface({ epoch: 7, wave: 5, turn: 5 });
  const advance = createBattlePromptAdvancer(rig, from, {}, "post-turn-trainer-settlement", {
    expectedCommandAddress: "7:5:5",
  });

  authority.evidence.pushBattleReadiness("battle:message", "MoneyRewardPhase", true, 40, true, {
    epoch: 7,
    wave: 5,
    turn: 6,
  });
  assert.equal(await advance(), false, "an unexplained future-turn money prompt must stay fail-closed");

  authority.evidence.pushConsole("Start Phase BattleEndPhase");
  authority.evidence.pushBattleReadiness("battle:message", "MoneyRewardPhase", true, 41, true, {
    epoch: 7,
    wave: 5,
    turn: 6,
  });
  assert.equal(await advance(), true, "the trainer's exact money narration must be actionable");

  authority.evidence.pushBattleReadiness("battle:message", "ModifierRewardPhase", true, 42, true, {
    epoch: 7,
    wave: 5,
    turn: 6,
  });
  assert.equal(await advance(), true, "the trainer's exact modifier narration must be actionable");
  assert.deepEqual(
    authority.presses.map(entry => entry.key),
    ["Space", "Space"],
  );
  assert.equal(await advance(), false, "each trainer-settlement prompt generation receives exactly one action");
});

test("the retained renderer drains account-local trainer rewards only after its exact V2 projection", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const from = { authority: 0, renderer: 0 };
  authority.evidence.pushCommandSurface({ epoch: 7, wave: 5, turn: 5 });
  renderer.evidence.pushCommandSurface({ epoch: 7, wave: 5, turn: 5 });
  const advance = createBattlePromptAdvancer(rig, from, {}, "retained-renderer-trainer-settlement", {
    expectedCommandAddress: "7:5:5",
  });

  renderer.evidence.pushBattleReadiness("battle:message", "ModifierRewardPhase", true, 50, true, {
    epoch: 7,
    wave: 5,
    turn: 6,
  });
  assert.equal(await advance(), false, "a renderer-local successor prompt has no authority from its phase name alone");

  renderer.evidence.pushConsole("[coop:v2-control] projected ordered trainer victory rev=25 wave=4 turn=6");
  renderer.evidence.pushBattleReadiness("battle:message", "ModifierRewardPhase", true, 51, true, {
    epoch: 7,
    wave: 5,
    turn: 6,
  });
  assert.equal(await advance(), false, "a trainer-victory projection from another wave remains fail-closed");

  renderer.evidence.pushConsole("[coop:v2-control] projected ordered trainer victory rev=25 wave=5 turn=6");
  renderer.evidence.pushBattleReadiness("battle:message", "ModifierRewardPhase", true, 52, true, {
    epoch: 7,
    wave: 5,
    turn: 6,
  });
  assert.equal(await advance(), true, "the exact retained trainer-victory projection authorizes its voucher popup");
  assert.deepEqual(authority.presses, [], "the authority has no prompt and receives no speculative input");
  assert.deepEqual(
    renderer.presses.map(entry => entry.key),
    ["Space"],
  );
  assert.equal(await advance(), false, "the exact renderer prompt generation receives one action only");
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

test("an embedded-battle command watcher stays passive while current and is superseded by newer UI", () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  renderer.evidence.events.push({
    index: renderer.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:watcher",
      phase: "CoopReplayTurnPhase",
      ready: { handlerActive: false, awaitingActionInput: false, inputBlocked: true },
    },
  });

  assert.equal(hasProvisionalCommandWatcherSurface([authority, renderer], { authority: 0, renderer: 0 }), true);

  renderer.evidence.events.push({
    index: renderer.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "mystery-encounter:message",
      phase: "CoopReplayMePhase",
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    },
  });
  assert.equal(
    hasProvisionalCommandWatcherSurface([authority, renderer], { authority: 0, renderer: 0 }),
    false,
    "historical watcher evidence cannot hide a newer unknown/actionable surface",
  );
});

test("host-owned learn move allows asymmetric UI only while address and state stay exact", () => {
  const address = { epoch: 17, wave: 1, turn: 3 };
  const owner = {
    surfaceId: "learn-move:confirm",
    localSeat: 0,
    ownerSeat: 0,
    seatsWithInput: [0],
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: false },
    address,
    stateDigest: "same-state",
  };
  const watcher = {
    surfaceId: "learn-move:summary",
    phase: "LearnMovePhase",
    localSeat: 1,
    ownerSeat: null,
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: true },
    address,
    stateDigest: "same-state",
  };

  assert.doesNotThrow(() => assertAsymmetricLearnMoveProjection(owner, watcher));
  assert.throws(
    () =>
      assertAsymmetricLearnMoveProjection(owner, {
        ...watcher,
        address: { epoch: 17, wave: 2, turn: 1 },
        stateDigest: "speculative-next-wave",
      }),
    /different authoritative states/u,
    "the pre-fix wave-2 watcher / wave-1 owner split must fail",
  );
});

test("a repeated multi-battler SummonPhase retains its unchanged passive semantic surface", () => {
  const authority = fakeClient("authority", ["Start Phase SummonPhase"]);
  const renderer = fakeClient("renderer");
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "battle:message",
      operationClass: "battle-progress",
      phase: "SummonPhase",
      ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: true },
    },
  });
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    text: "Start Phase SummonPhase",
  });

  assert.equal(
    hasPassiveBattleProgressSurface([authority, renderer], { authority: 0, renderer: 0 }),
    true,
    "a second battler reuses the passive message surface without becoming an unknown human-input screen",
  );

  authority.evidence.events.push({
    index: authority.evidence.events.length,
    text: "Start Phase ToggleDoublePositionPhase",
  });
  assert.equal(
    hasPassiveBattleProgressSurface([authority, renderer], { authority: 0, renderer: 0 }),
    false,
    "a different later phase still supersedes the historical summon surface",
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
  const seats = { authority: 0, renderer: 1 };
  for (const client of Object.values(clients)) {
    client.publicSeat = seats[client.label];
    client.evidence.pushCommandSurface();
    client.evidence.pushBattleReadiness("battle:message", "MessagePhase", true, 1);
    client.press = async function press(key, purpose) {
      this.presses.push({ key, purpose });
      this.evidence.pushOwnedCommandSurface(this.publicSeat);
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
  for (const [client, localSeat] of [
    [authority, 0],
    [renderer, 1],
  ]) {
    client.evidence.events.push({
      index: client.evidence.events.length,
      kind: "browser-surface2",
      observation: {
        surfaceId: "reward-shop",
        localSeat,
        address: { epoch: 7, wave: 1, turn: 1 },
      },
    });
  }
  const rig = {
    host: authority,
    clients: { authority, renderer },
    config: { faintOwnerSeat: "renderer" },
  };

  assert.deepEqual(await waitForOutcomeBounded(rig, { authority: 0, renderer: 0 }, 0), {
    kind: "reward",
    surfaceId: "reward-shop",
  });
});

test("the outcome wait preserves a biome market instead of misclassifying its shared phase as rewards", async () => {
  const authority = fakeClient("authority", ["Start Phase SelectModifierPhase"]);
  const renderer = fakeClient("renderer", ["Start Phase SelectModifierPhase"]);
  for (const [client, localSeat] of [
    [authority, 0],
    [renderer, 1],
  ]) {
    client.evidence.events.push({
      index: client.evidence.events.length,
      kind: "browser-surface2",
      observation: {
        surfaceId: "biome-market",
        localSeat,
        address: { epoch: 7, wave: 10, turn: 2 },
      },
    });
  }
  const rig = {
    host: authority,
    clients: { authority, renderer },
    config: { faintOwnerSeat: "renderer" },
  };

  assert.deepEqual(await waitForOutcomeBounded(rig, { authority: 0, renderer: 0 }, 0), {
    kind: "reward",
    surfaceId: "biome-market",
  });
});

test("an embedded Mystery battle recognizes an exact shared next-wave encounter as healthy progress", async () => {
  const nextEncounter = localSeat => ({
    kind: "browser-surface2",
    observation: {
      surfaceId: "battle:message",
      operationClass: "battle-progress",
      phase: "NextEncounterPhase",
      coop: true,
      localSeat,
      seatsWithInput: [localSeat],
      membershipRevision: 3,
      connectionGeneration: 0,
      connectionGenerations: [0, 0],
      mysteryEncounterType: 87,
      stateDigest: "next-wave-state",
      address: { epoch: 7, wave: 3, turn: 1 },
      ready: { handlerActive: true, awaitingActionInput: true },
    },
  });
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  authority.evidence.events.push({ ...nextEncounter(0), index: authority.evidence.events.length });
  renderer.evidence.events.push({ ...nextEncounter(1), index: renderer.evidence.events.length });
  const rig = {
    activeBattleWave: 2,
    host: authority,
    clients: { authority, renderer },
    config: { faintOwnerSeat: "renderer" },
  };
  const boundary = {
    epoch: 7,
    wave: 3,
    turn: 1,
    stateDigest: "next-wave-state",
    mysteryEncounterType: 87,
  };

  assert.deepEqual(findSharedSuccessorWavePresentation(rig, { authority: 0, renderer: 0 }), boundary);
  assert.deepEqual(await waitForOutcomeBounded(rig, { authority: 0, renderer: 0 }, 0), {
    kind: "wave-transition",
    boundary,
  });

  renderer.evidence.events.at(-1).observation.stateDigest = "diverged";
  assert.equal(findSharedSuccessorWavePresentation(rig, { authority: 0, renderer: 0 }), null);
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

test("one-sided next-command confirmation presses its partner's exact public CommandPhase prompt", async () => {
  const authority = fakeClient("authority");
  authority.publicSeat = 0;
  const renderer = fakeClient("renderer");
  renderer.publicSeat = 1;
  const address = { epoch: 7, wave: 2, turn: 3 };
  authority.evidence.events.push({
    index: authority.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "battle:message",
      operationClass: "battle-progress",
      ownerModel: "local",
      coop: true,
      address,
      localSeat: 0,
      seatsWithInput: [0],
      phase: "CommandPhase",
      phaseInstance: 14,
      uiMode: "MESSAGE",
      ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    },
  });
  renderer.evidence.events.push({
    index: renderer.evidence.events.length,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:command",
      operationClass: "command",
      coop: true,
      address,
      localSeat: 1,
      seatsWithInput: [1],
      phase: "CommandPhase",
      phaseInstance: 35,
      uiMode: "COMMAND",
      ready: { handlerActive: true },
    },
  });
  const rig = {
    host: authority,
    clients: { authority, renderer },
    config: { faintOwnerSeat: "renderer" },
    consumedBattlePromptInstances: new Set(),
  };

  assert.deepEqual(
    await waitForOutcomeBounded(rig, { authority: 0, renderer: 0 }, 100, {
      stopOnOwnedCommandFrontier: true,
      singleSidedConfirmMs: 5,
    }),
    { kind: "command", client: renderer },
  );
  assert.deepEqual(authority.presses, [
    { key: "Space", purpose: "post-turn-next-command-frontier-authority-battle:message-1" },
  ]);
});

test("the campaign outcome wait never infers a faint from a host authority SwitchPhase log", async () => {
  const command = localSeat => ({
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:command",
      operationClass: "command",
      phase: "CommandPhase",
      phaseInstance: 5,
      uiMode: "COMMAND",
      localSeat,
      seatsWithInput: [localSeat],
      ready: { handlerActive: true },
      address: { epoch: 7, wave: 2, turn: 1 },
    },
  });
  // The host is the sole authoritative engine, so it logs "Start Phase SwitchPhase" even for a
  // GUEST-owned or already-resolved faint. That console line is NOT ownership proof that the HOST
  // owns an actionable replacement picker. Both seats are actually at their healthy wave-2 command
  // surface (the depth-lane run 29912693840 final capture: both leads alive, both commanding).
  const authority = fakeClient("authority", ["Start Phase SwitchPhase"]);
  authority.publicSeat = 0;
  authority.evidence.events.push({ ...command(0), index: authority.evidence.events.length });
  const renderer = fakeClient("renderer");
  renderer.publicSeat = 1;
  renderer.evidence.events.push({ ...command(1), index: renderer.evidence.events.length });
  const rig = {
    host: authority,
    clients: { authority, renderer },
    config: { faintOwnerSeat: "guest-seat" },
  };

  assert.deepEqual(
    await waitForOutcomeBounded(rig, { authority: 0, renderer: 0 }, 50, {
      stopOnOwnedCommandFrontier: true,
    }),
    { kind: "command" },
    "a host authority SwitchPhase with no owned actionable replacement surface must not be a faint",
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
  assert.deepEqual(renderer.presses, [
    { key: "Space", purpose: "fallback-renderer:1/4" },
    { key: "ArrowRight", purpose: "fallback-renderer:2/4" },
    { key: "Space", purpose: "fallback-renderer:3/4" },
    { key: "Space", purpose: "fallback-renderer:4/4" },
  ]);
});

test("the bounded outcome wait drives a late addressed target before arming blind fallback input", async () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  let targetDrives = 0;

  const outcome = await waitForOutcomeBounded(rig, { authority: 0, renderer: 0 }, 100, {
    stopOnTurnProgress: true,
    driveTargetSelection: async () => {
      targetDrives += 1;
      authority.evidence.pushConsole("Start Phase TurnStartPhase");
      renderer.evidence.pushConsole("Start Phase TurnStartPhase");
      return true;
    },
  });

  assert.deepEqual(outcome, { kind: "turn-progress" });
  assert.equal(targetDrives, 1, "the semantic target is consumed during the primary wait, not by fallback");
});

test("every causal post-command wait keeps the exact-address target driver armed", async () => {
  const source = await readFile(resolve(root, "test/browser/coop-public-ui/campaign.mjs"), "utf8");
  const start = source.indexOf("async function driveBattleWave(");
  const end = source.indexOf("\n/**\n * The client that reports ITSELF", start);
  assert.ok(start >= 0 && end > start, "driveBattleWave source boundary must remain inspectable");
  const battleDriver = source.slice(start, end);
  assert.equal(
    battleDriver.match(/\n\s*driveTargetSelection,/gu)?.length ?? 0,
    3,
    "primary, progressed-turn, and post-fallback waits must all drive a late public target picker",
  );
});

test("fallback stops retrying when an earlier key visibly enters the turn", async () => {
  const authority = fakeClient("authority", ["[coop:turn] host recorder: begin turn=1"]);
  const renderer = fakeClient("renderer");
  renderer.press = async function press(key, purpose) {
    this.presses.push({ key, purpose });
    this.evidence.pushConsole("Start Phase TurnStartPhase");
    this.evidence.pushOwnedCommandSurface(1, { epoch: 7, wave: 1, turn: 2 });
  };
  const rig = { host: authority, clients: { authority, renderer } };

  assert.deepEqual(
    await driveBattleFallback(
      rig,
      ["Space", "ArrowRight", "Space", "Space"],
      { authority: 0, renderer: 0 },
      "fallback",
    ),
    [renderer],
  );
  assert.deepEqual(
    renderer.presses,
    [{ key: "Space", purpose: "fallback-renderer:1/4" }],
    "the three stale keys must not spill into the next live command UI",
  );
  const suppression = renderer.evidence.events.find(event => event.kind === "campaign-battle-fallback-superseded");
  assert.deepEqual(
    { keysSent: suppression?.keysSent, keysSuppressed: suppression?.keysSuppressed },
    { keysSent: 1, keysSuppressed: 3 },
  );
});

test("recorded turn work suppresses fallback even when the initial TurnStart marker predates the evidence floor", async () => {
  const authority = fakeClient("authority", [
    "[coop:turn] host recorder: append turn=2 seq=0 k=moveUsed total=1 live=true",
  ]);
  const renderer = fakeClient("renderer", ["[coop:replay] guest RECV live battleEvent turn=2 seq=0 k=moveUsed"]);
  const rig = { host: authority, clients: { authority, renderer } };
  const from = { authority: 0, renderer: 0 };

  assert.deepEqual(clientsAwaitingTurnProgress(rig, from), []);
  assert.deepEqual(await driveBattleFallback(rig, ["Space", "ArrowRight", "Space", "Space"], from, "fallback"), []);
  assert.deepEqual(authority.presses, []);
  assert.deepEqual(renderer.presses, []);
});

test("fallback treats only the exact next owned command address as submitted-turn progress", async () => {
  const authority = fakeClient("authority", ["[coop:turn] host recorder: begin turn=1"]);
  const renderer = fakeClient("renderer");
  authority.publicSeat = 0;
  renderer.publicSeat = 1;
  renderer.evidence.pushOwnedCommandSurface(1, { epoch: 7, wave: 1, turn: 2 });
  const rig = { host: authority, clients: { authority, renderer } };
  const from = { authority: 0, renderer: 0 };

  assert.deepEqual(clientsAwaitingTurnProgress(rig, from, "7:1:1"), []);
  assert.deepEqual(
    await driveBattleFallback(rig, ["Space", "ArrowRight", "Space", "Space"], from, "fallback", "7:1:1"),
    [],
  );
  assert.deepEqual(renderer.presses, [], "no stale fallback key may enter the successor CommandPhase");

  const sameAddress = fakeClient("same-address");
  sameAddress.publicSeat = 1;
  sameAddress.evidence.pushOwnedCommandSurface(1, { epoch: 7, wave: 1, turn: 1 });
  const sameRig = { host: authority, clients: { authority, sameAddress } };
  assert.deepEqual(
    clientsAwaitingTurnProgress(sameRig, { authority: 0, "same-address": 0 }, "7:1:1"),
    [sameAddress],
    "a re-emitted source frontier cannot suppress the human retry",
  );
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

test("an exact retained wave successor receives measured headroom under the same immutable ceiling", () => {
  const authority = fakeClient("authority");
  const renderer = fakeClient("renderer");
  const rig = { host: authority, clients: { authority, renderer } };
  const budget = createAnimationProgressBudget(rig, { authority: 0, renderer: 0 }, 100, {
    now: () => 1_000,
    animationAllowanceMs: 50,
    waveProgressAllowanceMs: 300,
    hardCeilingMs: 400,
  });

  renderer.evidence.pushPhase("Start Phase CoopWaveProgressionReplayPhase", new Date(1_050).toISOString(), 50);
  assert.equal(budget.observe(), 1_350, "the typed progression phase outranks the generic 50ms test allowance");
  authority.evidence.pushPhase("[coop:v2] applied WAVE_ADVANCE rev=12", new Date(1_180).toISOString(), 180);
  assert.equal(budget.observe(), 1_400, "the exact entry is still capped by the original hard deadline");

  const records = [...authority.evidence.events, ...renderer.evidence.events].filter(
    event => event.kind === "campaign-animation-budget",
  );
  assert.ok(records.every(event => event.allowanceMs === 300));
});
