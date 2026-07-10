/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D Task D4: archetype-classifier → Move-side wiring
// dispatcher. Translates `ER_MOVE_ARCHETYPES` rows (which carry flat
// classifier-emitted JSON params) into:
//   - A bitmask of `MoveFlags` to OR onto the Move's `flags` field.
//   - A list of constructed `MoveAttr` instances ready to be attached via
//     `Move.addAttr(...)`.
//
// Why a dispatcher and not direct construction at the init site?
//
//   The classifier's emitted params are deliberately classifier-shaped — flat
//   strings (e.g. `flags: ["STRONG_JAW"]`), JSON-only types (no `MoveFlags`
//   bits), and sub-shape vocabulary that doesn't exactly match pokerogue's
//   typed attr constructors. Translating happens here ONCE, in a single
//   switch, so the init site stays small and the per-archetype quirks are
//   localized. Mirrors the D3 ability-side dispatcher.
//
// Skip semantics
//
//   This dispatcher is conservative: when the classifier emitted a shape we
//   can't faithfully translate, we return what we CAN build (e.g. flags but
//   no status attr, or vice versa) plus a `skipReason` for diagnostics.
//   When an entire row can't be wired, we return `flags: 0, attrs: []` and
//   a non-null `skipReason`.
//
// Bespoke skip
//
//   `bespoke` entries have `params: null` and need hand-written wiring — they
//   are the long-tail moves whose behavior doesn't fit any archetype shape.
//   The D4 bespoke-implementation task wires them; this dispatcher returns a
//   `skipReason` for visibility.
//
// MoveFlag setting
//
//   `Move`'s `setFlag` method is private. Rather than refactoring the Move
//   constructor flow, the init site uses a thin subclass that exposes a
//   public `applyErFlags(flags: MoveFlags)` helper. This dispatcher returns
//   the bitmask to OR; the subclass does the OR. See `init-elite-redux-
//   custom-moves.ts` for the subclass `setErFlagBits` plumbing.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ER_CLASSIFIER_FLAG_TO_MOVE_FLAG } from "#data/elite-redux/er-flag-mapping";
import type { ErMoveArchetypeKind } from "#data/elite-redux/er-move-archetypes";
import {
  AddArenaTagAttr,
  AddArenaTrapTagAttr,
  AddBattlerTagAttr,
  ClearWeatherAttr,
  ConfuseAttr,
  ErRandomBerryEffectAttr,
  ErRetrieveConsumedItemAttr,
  ErStatusEffectIgnoreImmunityAttr,
  ErSuperEffectiveVsTypeAttr,
  ErSuppressAbilitiesInFogAttr,
  FlinchAttr,
  ForceSwitchOutAttr,
  HealUserAndAllyAttr,
  HitHealAttr,
  IgnoreOpponentStatStagesAttr,
  type Move,
  MoveAttr,
  MoveEffectAttr,
  MovePowerMultiplierAttr,
  MultiHitAttr,
  MultiHitPowerIncrementAttr,
  ProtectAttr,
  RecoilAttr,
  RemoveTypeAttr,
  SacrificialAttr,
  StatStageChangeAttr,
  StatusEffectAttr,
  SuppressAbilitiesAttr,
  TerrainChangeAttr,
  VariableMoveTypeAttr,
  WeatherChangeAttr,
} from "#data/moves/move";
import { failIfTargetNotAttackingCondition, type MoveCondition } from "#data/moves/move-condition";
import { TerrainType } from "#data/terrain";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MultiHitType } from "#enums/multi-hit-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { NumberHolder } from "#utils/common";

/**
 * Result of a single move-archetype-dispatch call. Carries a flag bitmask
 * (OR'd onto the Move's flags by the caller), a list of MoveAttr instances
 * (attached via `Move.addAttr(...)` by the caller), and a diagnostic reason
 * when one or both pieces couldn't be produced.
 */
export interface MoveDispatchResult {
  /** Bitmask of `MoveFlags` to OR onto the Move's flags field. `0` when no flags wire. */
  readonly flags: number;
  /** Constructed MoveAttr instances ready to attach via `Move.addAttr(...)`. */
  readonly attrs: readonly MoveAttr[];
  /**
   * Why dispatch produced zero flags AND zero attrs, if applicable. `null`
   * means dispatch produced at least one wire-up. A string means we
   * intentionally skipped — bespoke or shape we don't yet translate.
   * Surfaced in init diagnostics; not an error.
   */
  readonly skipReason: string | null;
}

const SKIP_BESPOKE: MoveDispatchResult = {
  flags: 0,
  attrs: [],
  skipReason: "bespoke entry; hand-written implementation pending",
};

/** Build a success result with flags and/or attrs. */
function ok(flags: number, attrs: MoveAttr[]): MoveDispatchResult {
  return { flags, attrs, skipReason: null };
}

/** Skip with a custom reason. */
function skip(reason: string): MoveDispatchResult {
  return { flags: 0, attrs: [], skipReason: reason };
}

/**
 * Helper: is `v` a plain object (Record<string, unknown>)? Used to safely
 * read nested params without crashing on null / arrays / primitives.
 */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Resolve a classifier-emitted flag-name string ("STRONG_JAW", "KEEN_EDGE",
 * "ARROW", …) to its `MoveFlags` bit value. Returns `0` (MoveFlags.NONE) for
 * unrecognised inputs or for ER concepts represented as `MoveAttr` rather
 * than a flag bit.
 *
 * Tries the pokerogue-native enum form first (e.g. `"SLICING_MOVE"`), then
 * falls back to the classifier-form mapping in `ER_CLASSIFIER_FLAG_TO_MOVE_FLAG`.
 */
