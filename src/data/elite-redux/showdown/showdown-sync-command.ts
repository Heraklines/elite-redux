/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { TurnCommand } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { isShowdownSyncSession } from "#data/elite-redux/coop/coop-runtime";
import type { SerializedCommand } from "#data/elite-redux/coop/coop-transport";
import { getShowdownRelay } from "#data/elite-redux/showdown/showdown-battle-state";
import { swapBi } from "#data/elite-redux/showdown/showdown-side-swap";
import { Command } from "#enums/command";
import type { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import { getMoveTargets } from "#moves/move-utils";

export type ShowdownSyncSide = "player" | "enemy";

function commandSlot(side: ShowdownSyncSide, fieldIndex: number): number {
  return side === "player" ? fieldIndex : globalScene.currentBattle.arrangement.enemyOffset + fieldIndex;
}

function pokemonAt(side: ShowdownSyncSide, fieldIndex: number): Pokemon | undefined {
  return side === "player" ? globalScene.getPlayerField()[fieldIndex] : globalScene.getEnemyField()[fieldIndex];
}

function partyFor(side: ShowdownSyncSide): Pokemon[] {
  return side === "player" ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
}

function resolveTargets(
  pokemon: Pokemon,
  moveId: MoveId,
  command: SerializedCommand,
  remotePerspective: boolean,
): number[] {
  const legal = getMoveTargets(pokemon, moveId);
  if (legal.multiple || legal.targets.length <= 1) {
    return legal.targets;
  }
  const legalSet = new Set<number>(legal.targets);
  for (const battlerIndex of command.targets ?? []) {
    const localIndex = remotePerspective
      ? swapBi(battlerIndex, globalScene.currentBattle.arrangement.enemyOffset)
      : battlerIndex;
    if (legalSet.has(localIndex)) {
      return [localIndex];
    }
  }
  if (!remotePerspective) {
    for (const ref of command.targetRefs ?? []) {
      const target = globalScene.getField(true).find(candidate => candidate.id === ref.pokemonId);
      const battlerIndex = target?.getBattlerIndex();
      if (battlerIndex != null && legalSet.has(battlerIndex)) {
        return [battlerIndex];
      }
    }
  }
  return legal.targets.length === 0 ? [] : [legal.targets[0]];
}

/** Apply one already-selected Sync command to either side of the canonical local battle. */
export function applyShowdownSyncCommand(
  side: ShowdownSyncSide,
  fieldIndex: number,
  command: SerializedCommand,
): boolean {
  const pokemon = pokemonAt(side, fieldIndex);
  if (pokemon == null) {
    return false;
  }
  const slot = commandSlot(side, fieldIndex);
  if (command.command === Command.POKEMON) {
    const replacement = partyFor(side)[command.cursor];
    if (replacement == null || replacement.isFainted() || replacement.isOnField()) {
      return false;
    }
    globalScene.currentBattle.turnCommands[slot] = {
      command: Command.POKEMON,
      cursor: command.cursor,
      args: [command.baton ?? false],
    };
    return true;
  }
  if (command.command !== Command.FIGHT) {
    return false;
  }
  const move = pokemon.getMoveset().find(candidate => candidate.moveId === command.moveId);
  if (move == null || move.isOutOfPp()) {
    return false;
  }
  const useMode = (command.useMode as MoveUseMode | undefined) ?? MoveUseMode.NORMAL;
  const turnCommand: TurnCommand = {
    command: Command.FIGHT,
    cursor: command.cursor,
    move: {
      move: move.moveId,
      targets: resolveTargets(pokemon, move.moveId, command, side === "enemy"),
      useMode,
    },
    args: [useMode],
  };
  globalScene.currentBattle.turnCommands[slot] = turnCommand;
  globalScene.currentBattle.preTurnCommands[slot] = command.tera
    ? { command: Command.TERA, targets: [slot] }
    : { command: Command.FIGHT, targets: [slot], skip: true };
  return true;
}

/** Send this client's player-side command; the receiver mirrors its selected battler indices. */
export function broadcastShowdownSyncPlayerCommand(fieldIndex: number, command: SerializedCommand): void {
  if (!isShowdownSyncSession()) {
    return;
  }
  getShowdownRelay()?.sendCommand(globalScene.currentBattle.turn, command, fieldIndex);
}

/** Each Sync engine resolves its own local player result. */
export function localShowdownResult(playerWon: boolean): boolean {
  return playerWon;
}
