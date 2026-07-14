/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — EDITOR-CREATED custom trainers (er-custom-trainers.json).
//
// The team balancing editor's "Custom Trainers" tab writes one entry per
// staff-authored trainer:
//
//   "ACE_RICO": {
//     "id": 70001,                     // stable, assigned at creation, 70000-79999
//     "name": "Ace Rico",              // display name (1-24 chars)
//     "trainerClass": "ACE_TRAINER",   // TrainerType enum NAME (sprite)
//     "battleType": "double",          // "single" | "double" | "triple"
//     "difficulties": ["ace", "elite", "hell"],  // youngster/ace/elite/hell
//     "minWave": 20,
//     "maxWave": 60,
//     "endless": false,                // true => any floor >= minWave (maxWave ignored)
//     "challenge": "none",             // none | one of the ErCustomTrainerChallenge
//                                      // keys (inverse, monocolor, monogen, doubles,
//                                      // ghost, monotype, maxcost, points, freshstart,
//                                      // flipstat, limitedcatch, limitedsupport,
//                                      // hardcore, passives, usagetier, triples)
//     "team": [
//       {
//         "species": 445,              // pokerogue speciesId (vanilla + ER customs)
//         "formIndex": 0,              // optional
//         "level": 55,                 // explicit level; null/absent => wave-scaled
//         "moves": ["EARTHQUAKE", "DRAGON_CLAW", "SWORDS_DANCE", "FIRE_FANG"],
//         "abilitySlot": 0,            // 0 | 1 | 2
//         "fusion": { "species": 384, "formIndex": 0, "abilitySlot": 0 }, // optional
//         "heldItems": [{ "item": "LEFTOVERS", "count": 1 }]  // enemy-legal keys
//       }
//     ]
//   }
//
// Ids live in the RESERVED 70000-79999 band (above the editor mons at
// 60000-69999). Every entry is validated at load; an invalid entry is SKIPPED
// with a warning (it can never break a build). Staff intent WINS: the resolved
// party is fielded EXACTLY as authored and BYPASSES the #419 elite BST cap (see
// `isErCustomTrainerBstBypassActive`).
//
// SOLO PATH ONLY. Co-op runs skip custom-trainer selection entirely (the seam
// is documented in `new-battle-phase.ts`); adopting them into a co-op session
// is future work and must not touch `src/data/elite-redux/coop/**`.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { Challenges } from "#enums/challenges";
import { Gender } from "#data/gender";
import { MoveId } from "#enums/move-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import type { EnemyPokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { resolveHeldItemKey } from "#system/llm-director/held-item-resolver";
import type { HeldModifierConfig } from "#types/held-modifier-config";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import customTrainersJson from "./er-custom-trainers.json";

/** Reserved id band for editor-created custom trainers. */
export const ER_CUSTOM_TRAINER_ID_MIN = 70000;
export const ER_CUSTOM_TRAINER_ID_MAX = 79999;

/** The battle formats a custom trainer can declare. */
export type ErCustomTrainerBattleType = "single" | "double" | "triple";

/**
 * Challenge-exclusivity keys the editor exposes (one per `Challenges`). The
 * first five keys are the original set and MUST stay as-is (saved JSON
 * back-compat); the rest cover the remaining challenges.
 */
export type ErCustomTrainerChallenge =
  | "none"
  | "inverse"
  | "monocolor"
  | "monogen"
  | "doubles"
  | "ghost"
  | "monotype"
  | "maxcost"
  | "points"
  | "freshstart"
  | "flipstat"
  | "limitedcatch"
  | "limitedsupport"
  | "hardcore"
  | "passives"
  | "usagetier"
  | "triples";

/** Editor-authored fusion for one team member (base is the member's species). */
export interface ErCustomTrainerFusion {
  /** Pokerogue speciesId of the fusion partner. */
  species: number;
  formIndex?: number;
  /** Ability slot picked on the fusion species (0/1/2). */
  abilitySlot?: number;
}