function resolveFlagBit(name: string): number {
  // Direct pokerogue enum lookup first — covers names like "PUNCHING_MOVE",
  // "SLICING_MOVE", "DANCE_MOVE" if the classifier ever emits them.
  if (Object.hasOwn(MoveFlags, name)) {
    const v = (MoveFlags as unknown as Record<string, number>)[name];
    if (typeof v === "number" && v !== MoveFlags.NONE) {
      return v;
    }
  }
  // Classifier-form alias table (STRONG_JAW → BITING_MOVE, etc.).
  if (Object.hasOwn(ER_CLASSIFIER_FLAG_TO_MOVE_FLAG, name)) {
    const v = ER_CLASSIFIER_FLAG_TO_MOVE_FLAG[name];
    return v ?? 0;
  }
  return 0;
}

/**
 * Build a flag bitmask from a classifier `flags` array. Unrecognised entries
 * are silently dropped (the caller can detect this via a smaller-than-expected
 * bitmask if needed; we don't surface per-flag rejections to keep diagnostics
 * focused on per-row issues).
 */
function collectFlagBitmask(rawFlags: unknown): number {
  if (!Array.isArray(rawFlags)) {
    return 0;
  }
  let mask = 0;
  for (const raw of rawFlags) {
    if (typeof raw !== "string") {
      continue;
    }
    mask |= resolveFlagBit(raw);
  }
  return mask;
}

/**
 * Resolve a classifier-emitted status name to either a vanilla `StatusEffect`
 * or a `BattlerTagType` (battler-tag-flavoured statuses like FLINCH,
 * CONFUSION, INFATUATION). ER-specific statuses (`BLEED`, `FROSTBITE`, `FEAR`,
 * `DRENCH`) are routed to their backing ER battler tags; only unrecognised
 * names return `null` and the caller skips that piece.
 *
 * Returned discriminant:
 *  - `{ kind: "status", effect }` — a vanilla StatusEffect (POISON, BURN, …)
 *  - `{ kind: "tag", tag }` — a vanilla BattlerTagType (FLINCHED, CONFUSED, …)
 *  - `null` — ER-specific or unrecognised
 */
type ResolvedStatus =
  | { readonly kind: "status"; readonly effect: StatusEffect }
  | { readonly kind: "tag"; readonly tag: BattlerTagType };
function resolveStatusName(raw: string): ResolvedStatus | null {
  // Vanilla StatusEffect enum first.
  if (Object.hasOwn(StatusEffect, raw)) {
    const v = (StatusEffect as unknown as Record<string, number>)[raw];
    if (typeof v === "number" && v !== StatusEffect.NONE) {
      return { kind: "status", effect: v as StatusEffect };
    }
  }
  // Classifier aliases for tag-like statuses.
  switch (raw) {
    case "FLINCH":
      return { kind: "tag", tag: BattlerTagType.FLINCHED };
    case "CONFUSION":
      return { kind: "tag", tag: BattlerTagType.CONFUSED };
    case "INFATUATION":
      return { kind: "tag", tag: BattlerTagType.INFATUATED };
    case "CURSE":
      return { kind: "tag", tag: BattlerTagType.CURSED };
    case "DROWSY":
      return { kind: "tag", tag: BattlerTagType.DROWSY };
    // ER-specific statuses backed by ER battler tags (chip/flinch/trap effects
    // implemented in battler-tags.ts). Routing them here lets chance-status-on-hit
    // moves (e.g. Chiller's 10% frostbite) actually apply them.
    case "FROSTBITE":
      return { kind: "tag", tag: BattlerTagType.ER_FROSTBITE };
    case "BLEED":
      return { kind: "tag", tag: BattlerTagType.ER_BLEED };
    case "FEAR":
      return { kind: "tag", tag: BattlerTagType.ER_FEAR };
    case "DRENCH":
      return { kind: "tag", tag: BattlerTagType.ER_DRENCHED };
    default:
      return null;
  }
}

/**
 * Build a MoveAttr (or attrs) for a `statusChance` payload — either a vanilla
 * `StatusEffectAttr` or a `BattlerTag`-flavoured `AddBattlerTagAttr`. Returns
 * an empty array when the status name isn't translatable; the caller decides
 * whether to skip the whole row or proceed with flags-only.
 *
 * Note: the `chance` field on the payload is intentionally NOT applied here.
 * pokerogue routes secondary-effect chance via the parent `Move.chance` field
 * which is set at construction time from the ER draft's `effectChance`. Both
 * `StatusEffectAttr` and `AddBattlerTagAttr` honour `move.chance` via
 * `getMoveChance`. The dispatcher's `statusChance.chance` is therefore
 * informational only.
 */
function buildStatusAttrs(statusName: string): MoveAttr[] {
  const resolved = resolveStatusName(statusName);
  if (resolved === null) {
    return [];
  }
  if (resolved.kind === "status") {
    return [new StatusEffectAttr(resolved.effect, false)];
  }
  // tag — use the vanilla helpers when available, otherwise generic AddBattlerTagAttr.
  switch (resolved.tag) {
    case BattlerTagType.FLINCHED:
      return [new FlinchAttr()];
    case BattlerTagType.CONFUSED:
      return [new ConfuseAttr(false)];
    // CurseAttr is the move-specific implementation for the move Curse; for
    // generic "apply cursed tag" usage as a secondary effect we route through
    // AddBattlerTagAttr (CurseAttr has bespoke ghost-vs-non-ghost branching
    // that doesn't fit a passive secondary).
    default:
      return [new AddBattlerTagAttr(resolved.tag, false)];
  }
}

// =============================================================================
// Per-archetype dispatchers
// =============================================================================

/**
 * Dispatch a `flag-tagged-move` classifier row. Resolves the `flags` array to
 * a `MoveFlags` bitmask and, when a `statusChance` is present, builds the
 * appropriate `StatusEffectAttr` / `AddBattlerTagAttr`. Skips if NEITHER
 * piece wires.
 */
