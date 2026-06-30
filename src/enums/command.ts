export enum Command {
  FIGHT = 0,
  BALL,
  POKEMON,
  RUN,
  TERA,
  /** ER dev-tools: reload the current wave (lose-retry path). Gated at the command UI. */
  RESET,
}
