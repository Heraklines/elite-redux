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
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
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

/** A player item/modifier row: a modifierTypes key + optional count/sub-type. */
export interface SpecItemRow {
  name: string;
  count?: number | undefined;
  type?: number | undefined;
}

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
        /** Party-wide player level. */
        level?: number | undefined;
        money?: number | undefined;
        double?: boolean | undefined;
        /** Pin the run seed for a fully deterministic repro. */
        seed?: string | undefined;
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
      }
    | undefined;
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

function applyStages(side: "player" | "enemy", stages: number[] | undefined): void {
  if (!stages?.some(s => s !== 0)) {
    return;
  }
  const mon = side === "player" ? globalScene.getPlayerPokemon() : globalScene.getEnemyPokemon();
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

function applyHpPct(side: "player" | "enemy", pct: number | undefined): void {
  if (pct === undefined || pct <= 0 || pct >= 100) {
    return;
  }
  const mon = side === "player" ? globalScene.getPlayerPokemon() : globalScene.getEnemyPokemon();
  if (mon) {
    mon.hp = Math.max(1, Math.floor((mon.getMaxHp() * pct) / 100));
    mon.updateInfo();
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
    if (run.level && run.level >= 1) {
      O.STARTING_LEVEL_OVERRIDE = Math.min(100, run.level);
    }
    if (run.double) {
      O.BATTLE_STYLE_OVERRIDE = "double";
    }
    setErDifficulty(run.difficulty ?? "ace");

    // Enemy side.
    const enemy = spec.enemy;
    if (enemy?.kind === "wild" && enemy.wild) {
      const w = enemy.wild;
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
      if (devParty.length >= 2) {
        O.BATTLE_STYLE_OVERRIDE = "double";
      }
      // Arbitrary ability / passive / held items for the enemy side (the global
      // enemy overrides hit every enemy, so they read off the first custom mon).
      const e0 = enemy.party[0];
      if (e0?.ability) {
        O.ENEMY_ABILITY_OVERRIDE = e0.ability as AbilityId;
      }
      if (e0?.passiveAbility) {
        O.ENEMY_PASSIVE_ABILITY_OVERRIDE = e0.passiveAbility as AbilityId;
        O.ENEMY_HAS_PASSIVE_ABILITY_OVERRIDE = true;
      }
      if (e0?.heldItems && e0.heldItems.length > 0) {
        O.ENEMY_HELD_ITEMS_OVERRIDE = toModifierOverrides(e0.heldItems);
      }
    }

    // Items.
    O.STARTING_HELD_ITEMS_OVERRIDE = toModifierOverrides(spec.items?.held);
    O.STARTING_MODIFIER_OVERRIDE = toModifierOverrides(spec.items?.modifiers);

    return spec.party.slice(0, 6).map(toStarter);
  };

  const onBattleStartFn = (): void => {
    const start = spec.start ?? {};
    applyStages("player", start.playerStages);
    applyStages("enemy", start.enemyStages);
    applyHpPct("player", start.playerHpPct);
    applyHpPct("enemy", start.enemyHpPct);
    if (start.playerStatus) {
      globalScene.getPlayerPokemon()?.trySetStatus(start.playerStatus as StatusEffect);
    }
    if (start.enemyStatus) {
      globalScene.getEnemyPokemon()?.trySetStatus(start.enemyStatus as StatusEffect);
    }
    // Wild ability slot: applied live (simplest reliable path).
    const wildSlot = spec.enemy?.kind === "wild" ? spec.enemy.wild?.abilitySlot : undefined;
    if (wildSlot !== undefined) {
      const e = globalScene.getEnemyPokemon();
      if (e) {
        e.abilityIndex = Math.max(0, Math.min(2, wildSlot));
      }
    }
  };

  // Build incrementally so optional fields are never set to `undefined`
  // (the shared DevScenario type runs under exactOptionalPropertyTypes).
  const scenario: DevScenario = { label, description, setup: setupFn };
  if (spec.start || spec.enemy?.kind === "wild") {
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
