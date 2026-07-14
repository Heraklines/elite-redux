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
//     "weight": 100,                   // integer >= 1; absent => 100. RELATIVE odds
//                                      // this trainer is the one fielded when a
//                                      // spawn window fires (weight / totalWeight
//                                      // among the gate-eligible not-yet-used pool).
//                                      // Replaces the old per-trainer `spawnChance`:
//                                      // a saved `spawnChance` with no `weight`
//                                      // migrates to weight = spawnChance (>= 1).
//     "challenge": "none",             // none | one of the ErCustomTrainerChallenge
//                                      // keys (inverse, monocolor, monogen, doubles,
//                                      // ghost, monotype, maxcost, points, freshstart,
//                                      // flipstat, limitedcatch, limitedsupport,
//                                      // hardcore, passives, usagetier, triples)
//     "battleBgm": "battle_ghost_piano", // optional er-assets audio/bgm key
//                                      // (filename without .mp3). Plays for THIS
//                                      // battle ONLY. Trimmed; empty/absent = the
//                                      // trainer's default theme. See bgm.json.
//     "team": [
//       {
//         "species": 445,              // pokerogue speciesId (vanilla + ER customs)
//         "formIndex": 0,              // optional
//         "level": 55,                 // explicit level; null/absent => wave-scaled
//         "moves": ["EARTHQUAKE", "DRAGON_CLAW", "RLA", "RLNA"],
//                                      // move enum NAMES. Two literal tokens are
//                                      // resolved at install to a SEEDED random legal
//                                      // move of the species (level-up ∪ TM ∪ egg):
//                                      //   RLA  = random legal ATTACKING move (non-STATUS)
//                                      //   RLNA = random legal NON-ATTACKING move (STATUS)
//         "abilitySlot": 0,            // 0 | 1 | 2
//         "fusion": { "species": 384, "formIndex": 0, "abilitySlot": 0 }, // optional
//         "heldItems": [{ "item": "LEFTOVERS", "count": 1 }], // enemy-legal keys
//         "slotChance": 100            // slots 2-6 only: integer 1-100 chance the slot
//                                      // is FILLED this run (absent/slot-1 => 100). A
//                                      // failed roll omits the slot (party shrinks).
//       },
//       {                             // A WEIGHTED slot: ONE possibility is picked per
//                                      // run, probability weight/totalWeight (seeded).
//                                      // A flat member (above) == 1 variant weight 1.
//         "slotChance": 100,           // optional; lives on the slot wrapper here
//         "variants": [
//           { "species": 445, "moves": ["EARTHQUAKE"], "weight": 30 },
//           { "species": 448, "moves": ["CLOSE_COMBAT"], "weight": 70 }
//         ]
//       }
//     ]
//   }
//
// GLOBAL SPAWN DENSITY (er-custom-trainers-config.json — a sibling whitelisted
// file, NOT a meta key inside this map). The run is diced into fixed windows
// (default 10 waves); each window rolls ONCE (default 25%) whether ANY custom
// trainer appears at all, INDEPENDENT of how many trainers are authored. When a
// window fires, one wave inside it is chosen (seeded, slid forward past
// boss/fixed/mystery waves) and one trainer is picked by `weight` among the
// gate-eligible not-yet-used pool. At most one custom trainer per window, no
// repeats per run. This replaces the old per-trainer once-per-run `spawnChance`
// (which piled up: N trainers at 100% meant every early wave was a custom battle).
//
// Every per-run choice (window fire, wave, trainer pick, weighted-variant pick,
// slot-fill, RLA/RLNA move) derives ONLY from the run seed (NO Math.random), so a
// save reload — and a future co-op adoption — reproduce identically. Salts
// (load-bearing, keep stable):
//   window fire  : `${seed}:custom-trainer-window:${windowIndex}`
//   window wave  : `${seed}:custom-trainer-wave:${windowIndex}`
//   trainer pick : `${seed}:custom-trainer-pick:${windowIndex}`
//   variant pick : `${seed}:custom-trainer-slot:${key}:${slotIndex}`
//   slot fill    : `${seed}:custom-trainer-slotfill:${key}:${slotIndex}`
//   move token   : `${seed}:custom-trainer-move:${key}:${slotIndex}:${moveIndex}`
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

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { globalScene } from "#app/global-scene";
import { isDevToolsEnabled } from "#app/dev-tools/registry";
import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  encodeErShinyLabPreset,
  ER_SHINY_LAB_DEFAULT_PARAMS,
  type ErShinyLabSavedLook,
  getErShinyLabDefinition,
  normalizeErShinyLabSavedLook,
  sanitizeErShinyLabPresetName,
} from "#data/elite-redux/er-shiny-lab-effects";
import { isKnownTrainerAuraId } from "#data/elite-redux/er-trainer-fx";
import { collectShowdownFreeMoves } from "#data/elite-redux/showdown/showdown-legal-moves";
import { Challenges } from "#enums/challenges";
import { Gender } from "#data/gender";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import type { EnemyPokemon } from "#field/pokemon";
import type { Trainer } from "#field/trainer";
import { PokemonMove } from "#moves/pokemon-move";
import { resolveHeldItemKey } from "#system/llm-director/held-item-resolver";
import type { HeldModifierConfig } from "#types/held-modifier-config";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import customTrainersJson from "./er-custom-trainers.json";
import customTrainersConfigJson from "./er-custom-trainers-config.json";

/** Reserved id band for editor-created custom trainers. */
export const ER_CUSTOM_TRAINER_ID_MIN = 70000;
export const ER_CUSTOM_TRAINER_ID_MAX = 79999;

/**
 * Wave span an endless trainer's single per-run appearance is picked from:
 * minWave .. minWave + (window - 1). Endless trainers have no maxWave, so the
 * assigned wave is drawn uniformly across this many floors starting at minWave.
 */
export const ER_CUSTOM_TRAINER_ENDLESS_WINDOW = 200;

/**
 * GLOBAL spawn-density config (er-custom-trainers-config.json). Controls how OFTEN
 * a custom-trainer encounter happens at all, INDEPENDENT of how many trainers are
 * authored. The run is diced into fixed windows of `windowSize` waves; each window
 * rolls ONCE (`windowChancePct`) whether ANY custom trainer appears in it.
 */
