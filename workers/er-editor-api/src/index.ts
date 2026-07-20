/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — team data editor backend (Cloudflare Worker).
//
// The static editor SPA reads game data straight from the public GitHub raw
// URLs; only WRITES go through this Worker, which holds a single GitHub token
// (secret) and commits the edited JSON to the configured branch via the GitHub
// Contents API. Access is gated by a shared editor password.
//
// Editable files are an explicit WHITELIST (EDITABLE_FILES) — the Worker never
// writes any other repo path. Every save is a DELTA the Worker merges into the
// live file (concurrent editors don't clobber each other's untouched keys).
//
// Endpoints:
//   GET  /health        — liveness
//   POST /save          — { password, file, delta, author?, deploy? }
//                          `file` is a whitelist key (egg-moves, species-tuning,
//                          item-tuning, trainer-tuning, custom-trainers,
//                          custom-trainers-config, …); `delta` is deep-merged
//                          into the live JSON (null deletes a key; arrays
//                          replace wholesale), then committed. If deploy, also
//                          triggers the staging rebuild+deploy workflow.
//   POST /egg-moves     — back-compat alias: { password, eggMoves, author?,
//                          deploy? } → same as /save with file=egg-moves.
//   POST /deploy        — { password } → triggers the staging deploy workflow
//                          only (redeploy current branch without an edit).
//
// Secrets/vars (wrangler):
//   GITHUB_TOKEN (secret) — fine-grained PAT with Contents:read+write AND
//                           Actions:read+write (workflow dispatch) on the repo
//   GITHUB_REPO           — "Heraklines/elite-redux"
//   GITHUB_BRANCH         — e.g. "feat/elite-redux-port"
//   GITHUB_WORKFLOW_FILE  — deploy workflow filename (default "deploy-staging.yml")
//   EDITOR_PASSWORD (secret) — shared team password
//   ALLOWED_ORIGIN        — the editor's origin (or "*")
// =============================================================================

import {
  type CustomTrainerConflict,
  commitCustomTrainersWithRetry,
  mergeCustomTrainersDelta,
  stableStringify,
} from "./custom-trainers-merge";

interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_WORKFLOW_FILE?: string;
  /** Workflow that imports YouTube links or uploaded media into the BGM catalog. */
  MEDIA_IMPORT_WORKFLOW_FILE?: string;
  /** Optional branch used only by media workflow dispatches. */
  MEDIA_IMPORT_BRANCH?: string;
  /** Private temporary storage for direct audio/video uploads. */
  MEDIA_UPLOADS?: R2BucketLike;
  EDITOR_PASSWORD: string;
  ALLOWED_ORIGIN: string;
  /** Sprite asset repo for /upload-assets (default "Heraklines/er-assets").
   * The GITHUB_TOKEN PAT must ALSO have Contents read+write on this repo. */
  ASSETS_REPO?: string;
  /** Branch of ASSETS_REPO to commit sprites to (default "main"). */
  ASSETS_BRANCH?: string;
}

interface R2UploadedPartLike {
  partNumber: number;
  etag: string;
}

interface R2MultipartUploadLike {
  uploadId: string;
  uploadPart(partNumber: number, value: ReadableStream): Promise<R2UploadedPartLike>;
  complete(parts: R2UploadedPartLike[]): Promise<unknown>;
  abort(): Promise<void>;
}

interface R2ObjectLike {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

interface R2BucketLike {
  createMultipartUpload(
    key: string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<R2MultipartUploadLike>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUploadLike;
  get(key: string): Promise<R2ObjectLike | null>;
  head(key: string): Promise<Omit<R2ObjectLike, "body"> | null>;
  delete(key: string): Promise<void>;
}

const DEFAULT_WORKFLOW_FILE = "deploy-staging.yml";

type ValidationResult = { ok: true } | { ok: false; error: string };

interface EditableFile {
  /** Repo path the delta is merged into (the ONLY paths this Worker writes). */
  path: string;
  /** Human label for commit messages. */
  label: string;
  /** Validates a posted delta BEFORE it is merged. */
  validate: (delta: unknown) => ValidationResult;
}

const SPECIES_CONST_RE = /^SPECIES_[A-Z0-9_]+$/;
const ITEM_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const TIER_NAMES = new Set(["COMMON", "GREAT", "ULTRA", "ROGUE", "MASTER"]);
const DIFFICULTIES = new Set(["youngster", "ace", "elite", "hell"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** speciesConst → 1..4 move-name strings (the original egg-move semantics). */
function validateEggMovesDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [key, moves] of Object.entries(delta)) {
    if (!SPECIES_CONST_RE.test(key)) {
      return { ok: false, error: `bad species key: ${key}` };
    }
    if (!Array.isArray(moves) || moves.length === 0 || moves.length > 4) {
      return { ok: false, error: `${key}: must have 1-4 moves` };
    }
    for (const mv of moves) {
      if (typeof mv !== "string" || !/^[A-Z0-9_]+$/.test(mv)) {
        return { ok: false, error: `${key}: bad move name "${String(mv)}"` };
      }
    }
  }
  return { ok: true };
}

/** speciesConst → { eggTier?: 0..3, cost?: 1..50 } (null deletes). */
function validateSpeciesTuningDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [key, entry] of Object.entries(delta)) {
    if (!SPECIES_CONST_RE.test(key)) {
      return { ok: false, error: `bad species key: ${key}` };
    }
    if (entry === null) {
      continue; // delete the whole override
    }
    if (!isPlainObject(entry)) {
      return { ok: false, error: `${key}: must be an object or null` };
    }
    for (const [field, value] of Object.entries(entry)) {
      if (field === "eggTier") {
        if (value !== null && !(Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 3)) {
          return { ok: false, error: `${key}.eggTier: must be 0-3 or null` };
        }
      } else if (field === "cost") {
        if (value !== null && !(isFiniteNumber(value) && value >= 1 && value <= 50)) {
          return { ok: false, error: `${key}.cost: must be 1-50 or null` };
        }
      } else {
        return { ok: false, error: `${key}: unknown field "${field}"` };
      }
    }
  }
  return { ok: true };
}

/** itemKey → { tier?, weight?, maxWeight?, maxStack? } (null deletes). */
function validateItemTuningDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [key, entry] of Object.entries(delta)) {
    if (!ITEM_KEY_RE.test(key)) {
      return { ok: false, error: `bad item key: ${key}` };
    }
    if (entry === null) {
      continue;
    }
    if (!isPlainObject(entry)) {
      return { ok: false, error: `${key}: must be an object or null` };
    }
    for (const [field, value] of Object.entries(entry)) {
      if (field === "tier") {
        if (value !== null && !(typeof value === "string" && TIER_NAMES.has(value))) {
          return { ok: false, error: `${key}.tier: must be one of ${[...TIER_NAMES].join("/")} or null` };
        }
      } else if (field === "weight" || field === "maxWeight") {
        if (value !== null && !(isFiniteNumber(value) && value >= 0 && value <= 1000)) {
          return { ok: false, error: `${key}.${field}: must be 0-1000 or null` };
        }
      } else if (field === "maxStack") {
        if (value !== null && !(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 99)) {
          return { ok: false, error: `${key}.maxStack: must be 1-99 or null` };
        }
      } else {
        return { ok: false, error: `${key}: unknown field "${field}"` };
      }
    }
  }
  return { ok: true };
}

/** { frequency?: { <difficulty>: { trainerCadence?, factoryTeamPct? } }, sets?: { factoryExcludeSpecies?: [] } } */
function validateTrainerTuningDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [section, value] of Object.entries(delta)) {
    if (section === "frequency") {
      if (value === null) {
        continue;
      }
      if (!isPlainObject(value)) {
        return { ok: false, error: "frequency: must be an object or null" };
      }
      for (const [difficulty, knobs] of Object.entries(value)) {
        if (!DIFFICULTIES.has(difficulty)) {
          return { ok: false, error: `frequency: unknown difficulty "${difficulty}"` };
        }
        if (knobs === null) {
          continue;
        }
        if (!isPlainObject(knobs)) {
          return { ok: false, error: `frequency.${difficulty}: must be an object or null` };
        }
        for (const [field, knobValue] of Object.entries(knobs)) {
          if (field === "trainerCadence") {
            if (
              knobValue !== null
              && !(Number.isInteger(knobValue) && (knobValue as number) >= 1 && (knobValue as number) <= 50)
            ) {
              return { ok: false, error: `frequency.${difficulty}.trainerCadence: must be 1-50 or null` };
            }
          } else if (field === "factoryTeamPct") {
            if (knobValue !== null && !(isFiniteNumber(knobValue) && knobValue >= 0 && knobValue <= 100)) {
              return { ok: false, error: `frequency.${difficulty}.factoryTeamPct: must be 0-100 or null` };
            }
          } else {
            return { ok: false, error: `frequency.${difficulty}: unknown field "${field}"` };
          }
        }
      }
    } else if (section === "sets") {
      if (value === null) {
        continue;
      }
      if (!isPlainObject(value)) {
        return { ok: false, error: "sets: must be an object or null" };
      }
      for (const [field, fieldValue] of Object.entries(value)) {
        if (field === "factoryExcludeSpecies") {
          if (fieldValue === null) {
            continue;
          }
          if (!Array.isArray(fieldValue) || fieldValue.some(s => typeof s !== "string" || !SPECIES_CONST_RE.test(s))) {
            return { ok: false, error: "sets.factoryExcludeSpecies: must be a list of SPECIES_* consts or null" };
          }
        } else if (field === "factorySetOverrides") {
          if (fieldValue === null) {
            continue;
          }
          if (!isPlainObject(fieldValue)) {
            return { ok: false, error: "sets.factorySetOverrides: must be an object or null" };
          }
          for (const [speciesKey, sets] of Object.entries(fieldValue)) {
            if (!SPECIES_CONST_RE.test(speciesKey)) {
              return { ok: false, error: `factorySetOverrides: bad species key ${speciesKey}` };
            }
            if (sets === null) {
              continue; // back to the shipped sets
            }
            if (!Array.isArray(sets) || sets.length > 10) {
              return { ok: false, error: `${speciesKey}: must be a list of up to 10 sets or null` };
            }
            for (const set of sets) {
              if (!isPlainObject(set)) {
                return { ok: false, error: `${speciesKey}: each set must be an object` };
              }
              const moves = (set as { moves?: unknown }).moves;
              const abilitySlot = (set as { abilitySlot?: unknown }).abilitySlot;
              if (
                !Array.isArray(moves)
                || moves.length === 0
                || moves.length > 4
                || moves.some(m => typeof m !== "string" || !/^[A-Z0-9_]+$/.test(m))
              ) {
                return { ok: false, error: `${speciesKey}: each set needs 1-4 move names` };
              }
              if (abilitySlot !== 0 && abilitySlot !== 1 && abilitySlot !== 2) {
                return { ok: false, error: `${speciesKey}: abilitySlot must be 0, 1 or 2` };
              }
              const extras = Object.keys(set).filter(k => k !== "moves" && k !== "abilitySlot");
              if (extras.length > 0) {
                return { ok: false, error: `${speciesKey}: unknown set field "${extras[0]}"` };
              }
            }
          }
        } else {
          return { ok: false, error: `sets: unknown field "${field}"` };
        }
      }
    } else {
      return { ok: false, error: `unknown section "${section}"` };
    }
  }
  return { ok: true };
}