/** One held item on a team member. */
export interface ErCustomTrainerHeldItem {
  /** `modifierTypes` key (e.g. "LEFTOVERS"), resolved via `resolveHeldItemKey`. */
  item: string;
  count?: number;
}

/** One authored team member (raw JSON shape — kept loose; it is editor-written). */
export interface ErCustomTrainerMember {
  /** Pokerogue speciesId (vanilla < 10000, ER-custom >= 10000). */
  species: number;
  formIndex?: number;
  /** Explicit level; `null`/absent => the wave-scaled enemy level applies. */
  level?: number | null;
  /** Move enum NAMES (vanilla MoveId keys or ER-custom enum-keyed names). */
  moves?: readonly string[];
  /** Index into the species' ability list (active ability pick). */
  abilitySlot?: number;
  fusion?: ErCustomTrainerFusion | null;
  heldItems?: readonly ErCustomTrainerHeldItem[];
}

/** One authored trainer (raw JSON shape). */
export interface ErCustomTrainer {
  id: number;
  name: string;
  /** TrainerType enum NAME (sprite); resolved to a numeric `TrainerType`. */
  trainerClass: string;
  battleType?: ErCustomTrainerBattleType;
  difficulties?: readonly string[];
  minWave?: number;
  maxWave?: number;
  endless?: boolean;
  challenge?: ErCustomTrainerChallenge;
  team?: readonly ErCustomTrainerMember[];
}

export type ErCustomTrainers = Record<string, ErCustomTrainer>;

/** A fully-resolved member ready for the battle layer (ids resolved, moves mapped). */
export interface ErCustomTrainerMemberResolved {
  speciesId: number;
  formIndex: number;
  /** Explicit level, or `null` to use the wave-scaled enemy level. */
  level: number | null;
  moveIds: readonly number[];
  abilitySlot: number;
  fusion: { speciesId: number; formIndex: number; abilitySlot: number } | null;
  heldItemKeys: readonly { key: string; count: number }[];
}

/** A fully-resolved custom trainer ready for install. */
export interface ErCustomTrainerResolved {
  key: string;
  id: number;
  name: string;
  trainerType: number;
  /** Whether the encounter should be a double (also true for a pending triple). */
  isDouble: boolean;
  /** Authored as a triple but rendered as a double until #902 lands triples support. */
  isTriplePending: boolean;
  difficulties: readonly string[];
  minWave: number;
  maxWave: number;
  endless: boolean;
  challenge: ErCustomTrainerChallenge;
  members: readonly ErCustomTrainerMemberResolved[];
}

const CHALLENGE_MAP: Record<Exclude<ErCustomTrainerChallenge, "none">, Challenges> = {
  inverse: Challenges.INVERSE_BATTLE,
  monocolor: Challenges.MONO_COLOR,
  monogen: Challenges.SINGLE_GENERATION,
  doubles: Challenges.DOUBLES_ONLY,
  ghost: Challenges.GHOST_TRAINERS,
  monotype: Challenges.SINGLE_TYPE,
  maxcost: Challenges.LOWER_MAX_STARTER_COST,
  points: Challenges.LOWER_STARTER_POINTS,
  freshstart: Challenges.FRESH_START,
  flipstat: Challenges.FLIP_STAT,
  limitedcatch: Challenges.LIMITED_CATCH,
  limitedsupport: Challenges.LIMITED_SUPPORT,
  hardcore: Challenges.HARDCORE,
  passives: Challenges.PASSIVES,
  usagetier: Challenges.USAGE_TIER,
  triples: Challenges.TRIPLES_ONLY,
};

const VALID_DIFFICULTIES: ReadonlySet<string> = new Set(["youngster", "ace", "elite", "hell", "mystery"]);

let activeTrainers: ErCustomTrainers = customTrainersJson as ErCustomTrainers;
let resolvedCache: readonly ErCustomTrainerResolved[] | null = null;