export interface ErCustomTrainerSpawnConfig {
  /** Waves per spawn window (integer 1-100; default 10). */
  windowSize: number;
  /** Percent chance (0-100) a given window fields a custom trainer at all (default 25). */
  windowChancePct: number;
}

/** Shipped defaults (used when the config file is missing or a field is invalid). */
export const ER_CUSTOM_TRAINER_SPAWN_CONFIG_DEFAULT: ErCustomTrainerSpawnConfig = {
  windowSize: 10,
  windowChancePct: 25,
};

/**
 * Normalize a raw spawn-density config: `windowSize` clamps to an integer 1-100
 * (invalid/absent => 10); `windowChancePct` clamps to an integer 0-100
 * (invalid/absent => 25). A garbage file can never break spawning.
 */
export function normalizeErCustomTrainerSpawnConfig(raw: unknown): ErCustomTrainerSpawnConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }
    const n = Math.floor(value);
    return n >= min && n <= max ? n : fallback;
  };
  return {
    windowSize: clampInt(o.windowSize, 1, 100, ER_CUSTOM_TRAINER_SPAWN_CONFIG_DEFAULT.windowSize),
    windowChancePct: clampInt(o.windowChancePct, 0, 100, ER_CUSTOM_TRAINER_SPAWN_CONFIG_DEFAULT.windowChancePct),
  };
}

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

/**
 * Editor-authored Shiny Lab look one team member (or weighted possibility) fields
 * with. Effects are picked per category by their registry id (see
 * `ER_SHINY_LAB_EFFECTS_BY_CATEGORY`); the game encodes them (with default
 * params) into the same serialized `ErShinyLabSavedLook` tuple ghost/co-op mons
 * carry (#785), then renders it on the fielded enemy. An empty/unknown effect in
 * a category is dropped; a member with no valid effect fields normally (not shiny).
 */
export interface ErCustomTrainerShiny {
  /** Palette-effect registry id (recolors the whole sprite), or absent/"". */
  palette?: string;
  /** Surface-effect registry id (overlay on the sprite), or absent/"". */
  surface?: string;
  /** Around-effect registry id (aura behind/around the sprite), or absent/"". */
  around?: string;
  /** Optional name-prefix carried by the look (sanitized, capped). */
  name?: string;
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
  /**
   * Move enum NAMES (vanilla MoveId keys or ER-custom enum-keyed names). The two
   * literal tokens `RLA` (Random Legal Attacking move) and `RLNA` (Random Legal
   * Non-Attacking move) are resolved at install time to a seeded random legal
   * move of the matching category (see `resolveErCustomTrainerMoveIds`).
   */
  moves?: readonly string[];
  /** Index into the species' ability list (active ability pick). */
  abilitySlot?: number;
  fusion?: ErCustomTrainerFusion | null;
  heldItems?: readonly ErCustomTrainerHeldItem[];
  /** Shiny Lab visual effect the mon fields with (see {@linkcode ErCustomTrainerShiny}). */
  shiny?: ErCustomTrainerShiny | null;
  /**
   * WEIGHTED-SLOT possibility weight (integer >= 1). Only meaningful inside a
   * `variants` slot; ignored (treated as 1) on a bare flat member. Invalid
   * weights clamp to 1.
   */
  weight?: number;
  /**
   * SLOT-FILL chance (integer 1-100) that this slot is fielded AT ALL this run.
   * Absent/invalid => 100 (always filled). Slot 1 (index 0) ignores it — the
   * trainer always has a lead. On a `variants` slot the chance lives on the slot
   * wrapper instead (see {@linkcode ErCustomTrainerVariantSlot}).
   */
  slotChance?: number;
}

/**
 * A WEIGHTED slot: several member possibilities, ONE of which is picked per run
 * (probability weight/totalWeight, seeded). Back-compat: a flat member object is
 * equivalent to a single-variant slot of weight 1.
 */
export interface ErCustomTrainerVariantSlot {
  variants: readonly ErCustomTrainerMember[];
  /** Slot-fill chance 1-100 (absent/invalid => 100); ignored for slot 1 (index 0). */
  slotChance?: number;
}

/** One team-slot entry in the raw JSON: either a flat member or a weighted slot. */
export type ErCustomTrainerTeamEntry = ErCustomTrainerMember | ErCustomTrainerVariantSlot;

/** True when a raw team entry is the weighted `{ variants: [...] }` form. */
function isVariantSlot(entry: ErCustomTrainerTeamEntry): entry is ErCustomTrainerVariantSlot {
  return Array.isArray((entry as ErCustomTrainerVariantSlot).variants);
}