/**
 * Balance-tuning delta: dotted knob key → number | number[] | [number,number][]
 * | { name: number } | null. Shape-only validation — the GAME's loader
 * (er-balance-tuning.ts) revalidates every value against the knob registry and
 * falls back to the default for anything out of range, so a bad value can
 * never break a build.
 */
function validateBalanceTuningDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  const okNumber = (v: unknown): boolean => isFiniteNumber(v) && Math.abs(v) <= 1e9;
  for (const [key, value] of Object.entries(delta)) {
    if (!/^[a-z][a-zA-Z0-9.]{0,80}$/.test(key)) {
      return { ok: false, error: `bad knob key: ${key}` };
    }
    if (value === null || okNumber(value)) {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 64) {
        return { ok: false, error: `${key}: list too long` };
      }
      const allNumbers = value.every(okNumber);
      const allPairs = value.every(p => Array.isArray(p) && p.length === 2 && p.every(okNumber));
      if (!allNumbers && !allPairs) {
        return { ok: false, error: `${key}: must be a list of numbers or [a, b] pairs` };
      }
      continue;
    }
    if (isPlainObject(value)) {
      const entries = Object.entries(value);
      if (entries.length > 64) {
        return { ok: false, error: `${key}: too many map keys` };
      }
      for (const [mapKey, mapValue] of entries) {
        if (!/^[A-Za-z0-9_]{1,40}$/.test(mapKey)) {
          return { ok: false, error: `${key}: bad map key "${mapKey}"` };
        }
        if (mapValue !== null && !okNumber(mapValue)) {
          return { ok: false, error: `${key}.${mapKey}: must be a number or null` };
        }
      }
      continue;
    }
    return { ok: false, error: `${key}: unsupported value type` };
  }
  return { ok: true };
}

/** A valid in-game move/ability id (positive int; ER ids range into the 5000s). */
function okId(v: unknown): boolean {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 99999;
}

/** speciesConst → [[level 1-100, moveId], ...] (replaces the level-up learnset; null deletes). */
function validateLearnsetsDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [key, value] of Object.entries(delta)) {
    if (!SPECIES_CONST_RE.test(key)) {
      return { ok: false, error: `bad species key: ${key}` };
    }
    if (value === null) {
      continue; // revert to the shipped learnset
    }
    if (!Array.isArray(value) || value.length > 120) {
      return { ok: false, error: `${key}: must be a list of up to 120 [level, moveId] pairs or null` };
    }
    for (const pair of value) {
      if (
        !Array.isArray(pair)
        || pair.length !== 2
        || !(Number.isInteger(pair[0]) && (pair[0] as number) >= 1 && (pair[0] as number) <= 100)
        || !okId(pair[1])
      ) {
        return { ok: false, error: `${key}: each entry must be [level 1-100, moveId]` };
      }
    }
  }
  return { ok: true };
}

/** speciesConst → [moveId, ...] (replaces TM compatibility; null deletes). */
function validateTmLearnsetsDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [key, value] of Object.entries(delta)) {
    if (!SPECIES_CONST_RE.test(key)) {
      return { ok: false, error: `bad species key: ${key}` };
    }
    if (value === null) {
      continue;
    }
    if (!Array.isArray(value) || value.length > 400 || !value.every(okId)) {
      return { ok: false, error: `${key}: must be a list of up to 400 move ids or null` };
    }
  }
  return { ok: true };
}

/**
 * speciesConst → { ability1, ability2, hidden, innates: [a,b,c] } (each an id, or
 * 0 for none; `innates` is the ER 3-passive triple). null deletes the override.
 */
function validateSpeciesAbilitiesDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  const okSlot = (v: unknown): boolean => v === 0 || okId(v);
  for (const [key, entry] of Object.entries(delta)) {
    if (!SPECIES_CONST_RE.test(key)) {
      return { ok: false, error: `bad species key: ${key}` };
    }
    if (entry === null) {
      continue;
    }
    if (!isPlainObject(entry)) {
      return { ok: false, error: `${key}: must be an object or null` };
    }
    for (const [field, value] of Object.entries(entry)) {
      if (field === "innates") {
        if (!Array.isArray(value) || value.length !== 3 || !value.every(okSlot)) {
          return { ok: false, error: `${key}.innates: must be 3 ability ids (0 for none)` };
        }
      } else if (field === "ability1" || field === "ability2" || field === "hidden") {
        if (!okSlot(value)) {
          return { ok: false, error: `${key}.${field}: must be an ability id or 0` };
        }
      } else {
        return { ok: false, error: `${key}: unknown field "${field}"` };
      }
    }
  }
  return { ok: true };
}

/** The ONLY repo paths this Worker will ever write. */
const EDITABLE_FILES: Record<string, EditableFile> = {
  "egg-moves": {
    path: "src/data/elite-redux/er-egg-moves.json",
    label: "egg moves",
    validate: validateEggMovesDelta,
  },
  "species-tuning": {
    path: "src/data/elite-redux/er-species-tuning.json",
    label: "species tuning",
    validate: validateSpeciesTuningDelta,
  },
  "item-tuning": {
    path: "src/data/elite-redux/er-item-tuning.json",
    label: "item tuning",
    validate: validateItemTuningDelta,
  },
  "trainer-tuning": {
    path: "src/data/elite-redux/er-trainer-tuning.json",
    label: "trainer tuning",
    validate: validateTrainerTuningDelta,
  },
  "balance-tuning": {
    path: "src/data/elite-redux/er-balance-tuning.json",
    label: "balance tuning",
    validate: validateBalanceTuningDelta,
  },
  "custom-mons": {
    path: "src/data/elite-redux/er-custom-mons.json",
    label: "custom mons",
    validate: validateCustomMonsDelta,
  },
  "custom-trainers": {
    path: "src/data/elite-redux/er-custom-trainers.json",
    label: "custom trainers",
    validate: validateCustomTrainersDelta,
  },
  "custom-trainers-config": {
    path: "src/data/elite-redux/er-custom-trainers-config.json",
    label: "custom trainer spawn density",
    validate: validateCustomTrainersConfigDelta,
  },
  learnsets: {
    path: "src/data/elite-redux/er-learnsets.json",
    label: "learnsets",
    validate: validateLearnsetsDelta,
  },
  "tm-learnsets": {
    path: "src/data/elite-redux/er-tm-learnsets.json",
    label: "TM learnsets",
    validate: validateTmLearnsetsDelta,
  },
  "species-abilities": {
    path: "src/data/elite-redux/er-species-abilities.json",
    label: "species abilities",
    validate: validateSpeciesAbilitiesDelta,
  },
};

/** speciesConst → editor-created mon entry (null deletes the mon). */
function validateCustomMonsDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  const isName = (v: unknown): boolean => typeof v === "string" && /^[A-Z0-9_]{1,60}$/.test(v);
  for (const [key, mon] of Object.entries(delta)) {
    if (!SPECIES_CONST_RE.test(key)) {
      return { ok: false, error: `bad species key: ${key}` };
    }
    if (mon === null) {
      continue;
    }
    if (!isPlainObject(mon)) {
      return { ok: false, error: `${key}: must be an object or null` };
    }
    const m = mon as Record<string, unknown>;
    if (!Number.isInteger(m.id) || (m.id as number) < 60000 || (m.id as number) > 69999) {
      return { ok: false, error: `${key}: id must be 60000-69999` };
    }
    if (typeof m.name !== "string" || m.name.trim().length === 0 || m.name.length > 30) {
      return { ok: false, error: `${key}: name must be 1-30 chars` };
    }
    if (typeof m.slug !== "string" || !/^[a-z0-9-]{2,40}$/.test(m.slug)) {
      return { ok: false, error: `${key}: slug must be lowercase letters/digits/hyphens` };
    }
    if (
      !Array.isArray(m.baseStats)
      || m.baseStats.length !== 6
      || m.baseStats.some(v => !Number.isInteger(v) || (v as number) < 1 || (v as number) > 255)
    ) {
      return { ok: false, error: `${key}: baseStats must be 6 integers 1-255` };
    }
    if (!Array.isArray(m.types) || m.types.length !== 2 || !isName(m.types[0])) {
      return { ok: false, error: `${key}: types must be [PRIMARY, SECONDARY|null]` };
    }
    if (m.types[1] !== null && !isName(m.types[1])) {
      return { ok: false, error: `${key}: secondary type must be a type name or null` };
    }
    for (const field of ["abilities", "innates"]) {
      if (m[field] !== undefined) {
        const list = m[field];
        if (!Array.isArray(list) || list.length > 3 || list.some(v => typeof v !== "string" || v.length > 40)) {
          return { ok: false, error: `${key}: ${field} must be up to 3 ability names` };
        }
      }
    }
    if (
      m.catchRate !== undefined
      && !(Number.isInteger(m.catchRate) && (m.catchRate as number) >= 1 && (m.catchRate as number) <= 255)
    ) {
      return { ok: false, error: `${key}: catchRate must be 1-255` };
    }
    if (
      m.eggTier !== undefined
      && !(Number.isInteger(m.eggTier) && (m.eggTier as number) >= 0 && (m.eggTier as number) <= 3)
    ) {
      return { ok: false, error: `${key}: eggTier must be 0-3` };
    }
    if (m.cost !== undefined && !(Number.isInteger(m.cost) && (m.cost as number) >= 1 && (m.cost as number) <= 50)) {
      return { ok: false, error: `${key}: cost must be 1-50` };
    }
    if (
      m.levelUpMoves !== undefined
      && (!Array.isArray(m.levelUpMoves)
        || m.levelUpMoves.length > 40
        || m.levelUpMoves.some(
          lm =>
            !isPlainObject(lm)
            || !Number.isInteger((lm as { level?: unknown }).level)
            || ((lm as { level: number }).level as number) < 1
            || ((lm as { level: number }).level as number) > 100
            || !isName((lm as { move?: unknown }).move),
        ))
    ) {
      return { ok: false, error: `${key}: levelUpMoves must be up to 40 {level 1-100, move NAME} rows` };
    }
    if (
      m.eggMoves !== undefined
      && (!Array.isArray(m.eggMoves) || m.eggMoves.length > 4 || m.eggMoves.some(v => !isName(v)))
    ) {
      return { ok: false, error: `${key}: eggMoves must be up to 4 move names` };
    }
  }
  return { ok: true };
}

