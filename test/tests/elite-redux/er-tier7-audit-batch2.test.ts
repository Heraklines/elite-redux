/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER tier-7 dex-fidelity audit — BATCH 2 behavior proofs (GameManager).
//
// Covers 5 confirmed ability/move fixes (the 6th, an ability-description data
// misalignment, is non-behavioral and documented separately):
//   1. Egoist (555)      — copies the foe's EXACT (stat, stages) raise.
//   2. Cutthroat (743)   — first slicing move per entry gets +1 priority,
//                          consumed on landing a slicing move, re-armed by Sharpen.
//   3. Soul Linker (332) — no recoil/reflect on a KO or vs another Soul Linker.
//   4. Pitfall (937)     — ONE 30% roll applies BOTH trap + always-hit (wiring).
//   5. Aurora Borealis (291) — Ice STAB / Weather Ball Ice+double / Aurora Veil
//                          without hail / Blizzard never misses.
//
// Gated behind ER_SCENARIO=1. All asserted effects are deterministic under the
// test RNG clamp (no sub-100% procs; Pitfall's proc is proven via wiring + the
// headless --real-rng runner instead).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { PitfallTrapAndAlwaysHitAttr } from "#data/elite-redux/move-archetype-dispatcher";
import { AddBattlerTagAttr } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const EGOIST = ER_ID_MAP.abilities[555] as AbilityId; // 5276
const CUTTHROAT = ER_ID_MAP.abilities[743] as AbilityId; // 5444
const SOUL_LINKER = ER_ID_MAP.abilities[332] as AbilityId; // 5070
const AURORA_BOREALIS = ER_ID_MAP.abilities[291] as AbilityId; // 5029
const PITFALL_MOVE = ER_ID_MAP.moves[937] as MoveId; // 5096

