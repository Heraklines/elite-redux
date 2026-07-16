import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import type { TurnCommand } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { erShatteredPsycheMaybeFuse } from "#data/elite-redux/abilities/shattered-psyche";
import { summonCoopPlayerField } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  coopLocalOwnedPlayerFieldSlot,
  getCoopController,
  getCoopNetcodeMode,
  isAuthoritativeBattleSession,
} from "#data/elite-redux/coop/coop-runtime";
import { beginCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { SwitchType } from "#enums/switch-type";
import type { Pokemon } from "#field/pokemon";
import { BypassSpeedChanceModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { FieldPhase } from "#phases/field-phase";
import { inSpeedOrder } from "#utils/speed-order-generator";

export class TurnStartPhase extends FieldPhase {
  public readonly phaseName = "TurnStartPhase";

  private queuePreemptiveCounters(field: Pokemon[]): void {
    for (const pokemon of field) {
      // globalScene.getField() returns a length-4 array with `null` in every
      // unoccupied slot (slots 1 & 3 in a single battle), so guard before the
      // deref - otherwise TurnStartPhase crashed on the first turn of EVERY
      // single battle ("Cannot read properties of null (reading
      // 'getAllActiveAbilityAttrs')"), freezing the run after any move.
      if (!pokemon) {
        continue;
      }
      for (const attr of pokemon.getAllActiveAbilityAttrs()) {
        const condition = attr.getCondition();
        if (attr.constructor.name === "PreemptivePriorityCounterAbAttr" && (condition === null || condition(pokemon))) {
          (attr as unknown as { queueCounters: (holder: Pokemon) => void }).queueCounters(pokemon);
        }
      }
    }
  }

  /**
   * Returns an ordering of the current field based on command priority
   * @returns The sequence of commands for this turn
   */
  private getCommandOrder(): BattlerIndex[] {
    const playerField = globalScene.getPlayerField(true).map(p => p.getBattlerIndex());
    const enemyField = globalScene.getEnemyField(true).map(p => p.getBattlerIndex());
    const orderedTargets: BattlerIndex[] = playerField.concat(enemyField);

    // The function begins sorting orderedTargets based on command priority, move priority, and possible speed bypasses.
    // Non-FIGHT commands (SWITCH, BALL, RUN) have a higher command priority and will always occur before any FIGHT commands.
    orderedTargets.sort((a, b) => {
      const aCommand = globalScene.currentBattle.turnCommands[a];
      const bCommand = globalScene.currentBattle.turnCommands[b];

      if (aCommand?.command !== bCommand?.command) {
        if (aCommand?.command === Command.FIGHT) {
          return 1;
        }
        if (bCommand?.command === Command.FIGHT) {
          return -1;
        }
      }

      const aIndex = orderedTargets.indexOf(a);
      const bIndex = orderedTargets.indexOf(b);

      return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0;
    });
    return orderedTargets;
  }

  // TODO: Refactor this alongside `CommandPhase.handleCommand` to use SEPARATE METHODS
  // Also need a clearer distinction between "turn command" and queued moves
  start() {
    super.start();

    // Co-op AUTHORITATIVE netcode only (#633, TRACK-2 Phase B): the GUEST is a pure
    // renderer - it diverts the WHOLE turn resolution to CoopReplayTurnPhase (which
    // awaits the host's authoritative outcome stream + applies the checkpoint) and
    // queues NO MovePhase / capture / enemy resolution. The HOST falls through and
    // resolves the turn normally, opening a turn recording so its narration is captured
    // + streamed. In LOCKSTEP this block is SKIPPED entirely so both engines resolve the
    // turn normally (the move stays visibly synced). Gated on a live co-op role, so solo
    // / non-co-op play is byte-for-byte unchanged. Showdown-versus (C3) rides the SAME divert
    // via isAuthoritativeBattleSession() (co-op OR showdown, authoritative).
    if (isAuthoritativeBattleSession()) {
      const role = getCoopController()?.role;
      // DIAGNOSTIC (#633 trainer-victory deadlock): log the authoritative guest-diversion guard so a
      // live capture shows the mode+role at the divert decision - a silent "lockstep" fallback here is
      // exactly the failure where the guest runs its OWN engine instead of CoopReplayTurnPhase.
      console.info(
        `[coop-diag] turn-start authoritative guard mode=${getCoopNetcodeMode()} role=${role ?? "none"} turn=${globalScene.currentBattle.turn} diverts=${role === "guest"}`,
      );
      if (role === "guest") {
        // SELF-SWITCH MIRROR (#633, coop-me-authoritative): the guest is a pure renderer that diverts
        // the WHOLE turn here BEFORE the handleTurnCommand loop below - the ONLY place SwitchSummonPhase
        // is ever queued. So the guest's OWN voluntary switch (its `turnCommands[guestSlot] = {command:
        // POKEMON, cursor}`, written by command-phase tryLeaveField) was silently discarded: its on-field
        // composition kept the OLD lead while the host (which simulates with the guest's relayed command
        // and runs a real SwitchSummonPhase for that slot) swapped in the new mon. The positional
        // getPlayerField serialization then shifted by one, the per-turn checksum mismatched EVERY turn,
        // and the numeric-only resync heal could not reposition an on-field mon (so it never self-healed).
        // Mirror the guest's own switch with the SIDE-EFFECT-FREE summonCoopPlayerField (the SAME
        // `party[fieldIndex] <-> party[slotIndex]` swap + visual summon the host's SwitchSummonPhase does,
        // but with NO resolution pipeline + NO fresh RNG - a real SwitchSummonPhase / handleTurnCommand
        // would re-draw RNG + re-fire hazards/abilities and cause FRESH divergence). After this, the
        // guest's positional getPlayerField realigns with the host's and the checksum converges.
        this.mirrorGuestOwnSwitch();
        globalScene.phaseManager.pushNew("CoopReplayTurnPhase", globalScene.currentBattle.turn);
        this.end();
        return;
      }
      if (role === "host") {
        beginCoopRecording(globalScene.currentBattle.turn);
      }
    }

    // ER Shattered Psyche (5968, Primal Mew's innate): post-command, once per
    // battle, the holder fuses two of its opponents into one entity. Runs here -
    // after the guest early-return above, so it is host/solo only by construction
    // - once turnCommands are fully populated (both CommandPhase and
    // EnemyCommandPhase have run) but before the move phases are queued.
    erShatteredPsycheMaybeFuse();

    const field = globalScene.getField();
    const moveOrder = this.getCommandOrder();

    for (const pokemon of inSpeedOrder(ArenaTagSide.BOTH)) {
      const preTurnCommand = globalScene.currentBattle.preTurnCommands[pokemon.getBattlerIndex()];

      if (preTurnCommand?.skip) {
        continue;
      }

      switch (preTurnCommand?.command) {
        case Command.TERA:
          globalScene.phaseManager.pushNew("TeraPhase", pokemon);
      }
    }

    const phaseManager = globalScene.phaseManager;
    for (const pokemon of inSpeedOrder(ArenaTagSide.BOTH)) {
      if (globalScene.currentBattle.turnCommands[pokemon.getBattlerIndex()]?.command !== Command.FIGHT) {
        continue;
      }

      applyAbAttrs("BypassSpeedChanceAbAttr", { pokemon });
      globalScene.applyModifiers(BypassSpeedChanceModifier, pokemon.isPlayer(), pokemon);
    }

    this.queuePreemptiveCounters(field);

    moveOrder.forEach((o, index) => {
      const pokemon = field[o];
      const turnCommand = globalScene.currentBattle.turnCommands[o];

      if (!turnCommand || turnCommand.skip) {
        return;
      }

      // TODO: Remove `turnData.order` -
      // it is used exclusively for Fusion Flare/Bolt
      // and uses a really jank (and incorrect) implementation
      if (turnCommand.command === Command.FIGHT) {
        pokemon.turnData.order = index;
      }
      this.handleTurnCommand(turnCommand, pokemon);
    });

    // Queue various effects for the end of the turn.
    phaseManager.pushNew("CheckInterludePhase");

    // TODO: Re-order these phases to be consistent with mainline turn order:
    // https://www.smogon.com/forums/threads/sword-shield-battle-mechanics-research.3655528/page-64#post-9244179

    // TODO: In an ideal world, this is handled by the phase manager. The change is nontrivial due to the ordering of post-turn phases like those queued by VictoryPhase
    globalScene.phaseManager.queueTurnEndPhases();

    /*
     * `this.end()` will call `PhaseManager#shiftPhase()`, which dumps everything from `phaseQueuePrepend`
     * (aka everything that is queued via `unshift()`) to the front of the queue and dequeues to start the next phase.
     * This is important since stuff like `SwitchSummonPhase`, `AttemptRunPhase`, and `AttemptCapturePhase` break the "flow" and should take precedence
     */
    this.end();
  }

  /**
   * GUEST (authoritative, #633): mirror the guest's OWN voluntary switch BEFORE diverting the turn to
   * CoopReplayTurnPhase. The guest owns exactly one player field slot (resolved N-ready via
   * {@linkcode coopLocalOwnedPlayerFieldSlot} - the mon's `coopOwner` tag, falling back to the fixed
   * 2-player slot map); its queued `turnCommands[slot]` carries the switch (`command === Command.POKEMON`,
   * `cursor` = the target party slot) written by command-phase `tryLeaveField`. Perform the SAME side-effect-free
   * `party[fieldIndex] <-> party[cursor]` swap + visual summon the host's SwitchSummonPhase does via
   * {@linkcode summonCoopPlayerField} (NO resolution pipeline / NO fresh RNG), so the guest's positional
   * field serialization realigns with the host's. ONLY the guest's own slot + ONLY a POKEMON command is
   * acted on (BALL / RUN are not a field-composition change and ride the host's authoritative outcome).
   * Fully guarded so a malformed command can never block the divert.
   */
  private mirrorGuestOwnSwitch(): void {
    try {
      const guestSlot = coopLocalOwnedPlayerFieldSlot();
      const turnCommand = globalScene.currentBattle.turnCommands[guestSlot];
      // A voluntary switch carries the target party slot in `cursor`. Anything else (FIGHT/BALL/RUN,
      // a skipped command, or no cursor) is not a self-switch and rides the host's authoritative outcome.
      if (turnCommand == null || turnCommand.skip || turnCommand.command !== Command.POKEMON) {
        return;
      }
      const targetSlot = turnCommand.cursor;
      if (typeof targetSlot !== "number" || targetSlot < 0) {
        return;
      }
      // C.1 diagnostic (#633): KEEP this eager swap (it gives the guest immediate visual feedback on
      // its OWN switch). Log it so a future capture can compare it against the host-checkpoint
      // reconcileCoopPlayerField PASS 2 reposition log - if PASS 2 ever moves this same mon to a
      // DIFFERENT slot, the eager swap and the host's authoritative placement disagreed (the real
      // orphan fix is the post-PASS-2 sweep + incoming-vacate in coop-battle-engine, not disabling this).
      coopLog("field", `guest eager self-switch slot=${guestSlot} -> party=${targetSlot}`);
      // Identical swap to the host's SwitchSummonPhase (`party[fieldIndex] <-> party[slotIndex]`), but
      // side-effect-free: no SwitchSummonPhase / handleTurnCommand resolution, no RNG, no hazard/ability re-fire.
      summonCoopPlayerField(guestSlot, targetSlot);
    } catch {
      // A malformed self-switch command must never block the guest's turn divert.
    }
  }

  private handleTurnCommand(turnCommand: TurnCommand, pokemon: Pokemon) {
    switch (turnCommand?.command) {
      case Command.FIGHT:
        this.handleFightCommand(turnCommand, pokemon);
        break;
      case Command.BALL:
        // Multi-format: AttemptCapturePhase takes the target enemy's POSITION within its side
        // (== flat target - enemyOffset, which is `% 2` only in binary).
        globalScene.phaseManager.unshiftNew(
          "AttemptCapturePhase",
          globalScene.currentBattle.arrangement.locate(turnCommand.targets![0]).position,
          turnCommand.cursor!,
          // Co-op (#800): the commanding mon's owner IS the ball-thrower - the catch is
          // attributed to them (their half permitting) instead of pure half-balancing.
          (pokemon as { coopOwner?: "host" | "guest" }).coopOwner,
        );
        break;
      case Command.POKEMON:
        globalScene.phaseManager.unshiftNew(
          "SwitchSummonPhase",
          turnCommand.args?.[0] ? SwitchType.BATON_PASS : SwitchType.SWITCH,
          pokemon.getFieldIndex(),
          turnCommand.cursor!, // TODO: Is this bang correct?
          true,
          pokemon.isPlayer(),
        );
        break;
      case Command.SHIFT:
        // Multi-format (triple+): reposition this mon by swapping field slots with an active
        // ally. Queued like a switch (unshift -> runs BEFORE the move phases), so the shifter's
        // turn is consumed. `cursor` carries the ally's field slot. Player-side only.
        globalScene.phaseManager.unshiftNew("ShiftSummonPhase", pokemon.getFieldIndex(), turnCommand.cursor!);
        break;
      case Command.RUN:
        globalScene.phaseManager.unshiftNew("AttemptRunPhase");
        break;
    }
  }

  private handleFightCommand(turnCommand: TurnCommand, pokemon: Pokemon) {
    const queuedMove = turnCommand.move;
    if (!queuedMove) {
      return;
    }

    // TODO: This seems somewhat dubious
    const move =
      pokemon.getMoveset().find(m => m.moveId === queuedMove.move && m.ppUsed < m.getMovePp())
      ?? new PokemonMove(queuedMove.move);

    if (move.getMove().hasAttr("MoveHeaderAttr")) {
      globalScene.phaseManager.unshiftNew("MoveHeaderPhase", pokemon, move);
    }

    globalScene.phaseManager.pushNew(
      "MovePhase",
      pokemon,
      turnCommand.targets ?? queuedMove.targets,
      move,
      queuedMove.useMode,
    );
  }
}
