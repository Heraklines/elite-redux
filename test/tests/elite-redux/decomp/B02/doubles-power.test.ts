/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3: the shared L2 twin is a singles fight where the holder attacks, so it never evaluates an ally booster
// (Battery, Power Spot, Steely Spirit, Airborne, Voltron: dispatched for the ALLIES of the move user) and never sees the
// field auras (read with getAbilityAttrs). Here a real double battle is run once with the original ability and once with the
// ability rebuilt from its own blocks (a shadow id), on both of my Pokemon, and Move.calculateBattlePower (the engine
// calculation that asks all of these classes) must give the same power for every move. A baseline run with no ability proves
// the original really changed the power, so two equal numbers cannot both be "nothing happened".
import { allMoves } from "#data/data-lists";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { allocateShadowId, liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const MOVES = [
  MoveId.TACKLE,
  MoveId.EMBER,
  MoveId.WATER_GUN,
  MoveId.THUNDERBOLT,
  MoveId.IRON_HEAD,
  MoveId.BITE,
  MoveId.DAZZLING_GLEAM,
  MoveId.WING_ATTACK,
  MoveId.SHADOW_BALL,
  MoveId.EARTHQUAKE,
  MoveId.PSYCHIC,
] as const;

// ability id, name for the message, must the original change at least one power in this setup
const ABILITIES: readonly (readonly [number, string, boolean])[] = [
  [217, "Battery", true],
  [249, "Power Spot", true],
  [252, "Steely Spirit", true],
  [5271, "Airborne", true],
  [5958, "Voltron", true],
  [186, "Dark Aura", true],
  [187, "Fairy Aura", true],
  [188, "Aura Break", false], // only changes the power while an aura of the other kind is on the field
  [5196, "Pixie Power", true],
  [5679, "Nihil Blaster", false], // its field part is gated the same way as Aura Break
  [5935, "Pure Good", true],
  [20001, "Dreadful Winds", true],
  [20013, "Fairy Wings", true],
];

describe("B02 chunk 3: ally and field power boosters in a real double battle", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    unregisterShadows();
  });

  async function powers(abilityId: number): Promise<Record<string, number>> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("double")
      .moveset([MoveId.SPLASH])
      .ability(abilityId as AbilityId)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false)
      // wave 1 is always a single battle (the first-battle rule), so start later to get two Pokemon per side
      .startingWave(5)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.SHUCKLE);
    const [first, second] = game.scene.getPlayerField();
    const foe = game.scene.getEnemyField()[0];
    const result: Record<string, number> = {};
    for (const move of MOVES) {
      result[`first ${MoveId[move]}`] = allMoves[move].calculateBattlePower(first, foe, true);
      result[`second ${MoveId[move]}`] = allMoves[move].calculateBattlePower(second, foe, true);
    }
    return result;
  }

  for (const [id, name, mustChange] of ABILITIES) {
    it(`${name}: the rebuilt ability gives the same power as the original for every move`, async () => {
      const original = liveAbility(id);
      const shadowId = allocateShadowId();
      const rebuilt = rebuildAbility(original, shadowId, { registry: declRegistry });
      expect(rebuilt.rebuilt.length, `${name}: nothing was rebuilt`).toBeGreaterThan(0);
      const baseline = await powers(AbilityId.BALL_FETCH);
      const before = await powers(id);
      registerShadow(shadowId, rebuilt.ability);
      const after = await powers(shadowId);
      expect(after).toEqual(before);
      const changed = Object.keys(before).filter(key => before[key] !== baseline[key]);
      console.log(`B02_C3 doubles ${name}: ${changed.length} of ${Object.keys(before).length} powers differ from the no-ability baseline`);
      if (mustChange) {
        expect(changed.length).toBeGreaterThan(0);
      }
    }, 120000);
  }
});
