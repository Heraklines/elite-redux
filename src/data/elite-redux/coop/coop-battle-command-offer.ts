/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type {
  CoopBattleCommandOffer,
  CoopBattleMoveOffer,
  SerializedCommand,
} from "#data/elite-redux/coop/coop-transport";
import { Command } from "#enums/command";
import { MoveUseMode } from "#enums/move-use-mode";

export interface CoopCommandValidation {
  valid: boolean;
  reason?: string | undefined;
}

function invalid(reason: string): CoopCommandValidation {
  return { valid: false, reason };
}

function sameTargets(actual: readonly number[] | undefined, expected: readonly number[]): boolean {
  if (actual == null || actual.length !== expected.length) {
    return false;
  }
  const sortedActual = [...actual].sort((a, b) => a - b);
  const sortedExpected = [...expected].sort((a, b) => a - b);
  return sortedActual.every((target, index) => target === sortedExpected[index]);
}

function validateMove(command: SerializedCommand, move: CoopBattleMoveOffer | undefined): CoopCommandValidation {
  if (move == null) {
    return invalid("move-slot-not-offered");
  }
  if (command.moveId !== move.moveId) {
    return invalid("move-id-mismatch");
  }
  if ((command.useMode ?? MoveUseMode.NORMAL) !== MoveUseMode.NORMAL) {
    return invalid("non-human-use-mode");
  }
  if (command.tera === true && !move.canTera) {
    return invalid("tera-not-offered");
  }
  if (!move.targetSets.some(targets => sameTargets(command.targets, targets))) {
    return invalid("targets-not-offered");
  }
  return { valid: true };
}

function validateSwitch(command: SerializedCommand, offer: CoopBattleCommandOffer): CoopCommandValidation {
  if (command.moveId != null || command.targets != null || command.useMode != null || command.tera != null) {
    return invalid("switch-has-fight-fields");
  }
  if (command.baton != null && typeof command.baton !== "boolean") {
    return invalid("malformed-baton-flag");
  }
  const offeredSwitch = offer.switches.find(candidate => candidate.slot === command.cursor);
  if (offeredSwitch == null) {
    return invalid("switch-slot-not-offered");
  }
  if (command.baton === true) {
    return offeredSwitch.canBaton ? { valid: true } : invalid("baton-switch-not-offered");
  }
  return offeredSwitch.canNormal ? { valid: true } : invalid("normal-switch-not-offered");
}

function validateBall(command: SerializedCommand, offer: CoopBattleCommandOffer): CoopCommandValidation {
  if (command.moveId != null || command.useMode != null || command.tera != null || command.baton != null) {
    return invalid("action-has-fight-or-switch-flags");
  }
  if (!offer.ballTypes.includes(command.cursor)) {
    return invalid("ball-type-not-offered");
  }
  return sameTargets(command.targets, offer.ballTargets) ? { valid: true } : invalid("ball-targets-not-offered");
}

function validateRun(command: SerializedCommand, offer: CoopBattleCommandOffer): CoopCommandValidation {
  if (
    command.moveId != null
    || command.targets != null
    || command.useMode != null
    || command.tera != null
    || command.baton != null
  ) {
    return invalid("run-has-extra-fields");
  }
  return offer.canRun ? { valid: true } : invalid("run-not-offered");
}

/** Validate an untrusted peer command solely against the host-authored legal offer. */
export function validateCoopBattleCommand(
  command: SerializedCommand,
  offer: CoopBattleCommandOffer,
): CoopCommandValidation {
  if (!Number.isSafeInteger(command.command) || !Number.isSafeInteger(command.cursor)) {
    return invalid("malformed-command");
  }
  switch (command.command) {
    case Command.FIGHT:
      return validateMove(
        command,
        offer.moves.find(move => move.slot === command.cursor),
      );
    case Command.POKEMON:
      return validateSwitch(command, offer);
    case Command.BALL:
      return validateBall(command, offer);
    case Command.RUN:
      return validateRun(command, offer);
    default:
      return invalid("command-kind-not-offered");
  }
}