/** Test hook: replace (or with `undefined` restore) the active custom-trainer table. */
export function setErCustomTrainersForTesting(trainers?: ErCustomTrainers): void {
  activeTrainers = trainers ?? (customTrainersJson as ErCustomTrainers);
  resolvedCache = null;
}

/** Move enum NAME -> pokerogue MoveId, vanilla + ER customs (mirror of er-trainer-tuning.ts). */
let moveByNameCache: Map<string, number> | null = null;
function moveByName(): Map<string, number> {
  if (moveByNameCache !== null) {
    return moveByNameCache;
  }
  const map = new Map<string, number>();
  for (const [key, value] of Object.entries(MoveId)) {
    if (typeof value === "number") {
      map.set(key, value);
    }
  }
  for (const draft of ER_MOVES) {
    const pkrgId = ER_ID_MAP.moves[draft.id];
    if (pkrgId === undefined) {
      continue;
    }
    const key = draft.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (key && !map.has(key)) {
      map.set(key, pkrgId);
    }
  }
  moveByNameCache = map;
  return map;
}

function clampSlot(value: unknown): number {
  return value === 1 || value === 2 ? value : 0;
}

/** Validate + resolve one raw entry; returns a resolved trainer or `null` (skipped). */
function resolveEntry(key: string, entry: ErCustomTrainer): ErCustomTrainerResolved | null {
  if (!/^[A-Z0-9_]{1,40}$/.test(key)) {
    console.warn(`[er-custom-trainers] skipped ${key}: bad trainer key`);
    return null;
  }
  if (!Number.isInteger(entry.id) || entry.id < ER_CUSTOM_TRAINER_ID_MIN || entry.id > ER_CUSTOM_TRAINER_ID_MAX) {
    console.warn(`[er-custom-trainers] skipped ${key}: id must be ${ER_CUSTOM_TRAINER_ID_MIN}-${ER_CUSTOM_TRAINER_ID_MAX}`);
    return null;
  }
  if (typeof entry.name !== "string" || entry.name.trim().length === 0 || entry.name.length > 24) {
    console.warn(`[er-custom-trainers] skipped ${key}: name must be 1-24 chars`);
    return null;
  }
  const trainerType =
    typeof entry.trainerClass === "string"
      ? (TrainerType as unknown as Record<string, number | undefined>)[entry.trainerClass]
      : undefined;
  if (typeof trainerType !== "number") {
    console.warn(`[er-custom-trainers] skipped ${key}: unknown trainerClass "${entry.trainerClass}"`);
    return null;
  }
  const team = Array.isArray(entry.team) ? entry.team : [];
  if (team.length < 1 || team.length > 6) {
    console.warn(`[er-custom-trainers] skipped ${key}: team must have 1-6 members`);
    return null;
  }
  const moves = moveByName();
  const members: ErCustomTrainerMemberResolved[] = [];
  for (const m of team) {
    if (!Number.isInteger(m.species) || (m.species as number) < 1) {
      console.warn(`[er-custom-trainers] skipped ${key}: member species must be a positive speciesId`);
      return null;
    }
    const moveIds = (m.moves ?? [])
      .map(name => moves.get(String(name).trim().toUpperCase()))
      .filter((id): id is number => id !== undefined);
    const fusion =
      m.fusion && Number.isInteger(m.fusion.species) && (m.fusion.species as number) >= 1
        ? {
            speciesId: m.fusion.species,
            formIndex: Number.isInteger(m.fusion.formIndex) ? (m.fusion.formIndex as number) : 0,
            abilitySlot: clampSlot(m.fusion.abilitySlot),
          }
        : null;
    const heldItemKeys = (m.heldItems ?? [])
      .filter(h => h && typeof h.item === "string" && h.item.length > 0)
      .map(h => ({ key: h.item, count: Number.isInteger(h.count) && (h.count as number) > 0 ? (h.count as number) : 1 }));
    members.push({
      speciesId: m.species,
      formIndex: Number.isInteger(m.formIndex) ? (m.formIndex as number) : 0,
      level: typeof m.level === "number" && m.level >= 1 ? Math.floor(m.level) : null,
      moveIds,
      abilitySlot: clampSlot(m.abilitySlot),
      fusion,
      heldItemKeys,
    });
  }
  const difficulties = (Array.isArray(entry.difficulties) ? entry.difficulties : ["ace", "elite", "hell"]).filter(d =>
    VALID_DIFFICULTIES.has(d),
  );
  const battleType: ErCustomTrainerBattleType =
    entry.battleType === "double" || entry.battleType === "triple" ? entry.battleType : "single";
  const challenge: ErCustomTrainerChallenge =
    entry.challenge && entry.challenge in CHALLENGE_MAP ? entry.challenge : "none";
  const minWave = Number.isInteger(entry.minWave) && (entry.minWave as number) >= 1 ? (entry.minWave as number) : 1;
  const maxWave = Number.isInteger(entry.maxWave) && (entry.maxWave as number) >= minWave ? (entry.maxWave as number) : 200;
  return {
    key,
    id: entry.id,
    name: entry.name.trim(),
    trainerType,
    // A triple falls back to a double until #902 lands triples support.
    isDouble: battleType === "double" || battleType === "triple",
    isTriplePending: battleType === "triple",
    difficulties,
    minWave,
    maxWave,
    endless: entry.endless === true,
    challenge,
    members,
  };
}

