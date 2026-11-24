/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 2 probes: what the shared L1 and L2 suites cannot see.
//  - Aroma Veil (both halves, Tier B): the effect-chance line (above 0 and below 100) through the real dispatch, simulated or not.
//  - Pastel Veil / Sweet Veil (P) (Tier B, memory): the once-per-wave key, the party heal, the benched members, simulated calls.
//  - Soothing Aroma / Butter Up (Tier C): the end-of-turn heal reaches only hurt, living holder and adjacent allies.
//  - Toxic Spill, Telekinetic, Blistering Sun (Tier C): the marks and the arena effect, simulated or not.
//  - Juggernaut / Precise Fist (Tier B): the split canApply gives the old answer for every move, target and option.
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { allAbilities, allMoves } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { IgnoreOptionalMoveEffectsAbAttr } from "#data/elite-redux/ability-upgrades/attrs/optional-secondary-effect";
import {
  FirstEntryPartyHealAbAttr,
  HolderAndAlliesRecoveryAbAttr,
} from "#data/elite-redux/ability-upgrades/attrs/party-recovery";
import {
  BreakScreensOnAttackAbAttr,
  FieldPoisonWeaknessOnEntryAbAttr,
  PreLeaveFieldRemoveLinkedTailwindAbAttr,
  TelekineticStruggleOnEntryAbAttr,
} from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { NumberHolder, toDmgValue } from "#utils/common";
import type { AbAttrBaseParams } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

