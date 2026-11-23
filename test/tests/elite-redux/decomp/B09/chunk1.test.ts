/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ErEntryTrapTag } from "#data/arena-tag";
import { allMoves } from "#data/data-lists";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { EntryTailwindClearWeatherAbAttr } from "#data/elite-redux/archetypes/entry-tailwind-clear-weather";
import type { EntryTrapOnFoeSideAbAttr } from "#data/elite-redux/archetypes/entry-trap-on-foe-side";
import type { FieldCritBoostAbAttr } from "#data/elite-redux/archetypes/field-crit-boost";
import type { FieldStatShareAbAttr } from "#data/elite-redux/archetypes/field-stat-share";
import type {
  FireHitFormChangeAbAttr,
  FireUseFormChangeAbAttr,
} from "#data/elite-redux/archetypes/fire-interaction-form-change";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

// B09 chunk 1 probes for what the shared L1 and L2 cannot see:
//   1. Flammable Coat (FireUse / FireHit): the "already in the form" half of the gate, the last-strike safety rule, a fainted
//      holder and the attacker's type change, driven with a stand-in Pokemon (the harness holder has no 'engulfed' form).
//   2. Sharing Is Caring: the reentrancy memory, a zero change, and the shared-turn reset.
//   3. Spore Bed: the two settings read back and change what is laid; Air Lock: Tailwind and the weather clear, with a primal
//      weather that stays; Battle Aura: the bonus setting reads back and rebuilds.

const AIR_LOCK = 76;
const SHARING_IS_CARING = 5290;
const BATTLE_AURA = 5341;
const FLAMMABLE_COAT = 5373;
const SPORE_BED = 5902;

interface FakeMon {
  formIndex: number;
  fainted: boolean;
  readonly species: { forms: { formKey: string }[] };
  readonly turnData: { hitsLeft: number };
  readonly typeOverride: Map<MoveId, PokemonType>;
  getFormKey(): string;
  isFainted(): boolean;
  getMoveType(move: { id: MoveId; type: PokemonType }): PokemonType;
}

/** Only the members the two classes and the library atoms read. Form index 1 is the 'engulfed' form. */
function fakeMon(): FakeMon {
  const forms = [{ formKey: "" }, { formKey: "engulfed" }];
  const mon: FakeMon = {
    formIndex: 0,
    fainted: false,
    species: { forms },
    turnData: { hitsLeft: 0 },
    typeOverride: new Map(),
    getFormKey: () => (forms.length <= mon.formIndex ? "" : forms[mon.formIndex].formKey),
    isFainted: () => mon.fainted,
    getMoveType: move => mon.typeOverride.get(move.id) ?? move.type,
  };
  return mon;
}

/** Read inside each test: allMoves is only filled once a game has started. */
const fireProbeMoves = () => [
  allMoves[MoveId.EMBER],
  allMoves[MoveId.FLAME_WHEEL],
  allMoves[MoveId.WILL_O_WISP],
  allMoves[MoveId.TACKLE],
  allMoves[MoveId.WATER_GUN],
  allMoves[MoveId.SWORDS_DANCE],
];

