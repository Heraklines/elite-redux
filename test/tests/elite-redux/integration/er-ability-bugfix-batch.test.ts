/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression batch covering four ER ability bugs:
//
//  (a) No Turning Back (668) — the one-time +1-to-all-stats boost RE-TRIGGERED
//      every time the holder re-crossed below ½ HP (e.g. after a Sitrus Berry
//      healed it above ½, the next hit boosted AGAIN). It must boost exactly
//      ONCE per battle, sharing the NO_RETREAT guard the self-trap tag uses.
//
//  (b) Effect Spore / Poison Touch — must be CONTACT-only. ER had added
//      non-contact tiers that procced off non-contact moves; removed (mirrors
//      the Poison Point fix). The vanilla contact behavior must remain.
//
//  (c) Purple Haze (853) — the scripted follow-up Poison Gas must resolve
//      immediately after the attack (forced FIRST), not re-ordered by speed,
//      and honor the intended 20 BP. POISON_GAS is rebalanced by ER into a
//      SPECIAL damaging move, so the cast deals damage; the power override
//      replaces its rebalanced power for this cast alone.
//
//  (d) Locust Swarm / hp-threshold-form-change — the archetype is now
//      bidirectional (transform below threshold + REVERT once HP recovers
//      above it), and a missing target form is flagged (console.warn) rather
//      than silently swallowed.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { BattleScene } from "#app/battle-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import { HpThresholdFormChangeAbAttr } from "#data/elite-redux/archetypes/hp-threshold-form-change";
import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function mockRngMin(): () => void {
  const saved = BattleScene.prototype.randBattleSeedInt;
  BattleScene.prototype.randBattleSeedInt = (_range, min = 0) => min;
  return () => {
    BattleScene.prototype.randBattleSeedInt = saved;
  };
}

