/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 2: the engine sites that the shared L1 / L2 suites cannot reach for the eight classes of the chunk.
//
// Presence flags are never dispatched, and the calc hooks of this chunk are asked inside the type chart, inside canSetStatus
// and when the holder attacks into a protection, which no scenario template of the battle twin visits. Here each of them is
// driven AT its engine site,
//
//   original  the live ability (for example Scrappy)
//   rebuilt   the same ability rebuilt from its declaration (what a staff blueprint compiles to), where the declaration is live
//   control   Ball Fetch (no such attr)
//
// The rebuilt run must equal the original one and the control must differ. The control is what proves the scenario really reaches
// the site, so equal results are never two empty recordings. The three parked classes (Demolitionist, Multitype-style flags) have
// no live declaration yet, so only original and control are compared for them.
import type { Ability } from "#abilities/ability";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { GameManager } from "#test/framework/game-manager";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allocateShadowId } from "#test/tests/elite-redux/decomp/harness/twin";
import { BooleanHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Ids from the live game (dump of the live attrs, see the declarations).
const PINNACLE_BLADE = 5401;
const PUNCTURE = 5942;
const DEMOLITIONIST = 5320;
const INFILTRATOR = 151;
const THUNDERCALL = 5126;
const MAGIC_BOUNCE = 156;
const CONJURER_OF_DECEIT = 5464;
const SCRAPPY = 113;
const PHANTOM_PAIN = 5188;
const CORROSION = 212;
const MYCELIUM_MIGHT = 298;
const OVERCHARGE = 5087;
const DISGUISE = 209;
const BALL_FETCH = AbilityId.BALL_FETCH as number;

type Holder = ReturnType<GameManager["field"]["getPlayerPokemon"]>;
interface Ctx {
  readonly game: GameManager;
  readonly holder: Holder;
  readonly foe: ReturnType<GameManager["field"]["getEnemyPokemon"]>;
}

describe("B07 chunk 2 at the engine sites", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    unregisterShadows();
    vi.restoreAllMocks();
  });

  /** Rebuilds a live ability from its declarations and puts it into the ability list under a shadow id. */
  function shadowOf(abilityId: number, expectedRebuilt: number[]): number {
    const original = allAbilities[abilityId] as Ability;
    const shadowId = allocateShadowId();
    const result = rebuildAbility(original, shadowId, { registry: declRegistry });
    for (const index of expectedRebuilt) {
      expect(result.rebuilt, `${original.name} attr ${index} must be rebuilt`).toContain(index);
    }
    registerShadow(shadowId, result.ability);
    return shadowId;
  }

  /** A one-battle observation: starts a battle whose holder has `abilityId`, then reads something. */
  async function observe<T>(abilityId: number, setup: { readonly foe?: SpeciesId }, read: (ctx: Ctx) => T): Promise<T> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(abilityId as AbilityId)
      .startingLevel(100)
      .enemySpecies(setup.foe ?? SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    return read({ game, holder: game.field.getPlayerPokemon(), foe: game.field.getEnemyPokemon() });
  }

  /** original / rebuilt / control for a direct read. */
  async function threeWays<T>(
    abilityId: number,
    rebuiltIndex: number,
    read: (ctx: Ctx) => T,
    setup: { readonly foe?: SpeciesId } = {},
  ): Promise<{ original: T; rebuilt: T; control: T }> {
    const shadow = shadowOf(abilityId, [rebuiltIndex]);
    const original = await observe(abilityId, setup, read);
    const rebuilt = await observe(shadow, setup, read);
    const control = await observe(BALL_FETCH, setup, read);
    return { original, rebuilt, control };
  }

  // ---------------------------------------------------------------------------------------------
  // IgnoreProtectByFlagAbAttr (a presence flag with one setting): Move.doesFlagEffectApply(IGNORE_PROTECT)
  // ---------------------------------------------------------------------------------------------
  for (const [name, abilityId, attrIndex] of [
    ["Pinnacle Blade", PINNACLE_BLADE, 1],
    ["Puncture", PUNCTURE, 2],
  ] as const) {
    it(`IgnoreProtectByFlagAbAttr: a slicing move goes through protection, a non-slicing one does not (${name})`, async () => {
      const read = ({ holder, foe }: Ctx) => ({
        slicing: allMoves[MoveId.SLASH].doesFlagEffectApply({
          flag: MoveFlags.IGNORE_PROTECT,
          user: holder,
          target: foe,
        }),
        nonSlicing: allMoves[MoveId.TACKLE].doesFlagEffectApply({
          flag: MoveFlags.IGNORE_PROTECT,
          user: holder,
          target: foe,
        }),
      });
      const result = await threeWays(abilityId, attrIndex, read);
      expect(result.original).toEqual({ slicing: true, nonSlicing: false });
      expect(result.rebuilt).toEqual(result.original);
      expect(result.control).toEqual({ slicing: false, nonSlicing: false });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // IgnoreProtectFirstTurnAbAttr (parked): the same engine site, before and after the holder has used a move
  // ---------------------------------------------------------------------------------------------
  it("IgnoreProtectFirstTurnAbAttr: every move goes through protection until the holder has used a move (Demolitionist)", async () => {
    const read = ({ holder, foe }: Ctx) => {
      const asks = () =>
        allMoves[MoveId.WATER_GUN].doesFlagEffectApply({ flag: MoveFlags.IGNORE_PROTECT, user: holder, target: foe });
      const before = asks();
      holder.summonData.moveHistory.push({ move: MoveId.SPLASH } as never);
      return { before, after: asks() };
    };
    expect(await observe(DEMOLITIONIST, {}, read)).toEqual({ before: true, after: false });
    expect(await observe(BALL_FETCH, {}, read)).toEqual({ before: false, after: false });
  });

  // ---------------------------------------------------------------------------------------------
  // InfiltratorAbAttr: the dispatch itself, and Pokemon.isSafeguarded
  // ---------------------------------------------------------------------------------------------
  for (const [name, abilityId, attrIndex] of [
    ["Infiltrator", INFILTRATOR, 0],
    ["Thundercall", THUNDERCALL, 1],
  ] as const) {
    it(`InfiltratorAbAttr: the bypass is set, an earlier bypass stays, and Safeguard is bypassed (${name})`, async () => {
      const read = ({ holder, foe }: Ctx) => {
        const fresh = new BooleanHolder(false);
        applyAbAttrs("InfiltratorAbAttr", { pokemon: holder, bypassed: fresh });
        const already = new BooleanHolder(true);
        applyAbAttrs("InfiltratorAbAttr", { pokemon: holder, bypassed: already });
        globalScene.arena.addTag(ArenaTagType.SAFEGUARD, 5, MoveId.SAFEGUARD, foe.id, ArenaTagSide.ENEMY);
        return { fresh: fresh.value, already: already.value, safeguarded: foe.isSafeguarded(holder) };
      };
      const result = await threeWays(abilityId, attrIndex, read);
      expect(result.original).toEqual({ fresh: true, already: true, safeguarded: false });
      expect(result.rebuilt).toEqual(result.original);
      expect(result.control).toEqual({ fresh: false, already: true, safeguarded: true });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // ReflectStatusMoveAbAttr: the presence query of isMoveReflectableBy and the dispatch of MoveReflectPhase
  // ---------------------------------------------------------------------------------------------
  for (const [name, abilityId, attrIndex] of [
    ["Magic Bounce", MAGIC_BOUNCE, 0],
    ["Conjurer Of Deceit", CONJURER_OF_DECEIT, 1],
  ] as const) {
    it(`ReflectStatusMoveAbAttr: the move is queued again with the holder as user, aimed at the original user (${name})`, async () => {
      const read = ({ holder, foe }: Ctx) => {
        const queued: unknown[][] = [];
        vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
          queued.push(args);
        }) as never);
        applyAbAttrs("ReflectStatusMoveAbAttr", { pokemon: holder, opponent: foe, move: allMoves[MoveId.TOXIC] });
        const call = queued[0] as [string, unknown, number[], { moveId: number }, number, number] | undefined;
        return {
          present: holder.hasAbilityWithAttr("ReflectStatusMoveAbAttr"),
          queuedCount: queued.length,
          phase: call?.[0],
          userIsHolder: call?.[1] === holder,
          targets: call?.[2],
          moveId: call?.[3]?.moveId,
        };
      };
      const result = await threeWays(abilityId, attrIndex, read);
      expect(result.original.present).toBe(true);
      expect(result.original.queuedCount).toBe(1);
      expect(result.original.phase).toBe("MovePhase");
      expect(result.original.userIsHolder).toBe(true);
      expect(result.original.moveId).toBe(MoveId.TOXIC);
      expect(result.rebuilt).toEqual(result.original);
      expect(result.control).toEqual({
        present: false,
        queuedCount: 0,
        phase: undefined,
        userIsHolder: false,
        targets: undefined,
        moveId: undefined,
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // IgnoreTypeImmunityAbAttr: Pokemon.checkIgnoreTypeImmunity, asked for each (move type, defender type) pair
  // ---------------------------------------------------------------------------------------------
  const typeImmunityPairs = ({ holder, foe }: Ctx) => {
    const check = (moveType: PokemonType, defenderType: PokemonType, ignoreSourceAbility = false): boolean =>
      (
        foe as unknown as {
          checkIgnoreTypeImmunity(p: object): boolean;
        }
      ).checkIgnoreTypeImmunity({ source: holder, simulated: true, moveType, defenderType, ignoreSourceAbility });
    return {
      normalOnGhost: check(PokemonType.NORMAL, PokemonType.GHOST),
      fightingOnGhost: check(PokemonType.FIGHTING, PokemonType.GHOST),
      ghostOnGhost: check(PokemonType.GHOST, PokemonType.GHOST),
      normalOnSteel: check(PokemonType.NORMAL, PokemonType.STEEL),
      ghostOnNormal: check(PokemonType.GHOST, PokemonType.NORMAL),
      normalOnGhostAbilityIgnored: check(PokemonType.NORMAL, PokemonType.GHOST, true),
    };
  };
  it("IgnoreTypeImmunityAbAttr: Normal and Fighting moves get past a Ghost's immunity (Scrappy)", async () => {
    const result = await threeWays(SCRAPPY, 0, typeImmunityPairs);
    expect(result.original).toEqual({
      normalOnGhost: true,
      fightingOnGhost: true,
      ghostOnGhost: false,
      normalOnSteel: false,
      ghostOnNormal: false,
      normalOnGhostAbilityIgnored: false,
    });
    expect(result.rebuilt).toEqual(result.original);
    expect(result.control).toEqual({
      normalOnGhost: false,
      fightingOnGhost: false,
      ghostOnGhost: false,
      normalOnSteel: false,
      ghostOnNormal: false,
      normalOnGhostAbilityIgnored: false,
    });
  });
  it("IgnoreTypeImmunityAbAttr: Ghost moves get past a Normal's immunity (Phantom Pain)", async () => {
    const result = await threeWays(PHANTOM_PAIN, 0, typeImmunityPairs);
    expect(result.original).toEqual({
      normalOnGhost: false,
      fightingOnGhost: false,
      ghostOnGhost: false,
      normalOnSteel: false,
      ghostOnNormal: true,
      normalOnGhostAbilityIgnored: false,
    });
    expect(result.rebuilt).toEqual(result.original);
    expect(result.control.ghostOnNormal).toBe(false);
  });

  // ---------------------------------------------------------------------------------------------
  // IgnoreTypeStatusEffectImmunityAbAttr: Pokemon.canSetStatus
  // ---------------------------------------------------------------------------------------------
  const statusReads = ({ holder, foe }: Ctx) => {
    const can = (status: StatusEffect, category: MoveCategory | null): boolean =>
      foe.canSetStatus(status, true, false, holder, false, false, category);
    return {
      poison: can(StatusEffect.POISON, MoveCategory.STATUS),
      toxic: can(StatusEffect.TOXIC, MoveCategory.PHYSICAL),
      burn: can(StatusEffect.BURN, MoveCategory.STATUS),
      burnByDamagingMove: can(StatusEffect.BURN, MoveCategory.PHYSICAL),
      paralysis: can(StatusEffect.PARALYSIS, MoveCategory.STATUS),
      sleep: can(StatusEffect.SLEEP, MoveCategory.STATUS),
    };
  };
  it("IgnoreTypeStatusEffectImmunityAbAttr: poison gets past a Steel type, burn and paralysis do not (Corrosion)", async () => {
    const result = await threeWays(CORROSION, 1, statusReads, { foe: SpeciesId.KLINK });
    expect(result.original).toEqual({
      poison: true,
      toxic: true,
      burn: true,
      burnByDamagingMove: true,
      paralysis: true,
      sleep: true,
    });
    expect(result.rebuilt).toEqual(result.original);
    expect(result.control.poison).toBe(false);
    expect(result.control.toxic).toBe(false);
  });
  it("IgnoreTypeStatusEffectImmunityAbAttr: only a STATUS move burns a Fire type (Mycelium Might)", async () => {
    const result = await threeWays(MYCELIUM_MIGHT, 4, statusReads, { foe: SpeciesId.CHARMANDER });
    expect(result.original.burn).toBe(true);
    expect(result.original.burnByDamagingMove).toBe(false);
    expect(result.rebuilt).toEqual(result.original);
    expect(result.control.burn).toBe(false);
    expect(result.control.burnByDamagingMove).toBe(false);
  });
  it("IgnoreTypeStatusEffectImmunityAbAttr: paralysis versus Electric is never asked, so Overcharge does nothing (suspected game bug, recorded)", async () => {
    const result = await threeWays(OVERCHARGE, 1, statusReads, { foe: SpeciesId.PIKACHU });
    expect(result.original.paralysis).toBe(false);
    expect(result.rebuilt).toEqual(result.original);
    expect(result.control.paralysis).toBe(false);
  });

  // ---------------------------------------------------------------------------------------------
  // NoFusionAbilityAbAttr and NoTransformAbilityAbAttr (parked): Pokemon.canApplyAbilitySource
  // ---------------------------------------------------------------------------------------------
  it("NoFusionAbilityAbAttr and NoTransformAbilityAbAttr: Disguise stops working on a fused and on a transformed Pokemon", async () => {
    const read = ({ holder }: Ctx) => {
      const ability = holder.getAbility();
      const works = () => holder.canApplyAbilitySource(ability, false, 0, false, false);
      const normal = works();
      const fused = vi.spyOn(holder, "isFusion").mockReturnValue(true);
      const whileFused = works();
      fused.mockReturnValue(false);
      const transformed = vi.spyOn(holder, "isTransformed").mockReturnValue(true);
      const whileTransformed = works();
      transformed.mockReturnValue(false);
      return { normal, whileFused, whileTransformed };
    };
    expect(await observe(DISGUISE, {}, read)).toEqual({ normal: true, whileFused: false, whileTransformed: false });
    expect(await observe(BALL_FETCH, {}, read)).toEqual({ normal: true, whileFused: true, whileTransformed: true });
  });
});
