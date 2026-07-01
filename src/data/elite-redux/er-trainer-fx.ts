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

// =============================================================================
// FX tuning (two independent controls, mirrors the Shiny Lab speed / auraSize).
//   - speed: how FAST the entrance + aura play (a render-clock / duration factor).
//   - intensity: how STRONG they look (aura reach + amount, entrance drama depth).
// Both default to 1 (no change) and clamp to a sane band; a value of 1 reproduces
// the shipped behavior EXACTLY so old ghosts / non-tuned effects are unaffected.
// =============================================================================

export const TRAINER_FX_SPEED_MIN = 0.25;
export const TRAINER_FX_SPEED_MAX = 3;
export const TRAINER_FX_INTENSITY_MIN = 0.5;
export const TRAINER_FX_INTENSITY_MAX = 2;
/** Default tuning (1x) for both speed + intensity (no change to the shipped look). */
export const TRAINER_FX_DEFAULT_TUNING = 1;
/** LEFT/RIGHT adjustment step in the editor (a small 5% increment). */
export const TRAINER_FX_TUNING_STEP = 0.05;
/**
 * Base playback-speed factor applied to EVERY trainer FX (entrance + aura) on top of
 * the player's speed tuning. 0.4 means the default (100% slider) plays at 40% of the
 * raw effect speed (2.5x slower) for a calmer default; the slider still scales from
 * here (up to the 3x cap -> ~1.2x raw). Applied at render time only, so it also
 * slows already-published ghosts with a default (1x) tuning.
 */
export const TRAINER_FX_BASE_SPEED = 0.4;

/** Clamp an FX speed multiplier to its valid band; garbage / non-finite -> default 1. */
export function clampTrainerFxSpeed(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return TRAINER_FX_DEFAULT_TUNING;
  }
  return Math.max(TRAINER_FX_SPEED_MIN, Math.min(TRAINER_FX_SPEED_MAX, value));
}

/** Clamp an FX intensity multiplier to its valid band; garbage / non-finite -> default 1. */
export function clampTrainerFxIntensity(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return TRAINER_FX_DEFAULT_TUNING;
  }
  return Math.max(TRAINER_FX_INTENSITY_MIN, Math.min(TRAINER_FX_INTENSITY_MAX, value));
}

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
  /** Byte-quantized FX speed multiplier (0.25-3, default 1). Absent -> 1x. */
  fs?: number;
  /** Byte-quantized FX intensity multiplier (0.5-2, default 1). Absent -> 1x. */
  fi?: number;
}

const TRAINER_FX_SPEED_RANGE = TRAINER_FX_SPEED_MAX - TRAINER_FX_SPEED_MIN;
const TRAINER_FX_INTENSITY_RANGE = TRAINER_FX_INTENSITY_MAX - TRAINER_FX_INTENSITY_MIN;

/** Clamp to a byte (0-255) like the Shiny Lab quantizer. */
function toTrainerFxByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Byte-quantize an FX speed multiplier (clamped to band first) for the save. */
export function encodeTrainerFxSpeed(speed: number): number {
  return toTrainerFxByte(((clampTrainerFxSpeed(speed) - TRAINER_FX_SPEED_MIN) / TRAINER_FX_SPEED_RANGE) * 255);
}

/** Decode a byte-quantized FX speed multiplier (absent -> default 1x). */
export function decodeTrainerFxSpeed(byteValue: number | undefined): number {
  if (byteValue === undefined) {
    return TRAINER_FX_DEFAULT_TUNING;
  }
  return TRAINER_FX_SPEED_MIN + (toTrainerFxByte(byteValue) / 255) * TRAINER_FX_SPEED_RANGE;
}

/** Byte-quantize an FX intensity multiplier (clamped to band first) for the save. */
export function encodeTrainerFxIntensity(intensity: number): number {
  return toTrainerFxByte(
    ((clampTrainerFxIntensity(intensity) - TRAINER_FX_INTENSITY_MIN) / TRAINER_FX_INTENSITY_RANGE) * 255,
  );
}

/** Decode a byte-quantized FX intensity multiplier (absent -> default 1x). */
export function decodeTrainerFxIntensity(byteValue: number | undefined): number {
  if (byteValue === undefined) {
    return TRAINER_FX_DEFAULT_TUNING;
  }
  return TRAINER_FX_INTENSITY_MIN + (toTrainerFxByte(byteValue) / 255) * TRAINER_FX_INTENSITY_RANGE;
}

/** The stored FX speed multiplier for a save (default 1x when unset). */
export function getTrainerFxSpeed(save: TrainerFxSaveData | undefined): number {
  return decodeTrainerFxSpeed(save?.fs);
}

/** The stored FX intensity multiplier for a save (default 1x when unset). */
export function getTrainerFxIntensity(save: TrainerFxSaveData | undefined): number {
  return decodeTrainerFxIntensity(save?.fi);
}

/** Persist the FX speed multiplier onto a save (byte-quantized, clamped). */
export function setTrainerFxSpeed(save: TrainerFxSaveData, speed: number): void {
  save.fs = encodeTrainerFxSpeed(speed);
}