/**
 * Global custom-trainer spawn-density config (er-custom-trainers-config.json):
 * { windowSize?: 1-100, windowChancePct?: 0-100 }. Shape-only — the game's loader
 * (er-custom-trainers.ts) re-normalizes every field and falls back to the shipped
 * default for anything out of range, so a bad value can never break a build.
 */
function validateCustomTrainersConfigDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  for (const [key, value] of Object.entries(delta)) {
    if (key === "windowSize") {
      if (!(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100)) {
        return { ok: false, error: "windowSize must be an integer 1-100" };
      }
    } else if (key === "windowChancePct") {
      if (!(Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100)) {
        return { ok: false, error: "windowChancePct must be an integer 0-100" };
      }
    } else {
      return { ok: false, error: `unknown field "${key}"` };
    }
  }
  return { ok: true };
}

/** trainerKey -> editor-created custom-trainer entry (null deletes the trainer). */
function validateCustomTrainersDelta(delta: unknown): ValidationResult {
  if (!isPlainObject(delta)) {
    return { ok: false, error: "delta must be an object" };
  }
  const isName = (v: unknown): boolean => typeof v === "string" && /^[A-Z0-9_]{1,60}$/.test(v);
  const validBattleTypes = new Set(["single", "double", "triple"]);
  const validChallenges = new Set([
    "none",
    "inverse",
    "monocolor",
    "monogen",
    "doubles",
    "ghost",
    "monotype",
    "maxcost",
    "points",
    "freshstart",
    "flipstat",
    "limitedcatch",
    "limitedsupport",
    "hardcore",
    "passives",
    "usagetier",
    "triples",
  ]);
  const validDifficulties = new Set(["youngster", "ace", "elite", "hell", "mystery"]);
  // Ghost Trainer FX aura ids (TRAINER_AURA_EFFECTS in er-trainer-fx.ts) — the ONLY
  // valid `trainerEffect` values, mirroring the runtime `isKnownTrainerAuraId` whitelist.
  const validTrainerEffects = new Set([
    "smoke",
    "embers",
    "frost",
    "shadowaura",
    "goldenglow",
    "holyrays",
    "cosmos",
    "sparkstorm",
  ]);
  for (const [key, tr] of Object.entries(delta)) {
    if (!/^[A-Z0-9_]{1,40}$/.test(key)) {
      return { ok: false, error: `bad trainer key: ${key}` };
    }
    if (tr === null) {
      continue;
    }
    if (!isPlainObject(tr)) {
      return { ok: false, error: `${key}: must be an object or null` };
    }
    const t = tr as Record<string, unknown>;
    if (!Number.isInteger(t.id) || (t.id as number) < 70000 || (t.id as number) > 79999) {
      return { ok: false, error: `${key}: id must be 70000-79999` };
    }
    if (typeof t.name !== "string" || t.name.trim().length === 0 || t.name.length > 24) {
      return { ok: false, error: `${key}: name must be 1-24 chars` };
    }
    if (!isName(t.trainerClass)) {
      return { ok: false, error: `${key}: trainerClass must be a TrainerType NAME` };
    }
    if (
      t.trainerSprite !== undefined
      && !(typeof t.trainerSprite === "string" && /^[a-z0-9_]{2,64}$/.test(t.trainerSprite))
    ) {
      return { ok: false, error: `${key}: trainerSprite must be a catalog key ([a-z0-9_], 2-64 chars)` };
    }
    if (t.gender !== undefined && t.gender !== "m" && t.gender !== "f") {
      return { ok: false, error: `${key}: gender must be "m" or "f"` };
    }
    if (t.battleType !== undefined && !validBattleTypes.has(t.battleType as string)) {
      return { ok: false, error: `${key}: battleType must be single/double/triple` };
    }
    if (t.challenge !== undefined && !validChallenges.has(t.challenge as string)) {
      return { ok: false, error: `${key}: challenge must be a known challenge key (see ErCustomTrainerChallenge)` };
    }
    // Optional challenge VALUE parameter (mono-type/gen/color/...): a positive
    // integer within the widest challenge maxValue (SINGLE_TYPE = 18). The game
    // clamps per-challenge; here we only bound the raw int. The game also drops it
    // for a non-value-bearing / "none" challenge, so a stray value is harmless.
    if (
      t.challengeValue !== undefined
      && !(
        Number.isInteger(t.challengeValue)
        && (t.challengeValue as number) >= 1
        && (t.challengeValue as number) <= 18
      )
    ) {
      return { ok: false, error: `${key}: challengeValue must be an integer 1-18` };
    }
    if (
      t.difficulties !== undefined
      && (!Array.isArray(t.difficulties) || t.difficulties.some(d => !validDifficulties.has(d as string)))
    ) {
      return { ok: false, error: `${key}: difficulties must be youngster/ace/elite/hell` };
    }
    for (const field of ["minWave", "maxWave"]) {
      if (
        t[field] !== undefined
        && !(Number.isInteger(t[field]) && (t[field] as number) >= 1 && (t[field] as number) <= 5000)
      ) {
        return { ok: false, error: `${key}: ${field} must be 1-5000` };
      }
    }
    if (t.endless !== undefined && typeof t.endless !== "boolean") {
      return { ok: false, error: `${key}: endless must be a boolean` };
    }
    // `weight` is the current spawn-odds field (integer >= 1); `spawnChance`
    // (1-100) is the DEPRECATED predecessor, still accepted during the transition
    // (the game migrates it to weight on load). New saves write `weight` only.
    if (t.weight !== undefined && !(Number.isInteger(t.weight) && (t.weight as number) >= 1)) {
      return { ok: false, error: `${key}: weight must be an integer >= 1` };
    }
    if (
      t.spawnChance !== undefined
      && !(Number.isInteger(t.spawnChance) && (t.spawnChance as number) >= 1 && (t.spawnChance as number) <= 100)
    ) {
      return { ok: false, error: `${key}: spawnChance must be an integer 1-100` };
    }
    if (
      t.battleBgm !== undefined
      && !(typeof t.battleBgm === "string" && t.battleBgm.length <= 64 && /^[a-z0-9_]+$/.test(t.battleBgm))
    ) {
      return { ok: false, error: `${key}: battleBgm must be a bgm key ([a-z0-9_], up to 64 chars)` };
    }
    if (t.introDialogue !== undefined && !(typeof t.introDialogue === "string" && t.introDialogue.length <= 200)) {
      return { ok: false, error: `${key}: introDialogue must be a string up to 200 chars` };
    }
    if (
      t.victoryDialogue !== undefined
      && !(typeof t.victoryDialogue === "string" && t.victoryDialogue.length <= 200)
    ) {
      return { ok: false, error: `${key}: victoryDialogue must be a string up to 200 chars` };
    }
    if (t.defeatDialogue !== undefined && !(typeof t.defeatDialogue === "string" && t.defeatDialogue.length <= 200)) {
      return { ok: false, error: `${key}: defeatDialogue must be a string up to 200 chars` };
    }
    if (
      t.trainerEffect !== undefined
      && !(typeof t.trainerEffect === "string" && validTrainerEffects.has(t.trainerEffect))
    ) {
      return { ok: false, error: `${key}: trainerEffect must be a known aura id (see TRAINER_AURA_EFFECTS)` };
    }
    if (!Array.isArray(t.team) || t.team.length === 0 || t.team.length > 6) {
      return { ok: false, error: `${key}: team must have 1-6 members` };
    }
    // Validate ONE flat member object (also used for each weighted variant). The
    // move NAME check accepts the `RLA`/`RLNA` tokens for free (they match the
    // `[A-Z0-9_]{1,60}` name charset). `allowWeight` permits a variant's weight.
    const checkMember = (mm: Record<string, unknown>, allowWeight: boolean): ValidationResult => {
      if (!Number.isInteger(mm.species) || (mm.species as number) < 1) {
        return { ok: false, error: `${key}: member species must be a positive speciesId` };
      }
      if (
        mm.level !== undefined
        && mm.level !== null
        && !(Number.isInteger(mm.level) && (mm.level as number) >= 1 && (mm.level as number) <= 200)
      ) {
        return { ok: false, error: `${key}: member level must be 1-200 or null` };
      }
      if (mm.abilitySlot !== undefined && ![0, 1, 2].includes(mm.abilitySlot as number)) {
        return { ok: false, error: `${key}: abilitySlot must be 0/1/2` };
      }
      if (mm.insanity !== undefined && mm.insanity !== null) {
        if (!isPlainObject(mm.insanity)) {
          return { ok: false, error: `${key}: insanity must be { ability?, innates? } or null` };
        }
        const insanity = mm.insanity as Record<string, unknown>;
        if (Object.keys(insanity).some(field => field !== "ability" && field !== "innates")) {
          return { ok: false, error: `${key}: insanity has an unknown field` };
        }
        if (
          insanity.ability !== undefined
          && !(Number.isInteger(insanity.ability) && (insanity.ability as number) > 0)
        ) {
          return { ok: false, error: `${key}: insanity.ability must be a positive AbilityId` };
        }
        if (
          insanity.innates !== undefined
          && (!Array.isArray(insanity.innates)
            || insanity.innates.length > 3
            || insanity.innates.some(
              abilityId => abilityId !== null && !(Number.isInteger(abilityId) && (abilityId as number) > 0),
            ))
        ) {
          return { ok: false, error: `${key}: insanity.innates must be up to 3 positive AbilityIds or nulls` };
        }
      }
      if (
        mm.moves !== undefined
        && (!Array.isArray(mm.moves) || mm.moves.length > 4 || mm.moves.some(v => !isName(v)))
      ) {
        return { ok: false, error: `${key}: moves must be up to 4 move NAMEs (incl. RLA/RLNA tokens)` };
      }
      if (
        mm.fusion !== undefined
        && mm.fusion !== null
        && (!isPlainObject(mm.fusion) || !Number.isInteger((mm.fusion as Record<string, unknown>).species))
      ) {
        return { ok: false, error: `${key}: fusion must be { species, formIndex?, abilitySlot? } or null` };
      }
      if (
        mm.heldItems !== undefined
        && (!Array.isArray(mm.heldItems)
          || mm.heldItems.length > 6
          || mm.heldItems.some(h => !isPlainObject(h) || !isName((h as Record<string, unknown>).item)))
      ) {
        return { ok: false, error: `${key}: heldItems must be up to 6 { item NAME, count? }` };
      }
      if (mm.vitamins !== undefined) {
        if (!isPlainObject(mm.vitamins)) {
          return { ok: false, error: `${key}: vitamins must be an object` };
        }
        const vitamins = mm.vitamins as Record<string, unknown>;
        const vitaminFields = new Set(["hp", "atk", "def", "spatk", "spdef", "spd"]);
        if (Object.keys(vitamins).some(field => !vitaminFields.has(field))) {
          return { ok: false, error: `${key}: vitamins has an unknown stat` };
        }
        if (
          Object.values(vitamins).some(
            count => !Number.isInteger(count) || (count as number) < 0 || (count as number) > 31,
          )
        ) {
          return { ok: false, error: `${key}: vitamin counts must be integers from 0-31` };
        }
      }
      // `sanityOff` is EDITOR metadata (move-legality enforcement toggle): the
      // game-side parser ignores it. Accept it, but keep it a clean boolean.
      if (mm.sanityOff !== undefined && typeof mm.sanityOff !== "boolean") {
        return { ok: false, error: `${key}: sanityOff must be a boolean` };
      }
      // Shiny Lab look: optional { palette?, surface?, around?, name? }. Effect ids
      // are lowercase-alnum registry keys; name is a short prefix. The game drops
      // any unknown id at load, so we only shape-check here.
      if (mm.shiny !== undefined && mm.shiny !== null) {
        if (!isPlainObject(mm.shiny)) {
          return { ok: false, error: `${key}: shiny must be { palette?, surface?, around?, name? } or null` };
        }
        const sh = mm.shiny as Record<string, unknown>;
        for (const cat of ["palette", "surface", "around"]) {
          const v = sh[cat];
          if (v !== undefined && !(typeof v === "string" && v.length <= 40 && /^[a-z0-9]+$/.test(v))) {
            return { ok: false, error: `${key}: shiny.${cat} must be a shiny-effect id ([a-z0-9], up to 40 chars)` };
          }
        }
        if (sh.name !== undefined && !(typeof sh.name === "string" && sh.name.length <= 24)) {
          return { ok: false, error: `${key}: shiny.name must be a string up to 24 chars` };
        }
      }
      // Weighted-slot possibility weight: integer >= 1. Only valid inside a
      // `variants` slot; a bare flat member must not carry one.
      if (mm.weight !== undefined) {
        if (!allowWeight) {
          return { ok: false, error: `${key}: weight is only allowed inside a variants slot` };
        }
        if (!(Number.isInteger(mm.weight) && (mm.weight as number) >= 1)) {
          return { ok: false, error: `${key}: variant weight must be an integer >= 1` };
        }
      }
      return { ok: true };
    };
    // Slot-fill chance (slots 2-6): optional integer 1-100 (absent => 100).
    const checkSlotChance = (v: unknown): ValidationResult =>
      v === undefined || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100)
        ? { ok: true }
        : { ok: false, error: `${key}: slotChance must be an integer 1-100` };
    for (const entry of t.team) {
      if (!isPlainObject(entry)) {
        return { ok: false, error: `${key}: each team slot must be an object` };
      }
      const e = entry as Record<string, unknown>;
      if (e.variants === undefined) {
        // FLAT member (optionally carrying its own slotChance for slots 2-6).
        const sc = checkSlotChance(e.slotChance);
        if (!sc.ok) {
          return sc;
        }
        const mr = checkMember(e, false);
        if (!mr.ok) {
          return mr;
        }
      } else {
        // WEIGHTED slot: { variants: [member...], slotChance? }.
        if (!Array.isArray(e.variants) || e.variants.length === 0 || e.variants.length > 12) {
          return { ok: false, error: `${key}: variants must be an array of 1-12 possibilities` };
        }
        const sc = checkSlotChance(e.slotChance);
        if (!sc.ok) {
          return sc;
        }
        for (const variant of e.variants) {
          if (!isPlainObject(variant)) {
            return { ok: false, error: `${key}: each variant must be an object` };
          }
          const vr = checkMember(variant as Record<string, unknown>, true);
          if (!vr.ok) {
            return vr;
          }
        }
      }
    }
  }
  return { ok: true };
}