function dispatchFlagTaggedMove(params: Record<string, unknown>): MoveDispatchResult {
  const flagsMask = collectFlagBitmask(params.flags);
  const attrs: MoveAttr[] = [];
  if (isObject(params.statusChance)) {
    const statusName = params.statusChance.status;
    if (typeof statusName === "string") {
      attrs.push(...buildStatusAttrs(statusName));
    }
  }
  if (flagsMask === 0 && attrs.length === 0) {
    return skip(`flag-tagged-move: nothing to wire (flags=${JSON.stringify(params.flags)})`);
  }
  return ok(flagsMask, attrs);
}

/**
 * Dispatch a `chance-status-on-hit` classifier row. Builds the status-side
 * attr only; `Move.chance` (set at construction time from the ER draft's
 * `effectChance`) gates the proc.
 */
function dispatchChanceStatusOnHit(params: Record<string, unknown>): MoveDispatchResult {
  const statusName = params.status;
  if (typeof statusName !== "string") {
    return skip("chance-status-on-hit: missing status name");
  }
  const attrs = buildStatusAttrs(statusName);
  if (attrs.length === 0) {
    return skip(`chance-status-on-hit: unsupported status ${statusName}`);
  }
  return ok(0, attrs);
}

/**
 * Dispatch a `recoil-or-drain` classifier row. Modes:
 *  - `recoil` → `RecoilAttr(useHp=false, damageRatio=recoilPct)` — the
 *    pokerogue `RecoilAttr` charges recoil based on `damageDealt * damageRatio`.
 *  - `drain` → `HitHealAttr(healRatio=drainPct)` — heals user a fraction of
 *    damage dealt.
 */
function dispatchRecoilOrDrain(params: Record<string, unknown>): MoveDispatchResult {
  const mode = params.mode;
  if (mode === "recoil") {
    const pct = params.recoilPct;
    if (typeof pct !== "number" || pct <= 0 || pct > 1) {
      return skip("recoil-or-drain recoil: missing/invalid recoilPct");
    }
    return ok(MoveFlags.RECKLESS_MOVE, [new RecoilAttr(false, pct, false)]);
  }
  if (mode === "drain") {
    const pct = params.drainPct;
    if (typeof pct !== "number" || pct <= 0 || pct > 1) {
      return skip("recoil-or-drain drain: missing/invalid drainPct");
    }
    return ok(MoveFlags.TRIAGE_MOVE, [new HitHealAttr(pct)]);
  }
  return skip(`recoil-or-drain: unknown mode ${String(mode)}`);
}

/**
 * Helper: pick the most effective type for a user against the current target
 * out of the candidate `types`. Falls back to the first candidate if no
 * effectiveness data is available (e.g. simulated move-gen contexts).
 */
function pickBestEffectivenessType(user: Pokemon, target: Pokemon, types: readonly PokemonType[]): PokemonType {
  // No concrete target (e.g. weather move-type checks call getMoveType with a
  // null target) — there's no effectiveness data, so use the first candidate.
  if (!target) {
    return types[0];
  }
  let bestType: PokemonType = types[0];
  let bestMult = Number.NEGATIVE_INFINITY;
  for (const t of types) {
    const mult = target.getAttackTypeEffectiveness(t, { source: user });
    if (mult > bestMult) {
      bestMult = mult;
      bestType = t;
    }
  }
  return bestType;
}

/**
 * Custom `VariableMoveTypeAttr` for the ER "best effectiveness chooser" type
 * pattern (e.g. Aqua/Lava Crest, Crystal Beam). At runtime, the move's
 * type morphs to whichever of the configured candidate types deals the
 * highest type-effectiveness multiplier against the current target.
 *
 * Pokerogue's apply-attrs pipeline calls this with `args[0]` as a
 * `NumberHolder` containing the move's current resolved type; we mutate it.
 *
 * For movegen / item-spawn purposes, returns the first candidate as a stable
 * approximation (we don't know the target context there).
 */
export class BestEffectivenessTypeAttr extends VariableMoveTypeAttr {
  private readonly candidates: readonly PokemonType[];

  constructor(candidates: readonly PokemonType[]) {
    super();
    this.candidates = candidates;
  }

  override apply(user: Pokemon, target: Pokemon, _move: Move, args: any[]): boolean {
    const holder = args[0];
    if (!(holder instanceof NumberHolder)) {
      return false;
    }
    if (this.candidates.length === 0) {
      return false;
    }
    // `getMoveType` is also invoked outside real targeting (e.g. weather
    // cancellation checks) with a null target; fall back to the first candidate
    // there instead of dereferencing null.
    if (!target) {
      holder.value = this.candidates[0];
      return true;
    }
    holder.value = pickBestEffectivenessType(user, target, this.candidates);
    return true;
  }

  override getTypesForItemSpawn(_user: Pokemon, _move: Move): PokemonType[] {
    return [...this.candidates];
  }

  override getTypeForMovegen(_user: Pokemon, move: Move): PokemonType {
    return this.candidates[0] ?? move.type;
  }
}

/**
 * Sentinel `MoveAttr` that contributes a `MoveCondition` (via `getCondition()`)
 * but has no apply-side effect. Used to attach pre-built move conditions
 * (e.g. {@linkcode failIfTargetNotAttackingCondition} for Sucker Punch-style
 * moves) through the dispatcher's flags+attrs pipeline.
 *
 * Pokerogue's `Move.addAttr(...)` automatically reads `attr.getCondition()`
 * and pushes the resulting condition onto the Move's `conditions` array, so
 * this attr acts as a transport for the condition without doing any work in
 * its `apply()` method.
 */
export class MoveConditionAttr extends MoveAttr {
  private readonly condition: MoveCondition;

  constructor(condition: MoveCondition) {
    super();
    this.condition = condition;
  }

  override getCondition(): MoveCondition {
    return this.condition;
  }
}

