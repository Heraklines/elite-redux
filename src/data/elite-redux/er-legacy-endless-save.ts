import { GameModes } from "#enums/game-modes";

/**
 * Standalone vanilla Endless used different progression and balance rules from
 * Elite Redux's postgame Endless Rift. Loading one into the current runtime can
 * therefore create an invalid run. Refusing the load preserves the stored save.
 */
export const RETIRED_STANDALONE_ENDLESS_MESSAGE =
  "This save is from the retired standalone Endless mode and cannot be continued in Elite Redux. It has not been deleted. Current postgame Endless saves are unaffected.";

export function isRetiredStandaloneEndlessSave(save: { gameMode: GameModes | number }): boolean {
  return save.gameMode === GameModes.ENDLESS || save.gameMode === GameModes.SPLICED_ENDLESS;
}