/** One authored trainer (raw JSON shape). */
export interface ErCustomTrainer {
  id: number;
  name: string;
  /** TrainerType enum NAME (sprite); resolved to a numeric `TrainerType`. */
  trainerClass: string;
  /**
   * Which gendered sprite the trainer fields, for classes that ship both an `_m`
   * and `_f` sprite (see `hasGenders`). "f" fields the female sprite; "m"/absent
   * the male/default. Ignored (no effect) for a class with a single sprite — the
   * game silently keeps the base sprite. The authored `name` always wins.
   */
  gender?: "m" | "f";
  battleType?: ErCustomTrainerBattleType;
  difficulties?: readonly string[];
  minWave?: number;
  maxWave?: number;
  endless?: boolean;
  /**
   * Relative odds this trainer is the one fielded when a spawn window fires
   * (weight / totalWeight among gate-eligible not-yet-used trainers). Integer
   * >= 1; absent => 100. REPLACES the old per-trainer `spawnChance`.
   */
  weight?: number;
  /**
   * DEPRECATED (pre-window-density saves). Per-trainer once-per-run appearance
   * chance 1-100. Still parsed for back-compat: a saved entry with `spawnChance`
   * and no `weight` migrates to `weight = spawnChance` (clamped >= 1). New saves
   * always write `weight` instead.
   */
  spawnChance?: number;
  challenge?: ErCustomTrainerChallenge;
  /**
   * er-assets `audio/bgm/<key>.mp3` key (filename without `.mp3`) that plays for
   * THIS battle only. Trimmed; empty/absent/invalid => the trainer's default
   * theme. Charset `[a-z0-9_]+` (mirrors the editor + worker validator).
   */
  battleBgm?: string;
  /**
   * Optional encounter line shown when this trainer's battle starts (the "intro
   * blurb"). Trimmed, control-chars stripped, capped at
   * {@linkcode ER_CUSTOM_TRAINER_INTRO_MAX} chars. Empty/absent => the trainer's
   * default class encounter line. Players can suppress it entirely with the
   * "Skip custom trainer intros" setting.
   */
  introDialogue?: string;
  /**
   * Optional line shown when the PLAYER beats this trainer (the victory line).
   * Same normalization + cap as {@linkcode introDialogue}. Applied through the
   * SAME instance-level `getVictoryMessages` override the ghost dialogue routine
   * uses (see `markTrainerAsGhost` in er-ghost-teams.ts). Empty/absent => the
   * trainer's default class victory line. NOT gated by the intro-skip setting.
   */
  victoryDialogue?: string;
  /**
   * Optional line shown when this trainer BEATS the player (the defeat line, i.e.
   * the trainer wins). Same normalization + cap as {@linkcode introDialogue}.
   * Applied through the SAME instance-level `getDefeatMessages` override the ghost
   * dialogue routine uses. Empty/absent => the trainer's default class defeat line.
   */
  defeatDialogue?: string;
  /**
   * Optional TRAINER-SPRITE visual effect (an aura rendered around the trainer's
   * field sprite), reusing the Ghost Trainer FX aura seam EXACTLY: the value is an
   * aura id from the ghost FX catalog ({@linkcode TRAINER_AURA_EFFECTS}, validated
   * via `isKnownTrainerAuraId`), stamped instance-level as `trainer.erGhostAura` at
   * install and rendered by the existing `applyErGhostAuraFx` overlay in
   * encounter-phase. Empty/absent/unknown => no aura (the plain trainer sprite).
   */
  trainerEffect?: string;
  team?: readonly ErCustomTrainerTeamEntry[];
}

export type ErCustomTrainers = Record<string, ErCustomTrainer>;

/** Max length of a custom trainer's intro blurb (kept short for the dialogue box). */
export const ER_CUSTOM_TRAINER_INTRO_MAX = 200;

/**
 * One move slot on a resolved member: a concrete move id, or an `RLA`/`RLNA`
 * token that is resolved to a seeded random legal move at install time.
 */
export type ErCustomTrainerMoveSpec = { kind: "id"; id: number } | { kind: "token"; token: "RLA" | "RLNA" };

/** A fully-resolved member ready for the battle layer (ids resolved, moves mapped). */
export interface ErCustomTrainerMemberResolved {
  speciesId: number;
  formIndex: number;
  /** Explicit level, or `null` to use the wave-scaled enemy level. */
  level: number | null;
  /** Concrete move ids ONLY (RLA/RLNA tokens excluded); see `moveSpecs` for the full ordered slots. */
  moveIds: readonly number[];
  /** Ordered move slots incl. RLA/RLNA tokens (resolved via `resolveErCustomTrainerMoveIds`). */
  moveSpecs: readonly ErCustomTrainerMoveSpec[];
  abilitySlot: number;
  fusion: { speciesId: number; formIndex: number; abilitySlot: number } | null;
  heldItemKeys: readonly { key: string; count: number }[];
  /** Serialized Shiny Lab look this member fields with, or `null` (renders normally). */
  shinyLook: ErShinyLabSavedLook | null;
  /** Sanitized name-prefix carried by the shiny look ("" when none). */
  shinyName: string;
}

/** One weighted possibility of a resolved team slot. */
export interface ErCustomTrainerVariantResolved {
  member: ErCustomTrainerMemberResolved;
  /** Integer weight >= 1 (probability weight/totalWeight within the slot). */
  weight: number;
}

/** A fully-resolved team slot: 1+ weighted possibilities + a per-run fill chance. */
export interface ErCustomTrainerSlotResolved {
  /** Possibilities (length >= 1); ONE is picked per run by weight. */
  variants: readonly ErCustomTrainerVariantResolved[];
  /** Chance 1-100 the slot is fielded this run. Slot 1 (index 0) is forced to 100. */
  slotChance: number;
}

/** One member actually fielded this run, tagged with its authored slot index. */
export interface ErCustomTrainerFieldedMember {
  member: ErCustomTrainerMemberResolved;
  /** Authored slot index (0-based); the salt anchor for variant + move-token rolls. */
  slotIndex: number;
}

