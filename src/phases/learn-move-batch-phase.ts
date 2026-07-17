import { globalScene } from "#app/global-scene";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import { allMoves } from "#data/data-lists";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  type CoopLearnMoveOperationBinding,
  captureCoopLearnMoveOperationBinding,
  commitCoopLearnMoveBatchDecision,
  sendCoopLearnMoveBatchPrompt,
} from "#data/elite-redux/coop/coop-learn-move-operation";
import {
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopNetcodeMode,
  getCoopUiMirror,
} from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_LEARN_MOVE_BATCH_CHOICE_KINDS,
  COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE,
} from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import { erRecordAchievementLearnMove } from "#data/elite-redux/er-achievement-tracker";
import { isErOmniformMon, listOmniformEvolutionsForMove } from "#data/elite-redux/omniform-movesets";
import { recordSinglePlayerInteraction } from "#data/elite-redux/replay-single-recording";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { PlayerPartyMemberPokemonPhase } from "#phases/player-party-member-pokemon-phase";
import { EvolutionSceneUiHandler } from "#ui/evolution-scene-ui-handler";

/** The wire `kind` for the relayed batch level-up terminal (see the co-op path below + coop-seq-registry). */
const LEARN_MOVE_BATCH_CHOICE_KIND = "learnMoveBatch";

/**
 * Co-op (#848): the relayed-terminal sentinel meaning "the owner's batch panel errored - fall back to the
 * per-move LearnMovePhase flow". A normal terminal's `choice` is the COUNT of learned moves (>= 0), so a
 * negative sentinel can never collide with a real assignment count.
 */
export const COOP_LEARN_MOVE_BATCH_FALLBACK = -1;

/** How long the host waits for the guest owner's batch decision (20min "wait for the human", LOUD backstop). */
const COOP_LEARN_MOVE_BATCH_WAIT_MS = 1_200_000;

/**
 * Co-op (#848): encode the batch panel's final `[moveId, slotIndex]` assignment list into a relay terminal.
 * `choice` = the assignment COUNT; `data` = the flat `[moveId0, slot0, moveId1, slot1, ...]` (length 2*count).
 * A DECLINE (nothing learned) is `{ choice: 0, data: [] }`.
 */
export function encodeCoopLearnMoveBatchTerminal(learned: readonly [MoveId, number][]): {
  choice: number;
  data: number[];
} {
  const data: number[] = [];
  for (const [moveId, slotIndex] of learned) {
    data.push(moveId, slotIndex);
  }
  return { choice: learned.length, data };
}

/** Co-op (#848): decode a relayed batch terminal `[moveId, slotIndex]` list from a `choice` count + `data`. */
export function decodeCoopLearnMoveBatchTerminal(count: number, data: number[] | undefined): [MoveId, number][] {
  const out: [MoveId, number][] = [];
  const flat = data ?? [];
  for (let i = 0; i < count && i * 2 + 1 < flat.length; i++) {
    out.push([flat[i * 2] as MoveId, flat[i * 2 + 1]]);
  }
  return out;
}

/**
 * ER QoL: filter a level-up move list down to the moves actually offerable in the
 * Move Learn panel - drop {@linkcode MoveId.NONE}, duplicates, and any move the
 * mon already knows, so a move can NEVER be learned twice and a "nothing new"
 * level shows no panel at all. Pure and order-preserving for easy unit testing.
 */
export function filterLearnableMoves(levelMoveIds: number[], knownMoveIds: number[]): MoveId[] {
  const known = new Set(knownMoveIds);
  const seen = new Set<number>();
  const out: MoveId[] = [];
  for (const id of levelMoveIds) {
    if (id === MoveId.NONE || known.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id as MoveId);
  }
  return out;
}

