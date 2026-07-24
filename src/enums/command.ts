export enum Command {
  FIGHT = 0,
  BALL,
  POKEMON,
  RUN,
  TERA,
  /** ER: reload the current wave through the lose-retry path. */
  RESET,
  /**
   * Multi-format (triple+): reposition by SWAPPING this Pokemon's field slot with a chosen
   * ACTIVE ally. Consumes the shifter's turn (no move is used); resolved during TurnStartPhase
   * ordered like a switch (before moves). Only offered when `getBattlerCount() >= 3`.
   */
  SHIFT,
}
