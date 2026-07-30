import { globalScene } from "#app/global-scene";

/**
 * Drop action/input phases from the just-finished turn once the final enemy is
 * gone. In multi-active battles, ally MovePhases can already be queued behind
 * the first VictoryPhase. Letting them run with no targets eventually schedules
 * a fresh CommandPhase and strands the cleared wave forever.
 *
 * Keep the turn-settlement phases: they own delayed state cleanup and the
 * transition from wider battle formats. BattleEnd calls this helper again after
 * that settlement has drained, removing any CommandPhases a stale TurnInitPhase
 * created in the meantime before the next encounter is allowed to start.
 */
export function removeQueuedPostVictoryCombatPhases(): void {
  // Authoritative co-op owns a separately sanctioned victory tail. This cleanup
  // is for the solo multi-active queue corruption reported in production.
  if (globalScene.gameMode.isCoop) {
    return;
  }
  const staleCombatPhases = [
    "CommandPhase",
    "EnemyCommandPhase",
    "TurnStartPhase",
    "MovePhase",
    "TurnInitPhase",
  ] as const;
  for (const phaseName of staleCombatPhases) {
    while (globalScene.phaseManager.tryRemovePhase(phaseName)) {
      // Remove static phases, dynamic phases, and their markers.
    }
  }
}