/**
 * Deep-merge `delta` into `base` (both plain objects):
 *   - plain objects merge recursively,
 *   - `null` DELETES the key (how the editor clears an override),
 *   - arrays and scalars replace wholesale.
 */
function deepMerge(base: Record<string, unknown>, delta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    if (value === null) {
      delete out[key];
    } else if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Sort object keys recursively for a clean, stable diff. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

/** Fire the staging rebuild+deploy GitHub Action (workflow_dispatch on the branch). */
async function triggerDeploy(env: Env): Promise<{ ok: true } | { ok: false; error: string }> {
  const workflow = env.GITHUB_WORKFLOW_FILE || DEFAULT_WORKFLOW_FILE;
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: env.GITHUB_BRANCH }),
  });
  // workflow_dispatch returns 204 No Content on success.
  if (res.status === 204) {
    return { ok: true };
  }
  return { ok: false, error: `deploy dispatch failed: ${res.status} ${await res.text()}` };
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Editor-Password",
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

function ghHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "er-editor-api",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** UTF-8 safe base64 (GitHub Contents API wants base64-encoded file content). */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/** Decode the base64 content GitHub returns for a file (may contain newlines). */
function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

interface SaveBody {
  password?: string;
  file?: string;
  delta?: unknown;
  author?: string;
  deploy?: boolean;
  /**
   * custom-trainers only: per-trainer load-time baseline hash (trainerKey ->
   * hashTrainerEntry). Drives the per-trainer stale-edit conflict guard AND marks
   * a delta entry as a MODIFICATION (has baseline) vs a NEW trainer (no baseline,
   * server-assigned id). Absent for every other file.
   */
  baselines?: Record<string, string>;
}

