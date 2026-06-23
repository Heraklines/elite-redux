/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Hubris KO-credit (#628): a player reported "Hubris activates if your
// teammate pokemon dies; even if the pokemon with it didn't kill the pokemon."
//
// Root cause: ER's on-KO stat trigger (StatTriggerOnKoAbAttr - Hubris, Chilling
// Neigh, Adrenaline Rush, ...) extended `PostKnockOutAbAttr`, which faint-phase
// dispatches to EVERY on-field Pokemon when ANY one faints. With an unconditional
// `canApply`, the holder boosted off a teammate's (or any) death. Vanilla's
// Moxie-family uses the killer-only `PostVictoryAbAttr` hook; we keep the on-KO
// subclass but gate `canApply` to the mon credited with the KO.
//
// Test design (doubles, both player mons attack with Tackle): in ONE turn the
// HOLDER KOs foe #2 and the ALLY KOs foe #1, so TWO faints happen on the field.
//   - Hubris (gated): the holder is credited with exactly ONE KO (its own), so
//     it gains +1 SpAtk. Before the fix it boosted off BOTH faints -> +2. The
//     "+1, not +2" is the regression assertion - it proves the ally's KO no
//     longer leaks a boost onto the holder.
//   - Forsaken Heart (`triggerOnAnyFaint`): SHOULD boost on every field faint,
//     so it gains +2 here. This guards that the new gate didn't break it.
//
// (Direct gate unit tests - "victim credited to another mon -> false", i.e. the
// literal teammate-death case - live in
// test/data/elite-redux/archetypes/stat-trigger-on-event.test.ts.)
//
// NB: MoveId.SPLASH / MoveId.GROWL resolve to DAMAGING moves in this build, so
// they can't be used as an inert "do nothing" action - hence the two-KO design
// using Tackle (a plain, correctly-resolving single-target move).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
// ER dex ids (er-ability-audit.tsv col 1; dispatcher case numbers): Hubris 533,
// Forsaken Heart 771. ER_ID_MAP.abilities maps dex id -> pkrg AbilityId.
const HUBRIS = ER_ID_MAP.abilities[533] as AbilityId;
const FORSAKEN_HEART = ER_ID_MAP.abilities[771] as AbilityId;

describe.skipIf(!RUN)("ER Hubris / on-KO stat triggers credit the holder's KO (#628)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .criticalHits(false)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.MAGIKARP) // frail - a lvl-100 Tackle OHKOs it
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH) // foes don't threaten the lvl-100 player mons
      .enemyLevel(1)
      .startingLevel(100);
  });

  it("maps the ER ability ids correctly", () => {
    expect(HUBRIS, "Hubris id resolves").toBeTruthy();
    expect(FORSAKEN_HEART, "Forsaken Heart id resolves").toBeTruthy();
    // Fail loudly if the dex-id mapping drifted.
    expect(allAbilities[HUBRIS]?.name?.toLowerCase()).toContain("hubris");
    expect(allAbilities[FORSAKEN_HEART]?.name?.toLowerCase()).toContain("forsaken");
  });

  it("Hubris boosts ONCE for the holder's own KO, NOT for the ally's KO (#628)", async () => {
    game.override.ability(HUBRIS);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX);
    const holder = game.scene.getPlayerField()[0];
    expect(holder.getAbility().id).toBe(HUBRIS);
    expect(holder.getStatStage(Stat.SPATK)).toBe(0);

    // Same turn: HOLDER KOs foe #2, ALLY KOs foe #1 -> two field faints.
    game.move.select(MoveId.TACKLE, 0, BattlerIndex.ENEMY_2);
    game.move.select(MoveId.TACKLE, 1, BattlerIndex.ENEMY);
    await game.toEndOfTurn();

    // Gated: credited with its OWN KO only -> +1. Pre-fix this was +2 (it also
    // boosted off the ally's KO) - that is the #628 bug.
    expect(holder.getStatStage(Stat.SPATK), "credited with its own KO only -> +1, not +2").toBe(1);
  });

  it("Forsaken Heart boosts on EVERY field faint (triggerOnAnyFaint bypass)", async () => {
    game.override.ability(FORSAKEN_HEART);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX);
    const holder = game.scene.getPlayerField()[0];
    expect(holder.getAbility().id).toBe(FORSAKEN_HEART);
    expect(holder.getStatStage(Stat.ATK)).toBe(0);

    // Same two faints, but Forsaken Heart fires on ANY faint anywhere on the
    // field, so the holder boosts for BOTH the holder's and the ally's KO -> +2.
    game.move.select(MoveId.TACKLE, 0, BattlerIndex.ENEMY_2);
    game.move.select(MoveId.TACKLE, 1, BattlerIndex.ENEMY);
    await game.toEndOfTurn();

    expect(holder.getStatStage(Stat.ATK), "any faint boosts -> +2 from two KOs").toBe(2);
  });
});
