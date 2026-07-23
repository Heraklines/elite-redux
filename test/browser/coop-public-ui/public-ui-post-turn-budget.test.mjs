/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createBattlePromptAdvancer, driveConfirmedLeave } from "./campaign.mjs";
import { findOwnedActionableTargetSurface } from "./campaign-nav.mjs";
import { marketObservationView } from "./evidence.mjs";
import { assertMarketPurchaseConverged, planMarketGridKeys } from "./market-journey.mjs";
import {
  createPublicBattleProgressBudget,
  DuoPublicUiRig,
  findActionableFirstLoginGenderSurface,
  findSharedCommandFrontierMatch,
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

function replacementPicker(ownerSeat, address = { epoch: 73, wave: 1, turn: 2 }) {
  return {
    kind: "browser-surface2",
    observation: {
      operationClass: "replacement",
      surfaceId: "party:replacement",
      ownerModel: "interaction",
      phase: "SwitchPhase",
      uiMode: "PARTY",
      address,
      localSeat: ownerSeat,
      ownerSeat,
      seatsWithInput: [ownerSeat],
      ready: { handlerActive: true },
    },
  };
}

function commandFrontierObservation(
  localSeat,
  kind,
  stateDigest = "same-state",
  address = { epoch: 73, wave: 1, turn: 3 },
) {
  const owner = kind === "owner";
  return {
    kind: "browser-surface2",
    observation: {
      version: 2,
      coop: true,
      operationClass: owner ? "command" : "battle-progress",
      surfaceId: owner ? "command:command" : "battle:message",
      phase: "CommandPhase",
      uiMode: owner ? "COMMAND" : "MESSAGE",
      address,
      membershipRevision: 9,
      connectionGeneration: 2,
      stateDigest,
      localSeat,
      seatsWithInput: [localSeat],
      ready: { handlerActive: true, awaitingActionInput: owner ? null : true },
    },
  };
}

test("command frontier accepts one real owner plus the half-wiped partner watcher", () => {
  const host = { label: "host", publicSeat: 0, evidence: new FakeEvidence("host") };
  const guest = { label: "guest", publicSeat: 1, evidence: new FakeEvidence("guest") };
  host.evidence.push(commandFrontierObservation(0, "watcher"));
  guest.evidence.push(commandFrontierObservation(1, "owner"));

  const match = findSharedCommandFrontierMatch(host, guest, { host: 0, guest: 0 }, null);
  assert.equal(match?.address, "73:1:3");
  assert.equal(match?.hostProjection.kind, "watcher");
  assert.equal(match?.guestProjection.kind, "owner");
});

test("command frontier accepts an exact replay waiter as a non-actionable watcher", () => {
  const host = { label: "host", publicSeat: 0, evidence: new FakeEvidence("host") };
  const guest = { label: "guest", publicSeat: 1, evidence: new FakeEvidence("guest") };
  const address = { epoch: 73, wave: 2, turn: 4 };
  host.evidence.push(commandFrontierObservation(0, "owner", "same-state", address));
  guest.evidence.push({
    kind: "browser-surface2",
    observation: {
      ...commandFrontierObservation(1, "watcher", "same-state", address).observation,
      surfaceId: "command:watcher",
      operationClass: "command",
      phase: "CoopReplayTurnPhase",
      seatsWithInput: [],
      ready: { handlerActive: false, awaitingActionInput: false, inputBlocked: true },
    },
  });

  const match = findSharedCommandFrontierMatch(host, guest, { host: 0, guest: 0 }, null);
  assert.equal(match?.hostProjection.kind, "owner");
  assert.equal(match?.guestProjection.kind, "watcher");
  assert.equal(match?.address, "73:2:4");
});

test("command frontier rejects owner/watcher digest or generation disagreement", () => {
  const host = { label: "host", publicSeat: 0, evidence: new FakeEvidence("host") };
  const guest = { label: "guest", publicSeat: 1, evidence: new FakeEvidence("guest") };
  host.evidence.push(commandFrontierObservation(0, "watcher", "host-state"));
  guest.evidence.push(commandFrontierObservation(1, "owner", "guest-state"));
  assert.equal(findSharedCommandFrontierMatch(host, guest, { host: 0, guest: 0 }, null), null);

  guest.evidence.events[0].observation.stateDigest = "host-state";
  guest.evidence.events[0].observation.connectionGeneration += 1;
  assert.equal(findSharedCommandFrontierMatch(host, guest, { host: 0, guest: 0 }, null), null);
});

test("campaign reward leave cannot send confirm before both semantic confirmation projections exist", async () => {
  const order = [];
  const owner = {
    label: "owner",
    publicSeat: 0,
    evidence: new FakeEvidence("owner"),
    press: async key => order.push(`press:${key}`),
    waitForOwnedRewardConfirm: async () => {
      order.push("owner-confirm-ready");
      return { index: 17 };
    },
  };
  const watcher = {
    label: "watcher",
    publicSeat: 1,
    evidence: new FakeEvidence("watcher"),
    waitForAddressedRewardWatcher: async () => {
      order.push("watcher-confirm-ready");
      return { index: 19 };
    },
  };
  const rig = { clients: { owner, watcher }, config: { timeoutMs: 1_000 } };
  await driveConfirmedLeave(
    rig,
    { name: "reward", keys: ["Backspace", "Space"], confirmSurfaceId: "reward:confirm" },
    owner,
    { address: { epoch: 73, wave: 1, turn: 4 }, stateDigest: "settled" },
  );
  assert.deepEqual(order, ["press:Backspace", "owner-confirm-ready", "watcher-confirm-ready", "press:Space"]);
});

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
      selectedOptionId: "boy",
      optionIds: ["boy", "girl"],
      surfaceGeneration: 1,
      ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: false },
    },
  });

  assert.equal(findActionableFirstLoginGenderSurface(evidence, 0), evidence.events[1]);
});

