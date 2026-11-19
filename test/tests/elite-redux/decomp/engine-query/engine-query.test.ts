/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The engine-query sweep (spec 1.4, foundation step 7). About a hundred engine sites used to ask
// `hasAbility(AbilityId.X)` for 40 identity-checked abilities. They now ask `abilityQuery(pokemon, ROLE)`, which is
// true for the original ability AND for any ability that carries a runtime-capability block with that role.
//
// Proof, in three parts:
//   1. Query level: for every role, the original ability answers exactly like `hasAbility` did (with the same
//      `canApply` / `ignoreOverride` options), an unrelated ability answers no, and a "carrier" (an ability that is
//      NOT the original but carries the role's capability block) answers yes for that role and only that role.
//   2. L2 battle traces: ability X is run against its carrier X' (same attrs, the identity marker removed, the
//      capability blocks added) in a scenario that reaches the engine site. The traces must be identical. The same
//      scenario also runs against a CONTROL (no capability) that must differ, which proves the scenario reaches the
//      site and so the equal traces are not two empty recordings.
//   3. Coverage: every one of the 40 abilities has a role, and every role is either L2-reached or has a written reason.
import { AbBuilder, type Ability } from "#abilities/ability";
import { allAbilities, allMoves } from "#data/data-lists";
import {
  ABILITY_STUDIO_ENGINE_QUERIES,
  ABILITY_STUDIO_ENGINE_QUERY_SOURCES,
  type AbilityStudioEngineQuery,
  abilityQuery,
} from "#data/elite-redux/ability-studio/runtime-capabilities";
import {
  ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS,
  AbilityStudioRuntimeCapabilityAbAttr,
  AbilityStudioSourceAbilityAbAttr,
} from "#data/elite-redux/ability-studio/runtime-components";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { Pokemon } from "#field/pokemon";
import type { GameManager } from "#test/framework/game-manager";
import { BattleTrace, diffTraces, type TraceData } from "#test/tests/elite-redux/decomp/harness/battle-trace";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import {
  celebrate,
  runScenario,
  type ScenarioSpec,
  TEMPLATES,
  use,
} from "#test/tests/elite-redux/decomp/harness/scenarios";
import { allocateShadowId } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const QUERIES = Object.values(ABILITY_STUDIO_ENGINE_QUERIES) as AbilityStudioEngineQuery[];

function queriesOf(ability: AbilityId): AbilityStudioEngineQuery[] {
  return QUERIES.filter(query => ABILITY_STUDIO_ENGINE_QUERY_SOURCES[query] === ability);
}

/**
 * An ability that is NOT `original`, behaves like it through its attrs (the very same attr instances), and carries
 * the given engine-query capability blocks instead of the identity. The marker attr that makes `hasAbility(X)` true
 * for the original is left out, so the carrier can only be recognised through its blocks.
 */
function carrierOf(original: Ability, shadowId: number, queries: readonly AbilityStudioEngineQuery[]): Ability {
  const builder = new AbBuilder(shadowId as AbilityId, original.generation, original.postSummonPriority);
  builder.flags = (original as unknown as { flags: number }).flags;
  builder.conditions.push(...original.conditions);
  for (const attr of original.attrs) {
    if (!(attr instanceof AbilityStudioSourceAbilityAbAttr)) {
      builder.attrs.push(attr);
    }
  }
  for (const query of queries) {
    builder.attrs.push(
      new AbilityStudioRuntimeCapabilityAbAttr(
        query,
        `Engine query ${query}`,
        "engine-query",
        `Whenever a game system asks for ${query}`,
      ),
    );
  }
  const ability = builder.build();
  Object.defineProperty(ability, "name", { value: original.name, configurable: true, enumerable: true });
  Object.defineProperty(ability, "description", { value: original.description, configurable: true, enumerable: true });
  return ability;
}

/**
 * Species carry innate abilities (Castform: Forecast; Aegislash: Stance Change; Blissey: Overcoat ...), which would
 * answer the engine's questions for the original AND for the carrier and so hide the very block under test. The
 * proof battles run without any innate.
 */
