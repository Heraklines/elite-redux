import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import Overrides from "#app/overrides";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import { allMoves } from "#data/data-lists";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  getCoopController,
  getCoopInteractionRelay,
  getCoopNetcodeMode,
  getCoopRuntime,
  getCoopUiMirror,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import { erRecordAchievementLearnMove } from "#data/elite-redux/er-achievement-tracker";
import { recordSinglePlayerInteraction } from "#data/elite-redux/replay-single-recording";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { PlayerPartyMemberPokemonPhase } from "#phases/player-party-member-pokemon-phase";
import { EvolutionSceneUiHandler } from "#ui/evolution-scene-ui-handler";
import { SummaryUiMode } from "#ui/summary-ui-handler";
import i18next from "i18next";

// Co-op (#633): the move-replace ("which move to forget") menu is an OWNED, shared screen.
// Only the player whose mon is learning the move drives it; the partner watches and mirrors
// the result so both clients transition together. All relayed on one dedicated seq (FIFO,
// distinct from the small interaction-turn seqs the reward shop uses).
export const COOP_LEARN_MOVE_SEQ = 9_000_001;
/** How long the watcher waits for the owner's move-replace decision before giving up.
 *  20min: "wait for the human" - a slow decision must never trip a premature give-up (desync). */
const COOP_LEARN_MOVE_WAIT_MS = 1_200_000;

// Co-op AUTHORITATIVE host->guest move-learn forward (#633 BUG3+5). Disjoint from the 9_000_001
// lockstep relay and the 9_000_000 ME terminal channel so a buffered forward never FIFO-collides.
// Per-slot keying lets two queued level-up learns for DIFFERENT mons not cross-consume.
export const COOP_LEARN_MOVE_FWD_SEQ_BASE = 9_100_000;
/** The host awaits the guest's forwarded pick. "Wait for the human" but bounded so a disconnected /
 *  idle partner can never freeze the host: on a null / timeout the host keeps the mon's current moves. */
export const COOP_LEARN_MOVE_FWD_WAIT_MS = 1_200_000;

export class LearnMovePhase extends PlayerPartyMemberPokemonPhase {
  public readonly phaseName = "LearnMovePhase";
  private moveId: MoveId;
  private messageMode: UiMode;
  private learnMoveType: LearnMoveType;
  private cost: number;

  constructor(
    partyMemberIndex: number,
    moveId: MoveId,
    learnMoveType: LearnMoveType = LearnMoveType.LEARN_MOVE,
    cost = -1,
  ) {
    super(partyMemberIndex);
    this.moveId = moveId;
    this.learnMoveType = learnMoveType;
    this.cost = cost;
  }

  start() {
    super.start();

    const pokemon = this.getPokemon();
    const move = allMoves[this.moveId];
    // Use the REAL moveset (ignoreOverride=true), not the MOVESET_OVERRIDE view:
    // a stale dev/scenario override makes getMoveset() return moves the mon
    // doesn't actually have, so the "already knows it" check below never matched
    // the just-learned level-up move -> LevelUpPhase re-queued it forever (the
    // run-blocking infinite move-learn loop, e.g. Latios past lv 37).
    const currentMoveset = pokemon.getMoveset(true);

    // The game first checks if the Pokemon already has the move and ends the phase if it does.
    const hasMoveAlready = currentMoveset.some(m => m.moveId === move.id) && this.moveId !== MoveId.SKETCH;
    if (hasMoveAlready) {
      return this.end();
    }

    this.messageMode =
      globalScene.ui.getHandler() instanceof EvolutionSceneUiHandler ? UiMode.EVOLUTION_SCENE : UiMode.MESSAGE;
    globalScene.ui.setMode(this.messageMode);
    // If the Pokemon has an empty move slot, the new move is added to the largest empty moveset index.
    // Otherwise the phase checks if the player wants to replace a move. The cap is normally 4 but ER's
    // "5th move slot" consumable can raise it (see Pokemon.getMaxMoveCount).
    if (globalScene.gameMode.isCoop && getCoopNetcodeMode() === "authoritative") {
      // Co-op AUTHORITATIVE (#633 BUG3+5): the HOST is the sole engine. This dispatch supersedes the
      // lockstep owner/watcher mapping below (which assumes BOTH clients run a LearnMovePhase - false
      // here: the guest is a pure renderer parked in CoopReplayTurnPhase). Reached ONLY when the
      // netcode is authoritative, so solo / host-lockstep / lockstep stay byte-identical.
      this.coopAuthoritativeLearnMove(currentMoveset, move, pokemon);
    } else if (currentMoveset.length < pokemon.getMaxMoveCount()) {
      // Empty slot: the move auto-learns identically on both clients (deterministic), so
      // co-op needs no relay here.
      this.learnMove(currentMoveset.length, move, pokemon);
    } else if (this.coopLearnMoveRole(pokemon) === "watcher") {
      // Co-op (#633): the move-replace menu is OWNED by this mon's player. The PARTNER
      // opens the SAME menu and mirrors the owner's live cursor (cosmetic), then applies the
      // owner's relayed result (which move was forgotten, or none) - so both see the cursor
      // move and transition together while only the owner actually picks. The owner / solo /
      // hotseat(spoof) path opens the real, interactive menu below.
      void this.coopWatchLearnMove(move, pokemon);
    } else {
      this.replaceMoveCheck(move, pokemon);
    }
  }

