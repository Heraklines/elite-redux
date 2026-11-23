/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 3, the eight Tier B classes: PostAttackChangeTargetTypeAbAttr, PostAttackContactSuppressTargetAbilityAbAttr,
// PostAttackRemoveTargetTypeAbAttr, PostAttackScriptedMoveAbAttr, PostAttackSetTerrainByMoveTypeAbAttr,
// PostAttackSetHazardByMoveTypeAbAttr, PostDamageForceAttackerOutAbAttr and PostDefendChangeAttackerTypeAbAttr.
// The shared L1 grid has no pulse, dance or contact-ignoring states, no poisoned or Terastallized target, no hit result other than
// EFFECTIVE and no move history, so this test drives canApply of
//   (a) the FROZEN original rule, written here from the source as it was before the split,
//   (b) the refactored class (guards && gate && residual),
//   (c) the REBUILD whose gate is the library tree of the binding (only where the binding is not legacy),
// over every move of the game and the states above, and compares all of them (results and random draws).
import { PostAttackRemoveTargetTypeAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { PostAttackRemoveTargetTypeAbAttr as ArchetypeRemoveTargetType } from "#data/elite-redux/archetypes/post-attack-remove-target-type";
import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setStatusOf, setTypesOf } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const moduleOf = (name: string): DeclModule => declRegistry.get(name) as DeclModule;
const sitesOf = (name: string) => allAttrSites().filter(site => site.className === name);
const everyMove = (): Move[] => (allMoves as (Move | undefined)[]).filter((m): m is Move => m !== undefined && m.id !== MoveId.NONE);
type Any = Record<string, any>; // biome-ignore lint/suspicious/noExplicitAny: reads private fields of the attrs under test

/** The rebuild of a site, or undefined when its gate is a written legacy binding. */
function rebuildOf(name: string, site: ReturnType<typeof sitesOf>[number]) {
  if (getBinding(site.abilityId, site.attrIndex, "gate")?.spec === undefined) {
    return undefined;
  }
  return recomposeAttr(moduleOf(name), site.attr, site.abilityId, site.attrIndex);
}