/** Persist the FX intensity multiplier onto a save (byte-quantized, clamped). */
export function setTrainerFxIntensity(save: TrainerFxSaveData, intensity: number): void {
  save.fi = encodeTrainerFxIntensity(intensity);
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

/** Optional per-entrance FX tuning (see clampTrainerFxSpeed / clampTrainerFxIntensity). */
export interface TrainerFxTuning {
  /** Playback speed multiplier (higher = faster; divides the tween duration). */
  speed?: number | undefined;
  /** Drama multiplier (scales the START motion distance + squash depth). */
  intensity?: number | undefined;
}

/**
 * Pre-position `trainer` for the given entrance effect and return the tween
 * config that settles it onto the field. `arrival` is the trainer's intended
 * final state (the same end state the vanilla slide produces).
 *
 * `tuning.speed` divides the tween DURATION (higher = faster) and `tuning.intensity`
 * scales the START deviation from `arrival` (motion distance + squash depth). The END
 * state is ALWAYS `arrival` (x/y/alpha/scaleX=sx/scaleY=sy) regardless of tuning, so
 * the downstream reveal / summon logic is unaffected. Tuning of 1x (or omitted)
 * reproduces the shipped entrance EXACTLY.
 */
export function buildTrainerEntranceTween(
  trainer: Phaser.GameObjects.Container | Phaser.GameObjects.Sprite,
  approach: GhostApproachEffect | undefined,
  arrival: EntranceArrival,
  tuning?: TrainerFxTuning,
): Phaser.Types.Tweens.TweenBuilderConfig {
  // Capture the trainer's natural scale so every entrance can squash/pop and
  // ALWAYS settle back to it (the end state stays x/y/alpha/scale = arrival).
  const sx = trainer.scaleX;
  const sy = trainer.scaleY;
  const speed = TRAINER_FX_BASE_SPEED * clampTrainerFxSpeed(tuning?.speed);
  const intensity = clampTrainerFxIntensity(tuning?.intensity);
  const base: Phaser.Types.Tweens.TweenBuilderConfig = {
    targets: trainer,
    x: arrival.x,
    y: arrival.y,
    alpha: arrival.alpha,
    scaleX: sx,
    scaleY: sy,
    duration: 2000,
  };

  // Pre-position the trainer to a dramatic START state and return the settle tween.
  // `dx`/`dy` are the base offset from arrival (scaled by intensity); `fx`/`fy` are the
  // base start-scale factors relative to natural scale (their deviation from 1 scaled by
  // intensity, floored so a high intensity can't invert the sprite). `duration` is divided
  // by speed. The END state is `base` (= arrival), untouched by tuning.
  const settle = (spec: {
    dx?: number;
    dy?: number;
    fx?: number;
    fy?: number;
    alpha: number;
    duration: number;
    ease: string;
  }): Phaser.Types.Tweens.TweenBuilderConfig => {
    trainer.x = arrival.x + (spec.dx ?? 0) * intensity;
    trainer.y = arrival.y + (spec.dy ?? 0) * intensity;
    trainer.setScale(
      sx * Math.max(0.05, 1 + ((spec.fx ?? 1) - 1) * intensity),
      sy * Math.max(0.05, 1 + ((spec.fy ?? 1) - 1) * intensity),
    );
    trainer.setAlpha(spec.alpha);
    return { ...base, duration: Math.max(1, Math.round(spec.duration / speed)), ease: spec.ease };
  };

  switch (approach) {
    case "riseFromGround":
      // Burst up from well below the field, squashed flat, overshooting as it
      // stretches to full height on the way out of the ground.
      return settle({ dy: 190, fx: 1.12, fy: 0.4, alpha: 0, duration: 1150, ease: "Back.easeOut" });
    case "fromAbove":
      // Plummet from high above and BOUNCE on landing.
      return settle({ dy: -280, alpha: 1, duration: 1250, ease: "Bounce.easeOut" });
    case "flashIn":
      // Pop into existence oversized + invisible, snapping down hard and fast.
      return settle({ fx: 1.7, fy: 1.7, alpha: 0, duration: 240, ease: "Back.easeOut" });
    case "fogMaterialize":
      // Swell in from a small, low, drifting haze.
      return settle({ dy: 26, fx: 0.8, fy: 0.8, alpha: 0, duration: 1700, ease: "Sine.easeOut" });
    case "reverseDissolve":
      // Shimmer up from a slightly oversized, transparent ghost.
      return settle({ fx: 1.14, fy: 1.14, alpha: 0, duration: 1300, ease: "Cubic.easeInOut" });
    case "fromShadow":
      // Slink up out of a flattened shadow puddle (very squashed + faint -> full).
      return settle({ dy: 34, fx: 1.18, fy: 0.28, alpha: 0.18, duration: 1400, ease: "Back.easeOut" });
    default:
      // Vanilla slide-in: the trainer keeps its current (pre-slide) x and slides
      // the +300 to its arrival x. y / alpha / scale are already at arrival.
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
  // FX tuning: keep the byte-quantized speed / intensity when present + numeric (clamped to a
  // byte). An absent value decodes to the default 1x, so old saves are unaffected.
  if (typeof r.fs === "number" && Number.isFinite(r.fs)) {
    out.fs = toTrainerFxByte(r.fs);
  }
  if (typeof r.fi === "number" && Number.isFinite(r.fi)) {
    out.fi = toTrainerFxByte(r.fi);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
