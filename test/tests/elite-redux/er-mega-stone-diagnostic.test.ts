/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DIAGNOSTIC: why are there so few megas in Hell? Scan every hell/insane ER
// roster and count (a) members holding a mega-stone item, (b) of those, how
// many species actually have a registered Mega form (so forceErMega would fire).
// Splits the two failure hypotheses cleanly:
//   A) rosters don't carry mega stones        → mega-stone holder count is low
//   B) holders' species have no Mega form here → eligible count << holder count

import { ER_MEGA_STONE_ITEM_IDS } from "#data/elite-redux/er-mega-stone-item-ids";
import { ER_TRAINER_REGISTRY } from "#data/elite-redux/init-elite-redux-trainers";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER mega-stone diagnostic (Hell shortage)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("counts mega-stone holders and mega-form eligibility across hell rosters", () => {
    // biome-ignore lint/suspicious/noExplicitAny: registry shape
    const reg = ER_TRAINER_REGISTRY as any[];
    let totalMembers = 0;
    let megaStoneHolders = 0;
    let megaEligible = 0; // holder whose species HAS a /mega/ form
    const ineligible: string[] = []; // holder species with NO mega form
    const sampleItemIds = new Set<number>();
    const allItemIds = new Set<number>();

    for (const t of reg) {
      const roster = (t.hellParty?.length > 0 ? t.hellParty : t.insaneParty) ?? [];
      for (const m of roster) {
        totalMembers++;
        allItemIds.add(m.itemId);
        if (ER_MEGA_STONE_ITEM_IDS.has(m.itemId)) {
          megaStoneHolders++;
          sampleItemIds.add(m.itemId);
          const species = getPokemonSpecies(m.speciesId);
          const hasMega = (species?.forms ?? []).some((f: { formKey: string }) =>
            /mega|primal|origin/i.test(f.formKey),
          );
          if (hasMega) {
            megaEligible++;
          } else {
            ineligible.push(`${species?.name ?? `#${m.speciesId}`} (item ${m.itemId})`);
          }
        }
      }
    }

    console.log(`\n[mega-diag] total hell/insane roster members: ${totalMembers}`);
    console.log(`[mega-diag] mega-stone holders (itemId >= 748): ${megaStoneHolders}`);
    console.log(`[mega-diag] of those, species WITH a /mega/ form (forceErMega fires): ${megaEligible}`);
    console.log(`[mega-diag] of those, species WITHOUT a mega form (no-op): ${ineligible.length}`);
    console.log(
      `[mega-diag] distinct mega-stone item ids seen: ${[...sampleItemIds].sort((a, b) => a - b).join(", ")}`,
    );
    console.log(
      `[mega-diag] item-id range across ALL holders: min ${Math.min(...allItemIds)} / max ${Math.max(...allItemIds)}`,
    );
    if (ineligible.length > 0) {
      console.log("[mega-diag] first 30 holders with NO mega form:");
      for (const s of ineligible.slice(0, 30)) {
        console.log(`   ${s}`);
      }
    }

    // Also dump the top item ids just below the 748 threshold, to catch a
    // mis-set threshold (mega stones registered under a different id range).
    const near = [...allItemIds].filter(id => id >= 600 && id < 748).sort((a, b) => a - b);
    console.log(`[mega-diag] holder item ids in 600..747 (potential mis-classified megas): ${near.join(", ")}`);

    expect(totalMembers).toBeGreaterThan(0);
  });
});