/** A fully-resolved custom trainer ready for install. */
export interface ErCustomTrainerResolved {
  key: string;
  id: number;
  name: string;
  trainerType: number;
  /** "f" fields the female sprite variant (classes with `hasGenders`); "m" otherwise. */
  gender: "m" | "f";
  /** Whether the encounter should be a double (also true for a pending triple). */
  isDouble: boolean;
  /** Authored as a triple but rendered as a double until #902 lands triples support. */
  isTriplePending: boolean;
  difficulties: readonly string[];
  minWave: number;
  maxWave: number;
  endless: boolean;
  /** Relative pick weight when a spawn window fires (integer >= 1; default 100). */
  weight: number;
  challenge: ErCustomTrainerChallenge;
  /** er-assets bgm key to play for this battle only, or "" for the default theme. */
  battleBgm: string;
  /** Normalized intro blurb shown at battle start, or "" for the default class line. */
  introDialogue: string;
  /** Normalized victory line (player beats the trainer), or "" for the default class line. */
  victoryDialogue: string;
  /** Normalized defeat line (trainer beats the player), or "" for the default class line. */
  defeatDialogue: string;
  /** Ghost-FX aura id rendered around the trainer sprite, or "" for no aura. */
  trainerEffect: string;
  /**
   * The REPRESENTATIVE members (variant 0 of each slot, slot-fill ignored) — the
   * authored default view. The FIELDED party for a run is derived per-seed via
   * {@linkcode resolveErCustomTrainerParty} (weighted variant pick + slot-fill).
   */
  members: readonly ErCustomTrainerMemberResolved[];
  /** Full per-slot detail: weighted possibilities + slot-fill chance. */
  slots: readonly ErCustomTrainerSlotResolved[];
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
let activeSpawnConfig: ErCustomTrainerSpawnConfig = normalizeErCustomTrainerSpawnConfig(customTrainersConfigJson);

/** Test hook: replace (or with `undefined` restore) the active custom-trainer table. */
export function setErCustomTrainersForTesting(trainers?: ErCustomTrainers): void {
  activeTrainers = trainers ?? (customTrainersJson as ErCustomTrainers);
  resolvedCache = null;
  USED_CUSTOM_TRAINER_WINDOWS.clear();
}

/** The active (normalized) global spawn-density config. */
export function getErCustomTrainerSpawnConfig(): ErCustomTrainerSpawnConfig {
  return activeSpawnConfig;
}

/** Test hook: replace (or with `undefined` restore) the active spawn-density config. */
export function setErCustomTrainerSpawnConfigForTesting(config?: Partial<ErCustomTrainerSpawnConfig>): void {
  activeSpawnConfig = normalizeErCustomTrainerSpawnConfig(config ?? customTrainersConfigJson);
  USED_CUSTOM_TRAINER_WINDOWS.clear();
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

/** Valid er-assets bgm key charset (mirrors the editor + worker validator). */
const BATTLE_BGM_RE = /^[a-z0-9_]+$/;

/**
 * Normalize an authored `battleBgm`: trim, lowercase-charset-check, length cap.
 * A non-string, empty-after-trim, over-long, or bad-charset value => "" (no
 * override, the trainer keeps its default theme).
 */
export function normalizeBattleBgm(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const key = value.trim();
  if (key.length === 0 || key.length > 64 || !BATTLE_BGM_RE.test(key)) {
    return "";
  }
  return key;
}

/**
 * Normalize an authored trainer dialogue LINE (intro / victory / defeat): strip
 * control chars (so it stays on the dialogue line), collapse to a single trimmed
 * string, and cap at {@linkcode ER_CUSTOM_TRAINER_INTRO_MAX}. A non-string or
 * empty-after-trim value => "" (no line; the trainer keeps its default class line).
 */
export function normalizeDialogueLine(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  let cleaned = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    // Drop control chars (incl. newlines/tabs) so the line renders on one line.
    if (code >= 0x20 && code !== 0x7f) {
      cleaned += ch;
    }
  }
  return cleaned.trim().slice(0, ER_CUSTOM_TRAINER_INTRO_MAX);
}

/** Normalize an authored `introDialogue` (alias of {@linkcode normalizeDialogueLine}). */
export function normalizeIntroDialogue(value: unknown): string {
  return normalizeDialogueLine(value);
}

/**
 * Normalize an authored `trainerEffect`: an aura id from the Ghost Trainer FX
 * catalog. Anything not in the known aura whitelist (`isKnownTrainerAuraId`) => ""
 * (no aura). Mirrors how `sanitizeGhostProfile` clamps a ghost's `aura` field, so
 * a custom trainer's effect is the SAME representation the ghost seam consumes.
 */
export function normalizeTrainerEffect(value: unknown): string {
  return isKnownTrainerAuraId(value) ? value : "";
}

/**
 * Normalize an authored `spawnChance` to an integer in 1-100. Absent or invalid
 * (non-number, non-finite, out of 1-100) => 100, so a saved entry without the
 * field behaves exactly as before (guaranteed to appear once per run).
 */
function normalizeSpawnChance(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 100;
  }
  const n = Math.floor(value);
  return n >= 1 && n <= 100 ? n : 100;
}

/**
 * Normalize a slot-fill chance (slots 2-6) to an integer 1-100. Identical rules
 * to {@linkcode normalizeSpawnChance}: absent/invalid => 100 (slot always filled).
 */
function normalizeSlotChance(value: unknown): number {
  return normalizeSpawnChance(value);
}

/**
 * Resolve a trainer's pick `weight` with `spawnChance` back-compat migration:
 *   - a present `weight` clamps to an integer >= 1 (invalid => 1),
 *   - else a legacy `spawnChance` migrates to `weight = spawnChance` (clamped >= 1),
 *   - else (neither present) => 100 (the shipped default weight).
 * Pure — exported for direct migration testing.
 */
export function resolveErCustomTrainerWeight(weight: unknown, spawnChance: unknown): number {
  const clampAtLeastOne = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 1;
    }
    const n = Math.floor(value);
    return n >= 1 ? n : 1;
  };
  if (weight !== undefined) {
    return clampAtLeastOne(weight);
  }
  if (spawnChance !== undefined) {
    return clampAtLeastOne(spawnChance);
  }
  return 100;
}

/** Clamp an authored variant weight to an integer >= 1 (invalid => 1). */
function clampVariantWeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  const n = Math.floor(value);
  return n >= 1 ? n : 1;
}

/**
 * Parse one member's authored move NAMES into ordered move slots. A concrete name
 * resolves to a `{ kind: "id" }` spec; the literal `RLA`/`RLNA` tokens become
 * `{ kind: "token" }` specs (resolved to a seeded legal move at install); an
 * unknown name is DROPPED (matches the pre-existing unknown-move behavior).
 */
function parseMoveSpecs(rawMoves: readonly string[] | undefined): {
  specs: ErCustomTrainerMoveSpec[];
  ids: number[];
} {
  const moves = moveByName();
  const specs: ErCustomTrainerMoveSpec[] = [];
  const ids: number[] = [];
  for (const raw of rawMoves ?? []) {
    const name = String(raw).trim().toUpperCase();
    if (name === "RLA" || name === "RLNA") {
      specs.push({ kind: "token", token: name });
      continue;
    }
    const id = moves.get(name);
    if (id !== undefined) {
      specs.push({ kind: "id", id });
      ids.push(id);
    }
  }
  return { specs, ids };
}

