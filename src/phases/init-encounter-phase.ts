import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { getCoopController, isAuthoritativeBattleSession } from "#data/elite-redux/coop/coop-runtime";
import { beginCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";

/**
 * Phase to handle actions on a new encounter that must take place after other setup
 * (i.e. queue {@linkcode PostSummonPhase}s)
 */
export class InitEncounterPhase extends Phase {
  public override readonly phaseName = "InitEncounterPhase";

  public override start(): void {
    // Every battle reaches InitEncounter before its PostSummon entry-effect chain, including later waves
    // that reuse the existing player field and therefore queue no SummonPhase. SummonPhase opens this same
    // scoped recorder earlier when a real summon exists (capturing PreSummon cues); this call is idempotent
    // for that scope and is the mandatory backstop for no-resummon waves.
    const controller = getCoopController();
    if (isAuthoritativeBattleSession() && controller?.role === "host") {
      beginCoopRecording(
        globalScene.currentBattle.turn,
        `${controller.sessionEpoch}:${globalScene.currentBattle.waveIndex}`,
      );
    }
    for (const pokemon of globalScene.getField(true)) {
      if (pokemon.isEnemy() || pokemon.turnData.summonedThisTurn) {
        globalScene.phaseManager.unshiftNew("PostSummonPhase", pokemon.getBattlerIndex());
      }
    }

    super.end();
  }
}