describe.skipIf(!RUN)("ER tier-7 audit batch 2 — behavior", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => phaserGame?.destroy(true));

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingWave(145) // past the #419 BST cap so bulky enemies aren't devolved
      .startingLevel(100)
      .enemyLevel(100);
  });

  // ---------------------------------------------------------------------------
  // Fix 1 — Egoist (555): copies the foe's EXACT raise (same stat, same stages).
  // ---------------------------------------------------------------------------
  describe("Egoist (555)", () => {
    it("a foe's Iron Defense (+2 Def) gives the holder +2 Def — NOT +1 Atk/SpAtk/SpD", async () => {
      game.override
        .ability(EGOIST)
        .moveset([MoveId.SPLASH])
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.IRON_DEFENSE]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.IRON_DEFENSE);
      await game.toEndOfTurn();

      // Mirrors the foe's exact raise: Def +2. The old wire hardcoded +1 Atk/SpAtk/SpD.
      expect(player.getStatStage(Stat.DEF)).toBe(2);
      expect(player.getStatStage(Stat.ATK)).toBe(0);
      expect(player.getStatStage(Stat.SPATK)).toBe(0);
      expect(player.getStatStage(Stat.SPDEF)).toBe(0);
      expect(player.getStatStage(Stat.SPD)).toBe(0);
    });

    it("a foe's Swords Dance (+2 Atk) gives the holder +2 Atk", async () => {
      game.override
        .ability(EGOIST)
        .moveset([MoveId.SPLASH])
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.SWORDS_DANCE]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();

      game.move.select(MoveId.SPLASH);
      await game.move.forceEnemyMove(MoveId.SWORDS_DANCE);
      await game.toEndOfTurn();

      expect(player.getStatStage(Stat.ATK)).toBe(2);
      expect(player.getStatStage(Stat.DEF)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Fix 2 — Cutthroat (743): one-shot +1 slicing priority per entry, consumed on
  // landing a slicing move, re-armed by Sharpen. SHUCKLE (very slow, tiny Atk) vs
  // a fast JOLTEON isolates ORDER: SHUCKLE only outspeeds via the +1 priority.
  // ---------------------------------------------------------------------------
  describe("Cutthroat (743)", () => {
    beforeEach(() => {
      game.override
        .ability(CUTTHROAT)
        .moveset([MoveId.NIGHT_SLASH, MoveId.CROSS_POISON, MoveId.SHARPEN])
        .enemySpecies(SpeciesId.JOLTEON) // fast; survives SHUCKLE's tiny slicing hits at full HP
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.TACKLE]);
    });

    it("the FIRST slicing move on entry gets +1 priority (a slower holder moves first)", async () => {
      await game.classicMode.startBattle(SpeciesId.SHUCKLE);
      const player = game.scene.getPlayerPokemon()!;
      const enemy = game.scene.getEnemyPokemon()!;
      enemy.hp = 1; // any hit KOs → ORDER is the only variable

      game.move.select(MoveId.NIGHT_SLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();

      // +1 priority let the slow SHUCKLE move first: enemy KO'd before it Tackled.
      expect(enemy.isFainted()).toBe(true);
      expect(player.hp).toBe(player.getMaxHp());
    });

    it("after landing a slicing move, the NEXT slicing move has NO priority (consumed)", async () => {
      await game.classicMode.startBattle(SpeciesId.SHUCKLE);
      const player = game.scene.getPlayerPokemon()!;
      const enemy = game.scene.getEnemyPokemon()!;

      // Turn 1: full-HP Jolteon survives SHUCKLE's Night Slash; the slicing hit
      // LANDS → consumes the +1 priority. (SHUCKLE moved first this turn.)
      game.move.select(MoveId.NIGHT_SLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();
      expect(enemy.isFainted()).toBe(false);
      const hpAfterT1 = player.hp;
      enemy.hp = 1; // so turn-2 order is the only variable

      // Turn 2: Cross Poison (slicing) with the boost gone → the faster Jolteon
      // Tackles FIRST (SHUCKLE loses HP) before SHUCKLE's slicing KOs it.
      game.move.select(MoveId.CROSS_POISON);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(enemy.isFainted()).toBe(true);
      expect(player.hp).toBeLessThan(hpAfterT1);
    });

    it("using Sharpen RE-ARMS the one-shot: the next slicing move regains +1 priority", async () => {
      await game.classicMode.startBattle(SpeciesId.SHUCKLE);
      const player = game.scene.getPlayerPokemon()!;
      const enemy = game.scene.getEnemyPokemon()!;

      // Turn 1: Night Slash lands on the full-HP Jolteon → consumes the boost.
      game.move.select(MoveId.NIGHT_SLASH);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();
      expect(enemy.isFainted()).toBe(false);

      // Turn 2: Sharpen re-arms the one-shot priority.
      game.move.select(MoveId.SHARPEN);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();
      const hpAfterT2 = player.hp;
      enemy.hp = 1;

      // Turn 3: Cross Poison (slicing) again has +1 priority (re-armed) → the slow
      // SHUCKLE moves first and KOs the 1-HP Jolteon before it can Tackle.
      game.move.select(MoveId.CROSS_POISON);
      await game.move.forceEnemyMove(MoveId.TACKLE);
      await game.toEndOfTurn();

      expect(enemy.isFainted()).toBe(true);
      expect(player.hp).toBe(hpAfterT2); // no Tackle taken on turn 3 → moved first
    });
  });

  // ---------------------------------------------------------------------------
  // Fix 3 — Soul Linker (332): no recoil/reflect on a KO or vs another Soul Linker.
  // ---------------------------------------------------------------------------
  describe("Soul Linker (332)", () => {
    // NB: ER weaponized Splash (a real 1-BP physical move), so the inert "do
    // nothing" move here is CELEBRATE (power 0, status). The direct hit is SWIFT
    // (non-contact, always-hit) to keep contact-punish innates out of the picture.
    beforeEach(() => {
      game.override
        .ability(SOUL_LINKER)
        .moveset([MoveId.SWIFT, MoveId.CELEBRATE])
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyMoveset([MoveId.CELEBRATE]);
    });

    it("KOing a foe with a direct hit gives the holder NO offensive recoil", async () => {
      game.override.enemyAbility(AbilityId.BALL_FETCH);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerPokemon()!;
      const enemy = game.scene.getEnemyPokemon()!;
      enemy.hp = 1;

      game.move.select(MoveId.SWIFT);
      await game.move.forceEnemyMove(MoveId.CELEBRATE);
      await game.toEndOfTurn();

      expect(enemy.isFainted()).toBe(true);
      expect(player.hp).toBe(player.getMaxHp()); // KO excluded → no self-damage
    });

    it("CONTROL: a NON-KO hit vs a normal foe DOES recoil the holder", async () => {
      game.override.enemyAbility(AbilityId.BALL_FETCH);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerPokemon()!;
      const enemy = game.scene.getEnemyPokemon()!;

      game.move.select(MoveId.SWIFT);
      await game.move.forceEnemyMove(MoveId.CELEBRATE);
      await game.toEndOfTurn();

      expect(enemy.isFainted()).toBe(false);
      expect(player.hp).toBeLessThan(player.getMaxHp()); // offensive self-damage applied
    });

    it("vs ANOTHER Soul Linker, a non-KO hit gives NO offensive recoil", async () => {
      game.override.enemyAbility(SOUL_LINKER);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerPokemon()!;
      const enemy = game.scene.getEnemyPokemon()!;

      game.move.select(MoveId.SWIFT);
      await game.move.forceEnemyMove(MoveId.CELEBRATE);
      await game.toEndOfTurn();

      expect(enemy.isFainted()).toBe(false);
      expect(player.hp).toBe(player.getMaxHp()); // vs-another-Soul-Linker excluded
    });

    it("CONTROL: a normal attacker hitting the holder takes reflect damage", async () => {
      game.override.enemyAbility(AbilityId.BALL_FETCH).enemyMoveset([MoveId.SWIFT]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerPokemon()!;
      const enemy = game.scene.getEnemyPokemon()!;

      game.move.select(MoveId.CELEBRATE);
      await game.move.forceEnemyMove(MoveId.SWIFT);
      await game.toEndOfTurn();

      expect(player.isFainted()).toBe(false);
      expect(enemy.hp).toBeLessThan(enemy.getMaxHp()); // reflected the hit back
    });

    it("a Soul Linker attacker hitting the holder is NOT reflected (vs another Soul Linker)", async () => {
      game.override.enemyAbility(SOUL_LINKER).enemyMoveset([MoveId.SWIFT]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerPokemon()!;
      const enemy = game.scene.getEnemyPokemon()!;

      game.move.select(MoveId.CELEBRATE);
      await game.move.forceEnemyMove(MoveId.SWIFT);
      await game.toEndOfTurn();

      expect(player.isFainted()).toBe(false);
      expect(enemy.hp).toBe(enemy.getMaxHp()); // no reflect vs another Soul Linker
    });
  });

  // ---------------------------------------------------------------------------
  // Fix 4 — Pitfall (937): ONE 30% roll applies BOTH tags. The proc is sub-100%
  // (suppressed by the test RNG clamp), so the single-roll structure is proven by
  // WIRING here + a headless --real-rng runner separately.
  // ---------------------------------------------------------------------------
  describe("Pitfall (937)", () => {
    it("wires a SINGLE combined attr — not two independent AddBattlerTag rolls", () => {
      const move = allMoves[PITFALL_MOVE];
      expect(move, "Pitfall move resolved").toBeDefined();
      const combined = move.attrs.filter(a => a instanceof PitfallTrapAndAlwaysHitAttr);
      expect(combined.length, "exactly one combined trap+always-hit attr").toBe(1);
      // No standalone AddBattlerTagAttr rolling TRAPPED / ALWAYS_GET_HIT separately.
      const standaloneTagAdders = move.attrs.filter(
        a =>
          a instanceof AddBattlerTagAttr
          && (a.tagType === BattlerTagType.TRAPPED || a.tagType === BattlerTagType.ALWAYS_GET_HIT),
      );
      expect(standaloneTagAdders.length, "no independent trap/always-hit rolls").toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Fix 5 — Aurora Borealis (291): Ice STAB / Weather Ball Ice+double / Aurora
  // Veil without hail / Blizzard never misses.
  // ---------------------------------------------------------------------------
  describe("Aurora Borealis (291)", () => {
    it("grants Ice STAB to a non-Ice holder (Ice Beam on Normal-type Snorlax)", async () => {
      game.override
        .ability(AURORA_BOREALIS)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const iceBeam = allMoves[MoveId.ICE_BEAM];

      // StabAdd(ICE) surfaces as a 1.5x battle-power boost for the off-type holder.
      expect(iceBeam.calculateBattlePower(player, enemy)).toBe(Math.floor(iceBeam.power * 1.5));
    });

    it("control: WITHOUT Aurora Borealis, a Normal-type holder's Ice Beam gets no STAB", async () => {
      game.override
        .ability(AbilityId.BALL_FETCH)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.CELEBRATE]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const iceBeam = allMoves[MoveId.ICE_BEAM];

      expect(iceBeam.calculateBattlePower(player, enemy)).toBe(iceBeam.power);
    });

    it("Weather Ball becomes Ice-type for the holder with no weather", async () => {
      game.override
        .ability(AURORA_BOREALIS)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerPokemon()!;

      expect(player.getMoveType(allMoves[MoveId.WEATHER_BALL])).toBe(PokemonType.ICE);
    });

    it("Weather Ball power is DOUBLED for the holder with no weather (50 -> 100)", async () => {
      game.override
        .ability(AURORA_BOREALIS)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const weatherBall = allMoves[MoveId.WEATHER_BALL];

      // Acts as if in hail: base 50 doubled with no weather up. (Ice STAB stacks
      // on top since Weather Ball is now off-type Ice, so power is >= 2x, like the
      // Chloroplast Solar-Flare Weather Ball case.)
      expect(weatherBall.calculateBattlePower(player, enemy)).toBeGreaterThanOrEqual(weatherBall.power * 2);
    });

    it("Blizzard never misses for the holder regardless of weather", async () => {
      game.override
        .ability(AURORA_BOREALIS)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerPokemon()!;
      const enemy = game.scene.getEnemyPokemon()!;
      const blizzard = allMoves[MoveId.BLIZZARD];

      const matches = player
        .getAllActiveAbilityAttrs()
        .some(a => a instanceof ConditionalAlwaysHitAbAttr && a.matches(blizzard, player, enemy));
      expect(matches, "Aurora Borealis holder's Blizzard bypasses the accuracy check").toBe(true);
    });

    it("control: WITHOUT Aurora Borealis, Blizzard does NOT get always-hit", async () => {
      game.override
        .ability(AbilityId.BALL_FETCH)
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.scene.getPlayerPokemon()!;
      const enemy = game.scene.getEnemyPokemon()!;
      const blizzard = allMoves[MoveId.BLIZZARD];

      const matches = player
        .getAllActiveAbilityAttrs()
        .some(a => a instanceof ConditionalAlwaysHitAbAttr && a.matches(blizzard, player, enemy));
      expect(matches).toBe(false);
    });

    it("Aurora Veil is settable without hail/snow for the holder", async () => {
      game.override
        .ability(AURORA_BOREALIS)
        .moveset([MoveId.AURORA_VEIL])
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      game.move.select(MoveId.AURORA_VEIL);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.toEndOfTurn();

      expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)).toBeDefined();
    });

    it("control: WITHOUT Aurora Borealis, Aurora Veil fails with no hail/snow", async () => {
      game.override
        .ability(AbilityId.BALL_FETCH)
        .moveset([MoveId.AURORA_VEIL])
        .enemySpecies(SpeciesId.SNORLAX)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);

      game.move.select(MoveId.AURORA_VEIL);
      await game.move.forceEnemyMove(MoveId.SPLASH);
      await game.toEndOfTurn();

      expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)).toBeUndefined();
    });
  });
});
