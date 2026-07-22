/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — per-Omniform-evolution moveset model (Partner Eevee core).
//
// The whole point of an Omniform mon (Partner Eevee today; 3-4 more partner
// evolutions and eventually one per type are coming) is that EACH of its
// mid-battle evolution forms carries its OWN independent moveset. This module is
// the generic backend for that:
//
//   - `isErOmniformMon(mon)`  — the multi-form predicate. Every new behavior gates
//     on it, so a vanilla single-form mon serializes + behaves byte-identically.
//   - a compact per-form store persisted on `customPokemonData.erOmniformMovesets`
//     (move id + ppUsed pairs, keyed by form identity; `undefined` for every
//     non-Omniform mon so the serialized shape is unchanged).
//   - a seeded roll: on first unlock, an evolution form's base moveset is drawn
//     seeded-randomly from THAT form species' own learnset (deterministic per mon
//     + form, independent of the live battle RNG stream).
//   - the teach-path backend (`learnMoveForEvolution`, `listOmniformEvolutionsForMove`)
//     the level-up batch panel / TM case / Learner's Shroom call, enforcing
//     "once per evolution" + each evolution species' OWN learnable set (level-up +
//     TM/tutor + egg).
//   - the in-battle per-form live-moveset swap the Omniform transform drives, with
//     PP preserved per form within a battle.
//
// The BASE form's moveset is NOT duplicated in the store: it is the mon's normal
// persistent `moveset`. Only the transform-target evolutions get store entries.
// =============================================================================

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { speciesTmMoves } from "#balance/tms";
import {
  erOmniformConnectedForms,
  erOmniformFamilyForms,
  erOmniformOriginalIdentity,
  type OmniformTarget,
} from "#data/elite-redux/abilities/omniform-registry";
import type { PokemonSpeciesForm } from "#data/pokemon-species";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import type { LevelMoves } from "#types/pokemon-level-moves";
import { getPokemonSpecies, getPokemonSpeciesForm } from "#utils/pokemon-utils";

/** One stored move: `[moveId, ppUsed]`. Compact on purpose (save-size sensitive). */
export type SerializedOmniformMove = [moveId: number, ppUsed: number];

/**
 * The persisted per-evolution moveset store: form-identity key -> its moveset.
 * Only NON-base evolution forms are stored (the base form uses the mon's own
 * persistent `moveset`). Lives on {@linkcode CustomPokemonData.erOmniformMovesets};
 * `undefined` for every non-Omniform mon.
 */
export type ErOmniformMovesetStore = Record<string, SerializedOmniformMove[]>;

/** Identity key for a `(speciesId, formIndex)` pair (matches the Omniform registry key shape). */
export function omniformFormKey(speciesId: number, formIndex: number): string {
  return `${speciesId}:${formIndex}`;
}

/**
 * The mon's PERSISTENT base identity: its pre-transform snapshot while mid-battle
 * transformed, else its current species/form. This is the stable anchor (Partner
 * Eevee) the family + store are keyed from, regardless of the transient form the
 * mon is wearing on the field right now.
 */
export function omniformBaseIdentity(mon: Pokemon): OmniformTarget {
  const original = erOmniformOriginalIdentity(mon);
  if (original) {
    return { speciesId: original.speciesId, formIndex: original.formIndex };
  }
  return { speciesId: mon.species.speciesId, formIndex: mon.formIndex };
}

/**
 * The generic multi-form predicate: `true` when `mon`'s persistent base identity is
 * a registered Omniform holder that actually has transform-target evolutions (family
 * size > 1). Partner Eevee is the only mon that satisfies this today. Every
 * per-evolution behavior gates on this so vanilla mons are untouched.
 */
export function isErOmniformMon(mon: Pokemon): boolean {
  const base = omniformBaseIdentity(mon);
  return erOmniformFamilyForms(base.speciesId, base.formIndex).length > 1;
}

/** Whether `form` is the mon's persistent BASE form (stored in `mon.moveset`, not the form store). */
function isBaseForm(form: OmniformTarget, base: OmniformTarget): boolean {
  return form.speciesId === base.speciesId && form.formIndex === base.formIndex;
}

/** Resolve a target's `PokemonSpeciesForm` (a specific form, or the species itself). */
function resolveForm(form: OmniformTarget): PokemonSpeciesForm {
  return getPokemonSpeciesForm(form.speciesId, form.formIndex);
}

