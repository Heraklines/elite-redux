/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Ghost Trainer FX catalog (cosmetic entrance + aura effects).
//
// Players spend ACHIEVEMENT POINTS (the spendable balance = derived earnedScore
// minus a persisted spentAchvPoints counter; see game-data.ts) to unlock:
//   - an ENTRANCE effect: how their ghost trainer arrives on the field at the
//     start of an encounter (encounter-phase tween), and
//   - an AURA effect: an FX overlay rendered around the trainer sprite during
//     the encounter (er-trainer-aura-fx.ts, reusing the Shiny Lab pixel pipeline).
//
// Ownership + equipped picks live on the SYSTEM save as `TrainerFxSaveData`
// (modeled on ErShinyLabSaveData: owned bitsets + equipped indexes). When the
// player publishes their ghost (Ghost Trainer Editor), the equipped picks are
// folded onto `GhostTrainerProfile` (approach / aura / showAuraInBattle) so they
// ride along on every published ghost and OTHER players see them on encounter.
//
// This is a dependency-light catalog: it only imports the GhostApproachEffect
// TYPE from er-ghost-profile (type-only, erased) plus the shared bitset helpers
// from er-shiny-lab-effects, so there is no runtime import cycle.
// =============================================================================

import {
  hasErShinyLabBit,
  normalizeErShinyLabBitset,
  setErShinyLabBit,
} from "#data/elite-redux/er-shiny-lab-effects";
import type { GhostApproachEffect } from "#data/elite-redux/er-ghost-profile";

/** One unlockable ghost-trainer ENTRANCE effect. */
export interface TrainerEntranceEffect {
  /** Stable catalog id (drives the owned-bit index; never reordered). */
  id: string;
  /** Player-facing label (plain English; mirrored in locales/en/ghost-trainer-fx.json). */
  label: string;
  /** Achievement-point cost to unlock. */
  cost: number;
  /** The {@linkcode GhostApproachEffect} serialized onto the published profile. */
  approach: GhostApproachEffect;
}

/** One unlockable ghost-trainer AURA effect (id reuses an existing AROUND shader id). */
export interface TrainerAuraEffect {
  /** AROUND shader id (also stored verbatim in `GhostTrainerProfile.aura`). */
  id: string;
  /** Player-facing label. */
  label: string;
  /** Achievement-point cost to unlock. */
  cost: number;
}

/**
 * The 6 entrance effects. SHADOW_STEP -> the pre-existing `fromShadow` approach
 * and DESCEND_FROM_ABOVE -> the pre-existing `fromAbove`; the other four map to
 * approach members added in er-ghost-profile.ts.
 */
export const TRAINER_ENTRANCE_EFFECTS: readonly TrainerEntranceEffect[] = [
  { id: "riseFromGround", label: "Rise From Ground", cost: 700, approach: "riseFromGround" },
  { id: "fogMaterialize", label: "Fog Materialize", cost: 700, approach: "fogMaterialize" },
  { id: "flashIn", label: "Flash In", cost: 700, approach: "flashIn" },
  { id: "shadowStep", label: "Shadow Step", cost: 500, approach: "fromShadow" },
  { id: "descendFromAbove", label: "Descend From Above", cost: 500, approach: "fromAbove" },
  { id: "reverseDissolve", label: "Reverse Dissolve", cost: 500, approach: "reverseDissolve" },
] as const;

/**
 * The 8 aura effects. Every id MUST exist in AROUND / AROUND_IDS
 * (er-shiny-lab-fx.ts / er-shiny-lab-effects.ts) - the trainer aura overlay
 * renders the exact same "around" shader the Shiny Lab uses on Pokemon.
 */
export const TRAINER_AURA_EFFECTS: readonly TrainerAuraEffect[] = [
  { id: "smoke", label: "Smoke", cost: 1000 },
  { id: "embers", label: "Embers", cost: 1000 },
  { id: "frost", label: "Frost", cost: 1000 },
  { id: "shadowaura", label: "Shadow Aura", cost: 1000 },
  { id: "goldenglow", label: "Golden Glow", cost: 1250 },
  { id: "holyrays", label: "Holy Rays", cost: 1250 },
  { id: "cosmos", label: "Cosmos", cost: 1250 },
  { id: "sparkstorm", label: "Spark Storm", cost: 1250 },
] as const;

