/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 3 probes: what the shared L1 grid and the L2 twin cannot see. Every test drives the ORIGINAL attr of a real ability and its
// REBUILD (recomposeAttr from the declaration and the bindings, or buildAttr with the class's own gate where the gate binding is still a
// legacy closure) side by side.
//   - Electromancy and Hydromancy: the effect-chance rule (guards first, then the move test), the cap at 100, the live settings.
//   - Eulogy: the revival with a real party (fainted, boss and ordinary members), the once-per-battle marker, simulated, the live percent.
//   - False Equivalence: the field effect, its length, simulated.
//   - The Elite Redux terrain abilities (five users): the length patch, the extender, simulated, the live settings.
//   - Hijack and Irradiated Fist: clause order, the one random draw (and where it sits), the marker rules, the replaceable slots.
//   - Jackpot: the per-side memory, the Luck flag, simulated, the replaceable gate.
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { FieldEffectModifier } from "#modifiers/modifier";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setStatusOf, setTerrainOf } from "#test/tests/elite-redux/decomp/harness/world";
import type { AbAttrBaseParams, PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const HYDROMANCY = 6005;
const FALSE_EQUIVALENCE = 6007;
const IRRADIATED_FIST = 6035;
const ELECTROMANCY = 6037;
const HIJACK = 6038;
const EULOGY = 6046;
const JACKPOT = 6114;
/** The five terrain users: id, name, attr index, terrain. */
const TERRAIN_USERS: readonly [number, string, number, TerrainType][] = [
  [227, "Psychic Surge", 0, TerrainType.PSYCHIC],
  [228, "Misty Surge", 0, TerrainType.MISTY],
  [229, "Grassy Surge", 0, TerrainType.GRASSY],
  [289, "Hadron Engine", 0, TerrainType.ELECTRIC],
  [20000, "Psychic Supremacy", 2, TerrainType.PSYCHIC],
];

function moduleOf(name: string): NonNullable<ReturnType<typeof declRegistry.get>> {
  const module = declRegistry.get(name);
  expect(module, `${name} must be declared`).toBeDefined();
  return module!;
}

function baseParams(holder: Pokemon, simulated = false): AbAttrBaseParams {
  return { pokemon: holder, simulated } as AbAttrBaseParams;
}

function hitParams(
  holder: Pokemon,
  foe: Pokemon,
  move: MoveId,
  damage: number,
  simulated = false,
): PostMoveInteractionAbAttrParams {
  return {
    pokemon: holder,
    opponent: foe,
    move: allMoves[move],
    damage,
    hitResult: HitResult.EFFECTIVE,
    simulated,
  } as PostMoveInteractionAbAttrParams;
}

function chanceParams(holder: Pokemon, move: ReturnType<typeof moveOf>, chance: number) {
  return { pokemon: holder, move, chance: new NumberHolder(chance), simulated: false } as never;
}

function moveOf(id: MoveId) {
  return allMoves[id];
}

/** The class's own `gate` of a live attr, bound: what the legacy binding keeps in the slot. */
function gateOf(attr: AbAttr): never {
  const gated = attr as unknown as { gate: (p: unknown) => boolean };
  return gated.gate.bind(attr) as never;
}

describe("B16 chunk 3", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A real battle with three party members (the first one is the holder) against a Splashing Magikarp. */
  async function startParty() {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(30)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY, SpeciesId.SNORLAX);
    const party = game.scene.getPlayerParty();
    return { game, party, holder: party[0], foe: game.field.getEnemyPokemon() };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Electromancy and Hydromancy (effect chance)", () => {
    it("Electromancy: the parent's rule first, then the status test; x5 capped at 100; the settings are live; the gate is replaceable", async () => {
      const { holder } = await startWorld(phaserGame);
      const original = liveAbility(ELECTROMANCY).attrs[0];
      const module = moduleOf("ElectromancyEffectChanceAbAttr");
      expect(readDeclParams(module, original)).toEqual({ multiplier: 5, status: "PARALYSIS" });
      const rebuilt = buildAttr(module, readDeclParams(module, original), { gate: gateOf(original) });
      expect(rebuilt).not.toBe(original);

      // [move, chance, expected]. Thunder Wave only counts through the VALUE of the chance (it has no chance of its own).
      const cases: [MoveId, number, boolean][] = [
        [MoveId.THUNDERBOLT, 10, true],
        [MoveId.THUNDERBOLT, 0, false],
        [MoveId.THUNDERBOLT, -1, false],
        [MoveId.THUNDER_WAVE, 100, true],
        [MoveId.THUNDER_WAVE, -1, false],
        [MoveId.EMBER, 10, false],
        [MoveId.TACKLE, 30, false],
        [MoveId.ORDER_UP, 30, false],
        [MoveId.ELECTRO_SHOT, 30, false],
      ];
      for (const [move, chance, expected] of cases) {
        for (const [who, attr] of [
          ["original", original],
          ["rebuild", rebuilt],
        ] as const) {
          expect(attr.canApply(chanceParams(holder, moveOf(move), chance)), `${who} ${MoveId[move]} ${chance}`).toBe(
            expected,
          );
        }
      }
      for (const attr of [original, rebuilt]) {
        const holderValue = chanceParams(holder, moveOf(MoveId.THUNDERBOLT), 10) as { chance: NumberHolder };
        attr.apply(holderValue as never);
        expect(holderValue.chance.value).toBe(50);
        const capped = chanceParams(holder, moveOf(MoveId.THUNDERBOLT), 30) as { chance: NumberHolder };
        attr.apply(capped as never);
        expect(capped.chance.value).toBe(100);
      }

      // Live settings: x2 for burns. The gate follows the status param (the class's own gate is used).
      const burns = buildAttr(
        module,
        { multiplier: 2, status: "BURN" },
        { gate: ((p: never) => gateOf(burns)(p)) as never },
      );
      expect(burns.canApply(chanceParams(holder, moveOf(MoveId.EMBER), 10))).toBe(true);
      expect(burns.canApply(chanceParams(holder, moveOf(MoveId.THUNDERBOLT), 10))).toBe(false);
      const doubled = chanceParams(holder, moveOf(MoveId.EMBER), 10) as { chance: NumberHolder };
      burns.apply(doubled as never);
      expect(doubled.chance.value).toBe(20);
      expect(readDeclParams(module, burns)).toEqual({ multiplier: 2, status: "BURN" });

      // The gate slot is real: replaced by "always", a move with no status passes, but the parent's rule (chance above 0) stays.
      const open = buildAttr(module, {}, { gate: { all: [] } });
      expect(open.canApply(chanceParams(holder, moveOf(MoveId.TACKLE), 30))).toBe(true);
      expect(open.canApply(chanceParams(holder, moveOf(MoveId.TACKLE), 0))).toBe(false);
      expect(open.canApply(chanceParams(holder, moveOf(MoveId.ORDER_UP), 30))).toBe(false);
      // The gate is legacy until R-B16-15: the attr cannot be rebuilt from bindings, and says why.
      expect(() => recomposeAttr(module, original, ELECTROMANCY, 0)).toThrow(/no library binding/);
    });

    it("Hydromancy: only a move with the Drench part passes, x5 capped at 100, the multiplier is live, the gate is replaceable", async () => {
      const { holder } = await startWorld(phaserGame);
      const original = liveAbility(HYDROMANCY).attrs[0];
      const module = moduleOf("HydromancyEffectChanceAbAttr");
      expect(readDeclParams(module, original)).toEqual({ multiplier: 5 });
      const rebuilt = buildAttr(module, {}, { gate: gateOf(original) });
      const drench = allMoves.find(
        move => move !== undefined && move.attrs.some(attr => attr.constructor.name === "ErDrenchAttr"),
      );
      expect(drench, "the game has at least one move with the Drench part").toBeDefined();
      for (const attr of [original, rebuilt]) {
        expect(attr.canApply(chanceParams(holder, drench!, 20)), "drenching move").toBe(true);
        expect(attr.canApply(chanceParams(holder, drench!, 0)), "no chance").toBe(false);
        expect(attr.canApply(chanceParams(holder, moveOf(MoveId.EMBER), 10)), "burn move").toBe(false);
        expect(attr.canApply(chanceParams(holder, moveOf(MoveId.ORDER_UP), 30)), "Order Up").toBe(false);
        const value = chanceParams(holder, drench!, 10) as { chance: NumberHolder };
        attr.apply(value as never);
        expect(value.chance.value).toBe(50);
        const capped = chanceParams(holder, drench!, 30) as { chance: NumberHolder };
        attr.apply(capped as never);
        expect(capped.chance.value).toBe(100);
      }
      const triple = buildAttr(module, { multiplier: 3 }, { gate: gateOf(original) });
      const tripled = chanceParams(holder, drench!, 10) as { chance: NumberHolder };
      triple.apply(tripled as never);
      expect(tripled.chance.value).toBe(30);
      const open = buildAttr(module, {}, { gate: { all: [] } });
      expect(open.canApply(chanceParams(holder, moveOf(MoveId.EMBER), 10))).toBe(true);
      expect(open.canApply(chanceParams(holder, moveOf(MoveId.EMBER), 0))).toBe(false);
      expect(() => recomposeAttr(module, original, HYDROMANCY, 0)).toThrow(/no library binding/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Eulogy", () => {
    it("brings back the FIRST fainted non-boss party member at half HP with no status, once per battle; simulated changes nothing", async () => {
      const { holder, party } = await startParty();
      const original = liveAbility(EULOGY).attrs[0];
      const module = moduleOf("EulogyAbAttr");
      expect(readDeclParams(module, original)).toEqual({ percent: 50 });
      const rebuilt = buildAttr(module, { percent: 50 }, { gate: gateOf(original) });
      const [, second, third] = party;

      for (const attr of [original, rebuilt]) {
        holder.battleData.erAbilityProvenance = [];
        for (const mon of [second, third]) {
          mon.hp = 0;
          setStatusOf(mon, StatusEffect.NONE);
        }
        // Nobody to bring back but a boss, and a boss never counts.
        vi.spyOn(second, "isBoss").mockReturnValue(true);
        vi.spyOn(third, "isBoss").mockReturnValue(true);
        expect(attr.canApply({ pokemon: holder, simulated: false } as never), "only bosses fainted").toBe(false);
        vi.restoreAllMocks();
        // Nobody fainted at all.
        second.hp = second.getMaxHp();
        third.hp = third.getMaxHp();
        expect(attr.canApply({ pokemon: holder, simulated: false } as never), "nobody fainted").toBe(false);
        // The second member is a boss, the third an ordinary fainted member: the third comes back.
        second.hp = 0;
        third.hp = 0;
        setStatusOf(third, StatusEffect.BURN);
        vi.spyOn(second, "isBoss").mockReturnValue(true);
        expect(attr.canApply({ pokemon: holder, simulated: false } as never), "an ordinary one fainted").toBe(true);
        attr.apply({ pokemon: holder, simulated: true } as never);
        expect(third.hp, "simulated").toBe(0);
        expect(holder.battleData.erAbilityProvenance, "simulated marker").toEqual([]);
        attr.apply({ pokemon: holder, simulated: false } as never);
        expect(third.hp).toBe(Math.max(1, Math.floor(third.getMaxHp() / 2)));
        expect(third.status).toBeNull();
        expect(second.hp, "the boss stays down").toBe(0);
        expect(holder.battleData.erAbilityProvenance).toContain("eulogy:spent");
        // Once per battle: the marker closes the gate even though the boss is still down and another member faints.
        third.hp = 0;
        vi.restoreAllMocks();
        expect(attr.canApply({ pokemon: holder, simulated: false } as never), "spent").toBe(false);
      }
    });

    it("picks the first fainted member in party order, the percent is live (rounding, minimum 1 HP) and the gate is replaceable", async () => {
      const { holder, party } = await startParty();
      const module = moduleOf("EulogyAbAttr");
      const original = liveAbility(EULOGY).attrs[0];
      const [, second, third] = party;
      second.hp = 0;
      third.hp = 0;
      holder.battleData.erAbilityProvenance = [];
      original.apply({ pokemon: holder, simulated: false } as never);
      expect(second.hp, "the first one in party order").toBeGreaterThan(0);
      expect(third.hp).toBe(0);
      for (const [percent, maxHp, expected] of [
        [100, 333, 333],
        [1, 50, 1],
        [33, 101, 33],
        [50, 101, 50],
      ] as const) {
        const attr = buildAttr(module, { percent }, { gate: gateOf(original) });
        holder.battleData.erAbilityProvenance = [];
        third.hp = 0;
        second.hp = second.getMaxHp();
        vi.spyOn(third, "getMaxHp").mockReturnValue(maxHp);
        attr.apply({ pokemon: holder, simulated: false } as never);
        expect(third.hp, `${percent}% of ${maxHp}`).toBe(expected);
        vi.restoreAllMocks();
      }
      // Replaced gate: the marker no longer stops it (the residual, a fainted member exists, stays).
      const open = buildAttr(module, {}, { gate: { all: [] } });
      holder.battleData.erAbilityProvenance = ["eulogy:spent"];
      third.hp = 0;
      expect(open.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
      third.hp = third.getMaxHp();
      second.hp = second.getMaxHp();
      expect(open.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
      expect(() => recomposeAttr(module, original, EULOGY, 0)).toThrow(/no library binding/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("False Equivalence", () => {
    it("sets Wonder Room on both sides for 5 turns with the holder as source; the length is live; simulated changes nothing", async () => {
      const { holder } = await startWorld(phaserGame);
      const module = moduleOf("PostSummonWonderRoomAbAttr");
      const original = liveAbility(FALSE_EQUIVALENCE).attrs[0];
      const rebuilt = recomposeAttr(module, original, FALSE_EQUIVALENCE, 0);
      expect(rebuilt).not.toBe(original);
      expect(readDeclParams(module, original)).toEqual({ turns: 5 });
      for (const attr of [original, rebuilt]) {
        globalScene.arena.removeTag(ArenaTagType.WONDER_ROOM);
        expect(attr.canApply(baseParams(holder))).toBe(true);
        attr.apply(baseParams(holder, true));
        expect(globalScene.arena.getTag(ArenaTagType.WONDER_ROOM), "simulated").toBeUndefined();
        attr.apply(baseParams(holder));
        const tag = globalScene.arena.getTag(ArenaTagType.WONDER_ROOM);
        expect(tag).toBeDefined();
        expect(tag?.turnCount).toBe(5);
        expect(tag?.sourceId).toBe(holder.id);
        expect(tag?.sourceMove).toBe(MoveId.WONDER_ROOM);
      }
      globalScene.arena.removeTag(ArenaTagType.WONDER_ROOM);
      buildAttr(module, { turns: 3 }).apply(baseParams(holder));
      expect(globalScene.arena.getTag(ArenaTagType.WONDER_ROOM)?.turnCount).toBe(3);
      globalScene.arena.removeTag(ArenaTagType.WONDER_ROOM);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Elite Redux terrain abilities", () => {
    it("entry: every one of the five users sets its terrain for 8 turns, original and rebuild alike; simulated changes nothing", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const module = moduleOf("ErTerrainSummonAbAttr");
      for (const [id, name, index, terrain] of TERRAIN_USERS) {
        const original = liveAbility(id).attrs[index];
        expect(original.constructor.name, name).toBe("ErTerrainSummonAbAttr");
        const rebuilt = recomposeAttr(module, original, id, index);
        expect(rebuilt, name).not.toBe(original);
        expect(readDeclParams(module, original), name).toEqual({ terrain: TerrainType[terrain], turns: 8 });
        for (const attr of [original, rebuilt]) {
          setTerrainOf(game, TerrainType.NONE);
          expect(attr.canApply(baseParams(holder)), `${name} can set the terrain over none`).toBe(true);
          attr.apply(baseParams(holder, true));
          expect(globalScene.arena.terrain, `${name} simulated`).toBeNull();
          attr.apply(baseParams(holder));
          expect(globalScene.arena.terrain?.terrainType, name).toBe(terrain);
          expect(globalScene.arena.terrain?.turnsLeft, name).toBe(8);
          // The same terrain is already up: nothing to do.
          expect(attr.canApply(baseParams(holder)), `${name} same terrain`).toBe(false);
        }
      }
    });

    it("entry: the settings are live and the item extender is kept on top of the length", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const module = moduleOf("ErTerrainSummonAbAttr");
      const short = buildAttr(module, { terrain: "GRASSY", turns: 3 });
      setTerrainOf(game, TerrainType.NONE);
      short.apply(baseParams(holder));
      expect(globalScene.arena.terrain?.terrainType).toBe(TerrainType.GRASSY);
      expect(globalScene.arena.terrain?.turnsLeft).toBe(3);
      vi.spyOn(globalScene, "applyModifier").mockImplementation(((
        type: unknown,
        _player: unknown,
        _mon: unknown,
        holderValue: NumberHolder,
      ) => {
        if (type === FieldEffectModifier) {
          holderValue.value += 2;
          return true;
        }
        return false;
      }) as never);
      const original = liveAbility(227).attrs[0];
      const rebuilt = recomposeAttr(module, original, 227, 0);
      for (const attr of [original, rebuilt]) {
        setTerrainOf(game, TerrainType.NONE);
        attr.apply(baseParams(holder));
        expect(globalScene.arena.terrain?.turnsLeft).toBe(10);
      }
    });

    it("pins the oddity: a terrain that refused the new one still has its length overwritten (no check that it is the one I set)", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const original = liveAbility(227).attrs[0];
      // The arena refuses to replace the terrain (the same effect a protected Toxic terrain has), but a terrain with turns is in place.
      setTerrainOf(game, TerrainType.GRASSY);
      vi.spyOn(globalScene.arena, "trySetTerrain").mockReturnValue(false);
      original.apply(baseParams(holder));
      expect(globalScene.arena.terrain?.terrainType).toBe(TerrainType.GRASSY);
      expect(globalScene.arena.terrain?.turnsLeft).toBe(8);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Hijack", () => {
    it("clause order and truth table: attack condition, damage, Electric after abilities, paralyzed foe, then the foe's two memory tests", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(HIJACK).attrs[0];
      const module = moduleOf("HijackAbAttr");
      const rebuilt = recomposeAttr(module, original, HIJACK, 0);
      expect(rebuilt).not.toBe(original);
      expect(readDeclParams(module, original)).toEqual({});
      const statuses = [StatusEffect.NONE, StatusEffect.PARALYSIS, StatusEffect.BURN];
      for (const foeStatus of statuses) {
        for (const used of [false, true]) {
          for (const marked of [false, true]) {
            setStatusOf(foe, foeStatus);
            foe.summonData.erCommandedUsedThisSwitchIn = used;
            foe.removeTag(BattlerTagType.ER_COMMANDED);
            if (marked) {
              foe.addTag(BattlerTagType.ER_COMMANDED, 0, MoveId.NONE, holder.id);
              foe.summonData.erCommandedUsedThisSwitchIn = used;
            }
            for (const [move, damage] of [
              [MoveId.THUNDERBOLT, 5],
              [MoveId.THUNDERBOLT, 0],
              [MoveId.TACKLE, 5],
              [MoveId.THUNDER_WAVE, 5],
            ] as const) {
              const expected =
                move === MoveId.THUNDERBOLT && damage > 0 && foeStatus === StatusEffect.PARALYSIS && !used && !marked;
              const params = hitParams(holder, foe, move, damage);
              const label = `${MoveId[move]} ${damage} foe ${StatusEffect[foeStatus]} used ${used} marked ${marked}`;
              expect(original.canApply(params), `original ${label}`).toBe(expected);
              expect(rebuilt.canApply(params), `rebuild ${label}`).toBe(expected);
            }
          }
        }
      }
      foe.removeTag(BattlerTagType.ER_COMMANDED);
      foe.summonData.erCommandedUsedThisSwitchIn = false;
      setStatusOf(foe, StatusEffect.PARALYSIS);
      // The type is read AFTER ability changes: a Normal move turned Electric counts, an Electric one turned Water does not.
      for (const attr of [original, rebuilt]) {
        const turned = vi.spyOn(holder, "getMoveType").mockReturnValue(PokemonType.ELECTRIC);
        expect(attr.canApply(hitParams(holder, foe, MoveId.TACKLE, 5)), "Tackle turned Electric").toBe(true);
        turned.mockReturnValue(PokemonType.WATER);
        expect(attr.canApply(hitParams(holder, foe, MoveId.THUNDERBOLT, 5)), "Thunderbolt turned Water").toBe(false);
        turned.mockRestore();
      }
    });

    it("apply: the marker goes on the foe with the holder as source, nothing when simulated; both slots are replaceable", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(HIJACK).attrs[0];
      const module = moduleOf("HijackAbAttr");
      const rebuilt = recomposeAttr(module, original, HIJACK, 0);
      for (const attr of [original, rebuilt]) {
        foe.removeTag(BattlerTagType.ER_COMMANDED);
        attr.apply(hitParams(holder, foe, MoveId.THUNDERBOLT, 5, true));
        expect(foe.getTag(BattlerTagType.ER_COMMANDED)).toBeUndefined();
        attr.apply(hitParams(holder, foe, MoveId.THUNDERBOLT, 5));
        expect(foe.getTag(BattlerTagType.ER_COMMANDED)?.sourceId).toBe(holder.id);
        expect(holder.getTag(BattlerTagType.ER_COMMANDED)).toBeUndefined();
      }
      foe.removeTag(BattlerTagType.ER_COMMANDED);
      foe.summonData.erCommandedUsedThisSwitchIn = false;
      setStatusOf(foe, StatusEffect.NONE);
      const open = recomposeAttr(module, original, HIJACK, 0, { conds: { gate: { all: [] } } });
      expect(open.canApply(hitParams(holder, foe, MoveId.TACKLE, 5))).toBe(true);
      expect(open.canApply(hitParams(holder, foe, MoveId.TACKLE, 0))).toBe(false);
      foe.summonData.erCommandedUsedThisSwitchIn = true;
      expect(open.canApply(hitParams(holder, foe, MoveId.TACKLE, 5)), "the residual stays").toBe(false);
      foe.summonData.erCommandedUsedThisSwitchIn = false;
      const onlyCondition = recomposeAttr(module, original, HIJACK, 0, { conds: { "ctor:0": { all: [] } } });
      expect(onlyCondition.canApply(hitParams(holder, foe, MoveId.THUNDER_WAVE, 5))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Irradiated Fist", () => {
    it("draws ONE random number, only for a damaging punch, before the can-be-poisoned test; original and rebuild agree", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(IRRADIATED_FIST).attrs[0];
      const module = moduleOf("IrradiatedFistAbAttr");
      const rebuilt = recomposeAttr(module, original, IRRADIATED_FIST, 0);
      expect(rebuilt).not.toBe(original);
      expect(readDeclParams(module, original)).toEqual({ chance: 50 });
      // [move, damage, foe status, draw it returns, expected, expected number of draws]
      const cases: [MoveId, number, StatusEffect, number, boolean, number][] = [
        [MoveId.MACH_PUNCH, 5, StatusEffect.NONE, 49, true, 1],
        [MoveId.MACH_PUNCH, 5, StatusEffect.NONE, 50, false, 1],
        [MoveId.MACH_PUNCH, 0, StatusEffect.NONE, 0, false, 0],
        [MoveId.TACKLE, 5, StatusEffect.NONE, 0, false, 0],
        [MoveId.SWORDS_DANCE, 5, StatusEffect.NONE, 0, false, 0],
        // The foe cannot be poisoned: the draw is still spent (it sits before that test).
        [MoveId.MACH_PUNCH, 5, StatusEffect.BURN, 0, false, 1],
        [MoveId.MACH_PUNCH, 5, StatusEffect.TOXIC, 0, false, 1],
      ];
      for (const [move, damage, foeStatus, draw, expected, draws] of cases) {
        for (const [who, attr] of [
          ["original", original],
          ["rebuild", rebuilt],
        ] as const) {
          setStatusOf(foe, foeStatus);
          const spy = vi.spyOn(holder, "randBattleSeedInt").mockReturnValue(draw);
          const label = `${who} ${MoveId[move]} dmg ${damage} foe ${StatusEffect[foeStatus]} draw ${draw}`;
          expect(attr.canApply(hitParams(holder, foe, move, damage)), label).toBe(expected);
          expect(spy.mock.calls.length, `${label}: draws`).toBe(draws);
          if (draws > 0) {
            expect(spy).toHaveBeenCalledWith(100);
          }
          spy.mockRestore();
        }
      }
    });

    it("apply: badly poisons the foe and marks it only when the poisoning landed; simulated does nothing; the chance is live", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(IRRADIATED_FIST).attrs[0];
      const module = moduleOf("IrradiatedFistAbAttr");
      const rebuilt = recomposeAttr(module, original, IRRADIATED_FIST, 0);
      for (const attr of [original, rebuilt]) {
        setStatusOf(foe, StatusEffect.NONE);
        // A status that is still queued from the first round would make the second poisoning impossible.
        foe.turnData.pendingStatus = StatusEffect.NONE;
        foe.removeTag(BattlerTagType.ER_IRRADIATED_TOXIC);
        attr.apply(hitParams(holder, foe, MoveId.MACH_PUNCH, 5, true));
        expect(foe.status).toBeNull();
        expect(foe.getTag(BattlerTagType.ER_IRRADIATED_TOXIC)).toBeUndefined();
        // trySetStatus queues the status (it lands in a later phase), so the call itself is what is checked: Toxic, source = the holder.
        const poison = vi.spyOn(foe, "trySetStatus");
        attr.apply(hitParams(holder, foe, MoveId.MACH_PUNCH, 5));
        expect(poison).toHaveBeenCalledTimes(1);
        expect(poison).toHaveBeenCalledWith(StatusEffect.TOXIC, holder);
        expect(foe.getTag(BattlerTagType.ER_IRRADIATED_TOXIC)?.sourceId).toBe(holder.id);
        poison.mockRestore();
        // The poisoning is refused: no marker.
        setStatusOf(foe, StatusEffect.NONE);
        foe.removeTag(BattlerTagType.ER_IRRADIATED_TOXIC);
        vi.spyOn(foe, "trySetStatus").mockReturnValue(false);
        attr.apply(hitParams(holder, foe, MoveId.MACH_PUNCH, 5));
        expect(foe.getTag(BattlerTagType.ER_IRRADIATED_TOXIC)).toBeUndefined();
        vi.restoreAllMocks();
      }
      // The chance is a live setting: a rebuild with 80 passes a draw of 79 and fails 80 (the gate param follows the slider); the class
      // itself, built with 100, passes the highest draw.
      setStatusOf(foe, StatusEffect.NONE);
      foe.turnData.pendingStatus = StatusEffect.NONE;
      vi.restoreAllMocks();
      const eighty = recomposeAttr(module, original, IRRADIATED_FIST, 0, { params: { chance: 80 } });
      for (const [draw, expected] of [
        [79, true],
        [80, false],
      ] as const) {
        const spy = vi.spyOn(holder, "randBattleSeedInt").mockReturnValue(draw);
        expect(eighty.canApply(hitParams(holder, foe, MoveId.MACH_PUNCH, 5)), `draw ${draw}`).toBe(expected);
        spy.mockRestore();
      }
      // The gate slot keeps the class's own gate of THIS instance (built with chance 100).
      const always = buildAttr(
        module,
        { chance: 100 },
        { "ctor:0": () => true, gate: ((p: never) => (gateOf(always) as (q: never) => boolean)(p)) as never },
      );
      const spy = vi.spyOn(holder, "randBattleSeedInt").mockReturnValue(99);
      expect(always.canApply(hitParams(holder, foe, MoveId.MACH_PUNCH, 5))).toBe(true);
      spy.mockRestore();
      // The gate is a real slot: replaced by "always", a non-punch passes (and the draw is gone with it).
      const open = recomposeAttr(module, original, IRRADIATED_FIST, 0, { conds: { gate: { all: [] } } });
      const none = vi.spyOn(holder, "randBattleSeedInt");
      expect(open.canApply(hitParams(holder, foe, MoveId.TACKLE, 5))).toBe(true);
      expect(none).not.toHaveBeenCalled();
      expect(open.canApply(hitParams(holder, foe, MoveId.TACKLE, 0)), "damage guard stays").toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Jackpot", () => {
    type Sides = { erJackpotSides?: Map<boolean, number> | undefined };
    const battle = () => globalScene.currentBattle as unknown as Sides;
    const lucky = (mon: Pokemon) => (mon.waveData as unknown as { erJackpotLuck?: number }).erJackpotLuck === 1;

    it("one boost per SIDE per battle: the side flag, the holder's Luck flag, simulated, canApply always true", async () => {
      const { holder, party, foe } = await startParty();
      const original = liveAbility(JACKPOT).attrs[1];
      const module = moduleOf("JackpotBattleBuffAbAttr");
      expect(readDeclParams(module, original)).toEqual({ critStages: 1, luck: 1 });
      const rebuilt = buildAttr(module, { critStages: 1, luck: 1 }, { gate: gateOf(original) });
      const partner = party[1];
      for (const attr of [original, rebuilt]) {
        battle().erJackpotSides = undefined;
        for (const mon of [holder, partner, foe]) {
          (mon.waveData as unknown as { erJackpotLuck?: number }).erJackpotLuck = undefined;
        }
        expect(attr.canApply(baseParams(holder))).toBe(true);
        attr.apply(baseParams(holder, true));
        expect(battle().erJackpotSides, "simulated creates nothing").toBeUndefined();
        expect(lucky(holder)).toBe(false);
        const before = holder.getLuck();
        attr.apply(baseParams(holder));
        expect([...(battle().erJackpotSides ?? [])]).toEqual([[true, 1]]);
        expect(lucky(holder)).toBe(true);
        expect(holder.getLuck()).toBe(before + 1);
        // A second Pokemon of the SAME side gets nothing; the other side has its own boost.
        attr.apply(baseParams(partner));
        expect(lucky(partner), "same side").toBe(false);
        attr.apply(baseParams(foe));
        expect([...(battle().erJackpotSides?.keys() ?? [])].sort()).toEqual([false, true]);
        expect(lucky(foe), "other side").toBe(true);
        // Even the holder again changes nothing (the flag is already there).
        attr.apply(baseParams(holder));
        expect(battle().erJackpotSides?.size).toBe(2);
      }
    });

    it("the amounts are editable: critStages 2 and luck 3 are stored and read by the engine", async () => {
      const { holder, foe } = await startParty();
      const module = moduleOf("JackpotBattleBuffAbAttr");
      battle().erJackpotSides = undefined;
      (holder.waveData as unknown as { erJackpotLuck?: number }).erJackpotLuck = undefined;
      const before = holder.getLuck();
      const strong = buildAttr(module, { critStages: 2, luck: 3 }, { gate: gateOf(liveAbility(JACKPOT).attrs[1]) });
      strong.apply(baseParams(holder));
      expect(battle().erJackpotSides?.get(true)).toBe(2);
      expect(holder.getLuck()).toBe(before + 3);
      expect(battle().erJackpotSides?.get(foe.isPlayer())).toBeUndefined();
      battle().erJackpotSides = undefined;
      (holder.waveData as unknown as { erJackpotLuck?: number }).erJackpotLuck = undefined;
    });

    it("the gate is a real slot: replaced by 'always', a second Pokemon of the same side gets the Luck flag too", async () => {
      const { holder, party } = await startParty();
      const original = liveAbility(JACKPOT).attrs[1];
      const module = moduleOf("JackpotBattleBuffAbAttr");
      battle().erJackpotSides = undefined;
      const open = buildAttr(module, {}, { gate: { all: [] } });
      open.apply(baseParams(holder));
      open.apply(baseParams(party[1]));
      expect(lucky(holder)).toBe(true);
      expect(lucky(party[1])).toBe(true);
      // The original gate itself, on the same battle object: now closed for both.
      const gate = gateOf(original) as unknown as (p: AbAttrBaseParams) => boolean;
      expect(gate(baseParams(holder))).toBe(false);
      battle().erJackpotSides = undefined;
      expect(gate(baseParams(holder))).toBe(true);
      expect(() => recomposeAttr(module, original, JACKPOT, 1)).toThrow(/no library binding/);
      battle().erJackpotSides = undefined;
    });
  });
});
