export enum MultiHitType {
  TWO,
  TWO_TO_FIVE,
  THREE,
  TEN,
  BEAT_UP,
  /**
   * Elite Redux — forces a single hit. Used by Giant Shuriken (ability 958),
   * which turns the normally 2–5-hit Water Shuriken into a single 100BP strike.
   */
  ONE,
}