function withoutInnates(): void {
  vi.spyOn(Pokemon.prototype, "getPassiveAbilities").mockReturnValue([]);
}

describe("engine queries: coverage", () => {
  it("every identity-checked ability has at least one role, and every role points at one of them", () => {
    const covered = new Set(QUERIES.map(query => ABILITY_STUDIO_ENGINE_QUERY_SOURCES[query]));
    expect([...covered].sort((a, b) => a - b)).toEqual(
      [...ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS].sort((a, b) => a - b),
    );
    expect(QUERIES.length).toBe(Object.keys(ABILITY_STUDIO_ENGINE_QUERY_SOURCES).length);
  });
});

describe("engine queries: query level", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterShadows);

  it("the original answers like hasAbility did, a carrier answers for its own role only, others answer no", async () => {
    const game = freshGame(phaserGame);
    withoutInnates();
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const options = [
      {},
      { canApply: false },
      { canApply: false, ignoreOverride: true },
      { ignoreOverride: true },
    ] as const;
    const problems: string[] = [];
    for (const query of QUERIES) {
      const sourceId = ABILITY_STUDIO_ENGINE_QUERY_SOURCES[query];
      const original = allAbilities[sourceId];
      const carrierId = allocateShadowId();
      registerShadow(carrierId, carrierOf(original, carrierId, [query]));
      for (const option of options) {
        const legacy = (id: AbilityId): boolean =>
          holder.hasAbility(
            id,
            "canApply" in option ? option.canApply : true,
            "ignoreOverride" in option ? option.ignoreOverride : false,
          );
        // 1. the original ability: exactly what hasAbility answered. Some abilities are only "in effect" under a
        //    condition (Sand Force needs a sandstorm), so the answer to "in effect" may legitimately be no.
        game.override.ability(sourceId);
        const expected = legacy(sourceId);
        if ("canApply" in option && option.canApply === false && expected !== true) {
          problems.push(`${query}: ${AbilityId[sourceId]} must be present when in-effect is not asked for`);
        }
        if (abilityQuery(holder, query, option) !== expected) {
          problems.push(
            `${query}: the original ${AbilityId[sourceId]} answers differently from hasAbility (${JSON.stringify(option)})`,
          );
        }
        // 2. an unrelated ability
        game.override.ability(AbilityId.BALL_FETCH);
        if (abilityQuery(holder, query, option) !== false) {
          problems.push(`${query}: Ball Fetch must answer no (${JSON.stringify(option)})`);
        }
        // 3. the carrier answers like the original for its role (it copies the original's conditions), is not the
        //    original (so only the block can be answering), and does not answer for the other roles.
        game.override.ability(carrierId as AbilityId);
        if (abilityQuery(holder, query, option) !== expected) {
          problems.push(`${query}: the carrier must answer like the original (${JSON.stringify(option)})`);
        }
        if (legacy(sourceId) !== false) {
          problems.push(`${query}: the carrier must not be the original ability (${JSON.stringify(option)})`);
        }
        for (const other of QUERIES.filter(candidate => candidate !== query)) {
          if (abilityQuery(holder, other, option) !== false) {
            problems.push(`${query}: the carrier also answered yes for ${other}`);
          }
        }
      }
      unregisterShadows();
    }
    game.override.ability(AbilityId.BALL_FETCH);
    expect(problems).toEqual([]);
  }, 600_000);
});

// ---------------------------------------------------------------------------------------------
// L2

const QUIET = TEMPLATES["quiet-turns"];
const base = (id: string, label: string, over: Partial<ScenarioSpec>): ScenarioSpec => ({
  ...QUIET,
  id: `engine-query:${id}`,
  label,
  ...over,
});
const BIG_FOE = { foe: SpeciesId.SNORLAX, foeLevel: 100 } as const;
const IDLE_FOE = { ...BIG_FOE, foeMoves: [MoveId.CELEBRATE] } as const;
const MY_MOVES = [MoveId.TACKLE, MoveId.CELEBRATE, MoveId.SWORDS_DANCE, MoveId.DOUBLE_SLAP] as const;

