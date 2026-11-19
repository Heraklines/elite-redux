/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 chunk 1: the engine sites of the seven presence-flag classes. A flag is never dispatched, so the shared L2 twin
// can only compare whole battles that never reach its engine site. Here every flag is driven AT its site, three times:
//
//   original  the live ability (for example Amphibious)
//   rebuilt   the same ability rebuilt from its declaration (what a staff blueprint compiles to)
//   control   Ball Fetch (no flag)
//
// The rebuilt run must equal the original one, and the control must differ. The control is what proves the scenario
// really reaches the site, so equal results are not two empty recordings.
import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { getMoveTargets } from "#moves/move-utils";
import type { GameManager } from "#test/framework/game-manager";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { celebrate, type ScenarioSpec, use } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { allocateShadowId, type TwinScenario, twinById } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// Ids from the live game (see the dump in the batch notes).
const AMPHIBIOUS = 5035;
const MOUNTAINEER = 5052;
const COSMIC_DAZE = 5263;
const CLUELESS = 5162;
const OVERRULE = 5516;
const MENTAL_POLLUTION = 5517;
const ARTILLERY = 5114;
const AMPLIFIER = 5115;
const SWEEPING_EDGE = 5157;

const BALL_FETCH = AbilityId.BALL_FETCH as number;

