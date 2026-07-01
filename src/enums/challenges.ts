export enum Challenges {
  SINGLE_GENERATION,
  SINGLE_TYPE,
  LOWER_MAX_STARTER_COST,
  LOWER_STARTER_POINTS,
  FRESH_START,
  INVERSE_BATTLE,
  FLIP_STAT,
  LIMITED_CATCH,
  LIMITED_SUPPORT,
  HARDCORE,
  PASSIVES,
  DOUBLES_ONLY,
  USAGE_TIER,
  MONO_COLOR,
  GHOST_TRAINERS,
  // ER: keep TRIPLES_ONLY LAST - challenge ids are persisted by ordinal, so a new
  // value must APPEND (never insert) or it shifts every saved challenge config.
  TRIPLES_ONLY,
}