const ENTRANCE_BY_ID = new Map(TRAINER_ENTRANCE_EFFECTS.map(e => [e.id, e]));
const ENTRANCE_BY_APPROACH = new Map(TRAINER_ENTRANCE_EFFECTS.map(e => [e.approach, e]));
const AURA_BY_ID = new Map(TRAINER_AURA_EFFECTS.map(e => [e.id, e]));

/** Known aura id set (the trustworthy whitelist used by the profile sanitizer). */
export const TRAINER_AURA_IDS: ReadonlySet<string> = new Set(TRAINER_AURA_EFFECTS.map(e => e.id));

/** True if `id` is a known trainer aura id. Used to clamp an untrusted peer's profile. */
export function isKnownTrainerAuraId(id: unknown): id is string {
  return typeof id === "string" && TRAINER_AURA_IDS.has(id);
}

export function getTrainerEntranceById(id: string | null | undefined): TrainerEntranceEffect | null {
  return id ? (ENTRANCE_BY_ID.get(id) ?? null) : null;
}

export function getTrainerEntranceByApproach(
  approach: GhostApproachEffect | null | undefined,
): TrainerEntranceEffect | null {
  return approach ? (ENTRANCE_BY_APPROACH.get(approach) ?? null) : null;
}

export function getTrainerAuraById(id: string | null | undefined): TrainerAuraEffect | null {
  return id ? (AURA_BY_ID.get(id) ?? null) : null;
}

// =============================================================================
// Save struct (modeled on ErShinyLabSaveData - owned bitsets + equipped indexes).
// Equipped index encoding: 0 = none, N = registry index N - 1 (matches the Shiny
// Lab loadout encoding so an absent/0 value is always "nothing equipped").
// =============================================================================

export interface TrainerFxSaveData {
  /** Owned entrance-effect bitset (bit index = TRAINER_ENTRANCE_EFFECTS index). */
  e?: number[];
  /** Owned aura-effect bitset (bit index = TRAINER_AURA_EFFECTS index). */
  a?: number[];
  /** Equipped entrance index, 0 = none else registry index + 1. */
  le?: number;
  /** Equipped aura index, 0 = none else registry index + 1. */
  la?: number;
}

export function trainerFxEntranceIndex(id: string): number {
  return TRAINER_ENTRANCE_EFFECTS.findIndex(e => e.id === id);
}

export function trainerFxAuraIndex(id: string): number {
  return TRAINER_AURA_EFFECTS.findIndex(e => e.id === id);
}

export function isTrainerEntranceOwned(save: TrainerFxSaveData | undefined, id: string): boolean {
  const index = trainerFxEntranceIndex(id);
  return index >= 0 && hasErShinyLabBit(save?.e, index);
}

export function isTrainerAuraOwned(save: TrainerFxSaveData | undefined, id: string): boolean {
  const index = trainerFxAuraIndex(id);
  return index >= 0 && hasErShinyLabBit(save?.a, index);
}

export function setTrainerEntranceOwned(save: TrainerFxSaveData, id: string): void {
  const index = trainerFxEntranceIndex(id);
  if (index >= 0) {
    save.e = setErShinyLabBit(save.e, index);
  }
}

export function setTrainerAuraOwned(save: TrainerFxSaveData, id: string): void {
  const index = trainerFxAuraIndex(id);
  if (index >= 0) {
    save.a = setErShinyLabBit(save.a, index);
  }
}

/** The currently-equipped entrance effect (null = default slide-in). */
export function getEquippedTrainerEntrance(save: TrainerFxSaveData | undefined): TrainerEntranceEffect | null {
  const value = save?.le ?? 0;
  return value > 0 ? (TRAINER_ENTRANCE_EFFECTS[value - 1] ?? null) : null;
}

/** The currently-equipped aura effect (null = no aura). */
export function getEquippedTrainerAura(save: TrainerFxSaveData | undefined): TrainerAuraEffect | null {
  const value = save?.la ?? 0;
  return value > 0 ? (TRAINER_AURA_EFFECTS[value - 1] ?? null) : null;
}

/** Equip an entrance effect by id (or null to clear). Caller guarantees ownership. */
export function setEquippedTrainerEntrance(save: TrainerFxSaveData, id: string | null): void {
  const index = id ? trainerFxEntranceIndex(id) : -1;
  save.le = index >= 0 ? index + 1 : 0;
}

/** Equip an aura effect by id (or null to clear). Caller guarantees ownership. */
export function setEquippedTrainerAura(save: TrainerFxSaveData, id: string | null): void {
  const index = id ? trainerFxAuraIndex(id) : -1;
  save.la = index >= 0 ? index + 1 : 0;
}

