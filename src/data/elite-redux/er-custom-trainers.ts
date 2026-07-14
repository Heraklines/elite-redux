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
//     "spawnChance": 100,              // integer 1-100; absent => 100. ONE per-run
//                                      // roll decides IF the trainer appears this
//                                      // run; if it does, it spawns EXACTLY ONCE at
//                                      // a random floor in its window (100 =
//                                      // guaranteed once per run). See
//                                      // `rollErCustomTrainerAppearance`.
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
// Every per-run choice (spawn, wave, weighted-variant pick, slot-fill, RLA/RLNA
// move) derives ONLY from the run seed (NO Math.random), so a save reload — and a
// future co-op adoption — reproduce identically. Salts are documented at each
// helper (custom-trainer-slot / custom-trainer-slotfill / custom-trainer-move).
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
import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { collectShowdownFreeMoves } from "#data/elite-redux/showdown/showdown-legal-moves";
import { Challenges } from "#enums/challenges";
import { Gender } from "#data/gender";
import { MoveCategory } from "#enums/move-category";
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

/**
 * Wave span an endless trainer's single per-run appearance is picked from:
 * minWave .. minWave + (window - 1). Endless trainers have no maxWave, so the
 * assigned wave is drawn uniformly across this many floors starting at minWave.
 */
export const ER_CUSTOM_TRAINER_ENDLESS_WINDOW = 200;

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
  /** Per-run appearance chance, integer 1-100. Absent/invalid => 100 (guaranteed). */
  spawnChance?: number;
  challenge?: ErCustomTrainerChallenge;
  /**
   * er-assets `audio/bgm/<key>.mp3` key (filename without `.mp3`) that plays for
   * THIS battle only. Trimmed; empty/absent/invalid => the trainer's default
   * theme. Charset `[a-z0-9_]+` (mirrors the editor + worker validator).
   */
  battleBgm?: string;
  team?: readonly ErCustomTrainerTeamEntry[];
}

export type ErCustomTrainers = Record<string, ErCustomTrainer>;

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
  /** Per-run appearance chance, normalized to an integer 1-100 (100 = guaranteed). */
  spawnChance: number;
  challenge: ErCustomTrainerChallenge;
  /** er-assets bgm key to play for this battle only, or "" for the default theme. */
  battleBgm: string;
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

