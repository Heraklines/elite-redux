/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TELEMETRY STATE SNAPSHOT (#player-telemetry). PURE feature extraction: turn a live field mon into a
// serializable {@link TelemetryMonState} and a pair of field arrays into a {@link TelemetryBattleState}.
//
// It reads a mon through a MINIMAL STRUCTURAL interface ({@link TelemetryMonSource}) that the real
// `Pokemon` satisfies, so this module has NO runtime dependency on the engine and unit-tests with plain
// object fakes (no GameManager, no globalScene). Every field read is defensive: a telemetry snapshot must
// NEVER throw into the caller (telemetry can't affect gameplay), so an accessor that is missing or throws
// yields a safe default rather than propagating.
// =============================================================================

import type {
  TelemetryActor,
  TelemetryBattleState,
  TelemetryMonState,
  TelemetryMoveState,
} from "#data/elite-redux/telemetry/telemetry-schema";

/** The minimal move view the snapshot reads (a real `PokemonMove` satisfies it). */
export interface TelemetryMoveSource {
  moveId: number;
  ppUsed: number;
  getMove(): { type: number; power: number };
  getMovePp(): number;
}

/** The minimal mon view the snapshot reads (a real `Pokemon` satisfies it structurally). */
export interface TelemetryMonSource {
  species: { speciesId: number };
  formIndex: number;
  level: number;
  hp: number;
  getMaxHp(): number;
  status: { effect: number } | null;
  getStatStages(): number[];
  getAbility(): { id: number };
  getPassiveAbilities?(): readonly ({ id: number } | null)[];
  getHeldItems(): { type: { id: string } }[];
  getMoveset(): (TelemetryMoveSource | null | undefined)[];
  isActive(includeSwitching?: boolean): boolean;
}

/** Run `fn`, returning `fallback` on any throw. Keeps a snapshot total (telemetry must never break play). */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Featurize one move. */
export function snapshotMove(m: TelemetryMoveSource): TelemetryMoveState {
  const move = safe(() => m.getMove(), { type: -1, power: 0 });
  return {
    move: m.moveId,
    type: move.type ?? -1,
    power: move.power ?? 0,
    ppUsed: m.ppUsed ?? 0,
    maxPp: safe(() => m.getMovePp(), 0),
  };
}

/**
 * Snapshot one field mon into its ML state. `actor` (co-op ownership) is stamped only when provided.
 * Every read is guarded so a partially-initialized mon never throws.
 */
export function snapshotMon(mon: TelemetryMonSource, actor?: TelemetryActor): TelemetryMonState {
  const maxHp = safe(() => mon.getMaxHp(), 0);
  const hp = mon.hp ?? 0;
  const innates = safe(
    () => (mon.getPassiveAbilities?.() ?? []).map(a => (a == null ? null : (a.id ?? null))),
    [] as (number | null)[],
  );
  const heldItems = safe(() => mon.getHeldItems().map(h => h.type.id), [] as string[]);
  const moves = safe(
    () =>
      mon
        .getMoveset()
        .filter((m): m is TelemetryMoveSource => m != null)
        .map(snapshotMove),
    [] as TelemetryMoveState[],
  );
  const state: TelemetryMonState = {
    species: safe(() => mon.species.speciesId, -1),
    form: mon.formIndex ?? 0,
    level: mon.level ?? 0,
    hp,
    maxHp,
    status: safe(() => mon.status?.effect ?? null, null),
    statStages: safe(() => [...mon.getStatStages()], []),
    ability: safe(() => mon.getAbility().id, -1),
    innates,
    heldItems,
    moves,
    active: safe(() => mon.isActive(true), false),
    fainted: hp <= 0,
  };
  if (actor !== undefined) {
    state.actor = actor;
  }
  return state;
}

/** Context that anchors a field snapshot in the run (read by the caller from globalScene). */
export interface TelemetryFieldContext {
  wave: number;
  biome: number;
  turn: number;
  weather: number | null;
  terrain: number | null;
}

/**
 * Snapshot both sides' field into a {@link TelemetryBattleState} - the "state" half of a (state, action)
 * training pair. `ownerOf` (optional) resolves the co-op actor for a player-side mon.
 */
export function snapshotBattleState(
  playerField: readonly TelemetryMonSource[],
  enemyField: readonly TelemetryMonSource[],
  ctx: TelemetryFieldContext,
  ownerOf?: (mon: TelemetryMonSource) => TelemetryActor | undefined,
): TelemetryBattleState {
  return {
    wave: ctx.wave,
    biome: ctx.biome,
    turn: ctx.turn,
    weather: ctx.weather,
    terrain: ctx.terrain,
    player: playerField.map(m => snapshotMon(m, ownerOf?.(m))),
    enemy: enemyField.map(m => snapshotMon(m)),
  };
}