/** Dependencies handed to the Move Learn panel handler (see {@linkcode LearnMoveBatchPhase}). */
export interface LearnMoveBatchDeps {
  pokemon: Pokemon;
  /** The NEW, offerable moves for this level-up (already de-duped / known-filtered). */
  learnableIds: MoveId[];
  /** Silently place a chosen move into a slot (no "learned X" banner). */
  assign: (moveId: MoveId, slotIndex: number) => void;
  /** Undo EVERY assignment made this panel session - restore the exact moveset the
   * mon had before the panel opened (for the "B = oops, undo" exit). */
  revert: () => void;
  /** Called once when the player finishes or cancels; closes the panel + ends the phase. */
  done: () => void;
  /** Panic exit: if the panel fails to open/operate, fall back to the per-move
   * LearnMovePhase flow so the player still learns moves and never softlocks. */
  fallback: () => void;
  /**
   * ER Omniform (#partner-eevee): when true, `pokemon` is an Omniform mon (Partner
   * Eevee), so the panel shows the evolution strip and offers each move PER
   * evolution (base first). The BASE form learns through {@linkcode assign} (the
   * vanilla `mon.moveset` path); every non-base evolution learns into its own
   * stored moveset via `learnMoveForEvolution` (the handler calls the core API
   * directly). `learnableIds` here is the RAW offered set (not base-known-filtered),
   * because a move the base already knows may still be teachable to an evolution.
   * Unset for a normal mon, so the vanilla single-moveset panel is byte-identical.
   */
  omniform?: boolean;
}

/**
 * ER QoL (level-up move panel, #er): replaces the per-move text barrage with ONE
 * interactive panel listing every NEW move this level-up teaches. The player
 * picks moves to learn (and which move they overwrite when the set is full);
 * assignment is SILENT (no "learned X" message) and the list thins down in place.
 * See {@linkcode UiMode.LEARN_MOVE_BATCH} / LearnMoveBatchUiHandler.
 *
 * ONLY the LevelUpPhase loop routes through here. TMs, the egg/Memory tutor, the
 * relearner and evolution-move learning still use the vanilla LearnMovePhase.
 */
export class LearnMoveBatchPhase extends PlayerPartyMemberPokemonPhase {
  public readonly phaseName = "LearnMoveBatchPhase";
  private readonly candidateMoveIds: MoveId[];

  constructor(partyMemberIndex: number, candidateMoveIds: MoveId[]) {
    super(partyMemberIndex);
    this.candidateMoveIds = candidateMoveIds;
  }

