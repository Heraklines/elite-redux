/**
 * Bitmask flags for the up-to-3 unlockable passive abilities per starter.
 * Elite Redux ports each species' 3 "innates" into 3 slots. Vanilla pokerogue
 * uses slot 1 only; the UNLOCKED/ENABLED legacy aliases preserve that semantics.
 */
export enum Passive {
  // Slot 1 (cheapest unlock — vanilla-equivalent slot)
  UNLOCKED_1 = 1 << 0,
  ENABLED_1 = 1 << 1,
  // Slot 2 (medium unlock cost)
  UNLOCKED_2 = 1 << 2,
  ENABLED_2 = 1 << 3,
  // Slot 3 (most expensive unlock)
  UNLOCKED_3 = 1 << 4,
  ENABLED_3 = 1 << 5,

  // Back-compat aliases — existing callsites use UNLOCKED/ENABLED to refer
  // to slot 1. These literal values match UNLOCKED_1/ENABLED_1 to preserve
  // that meaning under the new layout. (Inlined as literals because the
  // `unplugin-inline-enum` build plugin does not support Identifier
  // initializers — `UNLOCKED = UNLOCKED_1` would break the build.)
  UNLOCKED = 1,
  ENABLED = 2,
}
