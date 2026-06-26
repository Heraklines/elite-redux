/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op AUTHORITATIVE mystery-encounter BATTLE HANDOFF (#633).
//
// THE PROBLEM: a mystery encounter whose option spawns a battle is owner-ALTERNATED
// for the interaction (the owner picks the option), but the SPAWNED BATTLE must always
// be HOST-AUTHORITATIVE (the host runs it, the guest replays it via the existing battle
// path). In the old "both clients run the ME engine + the watcher replays the owner's
// button stream" design the watcher (host) STALLED at the encounter -> battle boundary:
// the owner's button stream dries up there (the owner forks into the spawned battle and
// parks in CoopReplayTurnPhase instead of pressing on), so the watcher never reached the
// battle -> deadlock.
//
// THE HANDOFF: at the single chokepoint every ME-spawned battle funnels through
// (`initBattleWithEnemyConfig`), the HOST serializes the just-generated boss party and
// STREAMS it keyed by the ME interaction; the GUEST (which forwarded its option pick when
// it owned the ME) DISCARDS its own locally-rolled party and ADOPTS the host's verbatim.
// Both then fall into the existing host-drives / guest-replays battle path. So the spawned
// boss is identical on both clients and the battle is host-authoritative REGARDLESS of who
// owned the encounter.
//
// This module is the ENGINE-FREE key helper (so the transport + tests can depend on it
// without dragging in globalScene). The engine-coupled capture/adopt lives in
// `coop-runtime.ts` (`coopHandoffMeBattle`).
// =============================================================================

import { coopLog } from "#data/elite-redux/coop/coop-debug";

/**
 * The stream key for an ME-spawned battle's enemy party. An ME battle spawns MID-wave from
 * an option pick (NOT at the wave's starting encounter), so `enemyPartySync`'s plain
 * waveIndex key would collide with the wave's own encounter party and with a SECOND ME
 * battle in the same wave. Key it by BOTH the wave AND the ME interaction counter (the
 * value the alternation counter held when the ME opened - pinned identically on both
 * clients), so each ME battle has a unique, stable key both clients agree on.
 */
export function meBattleHandoffKey(waveIndex: number, meInteractionCounter: number): string {
  const key = `me:${waveIndex}:${meInteractionCounter}`;
  // Per ME-spawned battle (not hot): log the derived stream key so a host-capture / guest-adopt of
  // an ME battle can be paired (both clients must agree on this key for the handoff to land).
  coopLog("me", `meBattleHandoffKey wave=${waveIndex} meCounter=${meInteractionCounter} -> key=${key}`);
  return key;
}
