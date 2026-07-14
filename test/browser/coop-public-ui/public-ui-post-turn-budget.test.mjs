/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createPublicBattleProgressBudget, PublicUiClient } from "./public-ui-harness.mjs";

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
}

function at(ms) {
  return new Date(ms).toISOString();
}

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
