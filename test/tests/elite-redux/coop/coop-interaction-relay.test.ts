/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op alternating-interaction relay (#633). Same seed -> both clients generate the
// IDENTICAL reward/shop/ME pool, so only the OWNER's CHOICE crosses the wire and the
// WATCHER applies the same index to its own pool. Verified over a LoopbackTransport:
// FIFO per-interaction delivery (multi-buy shops), race buffering, timeout->null, and
// stale-seq isolation.

import {
  COOP_DEX_SYNC_SEQ,
  COOP_INTERACTION_LEAVE,
  CoopInteractionRelay,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { COOP_NO_FAULT_PROFILE, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { describe, expect, it } from "vitest";

describe("co-op alternating-interaction relay (#633)", () => {
  it("delivers the owner's choice to a parked watcher (reward pick)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    const awaited = watcher.awaitInteractionChoice(0);
    owner.sendInteractionChoice(0, "reward", 2);

    const res = await awaited;
    expect(res).not.toBeNull();
    expect(res?.choice).toBe(2);
    expect(res?.data).toBeUndefined();
  });

  it("admits only an exact V2 quiz presentation observation while raw authority choices stay suppressed", async () => {
    const { host, guest } = createLoopbackPair();
    const operationId = "7:0:680000005000:QUIZ_ANSWER";
    const owner = new CoopInteractionRelay(host, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => true,
    });
    const watcher = new CoopInteractionRelay(guest, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => false,
      validateV2QuizAnswerObservation: input =>
        input.seq === 8_500_000 && input.choice === 2 && input.questionIndex === 0 && input.operationId === operationId,
    });

    const awaited = watcher.awaitInteractionChoice(8_500_000, undefined, ["quizAns"]);
    owner.sendInteractionChoice(8_500_000, "quizAns", 2, [0]);
    host.send({
      t: "interactionChoice",
      seq: 8_500_000,
      kind: "quizAns",
      choice: 2,
      data: [0],
      cosmeticOperationId: `${operationId}:forged`,
    });
    expect(owner.sendV2QuizAnswerObservation(8_500_000, 2, 0, operationId)).toBe(true);

    await expect(awaited).resolves.toEqual({
      choice: 2,
      data: [0],
      kind: "quizAns",
      operationId,
      rewardSurface: undefined,
    });
  });

  it("carries only exact account-local dexSync telemetry outside the V2 mechanical log", async () => {
    const { host, guest } = createLoopbackPair();
    const timer: { fire?: () => void } = {};
    const received: string[] = [];
    const authorityReceived: string[] = [];
    guest.onMessage(msg => {
      if (msg.t === "interactionOutcome") {
        received.push(msg.outcome.k);
      }
    });
    host.onMessage(msg => {
      if (msg.t === "interactionOutcome") {
        authorityReceived.push(msg.outcome.k);
      }
    });
    const owner = new CoopInteractionRelay(host, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => true,
    });
    const watcher = new CoopInteractionRelay(guest, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => false,
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    owner.sendInteractionOutcome(COOP_DEX_SYNC_SEQ, "dexSync", { k: "dexSync", dex: "account-merge" });
    owner.sendInteractionOutcome(0, "reward", { k: "leave" });
    owner.sendInteractionOutcome(COOP_DEX_SYNC_SEQ, "reward", { k: "dexSync", dex: "wrong-kind" });
    owner.sendInteractionOutcome(0, "dexSync", { k: "dexSync", dex: "wrong-address" });
    watcher.sendInteractionOutcome(COOP_DEX_SYNC_SEQ, "dexSync", { k: "dexSync", dex: "forged-replica" });
    watcher.sendInteractionOutcome(0, "reward", { k: "leave" });
    await Promise.resolve();

    expect(received).toEqual(["dexSync"]);
    expect(authorityReceived).toEqual([]);
    expect(watcher.hasBufferedInteractionOutcomeFor(COOP_DEX_SYNC_SEQ)).toBe(false);
    const legacyWait = watcher.awaitInteractionOutcome(COOP_DEX_SYNC_SEQ, 1);
    timer.fire?.();
    await expect(legacyWait).resolves.toBeNull();
  });

  it("delivers a multi-pick shop sequence FIFO, ending in the leave sentinel", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    // Owner buys slot 5 (onto party mon 1), then slot 2, then leaves - all one interaction.
    owner.sendInteractionChoice(3, "biomeShop", 5, [1]);
    owner.sendInteractionChoice(3, "biomeShop", 2);
    owner.sendInteractionChoice(3, "biomeShop", COOP_INTERACTION_LEAVE);
    await new Promise(r => setTimeout(r, 0)); // let them buffer

    const first = await watcher.awaitInteractionChoice(3);
    expect(first?.choice).toBe(5);
    expect(first?.data).toEqual([1]);
    const second = await watcher.awaitInteractionChoice(3);
    expect(second?.choice).toBe(2);
    const third = await watcher.awaitInteractionChoice(3);
    expect(third?.choice).toBe(COOP_INTERACTION_LEAVE);
  });

  it("drops retained proposal retries before they can resolve the next same-sequence shop waiter", async () => {
    const { host, guest } = createLoopbackPair();
    const violations: string[] = [];
    const owner = new CoopInteractionRelay(guest, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => false,
    });
    const authority = new CoopInteractionRelay(host, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => true,
      onV2AuthorityProposalViolation: reason => violations.push(reason),
    });
    const firstOperationId = "1:1:300:REWARD";
    const secondOperationId = "1:1:301:REWARD";

    const firstWait = authority.awaitInteractionChoice(3, 1_000, ["lock"]);
    owner.sendInteractionChoice(3, "lock", 0, [3], undefined, firstOperationId);
    await expect(firstWait).resolves.toMatchObject({ operationId: firstOperationId, choice: 0, data: [3] });

    // Model a result delayed past several 250 ms proposal-lease retries. None
    // may enter the FIFO that the next action on this same shop sequence uses.
    owner.sendInteractionChoice(3, "lock", 0, [3], undefined, firstOperationId);
    owner.sendInteractionChoice(3, "lock", 0, [3], undefined, firstOperationId);
    owner.sendInteractionChoice(3, "lock", 0, [3], undefined, firstOperationId);
    await Promise.resolve();

    const nextWait = authority.awaitInteractionChoice(3, 1_000, ["lock"]);
    let nextSettled = false;
    void nextWait.then(() => {
      nextSettled = true;
    });
    await Promise.resolve();
    expect(nextSettled).toBe(false);

    // A second real human action may be byte-identical but has the next stable
    // operation ID, so it remains distinguishable from retries and is admitted.
    owner.sendInteractionChoice(3, "lock", 0, [3], undefined, secondOperationId);
    await expect(nextWait).resolves.toMatchObject({ operationId: secondOperationId, choice: 0, data: [3] });
    expect(violations).toEqual([]);
  });

  it("fails closed when one V2 proposal ID is reused with conflicting payload", async () => {
    const { host, guest } = createLoopbackPair();
    const violations: string[] = [];
    const owner = new CoopInteractionRelay(guest, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => false,
    });
    const authority = new CoopInteractionRelay(host, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => true,
      onV2AuthorityProposalViolation: reason => violations.push(reason),
    });
    const operationId = "1:1:300:REWARD";

    const firstWait = authority.awaitInteractionChoice(3, 1_000, ["reward"]);
    owner.sendInteractionChoice(3, "reward", 0, [0], undefined, operationId);
    await expect(firstWait).resolves.toMatchObject({ operationId, choice: 0, data: [0] });

    owner.sendInteractionChoice(3, "reward", 1, [0], undefined, operationId);
    await Promise.resolve();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("conflict");
  });

  it("fails the guest locally instead of sending an unidentified V2 proposal", async () => {
    const { host, guest } = createLoopbackPair();
    const timer: { fire?: () => void } = {};
    const guestViolations: string[] = [];
    const authorityViolations: string[] = [];
    const owner = new CoopInteractionRelay(guest, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => false,
      onV2AuthorityProposalViolation: reason => guestViolations.push(reason),
    });
    const authority = new CoopInteractionRelay(host, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => true,
      onV2AuthorityProposalViolation: reason => authorityViolations.push(reason),
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    const wait = authority.awaitInteractionChoice(3, 1, ["reward"]);
    owner.sendInteractionChoice(3, "reward", 0, [0]);
    await Promise.resolve();

    expect(guestViolations).toHaveLength(1);
    expect(guestViolations[0]).toContain("missing a valid immutable operation ID");
    expect(authorityViolations).toEqual([]);
    timer.fire?.();
    await expect(wait).resolves.toBeNull();
  });

  it("fails authority before FIFO admission when a peer forges an unidentified V2 proposal", async () => {
    const { host, guest } = createLoopbackPair();
    const timer: { fire?: () => void } = {};
    const violations: string[] = [];
    const authority = new CoopInteractionRelay(host, {
      isInteractionAuthorityV2: () => true,
      isLocalAuthority: () => true,
      onV2AuthorityProposalViolation: reason => violations.push(reason),
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    const wait = authority.awaitInteractionChoice(3, 1, ["reward"]);
    guest.send({ t: "interactionChoice", seq: 3, kind: "reward", choice: 0, data: [0] });
    await Promise.resolve();

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("unidentified guest proposal");
    timer.fire?.();
    await expect(wait).resolves.toBeNull();
  });

  it("deduplicates journal-first then raw interaction-choice carriers", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const timer: { fire?: () => void } = {};
    const watcher = new CoopInteractionRelay(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    watcher.materializeCommittedInteractionChoice(8, "abilityPicker", -3, [11], "1:0:800");
    owner.sendInteractionChoice(8, "abilityPicker", -3, [11]);
    expect((await watcher.awaitInteractionChoice(8))?.data).toEqual([11]);
    const echo = watcher.awaitInteractionChoice(8, 1);
    timer.fire?.();
    expect(await echo).toBeNull();
  });

  it("deduplicates raw-first then journal interaction-choice carriers", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const timer: { fire?: () => void } = {};
    const watcher = new CoopInteractionRelay(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    owner.sendInteractionChoice(9, "abilityPicker", -3, [12, 2]);
    await Promise.resolve();
    watcher.materializeCommittedInteractionChoice(9, "abilityPicker", -3, [12, 2], "1:0:900");
    expect((await watcher.awaitInteractionChoice(9))?.data).toEqual([12, 2]);
    const echo = watcher.awaitInteractionChoice(9, 1);
    timer.fire?.();
    expect(await echo).toBeNull();
  });

  it("times out to null so the watcher never hangs, then leaves", async () => {
    const { guest } = createLoopbackPair();
    const timer: { fire?: () => void } = {};
    const watcher = new CoopInteractionRelay(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    const awaited = watcher.awaitInteractionChoice(1, 1000);
    expect(timer.fire).toBeDefined();
    timer.fire?.();
    expect(await awaited).toBeNull();
  });

  it("a choice for a DIFFERENT interaction seq does not satisfy the wait", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const timer: { fire?: () => void } = {};
    const watcher = new CoopInteractionRelay(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    // Owner sends a choice for interaction 4; the watcher is waiting on interaction 5.
    owner.sendInteractionChoice(4, "me", 0);
    const awaited = watcher.awaitInteractionChoice(5, 1000);
    await new Promise(r => setTimeout(r, 0));
    timer.fire?.();
    expect(await awaited).toBeNull();
  });

  it("routes same-pin reward choices only to their exact ordered Mystery surface", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);
    const firstSurface = { surfaceId: "modifier:me:graves:0", ordinal: 0 } as const;
    const secondSurface = { surfaceId: "modifier:me:graves:1", ordinal: 1 } as const;

    owner.sendInteractionChoice(12, "reward", COOP_INTERACTION_LEAVE, undefined, firstSurface);
    owner.sendInteractionChoice(12, "reward", 0, [0], secondSurface);
    await Promise.resolve();

    expect(
      await watcher.awaitInteractionChoice(12, 1000, ["reward"], secondSurface),
      "surface B skips a buffered surface-A terminal even though seq and kind match",
    ).toMatchObject({ choice: 0, rewardSurface: secondSurface });
    expect(await watcher.awaitInteractionChoice(12, 1000, ["reward"], firstSurface)).toMatchObject({
      choice: COOP_INTERACTION_LEAVE,
      rewardSurface: firstSurface,
    });
  });

  // Fix #2 (#633): the OWNER host-streams its rolled reward-option list so the WATCHER
  // rebuilds it instead of re-rolling (party luck would diverge the pools + the RNG cursor).
  describe("reward-option streaming (#633 Fix #2)", () => {
    const options = [
      { id: "RARE_CANDY", tier: 1, upgradeCount: 0, cost: 0 },
      { id: "TM_NORMAL", tier: 2, upgradeCount: 1, cost: 0, pregenArgs: [33] },
    ];

    it("delivers the owner's rolled option list to a parked watcher", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      const awaited = watcher.awaitRewardOptions(7, 0);
      owner.sendRewardOptions(7, 0, options);

      const res = await awaited;
      expect(res).toEqual(options);
    });

    it("buffers options that arrive before the watcher awaits (race fix)", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);

      owner.sendRewardOptions(7, 0, options);
      await new Promise(r => setTimeout(r, 0)); // let it buffer
      const res = await watcher.awaitRewardOptions(7, 0);
      expect(res).toEqual(options);
    });

    it("carries the concrete market subclass and exact stock beside the option pool", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);
      const projection = { marketKind: "black-market" as const, remainingStock: [2, 1] };

      owner.sendRewardOptions(7, 777, options, undefined, projection);
      await new Promise(r => setTimeout(r, 0));

      expect(await watcher.awaitRewardOptions(7, 777)).toEqual(options);
      expect(watcher.consumeRewardOptionsProjection(7, 777)).toEqual(projection);
    });

    it("drops a partial or stock-mismatched market projection instead of adopting guessed stock", async () => {
      const { host, guest } = createLoopbackPair();
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });
      const awaited = watcher.awaitRewardOptions(7, 777, 1000);

      host.send({
        t: "rewardOptions",
        seq: 7,
        reroll: 777,
        options,
        marketKind: "exotic",
        remainingStock: [1],
      });
      await new Promise(r => setTimeout(r, 0));
      timer.fire?.();

      expect(await awaited).toBeNull();
      expect(watcher.consumeRewardOptionsProjection(7, 777)).toBeNull();
    });

    it("re-requests and recovers the exact cached owner options when the first stream frame is lost", async () => {
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 81017 });
      const owner = new CoopInteractionRelay(pair.host);
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(pair.guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });

      pair.armNextDrop("rewardOptions", "host");
      owner.sendRewardOptions(8, 0, options);
      const awaited = watcher.awaitRewardOptions(8, 0, 1000);
      await new Promise(r => setTimeout(r, 0));
      timer.fire?.();

      expect(await awaited).toEqual(options);
      expect(pair.counters.host.oneShotDropped).toBe(1);
    });

    it("keys options by (seq, reroll) - a different reroll round does not satisfy the wait", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });

      // Owner streams the reroll-0 list; the watcher is waiting on reroll 1.
      owner.sendRewardOptions(7, 0, options);
      const awaited = watcher.awaitRewardOptions(7, 1, 1000);
      await new Promise(r => setTimeout(r, 0));
      timer.fire?.();
      expect(await awaited).toBeNull();
    });

    it("does not alias two ordered ME surfaces at the same seq and reroll", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });
      const firstSurface = { surfaceId: "modifier:me:graves:0", ordinal: 0 } as const;
      const secondSurface = { surfaceId: "modifier:me:graves:1", ordinal: 1 } as const;

      owner.sendRewardOptions(7, 0, options, firstSurface);
      await new Promise(r => setTimeout(r, 0));
      const wrongSurface = watcher.awaitRewardOptions(7, 0, 1000, secondSurface);
      timer.fire?.();
      expect(await wrongSurface).toBeNull();
      expect(await watcher.awaitRewardOptions(7, 0, 1000, firstSurface)).toEqual(options);
    });

    it("returns the exact ordered surface key when a reconnect installs its listener after buffering", async () => {
      const { host, guest } = createLoopbackPair();
      const owner = new CoopInteractionRelay(host);
      const watcher = new CoopInteractionRelay(guest);
      const rewardSurface = { surfaceId: "modifier:me:graves:0", ordinal: 0 } as const;

      owner.sendRewardOptions(7, 0, options, rewardSurface);
      await new Promise(r => setTimeout(r, 0));

      expect(watcher.bufferedRewardOptionsKeyFor("7:")).toBe("7:0:0:modifier%3Ame%3Agraves%3A0");
    });

    it("drops a malformed ordered surface before it can satisfy an option waiter", async () => {
      const { host, guest } = createLoopbackPair();
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });
      const expectedSurface = { surfaceId: "modifier:me:graves:0", ordinal: 0 } as const;
      const awaited = watcher.awaitRewardOptions(7, 0, 1000, expectedSurface);

      host.send({
        t: "rewardOptions",
        seq: 7,
        reroll: 0,
        options,
        rewardSurface: { surfaceId: "Modifier 0", ordinal: 0 },
      });
      await new Promise(r => setTimeout(r, 0));
      timer.fire?.();
      expect(await awaited).toBeNull();
    });

    it("times out to null so the caller can fail closed without using a local roll", async () => {
      const { guest } = createLoopbackPair();
      const timer: { fire?: () => void } = {};
      const watcher = new CoopInteractionRelay(guest, {
        schedule: cb => {
          timer.fire = cb;
          return () => {};
        },
      });

      const awaited = watcher.awaitRewardOptions(2, 0, 1000);
      expect(timer.fire).toBeDefined();
      timer.fire?.();
      expect(await awaited).toBeNull();
    });
  });
});
