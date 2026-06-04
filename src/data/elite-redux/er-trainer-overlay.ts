// =============================================================================
// Elite Redux Phase D2 — trainer-overlay helper.
//
// B4 built `ER_TRAINER_REGISTRY` + `ER_TRAINER_BY_KEY`. This module exposes
// a small consumption API used by ER-aware battle code to substitute an ER
// roster into pokerogue's trainer system at encounter-spawn time.
//
// Design: the overlay is OPT-IN — vanilla pokerogue's encounter generation
// remains unchanged. ER-aware callers query the overlay by trainer name or
// trainer-type and pull the appropriate roster (party / insaneParty /
// hellParty) for the current encounter.
//
// Full runtime integration with pokerogue's `Trainer` constructor /
// `TrainerConfig.setPartyMemberFunc` is deferred — this helper is the
// callable utility for that integration when the encounter-API surface is
// understood and stable.
// =============================================================================

import { ER_TRAINER_BY_KEY, ER_TRAINER_REGISTRY } from "#data/elite-redux/init-elite-redux-trainers";
import type { ErPartyMemberRegistered, ErTrainerRegistryEntry } from "#data/elite-redux/init-elite-redux-trainers";

/** Which tier of an ER trainer's roster to use for an encounter. */
export type ErRosterTier = "party" | "insane" | "hell";

/**
 * Look up an ER trainer by its stable name (e.g. "May Route 103 Treecko").
 * Returns `undefined` if no ER trainer with this name was registered.
 */
export function getErTrainerByKey(stableKey: string): ErTrainerRegistryEntry | undefined {
  return ER_TRAINER_BY_KEY.get(stableKey);
}

/**
 * Return every ER trainer whose `trainerType` matches the given pokerogue
 * `TrainerType` numeric id. Useful for pool-based encounter generation
 * where pokerogue picks a trainer by type and the ER-aware layer wants
 * to substitute one of the ER rosters that maps to the same type.
 *
 * Returns a fresh array each call (filtered view of the registry); callers
 * should NOT mutate it.
 */
export function findErTrainersForType(trainerType: number): readonly ErTrainerRegistryEntry[] {
  return ER_TRAINER_REGISTRY.filter(t => t.trainerType === trainerType);
}

/**
 * Select an ER roster for a given encounter tier. Falls back through
 * tiers when the requested one is empty:
 *   - tier "hell" → falls back to "insane" → falls back to "party"
 *   - tier "insane" → falls back to "party"
 *   - tier "party" → always returns party (always populated for any
 *     trainer that's in the registry)
 *
 * Returns the party array (always non-empty for a registered trainer).
 */
export function selectErRoster(
  trainer: ErTrainerRegistryEntry,
  tier: ErRosterTier,
): readonly ErPartyMemberRegistered[] {
  if (tier === "hell" && trainer.hellParty && trainer.hellParty.length > 0) {
    return trainer.hellParty;
  }
  if ((tier === "hell" || tier === "insane") && trainer.insaneParty && trainer.insaneParty.length > 0) {
    return trainer.insaneParty;
  }
  return trainer.party;
}

/**
 * Convenience: pick the FIRST ER trainer for a given trainerType + tier.
 * Returns null if no ER trainer maps to this type. Phase D2 callers can
 * use this for a "deterministic pick" model; encounter randomness can be
 * layered on by callers that prefer a random pick from
 * `findErTrainersForType()`.
 */
export function pickFirstErTrainerForType(
  trainerType: number,
  tier: ErRosterTier = "party",
): { trainer: ErTrainerRegistryEntry; roster: readonly ErPartyMemberRegistered[] } | null {
  const candidates = findErTrainersForType(trainerType);
  if (candidates.length === 0) {
    return null;
  }
  const trainer = candidates[0];
  return { trainer, roster: selectErRoster(trainer, tier) };
}

/**
 * Total trainer count in the registry — handy for tests + audit logs.
 */
export function getErTrainerCount(): number {
  return ER_TRAINER_REGISTRY.length;
}