for (const language of ["German", "French", "Japanese", "Arabic", "Cyrillic", "future locale"]) {
  test(`first-login gender readiness is semantic for ${language} option ids`, () => {
    const optionIds = ["boy", "girl"];
    const evidence = new FakeEvidence(`new-account-${language}`);
    evidence.push({
      kind: "browser-surface2",
      observation: {
        surfaceId: "option-select:SelectGenderPhase",
        phase: "SelectGenderPhase",
        phaseInstance: 3,
        uiMode: "OPTION_SELECT",
        seatsWithInput: [0],
        selectedOptionId: optionIds[0],
        optionIds,
        surfaceGeneration: 1,
        ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: false },
      },
    });

    assert.equal(findActionableFirstLoginGenderSurface(evidence, 0), evidence.events[0]);
  });
}

test("post-turn progress refreshes the stall watchdog until a separate absolute ceiling", () => {
  let nowMs = 1_000;
  const authority = { label: "authority", evidence: new FakeEvidence("authority") };
  const renderer = { label: "renderer", evidence: new FakeEvidence("renderer") };
  const rig = { clients: { authority, renderer } };
  const budget = createPublicBattleProgressBudget(rig, { authority: 0, renderer: 0 }, 100, {
    now: () => nowMs,
    progressAllowanceMs: 80,
    hardCeilingMs: 500,
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
  assert.equal(
    budget.observe(),
    1_340,
    "unique authority progress may extend beyond the former short total-time ceiling",
  );

  nowMs = 1_335;
  renderer.evidence.push({
    at: at(nowMs),
    kind: "console",
    text: "[coop:replay] guest replay turn=1: live increment seq=12..12",
  });
  assert.equal(budget.observe(), 1_415, "unique renderer progress refreshes the same stall watchdog");

  nowMs = 1_450;
  authority.evidence.push({
    at: at(nowMs),
    kind: "console",
    text: "[coop:turn] host recorder: append turn=1 seq=13 k=message total=14 live=true",
  });
  assert.equal(budget.observe(), 1_500, "causal progress remains capped by the absolute circuit breaker");
  assert.equal(budget.hardDeadline(), 1_500);
});

test("default post-turn watchdog survives the measured two-browser Explosion animation gap", () => {
  let nowMs = 1_000;
  const authority = { label: "authority", evidence: new FakeEvidence("authority") };
  const renderer = { label: "renderer", evidence: new FakeEvidence("renderer") };
  const rig = { clients: { authority, renderer } };
  const budget = createPublicBattleProgressBudget(rig, { authority: 0, renderer: 0 }, 1_000, {
    now: () => nowMs,
  });

  renderer.evidence.push({
    at: at(nowMs),
    kind: "browser-surface2",
    observation: {
      operationClass: "command",
      surfaceId: "command:watcher",
      phaseInstance: 26,
      ready: { awaitingActionInput: false },
    },
  });
  const refreshedDeadline = budget.observe();

  nowMs += 95_000;
  assert.ok(
    nowMs < refreshedDeadline,
    "run 29802798087's 94.35s causal gap must not expire the normal public post-turn watchdog",
  );
  assert.ok(refreshedDeadline < budget.hardDeadline(), "the immutable absolute ceiling remains independent");
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

test("retained continuation proves the exact Authority V2 turn retirement after cutover", async () => {
  const hostEvidence = new FakeEvidence("host");
  const guestEvidence = new FakeEvidence("guest");
  hostEvidence.push({
    kind: "console",
    text: "[coop:v2-turn] turn CUTOVER active role=authority",
  });
  hostEvidence.push({
    kind: "console",
    text:
      "[coop:v2-authority] receipt rev=17 op=TURN/e73/w1/t2 stage=controlInstalled "
      + "sender=1 generation=4 advanced retired=true waiting=[]",
  });
  guestEvidence.push({
    kind: "console",
    text: "guest ACK turn stage=continuationReady e=73 wave=1 turn=2 rev=91",
  });
  const host = { label: "host", evidence: hostEvidence };
  const guest = { label: "guest", evidence: guestEvidence };
  const rig = { host, guest, config: { timeoutMs: 0 } };

  assert.equal(
    await DuoPublicUiRig.prototype.assertRetainedContinuation.call(rig, { host: 0, guest: 0 }, "v2-turn"),
    "73:1:2:91",
  );
  assert.equal(hostEvidence.events.at(-1).side, "v2-retirement");
  assert.equal(
    hostEvidence.events.some(event => event.text?.includes("host RELEASE retained turn")),
    false,
    "the retired legacy carrier is not a second correctness oracle after V2 cutover",
  );
});

test("retained continuation keeps the exact legacy release oracle before V2 cutover", async () => {
  const hostEvidence = new FakeEvidence("host");
  const guestEvidence = new FakeEvidence("guest");
  hostEvidence.push({
    kind: "console",
    text: "host RELEASE retained turn after continuationReady key=73:1:2:91",
  });
  guestEvidence.push({
    kind: "console",
    text: "guest ACK turn stage=continuationReady e=73 wave=1 turn=2 rev=91",
  });
  const host = { label: "host", evidence: hostEvidence };
  const guest = { label: "guest", evidence: guestEvidence };
  const rig = { host, guest, config: { timeoutMs: 0 } };

  assert.equal(
    await DuoPublicUiRig.prototype.assertRetainedContinuation.call(rig, { host: 0, guest: 0 }, "legacy-turn"),
    "73:1:2:91",
  );
  assert.equal(hostEvidence.events.at(-1).side, "legacy-release");
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
    assertPresentationLedgerAtSharedCommand: async (_from, expectedAddress) => {
      assert.equal(expectedAddress, "73:1:2");
      order.push("presentation-proof");
    },
  };

  const result = await DuoPublicUiRig.prototype.driveSequentialCommandRound.call(
    rig,
    { first: 0, second: 0 },
    ["Space", "Space", "Space"],
    "turn-2",
  );

  assert.deepEqual(order, ["first", "presentation-proof", "second"]);
  assert.equal(firstEvidence.events.at(-1).kind, "sequential-command-proof");
  assert.equal(secondEvidence.events.at(-1).kind, "sequential-command-proof");
  assert.deepEqual(result.outcomeCursors, {
    first: firstEvidence.events.at(-1).index,
    second: secondEvidence.events.at(-1).index,
  });
  assert.equal(result.expectedCommandAddress, "73:1:2");
});

test("sequential command driver never resurrects a command surface superseded by presentation", async () => {
  const order = [];
  const firstEvidence = new FakeEvidence("first");
  const secondEvidence = new FakeEvidence("second");
  firstEvidence.push(ownedCommand(0));
  firstEvidence.push({
    kind: "browser-surface2",
    observation: {
      operationClass: "battle-progress",
      surfaceId: "battle:message",
      phase: "MoveEffectPhase",
      uiMode: "MESSAGE",
      address: { epoch: 73, wave: 1, turn: 2 },
      localSeat: 0,
      seatsWithInput: [0],
      ready: { handlerActive: true, awaitingActionInput: false },
    },
  });
  secondEvidence.push(ownedCommand(1));
  const first = {
    label: "first",
    publicSeat: 0,
    evidence: firstEvidence,
    checkpoint: async () => {},
    sequence: async () => {
      order.push("first");
    },
  };
  const second = {
    label: "second",
    publicSeat: 1,
    evidence: secondEvidence,
    checkpoint: async () => {},
    sequence: async () => {
      order.push("second");
      firstEvidence.push(ownedCommand(0));
    },
  };
  const rig = {
    clients: { first, second },
    config: { timeoutMs: 1_000 },
    assertPresentationLedgerAtSharedCommand: async () => order.push("presentation-proof"),
  };

  await DuoPublicUiRig.prototype.driveSequentialCommandRound.call(
    rig,
    { first: 0, second: 0 },
    ["Space"],
    "showdown-switch",
  );

  assert.deepEqual(order, ["second", "presentation-proof", "first"]);
});

test("target selection is admitted only while the exact owned picker is the current semantic surface", () => {
  const evidence = new FakeEvidence("owner");
  const client = { label: "owner", publicSeat: 1, evidence };
  const address = { epoch: 73, wave: 1, turn: 2 };
  evidence.push({
    kind: "browser-surface2",
    observation: {
      operationClass: "command",
      surfaceId: "command:target",
      ownerModel: "local",
      phase: "SelectTargetPhase",
      phaseInstance: 8,
      uiMode: "TARGET_SELECT",
      address,
      localSeat: 1,
      seatsWithInput: [1],
      selectedOptionId: "battle-target:2",
      optionIds: ["battle-target:2", "battle-target:3"],
      ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
    },
  });

  assert.equal(findOwnedActionableTargetSurface(client, 0, "73:1:2"), evidence.events[0]);
  assert.equal(findOwnedActionableTargetSurface(client, 0, "73:1:3"), null, "the address is fail-closed");

  evidence.push({
    kind: "browser-surface2",
    observation: {
      ...ownedCommand(1, address).observation,
      surfaceId: "battle:message",
      operationClass: "battle-progress",
      phase: "MovePhase",
      uiMode: "MESSAGE",
    },
  });
  assert.equal(
    findOwnedActionableTargetSurface(client, 0, "73:1:2"),
    null,
    "a closed picker cannot spend a delayed second key",
  );
});

test("sequential command driver resolves an animation-delayed target before waiting for the peer owner", async () => {
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
      order.push("first-command");
      firstEvidence.push({
        kind: "browser-surface2",
        observation: {
          operationClass: "command",
          surfaceId: "command:target",
          ownerModel: "local",
          phase: "SelectTargetPhase",
          phaseInstance: 9,
          uiMode: "TARGET_SELECT",
          address,
          localSeat: 0,
          seatsWithInput: [0],
          selectedOptionId: "battle-target:2",
          optionIds: ["battle-target:2", "battle-target:3"],
          ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
        },
      });
    },
    press: async key => {
      order.push(`first-target:${key}`);
      secondEvidence.push(ownedCommand(1, address));
    },
  };
  const second = {
    label: "second",
    publicSeat: 1,
    evidence: secondEvidence,
    checkpoint: async () => {},
    sequence: async () => {
      order.push("second-command");
    },
    press: async () => {},
  };
  const rig = {
    clients: { first, second },
    config: { timeoutMs: 1_000 },
    assertPresentationLedgerAtSharedCommand: async (_from, expectedAddress) => {
      assert.equal(expectedAddress, "73:1:2");
      order.push("presentation-proof");
    },
  };

  await DuoPublicUiRig.prototype.driveSequentialCommandRound.call(
    rig,
    { first: 0, second: 0 },
    ["Space", "Space", "Space"],
    "targeted-turn",
  );

  assert.deepEqual(order, ["first-command", "first-target:Space", "presentation-proof", "second-command"]);
  assert.equal(
    firstEvidence.events.some(event => event.kind === "semantic-target-selection-proof"),
    true,
  );
});

test("paired reward frontier supersedes a next-command wait before either owner opens", async () => {
  const firstEvidence = new FakeEvidence("first");
  const secondEvidence = new FakeEvidence("second");
  firstEvidence.push({ kind: "console", text: "Start Phase SelectModifierPhase" });
  secondEvidence.push({ kind: "console", text: "Start Phase SelectModifierPhase" });
  const unexpected = async () => {
    throw new Error("a structural reward must not spend a command key");
  };
  const first = {
    label: "first",
    publicSeat: 0,
    evidence: firstEvidence,
    checkpoint: async () => {},
    sequence: unexpected,
    press: unexpected,
  };
  const second = {
    label: "second",
    publicSeat: 1,
    evidence: secondEvidence,
    checkpoint: async () => {},
    sequence: unexpected,
    press: unexpected,
  };
  const rig = { clients: { first, second }, config: { timeoutMs: 1_000 } };

  const result = await DuoPublicUiRig.prototype.driveSequentialCommandRound.call(
    rig,
    { first: 0, second: 0 },
    ["Space", "Space", "Space"],
    "post-replacement-frontier",
  );

  assert.equal(result.commandEvents.first, undefined);
  assert.equal(result.commandEvents.second, undefined);
  assert.deepEqual(result.outcomeCursors, { first: 0, second: 0 });
  assert.equal(firstEvidence.events.at(-1).supersededBy, "reward");
  assert.equal(secondEvidence.events.at(-1).supersededBy, "reward");
});

test("sequential command driver accepts an exact-address collection close when the partner slot cannot act", async () => {
  const order = [];
  const address = { epoch: 73, wave: 1, turn: 2 };
  const firstEvidence = new FakeEvidence("first");
  const secondEvidence = new FakeEvidence("second");
  firstEvidence.push(ownedCommand(0, address));
  const first = {
    label: "first",
    publicRole: "host",
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
          localRole: "host",
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
  assert.equal(result.expectedCommandAddress, "73:1:2");
});

test("renderer presentation cannot close command collection before its delayed Showdown command", async () => {
  const order = [];
  const address = { epoch: 73, wave: 1, turn: 2 };
  const authorityEvidence = new FakeEvidence("authority");
  const rendererEvidence = new FakeEvidence("renderer");
  authorityEvidence.push(ownedCommand(0, address));
  const authority = {
    label: "authority",
    publicRole: "host",
    publicSeat: 0,
    evidence: authorityEvidence,
    checkpoint: async () => {},
    sequence: async () => {
      order.push("authority-command");
      authorityEvidence.push({
        kind: "browser-surface2",
        observation: {
          operationClass: "battle-progress",
          surfaceId: "battle:message",
          phase: "EnemyCommandPhase",
          localRole: "host",
          address,
        },
      });
      rendererEvidence.push({
        kind: "browser-surface2",
        observation: {
          operationClass: "battle-progress",
          surfaceId: "battle:message",
          phase: "MessagePhase",
          localRole: "guest",
          address,
        },
      });
      setTimeout(() => rendererEvidence.push(ownedCommand(1, address)), 10);
    },
  };
  const renderer = {
    label: "renderer",
    publicRole: "guest",
    publicSeat: 1,
    evidence: rendererEvidence,
    checkpoint: async () => {},
    sequence: async () => order.push("renderer-command"),
  };
  const rig = {
    clients: { authority, renderer },
    host: authority,
    guest: renderer,
    config: { timeoutMs: 1_000 },
    assertPresentationLedgerAtSharedCommand: async () => order.push("presentation-proof"),
  };

  const result = await DuoPublicUiRig.prototype.driveSequentialCommandRound.call(
    rig,
    { authority: 0, renderer: 0 },
    ["Space"],
    "showdown-entry",
  );

  assert.deepEqual(order, ["authority-command", "presentation-proof", "renderer-command"]);
  assert.equal(result.commandEvents.renderer?.observation.surfaceId, "command:command");
  assert.equal(rendererEvidence.events.at(-1).skippedAfterCollectionClosed, false);
});

test("exact-address reward closure skips a phantom owner without hiding the one-shot outcome", async () => {
  const order = [];
  const address = { epoch: 73, wave: 1, turn: 4 };
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
      secondEvidence.push({
        kind: "browser-surface2",
        observation: {
          operationClass: "reward",
          surfaceId: "reward-shop",
          phase: "SelectModifierPhase",
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
    "turn-4",
  );

  assert.deepEqual(order, ["first"]);
  assert.equal(result.commandEvents.second, undefined);
  assert.equal(result.outcomeCursors.second, 0, "the reward event remains inside the next outcome scan");
  const secondProof = secondEvidence.events.at(-1);
  assert.equal(secondProof.kind, "sequential-command-proof");
  assert.equal(secondProof.skippedAfterCollectionClosed, true);
  assert.equal(secondProof.collectionClosedObservedBy, "second");
  assert.equal(result.expectedCommandAddress, "73:1:4");
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
    text: `[coop:reward] reward op WATCHER materialize retained choice=-1 terminal=true id=${operationId}`,
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

test("post-replacement route classifies a fresh owned command frontier as a continuing wave", async () => {
  const host = { label: "host", publicSeat: 0, evidence: new FakeEvidence("host") };
  const guest = { label: "guest", publicSeat: 1, evidence: new FakeEvidence("guest") };
  host.evidence.push(ownedCommand(0));
  guest.evidence.push(ownedCommand(1));
  const rig = { clients: { host, guest }, config: { timeoutMs: 1_000 } };

  const route = await DuoPublicUiRig.prototype.classifyPostReplacementRoute.call(rig, { host: 0, guest: 0 });
  assert.equal(route, "continuing");
});

test("post-replacement route classifies both-seat SelectModifierPhase as a won wave", async () => {
  const host = { label: "host", publicSeat: 0, evidence: new FakeEvidence("host") };
  const guest = { label: "guest", publicSeat: 1, evidence: new FakeEvidence("guest") };
  host.evidence.push({ kind: "console", text: "%cStart Phase SelectModifierPhase color:green;" });
  guest.evidence.push({ kind: "console", text: "%cStart Phase SelectModifierPhase color:green;" });
  const rig = { clients: { host, guest }, config: { timeoutMs: 1_000 } };

  const route = await DuoPublicUiRig.prototype.classifyPostReplacementRoute.call(rig, { host: 0, guest: 0 });
  assert.equal(route, "won");
});

test("faint tail keeps a post-checkpoint one-shot command surface reachable from its floor (run 29880978259)", async () => {
  const hostEvidence = new FakeEvidence("host");
  const guestEvidence = new FakeEvidence("guest");
  const host = { label: "host", publicSeat: 0, evidence: hostEvidence, checkpoint: async () => {} };
  const guest = { label: "guest", publicSeat: 1, evidence: guestEvidence, checkpoint: async () => {} };
  // Faint detection: the owner's replacement picker is already open on the faint seat.
  guestEvidence.push(replacementPicker(1));
  const rig = {
    clients: { host, guest },
    activeBattleWave: 1,
    config: { timeoutMs: 1_000 },
    classifyPostReplacementRoute: DuoPublicUiRig.prototype.classifyPostReplacementRoute,
    async driveReplacement() {
      // The picker re-renders during the drive, THEN the continuing wave opens the one-shot turn-2
      // command surface on both seats, and only AFTER that does the slow replacement-applied
      // checkpoint land - exactly the ordering that made the raw post-drive cursor skip the command
      // surface in run 29880978259 (checkpoint event index > command surface index).
      guestEvidence.push(replacementPicker(1));
      guestEvidence.push(ownedCommand(1));
      hostEvidence.push(ownedCommand(0));
      guestEvidence.push({ kind: "checkpoint", name: "page-1-replacement-applied" });
      hostEvidence.push({ kind: "checkpoint", name: "page-1-replacement-applied" });
    },
  };

  const result = await DuoPublicUiRig.prototype.driveFaintReplacementTail.call(
    rig,
    { kind: "faint", client: guest },
    { host: 0, guest: 0 },
  );

  assert.equal(result.route, "continuing");
  // The regression guard: the floor must sit above the consumed picker yet below the one-shot
  // command surface, so both seats' turn-2 command surfaces stay reachable. A raw post-drive cursor
  // (the prior approach) would land past them because the checkpoint events were appended last.
  const hostCommand = hostEvidence.findLastSemanticSurface(result.floor.host, "command:command");
  const guestCommand = guestEvidence.findLastSemanticSurface(result.floor.guest, "command:command");
  assert.ok(hostCommand, "host turn-2 command surface must remain reachable from the post-faint floor");
  assert.ok(guestCommand, "guest turn-2 command surface must remain reachable from the post-faint floor");
});

test("faint tail drives the won-wave reward-to-wave-2 chain when the faint co-wins the wave", async () => {
  const hostEvidence = new FakeEvidence("host");
  const guestEvidence = new FakeEvidence("guest");
  const host = { label: "host", publicSeat: 0, evidence: hostEvidence, checkpoint: async () => {} };
  const guest = { label: "guest", publicSeat: 1, evidence: guestEvidence, checkpoint: async () => {} };
  guestEvidence.push(replacementPicker(1));
  const calls = [];
  const rig = {
    clients: { host, guest },
    host,
    guest,
    activeBattleWave: 1,
    config: { timeoutMs: 1_000 },
    classifyPostReplacementRoute: DuoPublicUiRig.prototype.classifyPostReplacementRoute,
    async driveReplacement() {
      guestEvidence.push(replacementPicker(1));
      // Won wave: both engines commit WAVE_ADVANCE -> SelectModifierPhase; NO turn-2 command opens.
      hostEvidence.push({ kind: "console", text: "%cStart Phase SelectModifierPhase color:green;" });
      guestEvidence.push({ kind: "console", text: "%cStart Phase SelectModifierPhase color:green;" });
    },
    async assertSharedSurface(surface, _floor, proofName, options) {
      calls.push(["assertSharedSurface", surface, proofName, options.expectedWave]);
    },
    async leaveRewardsAndReachWave2() {
      calls.push(["leaveRewardsAndReachWave2"]);
    },
  };

  const result = await DuoPublicUiRig.prototype.driveFaintReplacementTail.call(
    rig,
    { kind: "faint", client: guest },
    { host: 0, guest: 0 },
  );

  assert.equal(result.route, "won");
  assert.deepEqual(calls, [
    ["assertSharedSurface", "reward", "wave-1-won-faint-reward", 1],
    ["leaveRewardsAndReachWave2"],
  ]);
});
