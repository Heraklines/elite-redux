/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO #609: Cursed Idol relic ("Void Gaze"). Spec: each BATTLE the FIRST player
// mon sent out (ordinal 1) gets a FREE Substitute; the NEXT entrant (ordinal 2)
// arrives at half HP; ordinal 3+ are unaffected. Live report: the Substitute is
// ALSO applied to a switched-in mon (it should only be the first lead).
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-cursed-idol-substitute.test.ts

import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const sub = (p: { getTag: (t: BattlerTagType) => unknown }) => !!p.getTag(BattlerTagType.SUBSTITUTE);

describe.skipIf(!RUN)("repro: Cursed Idol substitute on switch-in (#609)", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("only ordinal-1 (the lead) gets the Substitute; switched-in mons do not", async () => {
    const game = new GameManager(g);
    game.override
      .battleStyle("single")
      .startingModifier([{ name: "ER_RELIC_CURSED_IDOL" }])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN) // harmless: keep player mons alive across switches
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.BLISSEY, SpeciesId.LAPRAS);

    const lead = game.field.getPlayerPokemon();
    console.log(`ord1 lead=${lead.species.name} sub=${sub(lead)} hp=${lead.hp}/${lead.getMaxHp()}`);
    expect(sub(lead), "the FIRST lead (ordinal 1) must get the free Substitute").toBe(true);

    // Switch in the 2nd mon (ordinal 2): HP halved, NO Substitute.
    game.doSwitchPokemon(1);
    await game.toNextTurn();
    const second = game.field.getPlayerPokemon();
    console.log(`ord2 in=${second.species.name} sub=${sub(second)} hp=${second.hp}/${second.getMaxHp()}`);
    expect(sub(second), "an ordinal-2 switch-in must NOT get a Substitute").toBe(false);

    // Switch in the 3rd mon (ordinal 3): NO Substitute, no halving.
    const lapIdx = game.scene.getPlayerParty().findIndex(p => p.species.speciesId === SpeciesId.LAPRAS);
    game.doSwitchPokemon(lapIdx);
    await game.toNextTurn();
    const third = game.field.getPlayerPokemon();
    console.log(`ord3 in=${third.species.name} sub=${sub(third)} hp=${third.hp}/${third.getMaxHp()}`);
    expect(third.species.speciesId, "3rd switch landed on Lapras").toBe(SpeciesId.LAPRAS);
    expect(sub(third), "an ordinal-3 switch-in must NOT get a Substitute").toBe(false);
  }, 120_000);

  it("DOUBLES: exactly ONE lead gets the Substitute; later entrants do not", async () => {
    const game = new GameManager(g);
    game.override
      .battleStyle("double")
      .startingModifier([{ name: "ER_RELIC_CURSED_IDOL" }])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.BLISSEY, SpeciesId.LAPRAS, SpeciesId.SNORLAX);

    const [leadA, leadB] = game.scene.getPlayerField();
    const subbedLeads = [leadA, leadB].filter(sub).length;
    console.log(
      `DOUBLES leads: A=${leadA.species.name} sub=${sub(leadA)} hp=${leadA.hp}/${leadA.getMaxHp()} | `
        + `B=${leadB.species.name} sub=${sub(leadB)} hp=${leadB.hp}/${leadB.getMaxHp()} (subbed leads=${subbedLeads})`,
    );
    // The whole party: NO mon other than the single ordinal-1 lead may have a sub.
    const subbedTotal = game.scene.getPlayerParty().filter(sub).length;
    expect(subbedLeads, "exactly ONE doubles lead gets the Substitute (ordinal 1)").toBe(1);
    expect(subbedTotal, "no other party mon may carry a Cursed-Idol Substitute").toBe(1);
    // The SLOT-0 lead (the player's first-sent mon) gets the Substitute; slot 1 is
    // drained - not the speed-ordered reverse.
    expect(sub(leadA), "the slot-0 lead must get the free Substitute, not the slot-1 mon").toBe(true);
    expect(leadB.hp, "the slot-1 lead is the one drained to half HP").toBeLessThanOrEqual(leadB.getMaxHp() / 2 + 1);
  }, 120_000);
});
