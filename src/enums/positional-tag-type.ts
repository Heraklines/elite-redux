/**
 * Enum representing all positional tag types.
 * @privateRemarks
 * When adding new tag types, please update `positionalTagConstructorMap` in `src/data/positionalTags`
 * with the new tag type.
 */
export enum PositionalTagType {
  DELAYED_ATTACK = "DELAYED_ATTACK",
  WISH = "WISH",
  /** Permanent effect attached to a battler slot by Electrodynamics. */
  ELECTRODYNAMICS_POSITION = "ELECTRODYNAMICS_POSITION",
}