/** Read a whitelisted repo file: its sha + parsed object map (or a fatal error). */
async function readRepoJson(
  path: string,
  label: string,
  env: Env,
): Promise<{ sha?: string; existing: Record<string, unknown> } | { error: string }> {
  const base = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  const getRes = await fetch(`${base}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, { headers: ghHeaders(env) });
  if (getRes.ok) {
    const meta = (await getRes.json()) as { sha?: string; content?: string };
    if (meta.content) {
      try {
        const parsed = JSON.parse(fromBase64(meta.content)) as unknown;
        return {
          ...(meta.sha ? { sha: meta.sha } : {}),
          existing: isPlainObject(parsed) ? parsed : {},
        };
      } catch {
        return { error: `current ${label} file is not valid JSON` };
      }
    }
    return { ...(meta.sha ? { sha: meta.sha } : {}), existing: {} };
  }
  if (getRes.status === 404) {
    return { existing: {} };
  }
  return { error: `github read failed: ${getRes.status}` };
}

/**
 * MULTI-STAFF-SAFE save for er-custom-trainers.json: read the CURRENT file, merge
 * ONLY the posted trainers (unmentioned preserved; explicit `null` deletes),
 * SERVER-assign ids to new trainers, reject per-trainer stale-baseline conflicts,
 * and sha-conditionally commit with a bounded retry so a lost read/write race
 * never drops a merge. Returns `idRemap` + `conflicts` so the editor can adopt the
 * real ids and keep conflicted trainers dirty.
 */
async function handleSaveCustomTrainers(body: SaveBody, target: EditableFile, env: Env): Promise<Response> {
  const delta = body.delta as Record<string, unknown>;
  const baselines = isPlainObject(body.baselines) ? (body.baselines as Record<string, string>) : undefined;
  const path = target.path;
  const author = typeof body.author === "string" ? body.author.slice(0, 40).replace(/[^\w .-]/g, "") : "";
  const apiBase = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;

  let committedSha: string | undefined;
  let committedUrl: string | undefined;
  const result = await commitCustomTrainersWithRetry({
    read: () => readRepoJson(path, target.label, env),
    merge: existing => mergeCustomTrainersDelta(existing, delta, baselines),
    serialize: merged => `${JSON.stringify(sortKeysDeep(merged), null, 2)}\n`,
    isUnchanged: (merged, existing) => stableStringify(merged) === stableStringify(existing),
    write: async (content, sha) => {
      const putRes = await fetch(apiBase, {
        method: "PUT",
        headers: { ...ghHeaders(env), "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `editor: update ${target.label}${author ? ` (by ${author})` : ""}`,
          content: toBase64(content),
          branch: env.GITHUB_BRANCH,
          ...(sha ? { sha } : {}),
        }),
      });
      if (putRes.ok) {
        const committed = (await putRes.json()) as { commit?: { sha?: string; html_url?: string } };
        committedSha = committed.commit?.sha;
        committedUrl = committed.commit?.html_url;
        return { ok: true };
      }
      // 409 = the file sha we PUT is stale (a teammate committed first): retry the
      // read-merge-write loop against the fresh file. 422 can also signal a sha race.
      const conflict = putRes.status === 409 || putRes.status === 422;
      return { ok: false, conflict, error: `github commit failed: ${putRes.status} ${await putRes.text()}` };
    },
  });

  if (!result.ok) {
    return json({ ok: false, error: result.error }, 502, env);
  }

  // Optionally kick off the rebuild+deploy so the edit goes live.
  let deployed = false;
  let deployError: string | undefined;
  if (body.deploy && result.committed) {
    const dep = await triggerDeploy(env);
    deployed = dep.ok;
    if (!dep.ok) {
      deployError = dep.error;
    }
  }
  return json(
    {
      ok: true,
      commit: committedSha,
      url: committedUrl,
      committed: result.committed,
      idRemap: result.idRemap,
      keyRemap: result.keyRemap,
      conflicts: result.conflicts as CustomTrainerConflict[],
      deployed,
      deployError,
    },
    200,
    env,
  );
}

/** Merge-commit a validated delta into a whitelisted file, optionally deploy. */
async function handleSave(body: SaveBody, env: Env): Promise<Response> {
  // Open mode: if no EDITOR_PASSWORD secret is configured, skip the gate.
  if (env.EDITOR_PASSWORD && body.password !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "unauthorized" }, 401, env);
  }
  const target = body.file === undefined ? undefined : EDITABLE_FILES[body.file];
  if (target === undefined) {
    return json({ ok: false, error: `unknown file (allowed: ${Object.keys(EDITABLE_FILES).join(", ")})` }, 400, env);
  }
  if (!isPlainObject(body.delta) || Object.keys(body.delta).length === 0) {
    return json({ ok: false, error: "delta must be a non-empty object" }, 400, env);
  }
  const validated = target.validate(body.delta);
  if (!validated.ok) {
    return json({ ok: false, error: validated.error }, 400, env);
  }

  // Custom trainers take the multi-staff-safe path (server-assigned ids +
  // per-trainer conflict guard + sha-retry). Every other file uses deep-merge.
  if (body.file === "custom-trainers") {
    return handleSaveCustomTrainers(body, target, env);
  }

  // Read the current file so we MERGE the posted delta into it (the editor
  // only sends changed keys — untouched keys must be preserved, and
  // concurrent editors must not clobber each other).
  const base = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${target.path}`;
  const getRes = await fetch(`${base}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, { headers: ghHeaders(env) });
  let sha: string | undefined;
  let existing: Record<string, unknown> = {};
  if (getRes.ok) {
    const meta = (await getRes.json()) as { sha?: string; content?: string };
    sha = meta.sha;
    if (meta.content) {
      try {
        const parsed = JSON.parse(fromBase64(meta.content)) as unknown;
        if (isPlainObject(parsed)) {
          existing = parsed;
        }
      } catch {
        return json({ ok: false, error: `current ${target.label} file is not valid JSON` }, 502, env);
      }
    }
  } else if (getRes.status !== 404) {
    return json({ ok: false, error: `github read failed: ${getRes.status}` }, 502, env);
  }

  const merged = sortKeysDeep(deepMerge(existing, body.delta)) as Record<string, unknown>;
  const content = `${JSON.stringify(merged, null, 2)}\n`;

  const author = typeof body.author === "string" ? body.author.slice(0, 40).replace(/[^\w .-]/g, "") : "";
  const putRes = await fetch(base, {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `editor: update ${target.label}${author ? ` (by ${author})` : ""}`,
      content: toBase64(content),
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) {
    return json({ ok: false, error: `github commit failed: ${putRes.status} ${await putRes.text()}` }, 502, env);
  }
  const committed = (await putRes.json()) as { commit?: { sha?: string; html_url?: string } };

  // Optionally kick off the rebuild+deploy so the edit goes live.
  let deployed = false;
  let deployError: string | undefined;
  if (body.deploy) {
    const dep = await triggerDeploy(env);
    deployed = dep.ok;
    if (!dep.ok) {
      deployError = dep.error;
    }
  }
  return json(
    { ok: true, commit: committed.commit?.sha, url: committed.commit?.html_url, deployed, deployError },
    200,
    env,
  );
}

// --- Remote dev-log sink (staging test suite → the repo's dev-logs branch) ----
// The in-game Send Logs button posts the FULL capture here from wherever the
// tester is playing; each log is committed as a file on the `dev-logs` branch
// (NEVER the code branch - no CI, no noise). The maintainer syncs them locally
// with scripts/pull-dev-logs.mjs. Unauthenticated by design (testers have no
// password) but size-capped and path-fixed, so the worst case is log spam on
// an orphan QA branch.

const DEVLOG_BRANCH = "dev-logs";
const DEVLOG_MAX_BYTES = 300_000;

interface DevLogBody {
  by?: string;
  scenario?: string;
  comment?: string;
  report?: string;
}

const devlogSlug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "no-scenario";

/** Ensure the dev-logs branch exists (create from the code branch head once). */
async function ensureDevLogBranch(env: Env): Promise<string | null> {
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}`;
  const refRes = await fetch(`${api}/git/ref/heads/${DEVLOG_BRANCH}`, { headers: ghHeaders(env) });
  if (refRes.ok) {
    return null; // exists
  }
  const baseRes = await fetch(`${api}/git/ref/heads/${env.GITHUB_BRANCH}`, { headers: ghHeaders(env) });
  if (!baseRes.ok) {
    return `base branch read failed: ${baseRes.status}`;
  }
  const base = (await baseRes.json()) as { object: { sha: string } };
  const createRes = await fetch(`${api}/git/refs`, {
    method: "POST",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${DEVLOG_BRANCH}`, sha: base.object.sha }),
  });
  // 422 = lost a creation race - that's fine, the branch exists now.
  if (!createRes.ok && createRes.status !== 422) {
    return `branch create failed: ${createRes.status}`;
  }
  return null;
}

/** Commit one Send Logs capture onto the dev-logs branch. */
async function handleDevLog(body: DevLogBody, env: Env): Promise<Response> {
  const report = typeof body.report === "string" ? body.report : "";
  if (report.trim().length === 0) {
    return json({ ok: false, error: "empty report" }, 400, env);
  }
  if (report.length > DEVLOG_MAX_BYTES) {
    return json({ ok: false, error: "report too large" }, 413, env);
  }
  const branchError = await ensureDevLogBranch(env);
  if (branchError !== null) {
    return json({ ok: false, error: branchError }, 502, env);
  }
  const by = devlogSlug(typeof body.by === "string" && body.by ? body.by : "anon");
  const scenario = devlogSlug(typeof body.scenario === "string" && body.scenario ? body.scenario : "no-scenario");
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const path = `remote/${day}/${stamp}__${scenario}__${by}.log`;
  const putRes = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `devlog: ${scenario} (by ${by})`,
      content: toBase64(report),
      branch: DEVLOG_BRANCH,
    }),
  });
  if (!putRes.ok) {
    return json({ ok: false, error: `log commit failed: ${putRes.status}` }, 502, env);
  }
  return json({ ok: true, path }, 200, env);
}

const ASSET_FILE_RE = /^(front|back|shiny|shiny-back|shiny-2|shiny-back-2|shiny-3|shiny-back-3|icon)\.(png|json)$/;

interface UploadAssetsBody {
  password?: string;
  slug?: string;
  files?: { name?: string; contentBase64?: string }[];
  author?: string;
}

/**
 * Commit a custom mon's sprite files to the ASSETS repo
 * (images/pokemon/elite-redux/<slug>/...) as ONE commit via the Git Data API.
 * Only the fixed sprite filenames are accepted. Requires the PAT to cover the
 * assets repo (Contents read+write) — without it GitHub answers 404.
 */
async function handleUploadAssets(body: UploadAssetsBody, env: Env): Promise<Response> {
  if (env.EDITOR_PASSWORD && body.password !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "unauthorized" }, 401, env);
  }
  const slug = body.slug ?? "";
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    return json({ ok: false, error: "bad slug" }, 400, env);
  }
  const files = body.files ?? [];
  if (!Array.isArray(files) || files.length === 0 || files.length > 24) {
    return json({ ok: false, error: "1-24 files required" }, 400, env);
  }
  for (const file of files) {
    if (typeof file.name !== "string" || !ASSET_FILE_RE.test(file.name)) {
      return json({ ok: false, error: `bad file name: ${String(file.name)}` }, 400, env);
    }
    if (
      typeof file.contentBase64 !== "string"
      || file.contentBase64.length === 0
      || file.contentBase64.length > 2_000_000
    ) {
      return json({ ok: false, error: `${file.name}: content missing or over ~1.5MB` }, 400, env);
    }
  }

  const repo = env.ASSETS_REPO || "Heraklines/er-assets";
  const branch = env.ASSETS_BRANCH || "main";
  const api = `https://api.github.com/repos/${repo}`;
  const headers = { ...ghHeaders(env), "Content-Type": "application/json" };

  // Current branch head + its tree.
  const refRes = await fetch(`${api}/git/ref/heads/${branch}`, { headers: ghHeaders(env) });
  if (!refRes.ok) {
    return json(
      { ok: false, error: `assets repo read failed: ${refRes.status} (does the PAT cover ${repo}?)` },
      502,
      env,
    );
  }
  const ref = (await refRes.json()) as { object: { sha: string } };
  const headSha = ref.object.sha;
  const commitRes = await fetch(`${api}/git/commits/${headSha}`, { headers: ghHeaders(env) });
  if (!commitRes.ok) {
    return json({ ok: false, error: `assets commit read failed: ${commitRes.status}` }, 502, env);
  }
  const headCommit = (await commitRes.json()) as { tree: { sha: string } };

  // One blob per file, then one tree, one commit, one ref update.
  const treeEntries: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const file of files) {
    const blobRes = await fetch(`${api}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: file.contentBase64, encoding: "base64" }),
    });
    if (!blobRes.ok) {
      return json({ ok: false, error: `blob create failed for ${file.name}: ${blobRes.status}` }, 502, env);
    }
    const blob = (await blobRes.json()) as { sha: string };
    treeEntries.push({
      path: `images/pokemon/elite-redux/${slug}/${file.name}`,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }
  const treeRes = await fetch(`${api}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: treeEntries }),
  });
  if (!treeRes.ok) {
    return json({ ok: false, error: `tree create failed: ${treeRes.status}` }, 502, env);
  }
  const tree = (await treeRes.json()) as { sha: string };
  const author = typeof body.author === "string" ? body.author.slice(0, 40).replace(/[^\w .-]/g, "") : "";
  const newCommitRes = await fetch(`${api}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: `editor: sprites for ${slug}${author ? ` (by ${author})` : ""}`,
      tree: tree.sha,
      parents: [headSha],
    }),
  });
  if (!newCommitRes.ok) {
    return json({ ok: false, error: `commit create failed: ${newCommitRes.status}` }, 502, env);
  }
  const newCommit = (await newCommitRes.json()) as { sha: string };
  const updateRes = await fetch(`${api}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });
  if (!updateRes.ok) {
    return json({ ok: false, error: `ref update failed: ${updateRes.status}` }, 502, env);
  }
  return json({ ok: true, commit: newCommit.sha, files: files.length }, 200, env);
}

