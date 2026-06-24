/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op starter-select roster + budget model (#633, co-op mode - phase P1).
//
// Pure logic - NO game-engine imports - so the two co-op starter-select rules
// are unit-testable headlessly and shared by every layer that needs them:
//   1. BUDGET: each player independently has COOP_STARTER_COST_BUDGET (5) starter
//      points, NOT the single 10/15 pool of solo modes. (`getValueLimit()` is the
//      solo path; co-op asks this model instead.)
//   2. CAP: each player may bring at most COOP_SLOTS_PER_PLAYER (3) Pokemon. The
//      same predicate (`isFull`) gates "can't catch when your half is full" later
//      in the run - the in-run party-cap and the starter-select cap are one rule.
//
// The two players' picks land in the single shared 6-slot party PARTITIONED by
// owner (host = party slots 0..2, guest = 3..5) per the coop-session ownership
// model, so `toMergedParty()` yields the launch order the run is built from.
// =============================================================================

import { COOP_SLOTS_PER_PLAYER, coopPartySlotRange } from "#data/elite-redux/coop/coop-session";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

/** Each player's starter-point budget in co-op (vs. the solo 10/15 pool). */
export const COOP_STARTER_COST_BUDGET = 5;

/**
 * A single tentative starter pick during co-op selection. Deliberately minimal -
 * the model only needs the species (identity / de-dupe) and its starter-point
 * `cost` to enforce the budget. The full {@linkcode Starter} struct (form, gender,
 * ability index, ivs, nature, ...) is assembled by the UI layer at launch from
 * these picks; keeping this struct engine-free is what makes the rules testable.
 */
export interface CoopRosterEntry {
  /** `SpeciesId` (or `ErSpeciesId`) of the pick. */
  speciesId: number;
  /** Starter-point cost (`gameData.getSpeciesStarterValue(speciesId)`). */
  cost: number;
}

/** Why a pick was rejected, or `ok` when it is allowed. */
export type CoopRosterResult =
  | { ok: true }
  /** The player already holds {@linkcode COOP_SLOTS_PER_PLAYER} Pokemon. */
  | { ok: false; reason: "full" }
  /** Adding the pick would exceed {@linkcode COOP_STARTER_COST_BUDGET}. */
  | { ok: false; reason: "budget" }
  /** The player already picked this species (no dupes within one player's half). */
  | { ok: false; reason: "duplicate" };

/**
 * Both players' tentative rosters during co-op starter select. Enforces the
 * per-player 3-mon cap + 5-point budget and assembles the merged launch party.
 * Pure state - the transport syncs picks by replaying `add`/`remove` on each
 * side, so both clients converge on identical rosters.
 */
export class CoopRoster {
  private readonly picks: Record<CoopRole, CoopRosterEntry[]> = { host: [], guest: [] };

  /** This player's current picks, in selection order. */
  entries(role: CoopRole): readonly CoopRosterEntry[] {
    return this.picks[role];
  }

  /** How many Pokemon this player has chosen. */
  count(role: CoopRole): number {
    return this.picks[role].length;
  }

  /** Starter points this player has spent. */
  spent(role: CoopRole): number {
    return this.picks[role].reduce((sum, e) => sum + e.cost, 0);
  }

  /** Starter points this player has left. */
  remaining(role: CoopRole): number {
    return COOP_STARTER_COST_BUDGET - this.spent(role);
  }

  /** Whether this player's half of the party is full (the catch-gate predicate). */
  isFull(role: CoopRole): boolean {
    return this.picks[role].length >= COOP_SLOTS_PER_PLAYER;
  }

  /** Whether this player already chose `speciesId`. */
  has(role: CoopRole, speciesId: number): boolean {
    return this.picks[role].some(e => e.speciesId === speciesId);
  }

  /**
   * Whether `role` could add a pick of `cost` (and optional `speciesId` for the
   * dupe check) right now, WITHOUT mutating. The UI uses this to grey out / reject
   * selections before committing them.
   */
  canAdd(role: CoopRole, cost: number, speciesId?: number): CoopRosterResult {
    if (this.isFull(role)) {
      return { ok: false, reason: "full" };
    }
    if (speciesId != null && this.has(role, speciesId)) {
      return { ok: false, reason: "duplicate" };
    }
    if (cost > this.remaining(role)) {
      return { ok: false, reason: "budget" };
    }
    return { ok: true };
  }

  /** Add a pick for `role`, enforcing cap + budget + dupe. No-op on rejection. */
  add(role: CoopRole, entry: CoopRosterEntry): CoopRosterResult {
    const check = this.canAdd(role, entry.cost, entry.speciesId);
    if (check.ok) {
      this.picks[role].push({ speciesId: entry.speciesId, cost: entry.cost });
    }
    return check;
  }

  /**
   * Replace ALL of this player's picks at once. Used to apply a synced snapshot
   * from the partner (each player edits their OWN half on their OWN screen, then
   * the whole half is mirrored over the transport) or to re-apply the local
   * player's edited selection. Each entry is re-validated against cap/budget/dupe;
   * returns the accepted set (entries a rule drops are omitted).
   */
  replace(role: CoopRole, entries: readonly CoopRosterEntry[]): CoopRosterEntry[] {
    this.picks[role].length = 0;
    for (const e of entries) {
      this.add(role, e);
    }
    return [...this.picks[role]];
  }

  /** Remove this player's pick of `speciesId`. Returns whether one was removed. */
  remove(role: CoopRole, speciesId: number): boolean {
    const list = this.picks[role];
    const idx = list.findIndex(e => e.speciesId === speciesId);
    if (idx < 0) {
      return false;
    }
    list.splice(idx, 1);
    return true;
  }

  /** Whether BOTH players have chosen at least one Pokemon (min to launch). */
  bothReady(): boolean {
    return this.count("host") > 0 && this.count("guest") > 0;
  }

  /**
   * The merged 6-slot launch party: host picks fill party slots 0..2, guest picks
   * fill 3..5 (the {@linkcode coopPartySlotRange} partition), each in selection
   * order; empty slots are `null`. The run is built by dropping the nulls and
   * launching the remaining Pokemon in this order.
   */
  toMergedParty(): (CoopRosterEntry | null)[] {
    const party: (CoopRosterEntry | null)[] = new Array(COOP_SLOTS_PER_PLAYER * 2).fill(null);
    for (const role of ["host", "guest"] as const) {
      const { start } = coopPartySlotRange(role);
      this.picks[role].forEach((entry, i) => {
        party[start + i] = entry;
      });
    }
    return party;
  }
}
