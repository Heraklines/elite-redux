/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op live-party operations (#633, co-op mode - phase P3).
//
// The engine-coupled side of the co-op ownership model: the few operations that
// have to touch the live `globalScene` player party. Kept here (NOT in the
// engine-free coop-session.ts) so the pure ownership rules stay headlessly
// unit-testable, while these thin wrappers apply them to the real party array.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { type CoopGiveResult, coopGiveToPartner, coopInterleaveOrder } from "#data/elite-redux/coop/coop-session";
import type { PlayerPokemon } from "#field/pokemon";

/**
 * Re-order the live player party into interleaved owner order (host0, guest0,
 * host1, ...) so the two double leads (party[0]/party[1]) stay host / guest
 * respectively - the field-slot ownership invariant. No-op outside co-op.
 */
export function coopReorderParty(): void {
  if (!globalScene.gameMode.isCoop) {
    return;
  }
  const party = globalScene.getPlayerParty();
  const ordered = coopInterleaveOrder(party);
  party.length = 0;
  party.push(...ordered);
}

/**
 * Give a co-op mon to the partner (#633, P3): validate the transfer, flip the
 * mon's `coopOwner`, then re-order the party so the field leads stay correct.
 * Returns the validation result; on `ok` the mon now belongs to the other
 * player's half (and counts against THEIR 3-mon cap). A no-op (returns the
 * rejection) when the transfer is illegal - partner full, or the giver's last mon.
 */
export function coopGiveMonToPartner(mon: PlayerPokemon): CoopGiveResult {
  const result = coopGiveToPartner(globalScene.getPlayerParty(), mon.coopOwner);
  if (!result.ok) {
    return result;
  }
  mon.coopOwner = mon.coopOwner === "host" ? "guest" : "host";
  coopReorderParty();
  return result;
}