  start(): void {
    super.start();
    const pokemon = this.getPokemon();
    // Real moveset (ignoreOverride=true): a stale MOVESET_OVERRIDE must not hide a
    // move the mon truly has, or the "already knows it" filter misses and the same
    // move could be offered/learned twice (mirrors LearnMovePhase's #449 guard).
    const known = pokemon.getMoveset(true).map(m => m.moveId);
    // Also drop any id that doesn't resolve to a real Move - a bad/custom id must
    // never throw inside the panel (the level-up softlock class).
    const learnable = filterLearnableMoves(this.candidateMoveIds, known).filter(id => allMoves[id] != null);

    // ER Omniform (#partner-eevee): a Partner Eevee's level-up offers are expanded
    // PER evolution (not in total) - each offered move can be learned onto the base
    // form AND, independently, onto any evolution that can legally take it. The
    // panel shows the evolution strip; the offered pool is the RAW moves (only
    // NONE / duplicates / unresolvable dropped), NOT base-known-filtered, since a
    // move the base already knows may still be teachable to an evolution. Co-op is
    // out of scope (this branch is the solo path only), so the co-op panel above is
    // untouched. Gated on `isErOmniformMon`, so a normal mon is byte-identical.
    const omniform = !globalScene.gameMode.isCoop && isErOmniformMon(pokemon);
    const offered = omniform
      ? [...new Set(this.candidateMoveIds)].filter(id => id !== MoveId.NONE && allMoves[id] != null)
      : learnable;
    // "Only on levels that teach something new" - nothing offerable -> no panel. For
    // an Omniform mon, "offerable" means SOME evolution can still legally take SOME
    // offered move (base already knowing them all is not enough to skip the panel).
    const hasOffer = omniform
      ? offered.some(id => listOmniformEvolutionsForMove(pokemon, id).some(o => o.canLearn))
      : learnable.length > 0;
    if (!hasOffer) {
      this.end();
      return;
    }

    // Co-op (#848): the batch Move Learn panel is now the SHARED co-op level-up path (the maintainer's
    // explicit want - one nice panel, synced). The mon's OWNER drives the real panel and the WATCHER opens
    // the SAME panel + mirrors the owner's live cursor, both closing together on the relayed terminal (the
    // owner's final assignment set), which the HOST applies authoritatively. This SUPERSEDES the old
    // per-move LearnMovePhase bypass for LEVEL-UP learns (that bypass left the guest's forwarded picker
    // stranded when it never signalled back - the reported P0). Any panel error still falls back to the
    // relayed per-move flow, so it can NEVER softlock. TMs / the egg/Memory tutor / the relearner keep
    // using LearnMovePhase directly. Only AUTHORITATIVE co-op runs this; a non-authoritative
    // (lockstep/spoof) session keeps the byte-identical relayed per-move flow.
    if (globalScene.gameMode.isCoop) {
      if (getCoopNetcodeMode() === "authoritative") {
        this.coopBatchLearnMove(pokemon, learnable);
        return;
      }
      this.coopPerMoveFallback(learnable);
      return;
    }

    const returnMode =
      globalScene.ui.getHandler() instanceof EvolutionSceneUiHandler ? UiMode.EVOLUTION_SCENE : UiMode.MESSAGE;
    const learnedIds: MoveId[] = [];
    // #record-replay (single-player): the overwritten slot for each learned move (parallel to learnedIds),
    // so the batch learn is captured with enough detail for the single-engine loader to reproduce it.
    const learnedSlots: number[] = [];
    let finished = false;
    // Snapshot the pre-panel moveset so the panel's "undo" exit can restore it
    // EXACTLY. setMove() replaces a slot with a NEW PokemonMove, so these held refs
    // are never mutated - re-seating them is a clean revert.
    const snapshotMoveset = [...pokemon.moveset];
    const snapshotSummonMoveset = pokemon.summonData?.moveset ? [...pokemon.summonData.moveset] : null;

    const deps: LearnMoveBatchDeps = {
      pokemon,
      learnableIds: offered,
      omniform,
      assign: (moveId, slotIndex) => {
        // Silent write - no banner, just place the move. Mirrors the data half of
        // LearnMovePhase.learnMove (setMove + load the move's animation assets).
        pokemon.setMove(slotIndex, moveId);
        erRecordAchievementLearnMove(pokemon, moveId);
        learnedIds.push(moveId);
        learnedSlots.push(slotIndex);
        initMoveAnim(moveId).then(() => loadMoveAnimAssets([moveId], true));
      },
      revert: () => {
        // Restore the exact pre-panel moveset and forget every learn this session
        // (so the move-learned form change below does NOT fire for undone moves).
        pokemon.moveset.splice(0, pokemon.moveset.length, ...snapshotMoveset);
        if (snapshotSummonMoveset && pokemon.summonData?.moveset) {
          pokemon.summonData.moveset.splice(0, pokemon.summonData.moveset.length, ...snapshotSummonMoveset);
        }
        learnedIds.length = 0;
        learnedSlots.length = 0;
      },
      done: () => {
        if (finished) {
          return;
        }
        finished = true;
        // Fire any move-learned form change ONCE after the panel closes (not mid-panel).
        if (learnedIds.length > 0) {
          globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeMoveLearnedTrigger, true);
        }
        // #record-replay (single-player): capture the batch level-up learn RESULT so the single-engine
        // loader reproduces it. One "learnMove" per learned move (choice = the overwritten slot, data =
        // [moveId]), or a single DECLINE (choice = the move cap, matching the per-move LearnMovePhase
        // sentinel) when nothing was learned. No-op unless recording; hard no-op in co-op (the co-op branch
        // above already routed level-up learns through the relayed per-move LearnMovePhase, so this never
        // double-records). Fires AFTER the moves are applied (behavior-preserving) + is fully guarded.
        if (learnedIds.length === 0) {
          recordSinglePlayerInteraction("learnMove", pokemon.getMaxMoveCount());
        } else {
          learnedIds.forEach((id, i) => recordSinglePlayerInteraction("learnMove", learnedSlots[i] ?? 0, [id]));
        }
        globalScene.ui.setMode(returnMode).then(() => this.end());
      },
      fallback: () => {
        // Panel failed - restore the known-good per-move LearnMovePhase flow so
        // the player still learns moves and the run NEVER softlocks.
        if (finished) {
          return;
        }
        finished = true;
        for (const id of this.candidateMoveIds) {
          globalScene.phaseManager.unshiftNew("LearnMovePhase", this.partyMemberIndex, id);
        }
        globalScene.ui.setMode(returnMode).then(() => this.end());
      },
    };