interface TrainerSpriteUploadBody {
  password?: string;
  key?: string;
  label?: string;
  genders?: boolean;
  kind?: string;
  tags?: string[];
  author?: string;
  license?: string;
  sourceUrl?: string;
  rightsConfirmed?: boolean;
  deployStaging?: boolean;
  files?: { variant?: "single" | "m" | "f"; pngBase64?: string; atlas?: unknown }[];
}

async function commitAssetTree(
  env: Env,
  entries: readonly { path: string; contentBase64: string }[],
  message: string,
): Promise<{ ok: true; commit: string } | { ok: false; error: string }> {
  const repo = env.ASSETS_REPO || "Heraklines/er-assets";
  const branch = env.ASSETS_BRANCH || "main";
  const api = `https://api.github.com/repos/${repo}`;
  const headers = { ...ghHeaders(env), "Content-Type": "application/json" };
  const refRes = await fetch(`${api}/git/ref/heads/${branch}`, { headers: ghHeaders(env) });
  if (!refRes.ok) {
    return { ok: false, error: `assets repo read failed: ${refRes.status} (does the PAT cover ${repo}?)` };
  }
  const headSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;
  const commitRes = await fetch(`${api}/git/commits/${headSha}`, { headers: ghHeaders(env) });
  if (!commitRes.ok) {
    return { ok: false, error: `assets commit read failed: ${commitRes.status}` };
  }
  const baseTree = ((await commitRes.json()) as { tree: { sha: string } }).tree.sha;
  const tree: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const entry of entries) {
    const blobRes = await fetch(`${api}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: entry.contentBase64, encoding: "base64" }),
    });
    if (!blobRes.ok) {
      return { ok: false, error: `blob create failed for ${entry.path}: ${blobRes.status}` };
    }
    tree.push({
      path: entry.path,
      mode: "100644",
      type: "blob",
      sha: ((await blobRes.json()) as { sha: string }).sha,
    });
  }
  const treeRes = await fetch(`${api}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify({ base_tree: baseTree, tree }),
  });
  if (!treeRes.ok) {
    return { ok: false, error: `assets tree create failed: ${treeRes.status}` };
  }
  const treeSha = ((await treeRes.json()) as { sha: string }).sha;
  const nextCommitRes = await fetch(`${api}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, tree: treeSha, parents: [headSha] }),
  });
  if (!nextCommitRes.ok) {
    return { ok: false, error: `assets commit create failed: ${nextCommitRes.status}` };
  }
  const nextSha = ((await nextCommitRes.json()) as { sha: string }).sha;
  const updateRes = await fetch(`${api}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ sha: nextSha, force: false }),
  });
  return updateRes.ok
    ? { ok: true, commit: nextSha }
    : { ok: false, error: `assets ref update failed: ${updateRes.status}` };
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

