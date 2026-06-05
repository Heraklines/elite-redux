/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DIAGNOSTIC (not a behavioral assertion): dump the ER trainer pool shape so we
// can see WHY Hell-mode trainers repeat — per-type pool sizes and which species
// dominate hell rosters.

import {
  getErUsedTrainerKeys,
  resetErRunTrainerTracking,
  restoreErRunTrainerTracking,
} from "#data/elite-redux/er-trainer-runtime-hook";
import { ER_TRAINER_REGISTRY } from "#data/elite-redux/init-elite-redux-trainers";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER trainer pool diagnostic (Hell repeats)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("dumps per-type pool sizes and hell-roster species frequency", () => {
    const reg = ER_TRAINER_REGISTRY as any[];
    expect(reg.length).toBeGreaterThan(0);
    console.log(`[pool] total ER trainers: ${reg.length}`);

    // How many ship a real hell roster?
    const withHell = reg.filter(t => (t.hellParty?.length ?? 0) > 0);
    const withInsane = reg.filter(t => (t.insaneParty?.length ?? 0) > 0);
    console.log(`[pool] with hellParty: ${withHell.length}; with insaneParty: ${withInsane.length}`);

    // Per-trainerType pool size distribution (HELL-eligible = hell or insane roster).
    const byType = new Map<number, number>();
    for (const t of reg) {
      const hellEligible = (t.hellParty?.length ?? 0) > 0 || (t.insaneParty?.length ?? 0) > 0;
      if (hellEligible) {
        byType.set(t.trainerType, (byType.get(t.trainerType) ?? 0) + 1);
      }
    }
    const sizes = [...byType.values()];
    const sizeBuckets = { "1": 0, "2": 0, "3-4": 0, "5+": 0 };
    for (const s of sizes) {
      if (s === 1) {
        sizeBuckets["1"]++;
      } else if (s === 2) {
        sizeBuckets["2"]++;
      } else if (s <= 4) {
        sizeBuckets["3-4"]++;
      } else {
        sizeBuckets["5+"]++;
      }
    }
    console.log(`[pool] HELL-eligible types: ${byType.size}; pool-size buckets:`, JSON.stringify(sizeBuckets));
    console.log("[pool] types with only 1 HELL-eligible trainer (forced repeats):", sizeBuckets["1"]);

    // Species frequency across all hell/insane rosters (what you "see all the time").
    const freq = new Map<number, number>();
    for (const t of reg) {
      const roster = (t.hellParty?.length > 0 ? t.hellParty : t.insaneParty) ?? [];
      for (const m of roster) {
        freq.set(m.speciesId, (freq.get(m.speciesId) ?? 0) + 1);
      }
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    console.log("[pool] top-20 species across hell/insane rosters:");
    for (const [sid, n] of top) {
      const name = getPokemonSpecies(sid)?.name ?? `#${sid}`;
      console.log(`   ${name} (#${sid}): ${n} trainers`);
    }
    // Spotlight the reported repeat offenders.
    for (const sid of [SpeciesId.TYRANITAR, SpeciesId.GLIMMORA]) {
      console.log(`   [reported] ${getPokemonSpecies(sid)?.name}: ${freq.get(sid) ?? 0} trainers`);
    }
  });

  it("used-trainer set persists/restores (no-repeat survives save/load)", () => {
    resetErRunTrainerTracking();
    expect(getErUsedTrainerKeys()).toEqual([]);

    // Simulate a run having fought 3 trainers, then "saving".
    restoreErRunTrainerTracking(["a", "b", "c"]);
    const saved = getErUsedTrainerKeys();
    expect(new Set(saved)).toEqual(new Set(["a", "b", "c"]));

    // "Load" a different snapshot — replaces, doesn't merge.
    restoreErRunTrainerTracking(["x"]);
    expect(getErUsedTrainerKeys()).toEqual(["x"]);

    // Backwards compat: an old save with no keys restores to a fresh set.
    restoreErRunTrainerTracking(undefined);
    expect(getErUsedTrainerKeys()).toEqual([]);
  });
});
