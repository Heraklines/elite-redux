import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import Overrides from "#app/overrides";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import { allMoves } from "#data/data-lists";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  armCoopLearnMoveIntentResend,
  type CoopLearnMoveOperationBinding,
  captureCoopLearnMoveOperationBinding,
  commitCoopLearnMoveDecision,
  sendCoopLearnMovePrompt,
} from "#data/elite-redux/coop/coop-learn-move-operation";
import {
  advanceCoopInteractionForContinuation,
  clearCoopLearnMoveForwardInFlight,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopNetcodeMode,
  getCoopRuntime,
  getCoopUiMirror,
  markCoopLearnMoveForwardInFlight,
} from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_LEARN_MOVE_CHOICE_KINDS,
  COOP_LEARN_MOVE_FWD_SEQ_BASE,
  COOP_LEARN_MOVE_SEQ,
} from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import { erRecordAchievementLearnMove } from "#data/elite-redux/er-achievement-tracker";
import {
  getOrRollFormMoveset,
  isErOmniformMon,
  learnMoveForEvolution,
  listOmniformEvolutionsForMove,
  type OmniformTarget,
  omniformBaseIdentity,
} from "#data/elite-redux/omniform-movesets";
import { recordSinglePlayerInteraction } from "#data/elite-redux/replay-single-recording";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { PlayerPartyMemberPokemonPhase } from "#phases/player-party-member-pokemon-phase";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { EvolutionSceneUiHandler } from "#ui/evolution-scene-ui-handler";
import { omniformEntriesForTargets } from "#ui/omniform-evolution-view";
import { SummaryUiMode } from "#ui/summary-ui-handler";
import i18next from "i18next";

// Co-op (#633): the move-replace ("which move to forget") menu is an OWNED, shared screen.
// Only the player whose mon is learning the move drives it; the partner watches and mirrors
// the result so both clients transition together. All relayed on one dedicated seq (FIFO,
// distinct from the small interaction-turn seqs the reward shop uses).
// #840: COOP_LEARN_MOVE_SEQ + COOP_LEARN_MOVE_FWD_SEQ_BASE now live in coop-seq-registry;
// re-exported here. COOP_LEARN_MOVE_SEQ was RELOCATED from 9_000_001 (which sat inside the 9M
// ME-terminal band `COOP_ME_TERM_SEQ_BASE + counter`, a numeric overlap the collision test caught)
// to a free base above every other band. Same-build: the send + await read this one const.
export { COOP_LEARN_MOVE_FWD_SEQ_BASE, COOP_LEARN_MOVE_SEQ };

/** How long the watcher waits for the owner's move-replace decision before giving up.
 *  20min: "wait for the human" - a slow decision must never trip a premature give-up (desync). */
const COOP_LEARN_MOVE_WAIT_MS = 1_200_000;

/** The host awaits the guest's forwarded pick. "Wait for the human" but bounded so a disconnected /
 *  idle partner can never freeze the host: on a null / timeout the host keeps the mon's current moves. */
export const COOP_LEARN_MOVE_FWD_WAIT_MS = 1_200_000;

export class LearnMovePhase extends PlayerPartyMemberPokemonPhase {
  public readonly phaseName = "LearnMovePhase";
  private readonly moveId: MoveId;
  private messageMode: UiMode;
  private readonly learnMoveType: LearnMoveType;
  private readonly cost: number;
  /** Stable selectors for every authoritative picker callback / await tail owned by this phase. */
  private coopOperationBinding: CoopLearnMoveOperationBinding | null = null;
  private coopRelay: CoopInteractionRelay | null = null;
  private coopLocalRole: CoopRole | null = null;
  private coopInteractionCounter: (() => number) | null = null;
  private coopRuntimeBound = false;

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

