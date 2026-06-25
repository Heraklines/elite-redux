import { globalScene } from "#app/global-scene";
import { getCoopController, getCoopInteractionRelay } from "#data/elite-redux/coop/coop-runtime";
import { coopOwnerOfFieldIndex } from "#data/elite-redux/coop/coop-session";
import { SwitchType } from "#enums/switch-type";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";
import { PartyOption, PartyUiHandler, PartyUiMode } from "#ui/party-ui-handler";

/** Co-op (#633): how long the WATCHER waits for the owner's relayed replacement choice. */
const COOP_SWITCH_WAIT_MS = 300_000;

/**
 * Opens the party selector UI and transitions into a {@linkcode SwitchSummonPhase}
 * for the player (if a switch would be valid for the current battle state).
 */
export class SwitchPhase extends BattlePhase {
  public readonly phaseName = "SwitchPhase";
  protected readonly fieldIndex: number;
  private readonly switchType: SwitchType;
  private readonly isModal: boolean;
  private readonly doReturn: boolean;

  /**
   * Creates a new SwitchPhase
   * @param switchType {@linkcode SwitchType} The type of switch logic this phase implements
   * @param fieldIndex Field index to switch out
   * @param isModal Indicates if the switch should be forced (true) or is
   * optional (false).
   * @param doReturn Indicates if the party member on the field should be
   * recalled to ball or has already left the field. Passed to {@linkcode SwitchSummonPhase},
   * and is (ostensibly) only set to `false` from `FaintPhase`.
   */
  constructor(switchType: SwitchType, fieldIndex: number, isModal: boolean, doReturn: boolean) {
    super();

    this.switchType = switchType;
    this.fieldIndex = fieldIndex;
    this.isModal = isModal;
    this.doReturn = doReturn;
  }

  start() {
    super.start();

    // Skip modal switch if impossible (no remaining party members that aren't already in battle)
    if (this.isModal && globalScene.getPokemonAllowedInBattle().every(p => p.isOnField())) {
      return super.end();
    }

    /**
     * Skip if the fainted party member has been revived already. doReturn is
     * only passed as `false` from FaintPhase (as opposed to other usages such
     * as ForceSwitchOutAttr or CheckSwitchPhase), so we only want to check this
     * if the mon should have already been returned but is still alive and well
     * on the field. see also; battle.test.ts
     */
    // TODO: If a Phasing move kills its own user, when does said user appear on field?
    // Is it after the user faints
    if (this.isModal && !this.doReturn && !globalScene.getPlayerParty()[this.fieldIndex].isFainted()) {
      return super.end();
    }

    // Check if there is any space still in field
    if (this.isModal && globalScene.getPlayerField(true).length > globalScene.currentBattle.getBattlerCount()) {
      return super.end();
    }

    // Override field index to 0 in case of double battle where 2/3 remaining legal party members fainted at once
    const fieldIndex =
      globalScene.currentBattle.getBattlerCount() === 1 || globalScene.getPokemonAllowedInBattle().length > 1
        ? this.fieldIndex
        : 0;

    // Co-op (#633): a replacement is chosen ONLY by the player who owns the field slot
    // (host = slot 0, guest = slot 1). The partner must NOT pick the other player's
    // mon; it WATCHES and applies the owner's relayed choice to its own identical
    // party (same seed -> same bench). Keyed by turn+slot so both clients agree on the
    // choice this belongs to. Solo / non-coop is byte-for-byte unchanged (skips this).
    const coopController = globalScene.gameMode.isCoop ? getCoopController() : null;
    const coopRelay = coopController == null ? null : getCoopInteractionRelay();
    if (coopController != null && coopRelay != null) {
      const seq = (globalScene.currentBattle.turn ?? 0) * 4 + this.fieldIndex;
      if (coopOwnerOfFieldIndex(this.fieldIndex) !== coopController.role) {
        // WATCHER: do not open the picker; apply the owner's relayed replacement.
        void coopRelay.awaitInteractionChoice(seq, COOP_SWITCH_WAIT_MS).then(res => {
          const slotIndex = res?.choice ?? -1;
          if (slotIndex >= globalScene.currentBattle.getBattlerCount() && slotIndex < 6) {
            // Co-op (#633 Fix #4g): carry the BATON_PASS flag relayed in data[0]. Without it the
            // watcher always applied a PLAIN switch, dropping the owner's Baton Pass (stat changes
            // not passed) -> the two engines diverged the moment a baton switch happened.
            const switchType = res?.data?.[0] === 1 ? SwitchType.BATON_PASS : this.switchType;
            globalScene.phaseManager.unshiftNew("SwitchSummonPhase", switchType, fieldIndex, slotIndex, this.doReturn);
          }
          globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
        });
        return;
      }
      // OWNER: pick normally, and relay the chosen slot (+ baton flag) so the watcher mirrors it.
      globalScene.ui.setMode(
        UiMode.PARTY,
        this.isModal ? PartyUiMode.FAINT_SWITCH : PartyUiMode.POST_BATTLE_SWITCH,
        fieldIndex,
        (slotIndex: number, option: PartyOption) => {
          const isBaton = option === PartyOption.PASS_BATON;
          coopRelay.sendInteractionChoice(seq, "switch", slotIndex, isBaton ? [1] : [0]);
          if (slotIndex >= globalScene.currentBattle.getBattlerCount() && slotIndex < 6) {
            const switchType = isBaton ? SwitchType.BATON_PASS : this.switchType;
            globalScene.phaseManager.unshiftNew("SwitchSummonPhase", switchType, fieldIndex, slotIndex, this.doReturn);
          }
          globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
        },
        PartyUiHandler.FilterNonFainted,
      );
      return;
    }

    globalScene.ui.setMode(
      UiMode.PARTY,
      this.isModal ? PartyUiMode.FAINT_SWITCH : PartyUiMode.POST_BATTLE_SWITCH,
      fieldIndex,
      (slotIndex: number, option: PartyOption) => {
        if (slotIndex >= globalScene.currentBattle.getBattlerCount() && slotIndex < 6) {
          const switchType = option === PartyOption.PASS_BATON ? SwitchType.BATON_PASS : this.switchType;
          globalScene.phaseManager.unshiftNew("SwitchSummonPhase", switchType, fieldIndex, slotIndex, this.doReturn);
        }
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
      },
      PartyUiHandler.FilterNonFainted,
    );
  }
}