/**
 * Resolve an authored Shiny Lab look into the serialized tuple the enemy renders.
 * Each category's effect id is validated against the registry (unknown => dropped);
 * with no valid effect the member renders normally (returns `null`). The loadout is
 * encoded with DEFAULT params — the same `ErShinyLabSavedLook` representation ghost
 * and co-op mons serialize (#785) — so the look is reproduced identically in battle.
 */
function resolveShinyLook(raw: ErCustomTrainerShiny | null | undefined): { look: ErShinyLabSavedLook; name: string } | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const pick = (category: "palette" | "surface" | "around", value: unknown): string | null =>
    typeof value === "string" && getErShinyLabDefinition(category, value) ? value : null;
  const loadout = {
    palette: pick("palette", raw.palette),
    surface: pick("surface", raw.surface),
    around: pick("around", raw.around),
  };
  if (!loadout.palette && !loadout.surface && !loadout.around) {
    return null;
  }
  const preset = encodeErShinyLabPreset({ loadout, params: ER_SHINY_LAB_DEFAULT_PARAMS });
  const look = normalizeErShinyLabSavedLook(preset);
  if (!look) {
    return null;
  }
  return { look, name: sanitizeErShinyLabPresetName(typeof raw.name === "string" ? raw.name : "") };
}

/** Resolve one raw member; returns `null` when the species id is invalid (drops the trainer). */
function resolveMember(m: ErCustomTrainerMember): ErCustomTrainerMemberResolved | null {
  if (!Number.isInteger(m.species) || (m.species as number) < 1) {
    return null;
  }
  const { specs, ids } = parseMoveSpecs(m.moves);
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
  const shiny = resolveShinyLook(m.shiny);
  return {
    speciesId: m.species,
    formIndex: Number.isInteger(m.formIndex) ? (m.formIndex as number) : 0,
    level: typeof m.level === "number" && m.level >= 1 ? Math.floor(m.level) : null,
    moveIds: ids,
    moveSpecs: specs,
    abilitySlot: clampSlot(m.abilitySlot),
    fusion,
    heldItemKeys,
    shinyLook: shiny ? shiny.look : null,
    shinyName: shiny ? shiny.name : "",
  };
}

/**
 * Resolve one raw team entry (flat member OR weighted `{ variants }` slot) into a
 * resolved slot. Slot index 0 (the lead) is forced to slotChance 100. Returns
 * `null` when any member/variant is invalid (drops the whole trainer).
 */
