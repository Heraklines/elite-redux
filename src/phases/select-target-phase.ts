import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { broadcastCoopOwnSlotCommand } from "#data/elite-redux/coop/coop-runtime";
import { broadcastShowdownSyncPlayerCommand } from "#data/elite-redux/showdown/showdown-sync-command";
import type { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { UiMode } from "#enums/ui-mode";
import { PokemonPhase } from "#phases/pokemon-phase";

export class SelectTargetPhase extends PokemonPhase {
  public readonly phaseName = "SelectTargetPhase";
  // biome-ignore lint/complexity/noUselessConstructor: This makes `fieldIndex` required
  constructor(fieldIndex: number) {
    super(fieldIndex);
  }

  start() {
    super.start();

    const turnCommand = globalScene.currentBattle.turnCommands[this.fieldIndex];
    const moveId = turnCommand?.move?.move;
    if (!moveId) {
      this.end();
      return;
    }

    // TODO: Move the logic for computing default targets here instead of `target-select-ui-handler`
    const move = allMoves[moveId];
    const fieldSide = globalScene.getField();

    const user = fieldSide[this.fieldIndex];
    // Any multi format + any LIVING ally (was `double` + getAlly(): the ally-default
    // cursor was dead in TRIPLES and only ever considered the first ally).
    const ally = user.getAllies().find(a => !a.isFainted());
    const shouldDefaultToAlly =
      globalScene.currentBattle.getBattlerCount() > 1 // formatting
      && move.allyTargetDefault
      && ally != null;
    const defaultTargets = shouldDefaultToAlly && ally != null ? [ally.getBattlerIndex()] : undefined;

    globalScene.ui.setMode(
      UiMode.TARGET_SELECT,
      this.fieldIndex,
      move.id,
      (targets: BattlerIndex[]) => {
        globalScene.ui.setMode(UiMode.MESSAGE);
        // Find any tags blocking this target from being selected
        // TODO: Denest and make less jank

        // TODO: when would this occur?
        if (targets[0]) {
          const restrictingTag = user.getTargetRestrictingTag(moveId, fieldSide[targets[0]]);
          if (restrictingTag) {
            globalScene.phaseManager.queueMessage(restrictingTag.selectionDeniedText(user, moveId));
            targets = [];
          }
        }

        if (targets.length === 0) {
          globalScene.currentBattle.turnCommands[this.fieldIndex] = null;
          globalScene.phaseManager.unshiftNew("CommandPhase", this.fieldIndex);
        } else {
          turnCommand.targets = targets;
          // Co-op (#633): now that the LOCAL human has picked the actual target, relay
          // this OWN-slot FIGHT command with the RESOLVED target. CommandPhase deferred
          // the broadcast for exactly this reason, so the partner applies the chosen
          // target verbatim instead of re-opening target-select on a mon it doesn't
          // control (the live "stuck choosing for the partner's mon" bug). The helper
          // is a hard no-op in solo and for the partner's slot.
          if (turnCommand.command === Command.FIGHT && turnCommand.move) {
            // #633 Fix #4a: the Terastallize flag lives on the preTurnCommand (the turnCommand
            // is always FIGHT), so read it from there to relay tera on a spread/multi-target
            // move whose broadcast was deferred to this resolved-target phase.
            const tera = globalScene.currentBattle.preTurnCommands[this.fieldIndex]?.command === Command.TERA;
            broadcastCoopOwnSlotCommand(this.fieldIndex, {
              command: Command.FIGHT,
              cursor: turnCommand.cursor ?? -1,
              moveId: turnCommand.move.move,
              targets,
              useMode: turnCommand.move.useMode,
              ...(tera ? { tera: true } : {}),
            });
            broadcastShowdownSyncPlayerCommand(this.fieldIndex, {
              command: Command.FIGHT,
              cursor: turnCommand.cursor ?? -1,
              moveId: turnCommand.move.move,
              targets,
              useMode: turnCommand.move.useMode,
              ...(tera ? { tera: true } : {}),
            });
          }
        }
        if (turnCommand.command === Command.BALL && this.fieldIndex) {
          // Null-safe + ALL earlier slots (triple ball-throw crash class - see command-phase).
          for (let i = 0; i < this.fieldIndex; i++) {
            const cmd = globalScene.currentBattle.turnCommands[i];
            if (cmd) {
              cmd.skip = true;
            }
          }
        }
        this.end();
      },
      defaultTargets,
    );
  }
}
