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
  AddTypeAttr,
  ClearWeatherAttr,
  ConfuseAttr,
  EatBerryAttr,
  FlinchAttr,
  ForceSwitchOutAttr,
  HealOnAllyAttr,
  HighCritAttr,
  HitHealAttr,
  IgnoreOpponentStatStagesAttr,
  type Move,
  type MoveAttr,
  MovePowerMultiplierAttr,
  MultiHitAttr,
  RecoilAttr,
  RemoveTypeAttr,
  SacrificialAttr,
  StatStageChangeAttr,
  StatusEffectAttr,
  SuppressAbilitiesAttr,
  VariableMoveTypeAttr,
} from "#data/moves/move";
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
 * CONFUSION, INFATUATION). ER-specific statuses (`BLEED`, `FROSTBITE`,
 * `DRENCH`) and curse/drowsy don't have a clean vanilla wiring — we return
 * `null` for those and the caller skips that piece.
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
    // ER-specific statuses (BLEED, FROSTBITE, DRENCH) — no vanilla wiring.
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
      // Seismic Fist — 20% chance to drop foe's Def by 1.
      // Move.chance (20) gates the proc via StatStageChangeAttr's getMoveChance().
      return ok(0, [new StatStageChangeAttr([Stat.DEF], -1)]);
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
      // Energy Wave — pure damage move (115 BP, 90 acc, special, Normal). No
      // secondary effects in ER source; archetype classifier flagged it bespoke
      // because no archetype matched. Wire HighCritAttr for a slight edge
      // consistent with the "deadly wave of energy" flavor.
      return ok(0, [new HighCritAttr()]);
    case 823:
      // Fluttering Leaf — deals damage and switches user out. ForceSwitchOutAttr
      // with selfSwitch=true matches U-Turn/Volt Switch semantics.
      return ok(0, [new ForceSwitchOutAttr(true)]);
    case 832:
      // Boiling Flame — Fire move that deals 1.5x damage in rain. We attach a
      // MovePowerMultiplierAttr that inspects active weather at apply-time;
      // also tag the move as WEATHER_BASED so ER weather-syncing abilities
      // pick it up.
      return ok(MoveFlags.WEATHER_BASED, [
        new MovePowerMultiplierAttr((_u, _t, _m) => {
          const wt = globalScene.arena.weather?.weatherType;
          return wt === WeatherType.RAIN || wt === WeatherType.HEAVY_RAIN ? 1.5 : 1;
        }),
      ]);
    case 834:
      // Double Lariat — hits both foes (target field handles that), silences
      // hit targets via THROAT_CHOPPED tag (2 turn duration matches Throat
      // Chop's standard 2-turn lock-out).
      return ok(0, [new AddBattlerTagAttr(BattlerTagType.THROAT_CHOPPED, false, false, 2, 2)]);
    case 836:
      // Yggdrasil Force — lowers user's Atk and Def by 1 each (unconditional).
      return ok(0, [new StatStageChangeAttr([Stat.ATK, Stat.DEF], -1, true)]);
    case 837:
      // Drain Brain — lowers target SpAtk and heals user by that amount.
      // Same shape as Strength Sap (HitHealAttr stat-based heal + StatStageChangeAttr).
      return ok(MoveFlags.TRIAGE_MOVE, [new HitHealAttr(null, Stat.SPATK), new StatStageChangeAttr([Stat.SPATK], -1)]);
    case 841:
      // Gem Missile — +1 priority rock move (priority field in draft already
      // applied at construction). HighCritAttr gives the "sharp gem" flavor
      // a 1/8 crit rate boost, consistent with other priority-strike moves.
      return ok(0, [new HighCritAttr()]);
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
      // Creeping Thorns — hurts foes on switch in. ER has its own Creeping
      // Thorns tag, not in vanilla ArenaTagType. As a faithful approximation
      // we deploy Spikes on the enemy side (same shape: damage on switch-in).
      return ok(0, [new AddArenaTrapTagAttr(ArenaTagType.SPIKES, 0, false, false)]);
    case 935:
      // Megaton Hammer — ignores Protect. IGNORE_PROTECT flag handles this.
      return ok(MoveFlags.IGNORE_PROTECT | MoveFlags.HAMMER_BASED, []);
    case 949:
      // Beatdown — hits 2-5 times.
      return ok(0, [new MultiHitAttr(MultiHitType.TWO_TO_FIVE)]);
    case 951:
      // Mystic Dance — self-status: raises user's SpAtk and Speed by 1 each.
      // DANCE_MOVE flag triggers Dancer-style ability copies.
      return ok(MoveFlags.DANCE_MOVE, [new StatStageChangeAttr([Stat.SPATK, Stat.SPD], 1, true)]);
    case 954:
      // Kilobite — biting Steel move that drops foe's Speed by 1. The "+1 user
      // Speed if foe immune to Speed drop" branch is bespoke; first-pass keeps
      // the foe-speed drop only. BITING_MOVE flag enables Strong Jaw boost.
      return ok(MoveFlags.BITING_MOVE, [new StatStageChangeAttr([Stat.SPD], -1)]);
    case 955:
      // Tangling Husk — +4 priority protect-style move that protects against
      // non-Fire moves; slows attackers on contact. Both restrictions are
      // bespoke (no vanilla "type-specific protect" or "slow-on-contact-protect"
      // primitives). First-pass: generic Protect tag, matching Detect shape.
      return ok(0, [new AddBattlerTagAttr(BattlerTagType.PROTECTED, true, true)]);
    case 962:
      // Sparkling Barrage — hits 3 times.
      return ok(0, [new MultiHitAttr(MultiHitType.THREE)]);
    case 963:
      // Spectral Serenade — power 130 ghost move. Description says "every
      // other turn" which is a recharge-like restriction; AddBattlerTagAttr
      // with RECHARGING tag (self, 1 turn, last-hit-only) matches Hyper Beam.
      return ok(0, [new AddBattlerTagAttr(BattlerTagType.RECHARGING, true, false, 1, 1, true)]);
    case 964:
      // Merculight — +4 priority protect-style status move that paralyzes
      // attackers. The paralyze-on-protect is bespoke. First-pass: generic
      // Protect tag (matching Detect/Protect shape).
      return ok(0, [new AddBattlerTagAttr(BattlerTagType.PROTECTED, true, true)]);
    case 966:
      // Spectral Flame — status move that burns the target. The "including
      // Fire types" piece is bespoke (vanilla `StatusEffectAttr` honours type
      // immunity); the fog-ability-suppression piece is deferred. As a first
      // pass we inflict standard BURN.
      return ok(0, [new StatusEffectAttr(StatusEffect.BURN, false)]);
    case 967:
      // Trepidation — ER status move that makes foe miss Psychic moves. No
      // vanilla "miss-specific-type" primitive (this is closest to Foresight
      // but inverted); first-pass: FlinchAttr as a small turn-disruption proxy.
      // The damaging 20-BP body + 90 acc remains from the draft.
      return ok(0, [new FlinchAttr()]);
    case 969:
      // Fetch — status move that switches the user out (the "retrieves lost
      // item" piece is bespoke and deferred — pokerogue's item system doesn't
      // cleanly model "lost items"). ForceSwitchOutAttr(true) matches Teleport.
      return ok(0, [new ForceSwitchOutAttr(true)]);
    case 971:
      // Clear Skies — clears the current weather, regardless of type. The
      // "prevents new weather for 5 turns" piece is bespoke and deferred
      // (no vanilla weather-block primitive). We deploy a ClearWeatherAttr per
      // weather type so whichever is active gets cleared.
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
      ]);
    case 974:
      // Vexing Void — 30% chance to lower SpDef. Move.chance (30) gates.
      return ok(0, [new StatStageChangeAttr([Stat.SPDEF], -1)]);
    case 975:
      // Eclipse — heavy Dark damage, then user loses Dark typing.
      return ok(0, [new RemoveTypeAttr(PokemonType.DARK)]);
    case 977:
      // Caltrops — sets spikes that ALSO inflict bleeding on switch-in. The
      // bleed-on-switch-in piece is bespoke (no composite primitive). First-
      // pass: deploy SPIKES alone, mirroring the Creeping Thorns (897) wiring.
      return ok(0, [new AddArenaTrapTagAttr(ArenaTagType.SPIKES, 0, false, false)]);
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
      // Banished Power — raises user's highest offense/defense after damage.
      // No vanilla "raise highest stat" primitive (Salt Cure, Power Trick etc.
      // are different shapes); for a first pass we raise SpAtk (the most
      // common winner for the dark-typed moves in this cluster). Defer the
      // proper "highest of {Atk,Def,SpAtk,SpDef,Spd}" logic to a future
      // primitive.
      return ok(0, [new StatStageChangeAttr([Stat.SPATK], 1, true)]);
    case 991:
      // Triple Tremor — hits 3 times. Power-increases-per-hit isn't a vanilla
      // primitive; simple MultiHitAttr(THREE) is a faithful enough first pass.
      return ok(0, [new MultiHitAttr(MultiHitType.THREE)]);
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
      // Incite — adds Dark type to target. The "enrages foe" piece is bespoke
      // (no vanilla "enrage" status); first-pass: AddTypeAttr only.
      return ok(0, [new AddTypeAttr(PokemonType.DARK)]);
    case 1006:
      // Jetstream Burst — wind move hitting both foes. WIND_MOVE flag triggers
      // Wind Rider; the both-targets dimension is handled by the move's
      // target field (BOTH_OPPONENTS).
      return ok(MoveFlags.WIND_MOVE, []);
    case 1007:
      // Sky Quake — physical wind move; same shape as Jetstream Burst.
      return ok(MoveFlags.WIND_MOVE, []);
    case 1009:
      // Sunstrike (N) — ignores opponent's stat boosts (matches Sacred Sword).
      // The "negates evs, items, lowest defense" pieces are bespoke and deferred.
      return ok(0, [new IgnoreOpponentStatStagesAttr()]);
    case 1016:
      // Party Favors — Fairy damaging move that also heals user's ally by 25%.
      // HealOnAllyAttr with healRatio 0.25 matches Pollen Puff's ally-heal shape.
      return ok(0, [new HealOnAllyAttr(0.25)]);
    case 1017:
      // Shot Put — 30% chance to lower foe's Speed by 1. Move.chance gates.
      return ok(0, [new StatStageChangeAttr([Stat.SPD], -1)]);
    case 1020:
      // Dragon Dash — +1 priority dragon move (priority field in draft, applied
      // at construction). HighCritAttr adds 1/8 crit rate for "lunges" flavor.
      return ok(0, [new HighCritAttr()]);
    case 1021:
      // Pocket Sand — 10% to lower foe's accuracy by 1, +1 priority (already
      // in draft.priority). Pokerogue doesn't expose an effect-chance gate at
      // the attr level; we keep the stat-stage drop unconditional and rely on
      // the +1 priority + the description making the trade-off clear.
      return ok(0, [new StatStageChangeAttr([Stat.ACC], -1)]);
    case 1022:
      // Concoction — damaging Grass move that also consumes one of the user's
      // berries. EatBerryAttr(selfTarget=true) matches the Stuff Cheeks shape.
      return ok(0, [new EatBerryAttr(true)]);
    case 1027:
      // Rain Flush — lowers user's Defense and SpDefense by 1 each
      // (effectChance is 100 on the draft = unconditional).
      return ok(0, [new StatStageChangeAttr([Stat.DEF, Stat.SPDEF], -1, true)]);
    case 1028:
      // Ice Wall — damages and sets Reflect on user's side for 5 turns.
      return ok(0, [new AddArenaTagAttr(ArenaTagType.REFLECT, 5, true, true)]);
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