    // ER Omniform (#partner-eevee): a Partner Eevee can be taught a move (TM Case,
    // Learner's Shroom, Memory Mushroom, relearner, ... - "anything that can teach")
    // onto ANY of its evolutions. Offer an evolution picker first, then route: the
    // BASE form takes the normal learn flow (mon.moveset, banner, TM tracking); a
    // non-base evolution learns into its OWN stored moveset via learnMoveForEvolution.
    // Solo-only (co-op is out of scope) + gated on isErOmniformMon, so every
    // non-Omniform + co-op flow is byte-identical.
    if (!globalScene.gameMode.isCoop && isErOmniformMon(pokemon)) {
      this.omniformLearnMove(pokemon, move);
      return;
    }

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
      if (!this.bindCoopAuthoritativeRuntime()) {
        return;
      }
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

  /** Capture the phase's runtime once, before any authoritative UI callback or await can outlive ambient state. */
  private bindCoopAuthoritativeRuntime(): boolean {
    if (this.coopRuntimeBound) {
      return true;
    }
    const controller = getCoopController();
    if (controller == null) {
      failCoopSharedSession("Learn-move phase could not bind to a live authoritative role");
      return false;
    }
    this.coopLocalRole = controller.role;
    this.coopInteractionCounter = () => controller.interactionCounter();
    this.coopOperationBinding = captureCoopLearnMoveOperationBinding(controller.role);
    this.coopRelay = getCoopInteractionRelay();
    this.coopRuntimeBound = true;
    return true;
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
    const localRole = this.coopLocalRole ?? getCoopController()?.role;
    if (localRole == null) {
      return;
    }
    const owner = (this.getPokemon() as { coopOwner?: CoopRole }).coopOwner ?? "host";
    if (owner !== localRole) {
      return;
    }
    if (this.coopOperationBinding != null && localRole === "host") {
      const committed = commitCoopLearnMoveDecision(
        {
          payload: {
            type: "decision",
            partySlot: this.partyMemberIndex,
            moveId: this.moveId,
            forgetSlot: moveIndex,
            maxMoveCount: this.getPokemon().getMaxMoveCount(),
          },
          ownerRole: "host",
          localRole: "host",
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        this.coopOperationBinding,
      );
      if (!committed) {
        failCoopSharedSession(`Host-owned learn-move decision for slot ${this.partyMemberIndex} was not retained`);
        return;
      }
    }
    (this.coopRelay ?? getCoopInteractionRelay())?.sendInteractionChoice(COOP_LEARN_MOVE_SEQ, "learnMove", moveIndex);
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

    const res = await relay.awaitInteractionChoice(
      COOP_LEARN_MOVE_SEQ,
      COOP_LEARN_MOVE_WAIT_MS,
      COOP_LEARN_MOVE_CHOICE_KINDS,
    );
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
    // The normal phase path binds in start(). Keep this guard here because existing reward-continuation
    // adapters invoke this dispatch directly; they still must capture the exact runtime before opening UI.
    if (!this.bindCoopAuthoritativeRuntime()) {
      return;
    }
    if (this.coopLocalRole === "guest") {
      // #835 cross-ownership softlock: when a shop-continuation reward (TM Case / Learner's Shroom /
      // Memory Mushroom) is bought - by EITHER player - for a GUEST-owned mon whose moveset is FULL, the
      // "which move to forget" pick belongs to the GUEST (the mon's owner). The guest ALSO has this real
      // LearnMovePhase (queued by the reward apply on the owner/watcher shop axis, which applies on BOTH
      // clients). Pre-#835 the guest branch immediately removed the continuation copy + advanced the
      // counter + ended, and the guest's picker came only from a DETACHED overlay (#787
      // openCoopLearnMovePickerInline via wireCoopLearnMoveForward) that no phase kept alive - so a
      // following setMode tore it off screen before the human picked, the guest never relayed a
      // forget-index, and the host's forwarded await (coopHostForwardLearnMove) stranded on the read-only
      // picker for the full 20-min fallback (the reported "the other person stays in the selection
      // screen"). Fix: render the picker HERE, from this queue-protected phase, and DEFER the copy-removal
      // + advance until the pick settles - symmetric to the host's coopHostForwardLearnMove.
      const monOwner = (pokemon as { coopOwner?: CoopRole }).coopOwner ?? "host";
      const movesetFull =
        typeof pokemon?.getMaxMoveCount === "function" && currentMoveset.length >= pokemon.getMaxMoveCount();
      if (monOwner === "guest" && movesetFull) {
        this.coopGuestForwardOwnedLearnMove(move, pokemon);
        return;
      }
      // #873 cross-ownership DROPPED-LEARN: when a reward-shop TM / TM Case / Learner's Shroom / free
      // Memory Mushroom is bought - by EITHER player - for a GUEST-owned mon whose moveset has an EMPTY
      // slot, the learn is a DETERMINISTIC auto-learn (no forget-picker, no human choice). The reward
      // apply queues this real LearnMovePhase on BOTH clients; the HOST auto-learns onto its copy of the
      // merged party (the empty-slot branch below), but pre-#873 the guest branch treated its OWN
      // LearnMovePhase as a pure-renderer no-op and ended WITHOUT learning - so the move landed only on
      // the host and the reporting guest (the mon's owner) never saw it ("partner picked a TM for me
      // with Surf but it did not appear in my moveset"). Nothing heals it: a BENCH mon's moveset is
      // hashed NOWHERE (the per-turn checksum hashes ON-FIELD moves only; the session-save digest
      // excludes the full party PokemonData), so no resync ever detects or reconciles the divergence.
      // Fix: the mon OWNER applies its own deterministic empty-slot learn HERE, symmetric to the host -
      // the recipient-drives application (#800/#831). learnMove() runs the SAME #698 continuation cleanup
      // (TM / free-Memory tryRemovePhase("SelectModifierPhase") + advance) the no-op branch below does,
      // so this fully supersedes it for the guest-owned empty-slot case. There is NO double-render here:
      // the persistent CoopReplayLearnMovePhase listener only spawns on a host `learnMoveForward`, which
      // the host sends ONLY for a FULL guest-owned moveset (coopHostForwardLearnMove) - never here.
      if (monOwner === "guest" && !movesetFull) {
        this.learnMove(currentMoveset.length, move, pokemon);
        return;
      }
      // #875 cross-ownership DROPPED-LEARN, HOST-OWNED MIRROR: the SYMMETRIC counterpart of the #873 case
      // above. When a reward-shop TM / TM Case / Learner's Shroom / free Memory Mushroom is bought - by
      // EITHER player - for a HOST-owned mon whose moveset has an EMPTY slot, the learn is a DETERMINISTIC
      // auto-learn (no forget-picker, no human choice). The reward apply queues this real LearnMovePhase on
      // BOTH clients; the HOST auto-learns onto its authoritative copy (the empty-slot branch below), but
      // pre-#875 the guest branch treated its LearnMovePhase as a pure-renderer no-op and ended WITHOUT
      // learning - so the move landed on the host's copy while the guest's MIRROR of the host-owned mon
      // never learned it (#873 fixed only the guest-OWNED recipient case). A BENCH mon's moveset is hashed
      // NOWHERE by the base per-turn checksum (ON-FIELD moves only) and the session-save digest excludes the
      // full party PokemonData, so the divergence is INVISIBLE to the checksum (until #875's benchMoves
      // digest); the guest's mirror only re-converged opportunistically at the next per-turn authoritative
      // state apply. Fix: the guest applies the SAME deterministic empty-slot learn onto its mirror HERE, so
      // both engines' copies know the move IMMEDIATELY - the recipient-drives application (#800/#831/#873)
      // extended from the mon's OWNER to its watcher MIRROR. learnMove() runs the SAME #698 continuation
      // cleanup (TM / free-Memory tryRemovePhase("SelectModifierPhase") + advance) the no-op branch below
      // does, so it fully supersedes it for the host-owned empty-slot case. There is NO double-render: the
      // persistent CoopReplayLearnMovePhase listener only spawns on a host `learnMoveForward`, which the host
      // sends ONLY for a FULL GUEST-owned moveset (coopHostForwardLearnMove) - never for a host-owned mon.
      // The FULL-moveset host-owned case (host drives an interactive forget-picker; the forget slot is the
      // host human's non-deterministic choice) is NOT mirrored here - it stays a no-op end and re-converges
      // via the per-turn authoritative-state apply + the new benchMoves checksum (which now DETECTS it).
      if (monOwner === "host" && !movesetFull) {
        this.learnMove(currentMoveset.length, move, pokemon);
        return;
      }
      // #698 stale-shop softlock: a TM Case / Memory-Mushroom (cost=-1) reward queues a back-out
      // "continuation" SelectModifierPhase copy alongside this LearnMovePhase (see
      // SelectModifierPhase.applyModifier queuesContinuation). On the HOST the real learnMove() deletes
      // that copy via tryRemovePhase("SelectModifierPhase"); the guest's no-op branch below never runs
      // learnMove(), so the copy would orphan -> the watcher re-enters a reward shop the owner already
      // left and hangs (20-min await), which also blocks the resync that should rescue it. Mirror the
      // host's exact tryRemovePhase conditions (learn-move-phase learnMove: TM, or MEMORY with cost=-1)
      // so the guest's phase queue converges. Gated inside the authoritative-guest branch -> solo / host
      // / lockstep / hotseat are byte-identical (they never enter here). This path is the EMPTY-slot
      // auto-learn (no picker) or a HOST-owned mon (the host drives its own picker via replaceMoveCheck),
      // so the guest takes no interactive action and the immediate cleanup is correct.
      // #789-class (probe-verified for capsules): removing the continuation copy IS the commit
      // signal for a continuation-class reward - the shop deliberately skipped its advance, so
      // advance HERE or the alternation rotation stalls on the same owner. From-pinned to the
      // live counter, so a double-fire (or the partner's broadcast landing first) is a no-op.
      if (
        (this.learnMoveType === LearnMoveType.TM || (this.learnMoveType === LearnMoveType.MEMORY && this.cost === -1))
        && globalScene.phaseManager.tryRemovePhase("SelectModifierPhase")
      ) {
        advanceCoopInteractionForContinuation(this.coopInteractionCounter?.() ?? -1);
      }
      // Pure renderer: for the EMPTY-slot / host-owned-mon case the persistent listener's
      // CoopReplayLearnMovePhase (level-up path) or the host's own picker is the sole renderer.
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
    const relay = this.coopRelay;
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
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const turn = globalScene.currentBattle?.turn ?? 0;
    const operationBinding = this.coopOperationBinding;
    if (
      operationBinding == null
      || !sendCoopLearnMovePrompt(
        relay,
        {
          type: "prompt",
          partySlot: slot,
          moveId: this.moveId,
          maxMoveCount,
        },
        { localRole: "host", wave, turn },
        operationBinding,
      )
    ) {
      failCoopSharedSession(`Learn-move prompt for slot ${slot} could not enter durable authority`);
      return;
    }
    const mirror = getCoopUiMirror();
    // Render the picker READ-ONLY (no-op callback: the outcome is the relayed pick, never this
    // callback) and mirror the GUEST's live cursor so the host watches the partner choose.
    await globalScene.ui.setModeWithoutClear(UiMode.SUMMARY, pokemon, SummaryUiMode.LEARN_MOVE, move, () => {});
    mirror?.beginSession("watcher", UiMode.SUMMARY, COOP_LEARN_MOVE_SEQ);

    const res = await relay.awaitInteractionChoice(seq, COOP_LEARN_MOVE_FWD_WAIT_MS, COOP_LEARN_MOVE_CHOICE_KINDS);
    mirror?.endSession();
    if (res == null) {
      coopWarn("learnmove", "guest forward pick null (timeout/disconnect); keeping current moves", { slot, seq });
    }
    // null -> getMaxMoveCount() sentinel -> applyForgetResult keeps current moves + ends (no hang).
    const forgetSlot = res?.choice ?? maxMoveCount;
    if (
      !commitCoopLearnMoveDecision(
        {
          payload: { type: "decision", partySlot: slot, moveId: this.moveId, forgetSlot, maxMoveCount },
          ownerRole: "guest",
          localRole: "host",
          wave,
          turn,
        },
        operationBinding,
      )
    ) {
      failCoopSharedSession(`Learn-move decision for slot ${slot} could not enter durable authority`);
      return;
    }
    await this.applyForgetResult(forgetSlot, move, pokemon);
  }

  /**
   * Co-op AUTHORITATIVE GUEST (#835): the guest OWNS this full-moveset mon, so the "which move to forget"
   * pick is the GUEST's - but the actual forget is applied HOST-authoritatively. This runs when a
   * shop-continuation reward (TM Case / Learner's Shroom / free Memory Mushroom) queued a real guest
   * {@linkcode LearnMovePhase} on a guest-owned mon (the reward apply runs on BOTH clients). It renders
   * the interactive forget-picker from THIS queue-protected phase (not the detached #787 overlay, which
   * a following setMode could tear off), relays the human's chosen slot to the host on the disjoint
   * `9_100_000 + partySlot` channel (the SAME channel the host's {@linkcode coopHostForwardLearnMove}
   * awaits), and only THEN performs the deferred continuation cleanup (remove the back-out copy + advance
   * the alternation). So the host's forwarded await resolves the instant the guest picks and BOTH screens
   * dismiss together - no orphaned overlay, no 20-min strand.
   *
   * It is the SOLE renderer for this learn: the in-flight mark (set synchronously, before the host's
   * ordered `learnMoveForward` for this slot is processed) makes {@linkcode wireCoopLearnMoveForward}
   * short-circuit its duplicate listener open. The picker resolves on LOCAL human input / B-cancel, so it
   * can never hang; if the relay is missing it degrades to the immediate cleanup below (still no hang).
   */
  private coopGuestForwardOwnedLearnMove(move: Move, pokemon: Pokemon): void {
    const slot = this.partyMemberIndex;
    // Claim the slot BEFORE any await so the ordered `learnMoveForward` the host is about to send finds
    // the guard SET and does not also open the detached overlay (double-render guard).
    markCoopLearnMoveForwardInFlight(slot);
    const seq = COOP_LEARN_MOVE_FWD_SEQ_BASE + slot;
    const relay = this.coopRelay;
    const operationBinding = this.coopOperationBinding;
    const mirror = getCoopUiMirror();
    coopLog("learnmove", "guest OWNS this full-moveset mon -> renders the forget-picker itself (#835)", {
      slot,
      moveId: this.moveId,
      seq,
    });
    let settled = false;
    const finish = (moveIndex: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      mirror?.endSession();
      clearCoopLearnMoveForwardInFlight(slot);
      // Relay the human's forget-slot to the host (the sole engine); it applies the forget + learns.
      coopLog("learnmove", "guest relays owned-mon forget-pick (#835)", { seq, moveIndex });
      relay?.sendInteractionChoice(seq, "learnMove", moveIndex);
      const payload = {
        type: "decision" as const,
        partySlot: slot,
        moveId: this.moveId,
        forgetSlot: moveIndex,
        maxMoveCount: pokemon.getMaxMoveCount(),
      };
      armCoopLearnMoveIntentResend(
        {
          payload,
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: globalScene.currentBattle?.turn ?? 0,
          resend: () => relay?.sendInteractionChoice(seq, "learnMove", moveIndex),
        },
        operationBinding,
      );
      // DEFERRED continuation cleanup: now that the pick is committed, remove the back-out SelectModifier
      // copy + advance the alternation (the same commit the immediate no-op path does, but AFTER the pick
      // instead of before it - so the picker overlay lived long enough for the human to use it).
      if (
        (this.learnMoveType === LearnMoveType.TM || (this.learnMoveType === LearnMoveType.MEMORY && this.cost === -1))
        && globalScene.phaseManager.tryRemovePhase("SelectModifierPhase")
      ) {
        advanceCoopInteractionForContinuation(this.coopInteractionCounter?.() ?? -1);
      }
      void globalScene.ui.setMode(this.messageMode).then(() => this.end());
    };
    if (relay == null || operationBinding == null) {
      clearCoopLearnMoveForwardInFlight(slot);
      failCoopSharedSession(`Guest-owned learn-move picker for slot ${slot} lost its runtime binding`);
      return;
    }
    // Render the REAL interactive move-forget picker (the shared #563 screen). beginSession("owner", ...)
    // so the HOST's read-only mirror follows this client's live cursor (cosmetic).
    void globalScene.ui
      .setModeWithoutClear(UiMode.SUMMARY, pokemon, SummaryUiMode.LEARN_MOVE, move, (moveIndex: number) =>
        finish(moveIndex),
      )
      .then(() => {
        mirror?.beginSession("owner", UiMode.SUMMARY, COOP_LEARN_MOVE_SEQ);
      });
  }

  /**
   * ER Omniform (#partner-eevee): offer an evolution picker for a taught move, then
   * route the learn per the chosen evolution. Every family evolution that can LEGALLY
   * take the move and does not already know it is listed (base first); illegal /
   * already-known evolutions are omitted. Picking the BASE form runs the normal learn
   * flow; picking a non-base evolution teaches into its own stored moveset. If NO
   * evolution can take it (all already know it / illegal), it ends as a no-op (the
   * vanilla "already knows" behavior).
   */
  private omniformLearnMove(pokemon: Pokemon, move: Move): void {
    this.messageMode =
      globalScene.ui.getHandler() instanceof EvolutionSceneUiHandler ? UiMode.EVOLUTION_SCENE : UiMode.MESSAGE;
    const offers = listOmniformEvolutionsForMove(pokemon, this.moveId).filter(o => o.canLearn);
    if (offers.length === 0) {
      // No evolution can take it (all already know it / illegal) - mirror the vanilla no-op end.
      this.end();
      return;
    }
    const base = omniformBaseIdentity(pokemon);
    const entries = omniformEntriesForTargets(
      pokemon,
      offers.map(o => o.form),
    );
    const options: OptionSelectItem[] = offers.map((offer, i) => ({
      label: entries[i]?.name ?? String(offer.form.speciesId),
      handler: () => {
        if (offer.form.speciesId === base.speciesId && offer.form.formIndex === base.formIndex) {
          this.omniformLearnBase(pokemon, move);
        } else {
          this.omniformTeachEvolution(pokemon, move, offer.form, entries[i]?.name ?? move.name);
        }
        return true;
      },
    }));
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        this.rejectMoveAndEnd(move, pokemon);
        return true;
      },
    });
    globalScene.ui.setMode(this.messageMode).then(() =>
      globalScene.ui.showText(
        i18next.t("battle:learnMovePrompt", {
          pokemonName: getPokemonNameWithAffix(pokemon),
          moveName: move.name,
        }),
        null,
        () => globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, { options }),
      ),
    );
  }

  /** ER Omniform: the BASE form was chosen - run the normal solo learn flow (mon.moveset). */
  private omniformLearnBase(pokemon: Pokemon, move: Move): void {
    const currentMoveset = pokemon.getMoveset(true);
    globalScene.ui.setMode(this.messageMode);
    // Co-op is excluded by the omniform gate, so this is the plain solo learn path:
    // an empty slot auto-learns; a full moveset asks which move to replace.
    if (currentMoveset.length < pokemon.getMaxMoveCount()) {
      this.learnMove(currentMoveset.length, move, pokemon);
    } else {
      this.replaceMoveCheck(move, pokemon);
    }
  }

  /**
   * ER Omniform: teach the move into a NON-base evolution's OWN stored moveset via the
   * core teach API. A free slot learns directly; a full stored moveset presents a
   * compact "which move to forget" picker over THAT evolution's moves (OPTION_SELECT,
   * no new screen). 5th-move-slot aware through getMaxMoveCount().
   */
  private omniformTeachEvolution(pokemon: Pokemon, move: Move, form: OmniformTarget, evoName: string): void {
    const stored = getOrRollFormMoveset(pokemon, form);
    const max = pokemon.getMaxMoveCount();
    const filled = stored.filter(([m]) => m !== MoveId.NONE).length;
    if (filled < max) {
      const res = learnMoveForEvolution(pokemon, form, this.moveId, filled);
      this.omniformFinishEvolution(pokemon, move, evoName, res.ok);
      return;
    }
    // Full: pick which of the evolution's moves to overwrite.
    const options: OptionSelectItem[] = [];
    for (let i = 0; i < max; i++) {
      const pair = stored[i];
      const name = pair && pair[0] !== MoveId.NONE ? allMoves[pair[0]].name : "(empty)";
      const slot = i;
      options.push({
        label: name,
        handler: () => {
          const res = learnMoveForEvolution(pokemon, form, this.moveId, slot);
          this.omniformFinishEvolution(pokemon, move, evoName, res.ok);
          return true;
        },
      });
    }
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        this.rejectMoveAndEnd(move, pokemon);
        return true;
      },
    });
    globalScene.ui
      .setMode(this.messageMode)
      .then(() =>
        globalScene.ui.showText(i18next.t("battle:learnMoveForgetQuestion"), null, () =>
          globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, { options }),
        ),
      );
  }

  /**
   * ER Omniform: finish a non-base evolution teach - run the same TM / free-Memory
   * continuation cleanup the vanilla {@linkcode learnMove} does (record the TM, drop
   * the reward-shop back-out copy), then confirm and end. Never softlocks on a failed
   * teach (the offer was pre-validated, but stay safe).
   */
  private omniformFinishEvolution(pokemon: Pokemon, move: Move, evoName: string, ok: boolean): void {
    globalScene.ui.setMode(this.messageMode);
    if (!ok) {
      this.end();
      return;
    }
    // Mirror learnMove's continuation cleanup so a TM Case / free Memory Mushroom does
    // not orphan its reward-screen back-out SelectModifierPhase copy (#698).
    if (this.learnMoveType === LearnMoveType.TM) {
      if (!pokemon.usedTMs) {
        pokemon.usedTMs = [];
      }
      pokemon.usedTMs.push(this.moveId);
      globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    } else if (this.learnMoveType === LearnMoveType.MEMORY && this.cost === -1) {
      globalScene.phaseManager.tryRemovePhase("SelectModifierPhase");
    }
    erRecordAchievementLearnMove(pokemon, this.moveId);
    initMoveAnim(this.moveId).then(() => loadMoveAnimAssets([this.moveId], true));
    globalScene.playSound("level_up_fanfare");
    globalScene.ui.showText(
      i18next.t("battle:learnMove", {
        pokemonName: `${getPokemonNameWithAffix(pokemon)} (${evoName})`,
        moveName: move.name,
      }),
      null,
      () => this.end(),
      this.messageMode === UiMode.EVOLUTION_SCENE ? 1000 : undefined,
      true,
    );
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
      // #789-class: the continuation-copy removal is the interaction commit (see the guest mirror
      // branch above) - advance the alternation or the rotation stalls after a committed TM.
      if (globalScene.phaseManager.tryRemovePhase("SelectModifierPhase")) {
        advanceCoopInteractionForContinuation(
          this.coopInteractionCounter?.() ?? getCoopController()?.interactionCounter() ?? -1,
        );
      }
    } else if (this.learnMoveType === LearnMoveType.MEMORY) {
      if (this.cost === -1 && globalScene.phaseManager.tryRemovePhase("SelectModifierPhase")) {
        advanceCoopInteractionForContinuation(
          this.coopInteractionCounter?.() ?? getCoopController()?.interactionCounter() ?? -1,
        );
      } else if (this.cost !== -1) {
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