/** Test hook: replace (or with `undefined` restore) the active custom-trainer table. */
export function setErCustomTrainersForTesting(trainers?: ErCustomTrainers): void {
  activeTrainers = trainers ?? (customTrainersJson as ErCustomTrainers);
  resolvedCache = null;
  CUSTOM_TRAINER_RUN_ROLLS.clear();
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
  return {
    speciesId: m.species,
    formIndex: Number.isInteger(m.formIndex) ? (m.formIndex as number) : 0,
    level: typeof m.level === "number" && m.level >= 1 ? Math.floor(m.level) : null,
    moveIds: ids,
    moveSpecs: specs,
    abilitySlot: clampSlot(m.abilitySlot),
    fusion,
    heldItemKeys,
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
    spawnChance: normalizeSpawnChance(entry.spawnChance),
    challenge,
    battleBgm: normalizeBattleBgm(entry.battleBgm),
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
// Per-run appearance model (once-per-run, seed-deterministic). This REPLACES the
// old "convert every eligible wave and rotate" behavior: for each trainer we do
// ONE per-run roll (spawnChance %) to decide IF it appears at all this run, and,
// if it does, ONE per-run pick of the wave it is assigned to inside its window.
// The trainer then fires EXACTLY ONCE, at the first non-excluded wave >= its
// assigned wave (so a boss/fixed/mystery wave slides it forward naturally), and
// is marked used so it never returns again that run. Both the used set and the
// roll cache are run-scoped (cleared at run start via resetErCustomTrainerTracking);
// persistence across save/reload is a documented seam (see game-data.ts
// erUsedTrainerKeys). Everything derives from the run seed so a save reload — and
// a future co-op adoption — lands identically (NO Math.random).
// -----------------------------------------------------------------------------
const USED_CUSTOM_TRAINER_KEYS = new Set<string>();

/** The per-run appearance decision for one custom trainer. */
export interface ErCustomTrainerRunRoll {
  /** Whether this trainer appears at all this run (the once-per-run chance roll). */
  appears: boolean;
  /** The wave the appearance is assigned to (fires at the first non-excluded wave >= this). */
  assignedWave: number;
}

/** Per-run cache of the appearance roll, keyed by trainer key (seed-derived, lazy). */
const CUSTOM_TRAINER_RUN_ROLLS = new Map<string, ErCustomTrainerRunRoll>();

/** Reset per-run custom-trainer state (used set + appearance rolls); call at run start. */
export function resetErCustomTrainerTracking(): void {
  USED_CUSTOM_TRAINER_KEYS.clear();
  CUSTOM_TRAINER_RUN_ROLLS.clear();
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

/**
 * Deterministic per-run appearance decision for one custom trainer, derived
 * ONLY from the run seed + trainer key (reproducible from the seed; co-op-safe;
 * NO Math.random). Returns whether the trainer appears this run (the chance
 * roll) and, if so, the wave it is assigned to inside its eligible window. Pure
 * — exported for direct unit testing without fragile seed hunting.
 *
 * Formula (salts are load-bearing — keep them stable):
 *   appears      = hashSeed(`${seed}:custom-trainer-roll:${key}`) % 100 < spawnChance
 *   assignedWave = minWave + hashSeed(`${seed}:custom-trainer-wave:${key}`) % window
 *   window       = endless ? ER_CUSTOM_TRAINER_ENDLESS_WINDOW : (maxWave - minWave + 1)
 *
 * At spawnChance = 100 the roll is `x % 100 < 100`, always true, so the trainer
 * is guaranteed to appear exactly once per run at a random floor in its window.
 */
export function rollErCustomTrainerAppearance(
  seed: string,
  trainer: { key: string; minWave: number; maxWave: number; endless: boolean; spawnChance?: number },
): ErCustomTrainerRunRoll {
  const chance = normalizeSpawnChance(trainer.spawnChance);
  const appears = hashSeed(`${seed}:custom-trainer-roll:${trainer.key}`) % 100 < chance;
  const window = trainer.endless
    ? ER_CUSTOM_TRAINER_ENDLESS_WINDOW
    : Math.max(1, trainer.maxWave - trainer.minWave + 1);
  const assignedWave = trainer.minWave + (hashSeed(`${seed}:custom-trainer-wave:${trainer.key}`) % window);
  return { appears, assignedWave };
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

/** The per-run appearance roll for `trainer`, computed once from the run seed and cached. */
function getRunRoll(trainer: ErCustomTrainerResolved): ErCustomTrainerRunRoll {
  const cached = CUSTOM_TRAINER_RUN_ROLLS.get(trainer.key);
  if (cached !== undefined) {
    return cached;
  }
  const roll = rollErCustomTrainerAppearance(globalScene.seed ?? "", trainer);
  CUSTOM_TRAINER_RUN_ROLLS.set(trainer.key, roll);
  return roll;
}

function challengeActive(challenge: ErCustomTrainerChallenge): boolean {
  if (challenge === "none") {
    return true;
  }
  return globalScene.gameMode.hasChallenge(CHALLENGE_MAP[challenge]) === true;
}

/**
 * Pick a custom trainer that is DUE at `waveIndex`, gated by the active
 * difficulty, the floor range (or endless: any floor >= minWave) and
 * challenge-exclusivity. A trainer is due when its per-run appearance roll came
 * up (spawnChance), it has NOT been fielded yet this run, and `waveIndex` has
 * reached (or passed, via a slide-forward off an excluded wave) its assigned
 * wave — while still inside its window (waveIndex <= maxWave when not endless).
 * If several are due on the same wave, one is chosen by a deterministic
 * wave-seeded pick and the rest stay due for later waves. Returns `null` when
 * none is due. Fires each trainer EXACTLY once per run (the caller marks it used).
 */
export function selectErCustomTrainerForWave(waveIndex: number): ErCustomTrainerResolved | null {
  const all = getErCustomTrainers();
  if (all.length === 0) {
    return null;
  }
  const difficulty = getErDifficulty();
  const due = all.filter(t => {
    if (USED_CUSTOM_TRAINER_KEYS.has(t.key)) {
      return false;
    }
    if (!t.difficulties.includes(difficulty)) {
      return false;
    }
    if (waveIndex < t.minWave || (!t.endless && waveIndex > t.maxWave)) {
      return false;
    }
    if (!challengeActive(t.challenge)) {
      return false;
    }
    const roll = getRunRoll(t);
    return roll.appears && waveIndex >= roll.assignedWave;
  });
  if (due.length === 0) {
    return null;
  }
  const seed = `${globalScene.seed ?? ""}:custom-trainer:${waveIndex}`;
  const idx = hashSeed(seed) % due.length;
  return due[idx];
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
