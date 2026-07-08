/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #862 - wave-TYPE desync (testers gtgeli/duck-dodgers, wave 9, build mrbdf344).
//
// The ME PRESENCE roll depends on per-client PITY state (encounterSpawnChance),
// which diverges permanently after any one-sided ME anomaly: at the SAME wave 9
// with the SAME seed the host rolled a WILD battle while the guest rolled a
// MYSTERY ENCOUNTER, diverted into CoopReplayMePhase, and parked 20 minutes
// awaiting a presentation the host never sends (host meanwhile timed out its
// cmd:9:1 barrier and played alone).
//
// FIX (#862): the wave TYPE is host-authoritative. The host's wave-start
// enemyPartySync now ALWAYS states a verdict - the encounter type when it
// rolled an ME, the explicit COOP_WAVE_NO_ME sentinel otherwise - and the guest
// adopts it in BOTH directions (battle-scene wave-type gate + the
// MysteryEncounterPhase divert guard for a late-arriving verdict). This file
// pins the verdict TRANSPORT layer: the sentinel round-trips the wire and is
// distinguishable from "no sync received".
// =============================================================================

import { COOP_WAVE_NO_ME, CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

/** The loopback delivers on a queued task - flush before asserting. */
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("coop #862 - host-authoritative wave ME verdict", () => {
  it("a NO-ME wave-start sync records the explicit negative verdict on the guest", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStreamer = new CoopBattleStreamer(host);
    const guestStreamer = new CoopBattleStreamer(guest);
    hostStreamer.sendEnemyParty(9, [], COOP_WAVE_NO_ME);
    await flush();
    expect(guestStreamer.meTypeForWave(9)).toBe(COOP_WAVE_NO_ME);
  });

  it("an ME wave-start sync records the host's rolled type", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStreamer = new CoopBattleStreamer(host);
    const guestStreamer = new CoopBattleStreamer(guest);
    hostStreamer.sendEnemyParty(12, [], 47);
    await flush();
    expect(guestStreamer.meTypeForWave(12)).toBe(47);
  });

  it("no wave-start sync = undefined (distinguishable from the negative verdict)", () => {
    const { guest } = createLoopbackPair();
    const guestStreamer = new CoopBattleStreamer(guest);
    expect(guestStreamer.meTypeForWave(9)).toBeUndefined();
  });

  it("a verdict-SILENT mid-battle sync never overwrites: no false no-ME for an ME wave", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStreamer = new CoopBattleStreamer(host);
    const guestStreamer = new CoopBattleStreamer(guest);
    hostStreamer.sendEnemyParty(12, [], 47); // wave-start: ME verdict
    hostStreamer.sendEnemyParty(12, []); // mid-battle sync (command-phase/runtime sites pass no verdict)
    await flush();
    expect(guestStreamer.meTypeForWave(12)).toBe(47);
  });
});
