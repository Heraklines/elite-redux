/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// A mega stone must NOT be offered as a reward when its ONLY valid target in the
// party is ALREADY mega-evolved (ER megas are permanent resting forms, so an
// already-mega mon can never take another stone). Reported: "given a
// Victreebelite despite already having a mega-evolved Victreebel".
//
// The standard reward pool / biome-shop path (FormChangeItemModifierTypeGenerator)
// already gates this via its vanilla `fc.preFormKey === p.getFormKey()` filter.
// The GAP was the mining/delving loot path (er-mineral-loot.rollMegaStone), which
// force-generates a stone via pregenArgs and so BYPASSES that filter: its
// stone-collection helper gathered a mon's line mega stone regardless of the
// mon's current form. The fix skips an already-mega party member (reusing the
// game's own isMega() detection), while a DIFFERENT not-yet-mega'd member - or a
// pre-evolution in the same line - still keeps the stone available.
//
// Gated behind ER_SCENARIO=1 (ER form-change registry must be initialized).
// =============================================================================

import { emptyMineralHaul, rollMegaStone } from "#data/elite-redux/er-mineral-loot";
import { FormChangeItem } from "#enums/form-change-item";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function megaFormIndex(mon: { species: { forms: { formKey: string }[] } }): number {
  return mon.species.forms.findIndex(f =>
    [SpeciesFormKey.MEGA, SpeciesFormKey.MEGA_X, SpeciesFormKey.MEGA_Y].includes(f.formKey as SpeciesFormKey),
  );
}

/**
 * The set of mega-stone names `rollMegaStone` would grant the CURRENT party.
 * Rolled at 100% many times to surface the full eligible-stone set (each roll
 * force-grants one random stone from the party's eligible pool).
 */
function eligibleMineralStones(): Set<string> {
  const names = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const haul = emptyMineralHaul();
    if (rollMegaStone(haul, 5, 100)) {
      for (const opt of haul.options) {
        const item = (opt.type as { formChangeItem?: number }).formChangeItem;
        if (typeof item === "number") {
          names.add(FormChangeItem[item]);
        }
      }
    }
  }
  return names;
}

describe.skipIf(!RUN)("ER mineral-loot mega stone: not offered to an already-mega mon", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemySpecies(SpeciesId.MAGIKARP);
  });

  it("ER-custom mega (Victreebel): base offers Victreebelite, mega does NOT", async () => {
    await game.classicMode.startBattle(SpeciesId.VICTREEBEL);
    const mon = game.field.getPlayerPokemon();

    mon.formIndex = 0;
    expect(mon.isMega()).toBe(false);
    expect(eligibleMineralStones().has("VICTREEBELITE")).toBe(true);

    mon.formIndex = megaFormIndex(mon);
    expect(mon.isMega()).toBe(true);
    expect(eligibleMineralStones().has("VICTREEBELITE")).toBe(false);
  });

  it("vanilla mega (Venusaur): base offers Venusaurite, mega does NOT", async () => {
    await game.classicMode.startBattle(SpeciesId.VENUSAUR);
    const mon = game.field.getPlayerPokemon();

    mon.formIndex = 0;
    expect(mon.isMega()).toBe(false);
    expect(eligibleMineralStones().has("VENUSAURITE")).toBe(true);

    mon.formIndex = megaFormIndex(mon);
    expect(mon.isMega()).toBe(true);
    const megaStones = eligibleMineralStones();
    expect([...megaStones].some(s => s.startsWith("VENUSAURITE"))).toBe(false);
  });

  it("different eligible member: mega Victreebel + base Charizard -> Charizardite yes, Victreebelite no", async () => {
    await game.classicMode.startBattle(SpeciesId.VICTREEBEL, SpeciesId.CHARIZARD);
    const vic = game.scene.getPlayerParty().find(p => p.species.speciesId === SpeciesId.VICTREEBEL)!;
    vic.formIndex = megaFormIndex(vic);
    expect(vic.isMega()).toBe(true);

    const stones = eligibleMineralStones();
    expect(stones.has("VICTREEBELITE")).toBe(false);
    expect([...stones].some(s => s.startsWith("CHARIZARDITE"))).toBe(true);
  });

  it("not-yet-mega pre-evo in the same line keeps the stone: mega Victreebel + base Weepinbell -> Victreebelite still offered", async () => {
    await game.classicMode.startBattle(SpeciesId.VICTREEBEL, SpeciesId.WEEPINBELL);
    const vic = game.scene.getPlayerParty().find(p => p.species.speciesId === SpeciesId.VICTREEBEL)!;
    vic.formIndex = megaFormIndex(vic);
    expect(vic.isMega()).toBe(true);

    expect(eligibleMineralStones().has("VICTREEBELITE")).toBe(true);
  });
});