  /**
   * Co-op (#633): who controls THIS mon's move-replace menu. Returns "watcher" when the
   * local player does NOT own the learning mon (they mirror the result), "owner" when they
   * do (they drive it). Returns null outside a live co-op run; the hotseat (SpoofGuest)
   * path has no partner screen, so the local human always owns it.
   */
  private coopLearnMoveRole(pokemon: Pokemon): "owner" | "watcher" | null {
    if (!globalScene.gameMode.isCoop) {
      return null;
    }
    const controller = getCoopController();
    if (controller == null) {
      return null;
    }
    if (getCoopRuntime()?.spoof != null) {
      return "owner";
    }
    const owner = (pokemon as { coopOwner?: CoopRole }).coopOwner ?? "host";
    return owner === controller.role ? "owner" : "watcher";
  }

  /**
   * Co-op (#633) OWNER: relay the move-replace decision to the partner. `moveIndex` is the
   * forgotten move's slot, or `getMaxMoveCount()` to signal "did not learn". No-op in solo
   * and on the partner (only the mon-owner relays).
   */
  private coopRelayLearnResult(moveIndex: number): void {
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    const controller = getCoopController();
    if (controller == null) {
      return;
    }
    const owner = (this.getPokemon() as { coopOwner?: CoopRole }).coopOwner ?? "host";
    if (owner !== controller.role) {
      return;
    }
    getCoopInteractionRelay()?.sendInteractionChoice(COOP_LEARN_MOVE_SEQ, "learnMove", moveIndex);
  }

  /**
   * Co-op (#633) WATCHER: open the SAME move-forget menu the owner is driving (the shared
   * #563 screen) and MIRROR the owner's live cursor onto it, so the partner sees the
   * selection happen in real time instead of a static notice. The screen is opened with a
   * NO-OP selection callback and the watcher's local input is blocked at the UI layer, so the
   * replayed buttons are purely cosmetic - the AUTHORITATIVE result is the relayed choice
   * (applied below against this client's byte-identical mon). A null result (partner gone /
   * timeout) means "did not learn" so the run never hangs.
   */
  private async coopWatchLearnMove(move: Move, pokemon: Pokemon): Promise<void> {
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      return this.end();
    }
    const mirror = getCoopUiMirror();
    // Open the real move-forget menu (no-op callback: the replayed owner button can fire it,
    // but the outcome is committed from the relay, never from this callback).
    await globalScene.ui.setModeWithoutClear(UiMode.SUMMARY, pokemon, SummaryUiMode.LEARN_MOVE, move, () => {});
    // Mirror the owner's cursor onto this screen; adopts any owner buttons that arrived first.
    mirror?.beginSession("watcher", UiMode.SUMMARY, COOP_LEARN_MOVE_SEQ);