/**
 * Move effect that raises the USER's highest offensive/defensive stat
 * ({@linkcode Stat.ATK}/{@linkcode Stat.DEF}/{@linkcode Stat.SPATK}/
 * {@linkcode Stat.SPDEF}, ties → first listed) by one stage after the move
 * connects. ER's `Banished Power` shape ("raises the user's highest attack or
 * defense by 1"). Pokerogue has no built-in "raise highest stat" move attr, so
 * we resolve the stat at apply-time and enqueue a self-targeted
 * `StatStageChangePhase`.
 */
export class RaiseHighestOffenseDefenseStatAttr extends MoveEffectAttr {
  constructor() {
    super(true); // selfTarget
  }

  override apply(user: Pokemon, target: Pokemon, move: Move, args?: any[]): boolean {
    if (!super.apply(user, target, move, args)) {
      return false;
    }
    const candidates = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF] as const;
    let best: (typeof candidates)[number] = candidates[0];
    for (const s of candidates) {
      if (user.getStat(s, false) > user.getStat(best, false)) {
        best = s;
      }
    }
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", user.getBattlerIndex(), true, [best], 1);
    return true;
  }
}

/**
 * ER Pitfall (937): "30% chance to TRAP the target AND make attacks always hit
 * it." Both effects share a SINGLE `move.chance` roll — either both land or
 * neither. The previous wiring used two independent `AddBattlerTagAttr`s, each
 * rolling `move.chance` separately (P(both) ~= 9%, and frequently only one of
 * the two applied). This attr rolls once and, on success, applies both
 * `TRAPPED` (4-5 turns) and `ALWAYS_GET_HIT` together.
 */
export class PitfallTrapAndAlwaysHitAttr extends MoveEffectAttr {
  constructor() {
    super(false); // targets the foe
  }

  override apply(user: Pokemon, target: Pokemon, move: Move, args?: any[]): boolean {
    if (!super.apply(user, target, move, args)) {
      return false;
    }
    // Single shared roll against the move's chance (30). A negative/100 chance
    // always applies, matching AddBattlerTagAttr's own gating.
    const moveChance = this.getMoveChance(user, target, move, this.selfTarget, true);
    if (moveChance >= 0 && moveChance !== 100 && user.randBattleSeedInt(100) >= moveChance) {
      return false;
    }
    const trapTurns = user.randBattleSeedIntRange(4, 5);
    const trapped = target.addTag(BattlerTagType.TRAPPED, trapTurns, move.id, user.id);
    const flagged = target.addTag(BattlerTagType.ALWAYS_GET_HIT, 0, move.id, user.id);
    return trapped || flagged;
  }
}

/**
 * Dispatch a `type-conversion` classifier row. The only mode the classifier
 * emits today is `best-effectiveness` with a candidate types array. The
 * status-chance sibling (if present) wires the same way as flag-tagged-move.
 */
function dispatchTypeConversion(params: Record<string, unknown>): MoveDispatchResult {
  if (params.mode !== "best-effectiveness") {
    return skip(`type-conversion: unsupported mode ${String(params.mode)}`);
  }
  if (!Array.isArray(params.types) || params.types.length === 0) {
    return skip("type-conversion: empty/missing types array");
  }
  const candidates: PokemonType[] = [];
  for (const raw of params.types) {
    if (typeof raw !== "string") {
      continue;
    }
    if (Object.hasOwn(PokemonType, raw)) {
      const v = (PokemonType as unknown as Record<string, number>)[raw];
      if (typeof v === "number") {
        candidates.push(v as PokemonType);
      }
    }
  }
  if (candidates.length === 0) {
    return skip("type-conversion: no valid types after resolution");
  }
  const attrs: MoveAttr[] = [new BestEffectivenessTypeAttr(candidates)];
  if (isObject(params.statusChance)) {
    const statusName = params.statusChance.status;
    if (typeof statusName === "string") {
      attrs.push(...buildStatusAttrs(statusName));
    }
  }
  return ok(0, attrs);
}

/**
 * Resolve a `statuses` string-array to the corresponding `StatusEffect` enum
 * values, silently dropping unrecognised entries.
 */
function collectStatusEffects(rawStatuses: readonly unknown[]): StatusEffect[] {
  const out: StatusEffect[] = [];
  for (const raw of rawStatuses) {
    if (typeof raw !== "string") {
      continue;
    }
    if (!Object.hasOwn(StatusEffect, raw)) {
      continue;
    }
    const v = (StatusEffect as unknown as Record<string, number>)[raw];
    if (typeof v === "number" && v !== StatusEffect.NONE) {
      out.push(v as StatusEffect);
    }
  }
  return out;
}

/**
 * Dispatch a `conditional-damage` classifier row. Currently the only emitted
 * shape is `condition: { kind: "self-statused", statuses: [...] }` with a
 * multiplier (e.g. ER's Facade analog deals 1.5x when self is BURN/POISON/
 * PARALYSIS). We wire this via `MovePowerMultiplierAttr` with a closure that
 * checks user.status at apply-time.
 */
function dispatchConditionalDamage(params: Record<string, unknown>): MoveDispatchResult {
  const multiplier = params.multiplier;
  if (typeof multiplier !== "number" || multiplier <= 0) {
    return skip("conditional-damage: missing/invalid multiplier");
  }
  if (!isObject(params.condition)) {
    return skip("conditional-damage: missing condition");
  }
  const cond = params.condition;
  if (cond.kind !== "self-statused") {
    return skip(`conditional-damage: unsupported condition kind ${String(cond.kind)}`);
  }
  if (!Array.isArray(cond.statuses) || cond.statuses.length === 0) {
    return skip("conditional-damage self-statused: missing statuses");
  }
  const wantedStatuses = collectStatusEffects(cond.statuses);
  if (wantedStatuses.length === 0) {
    return skip("conditional-damage self-statused: no valid statuses after resolution");
  }
  // Closure: when user.status matches any of the configured non-volatile
  // statuses, return multiplier; otherwise return 1 (no boost).
  const powerMultiplierFunc = (user: Pokemon, _target: Pokemon, _move: Move): number => {
    const effect = user.status?.effect;
    if (effect === undefined || effect === StatusEffect.NONE) {
      return 1;
    }
    return wantedStatuses.includes(effect) ? multiplier : 1;
  };
  return ok(0, [new MovePowerMultiplierAttr(powerMultiplierFunc)]);
}