/** The validated + resolved custom trainers (lazy, cached). */
export function getErCustomTrainers(): readonly ErCustomTrainerResolved[] {
  if (resolvedCache !== null) {
    return resolvedCache;
  }
  const out: ErCustomTrainerResolved[] = [];
  for (const [key, entry] of Object.entries(activeTrainers)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const resolved = resolveEntry(key, entry);
    if (resolved !== null) {
      out.push(resolved);
    }
  }
  resolvedCache = out;
  return out;
}

// -----------------------------------------------------------------------------
// Rotation / non-repeat (mirrors the ER trainer no-repeat set, run-scoped). A
// used custom trainer is preferred-last for the rest of the run so a pool of
// staff trainers rotates. Persistence across save/reload is a documented seam
// (see game-data.ts erUsedTrainerKeys); this set is in-memory for now.
// -----------------------------------------------------------------------------
const USED_CUSTOM_TRAINER_KEYS = new Set<string>();

/** Reset per-run custom-trainer rotation (call at run start). */
export function resetErCustomTrainerTracking(): void {
  USED_CUSTOM_TRAINER_KEYS.clear();
}

/** Mark a custom trainer as fielded this run. */
export function markErCustomTrainerUsed(key: string): void {
  USED_CUSTOM_TRAINER_KEYS.add(key);
}

/** Deterministic FNV-1a hash of a seed string (mirrors runtime-hook selection seeding). */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function challengeActive(challenge: ErCustomTrainerChallenge): boolean {
  if (challenge === "none") {
    return true;
  }
  return globalScene.gameMode.hasChallenge(CHALLENGE_MAP[challenge]) === true;
}

/**
 * Pick a custom trainer for `waveIndex`, gated by the active difficulty, the
 * floor range (or endless: any floor >= minWave), and challenge-exclusivity.
 * Prefers unused-this-run trainers, then a deterministic wave-seeded choice so
 * a save reload lands the same trainer. Returns `null` when none is eligible.
 */
export function selectErCustomTrainerForWave(waveIndex: number): ErCustomTrainerResolved | null {
  const all = getErCustomTrainers();
  if (all.length === 0) {
    return null;
  }
  const difficulty = getErDifficulty();
  const eligible = all.filter(
    t =>
      t.difficulties.includes(difficulty)
      && waveIndex >= t.minWave
      && (t.endless || waveIndex <= t.maxWave)
      && challengeActive(t.challenge),
  );
  if (eligible.length === 0) {
    return null;
  }
  // Prefer trainers not yet fielded this run (rotation / non-repeat).
  const unused = eligible.filter(t => !USED_CUSTOM_TRAINER_KEYS.has(t.key));
  const pool = unused.length > 0 ? unused : eligible;
  const seed = `${globalScene.seed ?? ""}:custom-trainer:${waveIndex}`;
  const idx = hashSeed(seed) % pool.length;
  return pool[idx];
}

