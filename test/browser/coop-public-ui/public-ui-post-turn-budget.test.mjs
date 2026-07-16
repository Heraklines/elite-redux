/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createBattlePromptAdvancer } from "./campaign.mjs";
import { marketObservationView } from "./evidence.mjs";
import { assertMarketPurchaseConverged, planMarketGridKeys } from "./market-journey.mjs";
import {
  createPublicBattleProgressBudget,
  DuoPublicUiRig,
  findActionableFirstLoginGenderSurface,
  PublicUiClient,
} from "./public-ui-harness.mjs";

class FakeEvidence {
  constructor(label) {
    this.label = label;
    this.events = [];
  }

  push(event) {
    this.events.push({ index: this.events.length, ...event });
  }

  record(kind, detail) {
    this.events.push({ index: this.events.length, kind, ...detail });
  }

  cursor() {
    return this.events.length;
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

  async waitFor(pattern, { from = 0, description = String(pattern) } = {}) {
    const event = this.find(pattern, from);
    if (event == null) {
      throw new Error(`${this.label}: timed out waiting for ${description}`);
    }
    return event;
  }
}

function ownedCommand(localSeat, address = { epoch: 73, wave: 1, turn: 2 }) {
  return {
    kind: "browser-surface2",
    observation: {
      operationClass: "command",
      surfaceId: "command:command",
      phase: "CommandPhase",
      uiMode: "COMMAND",
      address,
      localSeat,
      seatsWithInput: [localSeat],
      ready: { handlerActive: true },
    },
  };
}

function at(ms) {
  return new Date(ms).toISOString();
}

test("Commander post-turn prompts use its proven address without inventing a hidden-owner command surface", async () => {
  const address = { epoch: 73, wave: 1, turn: 2 };
  const pressed = [];
  const makeClient = (label, publicSeat) => ({
    label,
    publicSeat,
    evidence: new FakeEvidence(label),
    press: async key => pressed.push({ label, key }),
  });
  const host = makeClient("host-seat", 0);
  const guest = makeClient("guest-seat", 1);
  const rig = { host, clients: { host, guest } };
  // Commander deliberately exposes no command surface on its owner. The read-only Commander oracle has
  // already proven this exact address, and only an actionable prompt at that address may spend a key.
  guest.evidence.push({
    kind: "browser-surface2",
    observation: {
      surfaceId: "battle:message",
      phase: "MessagePhase",
      phaseInstance: 8,
      uiMode: "MESSAGE",
      ownerModel: "local",
      coop: true,
      localSeat: 1,
      seatsWithInput: [1],
      address: { ...address, turn: address.turn + 1 },
      ready: { handlerActive: true, awaitingActionInput: true },
    },
  });
  const advance = createBattlePromptAdvancer(rig, { "host-seat": 0, "guest-seat": 0 }, {}, "commander-post-turn", {
    expectedCommandAddress: `${address.epoch}:${address.wave}:${address.turn}`,
  });
  assert.equal(await advance(), false, "a prompt from another turn is not admitted");

  guest.evidence.push({
    kind: "browser-surface2",
    observation: {
      ...guest.evidence.events[0].observation,
      phaseInstance: 9,
      address,
    },
  });
  assert.equal(await advance(), true, "the exact Commander-addressed prompt remains publicly drivable");
  assert.deepEqual(pressed, [{ label: "guest-seat", key: "Space" }]);
});

const ZERO_PROGRESS_BUDGET = Object.freeze({
  progressAllowanceMs: 0,
  hardCeilingMs: 0,
});

test("first-login gender confirm waits for the actionable option picker, not its preceding message", () => {
  const evidence = new FakeEvidence("new-account");
  evidence.push({
    kind: "browser-surface2",
    observation: {
      surfaceId: "battle:message",
      phase: "SelectGenderPhase",
      phaseInstance: 1,
      uiMode: "MESSAGE",
      seatsWithInput: [0],
      ready: { handlerActive: true, awaitingActionInput: false },
    },
  });

  assert.equal(
    findActionableFirstLoginGenderSurface(evidence, 0),
    null,
    "the public confirm key must not be spent on SelectGenderPhase's preceding MESSAGE projection",
  );

  evidence.push({
    kind: "browser-surface2",
    observation: {
      surfaceId: "option-select:SelectGenderPhase",
      phase: "SelectGenderPhase",
      phaseInstance: 2,
      uiMode: "OPTION_SELECT",
      seatsWithInput: [0],
      optionIds: ["boy", "girl"],
      ready: { handlerActive: true, awaitingActionInput: null },
    },
  });

  assert.equal(findActionableFirstLoginGenderSurface(evidence, 0), evidence.events[1]);
});

test("post-turn progress extends the soft deadline but never the immutable hard ceiling", () => {
  let nowMs = 1_000;
  const authority = { label: "authority", evidence: new FakeEvidence("authority") };
  const renderer = { label: "renderer", evidence: new FakeEvidence("renderer") };
  const rig = { clients: { authority, renderer } };
  const budget = createPublicBattleProgressBudget(rig, { authority: 0, renderer: 0 }, 100, {
    now: () => nowMs,
    progressAllowanceMs: 80,
    hardCeilingMs: 300,
  });

  assert.equal(budget.deadline(), 1_100);
  nowMs = 1_095;
  authority.evidence.push({
    at: at(nowMs),
    kind: "console",
    text: "Start Phase DamageAnimPhase",
  });
  assert.equal(budget.observe(), 1_175);

  nowMs = 1_170;
  renderer.evidence.push({
    at: at(nowMs),
    kind: "browser-surface2",
    observation: {
      operationClass: "battle-progress",
      surfaceId: "battle:message",
      phaseInstance: 12,
      ready: { awaitingActionInput: true },
    },
  });
  assert.equal(budget.observe(), 1_250, "an actionable semantic prompt is causal progress");

  nowMs = 1_240;
  authority.evidence.push({
    at: at(nowMs),
    kind: "console",
    text: "[coop:webrtc] raw rx role=host t=requestTurnCommit bytes=68 handlers=11",
  });
  assert.equal(budget.observe(), 1_250, "transport retries and heartbeats cannot extend the wait");

  nowMs = 1_260;
  authority.evidence.push({
    at: at(nowMs),
    kind: "console",
    text: "[coop:turn] host recorder: append turn=1 seq=12 k=faint total=13 live=true",
  });
  assert.equal(budget.observe(), 1_300, "causal progress is capped at the hard deadline");

  nowMs = 1_299;
  renderer.evidence.push({
    at: at(nowMs),
    kind: "console",
    text: "[coop:replay] guest replay turn=1: live increment seq=12..12",
  });
  assert.equal(budget.observe(), 1_300);
  assert.equal(budget.hardDeadline(), 1_300);
});

test("repeated semantic projections cannot refresh the same causal progress token", () => {
  let nowMs = 1_000;
  const authority = { label: "authority", evidence: new FakeEvidence("authority") };
  const renderer = { label: "renderer", evidence: new FakeEvidence("renderer") };
  const rig = { clients: { authority, renderer } };
  const budget = createPublicBattleProgressBudget(rig, { authority: 0, renderer: 0 }, 100, {
    now: () => nowMs,
    progressAllowanceMs: 80,
    hardCeilingMs: 300,
  });
  const observation = {
    operationClass: "reward",
    surfaceId: "reward-shop",
    phaseInstance: 12,
    ready: { awaitingActionInput: false },
  };

  nowMs = 1_095;
  authority.evidence.push({
    at: at(nowMs),
    kind: "browser-surface2",
    observation,
  });
  assert.equal(budget.observe(), 1_175);

  nowMs = 1_170;
  authority.evidence.push({
    at: at(nowMs),
    kind: "browser-surface2",
    observation: { ...observation, selectedOptionId: "leave" },
  });
  assert.equal(budget.observe(), 1_175, "a repeated semantic token must not extend the deadline again");

  nowMs = 1_174;
  authority.evidence.push({
    at: at(nowMs),
    kind: "browser-surface2",
    observation: { ...observation, ready: { awaitingActionInput: true } },
  });
  assert.equal(budget.observe(), 1_254, "a new readiness transition remains causal progress");
});

test("command wait drains an owned semantic surface buffered as its deadline callback resumes", async () => {
  const evidence = new FakeEvidence("authority");
  const commandSurface = {
    at: at(1_100),
    kind: "browser-surface2",
    observation: {
      operationClass: "command",
      surfaceId: "command:command",
      phase: "CommandPhase",
      uiMode: "COMMAND",
      localSeat: 0,
      seatsWithInput: [0],
      ready: { handlerActive: true },
    },
  };
  evidence.push(commandSurface);
  const client = { label: "authority", publicSeat: 0, evidence, config: { timeoutMs: 0 } };

  const result = await PublicUiClient.prototype.waitForLocalCommand.call(client, 0);
  assert.equal(result, evidence.events[0]);
});

test("sequential command driver submits the first owner before waiting for the partner UI", async () => {
  const order = [];
  const firstEvidence = new FakeEvidence("first");
  const secondEvidence = new FakeEvidence("second");
  firstEvidence.push(ownedCommand(0));
  const first = {
    label: "first",
    publicSeat: 0,
    evidence: firstEvidence,
    checkpoint: async () => {},
    sequence: async () => {
      order.push("first");
      secondEvidence.push(ownedCommand(1));
    },
  };
  const second = {
    label: "second",
    publicSeat: 1,
    evidence: secondEvidence,
    checkpoint: async () => {},
    sequence: async () => {
      order.push("second");
    },
  };
  const rig = {
    clients: { first, second },
    config: { timeoutMs: 1_000 },
  };

  const result = await DuoPublicUiRig.prototype.driveSequentialCommandRound.call(
    rig,
    { first: 0, second: 0 },
    ["Space", "Space", "Space"],
    "turn-2",
  );

  assert.deepEqual(order, ["first", "second"]);
  assert.equal(firstEvidence.events.at(-1).kind, "sequential-command-proof");
  assert.equal(secondEvidence.events.at(-1).kind, "sequential-command-proof");
  assert.deepEqual(result.outcomeCursors, {
    first: firstEvidence.events.at(-1).index,
    second: secondEvidence.events.at(-1).index,
  });
});

test("sequential command driver accepts an exact-address collection close when the partner slot cannot act", async () => {
  const order = [];
  const address = { epoch: 73, wave: 1, turn: 2 };
  const firstEvidence = new FakeEvidence("first");
  const secondEvidence = new FakeEvidence("second");
  firstEvidence.push(ownedCommand(0, address));
  const first = {
    label: "first",
    publicSeat: 0,
    evidence: firstEvidence,
    checkpoint: async () => {},
    sequence: async () => {
      order.push("first");
      firstEvidence.push({
        kind: "browser-surface2",
        observation: {
          operationClass: "battle-progress",
          surfaceId: "battle:message",
          phase: "MovePhase",
          address,
        },
      });
    },
  };
  const second = {
    label: "second",
    publicSeat: 1,
    evidence: secondEvidence,
    checkpoint: async () => {},
    sequence: async () => {
      order.push("second");
    },
  };
  const rig = {
    clients: { first, second },
    config: { timeoutMs: 1_000 },
  };

  const result = await DuoPublicUiRig.prototype.driveSequentialCommandRound.call(
    rig,
    { first: 0, second: 0 },
    ["Space", "Space", "Space"],
    "turn-2",
  );

  assert.deepEqual(order, ["first"]);
  assert.equal(result.commandEvents.second, undefined);
  const secondProof = secondEvidence.events.at(-1);
  assert.equal(secondProof.kind, "sequential-command-proof");
  assert.equal(secondProof.skippedAfterCollectionClosed, true);
  assert.equal(secondProof.collectionClosedObservedBy, "first");
});

function marketObservation({ localSeat, ownerSeat, marketOpen, stock, money, quantity }) {
  return {
    version: 1,
    address: { epoch: 73, wave: 10, turn: 4 },
    pinnedInteraction: 19,
    localRole: localSeat === 0 ? "host" : "guest",
    localSeat,
    ownerSeat,
    localOwner: localSeat === ownerSeat,
    marketOpen,
    uiMode: marketOpen ? "BIOME_SHOP" : "MESSAGE",
    phaseClass: "BiomeShopPhase",
    selectedIndex: marketOpen ? 1 : null,
    selectedItemId: marketOpen ? "WIDE_LENS" : null,
    money,
    stockModel: marketOpen ? "authoritative-visible" : "replica-apply-ledger",
    options: [
      { index: 0, id: "POKEBALL", name: "Poke Ball", cost: 200, stock: 6, targetModel: "direct" },
      { index: 1, id: "WIDE_LENS", name: "Wide Lens", cost: 1_200, stock, targetModel: "party" },
    ],
    party: [{ slot: 0, pokemonId: 9001, speciesId: 25 }],
    heldModifiers: quantity === 0 ? [] : [{ typeId: "WIDE_LENS", pokemonId: 9001, quantity }],
  };
}

test("market observer parser and purchase proof cover money, quantity, and both stock ledgers", () => {
  const before = {
    owner: marketObservation({ localSeat: 0, ownerSeat: 0, marketOpen: true, stock: 3, money: 5_000, quantity: 0 }),
    watcher: marketObservation({ localSeat: 1, ownerSeat: 0, marketOpen: false, stock: 99, money: 5_000, quantity: 0 }),
  };
  const after = {
    owner: marketObservation({ localSeat: 0, ownerSeat: 0, marketOpen: true, stock: 2, money: 3_800, quantity: 1 }),
    watcher: marketObservation({ localSeat: 1, ownerSeat: 0, marketOpen: false, stock: 98, money: 3_800, quantity: 1 }),
  };
  const parsed = marketObservationView(`[coop-browser:market] ${JSON.stringify(before.owner)}`);
  assert.equal(parsed.options[1].id, "WIDE_LENS");
  assert.throws(
    () =>
      marketObservationView(
        `[coop-browser:market] ${JSON.stringify({ ...before.owner, selectedIndex: 5, selectedItemId: "WIDE_LENS" })}`,
      ),
    /invalid market observation/u,
  );
  assert.deepEqual(planMarketGridKeys(0, 5), ["ArrowDown", "ArrowRight"]);
  const proof = assertMarketPurchaseConverged(before, after, {
    ownerLabel: "owner",
    targetId: "WIDE_LENS",
    partySlot: 0,
  });
  assert.equal(proof.cost, 1_200);
  assert.equal(proof.ownerStockAfter, 2);
  assert.equal(proof.watcherStockAfter, 98);
  assert.equal(proof.moneyAfter, 3_800);
});

test("reward leave waits for the exact owned actionable semantic shop surface", async () => {
  const evidence = new FakeEvidence("authority");
  const rewardObservation = {
    operationClass: "reward",
    surfaceId: "reward-shop",
    ownerModel: "interaction",
    phase: "SelectModifierPhase",
    uiMode: "MODIFIER_SELECT",
    localSeat: 0,
    ownerSeat: 0,
    seatsWithInput: [0],
    ready: { handlerActive: true, awaitingActionInput: false },
  };
  evidence.push({ kind: "browser-surface2", observation: rewardObservation });
  evidence.push({
    kind: "browser-surface2",
    observation: { ...rewardObservation, ready: { handlerActive: true, awaitingActionInput: true } },
  });
  const owner = { label: "authority", publicSeat: 0, evidence, config: { timeoutMs: 0 } };

  assert.equal(await PublicUiClient.prototype.waitForOwnedReward.call(owner, 0), evidence.events[1]);
});

test("reward leave accepts only the owner's exact addressed actionable confirmation", async () => {
  const evidence = new FakeEvidence("owner");
  const address = { epoch: 73, wave: 1, turn: 4 };
  const confirmObservation = {
    operationClass: "reward",
    surfaceId: "reward:confirm",
    ownerModel: "interaction",
    phase: "SelectModifierPhase",
    uiMode: "CONFIRM",
    address,
    localSeat: 0,
    ownerSeat: 0,
    seatsWithInput: [0],
    selectedOptionId: "yes",
    ready: { handlerActive: true, awaitingActionInput: null },
  };
  evidence.push({ kind: "browser-surface2", observation: confirmObservation });
  const owner = { label: "owner", publicSeat: 0, evidence, config: { timeoutMs: 0 } };

  assert.equal(await PublicUiClient.prototype.waitForOwnedRewardConfirm.call(owner, 0, address), evidence.events[0]);
});

test("reward leave requires the peer to remain an exact addressed non-actionable watcher", async () => {
  const evidence = new FakeEvidence("watcher");
  const address = { epoch: 73, wave: 1, turn: 4 };
  const watcherObservation = {
    operationClass: "reward",
    surfaceId: "reward-shop",
    ownerModel: "interaction",
    phase: "SelectModifierPhase",
    uiMode: "MODIFIER_SELECT",
    address,
    localSeat: 1,
    ownerSeat: 0,
    seatsWithInput: [0],
    ready: { handlerActive: true, awaitingActionInput: false },
  };
  evidence.push({ kind: "browser-surface2", observation: watcherObservation });
  const watcher = { label: "watcher", publicSeat: 1, evidence, config: { timeoutMs: 0 } };

  assert.equal(
    await PublicUiClient.prototype.waitForAddressedRewardWatcher.call(watcher, 0, 0, address),
    evidence.events[0],
  );
});

test("a non-owner confirmation projection cannot satisfy the owner contract", async () => {
  const evidence = new FakeEvidence("watcher");
  const address = { epoch: 73, wave: 1, turn: 4 };
  evidence.push({
    kind: "browser-surface2",
    observation: {
      operationClass: "reward",
      surfaceId: "reward:confirm",
      ownerModel: "interaction",
      phase: "SelectModifierPhase",
      uiMode: "CONFIRM",
      address,
      localSeat: 1,
      ownerSeat: 0,
      seatsWithInput: [0],
      selectedOptionId: "yes",
      ready: { handlerActive: true, awaitingActionInput: null },
    },
  });
  const watcher = { label: "watcher", publicSeat: 1, evidence, config: { timeoutMs: 0 } };

  await assert.rejects(
    PublicUiClient.prototype.waitForOwnedRewardConfirm.call(watcher, 0, address, ZERO_PROGRESS_BUDGET),
    /timed out waiting for actionable reward confirmation/u,
  );
});

test("reward watcher wait aborts on a bounded shared terminal", async () => {
  const evidence = new FakeEvidence("watcher");
  evidence.push({
    kind: "console",
    text: "[coop:runtime] shared session stopped safely: reward projection could not converge",
  });
  const watcher = { label: "watcher", publicSeat: 1, evidence, config: { timeoutMs: 0 } };

  await assert.rejects(
    PublicUiClient.prototype.waitForAddressedRewardWatcher.call(watcher, 0, 0, { epoch: 73, wave: 1, turn: 4 }),
    /shared session terminated while waiting for the reward watcher/u,
  );
});

test("reward terminal proof binds host retention to guest application and materialization", async () => {
  const hostEvidence = new FakeEvidence("host");
  const guestEvidence = new FakeEvidence("guest");
  const operationId = "73:0:REWARD:0";
  hostEvidence.push({
    kind: "console",
    text: `[coop:reward] reward authoritative RESULT retained rev=7 tick=11 id=${operationId}`,
  });
  hostEvidence.push({
    kind: "console",
    text: `[coop:reward] OWNER retained terminal before continuation seq=0 id=${operationId}`,
  });
  guestEvidence.push({
    kind: "console",
    text: `[coop:reward] shop authoritative RESULT applied-before-render kind=REWARD id=${operationId} rev=7 tick=11`,
  });
  guestEvidence.push({
    kind: "console",
    text: `[coop:reward] reward op WATCHER materialize JOURNAL choice=-1 terminal=true id=${operationId}`,
  });
  const host = { label: "host", evidence: hostEvidence };
  const guest = { label: "guest", evidence: guestEvidence };
  const rig = { host, guest, config: { timeoutMs: 0 } };

  const proof = await DuoPublicUiRig.prototype.assertRetainedRewardTerminal.call(
    rig,
    { host: 0, guest: 0 },
    { epoch: 73, wave: 1, turn: 4 },
    0,
  );

  assert.deepEqual(proof, {
    operationId,
    revision: 7,
    tick: 11,
    ownerSeat: 0,
    expectedAddress: { epoch: 73, wave: 1, turn: 4 },
  });
});
