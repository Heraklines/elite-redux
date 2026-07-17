/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op (#633 B9c) ER ability-picker outcome relay - wire round-trip.
//
// THE LIVE BUG: a player uses an ER ability item (Ability Capsule / Greater Ability Capsule /
// Greater Ability Randomizer) in the co-op reward shop. BOTH clients ran the picker phase and
// opened their OWN ability picker, picked independently -> diverged -> the watcher hung awaiting
// reward options the (already-advanced) owner never sent = SHOP SOFTLOCK.
//
// THE FIX: only the shop OWNER drives the picker + rolls RNG, then relays the resolved OUTCOME on
// the shop's pinned interaction seq via the SAME `interactionChoice` channel as reward picks. The
// WATCHER never opens a picker (and the randomizer watcher never rolls RNG) - it awaits the owner's
// literal outcome and applies it. EVERY owner end-path (commit OR any cancel/guard) relays an
// outcome (CANCEL when nothing committed), so the watcher never stalls.
//
// This suite proves the FIVE committed outcome payloads + the CANCEL sentinel survive the relay
// (owner.sendInteractionChoice -> watcher.awaitInteractionChoice) byte-identical, that the wire
// `interactionChoice` message survives a raw JSON round-trip, and that the COOP_ABILITY_OUTCOME
// `choice` sentinel stays distinct from the reward-shop LEAVE/REROLL sentinels (so the shop's
// watch loop can never misread an ability outcome as a reward pick).

import {
  adoptAbilityWatcherOutcome,
  captureCoopAbilityOperationBinding,
  resetCoopAbilityOperationFlag,
  resetCoopAbilityOutcomeRetryMs,
  setCoopAbilityOperationEnabled,
  setCoopAbilityOutcomeRetryMs,
} from "#data/elite-redux/coop/coop-ability-operation";
import {
  COOP_ABILITY_KIND,
  COOP_ABILITY_OP,
  COOP_ABILITY_OUTCOME,
  coopAbilityPickerSeq,
  sendCoopAbilityPickerOutcome,
} from "#data/elite-redux/coop/coop-ability-picker-relay";
import {
  COOP_INTERACTION_LEAVE,
  COOP_INTERACTION_REROLL,
  CoopInteractionRelay,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { assembleCoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { afterEach, describe, expect, it } from "vitest";

// The reward-shop interaction seq the OWNER is pinned to (the seq the shop watch loop awaits).
const SHOP_SEQ = 42;
const GUEST_SHOP_SEQ = 43;
// The DEDICATED seq the ability outcome actually rides - the shop loop never awaits this, so it can
// never steal the outcome (the BLOCKING bug the review caught). The picker phases use exactly this.
const SEQ = coopAbilityPickerSeq(SHOP_SEQ);

// The reward-shop action codes the shop loop's applyRelayedRewardAction dispatches on (data[0]).
// The ability op codes MUST stay clear of these so a misrouted outcome can't masquerade as a
// reward buy/transfer/lock. (Kept in sync with select-modifier-phase.ts COOP_ACT_*.)
const COOP_ACT_CODES = [0, 1, 2, 3];

// Every outcome the owner can commit, plus the default CANCEL. data[0] is the op; the rest is the
// per-op payload. These are the EXACT arrays the picker phases set on this.coopOutcome.
const OUTCOMES: { name: string; data: number[] }[] = [
  { name: "CANCEL (any cancel / guard / mon-vanished)", data: [COOP_ABILITY_OP.CANCEL] },
  { name: "Capsule: cycle active ability", data: [COOP_ABILITY_OP.CAP_CYCLE] },
  { name: "Capsule: run-unlock innate slot 2", data: [COOP_ABILITY_OP.CAP_RUNUNLOCK, 2] },
  { name: "Greater Capsule: permanently unlock innate slot 1", data: [COOP_ABILITY_OP.GCAP_PERM, 1] },
  { name: "Greater Capsule: run-unlock two innate slots", data: [COOP_ABILITY_OP.GCAP_RUN2, 1, 3] },
  // The randomizer relays the host's LITERAL rolled abilityId (a large enum value) - the watcher
  // applies it WITHOUT re-rolling, so this exact number must survive the wire.
  { name: "Greater Randomizer: slot 0 <- abilityId 261", data: [COOP_ABILITY_OP.GRAND, 0, 261] },
];

describe("co-op ER ability-picker outcome relay (#633 B9c) - wire round-trip", () => {
  afterEach(() => {
    resetCoopAbilityOutcomeRetryMs();
    resetCoopAbilityOperationFlag();
    clearCoopRuntime();
  });

  it("the COOP_ABILITY_OUTCOME sentinel is distinct from every reward cursor + LEAVE/REROLL", () => {
    // A reward/shop cursor is always >= 0; the ability sentinel must be a unique negative value so
    // the shop's watch loop can never confuse a relayed ability outcome with a reward pick.
    expect(COOP_ABILITY_OUTCOME).toBeLessThan(0);
    expect(COOP_ABILITY_OUTCOME).not.toBe(COOP_INTERACTION_LEAVE);
    expect(COOP_ABILITY_OUTCOME).not.toBe(COOP_INTERACTION_REROLL);
  });

  it("the op codes are all distinct (a misrouted outcome can never alias another op)", () => {
    const codes = Object.values(COOP_ABILITY_OP);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("the op codes never alias the reward-shop action codes COOP_ACT_* (de-alias, defense-in-depth)", () => {
    // Before the fix CANCEL/CYCLE/RUNUNLOCK/GCAP_PERM were 0..3 == REWARD/SHOP/TRANSFER/LOCK, so a
    // misrouted outcome replayed as a phantom buy/transfer/lock. Now all op codes are clear of 0..3.
    for (const code of Object.values(COOP_ABILITY_OP)) {
      expect(COOP_ACT_CODES).not.toContain(code);
    }
  });

  it("rides a DEDICATED seq the shop loop never reads (channel isolation - the BLOCKING fix)", async () => {
    // The derived seq must differ from the raw shop seq the reward-shop watch loop awaits...
    expect(SEQ).not.toBe(SHOP_SEQ);

    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    // The shop loop (modelled here) parks on the RAW shop seq; the picker parks on the DERIVED seq.
    let shopLoopGotOutcome = false;
    void watcher.awaitInteractionChoice(SHOP_SEQ).then(() => {
      shopLoopGotOutcome = true;
    });
    const pickerAwait = watcher.awaitInteractionChoice(SEQ);

    // Owner relays the ability outcome on the DERIVED seq (exactly as relayEnd does).
    owner.sendInteractionChoice(SEQ, COOP_ABILITY_KIND, COOP_ABILITY_OUTCOME, [COOP_ABILITY_OP.CAP_CYCLE]);

    const picked = await pickerAwait;
    expect(picked?.data).toEqual([COOP_ABILITY_OP.CAP_CYCLE]); // the picker (derived seq) gets it...
    expect(shopLoopGotOutcome).toBe(false); // ...and the shop loop (raw seq) NEVER sees it.
  });

  it.each(OUTCOMES)("delivers '$name' to a parked watcher byte-identical", async ({ data }) => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    // Watcher parks on the shop seq (exactly as the picker phase's coopApplyRelayedOutcome does).
    const awaited = watcher.awaitInteractionChoice(SEQ);
    // Owner relays the resolved outcome (exactly as the picker phase's relayEnd does).
    owner.sendInteractionChoice(SEQ, COOP_ABILITY_KIND, COOP_ABILITY_OUTCOME, data);

    const res = await awaited;
    expect(res).not.toBeNull();
    expect(res?.choice).toBe(COOP_ABILITY_OUTCOME);
    expect(res?.data).toEqual(data);
  });

  it.each(OUTCOMES)("the wire interactionChoice for '$name' survives a raw JSON round-trip", ({ data }) => {
    const msg: CoopMessage = {
      t: "interactionChoice",
      seq: SEQ,
      kind: COOP_ABILITY_KIND,
      choice: COOP_ABILITY_OUTCOME,
      data,
    };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });

  it("a CANCEL outcome relays just like a commit (the watcher always resolves, never stalls)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    // The owner cancels (or hits a guard) -> relays CANCEL on the same seq the watcher awaits.
    const awaited = watcher.awaitInteractionChoice(SEQ);
    owner.sendInteractionChoice(SEQ, COOP_ABILITY_KIND, COOP_ABILITY_OUTCOME, [COOP_ABILITY_OP.CANCEL]);

    const res = await awaited;
    expect(res?.choice).toBe(COOP_ABILITY_OUTCOME);
    expect(res?.data?.[0]).toBe(COOP_ABILITY_OP.CANCEL);
  });

  it("keeps the pure legacy abilityPicker carrier working when the operation flag is off", async () => {
    setCoopAbilityOperationEnabled(false);
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);
    const awaited = watcher.awaitInteractionChoice(SEQ);

    sendCoopAbilityPickerOutcome(owner, SHOP_SEQ, [COOP_ABILITY_OP.CAP_CYCLE], {
      localRole: "host",
      wave: 1,
    });

    expect((await awaited)?.data).toEqual([COOP_ABILITY_OP.CAP_CYCLE]);
  });

  it("DURABILITY: dropping only abilityPicker still materializes the committed outcome for the guest", async () => {
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === COOP_ABILITY_KIND,
      },
      { seed: 0xab1117 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopAbilityOperationBinding();
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopAbilityOperationBinding();
    setCoopRuntime(hostRuntime);

    sendCoopAbilityPickerOutcome(
      hostRuntime.interactionRelay,
      SHOP_SEQ,
      [COOP_ABILITY_OP.CAP_RUNUNLOCK, 2],
      {
        localRole: "host",
        wave: 1,
      },
      hostBinding,
    );
    const outcome = await guestRuntime.interactionRelay.awaitInteractionChoice(SEQ, 25);

    expect(pair.faultsInjected(), "the raw abilityPicker carrier was actually dropped").toBe(1);
    expect(outcome?.data, "the committed outcome reached the real guest choice FIFO").toEqual([
      COOP_ABILITY_OP.CAP_RUNUNLOCK,
      2,
    ]);
    expect(
      adoptAbilityWatcherOutcome(
        {
          pinned: SHOP_SEQ,
          data: outcome?.data ?? null,
          localRole: "guest",
          wave: 1,
        },
        guestBinding,
      ),
      "the watcher phase admits the journal-materialized result through its ledger gate",
    ).toBe(true);
  });

  it("EXACTLY ONCE: the journal and raw carriers produce only one consumable ability action", async () => {
    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopAbilityOperationBinding();
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopAbilityOperationBinding();
    setCoopRuntime(hostRuntime);
    const firstAwait = guestRuntime.interactionRelay.awaitInteractionChoice(SEQ, 25);

    sendCoopAbilityPickerOutcome(
      hostRuntime.interactionRelay,
      SHOP_SEQ,
      [COOP_ABILITY_OP.CAP_CYCLE],
      {
        localRole: "host",
        wave: 1,
      },
      hostBinding,
    );

    const first = await firstAwait;
    expect(first?.data).toEqual([COOP_ABILITY_OP.CAP_CYCLE]);
    expect(
      adoptAbilityWatcherOutcome(
        {
          pinned: SHOP_SEQ,
          data: first?.data ?? null,
          localRole: "guest",
          wave: 1,
        },
        guestBinding,
      ),
    ).toBe(true);
    expect(
      await guestRuntime.interactionRelay.awaitInteractionChoice(SEQ, 10),
      "the second carrier is an echo, not a second purchase",
    ).toBeNull();
  });

  it("INTENT RECOVERY: a dropped guest-owned abilityPicker is resent until the host commits it", async () => {
    setCoopAbilityOutcomeRetryMs(10);
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 0,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === COOP_ABILITY_KIND,
      },
      { seed: 0xab1118 },
    );
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    const guestSeq = coopAbilityPickerSeq(GUEST_SHOP_SEQ);
    const data = [COOP_ABILITY_OP.GRAND, 1, 261];
    pair.armNextDrop("interactionChoice", "guest");
    const hostAwait = hostRuntime.interactionRelay.awaitInteractionChoice(guestSeq, 100);

    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopAbilityOperationBinding();
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopAbilityOperationBinding();
    sendCoopAbilityPickerOutcome(
      guestRuntime.interactionRelay,
      GUEST_SHOP_SEQ,
      data,
      {
        localRole: "guest",
        wave: 1,
      },
      guestBinding,
    );
    setCoopRuntime(hostRuntime);

    const action = await hostAwait;
    expect(pair.faultsInjected(), "the first guest intent was actually dropped").toBe(1);
    expect(action?.data, "the resend reached the host authority").toEqual(data);
    expect(
      adoptAbilityWatcherOutcome(
        {
          pinned: GUEST_SHOP_SEQ,
          data: action?.data ?? null,
          localRole: "host",
          wave: 1,
        },
        hostBinding,
      ),
      "the host authority committed the guest-owned result",
    ).toBe(true);
  });

  it("ASYNC BINDING: a guest materializes two host picks while the host remains ambient", async () => {
    const pair = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(pair.host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(pair.guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopAbilityOperationBinding();
    setCoopRuntime(guestRuntime);
    const guestBinding = captureCoopAbilityOperationBinding();

    // Model a Phaser watcher continuation: the guest captured its binding before awaiting, but another
    // client is the process-wide ambient runtime by the time the promise resumes.
    setCoopRuntime(hostRuntime);
    for (const data of [[COOP_ABILITY_OP.CAP_CYCLE], [COOP_ABILITY_OP.CAP_RUNUNLOCK, 2]]) {
      const awaited = guestRuntime.interactionRelay.awaitInteractionChoice(SEQ, 25);
      sendCoopAbilityPickerOutcome(
        hostRuntime.interactionRelay,
        SHOP_SEQ,
        data,
        { localRole: "host", wave: 1 },
        hostBinding,
      );
      const action = await awaited;
      expect(action?.data).toEqual(data);
      expect(
        adoptAbilityWatcherOutcome(
          {
            pinned: SHOP_SEQ,
            data: action?.data ?? null,
            localRole: "guest",
            wave: 1,
          },
          guestBinding,
        ),
      ).toBe(true);
      expect(
        adoptAbilityWatcherOutcome(
          {
            pinned: SHOP_SEQ,
            data: action?.data ?? null,
            localRole: "guest",
            wave: 1,
          },
          guestBinding,
        ),
        "the receiving runtime owns its own exactly-once cursor",
      ).toBe(false);
    }
  });
});