// The #419 BST-cap bypass flag lives in a zero-import leaf module so the central
// runtime hook can read it without an import cycle; re-exported here so callers
// have a single custom-trainer entry point.
export { isErCustomTrainerBstBypassActive, setErCustomTrainerBstBypass } from "#data/elite-redux/er-custom-trainer-bst-flag";

// -----------------------------------------------------------------------------
// Enemy construction (the exact-party guarantee).
// -----------------------------------------------------------------------------

/** Apply an authored fusion onto a freshly built enemy (mirrors generateFusionSpecies). */
function applyCustomFusion(enemy: EnemyPokemon, fusion: { speciesId: number; formIndex: number; abilitySlot: number }): void {
  const fusionSpecies = getPokemonSpecies(fusion.speciesId);
  if (!fusionSpecies) {
    return;
  }
  enemy.fusionSpecies = fusionSpecies;
  enemy.fusionAbilityIndex = fusion.abilitySlot;
  enemy.fusionShiny = enemy.shiny;
  enemy.fusionVariant = enemy.variant;
  if (fusionSpecies.malePercent === null) {
    enemy.fusionGender = Gender.GENDERLESS;
  } else {
    const genderChance = (enemy.id % 256) * 0.390625;
    enemy.fusionGender = genderChance < fusionSpecies.malePercent ? Gender.MALE : Gender.FEMALE;
  }
  enemy.fusionFormIndex = Number.isInteger(fusion.formIndex)
    ? fusion.formIndex
    : globalScene.getSpeciesFormIndex(fusionSpecies, enemy.fusionGender, enemy.getNature(), true);
  enemy.fusionLuck = enemy.luck;
}

/**
 * Build one authored team member as an {@linkcode EnemyPokemon}, EXACTLY as
 * specified: species/form, level (explicit or the wave-scaled fallback),
 * ability slot, moveset and optional fusion. Held items are applied separately
 * (see {@linkcode erCustomTrainerHeldModifierConfigs}). Returns `null` when the
 * species can't be resolved.
 */
export function buildErCustomTrainerMember(
  member: ErCustomTrainerMemberResolved,
  index: number,
  scaledLevel: number,
  isDouble: boolean,
): EnemyPokemon | null {
  const species = getPokemonSpecies(member.speciesId);
  if (!species) {
    return null;
  }
  const level = member.level ?? scaledLevel;
  const trainerSlot = !isDouble || index % 2 === 0 ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER;
  const enemy = globalScene.addEnemyPokemon(species, level, trainerSlot);
  if (member.formIndex) {
    enemy.formIndex = member.formIndex;
  }
  enemy.abilityIndex = member.abilitySlot;
  if (member.fusion) {
    applyCustomFusion(enemy, member.fusion);
  }
  if (member.moveIds.length > 0) {
    const moves = member.moveIds.map(id => new PokemonMove(id));
    enemy.moveset = moves;
    enemy.summonData.moveset = moves.slice();
  }
  enemy.calculateStats();
  enemy.generateName();
  return enemy;
}

/** Resolve one member's authored held items to `HeldModifierConfig[]` (enemy-legal pool). */
export function erCustomTrainerHeldModifierConfigs(member: ErCustomTrainerMemberResolved): HeldModifierConfig[] {
  const out: HeldModifierConfig[] = [];
  for (const held of member.heldItemKeys) {
    const config = resolveHeldItemKey(held.key);
    if (config) {
      out.push({ ...config, stackCount: held.count });
    }
  }
  return out;
}
