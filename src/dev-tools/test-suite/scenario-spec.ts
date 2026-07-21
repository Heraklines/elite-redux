/*
 * Elite Redux — SCENARIO SPEC for the in-game scenario builder. *** STAGING ONLY ***
 *
 * A `ScenarioSpec` is a plain-JSON description of an arbitrary game situation:
 * run state (wave/biome/weather/seed/difficulty/challenges), the player party,
 * the enemy side (wild mon, trainer class, or a fully custom enemy party), items
 * and mid-battle state (stat stages / HP / status). It is:
 *
 *   - BUILT by the scenario-builder overlay (builder.ts),
 *   - EXECUTED by converting it into a regular DevScenario (buildDevScenario)
 *     that rides the exact same launch rails as the hand-written scenarios,
 *   - SHARED as a copy-paste code: base64url(JSON) with an "ERS1." prefix.
 *     Specs store NUMERIC enum ids (stable across builds, same policy as saves),
 *     so a code pasted by anyone reproduces the same situation - and with a
 *     pinned seed, the same RNG rolls.
 *
 * Pure logic only (no DOM) so it stays unit-testable.
 */

import { type DevEnemyMonSpec, setPendingDevEnemyParty } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { modifierTypes } from "#data/data-lists";
import { suppressAbilityIdForTurns } from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import type { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import type { Challenges } from "#enums/challenges";
import type { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import type { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { StatusEffect } from "#enums/status-effect";
import type { TrainerType } from "#enums/trainer-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { overrideHeldItems } from "#modifiers/modifier";
import type { ModifierOverride } from "#modifiers/modifier-type";
import type { ModifierTypeFunc } from "#types/modifier-types";
import type { Starter, StarterMoveset } from "#types/save-data";
import { resetDevOverrides } from "./dev-overrides";
import type { DevScenario } from "./scenarios";

// --- The spec ----------------------------------------------------------------

// NOTE: optional fields are declared `?: T | undefined` on purpose - the project
// runs `exactOptionalPropertyTypes`, and the builder constructs every literal
// with `value || undefined`, so the optionals must explicitly admit undefined.

export interface SpecMon {
  /** Numeric SpeciesId (vanilla or ER custom). */
  species: number;
  formIndex?: number | undefined;
  /** Ability slot 0/1/2 (the species' natural abilities). */
  abilitySlot?: number | undefined;
  /**
   * Force an arbitrary active ability by numeric AbilityId (vanilla OR ER custom
   * id, incl. ids >= 5000). Takes precedence over `abilitySlot` and lets a
   * scenario test an ability the mon does not naturally have (e.g. force High
   * Tide / Corrosion / Frisk). Applies via ABILITY_OVERRIDE (player) /
   * ENEMY_ABILITY_OVERRIDE (enemy) — so in multi-mon parties it hits that whole
   * side; pin it on the lead for a clean 1v1 ability test.
   */
  ability?: number | undefined;
  /** Force an arbitrary ER innate/passive by numeric AbilityId. */
  passiveAbility?: number | undefined;
  nature?: number | undefined;
  /** Up to 4 numeric MoveIds. */
  moves?: number[] | undefined;
  shiny?: boolean | undefined;
  /** Shiny tier: 0 normal/1 rare/2 epic. */
  variant?: number | undefined;
  female?: boolean | undefined;
}

export interface SpecEnemyMon extends SpecMon {
  level?: number | undefined;
  isBoss?: boolean | undefined;
  status?: number | undefined;
  bossSegments?: number | undefined;
  /**
   * Enemy held items / modifiers ({name: modifierTypes key, count?, type?}).
   * Applies via ENEMY_HELD_ITEMS_OVERRIDE (the whole enemy side), enabling
   * Frisk / Knock Off / Trick / Bug Bite / berry tests.
   */
  heldItems?: SpecItemRow[] | undefined;
}

/** One ability id disabled for a fixed number of completed turns. */
export interface SpecAbilitySuppression {
  ability: number;
  turns: number;
  sourceAbility?: number | undefined;
}

/** A player item/modifier row: a modifierTypes key + optional count/sub-type. */
export interface SpecItemRow {
  name: string;
  count?: number | undefined;
  type?: number | undefined;
}

// --- Headless full-run knobs (runner-only; all optional, ignored in-game) -------
// Every field below is consumed ONLY by the headless scenario runner
// (test/tools/run-scenario.test.ts) while it plays an entire classic run. They are
// additive/optional so old ERS1 share codes still decode and the in-game launch
// path (buildDevScenario) ignores them entirely.

/** A biome-market visit script: at the (optional) global wave, buy these `modifierTypes` keys. */
export interface BiomeShopVisit {
  /** Only apply on this global wave (e.g. 10, 20). Absent = every biome-shop visit. */
  wave?: number | undefined;
  /** `modifierTypes` keys to buy, in order. */
  buys: string[];
}

/** Pin a specific MysteryEncounter to a wave. `type` is a MysteryEncounterType enum NAME. */
export interface ForcedMysteryEncounter {
  wave: number;
  type: string;
}

/** A between-wave party-management action, applied after `afterWave` is cleared. */
export interface BetweenWaveAction {
  /** The global wave after which to apply these (e.g. 3 = after wave 3's reward). */
  afterWave: number;
  /** Reorder the party: the new order as a list of current party indexes (drives PartyUiMode.SWITCH). */
  reorder?: number[] | undefined;
  /** Move a held item from one party slot to another (drives PartyUiMode.MODIFIER_TRANSFER). */
  transferItem?: { from: number; to: number; itemName: string } | undefined;
  /** Teach a TM to a party slot (drives the ER TM-case party flow). `move` optionally forces which move slot to overwrite. */
  tmTeach?: { slot: number; move?: number | string | undefined } | undefined;
}

/** Party-full catch policy: keep (add, replacing slot 0), release (decline), or replace a chosen slot. */
export type OnCatchFull = "keep" | "release" | { replaceSlot: number };

export interface ScenarioSpec {
  /** Spec format version - bump on breaking changes. */
  v: 1;
  name?: string | undefined;
  notes?: string | undefined;
  run?:
    | {
        wave?: number | undefined;
        biome?: number | undefined;
        weather?: number | undefined;
        /** Active terrain (TerrainType): NONE/MISTY/ELECTRIC/GRASSY/PSYCHIC/TOXIC. */
        terrain?: number | undefined;
        /** Party-wide player level. */
        level?: number | undefined;
        money?: number | undefined;
        /**
         * Headless runner only: play this many consecutive waves (drive the reward
         * shop between them). Ignored by the in-game launch path (the human plays).
         * Additive/optional so old share codes still decode.
         */
        waves?: number | undefined;
        /**
         * Headless runner only: allow mystery encounters to spawn during the run
         * (un-does the test framework's `mysteryEncounterChance(0)`). Off by default
         * so a run is deterministic unless a scenario opts in. Ignored in-game.
         */
        allowMysteryEncounters?: boolean | undefined;
        double?: boolean | undefined;
        /** Triple battle (3v3). Takes precedence over `double`; fill `party` + enemy party with 3. */
        triple?: boolean | undefined;
        /** Pin the run seed for a fully deterministic repro. */
        seed?: string | undefined;
        /**
         * Headless runner only: pin every battle RNG call to its minimum result.
         * Useful for deterministic coverage of low-chance procs. Ignored by the
         * in-game scenario path, where the real seeded RNG remains authoritative.
         */
        battleRng?: "min" | undefined;
        difficulty?: "youngster" | "ace" | "elite" | "hell" | undefined;
        challenges?: { id: number; value: number }[] | undefined;
      }
    | undefined;
  party: SpecMon[];
  enemy?:
    | {
        kind: "wild" | "trainer" | "party";
        /** kind=wild: the single wild mon. */
        wild?: SpecEnemyMon | undefined;
        /** kind=trainer: force this trainer class (roster from difficulty + seed). */
        trainerType?: number | undefined;
        /** kind=party: fully custom enemy mons (slot-by-slot). */
        party?: SpecEnemyMon[] | undefined;
      }
    | undefined;
  items?:
    | {
        /** Player held items / modifiers ({name: modifierTypes key, count?, type?}). */
        held?: SpecItemRow[] | undefined;
        modifiers?: SpecItemRow[] | undefined;
        /** Guaranteed reward options in the first shop (modifierTypes keys). */
        shop?: string[] | undefined;
        /**
         * Headless runner only: seed the pokeball inventory ({POKEBALL name: count}).
         * The runner also auto-seeds a default stock when any `script` entry throws a
         * `ball`, so an unowned-ball throw never hangs the BALL submenu. Ignored in-game.
         */
        pokeballs?: Record<string, number> | undefined;
      }
    | undefined;
  start?:
    | {
        /** Stat stages, 7 entries [atk,def,spatk,spdef,spd,acc,eva], -6..6, 0 = untouched. */
        playerStages?: number[] | undefined;
        enemyStages?: number[] | undefined;
        /** HP percentage 1-100 (absent = full). */
        playerHpPct?: number | undefined;
        enemyHpPct?: number | undefined;
        playerStatus?: number | undefined;
        enemyStatus?: number | undefined;
        /** Same mid-battle state for the SECOND mon on each side (doubles + triples). */
        player2Stages?: number[] | undefined;
        enemy2Stages?: number[] | undefined;
        player2HpPct?: number | undefined;
        enemy2HpPct?: number | undefined;
        player2Status?: number | undefined;
        enemy2Status?: number | undefined;
        /** Same mid-battle state for the THIRD mon on each side (triples only). */
        player3Stages?: number[] | undefined;
        enemy3Stages?: number[] | undefined;
        player3HpPct?: number | undefined;
        enemy3HpPct?: number | undefined;
        player3Status?: number | undefined;
        enemy3Status?: number | undefined;
        /** Optional timed suppression staged on the lead after both sides are summoned. */
        playerAbilitySuppression?: SpecAbilitySuppression | undefined;
        enemyAbilitySuppression?: SpecAbilitySuppression | undefined;
      }
    | undefined;
  /**
   * Headless runner only (multi-wave): the reward to take after each wave, one
   * entry per wave. Each entry is a `modifierTypes` key (pick that reward),
   * `"FIRST"` (the first option), or `"SKIP"` (skip the reward). Ignored by the
   * in-game launch path. Additive/optional so old share codes still decode.
   */
  rewards?: string[] | undefined;
  /**
   * Headless runner only: the biome-market policy on every-10-wave shop visits.
   * `"SKIP"` (default) leaves each market immediately; an array of {@link BiomeShopVisit}
   * buys the listed items (optionally gated per wave). Ignored in-game.
   */
  biomeShops?: "SKIP" | BiomeShopVisit[] | undefined;
  /**
   * Headless runner only: the biome to pick at each World-Map boundary, consumed in
   * order (BiomeId enum NAMES). When exhausted / absent, the runner picks the first
   * (leftmost) node deterministically. Ignored in-game.
   */
  biomePicks?: string[] | undefined;
  /**
   * Headless runner only: the option index to choose at each ER Crossroads
   * (`0` = Stay, `1` = Leave), consumed in order; default `0`. Ignored in-game.
   */
  crossroads?: number[] | undefined;
  /** Headless runner only: pin specific MysteryEncounters to waves. Ignored in-game. */
  forceMysteryEncounters?: ForcedMysteryEncounter[] | undefined;
  /**
   * Headless runner only: the option-index path to take for each ME encountered, in
   * order (`[topOption, ...subOptions]`); default `[0]`. Ignored in-game.
   */
  meOptions?: number[][] | undefined;
  /**
   * Headless runner only: what to do when the party is full on a catch. `"release"`
   * (default) declines so the loop never stalls; `"keep"` adds the caught mon
   * (replacing slot 0); `{replaceSlot}` releases a chosen slot. Ignored in-game.
   */
  onCatchFull?: OnCatchFull | undefined;
  /**
   * Headless runner only: how to handle the between-wave egg lapse. `"skip"`
   * (default) declines the hatch prompt; `"hatch"` drives the hatch + summary.
   * Ignored in-game.
   */
  eggs?: "skip" | "hatch" | undefined;
  /** Headless runner only: between-wave party management actions. Ignored in-game. */
  betweenWaves?: BetweenWaveAction[] | undefined;
}

// --- Share codes ---------------------------------------------------------------

const SHARE_PREFIX = "ERS1.";

/** Spec → copy-paste share code (base64url JSON, prefixed + versioned). */
export function encodeScenarioSpec(spec: ScenarioSpec): string {
  const json = JSON.stringify(spec);
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${SHARE_PREFIX}${b64}`;
}

/** Share code → spec, or an error string. Tolerates surrounding whitespace. */
export function decodeScenarioSpec(code: string): ScenarioSpec | { error: string } {
  const trimmed = (code ?? "").trim();
  if (!trimmed.startsWith(SHARE_PREFIX)) {
    return { error: `not a scenario code (expected it to start with ${SHARE_PREFIX})` };
  }
  try {
    const b64 = trimmed.slice(SHARE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    const spec = JSON.parse(json) as ScenarioSpec;
    if (spec.v !== 1 || !Array.isArray(spec.party)) {
      return { error: "unsupported or malformed scenario code" };
    }
    return spec;
  } catch (err) {
    return { error: `could not read the code: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// --- Spec → DevScenario ----------------------------------------------------------

type MutableOverrides = { -readonly [K in keyof typeof Overrides]: (typeof Overrides)[K] };
const O = Overrides as unknown as MutableOverrides;

const STAGE_STATS = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA] as const;

function toStarter(mon: SpecMon): Starter {
  return {
    speciesId: mon.species as SpeciesId,
    shiny: mon.shiny ?? false,
    variant: (mon.variant ?? 0) as Starter["variant"],
    formIndex: mon.formIndex ?? 0,
    female: mon.female,
    abilityIndex: mon.abilitySlot ?? 0,
    passive: false,
    nature: (mon.nature ?? Nature.HARDY) as Nature,
    moveset: (mon.moves?.length ?? 0) > 0 ? (mon.moves?.slice(0, 4) as unknown as StarterMoveset) : undefined,
    pokerus: false,
    ivs: new Array(6).fill(31),
  };
}

function toModifierOverrides(rows: SpecItemRow[] | undefined): ModifierOverride[] {
  return (rows ?? [])
    .filter(r => r.name && Object.hasOwn(modifierTypes, r.name))
    .map(r => ({ name: r.name, count: r.count, type: r.type }) as ModifierOverride);
}

// The mon at field slot `idx` (0 = lead, 1 = the 2nd mon in doubles).
function fieldMon(side: "player" | "enemy", idx: number) {
  const field = side === "player" ? globalScene.getPlayerField() : globalScene.getEnemyField();
  return field[idx];
}

function applyStages(side: "player" | "enemy", idx: number, stages: number[] | undefined): void {
  if (!stages?.some(s => s !== 0)) {
    return;
  }
  const mon = fieldMon(side, idx);
  if (!mon) {
    return;
  }
  stages.slice(0, 7).forEach((stage, i) => {
    if (stage !== 0) {
      mon.setStatStage(STAGE_STATS[i], Math.max(-6, Math.min(6, stage)));
    }
  });
  mon.updateInfo();
}

function applyHpPct(side: "player" | "enemy", idx: number, pct: number | undefined): void {
  if (pct === undefined || pct <= 0 || pct >= 100) {
    return;
  }
  const mon = fieldMon(side, idx);
  if (mon) {
    mon.hp = Math.max(1, Math.floor((mon.getMaxHp() * pct) / 100));
    mon.updateInfo();
  }
}

function applyStatus(side: "player" | "enemy", idx: number, status: number | undefined): void {
  if (!status) {
    return;
  }
  fieldMon(side, idx)?.trySetStatus(status as StatusEffect);
}

function applyAbilitySuppression(side: "player" | "enemy", suppression: SpecAbilitySuppression | undefined): void {
  if (!suppression) {
    return;
  }
  const mon = fieldMon(side, 0);
  if (mon) {
    suppressAbilityIdForTurns(
      mon,
      suppression.ability as AbilityId,
      suppression.turns,
      (suppression.sourceAbility ?? suppression.ability) as AbilityId,
    );
  }
}

/**
 * Apply a specific set of held-item rows to ONE already-spawned enemy mon (not
 * the whole side). Reuses the engine's own {@linkcode overrideHeldItems} builder
 * (handles ModifierTypeGenerator / pregen args) by temporarily pointing the
 * side-wide enemy override at this mon's rows, then restoring it. Synchronous, so
 * the swap is invisible to anything else.
 */
function applyEnemyHeldItemsToMon(mon: Pokemon, rows: SpecItemRow[] | undefined): void {
  const overrides = toModifierOverrides(rows);
  if (overrides.length === 0) {
    return;
  }
  const prev = O.ENEMY_HELD_ITEMS_OVERRIDE;
  O.ENEMY_HELD_ITEMS_OVERRIDE = overrides;
  try {
    overrideHeldItems(mon, false);
  } finally {
    O.ENEMY_HELD_ITEMS_OVERRIDE = prev;
  }
}

/** One-line human summary for the banner / log header. */
export function describeScenarioSpec(spec: ScenarioSpec): string {
  const parts: string[] = [];
  if (spec.run?.wave) {
    parts.push(`wave ${spec.run.wave}`);
  }
  if (spec.run?.biome !== undefined) {
    parts.push(`${BiomeId[spec.run.biome] ?? `biome ${spec.run.biome}`}`);
  }
  if (spec.run?.weather) {
    parts.push(`${WeatherType[spec.run.weather] ?? "weather"}`);
  }
  if (spec.run?.difficulty) {
    parts.push(spec.run.difficulty);
  }
  if (spec.run?.seed) {
    parts.push(`seed ${spec.run.seed.slice(0, 8)}…`);
  }
  parts.push(`${spec.party.length} mon party`);
  if (spec.enemy?.kind === "trainer") {
    parts.push("trainer battle");
  } else if (spec.enemy?.kind === "party") {
    parts.push(`custom enemy x${spec.enemy.party?.length ?? 0}`);
  }
  return parts.join(", ");
}

/**
 * Convert a spec into a launchable DevScenario + a postLaunch step.
 * `postLaunch` MUST be called right after `ctx.startRunWithMode(...)` - it
 * applies the things that need the new run's gameMode/scene (seed pinning,
 * challenge activation).
 */
export function buildDevScenario(spec: ScenarioSpec): { scenario: DevScenario; postLaunch: () => void } {
  const shareCode = encodeScenarioSpec(spec);
  const label = `🧪 ${spec.name?.trim() || "Custom scenario"}`;
  const description = [
    spec.notes?.trim() || "Custom-built scenario.",
    "",
    describeScenarioSpec(spec),
    "",
    "Share code (copy into bug reports):",
    shareCode,
  ].join("\n");

  const setupFn = (): Starter[] => {
    resetDevOverrides();
    const run = spec.run ?? {};
    // Keys outside the harness defaults table - set them explicitly each time.
    O.STARTING_MONEY_OVERRIDE = run.money && run.money > 0 ? run.money : 0;
    O.SEED_OVERRIDE = run.seed?.trim() || "";
    O.RANDOM_TRAINER_OVERRIDE = null;
    O.BATTLE_TYPE_OVERRIDE = null;
    O.ENEMY_HEALTH_SEGMENTS_OVERRIDE = 0;
    O.ENEMY_SHINY_OVERRIDE = null;
    O.ENEMY_VARIANT_OVERRIDE = null;
    O.ENEMY_NATURE_OVERRIDE = null;
    O.ENEMY_HELD_ITEMS_OVERRIDE = [];
    // Ability/passive overrides (not all are in the dev-defaults reset table).
    O.HAS_PASSIVE_ABILITY_OVERRIDE = null;
    O.ENEMY_PASSIVE_ABILITY_OVERRIDE = AbilityId.NONE;
    O.ENEMY_HAS_PASSIVE_ABILITY_OVERRIDE = null;

    // Player lead: force an arbitrary active ability / innate by id when given
    // (ABILITY_OVERRIDE applies to the player side; pin on a 1-mon party for a
    // clean ability test). `ability` wins over the natural `abilitySlot`.
    const lead = spec.party[0];
    if (lead?.ability) {
      O.ABILITY_OVERRIDE = lead.ability as AbilityId;
    }
    if (lead?.passiveAbility) {
      O.PASSIVE_ABILITY_OVERRIDE = lead.passiveAbility as AbilityId;
      O.HAS_PASSIVE_ABILITY_OVERRIDE = true;
    }

    if (run.wave && run.wave >= 1) {
      O.STARTING_WAVE_OVERRIDE = run.wave;
    }
    if (run.biome !== undefined) {
      O.STARTING_BIOME_OVERRIDE = run.biome as BiomeId;
    }
    if (run.weather) {
      O.WEATHER_OVERRIDE = run.weather as WeatherType;
    }
    if (run.terrain) {
      O.STARTING_TERRAIN_OVERRIDE = run.terrain as TerrainType;
    }
    if (run.level && run.level >= 1) {
      O.STARTING_LEVEL_OVERRIDE = Math.min(100, run.level);
    }
    if (run.triple) {
      O.BATTLE_STYLE_OVERRIDE = "triple";
    } else if (run.double) {
      O.BATTLE_STYLE_OVERRIDE = "double";
    }
    setErDifficulty(run.difficulty ?? "ace");

    // Enemy side.
    const enemy = spec.enemy;
    if (enemy?.kind === "wild" && enemy.wild) {
      const w = enemy.wild;
      // Force a WILD battle (the trainer branch forces TRAINER) so `kind` is
      // authoritative - otherwise the wave/difficulty could roll a trainer and
      // break wild-only setups like Frisk / held-item-on-the-foe tests.
      O.BATTLE_TYPE_OVERRIDE = BattleType.WILD;
      O.ENEMY_SPECIES_OVERRIDE = w.species as SpeciesId;
      if (w.level && w.level >= 1) {
        O.ENEMY_LEVEL_OVERRIDE = w.level;
      }
      if (w.moves && w.moves.length > 0) {
        O.ENEMY_MOVESET_OVERRIDE = w.moves.slice(0, 4) as MoveId[];
      }
      if (w.formIndex) {
        O.ENEMY_FORM_OVERRIDES = { [w.species]: w.formIndex };
      }
      if (w.status) {
        O.ENEMY_STATUS_OVERRIDE = w.status as StatusEffect;
      }
      if (w.nature !== undefined) {
        O.ENEMY_NATURE_OVERRIDE = w.nature as Nature;
      }
      if (w.shiny) {
        O.ENEMY_SHINY_OVERRIDE = true;
        O.ENEMY_VARIANT_OVERRIDE = (w.variant ?? 0) as MutableOverrides["ENEMY_VARIANT_OVERRIDE"];
      }
      if (w.abilitySlot !== undefined) {
        // Resolve the slot to the concrete ability so it works for every species.
        // (Done live in onBattleStart instead - the species tables are simpler there.)
      }
      if (w.ability) {
        O.ENEMY_ABILITY_OVERRIDE = w.ability as AbilityId;
      }
      if (w.passiveAbility) {
        O.ENEMY_PASSIVE_ABILITY_OVERRIDE = w.passiveAbility as AbilityId;
        O.ENEMY_HAS_PASSIVE_ABILITY_OVERRIDE = true;
      }
      if (w.heldItems && w.heldItems.length > 0) {
        O.ENEMY_HELD_ITEMS_OVERRIDE = toModifierOverrides(w.heldItems);
      }
      if (w.bossSegments && w.bossSegments >= 1) {
        O.ENEMY_HEALTH_SEGMENTS_OVERRIDE = Math.min(10, w.bossSegments);
      }
    } else if (enemy?.kind === "trainer" && enemy.trainerType) {
      O.BATTLE_TYPE_OVERRIDE = BattleType.TRAINER;
      O.RANDOM_TRAINER_OVERRIDE = { trainerType: enemy.trainerType as Exclude<TrainerType, TrainerType.UNKNOWN> };
    } else if (enemy?.kind === "party" && enemy.party && enemy.party.length > 0) {
      const devParty: DevEnemyMonSpec[] = enemy.party.slice(0, 6).map(p => {
        const m: DevEnemyMonSpec = { speciesId: p.species };
        if (p.level !== undefined) {
          m.level = p.level;
        }
        if (p.moves && p.moves.length > 0) {
          m.moveIds = p.moves.slice(0, 4);
        }
        if (p.abilitySlot !== undefined) {
          m.abilitySlot = p.abilitySlot;
        }
        if (p.nature !== undefined) {
          m.nature = p.nature;
        }
        if (p.formIndex !== undefined) {
          m.formIndex = p.formIndex;
        }
        if (p.isBoss !== undefined) {
          m.isBoss = p.isBoss;
        }
        if (p.shiny !== undefined) {
          m.shiny = p.shiny;
        }
        return m;
      });
      setPendingDevEnemyParty(devParty);
      // Don't downgrade a triple to a double: a triple keeps its 3-wide style set above.
      if (devParty.length >= 2 && !run.triple) {
        O.BATTLE_STYLE_OVERRIDE = "double";
      }
      // Ability / passive are SIDE-WIDE overrides (they hit every enemy), so they
      // read off the first custom mon. Per-mon `status` / `bossSegments` /
      // `heldItems` can't ride a uniform override - they're applied post-spawn on
      // the actual mons in onBattleStartFn below.
      const e0 = enemy.party[0];
      if (e0?.ability) {
        O.ENEMY_ABILITY_OVERRIDE = e0.ability as AbilityId;
      }
      if (e0?.passiveAbility) {
        O.ENEMY_PASSIVE_ABILITY_OVERRIDE = e0.passiveAbility as AbilityId;
        O.ENEMY_HAS_PASSIVE_ABILITY_OVERRIDE = true;
      }
    }

    // Items.
    O.STARTING_HELD_ITEMS_OVERRIDE = toModifierOverrides(spec.items?.held);
    O.STARTING_MODIFIER_OVERRIDE = toModifierOverrides(spec.items?.modifiers);

    return spec.party.slice(0, 6).map(toStarter);
  };

  const onBattleStartFn = (): void => {
    const start = spec.start ?? {};
    // Lead (slot 0), then the 2nd (slot 1, doubles+triples) and 3rd (slot 2, triples) mons.
    applyStages("player", 0, start.playerStages);
    applyStages("enemy", 0, start.enemyStages);
    applyStages("player", 1, start.player2Stages);
    applyStages("enemy", 1, start.enemy2Stages);
    applyStages("player", 2, start.player3Stages);
    applyStages("enemy", 2, start.enemy3Stages);
    applyHpPct("player", 0, start.playerHpPct);
    applyHpPct("enemy", 0, start.enemyHpPct);
    applyHpPct("player", 1, start.player2HpPct);
    applyHpPct("enemy", 1, start.enemy2HpPct);
    applyHpPct("player", 2, start.player3HpPct);
    applyHpPct("enemy", 2, start.enemy3HpPct);
    applyStatus("player", 0, start.playerStatus);
    applyStatus("enemy", 0, start.enemyStatus);
    applyStatus("player", 1, start.player2Status);
    applyStatus("enemy", 1, start.enemy2Status);
    applyStatus("player", 2, start.player3Status);
    applyStatus("enemy", 2, start.enemy3Status);
    applyAbilitySuppression("player", start.playerAbilitySuppression);
    applyAbilitySuppression("enemy", start.enemyAbilitySuppression);
    // Wild ability slot: applied live (simplest reliable path).
    const wildSlot = spec.enemy?.kind === "wild" ? spec.enemy.wild?.abilitySlot : undefined;
    if (wildSlot !== undefined) {
      const e = globalScene.getEnemyPokemon();
      if (e) {
        e.abilityIndex = Math.max(0, Math.min(2, wildSlot));
      }
    }
    // Custom enemy party: per-mon status / boss segments / held items, applied on
    // the actual spawned mons (indexed by party slot so benched mons get them too)
    // - the uniform ENEMY_*_OVERRIDEs can only express a single side-wide value.
    if (spec.enemy?.kind === "party" && spec.enemy.party) {
      const enemyParty = globalScene.getEnemyParty();
      spec.enemy.party.slice(0, 6).forEach((p, i) => {
        const mon = enemyParty[i];
        if (!mon) {
          return;
        }
        if (p.status) {
          mon.trySetStatus(p.status as StatusEffect);
        }
        if (p.bossSegments && p.bossSegments >= 1) {
          mon.setBoss(true, Math.min(10, p.bossSegments));
          mon.initBattleInfo();
        }
        applyEnemyHeldItemsToMon(mon, p.heldItems);
      });
    }
  };

  // Build incrementally so optional fields are never set to `undefined`
  // (the shared DevScenario type runs under exactOptionalPropertyTypes).
  const hasPerMonEnemyFields =
    spec.enemy?.kind === "party"
    && (spec.enemy.party ?? []).some(p => p.status || p.bossSegments || (p.heldItems?.length ?? 0) > 0);
  const scenario: DevScenario = { label, description, setup: setupFn };
  if (spec.start || spec.enemy?.kind === "wild" || hasPerMonEnemyFields) {
    scenario.onBattleStart = onBattleStartFn;
  }
  const shopFuncs = (spec.items?.shop ?? [])
    .filter(key => Object.hasOwn(modifierTypes, key))
    .map(key => (modifierTypes as Record<string, ModifierTypeFunc>)[key]);
  if (shopFuncs.length > 0) {
    scenario.shopItems = shopFuncs;
  }

  const postLaunch = (): void => {
    const run = spec.run ?? {};
    // Seed pinning: the run's seed was rolled at the last scene reset (title),
    // BEFORE setup() ran - so pin it directly on the live scene too. Every
    // downstream roll (wave seed, ER trainer/factory/ghost picks) derives from it.
    if (run.seed?.trim()) {
      globalScene.setSeed(run.seed.trim());
    }
    if (run.money !== undefined && run.money >= 0) {
      globalScene.money = Math.floor(run.money);
      globalScene.updateMoneyText(false);
    }
    // Challenges need the new run's gameMode (created by startRunWithMode).
    for (const ch of run.challenges ?? []) {
      if (ch?.id && typeof ch.value === "number") {
        try {
          globalScene.gameMode?.setChallengeValue(ch.id as Challenges, ch.value);
        } catch {
          /* unknown challenge id in an old share code - ignore */
        }
      }
    }
  };

  return { scenario, postLaunch };
}

/** A minimal starting spec for the builder form. */
export function emptyScenarioSpec(): ScenarioSpec {
  return {
    v: 1,
    name: "",
    notes: "",
    run: {},
    party: [],
    enemy: { kind: "wild" },
    items: {},
    start: {},
  };
}

// Re-export the ability NONE sentinel for the builder's slot handling.
export const ABILITY_NONE = AbilityId.NONE;