// -----------------------------------------------------------------------------
// Seeded roll
// -----------------------------------------------------------------------------

/**
 * A small, self-contained deterministic PRNG (mulberry32). Used to roll an
 * evolution's base moveset reproducibly from a per-mon/per-form seed WITHOUT
 * touching the live battle RNG stream (so rolling a store never perturbs combat
 * rolls, and the same mon always rolls the same base kit).
 */
export function makeSeededRandInt(seed: number): (range: number) => number {
  let s = seed >>> 0;
  return (range: number): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * range) % (range || 1);
  };
}

/** Stable 32-bit hash (djb2) of a string — for deriving a per-form roll seed. */
function hashString(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** The deterministic roll seed for `mon`'s `formKey` evolution moveset (stable across reloads). */
function rollSeed(mon: Pokemon, formKey: string): number {
  return hashString(`${mon.id}:${formKey}`);
}

/**
 * Roll a seeded, level-appropriate base moveset (up to `maxSlots` move ids) from
 * `speciesForm`'s OWN level-up learnset, preferring the moves the holder's level
 * qualifies for. Deterministic for a given `randInt`. Excludes {@linkcode MoveId.NONE}
 * and duplicates. Exposed for tests (roll determinism per seed).
 */
export function rollOmniformMoveset(
  speciesForm: PokemonSpeciesForm,
  level: number,
  maxSlots: number,
  randInt: (range: number) => number,
): number[] {
  const levelMoves = speciesForm.getLevelMoves();
  const eligible: number[] = [];
  const seen = new Set<number>([MoveId.NONE]);
  // High-level first so a level-appropriate mon draws from its strongest kit.
  for (let i = levelMoves.length - 1; i >= 0; i--) {
    const [moveLevel, moveId] = levelMoves[i];
    if (moveLevel > level || seen.has(moveId)) {
      continue;
    }
    seen.add(moveId);
    eligible.push(moveId);
  }
  // If the mon under-qualifies (few reached moves), top up with the rest of the
  // learnset so a fresh evolution never rolls an empty kit.
  if (eligible.length < maxSlots) {
    for (let i = levelMoves.length - 1; i >= 0; i--) {
      const moveId = levelMoves[i][1];
      if (!seen.has(moveId)) {
        seen.add(moveId);
        eligible.push(moveId);
      }
    }
  }
  // Seeded Fisher-Yates shuffle, then take the first N.
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  return eligible.slice(0, Math.max(0, maxSlots));
}

// -----------------------------------------------------------------------------
// Pooled level-up union (every family member learns any member's level-up move)
// -----------------------------------------------------------------------------

/**
 * Pool the level-up learnsets of `forms` into ONE `[level, moveId]` table, each move
 * kept at the MINIMUM learn level across all contributors. Because an Omniform mon
 * switches between evolution forms via Omniform and can be in ANY form when it levels
 * up, every family member must be able to learn the whole family's level-up pool — so
 * no move is missed just because the current form is not the one that "owns" it (e.g.
 * a Jolteon-only Electric move at level 30 is offered even while in base/other form).
 */
function familyUnionLevelMoves(forms: readonly OmniformTarget[]): LevelMoves {
  const minLevel = new Map<number, number>();
  for (const form of forms) {
    for (const [level, moveId] of resolveForm(form).getLevelMoves()) {
      if (moveId === MoveId.NONE) {
        continue;
      }
      const existing = minLevel.get(moveId);
      if (existing === undefined || level < existing) {
        minLevel.set(moveId, level);
      }
    }
  }
  const out: LevelMoves = [];
  for (const [moveId, level] of minLevel.entries()) {
    out.push([level, moveId as MoveId]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

/**
 * The pooled level-up learn set for `mon`'s WHOLE Omniform family, each move at its
 * minimum level across the family (base first, resolved from the mon's persistent
 * base identity). Empty for a non-Omniform mon. This is what the level-up offer path
 * feeds a partner mon so leveling any form can learn any pooled move; the per-evolution
 * stored movesets + seeded roll are untouched (each evolution still rolls its OWN kit).
 */
export function omniformUnionLevelMoves(mon: Pokemon): LevelMoves {
  if (!isErOmniformMon(mon)) {
    return [];
  }
  return familyUnionLevelMoves(omniformFamilyForms(mon));
}

// -----------------------------------------------------------------------------
// Learnability (each evolution species' OWN learnable set + the family union)
// -----------------------------------------------------------------------------

/**
 * Every move `form` can legally learn through ANY source: its OWN level-up
 * learnset (full), the shared Omniform-family TM/tutor table (ER merges tutor
 * moves into `speciesTmMoves`), and its root's egg moves. This is the
 * per-evolution legality predicate the teach path enforces. Partner Eevee's family
 * TM tables are initialized to the same union, so a TM accepted by one partner
 * evolution is accepted by all nine family members.
 */
export function omniformFormLearnableMoves(form: OmniformTarget): Set<MoveId> {
  const speciesForm = resolveForm(form);
  const out = new Set<MoveId>();
  for (const [, moveId] of speciesForm.getLevelMoves()) {
    if (moveId !== MoveId.NONE) {
      out.add(moveId);
    }
  }
  // `formKey` lives on the concrete `PokemonForm`, not the base species form; a
  // formless species (every partner eeveelution) reads "".
  const species = getPokemonSpecies(form.speciesId);
  const formKey = species.forms?.[form.formIndex]?.formKey ?? "";
  for (const entry of speciesTmMoves[form.speciesId] ?? []) {
    // A bare `MoveId` entry applies to every form; a `[formKey, MoveId]` entry only
    // to that form (mirrors `Pokemon.getErLearnableShroomMoves`).
    if (Array.isArray(entry)) {
      if (entry[0] === formKey) {
        out.add(entry[1] as MoveId);
      }
    } else {
      out.add(entry as MoveId);
    }
  }
  const rootId = getPokemonSpecies(form.speciesId).getRootSpeciesId(true);
  for (const moveId of speciesEggMoves[rootId] ?? []) {
    out.add(moveId);
  }
  // Pool the WHOLE Omniform family's level-up moves so every member can learn any
  // move ANY family member learns on level-up (the requirement: a form does not have
  // to BE Jolteon to learn a Jolteon-only level-up move). Resolved from the undirected
  // family component so a partner eeveelution (queried by its own form) also reaches
  // the Partner Eevee head. A non-Omniform form's component is just itself, so its
  // own level-up moves are re-added (a no-op) and vanilla learnability is unchanged.
  for (const [, moveId] of familyUnionLevelMoves(erOmniformConnectedForms(form.speciesId, form.formIndex))) {
    out.add(moveId);
  }
  return out;
}

/** Whether `form` can legally learn `moveId` through any source. */
export function canFormLearnMove(form: OmniformTarget, moveId: MoveId): boolean {
  return omniformFormLearnableMoves(form).has(moveId);
}

// -----------------------------------------------------------------------------
// The store: get / roll / ensure
// -----------------------------------------------------------------------------

/** The mon's live store, creating the empty object on first access (Omniform mons only). */
function getStore(mon: Pokemon): ErOmniformMovesetStore {
  mon.customPokemonData.erOmniformMovesets ??= {};
  return mon.customPokemonData.erOmniformMovesets;
}

/**
 * `form`'s current stored moveset as `[moveId, ppUsed]` pairs, rolling + persisting
 * a seeded base set on first access. The BASE form is not stored — it returns the
 * mon's live persistent `moveset`.
 */
export function getOrRollFormMoveset(mon: Pokemon, form: OmniformTarget): SerializedOmniformMove[] {
  const base = omniformBaseIdentity(mon);
  if (isBaseForm(form, base)) {
    return mon.moveset.map(m => [m.moveId, m.ppUsed] as SerializedOmniformMove);
  }
  const store = getStore(mon);
  const key = omniformFormKey(form.speciesId, form.formIndex);
  const existing = store[key];
  if (existing) {
    return existing;
  }
  const rolled = rollOmniformMoveset(
    resolveForm(form),
    mon.level,
    mon.getMaxMoveCount(),
    makeSeededRandInt(rollSeed(mon, key)),
  );
  const entry: SerializedOmniformMove[] = rolled.map(moveId => [moveId, 0]);
  store[key] = entry;
  return entry;
}

/**
 * Ensure every evolution in `mon`'s Omniform family has a rolled base moveset in the
 * store (idempotent). Called on acquisition / unlock and before the first transform.
 * No-op for a non-Omniform mon. Returns the store (or `undefined` when not applicable).
 */
export function ensureOmniformFormMovesets(mon: Pokemon): ErOmniformMovesetStore | undefined {
  if (!isErOmniformMon(mon)) {
    return;
  }
  const base = omniformBaseIdentity(mon);
  for (const form of erOmniformFamilyForms(base.speciesId, base.formIndex)) {
    if (!isBaseForm(form, base)) {
      getOrRollFormMoveset(mon, form);
    }
  }
  return mon.customPokemonData.erOmniformMovesets;
}

// -----------------------------------------------------------------------------
// In-battle live moveset swap (PP preserved per form within a battle)
// -----------------------------------------------------------------------------

/**
 * The per-battle cache of each form's LIVE `PokemonMove[]` (with in-battle PP), so
 * switching Eevee -> Flareon -> Eevee keeps Flareon's spent PP. Battle-scoped:
 * cleared on `leaveField` (switch-out / faint / wave end). A `WeakMap` so a
 * destroyed mon's cache is collected.
 */
const OMNIFORM_BATTLE_MOVESETS = new WeakMap<Pokemon, Map<string, PokemonMove[]>>();

/** Snapshot `form`'s current live moveset (deep copy, PP included) into the battle cache. */
export function snapshotOmniformBattleMoveset(mon: Pokemon, form: OmniformTarget, moveset: PokemonMove[]): void {
  let byForm = OMNIFORM_BATTLE_MOVESETS.get(mon);
  if (!byForm) {
    byForm = new Map();
    OMNIFORM_BATTLE_MOVESETS.set(mon, byForm);
  }
  const key = omniformFormKey(form.speciesId, form.formIndex);
  byForm.set(
    key,
    moveset.map(m => new PokemonMove(m.moveId, m.ppUsed, m.ppUp, m.maxPpOverride)),
  );
}

/**
 * Build `form`'s LIVE moveset for the field: the battle-cached copy if this form has
 * already been active this battle (PP preserved), else a fresh copy of its stored /
 * base template. Used by the Omniform transform to swap the active moveset.
 */
export function loadOmniformBattleMoveset(mon: Pokemon, form: OmniformTarget): PokemonMove[] {
  const byForm = OMNIFORM_BATTLE_MOVESETS.get(mon);
  const key = omniformFormKey(form.speciesId, form.formIndex);
  const cached = byForm?.get(key);
  if (cached) {
    return cached;
  }
  const fresh = getOrRollFormMoveset(mon, form).map(([moveId, ppUsed]) => new PokemonMove(moveId, ppUsed));
  if (byForm) {
    byForm.set(key, fresh);
  }
  return fresh;
}

/** Clear `mon`'s per-battle moveset cache (called on leaveField). */
export function clearOmniformBattleMovesets(mon: Pokemon): void {
  OMNIFORM_BATTLE_MOVESETS.delete(mon);
}

// -----------------------------------------------------------------------------
// Teach-path backend (level-up batch panel / TM case / Learner's Shroom)
// -----------------------------------------------------------------------------

/** Why a {@linkcode learnMoveForEvolution} call was rejected. */
export type OmniformLearnReason = "not-omniform" | "not-in-family" | "not-learnable" | "already-known" | "bad-slot";

/** The result of a teach attempt. `ok` true means the move was written into the form's slot. */
export interface OmniformLearnResult {
  ok: boolean;
  reason?: OmniformLearnReason;
}

/** Whether `form` is a member of `mon`'s Omniform family. */
function isFamilyForm(mon: Pokemon, form: OmniformTarget): boolean {
  const base = omniformBaseIdentity(mon);
  return erOmniformFamilyForms(base.speciesId, base.formIndex).some(
    f => f.speciesId === form.speciesId && f.formIndex === form.formIndex,
  );
}

/**
 * THE teach-path API. Teach `moveId` into `slot` of a SPECIFIC evolution `form`'s
 * moveset. Callable per offered move + selected evolution by the level-up batch
 * panel, the TM case, and the Learner's Shroom. Enforces:
 *   - `mon` is an Omniform mon and `form` is in its family;
 *   - legality: `moveId` is in THAT evolution species' own learnable set;
 *   - once-per-evolution: the form does not already know `moveId`;
 *   - a valid slot within the mon's move cap (5th-slot item aware).
 *
 * On success the store (or, for the base form, the mon's live `moveset`) is updated,
 * and if the form is the one currently active on the field its live moveset updates too.
 */
export function learnMoveForEvolution(
  mon: Pokemon,
  form: OmniformTarget,
  moveId: MoveId,
  slot: number,
): OmniformLearnResult {
  if (!isErOmniformMon(mon)) {
    return { ok: false, reason: "not-omniform" };
  }
  if (!isFamilyForm(mon, form)) {
    return { ok: false, reason: "not-in-family" };
  }
  if (!canFormLearnMove(form, moveId)) {
    return { ok: false, reason: "not-learnable" };
  }
  const maxSlots = mon.getMaxMoveCount();
  if (slot < 0 || slot >= maxSlots) {
    return { ok: false, reason: "bad-slot" };
  }
  const base = omniformBaseIdentity(mon);

  if (isBaseForm(form, base)) {
    if (mon.moveset.some(m => m.moveId === moveId)) {
      return { ok: false, reason: "already-known" };
    }
    mon.setMove(slot, moveId);
    return { ok: true };
  }

  const entry = getOrRollFormMoveset(mon, form);
  if (entry.some(([m]) => m === moveId)) {
    return { ok: false, reason: "already-known" };
  }
  while (entry.length <= slot) {
    entry.push([MoveId.NONE, 0]);
  }
  entry[slot] = [moveId, 0];

  // If this evolution is the one currently on the field, mirror the write live so the
  // change is visible immediately (mid-battle teach via a learner item).
  const current = mon.getSpeciesForm();
  if (current.speciesId === form.speciesId && current.formIndex === form.formIndex && mon.summonData.moveset) {
    while (mon.summonData.moveset.length <= slot) {
      mon.summonData.moveset.push(new PokemonMove(MoveId.NONE));
    }
    mon.summonData.moveset[slot] = new PokemonMove(moveId);
  }
  return { ok: true };
}

/** One evolution's offer for a given move, for the level-up batch panel / TM UI. */
export interface OmniformEvolutionOffer {
  /** The evolution form this offer is for. */
  form: OmniformTarget;
  /** Whether this evolution can legally learn the move AND does not already know it. */
  canLearn: boolean;
  /** Whether this evolution already has the move (so it is offered but greyed / disabled). */
  alreadyKnown: boolean;
  /** Whether the move is in this evolution species' learnable set at all. */
  learnable: boolean;
}

/**
 * For a move being offered (a level-up teach, a TM, a shroom move), list EVERY
 * evolution in `mon`'s family and whether each can take it. This is what phase 2's
 * extended batch level-up panel consumes: level-up move offers are expanded PER
 * evolution (not in total), so the player can teach e.g. Flamethrower to the base
 * form AND, independently, to Flareon — but never to the same evolution twice.
 */
export function listOmniformEvolutionsForMove(mon: Pokemon, moveId: MoveId): OmniformEvolutionOffer[] {
  if (!isErOmniformMon(mon)) {
    return [];
  }
  const base = omniformBaseIdentity(mon);
  return erOmniformFamilyForms(base.speciesId, base.formIndex).map(form => {
    const learnable = canFormLearnMove(form, moveId);
    const known = isBaseForm(form, base)
      ? mon.moveset.some(m => m.moveId === moveId)
      : getOrRollFormMoveset(mon, form).some(([m]) => m === moveId);
    return { form, learnable, alreadyKnown: known, canLearn: learnable && !known };
  });
}

/** The ordered evolution forms of `mon`'s Omniform family (base first). Empty for non-Omniform mons. */
export function omniformFamilyForms(mon: Pokemon): OmniformTarget[] {
  if (!isErOmniformMon(mon)) {
    return [];
  }
  const base = omniformBaseIdentity(mon);
  return erOmniformFamilyForms(base.speciesId, base.formIndex);
}

/** Re-export for consumers that need the resolved species form of an evolution offer. */
export function omniformFormSpeciesForm(form: OmniformTarget): PokemonSpeciesForm {
  return resolveForm(form);
}

export type { OmniformTarget };
