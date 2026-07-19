/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// AUTHORITY V2 - canonical human command-frontier extraction.
//
// The authoritative state already names every field actor by canonical battler
// index, stable Pokemon id, and (for human-controlled seats) stable numeric seat
// ownership. Both ordinary turn commits and post-replacement commits MUST derive
// their next command frontier through this one pure mapper. Keeping separate
// player-side filters made Showdown's remote human (the authoritative enemy side)
// silently disappear and forced the next turn back onto the legacy relay.
//
// Engine-free: state + wire contract types only. AI enemies carry no owner and
// are omitted. A player-side actor is always human and therefore becomes a loud
// unresolved result when ownership is missing. An explicitly-owned enemy actor
// is human too (Showdown); an unowned enemy remains AI.
// =============================================================================

import type { CoopCommandControlTarget } from "#data/elite-redux/coop/authority-v2/contract";
import type { CoopAuthoritativeBattleStateV1, CoopAuthoritativeFieldSeat } from "#data/elite-redux/coop/coop-transport";

export interface CoopCommandFrontierIssue {
  readonly seat: CoopAuthoritativeFieldSeat;
  readonly reason: "missing-owner" | "invalid-pokemon-id" | "invalid-field-index";
}

export interface CoopCommandFrontierResolution {
  readonly commands: readonly CoopCommandControlTarget[];
  readonly unresolved: readonly CoopCommandFrontierIssue[];
}

export interface CoopShowdownCommandProofInput {
  readonly localRole: "host" | "guest";
  readonly localSide: "player" | "enemy";
  readonly fieldIndex: number;
  readonly pokemonId: number;
  readonly enemyOffset: number;
  readonly hostSeatId: number;
  readonly guestSeatId: number;
}

function roleSeatId(seat: CoopAuthoritativeFieldSeat): number | null {
  if (Number.isSafeInteger(seat.ownerSeatId) && (seat.ownerSeatId as number) >= 0) {
    return seat.ownerSeatId as number;
  }
  if (seat.owner === "host") {
    return 0;
  }
  if (seat.owner === "guest") {
    return 1;
  }
  return null;
}

function seatHp(state: CoopAuthoritativeBattleStateV1, seat: CoopAuthoritativeFieldSeat): number | null {
  const party = seat.side === "player" ? state.playerParty : state.enemyParty;
  // Identity is the protocol address. Party index is only a compatibility fallback for older complete
  // carriers that omitted an `id` field; a transient array transposition must never read another mon's HP.
  const partyIndexRecord = party[seat.partyIndex];
  const record =
    party.find(mon => mon?.id === seat.pokemonId) ?? (partyIndexRecord?.id == null ? partyIndexRecord : undefined);
  const hp = record?.hp;
  return typeof hp === "number" && Number.isFinite(hp) ? hp : null;
}

function isHumanSeat(seat: CoopAuthoritativeFieldSeat): boolean {
  // Every player-side field actor is human in classic co-op and Showdown. Enemy-side actors are AI unless
  // the carrier explicitly stamps participant ownership (Showdown's remote human side).
  return seat.side === "player" || seat.ownerSeatId != null || seat.owner === "host" || seat.owner === "guest";
}

/**
 * Extract every living human command actor from one authoritative carrier.
 *
 * Unknown HP remains legacy-compatible/fail-open: complete current carriers always include it, while an
 * older compatible carrier may not. A known fainted actor is excluded; the caller's immediate-successor
 * predicate still decides whether the whole boundary is commandable or must cross replacement/terminal.
 */
export function resolveCoopV2CommandFrontier(state: CoopAuthoritativeBattleStateV1): CoopCommandFrontierResolution {
  const commands: CoopCommandControlTarget[] = [];
  const unresolved: CoopCommandFrontierIssue[] = [];
  const seats = [...state.field].filter(isHumanSeat).sort((left, right) => left.bi - right.bi);

  for (const seat of seats) {
    if ((seatHp(state, seat) ?? 1) <= 0) {
      continue;
    }
    if (!Number.isSafeInteger(seat.pokemonId) || seat.pokemonId <= 0) {
      unresolved.push({ seat, reason: "invalid-pokemon-id" });
      continue;
    }
    if (!Number.isSafeInteger(seat.bi) || seat.bi < 0) {
      unresolved.push({ seat, reason: "invalid-field-index" });
      continue;
    }
    const ownerSeatId = roleSeatId(seat);
    if (ownerSeatId == null) {
      unresolved.push({ seat, reason: "missing-owner" });
      continue;
    }
    commands.push({ ownerSeatId, pokemonId: seat.pokemonId, fieldIndex: seat.bi });
  }

  return { commands, unresolved };
}

/**
 * Reflect one real local Showdown command phase back into host-canonical protocol coordinates.
 *
 * The host's scene is already canonical. The guest holds a reflected world in which local player is
 * canonical enemy and local enemy is canonical player. Reject every malformed/ambiguous axis instead of
 * manufacturing a receipt that could retire another actor's control.
 */
export function resolveCoopV2ShowdownCommandProof(
  input: CoopShowdownCommandProofInput,
): CoopCommandControlTarget | null {
  if (
    !Number.isSafeInteger(input.fieldIndex)
    || input.fieldIndex < 0
    || !Number.isSafeInteger(input.pokemonId)
    || input.pokemonId <= 0
    || !Number.isSafeInteger(input.enemyOffset)
    || input.enemyOffset <= 0
    || !Number.isSafeInteger(input.hostSeatId)
    || input.hostSeatId < 0
    || !Number.isSafeInteger(input.guestSeatId)
    || input.guestSeatId < 0
    || input.hostSeatId === input.guestSeatId
  ) {
    return null;
  }
  const canonicalSide =
    input.localRole === "guest" ? (input.localSide === "player" ? "enemy" : "player") : input.localSide;
  return {
    ownerSeatId: canonicalSide === "player" ? input.hostSeatId : input.guestSeatId,
    pokemonId: input.pokemonId,
    fieldIndex: canonicalSide === "player" ? input.fieldIndex : input.enemyOffset + input.fieldIndex,
  };
}
