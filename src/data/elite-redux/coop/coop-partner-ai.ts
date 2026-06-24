/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op partner command auto-resolve (#633, P2).
//
// In the co-op forced-double, the LOCAL human only ever drives their OWN field
// slot; the PARTNER's slot is auto-resolved and never shown. In the current
// local/spoof path the partner is a bot, so its command is picked by a small,
// self-contained AI here. A real REMOTE partner sends its command over the
// transport in phase P6 - and this function's shape (a partner mon in, a
// command-shaped {@linkcode ResolvedPartnerCommand} out) is exactly the seam that
// inbound `command` transport message will resolve into instead, so the
// CommandPhase call site does not change when P6 lands.
//
// Pure-ish: depends only on the passed `PlayerPokemon` + `globalScene` (for the
// seeded battle RNG + the live field), never on co-op session/transport state, so
// it is independently testable. NO new behavior leaks outside a co-op run because
// the only caller is gated behind `globalScene.gameMode.isCoop`.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { EncoreTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import type { SerializedCommand } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { getMoveTargets } from "#moves/move-utils";
import type { TurnMove } from "#types/turn-move";

/** A partner command resolved for one field slot, shaped for `CommandPhase.handleCommand`. */
export interface ResolvedPartnerCommand {
  command: Command.FIGHT;
  /** Index of the chosen move in the partner's moveset, or -1 for Struggle. */
  moveIndex: number;
  /** The full move record (move + resolved targets + use mode) the engine reuses. */
  turnMove: TurnMove;
}

/**
 * Resolve a single concrete target list for `moveId` used by `partner`, mirroring
 * the legal-target resolution the engine uses for a player move: forward the WHOLE
 * set for a spread/multi move, pick ONE candidate (seeded) for a single-target
 * move, fall back to the attacker for counter moves with no target, else empty.
 */
function resolvePartnerTargets(partner: PlayerPokemon, moveId: MoveId): BattlerIndex[] {
  const moveTargets = getMoveTargets(partner, moveId);
  const candidates = globalScene
    .getField(true)
    .filter(p => moveTargets.targets.indexOf(p.getBattlerIndex()) > -1)
    .map(p => p.getBattlerIndex());

  // Spread / multi-target: every legal target is hit.
  if (moveTargets.multiple) {
    return candidates;
  }

  if (candidates.length === 0) {
    // Counter moves resolve to the attacker, same as the engine's player path.
    if (allMoves[moveId].hasAttr("CounterDamageAttr")) {
      return [BattlerIndex.ATTACKER];
    }
    return [];
  }

  // Single-target with multiple candidates (e.g. a foe + the ally in a double):
  // pick one with the SEEDED battle RNG so runs stay replay-consistent.
  return [candidates[globalScene.randBattleSeedInt(candidates.length)]];
}

/**
 * Auto-pick a legal FIGHT command for the co-op partner mon `partner`.
 *
 * Honors an active Encore (only the encored move is legal), then picks a random
 * USABLE move from the partner's moveset (same usability predicate the engine's
 * own AI uses), falling back to Struggle when nothing is usable. Targets are
 * resolved through {@linkcode resolvePartnerTargets}. Any already-queued/charging
 * move is consumed by `CommandPhase.tryExecuteQueuedMove()` BEFORE this runs, so
 * this only ever handles the fresh-pick case.
 *
 * Uses the seeded `randBattleSeedInt`, never `Math.random`, so a co-op run replays
 * deterministically.
 */
export function resolvePartnerCommand(partner: PlayerPokemon): ResolvedPartnerCommand {
  const moveset = partner.getMoveset();
  const usable = moveset.filter(m => m.isUsable(partner, false, true)[0]);

  let chosen = usable.length > 0 ? usable[globalScene.randBattleSeedInt(usable.length)] : undefined;

  // Encore: if the partner is encored into a still-usable move, it is the ONLY
  // legal choice. (The usability filter alone does not enforce Encore.)
  const encoreTag = partner.getTag(EncoreTag);
  if (encoreTag) {
    const encored = usable.find(m => m.moveId === encoreTag.moveId);
    if (encored) {
      chosen = encored;
    }
  }

  if (chosen === undefined) {
    // No usable move -> Struggle, targets resolved like the engine's own fallback.
    return {
      command: Command.FIGHT,
      moveIndex: -1,
      turnMove: {
        move: MoveId.STRUGGLE,
        targets: resolvePartnerTargets(partner, MoveId.STRUGGLE),
        useMode: MoveUseMode.NORMAL,
      },
    };
  }

  const moveIndex = moveset.findIndex(m => m.moveId === chosen!.moveId);
  return {
    command: Command.FIGHT,
    moveIndex,
    turnMove: {
      move: chosen.moveId,
      targets: resolvePartnerTargets(partner, chosen.moveId),
      useMode: MoveUseMode.NORMAL,
    },
  };
}

/**
 * Build a partner command for a SPECIFIC move slot - the choice a remote partner
 * (real guest, or the SpoofGuest) sent back over the transport (#633, LIVE-C).
 * The host stays authoritative: it re-validates the peer's pick (slot in range +
 * the move actually usable) and, if it isn't legal, re-picks locally via
 * {@linkcode resolvePartnerCommand} - so a bad/stale wire choice can never produce
 * an illegal turn. Targets are resolved host-side exactly like the AI path.
 */
export function resolvePartnerSlotCommand(partner: PlayerPokemon, slot: number): ResolvedPartnerCommand {
  const moveset = partner.getMoveset();
  const move = slot >= 0 && slot < moveset.length ? moveset[slot] : undefined;
  if (move == null || !move.isUsable(partner, false, true)[0]) {
    return resolvePartnerCommand(partner);
  }
  return {
    command: Command.FIGHT,
    moveIndex: slot,
    turnMove: {
      move: move.moveId,
      targets: resolvePartnerTargets(partner, move.moveId),
      useMode: MoveUseMode.NORMAL,
    },
  };
}

/**
 * Apply a partner's command received over the transport in LOCKSTEP (#633, LIVE-C),
 * EXACTLY as the partner chose - the key to two engines staying in sync:
 *  - the move is matched by MOVE ID, not the wire `cursor` index, because the two
 *    clients' movesets can be ordered differently (index N != the same move), which
 *    was making the partner use the wrong move (e.g. Sappy Seed vs Vine Whip);
 *  - the partner's EXACT `targets` are used verbatim - NO seeded `randBattleSeedInt`
 *    re-roll - so both engines consume the shared battle-RNG stream identically
 *    (a host-side re-roll here shifted the stream and desynced damage/crits/faints).
 * Returns `null` if the move can't be found in this client's moveset (caller then
 * falls back to the AI picker so the turn never stalls).
 */
export function applyWiredPartnerCommand(
  partner: PlayerPokemon,
  cmd: SerializedCommand,
): ResolvedPartnerCommand | null {
  const moveset = partner.getMoveset();
  let moveIndex = -1;
  if (cmd.moveId != null && cmd.moveId !== MoveId.NONE) {
    moveIndex = moveset.findIndex(m => m.moveId === cmd.moveId);
  }
  if (moveIndex < 0 && cmd.cursor >= 0 && cmd.cursor < moveset.length) {
    moveIndex = cmd.cursor;
  }
  const move = moveIndex >= 0 ? moveset[moveIndex] : undefined;
  if (move == null) {
    return null;
  }
  // Use the partner's wired targets verbatim; only resolve host-side if none came.
  const targets =
    cmd.targets === undefined ? resolvePartnerTargets(partner, move.moveId) : (cmd.targets as BattlerIndex[]);
  // `useMode` crosses the wire as a raw number; it IS a MoveUseMode enum value.
  const useMode = (cmd.useMode ?? MoveUseMode.NORMAL) as MoveUseMode;
  return {
    command: Command.FIGHT,
    moveIndex,
    turnMove: { move: move.moveId, targets, useMode },
  };
}