describe("B05 flag classes at their engine sites", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterShadows);

  /** Rebuilds a live ability from its declarations and puts it into the ability list under a shadow id. */
  function shadowOf(abilityId: number, expectedRebuilt: number[]): number {
    const original = allAbilities[abilityId] as Ability;
    const shadowId = allocateShadowId();
    const result = rebuildAbility(original, shadowId, { registry: declRegistry });
    // The flag attr itself must have been rebuilt from its declaration, not carried over untouched.
    for (const index of expectedRebuilt) {
      expect(result.rebuilt, `${original.name} attr ${index} must be rebuilt`).toContain(index);
    }
    registerShadow(shadowId, result.ability);
    return shadowId;
  }

  /** A one-battle observation: starts a battle whose holder has `abilityId`, then reads something. */
  async function observe<T>(
    abilityId: number,
    setup: {
      readonly foe?: SpeciesId;
      readonly foeLevel?: number;
      readonly foeAbility?: AbilityId;
      readonly doubles?: boolean;
      readonly holderMoves?: MoveId[];
    },
    read: (ctx: { game: GameManager; holder: ReturnType<GameManager["field"]["getPlayerPokemon"]> }) => T,
  ): Promise<T> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle(setup.doubles ? "double" : "single")
      .moveset(setup.holderMoves ?? [MoveId.SPLASH])
      .ability(abilityId as AbilityId)
      .startingLevel(100)
      .enemySpecies(setup.foe ?? SpeciesId.MAGIKARP)
      .enemyLevel(setup.foeLevel ?? 30)
      .enemyAbility(setup.foeAbility ?? AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(
      ...((setup.doubles ? [SpeciesId.BLISSEY, SpeciesId.PIKACHU] : [SpeciesId.BLISSEY]) as [SpeciesId]),
    );
    return read({ game, holder: game.field.getPlayerPokemon() });
  }

  /** original / rebuilt / control for a direct read. */
  async function threeWays<T>(
    abilityId: number,
    rebuiltIndex: number,
    setup: Parameters<typeof observe>[1],
    read: Parameters<typeof observe<T>>[2],
  ): Promise<{ original: T; rebuilt: T; control: T }> {
    const shadow = shadowOf(abilityId, [rebuiltIndex]);
    const original = await observe(abilityId, setup, read);
    const rebuilt = await observe(shadow, setup, read);
    const control = await observe(BALL_FETCH, setup, read);
    return { original, rebuilt, control };
  }

  /** original / rebuilt / control for a whole scripted battle (the traces are compared). */
  async function threeBattles(
    abilityId: number,
    rebuiltIndex: number,
    template: ScenarioSpec,
  ): Promise<{ rebuiltDiffs: string[]; controlDiffs: string[] }> {
    const shadow = shadowOf(abilityId, [rebuiltIndex]);
    const scenario: TwinScenario = { template, axes: {}, label: template.label };
    const reach = { attrs: [], presenceOnly: true } as const;
    const rebuilt = await twinById(phaserGame, abilityId, shadow, scenario, { reach });
    const control = await twinById(phaserGame, abilityId, BALL_FETCH, scenario, { reach });
    return {
      rebuiltDiffs: rebuilt.differences.map(d => d.message),
      controlDiffs: control.differences.map(d => d.message),
    };
  }

  const BASE = {
    holder: SpeciesId.BLISSEY,
    party: [] as SpeciesId[],
    foe: SpeciesId.MAGIKARP,
    foeAbility: AbilityId.BALL_FETCH,
    holderMoves: [MoveId.CELEBRATE, MoveId.TACKLE],
    foeMoves: [MoveId.SPLASH],
  } as const;

  it("DrenchImmunityAbAttr: the Drenched effect cannot be added (Amphibious)", async () => {
    const read = ({
      game,
      holder,
    }: {
      game: GameManager;
      holder: ReturnType<GameManager["field"]["getPlayerPokemon"]>;
    }) => {
      holder.addTag(BattlerTagType.ER_DRENCHED, 2, MoveId.NONE, game.field.getEnemyPokemon().id);
      return holder.getTag(BattlerTagType.ER_DRENCHED) !== undefined;
    };
    const result = await threeWays(AMPHIBIOUS, 1, {}, read);
    expect(result.original).toBe(false);
    expect(result.rebuilt).toBe(result.original);
    expect(result.control).toBe(true);
  });

  it("StealthRockImmunityAbAttr: no hazard damage, a heal instead (Mountaineer)", async () => {
    // Direct read: the trap says "no further effect" (false) and queues a heal instead of damage, unless at full HP.
    const read = ({
      game,
      holder,
    }: {
      game: GameManager;
      holder: ReturnType<GameManager["field"]["getPlayerPokemon"]>;
    }) => {
      game.scene.arena.addTag(
        ArenaTagType.STEALTH_ROCK,
        0,
        MoveId.STEALTH_ROCK,
        game.field.getEnemyPokemon().id,
        ArenaTagSide.PLAYER,
      );
      const tag = game.scene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.PLAYER)!;
      holder.hp = Math.floor(holder.getMaxHp() / 2);
      const simulated = tag.activateTrap(true, holder);
      const queuedBefore = game.scene.phaseManager.hasPhaseOfType("PokemonHealPhase");
      const real = tag.activateTrap(false, holder);
      const queuedAfter = game.scene.phaseManager.hasPhaseOfType("PokemonHealPhase");
      holder.hp = holder.getMaxHp();
      game.scene.phaseManager.tryRemovePhase("PokemonHealPhase");
      const fullHp = tag.activateTrap(false, holder);
      const queuedAtFull = game.scene.phaseManager.hasPhaseOfType("PokemonHealPhase");
      return { simulated, queuedBefore, real, queuedAfter, fullHp, queuedAtFull };
    };
    const result = await threeWays(MOUNTAINEER, 1, {}, read);
    expect(result.original).toEqual({
      simulated: false,
      queuedBefore: false,
      real: false,
      queuedAfter: true,
      fullHp: false,
      queuedAtFull: false,
    });
    expect(result.rebuilt).toEqual(result.original);
    expect(result.control).not.toEqual(result.original);
  });

  it("DoubleSelfInflictedDamageAbAttr: an enraged foe takes twice the recoil (Cosmic Daze), whole battle", async () => {
    const template: ScenarioSpec = {
      ...BASE,
      id: "b05-double-self",
      label: "An enraged Snorlax hits the holder and takes its enrage recoil",
      foe: SpeciesId.SNORLAX,
      foeLevel: 100,
      foeMoves: [MoveId.TACKLE],
      turns: [celebrate(), celebrate()],
      setup: ({ foe }) => {
        foe.addTag(BattlerTagType.ER_ENRAGE);
      },
    };
    const result = await threeBattles(COSMIC_DAZE, 1, template);
    expect(result.rebuiltDiffs).toEqual([]);
    expect(
      result.controlDiffs.length,
      "the control must differ (the recoil is doubled only with the flag)",
    ).toBeGreaterThan(0);
  });

  it("DoubleSelfInflictedDamageAbAttr: a confused foe hits itself for twice the damage (Cosmic Daze), whole battle", async () => {
    const template: ScenarioSpec = {
      ...BASE,
      id: "b05-double-self-confusion",
      label: "A confused Snorlax tries to attack for several turns",
      foe: SpeciesId.SNORLAX,
      foeLevel: 100,
      foeMoves: [MoveId.TACKLE],
      turns: [celebrate(), celebrate(), celebrate(), celebrate(), celebrate(), celebrate()],
      setup: ({ foe }) => {
        foe.addTag(BattlerTagType.CONFUSED, 6, MoveId.CONFUSE_RAY, 0);
      },
    };
    const result = await threeBattles(COSMIC_DAZE, 1, template);
    expect(result.rebuiltDiffs).toEqual([]);
    // The self-hit is a 1 in 3 chance per turn with a seeded roll; six turns reach it, and the doubled hit shows up in HP.
    expect(
      result.controlDiffs.length,
      "the control must differ (the self-hit is doubled only with the flag)",
    ).toBeGreaterThan(0);
  });

  it("StealthRockImmunityAbAttr: a whole battle where the holder switches in under Stealth Rock (Mountaineer)", async () => {
    const template: ScenarioSpec = {
      ...BASE,
      id: "b05-stealth-rock-switch",
      label: "The holder switches out and back in with Stealth Rock on its side",
      party: [SpeciesId.PIKACHU],
      holderMoves: [MoveId.CELEBRATE],
      turns: [{ switchTo: 1 }, { switchTo: 1 }],
      setup: ({ game, holder, foe }) => {
        holder.hp = Math.floor(holder.getMaxHp() / 2);
        game.scene.arena.addTag(ArenaTagType.STEALTH_ROCK, 0, MoveId.STEALTH_ROCK, foe.id, ArenaTagSide.PLAYER);
      },
    };
    const result = await threeBattles(MOUNTAINEER, 1, template);
    expect(result.rebuiltDiffs).toEqual([]);
    expect(result.controlDiffs.length, "the control must differ (damage instead of a heal)").toBeGreaterThan(0);
  });

  it("SuppressFieldEffectsAbAttr: terrain and Gravity are switched off while the holder is out (Clueless)", async () => {
    const read = ({ game }: { game: GameManager }) => {
      const arena = game.scene.arena;
      arena.trySetTerrain(TerrainType.ELECTRIC, true);
      arena.addTag(ArenaTagType.GRAVITY, 5, MoveId.GRAVITY, 0);
      return {
        suppressed: arena.isFieldEffectSuppressed(),
        terrain: arena.terrainType,
        gravity: arena.hasActiveGravity(),
      };
    };
    const result = await threeWays(CLUELESS, 1, {}, read);
    expect(result.original).toEqual({ suppressed: true, terrain: TerrainType.NONE, gravity: false });
    expect(result.rebuilt).toEqual(result.original);
    expect(result.control).toEqual({ suppressed: false, terrain: TerrainType.ELECTRIC, gravity: true });
  });

  it("OverruleCritAbAttr: a critical hit ignores Multiscale and doubles resisted damage (Overrule), whole battles", async () => {
    // A critical Tackle on a Snorlax with Multiscale at full HP (part 2: the damage cut is skipped).
    const ignoresCut: ScenarioSpec = {
      ...BASE,
      id: "b05-overrule-multiscale",
      label: "A critical Tackle against a full-HP Multiscale foe",
      foe: SpeciesId.SNORLAX,
      foeLevel: 100,
      foeAbility: AbilityId.MULTISCALE,
      crits: true,
      turns: [use(MoveId.TACKLE), use(MoveId.TACKLE)],
    };
    const first = await threeBattles(OVERRULE, 0, ignoresCut);
    expect(first.rebuiltDiffs).toEqual([]);
    expect(first.controlDiffs.length, "the control must differ (Multiscale halves the hit)").toBeGreaterThan(0);

    // A critical, resisted Tackle on a Registeel (part 1: the resisted damage is doubled).
    const doublesResisted: ScenarioSpec = {
      ...BASE,
      id: "b05-overrule-resisted",
      label: "A critical resisted Tackle against Registeel",
      foe: SpeciesId.REGISTEEL,
      foeLevel: 100,
      crits: true,
      turns: [use(MoveId.TACKLE), use(MoveId.TACKLE)],
    };
    const second = await threeBattles(OVERRULE, 0, doublesResisted);
    expect(second.rebuiltDiffs).toEqual([]);
    expect(second.controlDiffs.length, "the control must differ (the resisted hit is doubled)").toBeGreaterThan(0);
  });

  it("SuppressFieldAbilitiesWhenEnragedAbAttr: other abilities are off only while the holder is enraged (Mental Pollution)", async () => {
    const read = ({
      game,
      holder,
    }: {
      game: GameManager;
      holder: ReturnType<GameManager["field"]["getPlayerPokemon"]>;
    }) => {
      const foe = game.field.getEnemyPokemon();
      const before = foe.canApplyAbility();
      holder.addTag(BattlerTagType.ER_ENRAGE);
      const whileEnraged = foe.canApplyAbility();
      const holderOwn = holder.canApplyAbility();
      holder.removeTag(BattlerTagType.ER_ENRAGE);
      const after = foe.canApplyAbility();
      return { before, whileEnraged, holderOwn, after };
    };
    const result = await threeWays(MENTAL_POLLUTION, 0, { foeAbility: AbilityId.LEVITATE }, read);
    expect(result.original).toEqual({ before: true, whileEnraged: false, holderOwn: true, after: true });
    expect(result.rebuilt).toEqual(result.original);
    expect(result.control).toEqual({ before: true, whileEnraged: true, holderOwn: true, after: true });
  });

  it("SpreadTargetByFlagAbAttr: single-target moves with the property hit both foes (Amplifier, Artillery, Sweeping Edge)", async () => {
    // One read per move and per holder: Sing is a single-target sound move, Aura Sphere a pulse move, Slash a slicing move.
    const read = ({ holder }: { holder: ReturnType<GameManager["field"]["getPlayerPokemon"]> }) => {
      // `multiple` is true when the move hits every near foe (ALL_NEAR_ENEMIES); a single-target move lists its choices only.
      const sizeOf = (move: MoveId): boolean => getMoveTargets(holder, move).multiple;
      return {
        sing: sizeOf(MoveId.SING),
        tackle: sizeOf(MoveId.TACKLE),
        pulse: sizeOf(MoveId.AURA_SPHERE),
        slicing: sizeOf(MoveId.SLASH),
      };
    };
    const amplifier = await threeWays(AMPLIFIER, 1, { doubles: true }, read);
    expect(amplifier.rebuilt).toEqual(amplifier.original);
    expect(amplifier.original.sing).toBe(true);
    expect(amplifier.control.sing).toBe(false);
    const artillery = await threeWays(ARTILLERY, 1, { doubles: true }, read);
    expect(artillery.rebuilt).toEqual(artillery.original);
    expect(artillery.original.pulse).toBe(true);
    expect(artillery.control.pulse).toBe(false);
    const sweeping = await threeWays(SWEEPING_EDGE, 1, { doubles: true }, read);
    expect(sweeping.rebuilt).toEqual(sweeping.original);
    expect(sweeping.original.slicing).toBe(true);
    expect(sweeping.control.slicing).toBe(false);
    // The three users differ from each other, so the param really picks the property.
    expect(amplifier.original.pulse).toBe(amplifier.control.pulse);
    expect(artillery.original.sing).toBe(artillery.control.sing);
  });
});