/**
 * Per-id bespoke move wiring. Each case wires a single ER bespoke move id to
 * a list of pokerogue MoveAttr instances (composed from existing vanilla
 * primitives — no new MoveAttr classes needed) plus an optional MoveFlags
 * bitmask. Called from `dispatchMoveArchetype` when the row's archetype is
 * `bespoke` AND an `erMoveId` has been provided.
 *
 * Each wired id corresponds to an entry in
 * `docs/plans/elite-redux-bespoke-inventory.md` (the "Bespoke moves" table).
 * Unwired ids fall through to `SKIP_BESPOKE`.
 */
function dispatchBespokeMove(erMoveId: number): MoveDispatchResult {
  switch (erMoveId) {
    case 760:
      // Outburst — severe special damage, user faints (Explosion-style sacrifice).
      // Power 250 already on the draft; this attr just enforces the faint.
      return ok(0, [new SacrificialAttr()]);
    case 761:
      // Seismic Fist — 20% chance to drop foe's Def by 1. Punching-flagged so
      // Iron Fist / Raging Boxer (and other punch-boosting abilities) apply.
      // Move.chance (20) gates the proc via StatStageChangeAttr's getMoveChance().
      return ok(MoveFlags.PUNCHING_MOVE, [new StatStageChangeAttr([Stat.DEF], -1)]);
    case 769:
      // Primal Beam — 20% chance to raise user's Atk by 1 (selfTarget).
      // ER's "may rise own Atk" — Move.chance (20) gates the proc.
      return ok(0, [new StatStageChangeAttr([Stat.ATK], 1, true)]);
    case 788:
      // Jagged Punch — 10% chance to set Stealth Rocks on hit. Move.chance (10)
      // gates the proc. Punching-flagged so Iron Fist boost applies.
      return ok(MoveFlags.PUNCHING_MOVE, [new AddArenaTrapTagAttr(ArenaTagType.STEALTH_ROCK, 0, false, false)]);
    case 810:
      // Blood Shot — inflicts ER_BLEED via the dedicated battler tag (ER
      // models bleed as a battler tag, not a vanilla StatusEffect — see
      // BattlerTagType.ER_BLEED in `battler-tag-type.ts`). 4-6 turn duration
      // mirrors the cursed-bleed flavor.
      return ok(0, [new AddBattlerTagAttr(BattlerTagType.ER_BLEED, false, false, 4, 6)]);
    case 811:
      // Flash Freeze — inflicts ER_FROSTBITE via battler tag (same rationale
      // as ER_BLEED). The "never misses if user is Ice-type" piece is bespoke
      // and deferred — the 90% accuracy from the draft remains as-is.
      return ok(0, [new AddBattlerTagAttr(BattlerTagType.ER_FROSTBITE, false, false, 4, 6)]);
    case 822:
      // Energy Wave — pure damage move (115 BP, 90 acc, special, Normal).
      // ER description is "Deals damage." with NO secondary effect, so the move
      // is intentionally effect-less (base stats only). A previously-added
      // HighCritAttr was an unfaithful "flavor" embellishment — removed to match
      // the source.
      return ok(0, []);
    case 823:
      // Fluttering Leaf — deals damage and switches user out. ForceSwitchOutAttr
      // with selfSwitch=true matches U-Turn/Volt Switch semantics.
      return ok(0, [new ForceSwitchOutAttr(true)]);
    case 832:
      // Boiling Flame — "deals increased damage in rain". ONLY the WEATHER_BASED
      // flag is set here (so ER weather-syncing abilities pick it up); the actual
      // rain power boost is the x3 rider in applyErMoveBespokeRiders (case 832),
      // which nets ~1.5x after Fire's natural 0.5x rain halving. Wiring a boost
      // here too would double-apply it (~2.25x).
      return ok(MoveFlags.WEATHER_BASED, []);
    case 834:
      // Double Lariat — hits both foes (target field handles that), silences
      // hit targets via THROAT_CHOPPED tag (2 turn duration matches Throat
      // Chop's standard 2-turn lock-out).
      return ok(0, [new AddBattlerTagAttr(BattlerTagType.THROAT_CHOPPED, false, false, 2, 2)]);
    case 835:
      // Leech Blade — "Heals 50% of damage done. Keen Edge boost." A draining
      // slicing blade: the heal (HitHealAttr 0.5 + TRIAGE_MOVE) was previously
      // dropped — the move was wired as flag-tagged-move with only the KEEN_EDGE
      // (= SLICING_MOVE) flag, so it healed nothing. Wire both: the 50% drain and
      // the slicing flag (ER's "Keen Edge boost" = SLICING_MOVE, which the
      // rebalance pass grants +crit / 100% accuracy). The heal is a fraction of
      // damage actually dealt, so a kill on an already-weakened target heals less
      // (vanilla drain behaviour).
      return ok(MoveFlags.TRIAGE_MOVE | MoveFlags.SLICING_MOVE, [new HitHealAttr(0.5)]);
    case 836:
      // Yggdrasil Force — lowers user's Atk and Def by 1 each (unconditional).
      return ok(0, [new StatStageChangeAttr([Stat.ATK, Stat.DEF], -1, true)]);
    case 837:
      // Drain Brain — lowers target SpAtk and heals user by that amount.
      // Same shape as Strength Sap (HitHealAttr stat-based heal + StatStageChangeAttr).
      return ok(MoveFlags.TRIAGE_MOVE, [new HitHealAttr(null, Stat.SPATK), new StatStageChangeAttr([Stat.SPATK], -1)]);
    case 841:
      // Gem Missile — "+1 priority." rock move. The +1 priority is the entire
      // effect (priority field already applied at construction), so the move is
      // intentionally effect-less here. A previously-added HighCritAttr was an
      // unfaithful "flavor" embellishment not in the ER source — removed.
      return ok(0, []);
    case 844:
      // Inverse Room — status move that reverses type matchups field-wide for
      // 5 turns. Sets the ER INVERSE_ROOM arena tag; the type-chart inversion is
      // applied in getTypeDamageMultiplier while the tag is active.
      return ok(0, [new AddArenaTagAttr(ArenaTagType.INVERSE_ROOM, 5)]);
    case 846:
      // Karma — self-status: raises SpAtk and SpDef by 1, lowers Speed by 1.
      // Two separate StatStageChangeAttrs since stage delta differs.
      return ok(0, [
        new StatStageChangeAttr([Stat.SPATK, Stat.SPDEF], 1, true),
        new StatStageChangeAttr([Stat.SPD], -1, true),
      ]);
    case 853:
      // Raging Souls — sharply lowers user's SpAtk by 2.
      return ok(0, [new StatStageChangeAttr([Stat.SPATK], -2, true)]);
    case 897:
      // Creeping Thorns — deploys the real ER Creeping Thorns hazard on the foe
      // side (Spikes-style switch-in damage PLUS ER_BLEED).
      return ok(0, [new AddArenaTrapTagAttr(ArenaTagType.CREEPING_THORNS, 0, false, false)]);
    case 935:
      // Megaton Hammer — ignores Protect. IGNORE_PROTECT flag handles this.
      return ok(MoveFlags.IGNORE_PROTECT | MoveFlags.HAMMER_BASED, []);
    case 949:
      // Beatdown — hits 2-5 times.
      return ok(0, [new MultiHitAttr(MultiHitType.TWO_TO_FIVE)]);
    case 950:
      // Eerie Fog — ghost status move that sets fog weather for 8 turns. The
      // "drains stat boosts from non-Ghost/Psychic mons" piece is bespoke (no
      // vanilla weather → stat-strip primitive). First-pass: WeatherChangeAttr
      // sets FOG; ER abilities keyed on fog (e.g. Rest in Peace, Soul Tap)
      // then activate around it.
      return ok(0, [new WeatherChangeAttr(WeatherType.FOG)]);
    case 951:
      // Mystic Dance — self-status: raises user's SpAtk and Speed by 1 each.
      // DANCE_MOVE flag triggers Dancer-style ability copies.
      return ok(MoveFlags.DANCE_MOVE, [new StatStageChangeAttr([Stat.SPATK, Stat.SPD], 1, true)]);
    case 954:
      // Kilobite — biting Steel move: "-1 Speed to foe OR +1 Speed to user."
      // Drop the foe's Speed; when that can't apply (foe at -6 or a stat-drop
      // immunity ability like Clear Body), the user gains +1 Speed instead.
      // BITING_MOVE flag enables Strong Jaw boost.
      return ok(MoveFlags.BITING_MOVE, [
        new StatStageChangeAttr([Stat.SPD], -1),
        new StatStageChangeAttr([Stat.SPD], 1, true, {
          condition: (_u, target) =>
            target != null && (target.getStatStage(Stat.SPD) <= -6 || target.hasAbilityWithAttr("ProtectStatAbAttr")),
        }),
      ]);
    case 955:
      // Tangling Husk — protect that slows attackers on contact. SILK_TRAP =
      // protect + -1 Speed to a contact attacker (the slow-on-contact clause).
      // The "non-Fire moves only" filter is genuinely bespoke (no type-specific
      // protect primitive) and remains deferred.
      return ok(0, [new ProtectAttr(BattlerTagType.SILK_TRAP)]);
    case 962:
      // Sparkling Barrage — hits 3 times.
      return ok(0, [new MultiHitAttr(MultiHitType.THREE)]);
    case 963:
      // Spectral Serenade — power 130 ghost move. Description says "every
      // other turn" which is a recharge-like restriction; AddBattlerTagAttr
      // with RECHARGING tag (self, 1 turn, last-hit-only) matches Hyper Beam.
      return ok(0, [new AddBattlerTagAttr(BattlerTagType.RECHARGING, true, false, 1, 1, true)]);
    case 964:
      // Merculight — +4 priority protect that paralyzes contact attackers (dex:
      // "Evades attacks with certainty, paralyzing attackers"). ER_PARALYZING_SHIELD
      // is the Baneful-Bunker-shaped protect tag that inflicts PARALYSIS on contact.
      // ProtectAttr (not a bare AddBattlerTagAttr) is required so the block path fires the
      // tag's CUSTOM lapse -> onContact -> PARALYSIS; it also carries the "may fail in
      // succession" condition built in.
      return ok(0, [new ProtectAttr(BattlerTagType.ER_PARALYZING_SHIELD)]);
    case 966:
      // Spectral Flame — "Burns the target, including Fire types. Suppresses
      // abilities in fog." ErStatusEffectIgnoreImmunityAttr bypasses the vanilla
      // Fire burn-immunity for THIS move only (via trySetStatus' ignoreTypeImmunity
      // flag); ErSuppressAbilitiesInFogAttr suppresses the target's ability, but
      // ONLY when the active weather is FOG (no-op otherwise, so the burn still
      // lands).
      return ok(0, [
        new ErStatusEffectIgnoreImmunityAttr(StatusEffect.BURN, false),
        new ErSuppressAbilitiesInFogAttr(),
      ]);
    case 967:
      // Trepidation — damaging move (20 BP body from the draft) that, on hit,
      // applies ER_DESPAIR to the TARGET for 3 turns. While the tag is active
      // every Psychic-type move the holder USES misses (forced in
      // MoveEffectPhase.hitCheck — see ErDespairTag).
      return ok(0, [new AddBattlerTagAttr(BattlerTagType.ER_DESPAIR, false, false, 3, 3)]);
    case 969:
      // Fetch — "The user retrieves its lost item and switches to an ally."
      // ErRetrieveConsumedItemAttr restores the user's most-recently consumed
      // berry (ER's only tracked "lost item" — same store Harvest restores from)
      // as a held item, THEN ForceSwitchOutAttr(true) self-switches. Retrieve
      // runs before the switch (attrs apply in order). Non-berry consumables
      // aren't ledgered in this engine — see ErRetrieveConsumedItemAttr's note.
      return ok(0, [new ErRetrieveConsumedItemAttr(), new ForceSwitchOutAttr(true)]);
    case 970:
      // Transmute — power 80 psychic move that "remakes the user's item on KO".
      // Pokerogue's modifier/item system doesn't surface a clean "regenerate
      // consumed item on KO" primitive (RIPEN, PLUCK, INCINERATE etc. all
      // consume the FOE's item). Deferred until an ER item-regen primitive
      // exists; the 80 BP body from the draft remains.
      return skip("Transmute (er id 970): requires custom on-KO item-regen primitive in modifier system");
    case 971:
      // Clear Skies — "Clears the current weather AND prevents new weather from
      // being set for 5 turns." A ClearWeatherAttr per weather type clears
      // whichever is active, then the ER_WEATHER_LOCK arena tag (5 turns) blocks
      // any new weather (checked in Arena.canSetWeather).
      return ok(0, [
        new ClearWeatherAttr(WeatherType.SUNNY),
        new ClearWeatherAttr(WeatherType.RAIN),
        new ClearWeatherAttr(WeatherType.SANDSTORM),
        new ClearWeatherAttr(WeatherType.HAIL),
        new ClearWeatherAttr(WeatherType.SNOW),
        new ClearWeatherAttr(WeatherType.FOG),
        new ClearWeatherAttr(WeatherType.HEAVY_RAIN),
        new ClearWeatherAttr(WeatherType.HARSH_SUN),
        new ClearWeatherAttr(WeatherType.STRONG_WINDS),
        new AddArenaTagAttr(ArenaTagType.ER_WEATHER_LOCK, 5),
      ]);
    case 974:
      // Vexing Void — 30% chance to lower SpDef. Move.chance (30) gates.
      return ok(0, [new StatStageChangeAttr([Stat.SPDEF], -1)]);
    case 975:
      // Eclipse — heavy Dark damage, then user loses Dark typing.
      return ok(0, [new RemoveTypeAttr(PokemonType.DARK)]);
    case 977:
      // Caltrops — "sets spikes that ALSO inflict bleeding on switch-in." This
      // is exactly the ER Creeping Thorns hazard (Spikes-style switch-in damage
      // PLUS ER_BLEED), deployed on the foe side.
      return ok(0, [new AddArenaTrapTagAttr(ArenaTagType.CREEPING_THORNS, 0, false, false)]);
    case 979:
      // Safe Passage — self-switch that protects the incoming ally with a
      // -35% damage reduction this turn. The damage-reduction piece is bespoke
      // (no vanilla "incoming-mon damage-shield" primitive); first-pass:
      // self-switch only.
      return ok(0, [new ForceSwitchOutAttr(true)]);
    case 989:
      // Showtime — sets Magic Room then switches the user out. There's no
      // ArenaTagType.MAGIC_ROOM in vanilla (only TRICK_ROOM). First-pass:
      // self-switch only; defer the Magic Room piece.
      return ok(0, [new ForceSwitchOutAttr(true)]);
    case 990:
      // Banished Power — "raises the user's highest attack or defense by 1"
      // (highest of ATK/DEF/SPATK/SPDEF, resolved at apply-time).
      return ok(0, [new RaiseHighestOffenseDefenseStatAttr()]);
    case 991:
      // Triple Tremor — hits 3 times, power increasing per hit (Triple Kick /
      // Triple Axel shape): MultiHitAttr(THREE) + MultiHitPowerIncrementAttr(3).
      return ok(0, [new MultiHitAttr(MultiHitType.THREE), new MultiHitPowerIncrementAttr(3)]);
    case 999:
      // Metallic Melody — sound move that hits both opponents. The
      // hits-both-foes target is handled by the move's target field
      // (target=1 = BOTH_OPPONENTS); we add the SOUND_BASED flag here.
      return ok(MoveFlags.SOUND_BASED, []);
    case 1000:
      // Blue Moon — ice-type special move. The LUNAR_MOVE flag triggers ER
      // lunar-themed ability boosters (e.g. Lunar Affinity). The "cannot use
      // twice in a row" condition is bespoke and deferred.
      return ok(MoveFlags.LUNAR_MOVE, []);
    case 1003:
      // Septic Switch — suppresses target ability then switches user out.
      // Both primitives exist in vanilla; composed directly.
      return ok(0, [new SuppressAbilitiesAttr(), new ForceSwitchOutAttr(true)]);
    case 1005:
      // Incite — "Adds the Dark type to the target and enrages them." Wired by
      // applyErMoveBespokeRiders (AddTypeAttr(DARK) + the ER_ENRAGE recoil status)
      // in init-elite-redux-custom-moves.ts; skip here so it isn't double-applied
      // (the old TAUNT wiring predated the ER_ENRAGE status).
      return skip("Incite wired by applyErMoveBespokeRiders (Dark type + ER_ENRAGE)");
    case 1006:
      // Toxic Terrain (er internal id 1006) — "Boosts Poison-type moves for 8
      // turns and deals 1/16 HP damage." Sets the ER-custom Toxic Terrain.
      // (The id-resync: array-index 1006 is Jetstream Burst, but runtime keys by
      // the internal id, where 1006 is Toxic Terrain — see er-moves.ts.)
      return ok(0, [new TerrainChangeAttr(TerrainType.TOXIC, 8)]);
    case 1007:
      // Jetstream Burst (er internal id 1007) — wind move hitting both foes.
      // WIND_MOVE flag triggers Wind Rider; both-targets is the move's target.
      return ok(MoveFlags.WIND_MOVE, []);
    case 1008:
      // Sky Quake (er internal id 1008) — physical wind move hitting both foes.
      // WIND_MOVE flag triggers Wind Rider.
      return ok(MoveFlags.WIND_MOVE, []);
    case 1009:
      // Sunstrike (N) — ignores opponent's stat boosts (matches Sacred Sword).
      // The "negates evs, items, lowest defense" pieces are bespoke and deferred.
      return ok(0, [new IgnoreOpponentStatStagesAttr()]);
    case 1010:
      // Tempest Storm (N) — sets the ER TEMPEST_STORM weather, a thundershock
      // storm that chips both sides each turn (Electric-types immune), modeled
      // on Sandstorm/Hail. Duration is the move-set default (5).
      return ok(0, [new WeatherChangeAttr(WeatherType.TEMPEST_STORM)]);
    case 1016:
      // Party Favors — Fairy damaging move that ALSO heals the USER and its ally by
      // 25% (dex: "Heals you and your ally by 25% and does damage"). HealOnAllyAttr
      // was wrong: it only heals an ally the move TARGETS, but Party Favors targets the
      // foe, so nothing healed. HealUserAndAllyAttr heals the user's own side post-hit.
      return ok(0, [new HealUserAndAllyAttr(0.25)]);
    case 1017:
      // Shot Put — 30% chance to lower foe's Speed by 1. Move.chance gates.
      return ok(0, [new StatStageChangeAttr([Stat.SPD], -1)]);
    case 1020:
      // Dragon Dash — "Lunges at the target quickly. +1 prio." The ER move data
      // carries no secondary effect (effect=0) and the description mentions no
      // crit boost, so the +1 priority (draft.priority) is the whole move.
      return ok(0, []);
    case 1021:
      // Pocket Sand — 10% to lower foe's accuracy by 1, +1 priority (already
      // in draft.priority). Pokerogue doesn't expose an effect-chance gate at
      // the attr level; we keep the stat-stage drop unconditional and rely on
      // the +1 priority + the description making the trade-off clear.
      return ok(0, [new StatStageChangeAttr([Stat.ACC], -1)]);
    case 1022:
      // Concoction — "Attacks and uses a random berry effect." Applies a RANDOM
      // berry's effect to the user unconditionally (no held berry needed, nothing
      // consumed) — was EatBerryAttr, which only ate the user's own held berry.
      return ok(0, [new ErRandomBerryEffectAttr()]);
    case 1023:
      // Hacksaw — "Super effective vs Steel." #374: a power boost cannot fix
      // the resisted Steel-vs-Steel matchup (and never shows the SE message);
      // use the type-chart override like Aura Force / Clay Dart.
      return ok(0, [new ErSuperEffectiveVsTypeAttr(PokemonType.STEEL)]);
    case 1024:
      // Godspeed — Flying physical move, +2 priority (draft.priority).
      // "Super effective vs Steel." #374: Flying is resisted by Steel, so the
      // x2 power boost still read as not-very-effective — chart override.
      return ok(0, [new ErSuperEffectiveVsTypeAttr(PokemonType.STEEL)]);
    case 1027:
      // Rain Flush — lowers user's Defense and SpDefense by 1 each
      // (effectChance is 100 on the draft = unconditional).
      return ok(0, [new StatStageChangeAttr([Stat.DEF, Stat.SPDEF], -1, true)]);
    case 1028:
      // Ice Wall — damages and sets Reflect on user's side for 5 turns.
      return ok(0, [new AddArenaTagAttr(ArenaTagType.REFLECT, 5, true, true)]);
    case 1029:
      // Obscured Shot — Sucker Punch analog. +1 priority dark move (already
      // applied via draft.priority); fails when the target isn't selecting
      // an attacking move. Routes pokerogue's `failIfTargetNotAttackingCondition`
      // through `MoveConditionAttr` so `Move.addAttr(...)` registers the
      // condition on the Move's `conditions` array.
      return ok(0, [new MoveConditionAttr(failIfTargetNotAttackingCondition)]);
    default:
      return SKIP_BESPOKE;
  }
}