describe("B09 chunk 1 (hazard markers, Air Lock rider, Spore Bed, Battle Aura, Sharing Is Caring, Flammable Coat)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Flammable Coat, using a Fire move: the rebuilt gate agrees with the original for form, faint, last strike and move", async () => {
    await startWorld(phaserGame);
    const original = liveAbility(FLAMMABLE_COAT).attrs[0] as FireUseFormChangeAbAttr;
    expect(original.constructor.name).toBe("FireUseFormChangeAbAttr");
    const module = declRegistry.get("FireUseFormChangeAbAttr")!;
    const rebuilt = recomposeAttr(module, original, FLAMMABLE_COAT, 0) as FireUseFormChangeAbAttr;
    expect(readDeclParams(module, original)).toEqual({ formKey: "engulfed" });
    let compared = 0;
    let yes = 0;
    const holder = fakeMon();
    const foe = fakeMon();
    for (const formIndex of [0, 1]) {
      for (const fainted of [false, true]) {
        for (const hitsLeft of [0, 1, 2, 5]) {
          for (const move of fireProbeMoves()) {
            holder.formIndex = formIndex;
            holder.fainted = fainted;
            holder.turnData.hitsLeft = hitsLeft;
            const params = {
              pokemon: holder,
              opponent: foe,
              move,
              damage: 10,
              hitResult: HitResult.EFFECTIVE,
              simulated: false,
            } as unknown as PostMoveInteractionAbAttrParams;
            const expected = original.canApply(params);
            expect(
              rebuilt.canApply(params),
              `${move.name}, form ${formIndex}, fainted ${fainted}, hitsLeft ${hitsLeft}`,
            ).toBe(expected);
            compared++;
            yes += expected ? 1 : 0;
          }
        }
      }
    }
    expect(yes, "some states pass").toBeGreaterThan(0);
    expect(compared - yes, "some states are blocked").toBeGreaterThan(0);
    // Truth table of the original, so the agreement is not vacuous.
    const at = (
      formIndex: number,
      fainted: boolean,
      hitsLeft: number,
      move: ReturnType<typeof fireProbeMoves>[number],
    ) => {
      holder.formIndex = formIndex;
      holder.fainted = fainted;
      holder.turnData.hitsLeft = hitsLeft;
      return original.canApply({ pokemon: holder, opponent: foe, move } as unknown as PostMoveInteractionAbAttrParams);
    };
    expect(at(0, false, 0, allMoves[MoveId.EMBER])).toBe(true);
    expect(at(0, false, 0, allMoves[MoveId.WILL_O_WISP])).toBe(true); // a status Fire move counts
    expect(at(0, false, 0, allMoves[MoveId.TACKLE])).toBe(false); // not Fire
    expect(at(1, false, 0, allMoves[MoveId.EMBER])).toBe(false); // already in the form
    expect(at(0, true, 0, allMoves[MoveId.EMBER])).toBe(false); // fainted
    expect(at(0, false, 2, allMoves[MoveId.EMBER])).toBe(false); // not the last strike
    expect(at(0, false, 1, allMoves[MoveId.EMBER])).toBe(true); // the last strike
    // My own type-changing ability counts (the class asks the holder).
    holder.typeOverride.set(MoveId.TACKLE, PokemonType.FIRE);
    expect(at(0, false, 0, allMoves[MoveId.TACKLE])).toBe(true);
    expect(rebuilt.canApply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE] } as never)).toBe(true);
    holder.typeOverride.clear();
    // The form key setting moves the gate: a rebuild for another key is not "in the form" while the holder is in 'engulfed'.
    const other = recomposeAttr(module, original, FLAMMABLE_COAT, 0, {
      params: { formKey: "hivemind" },
    }) as FireUseFormChangeAbAttr;
    holder.formIndex = 1;
    holder.fainted = false;
    holder.turnData.hitsLeft = 0;
    const emberParams = { pokemon: holder, opponent: foe, move: allMoves[MoveId.EMBER] } as never;
    expect(original.canApply(emberParams)).toBe(false);
    expect(other.canApply(emberParams)).toBe(true);
    expect(other.getTargetFormKey()).toBe("hivemind");
  });

  it("Flammable Coat, hit by a Fire move: the attacker's move type counts and the rebuilt gate agrees with the original", async () => {
    await startWorld(phaserGame);
    const original = liveAbility(FLAMMABLE_COAT).attrs[1] as FireHitFormChangeAbAttr;
    expect(original.constructor.name).toBe("FireHitFormChangeAbAttr");
    const module = declRegistry.get("FireHitFormChangeAbAttr")!;
    const rebuilt = recomposeAttr(module, original, FLAMMABLE_COAT, 1) as FireHitFormChangeAbAttr;
    expect(readDeclParams(module, original)).toEqual({ formKey: "engulfed" });
    const holder = fakeMon();
    const attacker = fakeMon();
    let yes = 0;
    let compared = 0;
    for (const formIndex of [0, 1]) {
      for (const fainted of [false, true]) {
        for (const retype of [undefined, PokemonType.FIRE, PokemonType.NORMAL]) {
          for (const move of fireProbeMoves()) {
            holder.formIndex = formIndex;
            holder.fainted = fainted;
            attacker.typeOverride.clear();
            if (retype !== undefined) {
              attacker.typeOverride.set(move.id, retype);
            }
            const params = {
              pokemon: holder,
              opponent: attacker,
              move,
              damage: 10,
              hitResult: HitResult.EFFECTIVE,
              simulated: false,
            } as unknown as PostMoveInteractionAbAttrParams;
            const expected = original.canApply(params);
            expect(
              rebuilt.canApply(params),
              `${move.name}, form ${formIndex}, fainted ${fainted}, attacker type ${String(retype)}`,
            ).toBe(expected);
            compared++;
            yes += expected ? 1 : 0;
          }
        }
      }
    }
    expect(yes).toBeGreaterThan(0);
    expect(compared - yes).toBeGreaterThan(0);
    // Truth table: the ATTACKER's type change decides (Normalize turns Ember into Normal; a Fire-ised Tackle counts).
    holder.formIndex = 0;
    holder.fainted = false;
    attacker.typeOverride.clear();
    const hit = (move: ReturnType<typeof fireProbeMoves>[number]) =>
      original.canApply({ pokemon: holder, opponent: attacker, move } as unknown as PostMoveInteractionAbAttrParams);
    expect(hit(allMoves[MoveId.EMBER])).toBe(true);
    expect(hit(allMoves[MoveId.TACKLE])).toBe(false);
    attacker.typeOverride.set(MoveId.EMBER, PokemonType.NORMAL);
    attacker.typeOverride.set(MoveId.TACKLE, PokemonType.FIRE);
    expect(hit(allMoves[MoveId.EMBER])).toBe(false);
    expect(hit(allMoves[MoveId.TACKLE])).toBe(true);
    expect(rebuilt.canApply({ pokemon: holder, opponent: attacker, move: allMoves[MoveId.TACKLE] } as never)).toBe(
      true,
    );
  });

  it("Sharing Is Caring: a zero change is not shared, the per-turn memory blocks a second share, and a new turn clears it", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const original = liveAbility(SHARING_IS_CARING).attrs[0] as FieldStatShareAbAttr;
    expect(original.constructor.name).toBe("FieldStatShareAbAttr");
    const module = declRegistry.get("FieldStatShareAbAttr")!;
    const rebuilt = recomposeAttr(module, original, SHARING_IS_CARING, 0) as FieldStatShareAbAttr;
    const params = (stages: number) =>
      ({ pokemon: holder, stats: [Stat.ATK], stages, selfTarget: false, simulated: false }) as never;
    for (const stages of [0, 1, -2, 6]) {
      expect(rebuilt.canApply(params(stages)), `stages ${stages} before any share`).toBe(
        original.canApply(params(stages)),
      );
    }
    expect(original.canApply(params(0))).toBe(false);
    expect(original.canApply(params(1))).toBe(true);
    expect(original.canApply(params(-2))).toBe(true);
    // A simulated apply leaves no memory.
    original.apply({ ...(params(1) as object), simulated: true } as never);
    expect(original.canApply(params(1))).toBe(true);
    // A real apply stamps the turn: both the original and the rebuild now refuse, for every amount.
    original.apply(params(1));
    for (const stages of [1, -2]) {
      expect(original.canApply(params(stages)), `original, stages ${stages}, same turn`).toBe(false);
      expect(rebuilt.canApply(params(stages)), `rebuilt, stages ${stages}, same turn`).toBe(false);
    }
    // The next turn clears the memory again.
    game.scene.currentBattle.turn += 1;
    expect(original.canApply(params(1))).toBe(true);
    expect(rebuilt.canApply(params(1))).toBe(true);
    expect(rebuilt.canApply(params(0))).toBe(false);
  });

  it("Spore Bed: the battle effect and the side read back, rebuild, and decide what is laid", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const original = liveAbility(SPORE_BED).attrs[0] as EntryTrapOnFoeSideAbAttr;
    expect(original.constructor.name).toBe("EntryTrapOnFoeSideAbAttr");
    const module = declRegistry.get("EntryTrapOnFoeSideAbAttr")!;
    expect(readDeclParams(module, original)).toEqual({ effect: "Infestation", side: "The opposing side" });
    const arena = game.scene.arena;
    const params = { pokemon: holder, simulated: false } as never;
    // The original lays the trap on the enemy side (the holder is a player) with Infestation.
    original.apply({ pokemon: holder, simulated: true } as never);
    expect(arena.getTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, ArenaTagSide.ENEMY)).toBeUndefined();
    original.apply(params);
    const laid = arena.getTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, ArenaTagSide.ENEMY);
    expect(laid).toBeInstanceOf(ErEntryTrapTag);
    expect((laid as ErEntryTrapTag).appliedTag).toBe(BattlerTagType.INFESTATION);
    expect(arena.getTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, ArenaTagSide.PLAYER)).toBeUndefined();
    arena.removeTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, ArenaTagSide.ENEMY, true);
    // A rebuild with the two settings changed lays a Confusion trap on my own side.
    const changed = recomposeAttr(module, original, SPORE_BED, 0, {
      params: { effect: "Confusion", side: "My own side" },
    }) as EntryTrapOnFoeSideAbAttr;
    changed.apply(params);
    const own = arena.getTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, ArenaTagSide.PLAYER);
    expect(own).toBeInstanceOf(ErEntryTrapTag);
    expect((own as ErEntryTrapTag).appliedTag).toBe(BattlerTagType.CONFUSED);
    expect(arena.getTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, ArenaTagSide.ENEMY)).toBeUndefined();
    arena.removeTagOnSide(ArenaTagType.ER_INFESTATION_TRAP, ArenaTagSide.PLAYER, true);
    // The unchanged rebuild reads back the same settings.
    const same = recomposeAttr(module, original, SPORE_BED, 0) as EntryTrapOnFoeSideAbAttr;
    expect(readDeclParams(module, same)).toEqual({ effect: "Infestation", side: "The opposing side" });
  });

  it("Air Lock rider: Tailwind goes on my side and a normal weather is cleared, a primal weather stays, a simulated entry does nothing", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const original = liveAbility(AIR_LOCK).attrs[4] as EntryTailwindClearWeatherAbAttr;
    expect(original.constructor.name).toBe("EntryTailwindClearWeatherAbAttr");
    const arena = game.scene.arena;
    setWeatherOf(game, WeatherType.RAIN);
    original.apply({ pokemon: holder, simulated: true } as never);
    expect(arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)).toBeUndefined();
    expect(arena.weather?.weatherType).toBe(WeatherType.RAIN);
    original.apply({ pokemon: holder, simulated: false } as never);
    const tailwind = arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER);
    expect(tailwind, "Tailwind on my side").toBeDefined();
    expect(tailwind?.turnCount).toBe(3);
    expect(arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.ENEMY)).toBeUndefined();
    expect(arena.weather?.weatherType ?? WeatherType.NONE).toBe(WeatherType.NONE);
    // A primal weather is immutable and stays.
    arena.removeTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER, true);
    setWeatherOf(game, WeatherType.HEAVY_RAIN);
    original.apply({ pokemon: holder, simulated: false } as never);
    expect(arena.weather?.weatherType).toBe(WeatherType.HEAVY_RAIN);
    expect(arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)).toBeDefined();
  });

  it("Battle Aura: the bonus reads back, rebuilds and moves with the setting", async () => {
    await startWorld(phaserGame);
    const original = liveAbility(BATTLE_AURA).attrs[0] as FieldCritBoostAbAttr;
    expect(original.constructor.name).toBe("FieldCritBoostAbAttr");
    const module = declRegistry.get("FieldCritBoostAbAttr")!;
    expect(readDeclParams(module, original)).toEqual({ bonus: 2 });
    const same = recomposeAttr(module, original, BATTLE_AURA, 0) as FieldCritBoostAbAttr;
    expect(same.bonus).toBe(2);
    const more = recomposeAttr(module, original, BATTLE_AURA, 0, { params: { bonus: 3 } }) as FieldCritBoostAbAttr;
    expect(more.bonus).toBe(3);
    expect(more.constructor.name).toBe("FieldCritBoostAbAttr");
  });
});