    try {
      globalScene.ui.setMode(UiMode.LEARN_MOVE_BATCH, deps);
    } catch (e) {
      console.error("[learn-move-batch] panel failed to open synchronously; per-move fallback", e);
      deps.fallback();
    }
  }

  /** The mode to return to when the panel closes (evolution scene vs the normal message box). */
  private coopReturnMode(): UiMode {
    return globalScene.ui.getHandler() instanceof EvolutionSceneUiHandler ? UiMode.EVOLUTION_SCENE : UiMode.MESSAGE;
  }

  /**
   * Co-op (#848) FAIL-SAFE: route each new move through the relayed per-move {@linkcode LearnMovePhase} flow
   * (owner drives / watcher mirrors, host-authoritative), exactly as the pre-#848 co-op bypass did. Used
   * when there is no live relay/session AND as the panel-error fallback, so a batch-panel failure can never
   * softlock - the player still learns the moves.
   */
  private coopPerMoveFallback(learnable: MoveId[]): void {
    for (const id of learnable) {
      globalScene.phaseManager.unshiftNew("LearnMovePhase", this.partyMemberIndex, id);
    }
    this.end();
  }

  /**
   * Co-op AUTHORITATIVE (#848): drive the SHARED batch Move Learn panel. The HOST is the sole engine and the
   * only client that runs {@linkcode LearnMoveBatchPhase} (the guest is parked in CoopReplayTurnPhase), so:
   *  - stream a `learnMoveBatchForward` present so the PARTNER opens the SAME panel (owner if it owns the
   *    mon, else a read-only watcher);
   *  - HOST-owned mon -> the host DRIVES the real panel and relays the final assignment terminal;
   *  - GUEST-owned mon -> the host opens a read-only WATCHER panel + awaits the guest owner's relayed
   *    terminal, which it applies AUTHORITATIVELY.
   * With no live relay/session it degrades to the relayed per-move flow (never a hang).
   */
  private coopBatchLearnMove(pokemon: Pokemon, learnable: MoveId[]): void {
    const relay = getCoopInteractionRelay();
    const controller = getCoopController();
    if (relay == null || controller == null) {
      coopWarn("learnmove", "co-op batch learn with no relay/controller -> per-move fallback (#848)");
      this.coopPerMoveFallback(learnable);
      return;
    }
    const slot = this.partyMemberIndex;
    const seq = COOP_LEARN_MOVE_BATCH_FWD_SEQ_BASE + slot;
    const owner = (pokemon as { coopOwner?: CoopRole }).coopOwner ?? "host";
    const ownerIsGuest = owner === "guest";
    coopLog("learnmove", "host opens shared batch Move Learn panel (#848)", {
      slot,
      seq,
      learnable: learnable.length,
      ownerIsGuest,
    });
    // Tell the partner to open the SAME panel (owner if it owns the mon, else a read-only watcher).
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const turn = globalScene.currentBattle?.turn ?? 0;
    const operationBinding = captureCoopLearnMoveOperationBinding("host");
    if (
      !sendCoopLearnMoveBatchPrompt(
        relay,
        {
          type: "prompt",
          partySlot: slot,
          learnableIds: [...learnable],
          ownerIsGuest,
        },
        { localRole: "host", wave, turn },
        operationBinding,
      )
    ) {
      failCoopSharedSession(`Learn-move batch prompt for slot ${slot} could not enter durable authority`);
      return;
    }
    if (ownerIsGuest) {
      void this.coopHostWatchBatch(pokemon, learnable, seq, operationBinding);
    } else {
      this.coopHostDriveBatch(pokemon, learnable, seq, operationBinding);
    }
  }

  /**
   * Co-op AUTHORITATIVE HOST (#848): the HOST owns the mon, so it DRIVES the real interactive batch panel and
   * relays the final assignment set as a `learnMoveBatch` terminal for the watcher to close on. beginSession
   * ("owner") so the WATCHER's read-only panel mirrors the host's live cursor (cosmetic). A panel error
   * relays a FALLBACK terminal (so the watcher stops waiting) and runs the relayed per-move flow.
   */
  private coopHostDriveBatch(
    pokemon: Pokemon,
    learnable: MoveId[],
    seq: number,
    operationBinding: CoopLearnMoveOperationBinding,
  ): void {
    const returnMode = this.coopReturnMode();
    const mirror = getCoopUiMirror();
    const relay = getCoopInteractionRelay();
    const snapshotMoveset = [...pokemon.moveset];
    const snapshotSummon = pokemon.summonData?.moveset ? [...pokemon.summonData.moveset] : null;
    const learned: [MoveId, number][] = [];
    let finished = false;
    const deps: LearnMoveBatchDeps = {
      pokemon,
      learnableIds: [...learnable],
      assign: (moveId, slotIndex) => {
        pokemon.setMove(slotIndex, moveId);
        erRecordAchievementLearnMove(pokemon, moveId);
        learned.push([moveId, slotIndex]);
        initMoveAnim(moveId).then(() => loadMoveAnimAssets([moveId], true));
      },
      revert: () => {
        pokemon.moveset.splice(0, pokemon.moveset.length, ...snapshotMoveset);
        if (snapshotSummon && pokemon.summonData?.moveset) {
          pokemon.summonData.moveset.splice(0, pokemon.summonData.moveset.length, ...snapshotSummon);
        }
        learned.length = 0;
      },
      done: () => {
        if (finished) {
          return;
        }
        finished = true;
        if (learned.length > 0) {
          globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeMoveLearnedTrigger, true);
        }
        mirror?.endSession();
        const { choice, data } = encodeCoopLearnMoveBatchTerminal(learned);
        if (
          !commitCoopLearnMoveBatchDecision(
            {
              payload: {
                type: "decision",
                partySlot: this.partyMemberIndex,
                assignments: [...learned],
                fallback: false,
              },
              ownerRole: "host",
              localRole: "host",
              wave: globalScene.currentBattle?.waveIndex ?? 0,
              turn: globalScene.currentBattle?.turn ?? 0,
            },
            operationBinding,
          )
        ) {
          failCoopSharedSession(`Host learn-move batch terminal for slot ${this.partyMemberIndex} was not retained`);
          return;
        }
        relay?.sendInteractionChoice(seq, LEARN_MOVE_BATCH_CHOICE_KIND, choice, data);
        coopLog("learnmove", "host drove batch panel, relays terminal to watcher (#848)", { seq, count: choice });
        globalScene.ui.setMode(returnMode).then(() => this.end());
      },
      fallback: () => {
        if (finished) {
          return;
        }
        finished = true;
        mirror?.endSession();
        if (
          !commitCoopLearnMoveBatchDecision(
            {
              payload: { type: "decision", partySlot: this.partyMemberIndex, assignments: [], fallback: true },
              ownerRole: "host",
              localRole: "host",
              wave: globalScene.currentBattle?.waveIndex ?? 0,
              turn: globalScene.currentBattle?.turn ?? 0,
            },
            operationBinding,
          )
        ) {
          failCoopSharedSession(`Host learn-move batch fallback for slot ${this.partyMemberIndex} was not retained`);
          return;
        }
        // Tell the watcher to stop waiting, then run the known-good relayed per-move flow.
        relay?.sendInteractionChoice(seq, LEARN_MOVE_BATCH_CHOICE_KIND, COOP_LEARN_MOVE_BATCH_FALLBACK);
        coopWarn("learnmove", "host batch panel fallback -> per-move flow (#848)", { seq });
        for (const id of learnable) {
          globalScene.phaseManager.unshiftNew("LearnMovePhase", this.partyMemberIndex, id);
        }
        globalScene.ui.setMode(returnMode).then(() => this.end());
      },
    };
    try {
      globalScene.ui.setMode(UiMode.LEARN_MOVE_BATCH, deps);
      mirror?.beginSession("owner", UiMode.LEARN_MOVE_BATCH, seq);
    } catch (e) {
      console.error("[learn-move-batch] co-op host-drive panel failed to open; per-move fallback", e);
      deps.fallback();
    }
  }

  /**
   * Co-op AUTHORITATIVE HOST (#848): the GUEST owns the mon, so the human who owns it drives the panel. The
   * host opens a READ-ONLY WATCHER panel (beginSession "watcher" so the ui.ts cursor mirror replays the
   * guest's live cursor - cosmetic) and AWAITS the guest owner's relayed terminal with a FINITE timeout,
   * which it applies AUTHORITATIVELY from the pre-panel snapshot (robust to any cosmetic cursor drift). On a
   * null (timeout / disconnect) it keeps the mon's current moves and ends - it can NEVER hang; on a FALLBACK
   * terminal it runs the relayed per-move flow.
   */
  private async coopHostWatchBatch(
    pokemon: Pokemon,
    learnable: MoveId[],
    seq: number,
    operationBinding: CoopLearnMoveOperationBinding,
  ): Promise<void> {
    const returnMode = this.coopReturnMode();
    const relay = getCoopInteractionRelay();
    const mirror = getCoopUiMirror();
    if (relay == null) {
      this.coopPerMoveFallback(learnable);
      return;
    }
    const snapshotMoveset = [...pokemon.moveset];
    const snapshotSummon = pokemon.summonData?.moveset ? [...pokemon.summonData.moveset] : null;
    // Read-only watcher panel: cosmetic (no engine writes); the awaited terminal is the sole authority.
    const watchDeps: LearnMoveBatchDeps = {
      pokemon,
      learnableIds: [...learnable],
      assign: () => {
        /* read-only watcher: the awaited terminal applies the moves authoritatively */
      },
      revert: () => {
        /* read-only watcher: nothing to revert (no local writes) */
      },
      done: () => {
        /* the authoritative close is the awaited terminal, not the mirrored button */
      },
      fallback: () => {
        /* handled on the terminal path below */
      },
    };
    try {
      await globalScene.ui.setModeWithoutClear(UiMode.LEARN_MOVE_BATCH, watchDeps);
      mirror?.beginSession("watcher", UiMode.LEARN_MOVE_BATCH, seq);
    } catch (e) {
      coopWarn("learnmove", "host watcher batch panel failed to open (still awaiting terminal) (#848)", e);
    }
    const res = await relay.awaitInteractionChoice(
      seq,
      COOP_LEARN_MOVE_BATCH_WAIT_MS,
      COOP_LEARN_MOVE_BATCH_CHOICE_KINDS,
    );
    mirror?.endSession();
    if (res == null) {
      coopWarn("learnmove", "guest batch terminal null (timeout/disconnect); keeping current moves (#848)", { seq });
      if (
        !commitCoopLearnMoveBatchDecision(
          {
            payload: { type: "decision", partySlot: this.partyMemberIndex, assignments: [], fallback: true },
            ownerRole: "guest",
            localRole: "host",
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
          },
          operationBinding,
        )
      ) {
        failCoopSharedSession(`Guest learn-move batch timeout for slot ${this.partyMemberIndex} was not retained`);
        return;
      }
      await globalScene.ui.setMode(returnMode);
      this.end();
      return;
    }
    if (res.choice === COOP_LEARN_MOVE_BATCH_FALLBACK) {
      coopWarn("learnmove", "guest batch panel fell back; host runs relayed per-move flow (#848)", { seq });
      if (
        !commitCoopLearnMoveBatchDecision(
          {
            payload: { type: "decision", partySlot: this.partyMemberIndex, assignments: [], fallback: true },
            ownerRole: "guest",
            localRole: "host",
            wave: globalScene.currentBattle?.waveIndex ?? 0,
            turn: globalScene.currentBattle?.turn ?? 0,
          },
          operationBinding,
        )
      ) {
        failCoopSharedSession(`Guest learn-move batch fallback for slot ${this.partyMemberIndex} was not retained`);
        return;
      }
      await globalScene.ui.setMode(returnMode);
      this.coopPerMoveFallback(learnable);
      return;
    }
    const assignments = decodeCoopLearnMoveBatchTerminal(res.choice, res.data);
    if (
      !commitCoopLearnMoveBatchDecision(
        {
          payload: {
            type: "decision",
            partySlot: this.partyMemberIndex,
            assignments: assignments.map(([moveId, slotIndex]) => [moveId, slotIndex] as [number, number]),
            fallback: false,
          },
          ownerRole: "guest",
          localRole: "host",
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: globalScene.currentBattle?.turn ?? 0,
        },
        operationBinding,
      )
    ) {
      failCoopSharedSession(`Guest learn-move batch terminal for slot ${this.partyMemberIndex} was not retained`);
      return;
    }
    // Apply the guest owner's picks AUTHORITATIVELY from the pre-panel snapshot (unaffected by cursor drift).
    pokemon.moveset.splice(0, pokemon.moveset.length, ...snapshotMoveset);
    if (snapshotSummon && pokemon.summonData?.moveset) {
      pokemon.summonData.moveset.splice(0, pokemon.summonData.moveset.length, ...snapshotSummon);
    }
    for (const [moveId, slotIndex] of assignments) {
      pokemon.setMove(slotIndex, moveId);
      erRecordAchievementLearnMove(pokemon, moveId);
      initMoveAnim(moveId).then(() => loadMoveAnimAssets([moveId], true));
    }
    if (assignments.length > 0) {
      globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeMoveLearnedTrigger, true);
    }
    coopLog("learnmove", "host applied guest's batch terminal authoritatively (#848)", {
      seq,
      count: assignments.length,
    });
    await globalScene.ui.setMode(returnMode);
    this.end();
  }
}
