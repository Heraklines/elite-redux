/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Creeping Thorns hazard + Loose Thorns (909) + the Creeping
// Thorns (897) / Caltrops (977) moves.
//
// Loose Thorns DEX: "Sets Creeping Thorns when hit by contact." Caltrops DEX:
// "sets spikes that ALSO inflict bleeding on switch-in." The real ER Creeping
// Thorns hazard deals Spikes-style switch-in damage AND inflicts ER_BLEED.
// =============================================================================

import type { AbAttr } from "#data/abilities/ab-attrs";
import { SetArenaTagOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { dispatchMoveArchetype } from "#data/elite-redux/move-archetype-dispatcher";
import { AddArenaTrapTagAttr } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Resolve an ER ability id to its dispatched AbAttr list via its archetype row. */
function attrsFor(erId: number): readonly AbAttr[] {
  const row = ER_ABILITY_ARCHETYPES[erId];
  expect(row, `no archetype row for er ability ${erId}`).toBeDefined();
  return dispatchArchetype(row.archetype, row.params, erId).attrs;
}

describe("ER - Creeping Thorns hazard (wiring)", () => {
  it("Loose Thorns (909) deploys CREEPING_THORNS on the attacker side, contact-gated", () => {
    const attrs = attrsFor(909);
    const deploy = attrs.find((a): a is SetArenaTagOnHitAbAttr => a instanceof SetArenaTagOnHitAbAttr);
    expect(deploy, "Loose Thorns should deploy an arena tag when hit").toBeDefined();
    expect(deploy?.getTagType()).toBe(ArenaTagType.CREEPING_THORNS);
    expect(deploy?.getSide()).toBe("attacker");
    expect(deploy?.requiresContact()).toBe(true);
  });

  it("the Creeping Thorns move (897) deploys the real CREEPING_THORNS hazard", () => {
    const attrs = dispatchMoveArchetype("bespoke", null, 897).attrs;
    const trap = attrs.find((a): a is AddArenaTrapTagAttr => a instanceof AddArenaTrapTagAttr);
    expect(trap, "Creeping Thorns move should add an arena trap").toBeDefined();
    expect(trap?.tagType).toBe(ArenaTagType.CREEPING_THORNS);
  });

  it("the Caltrops move (977) deploys the real CREEPING_THORNS hazard", () => {
    const attrs = dispatchMoveArchetype("bespoke", null, 977).attrs;
    const trap = attrs.find((a): a is AddArenaTrapTagAttr => a instanceof AddArenaTrapTagAttr);
    expect(trap, "Caltrops move should add an arena trap").toBeDefined();
    expect(trap?.tagType).toBe(ArenaTagType.CREEPING_THORNS);
  });
});

describe.skipIf(!RUN)("ER - Creeping Thorns hazard (behavior)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("damages AND bleeds a grounded switch-in", async () => {
    // Deploy the hazard on the ENEMY side before the enemy summons.
    game.scene.arena.addTag(ArenaTagType.CREEPING_THORNS, 0, undefined, 0, ArenaTagSide.ENEMY);
    // Snorlax: grounded, not Rock/Ghost, so it is hit + bleeds on summon.
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
  });

  it("Loose Thorns deploys Creeping Thorns on the attacker side when hit by contact", async () => {
    game.override.ability(ErAbilityId.LOOSE_THORNS as unknown as AbilityId).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    expect(game.scene.arena.getTagOnSide(ArenaTagType.CREEPING_THORNS, ArenaTagSide.ENEMY)).toBeUndefined();

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    // The foe's contact move deployed Creeping Thorns on ITS OWN (attacker) side.
    expect(game.scene.arena.getTagOnSide(ArenaTagType.CREEPING_THORNS, ArenaTagSide.ENEMY)).toBeDefined();
  });
});
