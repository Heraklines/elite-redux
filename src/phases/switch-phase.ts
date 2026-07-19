import type { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { isCoopV2ReplacementCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-replacement";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  addressCoopFaintSwitchChoiceData,
  awaitAddressedCoopFaintSwitchChoice,
  COOP_FAINT_SWITCH_RESOLUTION_FALLBACK,
  COOP_FAINT_SWITCH_RESOLUTION_NONE,
  COOP_FAINT_SWITCH_RESOLUTION_OWNER,
  type CoopFaintSourceAddress,
  captureCoopFaintSwitchOperationBinding,
  commitFaintSwitchAuthorityIntent,
  commitFaintSwitchAuthorityResult,
} from "#data/elite-redux/coop/coop-faint-switch-operation";
import {
  beginCoopFaintSwitchWindow,
  endCoopFaintSwitchWindow,
  getCoopFaintSwitchWaitMs,
} from "#data/elite-redux/coop/coop-interaction-relay";
import {
  coopOwnerOfPlayerFieldSlot,
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopNetcodeMode,
  getCoopRuntime,
  isVersusSession,
  runWhenCoopRuntimeActive,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_SWITCH_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { coopSwitchBlocksMonForOwner } from "#data/elite-redux/coop/coop-session";
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
  private readonly faintSourceAddress: CoopFaintSourceAddress | undefined;

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
  constructor(
    switchType: SwitchType,
    fieldIndex: number,
    isModal: boolean,
    doReturn: boolean,
    faintSourceAddress?: CoopFaintSourceAddress,
  ) {
    super();

    this.switchType = switchType;
    this.fieldIndex = fieldIndex;
    this.isModal = isModal;
    this.doReturn = doReturn;
    this.faintSourceAddress = faintSourceAddress;
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

    // Override field index to 0 in case of double battle where 2/3 remaining legal party members fainted at once.
    // CO-OP (seed 5ncYiLOw1a4JQZ0MAzWA1izj heavily-fainted seating desync): the collapse-to-0 is a SOLO
    // convenience (one lone survivor renders in the left slot), but in co-op each player owns a FIXED field
    // slot (host = 0, guest = 1) and a replacement MUST land in the OWNER's own slot - collapsing a guest
    // replacement to slot 0 (or resolving the override DIFFERENTLY on the two engines, since each computes
    // getPokemonAllowedInBattle() off its own party view) seats the pick in the WRONG slot, so the host seats
    // it while the guest leaves that slot ABSENT (`host={bi:1} guest=<absent>`) -> a checksum mismatch/resync
    // and the "switches in, instantly faints, re-opens the picker" loop. In co-op ALWAYS keep this.fieldIndex.
    const coopSlotOwnershipFixed = globalScene.gameMode.isCoop && getCoopController() != null;
    const fieldIndex =
      coopSlotOwnershipFixed
      || globalScene.currentBattle.getBattlerCount() === 1
      || globalScene.getPokemonAllowedInBattle().length > 1
        ? this.fieldIndex
        : 0;

    // Co-op (#633): a replacement is chosen ONLY by the player who owns the field slot
    // (host = slot 0, guest = slot 1). The partner must NOT pick the other player's
    // mon; it WATCHES and applies the owner's relayed choice to its own identical
    // party (same seed -> same bench). Keyed by turn+slot so both clients agree on the
    // choice this belongs to. Solo / non-coop is byte-for-byte unchanged (skips this).
    const coopController = globalScene.gameMode.isCoop ? getCoopController() : null;
    const coopRelay = coopController == null ? null : getCoopInteractionRelay();
    const authoritative = coopController != null && getCoopNetcodeMode() === "authoritative";
    if (coopController != null && coopRelay == null) {
      if (authoritative) {
        failCoopSharedSession("The authoritative replacement flow lost its interaction relay.");
        return;
      }
      failCoopSharedSession("The replacement flow lost its interaction relay.");
      return;
    }
    if (coopController != null && coopRelay != null) {
      const scene = globalScene;
      const operationBinding = (() => {
        if (!authoritative) {
          return null;
        }
        try {
          return captureCoopFaintSwitchOperationBinding(coopController.role);
        } catch (error) {
          coopWarn("replay", `replacement slot=${this.fieldIndex} could not bind its runtime`, error);
          failCoopSharedSession("The replacement flow lost its co-op runtime binding.");
          return;
        }
      })();
      if (operationBinding === undefined) {
        return;
      }
      const operationSourceAddress = this.faintSourceAddress ?? {
        wave: scene.currentBattle.waveIndex,
        turn: scene.currentBattle.turn ?? 0,
        occurrence: 0,
      };
      const seq = (globalScene.currentBattle.turn ?? 0) * 4 + this.fieldIndex;
      if (coopOwnerOfPlayerFieldSlot(this.fieldIndex) !== coopController.role) {
        // AUTHORITATIVE netcode (#633 partner-death sync, HALF B): the WATCHER here is the HOST
        // simulating the whole turn, and the slot's OWNER is the GUEST - but the authoritative guest
        // is a pure renderer in CoopReplayTurnPhase and NEVER reaches its own SwitchPhase, so it can
        // never relay a choice. Awaiting it would stall the host for COOP_SWITCH_WAIT_MS (300s) then
        // apply nothing, leaving the slot empty (a hang + desync). Instead AUTO-PICK a replacement
        // from the owner's party half and apply it LOCALLY, so the host's post-turn checkpoint shows
        // the new mon at this slot - which HALF A's reconcileCoopPlayerField then renders on the guest.
        // (LOCKSTEP is unchanged: both clients run the real SwitchPhase and fall through to the relay.)
        if (authoritative) {
          // #786: the slot's OWNER (the guest) chooses its OWN replacement. Its renderer opens
          // a party picker off the faint presentation (CoopGuestFaintSwitchPhase) and relays the
          // pick under this same turn+slot seq; await it here, falling back to the old auto-pick
          // when no (or an illegal) pick arrives in time - the run never stalls on a
          // disconnected or idle partner.
          scene.ui.showText("Waiting for your partner to choose their next Pokemon...");
          // The protocol address belongs to the original faint event. This phase can start after TurnInit
          // has advanced the ambient turn, so never reconstruct an addressed faint from currentBattle.turn.
          const sourceAddress = operationSourceAddress;
          // Separately freeze the phase's live boundary. Async callbacks fence against this later state,
          // not against the older faint address.
          const phaseBoundary = {
            wave: scene.currentBattle.waveIndex,
            turn: scene.currentBattle.turn ?? 0,
          };
          const sourceGeneration = coopSessionGeneration();
          const runtime = getCoopRuntime();
          if (runtime == null || runtime.controller !== coopController) {
            failCoopSharedSession("The replacement flow lost its active host runtime.");
            return;
          }
          const boundaryStillLive = (): boolean =>
            coopSessionGeneration() === sourceGeneration
            && getCoopRuntime() === runtime
            && scene.phaseManager.getCurrentPhase() === this
            && scene.currentBattle.waveIndex === phaseBoundary.wave
            && (scene.currentBattle.turn ?? 0) === phaseBoundary.turn;
          // Suppress the stall watchdog while awaiting the partner's HUMAN pick (see
          // ShowdownEnemyFaintSwitchPhase for the rationale): a slow-but-alive partner must not be misread as
          // a deadlock. Paired 1:1 with endCoopFaintSwitchWindow in the .then (always runs).
          beginCoopFaintSwitchWindow();
          void awaitAddressedCoopFaintSwitchChoice(
            coopRelay,
            {
              ...sourceAddress,
              fieldIndex: this.fieldIndex,
              timeoutMs: getCoopFaintSwitchWaitMs(),
            },
            operationBinding,
          ).then(res => {
            endCoopFaintSwitchWindow();
            // Resolve + commit under THIS runtime (see the close verdict below): the continuation
            // resumes on the shared microtask queue, and boundaryStillLive reads the ACTIVE runtime.
            runWhenCoopRuntimeActive(runtime, () => {
              if (coopSessionGeneration() !== sourceGeneration) {
                return;
              }
              if (!boundaryStillLive()) {
                failCoopSharedSession("The replacement flow lost its exact host boundary before committing.");
                return;
              }
              const battlerCount = scene.currentBattle.getBattlerCount();
              let slotIndex = res?.choice ?? -1;
              // #799 (live Wingull/Chinchou wrong-mon summon): the pick carries the chosen mon's
              // SPECIES (data[1]). If the two clients' party orders diverged, the blind slot index
              // points at a DIFFERENT mon here - resolve by IDENTITY instead and log the drift.
              const pickedSpecies = res?.data?.[1] ?? 0;
              if (pickedSpecies > 0 && slotIndex >= 0) {
                const atSlot = scene.getPlayerParty()[slotIndex];
                if (atSlot?.species?.speciesId !== pickedSpecies) {
                  const bySpecies = scene
                    .getPlayerParty()
                    .findIndex((p, i) => i >= battlerCount && i < 6 && p?.species?.speciesId === pickedSpecies);
                  if (bySpecies >= 0) {
                    coopWarn(
                      "replay",
                      `partner pick slot=${slotIndex} holds sp${atSlot?.species?.speciesId ?? 0} but partner picked sp${pickedSpecies} -> resolved by identity to slot=${bySpecies} (party-order drift)`,
                    );
                    slotIndex = bySpecies;
                  }
                }
              }
              const picked = scene.getPlayerParty()[slotIndex];
              const legal =
                slotIndex >= battlerCount
                && slotIndex < 6
                && picked?.isAllowedInBattle() === true
                && !coopSwitchBlocksMonForOwner(coopOwnerOfPlayerFieldSlot(this.fieldIndex), picked.coopOwner);
              if (!legal) {
                coopLog(
                  "replay",
                  `partner replacement pick field=${this.fieldIndex} ${
                    res == null ? "TIMED OUT" : `illegal (${slotIndex})`
                  } -> auto-pick`,
                );
                slotIndex = this.coopAutoPickReplacement(scene);
              }
              const authoritativePick = scene.getPlayerParty()[slotIndex];
              const noReplacement = slotIndex < 0 || authoritativePick == null;
              const terminalData = addressCoopFaintSwitchChoiceData(
                [0, authoritativePick?.species?.speciesId ?? 0],
                {
                  ...sourceAddress,
                  fieldIndex: this.fieldIndex,
                  partySlot: slotIndex,
                  resolution: noReplacement
                    ? COOP_FAINT_SWITCH_RESOLUTION_NONE
                    : legal
                      ? COOP_FAINT_SWITCH_RESOLUTION_OWNER
                      : COOP_FAINT_SWITCH_RESOLUTION_FALLBACK,
                },
                operationBinding,
              );
              const receipt = commitFaintSwitchAuthorityResult(
                {
                  payload: {
                    fieldIndex: this.fieldIndex,
                    partySlot: slotIndex,
                    data: terminalData,
                  },
                  ownerRole: coopOwnerOfPlayerFieldSlot(this.fieldIndex),
                  localRole: coopController.role,
                  // #799 identity for the authority-v2 shadow REPLACEMENT tap (unused by the legacy carrier).
                  speciesId: authoritativePick?.species?.speciesId ?? terminalData[1],
                  ...sourceAddress,
                },
                operationBinding,
              );
              if (receipt == null) {
                failCoopSharedSession("The authoritative replacement choice could not be retained.");
                return;
              }
              const releaseAfterPeerMaterial = (): void => {
                // The close verdict must be judged under THIS runtime: the .then continuation resumes on
                // the shared microtask queue, and boundaryStillLive reads the ACTIVE runtime - ambient
                // state a two-engine test process legitimately points elsewhere between pumps. In a real
                // browser the runtime is always active, so this defers nothing live.
                void scene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, boundaryStillLive).then(result =>
                  runWhenCoopRuntimeActive(runtime, () => {
                    if (coopSessionGeneration() !== sourceGeneration) {
                      return;
                    }
                    if (result === "superseded" || !boundaryStillLive()) {
                      failCoopSharedSession("The replacement flow lost its exact host boundary while closing.");
                      return;
                    }
                    if (slotIndex >= battlerCount && slotIndex < 6) {
                      scene.phaseManager.unshiftNew(
                        "SwitchSummonPhase",
                        this.switchType,
                        fieldIndex,
                        slotIndex,
                        this.doReturn,
                      );
                      // Queue the checkpoint only after the retained old-address terminal and this host
                      // message surface have both materially closed. It may carry turn N+1, but can no
                      // longer race an N modal or leak into a superseding phase.
                      scene.phaseManager.unshiftNew("CoopPushReplacementCheckpointPhase");
                    } else if (receipt.v2Staged === true) {
                      // Explicit no-replacement is still an authoritative transaction: no summon phase will
                      // create a later capture point, so publish the complete sealed-slot state now.
                      scene.phaseManager.unshiftNew("CoopPushReplacementCheckpointPhase");
                    }
                    scene.phaseManager.shiftPhase();
                  }),
                );
              };
              if (receipt.v2Staged === true) {
                releaseAfterPeerMaterial();
                return;
              }
              if (receipt.operationId == null) {
                if (!legal) {
                  failCoopSharedSession("A replacement timeout cannot continue without a retained peer terminal.");
                  return;
                }
                releaseAfterPeerMaterial();
                return;
              }
              const durability = runtime.durability;
              if (durability == null || runtime.controller.role !== "host") {
                failCoopSharedSession(`Replacement terminal ${receipt.operationId} has no host material barrier.`);
                return;
              }
              const operationId = receipt.operationId;
              void durability
                .waitForOperationMaterialApplied(operationId)
                .then(applied => {
                  if (coopSessionGeneration() !== sourceGeneration) {
                    return;
                  }
                  if (!applied) {
                    failCoopSharedSession(`Replacement terminal ${operationId} exhausted before peer material apply.`);
                    return;
                  }
                  runWhenCoopRuntimeActive(runtime, () => {
                    if (!boundaryStillLive()) {
                      failCoopSharedSession(`Replacement terminal ${operationId} lost its host phase boundary.`);
                      return;
                    }
                    releaseAfterPeerMaterial();
                  });
                })
                .catch(error => {
                  if (coopSessionGeneration() !== sourceGeneration) {
                    return;
                  }
                  coopWarn("replay", `replacement terminal ${operationId} material barrier rejected`, error);
                  failCoopSharedSession(`Replacement terminal ${operationId} material barrier failed.`);
                });
            });
          });
          return;
        }
        // LOCKSTEP WATCHER: do not open the picker; apply the owner's relayed replacement.
        void coopRelay.awaitInteractionChoice(seq, COOP_SWITCH_WAIT_MS, COOP_SWITCH_CHOICE_KINDS).then(res => {
          const slotIndex = res?.choice ?? -1;
          if (slotIndex >= scene.currentBattle.getBattlerCount() && slotIndex < 6) {
            // Co-op (#633 Fix #4g): carry the BATON_PASS flag relayed in data[0]. Without it the
            // watcher always applied a PLAIN switch, dropping the owner's Baton Pass (stat changes
            // not passed) -> the two engines diverged the moment a baton switch happened.
            const switchType = res?.data?.[0] === 1 ? SwitchType.BATON_PASS : this.switchType;
            scene.phaseManager.unshiftNew("SwitchSummonPhase", switchType, fieldIndex, slotIndex, this.doReturn);
          }
          scene.ui.setMode(UiMode.MESSAGE).then(() => scene.phaseManager.shiftPhase());
        });
        return;
      }
      // OWNER, but this player's WHOLE half is wiped (no legal same-owner bench): opening the modal
      // FAINT_SWITCH picker here STRANDS the owner FOREVER - every non-fainted party mon is either
      // fainted (blocked by FilterNonFainted) or the PARTNER's (blocked by coopSwitchFilter), so the
      // modal menu has NO selectable option and cannot be cancelled ("partner loses ALL Pokemon -> stuck
      // in the choose menu"). Instead relay a NO-PICK sentinel + CLOSE, leaving the slot empty so the run
      // continues with the surviving partner (asymmetric field, #828). If BOTH halves are wiped the modal
      // impossibility guard above (getPokemonAllowedInBattle().every(onField)) already ended without a
      // picker and the faint flow reaches game-over. Only a FORCED (modal) faint switch is closed this way.
      if (this.isModal && this.coopAutoPickReplacement(scene) < 0) {
        coopLog(
          "replay",
          `owner slot=${this.fieldIndex}: no legal same-owner replacement (half wiped) -> close picker, slot stays empty`,
        );
        if (authoritative) {
          const data = addressCoopFaintSwitchChoiceData(
            [0],
            {
              ...operationSourceAddress,
              fieldIndex: this.fieldIndex,
              partySlot: -1,
              resolution: COOP_FAINT_SWITCH_RESOLUTION_NONE,
            },
            operationBinding,
          );
          const receipt = commitFaintSwitchAuthorityResult(
            {
              payload: { fieldIndex: this.fieldIndex, partySlot: -1, data },
              ownerRole: coopController.role,
              localRole: coopController.role,
              ...operationSourceAddress,
            },
            operationBinding,
          );
          if (receipt == null) {
            failCoopSharedSession("The authoritative no-replacement choice could not be retained.");
            return;
          }
          if (receipt.v2Staged === true) {
            // No SwitchSummonPhase follows a half-wipe. Queue the post-resolution capture explicitly so
            // the typed null selection and complete sealed-slot carrier cannot remain staged forever.
            scene.phaseManager.unshiftNew("CoopPushReplacementCheckpointPhase");
          }
        }
        coopRelay.sendInteractionChoice(seq, "switch", -1, [0]);
        return super.end();
      }
      // OWNER: pick normally, and relay the chosen slot (+ baton flag) so the watcher mirrors it.
      const ownerGeneration = coopSessionGeneration();
      const ownerRuntime = authoritative ? getCoopRuntime() : null;
      const ownerBoundary = {
        wave: scene.currentBattle.waveIndex,
        turn: scene.currentBattle.turn ?? 0,
      };
      if (authoritative && (ownerRuntime == null || ownerRuntime.controller !== coopController)) {
        failCoopSharedSession("The owner replacement flow lost its active runtime.");
        return;
      }
      const ownerBoundaryStillLive = (): boolean =>
        !authoritative
        || (ownerRuntime != null
          && coopSessionGeneration() === ownerGeneration
          && getCoopRuntime() === ownerRuntime
          && scene.phaseManager.getCurrentPhase() === this
          && scene.currentBattle.waveIndex === ownerBoundary.wave
          && (scene.currentBattle.turn ?? 0) === ownerBoundary.turn);
      scene.ui.setMode(
        UiMode.PARTY,
        this.isModal ? PartyUiMode.FAINT_SWITCH : PartyUiMode.POST_BATTLE_SWITCH,
        fieldIndex,
        (slotIndex: number, option: PartyOption) => {
          if (!ownerBoundaryStillLive()) {
            failCoopSharedSession("The owner replacement flow lost its exact phase boundary before committing.");
            return;
          }
          const isBaton = option === PartyOption.PASS_BATON;
          let data = isBaton ? [1] : [0];
          if (authoritative) {
            data = addressCoopFaintSwitchChoiceData(
              data,
              {
                ...operationSourceAddress,
                fieldIndex: this.fieldIndex,
                partySlot: slotIndex,
                resolution: COOP_FAINT_SWITCH_RESOLUTION_OWNER,
              },
              operationBinding,
            );
            const retained = commitFaintSwitchAuthorityIntent(
              {
                payload: { fieldIndex: this.fieldIndex, partySlot: slotIndex, data },
                ownerRole: coopController.role,
                localRole: coopController.role,
                ...operationSourceAddress,
              },
              operationBinding,
            );
            if (!retained) {
              failCoopSharedSession("The authoritative replacement choice could not be retained.");
              return;
            }
          }
          coopRelay.sendInteractionChoice(seq, "switch", slotIndex, data);
          const finishOwnerReplacement = (): void => {
            if (slotIndex >= scene.currentBattle.getBattlerCount() && slotIndex < 6) {
              const switchType = isBaton ? SwitchType.BATON_PASS : this.switchType;
              scene.phaseManager.unshiftNew("SwitchSummonPhase", switchType, fieldIndex, slotIndex, this.doReturn);
              // #836 (live wave-5 party-order transposition): the host's SwitchSummonPhase SWAPS the party
              // array (`party[slotIndex] = fainted; party[fieldIndex] = replacement`), but the WATCHER (the
              // guest) mirrors a HOST-OWNED faint only at the NEXT turn resolution - so between the faint and
              // the next turn the guest keeps the STALE order (its fainted lead still at fieldIndex, the
              // replacement still on the bench). If the wave ends (or the replacement levels) before that
              // turn arrives, the guest's `getPlayerParty()` order is TRANSPOSED vs the host: the per-slot
              // exp deltas SKIP (wrong species at the slot) and the field/switch presentation lands on the
              // wrong mon. The GUEST-owned faint path already pushes this out-of-band checkpoint (HALF B) so
              // the partner materializes the replacement + mirrors the array swap IMMEDIATELY; do the SAME for
              // a HOST-owned faint so both engines' party order stays byte-identical from the moment of the
              // swap. Authoritative-only (the pure-renderer guest never reaches this branch; lockstep both run
              // their own SwitchSummonPhase); the phase itself is a host-role-gated no-op besides.
              if (authoritative) {
                scene.phaseManager.unshiftNew("CoopPushReplacementCheckpointPhase");
              }
            }
            scene.phaseManager.shiftPhase();
          };
          if (authoritative && ownerRuntime != null) {
            // Judge the close verdict under THIS runtime (see the non-owner branch above): the .then
            // resumes on the shared microtask queue and ownerBoundaryStillLive reads the ACTIVE runtime.
            void scene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, ownerBoundaryStillLive).then(result =>
              runWhenCoopRuntimeActive(ownerRuntime, () => {
                if (coopSessionGeneration() !== ownerGeneration) {
                  return;
                }
                if (result === "superseded" || !ownerBoundaryStillLive()) {
                  failCoopSharedSession("The owner replacement lost its exact phase boundary while closing.");
                  return;
                }
                finishOwnerReplacement();
              }),
            );
          } else {
            scene.ui.setMode(UiMode.MESSAGE).then(finishOwnerReplacement);
          }
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
          if (!this.stageVersusHostOwnReplacement(slotIndex)) {
            return;
          }
          const switchType = option === PartyOption.PASS_BATON ? SwitchType.BATON_PASS : this.switchType;
          globalScene.phaseManager.unshiftNew("SwitchSummonPhase", switchType, fieldIndex, slotIndex, this.doReturn);
          this.maybePushVersusHostReplacementCheckpoint();
        }
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
      },
      PartyUiHandler.FilterNonFainted,
    );
  }

  /**
   * Showdown's host-owned faint uses the vanilla player-party picker because Showdown is not a co-op game
   * mode. Once replacement Authority V2 is negotiated, that must not skip the typed pre-summon proposal:
   * the post-summon checkpoint phase can commit only proposals staged at the immutable faint address.
   */
  private stageVersusHostOwnReplacement(slotIndex: number): boolean {
    const controller = getCoopController();
    if (!isVersusSession() || controller?.role !== "host" || !isCoopV2ReplacementCutoverActive()) {
      return true;
    }
    const sourceAddress = this.faintSourceAddress ?? {
      wave: globalScene.currentBattle.waveIndex,
      turn: globalScene.currentBattle.turn ?? 0,
      occurrence: 0,
    };
    const replacement = globalScene.getPlayerParty()[slotIndex];
    const speciesId = replacement?.species?.speciesId ?? 0;
    const retained = commitFaintSwitchAuthorityIntent({
      payload: {
        fieldIndex: this.fieldIndex,
        partySlot: slotIndex,
        // V2 consumes the typed fields below, but keep this compatibility payload dense so the legacy
        // sparse-array rejection class cannot re-enter if this seam is inspected during a mixed build.
        data: [0, speciesId, controller.sessionEpoch, 0, COOP_FAINT_SWITCH_RESOLUTION_OWNER, sourceAddress.occurrence],
      },
      ownerRole: controller.role,
      localRole: controller.role,
      speciesId,
      ...sourceAddress,
    });
    if (!retained) {
      failCoopSharedSession("The Showdown host replacement could not be staged in Authority V2.");
      return false;
    }
    return true;
  }

  /**
   * Showdown 1v1: the versus HOST's OWN faint rides the vanilla picker (gameMode.isCoop is false), so it
   * skips the co-op owner path's #836 out-of-band replacement checkpoint. Push it here so the GUEST
   * materializes the host's replacement on its OPPONENT field + mirrors the party-array reorder
   * IMMEDIATELY, exactly as the co-op host-owned faint does - otherwise the guest keeps rendering the
   * fainted lead until the next turn resolution. Host-only (the pure-renderer guest never reaches its own
   * SwitchPhase); the checkpoint phase is host-role-gated + a no-op besides. Solo / co-op never enter here.
   */
  private maybePushVersusHostReplacementCheckpoint(): void {
    if (isVersusSession() && getCoopController()?.role === "host") {
      globalScene.phaseManager.unshiftNew("CoopPushReplacementCheckpointPhase");
    }
  }

  /**
   * Co-op AUTHORITATIVE (#633 partner-death sync, HALF B): auto-pick a replacement party slot for a
   * fainted field slot whose OWNER is the partner the host can't await. Mirrors exactly the choices
   * the owner's interactive picker would allow: the FIRST party member that is a BENCH slot (index
   * `>= getBattlerCount()`, i.e. not already on-field), is allowed in battle (non-fainted, same as
   * the picker's `FilterNonFainted`), and belongs to the slot's OWNER half (same
   * `coopSwitchBlocksMonForOwner` gate the picker enforces, so the host never pulls the host's own
   * bench into the guest's slot). Returns the chosen party slot, or -1 when the owner has no legal
   * bench replacement (the caller then leaves the slot empty exactly as a no-reply relay would).
   * No await, no menu, no RNG.
   */
  private coopAutoPickReplacement(scene: BattleScene = globalScene): number {
    const battlerCount = scene.currentBattle.getBattlerCount();
    const party = scene.getPlayerParty();
    // Ownership is keyed off the ORIGINAL slot (this.fieldIndex), matching the watcher gate above -
    // the override-to-0 `fieldIndex` only affects where the summon lands, not whose half is legal.
    // M5 (#633): the slot's owner is resolved from the mon's tag (N-ready), hoisted out of the scan.
    const slotOwner = coopOwnerOfPlayerFieldSlot(this.fieldIndex);
    return party.findIndex(
      (mon, i) =>
        i >= battlerCount && i < 6 && mon.isAllowedInBattle() && !coopSwitchBlocksMonForOwner(slotOwner, mon.coopOwner),
    );
  }
}
