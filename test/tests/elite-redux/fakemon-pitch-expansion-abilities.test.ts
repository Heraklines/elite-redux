/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene, initGlobalScene } from "#app/global-scene";
import { SlabCurseTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { manualCompositeConstituents } from "#data/elite-redux/abilities/composite-newcomers";
import {
  ER_BOOBY_TRAP_ABILITY_ID,
  ER_CELESTIAL_JELLY_ABILITY_ID,
  ER_EBB_AND_FLOW_ABILITY_ID,
  ER_FAKEMON_PITCH_ABILITIES,
  ER_LOW_TIDE_ABILITY_ID,
  ER_MANIFEST_ABILITY_ID,
  ER_MIRACLE_BLADE_ABILITY_ID,
  ER_MOONARCH_ABILITY_ID,
  ER_OFUDA_ABILITY_ID,
  ER_PAPER_TALISMAN_ABILITY_ID,
  ER_SEA_SPECTER_ABILITY_ID,
  ER_SLABS_CURSE_ABILITY_ID,
  ER_SPIRITUAL_SABER_ABILITY_ID,
} from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import {
  applyBoobyTrapHealing,
  BitterDrillDamageAbAttr,
  BoobyTrapAbAttr,
  BoobyTrapItemLostAbAttr,
  CelestialJellyAbAttr,
  LowTideWaterSurfAbAttr,
  ManifestContactAbAttr,
  MiracleBladeTypeChartAbAttr,
  OfudaAbAttr,
  rotateSouthernCrossPunchTargets,
  SeaSpecterAbAttr,
  SlabsCurseAbAttr,
  SpiritualSaberNoContactAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import type { Move } from "#data/moves/move";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { NumberHolder } from "#utils/common";
import { describe, expect, it } from "vitest";

const NEW_IDS = [
  ER_MIRACLE_BLADE_ABILITY_ID,
  ER_SPIRITUAL_SABER_ABILITY_ID,
  ER_SLABS_CURSE_ABILITY_ID,
  ER_BOOBY_TRAP_ABILITY_ID,
  ER_MANIFEST_ABILITY_ID,
  ER_PAPER_TALISMAN_ABILITY_ID,
  ER_OFUDA_ABILITY_ID,
  ER_LOW_TIDE_ABILITY_ID,
  ER_SEA_SPECTER_ABILITY_ID,
  ER_EBB_AND_FLOW_ABILITY_ID,
  ER_MOONARCH_ABILITY_ID,
  ER_CELESTIAL_JELLY_ABILITY_ID,
];

describe("fakemon pitch ability registration", () => {
  it("registers every owned ability", () => {
    expect(NEW_IDS.every(id => ER_FAKEMON_PITCH_ABILITIES.some(def => def.pokerogueId === id))).toBe(true);
  });

  it("keeps source drafts and runtime registrations one-to-one", () => {
    const sourceIds = ER_FAKEMON_PITCH_ABILITIES.map(def => def.draft.id);
    const registeredIds = ER_FAKEMON_PITCH_ABILITIES.map(def => def.pokerogueId);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
    expect(new Set(registeredIds).size).toBe(registeredIds.length);
    expect([...registeredIds].toSorted()).toEqual([...sourceIds].toSorted());
  });
});

describe("Iron Stream and composite ability mechanics", () => {
  it("makes slicing moves super-effective against Dark through Miracle Blade", () => {
    const move = { hasFlag: (flag: MoveFlags) => flag === MoveFlags.SLICING_MOVE } as never;
    const multiplier = new NumberHolder(0.5);
    new MiracleBladeTypeChartAbAttr().fire(move, [PokemonType.DARK], multiplier);
    expect(multiplier.value).toBe(2);
  });

  it("only injects contact for an active Manifest holder when no override strips it", () => {
    const attr = new ManifestContactAbAttr();
    expect(attr.forcesContact()).toBe(true);
  });
});

describe("entry-local bespoke state", () => {
  it("exposes summon-local Slab curse and Celestial Jelly latches", () => {
    expect(new SlabsCurseAbAttr()).toBeInstanceOf(SlabsCurseAbAttr);
    expect(new CelestialJellyAbAttr()).toBeInstanceOf(CelestialJellyAbAttr);
  });
});

describe("source-backed combat hooks", () => {
  it("routes Manifest through the real contact flag resolver and honors forced non-contact", () => {
    const move = allMoves[MoveId.WATER_GUN];
    const holder = {
      hasAbilityWithAttr: () => false,
      getAllActiveAbilityAttrs: () => [new ManifestContactAbAttr()],
    } as never;
    expect(move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: holder })).toBe(true);
    const forced = {
      hasAbilityWithAttr: (name: string) => name === "IgnoreContactAbAttr",
      getAllActiveAbilityAttrs: () => [new ManifestContactAbAttr()],
    } as never;
    expect(move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: forced })).toBe(false);
  });

  it("applies Slab's Curse PP drain to every move and ends when one reaches zero", () => {
    let spent = 0;
    const moves = [
      {
        usePp: (amount: number) => {
          spent += amount;
        },
        isOutOfPp: () => false,
      },
      {
        usePp: (amount: number) => {
          spent += amount;
        },
        isOutOfPp: () => true,
      },
    ];
    const tag = new SlabCurseTag(1, 2);
    expect(tag.lapse({ getMoveset: () => moves } as never, BattlerTagLapseType.TURN_END)).toBe(false);
    expect(spent).toBe(4);
  });

  it("Booby Trap curses only the first direct attacker per summon", () => {
    const holder = {
      isPlayer: () => false,
      summonData: { erAbilityProvenance: [] },
    } as never;
    const attacker = {
      id: 2,
      isPlayer: () => true,
      canAddTag: () => true,
      addTag: (..._args: unknown[]) => undefined,
    } as never;
    const params = {
      pokemon: holder,
      opponent: attacker,
      move: {
        category: MoveCategory.PHYSICAL,
        id: MoveId.TACKLE,
        doesFlagEffectApply: () => true,
      },
      hitResult: HitResult.EFFECTIVE,
      damage: 10,
      simulated: false,
    } as never;
    const attr = new BoobyTrapAbAttr();
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(attr.canApply(params)).toBe(false);
  });

  it("Ofuda's defensive curse is contact-independent", () => {
    const attacker = {
      canAddTag: () => true,
      addTag: (..._args: unknown[]) => undefined,
    } as never;
    const holder = { randBattleSeedInt: () => 0 } as never;
    const params = {
      pokemon: holder,
      opponent: attacker,
      move: { id: MoveId.TACKLE, category: MoveCategory.PHYSICAL },
      hitResult: HitResult.EFFECTIVE,
      damage: 0,
      simulated: false,
    } as never;
    expect(new OfudaAbAttr().canApply(params)).toBe(true);
  });

  it("Sea Specter aliases Ghost and Water trigger families", () => {
    const ghostMove = { type: PokemonType.GHOST } as Move;
    const waterMove = { type: PokemonType.WATER } as Move;
    expect(new SeaSpecterAbAttr().getTriggeredMoveTypes(ghostMove)).toEqual([PokemonType.GHOST, PokemonType.WATER]);
    expect(new SeaSpecterAbAttr().getTriggeredMoveTypes(waterMove)).toEqual([PokemonType.WATER, PokemonType.GHOST]);
  });

  it("Spiritual Saber marks Keen Edge moves as non-contact", () => {
    const user = {
      hasAbilityWithAttr: () => false,
      getAllActiveAbilityAttrs: () => [new SpiritualSaberNoContactAbAttr()],
    } as never;
    expect(
      allMoves[MoveId.NIGHT_SLASH].doesFlagEffectApply({
        flag: MoveFlags.MAKES_CONTACT,
        user,
      }),
    ).toBe(false);
  });

  it("retargets the target arrays already captured by queued move phases", () => {
    const firstTarget = 1;
    const secondTarget = 3;
    const capturedTargets = [firstTarget];
    const command: { targets?: number[]; move: { targets: number[] } } = {
      move: { targets: capturedTargets },
    };
    const previousScene = globalScene;
    initGlobalScene({
      currentBattle: {
        turnCommands: { 0: command },
      },
    } as never);

    try {
      rotateSouthernCrossPunchTargets({
        getOpponents: () => [
          { isActive: () => true, getBattlerIndex: () => firstTarget },
          { isActive: () => true, getBattlerIndex: () => secondTarget },
        ],
      } as never);

      expect(command.targets).toBe(capturedTargets);
      expect(command.move.targets).toBe(capturedTargets);
      expect(capturedTargets).toEqual([secondTarget]);
    } finally {
      if (previousScene) {
        initGlobalScene(previousScene);
      }
    }
  });

  it("doubles the attacker's drill power against an Embedded target", () => {
    const attr = new BitterDrillDamageAbAttr();
    const power = new NumberHolder(40);
    const params = {
      pokemon: {},
      opponent: {
        getTag: (tag: BattlerTagType) => (tag === BattlerTagType.ER_EMBEDDED ? {} : undefined),
      },
      move: {
        hasFlag: (flag: MoveFlags) => flag === MoveFlags.DRILL_BASED,
      },
      power,
      simulated: true,
    } as never;

    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(power.value).toBe(80);
  });
});
describe("remaining pitch contracts", () => {
  it("applies Slab's Curse for two turns to the attacker and one to each adjacent ally", () => {
    const durations: number[] = [];
    const ally = {
      isFainted: () => false,
      addTag: (_tag: unknown, duration: number) => durations.push(duration),
      getTag: () => undefined,
    };
    const attacker = {
      addTag: (_tag: unknown, duration: number) => durations.push(duration),
      getAdjacentAllies: () => [ally],
    };
    new SlabsCurseAbAttr().apply({ pokemon: { id: 1 } as never, attacker: attacker as never, simulated: false });
    expect(durations).toEqual([2, 1]);
  });

  it("retains Slab's Curse until the selected move reaches zero PP", () => {
    let pp = 3;
    const move = {
      usePp: (amount: number) => {
        pp -= amount;
      },
      isOutOfPp: () => pp <= 0,
    };
    const pokemon = { getMoveset: () => [move] };
    const tag = new SlabCurseTag(1, 2);
    expect(tag.lapse(pokemon as never, BattlerTagLapseType.TURN_END)).toBe(true);
    expect(tag.lapse(pokemon as never, BattlerTagLapseType.TURN_END)).toBe(false);
  });

  it("Booby Trap curses the thief when its item is removed", () => {
    let cursed = false;
    const thief = {
      isPlayer: () => true,
      addTag: () => {
        cursed = true;
      },
    } as never;
    new BoobyTrapItemLostAbAttr().apply({
      pokemon: { id: 1, isPlayer: () => false, summonData: { erAbilityProvenance: [] } } as never,
      opponent: thief,
      simulated: false,
    });
    expect(cursed).toBe(true);
  });

  it("heals the active Booby Trap holder for half the cursed foe's damage", () => {
    let healed = 0;
    const holder = {
      id: 1,
      isActive: () => true,
      getAllActiveAbilityAttrs: () => [new BoobyTrapAbAttr()],
      summonData: { erAbilityProvenance: ["booby-trap:2"] },
      heal: (amount: number) => {
        healed += amount;
      },
    };
    applyBoobyTrapHealing({ id: 2 } as never, 21, [holder as never]);
    expect(healed).toBe(10);
  });

  it("Low Tide answers with Water Surf after a Water move", () => {
    const attr = new LowTideWaterSurfAbAttr();
    const opponent = { getMoveType: (move: Move) => move.type } as never;
    expect(
      attr.canApply({
        opponent,
        move: allMoves[MoveId.WATER_GUN],
        simulated: false,
      } as never),
    ).toBe(true);
    expect(
      attr.canApply({
        opponent,
        move: allMoves[MoveId.EMBER],
        simulated: false,
      } as never),
    ).toBe(false);
  });

  it("wires Paper Talisman and Ebb and Flow to two existing constituent abilities", () => {
    const paper = manualCompositeConstituents(ER_PAPER_TALISMAN_ABILITY_ID);
    const ebb = manualCompositeConstituents(ER_EBB_AND_FLOW_ABILITY_ID);
    expect(paper).toHaveLength(2);
    expect(ebb).toHaveLength(2);
  });

  it("keeps the exact Spiritual Saber contract", () => {
    const definition = ER_FAKEMON_PITCH_ABILITIES.find(entry => entry.pokerogueId === ER_SPIRITUAL_SABER_ABILITY_ID)
      ?.draft.description;
    expect(definition).toMatch(/Blade's Essence/u);
    expect(definition).toMatch(/Keen Edge/u);
    expect(definition).toMatch(/no contact/u);
  });

  it("keeps the exact Paper Talisman contract", () => {
    const definition = ER_FAKEMON_PITCH_ABILITIES.find(entry => entry.pokerogueId === ER_PAPER_TALISMAN_ABILITY_ID)
      ?.draft.description;
    expect(definition).toContain("Fluffy + Aegis Ward");
  });

  it("keeps the exact Ebb and Flow contract", () => {
    const definition = ER_FAKEMON_PITCH_ABILITIES.find(entry => entry.pokerogueId === ER_EBB_AND_FLOW_ABILITY_ID)?.draft
      .description;
    expect(definition).toContain("Tidal Rush + High Tide");
  });

  it("only revives Celestial Jelly through its terrain/weather-gated pre-faint attr", () => {
    const attr = new CelestialJellyAbAttr();
    const pokemon = {
      battleData: { erAbilityProvenance: ["celestial-jelly:spent"] },
      getMaxHp: () => 100,
      hp: 0,
    } as never;
    expect(attr.canApply({ pokemon, damage: { value: 100 } } as never)).toBe(false);
  });

  it("clamps a lethal hit to 25% HP once and clears status", () => {
    const pokemon = {
      battleData: { erAbilityProvenance: [] as string[] },
      getMaxHp: () => 100,
      hp: 100,
      resetStatus: () => undefined,
      updateInfo: () => undefined,
    };
    const damage = { value: 100 };
    new CelestialJellyAbAttr().apply({ pokemon: pokemon as never, damage, simulated: false } as never);
    expect(damage.value).toBe(75);
    expect(pokemon.battleData.erAbilityProvenance).toContain("celestial-jelly:spent");
  });
});
