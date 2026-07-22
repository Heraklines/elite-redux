import type { TurnCommand } from "#app/battle";
import { MAX_TERAS_PER_ARENA } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { TrappedTag } from "#data/battler-tags";
import { getDailyEventSeedBoss } from "#data/daily-seed/daily-run";
import { isDailyFinalBoss } from "#data/daily-seed/daily-seed-utils";
import { isCoopV2ReplacementCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-replacement";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import {
  applyCoopAuthoritativeBattleState,
  coopAppliedStateTick,
  reapplyAcceptedCoopAuthoritativeBattleState,
} from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { adoptCoopEnemiesStructural } from "#data/elite-redux/coop/coop-enemy-builder";
import {
  applyWiredPartnerCommand,
  type ResolvedPartnerCommand,
  resolvePartnerCommand,
} from "#data/elite-redux/coop/coop-partner-ai";
import { ensureCoopAuthoritativeCommandPresentation } from "#data/elite-redux/coop/coop-presentation";
import { getCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import {
  cancelCoopV2DeferredCommandStart,
  coopHasPendingWaveAdvance,
  coopOwnerOfPlayerFieldSlot,
  enterCoopV2CommandControlBoundary,
  failCoopSharedSession,
  getCoopBattleStreamer,
  getCoopBattleSync,
  getCoopController,
  getCoopNetcodeMode,
  getCoopRendezvous,
  getCoopRuntime,
  isCoopAuthoritativeGuest,
  isCoopSharedTerminalFrozen,
  isCoopV2CommandAdmissionFrozen,
  isCoopV2ControlSurfaceStartFrozen,
  isVersusSession,
  pendingCoopAuthoritativeReplacementReplayTurn,
  recordCoopOwnSlotCommand,
  recordCoopPartnerSlotCommand,
  recordCoopV2CommandControlStarted,
} from "#data/elite-redux/coop/coop-runtime";
import type {
  CoopBattleCommandOffer,
  CoopBattleTargetRef,
  SerializedCommand,
} from "#data/elite-redux/coop/coop-transport";
import { reloadCurrentWave } from "#data/elite-redux/er-reset-wave";
import { recordSinglePlayerCommand } from "#data/elite-redux/replay-single-recording";
import { getShowdownRelay } from "#data/elite-redux/showdown/showdown-battle-state";
import { SHOWDOWN_TURN_TIMER_MS } from "#data/elite-redux/showdown/showdown-command-relay";
import {
  buildShowdownFightCommand,
  buildShowdownSwitchCommand,
} from "#data/elite-redux/showdown/showdown-guest-command";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { Command } from "#enums/command";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { isIgnorePP, isVirtual, MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { PokeballType } from "#enums/pokeball";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { getMoveTargets } from "#moves/move-utils";
import { CoopFinalizeTurnPhase } from "#phases/coop-replay-phases";
import {
  applyCoopEncounterAuthority,
  rebroadcastCoopWaveStartAuthorityAfterEntryEffects,
} from "#phases/encounter-phase";
import { FieldPhase } from "#phases/field-phase";
import type { MoveTargetSet } from "#types/move-target-set";
import type { TurnMove } from "#types/turn-move";
import { canTerastallize } from "#utils/pokemon-utils";
import i18next from "i18next";

// A healthy peer can spend more than four minutes in autonomous Commander presentation on a constrained
// browser runner before it is able to reach the same command point. Keep this command-only wait bounded,
// but beyond the measured seven-minute browser ceiling; shop/route waits retain the tighter default.
const COMMAND_RENDEZVOUS_RECOVERY_MAX_ATTEMPTS = 7;

export class CommandPhase extends FieldPhase {
  public readonly phaseName = "CommandPhase";
  protected fieldIndex: number;

  /**
   * Whether the command phase is handling a switch command
   */
  private isSwitch = false;

  /** Showdown versus-host 60s turn clock (timeout id); null when unarmed. */
  private showdownTurnClock: number | null = null;

  /**
   * Live {@linkcode CoopBattleStreamer.onCheckpointEnvelope} subscription installed while this authoritative
   * guest command is PARKED (deferred on its V2 command frontier). A retained REPLACEMENT checkpoint that
   * lands AFTER the park has no other consumer - this wakes the safe boundary so the parked command dissolves
   * into a {@linkcode CoopReplayTurnPhase} that applies + finalizes it. Null when not parked / not armed.
   */
  private parkedReplacementUnsub: (() => void) | null = null;

  constructor(fieldIndex: number) {
    super();

    this.fieldIndex = fieldIndex;
  }

  /**
   * Resets the cursor to the position of {@linkcode Command.FIGHT} if any of the following are true
   * - The setting to remember the last action is not enabled
   * - This is the first turn of a mystery encounter, trainer battle, or the END biome
   * - The cursor is currently on the POKEMON command
   */
  private resetCursorIfNeeded(): void {
    const commandUiHandler = globalScene.ui.handlers[UiMode.COMMAND];
    const { arena, commandCursorMemory, currentBattle } = globalScene;
    const { battleType, turn } = currentBattle;
    const { biomeId } = arena;

    // If one of these conditions is true, we always reset the cursor to Command.FIGHT
    const cursorResetEvent =
      battleType === BattleType.MYSTERY_ENCOUNTER || battleType === BattleType.TRAINER || biomeId === BiomeId.END;

    if (!commandUiHandler) {
      return;
    }
    if (
      (turn === 1 && (!commandCursorMemory || cursorResetEvent))
      || commandUiHandler.getCursor() === Command.POKEMON
    ) {
      commandUiHandler.setCursor(Command.FIGHT);
    }
  }

  /**
   * Submethod of {@linkcode start} that validates field index logic for nonzero field indices.
   * Must only be called if the field index is nonzero.
   */
  private handleFieldIndexLogic(): void {
    // If we somehow are attempting to check the right pokemon but there's only one pokemon out
    // Switch back to the center pokemon. This can happen rarely in double battles with mid turn switching
    // TODO: Prevent this from happening in the first place
    if (globalScene.getPlayerField().filter(p => p.isActive()).length === 1) {
      // Co-op (#783, the live faint deadlock): redirect to the SURVIVOR'S ACTUAL slot, never
      // blindly to CENTER. With one player mon fainted (not yet replaced - in co-op the
      // replacement rides the relayed switch / next checkpoint, so the fainted mon can still
      // occupy its slot), the legacy CENTER redirect could move this CommandPhase onto the
      // FAINTED, partner-owned slot; the ownership gate then skipped it silently - the guest
      // never prompted or broadcast its command, the host waited on the guest's move, and both
      // clients deadlocked ("partner moved forward and I was stuck"). Pointing at the survivor
      // keeps the downstream ownership gates correct on BOTH clients (own slot -> prompt,
      // partner slot -> request/await).
      if (getCoopController() != null) {
        const coopSurvivor = globalScene.getPlayerField().find(p => p.isActive());
        if (coopSurvivor) {
          this.fieldIndex = globalScene.getPlayerField().indexOf(coopSurvivor);
        }
        return;
      }
      // Triple: the lone survivor can sit at ANY slot (0/1/2), so command IT - a hardcoded slot 0
      // (CENTER) could point at a fainted mon (the doubles assumption that the survivor is always
      // slot 0). Binary keeps the exact legacy CENTER(=0) behavior.
      if (globalScene.currentBattle.getBattlerCount() >= 3) {
        const survivor = globalScene.getPlayerField().find(p => p.isActive());
        this.fieldIndex = survivor ? globalScene.getPlayerField().indexOf(survivor) : FieldPosition.CENTER;
      } else {
        this.fieldIndex = FieldPosition.CENTER;
      }
      return;
    }

    // Scan ALL earlier slots (not just fieldIndex-1): in a TRIPLE, a fainted/empty middle
    // slot has a null command, which broke the skip chain - slot 2 would still be prompted
    // after slot 0 threw a ball / fled. NB turnCommands is a KEYED OBJECT (Object.fromEntries
    // in battle.ts), not an array - index it, never .slice it (that threw in every double).
    let allyCommand: TurnCommand | null = null;
    for (let i = 0; i < this.fieldIndex; i++) {
      const c = globalScene.currentBattle.turnCommands[i];
      if (c?.command === Command.BALL || c?.command === Command.RUN) {
        allyCommand = c;
        break;
      }
    }
    if (allyCommand) {
      globalScene.currentBattle.turnCommands[this.fieldIndex] = {
        command: allyCommand.command,
        skip: true,
      };
    }
  }

  /**
   * Submethod of {@linkcode start} that sets the turn command to skip if this pokemon
   * is commanding its ally via {@linkcode AbilityId.COMMANDER}.
   */
  private checkCommander(): void {
    // If the Pokemon has applied Commander's effects to an ally, skip this command.
    // Any multi format + ANY ally (was `double` + first-ally-only, so a triple's
    // hidden Tatsugiri still got prompted for a command).
    // The tag's source id is the durable Commander relationship. An authoritative co-op
    // materialization can resolve that id to a different Pokemon object than this phase's
    // presentation instance, so reference equality would incorrectly expose command input.
    const pokemon = this.getPokemon();
    if (
      (globalScene.currentBattle?.getBattlerCount() ?? 0) > 1
      && pokemon.getAllies().some(ally => ally.getTag(BattlerTagType.COMMANDED)?.sourceId === pokemon.id)
    ) {
      globalScene.currentBattle.turnCommands[this.fieldIndex] = {
        command: Command.FIGHT,
        move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
        skip: true,
      };
    }
  }

  /**
   * Clear out all unusable moves in front of the currently acting pokemon's move queue.
   */
  // TODO: Refactor move queue handling to ensure that this method is not necessary.
  private clearUnusableMoves(): void {
    const playerPokemon = this.getPokemon();
    const moveQueue = playerPokemon.getMoveQueue();
    if (moveQueue.length === 0) {
      return;
    }

    let entriesToDelete = 0;
    const moveset = playerPokemon.getMoveset();
    for (const queuedMove of moveQueue) {
      const movesetQueuedMove = moveset.find(m => m.moveId === queuedMove.move);
      if (
        queuedMove.move !== MoveId.NONE
        && !isVirtual(queuedMove.useMode)
        && !(movesetQueuedMove?.isUsable(playerPokemon, isIgnorePP(queuedMove.useMode), true)?.[0] ?? false)
      ) {
        entriesToDelete++;
      } else {
        break;
      }
    }
    if (entriesToDelete) {
      moveQueue.splice(0, entriesToDelete);
    }
  }

  /**
   * Attempt to execute the first usable move in this Pokemon's move queue
   * @returns Whether a queued move was successfully set to be executed.
   */
  private tryExecuteQueuedMove(): boolean {
    this.clearUnusableMoves();
    const playerPokemon = globalScene.getPlayerField()[this.fieldIndex];
    const moveQueue = playerPokemon.getMoveQueue();

    if (moveQueue.length === 0) {
      return false;
    }

    // ER Discipline ("Can switch while rampaging"): a FRENZY-locked move (Thrash /
    // Outrage / Petal Dance) normally auto-repeats from the queue, so the command
    // menu never opens and the holder cannot switch. When the holder carries the
    // Discipline marker, do NOT auto-execute while the FRENZY tag is active — fall
    // through to open the menu so a voluntary switch (or another command) is
    // available. Gated on the FRENZY tag specifically so two-turn CHARGING moves
    // (Solar Beam / Dig / Fly) are unaffected.
    if (playerPokemon.getTag(BattlerTagType.FRENZY) && playerPokemon.hasAbilityWithAttr("SwitchWhileRampagingAbAttr")) {
      return false;
    }

    const queuedMove = moveQueue[0];
    if (queuedMove.move === MoveId.NONE) {
      this.handleCommand(Command.FIGHT, -1);
      return true;
    }
    const moveIndex = playerPokemon.getMoveset().findIndex(m => m.moveId === queuedMove.move);
    if (!isVirtual(queuedMove.useMode) && moveIndex === -1) {
      globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    } else {
      this.handleCommand(Command.FIGHT, moveIndex, queuedMove.useMode, queuedMove);
    }

    return true;
  }

  /**
   * Co-op battle control (#633, P2 + LIVE-C): in a co-op double the local human
   * only ever drives THEIR OWN field slot; the PARTNER's slot is resolved here and
   * the interactive menu is never opened for it. Returns `true` when this is the
   * partner slot (its command will be submitted, possibly asynchronously) so the
   * caller skips the menu.
   *
   * The partner's command comes from the partner OVER THE TRANSPORT (LIVE-C): the
   * host (authoritative) offers the legal move slots it computed and awaits the
   * peer's pick - a real guest live, or the {@linkcode SpoofGuest} over loopback in
   * dev/tests. If no relay is present or the peer does not answer within the
   * timeout, it falls back to the self-contained AI picker
   * ({@linkcode resolvePartnerCommand}) so the turn never hangs.
   */
  private canOfferPartnerRun(partner: PlayerPokemon): boolean {
    const { currentBattle, arena } = globalScene;
    return (
      arena.biomeId !== BiomeId.END
      && (currentBattle.mysteryEncounter?.fleeAllowed ?? true)
      && currentBattle.battleType !== BattleType.TRAINER
      && currentBattle.mysteryEncounter?.encounterMode !== MysteryEncounterMode.TRAINER_BATTLE
      && !partner.isTrapped([], true)
    );
  }

  /** Side-effect-free host legality check used only to construct the wire offer. */
  private canOfferPartnerBall(cursor: number): boolean {
    const { arena, currentBattle, gameData, gameMode, pokeballCounts } = globalScene;
    if (
      !Number.isSafeInteger(cursor)
      || cursor < 0
      || cursor > PokeballType.MASTER_BALL
      || !pokeballCounts[cursor as PokeballType]
    ) {
      return false;
    }
    if (globalScene.getEnemyField().filter(p => p.isActive(true)).length !== 1) {
      return false;
    }
    const { battleType } = currentBattle;
    const { isClassic, isEndless, isDaily } = gameMode;
    const isClassicFinalBoss = gameMode.isBattleClassicFinalBoss(currentBattle.waveIndex);
    const isEndlessMinorBoss = gameMode.isEndlessMinorBoss(currentBattle.waveIndex);
    const isFullFreshStart = gameMode.isFullFreshStartChallenge();
    const isCatchableDailyBoss = isDailyFinalBoss() && (getDailyEventSeedBoss()?.catchable ?? false);
    if (battleType === BattleType.TRAINER) {
      return false;
    }
    if (currentBattle.isBattleMysteryEncounter() && !currentBattle.mysteryEncounter?.catchAllowed) {
      return false;
    }
    if (arena.biomeId === BiomeId.END && battleType === BattleType.WILD) {
      const hasUncaughtFieldSpecies = globalScene
        .getEnemyField()
        .some(p => p.isActive() && !gameData.dexData[p.species.speciesId].caughtAttr);
      if (
        (isClassic && !isClassicFinalBoss && hasUncaughtFieldSpecies)
        || (isFullFreshStart && !isClassicFinalBoss)
        || (isEndless && !isEndlessMinorBoss)
        || (isClassic && isClassicFinalBoss)
        || (isFullFreshStart && isClassicFinalBoss)
        || (isEndless && isEndlessMinorBoss)
        || (isDaily && !isCatchableDailyBoss)
      ) {
        return false;
      }
    }
    const target = globalScene.getEnemyPokemon(false);
    if (target?.isBoss() && target.bossSegmentIndex >= 1 && !target.hasAbility(AbilityId.WONDER_GUARD, false, true)) {
      const challengedFinalBoss = isClassicFinalBoss && gameMode.hasAnyChallenges();
      if (
        (isClassicFinalBoss && (cursor < PokeballType.MASTER_BALL || challengedFinalBoss))
        || isCatchableDailyBoss
        || cursor < PokeballType.MASTER_BALL
      ) {
        return false;
      }
    }
    return true;
  }

  /** Build the complete action set from host state; no peer-derived legality enters this object. */
  private coopTargetRef(battlerIndex: number): CoopBattleTargetRef | null {
    const pokemon = [...globalScene.getPlayerField(), ...globalScene.getEnemyField()].find(
      candidate => candidate.getBattlerIndex() === battlerIndex,
    );
    return pokemon == null ? null : { side: pokemon.isPlayer() ? "player" : "enemy", pokemonId: pokemon.id };
  }

  private buildCoopPartnerCommandOffer(partner: PlayerPokemon, slotOwner: "host" | "guest"): CoopBattleCommandOffer {
    const moves = partner
      .getMoveset()
      .map((move, slot) => ({ move, slot }))
      .filter(({ move }) => move.isUsable(partner, false, true)[0])
      .map(({ move, slot }) => {
        const targetSet = getMoveTargets(partner, move.moveId);
        const targetSets = targetSet.multiple ? [targetSet.targets] : targetSet.targets.map(target => [target]);
        const currentTeras = globalScene.arena.playerTerasUsed;
        const plannedTera = +(
          globalScene.currentBattle.preTurnCommands[0]?.command === Command.TERA && this.fieldIndex > 0
        );
        return {
          slot,
          moveId: move.moveId,
          targetSets: targetSets.length > 0 ? targetSets : [[]],
          targetRefSets: (targetSets.length > 0 ? targetSets : [[]]).map(targets =>
            targets
              .map(target => this.coopTargetRef(target))
              .filter((target): target is CoopBattleTargetRef => target != null),
          ),
          canTera: canTerastallize(partner) && currentTeras + plannedTera < MAX_TERAS_PER_ARENA,
        };
      });
    if (moves.length === 0) {
      const struggleTargets = getMoveTargets(partner, MoveId.STRUGGLE);
      moves.push({
        slot: -1,
        moveId: MoveId.STRUGGLE,
        targetSets: struggleTargets.multiple
          ? [struggleTargets.targets]
          : struggleTargets.targets.map(target => [target]),
        targetRefSets: (struggleTargets.multiple
          ? [struggleTargets.targets]
          : struggleTargets.targets.map(target => [target])
        ).map(targets =>
          targets
            .map(target => this.coopTargetRef(target))
            .filter((target): target is CoopBattleTargetRef => target != null),
        ),
        canTera: false,
      });
    }
    const canBaton = !!globalScene.findModifier(
      modifier => modifier.is("SwitchEffectTransferModifier") && modifier.pokemonId === partner.id,
    );
    const canNormalSwitch = !partner.isTrapped([], true);
    const switches = globalScene
      .getPlayerParty()
      .map((pokemon, slot) => ({ pokemon, slot }))
      .filter(
        ({ pokemon }) =>
          pokemon.id !== partner.id
          && pokemon.coopOwner === slotOwner
          && pokemon.isAllowedInBattle()
          && !pokemon.isActive(true),
      )
      .map(({ slot }) => ({ slot, canNormal: canNormalSwitch, canBaton }));
    return {
      moves,
      switches,
      ballTypes: Object.keys(globalScene.pokeballCounts)
        .map(Number)
        .filter(ballType => this.canOfferPartnerBall(ballType)),
      ballTargets: globalScene
        .getEnemyField()
        .filter(pokemon => pokemon.isActive(true))
        .map(pokemon => pokemon.getBattlerIndex()),
      ballTargetRefs: globalScene
        .getEnemyField()
        .filter(pokemon => pokemon.isActive(true))
        .map(pokemon => ({ side: "enemy" as const, pokemonId: pokemon.id })),
      canRun: this.canOfferPartnerRun(partner),
    };
  }

  private tryCoopAutoResolve(): boolean {
    if (!globalScene.gameMode.isCoop) {
      return false;
    }
    const controller = getCoopController();
    // Fall back to normal (interactive) behavior if there is somehow no live
    // session - never lock the human out of their command.
    if (controller == null) {
      return false;
    }
    if (isCoopSharedTerminalFrozen()) {
      // Terminal preparation owns this phase now. Keep it parked until exactly-once finalization; do not
      // open local input, synthesize a command, or advance a queue already cleared by the runtime fence.
      return true;
    }
    // Only auto-resolve the PARTNER's slot; the local player commands their own.
    const slotOwner = coopOwnerOfPlayerFieldSlot(this.fieldIndex);
    // #819 diagnostics: ownership decides who prompts/relays this slot - a misresolve here IS
    // the spectator/deadlock class, so make the verdict visible in every capture.
    coopLog(
      "battle",
      `CommandPhase slot=${this.fieldIndex} turn=${globalScene.currentBattle.turn} owner=${slotOwner} role=${controller.role} -> ${slotOwner === controller.role ? "LOCAL UI" : "partner path"}`,
    );
    if (slotOwner === controller.role) {
      return false;
    }

    // Co-op AUTHORITATIVE netcode only (#633, TRACK-2 Phase B): on the GUEST, the partner
    // slot is the HOST's mon. The guest is a pure renderer - it must NOT await or AI-resolve
    // the host's slot (the host simulates the whole turn). Write an inert, skipped command so
    // the phase queue stays well-formed; TurnStartPhase then diverts the turn to
    // CoopReplayTurnPhase, which renders the host's authoritative outcome. (The HOST keeps
    // awaiting the guest's real command over the relay below, so it simulates with the
    // guest's actual pick.) In LOCKSTEP the guest FALLS THROUGH to the SAME request+apply
    // path the host uses below (requestPartnerCommand -> applyWiredPartnerCommand /
    // applyRelayedActionCommand + AI fallback), so the partner's move is relayed + applied
    // on both clients and the visible move stays synced (the move-sync fix).
    if (controller.role === "guest" && getCoopNetcodeMode() === "authoritative") {
      globalScene.currentBattle.turnCommands[this.fieldIndex] = {
        command: Command.FIGHT,
        move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
        skip: true,
      };
      this.end();
      return true;
    }

    const partner = this.getPokemon();
    // Passing the full `move` arg makes handleFightCommand reuse the resolved
    // targets and SKIP the interactive SelectTargetPhase.
    const apply = (resolved: ResolvedPartnerCommand) =>
      this.handleCommand(resolved.command, resolved.moveIndex, resolved.turnMove.useMode, resolved.turnMove);
    // The local AI command: both the no-relay path and the timeout/illegal fallback.
    const fallback = () => resolvePartnerCommand(partner);

    const sync = getCoopBattleSync();
    if (sync == null) {
      apply(fallback());
      return true;
    }
    const runtimeAtRequest = getCoopRuntime();
    // Offer the legal move slots WE computed and await the partner's pick. The
    // partner's command is applied EXACTLY ({@linkcode applyWiredPartnerCommand}:
    // matched by move ID + verbatim targets, no RNG re-roll) so both engines stay
    // in lockstep; a missing / slow reply (or an unfindable move) -> AI fallback.
    // Co-op (#633): the local human has nothing to do for the PARTNER's slot, so show a
    // clear "your partner is choosing" notice while we await their pick (instead of a
    // stale command menu / blank screen). The relayed command then transitions the turn.
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.showText(
      i18next.t("battle:coopPartnerChoosingMoveBattle", {
        defaultValue: "Your partner is choosing a move...",
      }),
      null,
      () => {},
      null,
      true,
    );
    const moveset = partner.getMoveset();
    const moveSlots = moveset.map((m, i) => (m.isUsable(partner, false, true)[0] ? i : -1)).filter(i => i >= 0);
    const offer = this.buildCoopPartnerCommandOffer(partner, slotOwner);
    // #851: key the request by the awaited slot's RESOLVED owner (computed above as `slotOwner`),
    // so the guest's independent broadcast matches even after a host-half-wipe recenter reseats the
    // survivor at a different field index than the guest has reconciled to (the 20-min-stall class).
    void sync
      .requestPartnerCommand(this.fieldIndex, globalScene.currentBattle.turn, moveSlots, slotOwner, offer, {
        epoch: controller.sessionEpoch,
        wave: globalScene.currentBattle.waveIndex,
        pokemonId: partner.id,
      })
      .then(cmd => {
        if (
          sync.isTerminalFrozen()
          || runtimeAtRequest == null
          || getCoopRuntime() !== runtimeAtRequest
          || isCoopSharedTerminalFrozen(runtimeAtRequest)
        ) {
          // A shared terminal releases retained command promises with null only to drain the old control
          // surface. It is never authority to invent a local AI command or end this phase independently.
          coopWarn(
            "battle",
            `CommandPhase terminal fence held owner=${slotOwner} field=${this.fieldIndex} `
              + `turn=${globalScene.currentBattle?.turn ?? -1}`,
          );
          return;
        }
        // A relayed BALL / RUN (the partner threw a Poke Ball or fled) is applied
        // verbatim, NOT routed through the move path: its `cursor` is a ball type,
        // not a move slot, so applyWiredPartnerCommand would mis-read it as a move.
        if (
          cmd != null
          && (cmd.command === Command.BALL || cmd.command === Command.RUN || cmd.command === Command.POKEMON)
        ) {
          this.applyRelayedActionCommand(cmd);
          // #record-replay: capture the partner slot's relayed action command (no-op unless recording).
          recordCoopPartnerSlotCommand(this.fieldIndex, cmd);
          return;
        }
        // FIGHT: the RELAYED partner command, else the AI fallback (a null guest reply still produces a
        // real RNG-derived command that is part of the authoritative run - capture what was COMMITTED).
        const resolved = (cmd && applyWiredPartnerCommand(partner, cmd)) || fallback();
        apply(resolved);
        // #record-replay: capture the partner slot's resolved FIGHT command (no-op unless recording).
        recordCoopPartnerSlotCommand(this.fieldIndex, {
          command: resolved.command,
          cursor: resolved.moveIndex,
          targets: resolved.turnMove.targets,
        });
      });
    return true;
  }

  /**
   * Co-op host-authoritative sync (#633, LIVE-D), run at each turn boundary (the
   * field is stable here - no resolution in flight). The HOST broadcasts the
   * authoritative post-previous-turn state once per turn (at field slot 0, turn 2+);
   * the GUEST snaps to the latest such checkpoint, so both screens converge on the
   * same hp / status / stages / weather every turn instead of drifting apart. Fully
   * guarded: no-op outside a live co-op session, and the apply/capture are themselves
   * wrapped so a sync hiccup can never break the turn.
   */
  private tryCoopCheckpointSync(): boolean {
    // Read the scene mode directly: isVersusSession() is runtime-backed and therefore becomes false
    // in the exact orphaned-runtime condition this boundary must catch.
    if (!globalScene.gameMode.isCoop && !globalScene.gameMode.isShowdown) {
      return true;
    }
    const controller = getCoopController();
    const streamer = getCoopBattleStreamer();
    if (controller == null || streamer == null) {
      failCoopSharedSession("A shared battle reached command input without its authoritative runtime.", {
        boundary: "recovery",
        reasonCode: "recovery-exhausted",
        wave: globalScene.currentBattle?.waveIndex,
        turn: globalScene.currentBattle?.turn,
      });
      return false;
    }
    const { turn, waveIndex } = globalScene.currentBattle;
    // M6c (#633): the LOCKSTEP per-turn checkpoint broadcast/adopt that used to live here was
    // dead (a live co-op session is ALWAYS authoritative since M3) and is deleted. The per-turn
    // authoritative state (checkpoint + checksum) streams via emitTurn at TurnEnd (TRACK-2
    // Phase B) / CoopReplayTurnPhase; only the wave-start enemy-party belt-and-suspenders stays.
    if (controller.role !== "host" && turn === 1) {
      const carrier = streamer.consumeEnemyPartyAuthority(waveIndex);
      if (carrier.state !== undefined && carrier.state.tick < coopAppliedStateTick()) {
        // Selector MEs and their spawned battle share a wave. A replayed pre-terminal selector carrier is
        // obsolete as one atomic unit: never clear the live enemies/descriptor and only then discover its
        // state twin is stale.
        coopLog(
          "stream",
          `guest discarded stale enemyParty carrier before command wave=${waveIndex} `
            + `tick=${carrier.state.tick} applied=${coopAppliedStateTick()}`,
        );
        ensureCoopAuthoritativeCommandPresentation();
        return true;
      }
      // Guest: at the wave's first turn, adopt the host's exact enemy party (a belt-and-
      // suspenders for the encounter-phase adopt; one-shot). The per-turn checkpoint +
      // checksum verification is owned by CoopReplayTurnPhase now (Phase B), not here.
      const { enemies } = carrier;
      if (enemies != null) {
        // enemyPartySync is one authoritative carrier split across party, encounter identity, and state
        // inboxes. A blocked NextEncounterPhase can leave all three for this final pre-input fallback.
        // Never adopt only the party: trainer victory/reward routing depends on the exact descriptor.
        const { encounter } = carrier;
        if (encounter == null) {
          failCoopSharedSession(
            `Wave ${waveIndex} authoritative encounter descriptor was unavailable at command input`,
          );
          return false;
        }
        applyCoopEncounterAuthority(globalScene.currentBattle, encounter);
        // #818: STRUCTURAL adopt - an ME-spawned battle's party exists only on the host,
        // so the guest must be able to BUILD it (species/count/shape), not just correct it.
        adoptCoopEnemiesStructural(enemies);
      }
      // The party image and its complete state are intentionally separate one-shot buffers. EncounterPhase
      // can consume the repeated party first while a newer post-PostSummon carrier is delivered afterward;
      // gating the state read on `enemies != null` then strands that newer state until checksum repair. Always
      // consume/apply the latest state at this final pre-input funnel. `undefined` remains a guarded no-op.
      const waveStartState = carrier.state;
      if (
        waveStartState !== undefined
        && !applyCoopAuthoritativeBattleState(waveStartState, true)
        && !reapplyAcceptedCoopAuthoritativeBattleState(waveStartState, true)
      ) {
        // EncounterPhase may already have accepted this exact tick for coherent intro rendering. Reassert
        // only that same accepted image at the final public-input seal; a stale/different payload remains
        // rejected, while a newer post-summon carrier is admitted normally above.
        failCoopSharedSession(`Wave ${waveIndex} authoritative entry state could not seal before command input`);
        return false;
      }
      // Applying an encounter descriptor may reconstruct local trainer presentation. Reassert the pure
      // renderer contract after the complete carrier has landed and before any public command input opens.
      ensureCoopAuthoritativeCommandPresentation();
    } else if (controller.role === "host" && turn === 1 && this.fieldIndex === 0) {
      // Co-op HOST (#920): the entry-ability chain (PostSummonPhase) has now settled - terrain, weather,
      // entry-hazard arena tags and entry form changes are on the arena/field, but the wave-start
      // enemyPartySync captured its authoritative state BEFORE PostSummon (pre-summon boundary). Re-broadcast
      // the post-summon re-capture so the guest adopts those on-entry effects at its OWN turn-1 belt-and-
      // suspenders above, BEFORE it commands, instead of at the turn-1 END checkpoint. Gated to field slot 0
      // so it evaluates once per wave; a hard no-op unless an entry effect actually changed state (self-latching).
      rebroadcastCoopWaveStartAuthorityAfterEntryEffects();
    }
    return true;
  }

  /**
   * While this authoritative-guest command is PARKED on its V2 command frontier, watch for the retained
   * REPLACEMENT carrier that must be consumed before the ordered command-open can ever admit. The bug this
   * closes (Frontier 4): the guest's own faint pick raced its local engine into TurnInit -> CommandPhase
   * BEFORE the host's `REPLACEMENT_COMMIT` checkpoint arrived, so TurnInit's pre-command replacement probe
   * saw nothing and the command parked. The checkpoint then lands ~18s later with NO consumer (no replay
   * pump, no envelope subscriber), so it stays materialDeferred forever and the command-open ordered AFTER
   * it can never admit -> hard hang at the turn-2 rendezvous. Arming this envelope subscription supplies the
   * missing consumer: on the checkpoint's arrival the parked command dissolves into the SAME
   * `CoopReplayTurnPhase` route TurnInit would have taken, which applies + checksum-verifies + finalizes the
   * replacement (unblocking the deferred authority revision) and then opens the real command.
   */
  private armReplacementReplayDissolveWhileParked(pokemonId: number): void {
    if (!isCoopAuthoritativeGuestGated() || !isCoopV2ReplacementCutoverActive()) {
      return;
    }
    // The checkpoint may already be buffered at park time (the non-racy window) - route immediately.
    if (this.dissolveIntoReplacementReplayIfPending(pokemonId)) {
      return;
    }
    if (this.parkedReplacementUnsub != null) {
      return; // already armed for this park (start() re-runs on every resume attempt)
    }
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      return;
    }
    this.parkedReplacementUnsub = streamer.onCheckpointEnvelope(() => {
      // One-shot + wrong-ambient safety: only act while THIS parked phase is still the current phase. In the
      // two-engine harness a checkpoint can be delivered while another client's scene is installed; the
      // current-phase identity check makes that delivery a no-op instead of dissolving the wrong client.
      if (globalScene.phaseManager.getCurrentPhase() !== this) {
        return;
      }
      this.dissolveIntoReplacementReplayIfPending(pokemonId);
    });
  }

  /**
   * If a retained authoritative REPLACEMENT carrier for this turn is buffered, dissolve this parked command
   * into the {@linkcode CoopReplayTurnPhase} that consumes it (identical route + args to TurnInit's
   * pre-command deferral). Returns true when it dissolved. The parked deferred-command entry is retracted
   * first: its `resume` points at the phase being ended, so leaving it would let a later same-address
   * command-open re-enter a dead phase and open a phantom second command surface.
   */
  private dissolveIntoReplacementReplayIfPending(pokemonId: number): boolean {
    const replacementReplayTurn = pendingCoopAuthoritativeReplacementReplayTurn();
    if (replacementReplayTurn == null) {
      return false;
    }
    this.clearParkedReplacementWake();
    cancelCoopV2DeferredCommandStart(this.fieldIndex, pokemonId);
    coopLog(
      "v2-replacement",
      "guest parked command dissolves into retained replacement replay at "
        + `wave=${globalScene.currentBattle.waveIndex} turn=${replacementReplayTurn}`,
    );
    globalScene.phaseManager.unshiftNew(
      "CoopReplayTurnPhase",
      replacementReplayTurn,
      0,
      undefined,
      globalScene.currentBattle.waveIndex,
    );
    this.end();
    return true;
  }

  private clearParkedReplacementWake(): void {
    this.parkedReplacementUnsub?.();
    this.parkedReplacementUnsub = null;
  }

  public override start(): void {
    const boundaryPokemon = globalScene.getPlayerField()[this.fieldIndex];
    if (boundaryPokemon != null) {
      const boundary = enterCoopV2CommandControlBoundary(this.fieldIndex, boundaryPokemon.id, () => this.start());
      if (boundary === "deferred") {
        this.armReplacementReplayDissolveWhileParked(boundaryPokemon.id);
        return;
      }
      // Un-parked normally (command frontier admitted): drop any parked-replacement wake armed above.
      this.clearParkedReplacementWake();
      if (boundary === "dissolved") {
        // Stale command for an already-advance-signaled wave (a queue-empty TurnInit->Command
        // manufacture for the OLD wave before the local battle re-based). Parking it would deadlock
        // the next-wave control that never addresses it; end cleanly (no super.start, no command
        // proof) exactly like the generated-skip path below, letting the already-queued next-wave
        // boundary proceed.
        this.end();
        return;
      }
      if (boundary === "failed") {
        failCoopSharedSession(
          `Authority V2 could not install command control for field ${this.fieldIndex} `
            + `at wave ${globalScene.currentBattle?.waveIndex ?? 0} turn ${globalScene.currentBattle?.turn ?? 0}`,
        );
        return;
      }
    }
    super.start();

    if (isCoopV2ControlSurfaceStartFrozen()) {
      coopWarn("v2-recovery", `CommandPhase start held field=${this.fieldIndex}: recovery owns the frontier`);
      return;
    }

    // CommandPhase is the first stable boundary after the authoritative renderer gate may have
    // neutralized structural SummonPhase. Restore trainer chrome only; Pokémon visibility and field
    // membership must come from an authoritative seat manifest, never a local presentation guess.
    ensureCoopAuthoritativeCommandPresentation();

    if (!this.tryCoopCheckpointSync()) {
      return;
    }

    globalScene.updateGameInfo();
    this.resetCursorIfNeeded();

    if (this.fieldIndex) {
      this.handleFieldIndexLogic();
    }

    const coopController = globalScene.gameMode.isCoop ? getCoopController() : null;
    const v2Controller = globalScene.gameMode.isCoop || globalScene.gameMode.isShowdown ? getCoopController() : null;

    this.checkCommander();

    // Authority V2: prove the exact stated successor only from the REAL CommandPhase chokepoint, after
    // checkpoint adoption + field-index repair. This covers both an owner's interactive menu and the
    // non-owner's mechanical await/auto-resolve phase; merely requesting a projection never signs it.
    if (v2Controller != null) {
      const commandPokemon = this.getPokemon();
      recordCoopV2CommandControlStarted(this.fieldIndex, commandPokemon.id, "player");
    }

    const hasGeneratedSkip = globalScene.currentBattle.turnCommands[this.fieldIndex]?.skip === true;

    const coopSlotOwner = coopController == null ? null : coopOwnerOfPlayerFieldSlot(this.fieldIndex);
    const isLocalCoopSlot = coopController != null && coopSlotOwner === coopController.role;
    const isAuthoritativeGuestPartnerSlot =
      coopController?.role === "guest"
      && getCoopNetcodeMode() === "authoritative"
      && coopSlotOwner !== coopController.role;

    // Generated skips are commands too. Commander, and the trailing slots after BALL/RUN, do not open
    // input, but an OWNED skipped slot must still announce the reciprocal command boundary. Ending it
    // here used to strand the peer at cmd:<wave>:<turn> exactly like a queued recharge did. Non-owned
    // renderer/engine slots keep the immediate skip: their owning peer is responsible for the arrival.
    if (hasGeneratedSkip && !isLocalCoopSlot) {
      this.end();
      return;
    }

    // An authoritative guest must classify the host-owned slot as renderer-only BEFORE consulting the
    // checkpoint-carried move queue. Otherwise a host recharge sentinel can execute on the guest engine.
    if (isAuthoritativeGuestPartnerSlot && this.tryCoopAutoResolve()) {
      return;
    }

    // Forced/queued commands on THIS client's owned slot still represent arrival at the reciprocal command
    // boundary. Do not execute them before the barrier: Meteor Assault/Hyper Beam leaves MoveId.NONE queued,
    // and the old ordering skipped the guest's arrival while the host remained sealed at cmd:<wave>:<turn>.
    // Partner slots retain the legacy authoritative ordering so the host can execute a forced partner action
    // directly instead of asking the peer to choose an action that is not actually selectable.
    if (!isLocalCoopSlot && this.tryExecuteQueuedMove()) {
      return;
    }

    if (!isLocalCoopSlot && this.tryCoopAutoResolve()) {
      return;
    }

    // Co-op (#839, next-command-open reciprocal barrier): we reached OUR OWN slot's command point with
    // our mon materialized on the field. Do NOT open the command UI until the PARTNER has ALSO reached
    // the same command point (both at command, both mons on field) - the missing reciprocal guard for
    // the faint-replacement lock (the wave-12 "sync issue": one player reaches its next move-choice
    // while the partner's replacement is not yet out / it already started a move, permanently locking
    // the other). A lost arrival is retransmitted after the recovery interval; timeout never authorizes
    // this client to open the command UI independently.
    const pendingBarrier = this.coopNextCommandBarrier();
    if (pendingBarrier == null) {
      // SYNC fast-path: solo / spoof / no rendezvous / partner-half-exhausted / partner ALREADY at this
      // command point. Open immediately - deferring behind a `.then` when there is nothing to wait for
      // reorders the UI open by a microtask for no reason (solo must stay byte-identical).
      this.enterOwnCommandBoundary();
      return;
    }
    void pendingBarrier.then(crossed => {
      if (crossed) {
        // The single continuation funnel re-consumes the latest wave-start authority immediately before
        // public input opens, including after a retained phase-route displacement.
        this.enterOwnCommandBoundary();
      }
    });
  }

  /** Execute a forced owned-slot action only after the reciprocal command boundary, else open its UI. */
  private enterOwnCommandBoundary(): void {
    // This is the single continuation funnel for every reciprocal-command path: synchronous arrival,
    // delayed arrival, and a command point temporarily displaced by a retained Crossroads/biome route.
    // Re-consume the latest wave-start authority here, immediately before public input can open. A renderer
    // may have consumed the pre-summon carrier when it first reached CommandPhase, then received the host's
    // post-PostSummon/biome-preparation refresh while that command point was rerouted. Applying only in the
    // ordinary rendezvous callback left that newer carrier buffered and opened input with stale map/biome
    // state. The consume is one-shot and host-safe, so making the funnel own it covers every route without
    // deriving or mutating guest mechanics.
    if (!this.tryCoopCheckpointSync()) {
      return;
    }
    // The authoritative guest can reach its owned slot before the host has completed PostSummon. In that
    // race, the first checkCommander() above legitimately sees no CommandedTag, then the post-summon
    // checkpoint consumed at the reciprocal barrier materializes the tag. Re-evaluate at the actual
    // continuation boundary so a late authoritative Commander relationship cannot expose one frame of
    // selectable input. The operation is idempotent: it only reasserts the same inert skipped command.
    this.checkCommander();
    const hasGeneratedSkip = globalScene.currentBattle.turnCommands[this.fieldIndex]?.skip === true;
    if (hasGeneratedSkip) {
      this.end();
      return;
    }
    if (!this.tryExecuteQueuedMove()) {
      this.openOwnCommandUi();
    }
  }

  /**
   * Showdown 1v1 (Task F1): on the versus GUEST, its OWN team is now its LOCAL PLAYER party (the
   * data-level side swap), so the NORMAL player-side command UI runs against real data. The guest
   * must not RESOLVE the turn (the host is the sole engine); it SHIPS the resolved command via the
   * relay ({@linkcode ShowdownCommandRelay.sendCommand}) and writes an inert skip so the phase queue
   * stays well-formed (TurnStartPhase then diverts the turn to CoopReplayTurnPhase and the guest
   * renders the host's authoritative outcome). Intercepted at the commit point in
   * {@linkcode handleCommand}, mirroring the co-op own-slot broadcast shape. Gated on the live versus
   * GUEST, so solo / co-op / host are byte-for-byte unchanged.
   *
   * `cursor` is the move slot (FIGHT/TERA) or the party slot (POKEMON) - the same raw index the host
   * validates against ITS enemy party, aligned 1:1 because the side-swap preserves party ORDER.
   * Targets are a presentation default (the host re-derives them). Returns true when it shipped.
   */
  private tryShipShowdownGuestCommand(command: Command, cursor: number, useMode: boolean | MoveUseMode): boolean {
    if (!isVersusSession() || getCoopController()?.role !== "guest") {
      return false;
    }
    let serialized: SerializedCommand;
    if (command === Command.FIGHT || command === Command.TERA) {
      const moveId = this.getPokemon().getMoveset()[cursor]?.moveId;
      if (moveId == null) {
        return false;
      }
      serialized = buildShowdownFightCommand(cursor, moveId);
      if (typeof useMode !== "boolean") {
        serialized.useMode = useMode;
      }
      if (command === Command.TERA) {
        serialized.tera = true;
      }
    } else if (command === Command.POKEMON) {
      serialized = buildShowdownSwitchCommand(cursor);
      serialized.baton = typeof useMode === "boolean" ? useMode : false;
    } else {
      // BALL / RUN / SHIFT have no meaning in a versus trainer 1v1; let them fall through (they are
      // not selectable in this mode, so this branch is unreachable in practice).
      return false;
    }
    getShowdownRelay()?.sendCommand(globalScene.currentBattle.turn, serialized);
    globalScene.currentBattle.turnCommands[this.fieldIndex] = {
      command: Command.FIGHT,
      move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
      skip: true,
    };
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.showText(
      i18next.t("battle:showdownOpponentChoosing", { defaultValue: "Move locked in! Opponent is choosing..." }),
      null,
      () => {},
      null,
      true,
    );
    this.end();
    return true;
  }

  /** Open THIS client's own-slot command UI (FIGHT for a skip-to-fight ME, else the COMMAND menu). */
  private openOwnCommandUi(): void {
    if (
      globalScene.currentBattle.isBattleMysteryEncounter()
      && globalScene.currentBattle.mysteryEncounter?.skipToFightInput
    ) {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.FIGHT, this.fieldIndex);
    } else {
      globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    }
    this.startShowdownTurnClock();
  }

  /**
   * Showdown 1v1: BOTH clients get a 60s turn clock (Task F1 folds the guest's onto the same code as
   * the host's). Without it a client could deliberate forever while its opponent - whose pick is
   * already committed/buffered - stared at "waiting" with no recourse (a live 3.5-minute stall was
   * log-confirmed for the host). On expiry: auto-pick the lead's first usable move and drive it
   * through {@linkcode handleCommand} - which EXECUTES it on the host and SHIPS it on the guest (the
   * versus-guest interception). Versus-only; cleared on phase end.
   */
  private startShowdownTurnClock(): void {
    if (!isVersusSession()) {
      return;
    }
    this.clearShowdownTurnClock();
    this.showdownTurnClock = window.setTimeout(() => {
      this.showdownTurnClock = null;
      try {
        const lead = globalScene.getPlayerField()[this.fieldIndex];
        const idx = lead?.getMoveset().findIndex(m => m != null && !m.isOutOfPp());
        if (idx != null && idx >= 0) {
          globalScene.ui.setMode(UiMode.MESSAGE);
          this.handleCommand(Command.FIGHT, idx);
        }
      } catch {
        /* the clock must never crash the command phase; a failed auto-pick leaves the menu open */
      }
    }, SHOWDOWN_TURN_TIMER_MS);
  }

  /** Clear the versus turn clock (no-op when none armed). */
  private clearShowdownTurnClock(): void {
    if (this.showdownTurnClock != null) {
      window.clearTimeout(this.showdownTurnClock);
      this.showdownTurnClock = null;
    }
  }

  /**
   * Co-op (#839): the RECIPROCAL next-command rendezvous. Resolves once BOTH clients have reached this
   * wave+turn's command point (each arrives when it opens its OWN materialized slot's command). A no-op
   * (resolves immediately) outside a live co-op run, in the hotseat/spoof path (no real partner), or
   * when there is no rendezvous - so solo / lockstep / dev is byte-identical. Never throws: a barrier
   * failure resolves so the command UI still opens.
   */
  /**
   * Returns `null` when NO waiting is needed (the caller opens the command UI synchronously - solo /
   * spoof / no rendezvous / partner half exhausted / partner already arrived at this command point),
   * else a promise that resolves true once the partner arrives/cross-point catch-up is classified,
   * or false only if the waiter is explicitly aborted.
   */
  private coopNextCommandBarrier(): Promise<boolean> | null {
    try {
      if (!globalScene.gameMode.isCoop || getCoopRuntime()?.spoof != null) {
        return null;
      }
      // authority-v2 turn CUTOVER note: the successor COMMAND ADDRESS is STATED by the host and PROJECTED
      // (frozen decision 4 - the guest never DERIVES its next command from this barrier). The reciprocal
      // next-command rendezvous below is pure PACING, NOT authority: it only ARRIVEs + AWAITs the partner at
      // the shared cmd:<wave>:<turn> point and never chooses a command or an address. An earlier cutover pass
      // short-circuited it entirely, which dropped the reciprocal faint-replacement/command lock (#839) - the
      // faster seat then raced ahead of a partner mid-replay (the observed missing-arrival class). So it MUST
      // keep running under cutover; it stays a no-op / byte-identical outside a live co-op run (the guards
      // below) and re-introduces no second authority for the command content.
      const rendezvous = getCoopRendezvous();
      if (rendezvous == null) {
        return null;
      }
      const point = `cmd:${globalScene.currentBattle.waveIndex}:${globalScene.currentBattle.turn}`;
      // Classic's final boss deliberately starts as a single battle and promotes to double only
      // when phase two materializes. The guest owns no field slot during stage one, so no guest
      // CommandPhase can ever announce this point even when guest-owned bench mons are healthy.
      // Treat only this exact product geometry as a one-owner boundary; a generic capacity-one
      // exemption would incorrectly bypass real faint-replacement waits in ordinary co-op battles.
      const singleOwnerFinalBossStage =
        globalScene.currentBattle.isClassicFinalBoss
        && globalScene.currentBattle.arrangement.playerCapacity === 1
        && globalScene.currentBattle.arrangement.enemyCapacity === 1;
      if (singleOwnerFinalBossStage) {
        coopLog("rendezvous", `next-command barrier ${point} ARRIVE-ONLY (final-boss stage-one spectator)`);
        rendezvous.arrive(point);
        return null;
      }
      // Asymmetric-field guard (#828 class): a partner whose HALF IS WIPED never reaches an own-slot
      // command point, so awaiting them would eat the full timeout EVERY TURN for the rest of the run.
      // If the partner owns no battle-legal mon, arrive (so any pending partner-side wait resolves) but
      // do NOT await - the survivor plays on unthrottled.
      const controller = getCoopController();
      const partnerRole = controller?.role === "host" ? "guest" : "host";
      const partnerHasCommandable = globalScene
        .getPlayerParty()
        .some(p => p != null && p.coopOwner === partnerRole && !p.isFainted() && p.isAllowedInBattle());
      if (!partnerHasCommandable) {
        coopLog("rendezvous", `next-command barrier ${point} ARRIVE-ONLY (partner half exhausted, no await)`);
        rendezvous.arrive(point);
        return null;
      }
      if (rendezvous.hasPartnerArrived(point)) {
        // Partner is already here - arrive (idempotent) and proceed synchronously.
        rendezvous.arrive(point);
        coopLog("rendezvous", `next-command barrier ${point} SYNC pass (partner already arrived)`);
        return null;
      }
      coopLog("rendezvous", `next-command barrier ARRIVE+AWAIT ${point} slot=${this.fieldIndex}`);
      // Co-op replacement-retention release (Track R deadlock): the authoritative guest has now
      // reached its OWN next command point - the auto-summon that filled this slot is already
      // materialApplied + presentationReady - and is about to PACING-wait on the partner. That park IS
      // this replacement continuation's real public surface. Emit it here as a "rendererWait"
      // continuation (mirrors CoopReplayTurnPhase's parked-renderer emit) so the retained replacement
      // checkpoint releases at continuationReady the instant the guest is command-ready, instead of
      // being gated behind the post-barrier setMode(UiMode.COMMAND) - which never fires while the host
      // is still choosing its OWN-slot replacement, leaving the host to RE-SEND the unacked replacement
      // checkpoint forever. notifyContinuationSurface only releases a continuation whose address matches
      // the current authority address, so this is a safe no-op when none is pending. Guest-only: the
      // host reports its command surface through ui.setMode's post-commit chokepoint and has no pending
      // guest-side continuation here.
      if (isCoopAuthoritativeGuest()) {
        getCoopBattleStreamer()?.notifyContinuationSurface("rendererWait");
      }
      return rendezvous
        .rendezvous(point, getCoopRendezvousWaitMs(), COMMAND_RENDEZVOUS_RECOVERY_MAX_ATTEMPTS)
        .then(result => {
          if (result.timedOut) {
            coopWarn(
              "rendezvous",
              `next-command barrier ${point} ABORTED during teardown/recovery - command UI remains closed`,
            );
            return false;
          }
          if (result.authoritativePoint !== undefined && result.authoritativePoint !== point) {
            coopWarn(
              "rendezvous",
              `next-command barrier ${point} ROUTED AWAY to host-authoritative ${result.authoritativePoint}; closing phantom command phase`,
            );
            // The live ME softlock can race waveResolved in AFTER finalize already queued a phantom turn.
            // A host route to the reward shop sanctions discarding that locally-derived turn queue and
            // materializing the same one-shot host WAVE_ADVANCE tail normal finalization would have queued.
            if (result.authoritativePoint.startsWith("shop:") && coopHasPendingWaveAdvance()) {
              globalScene.phaseManager.clearPhaseQueue();
              CoopFinalizeTurnPhase.runPendingWaveAdvanceTail();
            }
            this.end();
            return false;
          }
          if (result.crossPoint !== undefined) {
            // #847 CROSS-POINT: the partner is already at another sync point (e.g. the reward shop) and
            // will never reach this command point. Open the UI immediately - the downstream catch-up
            // machinery reconciles. INFO, not the anti-hang WARN (no dead partner, no 60s wait).
            coopLog(
              "rendezvous",
              `next-command barrier ${point} host-authoritative route ACKED (partner had ${result.crossPoint}); opening UI`,
            );
          }
          return true;
        })
        .catch((e: unknown) => {
          coopWarn("rendezvous", "next-command barrier threw - FAIL CLOSED; command UI remains closed", e);
          return false;
        });
    } catch (e) {
      coopWarn("rendezvous", "next-command barrier threw - FAIL CLOSED; command UI remains closed", e);
      return Promise.resolve(false);
    }
  }

  /**
   * Submethod of {@linkcode handleFightCommand} responsible for queuing the provided error message when the move cannot be used
   * @param msg - The reason why the move cannot be used
   */
  private queueFightErrorMessage(msg: string): void {
    const ui = globalScene.ui;
    ui.setMode(UiMode.MESSAGE);
    ui.showText(
      msg,
      null,
      () => {
        ui.clearText();
        ui.setMode(UiMode.FIGHT, this.fieldIndex);
      },
      null,
      true,
    );
  }

  /**
   * Helper method for {@linkcode handleFightCommand} that returns the moveID for the phase
   * based on the move passed in or the cursor.
   *
   * Does not check if the move is usable or not, that should be handled by the caller.
   */
  private computeMoveId(playerPokemon: PlayerPokemon, cursor: number, move: TurnMove | undefined): MoveId {
    return move?.move ?? (cursor > -1 ? playerPokemon.getMoveset()[cursor]?.moveId : MoveId.NONE);
  }

  /**
   * Process the logic for executing a fight-related command
   *
   * @remarks
   * - Validates whether the move can be used, using struggle if not
   * - Constructs the turn command and inserts it into the battle's turn commands
   *
   * @param command - The command to handle (FIGHT or TERA)
   * @param cursor - The index that the cursor is placed on, or -1 if no move can be selected.
   * @param ignorePP - Whether to ignore PP when checking if the move can be used.
   * @param move - The move to force the command to use, if any.
   */
  private handleFightCommand(
    command: Command.FIGHT | Command.TERA,
    cursor: number,
    useMode: MoveUseMode = MoveUseMode.NORMAL,
    move?: TurnMove,
  ): boolean {
    const playerPokemon = this.getPokemon();
    const ignorePP = isIgnorePP(useMode);
    const [canUse, reason] = cursor === -1 ? [true, ""] : playerPokemon.trySelectMove(cursor, ignorePP);

    // Ternary here ensures we don't compute struggle conditions unless necessary
    const useStruggle = canUse
      ? false
      : cursor > -1 && !playerPokemon.getMoveset().some(m => m.isUsable(playerPokemon, ignorePP, true)[0]);

    if (!canUse && !useStruggle) {
      this.queueFightErrorMessage(reason);
      return false;
    }

    const moveId = useStruggle ? MoveId.STRUGGLE : this.computeMoveId(playerPokemon, cursor, move);

    const turnCommand: TurnCommand = {
      command: Command.FIGHT,
      cursor,
      move: { move: moveId, targets: [], useMode },
      args: [useMode, move],
    };
    const preTurnCommand: TurnCommand = {
      command,
      targets: [this.fieldIndex],
      skip: command === Command.FIGHT,
    };

    const moveTargets: MoveTargetSet =
      move === undefined
        ? getMoveTargets(playerPokemon, moveId)
        : {
            targets: move.targets,
            // Co-op (#633): a relayed PARTNER move must take its spread/`multiple`
            // flag from the MOVE DEFINITION (deterministic + identical on both
            // clients, same source the local-human path above uses) - NOT from the
            // wired target-array length. The length proxy diverged across clients
            // (one treated Sappy Seed as spread, the other single-target), flipping
            // the spread-damage modifier and desyncing the whole battle. Same seed
            // already gives both clients identical enemies + RNG, so matching this
            // one flag is all that's needed. Solo / queued moves keep the proxy.
            multiple: globalScene.gameMode.isCoop
              ? getMoveTargets(playerPokemon, moveId).multiple
              : move.targets.length > 1,
          };

    if (moveId === MoveId.NONE) {
      turnCommand.targets = [this.fieldIndex];
    }

    console.log(
      "Move:",
      MoveId[moveId],
      "Move targets:",
      moveTargets,
      "\nPlayer Pokemon:",
      getPokemonNameWithAffix(playerPokemon),
    );

    // Co-op (#633): a RELAYED PARTNER command (a forced `move` on the field slot the
    // local player does NOT control) carries the partner's already-RESOLVED targets -
    // they are authoritative. Never open the interactive target-select for a mon we
    // don't own (the live "guest got the target cursor for the host's Bulbasaur, then
    // was stuck choosing Charmander's move" bug). Solo / own-slot / queued-move paths
    // are unaffected: `coopController` is null outside a live co-op run.
    const coopController = move !== undefined && globalScene.gameMode.isCoop ? getCoopController() : null;
    const isCoopPartnerApply =
      coopController != null && coopOwnerOfPlayerFieldSlot(this.fieldIndex) !== coopController.role;

    // Whether an interactive SelectTargetPhase was queued for THIS (own) command, so
    // the co-op broadcast of our own pick is DEFERRED until SelectTargetPhase resolves
    // the actual target (relaying the chosen target, not the candidate set).
    let selectTargetQueued = false;

    if (!isCoopPartnerApply && moveTargets.targets.length > 1 && moveTargets.multiple) {
      globalScene.phaseManager.unshiftNew("SelectTargetPhase", this.fieldIndex);
      selectTargetQueued = true;
    }

    if (turnCommand.move && (moveTargets.targets.length <= 1 || moveTargets.multiple)) {
      turnCommand.move.targets = moveTargets.targets;
    } else if (
      turnCommand.move
      && playerPokemon.getTag(BattlerTagType.CHARGING)
      && playerPokemon.getMoveQueue().length > 0
    ) {
      turnCommand.move.targets = playerPokemon.getMoveQueue()[0].targets;
    } else if (isCoopPartnerApply && turnCommand.move) {
      // Multi-candidate single-target partner move: apply the partner's resolved
      // targets verbatim instead of opening target-select on a mon we don't control.
      turnCommand.move.targets = moveTargets.targets;
    } else {
      globalScene.phaseManager.unshiftNew("SelectTargetPhase", this.fieldIndex);
      selectTargetQueued = true;
    }

    globalScene.currentBattle.preTurnCommands[this.fieldIndex] = preTurnCommand;
    globalScene.currentBattle.turnCommands[this.fieldIndex] = turnCommand;

    // Broadcast our own-slot command now ONLY if its target is already final. When an
    // interactive SelectTargetPhase was queued, that phase broadcasts the RESOLVED
    // command instead, so the partner never re-opens target-select / re-picks.
    if (!selectTargetQueued) {
      // Co-op (#633 Fix #4a): carry the Terastallize flag (Command.TERA) so the watcher
      // teras the partner's mon too. Without it the broadcast hardcoded FIGHT and the
      // partner never terastallized -> the two engines diverged (type/STAB/stat changes).
      this.broadcastLocalCoopCommand(turnCommand, moveId, moveTargets.targets, useMode, command === Command.TERA);
    }

    return true;
  }

  /**
   * Co-op LOCKSTEP (#633, LIVE-C): broadcast the LOCAL human's OWN-slot FIGHT
   * command over the transport so the PEER's partner-slot await
   * ({@linkcode tryCoopAutoResolve}) resolves with the move the human actually
   * picked, instead of falling back to the peer's AI. Each client commands only
   * its own field slot interactively and broadcasts it; the other client awaits
   * and applies it - that is how two real humans trade moves.
   *
   * GUARDED so the solo / non-coop path is byte-for-byte unaffected:
   *   - only in a co-op run with a live session, and
   *   - only for the LOCAL player's OWN field slot (the partner slot is the one we
   *     AWAIT, never broadcast; broadcasting it would feed the peer its own pick).
   *
   * Known gap (this first cut): only the FIGHT command is broadcast. Non-FIGHT
   * partner commands (switch / item / run) still fall back to the peer's AI - those
   * are not yet relayed. The peer applies `cursor` (the move slot) via
   * {@linkcode resolvePartnerSlotCommand}, which re-validates + re-resolves targets
   * host-side; the wired `targets` are sent for parity / future use but a single-
   * target move with multiple candidates in a double is re-picked by the peer's
   * seeded RNG (a known determinism edge until the apply path consumes the wired
   * targets directly).
   */
  private broadcastLocalCoopCommand(
    turnCommand: TurnCommand,
    moveId: MoveId,
    targets: BattlerIndex[],
    useMode: MoveUseMode,
    tera = false,
  ): void {
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    const controller = getCoopController();
    if (controller == null) {
      return;
    }
    // Only broadcast OUR OWN slot; the partner slot is awaited, not broadcast.
    if (coopOwnerOfPlayerFieldSlot(this.fieldIndex) !== controller.role) {
      return;
    }
    const sync = getCoopBattleSync();
    if (sync == null) {
      return;
    }
    const ownFightCommand = {
      command: Command.FIGHT,
      cursor: turnCommand.cursor ?? -1,
      moveId,
      targets,
      targetRefs: targets
        .map(target => this.coopTargetRef(target))
        .filter((target): target is CoopBattleTargetRef => target != null),
      useMode,
      // #633 Fix #4a: carry the Terastallize flag so the watcher teras the partner's mon.
      ...(tera ? { tera: true } : {}),
    };
    // #851: stamp OUR resolved owner (== controller.role past the guard above) so the host's
    // partner-slot await matches by owner even across a post-half-wipe field-index skew.
    sync.broadcastLocalCommand(this.fieldIndex, globalScene.currentBattle.turn, ownFightCommand, controller.role, {
      epoch: controller.sessionEpoch,
      wave: globalScene.currentBattle.waveIndex,
      pokemonId: this.getPokemon().id,
    });
    // #record-replay: capture the own-slot FIGHT command (no-op unless recording).
    recordCoopOwnSlotCommand(this.fieldIndex, ownFightCommand);
  }

  /**
   * Set the mode in preparation to show the text, and then show the text.
   * Only works for parameterless i18next keys.
   * @param key - The i18next key for the text to show
   */
  private queueShowText(key: string): void {
    globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    globalScene.ui.setMode(UiMode.MESSAGE);

    globalScene.ui.showText(
      i18next.t(key),
      null,
      () => {
        globalScene.ui.showText("", 0);
        globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
      },
      null,
      true,
    );
  }

  /**
   * Helper method for {@linkcode handleBallCommand} that checks if a pokeball can be thrown
   * and displays the appropriate error message.
   *
   * @remarks
   * The pokeball may not be thrown if any of the following are true:
   * - It is a trainer battle
   * - The player is in the {@linkcode BiomeId.END | End} biome and
   *   - it is not classic mode; or
   *   - the player has not caught the target before and the player is still missing more than one starter
   * - The player is in a mystery encounter that disallows catching the pokemon
   * @returns Whether a pokeball can be thrown
   */
  private checkCanUseBall(): boolean {
    const { arena, currentBattle, gameData, gameMode } = globalScene;
    const { battleType } = currentBattle;
    const { biomeId } = arena;
    const { isClassic, isEndless, isDaily } = gameMode;
    const { dexData } = gameData;

    const isClassicFinalBoss = gameMode.isBattleClassicFinalBoss(globalScene.currentBattle.waveIndex);
    const isEndlessMinorBoss = gameMode.isEndlessMinorBoss(globalScene.currentBattle.waveIndex);
    const isFullFreshStart = gameMode.isFullFreshStartChallenge();
    const someUncaughtSpeciesOnField = globalScene
      .getEnemyField()
      .some(p => p.isActive() && !dexData[p.species.speciesId].caughtAttr);
    const isCatchableDailyBoss = isDailyFinalBoss() && (getDailyEventSeedBoss()?.catchable ?? false);

    if (biomeId === BiomeId.END && battleType === BattleType.WILD) {
      if (
        (isClassic && !isClassicFinalBoss && someUncaughtSpeciesOnField)
        || (isFullFreshStart && !isClassicFinalBoss)
        || (isEndless && !isEndlessMinorBoss)
      ) {
        // Uncatchable paradox mons in classic and endless
        this.queueShowText("battle:noPokeballForce");
      } else if (
        // ER: the classic final boss is the Primal Cascoon - a true BOSS, never a
        // catch reward. Vanilla only blocked it while you were "missing multiple
        // starters" (catch Eternatus as a dex-completion prize), so an experienced
        // ER player with most starters could ball the boss (reported: the Black
        // Shiny Primal Cascoon was catchable, even with a Master Ball). Always block
        // the classic final boss here.
        (isClassic && isClassicFinalBoss)
        || (isFullFreshStart && isClassicFinalBoss)
        || (isEndless && isEndlessMinorBoss)
        || (isDaily && !isCatchableDailyBoss)
      ) {
        // Uncatchable final boss in classic, endless and daily
        this.queueShowText("battle:noPokeballForceFinalBoss");
      } else {
        return true;
      }
    } else if (battleType === BattleType.TRAINER) {
      this.queueShowText("battle:noPokeballTrainer");
    } else if (currentBattle.isBattleMysteryEncounter() && !currentBattle.mysteryEncounter!.catchAllowed) {
      this.queueShowText("battle:noPokeballMysteryEncounter");
    } else {
      return true;
    }

    return false;
  }

  /**
   * Helper method for {@linkcode handleCommand} that handles the logic when the selected command is to use a pokeball.
   *
   * @param cursor - The index of the pokeball to use
   * @returns Whether the command was successfully initiated
   */
  private handleBallCommand(cursor: number): boolean {
    const targets = globalScene
      .getEnemyField()
      .filter(p => p.isActive(true))
      .map(p => p.getBattlerIndex());

    if (!this.checkCanUseBall()) {
      return false;
    }

    if (targets.length > 1) {
      this.queueShowText("battle:noPokeballMulti");
      return false;
    }

    const isChallengeActive = globalScene.gameMode.hasAnyChallenges();
    const isFinalBoss = globalScene.gameMode.isBattleClassicFinalBoss(globalScene.currentBattle.waveIndex);
    const isCatchableDailyBoss = isDailyFinalBoss() && (getDailyEventSeedBoss()?.catchable ?? false);

    const numBallTypes = 5;
    if (cursor < numBallTypes) {
      const targetPokemon = globalScene.getEnemyPokemon(false);
      if (
        targetPokemon?.isBoss()
        && targetPokemon?.bossSegmentIndex >= 1 // TODO: Decouple this hardcoded exception for wonder guard and just check the target...
        && !targetPokemon?.hasAbility(AbilityId.WONDER_GUARD, false, true)
      ) {
        // When facing the final boss, it must be weakened unless a Master Ball is used AND no challenges are active.
        // The message is customized for the final boss.
        if (
          isFinalBoss
          && (cursor < PokeballType.MASTER_BALL || (cursor === PokeballType.MASTER_BALL && isChallengeActive))
        ) {
          this.queueShowText("battle:noPokeballForceFinalBossCatchable");
          return false;
        }
        // When facing any other boss, Master Ball can always be used, and we use the standard message.
        if (isCatchableDailyBoss || cursor < PokeballType.MASTER_BALL) {
          this.queueShowText("battle:noPokeballStrong");
          return false;
        }
      }

      globalScene.currentBattle.turnCommands[this.fieldIndex] = {
        command: Command.BALL,
        cursor,
      };
      globalScene.currentBattle.turnCommands[this.fieldIndex]!.targets = targets;
      // The throw consumes the whole side's turn: skip every EARLIER slot's committed
      // command. Null-safe + all slots, not just [fieldIndex-1] - in a TRIPLE the
      // previous slot's command can be null (fainted/empty slot), which crashed with
      // "Cannot set properties of null (setting 'skip')" (tester izumi, 2026-07-01).
      for (let i = 0; i < this.fieldIndex; i++) {
        const cmd = globalScene.currentBattle.turnCommands[i];
        if (cmd) {
          cmd.skip = true;
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Submethod of {@linkcode tryLeaveField} to handle the logic for effects that prevent the pokemon from leaving the field
   * due to trapping abilities or effects.
   *
   * This method queues the proper messages in the case of trapping abilities or effects.
   *
   * @returns Whether the pokemon is currently trapped
   */
  private handleTrap(): boolean {
    const playerPokemon = this.getPokemon();
    const trappedAbMessages: string[] = [];
    const isSwitch = this.isSwitch;
    if (!playerPokemon.isTrapped(trappedAbMessages)) {
      return false;
    }
    if (trappedAbMessages.length > 0) {
      if (isSwitch) {
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          globalScene.ui.showText(
            trappedAbMessages[0],
            null,
            () => {
              globalScene.ui.showText("", 0);
              if (isSwitch) {
                globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
              }
            },
            null,
            true,
          );
        });
      }
    } else {
      const trapTag = playerPokemon.getTag(TrappedTag);
      const fairyLockTag = globalScene.arena.getTagOnSide(ArenaTagType.FAIRY_LOCK, ArenaTagSide.PLAYER);

      if (!isSwitch) {
        globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
        globalScene.ui.setMode(UiMode.MESSAGE);
      }
      if (trapTag) {
        this.showNoEscapeText(trapTag, false);
      } else if (fairyLockTag) {
        this.showNoEscapeText(fairyLockTag, false);
      }
    }

    return true;
  }

  /**
   * Common helper method that attempts to have the pokemon leave the field.
   * Checks for trapping abilities and effects.
   *
   * @param cursor - The index of the option that the cursor is on
   * @returns Whether the pokemon is able to leave the field, indicating the command phase should end
   */
  private tryLeaveField(cursor?: number, isBatonSwitch = false): boolean {
    const currentBattle = globalScene.currentBattle;

    if (isBatonSwitch || !this.handleTrap()) {
      currentBattle.turnCommands[this.fieldIndex] = this.isSwitch
        ? {
            command: Command.POKEMON,
            cursor,
            args: [isBatonSwitch],
          }
        : {
            command: Command.RUN,
          };
      if (!this.isSwitch && this.fieldIndex) {
        // Fleeing consumes the side's turn: skip every earlier slot's committed command,
        // null-safe (a fainted/empty TRIPLE slot has a null command - same crash class
        // as the triple ball throw).
        for (let i = 0; i < this.fieldIndex; i++) {
          const cmd = currentBattle.turnCommands[i];
          if (cmd) {
            cmd.skip = true;
          }
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Multi-format (triple+) SHIFT: reposition this mon by swapping field slots with an ACTIVE
   * ally. Writes a {@linkcode Command.SHIFT} turn command (carrying the ally's field slot) for
   * THIS slot only - the swapped-with ally is NOT skipped and still acts from its new position.
   * Resolved during {@linkcode TurnStartPhase} ordered like a switch (before moves), so the
   * shifter's turn is consumed. Strictly gated to triple+ formats; binary battles never reach here.
   *
   * @param targetFieldIndex - The field slot of the active ally to swap positions with.
   * @returns Whether the shift command was accepted (ending the command phase).
   */
  private handleShiftCommand(targetFieldIndex: number): boolean {
    // Gate every shift branch on triple+ (binary battles are byte-identical: no shift exists).
    // Co-op is excluded entirely (triples are gated out of co-op); guard the path regardless.
    if (globalScene.currentBattle.getBattlerCount() < 3 || globalScene.gameMode.isCoop) {
      return false;
    }
    // TODO(triple): restrict to adjacent/center per strict mainline rules
    if (targetFieldIndex === this.fieldIndex) {
      return false;
    }
    const playerField = globalScene.getPlayerField();
    if (!playerField[this.fieldIndex]?.isActive(true) || !playerField[targetFieldIndex]?.isActive(true)) {
      return false;
    }

    globalScene.currentBattle.turnCommands[this.fieldIndex] = {
      command: Command.SHIFT,
      cursor: targetFieldIndex,
    };
    return true;
  }

  /**
   * Helper method for {@linkcode handleCommand} that handles the logic when the selected command is RUN.
   *
   * @remarks
   * Checks if the player is allowed to flee, and if not, queues the appropriate message.
   *
   * The player cannot flee if:
   * - The player is in the {@linkcode BiomeId.END | End} biome
   * - The player is in a trainer battle
   * - The player is in a mystery encounter that disallows fleeing
   * - The player's pokemon is trapped by an ability or effect
   * @returns Whether the pokemon is able to leave the field, indicating the command phase should end
   */
  private handleRunCommand(): boolean {
    const { currentBattle, arena } = globalScene;
    const mysteryEncounterFleeAllowed = currentBattle.mysteryEncounter?.fleeAllowed ?? true;
    if (arena.biomeId === BiomeId.END || !mysteryEncounterFleeAllowed) {
      this.queueShowText("battle:noEscapeForce");
      return false;
    }
    if (
      currentBattle.battleType === BattleType.TRAINER
      || currentBattle.mysteryEncounter?.encounterMode === MysteryEncounterMode.TRAINER_BATTLE
    ) {
      this.queueShowText("battle:noEscapeTrainer");
      return false;
    }

    const success = this.tryLeaveField();

    return success;
  }

  /**
   * Show a message indicating that the pokemon cannot escape, and then return to the command phase.
   */
  private showNoEscapeText(tag: any, isSwitch: boolean): void {
    globalScene.ui.showText(
      i18next.t("battle:noEscapePokemon", {
        pokemonName:
          tag.sourceId && globalScene.getPokemonById(tag.sourceId)
            ? getPokemonNameWithAffix(globalScene.getPokemonById(tag.sourceId)!)
            : "",
        moveName: tag.getMoveName(),
        escapeVerb: i18next.t(isSwitch ? "battle:escapeVerbSwitch" : "battle:escapeVerbFlee"),
      }),
      null,
      () => {
        globalScene.ui.showText("", 0);
        if (!isSwitch) {
          globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
        }
      },
      null,
      true,
    );
  }

  // Overloads for handleCommand to provide a more specific signature for the different options
  /**
   * Process the command phase logic based on the selected command
   *
   * @param command - The kind of command to handle
   * @param cursor - The index of option that the cursor is on, or -1 if no option is selected
   * @param useMode - The mode to use for the move, if applicable. For switches, a boolean that specifies whether the switch is a Baton switch.
   * @param move - For {@linkcode Command.FIGHT}, the move to use
   * @returns Whether the command was successful
   */
  handleCommand(command: Command.FIGHT | Command.TERA, cursor: number, useMode?: MoveUseMode, move?: TurnMove): boolean;
  handleCommand(command: Command.POKEMON, cursor: number, useBaton: boolean): boolean;
  handleCommand(command: Command.BALL | Command.RUN | Command.SHIFT, cursor: number): boolean;
  handleCommand(command: Command, cursor: number, useMode?: boolean | MoveUseMode, move?: TurnMove): boolean;

  public handleCommand(
    command: Command,
    cursor: number,
    useMode: boolean | MoveUseMode = false,
    move?: TurnMove,
  ): boolean {
    if (isCoopV2CommandAdmissionFrozen()) {
      coopWarn("v2-recovery", `Command admission refused field=${this.fieldIndex}: recovery owns the frontier`);
      return false;
    }
    // SHOWDOWN 1v1 (Task F1): the versus guest SHIPS its own-slot pick to the host instead of
    // resolving it locally (the host is the sole engine). Intercept BEFORE any local execution.
    if (this.tryShipShowdownGuestCommand(command, cursor, useMode)) {
      return true;
    }

    let success = false;

    switch (command) {
      case Command.TERA:
      case Command.FIGHT:
        success = this.handleFightCommand(command, cursor, typeof useMode === "boolean" ? undefined : useMode, move);
        break;
      case Command.BALL:
        success = this.handleBallCommand(cursor);
        break;
      case Command.POKEMON:
        this.isSwitch = true;
        success = this.tryLeaveField(cursor, typeof useMode === "boolean" ? useMode : undefined);
        this.isSwitch = false;
        break;
      case Command.RUN:
        success = this.handleRunCommand();
        break;
      case Command.SHIFT:
        success = this.handleShiftCommand(cursor);
        break;
    }

    if (success) {
      // Co-op (#633): relay a BALL / RUN chosen on OUR OWN slot to the partner.
      // Only FIGHT moves were broadcast before, so a thrown Poke Ball (or a flee)
      // never reached the partner's client - its await for our slot timed out and
      // the partner-AI fired a MOVE there instead, so the wild mon was caught on
      // ONE client only (the reported catch desync). FIGHT relays through its own
      // path (handleFightCommand / SelectTargetPhase); here we cover BALL + RUN.
      if (command === Command.BALL || command === Command.RUN) {
        this.broadcastLocalCoopActionCommand(command, cursor);
      } else if (command === Command.POKEMON) {
        // Co-op (#633): a SWITCH chosen on our OWN slot must also reach the partner.
        // Before, only FIGHT/BALL/RUN were relayed, so a switch never crossed: the
        // partner's await for our slot timed out and its AI fired a MOVE there instead -
        // one client switched, the other attacked, and the merged party diverged (the
        // live wave-4 "he switched and we desynced" report). `cursor` is the party slot
        // (the merged party is identical on both clients), and the Baton flag rides along.
        this.broadcastLocalCoopActionCommand(command, cursor, typeof useMode === "boolean" ? useMode : false);
      }
      // #record-replay (single-player): capture this committed player command (move/switch/ball/run).
      // Fires AFTER the co-op broadcast above (behavior-preserving) and is a hard no-op in co-op (the
      // co-op relay taps own that path) + when not recording - so solo / co-op are both unaffected.
      recordSinglePlayerCommand(this.fieldIndex, command, cursor);
      this.end();
    }

    return success;
  }

  /**
   * ER dev-tools: reload the current wave from its save snapshot (the same path the
   * lose-retry uses), then end this phase so the manager advances into the rebuilt
   * encounter. Triggered by the dev-gated RESET command in {@linkcode CommandUiHandler}.
   */
  public resetWave(): void {
    reloadCurrentWave(() => this.end());
  }

  /**
   * Co-op (#633): broadcast a BALL / RUN / POKEMON(switch) command the local human
   * chose for THEIR OWN field slot, so the partner's client mirrors it instead of
   * timing out and auto-resolving a MOVE there (which caught / fled / kept the old mon
   * in on one client only). No-op outside a live co-op run or for the partner slot
   * (that slot is awaited, never broadcast). The partner applies it verbatim via
   * {@linkcode applyRelayedActionCommand}.
   */
  private broadcastLocalCoopActionCommand(
    command: Command.BALL | Command.RUN | Command.POKEMON,
    cursor: number,
    baton = false,
  ): void {
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    const controller = getCoopController();
    if (controller == null || coopOwnerOfPlayerFieldSlot(this.fieldIndex) !== controller.role) {
      return;
    }
    const sync = getCoopBattleSync();
    if (sync == null) {
      return;
    }
    const targets =
      command === Command.BALL
        ? globalScene
            .getEnemyField()
            .filter(p => p.isActive(true))
            .map(p => p.getBattlerIndex())
        : [];
    const targetRefs = targets
      .map(target => this.coopTargetRef(target))
      .filter((target): target is CoopBattleTargetRef => target != null);
    const ownActionCommand: SerializedCommand = {
      command,
      cursor,
      ...(command === Command.BALL ? { targets } : {}),
      ...(command === Command.BALL ? { targetRefs } : {}),
      ...(command === Command.POKEMON ? { baton } : {}),
    };
    // #851: stamp OUR resolved owner (== controller.role past the guard above) so the peer's
    // partner-slot await matches by owner even across a post-half-wipe field-index skew.
    sync.broadcastLocalCommand(this.fieldIndex, globalScene.currentBattle.turn, ownActionCommand, controller.role, {
      epoch: controller.sessionEpoch,
      wave: globalScene.currentBattle.waveIndex,
      pokemonId: this.getPokemon().id,
    });
    // #record-replay: capture the own-slot BALL/RUN/POKEMON command (no-op unless recording).
    recordCoopOwnSlotCommand(this.fieldIndex, ownActionCommand);
  }

  /**
   * Co-op (#633): apply a partner's relayed BALL / RUN command on this (partner)
   * slot by setting the turn command DIRECTLY - NOT by re-running handleBallCommand,
   * whose `checkCanUseBall` reads per-PLAYER save state (dex caughtAttr / starter
   * counts) that legitimately differs between the two clients and could diverge in
   * the END biome. The catcher already validated the throw; we mirror their exact
   * resolved command so both clients run the SAME AttemptCapturePhase (seeded catch
   * RNG -> identical outcome). The ally slot is skipped by the other slot's
   * {@linkcode handleFieldIndexLogic}, which already keys off an ally BALL/RUN.
   */
  private applyRelayedActionCommand(cmd: SerializedCommand): void {
    const battle = globalScene.currentBattle;
    if (cmd.command === Command.RUN) {
      battle.turnCommands[this.fieldIndex] = { command: Command.RUN };
    } else if (cmd.command === Command.POKEMON) {
      // Mirror the partner's SWITCH verbatim: same party-slot cursor + Baton flag, so
      // both clients run the SAME SwitchSummonPhase and the merged party stays identical.
      battle.turnCommands[this.fieldIndex] = {
        command: Command.POKEMON,
        cursor: cmd.cursor,
        args: [cmd.baton ?? false],
      };
    } else {
      const targets =
        (cmd.targets as BattlerIndex[] | undefined)
        ?? globalScene
          .getEnemyField()
          .filter(p => p.isActive(true))
          .map(p => p.getBattlerIndex());
      battle.turnCommands[this.fieldIndex] = { command: Command.BALL, cursor: cmd.cursor ?? 0, targets };
    }
    this.end();
  }

  cancel() {
    if (this.fieldIndex) {
      // Re-queue EVERY slot up to and INCLUDING this one. The old hardcoded 0+1 pair
      // dropped a triple's slot 2 from the turn when the player backed out of the third
      // mon's prompt - its command stayed null and the turn ran without it (tester
      // report: "press b to back up to the first mon, it skips your third mons move").
      for (let i = 0; i <= this.fieldIndex; i++) {
        globalScene.phaseManager.unshiftNew("CommandPhase", i);
      }
      this.end();
    }
  }

  getFieldIndex(): number {
    return this.fieldIndex;
  }

  getPokemon(): PlayerPokemon {
    return globalScene.getPlayerField()[this.fieldIndex];
  }

  end() {
    this.clearShowdownTurnClock();
    this.clearParkedReplacementWake();
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
  }
}
