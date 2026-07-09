/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #867 - wave WILD-vs-TRAINER desync (god-leg soak seed 20260709, wave 42-43).
//
// The guest re-derived the wave TYPE via BattleScene.isWaveTrainer - an
// arena-trainerChance / biome-overstay / seeded roll that DIVERGES from the host
// once the guest's arena/overstay state drifts. At wave 43 the host was on a
// TRAINER battle (battleType=1) while the guest self-derived WILD (battleType=0):
// the saveDataDigest (which hashes currentBattle.battleType) split, tripping a
// per-turn checksum MISMATCH + a stateSync heal every turn (soak 4 assertions),
// and a "wild"-thinking guest mishandled the trainer's mid-battle send-outs.
//
// FIX (#867): the wave TYPE is host-authoritative, exactly like the #862 ME
// verdict. The host's wave-start enemyPartySync now ALSO states its battleType,
// and the guest ADOPTS it in newBattle (handleNonFixedBattle) instead of rolling
// isWaveTrainer. This file pins the verdict TRANSPORT layer: the battleType
// round-trips the wire and is distinguishable from "no sync received".
// =============================================================================

import { COOP_WAVE_NO_ME, CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattleType } from "#enums/battle-type";
import { describe, expect, it } from "vitest";

/** The loopback delivers on a queued task - flush before asserting. */
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("coop #867 - host-authoritative wave battleType verdict", () => {
  it("a TRAINER wave-start sync records the host's TRAINER verdict on the guest", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStreamer = new CoopBattleStreamer(host);
    const guestStreamer = new CoopBattleStreamer(guest);
    hostStreamer.sendEnemyParty(43, [], COOP_WAVE_NO_ME, BattleType.TRAINER);
    await flush();
    expect(guestStreamer.battleTypeForWave(43)).toBe(BattleType.TRAINER);
  });

  it("a WILD wave-start sync records the host's WILD verdict on the guest", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStreamer = new CoopBattleStreamer(host);
    const guestStreamer = new CoopBattleStreamer(guest);
    hostStreamer.sendEnemyParty(42, [], COOP_WAVE_NO_ME, BattleType.WILD);
    await flush();
    expect(guestStreamer.battleTypeForWave(42)).toBe(BattleType.WILD);
  });

  it("no wave-start sync = undefined (falls back to the local roll)", () => {
    const { guest } = createLoopbackPair();
    const guestStreamer = new CoopBattleStreamer(guest);
    expect(guestStreamer.battleTypeForWave(43)).toBeUndefined();
  });

  it("a battleType-SILENT mid-battle sync never overwrites the wave-start TRAINER verdict", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStreamer = new CoopBattleStreamer(host);
    const guestStreamer = new CoopBattleStreamer(guest);
    hostStreamer.sendEnemyParty(43, [], COOP_WAVE_NO_ME, BattleType.TRAINER); // wave-start: TRAINER verdict
    hostStreamer.sendEnemyParty(43, []); // mid-battle re-send (older/silent call sites pass no verdict)
    await flush();
    expect(guestStreamer.battleTypeForWave(43)).toBe(BattleType.TRAINER);
  });

  it("the ME verdict and the battleType verdict round-trip INDEPENDENTLY in one sync", async () => {
    const { host, guest } = createLoopbackPair();
    const hostStreamer = new CoopBattleStreamer(host);
    const guestStreamer = new CoopBattleStreamer(guest);
    hostStreamer.sendEnemyParty(43, [], COOP_WAVE_NO_ME, BattleType.TRAINER);
    await flush();
    expect(guestStreamer.meTypeForWave(43)).toBe(COOP_WAVE_NO_ME);
    expect(guestStreamer.battleTypeForWave(43)).toBe(BattleType.TRAINER);
  });
});
