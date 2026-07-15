/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op battle ENGINE adapter (#633, LIVE-D). The thin, engine-COUPLED bridge
// between the live game and the pure checkpoint core: read the live field + arena
// into a `CoopBattleCheckpoint` (host), and apply a received checkpoint onto the
// live field (guest). Kept separate from the pure `coop-battle-checkpoint.ts` (which
// does the clamping/shape) so the data logic stays unit-testable; this file is the
// `globalScene`/`Pokemon` touch layer.
//
// The guest applies a checkpoint at a SAFE turn boundary (start of its command phase,
// field stable - never mid-resolution). It is a CONSERVATIVE numeric correction: hp,
// status, stat stages, weather/terrain - the visible outcome state. It does NOT force
// structural faints/switches (those follow from the relayed commands resolving the
// same way); it only snaps numeric drift so both screens show the same hp/damage. All
// of it is wrapped so a bad/partial checkpoint can never crash the guest's battle.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { EntryHazardTag } from "#data/arena-tag";
import type { BattleFormat } from "#data/battle-format";
import { SerializableBattlerTag } from "#data/battler-tags";
import { coopAllowAccountWrite } from "#data/elite-redux/coop/coop-account-gate";
import {
  isCoopAuthoritativeGuestGated,
  isShowdownGuestFlipGated,
} from "#data/elite-redux/coop/coop-authoritative-gate";
import {
  buildCheckpoint,
  type CoopArenaView,
  type CoopFieldMonView,
  monStateByIndex,
  normalizeMonState,
} from "#data/elite-redux/coop/coop-battle-checkpoint";
import {
  COOP_CHECKSUM_SENTINEL,
  type CoopChecksumMon,
  type CoopChecksumState,
  canonicalize,
  checksumState,
  fnv1a64,
  sortCoopChecksumArenaTags,
  sortCoopChecksumTagIds,
} from "#data/elite-redux/coop/coop-battle-checksum";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import {
  ensureCoopPokemonPresentationNodes,
  getActuallyFieldedCoopPokemon,
  settleCoopFieldPresentation,
} from "#data/elite-redux/coop/coop-field-presentation";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopAuthoritativeFieldSeat,
  CoopBattleCheckpoint,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
  CoopInteractionOutcome,
  CoopMonTransform,
  CoopRole,
  CoopSerializedArenaTag,
  CoopSerializedEnemy,
} from "#data/elite-redux/coop/coop-transport";
import { type ErRouteNode, getErPendingNodes, setErPendingNodes } from "#data/elite-redux/er-biome-routing";
import {
  erBiomeOverstayAnchor,
  getErBiomeLength,
  getErBiomeStartWave,
  setErBiomeOverstayAnchor,
  setErBiomeStructureExtent,
} from "#data/elite-redux/er-biome-structure";
import {
  getErMapSaveData,
  restoreErMapState,
  setAuthoritativeMapTravelClassification,
} from "#data/elite-redux/er-map-nodes";
import { getErMoneyStreakEntries, restoreErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import {
  type ErRelicBattleStateData,
  getErRelicBattleState,
  restoreErRelicBattleState,
} from "#data/elite-redux/er-relic-battle-state";
import {
  swapArenaTagSide,
  swapAuthoritativeState,
  swapBi,
  swapCheckpoint,
  swapFullField,
} from "#data/elite-redux/showdown/showdown-side-swap";
import type { Gender } from "#data/gender";
import { CustomPokemonData, PokemonBattleData, PokemonSummonData } from "#data/pokemon-data";
import { Status } from "#data/status-effect";
import type { TerrainType } from "#data/terrain";
import type { AbilityId } from "#enums/ability-id";
import type { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { BiomeId } from "#enums/biome-id";
import { FieldPosition } from "#enums/field-position";
import type { MoveId } from "#enums/move-id";
import type { Nature } from "#enums/nature";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { WeatherType } from "#enums/weather-type";
import { EnemyPokemon, type PlayerPokemon, type Pokemon } from "#field/pokemon";
// biome-ignore lint/performance/noNamespaceImport: held-item reconstruction resolves the modifier class by serialized name (`Modifier[className]`), exactly like the save-load path in game-data.ts.
import * as Modifier from "#modifiers/modifier";
import { PersistentModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { ModifierData } from "#system/modifier-data";
import { PokemonData } from "#system/pokemon-data";
import type { StarterDataEntry } from "#types/save-data";
import { EnemyBattleInfo } from "#ui/enemy-battle-info";
import { getPokemonSpecies, getPokemonSpeciesForm } from "#utils/pokemon-utils";
import { compressToBase64, decompressFromBase64 } from "lz-string";

// =============================================================================
// STRUCTURED APPLY FAILURE (accepted-review item 4). Every per-mon / per-section
// authoritative-state apply path below guards its OWN failure so one bad mon never
// aborts the rest of the turn's apply. Historically those catches were SILENT ("the
// checksum catches residual drift") - but the checksum can only see the HASHED
// fields, so a failure that corrupts an UNHASHED sub-field (a summonData internal, a
// modifier arg, a module-let substrate) left the guest silently diverged AND the
// outer apply still returned `true`. This accumulator turns each swallowed failure
// into a structured `{ section, monId?, error }` record; a non-empty drain at the
// finalize call site forces the LOUD heal-once/resync path even when the checksum
// happened to match (it is blind to the failed field). Empty on the happy path, so
// behavior is byte-identical when every mon/section applies cleanly.
// =============================================================================

/** One swallowed authoritative-apply failure: which section, which mon (if per-mon), and the error text. */
export interface CoopApplyFailure {
  /** The apply stage that failed (e.g. "monData", "modifiers", "substrates", "apply"). */
  section: string;
  /** The host-stable `Pokemon.id` for a per-mon failure; absent for a whole-section failure. */
  monId?: number;
  /** The error's message (or its stringification), for the loud diagnostic + coop log. */
  error: string;
}

/** Failures accumulated during the CURRENT authoritative-state apply; drained by the finalize caller. */
let coopApplyFailures: CoopApplyFailure[] = [];

/** Reset the apply-failure accumulator at the START of an authoritative-state apply (no cross-apply bleed). */
function beginCoopApplyFailureCapture(): void {
  coopApplyFailures = [];
}

/** Record ONE swallowed apply failure. Never throws (the caller's own catch already fired). */
function recordCoopApplyFailure(section: string, error: unknown, monId?: number): void {
  const text = error instanceof Error ? error.message : String(error);
  coopApplyFailures.push(monId === undefined ? { section, error: text } : { section, monId, error: text });
}

/**
 * Drain (return + clear) the structured failures accumulated by the most recent
 * {@linkcode applyCoopAuthoritativeBattleState}. A NON-EMPTY result means a per-mon / per-section apply
 * silently failed on a field the checksum cannot see - the caller MUST trigger the loud heal/resync
 * anyway. Empty on the happy path.
 */
export function drainCoopApplyFailures(): CoopApplyFailure[] {
  const out = coopApplyFailures;
  coopApplyFailures = [];
  return out;
}

/**
 * ER BattlerTags carried in the co-op checkpoint (#633 Fix #4h). These are BattlerTags, not
 * StatusEffects, so the checkpoint's `status` field can't repair them - without this the three
 * ER conditions could never be re-synced once anything drifts. Bleed is HP chip; frostbite /
 * fear are flag-bearing tags. Held as a literal list so the read + repair stay narrow + cheap.
 */
const COOP_REPAIRABLE_ER_TAGS = [BattlerTagType.ER_BLEED, BattlerTagType.ER_FROSTBITE, BattlerTagType.ER_FEAR] as const;

/** Read the ER bleed/frost/fear tags currently on a mon into the checkpoint shape. */
function readErTags(mon: ReturnType<typeof globalScene.getField>[number]): { type: string; turns: number }[] {
  const out: { type: string; turns: number }[] = [];
  for (const type of COOP_REPAIRABLE_ER_TAGS) {
    const tag = mon.getTag(type);
    if (tag != null) {
      out.push({ type, turns: tag.turnCount });
    }
  }
  return out;
}

/**
 * GUEST: repair the three ER bleed/frost/fear tags to match the host's checkpoint (#633 Fix
 * #4h). For each repairable tag: add it if the host has it and we don't; remove it if the
 * host doesn't and we do. Only these three tags are touched - every other BattlerTag is left
 * exactly as the lockstep engine computed it. Fully guarded by the caller.
 */
function repairErTags(
  mon: ReturnType<typeof globalScene.getField>[number],
  erTags: { type: string; turns: number }[] | undefined,
): void {
  const wanted = new Map<string, number>((erTags ?? []).map(t => [t.type, t.turns]));
  for (const type of COOP_REPAIRABLE_ER_TAGS) {
    const has = mon.getTag(type) != null;
    const want = wanted.has(type);
    if (want && !has) {
      mon.addTag(type, wanted.get(type) ?? 0);
    } else if (!want && has) {
      mon.removeTag(type);
    }
  }
}

/**
 * STABLE party-slot identity of a field mon (#633, enemy-switch mirror). The host's enemy
 * switch swaps `party[fieldIndex]` <-> a bench slot, keeping the same battler index but bringing
 * a DIFFERENT party member on-field; the streamed `bi` is only a POSITION, so this carries the
 * mon's index in its OWNING party (enemy -> `getEnemyParty()`, player -> `getPlayerParty()`) so
 * the guest can DETECT the switch + mirror it. NOT `mon.id` (per-client random + remapped). A
 * mon not found in its party serializes as -1 (defensive; the guest treats it as no-switch).
 */
function readPartyIndex(mon: Pokemon): number {
  try {
    const party = mon.isPlayer()
      ? (globalScene.getPlayerParty() as Pokemon[])
      : (globalScene.getEnemyParty() as Pokemon[]);
    return party.indexOf(mon);
  } catch {
    return -1;
  }
}

/** Read a live field mon into the pure checkpoint view. */
function readMonView(mon: ReturnType<typeof globalScene.getField>[number]): CoopFieldMonView | null {
  if (mon == null) {
    return null;
  }
  const erTags = readErTags(mon);
  return {
    bi: mon.getBattlerIndex(),
    partyIndex: readPartyIndex(mon),
    speciesId: mon.species?.speciesId ?? 0,
    hp: mon.hp,
    maxHp: mon.getMaxHp(),
    // A zero-HP mon may not have run its local FaintPhase yet. The authority must still publish one
    // self-consistent terminal state; otherwise field reconciliation stamps FAINT and this scalar pass
    // immediately clears it back to NONE.
    status: mon.isFainted() ? StatusEffect.FAINT : (mon.status?.effect ?? 0),
    // getStatStages() returns the live 7-length array; clone so the checkpoint never aliases it.
    statStages: [...mon.getStatStages()],
    fainted: mon.isFainted(),
    ...(erTags.length > 0 ? { erTags } : {}),
    // #798 PP sync: carry each slot's [moveId, ppUsed] so the guest's PP converges via the
    // checkpoint (it never runs MovePhase) instead of via a forced FULL resync every turn.
    moves: mon.getMoveset().map(m => ({ id: m?.moveId ?? 0, ppUsed: m?.ppUsed ?? 0 })),
    // #809: form + tera converge per turn (a mega/tera no longer costs a forced full resync).
    formIndex: mon.formIndex,
    isTerastallized: mon.isTerastallized === true,
    teraType: (mon as { teraType?: number }).teraType ?? 0,
    // #804: the authoritative owner tag (player-side mons only; enemies have none).
    ...((mon as { coopOwner?: CoopRole }).coopOwner === undefined
      ? {}
      : { coopOwner: (mon as { coopOwner?: CoopRole }).coopOwner }),
  };
}

/**
 * HOST: the field mons to SERIALIZE for the guest (#633, faint-field reconcile fix). The
 * naive `getField(true)` drops fainted mons (its `.filter(p => p.isActive())` -> isAllowedInBattle
 * -> `!isFainted()`), so a mon the host KOs mid-turn vanishes from every payload and the guest -
 * which only matches by battler index off its OWN live field and never removes - keeps that mon
 * ALIVE forever (a turn-1 field-composition desync the resync can't heal). The fix: serialize BOTH
 * sides as the SLOT-PRESENT slices (no isActive filter) - `getPlayerField(false)` for the player
 * side and `getEnemyField(false)` for the enemy side - so a just-fainted mon on EITHER side still
 * appears in the payload with `fainted:true` + hp 0. That fainted entry is what DRIVES the guest's
 * field reconcile ({@linkcode reconcileCoopEnemyField} for enemy slots, {@linkcode reconcileCoopPlayerField}
 * for player slots). A co-op partner faint (a player mon at bi 0/1 in the forced double) was the
 * gap that broke field composition from the first move; the player side now matches the enemy
 * side's slot-present capture so it propagates too.
 */
function getCoopSerializableField(): Pokemon[] {
  // Both accessors return non-null arrays (their own `.filter`/`.slice` guarantees it): each is
  // the slot-present party slice (no isActive filter), so a just-fainted mon on either side is
  // still included with hp 0 / fainted:true and drives the guest's field reconcile.
  const playerField = globalScene.getPlayerField(false);
  const enemyField = globalScene.getEnemyField(false);
  return [...playerField, ...enemyField];
}

/**
 * Read the arena's weather + terrain + tags into the pure checkpoint view (#633 GAP 1). ALWAYS
 * sets `arenaTags` (an empty array when the arena has none) - a NEW host that supports arena-tag
 * sync signals it by carrying the array, so the guest can converge to the EMPTY set (remove a
 * screen the host cleared), not just gain tags. An OLDER host omits the field entirely, and the
 * guest then leaves its tags alone (the `undefined` skip in {@linkcode reconcileArenaTags}).
 */
function readArenaView(): CoopArenaView {
  const arena = globalScene.arena;
  return {
    weather: arena.weather?.weatherType ?? 0,
    weatherTurnsLeft: arena.weather?.turnsLeft ?? 0,
    terrain: arena.terrain?.terrainType ?? 0,
    terrainTurnsLeft: arena.terrain?.turnsLeft ?? 0,
    arenaTags: readArenaTagViews(),
  };
}

/**
 * Read the arena's tags into the rich checkpoint view (#633 GAP 1). Carries `(tagType, side)` -
 * the identity the checksum hashes - PLUS `turnCount` + entry-hazard `layers` so the guest can
 * FORCE-SET them (turn counts are intentionally NOT hashed, so carrying them here can never
 * re-introduce a false desync; they only make a host-refreshed screen / multi-layer Spikes
 * render correctly). Sorted by `(tagType, side)` for a stable wire order. Fully guarded.
 */
function readArenaTagViews(): CoopSerializedArenaTag[] {
  try {
    return globalScene.arena.tags
      .map(
        (t): CoopSerializedArenaTag => ({
          tagType: t.tagType as unknown as string,
          side: t.side as unknown as number,
          turnCount: t.turnCount,
          layers: t instanceof EntryHazardTag ? t.layers : 1,
        }),
      )
      .sort((a, b) => (a.tagType < b.tagType ? -1 : a.tagType > b.tagType ? 1 : a.side - b.side));
  } catch {
    return [];
  }
}

/**
 * HOST: snapshot the current (post-turn) authoritative battle state. Returns null if
 * there is no live battle field to read (defensive).
 */
/**
 * #807 MONOTONIC STATE TICK (standard snapshot sequencing, Source/Quake style): the HOST stamps
 * every state-bearing capture (per-turn checkpoint, full snapshot, ME outcome) with a session-
 * monotonic tick; every GUEST applier rejects anything not NEWER than the last applied tick.
 * This retires the whole out-of-order/stale-apply bug class (the live stale-resync softlock was
 * one instance) instead of guarding each path by hand. Legacy peers (no tick) are accepted.
 */
let coopStateTickCounter = 0;
let coopLastAppliedStateTick = -1;

/** HOST: next monotonic tick for a state capture. */
export function coopNextStateTick(): number {
  return ++coopStateTickCounter;
}

/**
 * GUEST: accept-or-reject a state payload by tick. Advances the high-water mark on accept.
 * `undefined` (legacy sender) is always accepted and does not advance the mark.
 */
export function coopAcceptStateTick(tick: number | undefined, label: string): boolean {
  if (tick === undefined) {
    return true;
  }
  if (tick <= coopLastAppliedStateTick) {
    coopWarn("resync", `${label} tick=${tick} STALE (lastApplied=${coopLastAppliedStateTick}) -> REJECTED (#807)`);
    return false;
  }
  coopLastAppliedStateTick = tick;
  return true;
}

/**
 * Read the guest's monotonic state high-water without changing it.
 *
 * Recovery uses this to distinguish a genuinely rejected carrier from an idempotent retry whose
 * checkpoint/state tick was already admitted by an earlier attempt. The returned value is diagnostic
 * admission state only; callers must still prove the complete payload with its exact checksum before
 * treating an already-admitted tick as converged.
 */
export function coopAppliedStateTick(): number {
  return coopLastAppliedStateTick;
}

/** Session reset (new run / new rig): both sides start from a clean tick line. */
export function resetCoopStateTicks(): void {
  coopStateTickCounter = 0;
  coopLastAppliedStateTick = -1;
}

/** Clamp impossible HP created by a late max-HP recalculation before publishing authoritative state. */
export function normalizeCoopHpBoundsAtAuthorityBoundary(): void {
  for (const mon of [...globalScene.getPlayerParty(), ...globalScene.getEnemyParty()]) {
    const maxHp = mon.getMaxHp();
    if (mon.hp > maxHp) {
      coopWarn("checkpoint", `authority clamps impossible hp id=${mon.id} ${mon.hp}->${maxHp}`);
      mon.hp = maxHp;
    }
  }
}

export function captureCoopCheckpoint(): CoopBattleCheckpoint | null {
  try {
    // A late stat/modifier recalculation can lower max HP after the previous numeric HP write.
    // Never publish the impossible `hp > maxHp` state: the receiver necessarily clamps PokemonData,
    // which otherwise creates a permanent host/guest checksum split (long-run seed 20470471 wave 26).
    normalizeCoopHpBoundsAtAuthorityBoundary();
    // Serialize player ACTIVE mons + enemy SLOT-PRESENT mons (incl. just-fainted ones) so a
    // foe the host KOd this turn still rides the payload with fainted:true (#633 enemy-field
    // reconcile) - that entry drives the guest's removal of the dead enemy.
    const mons = getCoopSerializableField()
      .map(readMonView)
      .filter((v): v is CoopFieldMonView => v != null);
    if (mons.length === 0) {
      return null;
    }
    // Carry the host's authoritative money in EVERY per-turn checkpoint (#633/#698 money transient): the
    // pure-renderer guest never runs the host-only money mutations (between-wave reward-shop BUY, in-battle
    // Pay Day / scattered-money pickup), so without this its money lags the host until the next full resync
    // heals it - the visible "host=824 guest=1000" transient. The guest force-sets it (gated), so the first
    // turn of the wave after a shop spend snaps money. Read live + guarded so a bad read can't break capture.
    let money: number | undefined;
    try {
      money = globalScene.money;
    } catch {
      money = undefined;
    }
    const checkpoint = buildCheckpoint(mons, readArenaView(), money);
    checkpoint.tick = coopNextStateTick(); // #807 monotonic sequencing
    // Per-turn-HOT: build the summary only when debug is on. Reads the just-built checkpoint, never mutates.
    if (isCoopDebug()) {
      coopLog(
        "checkpoint",
        `host capture field=${checkpoint.field.length} weather=${checkpoint.weather} terrain=${checkpoint.terrain} `
          + `money=${checkpoint.money ?? "none"} `
          + `arenaTags=${checkpoint.arenaTags?.length ?? 0} mons=[${checkpoint.field
            .map(f => `bi${f.bi}:sp${f.speciesId}/hp${f.hp}-${f.maxHp}/st${f.status}/fnt${f.fainted ? 1 : 0}`)
            .join(" ")}]`,
      );
    }
    return checkpoint;
  } catch {
    // Never let a capture failure break the host's turn.
    return null;
  }
}

/**
 * GUEST (#633): side-effect-free field removal of one mon - zero hp so it reads as fainted, stamp the
 * FAINT status (VictoryPhase / isFainted(true) checks the status, not just hp - mirrors the host
 * FaintPhase, see #633 trainer-victory deadlock), then leaveField (NO FaintPhase / SwitchPhase /
 * resolution pipeline - that would re-introduce the engine divergence authoritative mode exists to
 * prevent). Shared by the player/enemy reconcile PASS 1 + the non-optional post-PASS-2 orphan sweep.
 * Fully guarded so one bad removal can't break the rest of the reconcile.
 */
function coopRemoveFromField(mon: Pokemon): void {
  try {
    mon.hp = 0;
    mon.doSetStatus(StatusEffect.FAINT);
    mon.leaveField(true, true, false);
  } catch {
    /* one removal failed; leave it and continue the reconcile */
  }
}

/**
 * GUEST: reconcile the live ENEMY field to the host's authoritative composition (#633
 * enemy-field reconcile fix). The host serializes player-active + enemy-SLOT-PRESENT mons (so a
 * just-fainted foe rides the payload with `fainted:true`), but the guest's per-mon numeric apply
 * only matches by battler index and never REMOVES. So a foe the host KOd mid-turn stays ALIVE on
 * the guest forever - a turn-1 field-composition desync. This helper closes that gap: from the
 * host's serialized `hostField` it computes the set of ENEMY battler indices (bi >= ENEMY, i.e.
 * 2/3) the host reports PRESENT-AND-ALIVE (`!fainted`), then for every enemy currently ON the
 * guest's active field whose `bi` is NOT in that set, it does a side-effect-free field removal
 * (set hp 0 then {@linkcode Pokemon.leaveField} - visual removal + `field.remove` + switchOutStatus,
 * NO FaintPhase / VictoryPhase / SwitchPhase, so the engine resolution pipeline is never re-entered).
 *
 * STRICTLY enemy slots (bi >= ENEMY); player faints (bi 0/1) are a separate relayed switch flow and
 * are never touched here. Idempotent: a mon already not `isActive()` / not `isOnField()` is skipped,
 * so re-applying the same checkpoint (or the resync mirror) can never double-remove. Fully guarded so
 * one bad removal can't break the rest of the heal.
 */
export function reconcileCoopEnemyField(hostField: { bi: number; fainted: boolean; speciesId?: number }[]): void {
  try {
    // Enemy battler indices the host reports PRESENT-AND-ALIVE (slot present, not fainted).
    const hostAliveEnemies = new Set<number>();
    for (const entry of hostField) {
      if (entry.bi >= BattlerIndex.ENEMY && !entry.fainted) {
        hostAliveEnemies.add(entry.bi);
      }
    }
    // PASS 1 - REMOVE: drop every guest enemy that is on-field-and-active but NOT alive on the host.
    for (const enemy of globalScene.getEnemyField(true)) {
      if (enemy == null) {
        continue;
      }
      const bi = enemy.getBattlerIndex();
      if (bi < BattlerIndex.ENEMY) {
        continue;
      }
      // Idempotency guard: already off-field / inactive -> nothing to remove (re-apply safe).
      if (!enemy.isActive() || !enemy.isOnField()) {
        continue;
      }
      if (hostAliveEnemies.has(bi)) {
        continue;
      }
      // Side-effect-free removal via the shared helper (#633 trainer-victory deadlock): it stamps
      // doSetStatus(FAINT) before leaveField exactly like the host FaintPhase, so the off-field KOd
      // enemy reads isFainted(true)===true - VictoryPhase's win guard checks the STATUS, not just hp.
      coopRemoveFromField(enemy);
    }
    // PASS 2 - SWAP/SUMMON: mirror a host ENEMY SWITCH (#633, enemy-switch mirror). For each enemy
    // bi the host reports ALIVE with a `speciesId`, if the guest's mon at that field slot is a
    // DIFFERENT species (a switch happened), summon the matching adopted party member onto the slot
    // (the guest's enemy party is in the SAME encounter order as the host, so the species identifies
    // which member). speciesId 0 / absent (an older payload or a player slot) is skipped. The
    // `partyIndex` stream field can NOT drive this - for an on-field mon it always equals the field
    // slot, so it carries no switch info (Oracle-verified); species is the robust signal.
    for (const entry of hostField) {
      if (entry.bi < BattlerIndex.ENEMY || entry.fainted) {
        continue;
      }
      const speciesId = entry.speciesId ?? 0;
      if (speciesId <= 0) {
        continue;
      }
      const fieldSlot = entry.bi - BattlerIndex.ENEMY;
      const party = globalScene.getEnemyParty();
      const current = party[fieldSlot];
      // No-op if the correct species is already on this field slot (idempotent re-apply).
      if (current != null && current.species?.speciesId === speciesId) {
        continue;
      }
      // Bench starts after the on-field slots (getEnemyField is party.slice(0, double?2:1)).
      const onFieldCount = globalScene.getEnemyField(false).length;
      // Find the adopted party member of the host's reported species that is NOT already on-field
      // (a bench slot), so we bring in the switched-in mon, not re-place an on-field duplicate.
      const partySlot = party.findIndex((p, i) => p != null && i >= onFieldCount && p.species?.speciesId === speciesId);
      if (partySlot < 0) {
        continue;
      }
      summonCoopEnemyField(fieldSlot, partySlot);
    }
    // C.2 (#633, MAJOR-3) - NON-OPTIONAL post-PASS-2 orphan sweep: PASS 2's swap (and the incoming-vacate
    // inside summonCoopEnemyField) can leave a fresh on-field orphan at an enemy slot the host reports
    // NOT alive. PASS 1 only saw the pre-PASS-2 state, so re-run the removal for any on-field guest enemy
    // whose bi is not in the host's alive set.
    for (const enemy of globalScene.getEnemyField(true)) {
      if (enemy == null || !enemy.isActive() || !enemy.isOnField()) {
        continue;
      }
      const bi = enemy.getBattlerIndex();
      if (bi < BattlerIndex.ENEMY || hostAliveEnemies.has(bi)) {
        continue;
      }
      coopLog("field", `enemy post-PASS2 orphan sweep removing bi=${bi} speciesId=${enemy.species?.speciesId ?? 0}`);
      coopRemoveFromField(enemy);
    }
  } catch {
    // A malformed host field must never crash the guest's battle.
  }
}

/**
 * GUEST: place the enemy party member at `partySlot` onto enemy field slot `fieldIndex`, mirroring
 * the host's switch (#633, enemy-switch mirror). Side-effect-free + idempotent: it does the SAME
 * array swap the host's `SwitchSummonPhase` does (`party[fieldIndex] <-> party[partySlot]`, so the
 * guest's `getEnemyParty()` stays PERMUTATION-IDENTICAL to the host across subsequent turns) and the
 * VISUAL placement subset of `summonWild` (NOT the pokeball-throw `summon`, NOT switch-summon's
 * ability/hazard/baton pipeline - that would re-enter the resolution engine authoritative mode
 * exists to bypass). `loadAssets` is fire-and-forget (the sprite pops in a frame late - fine for a
 * renderer; mirrors the existing `void enemy.loadAssets(false)` adopt path). Fully guarded.
 */
export function summonCoopEnemyField(fieldIndex: number, partySlot: number): void {
  try {
    const party = globalScene.getEnemyParty();
    const incoming = party[partySlot];
    const outgoing = party[fieldIndex];
    // Guard: both party entries must exist and the slots must differ.
    if (incoming == null || outgoing == null || partySlot === fieldIndex) {
      return;
    }
    // Idempotency: if the correct mon is already on-field at this slot, nothing to do.
    if (party[fieldIndex] === incoming) {
      return;
    }
    // #633 ("sprites shifting right / superimposing on switch-in"): the coop summon has no pokeball-throw
    // to land the incoming mon's ABSOLUTE position, and resetSummonData() does NOT reset x/y/fieldPosition,
    // so without re-seating it the incoming sprite renders at a stale offset on top of the on-field mon.
    // Capture the VACATED slot's exact placement now (before any mutation) and copy it onto the incoming.
    const slotX = outgoing.x;
    const slotY = outgoing.y;
    const slotFieldPosition = outgoing.fieldPosition;
    // C.2 (#633, "switched in on top"): if the incoming mon is currently on-field at a DIFFERENT slot,
    // VACATE that slot first - the swap below moves it to `fieldIndex` but leaves its OLD field slot
    // pointing at a still-on-field sprite (a stale occupant). Side-effect-free (no FaintPhase /
    // SwitchPhase). The post-PASS-2 removal sweep in reconcileCoopEnemyField clears any orphan it leaves.
    if (incoming.isOnField() && party.indexOf(incoming) !== partySlot) {
      try {
        incoming.leaveField(true, true, false);
      } catch {
        /* vacating the incoming's old slot failed; the post-PASS-2 sweep still clears the orphan */
      }
    }
    // SWAP the guest's enemy party array EXACTLY like the host (switch-summon-phase.ts:223-224),
    // so getEnemyParty() index alignment stays permutation-identical to the host next turn.
    [party[fieldIndex], party[partySlot]] = [party[partySlot], party[fieldIndex]];
    // Remove the outgoing mon from the field, side-effect-free (no FaintPhase / SwitchPhase).
    try {
      outgoing.leaveField(true, true, false);
    } catch {
      /* leaving the outgoing mon failed; continue and still place the incoming one */
    }
    // Place the incoming mon: reset summon data, (re)load its sprite (fire-and-forget), add it to
    // the field below the player's mon, show its info + sprite, then field-setup (clears
    // switchOutStatus so it reads as ON-FIELD). Mirrors the summonWild placement subset.
    incoming.resetSummonData();
    // #838 SPEC-1 (enemy-side #791 seating parity): seat via the REAL setFieldPosition (duration 0),
    // which applies the slot offset AND the battle-info seating (setMini + setSlotOffset) that the old
    // RAW fieldPosition write bypassed - without it an enemy DOUBLE switch-in renders its HP bar at the
    // wrong slot offset / full size on top of the ally's bar (the #791 class, enemy side). Derive the
    // side's CANONICAL base from a LIVE enemy ally when one exists (its x/y minus its own slot offset;
    // the vacated-slot capture is unreliable after a KO drop-tween), else fall back to the outgoing
    // capture minus the slot offset. Mirrors summonCoopPlayerField exactly.
    incoming.fieldPosition = slotFieldPosition;
    const slotOffset = incoming.getFieldPositionOffset();
    let baseX = slotX - slotOffset[0];
    let baseY = slotY - slotOffset[1];
    const liveAlly = globalScene
      .getEnemyField(true)
      .find(p => p != null && p !== incoming && p !== outgoing && p.isActive() && p.isOnField());
    if (liveAlly != null) {
      const allyOffset = liveAlly.getFieldPositionOffset();
      baseX = liveAlly.x - allyOffset[0];
      baseY = liveAlly.y - allyOffset[1];
    }
    incoming.fieldPosition = FieldPosition.CENTER;
    incoming.setPosition(baseX, baseY);
    void incoming.setFieldPosition(slotFieldPosition, 0);
    void incoming.loadAssets(true);
    globalScene.field.add(incoming);
    // Cast to the common base so `moveBelow<T>` (which constrains both args to one T) accepts an
    // EnemyPokemon below a PlayerPokemon - exactly as summon-phase.ts does for the wild summon.
    const playerPokemon: Pokemon | undefined = globalScene.getPlayerPokemon();
    if (playerPokemon != null) {
      globalScene.field.moveBelow(incoming as Pokemon, playerPokemon);
    }
    incoming.showInfo();
    incoming.setVisible(true);
    incoming.getSprite()?.setVisible(true);
    incoming.fieldSetup(true);
    globalScene.updateFieldScale();
    // #838 SPEC-2 (one-frame stale info panel): showInfo() only makes the bar visible; a freshly
    // summoned boss/statused mon shows a STALE bar until the per-turn numeric apply redraws it next
    // turn. Refresh the hp/status panel + the boss shield dividers NOW.
    void incoming.updateInfo();
    const info = incoming.getBattleInfo();
    if (info instanceof EnemyBattleInfo) {
      info.updateBossSegments(incoming);
    }
  } catch {
    // A malformed switch mirror must never crash the guest's battle.
  }
}

/**
 * GUEST: reconcile the live PLAYER field to the host's authoritative composition (#633
 * partner-death sync). The mirror of {@linkcode reconcileCoopEnemyField} for the PLAYER side: in
 * the authoritative co-op double a partner's mon (a player mon at battler index 0/1) can FAINT on
 * the host, but the per-mon numeric apply only matches by battler index and never REMOVES, so the
 * just-fainted partner stays ALIVE on the guest forever - a field-composition desync from the
 * first move. With the host now serializing the player side SLOT-PRESENT (so a just-fainted partner
 * rides the checkpoint with `fainted:true`), this helper closes the gap: from the host's serialized
 * `hostField` it computes the set of PLAYER battler indices (bi < ENEMY, i.e. 0/1) the host reports
 * PRESENT-AND-ALIVE (`!fainted`), then for every player mon currently ON the guest's active field
 * whose `bi` is NOT in that set, it does a side-effect-free field removal (set hp 0 then
 * {@linkcode Pokemon.leaveField} - NO FaintPhase / SwitchPhase, so the engine resolution pipeline is
 * never re-entered).
 *
 * STRICTLY player slots (bi < ENEMY); enemy faints (bi 2/3) are the enemy reconcile's job and are
 * never touched here. Idempotent: a mon already not `isActive()` / not `isOnField()` is skipped, so
 * re-applying the same checkpoint (or the resync mirror) can never double-remove. PASS 2 mirrors a
 * host REPLACEMENT (a partner's bench mon sent in for a fainted slot - HALF B's host auto-pick): a
 * different `speciesId` now at a player bi -> summon the matching party member. Fully guarded so one
 * bad removal/summon can't break the rest of the heal.
 */
export function reconcileCoopPlayerField(
  hostField: { bi: number; fainted: boolean; speciesId?: number; partyIndex?: number }[],
): void {
  try {
    // Player battler indices the host reports PRESENT-AND-ALIVE (slot present, not fainted).
    const hostAlivePlayers = new Set<number>();
    for (const entry of hostField) {
      if (entry.bi < BattlerIndex.ENEMY && !entry.fainted) {
        hostAlivePlayers.add(entry.bi);
      }
    }
    // PASS 1 - REMOVE: drop every guest player mon that is on-field-and-active but NOT alive on the host.
    for (const mon of globalScene.getPlayerField(true)) {
      if (mon == null) {
        continue;
      }
      const bi = mon.getBattlerIndex();
      if (bi >= BattlerIndex.ENEMY) {
        continue;
      }
      // Idempotency guard: already off-field / inactive -> nothing to remove (re-apply safe).
      if (!mon.isActive() || !mon.isOnField()) {
        continue;
      }
      if (hostAlivePlayers.has(bi)) {
        continue;
      }
      // Side-effect-free removal (no FaintPhase / resolution pipeline - that would re-introduce the
      // engine divergence authoritative mode exists to prevent).
      coopRemoveFromField(mon);
    }
    // PASS 2 - SWAP/SUMMON: REPOSITION the host's reported mon onto each player field slot (#633:
    // mirror a host partner REPLACEMENT from the bench AND repair a field/party-order divergence -
    // e.g. a guest SELF-SWITCH that was dropped, leaving the right mon ON-FIELD but at the WRONG
    // slot). For each player bi the host reports ALIVE with a `speciesId`, if the guest's mon at that
    // field slot is a DIFFERENT species, find the matching member ANYWHERE in the guest party
    // (bench OR on-field at the wrong slot) and REPOSITION it to the slot via the side-effect-free
    // swap - REPOSITION, never remove-then-resummon (a failed resummon would softlock the field).
    // Duplicate species are DISAMBIGUATED by the host's serialized `partyIndex` (the stable party-slot
    // identity the checksum hashes), not first-species-wins, so two same-species mons can't be crossed.
    // speciesId 0 / absent (an older payload or an enemy slot) is skipped.
    for (const entry of hostField) {
      if (entry.bi >= BattlerIndex.ENEMY || entry.fainted) {
        continue;
      }
      const speciesId = entry.speciesId ?? 0;
      if (speciesId <= 0) {
        continue;
      }
      const fieldSlot = entry.bi;
      const party = globalScene.getPlayerParty();
      const current = party[fieldSlot];
      // No-op if the correct species is already on this field slot (idempotent re-apply). When the host
      // disambiguates by partyIndex, also require the SAME party-slot identity so a same-species
      // duplicate at this slot is still repositioned to the host's exact member.
      const hostPartyIndex = typeof entry.partyIndex === "number" ? entry.partyIndex : -1;
      if (
        current != null
        && current.species?.speciesId === speciesId
        && (hostPartyIndex < 0 || party.indexOf(current) === hostPartyIndex)
      ) {
        continue;
      }
      // Find the matching member ANYWHERE in the party (bench OR on-field at the wrong slot), so a mon
      // that is on-field-but-mis-slotted is repositioned (the dropped-self-switch case), not just a
      // bench replacement. Prefer the host's exact partyIndex slot to disambiguate duplicate species;
      // fall back to the first species match (older payloads without a usable partyIndex).
      let partySlot = -1;
      if (
        hostPartyIndex >= 0
        && hostPartyIndex !== fieldSlot
        && party[hostPartyIndex]?.species?.speciesId === speciesId
      ) {
        partySlot = hostPartyIndex;
      } else {
        partySlot = party.findIndex((p, i) => p != null && i !== fieldSlot && p.species?.speciesId === speciesId);
      }
      if (partySlot < 0) {
        continue;
      }
      // C.1 diagnostic (#633): PASS 2 is repositioning this mon to a DIFFERENT slot than where it
      // currently sits (partySlot -> fieldSlot). Logged so a future capture shows whether PASS 2 ever
      // DISAGREES with the eager self-switch swap in turn-start-phase (if it never logs for the guest's
      // own switch, the eager swap already matched the host and the orphan fix below is the real cure).
      coopLog(
        "field",
        `player PASS2 reposition speciesId=${speciesId} from=${partySlot} to=${fieldSlot} bi=${entry.bi}`,
      );
      summonCoopPlayerField(fieldSlot, partySlot);
    }
    // C.2 (#633, MAJOR-3) - NON-OPTIONAL post-PASS-2 orphan sweep: PASS 2's repositioning swap (and the
    // incoming-vacate inside summonCoopPlayerField) can leave a fresh on-field orphan at a slot the host
    // reports NOT alive - the "switched in on top" stale sprite. PASS 1 only saw the pre-PASS-2 state, so
    // re-run the removal for any on-field guest player mon whose bi is not in the host's alive set.
    for (const mon of globalScene.getPlayerField(true)) {
      if (mon == null || !mon.isActive() || !mon.isOnField()) {
        continue;
      }
      const bi = mon.getBattlerIndex();
      if (bi >= BattlerIndex.ENEMY || hostAlivePlayers.has(bi)) {
        continue;
      }
      coopLog("field", `player post-PASS2 orphan sweep removing bi=${bi} speciesId=${mon.species?.speciesId ?? 0}`);
      coopRemoveFromField(mon);
    }
  } catch {
    // A malformed host field must never crash the guest's battle.
  }
}

/**
 * GUEST: place the player party member at `partySlot` onto player field slot `fieldIndex`, mirroring
 * the host's partner replacement (#633 partner-death sync, HALF B). The PLAYER-side mirror of
 * {@linkcode summonCoopEnemyField}: side-effect-free + idempotent, it does the SAME array swap the
 * host's `SwitchSummonPhase` does (`party[fieldIndex] <-> party[partySlot]`, so the guest's
 * `getPlayerParty()` stays PERMUTATION-IDENTICAL to the host across subsequent turns) and the VISUAL
 * placement subset of a summon (NO FaintPhase / SwitchSummonPhase resolution pipeline - that would
 * re-enter the engine authoritative mode exists to bypass). Unlike the enemy mirror it OMITS the
 * `field.moveBelow(...)` z-order call: a player mon renders on TOP and its back sprite is automatic
 * for a PlayerPokemon via `loadAssets`, so no extra ordering flag is needed. `loadAssets` is
 * fire-and-forget (the sprite pops in a frame late - fine for a renderer). Fully guarded.
 */
export function summonCoopPlayerField(fieldIndex: number, partySlot: number): void {
  try {
    const party = globalScene.getPlayerParty();
    const incoming = party[partySlot];
    const outgoing = party[fieldIndex];
    // Guard: both party entries must exist and the slots must differ.
    if (incoming == null || outgoing == null || partySlot === fieldIndex) {
      return;
    }
    // Idempotency: if the correct mon is already on-field at this slot, nothing to do.
    if (party[fieldIndex] === incoming) {
      return;
    }
    // #633 ("sprites shifting right / superimposing on switch-in"): the coop summon has no pokeball-throw
    // to land the incoming mon's ABSOLUTE position, and resetSummonData() does NOT reset x/y/fieldPosition,
    // so without re-seating it the incoming sprite renders at a stale offset on top of the on-field mon.
    // Capture the VACATED slot's exact placement now (before any mutation) and copy it onto the incoming.
    const slotX = outgoing.x;
    const slotY = outgoing.y;
    const slotFieldPosition = outgoing.fieldPosition;
    // C.2 (#633, "switched in on top"): if the incoming mon is currently on-field at a DIFFERENT slot,
    // VACATE that slot first - the swap below moves it to `fieldIndex` but leaves its OLD field slot
    // pointing at a still-on-field sprite, the stale occupant the player sees "switched in on top of"
    // their mon's position. Side-effect-free (no FaintPhase / SwitchPhase). The post-PASS-2 removal
    // sweep in reconcileCoopPlayerField then force-clears any orphan this leaves.
    if (incoming.isOnField() && party.indexOf(incoming) !== partySlot) {
      try {
        incoming.leaveField(true, true, false);
      } catch {
        /* vacating the incoming's old slot failed; the post-PASS-2 sweep still clears the orphan */
      }
    }
    // SWAP the guest's player party array EXACTLY like the host (switch-summon-phase.ts:223-224),
    // so getPlayerParty() index alignment stays permutation-identical to the host next turn.
    [party[fieldIndex], party[partySlot]] = [party[partySlot], party[fieldIndex]];
    // Remove the outgoing mon from the field, side-effect-free (no FaintPhase / SwitchPhase).
    try {
      outgoing.leaveField(true, true, false);
    } catch {
      /* leaving the outgoing mon failed; continue and still place the incoming one */
    }
    // Place the incoming mon: reset summon data, (re)load its sprite (fire-and-forget; the back
    // sprite is automatic for a PlayerPokemon), add it to the field, show its info + sprite, then
    // field-setup (clears switchOutStatus so it reads as ON-FIELD). No moveBelow - the player mon
    // renders on top.
    incoming.resetSummonData();
    // #791 (live "the UI is placed on top of the other"): the OUTGOING capture is unreliable
    // after a FAINT - the drop animation tweened that container low, so seating the incoming at
    // outgoing.x/y parked the new sprite over the bottom UI. Derive the side's CANONICAL base
    // from a LIVE ally when one exists (its x/y minus its own slot offset); fall back to the
    // outgoing capture minus the slot's offset otherwise. Then seat via the REAL
    // setFieldPosition (duration 0): it applies the slot offset AND the battle-info seating
    // (setMini + setSlotOffset) that the old direct fieldPosition write bypassed - which is why
    // the new mon's HP bar rendered full-size ON TOP of the ally's bar.
    incoming.fieldPosition = slotFieldPosition;
    const slotOffset = incoming.getFieldPositionOffset();
    let baseX = slotX - slotOffset[0];
    let baseY = slotY - slotOffset[1];
    const liveAlly = globalScene
      .getPlayerField(true)
      .find(p => p != null && p !== incoming && p !== outgoing && p.isActive() && p.isOnField());
    if (liveAlly != null) {
      const allyOffset = liveAlly.getFieldPositionOffset();
      baseX = liveAlly.x - allyOffset[0];
      baseY = liveAlly.y - allyOffset[1];
    }
    incoming.fieldPosition = FieldPosition.CENTER;
    incoming.setPosition(baseX, baseY);
    void incoming.setFieldPosition(slotFieldPosition, 0);
    void incoming.loadAssets(true);
    globalScene.field.add(incoming);
    incoming.showInfo();
    incoming.setVisible(true);
    incoming.getSprite()?.setVisible(true);
    incoming.fieldSetup(true);
    globalScene.updateFieldScale();
    // #838 SPEC-2 (one-frame stale info panel): refresh the hp/status panel now so a freshly summoned
    // statused replacement doesn't flash a stale bar until the per-turn numeric apply redraws it.
    void incoming.updateInfo();
  } catch {
    // A malformed replacement mirror must never crash the guest's battle.
  }
}

/**
 * GUEST: reconcile the live arena tags to exactly the host's set (#633 GAP 1). Hazards / screens
 * / tailwind (Stealth Rock, Spikes, Reflect, Light Screen, Tailwind, ...) are set by host
 * MoveEffectPhases the pure-renderer guest never runs, so the guest never gains them and the
 * per-turn checksum (which hashes `(tagType, side)`) resync-loops forever. This matches the guest's
 * `arena.tags` to the host's by `(tagType, side)`:
 *  - ADD any host tag the guest lacks (`arena.addTag`, then force the host's `turnCount`; for a
 *    multi-layer entry hazard, replay `onOverlap` up to the host's layer count).
 *  - REMOVE any guest tag the host doesn't have (`arena.removeTagOnSide`).
 *  - For a tag present on BOTH, force the host's `turnCount` (a screen the host refreshed) without
 *    touching anything the checksum hashes - turn counts are excluded by design, so this only fixes
 *    rendering and can never trip a false desync.
 * Idempotent (re-applying the same set is a no-op once converged). The `addTag` / `removeTagOnSide`
 * APIs may queue an on-add / on-remove message + animation; that is acceptable for a renderer. Fully
 * guarded so one bad tag can't break the rest of the heal. A `null`/`undefined` `hostTags` (an older
 * payload that never carried tags) is a hard skip - the guest's tags are left exactly as they were.
 */
export function reconcileArenaTags(hostTags: CoopSerializedArenaTag[] | undefined, strict = false): void {
  if (hostTags == null) {
    return;
  }
  try {
    const arena = globalScene.arena;
    // Key a tag by (tagType, side) - the checksum's identity. The host set is the source of truth.
    const keyOf = (tagType: string, side: number): string => `${tagType}|${side}`;
    const wanted = new Map<string, CoopSerializedArenaTag>();
    for (const t of hostTags) {
      if (typeof t.tagType === "string") {
        wanted.set(keyOf(t.tagType, t.side), t);
      }
    }
    // REMOVE: drop every guest tag the host no longer has (iterate a snapshot - removal mutates the array).
    for (const tag of [...arena.tags]) {
      const k = keyOf(tag.tagType as unknown as string, tag.side as unknown as number);
      if (!wanted.has(k)) {
        coopWarn("heal", `arenaTag REMOVE tagType=${tag.tagType} side=${tag.side} (host lacks it) -> removed`);
        try {
          arena.removeTagOnSide(tag.tagType, tag.side, true);
        } catch (error) {
          if (strict) {
            recordCoopApplyFailure("arenaTags", error);
          }
        }
      }
    }
    // ADD / REFRESH: ensure every host tag exists with the host's turnCount + layers.
    for (const want of wanted.values()) {
      try {
        const tagType = want.tagType as unknown as ArenaTagType;
        const side = want.side as unknown as ArenaTagSide;
        let existing = arena.getTagOnSide(tagType, side);
        if (existing == null) {
          coopWarn(
            "heal",
            `arenaTag ADD tagType=${want.tagType} side=${want.side} layers=${want.layers} turnCount=${want.turnCount} (guest lacked it) -> added`,
          );
          // Side-effect-quiet add (no source move / id needed for a render of an already-resolved tag).
          arena.addTag(tagType, Math.max(0, Math.trunc(want.turnCount)), undefined as unknown as MoveId, 0, side, true);
          existing = arena.getTagOnSide(tagType, side);
          // Replay overlaps to reach the host's entry-hazard layer count (Spikes / Toxic Spikes).
          if (existing instanceof EntryHazardTag) {
            for (let i = existing.layers; i < want.layers; i++) {
              existing.onOverlap();
            }
          }
        }
        // Force the host's turnCount (a refreshed screen / pinch-restored hazard). Excluded from
        // the hash, so this only corrects rendering and never causes a false desync.
        if (existing != null) {
          existing.turnCount = Math.max(0, Math.trunc(want.turnCount));
        }
      } catch (error) {
        if (strict) {
          recordCoopApplyFailure("arenaTags", error);
        }
      }
    }
  } catch (error) {
    // A malformed arena-tag set must never crash the guest's battle. A full authoritative transaction,
    // however, must reject instead of silently committing the other sections around this failed one.
    if (strict) {
      recordCoopApplyFailure("arenaTags", error);
    }
  }
}

/**
 * GUEST: snap the live field + arena to the host's authoritative `checkpoint`. Applied
 * at a turn boundary. Conservative + fully guarded: corrects numeric state only, and a
 * per-mon failure is swallowed so one bad entry can't break the rest of the battle.
 *
 * RETURNS whether the checkpoint was APPLIED (`true`) or REJECTED as stale by the #807
 * monotonic-tick guard (`false`). The caller uses this to gate the COMPANION per-mon
 * `fullField` snapshot + the checksum-verify: when a turn-resolution checkpoint is superseded
 * by a NEWER out-of-band replacement checkpoint (the live guest-faint tick race, seed
 * EW0gvphu5Ps8dmWDaUKqgr8x - a KOd slot's replacement summons, then the stale resolution's
 * fullField re-applies the pre-summon FAINTED state and instantly re-KOs it), the stale
 * checkpoint is rejected HERE but its ungated fullField would still clobber the freshly
 * summoned replacement. Gating the fullField on this return keeps the two in lockstep so a
 * stale companion snapshot can never override a newer field composition.
 */
export function applyCoopCheckpoint(checkpoint: CoopBattleCheckpoint): boolean {
  try {
    // SHOWDOWN (Task F1): reflect the legacy numeric checkpoint (slot/bi-keyed hp/status/stages + arena
    // tags) into the versus guest's LOCAL orientation before it reconciles the field. Distinct coordinate
    // space from the id-keyed authoritativeState (which rides the same turnResolution and is swapped in
    // applyCoopAuthoritativeBattleState); each is swapped exactly once. No-op off the versus-guest path.
    if (isShowdownGuestFlipGated()) {
      checkpoint = swapCheckpoint(checkpoint);
    }
    // #807: reject out-of-order/stale state (standard snapshot sequencing).
    if (!coopAcceptStateTick(checkpoint.tick, "checkpoint")) {
      return false;
    }
    coopLog(
      "checkpoint",
      `guest apply field=${checkpoint.field?.length ?? 0} weather=${checkpoint.weather} terrain=${checkpoint.terrain} arenaTags=${checkpoint.arenaTags?.length ?? 0}`,
    );
    // Reconcile the enemy field COMPOSITION to the host's FIRST (#633): drop any guest enemy the
    // host KOd this turn (it rides the checkpoint with fainted:true) AND mirror any host enemy
    // SWITCH (a different species now at a slot -> summon the matching adopted member). Done BEFORE
    // the per-mon numeric apply below so the freshly-summoned switched-in mon at a slot RECEIVES the
    // host's hp/status/stages for that bi (otherwise the numeric state writes onto the wrong, pre-swap
    // mon - Oracle ordering). Strictly enemy slots; side-effect-free; idempotent.
    reconcileCoopEnemyField(checkpoint.field);
    // ...and the PLAYER field COMPOSITION too (#633 partner-death sync): drop any guest partner the
    // host KOd this turn (it rides the checkpoint with fainted:true) AND mirror a host partner
    // REPLACEMENT (a different species now at a player slot -> summon the matching member). Same
    // BEFORE-the-numeric-apply ordering as the enemy reconcile so the freshly-summoned replacement
    // RECEIVES the host's hp/status/stages for that bi. Strictly player slots; side-effect-free; idempotent.
    reconcileCoopPlayerField(checkpoint.field);
    // Reconciliation above can remove a just-fainted battler from the ACTIVE field and reset its
    // summonData (including stat stages). Apply onto the same SLOT-PRESENT view the host serialized,
    // so that removed object still receives the authoritative terminal state used by the checksum.
    // This also keeps freshly reconciled replacements addressable by battler index.
    for (const mon of getCoopSerializableField()) {
      if (mon == null) {
        continue;
      }
      const raw = monStateByIndex(checkpoint, mon.getBattlerIndex());
      if (raw == null) {
        continue;
      }
      const state = normalizeMonState(raw);
      try {
        // A reconstructed authoritative mon can enter the logical field before any summon phase creates its
        // sprite/battle-info children. Numeric correction calls updateInfo/loadAssets below, so initialize
        // those presentation nodes first instead of silently abandoning the rest of this mon's checkpoint.
        ensureCoopPokemonPresentationNodes(mon);
        if (state.maxHp > 0 && mon.getMaxHp() !== state.maxHp) {
          coopWarn(
            "checkpoint",
            `mon bi=${mon.getBattlerIndex()} maxHp host=${state.maxHp} guest=${mon.getMaxHp()} -> applied`,
          );
          mon.setStat(Stat.HP, state.maxHp);
        }
        // hp is pre-clamped to [0, maxHp]. A host-fainted mon must still receive the FAINT status,
        // stat stages and move PP even when the renderer's animation already reduced it to zero; skipping
        // every scalar merely because the local mon was already fainted left status/PP permanently stale.
        // We still avoid force-fainting a locally alive mon from a legacy ambiguous zero-hp entry unless the
        // host explicitly marks the slot fainted.
        if (!mon.isFainted() || state.fainted) {
          if (isCoopDebug()) {
            const wantHp = Math.min(state.hp, mon.getMaxHp());
            const guestStatus = mon.status?.effect ?? 0;
            if (mon.hp !== wantHp || guestStatus !== (state.status ?? 0)) {
              coopWarn(
                "checkpoint",
                `mon bi=${mon.getBattlerIndex()} hp host=${wantHp} guest=${mon.hp} status host=${state.status ?? 0} guest=${guestStatus} -> applied`,
              );
            }
          }
          mon.hp = Math.min(state.hp, mon.getMaxHp());
          mon.status = state.status ? new Status(state.status as StatusEffect) : null;
          const stages = mon.getStatStages();
          for (let i = 0; i < 7 && i < stages.length; i++) {
            stages[i] = state.statStages[i];
          }
          // A volatile-tag read can fail after field reconciliation has removed/reset a fainted mon.
          // Tag repair is independent of the authoritative scalar fields below: never let one malformed
          // or temporarily detached tag container prevent PP/form/tera/ownership from converging.
          try {
            repairErTags(mon, state.erTags);
          } catch (error) {
            coopWarn(
              "checkpoint",
              `mon bi=${mon.getBattlerIndex()} ER-tag repair failed; continuing scalar adoption: ${String(error)}`,
            );
          }
          // #798 PP sync: adopt the host's ppUsed PER MATCHING MOVE ID. Deliberately
          // conservative - never adds/removes/reorders moves (learn-move has its own relay);
          // an id mismatch skips that slot and the resync backstop still heals it.
          // #809: adopt FORM + TERA (the checksum hashes both, so carrying them here keeps
          // checksums matched through megas/teras instead of triggering a forced resync).
          if (state.formIndex !== undefined && mon.formIndex !== state.formIndex) {
            coopLog(
              "checkpoint",
              `mon bi=${mon.getBattlerIndex()} formIndex ${mon.formIndex} -> ${state.formIndex} (#809)`,
            );
            mon.formIndex = state.formIndex;
            try {
              void mon.loadAssets(false);
            } catch {
              /* sprite refresh is cosmetic; state is what must converge */
            }
          }
          if (state.isTerastallized !== undefined) {
            mon.isTerastallized = state.isTerastallized;
          }
          if (state.teraType !== undefined) {
            (mon as { teraType?: number }).teraType = state.teraType;
          }
          // #804 slot-ownership heal: adopt the host-resolved owner tag on PLAYER mons,
          // GUARDED (never clear on undefined - same rule as applyFullMon). Divergent tags
          // made both clients resolve a slot as the partner's (the ME battle deadlock);
          // per-turn adoption keeps command routing agreed on both engines.
          if (state.coopOwner !== undefined && mon.isPlayer()) {
            const cur = (mon as { coopOwner?: "host" | "guest" }).coopOwner;
            if (cur !== state.coopOwner) {
              coopWarn(
                "checkpoint",
                `mon bi=${mon.getBattlerIndex()} coopOwner host=${state.coopOwner} guest=${cur ?? "-"} -> adopted (#804)`,
              );
              (mon as { coopOwner?: "host" | "guest" }).coopOwner = state.coopOwner;
            }
          }
          if (state.moves !== undefined) {
            // Faint/reconcile can switch getMoveset() between the summon override and base moveset during
            // this same apply. Align every distinct backing list so the authoritative PP survives either
            // representation becoming active after the mon leaves the field.
            const movesets = [mon.moveset, mon.summonData?.moveset, mon.getMoveset()].filter(
              (moveset, index, all): moveset is PokemonMove[] =>
                Array.isArray(moveset) && all.indexOf(moveset) === index,
            );
            for (const wire of state.moves) {
              for (const moveset of movesets) {
                const slot = moveset.find(m => m?.moveId === wire.id);
                if (slot != null && slot.ppUsed !== wire.ppUsed) {
                  slot.ppUsed = Math.max(0, Math.trunc(wire.ppUsed));
                }
              }
            }
          }
          void mon.updateInfo();
        }
      } catch (error) {
        // Checkpoint apply is the hot recovery boundary. A silent partial apply makes a persistent
        // divergence look like a transport failure, so retain isolation while emitting the exact mon.
        coopWarn(
          "checkpoint",
          `mon bi=${mon.getBattlerIndex()} correction failed; continuing other mons: ${String(error)}`,
        );
      }
    }
    // Correct weather / terrain type if it drifted (turn counts are approximate).
    const arena = globalScene.arena;
    if ((arena.weather?.weatherType ?? 0) !== checkpoint.weather) {
      coopWarn("checkpoint", `weather host=${checkpoint.weather} guest=${arena.weather?.weatherType ?? 0} -> applied`);
      arena.trySetWeather(checkpoint.weather as WeatherType);
    }
    if ((arena.terrain?.terrainType ?? 0) !== checkpoint.terrain) {
      coopWarn("checkpoint", `terrain host=${checkpoint.terrain} guest=${arena.terrain?.terrainType ?? 0} -> applied`);
      arena.trySetTerrain(checkpoint.terrain as TerrainType, true);
    }
    // Reconcile arena tags (#633 GAP 1): add hazards/screens/tailwind the guest's MoveEffectPhases
    // never set, remove ones the host cleared. This is the top resync-loop fix - the checksum hashes
    // `(tagType, side)`, so converging the SET is what makes it stop diverging every turn.
    reconcileArenaTags(checkpoint.arenaTags);
    // Mirror the host's authoritative MONEY (#633/#698 money transient). The pure-renderer guest never
    // runs the host-only money mutations (between-wave reward-shop BUY, in-battle Pay Day / scattered-money
    // pickup), so its money lags until a full resync heals it. Force-SETTING the host's value every turn
    // mirrors it continuously, so the visible "host=824 guest=1000" transient never shows (the first turn
    // of the wave after a shop spend snaps it). GATED to the authoritative GUEST so solo / host / lockstep
    // never touch money here (the host owns + computes its own money; only the renderer adopts it). Additive:
    // an older host omits `money` (undefined) and the guest leaves its money alone (no regression).
    if (checkpoint.money !== undefined && isCoopAuthoritativeGuestGated() && globalScene.money !== checkpoint.money) {
      coopWarn("checkpoint", `money host=${checkpoint.money} guest=${globalScene.money} -> applied`);
      globalScene.money = checkpoint.money;
      globalScene.updateMoneyText();
    }
    return true;
  } catch {
    // A malformed checkpoint must never crash the guest's battle.
    return false;
  }
}

/**
 * HOST: serialize the generated enemy party's identity (#633, LIVE-D6). Species /
 * level / IVs already match across clients (deterministic wave gen from the shared
 * seed); what diverged live was the rolled ABILITY (and potentially moveset). We send
 * the identity fields the guest overwrites so its enemies behave identically - by
 * party index, NOT a full Pokemon reconstruction (sprites/loading stay intact).
 */
export function captureCoopEnemies(): CoopSerializedEnemy[] {
  try {
    const enemies = globalScene.getEnemyParty();
    // Runtime ids are RNG-derived and a restored wave seed can revisit an earlier cursor. Same-side duplicate
    // ids make field seats and held-item ownership fundamentally ambiguous, so the host authority repairs them
    // once at the manifest boundary. Use a deterministic probe rather than consuming gameplay RNG; the chosen
    // id is carried to the guest below and by all later authoritative snapshots.
    const usedIds = new Set<number>();
    for (const [index, enemy] of enemies.entries()) {
      if (!usedIds.has(enemy.id)) {
        usedIds.add(enemy.id);
        continue;
      }
      const duplicateId = enemy.id;
      let replacementId = (duplicateId + index + 1) >>> 0;
      while (usedIds.has(replacementId)) {
        replacementId = (replacementId + 1) >>> 0;
      }
      enemy.id = replacementId;
      usedIds.add(replacementId);
      coopWarn(
        "enemy",
        `duplicate same-side pokemon id=${duplicateId} at partyIndex=${index} -> authoritative id=${replacementId}`,
      );
    }
    return enemies.map((enemy, index) => {
      // Stat-affecting generation hooks can lower max HP after the constructor initialized current HP,
      // briefly leaving an invalid 42/40-style host state. Every checkpoint serializer already clamps this;
      // normalize the sole authority at the earlier enemy-manifest boundary too so host UI, guest adoption,
      // and the first checksum all describe one valid state.
      const maxHp = enemy.getMaxHp();
      if (enemy.hp > maxHp) {
        coopWarn("enemy", `host enemy hp exceeded max at manifest bi=${index}: ${enemy.hp}/${maxHp} -> clamped`);
        enemy.hp = maxHp;
      }
      return {
        fieldIndex: index,
        data: {
          id: enemy.id,
          speciesId: enemy.species.speciesId,
          formIndex: enemy.formIndex,
          level: enemy.level,
          abilityIndex: enemy.abilityIndex,
          nature: enemy.nature,
          gender: enemy.gender,
          ivs: [...enemy.ivs],
          moveset: enemy.getMoveset().map(m => m.moveId),
          // All six calculated stats are authority state. Species/level/IV/nature equality is not enough:
          // ER generation hooks and run modifiers can alter the constructor's final stat array differently
          // on two clients. Carry the finished values so the renderer never derives battle geometry locally.
          stats: [...enemy.stats],
          hp: enemy.hp,
          // Boss adopt (#633, A/BLOCKING-2): boss state lives ONLY on EnemyPokemon and is hardcoded
          // `false` on the guest's `addEnemyPokemon` reconstruct, so an adopted boss renders normal
          // bars. Carry the host's authoritative segment count + current index + maxHp ceiling so the
          // guest can `setBoss` with the EXPLICIT count (never re-rolling from its diverged wave RNG)
          // and render the right shield dividers. Additive: solo never streams this.
          isBoss: enemy.isBoss(),
          bossSegments: enemy.bossSegments,
          bossSegmentIndex: enemy.bossSegmentIndex,
          maxHp,
          // Shiny + variant are rolled in the Pokemon constructor from the wave RNG,
          // but the guest's adopt path (buildCoopEnemy) consumes the RNG in a different
          // order than the host's normal generation, so its independent roll diverged -
          // one client saw a shiny wild mon, the other a normal one (and a caught mon
          // then carried the wrong shininess into that player's save). Carry the host's
          // authoritative roll so the guest renders + catches the EXACT same mon.
          shiny: enemy.shiny,
          variant: enemy.variant,
          // Held items (#633): for TRAINER waves the host's `trainer.genModifiers` (and the
          // wild held-item roll) attach held modifiers the guest would otherwise regenerate
          // from its own RNG (double/divergent items). Serialize each as a `ModifierData`
          // (plain-JSON, the same shape the save system round-trips) so the guest rebuilds
          // the EXACT same items and suppresses its own roll. `pokemonId` is the host's
          // runtime id - the guest remaps it to its own enemy id on reconstruction.
          heldItems: captureEnemyHeldItems(enemy),
        },
      };
    });
  } catch {
    return [];
  }
}

/**
 * HOST: serialize ONE live mon's held-item modifiers as plain `ModifierData` blobs (#633). Reads the
 * mon's OWN side list (player list when `mon.isPlayer()`, else the enemy list) filtered to this mon by
 * `pokemonId`. Each entry survives the JSON transport as a flat object; the guest reconstructs it via
 * {@linkcode ModifierData.toModifier}. Used for both the enemy adopt (via {@linkcode captureEnemyHeldItems})
 * and the on-field player/enemy resync snapshot (#633 RISKY #1/#2/#3).
 */
function captureCoopHeldItems(mon: Pokemon): Record<string, unknown>[] {
  try {
    return globalScene
      .findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === mon.id, mon.isPlayer())
      .map(m => {
        const data = new ModifierData(m, false);
        return {
          typeId: coopModifierTypeId(m),
          className: data.className,
          args: data.args,
          stackCount: data.stackCount,
          ...(data.typePregenArgs === undefined ? {} : { typePregenArgs: data.typePregenArgs }),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Return the stable registry key used by ModifierData/wire reconstruction. A few older ER paths built a
 * generated vitamin type directly, leaving `type.id` undefined at runtime even though its static type is
 * `string`. Canonicalize that known legacy shape at the authority boundary as well as fixing its producers:
 * an in-progress trainer fight from an older save can then still converge instead of serializing JSON null
 * in the checksum and an unreconstructible modifier blob. Unknown unkeyed classes remain an explicit empty
 * key (and therefore cannot masquerade as a valid item).
 */
function coopModifierTypeId(modifier: PersistentModifier): string {
  const raw = modifier.type?.id as unknown;
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  if (modifier instanceof Modifier.BaseStatModifier) {
    return "BASE_STAT_BOOSTER";
  }
  return "";
}

/**
 * HOST: serialize one enemy's held-item modifiers as plain `ModifierData` blobs (#633). Thin wrapper
 * over {@linkcode captureCoopHeldItems} so {@linkcode captureCoopEnemies} stays byte-identical (an enemy's
 * `isPlayer()` is false -> the enemy list, exactly as before).
 */
function captureEnemyHeldItems(enemy: ReturnType<typeof globalScene.getEnemyParty>[number]): Record<string, unknown>[] {
  return captureCoopHeldItems(enemy);
}

/**
 * GUEST: reconstruct + attach the host's serialized held-item modifiers onto an adopted
 * enemy (#633). Mirrors the save-load path (game-data.ts): resolve the class from the
 * vanilla `Modifier` namespace (or the ER fallback), rebuild via {@linkcode ModifierData.toModifier},
 * remap `pokemonId` to THIS client's enemy id, then `addEnemyModifier`. Fully guarded per item
 * so one bad entry can't break the encounter. `enemyId` is the live `EnemyPokemon.id`.
 */
export function applyCoopEnemyHeldItems(enemyId: number, heldItems: unknown): void {
  if (!Array.isArray(heldItems)) {
    return;
  }
  for (const raw of heldItems) {
    if (raw == null || typeof raw !== "object") {
      continue;
    }
    try {
      const data = new ModifierData(raw, false);
      const modifier = data.toModifier(
        Modifier[data.className as keyof typeof Modifier] ?? resolveErModifierClass(data.className),
      );
      if (modifier instanceof PokemonHeldItemModifier) {
        // The serialized id is the HOST's runtime id; this client's enemy has its own id.
        modifier.pokemonId = enemyId;
        void globalScene.addEnemyModifier(modifier, true);
      }
    } catch {
      /* one held item failed to reconstruct; skip it, keep the rest */
    }
  }
}

/**
 * GUEST (authoritative resync): set a LIVE on-field mon's held items to exactly the host's snapshot
 * set (#633 RISKY #1/#2/#3). Removes the mon's current held items, then re-attaches the host's.
 * Hardened vs {@linkcode applyCoopEnemyHeldItems} (which only runs on a fresh enemy): operates on a LIVE
 * mon that may already hold items, so it (a) verifies each remove before re-adding to avoid a silent
 * incrementStack MERGE, (b) sets stackCount explicitly from the blob, (c) NEVER re-attaches a
 * `PokemonFormChangeItemModifier` (the form is authoritative via `snap.formIndex`; re-firing its apply()
 * on the player side would trigger a spurious form change), and (d) uses ignoreUpdate so no per-mon bar
 * re-render / "bag full" toast. Returns true if it changed anything (so the caller refreshes the right
 * bar once). Fully guarded.
 */
function applyCoopHeldItemsForMon(mon: Pokemon, heldItems: unknown): boolean {
  if (!Array.isArray(heldItems)) {
    return false;
  }
  let changed = false;
  // Per-mon diagnostic accumulators (#633): which held-item typeIds we removed/re-added on this mon, so
  // a tester reading the log sees the EXACT held-item rebind a Knock-Off / Grip-Claw / Covet desync caused.
  const debug = isCoopDebug();
  const removedTypeIds: string[] = [];
  const addedTypeIds: string[] = [];
  try {
    const isPlayer = mon.isPlayer();
    // 1) remove existing held items on this mon (each guarded by the removeModifier return). Track the
    // GENUINE SURVIVORS - items whose removeModifier returned FALSE (never spliced from the list) - by
    // object identity. Those, and ONLY those, are the pre-existing held items a re-add in step 2 must
    // not re-introduce a duplicate of. An item this heal pass itself re-adds is NEVER a survivor, so it
    // can never block a later same-type-id add (the #698 BERRY,BERRY drop). PokeRogue's PersistentModifier.
    // add() already merges by matchType() (BerryModifier keys on berryType, AttackTypeBoosterModifier on
    // moveType, etc.), so two DISTINCT same-type-id items (two different berries) are each pushed, while
    // two truly-identical items arrive from the host as ONE blob with stackCount and are added once.
    const survivors: PokemonHeldItemModifier[] = [];
    for (const m of globalScene.findModifiers(
      x => x instanceof PokemonHeldItemModifier && x.pokemonId === mon.id,
      isPlayer,
    )) {
      if (globalScene.removeModifier(m, !isPlayer)) {
        if (debug) {
          removedTypeIds.push(m.type.id);
        }
        changed = true;
      } else {
        // removeModifier returned false: this item was NOT in the list / not spliced -> a genuine
        // pre-existing survivor that the host's set must not duplicate.
        survivors.push(m as PokemonHeldItemModifier);
      }
    }
    // 2) re-attach the host's set.
    for (const raw of heldItems) {
      if (raw == null || typeof raw !== "object") {
        continue;
      }
      try {
        const data = new ModifierData(raw as Record<string, unknown>, false);
        const modifier = data.toModifier(
          Modifier[data.className as keyof typeof Modifier] ?? resolveErModifierClass(data.className),
        );
        // Held items ONLY; never re-fire a form-change item's apply() (the form is healed by snap.formIndex).
        if (!(modifier instanceof PokemonHeldItemModifier)) {
          continue;
        }
        if (modifier instanceof Modifier.PokemonFormChangeItemModifier) {
          continue;
        }
        // The serialized id is the HOST's runtime id; remap to THIS client's live mon id.
        modifier.pokemonId = mon.id;
        // stackCount from the blob (toModifier already restores it; re-assert defensively).
        if (typeof data.stackCount === "number") {
          modifier.stackCount = data.stackCount;
        }
        // Skip ONLY if a GENUINE SURVIVOR (an item step 1 could not remove) MATCH-TYPES this new item -
        // i.e. addModifier would silently MERGE into it (a stack drift) instead of binding a fresh copy.
        // Crucially this is matchType (the same predicate addModifier merges on), NOT type.id, so a second
        // DISTINCT same-type-id item (the #698 two-berries case) is no longer falsely dropped, and an item
        // THIS pass already re-added is never in `survivors` so it can never block a later same-type add.
        const collidesSurvivor = survivors.some(s => modifier.matchType(s));
        if (collidesSurvivor) {
          continue;
        }
        if (isPlayer) {
          void globalScene.addModifier(modifier, true, false, false);
        } else {
          void globalScene.addEnemyModifier(modifier, true);
        }
        if (debug) {
          addedTypeIds.push(modifier.type.id);
        }
        changed = true;
      } catch {
        /* one item failed to reconstruct; keep the rest */
      }
    }
  } catch {
    /* never break the heal */
  }
  if (debug && changed) {
    coopWarn(
      "heal",
      `heldItems monId=${mon.id} bi=${mon.getBattlerIndex()} removed=[${removedTypeIds.join(",")}] added=[${addedTypeIds.join(",")}] -> applied`,
    );
  }
  return changed;
}

/** Read a number field from an opaque serialized blob, or undefined if absent/wrong type. */
function num(blob: Record<string, unknown>, key: string): number | undefined {
  const v = blob[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * GUEST: overwrite each already-generated enemy's identity with the host's, by party
 * index (#633, LIVE-D6). Only corrects a mon of the SAME species (never rewrites a
 * structurally different one); sets ability / nature / gender / IVs / moveset, then
 * recomputes stats and clamps hp. Fully guarded per-enemy so one bad entry can't break
 * the encounter. Applied at the wave's first turn boundary, before any move resolves.
 */
export function applyCoopEnemies(enemies: CoopSerializedEnemy[]): void {
  try {
    const party = globalScene.getEnemyParty();
    for (const entry of enemies) {
      const enemy = party[entry.fieldIndex];
      if (enemy == null) {
        continue;
      }
      const d = entry.data;
      // Sanity: only correct a same-species mon (don't fight a structural mismatch).
      if (num(d, "speciesId") !== undefined && enemy.species.speciesId !== num(d, "speciesId")) {
        continue;
      }
      try {
        const id = num(d, "id");
        if (id !== undefined && enemy.id !== id >>> 0) {
          const previousId = enemy.id;
          const authoritativeId = id >>> 0;
          // The same-species path keeps the guest's existing object and its locally reconstructed held
          // modifiers. Move those bindings with the object before adopting the host id; otherwise the mon
          // becomes visually correct while its items remain orphaned under the discarded local id.
          for (const modifier of globalScene.findModifiers(
            m => m instanceof PokemonHeldItemModifier && m.pokemonId === previousId,
            false,
          )) {
            if (modifier instanceof PokemonHeldItemModifier) {
              modifier.pokemonId = authoritativeId;
            }
          }
          enemy.id = authoritativeId;
        }
        const abilityIndex = num(d, "abilityIndex");
        if (abilityIndex !== undefined) {
          enemy.abilityIndex = abilityIndex;
        }
        if (Array.isArray(d.ivs)) {
          enemy.ivs = (d.ivs as unknown[]).filter((n): n is number => typeof n === "number").slice(0, 6);
        }
        const nature = num(d, "nature");
        if (nature !== undefined) {
          enemy.nature = nature as Nature;
        }
        const gender = num(d, "gender");
        if (gender !== undefined) {
          enemy.gender = gender as Gender;
        }
        // Adopt the host's authoritative shiny + variant (#633). This corrector runs
        // at the wave's first turn boundary (sprite already summoned), so if the
        // shininess actually changed, reload the sprite so the rendered mon matches.
        const prevShiny = enemy.shiny;
        const prevVariant = enemy.variant;
        if (typeof d.shiny === "boolean") {
          enemy.shiny = d.shiny;
        }
        const variant = num(d, "variant");
        if (variant !== undefined) {
          enemy.variant = variant as 0 | 1 | 2;
        }
        if (enemy.shiny !== prevShiny || enemy.variant !== prevVariant) {
          void enemy.loadAssets(false);
        }
        if (Array.isArray(d.moveset)) {
          const moveIds = (d.moveset as unknown[]).filter((n): n is number => typeof n === "number");
          if (moveIds.length > 0) {
            enemy.moveset = moveIds.map(id => new PokemonMove(id));
          }
        }
        // IVs / nature changed -> recompute as a backwards-compatible fallback, then overwrite with the
        // authority's completed stat array when protocol data supplies it.
        enemy.calculateStats();
        if (Array.isArray(d.stats)) {
          const stats = (d.stats as unknown[]).filter((n): n is number => typeof n === "number").slice(0, 6);
          if (stats.length === 6 && stats.every(stat => Number.isFinite(stat) && stat > 0)) {
            enemy.stats = stats.map(stat => Math.trunc(stat));
          }
        }
        // Boss adopt mirror (#633, A/MINOR-2): the mid-wave by-index overwrite must ALSO re-assert
        // boss state, with the EXPLICIT host count (never the diverged-RNG `getEncounterBossSegments`
        // fallback) + the host's index. This path runs at the wave's first-turn boundary with the bar
        // ALREADY SHOWN, so `initBattleInfo()` (which, on an existing battleInfo, dispatches to
        // `updateBossSegments` rather than rebuilding) re-renders the segmented bar in place.
        const bossSegments = num(d, "bossSegments");
        if (bossSegments !== undefined && bossSegments > 0) {
          enemy.setBoss(true, bossSegments);
          const bsi = num(d, "bossSegmentIndex");
          if (bsi !== undefined) {
            enemy.bossSegmentIndex = bsi;
          }
          enemy.initBattleInfo();
        } else if (d.isBoss === false || bossSegments === 0) {
          // The modern manifest carries the canonical non-boss state.  Clear a stale local boss just as
          // authoritatively as the positive branch promotes one; setBoss(false) is an RNG-free 0/0 write.
          enemy.setBoss(false);
          if (enemy.getBattleInfo() != null) {
            enemy.initBattleInfo();
          }
        }
        // The same-species corrector is just as authoritative as the structural rebuild. A guest can roll
        // the host's species yet calculate a different HP stat under divergent ER constructor context; in
        // that common path adoptCoopEnemiesStructural deliberately keeps the existing object and lands here.
        // Apply the host ceiling before current hp so the first field/checksum frame is exact.
        const maxHp = num(d, "maxHp");
        if (maxHp !== undefined && maxHp > 0 && enemy.getMaxHp() !== Math.trunc(maxHp)) {
          coopWarn(
            "enemy",
            `applyCoopEnemies maxHp authority host=${Math.trunc(maxHp)} guest=${enemy.getMaxHp()} -> applied`,
          );
          enemy.setStat(Stat.HP, Math.trunc(maxHp));
        }
        const hp = num(d, "hp");
        if (hp !== undefined) {
          const ceiling = maxHp !== undefined && maxHp > 0 ? maxHp : enemy.getMaxHp();
          enemy.hp = Math.max(0, Math.min(hp, ceiling));
        }
        void enemy.updateInfo();
      } catch {
        /* one enemy's correction failed; leave it and continue */
      }
    }
  } catch {
    // A malformed enemy-party message must never break the encounter.
  }
}

// =============================================================================
// Per-turn state CHECKSUM + full-state RESYNC (#633, TRACK-2). The host stamps a
// 64-bit fingerprint of its FULL authoritative state on each turn; the guest
// recomputes the same fingerprint over its own state and, on a MISMATCH, requests a
// full snapshot the host serializes here and the guest adopts field-by-field. This
// makes ANY divergence (incl. the ability/form/PP/tag drift the numeric checkpoint
// can't carry) detectable + self-healing. The hash/canonicalize logic is the pure
// `coop-battle-checksum.ts`; this file just READS the live engine into its view.
// =============================================================================

/** Read a live field mon's active ability id (0 if unreadable). */
function readAbilityId(mon: Pokemon): number {
  try {
    return mon.getAbility().id;
  } catch {
    return 0;
  }
}

/** Read a live mon's moveset as `[moveId, ppUsed]` in slot order. */
function readMoves(mon: Pokemon): [number, number][] {
  try {
    return mon.getMoveset().map(m => [m.moveId, m.ppUsed]);
  } catch {
    return [];
  }
}

/**
 * Read a live mon's TRANSFORM / Imposter copied identity (#836/#837), or null when not transformed. The
 * copied identity lives entirely in `summonData` (see {@linkcode CoopMonTransform}), so this reads it
 * from there verbatim - speciesForm id/form, the copied moveset+PP, types, active ability, gender, and
 * the copied battle stats - so the guest can re-apply exactly what the host's PokemonTransformPhase wrote.
 */
function readTransform(mon: Pokemon): CoopMonTransform | null {
  try {
    const sd = mon.summonData;
    const sf = sd?.speciesForm;
    if (sf == null) {
      return null;
    }
    return {
      speciesId: sf.speciesId,
      formIndex: sf.formIndex,
      moves: (sd.moveset ?? []).map(m => [m?.moveId ?? 0, m?.ppUsed ?? 0] as [number, number]),
      types: [...(sd.types ?? [])].map(t => t as unknown as number),
      ability: (sd.ability as unknown as number) ?? 0,
      gender: sd.gender === undefined ? -1 : (sd.gender as unknown as number),
      stats: [...(sd.stats ?? [])],
    };
  } catch {
    return null;
  }
}

/**
 * Read a live mon's battler-tag TYPE ids, sorted ascending (identity only, no counters). ONLY
 * {@linkcode SerializableBattlerTag} types are hashed (#876): a NON-serializable tag is a WITHIN-TURN
 * transient (FLINCHED, PROTECTED, ENDURING, HELPING_HAND, CENTER_OF_ATTENTION, ROOSTED, ELECTRIFIED,
 * BYPASS_SPEED, the charging-move tags, ...) that the save system deliberately DROPS on the
 * `PokemonData` wire round-trip (pokemon-data.ts discards any tag not `instanceof SerializableBattlerTag`
 * on load), AND that the pure-renderer guest never creates (it renders events, it does not run MovePhase /
 * flinch / protect logic). So a host tag like FLINCHED - applied by an enemy's move on the WINNING turn -
 * can NEVER reach the guest: the per-turn authoritative-state apply drops it, and the checksum-mismatch
 * stateSync heal (also `PokemonData`) drops it too, so hashing it produced a permanent, UNHEALABLE
 * false-desync that tripped the #838 per-turn assertion every time a flinch/protect landed at a wave-win
 * crossing (soak seed 20260709: host F0.tags=[ER_ENRAGE,FLINCHED] vs guest [ER_ENRAGE] @ wave 90 turn 3).
 * Restricting the hash to the SYNCABLE (serializable) subset makes both clients converge - the host filters
 * FLINCHED out, the guest already lacks it - while a REAL serializable-tag divergence (ER_ENRAGE, Leech
 * Seed, Encore, Taunt, ...) is STILL detected + healed. This mirrors the module's existing exclusion of
 * turn COUNTERS for the same "legitimately transient, not identity" reason (see the file header).
 */
function readTagTypes(mon: Pokemon): string[] {
  try {
    return sortCoopChecksumTagIds(
      mon.summonData.tags.filter(t => t instanceof SerializableBattlerTag).map(t => t.tagType as unknown as string),
    );
  } catch {
    return [];
  }
}

/** Read the arena's tag identities as `[tagType, side]`, sorted (turn counts excluded). */
function readArenaTags(): [string, number][] {
  try {
    return sortCoopChecksumArenaTags(
      globalScene.arena.tags.map(t => [t.tagType as unknown as string, t.side as unknown as number]),
    );
  } catch {
    return [];
  }
}

/** Read the player's persistent modifiers as `[typeId, stackCount]`, sorted by id. */
function readModifiers(): [string, number][] {
  try {
    return globalScene.modifiers
      .map(m => [coopModifierTypeId(m), m.stackCount] as [string, number])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  } catch {
    return [];
  }
}

/**
 * HOST: serialize the player-wide PERSISTENT modifiers as plain `ModifierData` blobs (#698 / #633
 * BUG 2). These are the NON-held-item `PersistentModifier`s on `globalScene.modifiers` (relics, EXP /
 * temp-stat-stage boosters, lures, candy jar, ...). Carried in the resync so the gated guest heal can
 * RECONSTRUCT one it is missing - the `[typeId, stackCount]` digest can't (a temp stat booster needs
 * its stat arg, an attack-type booster its type). Held items are EXCLUDED (they ride per-mon in
 * `field[].heldItems`); `PokemonFormChangeItemModifier`s are EXCLUDED too (healed via snap.formIndex).
 * Mirrors the held-item / enemy ModifierData serialization (`new ModifierData(m, false)`). Fully guarded.
 */
export function captureCoopPlayerModifiers(): Record<string, unknown>[] {
  try {
    return globalScene.modifiers
      .filter(
        m =>
          m instanceof PersistentModifier
          && !(m instanceof PokemonHeldItemModifier)
          && !(m instanceof Modifier.PokemonFormChangeItemModifier),
      )
      .map(m => {
        const data = new ModifierData(m, false);
        return {
          typeId: data.typeId,
          className: data.className,
          args: data.args,
          stackCount: data.stackCount,
          ...(data.typePregenArgs === undefined ? {} : { typePregenArgs: data.typePregenArgs }),
        };
      });
  } catch {
    return [];
  }
}

/**
 * ON-FIELD per-mon held-item identity digest as `[bi, typeId, stackCount]`, sorted (#633 RISKY #2/#3).
 * Iterates the SAME `getField(true)` set the checksum already hashes (and the snapshot can heal), reading
 * each mon's held items by `pokemonId` on that mon's OWN side list - so detection and heal cover identical
 * mons (no detect-but-can't-heal loop; BENCH items are deliberately excluded). Deterministic: only `bi`,
 * `type.id` (a stable string), and `stackCount` - never the per-client `pokemonId` or any RNG.
 */
function readHeldItemDigest(): [number, string, number][] {
  try {
    const out: [number, string, number][] = [];
    for (const mon of globalScene.getField(true)) {
      if (mon == null) {
        continue;
      }
      const bi = mon.getBattlerIndex();
      for (const m of globalScene.findModifiers(
        x => x instanceof PokemonHeldItemModifier && x.pokemonId === mon.id,
        mon.isPlayer(),
      )) {
        out.push([bi, coopModifierTypeId(m), m.stackCount]);
      }
    }
    return out.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] - b[2]));
  } catch {
    return [];
  }
}

/** Ball inventory as `[ballType, count]`, sorted by ballType (#633 RISKY #4). Plain ints, no RNG. */
function readPokeballCounts(): [number, number][] {
  try {
    return Object.entries(globalScene.pokeballCounts)
      .map(([k, v]) => [Number(k), Number(v)] as [number, number])
      .sort((a, b) => a[0] - b[0]);
  } catch {
    return [];
  }
}

/**
 * Read a live mon's boss state (#633, A/BLOCKING-2): `[bossSegments, bossSegmentIndex]`. Player mons
 * (and any non-enemy) read `[0, 0]` - boss state lives only on `EnemyPokemon`. Carried in the checksum
 * + the resync so a missing/diverged-boss guest is detectable + healable.
 */
function readBossState(mon: Pokemon): { bossSegments: number; bossSegmentIndex: number } {
  try {
    if (mon instanceof EnemyPokemon) {
      return { bossSegments: mon.bossSegments ?? 0, bossSegmentIndex: mon.bossSegmentIndex ?? 0 };
    }
  } catch {
    /* fall through to the non-boss default */
  }
  return { bossSegments: 0, bossSegmentIndex: 0 };
}

/** Read a live mon's Tera state (#633 GAP 7): whether Terastallized + the tera type (0 on error). */
function readTeraState(mon: Pokemon): { isTerastallized: boolean; teraType: number } {
  try {
    return { isTerastallized: mon.isTerastallized === true, teraType: (mon.teraType as unknown as number) ?? 0 };
  } catch {
    return { isTerastallized: false, teraType: 0 };
  }
}

/** Build the canonical checksum view of ONE live field mon. */
function readChecksumMon(mon: Pokemon): CoopChecksumMon {
  const tera = readTeraState(mon);
  const boss = readBossState(mon);
  // Transform / Imposter copied identity (#836/#837): 0/0 when not transformed (readTransform -> null).
  const transform = readTransform(mon) ?? { speciesId: 0, formIndex: 0 };
  return {
    bi: mon.getBattlerIndex(),
    partyIndex: readPartyIndex(mon),
    speciesId: mon.species?.speciesId ?? 0,
    hp: mon.hp,
    maxHp: mon.getMaxHp(),
    status: mon.status?.effect ?? 0,
    statStages: [...mon.getStatStages()],
    fainted: mon.isFainted(),
    abilityId: readAbilityId(mon),
    formIndex: mon.formIndex ?? 0,
    // Tera state (#633 GAP 7): a dropped Tera command is now a hashed identity divergence.
    isTerastallized: tera.isTerastallized,
    teraType: tera.teraType,
    // Boss state (#633, A/BLOCKING-2): a missing/diverged boss (count OR index) is now detectable.
    bossSegments: boss.bossSegments,
    bossSegmentIndex: boss.bossSegmentIndex,
    moves: readMoves(mon),
    tags: readTagTypes(mon),
    // Transform / Imposter copied identity (#836/#837): a host Transform stays invisible to speciesId
    // (species stays the original); hashing the copied speciesForm makes it detectable + healable.
    transformSpeciesId: transform.speciesId,
    transformFormIndex: transform.formIndex,
  };
}

// =============================================================================
// FULL SESSION SAVE-DATA digest (#837). The systemic desync closer: hash a NORMALIZED projection of
// `getSessionSaveData()` alongside the field checksum, so every substrate the session save serializes
// (money-streak, ward-stone charges, relic-battle-state, biome overstay anchor, and all modifiers as
// full ModifierData blobs incl. their getArgs internals) becomes desync-DETECTABLE by construction -
// closing the "modifier internal state / module-let substrate" blind-spot class the [typeId,stackCount]
// modifier digest is blind to (audit Part 1 #1/#2/#3/#6). DERIVED from the serializer (not a hand list)
// so a NEW substrate added to SessionSaveData is covered automatically; only the keys below are stripped.
// =============================================================================

/**
 * SessionSaveData keys EXCLUDED from the co-op save-data digest (#837). Each is a field that
 * legitimately differs between two healthy clients or per moment, so hashing it would manufacture a
 * FALSE desync. Everything NOT listed here is hashed, so a new substrate is covered automatically.
 * (The guard test asserts this set is the ONLY divergence between two engines sharing state.)
 */
const COOP_SAVEDATA_DIGEST_EXCLUDED_KEYS: ReadonlySet<string> = new Set<string>([
  // Per-client wall-clock accumulator: advances independently on each client every frame.
  "playTime",
  // `Date.now()` stamped at serialize time: two serializations are never equal.
  "timestamp",
  // Player-chosen run name: cosmetic; the guest may not carry it and it is never a sync concern.
  "name",
  // Lobby/account discovery metadata, not battle simulation state. It can be absent on a renderer
  // booted directly from authoritative bytes before its peer-identity handshake (and N-client
  // renderers do not all share one self/partner orientation). Never manufacture a battle resync
  // from this local resume-index field; the lobby validates it against the saved session separately.
  "coopParticipants",
  // Stable run/checkpoint identity belongs to persistence ordering, not deterministic battle state.
  // Independent executions of the same seeded script intentionally mint different run ids, while
  // retained commit addressing and CAS ancestry validate checkpoint revisions directly.
  "coopRun",
  // Arena weather/terrain TURN COUNTERS (`turnsLeft`) decrement per tick and legitimately differ by
  // one between two correct engines - the base field checksum EXCLUDES them for exactly this reason.
  // Arena IDENTITY (weather/terrain type, tags, biome) is already hashed by the base checksum, so
  // dropping the whole ArenaData here loses no coverage while avoiding that false-desync class.
  "arena",
  // Full per-mon PokemonData for the WHOLE party/enemy is large and carries volatile per-client battle
  // scratch (summon data, per-frame tweened fields, battle-scoped counters). On-field mon state + party
  // species + LEVELS are already in the base checksum; bench charge state rides the erWardStones /
  // modifiers side channels (kept below). Enemy mons are host-built and never id-aligned with the guest.
  "party",
  "enemyParty",
  "enemyModifiers",
  // The guest is a pure renderer and never RUNS a mystery encounter, so its queued-prophecy /
  // spawn-chance ME bookkeeping legitimately lags the host's (audit Part 1 #9); the ME OUTCOME is
  // host-authoritative and already synced through the ME terminal path.
  "mysteryEncounterSaveData",
  "mysteryEncounterType",
  // Run-local ACHIEVEMENT bookkeeping, not shared battle simulation state. The authoritative host runs
  // the lethal-hit tracker while the pure-renderer guest replays presentation events, so fields such as
  // `parallelPlayKoIds` legitimately advance on the host first (live wave-1 repro, build mrhpa314-147u).
  // Hashing this account/progression metadata manufactured an unhealable saveDataDigest mismatch: the
  // full battle snapshot correctly carries no achievement state, so every retry produced the same hash
  // and paused an otherwise-converged game. Achievement/account writes have their own co-op ownership
  // rail; they must never participate in the simulation convergence comparator.
  "erAchievementRunState",
  // Host-authoritative TrainerData for a trainer wave: mirrored to the guest via the enemy builder, but
  // its full serialized form (party template index / gen seed) can differ benignly; the on-field enemy
  // species the checksum already hashes is the sync-relevant part.
  "trainer",
  // Host-authoritative score / arena faint tally / trainer-no-repeat set: accumulated on the host's
  // authoritative pipeline, which the pure-renderer guest does not reproduce turn-for-turn.
  "score",
  "playerFaints",
  "erUsedTrainerKeys",
  // WAVE-CROSSING TRANSIENT (#846). During the host-ahead window of a wave crossing the HOST advances
  // `currentBattle.waveIndex` (post-victory transition) while the pure-renderer guest is still finalizing
  // the just-played wave, so the two read the digest ONE wave apart. The base FIELD checksum already
  // EXCLUDES `waveIndex` for exactly this reason (a genuine wave desync is caught by the field/party hash,
  // which would then differ - here it MATCHED, so this is only the transient skew). `erRelicBattleState`
  // is coupled to the same skew (its `wave` field IS `currentBattle.waveIndex`); it stays HASHED but is
  // NORMALIZED below to its wave-independent `lists` so the transient wave number drops out while a real
  // relic-list divergence is still detected. Repro: SOAK_PROFILE=level SOAK_LEVEL=55 SOAK_SEED=12345
  // diverged the digest at wave 52 on `waveIndex` + `erRelicBattleState.wave` ALONE (host 53 vs guest 52),
  // with every other checksum field matching.
  "waveIndex",
  // #867: `battleType` is COUPLED to `waveIndex` - it is a per-wave property that changes at the wave
  // boundary. During the SAME host-ahead crossing window the host reads its NEXT wave's battleType (e.g.
  // TRAINER) while the guest still reads the just-played wave's (WILD), so the digest splits on battleType
  // ALONE with every printed field matching (god-leg soak seed 20260709: `battleType host=1 guest=0`
  // @post-turn wave 42, host already on the wave-43 TRAINER). It is EXCLUDED for the identical reason as
  // waveIndex: it is a wave-crossing read-skew, not a state desync. A GENUINE wave-type divergence (a
  // guest that mis-derived the wave TYPE) surfaces through the on-field ENEMY SPECIES the base field
  // checksum hashes (a wild roll vs a trainer's party field different mons), and the wave TYPE itself is
  // now host-authoritative + adopted by the guest (the enemyPartySync battleType verdict + the newBattle
  // adopt in this fix), so the guest never re-derives a divergent value in the first place.
  "battleType",
  // Wave-2e: `coopControlPlane` carries the durability journal high-water marks (journalHighWater) +
  // the persisted interaction counter. The watermarks are FLOW-CONTROL transients: the RECEIVER always
  // lags the COMMITTER between an op's commit and its cumulative ack, so the two clients legitimately
  // read different values at any given capture point - the same read-skew class as the excluded raw
  // `waveIndex`/`battleType`, NOT a state desync (exposed by the lane-isolated gate: the #835
  // dropped-revive repro's post-heal convergence tripped on watermark skew alone). The field stays in
  // the SESSION SAVE (cold-resume parity needs it, #887) - it is only excluded from the convergence
  // digest. A REAL lost operation still surfaces through the journal's own gap-detection + resend
  // (coop-durability), which is the layer that owns watermark correctness.
  "coopControlPlane",
]);

/**
 * Normalize the session save's `erMapState` (#837, widened #865) to the host-AUTHORITATIVE fields the
 * guest ADOPTS: the biome-STRUCTURE trio (`biomeOverstayAnchor` + biome length/start-wave - the confirmed
 * encounter-generator blind spot, audit Part 1 #2) PLUS the REVEALED onward-node set, the pending travel
 * target, and the Treasure-Map fragment count (#865). The revealed nodes drive the biome-travel decision
 * (a natural single-node terminal picks `revealed[0]` with no relay), so hashing them makes a host-vs-guest
 * map drift DETECTABLE and the resync heal ({@linkcode restoreCoopErMapState}) adopts them - closing the
 * "erMapState heal path" gap (audit #841 item 1). Nodes are hashed by their `(biome, kind)` identity in
 * ORDER (the single-node terminal reads `revealed[0]`, so order is load-bearing). The PURE-RENDERER-only
 * fields that legitimately diverge and are never read at a biome terminal (Fairy's-Boon luck, carried
 * weather, the cosmetic journey history) stay OUT of the digest. Tolerant of an absent/malformed field
 * (older save / no map yet).
 */
function normalizeCoopErMapState(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object") {
    return {};
  }
  const map = value as Record<string, unknown>;
  const nodes = Array.isArray(map.nodes)
    ? (map.nodes as Record<string, unknown>[]).map(n => ({
        biome: typeof n?.biome === "number" ? n.biome : -1,
        kind: typeof n?.kind === "string" ? n.kind : "",
      }))
    : [];
  return {
    biomeOverstayAnchor: typeof map.biomeOverstayAnchor === "number" ? map.biomeOverstayAnchor : null,
    biomeLength: typeof map.biomeLength === "number" ? map.biomeLength : null,
    biomeStartWave: typeof map.biomeStartWave === "number" ? map.biomeStartWave : null,
    // #865: the revealed onward-node set + travel target + fragments are now host-authoritative + adopted.
    nodes,
    travelTarget: typeof map.travelTarget === "number" ? map.travelTarget : null,
    fragments: typeof map.fragments === "number" ? map.fragments : 0,
  };
}

/**
 * Map every LIVE player-party `Pokemon.id` to its stable party-SLOT index (#839). A `Pokemon.id` is a
 * per-client `randSeedInt` value: seed-deterministic mons share an id across clients, but a mon GRANTED
 * mid-run by a mystery encounter (a #794 shared-acquisition catch/gift) is MATERIALIZED independently on
 * each client and gets a DIFFERENT local id. Any save-data field keyed by that id (a held-item modifier
 * arg, a money-streak / ward-stone entry) would then diverge the digest FOREVER even though both clients
 * agree on the mon. The party ORDER is reconciled (the base checksum already hashes the speciesId
 * sequence + the bench heal adopts it), so the slot index is the cross-client-stable identity to hash.
 */
function coopPartyIndexById(versusGuest = false): Map<number, number> {
  const map = new Map<number, number>();
  try {
    // SHOWDOWN egress (Task F1): the versus guest maps its state BACK to authoritative orientation
    // for the digest, so the "player" party the modifier ids collapse against is its LOCAL ENEMY
    // party (the host's team) - matching the host's own player-party slot tokens.
    (versusGuest ? globalScene.getEnemyParty() : globalScene.getPlayerParty()).forEach((p, i) => {
      if (typeof p?.id === "number") {
        map.set(p.id, i);
      }
    });
  } catch {
    /* scene not ready - callers fall back to the raw id (no crash, no false normalization) */
  }
  return map;
}

/**
 * Replace a per-client `pokemonId` with its stable party-slot token for the digest (#839). A live
 * party mon's id maps to `p<slotIndex>` (cross-client-equal); a value that is NOT a current party id
 * (a small enum arg, a released/stale mon, a non-id number) is left RAW so a genuine change stays a
 * hashed divergence (e.g. the digest guard test's synthetic non-party money-streak keys still detect).
 */
function coopNormalizePokemonId(value: unknown, partyIndexById: Map<number, number>): unknown {
  if (typeof value === "number" && partyIndexById.has(value)) {
    return `p${partyIndexById.get(value)}`;
  }
  return value;
}

/**
 * Normalize a `[pokemonId, ...rest]` mon-keyed entry list (erMoneyStreaks `[id, streak]`, erWardStones
 * `[id, tier, charges, waveProgress]`) for the digest (#839). The leading per-client `Pokemon.id` is
 * mapped to its stable party-slot token; the rest of the tuple (streak / charges / waveProgress) is
 * hashed unchanged so a real drift still moves the digest. Sorted by a canonical of the normalized
 * entry so Map iteration order can never manufacture a divergence.
 */
function normalizeCoopMonKeyedEntries(list: unknown, partyIndexById: Map<number, number>): unknown[] {
  if (!Array.isArray(list)) {
    return [];
  }
  const out = (list as unknown[]).map(entry =>
    Array.isArray(entry) && entry.length > 0
      ? [coopNormalizePokemonId(entry[0], partyIndexById), ...entry.slice(1)]
      : entry,
  );
  return out.sort((a, b) => {
    const ca = canonicalize(a);
    const cb = canonicalize(b);
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

/**
 * Normalize the session save's `modifiers` list (#837) to the PLAYER-WIDE persistent modifiers with
 * their full `args`, sorted deterministically. This is the Stormglass-`chosenWeather` / temp-booster
 * internal-state coverage: the base checksum hashes `[typeId, stackCount]` only, so an arg-only change
 * (chosenWeather, charges) is invisible - carrying the full args here makes it a hashed divergence the
 * resync's {@linkcode reconcileCoopPlayerModifiers} can heal.
 *
 * Held items are EXCLUDED (#839): their `getArgs()[0]` is the holder's per-client `Pokemon.id` (a
 * randSeedInt value that diverges across clients for an ME-GRANTED mon), so hashing them diverged the
 * digest FOREVER; their on-field identity + stacks are already hashed by the base checksum's `heldItems`
 * field and their bench charge heals per-turn (not via resync), so excluding them loses no coverage.
 * The exclusion is a live `instanceof` over `globalScene.modifiers` (mirroring
 * {@linkcode captureCoopPlayerModifiers}) - the whole `PokemonHeldItemModifier` subclass tree (berries,
 * vitamins, stat boosters, form-change items, ...). The OLD className-STRING check was inert: it matched
 * only the ABSTRACT base name `PokemonHeldItemModifier`, which is never a live instance, so every
 * concrete held-item subclass (`BerryModifier`, `BaseStatModifier`, `TurnHealModifier`, ...) leaked into
 * the digest with its per-client id. Any residual pokemonId embedded in a NON-held modifier's args is
 * mapped to its party-slot token (defense-in-depth; a no-op for the usual player-wide modifiers). Sorted
 * by typeId then a canonical of the args, so array iteration order can never manufacture a divergence.
 */
function normalizeCoopModifierBlobs(
  partyIndexById: Map<number, number>,
  versusGuest = false,
): Record<string, unknown>[] {
  let live: PersistentModifier[];
  try {
    // SHOWDOWN egress (Task F1): in authoritative orientation the "player" persistent modifiers are
    // the host's, which on the versus guest live on its LOCAL ENEMY side - so hash those instead.
    live = (
      versusGuest
        ? globalScene.findModifiers(m => m instanceof PersistentModifier, false)
        : (globalScene.modifiers ?? [])
    ) as PersistentModifier[];
  } catch {
    return [];
  }
  const blobs: Record<string, unknown>[] = [];
  for (const m of live) {
    if (
      !(m instanceof PersistentModifier)
      || m instanceof PokemonHeldItemModifier
      || m instanceof Modifier.PokemonFormChangeItemModifier
    ) {
      continue;
    }
    const data = new ModifierData(m, !versusGuest);
    blobs.push({
      typeId: data.typeId,
      className: data.className,
      args: (Array.isArray(data.args) ? data.args : []).map(a => coopNormalizePokemonId(a, partyIndexById)),
      stackCount: typeof data.stackCount === "number" ? data.stackCount : 0,
      ...(data.typePregenArgs === undefined ? {} : { typePregenArgs: data.typePregenArgs }),
    });
  }
  return blobs.sort((a, b) => {
    const ta = a.typeId as string;
    const tb = b.typeId as string;
    if (ta !== tb) {
      return ta < tb ? -1 : 1;
    }
    const aa = canonicalize(a.args);
    const ba = canonicalize(b.args);
    return aa < ba ? -1 : aa > ba ? 1 : 0;
  });
}

/**
 * Normalize the session save's `erRelicBattleState` (#846) to its wave-INDEPENDENT `lists` only. The raw
 * value is `{ wave, lists }` where `wave` IS `currentBattle.waveIndex` (er-relic-battle-state.ts) - a
 * wave-crossing transient that legitimately differs by one between the host (already advanced) and the
 * pure-renderer guest (still finalizing the prior wave), manufacturing a FALSE digest desync exactly like
 * the excluded raw `waveIndex`. Dropping `wave` and hashing only the per-battle relic `lists` keeps a REAL
 * relic-list divergence (Cursed Idol / Pharaoh's Ankh ordinals) detectable while removing the transient.
 * Tolerant of an absent/malformed field (older save / no relics).
 */
function normalizeCoopErRelicBattleState(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object") {
    return { lists: {} };
  }
  const lists = (value as { lists?: unknown }).lists;
  return { lists: lists != null && typeof lists === "object" ? lists : {} };
}

/**
 * Build the NORMALIZED co-op save-data view (#837): the projection of `getSessionSaveData()` two
 * healthy clients agree on. DERIVED from the serializer so a new substrate is auto-covered; the
 * {@linkcode COOP_SAVEDATA_DIGEST_EXCLUDED_KEYS} denylist (each entry commented) strips the fields that
 * legitimately diverge, and `modifiers` / `erMapState` are normalized to their sync-relevant subset.
 * Returns a plain object (used both by the digest hash and the deep-diff diagnostics).
 */
export function captureCoopSaveDataNormalized(versusGuest = false): Record<string, unknown> {
  const session = globalScene.gameData.getSessionSaveData() as unknown as Record<string, unknown>;
  // #839: a single live party id->slot map shared by the modifier + mon-keyed-substrate normalizers, so
  // every per-client `Pokemon.id` the digest would otherwise hash raw collapses to its stable slot token.
  // SHOWDOWN egress (Task F1): the versus guest sources the authoritative (host) side (see coopPartyIndexById).
  const partyIndexById = coopPartyIndexById(versusGuest);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(session)) {
    if (COOP_SAVEDATA_DIGEST_EXCLUDED_KEYS.has(key)) {
      continue;
    }
    if (key === "modifiers") {
      out[key] = normalizeCoopModifierBlobs(partyIndexById, versusGuest);
      continue;
    }
    if (key === "erMapState") {
      out[key] = normalizeCoopErMapState(value);
      continue;
    }
    // #846: drop the wave-crossing-transient `wave` field, keep the sync-relevant relic `lists`.
    if (key === "erRelicBattleState") {
      out[key] = normalizeCoopErRelicBattleState(value);
      continue;
    }
    // ER mon-keyed substrates (#839): both key a per-client `Pokemon.id` (erMoneyStreaks `[id, streak]`,
    // erWardStones `[id, tier, charges, waveProgress]`), so normalize the id to its stable party slot -
    // otherwise an ME-granted mon (a divergent local id) diverges the digest forever, exactly like the
    // held-item modifier args above.
    if (key === "erMoneyStreaks" || key === "erWardStones") {
      out[key] = normalizeCoopMonKeyedEntries(value, partyIndexById);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * The 64-bit digest of the normalized session save-data view (#837). Both clients compute it at the
 * same turn boundary; a divergence in ANY save-data substrate (money-streak, ward-stone charges, relic
 * state, overstay anchor, Stormglass weather / booster args) moves the digest -> a checksum mismatch ->
 * the existing full-snapshot resync heals it. Returns the read-failure sentinel on any error so the
 * comparison is skipped (never a resync on a transient read failure), mirroring {@linkcode captureCoopChecksum}.
 */
export function captureCoopSaveDataDigest(versusGuest = false): string {
  try {
    return fnv1a64(canonicalize(captureCoopSaveDataNormalized(versusGuest)));
  } catch {
    return COOP_CHECKSUM_SENTINEL;
  }
}

/**
 * Read every OFF-FIELD (bench) player mon's hp + fainted flag for the per-turn checksum (#719
 * revive/heal backstop). Returns `[partyIndex, hp, faintedFlag]` per bench mon, in slot order
 * (faintedFlag 1 = fainted, 0 = alive). ON-FIELD mons are EXCLUDED - their hp is already hashed by the
 * field checksum and converged by the per-turn checkpoint; this extends the SAME coverage to the bench so
 * a Revive on a FAINTED bench mon whose owner->watcher relay was DROPPED (the mon stays fainted forever on
 * the watcher) becomes a DETECTABLE divergence the resync's `benchParty` heal closes - a gap the speciesId
 * `party` list + `partyLevels` miss (a revive changes no species and no level). Fully guarded.
 */
function readBenchHpDigest(): [number, number, number][] {
  const out: [number, number, number][] = [];
  try {
    const party = globalScene.getPlayerParty();
    // "Bench" = party slots beyond the field (i >= battlerCount), the same slot model as
    // firstLegalBenchSlot and the base field checksum. Do NOT use mon.isOnField(): the guest is a
    // pure renderer whose field/summon state is unreliable, so it would misclassify its own on-field
    // leads as bench and diverge from the host. The base field checksum already covers i < battlerCount.
    const battlerCount = globalScene.currentBattle?.getBattlerCount() ?? 2;
    for (let i = 0; i < party.length; i++) {
      const mon = party[i];
      if (mon == null || i < battlerCount) {
        continue;
      }
      out.push([i, mon.hp, mon.isFainted() ? 1 : 0]);
    }
  } catch {
    // A bad party read must never break the checksum capture (caller falls back to the sentinel).
  }
  return out;
}

/** Fold ONE mon's moveset into a stable hex hash (#875): `fnv1a64` over the canonical `[[moveId, ppUsed], ...]`
 *  slot list (slot order preserved). A learn/forget changes a moveId; a PP tick changes a ppUsed - either
 *  moves the fold. Bench mons never tick PP, so this is constant per bench mon until a learn/forget. */
function hashMonMoveset(mon: Pokemon): string {
  try {
    return fnv1a64(canonicalize(mon.getMoveset().map(m => [m?.moveId ?? 0, m?.ppUsed ?? 0] as [number, number])));
  } catch {
    return COOP_CHECKSUM_SENTINEL;
  }
}

/**
 * Read every OFF-FIELD (bench) player mon's MOVESET digest for the per-turn checksum (#875 bench-learn
 * backstop). Returns `[partyIndex, movesetHashHex]` per bench mon, in slot order. Mirrors the slot model of
 * {@linkcode readBenchHpDigest} exactly (bench = `i >= battlerCount`, NOT `mon.isOnField()`, so the guest's
 * unreliable field/summon state can't misclassify a lead). ON-FIELD mons are EXCLUDED - their moveset is
 * already hashed by the base {@linkcode readMoves} field; this extends the SAME coverage to the bench so a
 * TM / Shroom LEARNED onto a HOST-owned bench mon (whose learn the guest's mirror dropped, #875) becomes a
 * DETECTABLE divergence the resync heals. Fully guarded (a bad read must never break the checksum capture).
 */
function readBenchMovesDigest(): [number, string][] {
  const out: [number, string][] = [];
  try {
    const party = globalScene.getPlayerParty();
    const battlerCount = globalScene.currentBattle?.getBattlerCount() ?? 2;
    for (let i = 0; i < party.length; i++) {
      const mon = party[i];
      if (mon == null || i < battlerCount) {
        continue;
      }
      out.push([i, hashMonMoveset(mon)]);
    }
  } catch {
    /* a bad party read must never break the checksum capture (caller falls back to the sentinel). */
  }
  return out;
}

/** Off-field ENEMY-party moveset digest - the egress mirror of {@linkcode readBenchMovesDigest}. */
function readEnemyBenchMovesDigest(): [number, string][] {
  const out: [number, string][] = [];
  try {
    const party = globalScene.getEnemyParty();
    const battlerCount = globalScene.currentBattle?.getBattlerCount() ?? 2;
    for (let i = 0; i < party.length; i++) {
      const mon = party[i];
      if (mon == null || i < battlerCount) {
        continue;
      }
      out.push([i, hashMonMoveset(mon)]);
    }
  } catch {
    /* a bad enemy-party read must never break the checksum capture */
  }
  return out;
}

/**
 * Capture the full authoritative battle state into its canonical checksum view. Read
 * ONLY at a stable turn boundary (start of CommandPhase) - never mid-resolution - so
 * both clients hash the same logical instant. Field mons are sorted by battler index.
 */
export function captureCoopChecksumState(): CoopChecksumState {
  // The checksum is the final stable authority boundary even when no numeric checkpoint was needed
  // (for example, immediately after encounter construction). A late max-HP recalculation can otherwise
  // leave the authority with hp > maxHp while PokemonData necessarily clamps the renderer, guaranteeing
  // a checksum split that no replay can converge. Canonicalize the live state before either orientation
  // is read so every published/compared boundary obeys the same invariant.
  normalizeCoopHpBoundsAtAuthorityBoundary();
  // SHOWDOWN egress (Task F1): the versus guest holds its live scene in LOCAL orientation (its own
  // team = player side). Map it BACK to the host's AUTHORITATIVE orientation before hashing so the two
  // clients compare the SAME world. All three guest checksum call sites route through here.
  if (isShowdownGuestFlipGated()) {
    return captureVersusGuestChecksumState();
  }
  const arena = globalScene.arena;
  // #878: checksum the SAME slot-present view carried by checkpoints/snapshots. `getField(true)` drops a
  // just-fainted foe, making its summonData (notably statStages) invisible exactly at wave win.
  const field = getCoopSerializableField()
    .filter((m): m is Pokemon => m != null)
    .map(readChecksumMon)
    .sort((a, b) => a.bi - b.bi);
  return {
    field,
    weather: arena.weather?.weatherType ?? 0,
    terrain: arena.terrain?.terrainType ?? 0,
    arenaTags: readArenaTags(),
    party: globalScene.getPlayerParty().map(p => p.species.speciesId),
    // Party LEVELS in slot order (#633 B4): detect a bench-mon level drift the speciesId-only
    // `party` list misses (the live revive-in-shop desync). Settled at the CommandPhase boundary.
    partyLevels: globalScene.getPlayerParty().map(p => p.level),
    // BENCH-mon hp + fainted (#719 revive/heal backstop): the field checksum hashes ON-FIELD hp only, so a
    // Revive on a FAINTED bench mon whose owner->watcher relay was DROPPED left the mon fainted forever on
    // the watcher, INVISIBLE to the hash (a revive changes no species and no level, so `party`/`partyLevels`
    // miss it). Hashing each off-field mon's [slot, hp, fainted] makes that divergence DETECTABLE -> the
    // resync's benchParty heal revives it. Bench hp only moves on a revive/heal item, so no ordinary-turn noise.
    benchHp: readBenchHpDigest(),
    // BENCH-mon moveset digest (#875): the field checksum hashes ON-FIELD movesets only, so a move LEARNED
    // onto a HOST-owned BENCH mon (a reward-shop TM/Shroom whose learn the guest's mirror dropped) changed no
    // species/level/on-field-move and was INVISIBLE to the checksum. Folding each bench mon's moveset makes it
    // DETECTABLE; the guest adopts the host's bench movesets via the per-turn authoritative-state apply before
    // it recomputes this, so a healthy run hashes identical values (adopt-then-hash, no resync noise).
    benchMoves: readBenchMovesDigest(),
    money: globalScene.money,
    modifiers: readModifiers(),
    // On-field per-mon held-item digest (#633 RISKY #2/#3): a stack change (Bug-Bite/Knock-Off) or a
    // wrong-holder rebind (Grip Claw/Covet) among on-field mons - same global total, invisible to the
    // aggregate `modifiers` digest - is now a hashed divergence the snapshot held-item heal can close.
    heldItems: readHeldItemDigest(),
    // Ball inventory (#633 RISKY #4): the host decrements it host-only in AttemptCapturePhase (which the
    // pure-renderer guest never runs), so its inventory drifts; hashing it makes that drift detectable.
    pokeballCounts: readPokeballCounts(),
    // Active biome (B7): an independent biome re-roll (a seed/waveIndex drift that landed the two
    // clients in DIFFERENT biomes) is otherwise invisible to the field-only checkpoint. Settled at
    // the turn boundary (SwitchBiomePhase's newArena blocks the next checksum until it ends).
    biomeId: arena.biomeId ?? 0,
    // Run seed (B8): the master determinism input. runConfig-pinned identical across healthy clients;
    // only setSeed mutates it (never mid-turn), so it differs ONLY on a real seed split.
    seed: globalScene.seed ?? "",
    // Full session save-data digest (#837): the systemic blind-spot closer. Hashes the normalized
    // getSessionSaveData() view so money-streak / ward-stone charges / relic-battle-state / biome
    // overstay anchor / modifier-internal args (Stormglass chosenWeather) are all desync-detectable -
    // a class the [typeId, stackCount] `modifiers` digest above cannot see. Wave-boundary substrates,
    // so a mid-wave recompute yields the SAME value (constant within a wave); measured cheap enough to
    // recompute every turn (see #837 report), so no per-wave cache is needed.
    saveDataDigest: captureCoopSaveDataDigest(),
  };
}

/** Off-field ENEMY-party hp/fainted digest - the egress mirror of {@linkcode readBenchHpDigest}. */
function readEnemyBenchHpDigest(): [number, number, number][] {
  const out: [number, number, number][] = [];
  try {
    const party = globalScene.getEnemyParty();
    const battlerCount = globalScene.currentBattle?.getBattlerCount() ?? 2;
    for (let i = 0; i < party.length; i++) {
      const mon = party[i];
      if (mon == null || i < battlerCount) {
        continue;
      }
      out.push([i, mon.hp, mon.isFainted() ? 1 : 0]);
    }
  } catch {
    /* a bad enemy-party read must never break the checksum capture */
  }
  return out;
}

/**
 * SHOWDOWN egress (Task F1): capture the versus guest's checksum view mapped BACK to the host's
 * AUTHORITATIVE orientation, so `hostChecksum === guestChecksum` holds turn-over-turn.
 *
 * The guest's live scene is the mirror of the host's: its LOCAL player party is the host's ENEMY
 * party and vice versa (both full rosters are id-keyed-replicated every turn, so bench state is
 * present on both). To reproduce the host's PLAYER-centric checksum this capture (a) sources the
 * party/level/bench/modifier fields from the guest's LOCAL ENEMY side (the host's team), (b) reflects
 * the bi of every on-field mon + held-item entry and the side of every arena tag, and (c) hashes the
 * save-data digest in authoritative orientation. `pokeballCounts`, `money`, `weather`, `terrain`,
 * `biomeId` and `seed` are host-authoritative (the guest already adopted them), so they pass through.
 */
function captureVersusGuestChecksumState(): CoopChecksumState {
  const arena = globalScene.arena;
  // Egress mirror of the normal #878 slot-present capture (includes just-fainted mons).
  const field = getCoopSerializableField()
    .filter((m): m is Pokemon => m != null)
    .map(readChecksumMon)
    .map(mon => ({ ...mon, bi: swapBi(mon.bi) }))
    .sort((a, b) => a.bi - b.bi);
  const enemyParty = globalScene.getEnemyParty();
  const arenaTags = readArenaTags()
    .map(([tagType, side]) => [tagType, swapArenaTagSide(side)] as [string, number]);
  const canonicalArenaTags = sortCoopChecksumArenaTags(arenaTags);
  const modifiers = (() => {
    try {
      return globalScene
        .findModifiers(() => true, false)
        .map(m => [m.type.id, m.stackCount] as [string, number])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    } catch {
      return [] as [string, number][];
    }
  })();
  const heldItems = readHeldItemDigest()
    .map(([bi, typeId, stack]) => [swapBi(bi), typeId, stack] as [number, string, number])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] - b[2]));
  return {
    field,
    weather: arena.weather?.weatherType ?? 0,
    terrain: arena.terrain?.terrainType ?? 0,
    arenaTags: canonicalArenaTags,
    party: enemyParty.map(p => p.species.speciesId),
    partyLevels: enemyParty.map(p => p.level),
    benchHp: readEnemyBenchHpDigest(),
    // BENCH-mon moveset digest (#875), sourced from the guest's LOCAL ENEMY side (the host's team) in
    // authoritative orientation - the egress mirror of the player-side benchMoves above.
    benchMoves: readEnemyBenchMovesDigest(),
    money: globalScene.money,
    modifiers,
    heldItems,
    pokeballCounts: readPokeballCounts(),
    biomeId: arena.biomeId ?? 0,
    seed: globalScene.seed ?? "",
    saveDataDigest: captureCoopSaveDataDigest(true),
  };
}

/**
 * HOST + GUEST: the 64-bit fingerprint of the full authoritative battle state. The host
 * stamps it on each turn/checkpoint; the guest recomputes + compares. Returns the
 * read-failure sentinel on any error so the comparison is SKIPPED (never a resync on a
 * transient read failure).
 */
export function captureCoopChecksum(): string {
  try {
    const state = captureCoopChecksumState();
    const digest = checksumState(state);
    // Per-turn-HOT: guard the whole summary build so the (large) key=value string is only ever
    // assembled when debug logging is on. Reads `state` only - never mutates it. This lets the two
    // clients' captures be eyeballed side-by-side in the log to find WHICH field fed a divergent hash.
    if (isCoopDebug()) {
      coopLog(
        "checksum",
        `capture digest=${digest} `
          + `field=${state.field.length} biome=${state.biomeId} seed=${state.seed} `
          + `weather=${state.weather} terrain=${state.terrain} money=${state.money} `
          + `party=[${state.party.join(",")}] partyLevels=[${state.partyLevels.join(",")}] `
          + `arenaTags=${state.arenaTags.length} modifiers=${state.modifiers.length} `
          + `heldItemsDigest=${state.heldItems.length} pokeballs=[${state.pokeballCounts.map(([t, c]) => `${t}:${c}`).join(",")}] `
          + `mons=[${state.field
            .map(
              m =>
                `bi${m.bi}:sp${m.speciesId}/hp${m.hp}-${m.maxHp}/st${m.status}/ab${m.abilityId}/form${m.formIndex}`
                + `/tera${m.isTerastallized ? 1 : 0}:${m.teraType}/boss${m.bossSegments}:${m.bossSegmentIndex}`,
            )
            .join(" ")}]`,
      );
    }
    return digest;
  } catch {
    coopWarn("checksum", "captureCoopChecksum read failed -> sentinel (comparison skipped)");
    return COOP_CHECKSUM_SENTINEL;
  }
}

/** Build ONE field mon's full resync snapshot (superset of the checkpoint). */
function readFullMon(mon: Pokemon): CoopFullMonSnapshot {
  const tera = readTeraState(mon);
  const boss = readBossState(mon);
  return {
    bi: mon.getBattlerIndex(),
    partyIndex: readPartyIndex(mon),
    speciesId: mon.species?.speciesId ?? 0,
    hp: mon.hp,
    maxHp: mon.getMaxHp(),
    status: mon.status?.effect ?? 0,
    statStages: [...mon.getStatStages()],
    fainted: mon.isFainted(),
    abilityId: readAbilityId(mon),
    formIndex: mon.formIndex ?? 0,
    // Tera state (#633 GAP 7): forced in the snapshot apply so a dropped Tera command heals.
    isTerastallized: tera.isTerastallized,
    teraType: tera.teraType,
    // Authoritative level + exp (#633, B): forced TOGETHER on the guest so the stat recompute uses the
    // authoritative base (closes maxHp at root). `levelExp` is a derived getter, so no stale field.
    level: mon.level,
    exp: mon.exp,
    // Boss state (#633, A/BLOCKING-2): re-asserted on resync so boss bars + shield dividers heal.
    bossSegments: boss.bossSegments,
    bossSegmentIndex: boss.bossSegmentIndex,
    moves: readMoves(mon),
    tags: readTagTypes(mon),
    // On-field held items (#633 RISKY #1/#2/#3): the heavy ModifierData blobs the compact checksum
    // digest can't carry; the gated guest heal sets the live mon's items to this exact set.
    heldItems: captureCoopHeldItems(mon),
    // Transform / Imposter copied identity (#836/#837): the summonData a host Transform wrote, so the
    // guest converges its sprite/species/moveset/types/ability/stats. null = not transformed (guest clears).
    transform: readTransform(mon),
  };
}

/**
 * #838 UNIFY: the id-based authoritative full-state for a CROSSING / RESYNC / ME-terminal context, with
 * `pokeballCounts` STRIPPED. The unified apply ({@linkcode applyCoopAuthoritativeBattleState}) SETs balls
 * from this payload, but the resync/ME path must NOT (#843): a crossing SET raced a between-wave ball
 * grant and drifted the guest ABOVE the host. Balls converge ONLY through the per-turn end-of-turn state
 * (the sanctioned carrier), so this variant carries an empty ball list (the apply's `?? []` guard then
 * skips the ball SET). Returns null on a capture failure (duplicate ids) so the legacy fallback still runs.
 */
function captureCoopResyncAuthoritativeState(): CoopAuthoritativeBattleStateV1 | undefined {
  const state = captureCoopAuthoritativeBattleState(globalScene.currentBattle?.turn ?? 0);
  return state == null ? undefined : { ...state, pokeballCounts: [] };
}

/**
 * HOST: serialize the FULL authoritative battle state to heal a guest desync (#633,
 * TRACK-2). Carries every detail the per-turn checkpoint can't: ability, form, per-move
 * PP, battler tags, arena tags, party order, money, modifier stacks. Returns null when
 * there is no live field (defensive). The guest adopts it via {@linkcode applyCoopFullSnapshot}.
 */
export function captureCoopFullSnapshot(): CoopFullBattleSnapshot | null {
  try {
    const arena = globalScene.arena;
    // Same survivors-plus-fainted-enemy serialization as the per-turn checkpoint (#633 enemy-field
    // reconcile): the resync payload must also carry a just-fainted enemy so a guest healing via the
    // snapshot removes the dead foe, not just the per-turn checkpoint path.
    const field = getCoopSerializableField()
      .map(readFullMon)
      .sort((a, b) => a.bi - b.bi);
    if (field.length === 0) {
      return null;
    }
    return {
      tick: coopNextStateTick(), // #807 monotonic sequencing
      field,
      weather: arena.weather?.weatherType ?? 0,
      weatherTurnsLeft: arena.weather?.turnsLeft ?? 0,
      terrain: arena.terrain?.terrainType ?? 0,
      terrainTurnsLeft: arena.terrain?.turnsLeft ?? 0,
      // Rich arena tags (#633 GAP 1): the resync path reconciles the guest's arena identically to
      // the per-turn checkpoint (hazards / screens / tailwind), carrying turnCount + layers.
      arenaTags: readArenaTagViews(),
      party: globalScene.getPlayerParty().map(p => p.species.speciesId),
      money: globalScene.money,
      modifiers: readModifiers(),
      // Player-wide persistent modifier BLOBS (#698 / #633 BUG 2): the full ModifierData of the
      // NON-held-item PersistentModifiers, so the gated guest heal can RECONSTRUCT a player-wide
      // modifier it is MISSING (a temp stat booster, an EXP charm, ...) - the `[typeId, stackCount]`
      // `modifiers` digest above can only fix a stack / remove an extra, never re-create one with args.
      // Captured UNCONDITIONALLY (additive); only READ inside the gated authoritative heal.
      playerModifiers: captureCoopPlayerModifiers(),
      // Ball inventory is intentionally NOT carried in the resync snapshot (#843): the crossing/resync
      // ball SET raced the reward-shop ADD (guest drifted ABOVE host). Balls converge ONLY through the
      // end-of-turn authoritative state ({@linkcode captureCoopAuthoritativeBattleState}); the optional
      // wire field stays for back-compat but the apply no longer reads it.
      // Full per-mon PokemonData for the WHOLE party (#633 B4): the resync now carries bench-mon
      // level / exp / form / friendship / moveset (+ a host off-field evolution's species) so the
      // revive-in-shop desync heals - the on-field-only `field` + speciesId-only `party` cannot.
      // Reuses the capture-handshake serialize; applied (gated guest-only) in applyCoopFullSnapshot.
      benchParty: captureCoopCaptureParty(),
      // Biome + run seed (B7/B8): the guest heals a biome split (newArena) + re-pins the run seed /
      // wave seed on ANY resync. `?? ""` / `?? 0` so the literal never carries an explicit undefined
      // into a `?: T` field (exactOptional safety); the apply's length-guard skips an empty seed.
      biomeId: arena.biomeId ?? 0,
      seed: globalScene.seed ?? "",
      waveSeed: globalScene.waveSeed ?? "",
      // ER module-let substrates (#837): carried using each substrate's OWN save-data serializer so the
      // gated guest heal restores them through their own restore functions - closing the drift class the
      // saveDataDigest now DETECTS. Captured unconditionally (additive); only READ in the gated heal.
      erMoneyStreaks: getErMoneyStreakEntries(),
      biomeOverstayAnchor: erBiomeOverstayAnchor(),
      erRelicBattleState: getErRelicBattleState(),
      // Biome-structure extent (#841 item 5): rolled length + start wave. The saveDataDigest DETECTS a
      // drift here (via erMapState) but no heal carried it; the gated guest heal restores it through
      // restoreErBiomeStructure. Captured unconditionally (additive); only READ in the gated heal.
      erBiomeStructure: { biomeLength: getErBiomeLength(), biomeStartWave: getErBiomeStartWave() },
      // ER WORLD-MAP STATE (#865): the revealed onward nodes / travel target / fragments / journey (the
      // substrate's OWN save serializer) + the routing PENDING-NODE set the biome-travel decision reads
      // (getErPendingNodes, NOT part of erMapState). The gated guest heal adopts BOTH (restoreErMapState +
      // setErPendingNodes) so a natural single-node biome-travel terminal is coherent by construction and the
      // "erMapState heal path" (audit #841 item 1) is closed. Captured unconditionally (additive).
      erMapState: getErMapSaveData(),
      erPendingNodes: getErPendingNodes(),
      // #838 UNIFY: the id-based authoritative full-state (whole party as PokemonData, seating, arena,
      // modifiers, money, ER substrates). When present the guest heals via applyCoopAuthoritativeBattleState
      // (mutate-in-place by Pokemon.id) instead of the legacy species-order + benchParty reconcile above -
      // a strict superset of those fields. `?? undefined` keeps the wire field ABSENT on a capture failure
      // (duplicate ids) so the legacy fallback still runs.
      authoritativeState: captureCoopResyncAuthoritativeState(),
    };
  } catch {
    return null;
  }
}

function pokemonDataForWire(mon: Pokemon): Record<string, unknown> {
  const data = JSON.parse(JSON.stringify(new PokemonData(mon))) as Record<string, unknown>;
  // Save-format PokemonData normally omits derived stats because solo reload recalculates them. An
  // authoritative renderer must not recalculate under its own ER modifier/context, so the live network
  // carrier includes the host's exact array; applyAuthoritativeMonData already gives it precedence.
  data.stats = [...mon.stats];
  // PokemonData is a save-oriented projection and can retain the pre-summon snapshot even after a live
  // PostSummon ability mutates the battler's stages. Wave-start authority is captured precisely at that
  // post-entry boundary, so stamp the live mechanical array explicitly. Otherwise the entry-effect seal
  // notices a change elsewhere, re-broadcasts, but still carries zero stages and opens command on drifted math.
  const summonData = data.summonData;
  data.summonData = {
    ...(summonData != null && typeof summonData === "object" ? summonData : {}),
    statStages: [...mon.getStatStages()],
  };
  return data;
}

function captureCoopModifierBlobs(player: boolean): Record<string, unknown>[] {
  try {
    return globalScene
      .findModifiers(m => m instanceof PersistentModifier, player)
      .map(m => {
        const data = new ModifierData(m, player);
        return {
          player: data.player,
          typeId: coopModifierTypeId(m),
          className: data.className,
          args: data.args,
          stackCount: data.stackCount,
          ...(data.typePregenArgs === undefined ? {} : { typePregenArgs: data.typePregenArgs }),
        };
      });
  } catch {
    return [];
  }
}

function readAuthoritativeSeat(mon: Pokemon): CoopAuthoritativeFieldSeat {
  const side = mon.isPlayer() ? "player" : "enemy";
  const boss = readBossState(mon);
  return {
    side,
    bi: mon.getBattlerIndex(),
    partyIndex: readPartyIndex(mon),
    pokemonId: mon.id,
    presented: mon.isOnField(),
    ...((mon as { coopOwner?: CoopRole }).coopOwner === undefined
      ? {}
      : { owner: (mon as { coopOwner?: CoopRole }).coopOwner }),
    ...(side === "enemy" ? { bossSegmentIndex: boss.bossSegmentIndex } : {}),
  };
}

function assertNoDuplicateAuthoritativeIds(parties: Record<string, unknown>[][]): boolean {
  // IDs address Pokemon only inside their explicit side (`field[].side` selects the player/enemy map before
  // `pokemonId` is read). The engine can legitimately reuse a numeric id across opposing parties; rejecting
  // that collision dropped the entire authoritative state for a wave and left the renderer's stat stages
  // stale. Duplicates remain forbidden within one side, where lookup would actually be ambiguous.
  for (const [sideIndex, party] of parties.entries()) {
    const seen = new Set<number>();
    for (const raw of party) {
      const id = raw.id;
      if (typeof id !== "number") {
        return false;
      }
      if (seen.has(id)) {
        coopWarn(
          "resync",
          `authoritativeState duplicate Pokemon.id=${id} within side=${sideIndex} -> capture/apply rejected`,
        );
        return false;
      }
      seen.add(id);
    }
  }
  return true;
}

type CoopAuthoritativeBattleMaterialV1 = Omit<CoopAuthoritativeBattleStateV1, "tick">;

/**
 * Capture the complete mechanical material shared by authoritative-state publication and the
 * pre-command entry-effect seal. The monotonic transport tick is added only by the public carrier
 * builder below, so comparing material never mutates publication order.
 */
function captureCoopAuthoritativeBattleMaterial(turn: number): CoopAuthoritativeBattleMaterialV1 | null {
  try {
    const playerParty = globalScene.getPlayerParty().map(pokemonDataForWire);
    const enemyParty = globalScene.getEnemyParty().map(pokemonDataForWire);
    if (!assertNoDuplicateAuthoritativeIds([playerParty, enemyParty])) {
      return null;
    }
    const arena = globalScene.arena;
    return {
      version: 1,
      wave: globalScene.currentBattle?.waveIndex ?? 0,
      turn,
      double: globalScene.currentBattle?.double === true,
      playerParty,
      enemyParty,
      field: getCoopSerializableField()
        .map(readAuthoritativeSeat)
        .sort((a, b) => a.bi - b.bi),
      weather: arena.weather?.weatherType ?? 0,
      weatherTurnsLeft: arena.weather?.turnsLeft ?? 0,
      terrain: arena.terrain?.terrainType ?? 0,
      terrainTurnsLeft: arena.terrain?.turnsLeft ?? 0,
      arenaTags: readArenaTagViews(),
      money: globalScene.money,
      score: globalScene.score,
      pokeballCounts: readPokeballCounts(),
      playerModifiers: captureCoopModifierBlobs(true),
      enemyModifiers: captureCoopModifierBlobs(false),
      biomeId: arena.biomeId ?? 0,
      seed: globalScene.seed ?? "",
      waveSeed: globalScene.waveSeed ?? "",
      erMoneyStreaks: getErMoneyStreakEntries(),
      biomeOverstayAnchor: erBiomeOverstayAnchor(),
      erRelicBattleState: getErRelicBattleState(),
      // Biome-structure extent (#841 item 5): rolled length + start wave. The saveDataDigest DETECTS a
      // drift here (via erMapState) but no heal carried it; the gated guest heal restores it through
      // restoreErBiomeStructure. Captured unconditionally (additive); only READ in the gated heal.
      erBiomeStructure: { biomeLength: getErBiomeLength(), biomeStartWave: getErBiomeStartWave() },
      // ER WORLD-MAP STATE (#865): carried per-turn so the guest ADOPTS the host's map state (restoreErMapState
      // + setErPendingNodes) BEFORE it hashes its saveDataDigest - adopt-then-hash convergence, so the widened
      // erMapState digest never trips a per-turn assertion. Captured unconditionally (additive).
      erMapState: getErMapSaveData(),
      erPendingNodes: getErPendingNodes(),
    };
  } catch {
    return null;
  }
}

/**
 * HOST: capture the normal-turn full authoritative state. Per-mon live state is
 * carried by PokemonData.summonData; the field payload is seating only.
 */
export function captureCoopAuthoritativeBattleState(turn: number): CoopAuthoritativeBattleStateV1 | null {
  const material = captureCoopAuthoritativeBattleMaterial(turn);
  if (material == null) {
    return null;
  }
  const { version, ...rest } = material;
  return { version, tick: coopNextStateTick(), ...rest };
}

/**
 * Entry-effect SIGNATURE (#920): the complete mechanical projection of authoritative state an on-entry chain
 * (PostSummonPhase) can mutate between the PRE-summon wave-start capture and the first CommandPhase -
 * every carried field, including weather/terrain, arena tags, forms, both parties' PokemonData, and both
 * parties' stat stages. The stage component is essential: PostSummon abilities such as Let’s Roll / Download
 * can boost a host battler before turn 1, while the pure-renderer guest never executes that ability chain.
 * Omitting any carried field can let both clients open the same command surface with different battle math even though the
 * earlier pre-summon carrier had been applied successfully. The host compares the LIVE post-PostSummon
 * signature against the one it already broadcast in the wave-start
 * enemyPartySync; a difference means an entry effect fired, which is the sole trigger for the single
 * post-summon re-broadcast ({@linkcode rebroadcastCoopWaveStartAuthorityAfterEntryEffects}) so the
 * pure-renderer guest (which never runs summon/PostSummon) adopts the complete mechanical state BEFORE its
 * first command instead of at the turn-1 END checkpoint - after it already commanded with stale state.
 * In particular, scripted PostSummon attacks such as Cheap Tactics mutate HP without changing the old
 * arena/form/stage subset. The signature therefore uses the same complete material builder as the carrier.
 *
 * Reads live scene when `state` is omitted, else the given carrier. Fully guarded: a read failure returns
 * "" so the caller treats an empty LIVE signature as "cannot tell -> do NOT re-broadcast" (never a spurious
 * re-send). The captured state ALREADY snapshots every one of these fields (weather/terrain/arenaTags +
 * per-mon formIndex + PokemonData.summonData.statStages), so this compares the SAME serialized shapes on
 * both sides.
 * The monotonic publication tick is excluded because it expresses ordering rather than mechanical state.
 */
export function coopWaveStartEntryEffectSignature(state?: CoopAuthoritativeBattleStateV1 | null): string {
  try {
    if (state != null) {
      const { tick: _publicationOrder, ...material } = state;
      return canonicalize(material);
    }
    const material = captureCoopAuthoritativeBattleMaterial(globalScene.currentBattle?.turn ?? 0);
    return material == null ? "" : canonicalize(material);
  } catch {
    return "";
  }
}

function parseAuthoritativeParty(rawParty: Record<string, unknown>[] | undefined): PokemonData[] | null {
  if (!Array.isArray(rawParty)) {
    return null;
  }
  const out: PokemonData[] = [];
  for (const raw of rawParty) {
    try {
      out.push(new PokemonData(raw));
    } catch {
      return null;
    }
  }
  return out;
}

function battleSpriteKey(mon: Pokemon): string {
  try {
    // Presentation-aware (staging fix 2026-07-07): the DEFAULT back-arg resolves through the
    // versus-guest perspective flip (`presentationIsBack()`), which collapses to `isPlayer()` for
    // solo/co-op - passing `mon.isPlayer()` explicitly re-textured the versus guest's OWN team
    // (authoritative enemies, presented player-side) with FRONT sprites on every state apply.
    return mon.getBattleSpriteKey(undefined, false);
  } catch {
    return "";
  }
}

function copyMovesetFromData(data: PokemonData): PokemonMove[] {
  return (data.moveset ?? []).map(m => {
    const move = new PokemonMove(m.moveId);
    move.ppUsed = Math.max(0, Math.trunc(m.ppUsed ?? 0));
    move.ppUp = Math.max(0, Math.trunc(m.ppUp ?? 0));
    return move;
  });
}

/**
 * GUEST: apply the host's authoritative per-mon DATA in place (preserving the Phaser sprite). This is
 * the DATA half only - it writes species/form/stats/status/summonData/etc. and does NOT touch the
 * RENDER (battle-info bars, sprite atlas, boss dividers). The Phase-3 render differ
 * ({@linkcode runCoopRenderDiffer}) owns ALL rendering: it runs AFTER the whole state apply, over every
 * on-field mon, doing the unconditional cheap refresh + the sprite-key-gated re-summon. Keeping data
 * and render separate is what lets the differ invert the granularity (a missed field degrades to a
 * harmless extra refresh instead of a stale visual). See docs/plans Phase-3 spec (#838).
 */
function applyAuthoritativeMonData(mon: Pokemon, data: PokemonData, authoritativeGuest: boolean): void {
  try {
    mon.id = data.id;
    mon.species = getPokemonSpecies(data.species);
    mon.nickname = data.nickname;
    mon.formIndex = data.formIndex;
    mon.abilityIndex = data.abilityIndex;
    mon.passive = data.passive;
    mon.shiny = data.shiny;
    mon.variant = data.variant;
    mon.pokeball = data.pokeball;
    mon.level = data.level;
    mon.exp = data.exp;
    mon.gender = data.gender;
    mon.nature = data.nature;
    mon.luck = data.luck;
    mon.friendship = data.friendship;
    mon.metLevel = data.metLevel;
    mon.metBiome = data.metBiome;
    mon.metSpecies = data.metSpecies;
    mon.metWave = data.metWave;
    mon.pauseEvolutions = data.pauseEvolutions;
    mon.pokerus = data.pokerus;
    mon.usedTMs = [...(data.usedTMs ?? [])];
    mon.teraType = data.teraType;
    mon.isTerastallized = data.isTerastallized;
    mon.stellarTypesBoosted = [...(data.stellarTypesBoosted ?? [])];
    mon.ivs = [...(data.ivs ?? [])];
    mon.moveset = copyMovesetFromData(data);
    mon.status = data.status
      ? new Status(data.status.effect, data.status.toxicTurnCount, data.status.sleepTurnsRemaining)
      : null;
    mon.fusionSpecies = data.fusionSpecies ? getPokemonSpecies(data.fusionSpecies) : null;
    mon.fusionFormIndex = data.fusionFormIndex;
    mon.fusionAbilityIndex = data.fusionAbilityIndex;
    mon.fusionShiny = data.fusionShiny;
    mon.fusionVariant = data.fusionVariant;
    mon.fusionGender = data.fusionGender;
    mon.fusionLuck = data.fusionLuck;
    mon.fusionTeraType = data.fusionTeraType;
    mon.customPokemonData = new CustomPokemonData(data.customPokemonData);
    mon.fusionCustomPokemonData = new CustomPokemonData(data.fusionCustomPokemonData);
    mon.summonData = new PokemonSummonData(data.summonData);
    mon.battleData = new PokemonBattleData(data.battleData);
    if (data.coopOwner !== undefined) {
      (mon as PlayerPokemon).coopOwner = data.coopOwner;
    }
    mon.calculateStats();
    if (Array.isArray(data.stats) && data.stats.length > 0) {
      mon.stats = [...data.stats];
    }
    mon.hp = Math.max(0, Math.min(Math.trunc(data.hp), mon.getMaxHp()));
    if (authoritativeGuest && mon instanceof EnemyPokemon) {
      mon.setBoss(data.boss === true || data.bossSegments > 0, data.bossSegments > 0 ? data.bossSegments : undefined);
    }
    // NOTE: no render here. The Phase-3 differ (runCoopRenderDiffer) refreshes battle-info + re-summons
    // on a sprite-key change AFTER the whole state apply, over every on-field mon.
  } catch (e) {
    // One mon's authoritative data failed. The checksum catches HASHED residual drift, but NOT a corrupted
    // UNHASHED sub-field (a summonData internal, an ability/form the hash reads only on-field) - so record
    // it structurally: a non-empty drain forces the loud heal even when the checksum matched (item 4).
    recordCoopApplyFailure("monData", e, data.id);
  }
}

interface CoopAuthoritativeApplyMutationScope {
  /** Candidate-only objects are quarantined until the transaction commits. */
  readonly createdPokemon: Pokemon[];
  /** Prior-boundary objects are not destroyed until the transaction commits. */
  readonly retiredPokemon: { pokemon: Pokemon; side: "player" | "enemy" }[];
  /** Field/sprite projection is queued only after every material section succeeds. */
  fieldPresentation?: {
    readonly playerSeats: { pokemon: Pokemon; slot: number }[];
    readonly enemySeats: { pokemon: Pokemon; slot: number }[];
    readonly playerCapacity: number;
    readonly enemyCapacity: number;
  };
  preSpriteKeys?: Map<number, string>;
}

function constructAuthoritativePokemon(
  data: PokemonData,
  index: number,
  mutationScope?: CoopAuthoritativeApplyMutationScope,
): Pokemon | null {
  try {
    const battle = globalScene.currentBattle;
    const mon = data.toPokemon(battle?.battleType ?? BattleType.WILD, index, battle?.double === true);
    mon.setVisible(false);
    mon.getSprite()?.setVisible(false);
    mutationScope?.createdPokemon.push(mon);
    return mon;
  } catch {
    return null;
  }
}

function reconcileAuthoritativeParty(
  side: "player" | "enemy",
  hostParty: PokemonData[],
  authoritativeGuest: boolean,
  mutationScope?: CoopAuthoritativeApplyMutationScope,
): Pokemon[] {
  const liveParty =
    side === "player" ? (globalScene.getPlayerParty() as Pokemon[]) : (globalScene.getEnemyParty() as Pokemon[]);
  // #840: an EMPTY authoritative party for this side is "no info for this side right now", NOT "this side
  // has zero members". It occurs when the snapshot is captured mid-crossing - a between-waves POST_BATTLE_
  // SWITCH pushes CoopPushReplacementCheckpointPhase AFTER NewBattlePhase reset currentBattle but BEFORE
  // the next EncounterPhase spawns the foes, so getEnemyParty() is transiently empty on the host. Falling
  // through would `liveParty.length = 0` this renderer's LIVE enemy party (and destroy each member below),
  // stranding a queued phase on the now-null field slot (the getEffectiveStat NO-PARK strand). Leave the
  // live side untouched; the populated side (the player half, carrying the switch's reorder) still applies,
  // and real enemy state lands at the next turn boundary. A genuine in-battle side is never empty (fainted
  // members stay in the party at hp 0), so this only skips the transient no-info case.
  if (hostParty.length === 0) {
    return liveParty;
  }
  const byId = new Map<number, Pokemon>();
  for (const mon of liveParty) {
    if (mon != null && typeof mon.id === "number" && !byId.has(mon.id)) {
      byId.set(mon.id, mon);
    }
  }
  const wantedIds = new Set(hostParty.map(p => p.id));
  const ordered: Pokemon[] = [];
  for (let i = 0; i < hostParty.length; i++) {
    const data = hostParty[i];
    let mon = byId.get(data.id);
    if (mon == null) {
      mon = constructAuthoritativePokemon(data, i, mutationScope) ?? undefined;
    }
    if (mon == null) {
      continue;
    }
    applyAuthoritativeMonData(mon, data, authoritativeGuest);
    ordered.push(mon);
  }
  for (const mon of liveParty) {
    if (mon != null && !wantedIds.has(mon.id)) {
      if (mutationScope != null) {
        // Never destroy a prior-boundary object while the candidate can still fail. Field
        // presentation hides the stale seat below; physical teardown happens only after every
        // material section has committed and the state tick is ready to advance.
        mutationScope.retiredPokemon.push({ pokemon: mon, side });
        continue;
      }
      try {
        if (mon.isOnField()) {
          mon.leaveField(true, true, false);
        }
        if (side === "player") {
          globalScene.removePokemonFromPlayerParty(mon as PlayerPokemon, true);
        } else {
          globalScene.field.remove(mon, true);
          mon.destroy();
        }
      } catch {
        /* stale extra cleanup is best-effort */
      }
    }
  }
  liveParty.length = 0;
  liveParty.push(...ordered);
  return ordered;
}

function activeFieldIndexForSeat(seat: CoopAuthoritativeFieldSeat): number {
  const arrangement = globalScene.currentBattle?.arrangement;
  if (seat.side === "enemy") {
    return Math.max(0, seat.bi - (arrangement?.enemyOffset ?? BattlerIndex.ENEMY));
  }
  return seat.bi;
}

function reconcileAuthoritativeField(
  state: CoopAuthoritativeBattleStateV1,
  playerParty: PokemonData[],
  enemyParty: PokemonData[],
  mutationScope?: CoopAuthoritativeApplyMutationScope,
): void {
  const playerById = new Map(playerParty.map(p => [p.id, p]));
  const enemyById = new Map(enemyParty.map(p => [p.id, p]));
  const liveById = new Map<number, Pokemon>();
  for (const mon of [...(globalScene.getPlayerParty() as Pokemon[]), ...(globalScene.getEnemyParty() as Pokemon[])]) {
    liveById.set(mon.id, mon);
  }
  const visiblePlayerSeats: { pokemon: Pokemon; slot: number }[] = [];
  const visibleEnemySeats: { pokemon: Pokemon; slot: number }[] = [];
  for (const seat of state.field) {
    const party =
      seat.side === "player" ? (globalScene.getPlayerParty() as Pokemon[]) : (globalScene.getEnemyParty() as Pokemon[]);
    const data = seat.side === "player" ? playerById.get(seat.pokemonId) : enemyById.get(seat.pokemonId);
    const fieldIndex = activeFieldIndexForSeat(seat);
    let mon = liveById.get(seat.pokemonId);
    const partyIndex = party.indexOf(mon as Pokemon);
    if (mon != null && fieldIndex >= 0 && fieldIndex < party.length && partyIndex >= 0 && partyIndex !== fieldIndex) {
      [party[fieldIndex], party[partyIndex]] = [party[partyIndex], party[fieldIndex]];
    }
    mon = party[fieldIndex] ?? mon;
    if (mon == null || mon.id !== seat.pokemonId) {
      continue;
    }
    if (seat.side === "enemy" && mon instanceof EnemyPokemon && seat.bossSegmentIndex !== undefined) {
      mon.bossSegmentIndex = seat.bossSegmentIndex;
    }
    // `field` is logical slot data and intentionally contains pre-intro/just-fainted occupants. Only an
    // explicit host presentation statement may reveal a seat; protocol 30 rejects cached peers that do
    // not carry this required bit, and a malformed missing value therefore fails closed to hidden.
    if (seat.presented === true && (data?.hp ?? mon.hp) > 0) {
      (seat.side === "player" ? visiblePlayerSeats : visibleEnemySeats).push({ pokemon: mon, slot: fieldIndex });
    }
  }
  const arrangement = globalScene.currentBattle?.arrangement;
  if (mutationScope != null) {
    mutationScope.fieldPresentation = {
      playerSeats: visiblePlayerSeats,
      enemySeats: visibleEnemySeats,
      playerCapacity: arrangement?.playerCapacity ?? 1,
      enemyCapacity: arrangement?.enemyCapacity ?? 1,
    };
    return;
  }
  settleCoopFieldPresentation({
    side: "player",
    seats: visiblePlayerSeats,
    capacity: arrangement?.playerCapacity ?? 1,
    boundary: visiblePlayerSeats.length > 0 ? "resync-stable" : "wave-start-pre-intro",
    desired: "visible",
    hideStale: true,
  });
  settleCoopFieldPresentation({
    side: "enemy",
    seats: visibleEnemySeats,
    capacity: arrangement?.enemyCapacity ?? 1,
    boundary: visibleEnemySeats.length > 0 ? "resync-stable" : "wave-start-pre-intro",
    desired: "visible",
    hideStale: true,
  });
}

/**
 * Field materialization calls engine seating helpers that may swap the shared party array. Reassert
 * the host's id order at the completed boundary so the next local command menu cannot present a
 * host-active replacement as a legal bench switch on the guest.
 */
function reassertAuthoritativePartyOrder(side: "player" | "enemy", hostParty: PokemonData[]): void {
  const liveParty =
    side === "player" ? (globalScene.getPlayerParty() as Pokemon[]) : (globalScene.getEnemyParty() as Pokemon[]);
  const byId = new Map(liveParty.map(mon => [mon.id, mon]));
  const ordered = hostParty.map(data => byId.get(data.id)).filter((mon): mon is Pokemon => mon != null);
  if (ordered.length !== hostParty.length) {
    recordCoopApplyFailure(`${side}PartyOrder`, new Error("authoritative party member missing after field apply"));
    return;
  }
  if (ordered.some((mon, index) => liveParty[index] !== mon)) {
    coopWarn("resync", `${side} party order changed during field materialization -> authoritative order reasserted`);
    liveParty.splice(0, liveParty.length, ...ordered);
  }
}

function modifierInstanceKey(data: ModifierData): string {
  return `${data.typeId}|${data.className}|${JSON.stringify(data.args ?? [])}|${JSON.stringify(data.typePregenArgs ?? [])}`;
}

function rawModifierInstanceKey(
  raw: Record<string, unknown>,
  player: boolean,
): { key: string; data: ModifierData } | null {
  try {
    const data = new ModifierData(raw, player);
    return { key: modifierInstanceKey(data), data };
  } catch {
    return null;
  }
}

function pushPersistentModifier(modifier: PersistentModifier, player: boolean): void {
  if (player) {
    globalScene.modifiers.push(modifier);
  } else {
    (globalScene as unknown as { enemyModifiers: PersistentModifier[] }).enemyModifiers.push(modifier);
  }
}

function reconcileAuthoritativeModifiers(rawBlobs: Record<string, unknown>[] | undefined, player: boolean): void {
  if (!Array.isArray(rawBlobs)) {
    return;
  }
  try {
    const wanted = new Map<string, { raw: Record<string, unknown>; data: ModifierData }[]>();
    for (const raw of rawBlobs) {
      if (raw == null || typeof raw !== "object") {
        continue;
      }
      const keyed = rawModifierInstanceKey(raw, player);
      if (keyed == null) {
        continue;
      }
      const queue = wanted.get(keyed.key) ?? [];
      queue.push({ raw, data: keyed.data });
      wanted.set(keyed.key, queue);
    }
    let changed = false;
    for (const modifier of globalScene.findModifiers(m => m instanceof PersistentModifier, player)) {
      const liveData = new ModifierData(modifier, player);
      const queue = wanted.get(modifierInstanceKey(liveData));
      const match = queue?.shift();
      if (match == null) {
        if (globalScene.removeModifier(modifier, !player)) {
          changed = true;
        }
        continue;
      }
      if (typeof match.data.stackCount === "number" && modifier.stackCount !== match.data.stackCount) {
        modifier.stackCount = match.data.stackCount;
        changed = true;
      }
    }
    for (const queue of wanted.values()) {
      for (const { data } of queue) {
        try {
          const modifier = data.toModifier(
            Modifier[data.className as keyof typeof Modifier] ?? resolveErModifierClass(data.className),
          );
          if (!(modifier instanceof PersistentModifier)) {
            continue;
          }
          if (typeof data.stackCount === "number") {
            modifier.stackCount = data.stackCount;
          }
          pushPersistentModifier(modifier, player);
          changed = true;
        } catch (error) {
          recordCoopApplyFailure(player ? "playerModifiers" : "enemyModifiers", error);
        }
      }
    }
    if (changed) {
      globalScene.updateModifiers(player, true);
    }
  } catch (e) {
    // A malformed modifier payload must not crash the turn, but it CAN leave a modifier arg (an unhashed
    // internal the [typeId, stackCount] digest cannot see) diverged - record it so the finalize caller
    // forces the loud heal (item 4).
    recordCoopApplyFailure(player ? "playerModifiers" : "enemyModifiers", e);
  }
}

/**
 * Snapshot the current on-field sprite key of every active mon, keyed by `Pokemon.id`. Captured
 * BEFORE the authoritative data apply so {@linkcode runCoopRenderDiffer} can compare against the
 * post-apply key and re-summon ONLY when the visual identity actually changed. A mon absent from
 * this map after the apply is a NEWLY-seated field mon (the field reconcile already summoned it),
 * so it is never re-summoned by the differ.
 */
function captureCoopOnFieldSpriteKeys(): Map<number, string> {
  const keys = new Map<number, string>();
  try {
    for (const mon of getActuallyFieldedCoopPokemon()) {
      if (mon != null) {
        keys.set(mon.id, battleSpriteKey(mon));
      }
    }
  } catch {
    /* a read failure just yields fewer pre-keys -> the differ degrades to an extra refresh */
  }
  return keys;
}

/**
 * PHASE 3 render differ (#838): reconcile the guest's RENDER to the (already-applied) authoritative
 * DATA after a full-state apply. The granularity is DELIBERATELY INVERTED so a missed field degrades
 * to a harmless extra refresh, never a stale visual:
 *
 *  1. CHEAP REFRESH - runs UNCONDITIONALLY on every on-field mon + both held-item bars. These are the
 *     SAME canonical calls the live game already makes after damage / an item change, so re-running
 *     them every turn is idempotent and flicker-free:
 *       - {@linkcode Pokemon.updateInfo} -> the battle-info bar (hp, the ER status badge incl.
 *         bleed/frostbite/fear, name/gender/level/stat-stage text, shiny/tera icons);
 *       - {@linkcode EnemyBattleInfo.updateBossSegments} -> the boss segment dividers (enemy);
 *       - {@linkcode BattleScene.updateModifiers} for BOTH sides -> the held-item indicator bars. The
 *         authoritative modifier reconcile only redraws on a detected change; re-running the canonical
 *         bar rebuild here closes the "enemy items don't refresh on the guest" render gap (data
 *         converged, bar stale) regardless of that gate.
 *  2. EXPENSIVE RE-SUMMON - load the atlas + replay the sprite for a newly presented authoritative object,
 *     or when the `getBattleSpriteKey` INPUTS (species/form/shiny/variant/fusion/gender where it affects
 *     the sprite) changed across the data apply. Routine stable turns remain cheap, while a replacement
 *     constructed from PokemonData cannot remain on the placeholder just because it had no pre-apply key.
 *     The #845 absolute-positioning fix stays intact: field reconcile already seated the mon at the live
 *     platform base; this only loads/swaps its atlas.
 *
 * Fully guarded per mon: one failed refresh never aborts the rest.
 */
function runCoopRenderDiffer(preSpriteKeys: Map<number, string>): void {
  for (const mon of getActuallyFieldedCoopPokemon()) {
    if (mon == null) {
      continue;
    }
    try {
      // (1) CHEAP REFRESH - unconditional battle-info + boss-segment redraw.
      void mon.updateInfo(true);
      if (mon instanceof EnemyPokemon) {
        const info = mon.getBattleInfo();
        if (info instanceof EnemyBattleInfo) {
          info.updateBossSegments(mon);
        }
      }
      // (2) EXPENSIVE RE-SUMMON - when the sprite-key INPUTS changed for a mon already on field, OR
      // when authoritative reconciliation just seated a brand-new object. The old seating helper loaded
      // assets unconditionally for a new seat; dropping that while centralizing presentation left a newly
      // reconstructed replacement on the substitute placeholder because it has no pre-apply key to diff.
      const before = preSpriteKeys.get(mon.id) ?? "";
      const after = battleSpriteKey(mon);
      if (after !== "" && (before === "" || before !== after)) {
        coopLog(
          "resync",
          before === ""
            ? `render differ: newly presented id=${mon.id} key=${after} -> load atlas`
            : `render differ: sprite-key change id=${mon.id} ${before} -> ${after} -> re-summon`,
        );
        void mon
          .loadAssets(false)
          .then(() => {
            try {
              mon.playAnim();
            } catch {
              /* headless or torn-down sprite */
            }
            void mon.updateInfo(true);
          })
          .catch(() => {});
      }
    } catch {
      /* one mon's render refresh failed; the rest still refresh */
    }
  }
}

/**
 * GUEST: apply the normal-turn authoritative state. Returns false only when the
 * payload was absent, malformed, or stale by tick.
 */
export function applyCoopAuthoritativeBattleState(
  state: CoopAuthoritativeBattleStateV1 | undefined,
  authoritativeGuest = false,
): boolean {
  return applyCoopAuthoritativeBattleStateTransaction(state, authoritativeGuest, false);
}

/**
 * Reassert a full state that this client already accepted at an earlier safe boundary.
 * This deliberately bypasses only the monotonic-tick admission check: the live replay
 * pump may need a replacement immediately to collect its owner's next command, while
 * delayed animations then mutate HP/PP/field presentation before finalization. Callers
 * must retain this exact payload only after the first apply succeeded.
 */
export function reapplyAcceptedCoopAuthoritativeBattleState(
  state: CoopAuthoritativeBattleStateV1 | undefined,
  authoritativeGuest = false,
): boolean {
  if (state === undefined || state.tick !== coopLastAppliedStateTick) {
    coopWarn(
      "resync",
      `authoritativeState reassert tick=${state?.tick ?? "absent"} rejected (latest accepted=${coopLastAppliedStateTick})`,
    );
    return false;
  }
  return applyCoopAuthoritativeBattleStateTransaction(state, authoritativeGuest, true);
}

interface CoopAuthoritativeApplyPlan {
  /** Deep-cloned wire image in this renderer's local side orientation. */
  readonly state: CoopAuthoritativeBattleStateV1;
  readonly playerParty: PokemonData[];
  readonly enemyParty: PokemonData[];
}

interface CoopAuthoritativeApplyPlanFailure {
  readonly section: string;
  readonly error: string;
  readonly monId?: number;
}

interface CoopAuthoritativeApplyBoundary {
  readonly rollbackState: CoopAuthoritativeBattleStateV1;
  readonly playerParty: Pokemon[];
  readonly enemyParty: Pokemon[];
  readonly playerModifiers: PersistentModifier[];
  readonly enemyModifiers: PersistentModifier[];
  readonly arena: typeof globalScene.arena;
  readonly battleFormat?: BattleFormat;
  readonly rndState: string;
  readonly stateTickCounter: number;
  readonly lastAppliedTick: number;
}

let coopAuthoritativeApplyTransactionActive = false;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateAuthoritativeMonData(data: PokemonData): CoopAuthoritativeApplyPlanFailure | null {
  const raw = data as unknown as Record<string, unknown>;
  if (!Number.isSafeInteger(data.id) || !isFiniteNumber(data.hp)) {
    return { section: "monData", monId: data.id, error: "invalid Pokemon identity or hp" };
  }
  for (const field of ["usedTMs", "stellarTypesBoosted", "ivs", "moveset"] as const) {
    if (raw[field] != null && !Array.isArray(raw[field])) {
      return { section: "monData", monId: data.id, error: `${field} must be an array` };
    }
  }
  if (Array.isArray(raw.stats) && raw.stats.some(value => !isFiniteNumber(value))) {
    return { section: "monData", monId: data.id, error: "stats must contain only finite numbers" };
  }
  if (Array.isArray(raw.ivs) && raw.ivs.some(value => !isFiniteNumber(value) || value < 0 || value > 31)) {
    return { section: "monData", monId: data.id, error: "ivs must contain only values from 0 through 31" };
  }
  if (
    Array.isArray(raw.moveset)
    && raw.moveset.some(
      move => move == null || typeof move !== "object" || !isFiniteNumber((move as Record<string, unknown>).moveId),
    )
  ) {
    return { section: "monData", monId: data.id, error: "moveset contains an invalid move" };
  }
  return null;
}

function validateAuthoritativeModifierBlobs(
  blobs: Record<string, unknown>[] | undefined,
  player: boolean,
): CoopAuthoritativeApplyPlanFailure | null {
  if (blobs === undefined) {
    return null;
  }
  if (!Array.isArray(blobs)) {
    return { section: player ? "playerModifiers" : "enemyModifiers", error: "modifier set must be an array" };
  }
  for (const raw of blobs) {
    if (raw == null || typeof raw !== "object") {
      return { section: player ? "playerModifiers" : "enemyModifiers", error: "invalid modifier blob" };
    }
    const keyed = rawModifierInstanceKey(raw, player);
    if (keyed == null) {
      return {
        section: player ? "playerModifiers" : "enemyModifiers",
        error: "modifier blob could not be decoded",
      };
    }
    try {
      const modifier = keyed.data.toModifier(
        Modifier[keyed.data.className as keyof typeof Modifier] ?? resolveErModifierClass(keyed.data.className),
      );
      if (!(modifier instanceof PersistentModifier)) {
        return {
          section: player ? "playerModifiers" : "enemyModifiers",
          error: `modifier ${keyed.data.className} is not persistent`,
        };
      }
    } catch (error) {
      return {
        section: player ? "playerModifiers" : "enemyModifiers",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return null;
}

function validateAuthoritativeStateEnvelope(
  state: CoopAuthoritativeBattleStateV1,
  playerParty: PokemonData[],
  enemyParty: PokemonData[],
): CoopAuthoritativeApplyPlanFailure | null {
  if (
    (state.tick !== undefined && (!Number.isSafeInteger(state.tick) || state.tick < 0))
    || !Number.isSafeInteger(state.wave)
    || state.wave < 0
    || !Number.isSafeInteger(state.turn)
    || state.turn < 0
  ) {
    return { section: "preflight", error: "invalid state address" };
  }
  for (const value of [state.weather, state.terrain, state.money, state.score ?? 0, state.biomeId ?? 0]) {
    if (!isFiniteNumber(value)) {
      return { section: "preflight", error: "authoritative scalar is not finite" };
    }
  }
  for (const mon of [...playerParty, ...enemyParty]) {
    const failure = validateAuthoritativeMonData(mon);
    if (failure != null) {
      return failure;
    }
  }
  if (!Array.isArray(state.field)) {
    return { section: "field", error: "field seats must be an array" };
  }
  const partyIds = {
    player: new Set(playerParty.map(mon => mon.id)),
    enemy: new Set(enemyParty.map(mon => mon.id)),
  };
  const seatKeys = new Set<string>();
  for (const seat of state.field) {
    if (seat == null || typeof seat !== "object") {
      return { section: "field", error: "field contains a non-object seat" };
    }
    const seatKey = `${seat.side}:${seat.bi}`;
    if (
      (seat.side !== "player" && seat.side !== "enemy")
      || !Number.isSafeInteger(seat.bi)
      || !Number.isSafeInteger(seat.partyIndex)
      || !Number.isSafeInteger(seat.pokemonId)
      || typeof seat.presented !== "boolean"
      || seatKeys.has(seatKey)
      || !partyIds[seat.side].has(seat.pokemonId)
    ) {
      return { section: "field", error: `invalid or duplicate authoritative seat ${seatKey}` };
    }
    seatKeys.add(seatKey);
  }
  if (
    state.pokeballCounts != null
    && (!Array.isArray(state.pokeballCounts)
      || state.pokeballCounts.some(
        entry =>
          !Array.isArray(entry)
          || entry.length !== 2
          || !Number.isSafeInteger(entry[0])
          || !Number.isSafeInteger(entry[1]),
      ))
  ) {
    return { section: "pokeballCounts", error: "invalid pokeball count tuple" };
  }
  if (
    state.arenaTags != null
    && (!Array.isArray(state.arenaTags)
      || state.arenaTags.some(
        tag =>
          tag == null
          || typeof tag.tagType !== "string"
          || !isFiniteNumber(tag.side)
          || !isFiniteNumber(tag.turnCount)
          || !isFiniteNumber(tag.layers),
      ))
  ) {
    return { section: "arenaTags", error: "invalid arena tag" };
  }
  return (
    validateAuthoritativeModifierBlobs(state.playerModifiers, true)
    ?? validateAuthoritativeModifierBlobs(state.enemyModifiers, false)
  );
}

function prepareCoopAuthoritativeApplyPlan(
  source: CoopAuthoritativeBattleStateV1,
  stateAlreadyLocal: boolean,
): { plan?: CoopAuthoritativeApplyPlan; failure?: CoopAuthoritativeApplyPlanFailure } {
  let state: CoopAuthoritativeBattleStateV1;
  try {
    // A carrier is immutable once admitted. Cloning through its real JSON encoding prevents a callback or
    // retry owner from changing fields underneath this synchronous transaction and rejects non-wire values.
    state = JSON.parse(JSON.stringify(source)) as CoopAuthoritativeBattleStateV1;
  } catch (error) {
    return { failure: { section: "preflight", error: error instanceof Error ? error.message : String(error) } };
  }
  try {
    if (state.version !== 1) {
      return { failure: { section: "preflight", error: "unsupported authoritative state version" } };
    }
    if (!stateAlreadyLocal && isShowdownGuestFlipGated()) {
      state = swapAuthoritativeState(state);
    }
    const playerParty = parseAuthoritativeParty(state.playerParty);
    const enemyParty = parseAuthoritativeParty(state.enemyParty);
    if (playerParty == null || enemyParty == null) {
      return { failure: { section: "preflight", error: "party payload could not be decoded" } };
    }
    if (!assertNoDuplicateAuthoritativeIds([state.playerParty, state.enemyParty])) {
      return { failure: { section: "preflight", error: "party contains a duplicate identity" } };
    }
    const failure = validateAuthoritativeStateEnvelope(state, playerParty, enemyParty);
    return failure == null ? { plan: { state, playerParty, enemyParty } } : { failure };
  } catch (error) {
    return { failure: { section: "preflight", error: error instanceof Error ? error.message : String(error) } };
  }
}

function captureCoopAuthoritativeApplyBoundary(): CoopAuthoritativeApplyBoundary | null {
  const stateTickCounter = coopStateTickCounter;
  const lastAppliedTick = coopLastAppliedStateTick;
  const rndState = Phaser.Math.RND.state();
  const rollbackState = captureCoopAuthoritativeBattleState(globalScene.currentBattle?.turn ?? 0);
  // Capturing a receiver boundary is observational: neither authority sequencing nor RNG may move.
  coopStateTickCounter = stateTickCounter;
  coopLastAppliedStateTick = lastAppliedTick;
  Phaser.Math.RND.state(rndState);
  if (rollbackState == null) {
    return null;
  }
  return {
    rollbackState,
    playerParty: [...(globalScene.getPlayerParty() as Pokemon[])],
    enemyParty: [...(globalScene.getEnemyParty() as Pokemon[])],
    playerModifiers: [...globalScene.modifiers],
    enemyModifiers: [...(globalScene as unknown as { enemyModifiers: PersistentModifier[] }).enemyModifiers],
    arena: globalScene.arena,
    battleFormat: globalScene.currentBattle?.format,
    rndState,
    stateTickCounter,
    lastAppliedTick,
  };
}

function discardCandidatePokemon(pokemon: Pokemon): void {
  try {
    globalScene.field.remove(pokemon, true);
    pokemon.destroy();
  } catch {
    /* candidate-only object cleanup cannot alter the restored material boundary */
  }
}

function restoreCoopAuthoritativeApplyTopology(
  boundary: CoopAuthoritativeApplyBoundary,
  mutationScope: CoopAuthoritativeApplyMutationScope,
): void {
  for (const pokemon of mutationScope.createdPokemon) {
    discardCandidatePokemon(pokemon);
  }
  (globalScene.getPlayerParty() as Pokemon[]).splice(0, globalScene.getPlayerParty().length, ...boundary.playerParty);
  (globalScene.getEnemyParty() as Pokemon[]).splice(0, globalScene.getEnemyParty().length, ...boundary.enemyParty);
  globalScene.modifiers.splice(0, globalScene.modifiers.length, ...boundary.playerModifiers);
  const enemyModifiers = (globalScene as unknown as { enemyModifiers: PersistentModifier[] }).enemyModifiers;
  enemyModifiers.splice(0, enemyModifiers.length, ...boundary.enemyModifiers);
  globalScene.arena = boundary.arena;
  if (boundary.battleFormat != null) {
    globalScene.currentBattle?.setFormat(boundary.battleFormat);
  }
  Phaser.Math.RND.state(boundary.rndState);
}

function commitCoopAuthoritativeApplyPresentation(mutationScope: CoopAuthoritativeApplyMutationScope): void {
  const presentation = mutationScope.fieldPresentation;
  if (presentation == null) {
    return;
  }
  try {
    settleCoopFieldPresentation({
      side: "player",
      seats: presentation.playerSeats,
      capacity: presentation.playerCapacity,
      boundary: presentation.playerSeats.length > 0 ? "resync-stable" : "wave-start-pre-intro",
      desired: "visible",
      hideStale: true,
    });
    settleCoopFieldPresentation({
      side: "enemy",
      seats: presentation.enemySeats,
      capacity: presentation.enemyCapacity,
      boundary: presentation.enemySeats.length > 0 ? "resync-stable" : "wave-start-pre-intro",
      desired: "visible",
      hideStale: true,
    });
    if (mutationScope.preSpriteKeys != null) {
      runCoopRenderDiffer(mutationScope.preSpriteKeys);
    }
  } catch (error) {
    // Material state is already complete. Presentation has its own continuation-ready gate and bounded
    // recovery, so a torn-down renderer is reported there rather than invalidating committed battle data.
    coopWarn("resync", "authoritative presentation commit deferred to renderer recovery", error);
  }
}

function commitCoopAuthoritativeApplyCleanup(mutationScope: CoopAuthoritativeApplyMutationScope): void {
  const retired = new Set(mutationScope.retiredPokemon.map(entry => entry.pokemon));
  for (const pokemon of retired) {
    try {
      if (pokemon.isOnField()) {
        pokemon.leaveField(true, true, false);
      }
      globalScene.field.remove(pokemon, true);
      pokemon.destroy();
    } catch {
      /* the committed party no longer addresses this quarantined stale object */
    }
  }
}

/**
 * Apply one immutable wire image as a DATA transaction. The receiver first captures its current
 * material state without advancing the producer tick, then either commits the complete candidate or
 * restores that image and the prior admission high-water. Structured per-section failures count as a
 * failed transaction too: a checksum cannot make a partly-applied un-hashed field safe.
 */
function applyCoopAuthoritativeBattleStateTransaction(
  state: CoopAuthoritativeBattleStateV1 | undefined,
  authoritativeGuest: boolean,
  reassertAccepted: boolean,
): boolean {
  if (coopAuthoritativeApplyTransactionActive) {
    recordCoopApplyFailure("transactionReentry", new Error("nested authoritative state apply rejected"));
    return false;
  }
  coopAuthoritativeApplyTransactionActive = true;
  beginCoopApplyFailureCapture();
  const preflightRndState = Phaser.Math.RND.state();
  try {
    if (state === undefined || state.version !== 1) {
      return false;
    }
    const prepared = prepareCoopAuthoritativeApplyPlan(state, false);
    // Modifier constructors used by shadow validation are not allowed to consume the live battle cursor.
    Phaser.Math.RND.state(preflightRndState);
    if (prepared.plan == null) {
      const failure = prepared.failure ?? { section: "preflight", error: "unknown validation failure" };
      recordCoopApplyFailure(failure.section, new Error(failure.error), failure.monId);
      return false;
    }
    const plan = prepared.plan;
    if (!reassertAccepted && plan.state.tick !== undefined && plan.state.tick <= coopLastAppliedStateTick) {
      coopWarn(
        "resync",
        `authoritativeState tick=${plan.state.tick} STALE (lastApplied=${coopLastAppliedStateTick}) -> REJECTED (#807)`,
      );
      return false;
    }

    const boundary = captureCoopAuthoritativeApplyBoundary();
    if (boundary == null) {
      recordCoopApplyFailure("rollbackCapture", new Error("could not capture the pre-apply material state"));
      return false;
    }
    const mutationScope: CoopAuthoritativeApplyMutationScope = { createdPokemon: [], retiredPokemon: [] };
    const applied = applyCoopAuthoritativeBattleStateInternal(
      plan.state,
      authoritativeGuest,
      reassertAccepted,
      true,
      mutationScope,
      plan,
    );
    const candidateFailures = [...coopApplyFailures];
    if (applied && candidateFailures.length === 0) {
      commitCoopAuthoritativeApplyPresentation(mutationScope);
      commitCoopAuthoritativeApplyCleanup(mutationScope);
      coopStateTickCounter = boundary.stateTickCounter;
      if (!reassertAccepted && plan.state.tick !== undefined) {
        // Admission is the COMMIT marker. A failed apply can therefore never expose or consume this tick.
        coopLastAppliedStateTick = plan.state.tick;
      }
      return true;
    }

    // Restore exact identity topology before replaying the trusted immutable material image. In particular,
    // candidate-only Pokemon are discarded, prior Pokemon/modifier objects are reinserted, the old Arena
    // object is reinstated, and the process-global RNG cursor is put back. No destructive cleanup has run.
    restoreCoopAuthoritativeApplyTopology(boundary, mutationScope);
    const rollbackPrepared = prepareCoopAuthoritativeApplyPlan(boundary.rollbackState, true);
    Phaser.Math.RND.state(boundary.rndState);
    let rollbackApplied = false;
    let rollbackFailures: CoopApplyFailure[] = [];
    if (rollbackPrepared.plan != null) {
      rollbackApplied = applyCoopAuthoritativeBattleStateInternal(
        rollbackPrepared.plan.state,
        authoritativeGuest,
        true,
        true,
        undefined,
        rollbackPrepared.plan,
      );
      rollbackFailures = [...coopApplyFailures];
    } else if (rollbackPrepared.failure != null) {
      rollbackFailures = [rollbackPrepared.failure];
    }
    coopStateTickCounter = boundary.stateTickCounter;
    coopLastAppliedStateTick = boundary.lastAppliedTick;
    Phaser.Math.RND.state(boundary.rndState);
    coopApplyFailures = candidateFailures;
    if (!rollbackApplied || rollbackFailures.length > 0) {
      recordCoopApplyFailure(
        "rollback",
        new Error(
          rollbackApplied
            ? `rollback reported ${rollbackFailures.length} structured failure(s)`
            : "rollback materialization refused",
        ),
      );
    }
    return false;
  } finally {
    coopAuthoritativeApplyTransactionActive = false;
  }
}

function applyCoopAuthoritativeBattleStateInternal(
  state: CoopAuthoritativeBattleStateV1 | undefined,
  authoritativeGuest: boolean,
  reassertAccepted: boolean,
  stateAlreadyLocal = false,
  mutationScope?: CoopAuthoritativeApplyMutationScope,
  preparedPlan?: CoopAuthoritativeApplyPlan,
): boolean {
  // Reset the structured-failure accumulator FIRST (item 4): a prior apply's failures must never leak into
  // this one's drain, and an early reject below leaves it empty (no apply attempted -> nothing to heal).
  beginCoopApplyFailureCapture();
  if (state === undefined) {
    return false;
  }
  if (state.version !== 1) {
    return false;
  }
  // SHOWDOWN (Task F1): the versus guest holds its world in LOCAL orientation (own team = local player
  // side). Reflect the host's authoritative state into that orientation HERE - the single canonical
  // id-keyed apply that turnResolution / battleCheckpoint / waveEndState / stateSync-snapshot all funnel
  // through, so the swap fires exactly ONCE per payload regardless of the carrier. The swap runs at APPLY
  // time (always the guest's own context), not at wire-receive (which, in the shared-process duo harness,
  // can be the host's context). No-op for solo/co-op/host (versus-guest-only gate).
  if (!stateAlreadyLocal && isShowdownGuestFlipGated()) {
    state = swapAuthoritativeState(state);
  }
  try {
    const playerParty = preparedPlan?.playerParty ?? parseAuthoritativeParty(state.playerParty);
    const enemyParty = preparedPlan?.enemyParty ?? parseAuthoritativeParty(state.enemyParty);
    if (playerParty == null || enemyParty == null) {
      return false;
    }
    if (!assertNoDuplicateAuthoritativeIds([state.playerParty, state.enemyParty])) {
      return false;
    }
    // PHASE 3 (#838): snapshot the on-field sprite keys BEFORE the data apply mutates species/form/
    // shiny/etc., so the render differ below re-summons ONLY on an actual visual-identity change.
    const preSpriteKeys = captureCoopOnFieldSpriteKeys();
    // The classic finale starts single and expands to double in phase two. Party/field
    // reconciliation cannot seat slot 1 while the renderer still has a one-slot arrangement,
    // leaving the host permanently waiting for the guest-owned command. Geometry must land first.
    // Optional preserves additive compatibility with already-buffered older frames.
    if (typeof state.double === "boolean" && globalScene.currentBattle?.double !== state.double) {
      globalScene.currentBattle?.setDouble(state.double);
    }
    if (typeof state.biomeId === "number" && (globalScene.arena?.biomeId ?? -1) !== state.biomeId) {
      globalScene.newArena(state.biomeId as BiomeId);
    }
    reconcileAuthoritativeParty("player", playerParty, authoritativeGuest, mutationScope);
    reconcileAuthoritativeParty("enemy", enemyParty, authoritativeGuest, mutationScope);
    reconcileAuthoritativeField(state, playerParty, enemyParty, mutationScope);
    reassertAuthoritativePartyOrder("player", playerParty);
    reassertAuthoritativePartyOrder("enemy", enemyParty);
    const arena = globalScene.arena;
    if ((arena.weather?.weatherType ?? 0) !== state.weather) {
      arena.trySetWeather(state.weather as WeatherType);
    }
    if ((arena.terrain?.terrainType ?? 0) !== state.terrain) {
      arena.trySetTerrain(state.terrain as TerrainType, true);
    }
    reconcileArenaTags(state.arenaTags, true);
    globalScene.money = state.money;
    if (typeof state.score === "number") {
      globalScene.score = state.score;
    }
    for (const [type, count] of state.pokeballCounts ?? []) {
      if (typeof type === "number" && typeof count === "number") {
        globalScene.pokeballCounts[type] = Math.max(0, Math.trunc(count));
      }
    }
    reconcileAuthoritativeModifiers(state.playerModifiers, true);
    reconcileAuthoritativeModifiers(state.enemyModifiers, false);
    if (typeof state.seed === "string" && state.seed.length > 0) {
      globalScene.setSeed(state.seed);
    }
    if (typeof state.waveSeed === "string" && state.waveSeed.length > 0) {
      globalScene.waveSeed = state.waveSeed;
      Phaser.Math.RND.sow([state.waveSeed]);
    }
    restoreCoopModuleLetSubstrates(state);
    // Refresh both held-item bars before the final stat authority. Despite being a render entrypoint,
    // updateModifiers also reapplies stat-bearing modifiers (HP Up included), so running it afterward would
    // silently overwrite the explicit host stats on fainted slots and recreate a 40/42 checksum split.
    try {
      globalScene.updateModifiers(true, true);
      globalScene.updateModifiers(false, true);
    } catch (error) {
      // updateModifiers is also a material stat application entrypoint. Committing around a failed call can
      // leave HP/max-HP inconsistent even when its icon refresh was the visible symptom.
      recordCoopApplyFailure("modifierRefresh", error);
    }
    // Field reconciliation, modifier reconciliation, and ER substrate restoration can all recalculate
    // derived stats after the party-data apply. Reassert the host's explicit arrays at the TRUE completed
    // data boundary so fainted/off-field slots remain checksum-identical too. Party reconciliation has made
    // live order authoritative, which is stable even for an older payload whose local runtime id differed.
    for (const [liveParty, hostParty] of [
      [globalScene.getPlayerParty() as Pokemon[], playerParty],
      [globalScene.getEnemyParty() as Pokemon[], enemyParty],
    ] as const) {
      for (const [index, mon] of liveParty.entries()) {
        const hostData = hostParty[index];
        if (hostData != null && Array.isArray(hostData.stats) && hostData.stats.length > 0) {
          mon.stats = [...hostData.stats];
          mon.hp = Math.max(0, Math.min(Math.trunc(hostData.hp), mon.getMaxHp()));
        }
        // Seating a newly streamed ME enemy runs fieldSetup after the first PokemonData apply. That setup
        // legitimately initializes a local entry, but it also clears post-move boosts already resolved by
        // the host in this turn (Teleporting Hijinks exposed +1 DEF/SpAtk/SpDef becoming zero). Restore the
        // host stages at the same final boundary as derived stats; the guest never derives entry effects.
        if (hostData != null && Array.isArray(hostData.summonData?.statStages)) {
          mon.summonData.statStages = [...hostData.summonData.statStages];
        }
      }
    }
    // PHASE 3 (#838): reconcile the RENDER to the freshly-applied DATA over every on-field mon -
    // unconditional cheap refresh (battle-info bars, status badge, boss segments, both held-item bars)
    // + a sprite-key-gated re-summon. Runs LAST so it sees the final field composition + modifier state.
    // Presentation is an irreversible/asynchronous effect and therefore belongs only to a materially clean
    // candidate (or the trusted rollback image). A structured failure must not queue candidate atlas work
    // that can race the restored prior boundary after this synchronous function returns.
    if (coopApplyFailures.length === 0 && mutationScope != null) {
      mutationScope.preSpriteKeys = preSpriteKeys;
    } else if (coopApplyFailures.length === 0) {
      runCoopRenderDiffer(preSpriteKeys);
    }
    coopLog(
      "resync",
      `guest ${reassertAccepted ? "reassert" : "apply"} authoritativeState tick=${state.tick} wave=${state.wave} turn=${state.turn} party=${state.playerParty.length}/${state.enemyParty.length} field=${state.field.length}`,
    );
    return true;
  } catch (e) {
    // A whole-apply throw (past the early structural rejects) is the loudest failure class: record it so the
    // caller heals even if it somehow returned a stale-but-matching checksum. Return false as before.
    recordCoopApplyFailure("apply", e);
    return false;
  }
}

/** Reconcile a live mon's battler tags to exactly the snapshot's tag-type set. */
function reconcileTags(mon: Pokemon, wantTagTypes: string[]): void {
  try {
    const want = new Set(wantTagTypes);
    const have = new Set(mon.summonData.tags.map(t => t.tagType as unknown as string));
    // Drop tags the host no longer has.
    for (const have_t of [...have]) {
      if (!want.has(have_t)) {
        mon.removeTag(have_t as unknown as BattlerTagType);
      }
    }
    // Add tags the host has that we don't (best-effort: identity only, no source-move).
    for (const want_t of want) {
      if (!have.has(want_t)) {
        mon.addTag(want_t as unknown as BattlerTagType);
      }
    }
  } catch {
    /* tag reconciliation is best-effort; never break the heal */
  }
}

/**
 * GUEST: rebuild a mon's moveset from the host's move IDs when they STRUCTURALLY differ (#633
 * GAP 7), preserving the host's ppUsed per slot. Mirrors how {@linkcode applyCoopEnemies} rebuilds
 * an enemy moveset. A pure ppUsed-only divergence is left to the per-slot align below (no rebuild).
 * Returns true when it rebuilt (so the caller skips the per-slot ppUsed align). Fully guarded.
 */
function rebuildMovesetIfStructurallyDiverged(mon: Pokemon, snapMoves: [number, number][]): boolean {
  try {
    const localIds = mon.getMoveset().map(m => m.moveId);
    const hostIds = snapMoves.map(([id]) => id).filter(id => typeof id === "number" && id > 0);
    if (hostIds.length === 0) {
      return false;
    }
    const sameStructure = localIds.length === hostIds.length && localIds.every((id, i) => id === hostIds[i]);
    if (sameStructure) {
      return false;
    }
    // Move IDs differ - rebuild from the host's list (not just align PP), then set each ppUsed.
    mon.moveset = snapMoves
      .filter(([id]) => typeof id === "number" && id > 0)
      .map(([id, ppUsed]) => {
        const pm = new PokemonMove(id);
        pm.ppUsed = Math.max(0, Math.trunc(ppUsed ?? 0));
        return pm;
      });
    return true;
  } catch {
    return false;
  }
}

/**
 * GUEST (#836/#837): apply the host's TRANSFORM / Imposter copied identity onto a live mon so the
 * pure-renderer guest converges its sprite/species/moveset/types/ability/stats. Mirrors exactly what
 * the host's {@linkcode PokemonTransformPhase} writes into `summonData` (speciesForm / moveset / types
 * / ability / gender / stats). `null` = the host mon is NOT transformed: CLEAR a stale guest transform.
 * `undefined` = older host omitted the field: leave the guest's transform state alone. Only re-loads the
 * sprite (async, best-effort) when the transform identity actually CHANGED, so a steady transform is a
 * cheap no-op each turn. Fully guarded so a bad payload never breaks the guest's turn.
 */
function applyMonTransform(mon: Pokemon, transform: CoopMonTransform | null | undefined): void {
  if (transform === undefined) {
    return;
  }
  try {
    const sd = mon.summonData;
    if (sd == null) {
      return;
    }
    if (transform === null) {
      if (sd.speciesForm != null) {
        coopWarn("heal", `transform bi=${mon.getBattlerIndex()} host=none guest=transformed -> cleared (#836)`);
        sd.speciesForm = null;
        sd.moveset = null;
        sd.types = [];
        sd.stats = [0, 0, 0, 0, 0, 0];
        void mon
          .loadAssets(false)
          .then(() => mon.updateInfo())
          .catch(() => {});
      }
      return;
    }
    const already =
      sd.speciesForm != null
      && sd.speciesForm.speciesId === transform.speciesId
      && sd.speciesForm.formIndex === transform.formIndex;
    sd.speciesForm = getPokemonSpeciesForm(
      transform.speciesId as unknown as Parameters<typeof getPokemonSpeciesForm>[0],
      transform.formIndex,
    );
    sd.moveset = transform.moves
      .filter(([id]) => typeof id === "number" && id > 0)
      .map(([id, ppUsed]) => {
        const pm = new PokemonMove(id as unknown as MoveId);
        pm.ppUsed = Math.max(0, Math.trunc(ppUsed ?? 0));
        return pm;
      });
    sd.types = transform.types.map(t => t as unknown as (typeof sd.types)[number]);
    if (transform.ability) {
      sd.ability = transform.ability as unknown as AbilityId;
    }
    if (transform.gender >= 0) {
      sd.gender = transform.gender as unknown as Gender;
    }
    for (let i = 0; i < transform.stats.length && i < sd.stats.length; i++) {
      if (typeof transform.stats[i] === "number") {
        sd.stats[i] = transform.stats[i];
      }
    }
    if (!already) {
      coopWarn(
        "heal",
        `transform bi=${mon.getBattlerIndex()} host=sp${transform.speciesId}/form${transform.formIndex} -> applied (#836)`,
      );
      void mon
        .loadAssets(false)
        .then(() => {
          // Guarded: a headless/torn-down sprite (no anim target) must not reject the fire-and-forget heal.
          try {
            mon.playAnim();
          } catch {
            /* sprite anim unavailable (headless / mid-teardown) - the data model is already correct */
          }
          mon.updateInfo();
        })
        .catch(() => {});
    }
  } catch {
    // A malformed transform payload must never crash the guest's battle.
  }
}

/**
 * Apply ONE full mon snapshot onto a live mon (ability/form/tera/level FIRST, then stats, then hp,
 * then boss). `authoritativeGuest` (#633): the {@linkcode isCoopAuthoritativeGuest} gate result,
 * computed by the cycle-free caller (the engine must NOT import the runtime - that would create an
 * import cycle) and threaded down; the level/exp + boss re-assert branches fire ONLY when true, so
 * solo / host / lockstep stay byte-identical. `suppressResummon` (#633, MINOR-1): when a divergence
 * has failed to heal twice in a row on the same dimensions, skip the heavy boss bar rebuild (keep the
 * cheap scalar writes) so an unclosable boss divergence degrades to a static wrong-bar instead of a
 * per-turn re-render storm.
 */
function applyFullMon(
  mon: Pokemon,
  snap: CoopFullMonSnapshot,
  authoritativeGuest: boolean,
  suppressResummon = false,
): void {
  try {
    // Authoritative level + exp (#633, B): the guest is a pure renderer; adopt the host's level/exp
    // so the stat recompute below uses the authoritative base (closes maxHp at ROOT, not just masked
    // by the setStat force below). Forced TOGETHER + ONLY when level differs: `levelExp` is a derived
    // getter (exp - getLevelTotalExp(level)), so setting both consistent values keeps it consistent
    // and the guest never independently levels (it runs no ExpPhase, so no spurious LevelUpPhase).
    if (authoritativeGuest && typeof snap.level === "number" && snap.level > 0 && mon.level !== snap.level) {
      coopWarn("resync", `level force bi=${snap.bi} host=${snap.level} guest=${mon.level}`);
      mon.level = snap.level;
      if (typeof snap.exp === "number") {
        mon.exp = snap.exp;
      }
    }
    // Ability / form first so a stat recompute uses the authoritative values.
    if (mon.formIndex !== snap.formIndex) {
      coopWarn("heal", `formIndex bi=${snap.bi} host=${snap.formIndex} guest=${mon.formIndex} -> applied`);
      mon.formIndex = snap.formIndex;
    }
    // Active ability: if the host's authoritative active ability differs from what this
    // mon currently resolves, pin it via the summon-data override slot so getAbility()
    // returns the host's value exactly (0 = unreadable on the host -> leave ours alone).
    if (snap.abilityId !== 0 && mon.getAbility().id !== snap.abilityId) {
      coopWarn("heal", `abilityId bi=${snap.bi} host=${snap.abilityId} guest=${mon.getAbility().id} -> applied`);
      mon.summonData.ability = snap.abilityId as AbilityId;
    }
    // Tera state (#633 GAP 7): force the host's authoritative Tera state so a dropped/extra Tera
    // command heals (it changes the mon's type/STAB, which the per-turn checkpoint can't carry).
    // Set BEFORE calculateStats so a tera-driven stat path uses the authoritative flag.
    if (snap.isTerastallized !== undefined) {
      if (mon.isTerastallized !== snap.isTerastallized) {
        coopWarn(
          "heal",
          `tera bi=${snap.bi} host=${snap.isTerastallized ? 1 : 0} guest=${mon.isTerastallized ? 1 : 0} -> applied`,
        );
      }
      mon.isTerastallized = snap.isTerastallized;
    }
    if (snap.teraType !== undefined) {
      if ((mon.teraType as unknown as number) !== snap.teraType) {
        coopWarn("heal", `teraType bi=${snap.bi} host=${snap.teraType} guest=${mon.teraType} -> applied`);
      }
      mon.teraType = snap.teraType as unknown as Pokemon["teraType"];
    }
    // Transform / Imposter (#836/#837): apply the host's copied summonData identity BEFORE the moveset
    // heal below (a transformed mon's getMoveset() returns summonData.moveset, which this sets, so the
    // moveset heal then only aligns PP on the transformed set). Gated authoritative: the pure-renderer
    // guest converges the copied sprite/species/types/ability/stats; solo/host/lockstep compute it
    // themselves and skip. undefined (older host) is a no-op.
    if (authoritativeGuest) {
      applyMonTransform(mon, snap.transform);
    }
    // Moveset: REBUILD from the host's move IDs when they structurally differ (#633 GAP 7); else
    // only align ppUsed per slot (the lockstep-identical common case).
    const rebuilt = rebuildMovesetIfStructurallyDiverged(mon, snap.moves);
    if (!rebuilt) {
      const moveset = mon.getMoveset();
      for (let i = 0; i < moveset.length && i < snap.moves.length; i++) {
        const [, ppUsed] = snap.moves[i];
        if (moveset[i] != null && typeof ppUsed === "number") {
          moveset[i].ppUsed = Math.max(0, ppUsed);
        }
      }
    }
    reconcileTags(mon, snap.tags);
    // On-field held-item heal (#633 RISKY #1/#2/#3): set the live mon's held items to exactly the host's
    // snapshot set BEFORE calculateStats so a stat-affecting item (e.g. Eviolite) is present for the
    // recompute. Gated authoritative (solo / host / lockstep never run it); the per-mon bar refresh is
    // deferred to ONE updateModifiers call after the field loop in applyCoopFullSnapshot (C4).
    if (authoritativeGuest && snap.heldItems !== undefined) {
      const heldChanged = applyCoopHeldItemsForMon(mon, snap.heldItems);
      if (heldChanged) {
        const hostTypeIds = Array.isArray(snap.heldItems)
          ? snap.heldItems
              .map(h => (h != null && typeof h === "object" ? (h as Record<string, unknown>).typeId : undefined))
              .filter((t): t is string => typeof t === "string")
          : [];
        coopWarn("heal", `heldItems bi=${snap.bi} host=[${hostTypeIds.join(",")}] -> applied (rewrote to host set)`);
      }
    }
    mon.calculateStats();
    // maxHp force (#633 GAP 3): the checkpoint clamps hp to the LOCAL getMaxHp(); if maxHp itself
    // diverged (IV / level / form / stat-calc mismatch) hp clamps to the wrong ceiling and the
    // snapshot only setting hp leaves a permanent loop. After the recompute, if our maxHp still
    // differs from the host's, FORCE the HP stat to the host value so getMaxHp() matches and hp
    // clamps correctly. A loud warn surfaces the UPSTREAM stat divergence for a later root-cause fix
    // (forcing maxHp stops the loop but MASKS the real cause; the log makes it findable).
    if (typeof snap.maxHp === "number" && snap.maxHp > 0 && mon.getMaxHp() !== Math.trunc(snap.maxHp)) {
      coopWarn("resync", `maxhp divergence bi=${snap.bi} host=${Math.trunc(snap.maxHp)} guest=${mon.getMaxHp()}`);
      mon.setStat(Stat.HP, Math.trunc(snap.maxHp));
    }
    // Status.
    const prevStatus = mon.status?.effect ?? 0;
    if (prevStatus !== (snap.status ?? 0)) {
      coopWarn("heal", `status bi=${snap.bi} host=${snap.status ?? 0} guest=${prevStatus} -> applied`);
    }
    mon.status = snap.status ? new Status(snap.status as StatusEffect) : null;
    // Stat stages (7).
    const stages = mon.getStatStages();
    if (isCoopDebug()) {
      const wantStages = Array.from({ length: 7 }, (_, i) =>
        Math.max(-6, Math.min(6, Math.trunc(snap.statStages[i] ?? 0))),
      );
      const prevStages = [...stages].slice(0, 7);
      if (wantStages.some((v, i) => v !== prevStages[i])) {
        coopWarn(
          "heal",
          `statStages bi=${snap.bi} host=[${wantStages.join(",")}] guest=[${prevStages.join(",")}] -> applied`,
        );
      }
    }
    for (let i = 0; i < 7 && i < stages.length; i++) {
      stages[i] = Math.max(-6, Math.min(6, Math.trunc(snap.statStages[i] ?? 0)));
    }
    // HP last, clamped to the (now host-forced) max.
    const prevHp = mon.hp;
    const wantHp = Math.max(0, Math.min(Math.trunc(snap.hp), mon.getMaxHp()));
    if (prevHp !== wantHp) {
      coopWarn("heal", `hp bi=${snap.bi} host=${wantHp} guest=${prevHp} (maxHp=${mon.getMaxHp()}) -> applied`);
    }
    mon.hp = wantHp;
    // Boss re-assert (#633, A/BLOCKING-2), AFTER hp so the index derives from the correct hp. The host
    // decrements bossSegmentIndex as shields break, but the guest sets hp by direct assignment (never
    // via damage()), so its index would freeze and the dividers render wrong + the dimension loops
    // forever. Re-assert the EXPLICIT host segment COUNT (never the diverged-RNG getEncounterBossSegments
    // fallback), then DERIVE the index from the now-correct hp via getBossSegmentIndex() so the boss
    // dimension STOPS diverging each apply instead of looping. Gated authoritative; enemy-only.
    if (authoritativeGuest && mon instanceof EnemyPokemon && typeof snap.bossSegments === "number") {
      const want = snap.bossSegments;
      // A freshly reconstructed guest EnemyPokemon (addEnemyPokemon) leaves `bossSegments`
      // UNDEFINED until setBoss runs, while the host serializes 0 for a non-boss - so a bare
      // `!==` logs a false "boss divergence" every turn for every ordinary enemy (live seed
      // EW0gvphu5Ps8dmWDaUKqgr8x). Coalesce undefined->0 so only a REAL count divergence warns;
      // setBoss below still runs idempotently either way.
      if ((mon.bossSegments ?? 0) !== want) {
        coopWarn(
          "resync",
          `boss divergence bi=${snap.bi} host.segments=${want} guest.segments=${mon.bossSegments ?? 0}`,
        );
      }
      mon.setBoss(want > 0, want > 0 ? want : undefined);
      if (want > 0) {
        // Derive the index from hp (self-correcting), not the host's raw index (which can lag a turn).
        mon.bossSegmentIndex = mon.getBossSegmentIndex();
        // Re-render the segmented bar UNLESS we're in give-up mode (a persistent divergence shouldn't
        // re-render every turn). initBattleInfo() on an existing bar dispatches to updateBossSegments.
        if (!suppressResummon) {
          mon.initBattleInfo();
        }
      }
    }
    void mon.updateInfo();
  } catch (error) {
    // A rich field companion is part of the modern authority transaction. Surface a per-mon failure to
    // the finalize/replacement boundary so it cannot open control on a merely half-applied frame.
    recordCoopApplyFailure("fullMon", error, mon.id);
  }
}

/**
 * GUEST: reconcile player persistent-modifier STACK COUNTS to the host's (#633 GAP 2). A
 * relic / persistent-modifier stack-count divergence is hashed (`[typeId, stackCount]`), so it
 * is a permanent `still-diverged` resync-loop the per-turn checkpoint can't fix. This heals the
 * SAFE subset mid-battle:
 *  - For each non-held-item player persistent modifier (relics, EXP charms, lures, candy jar, ...),
 *    match by `type.id` to the host's `[typeId, stackCount]` and SET our `stackCount` to the host's.
 *    Persistent-modifier effects read `stackCount` at apply time (they don't accumulate on a set),
 *    so a direct set is side-effect-free - it never double-applies an effect.
 *  - REMOVE a non-held modifier the host no longer has (stackCount 0 / absent typeId).
 *
 * INTENTIONALLY skips `PokemonHeldItemModifier`s: they are `pokemonId`-bound and the snapshot's
 * aggregate `[typeId, stackCount]` carries NO pokemonId, so a mid-battle re-bind would corrupt the
 * binding. On-field per-mon held items are now healed separately + precisely by
 * {@linkcode applyCoopHeldItemsForMon} (#633 RISKY #1/#2/#3, keyed by battler index, not the aggregate
 * count); BENCH held-item structure still converges at the wave boundary via the enemy/party adopt. Here
 * we only touch the count-only global modifiers that the GAP-2 divergence is actually about. Does NOT
 * ADD a brand-new global modifier mid-battle (rebuilding a generator-typed modifier from a bare
 * typeId can need pregen RNG); a genuinely-missing global modifier is a wave-boundary adopt. After
 * any change, `updateModifiers` refreshes the bar. Fully guarded.
 */
export function reconcileCoopModifierStacks(hostModifiers: [string, number][] | undefined): void {
  if (hostModifiers == null) {
    return;
  }
  try {
    // Host stack count per typeId (the snapshot pre-sorts; an item may appear once with its count).
    const wantByType = new Map<string, number>();
    for (const [typeId, stackCount] of hostModifiers) {
      if (typeof typeId === "string") {
        wantByType.set(typeId, Math.max(0, Math.trunc(stackCount)));
      }
    }
    let changed = false;
    // Iterate a snapshot of the player modifier list (a removal mutates it).
    for (const modifier of [...globalScene.modifiers]) {
      // Held items are pokemonId-bound - never reconcile them from the aggregate count here.
      if (modifier instanceof PokemonHeldItemModifier || !(modifier instanceof PersistentModifier)) {
        continue;
      }
      const want = wantByType.get(modifier.type.id);
      if (want === undefined || want <= 0) {
        coopWarn(
          "heal",
          `modifier REMOVE typeId=${modifier.type.id} host=0/absent guest.stack=${modifier.stackCount} -> removed`,
        );
        // The host no longer has this global modifier -> drop it (count-only, side-effect-free).
        if (globalScene.removeModifier(modifier)) {
          changed = true;
        }
        continue;
      }
      if (modifier.stackCount !== want) {
        coopWarn(
          "heal",
          `modifier stack typeId=${modifier.type.id} host=${want} guest=${modifier.stackCount} -> applied`,
        );
        modifier.stackCount = want;
        changed = true;
      }
    }
    if (changed) {
      globalScene.updateModifiers(true);
    }
  } catch {
    // A malformed modifier list must never crash the guest's battle.
  }
}

/**
 * GUEST (authoritative resync): reconcile the player-wide PERSISTENT modifiers to the host's FULL blob
 * set (#698 / #633 BUG 2). The stack-only {@linkcode reconcileCoopModifierStacks} can fix a stack count
 * or remove an extra, but it can NEVER CREATE a host modifier the guest is missing - so a host-only
 * player-wide modifier (`TEMP_STAT_STAGE_BOOSTER`, `SUPER_EXP_CHARM`, ...) that needs args to rebuild
 * stayed permanently `<absent>` on the guest, diverging the checksum every turn. This heals the WHOLE
 * list the same proven way per-mon held items heal ({@linkcode applyCoopHeldItemsForMon}):
 *  - ADD: for each host blob with no matching guest modifier, RECONSTRUCT it via
 *    {@linkcode ModifierData.toModifier} (the same reconstruct path the held-item heal uses) and
 *    `addModifier` it (ignoreUpdate; the caller refreshes the bar once).
 *  - STACK: a guest modifier that MATCHES a host blob has its `stackCount` SET to the host's
 *    (persistent-modifier effects read stackCount at apply time, so a direct set is side-effect-free).
 *  - REMOVE: a guest player-wide persistent modifier the host's blob set lacks is dropped.
 *
 * INSTANCE IDENTITY (#844): a modifier is matched to a host blob by (typeId, argsHash) - typeId PLUS a
 * stable FNV-1a hash of its serialized (className, args) - NOT by typeId alone. A client can legitimately
 * hold MULTIPLE DISTINCT instances of ONE typeId (two `TEMP_STAT_STAGE_BOOSTER`s for DIFFERENT stats;
 * {@linkcode captureCoopPlayerModifiers} emits one blob PER instance), and the old typeId-only key
 * COLLAPSED all N of them onto the first blob - a full-snapshot resync of such a client silently LOST
 * instances (a state-destroying heal). Keying by instance identity reconciles N distinct instances to N.
 * This also SUBSUMES the old #837 arg-only heal: a guest instance whose internal args drifted no longer
 * matches the host blob's key, so it is REMOVED here and the host's correct-args instance is ADDED
 * (reconstructed) - the same remove-and-reconstruct the #837 in-place swap did, now falling directly out
 * of the instance-identity match (no separate arg-poke path). ER-custom classes reconstruct via the same
 * `Modifier[className] ?? resolveErModifierClass(className)` resolver the held-item / enemy heals use
 * (the only ER-custom player-wide relic on this path is the vanilla-namespaced `MapModifier`, which
 * resolves; every ER-custom PersistentModifier subclass is a held item, excluded below).
 *
 * NEVER touches `PokemonHeldItemModifier` (per-mon, healed elsewhere) or `PokemonFormChangeItemModifier`
 * (form healed via snap.formIndex) - the host already excludes both from the blob set, and we re-guard
 * here so a guest-only one is never removed by this path. Gated authoritative by the caller. Returns true
 * if it changed anything (so the caller refreshes the bar once). Fully guarded.
 */
export function reconcileCoopPlayerModifiers(hostBlobs: Record<string, unknown>[] | undefined): boolean {
  if (!Array.isArray(hostBlobs)) {
    return false;
  }
  let changed = false;
  try {
    // Whether a live modifier is one this path is allowed to own (player-wide, non-held, non-form).
    const isOwned = (m: PersistentModifier): boolean =>
      m instanceof PersistentModifier
      && !(m instanceof PokemonHeldItemModifier)
      && !(m instanceof Modifier.PokemonFormChangeItemModifier);
    // Instance identity (#844): typeId + a stable hash of the serialized (className, args). N DISTINCT
    // instances of one typeId key to N distinct slots (fixing the typeId-only collapse); an arg drift
    // yields a different key (so it falls to REMOVE + reconstruct-ADD, subsuming the #837 arg heal).
    const instanceKey = (typeId: string, className: unknown, args: unknown): string =>
      `${typeId} ${fnv1a64(canonicalize([typeof className === "string" ? className : null, args ?? []]))}`;
    // Host wanted instances, keyed by instance identity. A queue per key so a (pathological) identical-key
    // duplicate still wants N instances, never one (the host pre-filtered to owned modifiers).
    const wantByKey = new Map<string, { blob: Record<string, unknown>; stack: number }[]>();
    for (const raw of hostBlobs) {
      if (raw != null && typeof raw === "object") {
        const blob = raw as Record<string, unknown>;
        const typeId = blob.typeId;
        if (typeof typeId === "string") {
          const stackRaw = blob.stackCount;
          const stack = typeof stackRaw === "number" ? Math.max(0, Math.trunc(stackRaw)) : 1;
          const key = instanceKey(typeId, blob.className, blob.args);
          const queue = wantByKey.get(key) ?? [];
          queue.push({ blob, stack });
          wantByKey.set(key, queue);
        }
      }
    }
    // 1) STACK / REMOVE: iterate a snapshot of the guest's owned player-wide modifiers. Each live modifier
    // is serialized the SAME way the host serialized its blobs (`new ModifierData(m, false)`) so its
    // instance key matches byte-for-byte. A match CONSUMES one host slot (direct stackCount SET, no
    // re-apply - side-effect-free); an unmatched live modifier is dropped.
    for (const modifier of [...globalScene.modifiers]) {
      if (!isOwned(modifier)) {
        continue;
      }
      const liveData = new ModifierData(modifier, false);
      const key = instanceKey(modifier.type.id, liveData.className, liveData.args);
      const queue = wantByKey.get(key);
      const wanted = queue !== undefined && queue.length > 0 ? queue.shift() : undefined;
      if (wanted === undefined || wanted.stack <= 0) {
        coopWarn(
          "heal",
          `playerModifier REMOVE typeId=${modifier.type.id} host=0/absent guest.stack=${modifier.stackCount} -> removed`,
        );
        if (globalScene.removeModifier(modifier)) {
          changed = true;
        }
        continue;
      }
      if (modifier.stackCount !== wanted.stack) {
        coopWarn(
          "heal",
          `playerModifier stack typeId=${modifier.type.id} host=${wanted.stack} guest=${modifier.stackCount} -> applied`,
        );
        modifier.stackCount = wanted.stack;
        changed = true;
      }
    }
    // 2) ADD: any host slot NO live modifier consumed is an instance the guest lacks. Reconstruct it via
    // the same ModifierData path the per-mon held-item heal uses (vanilla Modifier namespace, ER-custom
    // fallback via resolveErModifierClass). This is the BUG 2 missing-modifier + the #844 missing-instance
    // case (a second distinct same-typeId instance the guest had collapsed away).
    for (const [, queue] of wantByKey) {
      for (const { blob, stack } of queue) {
        if (stack <= 0) {
          continue;
        }
        try {
          const data = new ModifierData(blob, false);
          const modifier = data.toModifier(
            Modifier[data.className as keyof typeof Modifier] ?? resolveErModifierClass(data.className),
          );
          // Re-guard: only a player-wide, non-held, non-form persistent modifier may be added by this path.
          if (
            !(modifier instanceof PersistentModifier)
            || modifier instanceof PokemonHeldItemModifier
            || modifier instanceof Modifier.PokemonFormChangeItemModifier
          ) {
            continue;
          }
          if (typeof data.stackCount === "number") {
            modifier.stackCount = data.stackCount;
          }
          coopWarn(
            "heal",
            `playerModifier ADD typeId=${modifier.type.id} stack=${modifier.stackCount} (guest lacked it) -> added`,
          );
          globalScene.addModifier(modifier, true, false, false);
          changed = true;
        } catch {
          /* one player-wide modifier failed to reconstruct; keep the rest */
        }
      }
    }
    if (changed) {
      globalScene.updateModifiers(true);
    }
  } catch {
    // A malformed player-wide modifier set must never crash the guest's battle.
  }
  return changed;
}

/**
 * GUEST (wave boundary): adopt the host's player-party ORDER (#633 GAP 4). The checksum hashes
 * `party = getPlayerParty().map(speciesId)` in slot order, so a party-order divergence (e.g. the
 * two clients merged the shared roster in a slightly different bench order) is a permanent
 * resync-loop. Mirrors the enemy `adoptCoopHostEnemyParty` reorder-by-identity pattern, but is
 * deliberately OFF-FIELD ONLY + run at a WAVE BOUNDARY (a mid-battle reorder of on-field mons is
 * unsafe): it permutes ONLY the BENCH slots (>= the on-field count) so the resulting full speciesId
 * sequence best matches the host's, never touching the on-field leads (those are the field
 * reconcile's job). Stable identity is `speciesId`; ties keep the first-available bench mon. A
 * party whose on-field leads already differ from the host is left to the field reconcile. Fully
 * guarded so a malformed order can never crash the guest. Returns true if it reordered anything.
 */
export function adoptCoopHostPlayerPartyOrder(hostParty: number[] | undefined): boolean {
  if (!Array.isArray(hostParty) || hostParty.length === 0) {
    return false;
  }
  try {
    const party = globalScene.getPlayerParty() as Pokemon[];
    if (party.length <= 1) {
      return false;
    }
    // #799 (live Wingull/Chinchou transposition): the old guard skipped ALL slots below the
    // on-field count, so in a co-op DOUBLE array slot 1 was permanently untouchable - a
    // transposition involving a lead ARRAY slot could NEVER heal (the field reconcile fixes
    // sprites/field state, not an array slot whose occupant is not even on the field, e.g. at
    // a wave boundary). New rule: pin ONLY mons that are genuinely ON FIELD right now (moving
    // those is the field reconcile's job); every other slot - including a lead-index slot whose
    // occupant is benched - is reorderable by identity to the host's exact sequence.
    //
    // #836 (live wave-5 party-order transposition): "genuinely on field" must ALSO mean the mon sits
    // at a FRONT array slot. `getPlayerField()` reads `party.slice(0, playerCapacity)`, so the array
    // order IS the field membership. A host faint-replacement transposition can leave the guest with an
    // ALIVE mon whose SPRITE is on the field (`isOnField()` true) but that sits at a BENCH array index
    // (>= capacity) while a FAINTED mon holds its front slot - a state where pinning the on-field mon at
    // its bench index froze the transposition forever (the reorder could not pull it forward). Such a
    // MISALIGNED on-field mon is NOT pinned: reordering it to its correct front slot is exactly what
    // restores array/field consistency, so a transient transposition always heals on the next resync.
    const playerCapacity = globalScene.currentBattle?.arrangement?.playerCapacity ?? 1;
    const pinned = new Set<number>();
    for (let i = 0; i < party.length; i++) {
      const mon = party[i];
      if (mon != null && mon.isOnField() && mon.isActive() && i < playerCapacity) {
        pinned.add(i);
      }
    }
    // Pool = every non-pinned mon; assign each non-pinned slot the host's species at that index.
    const remaining: Pokemon[] = [];
    for (let i = 0; i < party.length; i++) {
      if (!pinned.has(i) && party[i] != null) {
        remaining.push(party[i]);
      }
    }
    const desired: (Pokemon | null)[] = Array.from({ length: party.length }, () => null);
    for (let i = 0; i < party.length && i < hostParty.length; i++) {
      if (pinned.has(i)) {
        continue;
      }
      const wantSpecies = hostParty[i];
      const idx = remaining.findIndex(p => (p.species?.speciesId ?? -1) === wantSpecies);
      if (idx >= 0) {
        desired[i] = remaining[idx];
        remaining.splice(idx, 1);
      }
    }
    // Any unmatched pool mons fill the remaining non-pinned holes in order (defensive; keeps all).
    for (let i = 0; i < party.length; i++) {
      if (!pinned.has(i) && desired[i] == null && remaining.length > 0) {
        desired[i] = remaining.shift() ?? null;
      }
    }
    let changed = false;
    for (let i = 0; i < party.length; i++) {
      if (!pinned.has(i) && desired[i] != null && party[i] !== desired[i]) {
        party[i] = desired[i] as Pokemon;
        changed = true;
      }
    }
    if (changed) {
      coopLog(
        "resync",
        `adoptCoopHostPlayerPartyOrder reordered to host sequence (pinnedOnField=[${[...pinned].join(",")}])`,
      );
    }
    return changed;
  } catch {
    // A malformed party order must never crash the guest's run.
    return false;
  }
}

/**
 * GUEST (authoritative resync, #837): restore the ER MODULE-LET substrates the {@linkcode
 * CoopChecksumState.saveDataDigest} now detects as diverged but that no per-turn/resync heal carried:
 * the money-streak map (#348), the biome overstay anchor (#504), the per-battle relic state
 * (Cursed Idol / Pharaoh's Ankh), and - #865 - the ER WORLD-MAP STATE (revealed onward nodes / travel
 * target / fragments / journey) plus the routing PENDING-NODE set the biome-travel decision reads. Each
 * goes through the substrate's OWN restore function (never a hand-rolled write), so the wire form is
 * exactly the session-save form. Every field is additive: an older host omits it (undefined) and that
 * substrate is left untouched. Fully guarded so a malformed substrate can never crash the guest's battle.
 *
 * Called BOTH per-turn (from {@linkcode applyCoopAuthoritativeBattleState}, before the checksum verify -
 * so the guest adopts-then-hashes and the widened erMapState digest converges) AND on the full-snapshot
 * resync (from {@linkcode applyCoopFullSnapshot}).
 */
function restoreCoopModuleLetSubstrates(
  snapshot: Pick<
    CoopFullBattleSnapshot,
    | "erMoneyStreaks"
    | "biomeOverstayAnchor"
    | "erRelicBattleState"
    | "erBiomeStructure"
    | "erMapState"
    | "erPendingNodes"
  >,
): void {
  try {
    if (Array.isArray(snapshot.erMoneyStreaks)) {
      coopLog("heal", `erMoneyStreaks host entries=${snapshot.erMoneyStreaks.length} -> restored (#837/#348)`);
      restoreErMoneyStreaks(snapshot.erMoneyStreaks);
    }
    if (snapshot.biomeOverstayAnchor !== undefined) {
      coopLog("heal", `biomeOverstayAnchor host=${snapshot.biomeOverstayAnchor} -> restored (#837/#504)`);
      setErBiomeOverstayAnchor(snapshot.biomeOverstayAnchor);
    }
    if (snapshot.erBiomeStructure !== undefined) {
      coopLog(
        "heal",
        `erBiomeStructure host length=${snapshot.erBiomeStructure.biomeLength} startWave=${snapshot.erBiomeStructure.biomeStartWave} -> restored (#841 item 5)`,
      );
      setErBiomeStructureExtent(snapshot.erBiomeStructure.biomeLength, snapshot.erBiomeStructure.biomeStartWave);
    }
    if (snapshot.erRelicBattleState !== undefined) {
      coopLog(
        "heal",
        `erRelicBattleState host wave=${(snapshot.erRelicBattleState as ErRelicBattleStateData).wave} -> restored (#837)`,
      );
      restoreErRelicBattleState(snapshot.erRelicBattleState);
    }
    // ER WORLD-MAP STATE (#865 / audit #841 item 1): adopt the host's map state (revealed nodes / travel
    // target / fragments / journey / structure) THEN re-seat the routing PENDING-NODE set. Order matters:
    // restoreErMapState RESETS the map subsystem (nodes/routing/structure/fairy) and re-applies the host's
    // saved state - which WIPES the routing pending nodes (resetErRouting) - so setErPendingNodes must run
    // AFTER, since the biome-travel decision (SelectBiomePhase) reads getErPendingNodes(), NOT the persisted
    // erMapState nodes. Adopting the host's pending set makes a natural single-node biome-travel terminal
    // coherent by construction. (biomeStartWave is always carried, so restoreErMapState's wave fallback is a
    // no-op; pass the live wave defensively for an older save that omitted it.)
    if (snapshot.erMapState !== undefined) {
      coopLog(
        "heal",
        `erMapState host nodes=${snapshot.erMapState.nodes?.length ?? 0} travelTarget=${snapshot.erMapState.travelTarget ?? "-"} fragments=${snapshot.erMapState.fragments ?? 0} -> restored (#865/#841 item 1)`,
      );
      restoreErMapState(snapshot.erMapState, globalScene.currentBattle?.waveIndex ?? 1);
      setAuthoritativeMapTravelClassification(
        globalScene.currentBattle?.waveIndex ?? -1,
        typeof snapshot.erMapState.travelTarget === "number" ? snapshot.erMapState.travelTarget : null,
      );
    }
    if (Array.isArray(snapshot.erPendingNodes)) {
      coopLog(
        "heal",
        `erPendingNodes host count=${snapshot.erPendingNodes.length} revealed=${snapshot.erPendingNodes.filter(n => n.revealed).length} -> restored (#865)`,
      );
      setErPendingNodes((snapshot.erPendingNodes as ErRouteNode[]).map(n => ({ ...n })));
    }
  } catch (e) {
    // A malformed module-let substrate must never crash the guest's battle, but these substrates ride the
    // saveDataDigest (an OPAQUE hash) - a failed restore leaves the guest diverged with no per-field signal,
    // so record it structurally for the loud heal (item 4).
    recordCoopApplyFailure("substrates", e);
  }
}

/**
 * GUEST: adopt the host's full authoritative snapshot wholesale to HEAL a desync (#633,
 * TRACK-2). Applies field mons (ability/form before stat recompute), then arena weather /
 * terrain / TAGS (#633 GAP 1), then money, then the SAFE subset of persistent-modifier stack
 * counts (#633 GAP 2) - field-by-field onto the LIVE objects (never a session reload, which
 * would tear down the running battle). ON-FIELD per-mon held-item structure IS now rewritten to the
 * host's set (#633 RISKY #1/#2/#3, {@linkcode applyCoopHeldItemsForMon}, gated authoritative) and the
 * ball inventory healed (#633 RISKY #4); BENCH held items still converge at the wave boundary via the
 * enemy/party adopt. The player party ORDER is adopted OFF-FIELD ONLY here (#633 GAP 4,
 * {@linkcode adoptCoopHostPlayerPartyOrder} - bench-only, safe at any boundary). Fully guarded so a
 * malformed snapshot can never crash the guest.
 *
 * `authoritativeGuest` (#633): the {@linkcode isCoopAuthoritativeGuest} gate result, computed by the
 * cycle-free CALLER (the engine must not import the runtime - that is an import cycle) and threaded to
 * {@linkcode applyFullMon} so the level/exp + boss re-assert branches stay guest-only (solo / host /
 * lockstep are byte-identical). Defaults `false` so a non-gated call can never fire a guest branch.
 */
export function applyCoopFullSnapshot(
  snapshot: CoopFullBattleSnapshot,
  authoritativeGuest = false,
  suppressResummon = false,
): void {
  // #838 UNIFY: an AUTHORITATIVE GUEST adopting a modern host's id-based authoritative full-state uses the
  // SAME apply the live turns use (mutate-in-place by Pokemon.id, reconstruct/remove by id, adopt host party
  // order, instance-keyed modifiers, render differ) - a strict SUPERSET of the legacy species-order +
  // benchParty reconcile below, so that whole legacy path is skipped. It gates on its OWN monotonic tick
  // (authoritativeState.tick), so the snapshot.tick check is not needed here. suppressResummon is irrelevant
  // (the differ's re-summon is sprite-key-gated / flicker-free). The `authoritativeGuest` GATE preserves the
  // legacy defensive no-op for a NON-authoritative (host / solo / lockstep) apply, which the id-based apply -
  // that mutates by id unconditionally - would otherwise violate; production only ever applies as the guest.
  // The resync/ME authoritativeState is captured with pokeballCounts STRIPPED (#843): balls converge ONLY
  // through the per-turn end-of-turn state, never a crossing/resync SET that races a between-wave ball grant.
  if (snapshot.authoritativeState !== undefined && authoritativeGuest) {
    applyCoopAuthoritativeBattleState(snapshot.authoritativeState, authoritativeGuest);
    return;
  }
  // ---- Legacy fallback: a NON-authoritative apply, an OLDER host, or a field-less capture. ----
  // #807: reject out-of-order/stale state (standard snapshot sequencing).
  if (!coopAcceptStateTick(snapshot.tick, "fullSnapshot")) {
    return;
  }
  try {
    coopLog(
      "resync",
      `guest applyFullSnapshot field=${snapshot.field?.length ?? 0} weather=${snapshot.weather} terrain=${snapshot.terrain} arenaTags=${snapshot.arenaTags?.length ?? 0} modifiers=${snapshot.modifiers?.length ?? 0} party=${snapshot.party?.length ?? 0} money=${snapshot.money} suppressResummon=${suppressResummon}`,
    );
    // Biome heal (B7): a hashed biome split (a seed/waveIndex drift that landed the clients in
    // DIFFERENT biomes) is healed by rebuilding the arena to the host's biome. MUST run BEFORE the
    // weather/terrain/arenaTags reconcile below (a fresh Arena has none) so they land on the right
    // arena; its position vs. the field re-summon is immaterial (newArena swaps only globalScene.arena
    // DATA, never globalScene.field sprites). newArena is heavy, so gate to a genuine mismatch - a
    // no-op (and same arena object identity) when biome already matches, the overwhelmingly common case.
    // NOTE: newArena does NOT call arena.init(), so the visible background is not refreshed until the
    // next real SwitchBiomePhase; the checksum reads only arena.biomeId (data), which this DOES fix.
    if (typeof snapshot.biomeId === "number" && (globalScene.arena?.biomeId ?? -1) !== snapshot.biomeId) {
      coopWarn("resync", `biome force host=${snapshot.biomeId} guest=${globalScene.arena?.biomeId}`);
      globalScene.newArena(snapshot.biomeId as BiomeId);
    }
    // MINOR-1 (#633, converge-or-give-up): when a divergence has failed to heal twice on the same
    // dimensions, SKIP the heavy field-composition re-summon (it isn't closing the gap and a per-turn
    // teardown/rebuild is a flicker + asset-reload storm). The cheap per-mon scalar writes still run.
    if (!suppressResummon) {
      // Heal the enemy-field COMPOSITION first (#633): drop any just-fainted enemy (fainted:true) and
      // mirror any host enemy SWITCH (a different species now at a slot). Done BEFORE the per-mon heal
      // below so the freshly-summoned switched-in mon is the one the snapshot's per-bi state lands on.
      // Side-effect-free, idempotent, enemy slots only.
      reconcileCoopEnemyField(snapshot.field);
      // ...and the PLAYER-field COMPOSITION (#633 partner-death sync): drop any just-fainted partner
      // (fainted:true) and mirror a host partner REPLACEMENT (a different species now at a player
      // slot). Done BEFORE the per-mon heal below so the freshly-summoned replacement is the one the
      // snapshot's per-bi state lands on. Side-effect-free, idempotent, player slots only.
      reconcileCoopPlayerField(snapshot.field);
    }
    // The checkpoint reconcile immediately before this may have removed a just-fainted mon from the
    // ACTIVE field (and reset its summonData). Match against the SLOT-PRESENT view instead: it is the
    // exact capture coordinate space and retains that party object through the wave-win boundary.
    const byIndex = new Map(getCoopSerializableField().map(m => [m.getBattlerIndex(), m]));
    for (const snap of snapshot.field) {
      const mon = byIndex.get(snap.bi);
      if (mon != null) {
        applyFullMon(mon, snap, authoritativeGuest, suppressResummon);
      }
    }
    // On-field held-item bar refresh (#633 RISKY #1/#2/#3, C4): applyFullMon healed each mon's held items
    // with ignoreUpdate (no per-mon re-render); refresh BOTH modifier bars ONCE here when the gated heal
    // could have run (idempotent, gated authoritative; reconcileCoopModifierStacks refreshes the player
    // bar separately on a stack change).
    if (authoritativeGuest && snapshot.field.some(s => s.heldItems !== undefined)) {
      globalScene.updateModifiers(true);
      globalScene.updateModifiers(false);
    }
    const arena = globalScene.arena;
    if ((arena.weather?.weatherType ?? 0) !== snapshot.weather) {
      coopWarn("heal", `weather host=${snapshot.weather} guest=${arena.weather?.weatherType ?? 0} -> applied`);
      arena.trySetWeather(snapshot.weather as WeatherType);
    }
    if ((arena.terrain?.terrainType ?? 0) !== snapshot.terrain) {
      coopWarn("heal", `terrain host=${snapshot.terrain} guest=${arena.terrain?.terrainType ?? 0} -> applied`);
      arena.trySetTerrain(snapshot.terrain as TerrainType, true);
    }
    // Reconcile arena tags (#633 GAP 1): the full snapshot now HEALS hazards / screens / tailwind,
    // not just the per-turn checkpoint - so a guest that resyncs on a mismatch converges its arena.
    reconcileArenaTags(snapshot.arenaTags);
    if (globalScene.money !== snapshot.money) {
      coopWarn("heal", `money host=${snapshot.money} guest=${globalScene.money} -> applied`);
    }
    globalScene.money = snapshot.money;
    // Ball inventory is NOT healed here (#843). The host decrements the ball count host-only in
    // AttemptCapturePhase (the pure-renderer guest never runs it) and grants ball rewards through the
    // reward shop; the guest converges to the host's count via the END-OF-TURN authoritative state
    // ({@linkcode applyCoopAuthoritativeBattleState}, applied every finalize BEFORE the checksum verify),
    // NOT via this resync/crossing snapshot. Healing balls HERE raced the reward-shop ADD: a resync fired
    // by an UNRELATED field mismatch (e.g. a bench transposition) re-SET the ball count from the host's
    // snapshot around a between-wave ball grant, so the SET and the ADD stacked wrongly and the guest's
    // count drifted ABOVE the host's (soak seed 20260706 @wave 106: guest GREAT_BALL 15 vs host 10). Since
    // the per-turn authoritative SET already reconciles balls at every turn boundary before the checksum is
    // read (so a ball drift can never even TRIGGER a resync), carrying them ONLY there loses no coverage
    // while removing the racing SET. See coop-held-item-sync.test.ts (#4).
    // Reconcile player-wide persistent modifiers (#698 / #633 GAP 2 + BUG 2): the FULL-blob reconcile
    // (add missing / remove extra / fix stacks) heals a host-only player-wide modifier the guest is
    // MISSING (a temp stat booster, an EXP charm, ...) - the root divergence the stack-only path could
    // never close. Gated authoritative + only when the (newer) host carried the blobs; an OLDER host
    // (playerModifiers undefined) FALLS BACK to the proven stack-only reconcile (no regression). Held
    // items stay per-mon (healed above); both paths skip them.
    if (authoritativeGuest && snapshot.playerModifiers !== undefined) {
      reconcileCoopPlayerModifiers(snapshot.playerModifiers);
    } else {
      reconcileCoopModifierStacks(snapshot.modifiers);
    }
    // Run-seed heal (B8): the hashed master determinism input is now healed on ANY resync, not only at
    // an ME terminal (where applyCoopMeOutcome re-pins it separately + idempotently). Length-guarded so
    // an empty "" seed is never pinned; re-pinning the same seed is a no-op, safe in the common case.
    if (typeof snapshot.seed === "string" && snapshot.seed.length > 0) {
      if (globalScene.seed !== snapshot.seed) {
        coopWarn("heal", `seed host=${snapshot.seed} guest=${globalScene.seed} -> applied`);
      }
      globalScene.setSeed(snapshot.seed);
    }
    if (typeof snapshot.waveSeed === "string" && snapshot.waveSeed.length > 0) {
      if (globalScene.waveSeed !== snapshot.waveSeed) {
        coopWarn("heal", `waveSeed host=${snapshot.waveSeed} guest=${globalScene.waveSeed} -> applied`);
      }
      globalScene.waveSeed = snapshot.waveSeed;
      Phaser.Math.RND.sow([snapshot.waveSeed]);
    }
    // Adopt the host's player party ORDER (#633 GAP 4): OFF-FIELD-only bench reorder (safe at any
    // boundary) so the hashed `party` speciesId sequence converges. On-field leads are untouched.
    const reordered = adoptCoopHostPlayerPartyOrder(snapshot.party);
    if (reordered) {
      coopWarn(
        "heal",
        `party-order adopt host=[${(snapshot.party ?? []).join(",")}] guest=[${globalScene
          .getPlayerParty()
          .map(p => p.species?.speciesId ?? 0)
          .join(",")}] -> reordered bench`,
      );
    }
    // B4 (#633): heal bench-mon level / exp / form / friendship / moveset (+ a host off-field
    // evolution's species) by reconciling the WHOLE party to the host's PokemonData (the live
    // revive-in-shop desync: the host shows a bench mon fainted, the guest shows it alive). Reuses
    // the capture-handshake reconcile (preserves on-field leads + matched objects + held items,
    // constructs new mons, releases removed). GUEST-ONLY: gated on the `authoritativeGuest` param
    // (false for host / solo / lockstep), so those paths never run it. Runs LAST so its full per-mon
    // field-apply is the authoritative final word over the speciesId-only order-adopt above.
    if (authoritativeGuest && Array.isArray(snapshot.benchParty) && snapshot.benchParty.length > 0) {
      coopLog(
        "heal",
        `benchParty reconcile host=${snapshot.benchParty.length} mons guest=${globalScene.getPlayerParty().length} -> applyCaptureParty`,
      );
      applyCoopCaptureParty(snapshot.benchParty);
    }
    // ER module-let substrate heal (#837): restore the money-streak map, biome overstay anchor, and
    // per-battle relic state the saveDataDigest now DETECTS as diverged - each through the substrate's
    // OWN restore function (no hand-rolled second write). GUEST-ONLY (gated authoritative; host / solo /
    // lockstep skip it - lockstep both advance these deterministically). Each field is additive: an
    // older host omits it and that substrate is left alone (undefined skip in the helper).
    if (authoritativeGuest) {
      restoreCoopModuleLetSubstrates(snapshot);
    }
    coopLog(
      "resync",
      `guest applyFullSnapshot DONE authoritativeGuest=${authoritativeGuest} suppressResummon=${suppressResummon}`,
    );
  } catch {
    // A malformed snapshot must never crash the guest's battle.
  }
}

/**
 * HOST (#633 M2): capture ONLY the on-field mons' COMPLETE per-mon snapshot (the same `readFullMon`
 * view the resync uses), so the per-turn stream can heal the on-field state the numeric checkpoint
 * OMITS - moveset+PP / tera / boss segments / held items / non-ER tags / ability / form - IN-LINE every
 * turn, instead of only via a checksum-mismatch resync round-trip. FIELD-ONLY (no bench / player-modifier
 * / arena payload: those do not change within a battle turn and stay on the resync). Sorted by `bi` for a
 * stable wire order. Returns `null` on an empty field or a read failure (never breaks the host's turn).
 */
export function captureCoopFieldSnapshot(): CoopFullMonSnapshot[] | null {
  try {
    const field = getCoopSerializableField()
      .map(readFullMon)
      .sort((a, b) => a.bi - b.bi);
    return field.length === 0 ? null : field;
  } catch (error) {
    coopWarn("checkpoint", "authoritative full-field capture failed; field withheld", error);
    return null;
  }
}

/**
 * One coherent modern authority frame. Turn resolutions and out-of-band replacement checkpoints must
 * never publish a numeric checkpoint while silently omitting the rich field/state companion or while
 * carrying the checksum read-failure sentinel. Capturing the checksum preimage once also guarantees the
 * transmitted checksum describes the exact diagnostic preimage beside it.
 */
export interface CoopAuthoritativeCarrierCapture {
  checkpoint: CoopBattleCheckpoint;
  checksum: string;
  preimage: string;
  fullField: CoopFullMonSnapshot[];
  authoritativeState: CoopAuthoritativeBattleStateV1;
}

/** HOST: capture an all-or-nothing modern turn/replacement authority frame. */
export function captureCoopAuthoritativeCarrier(
  turn: number,
  reason: "turnResolution" | "replacement",
): CoopAuthoritativeCarrierCapture | null {
  try {
    const checkpoint = captureCoopCheckpoint();
    if (checkpoint == null) {
      throw new Error("numeric checkpoint was unavailable");
    }
    const fullField = captureCoopFieldSnapshot();
    if (fullField == null || fullField.length === 0) {
      throw new Error("full field snapshot was unavailable");
    }
    const authoritativeState = captureCoopAuthoritativeBattleState(turn);
    if (authoritativeState == null) {
      throw new Error("authoritative battle state was unavailable");
    }
    const checksumView = captureCoopChecksumState();
    if (checksumView.saveDataDigest === COOP_CHECKSUM_SENTINEL) {
      throw new Error("save-data digest capture returned the read-failure sentinel");
    }
    const preimage = canonicalize(checksumView);
    const checksum = checksumState(checksumView);
    if (checksum === COOP_CHECKSUM_SENTINEL) {
      throw new Error("full-state checksum collided with the reserved read-failure sentinel");
    }
    return { checkpoint, checksum, preimage, fullField, authoritativeState };
  } catch (error) {
    coopWarn("checkpoint", `${reason} authority capture incomplete; entire carrier withheld`, error);
    return null;
  }
}

/**
 * GUEST (#633 M2): apply the host's COMPLETE per-mon field snapshot at the turn boundary, healing each
 * on-field mon's ability / form / tera / moveset+PP / tags / held items IN-LINE (the numeric checkpoint
 * carries only hp / status / stages, so those otherwise wait for a checksum-mismatch resync). Reuses the
 * proven {@linkcode applyFullMon} per mon, matched by battler index. The field-COMPOSITION reconcile (drop
 * a fainted mon / mirror a switch) is already done by the per-turn checkpoint apply, so it is intentionally
 * NOT repeated here. Gated authoritative-guest BY THE CALLER (solo / host / lockstep pass `false` and this
 * is a no-op via the loop's applyFullMon gates); the held-item bar is refreshed ONCE after the loop
 * (mirrors applyCoopFullSnapshot's deferral). Fully guarded - a malformed field can never break the turn.
 */
export function applyCoopFieldSnapshot(field: CoopFullMonSnapshot[] | undefined, authoritativeGuest: boolean): void {
  if (!Array.isArray(field) || field.length === 0) {
    return;
  }
  try {
    // SHOWDOWN ingress: `fullField` is battler-index keyed just like the numeric checkpoint. The versus
    // guest owns the reflected local field, so map every rich mon companion into that same coordinate
    // space before matching it. Leaving this carrier unswapped made checkpoint/state converge while
    // maxHp, HP, held items, tags, and PP were repeatedly written onto the opposite mon forever.
    const localField = isShowdownGuestFlipGated() ? swapFullField(field) : field;
    // The numeric checkpoint immediately before this can remove a just-fainted mon from the ACTIVE
    // field and reset its summonData. Retain the slot-present object so the rich companion restores
    // every authoritative terminal field (notably ability/form/tags/held items) at the same boundary.
    const byIndex = new Map(getCoopSerializableField().map(m => [m.getBattlerIndex(), m]));
    for (const snap of localField) {
      const mon = byIndex.get(snap.bi);
      if (mon != null) {
        applyFullMon(mon, snap, authoritativeGuest);
      }
    }
    // Deferred single bar refresh (mirrors applyCoopFullSnapshot C4): applyFullMon healed held items
    // with ignoreUpdate; refresh both modifier bars ONCE here when the gated held-item heal could run.
    if (authoritativeGuest && localField.some(s => s.heldItems !== undefined)) {
      globalScene.updateModifiers(true);
      globalScene.updateModifiers(false);
    }
  } catch (error) {
    // The caller drains this structured failure and requests/awaits a complete retry. Swallowing it here
    // made the numeric half appear successful while an unhashed rich field could remain stale.
    recordCoopApplyFailure("fieldSnapshot", error);
  }
}

// =============================================================================
// Co-op authoritative non-battle ME outcome (#633, CHANGE-4 / P4). In authoritative
// co-op the HOST is the SOLE non-battle-ME engine: every side effect (party changes,
// ME-save tier weighting, RNG advance, dex / starter unlocks) lands ONLY on the host.
// At the ME terminal the host captures a COMPREHENSIVE resync blob and streams it; the
// guest applies it FIELD-BY-FIELD onto its LIVE objects so its run converges with the
// host's, exactly as the per-turn checkpoint heals battle drift. Pure JSON / scalars on
// the wire (bigint dex fields round-trip via string); every apply is fully guarded so a
// bad blob can never hang or crash the guest.
// =============================================================================

/**
 * HOST: serialize the WHOLE `gameData.dexData` + `starterData` into a compact, bigint-safe
 * blob (#633 MAJOR-2). `DexEntry.seenAttr` / `caughtAttr` are `bigint`, which JSON cannot carry,
 * so they are string-encoded via `.toString()` (decoded with `BigInt(...)` on apply). The whole
 * dex is serialized (a per-species "touched" diff is a future optimization; a full blob is correct
 * and small after lz-string). `starterData` is plain scalars / arrays, carried as-is. Fully guarded.
 */
/**
 * #801 run-scoped acquisition sharing: per-species dex fingerprints + the starterData JSON
 * captured at the CO-OP RUN START. The delta blob only carries entries that CHANGED since -
 * run catches, shiny unlocks, grants - never the host's whole account (live report: "they get
 * all of my pokemon instead of theirs" - the un-scoped blob union-merged the host's entire
 * dex onto the guest's account). No baseline captured -> EMPTY blob (share nothing, never
 * overshare); the next run start re-arms it.
 */
let coopDexBaseline: Map<number, string> | null = null;
let coopStarterBaseline: Map<number, string> | null = null;

/** Fingerprint one dex entry (cheap string compare basis). */
function dexEntryFingerprint(e: {
  seenAttr: bigint;
  caughtAttr: bigint;
  natureAttr: number;
  seenCount: number;
  caughtCount: number;
  hatchedCount: number;
}): string {
  return `${e.seenAttr}|${e.caughtAttr}|${e.natureAttr}|${e.seenCount}|${e.caughtCount}|${e.hatchedCount}`;
}

/** Capture the run-start acquisition baseline (call at the co-op run's first encounter). */
export function captureCoopDexBaseline(): void {
  try {
    const dex = new Map<number, string>();
    for (const [id, e] of Object.entries(globalScene.gameData.dexData)) {
      dex.set(Number(id), dexEntryFingerprint(e));
    }
    const starter = new Map<number, string>();
    for (const [id, e] of Object.entries(globalScene.gameData.starterData)) {
      starter.set(Number(id), JSON.stringify(e));
    }
    coopDexBaseline = dex;
    coopStarterBaseline = starter;
    coopLog("shop", `dex baseline captured (species=${dex.size} starters=${starter.size}) - deltas are run-scoped`);
  } catch {
    coopDexBaseline = null;
    coopStarterBaseline = null;
  }
}

/** Test/teardown hook: drop the baseline (a delta request then shares NOTHING). */
export function clearCoopDexBaseline(): void {
  coopDexBaseline = null;
  coopStarterBaseline = null;
}

export function captureCoopDexDelta(): string {
  try {
    // #801: without a run-start baseline, share NOTHING (an un-scoped blob would clone the
    // host's whole account dex onto the partner - the live "all of my pokemon" report).
    if (coopDexBaseline == null || coopStarterBaseline == null) {
      return "";
    }
    const dex: Record<
      number,
      {
        seenAttr: string;
        caughtAttr: string;
        natureAttr: number;
        seenCount: number;
        caughtCount: number;
        hatchedCount: number;
        ivs: number[];
      }
    > = {};
    for (const [id, e] of Object.entries(globalScene.gameData.dexData)) {
      if (coopDexBaseline.get(Number(id)) === dexEntryFingerprint(e)) {
        continue; // unchanged since run start - not a run acquisition, never shared
      }
      dex[Number(id)] = {
        seenAttr: e.seenAttr.toString(),
        caughtAttr: e.caughtAttr.toString(),
        natureAttr: e.natureAttr,
        seenCount: e.seenCount,
        caughtCount: e.caughtCount,
        hatchedCount: e.hatchedCount,
        ivs: [...e.ivs],
      };
    }
    // #801: starterData is scoped identically - only entries that changed since run start
    // (run shiny/black unlocks, candy from run catches), never the whole account table.
    const starter: Record<number, unknown> = {};
    for (const [id, e] of Object.entries(globalScene.gameData.starterData)) {
      if (coopStarterBaseline.get(Number(id)) !== JSON.stringify(e)) {
        starter[Number(id)] = e;
      }
    }
    return compressToBase64(JSON.stringify({ dex, starter }));
  } catch {
    // A dex read failure must never break the outcome send; an empty blob is a no-op on apply.
    return "";
  }
}

/**
 * GUEST: merge the host's dex / starter blob ({@linkcode captureCoopDexDelta}) onto the local
 * `gameData` (#633 MAJOR-2). Decodes the bigint `seenAttr` / `caughtAttr` via `BigInt(...)`,
 * sets the numeric counts, and merges `starterData`. Fully guarded so a malformed / empty blob
 * is a no-op (the per-turn checksum + the next ME terminal re-sync any residual drift).
 */
export function applyCoopDexDelta(blob: string): void {
  if (typeof blob !== "string" || blob.length === 0) {
    return;
  }
  try {
    const decompressed = decompressFromBase64(blob);
    if (decompressed == null || decompressed.length === 0) {
      return;
    }
    const parsed = JSON.parse(decompressed) as {
      dex?: Record<
        string,
        {
          seenAttr: string;
          caughtAttr: string;
          natureAttr: number;
          seenCount: number;
          caughtCount: number;
          hatchedCount: number;
          ivs: number[];
        }
      >;
      starter?: Record<string, StarterDataEntry>;
    };
    // #801 CRITICAL ("i overwrote all my guest's pokemon... it seems permanent"): the old apply
    // wholesale-SET each dex field and spread-OVERWROTE starter entries with the host's values -
    // the partner's own attrs, candy counts, and unlocks were REPLACED (destroyed) by whatever
    // the host had. The apply is now a strict GAIN-ONLY UNION: bitmasks OR, counts max, objects
    // gain new keys only. The receiving account can never lose anything from a co-op session.
    const dexData = globalScene.gameData.dexData;
    for (const [id, e] of Object.entries(parsed.dex ?? {})) {
      const entry = dexData[Number(id)];
      if (entry == null) {
        continue;
      }
      entry.seenAttr |= BigInt(e.seenAttr);
      entry.caughtAttr |= BigInt(e.caughtAttr);
      entry.natureAttr |= e.natureAttr;
      entry.seenCount = Math.max(entry.seenCount, e.seenCount);
      entry.caughtCount = Math.max(entry.caughtCount, e.caughtCount);
      entry.hatchedCount = Math.max(entry.hatchedCount, e.hatchedCount);
      if (Array.isArray(e.ivs) && Array.isArray(entry.ivs)) {
        for (let i = 0; i < entry.ivs.length && i < e.ivs.length; i++) {
          entry.ivs[i] = Math.max(entry.ivs[i], e.ivs[i]);
        }
      }
    }
    const BITMASK_STARTER_FIELDS = new Set(["eggMoves", "abilityAttr", "passiveAttr"]);
    const starterData = globalScene.gameData.starterData;
    for (const [id, sIn] of Object.entries(parsed.starter ?? {})) {
      if (sIn == null || typeof sIn !== "object") {
        continue;
      }
      const key = Number(id);
      const local = (starterData[key] ?? {}) as unknown as Record<string, unknown>;
      for (const [field, incoming] of Object.entries(sIn as unknown as Record<string, unknown>)) {
        const cur = local[field];
        if (typeof incoming === "number" && typeof cur === "number") {
          local[field] = BITMASK_STARTER_FIELDS.has(field) ? cur | incoming : Math.max(cur, incoming);
        } else if (typeof incoming === "boolean") {
          local[field] = cur === true || incoming;
        } else if (incoming != null && typeof incoming === "object" && !Array.isArray(incoming)) {
          // Objects (e.g. erShinyLab saved looks): gain NEW keys, local values win on conflict.
          local[field] = { ...(incoming as Record<string, unknown>), ...((cur as Record<string, unknown>) ?? {}) };
        } else if (cur === undefined) {
          local[field] = incoming;
        }
      }
      starterData[key] = local as unknown as (typeof starterData)[number];
    }
  } catch {
    // A malformed dex blob must never crash the guest; the checksum / next ME terminal re-sync.
  }
}

/**
 * GUEST: reconcile the player party from the host's serialized {@linkcode PokemonData} list
 * (#633 MAJOR-2). Applies the per-mon SCALAR fields FIELD-BY-FIELD onto the matched LIVE
 * `PlayerPokemon` (NOT a wholesale new-object swap, which would break the phase / UI references
 * that hold the live mon), then recomputes stats. A mon the host added that the guest does not
 * have (e.g. a gift ME) is the ONLY case that constructs a new object - appended at the BENCH
 * TAIL, where a fresh mon has no dangling references. Matching is by party INDEX (the host and
 * guest party order is kept permutation-identical by the order-adopt / checkpoint paths). Fully
 * guarded so a malformed entry can never crash the guest.
 */
export function applyCoopMePartyFromData(serializedParty: string[]): void {
  if (!Array.isArray(serializedParty)) {
    return;
  }
  try {
    // Widen to Pokemon[] (the existing engine reads do the same): the field-apply takes a Pokemon
    // and a freshly-constructed player mon (`toPokemon` -> a PlayerPokemon) appends type-cleanly.
    const party = globalScene.getPlayerParty() as Pokemon[];
    for (let i = 0; i < serializedParty.length; i++) {
      let data: PokemonData;
      try {
        data = new PokemonData(JSON.parse(serializedParty[i]));
      } catch {
        continue; // one bad blob entry; leave that slot and keep going.
      }
      const live = party[i];
      if (live != null && (live.species?.speciesId ?? -1) === data.species) {
        applyCoopMeMonFields(live, data);
      } else if (live == null) {
        // A NEW mon the host added (gift ME): construct from data and append at the bench tail.
        // A fresh mon has no dangling phase / UI references, so construction is safe here only.
        try {
          const added = data.toPokemon();
          party.push(added);
        } catch {
          // A construction failure must never crash the guest; the wave-boundary adopt re-syncs.
        }
      }
      // A species MISMATCH at an existing slot is left to the wave-boundary order-adopt /
      // field reconcile (a mid-ME swap of an existing live mon is unsafe).
    }
    // #633 M-1: a release / sacrifice / trade ME SHRINKS the host party. The append-only pass above
    // never drops a stale live mon, so without this the guest party ends LONGER than the host's - a
    // party-length divergence that breaks the per-turn replay (index alignment). Truncate the live
    // party back to the host's length, releasing each surplus BENCH mon via the canonical removal
    // path (which also detaches its held-item modifiers). Safe here: a non-battle ME terminal resync
    // runs OFF-FIELD, so every surplus mon is a bench mon with no live phase / field reference. We
    // never trim BELOW the on-field count (a defensive floor; the host party can't be shorter than
    // the shared on-field leads at an off-field ME terminal).
    const onFieldFloor = globalScene.getPlayerField(false).length;
    const targetLen = Math.max(serializedParty.length, onFieldFloor);
    // Remove from the tail inward so each splice keeps the lower indices stable.
    while (globalScene.getPlayerParty().length > targetLen) {
      const live = globalScene.getPlayerParty();
      const surplus = live.at(-1);
      if (surplus == null) {
        break;
      }
      coopLog(
        "party",
        `meParty TRUNCATE release bench sp=${surplus.species?.speciesId ?? 0} (host len=${serializedParty.length} guest len=${live.length})`,
      );
      globalScene.removePokemonFromPlayerParty(surplus, true);
    }
  } catch {
    // A malformed party list must never crash the guest's run.
  }
}

/** Apply ONE mon's host-authoritative SCALAR fields onto a LIVE mon (no object swap). */
function applyCoopMeMonFields(mon: Pokemon, data: PokemonData): void {
  try {
    mon.formIndex = data.formIndex;
    mon.abilityIndex = data.abilityIndex;
    mon.shiny = data.shiny;
    mon.variant = data.variant;
    mon.level = data.level;
    mon.exp = data.exp;
    mon.gender = data.gender;
    mon.nature = data.nature;
    mon.luck = data.luck;
    mon.friendship = data.friendship;
    mon.pauseEvolutions = data.pauseEvolutions;
    mon.pokerus = data.pokerus;
    // Co-op (#633 B2): mirror the host's per-account attribution so the per-player 3-cap, switch
    // legality, and field-slot ownership stay identical on both clients. Never CLEAR a tag with an
    // undefined (a solo-saved mon would have none); only adopt a host-resolved owner. `coopOwner`
    // lives on PlayerPokemon and this reconcile only ever runs on the player party.
    if (data.coopOwner !== undefined) {
      (mon as PlayerPokemon).coopOwner = data.coopOwner;
    }
    mon.metLevel = data.metLevel;
    mon.metBiome = data.metBiome;
    mon.metSpecies = data.metSpecies;
    mon.metWave = data.metWave;
    mon.usedTMs = [...data.usedTMs];
    if (Array.isArray(data.ivs)) {
      mon.ivs = [...data.ivs];
    }
    if (typeof data.nickname === "string") {
      mon.nickname = data.nickname;
    }
    // Moveset: adopt the host's moves + per-slot ppUsed (an ME can teach / overwrite a move).
    if (Array.isArray(data.moveset) && data.moveset.length > 0) {
      mon.moveset = data.moveset.map(m => {
        const pm = new PokemonMove(m.moveId);
        pm.ppUsed = Math.max(0, Math.trunc(m.ppUsed ?? 0));
        pm.ppUp = Math.max(0, Math.trunc(m.ppUp ?? 0));
        return pm;
      });
    }
    // Stats last (uses the now-authoritative level / form / ivs / nature), then hp + status.
    mon.calculateStats();
    if (Array.isArray(data.stats) && data.stats.length > 0) {
      mon.stats = [...data.stats];
    }
    mon.status = data.status
      ? new Status(data.status.effect, data.status.toxicTurnCount, data.status.sleepTurnsRemaining)
      : null;
    mon.hp = Math.max(0, Math.min(Math.trunc(data.hp), mon.getMaxHp()));
    void mon.updateInfo();
  } catch {
    // One mon's reconcile failed; leave it and continue (the checksum re-syncs residual drift).
  }
}

/**
 * HOST (#633 B1/B2/B3 capture handshake): serialize the FULL post-catch player party as
 * {@linkcode PokemonData} JSON. Rides the `waveResolved("capture")` signal so the GUEST - a pure
 * renderer that never runs `AttemptCapturePhase` and so never grows its party on a catch - can
 * reconcile its party to match (add the caught mon, mirror its `coopOwner`, release any party-full
 * casualty) and credit the catch to its OWN gameData. Guarded so a serialize failure is a no-op
 * (the next wave-boundary adopt + per-turn checksum re-sync any residual party drift).
 */
export function captureCoopCaptureParty(): string[] {
  try {
    return globalScene.getPlayerParty().map(p => JSON.stringify(new PokemonData(p)));
  } catch {
    return [];
  }
}

/**
 * GUEST (#633 B1/B2/B3): adopt the host's post-catch player party ({@linkcode captureCoopCaptureParty}).
 * A capture only ever touches the BENCH - it adds the caught mon and, when the catcher's half was
 * full, releases one bench mon; the two on-field leads are never moved. So we reconcile by matching
 * each host mon to an existing LIVE mon by species (+ `coopOwner`), which:
 *  - PRESERVES every unchanged mon's object + its held-item modifiers (a matched reuse, not a rebuild),
 *  - leaves a matched ON-FIELD lead fully untouched (its combat state is owned by the per-turn
 *    checkpoint - we never field-apply or tear down a live field sprite here),
 *  - CONSTRUCTS the genuinely-new caught mon (no live match) with the host-resolved `coopOwner` (B2),
 *  - RELEASES any live BENCH mon the host no longer has (the party-full casualty), never an on-field mon.
 * Each freshly-constructed mon is then credited to the GUEST's OWN `gameData` via `setPokemonCaught`
 * (idempotent on the dex bitfield, #689 "credit both accounts") - silent, since the guest renders the
 * host's catch narration from the battle-event stream, not a second toast. Fully guarded.
 *
 * CAVEAT (pre-existing authoritative-model limitation, not introduced here): `captureParty` carries
 * only `PokemonData`, so the wild mon's transferred held items are NOT synced onto the guest's caught
 * mon at THIS handshake. Mid-battle ON-FIELD held-item drift is now healed via the snapshot path
 * ({@linkcode applyCoopHeldItemsForMon}, #633 RISKY #1/#2/#3); the wild-mon-transfer-at-capture case (the
 * caught mon lands on the bench) remains deferred - it converges at the next wave-boundary adopt.
 */
export function applyCoopCaptureParty(serializedParty: string[]): void {
  if (!Array.isArray(serializedParty) || serializedParty.length === 0) {
    return;
  }
  try {
    const target: PokemonData[] = [];
    for (const s of serializedParty) {
      try {
        target.push(new PokemonData(JSON.parse(s)));
      } catch {
        // A corrupt party blob: do NOTHING rather than half-apply (the wave-boundary adopt re-syncs).
        return;
      }
    }
    const party = globalScene.getPlayerParty();
    const onField = new Set<Pokemon>(globalScene.getPlayerField(false));
    const unclaimed: PlayerPokemon[] = [...party];
    const result: PlayerPokemon[] = [];
    const constructed: PlayerPokemon[] = [];
    for (const t of target) {
      // Prefer a same-species + same-owner live mon (preserves its object + held items); relax to
      // species-only so a give-to-partner re-attribution still matches the same physical mon.
      let idx = unclaimed.findIndex(m => (m.species?.speciesId ?? -1) === t.species && m.coopOwner === t.coopOwner);
      if (idx === -1) {
        idx = unclaimed.findIndex(m => (m.species?.speciesId ?? -1) === t.species);
      }
      if (idx >= 0) {
        const mon = unclaimed.splice(idx, 1)[0];
        // A matched ON-FIELD lead stays untouched (per-turn checkpoint owns its live state); only a
        // BENCH mon is field-applied so its scalar fields + owner match the host.
        if (!onField.has(mon)) {
          applyCoopMeMonFields(mon, t);
        }
        result.push(mon);
      } else {
        // No live match = the freshly caught mon (or an ME gift). Construct it with the host owner.
        try {
          const added = t.toPokemon() as PlayerPokemon;
          if (t.coopOwner !== undefined) {
            added.coopOwner = t.coopOwner;
          }
          added.setVisible(false);
          result.push(added);
          constructed.push(added);
        } catch {
          // One construction failure must not abort the reconcile; the wave-boundary adopt re-syncs.
        }
      }
    }
    // Matched (kept) live mons = everything claimed off `unclaimed` that landed in `result` minus the
    // freshly-constructed ones. Snapshot it before the release pass mutates `result`.
    const keptCount = result.length - constructed.length;
    // Release mons the host no longer has (a party-full release during the catch). NEVER an on-field mon.
    let releasedCount = 0;
    let keptOnFieldSafety = 0;
    for (const m of unclaimed) {
      if (onField.has(m)) {
        result.push(m); // safety: a live on-field mon is never torn down here.
        keptOnFieldSafety++;
      } else {
        coopLog(
          "party",
          `captureParty RELEASE bench sp=${m.species?.speciesId ?? 0} owner=${m.coopOwner} (host dropped it)`,
        );
        globalScene.removePokemonFromPlayerParty(m, true);
        releasedCount++;
      }
    }
    // Rebuild the party in the host's order (the on-field leads stay at the FRONT because the host
    // keeps them there and we iterate `target` in order).
    party.length = 0;
    party.push(...result);
    // B3 (#689): credit the GUEST's OWN gameData for each freshly caught mon - registers the species
    // (caughtAttr + candy + starter unlock), idempotent on the dex bitfield. `showMessage=false`: the
    // guest renders the host's catch narration from the battle-event stream, not a second toast. The
    // `.catch` is REQUIRED - setPokemonCaught is async + fire-and-forget here, so a rejection would
    // escape the surrounding try (which only catches synchronous throws) as an unhandled rejection.
    // We deliberately do NOT call updateSpeciesDexIvs: it routes through validateAchv -> the ER
    // candy-reward + candy-bar UI, side-effects that don't belong on a silent wave-advance reconcile
    // (and the species registration above is what B3 needs; the per-species best-IV record is a
    // non-synced cosmetic dex detail).
    // #801 ROOT (live 'starters still being given to me'): this crediting predates the scoped
    // #794 share and ran for EVERY reconstructed mon - including the PARTNER'S OWN starters and
    // bench whenever the matcher rebuilt them (launch, wave adopts, resyncs) - silently
    // registering the partner's account species onto ours on every session. Credit ONLY mons WE
    // own; a partner's genuine catch reaches this account through the run-scoped dexSync stream.
    // This apply runs ONLY on the authoritative-guest renderer (cycle-free role derivation:
    // importing the controller from coop-runtime here would create an import cycle).
    const localRole: CoopRole = "guest";
    for (const mon of constructed) {
      if ((mon as { coopOwner?: CoopRole }).coopOwner === localRole) {
        // #807 B: crediting our OWN constructed mon is an allowlisted account write.
        void coopAllowAccountWrite("own-adopt-credit", () =>
          globalScene.gameData.setPokemonCaught(mon, true, false, false),
        ).catch(() => {});
      } else {
        coopLog(
          "party",
          `adopt SKIP account credit for partner-owned constructed mon sp=${mon.species?.speciesId} (#801)`,
        );
      }
    }
    coopLog(
      "party",
      `guest applied capture party: ${party.length} mons (kept=${keptCount} added=${constructed.length} released=${releasedCount} onFieldSafety=${keptOnFieldSafety}, host target=${target.length})`,
    );
  } catch {
    // A malformed capture party must never crash the guest's run.
  }
}

/**
 * HOST: capture the comprehensive non-battle-ME terminal resync (#633, P4). Bundles the existing
 * full-battle snapshot (field / arena / money / modifier counts), the FULL per-mon party as
 * serialized {@linkcode PokemonData} JSON, the ME-save tier-weighting events, the run-RNG cursor
 * (`seed` / `waveSeed`), and the bigint-safe dex / starter blob. ME-terminal-only - it does NOT
 * bloat the per-turn snapshot. The guest adopts it via {@linkcode applyCoopMeOutcome}.
 */
export function captureCoopMeOutcome(): Extract<CoopInteractionOutcome, { k: "meResync" }> {
  return {
    k: "meResync",
    base: captureCoopFullSnapshot(),
    party: globalScene.getPlayerParty().map(p => JSON.stringify(new PokemonData(p))),
    meSaveData: JSON.stringify(globalScene.mysteryEncounterSaveData.encounteredEvents),
    seed: globalScene.seed,
    waveSeed: globalScene.waveSeed,
    dex: captureCoopDexDelta(),
    // #838 UNIFY: the id-based authoritative full-state (captured off-field too, unlike `base` which is
    // null with no live field). The guest adopts THIS instead of the species-based `party` reconcile.
    // Balls stripped (#843) - the ME terminal is a crossing context, so balls stay per-turn-only.
    authoritativeState: captureCoopResyncAuthoritativeState(),
  };
}

/**
 * GUEST: adopt the host's comprehensive ME-terminal resync (#633, P4). #838 UNIFY: a modern host carries
 * the id-based authoritative full-state, so the guest converges the party / field / arena / modifiers /
 * ER substrates through {@linkcode applyCoopAuthoritativeBattleState} (mutate-in-place by `Pokemon.id`) -
 * the same apply the live turns use - instead of the legacy species-based party reconcile. It then
 * replaces the ME-save events wholesale (plain data), restores the RNG cursor so the guest's seed pointer
 * matches after the host alone consumed `randSeedInt`, and merges the dex / starter blob. `authoritativeGuest`
 * is passed `true` (applyCoopMeOutcome is definitionally the guest adopting the host's terminal, so no
 * runtime import is needed to compute the gate), so the full held-item / enemy-boss reconcile that the old
 * `base`-with-false path deferred now runs here. Falls back to `base` + the species party apply only for an
 * older host that omits `authoritativeState`. Fully guarded as a WHOLE so a partial-blob apply can never
 * hang or crash the guest - the per-turn checksum re-syncs any residual drift.
 */
function applyCoopMeOutcomeUnchecked(
  o: Extract<CoopInteractionOutcome, { k: "meResync" }>,
  rollbackReassert = false,
): void {
  // #838 UNIFY: a modern host carries the id-based authoritative full-state (captured off-field too).
  // Adopt it via the SAME apply the live turns use - mutate-in-place by Pokemon.id, reconstruct/remove
  // by id, adopt host party order - replacing the legacy species-based `applyCoopMePartyFromData` + the
  // `base` species-order/benchParty heal. authoritativeGuest=true: applyCoopMeOutcome is definitionally
  // the GUEST adopting the host's ME terminal (no runtime import needed to know that), so the full
  // modifier / enemy-boss reconcile runs. Falls back to base + species party only for an older host.
  if (o.authoritativeState === undefined) {
    if (o.base != null) {
      applyCoopFullSnapshot(o.base);
    }
    applyCoopMePartyFromData(o.party);
  } else {
    const applied = rollbackReassert
      ? applyCoopAuthoritativeBattleStateInternal(o.authoritativeState, true, true, true)
      : applyCoopAuthoritativeBattleState(o.authoritativeState, true);
    const structuredFailures = drainCoopApplyFailures();
    if (!applied || structuredFailures.length > 0) {
      throw new Error(
        applied
          ? `authoritative Mystery state reported ${structuredFailures.length} structured failure(s)`
          : "authoritative Mystery state refused",
      );
    }
  }
  // mysteryEncounterSaveData: replace encounteredEvents wholesale (it is plain data).
  if (typeof o.meSaveData === "string" && o.meSaveData.length > 0) {
    globalScene.mysteryEncounterSaveData.encounteredEvents = JSON.parse(o.meSaveData);
  }
  // RNG cursor: restore so the guest's seed pointer matches after the host alone advanced it.
  if (typeof o.seed === "string") {
    globalScene.setSeed(o.seed);
  }
  if (typeof o.waveSeed === "string") {
    globalScene.waveSeed = o.waveSeed;
    Phaser.Math.RND.sow([o.waveSeed]);
  }
  applyCoopDexDelta(o.dex);
}

let coopMeOutcomeRollbackFatal = false;

export function consumeCoopMeOutcomeRollbackFatal(): boolean {
  const fatal = coopMeOutcomeRollbackFatal;
  coopMeOutcomeRollbackFatal = false;
  return fatal;
}

export function applyCoopMeOutcome(o: Extract<CoopInteractionOutcome, { k: "meResync" }>): boolean {
  coopMeOutcomeRollbackFatal = false;
  let rollback: Extract<CoopInteractionOutcome, { k: "meResync" }>;
  const priorTickCounter = coopStateTickCounter;
  const priorLastAppliedTick = coopLastAppliedStateTick;
  try {
    rollback = captureCoopMeOutcome();
  } catch {
    return false;
  }
  try {
    applyCoopMeOutcomeUnchecked(o);
    // Capturing the rollback is observational on the receiver; do not advance its producer-side tick.
    coopStateTickCounter = priorTickCounter;
    return true;
  } catch {
    // A terminal image is a transaction: an exception cannot leave a partially-applied DATA image while
    // the exact terminal remains held. Best-effort restore is followed by a false result, which withholds
    // the journal ACK and terminal materialization so durability can retry or terminate the shared session.
    let rollbackApplied = false;
    try {
      applyCoopMeOutcomeUnchecked(rollback, true);
      rollbackApplied = true;
    } catch {
      // The caller will fail the shared session; there is no safe terminal wake-up after rollback failure.
    }
    coopMeOutcomeRollbackFatal = !rollbackApplied;
    coopStateTickCounter = priorTickCounter;
    coopLastAppliedStateTick = priorLastAppliedTick;
    return false;
  }
}