describe("B10 chunk 3: the gates of the eight Tier B classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every user has the expected number of attrs and the expected bindings", () => {
    const counts: Record<string, number> = {
      PostAttackChangeTargetTypeAbAttr: 3,
      PostAttackContactSuppressTargetAbilityAbAttr: 1,
      PostAttackRemoveTargetTypeAbAttr: 6,
      PostAttackScriptedMoveAbAttr: 19,
      PostAttackSetTerrainByMoveTypeAbAttr: 2,
      PostAttackSetHazardByMoveTypeAbAttr: 2,
      PostDamageForceAttackerOutAbAttr: 2,
      PostDefendChangeAttackerTypeAbAttr: 2,
    };
    for (const [name, count] of Object.entries(counts)) {
      const sites = sitesOf(name);
      expect(sites.length, name).toBe(count);
      for (const site of sites) {
        expect(getBinding(site.abilityId, site.attrIndex, "gate"), `${site.abilityName} ${name}`).toBeDefined();
      }
    }
    // Two classes share one name: Refrigerator attr 3 is the archetype one and is a written legacy gate.
    const removeSites = sitesOf("PostAttackRemoveTargetTypeAbAttr");
    const archetype = removeSites.filter(site => site.attr instanceof ArchetypeRemoveTargetType);
    expect(archetype.map(site => `${site.abilityName}:${site.attrIndex}`)).toEqual(["Refrigerator:3"]);
    expect(removeSites.filter(site => site.attr instanceof PostAttackRemoveTargetTypeAbAttr).length).toBe(5);
    expect(getBinding(archetype[0].abilityId, 3, "gate")?.legacyClosure).toBeDefined();
  });

  it("move.is('AttackMove') is NOT 'category is not STATUS': nine status-class moves differ, so the class test stays a guard", () => {
    const odd = everyMove().filter(move => move.is("AttackMove") !== (move.category !== MoveCategory.STATUS));
    expect(odd.map(move => move.name).sort()).toEqual(
      ["Captivate", "Decorate", "Flash", "Growl", "Nightmare", "Octolock", "Poison Gas", "Splash", "Whirlwind"].sort(),
    );
    expect(odd.every(move => !move.is("AttackMove") && move.category !== MoveCategory.STATUS)).toBe(true);
  });

  it("PostAttackChangeTargetType: frozen original, class and rebuild agree for every move; apply sets one type", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const name = "PostAttackChangeTargetTypeAbAttr";
    const frozen = (a: Any, p: Any): boolean => {
      if (!(p.move.category !== MoveCategory.STATUS)) {
        return false;
      }
      if (!p.opponent) {
        return false;
      }
      if (a.contactOnly && !p.move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: p.pokemon, target: p.opponent })) {
        return false;
      }
      if (a.requireFlag !== undefined && !p.move.hasFlag(a.requireFlag)) {
        return false;
      }
      return true;
    };
    for (const site of sitesOf(name)) {
      const rebuilt = rebuildOf(name, site);
      expect(rebuilt, site.abilityName).toBeDefined();
      for (const move of everyMove()) {
        for (const opponent of [foe, undefined]) {
          const params = { pokemon: holder, opponent, move, hitResult: HitResult.EFFECTIVE, simulated: false } as never;
          const want = frozen(site.attr as Any, params);
          expect(site.attr.canApply(params), `${site.abilityName} class ${move.name}`).toBe(want);
          expect(rebuilt!.canApply(params), `${site.abilityName} rebuild ${move.name}`).toBe(want);
        }
      }
      // apply: a preview changes nothing, a real call writes exactly one type
      const tackle = allMoves[MoveId.TACKLE];
      setTypesOf(foe, [PokemonType.NORMAL, PokemonType.FLYING]);
      site.attr.apply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 1, simulated: true } as never);
      expect(foe.summonData.types, `${site.abilityName} preview`).toEqual([PokemonType.NORMAL, PokemonType.FLYING]);
      for (const attr of [site.attr, rebuilt!]) {
        setTypesOf(foe, [PokemonType.NORMAL, PokemonType.FLYING]);
        attr.apply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 1, simulated: false } as never);
        const expected = (site.attr as Any).newType === "moveType" ? holder.getMoveType(tackle) : (site.attr as Any).newType;
        expect(foe.summonData.types, site.abilityName).toEqual([expected]);
      }
    }
  });

  it("PostAttackContactSuppressTargetAbility: frozen original, class and rebuild agree over target states; apply suppresses once", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const name = "PostAttackContactSuppressTargetAbilityAbAttr";
    const site = sitesOf(name)[0];
    const rebuilt = rebuildOf(name, site)!;
    const frozen = (a: Any, p: Any): boolean => {
      const { move, pokemon, opponent } = p;
      if (!opponent || opponent.isFainted()) {
        return false;
      }
      if (!move.is("AttackMove")) {
        return false;
      }
      if (a.contactOnly && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: pokemon, target: opponent })) {
        return false;
      }
      if (a.requireTargetStatus !== null) {
        const status = opponent.status?.effect ?? StatusEffect.NONE;
        if (!a.requireTargetStatus.includes(status)) {
          return false;
        }
      }
      if (opponent.summonData?.abilitySuppressed) {
        return false;
      }
      return true;
    };
    const statuses = [StatusEffect.NONE, StatusEffect.POISON, StatusEffect.TOXIC, StatusEffect.PARALYSIS, StatusEffect.BURN, StatusEffect.SLEEP];
    for (const status of statuses) {
      for (const suppressed of [false, true]) {
        for (const fainted of [false, true]) {
          setStatusOf(foe, status);
          foe.summonData.abilitySuppressed = suppressed;
          vi.spyOn(foe, "isFainted").mockReturnValue(fainted);
          for (const move of everyMove()) {
            const params = { pokemon: holder, opponent: foe, move, hitResult: 1, simulated: false } as never;
            const want = frozen(site.attr as Any, params);
            const label = `${StatusEffect[status]} suppressed=${suppressed} fainted=${fainted} ${move.name}`;
            expect(site.attr.canApply(params), `class ${label}`).toBe(want);
            expect(rebuilt.canApply(params), `rebuild ${label}`).toBe(want);
          }
          vi.restoreAllMocks();
        }
      }
    }
    expect(site.attr.canApply({ pokemon: holder, opponent: undefined, move: allMoves[MoveId.TACKLE], hitResult: 1, simulated: false } as never)).toBe(false);
    foe.summonData.abilitySuppressed = false;
    site.attr.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], hitResult: 1, simulated: true } as never);
    expect(foe.summonData.abilitySuppressed).toBe(false);
    rebuilt.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], hitResult: 1, simulated: false } as never);
    expect(foe.summonData.abilitySuppressed).toBe(true);
  });

  it("PostAttackRemoveTargetType (ab-attrs class): frozen original, class and rebuild agree over target types, Tera and self", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const name = "PostAttackRemoveTargetTypeAbAttr";
    const frozen = (a: Any, p: Any): boolean => {
      const { pokemon, opponent, move } = p;
      return (
        move.category !== MoveCategory.STATUS
        && pokemon !== opponent
        && move.category !== MoveCategory.STATUS
        && opponent.isOfType(a.removedType)
        && !(opponent.isTerastallized && opponent.getTeraType() === a.removedType)
      );
    };
    const sites = sitesOf(name).filter(site => site.attr instanceof PostAttackRemoveTargetTypeAbAttr);
    for (const site of sites) {
      const rebuilt = rebuildOf(name, site)!;
      for (const types of [[PokemonType.GHOST], [PokemonType.GHOST, PokemonType.NORMAL], [PokemonType.NORMAL], [PokemonType.FIRE, PokemonType.FLYING]]) {
        for (const tera of [false, true]) {
          setTypesOf(foe, types);
          foe.isTerastallized = tera;
          vi.spyOn(foe, "getTeraType").mockReturnValue(PokemonType.GHOST);
          for (const move of everyMove()) {
            for (const opponent of [foe, holder]) {
              const params = { pokemon: holder, opponent, move, hitResult: 1, simulated: false } as never;
              const label = `${site.abilityName} ${types.map(t => PokemonType[t])} tera=${tera} ${move.name} self=${opponent === holder}`;
              const want = frozen(site.attr as Any, params);
              expect(site.attr.canApply(params), `class ${label}`).toBe(want);
              expect(rebuilt.canApply(params), `rebuild ${label}`).toBe(want);
            }
          }
          foe.isTerastallized = false;
          vi.restoreAllMocks();
        }
      }
      // apply: Ghost-Normal becomes Normal, a pure Ghost target becomes typeless (UNKNOWN), a preview changes nothing
      const tackle = allMoves[MoveId.TACKLE];
      for (const attr of [site.attr, rebuilt]) {
        setTypesOf(foe, [PokemonType.GHOST, PokemonType.NORMAL]);
        attr.apply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 1, simulated: true } as never);
        expect(foe.summonData.types).toEqual([PokemonType.GHOST, PokemonType.NORMAL]);
        attr.apply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 1, simulated: false } as never);
        expect(foe.summonData.types).toEqual([PokemonType.NORMAL]);
        setTypesOf(foe, [PokemonType.GHOST]);
        attr.apply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 1, simulated: false } as never);
        expect(foe.summonData.types).toEqual([PokemonType.UNKNOWN]);
      }
    }
  });

  it("PostAttackScriptedMove: frozen original, class and rebuild agree for all 19 users, all moves and the guard states", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const name = "PostAttackScriptedMoveAbAttr";
    const frozen = (a: Any, p: Any, extraTypes: PokemonType[]): boolean => {
      const { pokemon, move, opponent } = p;
      const o = a.opts;
      if (!opponent) {
        return false;
      }
      if (pokemon.getOpponents().every((x: Pokemon) => x.isFainted())) {
        return false;
      }
      const last = pokemon.getLastXMoves(1)[0]?.useMode;
      const canFollow = !(pokemon.turnData.hitsLeft > 1) && (last === undefined || last < MoveUseMode.INDIRECT);
      if (!canFollow && move.id !== o.allowVirtualTriggerMoveId) {
        return false;
      }
      if (o.triggerMoveIds !== undefined && !o.triggerMoveIds.includes(move.id)) {
        return false;
      }
      if (o.targetStatsDecreased && !opponent.turnData.statStagesDecreased) {
        return false;
      }
      if (o.categoryFilter !== undefined && move.category !== o.categoryFilter) {
        return false;
      }
      if (o.typeFilter !== undefined && !o.typeFilter.some((t: PokemonType) => t === move.type || extraTypes.includes(t))) {
        return false;
      }
      if (o.flagFilter !== undefined && !move.doesFlagEffectApply({ flag: o.flagFilter, user: pokemon, target: opponent })) {
        return false;
      }
      return true;
    };
    const sites = sitesOf(name);
    const states: { name: string; set: () => void }[] = [
      { name: "normal", set: () => {} },
      { name: "hits left", set: () => { holder.turnData.hitsLeft = 2; } },
      { name: "after a free move", set: () => { holder.summonData.moveHistory.push({ move: MoveId.TACKLE, targets: [], useMode: MoveUseMode.INDIRECT } as never); } },
      { name: "foe lost a stage", set: () => { foe.turnData.statStagesDecreased = true; } },
    ];
    for (const state of states) {
      holder.turnData.hitsLeft = 0;
      holder.summonData.moveHistory.length = 0;
      foe.turnData.statStagesDecreased = false;
      state.set();
      for (const site of sites) {
        const rebuilt = rebuildOf(name, site);
        for (const move of everyMove()) {
          const params = { pokemon: holder, opponent: foe, move, hitResult: 1, simulated: false } as never;
          const want = frozen(site.attr as Any, params, []);
          expect(site.attr.canApply(params), `${site.abilityName} class ${state.name} ${move.name}`).toBe(want);
          if (rebuilt !== undefined) {
            expect(rebuilt.canApply(params), `${site.abilityName} rebuild ${state.name} ${move.name}`).toBe(want);
          }
        }
      }
    }
    holder.turnData.hitsLeft = 0;
    holder.summonData.moveHistory.length = 0;
    // every foe fainted, and no target at all
    const tackle = allMoves[MoveId.TACKLE];
    vi.spyOn(foe, "isFainted").mockReturnValue(true);
    for (const site of sites) {
      expect(site.attr.canApply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 1, simulated: false } as never), site.abilityName).toBe(false);
    }
    vi.restoreAllMocks();
    for (const site of sites) {
      expect(site.attr.canApply({ pokemon: holder, opponent: undefined, move: tackle, hitResult: 1, simulated: false } as never), site.abilityName).toBe(false);
    }
    // Monkey Business lets the free Tickle through the safety rule, but only Tickle
    const monkey = sites.find(site => site.abilityName === "Monkey Business")!;
    holder.summonData.moveHistory.push({ move: MoveId.TICKLE, targets: [], useMode: MoveUseMode.INDIRECT } as never);
    expect(monkey.attr.canApply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TICKLE], hitResult: 1, simulated: false } as never)).toBe(true);
    expect(monkey.attr.canApply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 1, simulated: false } as never)).toBe(false);
    holder.summonData.moveHistory.length = 0;
  });

  it("PostAttackScriptedMove: the type-list gate is legacy because a second type from another ability changes the answer; targetStatsDecreased round-trips", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const name = "PostAttackScriptedMoveAbAttr";
    const highTide = sitesOf(name).find(site => site.abilityName === "High Tide")!;
    expect(getBinding(highTide.abilityId, highTide.attrIndex, "gate")?.legacyClosure).toBeDefined();
    const tackle = allMoves[MoveId.TACKLE];
    const ghostMove = everyMove().find(move => move.type === PokemonType.GHOST && move.category !== MoveCategory.STATUS)!;
    const params = { pokemon: holder, opponent: foe, move: ghostMove, hitResult: 1, simulated: false } as never;
    expect(highTide.attr.canApply(params)).toBe(false);
    vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([
      { getTriggeredMoveTypes: (move: Move) => (move.type === PokemonType.GHOST ? [PokemonType.GHOST, PokemonType.WATER] : [move.type]) },
    ] as never);
    expect(highTide.attr.canApply(params), "a Ghost move counts as Water with Sea Specter").toBe(true);
    vi.restoreAllMocks();
    // the setting for "the target lost a stat stage" builds and reads back
    const module = moduleOf(name);
    const attr = buildAttr(module, { moveId: "THUNDERBOLT", power: 35, targetStatsDecreased: true }, { gate: { all: [] } }) as PostAttackScriptedMoveAbAttr;
    expect((attr as Any).opts).toEqual({ moveId: MoveId.THUNDERBOLT, power: 35, targetStatsDecreased: true });
    const own = new PostAttackScriptedMoveAbAttr({ moveId: MoveId.THUNDERBOLT, targetStatsDecreased: true });
    foe.turnData.statStagesDecreased = false;
    expect(own.canApply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 1, simulated: false } as never)).toBe(false);
    foe.turnData.statStagesDecreased = true;
    expect(own.canApply({ pokemon: holder, opponent: foe, move: tackle, hitResult: 1, simulated: false } as never)).toBe(true);
    foe.turnData.statStagesDecreased = false;
  });

  it("PostAttackScriptedMove: apply queues one free move at the foe, nothing in a preview", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const site = sitesOf("PostAttackScriptedMoveAbAttr").find(s => s.abilityName === "Thunder Clouds")!;
    const rebuilt = rebuildOf("PostAttackScriptedMoveAbAttr", site)!;
    const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    const params = (simulated: boolean) => ({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], hitResult: 1, simulated }) as never;
    site.attr.apply(params(true));
    expect(spy).not.toHaveBeenCalled();
    site.attr.apply(params(false));
    rebuilt.apply(params(false));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toBe("MovePhase");
    expect(spy.mock.calls[1].slice(0, 2)).toEqual(spy.mock.calls[0].slice(0, 2));
  });

  for (const [name, mapped] of [
    ["PostAttackSetTerrainByMoveTypeAbAttr", true],
    ["PostAttackSetHazardByMoveTypeAbAttr", false],
  ] as const) {
    it(`${name}: frozen original, class and rebuild agree for every move, hit result and roll, with the same draws`, async () => {
      const { holder, foe, game } = await startWorld(phaserGame);
      const frozen = (a: Any, p: Any, roll: number): { result: boolean; draws: number } => {
        let draws = 0;
        const draw = (): number => {
          draws++;
          return roll;
        };
        if (!(p.move.category !== MoveCategory.STATUS) || !(p.hitResult < HitResult.NO_EFFECT)) {
          return { result: false, draws };
        }
        if (mapped ? !a.terrainByType.has(p.move.type) : p.move.type !== a.moveType) {
          return { result: false, draws };
        }
        return { result: a.chance >= 100 || draw() < a.chance, draws };
      };
      for (const site of sitesOf(name)) {
        const rebuilt = rebuildOf(name, site)!;
        for (const roll of [0, 29, 30, 99]) {
          let draws = 0;
          vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation(() => {
            draws++;
            return roll;
          });
          for (const hitResult of [HitResult.EFFECTIVE, HitResult.SUPER_EFFECTIVE, HitResult.NOT_VERY_EFFECTIVE, HitResult.NO_EFFECT, HitResult.MISS, HitResult.STATUS]) {
            for (const move of everyMove()) {
              const params = { pokemon: holder, opponent: foe, move, hitResult, simulated: false } as never;
              const want = frozen(site.attr as Any, params, roll);
              const label = `${site.abilityName} roll ${roll} hit ${HitResult[hitResult]} ${move.name}`;
              draws = 0;
              expect(site.attr.canApply(params), `class ${label}`).toBe(want.result);
              expect(draws, `class draws ${label}`).toBe(want.draws);
              draws = 0;
              expect(rebuilt.canApply(params), `rebuild ${label}`).toBe(want.result);
              expect(draws, `rebuild draws ${label}`).toBe(want.draws);
            }
          }
          vi.restoreAllMocks();
        }
      }
    });
  }

  it("terrain and hazard apply: the right terrain and the right side, nothing in a preview", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const terrainSite = sitesOf("PostAttackSetTerrainByMoveTypeAbAttr")[0];
    const hazardSite = sitesOf("PostAttackSetHazardByMoveTypeAbAttr")[0];
    const trySet = vi.spyOn(globalScene.arena, "trySetTerrain").mockReturnValue(true as never);
    const addTag = vi.spyOn(globalScene.arena, "addTag").mockReturnValue(true as never);
    const pick = (type: PokemonType) => everyMove().find(m => m.type === type && m.category !== MoveCategory.STATUS)!;
    const params = (move: Move, simulated: boolean) => ({ pokemon: holder, opponent: foe, move, hitResult: 1, simulated }) as never;
    for (const attr of [terrainSite.attr, rebuildOf("PostAttackSetTerrainByMoveTypeAbAttr", terrainSite)!]) {
      trySet.mockClear();
      attr.apply(params(pick(PokemonType.ELECTRIC), true));
      expect(trySet).not.toHaveBeenCalled();
      attr.apply(params(pick(PokemonType.FAIRY), false));
      expect(trySet.mock.calls[0].slice(1)).toEqual([false, holder]);
      expect(trySet.mock.calls[0][0]).toBe((terrainSite.attr as Any).terrainByType.get(PokemonType.FAIRY));
    }
    for (const attr of [hazardSite.attr, rebuildOf("PostAttackSetHazardByMoveTypeAbAttr", hazardSite)!]) {
      addTag.mockClear();
      attr.apply(params(pick(PokemonType.ROCK), true));
      expect(addTag).not.toHaveBeenCalled();
      attr.apply(params(pick(PokemonType.ROCK), false));
      expect(addTag).toHaveBeenCalledTimes(1);
      expect(addTag.mock.calls[0][0]).toBe((hazardSite.attr as Any).tagType);
    }
  });

  it("PostDamageForceAttackerOut: frozen original and class agree over every guard state; apply spends the entry charge", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const name = "PostDamageForceAttackerOutAbAttr";
    const helperProto = Object.getPrototypeOf((sitesOf(name)[0].attr as Any).helper);
    const frozen = (a: Any, p: Any, switchOk: boolean): boolean => {
      const { pokemon, source } = p;
      if (!source || source === pokemon || source.isFainted() || pokemon.isFainted()) {
        return false;
      }
      if (!pokemon.isOpponent(source)) {
        return false;
      }
      if (pokemon.summonData.forceAttackerOutUsed) {
        return false;
      }
      const lastMove = source.getLastXMoves()[0];
      if (!lastMove || lastMove.move === MoveId.NONE || allMoves[lastMove.move]?.category === MoveCategory.STATUS) {
        return false;
      }
      if (a.contactRequired && !allMoves[lastMove.move]?.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: source, target: pokemon })) {
        return false;
      }
      return switchOk;
    };
    for (const site of sitesOf(name)) {
      expect((site.attr as Any).contactRequired, site.abilityName).toBe(true);
      for (const switchOk of [true, false]) {
        vi.spyOn(helperProto, "getSwitchOutCondition").mockReturnValue(switchOk);
        for (const used of [false, true]) {
          for (const source of [foe, undefined, holder]) {
            for (const holderFainted of [false, true]) {
              for (const moveId of [undefined, MoveId.NONE, MoveId.TACKLE, MoveId.WATER_GUN, MoveId.SPLASH, MoveId.FLAME_WHEEL]) {
                foe.summonData.moveHistory.length = 0;
                if (moveId !== undefined) {
                  foe.summonData.moveHistory.push({ move: moveId, targets: [], useMode: MoveUseMode.NORMAL } as never);
                }
                holder.summonData.forceAttackerOutUsed = used;
                vi.spyOn(holder, "isFainted").mockReturnValue(holderFainted);
                const params = { pokemon: holder, source, damage: 10, simulated: false } as never;
                expect(site.attr.canApply(params), `${site.abilityName} sw=${switchOk} used=${used} src=${source === foe ? "foe" : source === holder ? "self" : "none"} hf=${holderFainted} ${moveId === undefined ? "nomove" : MoveId[moveId]}`).toBe(frozen(site.attr as Any, params, switchOk));
                vi.mocked(holder.isFainted).mockRestore();
              }
            }
          }
        }
        vi.restoreAllMocks();
      }
      // apply: a preview does nothing; a real call spends the charge and switches the attacker out
      holder.summonData.forceAttackerOutUsed = false;
      const out = vi.spyOn(helperProto, "switchOutLogic").mockReturnValue(true);
      site.attr.apply({ pokemon: holder, source: foe, damage: 10, simulated: true } as never);
      expect(holder.summonData.forceAttackerOutUsed).toBe(false);
      expect(out).not.toHaveBeenCalled();
      site.attr.apply({ pokemon: holder, source: foe, damage: 10, simulated: false } as never);
      expect(holder.summonData.forceAttackerOutUsed).toBe(true);
      expect(out).toHaveBeenCalledWith(foe);
      holder.summonData.forceAttackerOutUsed = false;
      vi.restoreAllMocks();
    }
    foe.summonData.moveHistory.length = 0;
  });

  it("PostDefendChangeAttackerType: frozen original, class and rebuild agree, also for the settings no live user has", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const name = "PostDefendChangeAttackerTypeAbAttr";
    const module = moduleOf(name);
    const frozen = (a: Any, p: Any): boolean => {
      const { move, pokemon, opponent } = p;
      if (!opponent || !move.is("AttackMove")) {
        return false;
      }
      if (a.contactOnly && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: opponent, target: pokemon })) {
        return false;
      }
      if (a.requireFlag !== null && !move.doesFlagEffectApply({ flag: a.requireFlag, user: opponent, target: pokemon })) {
        return false;
      }
      return true;
    };
    const attrs = sitesOf(name).map(site => ({ label: site.abilityName, attr: site.attr, rebuilt: rebuildOf(name, site)! }));
    // settings without a live user: a pulse-move rule, and the other side
    const pulseGate = { all: [{ block: "move.damaging", params: {} }, { block: "move.flag", params: { flag: "PULSE_MOVE" } }] };
    const pulse = buildAttr(module, { type: "MOVE_TYPE", side: "ME", contactOnly: false, requireFlag: "PULSE_MOVE" }, { gate: pulseGate as never });
    attrs.push({ label: "pulse/me", attr: pulse, rebuilt: pulse });
    for (const { label, attr, rebuilt } of attrs) {
      for (const move of everyMove()) {
        for (const opponent of [foe, undefined]) {
          const params = { pokemon: holder, opponent, move, hitResult: 1, simulated: false } as never;
          const want = label === "pulse/me" ? move.category !== MoveCategory.STATUS && move.hasFlag(MoveFlags.PULSE_MOVE) && !!opponent : frozen(attr as Any, params);
          expect(attr.canApply(params), `${label} class ${move.name}`).toBe(want);
          expect(rebuilt.canApply(params), `${label} rebuild ${move.name}`).toBe(want);
        }
      }
    }
    // apply: the attacker (or the holder) gets one type; the move's type for "moveType"
    const water = everyMove().find(m => m.type === PokemonType.WATER && m.category !== MoveCategory.STATUS)!;
    setTypesOf(foe, [PokemonType.FIRE]);
    setTypesOf(holder, [PokemonType.NORMAL]);
    attrs[0].attr.apply({ pokemon: holder, opponent: foe, move: water, hitResult: 1, simulated: true } as never);
    expect(foe.summonData.types).toEqual([PokemonType.FIRE]);
    attrs[0].rebuilt.apply({ pokemon: holder, opponent: foe, move: water, hitResult: 1, simulated: false } as never);
    expect(foe.summonData.types).toEqual([(attrs[0].attr as Any).type]);
    pulse.apply({ pokemon: holder, opponent: foe, move: water, hitResult: 1, simulated: false } as never);
    expect(holder.summonData.types).toEqual([foe.getMoveType(water)]);
  });
});
