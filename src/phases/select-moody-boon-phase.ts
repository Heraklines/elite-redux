import { globalScene } from "#app/global-scene";
import { notifyMoodyRuntimeBoonDraft } from "#data/elite-redux/moody/moody-runtime-field-engine";
import { applyMoodyCoordinatorBoonOffers } from "#data/elite-redux/moody/moody-runtime-game-adapter";
import { getMoodyBoonOffers, getMoodyModeState, rollAndCommitMoodyCurse } from "#data/elite-redux/moody/moody-state";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";

export class SelectMoodyBoonPhase extends BattlePhase {
  public readonly phaseName = "SelectMoodyBoonPhase";

  constructor(private readonly waveIndex: number) {
    super();
  }

  start(): void {
    super.start();
    if (getMoodyModeState() == null) {
      this.end();
      return;
    }
    applyMoodyCoordinatorBoonOffers(this.waveIndex);
    notifyMoodyRuntimeBoonDraft(getMoodyBoonOffers(this.waveIndex).map(offer => offer.offerId));
    let completed = false;
    const completeDraft = () => {
      if (completed) {
        return;
      }
      completed = true;
      const curse = rollAndCommitMoodyCurse(
        this.waveIndex,
        globalScene.getPlayerParty().map(pokemon => pokemon.id),
      );
      if (curse == null) {
        this.end();
        return;
      }
      void globalScene.ui.showMoodyCurseReceived(curse).then(
        () => this.end(),
        () => this.end(),
      );
    };
    void globalScene.ui.setOverlayMode(UiMode.MOODY_BOON_SELECT, this.waveIndex, completeDraft).catch(completeDraft);
  }
}