// =============================================================================
// Entrance tween. The default (and every non-ghost trainer) keeps the vanilla
// +300 x-slide; an equipped entrance varies HOW the trainer arrives but ALWAYS
// ends at the same final state (x = startX + 300, y = startY, alpha = 1) so the
// downstream reveal / summon logic is unaffected. The trainer is pre-positioned
// to a custom START state, then this tween settles it to the end state. Mirrors
// the mystery-encounter introVisuals tween (a fire-and-forget parallel tween).
// =============================================================================

/** The horizontal slide distance the vanilla encounter applies to the enemy side. */
export const TRAINER_ENTRANCE_SLIDE_X = 300;

interface EntranceArrival {
  x: number;
  y: number;
  alpha: number;
}

/**
 * Pre-position `trainer` for the given entrance effect and return the tween
 * config that settles it onto the field. `arrival` is the trainer's intended
 * final state (the same end state the vanilla slide produces).
 */
export function buildTrainerEntranceTween(
  trainer: Phaser.GameObjects.Container | Phaser.GameObjects.Sprite,
  approach: GhostApproachEffect | undefined,
  arrival: EntranceArrival,
): Phaser.Types.Tweens.TweenBuilderConfig {
  const base: Phaser.Types.Tweens.TweenBuilderConfig = {
    targets: trainer,
    x: arrival.x,
    y: arrival.y,
    alpha: arrival.alpha,
    duration: 2000,
  };
  switch (approach) {
    case "fromAbove":
    case "riseFromGround": {
      // Descend from above / rise from below: no horizontal slide, settle vertically.
      const dy = approach === "fromAbove" ? -120 : 90;
      trainer.x = arrival.x;
      trainer.y = arrival.y + dy;
      trainer.setAlpha(0);
      return { ...base, duration: 1300, ease: approach === "fromAbove" ? "Bounce.easeOut" : "Back.easeOut" };
    }
    case "flashIn":
      // Snap into place, then a quick alpha pop.
      trainer.x = arrival.x;
      trainer.y = arrival.y;
      trainer.setAlpha(0);
      return { ...base, duration: 350, ease: "Cubic.easeIn" };
    case "fogMaterialize":
    case "reverseDissolve":
      // Materialize in place (alpha fade), no slide.
      trainer.x = arrival.x;
      trainer.y = arrival.y;
      trainer.setAlpha(0);
      return { ...base, duration: approach === "fogMaterialize" ? 1800 : 1500, ease: "Sine.easeInOut" };
    case "fromShadow":
      // Emerge from a shadow: in place, faint -> full.
      trainer.x = arrival.x;
      trainer.y = arrival.y;
      trainer.setAlpha(0.12);
      return { ...base, duration: 1600, ease: "Sine.easeOut" };
    default:
      // Vanilla slide-in: the trainer keeps its current (pre-slide) x and slides
      // the +300 to its arrival x. y / alpha are already at the arrival values.
      return base;
  }
}

function clampEquipped(value: unknown, count: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > count) {
    return 0;
  }
  return value;
}

/**
 * Normalise an untrusted/loaded TrainerFxSaveData: clamp the owned bitsets to
 * bytes and the equipped indexes to the valid registry range. An equipped index
 * that points at a NOT-owned effect is cleared (so a tampered save can't equip a
 * locked effect). Returns `undefined` when nothing meaningful is set.
 */
export function sanitizeTrainerFxSaveData(raw: unknown): TrainerFxSaveData | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const out: TrainerFxSaveData = {};
  const e = normalizeErShinyLabBitset(Array.isArray(r.e) ? (r.e as number[]) : undefined);
  const a = normalizeErShinyLabBitset(Array.isArray(r.a) ? (r.a as number[]) : undefined);
  if (e.length > 0) {
    out.e = e;
  }
  if (a.length > 0) {
    out.a = a;
  }
  const le = clampEquipped(r.le, TRAINER_ENTRANCE_EFFECTS.length);
  const la = clampEquipped(r.la, TRAINER_AURA_EFFECTS.length);
  // Drop an equipped pick the player does not actually own.
  if (le > 0 && hasErShinyLabBit(out.e, le - 1)) {
    out.le = le;
  }
  if (la > 0 && hasErShinyLabBit(out.a, la - 1)) {
    out.la = la;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
