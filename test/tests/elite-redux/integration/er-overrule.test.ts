/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Overrule 815 — "When this Pokémon's moves land critical hits, they (a) ignore
// defensive abilities that reduce damage AND (b) deal double damage if they are
// resisted." Both effects are crit-gated and live in `Pokemon.getAttackDamage`
// behind the OverruleCritAbAttr marker. We exercise them by calling
// getAttackDamage directly with isCritical true/false.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Overrule (815)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("on a crit, a RESISTED move deals double damage (negating the resist)", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[815] as AbilityId) // Overrule
      .enemySpecies(SpeciesId.REGIROCK) // pure Rock — resists Normal (0.5×)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);

    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = allMoves[MoveId.TACKLE];

    // Force a RESISTED (0.5×) hit directly via `effectiveness`, independent of the
    // enemy's typing: ER rebalanced Regirock's types (it is no longer pure Rock), so
    // the old "Normal is resisted by Rock" premise was stale and the resist never
    // applied. Overrule's resisted-×2 keys off `typeMultiplier < 1`, so pinning
    // effectiveness = 0.5 tests that logic exactly.
    const critDmg = enemy.getAttackDamage({
      source: user,
      move,
      isCritical: true,
      effectiveness: 0.5,
      simulated: true,
    }).damage;
    const nonCritDmg = enemy.getAttackDamage({
      source: user,
      move,
      isCritical: false,
      effectiveness: 0.5,
      simulated: true,
    }).damage;

    // A normal crit is ×1.5 of a non-crit. With Overrule's resisted-×2 on top, the
    // crit should be ≈ ×3 of the non-crit (1.5 × 2), i.e. well beyond a plain crit.
    expect(critDmg).toBeGreaterThan(nonCritDmg * 2.5);
  });

  it("on a crit, the defender's damage-reducing ability (Multiscale) is ignored", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[815] as AbilityId) // Overrule
      .enemySpecies(SpeciesId.DRAGONITE) // Multiscale: halves damage at full HP
      .enemyAbility(AbilityId.MULTISCALE);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);

    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    enemy.hp = enemy.getMaxHp(); // full HP → Multiscale active
    const move = allMoves[MoveId.TACKLE]; // neutral vs Dragon/Flying

    // Crit (Overrule ignores Multiscale) vs crit with abilities NOT ignored
    // (ignoreSourceAbility=true disables Overrule → Multiscale halves).
    const critIgnoring = enemy.getAttackDamage({ source: user, move, isCritical: true, simulated: true }).damage;
    const critWithMultiscale = enemy.getAttackDamage({
      source: user,
      move,
      isCritical: true,
      ignoreSourceAbility: true, // turns Overrule off
      simulated: true,
    }).damage;

    // Ignoring Multiscale ≈ double the damage of the Multiscale-halved crit.
    expect(critIgnoring).toBeGreaterThan(critWithMultiscale * 1.5);
  });

  // ===========================================================================
  // CONTRACT BOUNDARY (dex-authority, tester #Ryuveon): Overrule ignores
  // abilities that "reduce damage" — it is NOT Mold-Breaker-class. An
  // ABSORB / type-immunity ability (Sap Sipper, Volt/Water Absorb, Flash Fire,
  // Earth Eater, …) does NOT reduce damage: it NULLIFIES the move (immunity) and
  // grants a benefit (a stat boost / a heal / a power buff). That resolution
  // happens BEFORE `getAttackDamage`, where Overrule's crit effects live, so an
  // absorbed move never reaches Overrule at all. These cases lock in that
  // Overrule (even on a forced crit) does NOT bypass the absorb family — the
  // move is still absorbed. This is WORKING AS INTENDED per the ER 2.65 dex.
  // ===========================================================================
  const ABSORB_FAMILY: { name: string; ability: AbilityId; move: MoveId }[] = [
    { name: "Sap Sipper", ability: AbilityId.SAP_SIPPER, move: MoveId.RAZOR_LEAF }, // the tester's exact case
    { name: "Volt Absorb", ability: AbilityId.VOLT_ABSORB, move: MoveId.THUNDERBOLT },
    { name: "Water Absorb", ability: AbilityId.WATER_ABSORB, move: MoveId.WATER_GUN },
    { name: "Flash Fire", ability: AbilityId.FLASH_FIRE, move: MoveId.EMBER },
    { name: "Earth Eater", ability: AbilityId.EARTH_EATER, move: MoveId.MUD_SHOT },
  ];

  for (const { name, ability, move } of ABSORB_FAMILY) {
    it(`does NOT bypass ${name} — the move is still absorbed on an Overrule CRIT (no damage)`, async () => {
      game.override
        .battleStyle("single")
        .ability(ER_ID_MAP.abilities[815] as AbilityId) // Overrule
        .moveset(move)
        .criticalHits(true) // force the crit so Overrule's effects are fully "on"
        .enemySpecies(SpeciesId.SNORLAX) // Normal — the absorb ability still grants type immunity
        .enemyAbility(ability);
      await game.classicMode.startBattle(SpeciesId.MACHAMP);
      const enemy = game.field.getEnemyPokemon();
      const hpBefore = enemy.hp; // full HP → heal-absorbers cap at max, so HP is unchanged either way

      game.move.use(move);
      await game.move.forceHit();
      await game.toEndOfTurn();

      // Absorbed → zero damage. Overrule's crit "ignore damage-reducing abilities"
      // and "resisted-×2" both live in getAttackDamage, which an absorbed move never
      // reaches, so the immunity stands.
      expect(enemy.hp).toBe(hpBefore);
    });
  }

  it("Sap Sipper still FEEDS on the Overrule crit — the target gains +1 Atk (the tester's repro)", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[815] as AbilityId) // Overrule
      .moveset(MoveId.RAZOR_LEAF) // Grass, high crit ratio — the tester's move
      .criticalHits(true)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.SAP_SIPPER);
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;

    game.move.use(MoveId.RAZOR_LEAF);
    await game.move.forceHit();
    await game.toEndOfTurn();

    expect(enemy.hp).toBe(hpBefore); // no damage — absorbed
    expect(enemy.getStatStage(Stat.ATK)).toBe(1); // Sap Sipper's +1 Atk still fires
  });
});