interface Observation {
  readonly game: GameManager;
  readonly holder: Pokemon;
  readonly foe: Pokemon;
}

interface L2Case {
  readonly ability: AbilityId;
  /** The roles this scenario reaches (default: every role of the ability). */
  readonly roles?: readonly AbilityStudioEngineQuery[];
  readonly scenario: ScenarioSpec;
  /** A direct reading of engine state at the end of the run, compared between the runs as well. */
  readonly observe?: (state: Observation) => unknown;
}

/** Hand-written: each scenario drives the game into the engine site(s) of one ability. */
const L2_CASES: readonly L2Case[] = [
  {
    ability: AbilityId.KLUTZ,
    scenario: {
      ...TEMPLATES["holder-low-hp-turns"],
      id: "engine-query:klutz",
      label: "A Klutz holder at 30% HP with a Sitrus Berry",
    },
  },
  {
    ability: AbilityId.LEVITATE,
    scenario: {
      ...TEMPLATES["while-active-flags"],
      id: "engine-query:levitate",
      label: "Earthquake and Spikes against a Levitate holder",
    },
    observe: ({ holder }) => holder.isGrounded(),
  },
  {
    ability: AbilityId.UNBURDEN,
    scenario: {
      ...TEMPLATES["holder-low-hp-turns"],
      id: "engine-query:unburden",
      label: "An Unburden holder at 30% HP eats its Sitrus Berry with its Speed lowered by two stages",
      setup: ({ holder }) => {
        holder.hp = Math.max(1, Math.floor(holder.getMaxHp() * 0.3));
        holder.setStatStage(Stat.SPD, -2);
      },
    },
    observe: ({ holder }) => holder.getEffectiveStat(Stat.SPD),
  },
  {
    ability: AbilityId.TRUANT,
    scenario: base("truant", "A Truant holder attacks three turns in a row", {
      ...IDLE_FOE,
      holderMoves: MY_MOVES,
      turns: [use(MoveId.TACKLE), use(MoveId.TACKLE), use(MoveId.TACKLE)],
    }),
  },
  {
    ability: AbilityId.BERSERK,
    scenario: base("berserk", "A Berserk holder is confused by Confuse Ray", {
      foeMoves: [MoveId.CONFUSE_RAY],
      turns: [celebrate(), celebrate()],
    }),
  },
  {
    ability: AbilityId.COMATOSE,
    scenario: base("comatose", "A Comatose holder uses Snore and Sleep Talk", {
      ...IDLE_FOE,
      holderMoves: [MoveId.SNORE, MoveId.SLEEP_TALK, MoveId.TACKLE, MoveId.CELEBRATE],
      turns: [use(MoveId.SNORE), use(MoveId.SLEEP_TALK)],
    }),
  },
  {
    ability: AbilityId.SHADOW_TAG,
    scenario: base("shadow-tag", "A Shadow Tag foe against the holder", {
      foeAbility: AbilityId.SHADOW_TAG,
      foeMoves: [MoveId.CELEBRATE],
      turns: [celebrate(), celebrate()],
    }),
    observe: ({ holder }) => holder.isTrapped(),
  },
  {
    ability: AbilityId.PRANKSTER,
    scenario: base("prankster", "A Prankster holder uses status moves on a Dark foe", {
      foe: SpeciesId.SNORLAX,
      foeLevel: 100,
      setup: ({ foe }) => {
        // The test dex's species types are not the point; the foe is made Dark the way Soak would make it Water.
        foe.summonData.types = [PokemonType.DARK];
      },
      holderMoves: [MoveId.GROWL, MoveId.WILL_O_WISP, MoveId.TACKLE, MoveId.CELEBRATE],
      foeMoves: [MoveId.CELEBRATE],
      turns: [use(MoveId.GROWL), use(MoveId.WILL_O_WISP)],
    }),
    // Type immunity of a Dark target to a status move is read when the move's effectiveness is computed.
    observe: ({ holder, foe }) =>
      [MoveId.GROWL, MoveId.WILL_O_WISP].map(move =>
        foe.getMoveEffectiveness(holder, allMoves[move], false, true, undefined, false, true),
      ),
  },
  {
    ability: AbilityId.WANDERING_SPIRIT,
    scenario: base("wandering-spirit", "A Mummy foe hits a Wandering Spirit holder", {
      foeAbility: AbilityId.MUMMY,
      foeMoves: [MoveId.TACKLE],
      turns: [celebrate(), celebrate()],
    }),
  },
  {
    ability: AbilityId.WIND_POWER,
    scenario: base("wind-power", "A Wind Power holder sets Tailwind", {
      foeMoves: [MoveId.CELEBRATE],
      holderMoves: [MoveId.TAILWIND, MoveId.TACKLE, MoveId.CELEBRATE, MoveId.SWORDS_DANCE],
      turns: [use(MoveId.TAILWIND), celebrate()],
    }),
  },
  {
    ability: AbilityId.WIND_RIDER,
    scenario: base("wind-rider", "A Wind Rider holder sets Tailwind", {
      foeMoves: [MoveId.CELEBRATE],
      holderMoves: [MoveId.TAILWIND, MoveId.TACKLE, MoveId.CELEBRATE, MoveId.SWORDS_DANCE],
      turns: [use(MoveId.TAILWIND), celebrate()],
    }),
  },
  {
    ability: AbilityId.WONDER_GUARD,
    roles: ["wonder-guard-single-hp"],
    scenario: base("wonder-guard", "A Wonder Guard holder takes a hit (its maximum HP is 1)", {
      turns: [celebrate(), celebrate()],
    }),
  },
  {
    ability: AbilityId.STANCE_CHANGE,
    scenario: base("stance-change", "An Aegislash with Stance Change attacks and shields", {
      ...IDLE_FOE,
      holder: SpeciesId.AEGISLASH,
      holderMoves: [MoveId.TACKLE, MoveId.KINGS_SHIELD, MoveId.CELEBRATE, MoveId.SWORDS_DANCE],
      turns: [use(MoveId.TACKLE), use(MoveId.KINGS_SHIELD), celebrate()],
    }),
  },
  {
    ability: AbilityId.FORECAST,
    scenario: base("forecast", "A Castform with Forecast meets sun, then rain", {
      holder: SpeciesId.CASTFORM,
      foeMoves: [MoveId.SUNNY_DAY, MoveId.RAIN_DANCE],
      turns: [celebrate(), celebrate()],
    }),
  },
  {
    ability: AbilityId.FLOWER_GIFT,
    scenario: base("flower-gift", "A Cherrim with Flower Gift meets sun, then rain", {
      holder: SpeciesId.CHERRIM,
      foeMoves: [MoveId.SUNNY_DAY, MoveId.RAIN_DANCE],
      turns: [celebrate(), celebrate()],
    }),
  },
  {
    ability: AbilityId.GULP_MISSILE,
    scenario: base("gulp-missile", "A Cramorant with Gulp Missile surfs", {
      ...IDLE_FOE,
      holder: SpeciesId.CRAMORANT,
      holderMoves: [MoveId.SURF, MoveId.TACKLE, MoveId.CELEBRATE, MoveId.SWORDS_DANCE],
      turns: [use(MoveId.SURF), celebrate()],
    }),
  },
  {
    ability: AbilityId.PLUS,
    scenario: base("plus", "A Plus holder uses Magnetic Flux and Gear Up", {
      holderMoves: [MoveId.MAGNETIC_FLUX, MoveId.GEAR_UP, MoveId.TACKLE, MoveId.CELEBRATE],
      foeMoves: [MoveId.CELEBRATE],
      turns: [use(MoveId.MAGNETIC_FLUX), use(MoveId.GEAR_UP)],
    }),
  },
  {
    ability: AbilityId.MINUS,
    scenario: base("minus", "A Minus holder uses Magnetic Flux and Gear Up", {
      holderMoves: [MoveId.MAGNETIC_FLUX, MoveId.GEAR_UP, MoveId.TACKLE, MoveId.CELEBRATE],
      foeMoves: [MoveId.CELEBRATE],
      turns: [use(MoveId.MAGNETIC_FLUX), use(MoveId.GEAR_UP)],
    }),
  },
  {
    ability: AbilityId.MULTITYPE,
    roles: ["multitype-type-lock"],
    scenario: base("multitype", "A Multitype holder is hit by Soak", {
      foeMoves: [MoveId.SOAK],
      turns: [celebrate(), celebrate()],
    }),
  },
  {
    ability: AbilityId.RKS_SYSTEM,
    roles: ["rks-system-type-lock"],
    scenario: base("rks-system", "An RKS System holder is hit by Soak", {
      foeMoves: [MoveId.SOAK],
      turns: [celebrate(), celebrate()],
    }),
  },
  {
    ability: AbilityId.MIMICRY,
    scenario: base("mimicry", "A Mimicry holder uses Terrain Pulse on Electric Terrain", {
      ...BIG_FOE,
      foeMoves: [MoveId.ELECTRIC_TERRAIN],
      holderMoves: [MoveId.TERRAIN_PULSE, MoveId.TACKLE, MoveId.CELEBRATE, MoveId.SWORDS_DANCE],
      turns: [celebrate(), use(MoveId.TERRAIN_PULSE)],
    }),
  },
  {
    ability: AbilityId.DARK_AURA,
    scenario: base("dark-aura", "An Aura Break foe against a Dark Aura holder's Dark move", {
      ...IDLE_FOE,
      foeAbility: AbilityId.AURA_BREAK,
      holderMoves: [MoveId.BITE, MoveId.TACKLE, MoveId.CELEBRATE, MoveId.DRAINING_KISS],
      turns: [use(MoveId.BITE), use(MoveId.DRAINING_KISS)],
    }),
  },
  {
    ability: AbilityId.FAIRY_AURA,
    scenario: base("fairy-aura", "An Aura Break foe against a Fairy Aura holder's Fairy move", {
      ...IDLE_FOE,
      foeAbility: AbilityId.AURA_BREAK,
      holderMoves: [MoveId.BITE, MoveId.TACKLE, MoveId.CELEBRATE, MoveId.DRAINING_KISS],
      turns: [use(MoveId.BITE), use(MoveId.DRAINING_KISS)],
    }),
  },
  {
    ability: AbilityId.AURA_BREAK,
    scenario: base("aura-break", "An Aura Break holder uses Aura Sphere", {
      ...IDLE_FOE,
      holderMoves: [MoveId.AURA_SPHERE, MoveId.TACKLE, MoveId.CELEBRATE, MoveId.SWORDS_DANCE],
      turns: [use(MoveId.AURA_SPHERE), use(MoveId.AURA_SPHERE)],
    }),
  },
  {
    ability: AbilityId.BATTLE_BOND,
    scenario: base("battle-bond", "An Ash-Greninja with Battle Bond uses Water Shuriken", {
      ...IDLE_FOE,
      holder: SpeciesId.GRENINJA,
      holderMoves: [MoveId.WATER_SHURIKEN, MoveId.TACKLE, MoveId.CELEBRATE, MoveId.SWORDS_DANCE],
      setup: ({ holder }) => {
        holder.formIndex = 2;
      },
      turns: [use(MoveId.WATER_SHURIKEN), use(MoveId.WATER_SHURIKEN)],
    }),
  },
  {
    ability: AbilityId.OVERCOAT,
    scenario: base("overcoat", "An Overcoat holder multi-hits an Effect Spore foe", {
      ...IDLE_FOE,
      foeAbility: AbilityId.EFFECT_SPORE,
      holderMoves: MY_MOVES,
      turns: [use(MoveId.DOUBLE_SLAP), use(MoveId.DOUBLE_SLAP), use(MoveId.DOUBLE_SLAP), use(MoveId.DOUBLE_SLAP)],
    }),
  },
];

