export enum GameModes {
  CLASSIC,
  ENDLESS,
  SPLICED_ENDLESS,
  DAILY,
  CHALLENGE,
  LLM_DIRECTOR,
  // Appended (id 6) so existing modes keep their numeric ids (saved as modeId).
  COOP,
  // Appended (id 7) so existing modes keep their numeric ids (saved as modeId).
  // Single ephemeral 1v1 duel at level 100 - not a saved/continuable run.
  SHOWDOWN,
  // Appended (id 8) so every existing saved mode keeps its numeric id.
  // Classic-length solo run with independently configurable randomizers.
  FUN,
}