async function updateTrainerSpriteCatalog(
  body: TrainerSpriteUploadBody,
  env: Env,
): Promise<{ ok: true; commit: string } | { ok: false; error: string }> {
  const path = "src/data/elite-redux/er-custom-trainer-sprites.json";
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const readRes = await fetch(`${api}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, { headers: ghHeaders(env) });
    if (!readRes.ok) {
      return { ok: false, error: `sprite catalog read failed: ${readRes.status}` };
    }
    const live = (await readRes.json()) as { sha: string; content: string };
    let catalog: Record<string, unknown>;
    try {
      catalog = JSON.parse(decodeBase64Utf8(live.content)) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "sprite catalog contains invalid JSON" };
    }
    const key = body.key as string;
    catalog[key] = {
      label: (body.label as string).trim(),
      spriteKey: key,
      genders: body.genders === true,
      kind: (body.kind || "other").trim(),
      tags: body.tags || [],
      author: (body.author || "").trim(),
      license: body.license,
      sourceUrl: (body.sourceUrl || "").trim(),
    };
    const putRes = await fetch(api, {
      method: "PUT",
      headers: { ...ghHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `editor: trainer sprite ${key}`,
        content: toBase64(`${JSON.stringify(sortKeysDeep(catalog), null, 2)}\n`),
        sha: live.sha,
        branch: env.GITHUB_BRANCH,
      }),
    });
    if (putRes.ok) {
      return { ok: true, commit: ((await putRes.json()) as { commit: { sha: string } }).commit.sha };
    }
    if (putRes.status !== 409) {
      return { ok: false, error: `sprite catalog update failed: ${putRes.status} ${await putRes.text()}` };
    }
  }
  return { ok: false, error: "sprite catalog changed repeatedly; retry the upload" };
}

async function handleTrainerSpriteUpload(body: TrainerSpriteUploadBody, env: Env): Promise<Response> {
  if (env.EDITOR_PASSWORD && body.password !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "unauthorized" }, 401, env);
  }
  const key = body.key || "";
  const label = body.label || "";
  const license = body.license || "unknown";
  if (!/^[a-z0-9_]{2,64}$/.test(key) || label.trim().length === 0 || label.length > 80) {
    return json({ ok: false, error: "key or label is invalid" }, 400, env);
  }
  if (!new Set(["original", "cc0", "cc-by", "permission", "unknown"]).has(license)) {
    return json({ ok: false, error: "unknown license value" }, 400, env);
  }
  if (body.rightsConfirmed !== true) {
    return json({ ok: false, error: "rights confirmation is required" }, 400, env);
  }
  if (
    !Array.isArray(body.tags)
    || body.tags.length > 12
    || body.tags.some(tag => typeof tag !== "string" || tag.trim().length === 0 || tag.length > 32)
    || (body.author !== undefined && (typeof body.author !== "string" || body.author.length > 80))
    || (body.kind !== undefined && (typeof body.kind !== "string" || !/^[a-z0-9_-]{1,40}$/.test(body.kind)))
  ) {
    return json({ ok: false, error: "sprite metadata is invalid" }, 400, env);
  }
  if (body.sourceUrl && (body.sourceUrl.length > 500 || !/^https?:\/\//i.test(body.sourceUrl))) {
    return json({ ok: false, error: "source URL is invalid" }, 400, env);
  }
  const files = body.files || [];
  const expected = body.genders ? new Set(["m", "f"]) : new Set(["single"]);
  if (files.length !== expected.size || files.some(file => !file.variant || !expected.delete(file.variant))) {
    return json(
      { ok: false, error: body.genders ? "male and female files are required" : "one sprite file is required" },
      400,
      env,
    );
  }
  const assetEntries: { path: string; contentBase64: string }[] = [];
  for (const file of files) {
    if (
      typeof file.pngBase64 !== "string"
      || file.pngBase64.length < 12
      || file.pngBase64.length > 4_000_000
      || !file.pngBase64.replace(/^data:image\/png;base64,/, "").startsWith("iVBORw0KGgo")
    ) {
      return json({ ok: false, error: `${file.variant}: PNG is missing or too large` }, 400, env);
    }
    if (!isPlainObject(file.atlas) || !isPlainObject(file.atlas.frames)) {
      return json({ ok: false, error: `${file.variant}: atlas JSON is invalid` }, 400, env);
    }
    const suffix = file.variant === "single" ? "" : `_${file.variant}`;
    const base = `images/trainer/${key}${suffix}`;
    assetEntries.push({ path: `${base}.png`, contentBase64: file.pngBase64.replace(/^data:image\/png;base64,/, "") });
    assetEntries.push({ path: `${base}.json`, contentBase64: toBase64(`${JSON.stringify(file.atlas, null, 2)}\n`) });
  }
  body.license = license;
  const assets = await commitAssetTree(env, assetEntries, `editor: trainer sprite ${key}`);
  if (!assets.ok) {
    return json({ ok: false, error: assets.error }, 502, env);
  }
  const catalog = await updateTrainerSpriteCatalog(body, env);
  if (!catalog.ok) {
    return json({ ok: false, error: catalog.error, assetsCommitted: true, assetsCommit: assets.commit }, 502, env);
  }
  if (body.deployStaging !== false) {
    const deploy = await triggerDeploy(env);
    if (!deploy.ok) {
      return json({ ok: false, error: deploy.error, assetsCommitted: true, catalogCommitted: true }, 502, env);
    }
  }
  return json({ ok: true, assetsCommit: assets.commit, catalogCommit: catalog.commit, key }, 200, env);
}

const MEDIA_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
const MEDIA_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;
const MEDIA_UPLOAD_ID_RE = /^[0-9a-f-]{36}$/;
const MEDIA_UPLOAD_EXTENSIONS = new Set([
  "3gp",
  "aac",
  "aif",
  "aiff",
  "avi",
  "caf",
  "flac",
  "m4a",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "mpeg",
  "mpg",
  "oga",
  "ogg",
  "opus",
  "ts",
  "wav",
  "webm",
  "wma",
]);
const MEDIA_UPLOAD_LICENSES = new Set(["original", "permission", "cc0", "cc-by", "unknown"]);

interface MediaUploadStartBody {
  password?: string;
  fileName?: string;
  fileSize?: number;
  contentType?: string;
}

interface MediaUploadCompleteBody {
  password?: string;
  id?: string;
  uploadId?: string;
  parts?: R2UploadedPartLike[];
  keyPrefix?: string;
  title?: string;
  artist?: string;
  license?: string;
  attribution?: string;
  sourceUrl?: string;
  author?: string;
  deployStaging?: boolean;
  rightsConfirmed?: boolean;
}

interface MediaUploadAbortBody {
  password?: string;
  id?: string;
  uploadId?: string;
}

function mediaUploadKey(id: string): string {
  return `media-import/${id}`;
}

function randomMediaToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

function validatedMediaFileName(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 3 || value.length > 180) {
    return null;
  }
  const name = value.replaceAll("\\", "/").split("/").pop()?.trim() || "";
  const extension = name.split(".").pop()?.toLowerCase() || "";
  return name && MEDIA_UPLOAD_EXTENSIONS.has(extension) ? name : null;
}

function mediaUploadUnavailable(env: Env): Response | null {
  return env.MEDIA_UPLOADS ? null : json({ ok: false, error: "direct media uploads are not configured" }, 503, env);
}

async function dispatchMediaImport(
  env: Env,
  inputs: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const workflow = env.MEDIA_IMPORT_WORKFLOW_FILE || "deploy-staging.yml";
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: { ...ghHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: env.MEDIA_IMPORT_BRANCH || env.GITHUB_BRANCH,
        inputs,
      }),
    },
  );
  return response.status === 204
    ? { ok: true }
    : { ok: false, error: `media import dispatch failed: ${response.status} ${await response.text()}` };
}

async function handleMediaUploadStart(body: MediaUploadStartBody, env: Env): Promise<Response> {
  if (env.EDITOR_PASSWORD && body.password !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "unauthorized" }, 401, env);
  }
  const unavailable = mediaUploadUnavailable(env);
  if (unavailable) {
    return unavailable;
  }
  const fileName = validatedMediaFileName(body.fileName);
  const fileSize = Number(body.fileSize);
  const contentType = typeof body.contentType === "string" ? body.contentType.slice(0, 120) : "";
  if (!fileName) {
    return json({ ok: false, error: "choose a supported audio or video file" }, 400, env);
  }
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MEDIA_UPLOAD_MAX_BYTES) {
    return json({ ok: false, error: "file size must be between 1 byte and 1 GiB" }, 400, env);
  }
  if (contentType && !/^(audio|video)\//i.test(contentType) && contentType !== "application/octet-stream") {
    return json({ ok: false, error: "file content type must be audio or video" }, 400, env);
  }

  const id = crypto.randomUUID();
  const upload = await env.MEDIA_UPLOADS!.createMultipartUpload(mediaUploadKey(id), {
    httpMetadata: { contentType: contentType || "application/octet-stream" },
    customMetadata: {
      downloadToken: randomMediaToken(),
      fileName: encodeURIComponent(fileName),
      expectedSize: String(fileSize),
      createdAt: new Date().toISOString(),
    },
  });
  return json(
    {
      ok: true,
      id,
      uploadId: upload.uploadId,
      partSize: MEDIA_UPLOAD_PART_BYTES,
      maxSize: MEDIA_UPLOAD_MAX_BYTES,
    },
    201,
    env,
  );
}

async function handleMediaUploadPart(request: Request, url: URL, env: Env): Promise<Response> {
  if (env.EDITOR_PASSWORD && request.headers.get("X-Editor-Password") !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "unauthorized" }, 401, env);
  }
  const unavailable = mediaUploadUnavailable(env);
  if (unavailable) {
    return unavailable;
  }
  const match = url.pathname.match(/^\/media-upload\/([0-9a-f-]{36})\/parts\/(\d{1,5})$/);
  const id = match?.[1] || "";
  const partNumber = Number(match?.[2]);
  const uploadId = url.searchParams.get("uploadId") || "";
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (
    !MEDIA_UPLOAD_ID_RE.test(id)
    || !uploadId
    || uploadId.length > 200
    || !Number.isInteger(partNumber)
    || partNumber < 1
    || partNumber > 10_000
    || !request.body
  ) {
    return json({ ok: false, error: "invalid multipart upload request" }, 400, env);
  }
  if (contentLength > MEDIA_UPLOAD_PART_BYTES) {
    return json({ ok: false, error: "upload part exceeds the negotiated part size" }, 413, env);
  }
  try {
    const upload = env.MEDIA_UPLOADS!.resumeMultipartUpload(mediaUploadKey(id), uploadId);
    const part = await upload.uploadPart(partNumber, request.body);
    return json({ ok: true, part }, 200, env);
  } catch (error) {
    return json(
      { ok: false, error: `upload part failed: ${error instanceof Error ? error.message : error}` },
      502,
      env,
    );
  }
}

function validateMediaUploadMetadata(
  body: MediaUploadCompleteBody,
):
  | { ok: true; metadata: Required<Pick<MediaUploadCompleteBody, "keyPrefix" | "title" | "license">> }
  | { ok: false; error: string } {
  const keyPrefix = (body.keyPrefix || "battle_custom").trim();
  const title = (body.title || "").trim();
  const license = (body.license || "unknown").trim();
  if (!/^[a-z0-9_]{2,40}$/.test(keyPrefix)) {
    return { ok: false, error: "key prefix must use lowercase letters, numbers, and underscores" };
  }
  if (!title || title.length > 160) {
    return { ok: false, error: "track title is required and must be at most 160 characters" };
  }
  if (!MEDIA_UPLOAD_LICENSES.has(license)) {
    return { ok: false, error: "select a valid upload license" };
  }
  if ((body.artist || "").length > 120 || (body.attribution || "").length > 500 || (body.author || "").length > 40) {
    return { ok: false, error: "artist, attribution, or staff name is too long" };
  }
  if (body.sourceUrl && (body.sourceUrl.length > 500 || !/^https?:\/\//i.test(body.sourceUrl))) {
    return { ok: false, error: "source URL is invalid" };
  }
  if (license === "cc-by" && (!(body.attribution || "").trim() || !(body.sourceUrl || "").trim())) {
    return { ok: false, error: "CC BY uploads require attribution and a public source URL" };
  }
  if (body.rightsConfirmed !== true) {
    return { ok: false, error: "rights confirmation is required" };
  }
  return { ok: true, metadata: { keyPrefix, title, license } };
}

async function handleMediaUploadComplete(body: MediaUploadCompleteBody, request: Request, env: Env): Promise<Response> {
  if (env.EDITOR_PASSWORD && body.password !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "unauthorized" }, 401, env);
  }
  const unavailable = mediaUploadUnavailable(env);
  if (unavailable) {
    return unavailable;
  }
  const metadataResult = validateMediaUploadMetadata(body);
  if (!metadataResult.ok) {
    return json({ ok: false, error: metadataResult.error }, 400, env);
  }
  const id = body.id || "";
  const uploadId = body.uploadId || "";
  const parts = Array.isArray(body.parts)
    ? body.parts
        .map(part => ({ partNumber: Number(part.partNumber), etag: String(part.etag || "") }))
        .sort((a, b) => a.partNumber - b.partNumber)
    : [];
  if (
    !MEDIA_UPLOAD_ID_RE.test(id)
    || !uploadId
    || uploadId.length > 200
    || parts.length === 0
    || parts.length > 10_000
    || parts.some((part, index) => part.partNumber !== index + 1 || !part.etag || part.etag.length > 200)
  ) {
    return json({ ok: false, error: "multipart completion data is invalid" }, 400, env);
  }

  const key = mediaUploadKey(id);
  try {
    await env.MEDIA_UPLOADS!.resumeMultipartUpload(key, uploadId).complete(parts);
  } catch (error) {
    return json(
      { ok: false, error: `upload completion failed: ${error instanceof Error ? error.message : error}` },
      502,
      env,
    );
  }
  const object = await env.MEDIA_UPLOADS!.head(key);
  const downloadToken = object?.customMetadata?.downloadToken || "";
  const encodedFileName = object?.customMetadata?.fileName || "";
  const expectedSize = Number(object?.customMetadata?.expectedSize);
  if (!object || !downloadToken || !encodedFileName) {
    await env.MEDIA_UPLOADS!.delete(key);
    return json({ ok: false, error: "completed upload metadata is missing" }, 502, env);
  }
  if (!Number.isSafeInteger(expectedSize) || object.size !== expectedSize) {
    await env.MEDIA_UPLOADS!.delete(key);
    return json({ ok: false, error: "completed upload size does not match the selected file" }, 400, env);
  }
  if (object.size > MEDIA_UPLOAD_MAX_BYTES) {
    await env.MEDIA_UPLOADS!.delete(key);
    return json({ ok: false, error: "completed upload exceeds the 1 GiB limit" }, 413, env);
  }

  const fileName = decodeURIComponent(encodedFileName);
  const uploadUrl = `${new URL(request.url).origin}/media-upload/${id}?token=${encodeURIComponent(downloadToken)}`;
  const dispatched = await dispatchMediaImport(env, {
    operation: "import_music",
    source_urls: "",
    upload_url: uploadUrl,
    upload_name: fileName,
    upload_title: metadataResult.metadata.title,
    upload_artist: (body.artist || "").trim().slice(0, 120),
    upload_license: metadataResult.metadata.license,
    upload_attribution: (body.attribution || "").trim().slice(0, 500),
    upload_source_url: (body.sourceUrl || "").trim().slice(0, 500),
    key_prefix: metadataResult.metadata.keyPrefix,
    split_chapters: "false",
    require_creative_commons: "false",
    deploy_staging: body.deployStaging === true ? "true" : "false",
    author: (body.author || "").trim().slice(0, 40),
  });
  if (!dispatched.ok) {
    await env.MEDIA_UPLOADS!.delete(key);
    return json({ ok: false, error: dispatched.error }, 502, env);
  }
  return json({ ok: true, queued: true, id, fileName, size: object.size }, 202, env);
}

async function handleMediaUploadAbort(body: MediaUploadAbortBody, env: Env): Promise<Response> {
  if (env.EDITOR_PASSWORD && body.password !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "unauthorized" }, 401, env);
  }
  const unavailable = mediaUploadUnavailable(env);
  if (unavailable) {
    return unavailable;
  }
  const id = body.id || "";
  const uploadId = body.uploadId || "";
  if (!MEDIA_UPLOAD_ID_RE.test(id) || !uploadId || uploadId.length > 200) {
    return json({ ok: false, error: "invalid multipart upload" }, 400, env);
  }
  try {
    await env.MEDIA_UPLOADS!.resumeMultipartUpload(mediaUploadKey(id), uploadId).abort();
  } catch {
    // A completed session cannot be aborted; deleting the object below is still authoritative.
  }
  await env.MEDIA_UPLOADS!.delete(mediaUploadKey(id));
  return json({ ok: true, aborted: true }, 200, env);
}

async function handleMediaUploadObject(request: Request, url: URL, env: Env): Promise<Response> {
  const unavailable = mediaUploadUnavailable(env);
  if (unavailable) {
    return unavailable;
  }
  const id = url.pathname.match(/^\/media-upload\/([0-9a-f-]{36})$/)?.[1] || "";
  const token = url.searchParams.get("token") || "";
  if (!MEDIA_UPLOAD_ID_RE.test(id) || token.length < 32 || token.length > 128) {
    return json({ ok: false, error: "invalid upload download request" }, 400, env);
  }
  const key = mediaUploadKey(id);
  const object = await env.MEDIA_UPLOADS!.get(key);
  if (!object || object.customMetadata?.downloadToken !== token) {
    return json({ ok: false, error: "upload not found" }, 404, env);
  }
  if (request.method === "DELETE") {
    await env.MEDIA_UPLOADS!.delete(key);
    return json({ ok: true, deleted: true }, 200, env);
  }
  const encodedFileName = object.customMetadata?.fileName || "upload.bin";
  const fileName = decodeURIComponent(encodedFileName).replaceAll(/[\r\n"]/g, "_");
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      ETag: object.httpEtag,
      "Cache-Control": "private, no-store",
    },
  });
}

interface MediaImportBody {
  password?: string;
  urls?: string[];
  keyPrefix?: string;
  splitChapters?: boolean;
  requireCreativeCommons?: boolean;
  deployStaging?: boolean;
  rightsConfirmed?: boolean;
  author?: string;
}

async function handleMediaImport(body: MediaImportBody, env: Env): Promise<Response> {
  if (env.EDITOR_PASSWORD && body.password !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "unauthorized" }, 401, env);
  }
  const urls = body.urls || [];
  if (
    !Array.isArray(urls)
    || urls.length === 0
    || urls.length > 20
    || urls.some(
      url => typeof url !== "string" || url.length > 500 || !/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url),
    )
  ) {
    return json({ ok: false, error: "provide 1-20 YouTube video or playlist URLs" }, 400, env);
  }
  if (body.rightsConfirmed !== true) {
    return json({ ok: false, error: "rights confirmation is required" }, 400, env);
  }
  const keyPrefix = (body.keyPrefix || "battle_custom").trim();
  if (!/^[a-z0-9_]{2,40}$/.test(keyPrefix)) {
    return json({ ok: false, error: "key prefix must use lowercase letters, numbers, and underscores" }, 400, env);
  }
  const dispatched = await dispatchMediaImport(env, {
    operation: "import_music",
    source_urls: urls.join("\n"),
    upload_url: "",
    upload_name: "",
    upload_title: "",
    upload_artist: "",
    upload_license: "",
    upload_attribution: "",
    upload_source_url: "",
    key_prefix: keyPrefix,
    split_chapters: body.splitChapters === false ? "false" : "true",
    require_creative_commons: body.requireCreativeCommons === true ? "true" : "false",
    deploy_staging: body.deployStaging === true ? "true" : "false",
    author: (body.author || "").slice(0, 40),
  });
  return dispatched.ok
    ? json({ ok: true, queued: true }, 202, env)
    : json({ ok: false, error: dispatched.error }, 502, env);
}

async function handleMediaJobs(password: string | undefined, env: Env): Promise<Response> {
  if (env.EDITOR_PASSWORD && password !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: "unauthorized" }, 401, env);
  }
  const workflow = env.MEDIA_IMPORT_WORKFLOW_FILE || "deploy-staging.yml";
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(env.GITHUB_BRANCH)}&per_page=10`,
    { headers: ghHeaders(env) },
  );
  if (!response.ok) {
    return json({ ok: false, error: `media jobs read failed: ${response.status}` }, 502, env);
  }
  const data = (await response.json()) as {
    workflow_runs?: {
      id: number;
      status: string;
      conclusion: string | null;
      html_url: string;
      created_at: string;
      display_title?: string;
    }[];
  };
  return json(
    {
      ok: true,
      runs: (data.workflow_runs || []).filter(
        run => run.display_title === "Import BGM" || run.display_title === "Import YouTube BGM",
      ),
    },
    200,
    env,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }
    if (url.pathname === "/health") {
      return json({ ok: true }, 200, env);
    }
    if (/^\/media-upload\/[0-9a-f-]{36}\/parts\/\d{1,5}$/.test(url.pathname) && request.method === "POST") {
      return handleMediaUploadPart(request, url, env);
    }
    if (/^\/media-upload\/[0-9a-f-]{36}$/.test(url.pathname) && ["GET", "DELETE"].includes(request.method)) {
      return handleMediaUploadObject(request, url, env);
    }
    if (url.pathname === "/media-upload/start" && request.method === "POST") {
      let body: MediaUploadStartBody;
      try {
        body = (await request.json()) as MediaUploadStartBody;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleMediaUploadStart(body, env);
    }
    if (url.pathname === "/media-upload/complete" && request.method === "POST") {
      let body: MediaUploadCompleteBody;
      try {
        body = (await request.json()) as MediaUploadCompleteBody;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleMediaUploadComplete(body, request, env);
    }
    if (url.pathname === "/media-upload/abort" && request.method === "POST") {
      let body: MediaUploadAbortBody;
      try {
        body = (await request.json()) as MediaUploadAbortBody;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleMediaUploadAbort(body, env);
    }

    if (url.pathname === "/deploy" && request.method === "POST") {
      let body: { password?: string };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      // Open mode: if no EDITOR_PASSWORD secret is configured, skip the gate.
      if (env.EDITOR_PASSWORD && body.password !== env.EDITOR_PASSWORD) {
        return json({ ok: false, error: "unauthorized" }, 401, env);
      }
      const dep = await triggerDeploy(env);
      if (!dep.ok) {
        return json({ ok: false, error: dep.error }, 502, env);
      }
      return json({ ok: true, deployed: true }, 200, env);
    }

    if (url.pathname === "/save" && request.method === "POST") {
      let body: SaveBody;
      try {
        body = (await request.json()) as SaveBody;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleSave(body, env);
    }

    if (url.pathname === "/upload-assets" && request.method === "POST") {
      let body: UploadAssetsBody;
      try {
        body = (await request.json()) as UploadAssetsBody;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleUploadAssets(body, env);
    }
    if (url.pathname === "/upload-trainer-sprite" && request.method === "POST") {
      let body: TrainerSpriteUploadBody;
      try {
        body = (await request.json()) as TrainerSpriteUploadBody;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleTrainerSpriteUpload(body, env);
    }
    if (url.pathname === "/import-media" && request.method === "POST") {
      let body: MediaImportBody;
      try {
        body = (await request.json()) as MediaImportBody;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleMediaImport(body, env);
    }
    if (url.pathname === "/media-jobs" && request.method === "POST") {
      let body: { password?: string };
      try {
        body = (await request.json()) as { password?: string };
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleMediaJobs(body.password, env);
    }

    if (url.pathname === "/devlog" && request.method === "POST") {
      let body: DevLogBody;
      try {
        body = (await request.json()) as DevLogBody;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      return handleDevLog(body, env);
    }

    // Back-compat: the original egg-move route ({ eggMoves } instead of
    // { file, delta }). Kept so an older cached SPA keeps working.
    if (url.pathname === "/egg-moves" && request.method === "POST") {
      let body: { password?: string; eggMoves?: unknown; author?: string; deploy?: boolean };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ ok: false, error: "invalid JSON body" }, 400, env);
      }
      const saveBody: SaveBody = { file: "egg-moves" };
      if (body.password !== undefined) {
        saveBody.password = body.password;
      }
      if (body.eggMoves !== undefined) {
        saveBody.delta = body.eggMoves;
      }
      if (body.author !== undefined) {
        saveBody.author = body.author;
      }
      if (body.deploy !== undefined) {
        saveBody.deploy = body.deploy;
      }
      return handleSave(saveBody, env);
    }

    return json({ ok: false, error: "not found" }, 404, env);
  },
};