describe.skipIf(!RUN)("ER ability bugfix batch", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // (a) No Turning Back — boosts exactly once, even across a re-cross.
  // ===========================================================================
  describe("(a) No Turning Back (668) one-time boost guard", () => {
    it("boosts all stats on the first ≤½ HP crossing", async () => {
      game.override
        .battleStyle("single")
        .ability(ER_ID_MAP.abilities[668] as AbilityId)
        .moveset([MoveId.SPLASH])
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.TACKLE)
        .criticalHits(false);
      await game.classicMode.startBattle([SpeciesId.SNORLAX]);

      const user = game.scene.getPlayerPokemon()!;
      user.hp = Math.floor(user.getMaxHp() / 2) + 1;

      game.move.use(MoveId.SPLASH);
      await game.toEndOfTurn();

      for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) {
        expect(user.getStatStage(stat)).toBe(1);
      }
      expect(user.getTag(BattlerTagType.NO_RETREAT)).toBeDefined();
    });

    it("does NOT boost again after a heal re-crosses below ½ HP (Sitrus repro)", async () => {
      // Bulky holder (Snorlax) vs a moderately stronger enemy so a single hit
      // deals comfortably more than the +1-DEF reduction can erase — i.e. BOTH
      // the first and the post-heal crossing reliably land below half without
      // OHKO-ing the holder.
      game.override
        .battleStyle("single")
        .ability(ER_ID_MAP.abilities[668] as AbilityId)
        .moveset([MoveId.SPLASH])
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.TACKLE)
        .enemyLevel(60)
        .startingLevel(50)
        .criticalHits(false);
      await game.classicMode.startBattle([SpeciesId.SNORLAX]);

      const user = game.scene.getPlayerPokemon()!;
      const half = Math.floor(user.getMaxHp() / 2);

      // Heal the holder so a single Tackle drops it from just-above-half to
      // below half WITHOUT fainting it. The margin must be SMALLER than the
      // (DEF+1-reduced) Tackle damage so the SECOND crossing still lands; a
      // small fixed margin comfortably satisfies that for a lvl-60 Tackle.
      const margin = 3;

      // First crossing: just above half → a Tackle drops below → boost fires.
      user.hp = half + margin;
      game.move.use(MoveId.SPLASH);
      await game.toEndOfTurn();
      expect(user.hp).toBeLessThanOrEqual(half);
      expect(user.isFainted()).toBe(false);
      expect(user.getStatStage(Stat.ATK)).toBe(1);
      expect(user.getTag(BattlerTagType.NO_RETREAT)).toBeDefined();

      // Simulate a Sitrus-style heal back ABOVE half, then a second hit that
      // re-crosses below half. The NO_RETREAT guard must suppress a 2nd boost.
      user.hp = half + margin;
      game.move.use(MoveId.SPLASH);
      await game.toEndOfTurn();

      // Sanity: the second hit really did re-cross below half (so the guard is
      // actually exercised, not trivially satisfied by a missed re-cross).
      expect(user.hp).toBeLessThanOrEqual(half);

      // Still +1 (NOT +2) on every stat — the boost fired exactly once.
      for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) {
        expect(user.getStatStage(stat)).toBe(1);
      }
    });
  });

  // ===========================================================================
  // (b) Effect Spore / Poison Touch — contact-only.
  // ===========================================================================
  describe("(b) Effect Spore / Poison Touch contact gating", () => {
    it("Effect Spore — NOT statused by a non-contact DAMAGING move (Water Gun)", async () => {
      const restoreRng = mockRngMin();
      game.override
        .battleStyle("single")
        .ability(AbilityId.NO_GUARD)
        .enemyAbility(AbilityId.EFFECT_SPORE)
        .enemyHasPassiveAbility(false)
        .enemySpecies(SpeciesId.PARASECT)
        .enemyMoveset(MoveId.SPLASH)
        .moveset(MoveId.WATER_GUN) // non-contact, damaging
        .enemyLevel(50)
        .startingLevel(50)
        .criticalHits(false);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      game.move.use(MoveId.WATER_GUN);
      await game.toEndOfTurn();
      restoreRng();
      // Effect Spore is contact-only post-fix → a ranged attacker is untouched.
      expect(player.status).toBeFalsy();
    });

    it("Poison Touch — NOT poisoned by a non-contact DAMAGING move on defense", async () => {
      const restoreRng = mockRngMin();
      game.override
        .battleStyle("single")
        .ability(AbilityId.NO_GUARD)
        .enemyAbility(AbilityId.POISON_TOUCH)
        .enemyHasPassiveAbility(false)
        .enemySpecies(SpeciesId.GRIMER)
        .enemyMoveset(MoveId.SPLASH)
        .moveset(MoveId.WATER_GUN) // non-contact, damaging
        .enemyLevel(50)
        .startingLevel(50)
        .criticalHits(false);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const player = game.field.getPlayerPokemon();
      game.move.use(MoveId.WATER_GUN);
      await game.toEndOfTurn();
      restoreRng();
      // Poison Touch has NO defensive non-contact tier post-fix.
      expect(player.status).toBeFalsy();
    });

    it("Poison Touch — DOES poison on offense via a CONTACT move (Tackle)", async () => {
      const restoreRng = mockRngMin();
      game.override
        .battleStyle("single")
        .ability(AbilityId.POISON_TOUCH)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyHasPassiveAbility(false)
        .enemySpecies(SpeciesId.SHUCKLE)
        .enemyMoveset(MoveId.SPLASH)
        .moveset(MoveId.TACKLE) // contact
        .enemyLevel(50)
        .startingLevel(50)
        .criticalHits(false);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      game.move.use(MoveId.TACKLE);
      await game.toEndOfTurn();
      restoreRng();
      // The offense-side contact proc remains (Poison Touch "also works on offense").
      expect(enemy.status?.effect).toBeDefined();
    });
  });

  // ===========================================================================
  // (c) Purple Haze — scripted follow-up resolves FIRST and honors 20 BP.
  // ===========================================================================
  describe("(c) Purple Haze scripted follow-up", () => {
    it("the archetype enqueues the follow-up with MovePhaseTimingModifier.FIRST", async () => {
      // Attach the archetype to a vanilla ability and observe the MovePhase it
      // unshifts: it must carry timingModifier FIRST so it resolves right after
      // the attack instead of being speed-sorted into turn order.
      const ability = allAbilities.find(a => a?.id === AbilityId.BALL_FETCH)!;
      const original = [...(ability as unknown as { attrs: unknown[] }).attrs];
      const attr = new PostAttackScriptedMoveAbAttr({ moveId: MoveId.POISON_GAS, power: 20 });
      (ability as unknown as { attrs: unknown[] }).attrs.push(attr);

      try {
        game.override
          .battleStyle("single")
          .ability(AbilityId.BALL_FETCH)
          .moveset([MoveId.TACKLE])
          .enemySpecies(SpeciesId.SHUCKLE)
          .enemyAbility(AbilityId.BALL_FETCH)
          .enemyMoveset(MoveId.SPLASH)
          .enemyLevel(50)
          .startingLevel(50)
          .criticalHits(false);
        await game.classicMode.startBattle(SpeciesId.SNORLAX);

        const unshiftSpy = vi.spyOn(game.scene.phaseManager, "unshiftNew");

        game.move.use(MoveId.TACKLE);
        await game.toEndOfTurn();

        const moveCalls = unshiftSpy.mock.calls.filter(c => c[0] === "MovePhase");
        // At least one scripted MovePhase was enqueued, and it was POISON_GAS
        // with the FIRST timing modifier (the 6th arg).
        const poisonGasCall = moveCalls.find(c => {
          const moveArg = c[3] as { getMove?: () => { id: number } } | undefined;
          return moveArg?.getMove?.().id === MoveId.POISON_GAS;
        });
        expect(poisonGasCall).toBeDefined();
        // args: (name, pokemon, targets, move, useMode, timingModifier)
        expect(poisonGasCall![4]).toBe(MoveUseMode.INDIRECT);
        // FIRST = 2 (MovePhaseTimingModifier.FIRST).
        expect(poisonGasCall![5]).toBe(2);
      } finally {
        (ability as unknown as { attrs: unknown[] }).attrs = original;
      }
    });

    it("the scripted Poison Gas is a damaging cast whose power is overridden to 20 BP", async () => {
      // POISON_GAS is rebalanced into a SPECIAL DAMAGING move by ER (see
      // init-elite-redux-vanilla-move-patches.ts), so the scripted follow-up
      // deals damage; the `power: 20` override replaces its rebalanced power
      // for this cast alone. We assert (1) the registered move is damaging and
      // (2) the power-overridden clone the archetype casts reports exactly 20.
      const poisonGas = allMoves[MoveId.POISON_GAS];
      expect(poisonGas.power).toBeGreaterThan(0); // damaging post-ER-patch

      // The archetype casts via scriptedPokemonMove(moveId, power); reproduce
      // that clone and confirm the overridden power is 20 (not the ~65 BP base).
      const { scriptedPokemonMove } = await import("#data/elite-redux/archetypes/scripted-move-util");
      const scripted = scriptedPokemonMove(MoveId.POISON_GAS, 20);
      expect(scripted.getMove().power).toBe(20);
      // The clone preserves type/category so it still deals Poison damage.
      expect(scripted.getMove().type).toBe(poisonGas.type);
      expect(scripted.getMove().category).toBe(poisonGas.category);
    });

    it("the scripted Poison Gas follow-up actually executes after the attack", async () => {
      const ability = allAbilities.find(a => a?.id === AbilityId.BALL_FETCH)!;
      const original = [...(ability as unknown as { attrs: unknown[] }).attrs];
      (ability as unknown as { attrs: unknown[] }).attrs.push(
        new PostAttackScriptedMoveAbAttr({ moveId: MoveId.POISON_GAS, power: 20 }),
      );

      try {
        game.override
          .battleStyle("single")
          .ability(AbilityId.BALL_FETCH)
          .moveset([MoveId.TACKLE])
          .enemySpecies(SpeciesId.SHUCKLE)
          .enemyAbility(AbilityId.BALL_FETCH)
          .enemyMoveset(MoveId.SPLASH)
          .enemyLevel(100)
          .startingLevel(100)
          .criticalHits(false);
        await game.classicMode.startBattle(SpeciesId.SNORLAX);

        // Spy on MovePhase creation to confirm the scripted POISON_GAS phase ran.
        const createSpy = vi.spyOn(game.scene.phaseManager, "unshiftNew");

        game.move.use(MoveId.TACKLE);
        await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
        await game.toEndOfTurn();

        const ran = createSpy.mock.calls.some(c => {
          if (c[0] !== "MovePhase") {
            return false;
          }
          const moveArg = c[3] as { getMove?: () => { id: number } } | undefined;
          return moveArg?.getMove?.().id === MoveId.POISON_GAS;
        });
        expect(ran).toBe(true);
      } finally {
        (ability as unknown as { attrs: unknown[] }).attrs = original;
      }
    });
  });

  // ===========================================================================
  // (d) hp-threshold-form-change — bidirectional + flags missing form.
  // ===========================================================================
  describe("(d) Locust Swarm / hp-threshold-form-change", () => {
    it("Locust Swarm (884) wires the HP-threshold form-change archetype", () => {
      const pkrg = ER_ID_MAP.abilities[884];
      expect(pkrg).toBeDefined();
      const ability = allAbilities[pkrg as number];
      expect(ability).toBeDefined();
      const names = ability.attrs.map(a => a.constructor.name);
      expect(names).toContain("HpThresholdFormChangeAbAttr");
    });

    it("flags a missing target form (console.warn) instead of a silent no-op", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const attr = new HpThresholdFormChangeAbAttr({ hpThreshold: 0.25, targetFormKey: "hivemind" });

      // A species with no "hivemind" form (Snorlax has only the base form).
      const species = { speciesId: SpeciesId.SNORLAX, forms: [{ formKey: "" }] };
      const pokemon = {
        species,
        formIndex: 0,
        hp: 1,
        status: null,
        isFainted: () => false,
        getMaxHp: () => 100,
      };

      // Below threshold + form absent → apply() must warn (once) and not throw.
      attr.apply({ pokemon, simulated: false } as never);
      attr.apply({ pokemon, simulated: false } as never);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("hivemind");
    });

    it("is bidirectional: transform below threshold, revert above it", () => {
      const attr = new HpThresholdFormChangeAbAttr({ hpThreshold: 0.25, targetFormKey: "hivemind" });
      const forms = [{ formKey: "" }, { formKey: "hivemind" }];

      // Base form (index 0), HP at/below threshold → wants to transform.
      const lowBase = {
        species: { speciesId: 1, forms },
        formIndex: 0,
        hp: 20,
        isFainted: () => false,
        getMaxHp: () => 100,
      };
      expect(attr.canApply({ pokemon: lowBase } as never)).toBe(true);

      // Already in hivemind, HP still low → no-op (no transform, no revert).
      const lowHive = { ...lowBase, formIndex: 1 };
      expect(attr.canApply({ pokemon: lowHive } as never)).toBe(false);

      // In hivemind, HP recovered above threshold → wants to REVERT (the path
      // that was previously missing — holder stayed stuck in hivemind form).
      const highHive = {
        species: { speciesId: 1, forms },
        formIndex: 1,
        hp: 80,
        isFainted: () => false,
        getMaxHp: () => 100,
      };
      expect(attr.canApply({ pokemon: highHive } as never)).toBe(true);

      // Base form, HP high → nothing to do.
      const highBase = { ...highHive, formIndex: 0 };
      expect(attr.canApply({ pokemon: highBase } as never)).toBe(false);
    });
  });
});
