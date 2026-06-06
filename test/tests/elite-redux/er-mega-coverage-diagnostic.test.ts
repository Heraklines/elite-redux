/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// DIAGNOSTIC: of ER's 283 mega-capable base species, how many actually have a
// usable mega/primal/origin FORM injected onto the mapped pokerogue species?
// A trainer mon (or player) can only mega if the form exists — so this is the
// true ceiling on how many distinct ER megas can ever appear in our port.

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MEGA_CAPABLE_SPECIES_IDS } from "#data/elite-redux/er-mega-stone-item-ids";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER mega coverage diagnostic (how many megas actually work)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  const hasMegaForm = (pkId: number | undefined): boolean => {
    if (pkId === undefined) {
      return false;
    }
    const species = getPokemonSpecies(pkId);
    return (species?.forms ?? []).some(f => /mega|primal|origin/i.test(f.formKey));
  };

  it("reports mega-form injection coverage across all ER mega-capable species", () => {
    let total = 0;
    let unmapped = 0;
    let working = 0;
    const missing: string[] = [];

    for (const erId of ER_MEGA_CAPABLE_SPECIES_IDS) {
      total++;
      const pkId = ER_ID_MAP.species[erId];
      if (pkId === undefined) {
        unmapped++;
        continue;
      }
      if (hasMegaForm(pkId)) {
        working++;
      } else {
        const name = getPokemonSpecies(pkId)?.name ?? `pk#${pkId}`;
        missing.push(`${name} (er#${erId})`);
      }
    }

    console.log(`\n[mega-coverage] ER mega-capable base species: ${total}`);
    console.log(`[mega-coverage]   mapped + HAS a mega form (works): ${working}`);
    console.log(`[mega-coverage]   mapped but NO mega form injected (broken): ${missing.length}`);
    console.log(`[mega-coverage]   unmapped (id-map drift, dropped): ${unmapped}`);
    console.log("[mega-coverage] first 50 with NO injected mega form:");
    for (const m of missing.slice(0, 50)) {
      console.log(`   ${m}`);
    }

    expect(total).toBeGreaterThan(0);
  });

  it("spot-checks specific ER megas the user asked about", () => {
    // ER raw species ids: Chandelure 609, Kleavor 900. Redux customs (>=2000 in
    // ER space) map to pokerogue custom ids (>=10000) if registered.
    const probes: [string, number][] = [
      ["Chandelure", 609],
      ["Kleavor", 900],
      ["Chandelure Redux", 2278],
      ["Kleavor Redux", 2648],
      ["Reuniclus", 579],
      ["Reuniclus Redux", 2537],
      ["Calyrex", 898],
    ];
    for (const [label, erId] of probes) {
      const pkId = ER_ID_MAP.species[erId];
      const species = pkId === undefined ? undefined : getPokemonSpecies(pkId);
      const forms = (species?.forms ?? []).map(f => f.formKey || "(base)").join(", ");
      const passives = species?.getPassiveAbilities?.() ?? [];
      console.log(
        `[mega-probe] ${label} er#${erId} -> pk#${pkId ?? "UNMAPPED"} "${species?.name ?? "?"}" | mega? ${hasMegaForm(pkId)} | forms: [${forms}] | passives: [${passives.join(",")}]`,
      );
      // Per-form passives (the user's Calyrex report is about the rider FORMS).
      for (const f of species?.forms ?? []) {
        const fp = (f as { getPassiveAbilities?: () => number[] }).getPassiveAbilities?.() ?? [];
        console.log(`        form "${f.formKey || "(base)"}" passives: [${fp.join(",")}]`);
      }
    }
    expect(true).toBe(true);
  });
});