    const res = await relay.awaitInteractionChoice(COOP_LEARN_MOVE_SEQ, COOP_LEARN_MOVE_WAIT_MS);
    mirror?.endSession();
    await this.applyForgetResult(res?.choice ?? pokemon.getMaxMoveCount(), move, pokemon);
  }

  /**
   * Co-op (#633): apply a relayed move-forget RESULT (the owner's / guest's chosen slot, or the
   * `getMaxMoveCount()` "did not learn" sentinel) on THIS client's byte-identical mon. Shared by the
   * lockstep watcher ({@linkcode coopWatchLearnMove}) and the authoritative host forward
   * ({@linkcode coopHostForwardLearnMove}). An out-of-range index means "did not learn", so a null /
   * timeout result never hangs - it keeps the mon's current moves and ends.
   */
  private async applyForgetResult(moveIndex: number, move: Move, pokemon: Pokemon): Promise<void> {
    if (moveIndex >= 0 && moveIndex < pokemon.getMaxMoveCount()) {
      // Build the same "1... 2... and Poof! forgot X. And..." chain the owner sees, so the
      // result message matches (read the forgotten move's name BEFORE setMove replaces it).
      const forgetSuccessText = i18next.t("battle:learnMoveForgetSuccess", {
        pokemonName: getPokemonNameWithAffix(pokemon),
        moveName: pokemon.moveset[moveIndex]!.getName(),
      });
      const fullText = [i18next.t("battle:countdownPoof"), forgetSuccessText, i18next.t("battle:learnMoveAnd")].join(
        "$",
      );
      this.learnMove(moveIndex, move, pokemon, fullText);
    } else {
      await globalScene.ui.setMode(this.messageMode);
      await globalScene.ui.showTextPromise(
        i18next.t("battle:learnMoveNotLearned", {
          pokemonName: getPokemonNameWithAffix(pokemon),
          moveName: move.name,
        }),
        undefined,
        true,
      );
      this.end();
    }
  }

  /**
   * Co-op AUTHORITATIVE dispatch (#633 BUG3+5). The HOST is the sole battle engine; the GUEST is a pure
   * renderer parked in CoopReplayTurnPhase whose own engine never produced this LearnMovePhase from a
   * level-up (only the Shroom modifier-apply queues one on the guest). So:
   *  - GUEST: end immediately (NO menu). The single renderer is the persistent-listener-spawned
   *    {@linkcode CoopReplayLearnMovePhase} (wireCoopLearnMoveForward), so the picker opens EXACTLY once
   *    per learn - the Shroom-queued guest LearnMovePhase must NOT also render (double-render guard).
   *  - HOST + empty move slot: auto-learn directly (deterministic), exactly like solo - no forward.
   *  - HOST + HOST-owned full moveset: open the real interactive picker (the host owns the mon + drives).
   *  - HOST + GUEST-owned full moveset: forward the prompt to the guest and await its pick with a finite
   *    fallback ({@linkcode coopHostForwardLearnMove}).
   */
  private coopAuthoritativeLearnMove(currentMoveset: ReturnType<Pokemon["getMoveset"]>, move: Move, pokemon: Pokemon) {
    const controller = getCoopController();
    if (controller?.role === "guest") {
      // #698 stale-shop softlock: a TM Case / Memory-Mushroom (cost=-1) reward queues a back-out
      // "continuation" SelectModifierPhase copy alongside this LearnMovePhase (see
      // SelectModifierPhase.applyModifier queuesContinuation). On the HOST the real learnMove() deletes
      // that copy via tryRemovePhase("SelectModifierPhase"); the guest's no-op branch below never runs
      // learnMove(), so the copy would orphan -> the watcher re-enters a reward shop the owner already
      // left and hangs (20-min await), which also blocks the resync that should rescue it. Mirror the
      // host's exact tryRemovePhase conditions (learn-move-phase learnMove: TM, or MEMORY with cost=-1)
      // so the guest's phase queue converges. Gated inside the authoritative-guest branch -> solo / host
      // / lockstep / hotseat are byte-identical (they never enter here).
      if (
        this.learnMoveType === LearnMoveType.TM
        || (this.learnMoveType === LearnMoveType.MEMORY && this.cost === -1)
      ) {
        globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
      }
      // Pure renderer: the persistent listener's CoopReplayLearnMovePhase is the sole picker renderer.
      // Ending here (no menu) is the double-render guard for the Shroom-queued guest LearnMovePhase.
      coopLog("learnmove", "guest authoritative LearnMovePhase no-op end (single renderer is the listener)", {
        slot: this.partyMemberIndex,
        moveId: this.moveId,
      });
      this.end();
      return;
    }
    // HOST from here on (host or solo-spoof drives the engine).
    if (currentMoveset.length < pokemon.getMaxMoveCount()) {
      // Empty slot auto-learn is deterministic - no human pick, so no forward needed.
      this.learnMove(currentMoveset.length, move, pokemon);
      return;
    }
    const owner = (pokemon as { coopOwner?: CoopRole }).coopOwner ?? "host";
    if (owner === "guest") {
      // The mon belongs to the partner: forward the prompt + await their pick (finite fallback).
      void this.coopHostForwardLearnMove(move, pokemon);
      return;
    }
    // Host-owned mon: the host drives the real interactive picker itself.
    this.replaceMoveCheck(move, pokemon);
  }

  /**
   * Co-op AUTHORITATIVE HOST (#633 BUG3+5): forward a GUEST-owned mon's move-forget prompt to the guest
   * (the human who owns the mon) on the disjoint `9_100_000 + partySlot` channel, render the picker
   * READ-ONLY locally so the host watches the partner's live cursor, then AWAIT the guest's chosen
   * forget-slot with a FINITE timeout. On null (timeout / disconnect / superseded) the host applies
   * "did not learn" (keeps current moves) and ends - it can NEVER hang. If the relay is missing it
   * degrades to the interactive host-drives picker (no await), still never a hang.
   */
  private async coopHostForwardLearnMove(move: Move, pokemon: Pokemon): Promise<void> {
    const relay = getCoopInteractionRelay();
    if (relay == null) {
      // Degraded but safe: no live relay -> the host drives the interactive picker itself (no await).
      this.replaceMoveCheck(move, pokemon);
      return;
    }
    const slot = this.partyMemberIndex;
    const seq = COOP_LEARN_MOVE_FWD_SEQ_BASE + slot;
    const maxMoveCount = pokemon.getMaxMoveCount();
    coopLog("learnmove", "host forwards guest-owned move-learn prompt", {
      slot,
      seq,
      moveId: this.moveId,
      maxMoveCount,
    });
    relay.sendInteractionOutcome(seq, "learnMoveForward", {
      k: "learnMoveForward",
      partySlot: slot,
      moveId: this.moveId,
      maxMoveCount,
    });
    const mirror = getCoopUiMirror();
    // Render the picker READ-ONLY (no-op callback: the outcome is the relayed pick, never this
    // callback) and mirror the GUEST's live cursor so the host watches the partner choose.
    await globalScene.ui.setModeWithoutClear(UiMode.SUMMARY, pokemon, SummaryUiMode.LEARN_MOVE, move, () => {});
    mirror?.beginSession("watcher", UiMode.SUMMARY, COOP_LEARN_MOVE_SEQ);

    const res = await relay.awaitInteractionChoice(seq, COOP_LEARN_MOVE_FWD_WAIT_MS);
    mirror?.endSession();
    if (res == null) {
      coopWarn("learnmove", "guest forward pick null (timeout/disconnect); keeping current moves", { slot, seq });
    }
    // null -> getMaxMoveCount() sentinel -> applyForgetResult keeps current moves + ends (no hang).
    await this.applyForgetResult(res?.choice ?? maxMoveCount, move, pokemon);
  }

  /**
   * This displays a chain of messages (listed below) and asks if the user wishes to forget a move.
   *
   * > [Pokemon] wants to learn the move [MoveName]
   * > However, [Pokemon] already knows four moves.
   * > Should a move be forgotten and replaced with [MoveName]? --> `Mode.CONFIRM` -> Yes: Go to `this.forgetMoveProcess()`, No: Go to `this.rejectMoveAndEnd()`
   * @param move The Move to be learned
   * @param Pokemon The Pokemon learning the move
   */
  async replaceMoveCheck(move: Move, pokemon: Pokemon) {
    const learnMovePrompt = i18next.t("battle:learnMovePrompt", {
      pokemonName: getPokemonNameWithAffix(pokemon),
      moveName: move.name,
    });
    const moveLimitReached = i18next.t("battle:learnMoveLimitReached", {
      pokemonName: getPokemonNameWithAffix(pokemon),
    });
    const shouldReplaceQ = i18next.t("battle:learnMoveReplaceQuestion", {
      moveName: move.name,
    });
    const preQText = [learnMovePrompt, moveLimitReached].join("$");
    await globalScene.ui.showTextPromise(preQText);
    await globalScene.ui.showTextPromise(shouldReplaceQ, undefined, false);
    await globalScene.ui.setModeWithoutClear(
      UiMode.CONFIRM,
      () => this.forgetMoveProcess(move, pokemon), // Yes
      () => {
        // No
        globalScene.ui.setMode(this.messageMode);
        this.rejectMoveAndEnd(move, pokemon);
      },
    );
  }

  /**
   * This facilitates the process in which an old move is chosen to be forgotten.
   *
   * > Which move should be forgotten?
   *
   * The game then goes `Mode.SUMMARY` to select a move to be forgotten.
   * If a player does not select a move or chooses the new move (`moveIndex === 4`), the game goes to `this.rejectMoveAndEnd()`.
   * If an old move is selected, the function then passes the `moveIndex` to `this.learnMove()`
   * @param move The Move to be learned
   * @param Pokemon The Pokemon learning the move
   */
  async forgetMoveProcess(move: Move, pokemon: Pokemon) {
    globalScene.ui.setMode(this.messageMode);
    await globalScene.ui.showTextPromise(i18next.t("battle:learnMoveForgetQuestion"), undefined, true);
    // Co-op (#633): if WE own this mon, drive the shared move-forget menu and relay each
    // cursor button so the partner's mirror moves live. Hard no-op in solo (mirror is null).
    if (this.coopLearnMoveRole(pokemon) === "owner") {
      getCoopUiMirror()?.beginSession("owner", UiMode.SUMMARY, COOP_LEARN_MOVE_SEQ);
    }
    await globalScene.ui.setModeWithoutClear(
      UiMode.SUMMARY,
      pokemon,
      SummaryUiMode.LEARN_MOVE,
      move,
      (moveIndex: number) => {
        // Co-op (#633): selection made - stop mirroring our cursor (no-op in solo).
        getCoopUiMirror()?.endSession();
        // The summary returns the "new move" row index to signal rejection. That
        // row sits below the existing moves, so it equals the move cap (4, or 5
        // with ER's extra slot).
        if (moveIndex === pokemon.getMaxMoveCount()) {
          globalScene.ui.setMode(this.messageMode).then(() => this.rejectMoveAndEnd(move, pokemon));
          return;
        }
        const forgetSuccessText = i18next.t("battle:learnMoveForgetSuccess", {
          pokemonName: getPokemonNameWithAffix(pokemon),
          moveName: pokemon.moveset[moveIndex]!.getName(),
        });
        const fullText = [i18next.t("battle:countdownPoof"), forgetSuccessText, i18next.t("battle:learnMoveAnd")].join(
          "$",
        );
        // Co-op (#633): relay the owner's chosen forget-slot so the partner mirrors it.
        this.coopRelayLearnResult(moveIndex);
        // #record-replay (single-player): capture the learn-move RESULT (the forgotten moveset slot).
        // No-op unless recording / in co-op (the co-op relay above owns that path).
        recordSinglePlayerInteraction("learnMove", moveIndex);
        globalScene.ui.setMode(this.messageMode).then(() => this.learnMove(moveIndex, move, pokemon, fullText));
      },
    );
  }

  /**
   * This asks the player if they wish to end the current move learning process.
   *
   * > Stop trying to teach [MoveName]? --> `Mode.CONFIRM` --> Yes: > [Pokemon] did not learn the move [MoveName], No: `this.replaceMoveCheck()`
   *
   * If the player wishes to not teach the Pokemon the move, it displays a message and ends the phase.
   * If the player reconsiders, it repeats the process for a Pokemon with a full moveset once again.
   * @param move The Move to be learned
   * @param Pokemon The Pokemon learning the move
   */
  async rejectMoveAndEnd(move: Move, pokemon: Pokemon) {
    await globalScene.ui.showTextPromise(
      i18next.t("battle:learnMoveStopTeaching", { moveName: move.name }),
      undefined,
      false,
    );
    globalScene.ui.setModeWithoutClear(
      UiMode.CONFIRM,
      () => {
        globalScene.ui.setMode(this.messageMode);
        // Co-op (#633): relay "did not learn" (sentinel = the move cap) so the partner
        // mirrors the no-op and both leave the screen together.
        this.coopRelayLearnResult(pokemon.getMaxMoveCount());
        // #record-replay (single-player): capture the learn-move DECLINE (sentinel = the move cap).
        // No-op unless recording / in co-op (the co-op relay above owns that path).
        recordSinglePlayerInteraction("learnMove", pokemon.getMaxMoveCount());
        globalScene.ui
          .showTextPromise(
            i18next.t("battle:learnMoveNotLearned", {
              pokemonName: getPokemonNameWithAffix(pokemon),
              moveName: move.name,
            }),
            undefined,
            true,
          )
          .then(() => this.end());
      },
      () => {
        globalScene.ui.setMode(this.messageMode);
        this.replaceMoveCheck(move, pokemon);
      },
    );
  }

  /**
   * This teaches the Pokemon the new move and ends the phase.
   * When a Pokemon forgets a move and learns a new one, its 'Learn Move' message is significantly longer.
   *
   * Pokemon with a `moveset.length < 4`
   * > [Pokemon] learned [MoveName]
   *
   * Pokemon with a `moveset.length > 4`
   * > 1... 2... and 3... and Poof!
   * > [Pokemon] forgot how to use [MoveName]
   * > And...
   * > [Pokemon] learned [MoveName]!
   * @param move The Move to be learned
   * @param Pokemon The Pokemon learning the move
   */
  async learnMove(index: number, move: Move, pokemon: Pokemon, textMessage?: string) {
    if (this.learnMoveType === LearnMoveType.TM) {
      if (!pokemon.usedTMs) {
        pokemon.usedTMs = [];
      }
      pokemon.usedTMs.push(this.moveId);
      globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    } else if (this.learnMoveType === LearnMoveType.MEMORY) {
      if (this.cost === -1) {
        globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
      } else {
        if (!Overrides.WAIVE_ROLL_FEE_OVERRIDE) {
          globalScene.money -= this.cost;
          globalScene.updateMoneyText();
          globalScene.animateMoneyChanged(false);
        }
        globalScene.playSound("se/buy");
      }
    }
    pokemon.setMove(index, this.moveId);
    erRecordAchievementLearnMove(pokemon, this.moveId);
    initMoveAnim(this.moveId).then(() => {
      loadMoveAnimAssets([this.moveId], true);
    });
    globalScene.ui.setMode(this.messageMode);
    const learnMoveText = i18next.t("battle:learnMove", {
      pokemonName: getPokemonNameWithAffix(pokemon),
      moveName: move.name,
    });
    if (textMessage) {
      await globalScene.ui.showTextPromise(textMessage);
    }
    globalScene.playSound("level_up_fanfare"); // Sound loaded into game as is
    globalScene.ui.showText(
      learnMoveText,
      null,
      () => {
        globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeMoveLearnedTrigger, true);
        this.end();
      },
      this.messageMode === UiMode.EVOLUTION_SCENE ? 1000 : undefined,
      true,
    );
  }
}