describe("B18 chunk 2", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Aroma Veil: IgnoreOptionalMoveEffectsAbAttr and UserFieldIgnoreOptionalMoveEffectsAbAttr", () => {
    const CHANCES = [-1, 0, 1, 10, 50, 99, 100, 150];
    const oldRule = (chance: number): boolean => chance > 0 && chance < 100;

    it("both halves lower exactly the chances above 0 and below 100, through the real dispatch, simulated or not", async () => {
      const game = freshGame(phaserGame);
      game.override
        .battleStyle("single")
        .moveset([MoveId.SPLASH])
        .ability(AbilityId.AROMA_VEIL)
        .startingLevel(100)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(30)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .criticalHits(false);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const holder = game.field.getPlayerPokemon();
      const foe = game.field.getEnemyPokemon();
      const names = holder.getAbility().attrs.map(attr => attr.constructor.name);
      expect(names).toContain("IgnoreOptionalMoveEffectsAbAttr");
      expect(names).toContain("UserFieldIgnoreOptionalMoveEffectsAbAttr");
      const move = allMoves[MoveId.EMBER];
      for (const key of ["IgnoreMoveEffectsAbAttr", "UserFieldIgnoreMoveEffectsAbAttr"] as const) {
        for (const simulated of [false, true]) {
          for (const chance of CHANCES) {
            const holderChance = new NumberHolder(chance);
            applyAbAttrs(key, { pokemon: holder, move, simulated, chance: holderChance } as never);
            expect(holderChance.value, `${key} simulated ${simulated} chance ${chance}`).toBe(
              oldRule(chance) ? 0 : chance,
            );
          }
        }
      }
      // The real move code: Thunderbolt's 10% paralysis chance against the Aroma Veil holder is 0, Ember's guaranteed (100%)
      // burn is kept, and the holder's own attack is not touched.
      const effectAttr = (id: MoveId) =>
        allMoves[id].attrs.find(attr => attr.constructor.name === "StatusEffectAttr") as unknown as {
          getMoveChance: (user: Pokemon, target: Pokemon, move: Move, self?: boolean, show?: boolean) => number;
        };
      const thunderbolt = allMoves[MoveId.THUNDERBOLT];
      expect(effectAttr(MoveId.THUNDERBOLT).getMoveChance(foe, holder, thunderbolt, false, true)).toBe(0);
      expect(effectAttr(MoveId.THUNDERBOLT).getMoveChance(holder, foe, thunderbolt, false, true)).toBe(10);
      expect(effectAttr(MoveId.EMBER).getMoveChance(foe, holder, move, false, true)).toBe(100);
    });

    it("the rebuilt attr with a staff gate that is always true blanks every chance (Shield Dust), and the default gate keeps the old line", async () => {
      const { holder } = await startWorld(phaserGame);
      const move = allMoves[MoveId.EMBER];
      for (const name of ["IgnoreOptionalMoveEffectsAbAttr", "UserFieldIgnoreOptionalMoveEffectsAbAttr"]) {
        const module = declRegistry.get(name)!;
        expect(module).toBeDefined();
        const always = buildAttr(module, {}, { gate: () => true }) as IgnoreOptionalMoveEffectsAbAttr;
        const original = new (module.ctor as new () => IgnoreOptionalMoveEffectsAbAttr)();
        for (const chance of CHANCES) {
          const params = (value: number) => ({
            pokemon: holder,
            move,
            simulated: false,
            chance: new NumberHolder(value),
          });
          expect(always.canApply(params(chance) as never), `${name} always-true gate at ${chance}`).toBe(true);
          expect(original.canApply(params(chance) as never), `${name} original at ${chance}`).toBe(oldRule(chance));
        }
      }
    });
  });

  describe("FirstEntryPartyHealAbAttr (Pastel Veil, Sweet Veil (P))", () => {
    const KEY = "ability-upgrade:first-entry-party-heal:pastel-veil";
    const gateTree = { block: "time.once-per", params: { scope: "wave", key: KEY } };

    it("the library gate equals the class's own memory test, and apply writes the key unless simulated", async () => {
      const { holder } = await startWorld(phaserGame, { holder: SpeciesId.BLISSEY });
      const module = declRegistry.get("FirstEntryPartyHealAbAttr")!;
      const original = new FirstEntryPartyHealAbAttr({ key: "pastel-veil", healFraction: 0.1 });
      const rebuilt = buildAttr(
        module,
        { key: "pastel-veil", healFraction: 10 },
        { gate: gateTree },
      ) as FirstEntryPartyHealAbAttr;
      const params = (simulated: boolean) => ({ pokemon: holder, simulated }) as AbAttrBaseParams;
      holder.waveData.entryEffectsFired.delete(KEY);
      expect(original.canApply(params(false))).toBe(true);
      expect(rebuilt.canApply(params(false))).toBe(true);
      // The engine calls canApply and apply with the same params. A simulated call never uses the heal up.
      expect(rebuilt.canApply(params(true))).toBe(true);
      rebuilt.apply(params(true));
      expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(false);
      expect(rebuilt.canApply(params(false))).toBe(true);
      rebuilt.apply(params(false));
      expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(true);
      expect(original.canApply(params(false))).toBe(false);
      expect(rebuilt.canApply(params(false))).toBe(false);
      // The key set by someone else (the original's own earlier write) blocks the rebuild too.
      holder.waveData.entryEffectsFired.delete(KEY);
      original.apply(params(false));
      expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(true);
      expect(rebuilt.canApply(params(false))).toBe(false);
      holder.waveData.entryEffectsFired.delete(KEY);
    });

    it("each live user's gate binding names the very memory key its own attr uses, and the params read back", async () => {
      await startWorld(phaserGame);
      const module = declRegistry.get("FirstEntryPartyHealAbAttr")!;
      for (const [abilityId, attrIndex, plainKey] of [
        [257, 1, "pastel-veil"],
        [175, 3, "sweet-veil"],
      ] as const) {
        const live = allAbilities[abilityId].attrs[attrIndex] as unknown as { key: string };
        expect(live.key).toBe(`ability-upgrade:first-entry-party-heal:${plainKey}`);
        const binding = getBinding(abilityId, attrIndex, "gate");
        expect(JSON.stringify(binding?.spec)).toContain(`"key":"${live.key}"`);
        expect(JSON.stringify(binding?.spec)).toContain('"scope":"wave"');
        expect(readDeclParams(module, live as never)).toEqual({ key: plainKey, healFraction: 10 });
      }
    });

    it("heals only living, hurt party members: the holder by a queued heal, a benched one at once, a fainted or full one not at all", async () => {
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
      await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.PIKACHU, SpeciesId.EEVEE, SpeciesId.SNORLAX);
      const holder = game.field.getPlayerPokemon();
      const [hurtBench, faintedBench, fullBench] = game.scene.getPlayerParty().filter(member => member !== holder);
      const module = declRegistry.get("FirstEntryPartyHealAbAttr")!;
      for (const make of [
        () => new FirstEntryPartyHealAbAttr({ key: "pastel-veil", healFraction: 0.1 }),
        () =>
          buildAttr(module, { key: "pastel-veil", healFraction: 10 }, { gate: gateTree }) as FirstEntryPartyHealAbAttr,
      ]) {
        holder.waveData.entryEffectsFired.delete(KEY);
        holder.hp = holder.getMaxHp() - 5;
        hurtBench.hp = 1;
        faintedBench.hp = 0;
        fullBench.hp = fullBench.getMaxHp();
        const queued: unknown[][] = [];
        vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
          queued.push(args);
        }) as never);
        const attr = make();
        expect(attr.canApply({ pokemon: holder, simulated: false } as AbAttrBaseParams)).toBe(true);
        attr.apply({ pokemon: holder, simulated: false } as AbAttrBaseParams);
        const label = attr.constructor.name;
        expect(queued, `${label}: exactly one queued heal (the holder is on the field)`).toEqual([
          ["PokemonHealPhase", holder.getBattlerIndex(), toDmgValue(holder.getMaxHp() * 0.1), null, true],
        ]);
        expect(hurtBench.hp, `${label}: the benched hurt member is healed at once`).toBe(
          Math.min(hurtBench.getMaxHp(), 1 + toDmgValue(hurtBench.getMaxHp() * 0.1)),
        );
        expect(faintedBench.hp, `${label}: a fainted member stays fainted`).toBe(0);
        expect(fullBench.hp).toBe(fullBench.getMaxHp());
        expect(holder.waveData.entryEffectsFired.has(KEY)).toBe(true);
        vi.restoreAllMocks();
      }
      holder.waveData.entryEffectsFired.delete(KEY);
    });

    it("a staff rule that drops the memory heals again on a second entry, one that keeps it does not", async () => {
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
      await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.PIKACHU);
      const holder = game.field.getPlayerPokemon();
      const bench = game.scene.getPlayerParty().find(member => member !== holder)!;
      const module = declRegistry.get("FirstEntryPartyHealAbAttr")!;
      const withMemory = buildAttr(module, { key: "pastel-veil", healFraction: 10 }, { gate: gateTree });
      const withoutMemory = buildAttr(module, { key: "pastel-veil", healFraction: 10 }, { gate: { all: [] } });
      vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
      const enter = (attr: ReturnType<typeof buildAttr>): boolean => {
        const params = { pokemon: holder, simulated: false } as AbAttrBaseParams;
        if (!attr.canApply(params)) {
          return false;
        }
        attr.apply(params);
        return true;
      };
      holder.waveData.entryEffectsFired.delete(KEY);
      bench.hp = 1;
      expect(enter(withMemory)).toBe(true);
      expect(bench.hp).toBeGreaterThan(1);
      bench.hp = 1;
      expect(enter(withMemory), "second entry with the memory").toBe(false);
      expect(bench.hp).toBe(1);
      expect(enter(withoutMemory), "second entry without the memory").toBe(true);
      expect(bench.hp).toBeGreaterThan(1);
      holder.waveData.entryEffectsFired.delete(KEY);
    });
  });

  describe("HolderAndAlliesRecoveryAbAttr (Soothing Aroma, Butter Up)", () => {
    it("the rebuilt attr heals the same hurt, living holder and adjacent allies as the original, nothing when simulated or when nobody is hurt", async () => {
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
      await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.CHANSEY);
      // Battles with two on the field do not start in this harness (decomp-l2-reach.json lists the doubles scenario as
      // unreached), so the partner is the second party member, reported as the adjacent ally exactly as the engine would.
      const holder = game.field.getPlayerPokemon();
      const ally = game.scene.getPlayerParty().find(member => member !== holder)!;
      vi.spyOn(holder, "getAdjacentAllies").mockImplementation(() => [ally]);
      const module = declRegistry.get("HolderAndAlliesRecoveryAbAttr")!;
      const original = new HolderAndAlliesRecoveryAbAttr(1 / 16);
      const rebuilt = buildAttr(module, { healFraction: 6.25 }) as HolderAndAlliesRecoveryAbAttr;
      const params = (simulated: boolean) => ({ pokemon: holder, simulated }) as AbAttrBaseParams;
      const cases: { label: string; holderHp: number; allyHp: number; expected: number[] }[] = [
        { label: "both full", holderHp: holder.getMaxHp(), allyHp: ally.getMaxHp(), expected: [] },
        {
          label: "holder one below full",
          holderHp: holder.getMaxHp() - 1,
          allyHp: ally.getMaxHp(),
          expected: [holder.getBattlerIndex()],
        },
        { label: "ally hurt", holderHp: holder.getMaxHp(), allyHp: 1, expected: [ally.getBattlerIndex()] },
        { label: "both hurt", holderHp: 1, allyHp: 1, expected: [holder.getBattlerIndex(), ally.getBattlerIndex()] },
        { label: "ally fainted", holderHp: 1, allyHp: 0, expected: [holder.getBattlerIndex()] },
      ];
      for (const testCase of cases) {
        for (const attr of [original, rebuilt]) {
          holder.hp = testCase.holderHp;
          ally.hp = testCase.allyHp;
          const queued: unknown[][] = [];
          vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
            queued.push(args);
          }) as never);
          const label = `${testCase.label} (${attr === original ? "original" : "rebuilt"})`;
          expect(attr.canApply(params(false)), `${label}: canApply`).toBe(testCase.expected.length > 0);
          attr.apply(params(true));
          expect(queued, `${label}: nothing while simulated`).toEqual([]);
          attr.apply(params(false));
          expect(queued.map(call => call[1]).sort(), `${label}: who is healed`).toEqual([...testCase.expected].sort());
          for (const call of queued) {
            const target = call[1] === holder.getBattlerIndex() ? holder : ally;
            expect(call).toEqual(["PokemonHealPhase", call[1], toDmgValue(target.getMaxHp() * (1 / 16)), null, true]);
          }
          vi.restoreAllMocks();
          vi.spyOn(holder, "getAdjacentAllies").mockImplementation(() => [ally]);
        }
      }
    });
  });

  describe("FieldPoisonWeaknessOnEntryAbAttr (Toxic Spill)", () => {
    it("marks every Pokemon on the field, the holder included, and nothing when simulated", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const module = declRegistry.get("FieldPoisonWeaknessOnEntryAbAttr")!;
      const rebuilt = buildAttr(module) as FieldPoisonWeaknessOnEntryAbAttr;
      holder.tempSummonData.erPoisonWeakness = false;
      foe.tempSummonData.erPoisonWeakness = false;
      rebuilt.apply({ pokemon: holder, simulated: true } as AbAttrBaseParams);
      expect([holder.tempSummonData.erPoisonWeakness, foe.tempSummonData.erPoisonWeakness]).toEqual([false, false]);
      rebuilt.apply({ pokemon: holder, simulated: false } as AbAttrBaseParams);
      expect([holder.tempSummonData.erPoisonWeakness, foe.tempSummonData.erPoisonWeakness]).toEqual([true, true]);
    });
  });

  describe("TelekineticStruggleOnEntryAbAttr (Telekinetic)", () => {
    it("locks a plain foe to Struggle, spares a Psychic foe, and does nothing when simulated", async () => {
      const module = declRegistry.get("TelekineticStruggleOnEntryAbAttr")!;
      for (const [species, locked] of [
        [SpeciesId.MAGIKARP, true],
        [SpeciesId.ABRA, false],
      ] as const) {
        const { holder, foe } = await startWorld(phaserGame, { foe: species });
        const rebuilt = buildAttr(module) as TelekineticStruggleOnEntryAbAttr;
        foe.tempSummonData.erTelekineticStruggle = false;
        rebuilt.apply({ pokemon: holder, simulated: true } as AbAttrBaseParams);
        expect(foe.tempSummonData.erTelekineticStruggle, `${SpeciesId[species]} simulated`).toBe(false);
        rebuilt.apply({ pokemon: holder, simulated: false } as AbAttrBaseParams);
        expect(foe.tempSummonData.erTelekineticStruggle, `${SpeciesId[species]} real`).toBe(locked);
        const [usable] = foe.getMoveset()[0].isUsable(foe);
        expect(usable, `${SpeciesId[species]}: Splash usable`).toBe(!locked);
        foe.tempSummonData.erTelekineticStruggle = false;
      }
    });
  });

  describe("the settings that were added to the effects are real", () => {
    it("Telekinetic: with no immune types a Psychic foe is locked too, with the default it is spared", async () => {
      const module = declRegistry.get("TelekineticStruggleOnEntryAbAttr")!;
      const { holder, foe } = await startWorld(phaserGame, { foe: SpeciesId.ABRA });
      const open = buildAttr(module, { immuneTypes: "" }) as TelekineticStruggleOnEntryAbAttr;
      open.apply({ pokemon: holder, simulated: false } as AbAttrBaseParams);
      expect(foe.tempSummonData.erTelekineticStruggle).toBe(true);
      foe.tempSummonData.erTelekineticStruggle = false;
      const standard = buildAttr(module, {}) as TelekineticStruggleOnEntryAbAttr;
      standard.apply({ pokemon: holder, simulated: false } as AbAttrBaseParams);
      expect(foe.tempSummonData.erTelekineticStruggle).toBe(false);
    });

    it("Blistering Sun: a staff-picked field effect ends instead of Tailwind", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const module = declRegistry.get("PreLeaveFieldRemoveLinkedTailwindAbAttr")!;
      const attr = buildAttr(module, { tag: "REFLECT" }) as PreLeaveFieldRemoveLinkedTailwindAbAttr;
      const arena = game.scene.arena;
      arena.addTag(ArenaTagType.TAILWIND, 4, MoveId.TAILWIND, holder.id, ArenaTagSide.PLAYER);
      arena.addTag(ArenaTagType.REFLECT, 5, MoveId.REFLECT, holder.id, ArenaTagSide.PLAYER);
      attr.apply({ pokemon: holder, simulated: false } as AbAttrBaseParams);
      expect(arena.getTagOnSide(ArenaTagType.REFLECT, ArenaTagSide.PLAYER)).toBeUndefined();
      expect(arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)).toBeDefined();
      expect(() => buildAttr(module, { tag: "NOT_A_TAG" })).toThrow();
    });

    it("Juggernaut: a staff-picked list of field effects is what gets removed", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const module = declRegistry.get("BreakScreensOnAttackAbAttr")!;
      const attr = buildAttr(module, { screens: "REFLECT" }, { gate: { all: [] } }) as BreakScreensOnAttackAbAttr;
      const arena = game.scene.arena;
      arena.addTag(ArenaTagType.REFLECT, 5, MoveId.REFLECT, foe.id, ArenaTagSide.ENEMY);
      arena.addTag(ArenaTagType.LIGHT_SCREEN, 5, MoveId.LIGHT_SCREEN, foe.id, ArenaTagSide.ENEMY);
      attr.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], simulated: false } as never);
      expect(arena.getTagOnSide(ArenaTagType.REFLECT, ArenaTagSide.ENEMY)).toBeUndefined();
      expect(arena.getTagOnSide(ArenaTagType.LIGHT_SCREEN, ArenaTagSide.ENEMY)).toBeDefined();
      expect(() => buildAttr(module, { screens: "" })).toThrow();
    });
  });

  describe("PreLeaveFieldRemoveLinkedTailwindAbAttr (Blistering Sun)", () => {
    it("ends the holder's own Tailwind only, and only when not simulated", async () => {
      const { game, holder } = await startWorld(phaserGame);
      const module = declRegistry.get("PreLeaveFieldRemoveLinkedTailwindAbAttr")!;
      const rebuilt = buildAttr(module) as PreLeaveFieldRemoveLinkedTailwindAbAttr;
      const arena = game.scene.arena;
      arena.addTag(ArenaTagType.TAILWIND, 4, MoveId.TAILWIND, holder.id, ArenaTagSide.PLAYER);
      arena.addTag(ArenaTagType.TAILWIND, 4, MoveId.TAILWIND, holder.id, ArenaTagSide.ENEMY);
      rebuilt.apply({ pokemon: holder, simulated: true } as AbAttrBaseParams);
      expect(arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)).toBeDefined();
      rebuilt.apply({ pokemon: holder, simulated: false } as AbAttrBaseParams);
      expect(arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)).toBeUndefined();
      expect(arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.ENEMY)).toBeDefined();
    });
  });

  describe("BreakScreensOnAttackAbAttr (Juggernaut, Precise Fist)", () => {
    // The OLD canApply, clause by clause and in its old order, as the reference.
    const oldCanApply = (
      options: { contactRequired?: boolean; flag?: MoveFlags },
      params: PostMoveInteractionAbAttrParams,
    ): boolean => {
      if (!(params.move.category !== MoveCategory.STATUS) || !params.opponent || params.opponent.isFainted()) {
        return false;
      }
      if (
        options.contactRequired
        && !params.move.doesFlagEffectApply({
          flag: MoveFlags.MAKES_CONTACT,
          user: params.pokemon,
          target: params.opponent,
        })
      ) {
        return false;
      }
      return options.flag === undefined || params.move.hasFlag(options.flag);
    };
    const gateTrees = {
      NONE: { all: [{ block: "move.damaging" }] },
      MAKES_CONTACT: { all: [{ block: "move.damaging" }, { block: "move.flag", params: { flag: "MAKES_CONTACT" } }] },
      PUNCHING_MOVE: { all: [{ block: "move.damaging" }, { block: "move.flag", params: { flag: "PUNCHING_MOVE" } }] },
    } as const;

    it("the split canApply and the rebuild give the old answer for every option, move and target state", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const module = declRegistry.get("BreakScreensOnAttackAbAttr")!;
      const optionSets: { name: keyof typeof gateTrees; options: { contactRequired?: boolean; flag?: MoveFlags } }[] = [
        { name: "NONE", options: {} },
        { name: "MAKES_CONTACT", options: { contactRequired: true } },
        { name: "PUNCHING_MOVE", options: { flag: MoveFlags.PUNCHING_MOVE } },
      ];
      const moves = [
        MoveId.TACKLE,
        MoveId.EMBER,
        MoveId.MACH_PUNCH,
        MoveId.ICE_PUNCH,
        MoveId.SWORDS_DANCE,
        MoveId.SPLASH,
      ];
      const targets: { label: string; make: () => Pokemon | undefined }[] = [
        { label: "standing", make: () => foe },
        { label: "missing", make: () => undefined },
      ];
      let rows = 0;
      let punching = 0;
      for (const { name, options } of optionSets) {
        const original = new BreakScreensOnAttackAbAttr(options);
        const rebuilt = buildAttr(
          module,
          { requiredProperty: name },
          { gate: gateTrees[name] },
        ) as BreakScreensOnAttackAbAttr;
        for (const moveId of moves) {
          for (const target of targets) {
            for (const fainted of [false, true]) {
              for (const longReach of [false, true]) {
                const opponent = target.make();
                const move: Move = allMoves[moveId];
                const faintedSpy =
                  opponent === undefined
                    ? undefined
                    : vi.spyOn(opponent, "isFainted").mockImplementation(() => fainted);
                const reachSpy = vi
                  .spyOn(holder, "hasAbilityWithAttr")
                  .mockImplementation(((key: string) => longReach && key === "IgnoreContactAbAttr") as never);
                const params = {
                  pokemon: holder,
                  opponent,
                  move,
                  damage: 5,
                  hitResult: HitResult.EFFECTIVE,
                  simulated: false,
                } as never;
                const expected = oldCanApply(options, params);
                const label = `${name} ${MoveId[moveId]} ${target.label} fainted ${fainted} longReach ${longReach}`;
                expect(original.canApply(params), `${label}: the class`).toBe(expected);
                expect(rebuilt.canApply(params), `${label}: the rebuild`).toBe(expected);
                if (expected && name === "PUNCHING_MOVE") {
                  punching++;
                }
                faintedSpy?.mockRestore();
                reachSpy.mockRestore();
                rows++;
              }
            }
          }
        }
      }
      expect(rows).toBe(3 * 6 * 2 * 2 * 2);
      // Precise Fist really fires for the punching moves in the list, so the property test is not vacuous.
      expect(punching).toBeGreaterThan(0);
    });

    it("the live Juggernaut and Precise Fist, recomposed from their real bindings, answer like the live attrs (punching moves included)", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const module = declRegistry.get("BreakScreensOnAttackAbAttr")!;
      const moves = [
        MoveId.TACKLE,
        MoveId.EMBER,
        MoveId.MACH_PUNCH,
        MoveId.ICE_PUNCH,
        MoveId.FIRE_PUNCH,
        MoveId.SWORDS_DANCE,
      ];
      const fired: Record<number, MoveId[]> = { 5059: [], 5112: [] };
      for (const [abilityId, attrIndex] of [
        [5059, 2],
        [5112, 2],
      ] as const) {
        const live = allAbilities[abilityId].attrs[attrIndex] as BreakScreensOnAttackAbAttr;
        expect(live.constructor.name).toBe("BreakScreensOnAttackAbAttr");
        const rebuilt = recomposeAttr(module, live, abilityId, attrIndex) as BreakScreensOnAttackAbAttr;
        for (const moveId of moves) {
          const params = {
            pokemon: holder,
            opponent: foe,
            move: allMoves[moveId],
            damage: 5,
            hitResult: HitResult.EFFECTIVE,
            simulated: false,
          } as never;
          expect(rebuilt.canApply(params), `${abilityId} ${MoveId[moveId]}`).toBe(live.canApply(params));
          if (live.canApply(params)) {
            fired[abilityId].push(moveId);
          }
        }
      }
      // Juggernaut: every damaging contact move in the list. Precise Fist: exactly the punching moves.
      expect(fired[5059]).toEqual([MoveId.TACKLE, MoveId.MACH_PUNCH, MoveId.ICE_PUNCH, MoveId.FIRE_PUNCH]);
      expect(fired[5112]).toEqual([MoveId.MACH_PUNCH, MoveId.ICE_PUNCH, MoveId.FIRE_PUNCH]);
    });

    it("applying removes the three screens of the target's side only, and nothing when simulated", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const module = declRegistry.get("BreakScreensOnAttackAbAttr")!;
      const rebuilt = buildAttr(
        module,
        { requiredProperty: "MAKES_CONTACT" },
        { gate: gateTrees.MAKES_CONTACT },
      ) as BreakScreensOnAttackAbAttr;
      const arena = game.scene.arena;
      const screens = [ArenaTagType.REFLECT, ArenaTagType.LIGHT_SCREEN, ArenaTagType.AURORA_VEIL];
      for (const tag of screens) {
        arena.addTag(tag, 5, MoveId.REFLECT, foe.id, ArenaTagSide.ENEMY);
        arena.addTag(tag, 5, MoveId.REFLECT, holder.id, ArenaTagSide.PLAYER);
      }
      arena.addTag(ArenaTagType.TAILWIND, 4, MoveId.TAILWIND, foe.id, ArenaTagSide.ENEMY);
      const params = (simulated: boolean) =>
        ({
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.TACKLE],
          damage: 5,
          hitResult: HitResult.EFFECTIVE,
          simulated,
        }) as never;
      rebuilt.apply(params(true));
      for (const tag of screens) {
        expect(arena.getTagOnSide(tag, ArenaTagSide.ENEMY), `${tag} while simulated`).toBeDefined();
      }
      rebuilt.apply(params(false));
      for (const tag of screens) {
        expect(arena.getTagOnSide(tag, ArenaTagSide.ENEMY), `${tag} after`).toBeUndefined();
        expect(arena.getTagOnSide(tag, ArenaTagSide.PLAYER), `${tag} on my own side`).toBeDefined();
      }
      expect(arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.ENEMY)).toBeDefined();
    });
  });
});