/**
 * Dispatcher entry point. Looks up the right per-archetype handler and
 * invokes it. The caller wraps any throw in the init result's `errors`
 * array; this function ITSELF never throws on classifier-shape mismatches —
 * it returns a `MoveDispatchResult` with `skipReason` set.
 *
 * @param archetype - The archetype kind (matches `ErMoveArchetypeKind`).
 * @param params    - Classifier-emitted params (or `null` for `bespoke`).
 * @param erMoveId  - Optional ER move id (the source numbering, not the
 *                    pokerogue id). When provided and `archetype === "bespoke"`,
 *                    the per-id `dispatchBespokeMove` lookup is consulted
 *                    instead of returning the generic bespoke skip.
 */
export function dispatchMoveArchetype(
  archetype: ErMoveArchetypeKind,
  params: Record<string, unknown> | null,
  erMoveId: number | null = null,
): MoveDispatchResult {
  if (archetype === "bespoke") {
    if (erMoveId !== null) {
      return dispatchBespokeMove(erMoveId);
    }
    return SKIP_BESPOKE;
  }
  if (params === null) {
    return skip(`${archetype}: null params (classifier produced no shape)`);
  }
  switch (archetype) {
    case "flag-tagged-move":
      return dispatchFlagTaggedMove(params);
    case "chance-status-on-hit":
      return dispatchChanceStatusOnHit(params);
    case "recoil-or-drain":
      return dispatchRecoilOrDrain(params);
    case "type-conversion":
      return dispatchTypeConversion(params);
    case "conditional-damage":
      return dispatchConditionalDamage(params);
    default: {
      // Exhaustive guard — TypeScript should narrow to `never` here.
      const _exhaustive: never = archetype;
      return skip(`unknown move archetype ${String(_exhaustive)}`);
    }
  }
}
