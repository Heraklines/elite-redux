/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op battle CHECKPOINT (#633, LIVE-D). The PURE core of the authoritative
// post-turn state the host streams and the guest applies: build a
// `CoopBattleCheckpoint` from a readable view of the field + arena, and normalize a
// target mon-state before the guest writes it onto its engine mon.
//
// Deliberately engine-FREE (no `globalScene` / `Pokemon` import) so it is unit-
// testable headlessly. The thin engine adapters that READ a live `Pokemon`/arena
// into these views and WRITE a normalized state back live in the phase wiring (which
// may import the engine); this module is just the data transform, so the clamping /
// shape logic is verifiable without booting the game.
// =============================================================================

import { coopLog, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type {
  CoopBattleCheckpoint,
  CoopSerializedArenaTag,
  CoopSerializedMonState,
} from "#data/elite-redux/coop/coop-transport";

/** A readable snapshot of ONE live field mon (extracted from a `Pokemon` at the call site). */
export interface CoopFieldMonView {
  /** Battler index (0 host lead, 1 guest lead, 2/3 enemies). */
  bi: number;
  /** STABLE party-slot identity (#633, enemy-switch mirror); see {@linkcode CoopSerializedMonState.partyIndex}. */
  partyIndex: number;
  /** `species.speciesId` (#633, enemy-switch mirror); the robust switch-detection identity. */
  speciesId: number;
  hp: number;
  maxHp: number;
  /** `StatusEffect` enum value (0 = none). */
  status: number;
  /**
   * `Status.toxicTurnCount` (status sub-state sync): the toxic-damage ramp counter that scales
   * poison/toxic post-turn damage. The pure-renderer guest never runs PostTurnStatusEffectPhase, so
   * without carrying this it stays 0 while the host ramps - a permanent status divergence a badly-toxic'd
   * mon never heals (the checkpoint apply reconstructs Status from the effect enum alone). Absent/0 for a
   * non-toxic mon.
   */
  statusToxicTurnCount?: number;
  /**
   * `Status.sleepTurnsRemaining` (status sub-state sync): forced-sleep turns left. Same rationale as
   * {@linkcode statusToxicTurnCount} - the guest never decrements it locally, so a Yawn/Spore sleep's
   * remaining-turn companion the effect enum cannot carry has to ride the checkpoint. Absent when the mon
   * is not asleep (or an older/indefinite sleep with no explicit counter).
   */
  statusSleepTurnsRemaining?: number;
  /** The 7 stat stages (ATK..ACC/EVA). */
  statStages: number[];
  fainted: boolean;
  /** Only when it changed this turn. */
  formIndex?: number;
  /** Only when the active ability changed this turn (`AbilityId`). */
  abilityId?: number;
  /** ER bleed/frost/fear BattlerTags on this mon (#633 Fix #4h): `{ type, turns }` each. */
  erTags?: { type: string; turns: number }[];
  /** Move PP usage per moveset slot (#798): `{ id, ppUsed }` in slot order. */
  moves?: { id: number; ppUsed: number }[];
  /** #809: tera state so mega/tera converge per turn (formIndex is the existing field above). */
  isTerastallized?: boolean;
  teraType?: number;
  /**
   * #804 slot-ownership heal: the host-authoritative owner tag for PLAYER-side mons. Live
   * evidence (ME battle deadlock): the tags diverged between clients (a host-only summon-safety
   * swap), so BOTH resolved the same slot as the partner's. Carrying the tag per turn heals
   * drift at every checkpoint instead of only on full snapshots.
   */
  coopOwner?: "host" | "guest";
}

/** A readable snapshot of the arena's weather + terrain (+ tags, #633 GAP 1). */
export interface CoopArenaView {
  weather: number;
  weatherTurnsLeft: number;
  terrain: number;
  terrainTurnsLeft: number;
  /** Arena tags currently on the field (Stealth Rock / Spikes / screens / tailwind / ...). */
  arenaTags?: CoopSerializedArenaTag[];
}

/** Sanitize one arena tag for the wire: a string tagType + non-negative integer scalars. */
export function serializeArenaTag(tag: CoopSerializedArenaTag): CoopSerializedArenaTag {
  return {
    tagType: tag.tagType,
    side: Math.max(0, Math.trunc(tag.side)),
    turnCount: Math.max(0, Math.trunc(tag.turnCount)),
    layers: Math.max(1, Math.trunc(tag.layers)),
  };
}

/** Clamp a single stat stage into the engine's legal [-6, 6] range. */
function clampStage(v: number): number {
  return v < -6 ? -6 : v > 6 ? 6 : Math.trunc(v);
}

/**
 * Whether a numeric wire form can resolve on a species with `formCount` indexed forms.
 *
 * Species without an explicit forms array use index zero for their base species object. Species
 * with forms must resolve through that array. Receive code uses this before mutating a live mon.
 */
export function isResolvableCoopFormIndex(formCount: number, formIndex: number): boolean {
  return (
    Number.isSafeInteger(formCount)
    && formCount >= 0
    && Number.isSafeInteger(formIndex)
    && formIndex >= 0
    && (formCount === 0 ? formIndex === 0 : formIndex < formCount)
  );
}

/**
 * Normalize the OPTIONAL status sub-state (status sub-state sync): the toxic-damage counter + remaining
 * sleep turns a `Status` carries beyond its `effect` enum, sanitized to concrete `Status`-constructor args.
 *
 * BACKWARD COMPATIBLE by construction: an OLD payload (missing both sub-fields) yields
 * `{ toxicTurnCount: 0, sleepTurnsRemaining: undefined }` - i.e. effect-only, exactly the pre-migration
 * `new Status(effect)` behavior - so a mixed-version session never crashes and never mis-applies. Both the
 * BUILD side (outgoing sanitize) and every APPLY side (guest reconstruct) route through this so the fields
 * are read identically on both ends.
 */
export function coopStatusSubState(fields: {
  statusToxicTurnCount?: number | undefined;
  statusSleepTurnsRemaining?: number | undefined;
}): { toxicTurnCount: number; sleepTurnsRemaining: number | undefined } {
  const toxicTurnCount =
    fields.statusToxicTurnCount !== undefined
    && Number.isFinite(fields.statusToxicTurnCount)
    && fields.statusToxicTurnCount > 0
      ? Math.trunc(fields.statusToxicTurnCount)
      : 0;
  const sleepTurnsRemaining =
    fields.statusSleepTurnsRemaining !== undefined
    && Number.isFinite(fields.statusSleepTurnsRemaining)
    && fields.statusSleepTurnsRemaining >= 0
      ? Math.trunc(fields.statusSleepTurnsRemaining)
      : undefined;
  return { toxicTurnCount, sleepTurnsRemaining };
}

/** Normalize a field mon's mutable state into the wire shape (clamped, cloned, safe). */
export function serializeMonState(mon: CoopFieldMonView): CoopSerializedMonState {
  const maxHp = Math.max(1, Math.trunc(mon.maxHp));
  const hp = Math.max(0, Math.min(maxHp, Math.trunc(mon.hp)));
  const state: CoopSerializedMonState = {
    bi: mon.bi,
    // Carry the stable party-slot identity through (#633, enemy-switch mirror). Defensively
    // truncated; a missing value (-1) is preserved so the guest treats it as "no switch".
    partyIndex: Math.trunc(mon.partyIndex ?? -1),
    // Carry the species identity through (#633, enemy-switch mirror): the robust switch-detection
    // signal the guest compares per enemy field slot. Defaults to 0 (the guest then skips it).
    speciesId: Math.max(0, Math.trunc(mon.speciesId ?? 0)),
    hp,
    maxHp,
    status: Math.max(0, Math.trunc(mon.status)),
    // Always 7 stages; pad/truncate defensively so a malformed view can't desync length.
    statStages: Array.from({ length: 7 }, (_, i) => clampStage(mon.statStages[i] ?? 0)),
    // A 0-hp mon is fainted regardless of the source flag (the authoritative invariant).
    fainted: mon.fainted || hp === 0,
  };
  if (mon.formIndex !== undefined && Number.isSafeInteger(mon.formIndex) && mon.formIndex >= 0) {
    state.formIndex = Math.trunc(mon.formIndex);
  }
  if (mon.abilityId !== undefined) {
    state.abilityId = mon.abilityId;
  }
  if (mon.moves !== undefined) {
    // Sanitize per slot: non-negative integers only; slot order preserved (the checksum
    // hashes moves in slot order, so the wire shape must mirror the live moveset exactly).
    state.moves = mon.moves.map(m => ({
      id: Math.max(0, Math.trunc(m.id)),
      ppUsed: Math.max(0, Math.trunc(m.ppUsed)),
    }));
  }
  // #809: tera state passthrough (formIndex already carried below when present).
  if (typeof mon.isTerastallized === "boolean") {
    state.isTerastallized = mon.isTerastallized;
  }
  if (typeof mon.teraType === "number") {
    state.teraType = Math.trunc(mon.teraType);
  }
  // #804: pass the owner tag through, value-checked (only ever "host"/"guest" on the wire).
  if (mon.coopOwner === "host" || mon.coopOwner === "guest") {
    state.coopOwner = mon.coopOwner;
  }
  // Status sub-state (status sub-state sync): carry the toxic counter + remaining sleep turns so a
  // badly-statused mon's FULL Status converges on the pure-renderer guest (which never runs
  // PostTurnStatusEffectPhase). Omitted at their defaults (toxicTurnCount 0 / no sleep counter) so a
  // statusless or freshly-statused mon's wire shape is UNCHANGED, and an OLDER receiver ignores them.
  const statusSub = coopStatusSubState(mon);
  if (statusSub.toxicTurnCount > 0) {
    state.statusToxicTurnCount = statusSub.toxicTurnCount;
  }
  if (statusSub.sleepTurnsRemaining !== undefined) {
    state.statusSleepTurnsRemaining = statusSub.sleepTurnsRemaining;
  }
  // ER bleed/frost/fear tags (#633 Fix #4h): carry them through, sanitized (string type +
  // non-negative integer turns). Omitted when empty so a tagless mon's wire shape is unchanged.
  if (mon.erTags !== undefined && mon.erTags.length > 0) {
    state.erTags = mon.erTags
      .filter(t => typeof t.type === "string")
      .map(t => ({ type: t.type, turns: Math.max(0, Math.trunc(t.turns)) }));
  }
  return state;
}

/**
 * Build the authoritative post-turn checkpoint from the live field + arena views.
 *
 * `money` (#633/#698 money transient) is the host's authoritative money at this boundary, carried so
 * the guest can mirror it continuously instead of lagging until a resync heals it. Optional + additive:
 * an undefined value (an older caller / a context with no money) omits the field, and the guest then
 * leaves its money alone (no regression). Non-finite / negative values are dropped (treated as absent).
 */
export function buildCheckpoint(mons: CoopFieldMonView[], arena: CoopArenaView, money?: number): CoopBattleCheckpoint {
  const checkpoint: CoopBattleCheckpoint = {
    field: mons.map(serializeMonState),
    weather: Math.max(0, Math.trunc(arena.weather)),
    weatherTurnsLeft: Math.max(0, Math.trunc(arena.weatherTurnsLeft)),
    terrain: Math.max(0, Math.trunc(arena.terrain)),
    terrainTurnsLeft: Math.max(0, Math.trunc(arena.terrainTurnsLeft)),
  };
  // Carry the host's money whenever a finite, non-negative value is provided (#633/#698 money transient):
  // the guest force-sets it so a between-wave reward-shop spend / in-battle Pay Day mirrors within one
  // turn. Omitted for a missing / malformed value so an older host's payload shape is unchanged.
  if (money !== undefined && Number.isFinite(money) && money >= 0) {
    checkpoint.money = Math.trunc(money);
  }
  // Carry arena tags whenever the view PROVIDES the field (#633 GAP 1), INCLUDING an empty array:
  // a NEW host always sends it (even `[]`) so the guest can converge to the empty set (remove a
  // screen the host cleared), while an OLDER host omits the field and the guest leaves its tags
  // alone (the `undefined` skip in reconcileArenaTags). The empty-array case is the intended signal.
  if (arena.arenaTags !== undefined) {
    checkpoint.arenaTags = arena.arenaTags.filter(t => typeof t.tagType === "string").map(serializeArenaTag);
  }
  // Per-turn-HOT (build runs every checkpoint capture): assemble the key-field summary only when debug
  // is on. Pure read of the just-built checkpoint - never mutates it. Pairs with the engine's host/guest
  // capture+apply logs so a checkpoint can be eyeballed at every stage of its lifecycle.
  if (isCoopDebug()) {
    coopLog(
      "checkpoint",
      `build field=${checkpoint.field.length} weather=${checkpoint.weather}/${checkpoint.weatherTurnsLeft} `
        + `terrain=${checkpoint.terrain}/${checkpoint.terrainTurnsLeft} arenaTags=${checkpoint.arenaTags?.length ?? "none"} `
        + `money=${checkpoint.money ?? "none"} `
        + `mons=[${checkpoint.field
          .map(f => `bi${f.bi}:sp${f.speciesId}/hp${f.hp}-${f.maxHp}/st${f.status}/fnt${f.fainted ? 1 : 0}`)
          .join(" ")}]`,
    );
  }
  return checkpoint;
}

/** Find the authoritative state for the mon at battler index `bi` (undefined if absent). */
export function monStateByIndex(checkpoint: CoopBattleCheckpoint, bi: number): CoopSerializedMonState | undefined {
  return checkpoint.field.find(f => f.bi === bi);
}

/**
 * Re-clamp a received mon-state before the guest writes it onto its engine mon. The
 * guest trusts the host but must never write an out-of-range value (a corrupt/old
 * packet must not poison engine state): hp into [0, maxHp], stages into [-6, 6],
 * faint forced when hp is 0.
 */
export function normalizeMonState(state: CoopSerializedMonState): CoopSerializedMonState {
  return serializeMonState({
    bi: state.bi,
    partyIndex: state.partyIndex,
    speciesId: state.speciesId,
    hp: state.hp,
    maxHp: state.maxHp,
    status: state.status,
    // Status sub-state (status sub-state sync): pass the sub-fields through the re-clamp so a received
    // toxic counter / sleep-turn companion survives normalization (an old shape omits them -> effect only).
    ...(state.statusToxicTurnCount === undefined ? {} : { statusToxicTurnCount: state.statusToxicTurnCount }),
    ...(state.statusSleepTurnsRemaining === undefined
      ? {}
      : { statusSleepTurnsRemaining: state.statusSleepTurnsRemaining }),
    statStages: state.statStages,
    fainted: state.fainted,
    ...(state.formIndex === undefined ? {} : { formIndex: state.formIndex }),
    ...(state.abilityId === undefined ? {} : { abilityId: state.abilityId }),
    ...(state.erTags === undefined ? {} : { erTags: state.erTags }),
    ...(state.moves === undefined ? {} : { moves: state.moves }),
    ...(state.isTerastallized === undefined ? {} : { isTerastallized: state.isTerastallized }),
    ...(state.teraType === undefined ? {} : { teraType: state.teraType }),
    // #804: the owner tag must survive normalization or the drift heal never fires.
    ...(state.coopOwner === undefined ? {} : { coopOwner: state.coopOwner }),
  });
}
