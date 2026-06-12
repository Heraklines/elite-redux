export enum EggSourceType {
  GACHA_MOVE,
  GACHA_LEGENDARY,
  GACHA_SHINY,
  SAME_SPECIES_EGG,
  EVENT,
  /**
   * Elite Redux (#409): eggs pulled from the "Redux Up" gacha machine.
   * SAVE SAFETY: this enum is serialized into saves - new members must ONLY
   * ever be APPENDED (GachaType.REDUX is 3, which here is SAME_SPECIES_EGG;
   * never write a raw gacha cursor into an egg's sourceType).
   */
  GACHA_REDUX = 5,
}