/** Roles that no battle scenario here reaches, with the reason. Their query-level proof stands alone. */
const L2_UNREACHED: Readonly<Record<string, string>> = {
  "commander-hosting": "Needs an enemy Commander with a Dondozo ally in a double battle on the enemy side.",
  "guts-status-boost": "Read while the trainer's party is generated, before any battle exists.",
  "heavy-metal-weight":
    "Read by Telekinetic's entry rider against the opposing lead, which no stock scenario provides.",
  "ice-face-form": "Read only by the Winstrate challenge encounter, which is not a battle scenario.",
  "illuminate-dark-accuracy": "Needs a biome with the darkness rule.",
  "poison-heal-recovery": "Read for Toxic Terrain end-of-turn damage and a hurt-the-foe tick, which need that terrain.",
  "protosynthesis-booster": "Read when Booster Energy is used from the bag.",
  "quark-drive-booster": "Read when Booster Energy is used from the bag.",
  "quick-draw-target": "Read for a target's Quick Draw after a command-provenance proc.",
  "sand-force-moveset": "Read by the AI move-set generator while a team is built, before any battle exists.",
  "snow-warning-moveset": "Read by the AI move-set generator while a team is built, before any battle exists.",
  "solar-power-moveset": "Read by the AI move-set generator while a team is built, before any battle exists.",
  "stench-toxic-terrain": "Needs Toxic Terrain on the field and an enemy Stench source.",
  "sheer-force-secondary-effects": "Needs a held Life Orb or a Meloetta, which the scenario runner cannot give.",
  "multitype-plate-forms": "Read by the Arceus plate form-change conditions, which need a plate item use.",
  "rks-system-memory-forms": "Read by the Silvally memory form-change conditions, which need a memory item use.",
  "wonder-guard-boss-catch": "Read by the boss-weakening rule when throwing a Poke Ball.",
};

