/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 4 probes. The five declared classes are presence flags (never dispatched, so the shared L2 twin only compares a generic
// battle that never reaches their reader) or sit on the ATTACKER (CritUseLowerDefensiveStatAbAttr, whose L2 template makes the foe
// hit the holder). This file proves them by hand with the ORIGINAL attr of every real user and its REBUILD (recomposeAttr: a fresh
// instance made from the declaration), side by side, then through real battles / real engine readers:
//   1. every user of every class is rebuilt, keeps its class name and showAbility, and is a fresh object;
//   2. CritUseLowerDefensiveStatAbAttr: apply over every Defense x Sp. Def stage combination (a tie, either side lower, no defender),
//      and the real damage of a critical hit against Cloyster (Def 200, Sp. Def 65) with the original ability, its rebuilt shadow and
//      no ability;
//   3. BadDreamsImmunityAbAttr: a sleeping holder next to a Bad Dreams foe, original against rebuilt shadow, against a control;
//   4. BugPowderImmunityAbAttr: Move.isTypeImmune for a Bug-type and a non-Bug holder, and a real Sleep Powder battle;
//   5. IgnoreGenderInfatuationAbAttr: InfatuatedTag.canAdd for same-gender and genderless targets;
//   6. SwitchWhileRampagingAbAttr: the command menu opens mid-rampage for the original and the shadow, not for the control;
//   7. PreserveBaseStatAbilitiesAbAttr (parked, see decl/B04/pending): the ORIGINAL users' engine behaviour is pinned, and the
//      rebuild comparison runs as soon as the declaration exists.
import type { AbAttr } from "#abilities/ab-attrs";
import { InfatuatedTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { CommandPhase } from "#phases/command-phase";
import type { GameManager } from "#test/framework/game-manager";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { allocateShadowId, liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const DEADEYE = 5113;
const SWEET_DREAMS = 5071;
const PEACEFUL_SLUMBER = 5220;
const POLLINATE = 5118;
const BEAUTIFUL_MUSIC = 5326;
const DISCIPLINE = 5125;
const CHUNK4_CLASSES = [
  "CritUseLowerDefensiveStatAbAttr",
  "BadDreamsImmunityAbAttr",
  "BugPowderImmunityAbAttr",
  "IgnoreGenderInfatuationAbAttr",
  "SwitchWhileRampagingAbAttr",
] as const;
const PARKED_CLASS = "PreserveBaseStatAbilitiesAbAttr";

// The attrs are typed per trigger; the tests feed them plain parameter objects.
// biome-ignore lint/suspicious/noExplicitAny: parameter objects differ per trigger
type Params = any;

function sitesOf(className: string): { abilityId: number; abilityName: string; attrIndex: number }[] {
  return allAttrSites()
    .filter(site => site.className === className)
    .map(({ abilityId, abilityName, attrIndex }) => ({ abilityId, abilityName, attrIndex }));
}

/** The original attr of a live ability and its rebuild from the declaration. */
function pair(abilityId: number, attrIndex: number, className: string): { original: AbAttr; rebuilt: AbAttr } {
  const original = liveAbility(abilityId).attrs[attrIndex];
  expect(original.constructor.name).toBe(className);
  const module = declRegistry.get(className);
  expect(module, `${className} has a declaration`).toBeDefined();
  const rebuilt = recomposeAttr(module!, original, abilityId, attrIndex, {});
  expect(rebuilt).not.toBe(original);
  expect(rebuilt.constructor.name).toBe(className);
  return { original, rebuilt };
}

describe("B04 chunk 4: presence flags and the attacker-side defensive stat pick", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterShadows);

  async function start(
    setup: (game: GameManager) => void,
    holder: SpeciesId = SpeciesId.BLISSEY,
  ): Promise<{ game: GameManager; holder: Pokemon; foe: Pokemon }> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(1)
      .moveset([MoveId.SPLASH])
      .startingLevel(100)
      .enemyLevel(30)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .ability(AbilityId.BALL_FETCH)
      .criticalHits(false)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    setup(game);
    await game.classicMode.startBattle(holder);
    return { game, holder: game.field.getPlayerPokemon(), foe: game.field.getEnemyPokemon() };
  }

  /** The id of a shadow ability rebuilt from `abilityId` (every attr of the five classes is rebuilt). */
  function shadowOf(abilityId: number): number {
    const shadowId = allocateShadowId();
    const rebuilt = rebuildAbility(liveAbility(abilityId), shadowId, { registry: declRegistry });
    expect(
      rebuilt.carried.filter(entry => (CHUNK4_CLASSES as readonly string[]).includes(entry.className)),
      "every attr of this chunk is rebuilt",
    ).toEqual([]);
    expect(rebuilt.rebuilt.length, "something was rebuilt").toBeGreaterThan(0);
    registerShadow(shadowId, rebuilt.ability);
    return shadowId;
  }

  it("every user of the five classes is rebuilt as a fresh attr with the same class and showAbility", () => {
    const expectedUsers: Record<string, string[]> = {
      CritUseLowerDefensiveStatAbAttr: ["Celestial Bow", "Deadeye", "Hunter's Mark"],
      BadDreamsImmunityAbAttr: ["Honk Shoo", "Peaceful Slumber", "Sweet Dreams"],
      BugPowderImmunityAbAttr: ["Pollinate", "Steel Beetle"],
      IgnoreGenderInfatuationAbAttr: ["Beautiful Music"],
      SwitchWhileRampagingAbAttr: ["Discipline"],
    };
    for (const className of CHUNK4_CLASSES) {
      const sites = sitesOf(className);
      expect(sites.map(site => site.abilityName).sort(), className).toEqual(expectedUsers[className]);
      for (const site of sites) {
        const { original, rebuilt } = pair(site.abilityId, site.attrIndex, className);
        expect(rebuilt.showAbility, `${site.abilityName}: showAbility`).toBe(original.showAbility);
        expect(
          (rebuilt as unknown as { extraCondition?: unknown }).extraCondition,
          `${site.abilityName}: no attr-level condition appears`,
        ).toBe((original as unknown as { extraCondition?: unknown }).extraCondition);
        const built = buildAttr(declRegistry.get(className)!);
        expect(built.constructor.name).toBe(className);
        expect(built.showAbility, `${className}: a built attr is never shown in the flyout`).toBe(false);
      }
    }
  });

  it("CritUseLowerDefensiveStat: the lower of Defense and Sp. Def is picked over every stage combination, a tie picks Defense", async () => {
    const { holder, foe: defender } = await start(() => {});
    const sites = sitesOf("CritUseLowerDefensiveStatAbAttr");
    expect(sites.length).toBe(3);
    let compared = 0;
    let sawDef = 0;
    let sawSpDef = 0;
    for (const defStage of [-6, -3, 0, 2, 6] as const) {
      for (const spDefStage of [-6, -3, 0, 2, 6] as const) {
        defender.setStatStage(Stat.DEF, defStage);
        defender.setStatStage(Stat.SPDEF, spDefStage);
        const def = defender.getEffectiveStat(Stat.DEF);
        const spDef = defender.getEffectiveStat(Stat.SPDEF);
        const expected = def <= spDef ? Stat.DEF : Stat.SPDEF;
        for (const site of sites) {
          const { original, rebuilt } = pair(site.abilityId, site.attrIndex, "CritUseLowerDefensiveStatAbAttr");
          for (const attr of [original, rebuilt]) {
            for (const start of [Stat.DEF, Stat.SPDEF] as const) {
              const statHolder = new NumberHolder(start);
              expect(attr.canApply({ pokemon: holder, defender, statHolder, simulated: false } as Params)).toBe(true);
              attr.apply({ pokemon: holder, defender, statHolder, simulated: false } as Params);
              expect(statHolder.value, `${site.abilityName} def ${def} spdef ${spDef}`).toBe(expected);
              compared++;
            }
          }
        }
        if (expected === Stat.DEF) {
          sawDef++;
        } else {
          sawSpDef++;
        }
      }
    }
    expect(compared).toBeGreaterThan(100);
    expect(sawDef, "both outcomes were exercised").toBeGreaterThan(0);
    expect(sawSpDef, "both outcomes were exercised").toBeGreaterThan(0);
    // A genuine tie (equal effective stats) picks Defense.
    defender.setStatStage(Stat.DEF, 0);
    defender.setStatStage(Stat.SPDEF, 0);
    const spyDefender = {
      getEffectiveStat: () => 100,
    } as unknown as Pokemon;
    for (const site of sites) {
      const { original, rebuilt } = pair(site.abilityId, site.attrIndex, "CritUseLowerDefensiveStatAbAttr");
      for (const attr of [original, rebuilt]) {
        const statHolder = new NumberHolder(Stat.SPDEF);
        attr.apply({ pokemon: holder, defender: spyDefender, statHolder, simulated: false } as Params);
        expect(statHolder.value, `${site.abilityName}: a tie picks Defense`).toBe(Stat.DEF);
        // No defender resolved: the stat is left as it was.
        const untouched = new NumberHolder(Stat.SPDEF);
        attr.apply({ pokemon: holder, defender: undefined, statHolder: untouched, simulated: false } as Params);
        expect(untouched.value, `${site.abilityName}: no defender leaves the stat alone`).toBe(Stat.SPDEF);
      }
    }
  });

  it("CritUseLowerDefensiveStat: a real critical hit against Cloyster is the same for Deadeye and its rebuild, and bigger than without it", async () => {
    const damages: Record<string, { physical: number; special: number; normal: number }> = {};
    const seen: Record<string, (string | number)[]> = {};
    const shadowId = shadowOf(DEADEYE);
    for (const [label, id] of [
      ["original", DEADEYE],
      ["rebuilt", shadowId],
      ["none", AbilityId.BALL_FETCH],
    ] as const) {
      const world = await start(
        game =>
          game.override
            .ability(id as AbilityId)
            .enemySpecies(SpeciesId.CLOYSTER)
            .enemyLevel(100),
        SpeciesId.BLISSEY,
      );
      const hit = (move: MoveId, isCritical: boolean): number =>
        world.foe.getAttackDamage({
          source: world.holder,
          move: allMoves[move],
          isCritical,
          simulated: true,
          forcedRandomMultiplier: 1,
        }).damage;
      // Cloyster: Defense 180 is far above Sp. Def 45, so the lower stat is Sp. Def.
      expect(world.foe.getEffectiveStat(Stat.DEF)).toBeGreaterThan(world.foe.getEffectiveStat(Stat.SPDEF));
      seen[label] = [
        world.holder.getAbility().name,
        world.foe.getMaxHp(),
        world.foe.getEffectiveStat(Stat.DEF),
        world.foe.getEffectiveStat(Stat.SPDEF),
      ];
      damages[label] = {
        physical: hit(MoveId.TACKLE, true),
        special: hit(MoveId.WATER_GUN, true),
        normal: hit(MoveId.TACKLE, false),
      };
    }
    expect(damages.rebuilt, "rebuilt Deadeye deals what Deadeye deals").toEqual(damages.original);
    expect(
      damages.original.physical,
      `a physical crit reads the weaker Sp. Def instead of Defense, so it hurts more than the control ${JSON.stringify(damages)} ${JSON.stringify(seen)}`,
    ).toBeGreaterThan(damages.none.physical);
    // Water Gun is already special: Sp. Def is the lower stat, so nothing changes.
    expect(damages.original.special, "a special crit already reads the weaker stat").toBe(damages.none.special);
    // Without a crit the attr is never asked: all three agree.
    expect(damages.original.normal, "a normal hit is unchanged").toBe(damages.none.normal);
    expect(damages.rebuilt.normal).toBe(damages.none.normal);
  });

  it("BadDreamsImmunity: a sleeping holder next to a Bad Dreams foe loses no HP from it, the same for the original and the rebuild", async () => {
    for (const abilityId of [SWEET_DREAMS, PEACEFUL_SLUMBER]) {
      const play = async (id: number): Promise<{ hp: number; max: number; hasFlag: boolean }> => {
        const world = await start(game => game.override.ability(id as AbilityId).enemyAbility(AbilityId.BAD_DREAMS));
        world.holder.hp = Math.floor(world.holder.getMaxHp() / 2);
        world.holder.doSetStatus(StatusEffect.SLEEP, 5);
        world.game.move.select(MoveId.SPLASH);
        await world.game.toNextTurn();
        expect(world.holder.status?.effect, "the holder is still asleep").toBe(StatusEffect.SLEEP);
        return {
          hp: world.holder.hp,
          max: world.holder.getMaxHp(),
          hasFlag: world.holder.hasAbilityWithAttr("BadDreamsImmunityAbAttr"),
        };
      };
      const original = await play(abilityId);
      const shadow = await play(shadowOf(abilityId));
      const control = await play(AbilityId.BALL_FETCH);
      expect(shadow, `ability ${abilityId}`).toEqual(original);
      expect(original.hasFlag).toBe(true);
      expect(control.hasFlag).toBe(false);
      expect(
        control.hp,
        `without the flag Bad Dreams hurts the sleeper ${JSON.stringify([control, original])}`,
      ).toBeLessThan(Math.floor(control.max / 2));
      expect(original.hp, "with the flag the sleeper is not hurt by Bad Dreams").toBeGreaterThanOrEqual(
        Math.floor(original.max / 2),
      );
      // Prove the proof: a rebuild that LOSES the flag (the attr dropped) plays like the control, so this test can fail.
      const droppedId = allocateShadowId();
      const flagIndex = liveAbility(abilityId).attrs.findIndex(
        attr => attr.constructor.name === "BadDreamsImmunityAbAttr",
      );
      const dropped = rebuildAbility(liveAbility(abilityId), droppedId, { registry: declRegistry, drop: [flagIndex] });
      registerShadow(droppedId, dropped.ability);
      const withoutFlag = await play(droppedId);
      expect(withoutFlag.hasFlag).toBe(false);
      expect(withoutFlag.hp, "dropping the flag lets Bad Dreams hurt again").toBeLessThan(Math.floor(original.max / 2));
    }
  });

  it("BugPowderImmunity: a Bug-type holder is immune to powder moves, a non-Bug holder is not, the same for the original and the rebuild", async () => {
    const shadowId = shadowOf(POLLINATE);
    const sleepPowder = allMoves[MoveId.SLEEP_POWDER];
    for (const [label, species, bug] of [
      ["Bug-type", SpeciesId.SCYTHER, true],
      ["non-Bug", SpeciesId.BLISSEY, false],
    ] as const) {
      const results: Record<string, boolean[]> = {};
      for (const [name, id] of [
        ["original", POLLINATE],
        ["rebuilt", shadowId],
        ["control", AbilityId.BALL_FETCH],
      ] as const) {
        const world = await start(game => game.override.ability(id as AbilityId), species);
        const types = world.holder.getTypes();
        expect(types.includes(PokemonType.BUG), `${label} holder`).toBe(bug);
        // The game asks per type of the target (Move.isTypeImmune), so every type of the holder is checked.
        results[name] = types.map(type => sleepPowder.isTypeImmune(world.foe, world.holder, type));
      }
      expect(results.rebuilt, `${label}: rebuilt matches original`).toEqual(results.original);
      expect(results.original.some(Boolean), `${label}: immune only for a Bug-type holder with the ability`).toBe(bug);
      expect(results.control.some(Boolean), `${label}: the control is never immune`).toBe(false);
    }
  });

  it("BugPowderImmunity: a real Sleep Powder never puts a Bug-type Pollinate holder to sleep (original and rebuild)", async () => {
    const shadowId = shadowOf(POLLINATE);
    for (const id of [POLLINATE, shadowId]) {
      const world = await start(
        game =>
          game.override
            .ability(id as AbilityId)
            .enemyMoveset(MoveId.SLEEP_POWDER)
            .enemyLevel(100),
        SpeciesId.SCYTHER,
      );
      world.game.move.select(MoveId.SPLASH);
      await world.game.toNextTurn();
      world.game.move.select(MoveId.SPLASH);
      await world.game.toNextTurn();
      expect(world.holder.status?.effect ?? StatusEffect.NONE, `ability ${id}`).toBe(StatusEffect.NONE);
    }
  });

  it("IgnoreGenderInfatuation: infatuation from a Beautiful Music holder lands on any gender, the same for the original and the rebuild", async () => {
    const shadowId = shadowOf(BEAUTIFUL_MUSIC);
    const outcomes: Record<string, boolean[]> = {};
    for (const [name, id] of [
      ["original", BEAUTIFUL_MUSIC],
      ["rebuilt", shadowId],
      ["control", AbilityId.BALL_FETCH],
    ] as const) {
      const world = await start(game => game.override.ability(id as AbilityId));
      const results: boolean[] = [];
      for (const [holderGender, foeGender] of [
        [Gender.MALE, Gender.MALE],
        [Gender.MALE, Gender.FEMALE],
        [Gender.FEMALE, Gender.FEMALE],
        [Gender.MALE, Gender.GENDERLESS],
        [Gender.GENDERLESS, Gender.MALE],
      ] as const) {
        world.holder.gender = holderGender;
        world.foe.gender = foeGender;
        const tag = new InfatuatedTag(MoveId.ATTRACT, world.holder.id);
        results.push(tag.canAdd(world.foe));
      }
      outcomes[name] = results;
    }
    expect(outcomes.rebuilt).toEqual(outcomes.original);
    expect(outcomes.original, "with the flag every pairing can be infatuated").toEqual([true, true, true, true, true]);
    expect(outcomes.control, "without it only a male-female pairing can").toEqual([false, true, false, false, false]);
  });

  it("SwitchWhileRampaging: the command menu opens mid-rampage for Discipline and its rebuild, not for the control", async () => {
    const shadowId = shadowOf(DISCIPLINE);
    const outcomes: Record<string, { frenzy: boolean; menuOpened: boolean; hasFlag: boolean }> = {};
    for (const [name, id] of [
      ["original", DISCIPLINE],
      ["rebuilt", shadowId],
      ["control", AbilityId.BALL_FETCH],
    ] as const) {
      const world = await start(
        game =>
          game.override
            .ability(id as AbilityId)
            .moveset(MoveId.OUTRAGE)
            .startingWave(145)
            .enemySpecies(SpeciesId.SHUCKLE)
            .enemyLevel(100),
        SpeciesId.SNORLAX,
      );
      world.game.move.select(MoveId.OUTRAGE);
      await world.game.toEndOfTurn();
      const frenzy = world.holder.getTag(BattlerTagType.FRENZY) !== undefined;
      let menuOpened = false;
      world.game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
        menuOpened = true;
        const phase = world.game.scene.phaseManager.getCurrentPhase() as CommandPhase;
        void world.game.scene.ui.setMode(UiMode.FIGHT, phase.getFieldIndex());
      });
      world.game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
        const phase = world.game.scene.phaseManager.getCurrentPhase() as CommandPhase;
        phase.handleCommand(Command.FIGHT, 0, MoveUseMode.NORMAL);
      });
      await world.game.toEndOfTurn();
      outcomes[name] = { frenzy, menuOpened, hasFlag: world.holder.hasAbilityWithAttr("SwitchWhileRampagingAbAttr") };
    }
    expect(outcomes.rebuilt).toEqual(outcomes.original);
    expect(outcomes.original, "Discipline: rampaging, and the menu opens").toEqual({
      frenzy: true,
      menuOpened: true,
      hasFlag: true,
    });
    expect(outcomes.control, "no flag: rampaging, and the move repeats on its own").toEqual({
      frenzy: true,
      menuOpened: false,
      hasFlag: false,
    });
  }, 120000);

  describe("PreserveBaseStatAbilities (parked until the library claims the class, requests/B04.md section 15)", () => {
    const TURBOBLAZE = 163;
    const TERAVOLT = 164;
    const BLIND_RAGE = 5397;

    it("pins the engine behaviour of the three ORIGINAL users: the stat abilities of the foe stay on while abilities are ignored", async () => {
      const sites = sitesOf(PARKED_CLASS);
      expect(sites.map(site => site.abilityName).sort()).toEqual(["Blind Rage", "Teravolt", "Turboblaze"]);
      const readers: Record<string, number> = {};
      for (const [name, id] of [
        ["control", AbilityId.BALL_FETCH],
        ["turboblaze", TURBOBLAZE],
        ["teravolt", TERAVOLT],
        ["blindRage", BLIND_RAGE],
      ] as const) {
        const world = await start(game =>
          game.override
            .ability(id as AbilityId)
            .enemySpecies(SpeciesId.BLISSEY)
            .enemyAbility(AbilityId.MARVEL_SCALE)
            .enemyStatusEffect(StatusEffect.BURN),
        );
        // The foe (Marvel Scale, burned: Defense x1.5) reads its Defense while MY ability is ignoring abilities: the marker keeps Marvel Scale on.
        readers[name] = world.foe.getEffectiveStat(Stat.DEF, world.holder, allMoves[MoveId.TACKLE], true);
        expect(world.holder.hasAbilityWithAttr(PARKED_CLASS), name).toBe(name !== "control");
      }
      expect(readers.turboblaze).toBe(readers.teravolt);
      expect(readers.turboblaze).toBe(readers.blindRage);
      expect(readers.turboblaze, "Marvel Scale still raises Defense although abilities are ignored").toBeGreaterThan(
        readers.control,
      );
    });

    it.skipIf(declRegistry.get(PARKED_CLASS) === undefined)(
      "the rebuilt users keep the same stat read (runs once the declaration exists)",
      () => {
        for (const site of sitesOf(PARKED_CLASS)) {
          const { original, rebuilt } = pair(site.abilityId, site.attrIndex, PARKED_CLASS);
          expect(rebuilt.showAbility).toBe(original.showAbility);
        }
      },
    );
  });
});
