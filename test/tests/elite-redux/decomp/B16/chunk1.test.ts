/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 1 probes: what the shared L1 grid and the L2 twin cannot see.
//   - Bad Dreams: the sleeping-foe path (the harness axis `status` sets the HOLDER, never the foe).
//   - Ballaster: the charge memory and both retaliation paths, driven hit by hit on the ORIGINAL attr and on its REBUILD, plus an L2
//     twin against a sturdy foe (the shared template's Magikarp is knocked out by the retaliation).
//   - Blind Justice: the order and the ranges of the two random draws.
//   - Confectious (entry and attack): the gate really is the contact test, and the effect marks the right Pokemon.
//   - Stellarize power: the gate binding (I am Stellar type), proven with the ORIGINAL constructor closure kept in slot ctor:0, because the
//     closure itself is a legacy binding (no library atom yet) and so the shared L1 and L2 never rebuild this attr.
import type { AbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { celebrate, TEMPLATES } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { liveAbility, twinRebuild } from "#test/tests/elite-redux/decomp/harness/twin";
import { setStatusOf } from "#test/tests/elite-redux/decomp/harness/world";
import type { AbAttrBaseParams, PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const BAD_DREAMS = 123;
const BALLASTER = 6006;
const BLIND_JUSTICE = 6009;
const CONFECTIOUS = 6034;
const STELLARIZE = 6053;
const BEJEWELED = 6111;

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

describe("B16 chunk 1", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------------------------------------------------
  it("Bad Dreams: a sleeping foe loses floor(maxHp / 4) like the original, the percent param moves it, an awake foe is left alone", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(BAD_DREAMS).attrs[0];
    const module = moduleOf("ErBadDreamsAbAttr");
    const rebuilt = recomposeAttr(module, original, BAD_DREAMS, 0);
    expect(rebuilt).not.toBe(original);
    expect(readDeclParams(module, original)).toEqual({ percent: 25 });

    // Awake: nothing to do for either.
    expect(original.canApply(baseParams(holder))).toBe(false);
    expect(rebuilt.canApply(baseParams(holder))).toBe(false);

    setStatusOf(foe, StatusEffect.SLEEP);
    const max = foe.getMaxHp();
    const loss = (attr: AbAttr, simulated = false): number => {
      foe.hp = max;
      attr.apply(baseParams(holder, simulated));
      return max - foe.hp;
    };
    expect(original.canApply(baseParams(holder))).toBe(true);
    expect(rebuilt.canApply(baseParams(holder))).toBe(true);
    expect(loss(original)).toBe(Math.max(1, Math.floor(max / 4)));
    expect(loss(rebuilt)).toBe(loss(original));
    // Simulated: no change at all.
    expect(loss(original, true)).toBe(0);
    expect(loss(rebuilt, true)).toBe(0);
    // The param is live: 50 percent is half.
    const half = buildAttr(module, { percent: 50 });
    expect(loss(half)).toBe(Math.max(1, Math.floor(max / 2)));
    // A foe on 1 HP is not killed below 0 and the minimum is 1 HP of damage.
    foe.hp = 1;
    original.apply(baseParams(holder));
    expect(foe.hp).toBe(0);
    // The literal /4 and the new percent form agree for every whole max HP.
    for (let m = 1; m <= 5000; m++) {
      expect(Math.floor((m * 25) / 100)).toBe(Math.floor(m / 4));
    }
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Ballaster", () => {
    /** Drives one attr through hits and records everything observable: canApply, the stored charge, the queued retaliation. */
    function drive(
      attr: AbAttr,
      holder: Pokemon,
      foe: Pokemon,
      hits: readonly { move: MoveId; damage: number }[],
      game: { scene: { phaseManager: { unshiftNew: (...args: unknown[]) => unknown } } },
    ): unknown[] {
      holder.summonData.erAbilityProvenance = [];
      const calls: unknown[][] = [];
      const spy = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((...args: unknown[]) => {
        calls.push(args);
        return undefined;
      });
      const record: unknown[] = [];
      for (const hit of hits) {
        const params = hitParams(holder, foe, hit.move, hit.damage);
        const can = attr.canApply(params);
        const before = calls.length;
        if (can) {
          attr.apply(params);
        }
        const queued = calls.slice(before).map(call => {
          const move = call[3] as { moveId: number; getMove(): { power: number } };
          return { phase: call[0], target: call[2], moveId: move.moveId, power: move.getMove().power, mode: call[4] };
        });
        record.push({ can, charge: [...holder.summonData.erAbilityProvenance], queued });
      }
      spy.mockRestore();
      return record;
    }

    it("stores a charge on a first hit, retaliates on the next, retaliates at once for Water, and the rebuild matches every step", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(BALLASTER).attrs[1];
      const module = moduleOf("BallasterAbAttr");
      const rebuilt = recomposeAttr(module, original, BALLASTER, 1);
      expect(rebuilt).not.toBe(original);
      expect(readDeclParams(module, original)).toEqual({
        moveId: "STEAM_ERUPTION",
        power: 80,
        immediateTypes: "FIRE,WATER",
      });

      const sequences: Record<string, readonly { move: MoveId; damage: number }[]> = {
        "two normal hits then a third": [
          { move: MoveId.TACKLE, damage: 5 },
          { move: MoveId.TACKLE, damage: 5 },
          { move: MoveId.TACKLE, damage: 5 },
        ],
        "a water hit at once": [{ move: MoveId.WATER_GUN, damage: 5 }],
        "a normal hit, a water hit, a normal hit": [
          { move: MoveId.TACKLE, damage: 5 },
          { move: MoveId.WATER_GUN, damage: 5 },
          { move: MoveId.TACKLE, damage: 5 },
        ],
        "a fire hit at once": [{ move: MoveId.EMBER, damage: 5 }],
        "no damage, then a status move with damage 5": [
          { move: MoveId.TACKLE, damage: 0 },
          { move: MoveId.SWORDS_DANCE, damage: 5 },
        ],
      };
      for (const [name, hits] of Object.entries(sequences)) {
        const a = drive(original, holder, foe, hits, game as never);
        const b = drive(rebuilt, holder, foe, hits, game as never);
        expect(b, name).toEqual(a);
      }
      // Pin the original's own behaviour so the comparison is not two copies of one mistake.
      const steps = drive(original, holder, foe, sequences["two normal hits then a third"], game as never) as {
        can: boolean;
        charge: string[];
        queued: { moveId: number; power: number }[];
      }[];
      expect(steps.map(step => step.charge)).toEqual([["ballaster:1"], [], ["ballaster:1"]]);
      expect(steps.map(step => step.queued.length)).toEqual([0, 1, 0]);
      expect(steps[1].queued[0]).toMatchObject({ moveId: MoveId.STEAM_ERUPTION, power: 80 });
      const water = drive(original, holder, foe, sequences["a water hit at once"], game as never) as typeof steps;
      expect(water[0].queued.length).toBe(1);
      expect(water[0].charge).toEqual([]);
    });

    it("guards stay in the class (no damage, fainted foe, fainted holder) and the gate is the replaceable damaging-move test", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(BALLASTER).attrs[1];
      const module = moduleOf("BallasterAbAttr");
      const rebuilt = recomposeAttr(module, original, BALLASTER, 1);
      const tackle = hitParams(holder, foe, MoveId.TACKLE, 5);
      expect(original.canApply(tackle)).toBe(true);
      expect(rebuilt.canApply(tackle)).toBe(true);
      expect(rebuilt.canApply(hitParams(holder, foe, MoveId.TACKLE, 0))).toBe(false);
      vi.spyOn(foe, "isFainted").mockReturnValue(true);
      expect(original.canApply(tackle)).toBe(false);
      expect(rebuilt.canApply(tackle)).toBe(false);
      vi.restoreAllMocks();
      vi.spyOn(holder, "isFainted").mockReturnValue(true);
      expect(original.canApply(tackle)).toBe(false);
      expect(rebuilt.canApply(tackle)).toBe(false);
      vi.restoreAllMocks();

      // The gate is a real slot: a status move with damage 5 is refused by the bound gate and accepted when the gate is replaced.
      const growl = hitParams(holder, foe, MoveId.SWORDS_DANCE, 5);
      expect(rebuilt.canApply(growl)).toBe(false);
      const anyMove = recomposeAttr(module, original, BALLASTER, 1, { conds: { gate: { all: [] } } });
      expect(anyMove.canApply(growl)).toBe(true);
      expect(game).toBeDefined();
    });

    it("the params are live: another move, power and hit types change what is queued", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const module = moduleOf("BallasterAbAttr");
      const custom = buildAttr(
        module,
        { moveId: "EARTH_POWER", power: 90, immediateTypes: "GRASS" },
        { gate: { block: "move.damaging", params: {} } },
      );
      const steps = drive(
        custom,
        holder,
        foe,
        [
          { move: MoveId.WATER_GUN, damage: 5 }, // Water is no longer immediate: charge
          { move: MoveId.ENERGY_BALL, damage: 5 }, // Grass is immediate (and a charge exists): retaliate
        ],
        game as never,
      ) as { charge: string[]; queued: { moveId: number; power: number }[] }[];
      expect(steps[0].charge).toEqual(["ballaster:1"]);
      expect(steps[0].queued).toEqual([]);
      expect(steps[1].queued[0]).toMatchObject({ moveId: MoveId.EARTH_POWER, power: 90 });
      expect(scriptedPokemonMove(MoveId.EARTH_POWER, 90).moveId).toBe(MoveId.EARTH_POWER);
    });

    it("L2 twin against a sturdy foe: a second normal hit and a water hit retaliate with Steam Eruption in both battles", async () => {
      for (const foeMove of [MoveId.TACKLE, MoveId.WATER_GUN]) {
        const scenario = {
          template: {
            ...TEMPLATES["foe-hits-holder"],
            id: `b16-ballaster-${MoveId[foeMove]}`,
            label: `A sturdy Snorlax hits the holder with ${MoveId[foeMove]} on three turns`,
            foe: SpeciesId.SNORLAX,
            foeLevel: 100,
            foeMoves: [foeMove],
            turns: [celebrate(), celebrate(), celebrate()],
          },
          axes: {},
          label: `sturdy foe, ${MoveId[foeMove]}`,
        };
        const outcome = await twinRebuild(phaserGame, liveAbility(BALLASTER), declRegistry, scenario);
        expect(outcome.differences).toEqual([]);
        expect(outcome.rebuilt.rebuilt).toContain(1);
        const retaliations = outcome.original.messages.filter(message => /Steam Eruption/.test(message));
        expect(retaliations.length, `the original must retaliate against ${MoveId[foeMove]}`).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------
  it("Blind Justice: two draws in order (Pokemon, then move), nothing drawn without a candidate or when simulated", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    game.move.changeMoveset(foe, [MoveId.SPLASH, MoveId.TACKLE, MoveId.WATER_GUN, MoveId.EMBER]);
    const original = liveAbility(BLIND_JUSTICE).attrs[0];
    const module = moduleOf("BlindJusticeAbAttr");
    const rebuilt = recomposeAttr(module, original, BLIND_JUSTICE, 0);
    expect(rebuilt).not.toBe(original);

    const run = (attr: AbAttr, simulated = false): { ranges: number[]; locked: MoveId | undefined } => {
      foe.removeTag(BattlerTagType.ER_BLIND_JUSTICE);
      const ranges: number[] = [];
      const picks = [0, 2];
      const spy = vi.spyOn(holder, "randBattleSeedInt").mockImplementation((range: number) => {
        ranges.push(range);
        return picks[ranges.length - 1] ?? 0;
      });
      attr.apply(baseParams(holder, simulated));
      spy.mockRestore();
      const tag = foe.getTag(BattlerTagType.ER_BLIND_JUSTICE) as { sourceMove?: MoveId } | undefined;
      return { ranges, locked: tag?.sourceMove };
    };
    const a = run(original);
    // One candidate (the foe), four usable moves; the second draw picked index 2 of the foe's moves.
    expect(a.ranges).toEqual([1, 4]);
    expect(a.locked).toBe(MoveId.WATER_GUN);
    expect(run(rebuilt)).toEqual(a);
    // Simulated: nothing drawn, nothing locked.
    expect(run(original, true)).toEqual({ ranges: [], locked: undefined });
    expect(run(rebuilt, true)).toEqual({ ranges: [], locked: undefined });
    // A foe that already carries the lock is not a candidate: nothing drawn.
    foe.addTag(BattlerTagType.ER_BLIND_JUSTICE, 1, MoveId.TACKLE, holder.id);
    const ranges: number[] = [];
    const spy = vi.spyOn(holder, "randBattleSeedInt").mockImplementation((range: number) => {
      ranges.push(range);
      return 0;
    });
    original.apply(baseParams(holder));
    rebuilt.apply(baseParams(holder));
    spy.mockRestore();
    expect(ranges).toEqual([]);
  });

  // ---------------------------------------------------------------------------------------------------------------------
  it("Confectious: entry marks the holder, the attack marks the foe only for a damaging contact hit that dealt damage", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const entry = liveAbility(CONFECTIOUS).attrs[0];
    const entryRebuilt = recomposeAttr(moduleOf("ConfectiousEntryAbAttr"), entry, CONFECTIOUS, 0);
    holder.removeTag(BattlerTagType.ER_CONFECTED);
    entry.apply(baseParams(holder, true));
    expect(holder.getTag(BattlerTagType.ER_CONFECTED)).toBeUndefined();
    entryRebuilt.apply(baseParams(holder, true));
    expect(holder.getTag(BattlerTagType.ER_CONFECTED)).toBeUndefined();
    entry.apply(baseParams(holder));
    expect(holder.getTag(BattlerTagType.ER_CONFECTED)).toBeDefined();
    holder.removeTag(BattlerTagType.ER_CONFECTED);
    entryRebuilt.apply(baseParams(holder));
    expect(holder.getTag(BattlerTagType.ER_CONFECTED)).toBeDefined();

    const attack = liveAbility(CONFECTIOUS).attrs[1];
    const module = moduleOf("ConfectiousAttackAbAttr");
    const rebuilt = recomposeAttr(module, attack, CONFECTIOUS, 1);
    expect(rebuilt).not.toBe(attack);
    const cases: [string, MoveId, number, boolean][] = [
      ["a contact move that dealt damage", MoveId.TACKLE, 5, true],
      ["a contact move that dealt no damage", MoveId.TACKLE, 0, false],
      ["a non-contact damaging move", MoveId.WATER_GUN, 5, false],
      ["a status move", MoveId.SWORDS_DANCE, 5, false],
      ["a multi-hit contact move", MoveId.DOUBLE_SLAP, 3, true],
    ];
    for (const [name, move, damage, expected] of cases) {
      const params = hitParams(holder, foe, move, damage);
      expect(attack.canApply(params), `original: ${name}`).toBe(expected);
      expect(rebuilt.canApply(params), `rebuild: ${name}`).toBe(expected);
    }
    // The effect marks the foe, and not when simulated.
    foe.removeTag(BattlerTagType.ER_CONFECTED);
    rebuilt.apply(hitParams(holder, foe, MoveId.TACKLE, 5, true));
    expect(foe.getTag(BattlerTagType.ER_CONFECTED)).toBeUndefined();
    rebuilt.apply(hitParams(holder, foe, MoveId.TACKLE, 5));
    expect(foe.getTag(BattlerTagType.ER_CONFECTED)).toBeDefined();
    // Proof of the proof: with the gate replaced by "always true" a non-contact hit passes, so the contact test really is the gate.
    const noGate = recomposeAttr(module, attack, CONFECTIOUS, 1, { conds: { gate: { all: [] } } });
    expect(noGate.canApply(hitParams(holder, foe, MoveId.WATER_GUN, 5))).toBe(true);
    // And the constructor slot is real too: replacing the damaging-move condition lets a status move with damage and contact through only
    // if the gate agrees (Growl makes no contact), while an always-true gate plus an always-true constructor slot accepts it.
    const wide = recomposeAttr(module, attack, CONFECTIOUS, 1, {
      conds: { gate: { all: [] }, "ctor:0": { all: [] } },
    });
    expect(wide.canApply(hitParams(holder, foe, MoveId.SWORDS_DANCE, 5))).toBe(true);
    expect(wide.canApply(hitParams(holder, foe, MoveId.SWORDS_DANCE, 0))).toBe(false);
  });

  // ---------------------------------------------------------------------------------------------------------------------
  describe("Stellarize power (gate bound, constructor closure kept)", () => {
    for (const [abilityId, attrIndex] of [
      [STELLARIZE, 2],
      [BEJEWELED, 4],
    ] as const) {
      it(`ability ${abilityId} attr ${attrIndex}: the rebuild equals the original over holder type, foe form and move type`, async () => {
        const { holder, foe } = await startWorld(phaserGame);
        const original = liveAbility(abilityId).attrs[attrIndex] as AbAttr & { condition: unknown };
        const module = moduleOf("StellarizePowerAbAttr");
        expect(readDeclParams(module, original)).toEqual({ multiplier: 1.5 });
        const rebuilt = recomposeAttr(module, original, abilityId, attrIndex, {
          conds: { "ctor:0": original.condition as never },
        });
        expect(rebuilt).not.toBe(original);

        const results: string[] = [];
        for (const holderTypes of [
          undefined,
          [PokemonType.STELLAR],
          [PokemonType.NORMAL, PokemonType.STELLAR],
        ] as const) {
          holder.summonData.types = holderTypes === undefined ? [] : [...holderTypes];
          for (const tera of [false, true]) {
            foe.isTerastallized = tera;
            for (const move of [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.SWORDS_DANCE]) {
              const make = (): Record<string, unknown> => ({
                pokemon: holder,
                opponent: foe,
                move: allMoves[move],
                power: new NumberHolder(allMoves[move].power),
                simulated: false,
              });
              const run = (attr: AbAttr): [boolean, number] => {
                const params = make();
                const can = attr.canApply(params as never);
                if (can) {
                  attr.apply(params as never);
                }
                return [can, (params.power as NumberHolder).value];
              };
              const a = run(original);
              const b = run(rebuilt);
              expect(b, `types ${String(holderTypes)}, tera ${tera}, ${MoveId[move]}`).toEqual(a);
              results.push(`${String(holderTypes)}|${tera}|${MoveId[move]}|${a[0]}`);
            }
          }
        }
        // Pin the original: only a Stellar holder, a Terastallized foe and a printed Normal move together pass. The closure has no
        // category test, so the Normal status move Swords Dance passes as well (recorded, not changed).
        expect(results.filter(line => line.endsWith("|true"))).toEqual([
          `${PokemonType.STELLAR}|true|TACKLE|true`,
          `${PokemonType.STELLAR}|true|SWORDS_DANCE|true`,
          `${PokemonType.NORMAL},${PokemonType.STELLAR}|true|TACKLE|true`,
          `${PokemonType.NORMAL},${PokemonType.STELLAR}|true|SWORDS_DANCE|true`,
        ]);
        foe.isTerastallized = false;

        // The multiplier is live, and a changed gate changes the result (proof of the proof).
        holder.summonData.types = [PokemonType.STELLAR];
        foe.isTerastallized = true;
        const doubled = recomposeAttr(module, original, abilityId, attrIndex, {
          params: { multiplier: 2 },
          conds: { "ctor:0": original.condition as never },
        });
        const power = new NumberHolder(40);
        const params = { pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], power, simulated: false };
        expect(doubled.canApply(params as never)).toBe(true);
        doubled.apply(params as never);
        expect(power.value).toBe(80);
        const wrongGate = recomposeAttr(module, original, abilityId, attrIndex, {
          conds: {
            "ctor:0": original.condition as never,
            gate: { block: "mon.has-type", params: { who: "holder", type: "FIRE" } },
          },
        });
        expect(wrongGate.canApply(params as never)).toBe(false);
        foe.isTerastallized = false;
      });
    }
  });

  // ---------------------------------------------------------------------------------------------------------------------
  it("Stellarize type: the printed Normal type turns into the chosen type, other moves are untouched, the type param is live", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = moduleOf("StellarizeTypeAbAttr");
    for (const [abilityId, attrIndex] of [
      [STELLARIZE, 0],
      [BEJEWELED, 2],
    ] as const) {
      const original = liveAbility(abilityId).attrs[attrIndex];
      const rebuilt = recomposeAttr(module, original, abilityId, attrIndex);
      for (const attr of [original, rebuilt]) {
        const normal = {
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.TACKLE],
          moveType: new NumberHolder(0),
          simulated: false,
        };
        expect(attr.canApply(normal as never)).toBe(true);
        attr.apply(normal as never);
        expect(normal.moveType.value).toBe(PokemonType.STELLAR);
        const water = {
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.WATER_GUN],
          moveType: new NumberHolder(0),
          simulated: false,
        };
        expect(attr.canApply(water as never)).toBe(false);
      }
    }
    const flying = buildAttr(
      module,
      { type: "FLYING" },
      { "ctor:1": { block: "move.type", params: { type: "NORMAL", effective: false } } },
    );
    const params = {
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.TACKLE],
      moveType: new NumberHolder(0),
      simulated: false,
    };
    expect(flying.canApply(params as never)).toBe(true);
    flying.apply(params as never);
    expect(params.moveType.value).toBe(PokemonType.FLYING);
  });
});
