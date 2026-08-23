import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

type StarterLaunchPhase = {
  initBattleFromCurrentPhase?: (
    starters: readonly unknown[],
    ignoreMovesetValidation?: boolean,
    coopOwners?: readonly CoopRole[],
  ) => unknown;
  initBattle: (
    starters: readonly unknown[],
    ignoreMovesetValidation?: boolean,
    coopOwners?: readonly CoopRole[],
  ) => unknown;
};

/**
 * Launch a detached starter party across oracle cuts.
 *
 * Newer oracle sources advance the phase that was current when construction
 * began (`initBattleFromCurrentPhase`); the identity-bearing scheduler ignores
 * completion from a detached `SelectStarterPhase`, so legacy `initBattle`
 * callers would soft-lock at `TitlePhase`. This helper dispatches on the
 * available method so one overlay drives both source generations.
 */
export function launchDetachedStarters(
  starterPhase: StarterLaunchPhase,
  starters: readonly unknown[],
  coopOwners?: readonly CoopRole[],
): void {
  if (typeof starterPhase.initBattleFromCurrentPhase === "function") {
    starterPhase.initBattleFromCurrentPhase(starters, true, coopOwners);
    return;
  }
  if (coopOwners != null) {
    starterPhase.initBattle(starters, true, coopOwners);
    return;
  }
  starterPhase.initBattle(starters, true);
}