function resolveSlot(entry: ErCustomTrainerTeamEntry, slotIndex: number): ErCustomTrainerSlotResolved | null {
  if (isVariantSlot(entry)) {
    const rawVariants = Array.isArray(entry.variants) ? entry.variants : [];
    if (rawVariants.length < 1) {
      return null;
    }
    const variants: ErCustomTrainerVariantResolved[] = [];
    for (const v of rawVariants) {
      const member = resolveMember(v);
      if (member === null) {
        return null;
      }
      variants.push({ member, weight: clampVariantWeight(v.weight) });
    }
    return { variants, slotChance: slotIndex === 0 ? 100 : normalizeSlotChance(entry.slotChance) };
  }
  const member = resolveMember(entry);
  if (member === null) {
    return null;
  }
  return {
    variants: [{ member, weight: 1 }],
    slotChance: slotIndex === 0 ? 100 : normalizeSlotChance(entry.slotChance),
  };
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
  const slots: ErCustomTrainerSlotResolved[] = [];
  for (let i = 0; i < team.length; i++) {
    const slot = resolveSlot(team[i], i);
    if (slot === null) {
      console.warn(`[er-custom-trainers] skipped ${key}: slot ${i + 1} has an invalid member/variant`);
      return null;
    }
    slots.push(slot);
  }
  // Representative members = variant 0 of each slot (slot-fill ignored) — the
  // authored default view. The FIELDED party is derived per-seed at install.
  const members = slots.map(s => s.variants[0].member);
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
    gender: entry.gender === "f" ? "f" : "m",
    // A triple falls back to a double until #902 lands triples support.
    isDouble: battleType === "double" || battleType === "triple",
    isTriplePending: battleType === "triple",
    difficulties,
    minWave,
    maxWave,
    endless: entry.endless === true,
    weight: resolveErCustomTrainerWeight(entry.weight, entry.spawnChance),
    challenge,
    battleBgm: normalizeBattleBgm(entry.battleBgm),
    introDialogue: normalizeDialogueLine(entry.introDialogue),
    victoryDialogue: normalizeDialogueLine(entry.victoryDialogue),
    defeatDialogue: normalizeDialogueLine(entry.defeatDialogue),
    trainerEffect: normalizeTrainerEffect(entry.trainerEffect),
    members,
    slots,
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
// Window-density appearance model (seed-deterministic). REPLACES the old
// per-trainer once-per-run `spawnChance` (which piled up: N trainers at 100%
// meant every early wave was a custom battle). Now a GLOBAL density config dices
// the run into fixed windows; each window rolls ONCE whether ANY custom trainer
// appears, then picks WHICH trainer by `weight`. At most one custom trainer per
// window, no repeats per run. Both the used-key set and the used-window set are
// run-scoped (cleared at run start via resetErCustomTrainerTracking); everything
// derives from the run seed so a save reload — and a future co-op adoption —
// land identically (NO Math.random).
// -----------------------------------------------------------------------------
const USED_CUSTOM_TRAINER_KEYS = new Set<string>();

/** Windows (0-based indices) that have already fielded a custom trainer this run. */
const USED_CUSTOM_TRAINER_WINDOWS = new Set<number>();

/** Reset per-run custom-trainer state (used keys + used windows); call at run start. */
export function resetErCustomTrainerTracking(): void {
  USED_CUSTOM_TRAINER_KEYS.clear();
  USED_CUSTOM_TRAINER_WINDOWS.clear();
}

/** Mark a custom trainer as fielded this run (no repeats). */
export function markErCustomTrainerUsed(key: string): void {
  USED_CUSTOM_TRAINER_KEYS.add(key);
}

/** Mark a spawn window (0-based index) as having fielded its one custom trainer. */
export function markErCustomTrainerWindowUsed(windowIndex: number): void {
  USED_CUSTOM_TRAINER_WINDOWS.add(windowIndex);
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

/** The 0-based spawn-window index a 1-based `waveIndex` falls in (waves 1..size => 0). */
export function erCustomTrainerWindowIndex(waveIndex: number, windowSize: number): number {
  const size = Math.max(1, Math.floor(windowSize));
  return Math.floor((Math.max(1, waveIndex) - 1) / size);
}

/**
 * Whether the given spawn window fields a custom trainer AT ALL this run — the
 * global-density roll, INDEPENDENT of trainer count. Pure + deterministic; NO
 * Math.random. Salt (load-bearing): `${seed}:custom-trainer-window:${windowIndex}`.
 *   fires = hashSeed(...) % 100 < windowChancePct
 * A windowChancePct of 0 never fires; 100 always fires.
 */
export function rollErCustomTrainerWindow(
  seed: string,
  windowIndex: number,
  config: ErCustomTrainerSpawnConfig,
): boolean {
  if (config.windowChancePct <= 0) {
    return false;
  }
  return hashSeed(`${seed}:custom-trainer-window:${windowIndex}`) % 100 < config.windowChancePct;
}

/**
 * The wave WITHIN a firing window the custom trainer is anchored to (the first
 * wave >= this in the window fields it, sliding forward past boss/fixed/mystery
 * waves exactly like the old DUE semantics). Pure. Salt (load-bearing):
 * `${seed}:custom-trainer-wave:${windowIndex}`. Returns a 1-based wave number.
 */
export function erCustomTrainerWindowWave(seed: string, windowIndex: number, windowSize: number): number {
  const size = Math.max(1, Math.floor(windowSize));
  const start = windowIndex * size + 1;
  return start + (hashSeed(`${seed}:custom-trainer-wave:${windowIndex}`) % size);
}

/**
 * Pick ONE trainer index by `weight` among a firing window's gate-eligible pool,
 * probability weight/totalWeight, seeded by `${seed}:custom-trainer-pick:${windowIndex}`.
 * Pure + deterministic; NO Math.random. Entries with weight <= 0 are treated as
 * INELIGIBLE (never picked, excluded from the total). Returns the array index of
 * the picked entry, or -1 when the pool is empty or every weight is <= 0.
 */
export function pickErCustomTrainerByWeight(
  seed: string,
  windowIndex: number,
  pool: readonly { weight: number }[],
): number {
  let total = 0;
  for (const p of pool) {
    if (p.weight > 0) {
      total += Math.floor(p.weight);
    }
  }
  if (total <= 0) {
    return -1;
  }
  const r = hashSeed(`${seed}:custom-trainer-pick:${windowIndex}`) % total;
  let acc = 0;
  for (let i = 0; i < pool.length; i++) {
    if (pool[i].weight <= 0) {
      continue;
    }
    acc += Math.floor(pool[i].weight);
    if (r < acc) {
      return i;
    }
  }
  // Fall back to the last positive-weight entry (float/rounding guard).
  for (let i = pool.length - 1; i >= 0; i--) {
    if (pool[i].weight > 0) {
      return i;
    }
  }
  return -1;
}

// -----------------------------------------------------------------------------
// Weighted slot variants + slot-fill + RLA/RLNA move tokens (all seed-derived,
// NO Math.random — the run seed governs every choice so a save reload and a
// future co-op adoption land identically). Salts (load-bearing, keep stable):
//   variant pick : `${seed}:custom-trainer-slot:${key}:${slotIndex}`
//   slot fill    : `${seed}:custom-trainer-slotfill:${key}:${slotIndex}`
//   move token   : `${seed}:custom-trainer-move:${key}:${slotIndex}:${moveIndex}`
// -----------------------------------------------------------------------------

/**
 * Pick ONE variant index from a weighted slot, with probability weight/totalWeight,
 * seeded by `${seed}:custom-trainer-slot:${key}:${slotIndex}`. Pure + deterministic;
 * a single-variant slot always returns 0. Weights are clamped to >= 1.
 */
export function pickErCustomTrainerVariant(
  seed: string,
  key: string,
  slotIndex: number,
  variants: readonly { weight: number }[],
): number {
  if (variants.length <= 1) {
    return 0;
  }
  let total = 0;
  for (const v of variants) {
    total += Math.max(1, Math.floor(v.weight));
  }
  const r = hashSeed(`${seed}:custom-trainer-slot:${key}:${slotIndex}`) % total;
  let acc = 0;
  for (let i = 0; i < variants.length; i++) {
    acc += Math.max(1, Math.floor(variants[i].weight));
    if (r < acc) {
      return i;
    }
  }
  return variants.length - 1;
}

/**
 * Seeded slot-fill roll: whether slot `slotIndex` (0-based) is fielded this run.
 * Slot 0 (the lead) is ALWAYS filled. Otherwise the slot fills when
 * `hashSeed(...slotfill...) % 100 < slotChance` (100 => always). Pure.
 */
export function rollErCustomTrainerSlotFill(
  seed: string,
  key: string,
  slotIndex: number,
  slotChance: number,
): boolean {
  if (slotIndex === 0) {
    return true;
  }
  const chance = normalizeSlotChance(slotChance);
  return hashSeed(`${seed}:custom-trainer-slotfill:${key}:${slotIndex}`) % 100 < chance;
}

/**
 * Resolve the FIELDED party for a run: per authored slot roll slot-fill (slot 0
 * always fills), and for a filled slot pick one weighted variant. Returns the
 * fielded members tagged with their authored slot index (the salt anchor for
 * move-token resolution). Deterministic from `seed`; NO Math.random.
 */
export function resolveErCustomTrainerParty(
  seed: string,
  trainer: ErCustomTrainerResolved,
): ErCustomTrainerFieldedMember[] {
  const out: ErCustomTrainerFieldedMember[] = [];
  trainer.slots.forEach((slot, slotIndex) => {
    if (!rollErCustomTrainerSlotFill(seed, trainer.key, slotIndex, slot.slotChance)) {
      return;
    }
    const vi = pickErCustomTrainerVariant(seed, trainer.key, slotIndex, slot.variants);
    out.push({ member: slot.variants[vi].member, slotIndex });
  });
  return out;
}

// Legal-move pool cache: `${speciesId}:${wantStatus ? 1 : 0}` -> sorted move ids.
// The pools are static game data (level-up ∪ TM ∪ egg), so a run-level clear is
// unnecessary; the cache just amortizes the union across a fielded party.
const LEGAL_MOVE_POOL_CACHE = new Map<string, readonly number[]>();

/**
 * The legal-move pool for a species, split by category. Pool = the species'
 * level-up learnset ∪ TM/tutor-learnable ∪ egg moves, computed from the GAME's own
 * balance tables (NOT editor JSON), then filtered to attacking (category !== STATUS)
 * or non-attacking (category === STATUS). Returned SORTED by move id for a stable,
 * deterministic walk order. Empty when the species has no data for that category.
 */
function legalMovePool(speciesId: number, wantStatus: boolean): readonly number[] {
  const cacheKey = `${speciesId}:${wantStatus ? 1 : 0}`;
  const cached = LEGAL_MOVE_POOL_CACHE.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const species = getPokemonSpecies(speciesId);
  if (!species) {
    LEGAL_MOVE_POOL_CACHE.set(cacheKey, []);
    return [];
  }
  const root = species.getRootSpeciesId();
  const pool = collectShowdownFreeMoves(root, speciesId); // level-up ∪ TM/tutor (pre-evo inheritance)
  const eggs = speciesEggMoves[root];
  if (eggs) {
    for (const moveId of eggs) {
      pool.add(moveId);
    }
  }
  const out: number[] = [];
  for (const id of pool) {
    const move = allMoves[id];
    if (!move) {
      continue;
    }
    if ((move.category === MoveCategory.STATUS) === wantStatus) {
      out.push(id);
    }
  }
  out.sort((a, b) => a - b);
  LEGAL_MOVE_POOL_CACHE.set(cacheKey, out);
  return out;
}

/**
 * Seeded pick of a legal move for one RLA/RLNA token slot: start at
 * `hashSeed(...move...) % pool.length` and walk FORWARD deterministically until a
 * move not already in `used` is found (no duplicates within the moveset). Returns
 * `undefined` when the pool is empty OR every pool move is already used — the
 * caller then leaves the slot empty (matches the unknown-move drop behavior).
 */
function pickTokenMove(
  seed: string,
  key: string,
  slotIndex: number,
  moveIndex: number,
  pool: readonly number[],
  used: ReadonlySet<number>,
): number | undefined {
  if (pool.length === 0) {
    return undefined;
  }
  const start = hashSeed(`${seed}:custom-trainer-move:${key}:${slotIndex}:${moveIndex}`) % pool.length;
  for (let step = 0; step < pool.length; step++) {
    const cand = pool[(start + step) % pool.length];
    if (!used.has(cand)) {
      return cand;
    }
  }
  return undefined;
}

/**
 * Resolve one fielded member's move slots to concrete move ids: concrete specs
 * pass through; an `RLA` token resolves to a seeded random legal ATTACKING move
 * (category !== STATUS) and `RLNA` to a legal NON-ATTACKING move (category ===
 * STATUS). No duplicates within the moveset (a colliding roll walks the pool
 * forward). An empty legal pool leaves the slot out entirely (never crashes).
 * Deterministic from `seed`; NO Math.random.
 */
export function resolveErCustomTrainerMoveIds(
  seed: string,
  key: string,
  slotIndex: number,
  member: ErCustomTrainerMemberResolved,
): number[] {
  const chosen: number[] = [];
  const used = new Set<number>();
  member.moveSpecs.forEach((spec, moveIndex) => {
    if (spec.kind === "id") {
      chosen.push(spec.id);
      used.add(spec.id);
      return;
    }
    const pool = legalMovePool(member.speciesId, spec.token === "RLNA");
    const picked = pickTokenMove(seed, key, slotIndex, moveIndex, pool, used);
    if (picked !== undefined) {
      chosen.push(picked);
      used.add(picked);
    }
  });
  return chosen;
}

function challengeActive(challenge: ErCustomTrainerChallenge): boolean {
  if (challenge === "none") {
    return true;
  }
  return globalScene.gameMode.hasChallenge(CHALLENGE_MAP[challenge]) === true;
}

/**
 * Whether a trainer passes the per-wave GATES at `waveIndex`: not already fielded
 * this run, the active difficulty allows it, `waveIndex` is inside its floor range
 * (or endless: any floor >= minWave) and its challenge-exclusivity holds. The
 * shared gate for both the density selector and the dev force path.
 */
function isErCustomTrainerEligible(
  trainer: ErCustomTrainerResolved,
  waveIndex: number,
  difficulty: string,
): boolean {
  if (USED_CUSTOM_TRAINER_KEYS.has(trainer.key)) {
    return false;
  }
  if (!trainer.difficulties.includes(difficulty)) {
    return false;
  }
  if (waveIndex < trainer.minWave || (!trainer.endless && waveIndex > trainer.maxWave)) {
    return false;
  }
  return challengeActive(trainer.challenge);
}

// --- DEV-ONLY force path (staff testing) -------------------------------------
// Gated by the SAME `isDevToolsEnabled()` seam the dev-tools registry uses (local
// `start:dev` or a `VITE_DEV_TOOLS=1` staging build) so it is INERT in production
// — the read is short-circuited before any localStorage access, matching
// registry.ts. A staff tester forces a NAMED custom trainer to spawn at its first
// gate-eligible wave, bypassing the density roll, via the localStorage key below
// (or `setErCustomTrainerDevForce` from a dev scenario). While a force is armed
// the density path is suppressed, so the tester reliably gets exactly that trainer.

/** localStorage key a staff tester sets to the trainer KEY to force-spawn (dev only). */
export const ER_DEV_FORCE_CUSTOM_TRAINER_KEY = "er-dev-force-custom-trainer";

let devForcedCustomTrainerKeyOverride: string | null = null;

/**
 * DEV-ONLY: arm/clear a forced custom-trainer spawn by trainer key (staff testing).
 * Inert unless dev tools are enabled (checked at read time). Passing null clears it.
 */
export function setErCustomTrainerDevForce(key: string | null): void {
  devForcedCustomTrainerKeyOverride = key && key.trim() ? key.trim().toUpperCase() : null;
}

/** The armed dev-force trainer key (module override first, then localStorage), or null in prod. */
function readDevForcedCustomTrainerKey(): string | null {
  if (!isDevToolsEnabled()) {
    return null;
  }
  if (devForcedCustomTrainerKeyOverride) {
    return devForcedCustomTrainerKeyOverride;
  }
  try {
    const ls = (globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage;
    const raw = ls?.getItem(ER_DEV_FORCE_CUSTOM_TRAINER_KEY) ?? null;
    return raw && raw.trim() ? raw.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Pick the custom trainer to field at `waveIndex`, under the GLOBAL spawn-density
 * model: the run is diced into fixed windows; each window rolls ONCE whether ANY
 * custom trainer appears at all (independent of trainer count), and if it fires,
 * ONE wave inside the window anchors the appearance (sliding forward past excluded
 * boss/fixed/mystery waves) and ONE trainer is picked by `weight` among the
 * gate-eligible not-yet-used pool. At most one custom trainer per window; the
 * window is consumed on selection so a later wave in the same window fields none.
 * Returns `null` when nothing is due. Everything derives from the run seed (NO
 * Math.random). A DEV force override (staff testing) bypasses density entirely.
 */
export function selectErCustomTrainerForWave(waveIndex: number): ErCustomTrainerResolved | null {
  const all = getErCustomTrainers();
  if (all.length === 0) {
    return null;
  }
  const difficulty = getErDifficulty();
  const seed = globalScene.seed ?? "";

  // DEV-ONLY: a forced named trainer spawns at its first eligible wave, bypassing
  // density. While armed (and the trainer exists), density selection is suppressed.
  const forcedKey = readDevForcedCustomTrainerKey();
  if (forcedKey) {
    const forced = all.find(t => t.key === forcedKey);
    if (forced) {
      return isErCustomTrainerEligible(forced, waveIndex, difficulty) ? forced : null;
    }
    // Unknown key (typo) => fall through to normal density selection.
  }

  const config = getErCustomTrainerSpawnConfig();
  const windowIndex = erCustomTrainerWindowIndex(waveIndex, config.windowSize);
  // At most one custom trainer per window.
  if (USED_CUSTOM_TRAINER_WINDOWS.has(windowIndex)) {
    return null;
  }
  // Global-density roll: does this window field a custom trainer at all?
  if (!rollErCustomTrainerWindow(seed, windowIndex, config)) {
    return null;
  }
  // The anchor wave inside the window; DUE from that wave on (slide forward past
  // excluded waves, on which the selector is simply never called).
  const anchorWave = erCustomTrainerWindowWave(seed, windowIndex, config.windowSize);
  if (waveIndex < anchorWave) {
    return null;
  }
  const pool = all.filter(t => isErCustomTrainerEligible(t, waveIndex, difficulty));
  if (pool.length === 0) {
    return null;
  }
  const idx = pickErCustomTrainerByWeight(
    seed,
    windowIndex,
    pool.map(t => ({ weight: t.weight })),
  );
  if (idx < 0) {
    return null;
  }
  // Consume the window so a later wave in it fields nothing (one per window).
  markErCustomTrainerWindowUsed(windowIndex);
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
  moveIds: readonly number[] = member.moveIds,
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
  // Shiny Lab visual effect the mon fields with. Mirrors the ghost-adoption path
  // (er-ghost-teams.ts): force shiny + variant 0 (the palette rebase base), suppress
  // the local per-run roll, and stamp the serialized look + name-prefix so the
  // fielded enemy renders EXACTLY the authored effect. `null` => renders normally.
  if (member.shinyLook) {
    enemy.shiny = true;
    enemy.variant = 0;
    enemy.customPokemonData.erShinyLabSuppressLocal = true;
    enemy.customPokemonData.erShinyLab = member.shinyLook;
    enemy.customPokemonData.erShinyLabName = member.shinyName || undefined;
  }
  if (member.fusion) {
    applyCustomFusion(enemy, member.fusion);
  }
  if (moveIds.length > 0) {
    const moves = moveIds.map(id => new PokemonMove(id));
    enemy.moveset = moves;
    enemy.summonData.moveset = moves.slice();
  }
  enemy.calculateStats();
  enemy.generateName();
  return enemy;
}

/**
 * Apply a resolved custom trainer's VICTORY / DEFEAT lines and TRAINER-SPRITE
 * effect onto a freshly-built `Trainer` INSTANCE, reusing the ghost seams EXACTLY:
 *
 *   - victory line -> `trainer.getVictoryMessages` override (player beats the
 *     trainer). Same instance-level getter override `markTrainerAsGhost` sets for a
 *     ghost's `defeated` line (er-ghost-teams.ts).
 *   - defeat line  -> `trainer.getDefeatMessages` override (the trainer beats the
 *     player). Same seam as a ghost's `defeatPlayer`/`afterWin` lines.
 *   - trainer effect -> `trainer.erGhostAura` (an aura id), rendered lazily by the
 *     existing `applyErGhostAuraFx` overlay once the trainer is revealed
 *     (encounter-phase). Same seam a ghost's equipped aura rides on.
 *
 * Instance-level only: a fresh `Trainer` is built every wave, so nothing is mutated
 * on the shared `trainerConfigs` singleton and nothing leaks to the next wave (same
 * discipline as the battleBgm getter shadowing). Empty fields are no-ops (the
 * trainer keeps its default class lines / plain sprite). The INTRO line is applied
 * separately at the call site because it is gated by the "Skip custom trainer
 * intros" setting; victory/defeat/effect are not gated.
 */
export function applyErCustomTrainerPresentation(trainer: Trainer, resolved: ErCustomTrainerResolved): void {
  if (resolved.victoryDialogue) {
    const line = resolved.victoryDialogue;
    trainer.getVictoryMessages = () => [line];
  }
  if (resolved.defeatDialogue) {
    const line = resolved.defeatDialogue;
    trainer.getDefeatMessages = () => [line];
  }
  if (resolved.trainerEffect) {
    trainer.erGhostAura = resolved.trainerEffect;
  }
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