const SEED = "engine-query";

describe("engine queries: L2 battle traces", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterShadows);

  const run = async (
    entry: L2Case,
    abilityId: number,
    aliases: Record<number, number>,
  ): Promise<{ trace: TraceData; observed: unknown }> => {
    const game = freshGame(phaserGame);
    withoutInnates();
    const trace = await runScenario(game, entry.scenario, { abilityId }, (g: GameManager) =>
      BattleTrace.attach(g, { rng: "seeded", seed: SEED, aliases }),
    );
    const observed = entry.observe?.({
      game,
      holder: game.field.getPlayerPokemon(),
      foe: game.field.getEnemyPokemon(),
    });
    return { trace, observed };
  };

  it("every role is exactly one of reached by a scenario or excused with a written reason", () => {
    const reached = new Set(L2_CASES.flatMap(entry => entry.roles ?? queriesOf(entry.ability)));
    for (const query of QUERIES) {
      const excused = (L2_UNREACHED[query] ?? "") !== "";
      expect(reached.has(query) !== excused, `${query} must be exactly one of reached or excused`).toBe(true);
    }
  });

  for (const entry of L2_CASES) {
    it(`${AbilityId[entry.ability]}: the carrier behaves like the original, the control does not`, async () => {
      const original = allAbilities[entry.ability];
      const carrierId = allocateShadowId();
      const controlId = allocateShadowId();
      registerShadow(carrierId, carrierOf(original, carrierId, queriesOf(entry.ability)));
      registerShadow(controlId, carrierOf(original, controlId, []));
      const reference = await run(entry, entry.ability, {});
      const carrier = await run(entry, carrierId, { [carrierId]: entry.ability });
      const control = await run(entry, controlId, { [controlId]: entry.ability });
      expect(diffTraces(reference.trace, carrier.trace).map(difference => difference.message)).toEqual([]);
      expect(carrier.observed).toEqual(reference.observed);
      const controlDiffers =
        diffTraces(reference.trace, control.trace).length > 0
        || JSON.stringify(control.observed) !== JSON.stringify(reference.observed);
      expect(
        controlDiffers,
        "the scenario must reach an engine site: without the capability block the battle has to differ",
      ).toBe(true);
    }, 300_000);
  }
});
