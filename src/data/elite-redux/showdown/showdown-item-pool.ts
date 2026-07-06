import type { modifierTypes } from "#data/data-lists";

export type ShowdownItemKey = keyof typeof modifierTypes;

/** Curated held items legal in showdown (one per mon). Balance edits happen HERE only. */
export const SHOWDOWN_ITEM_POOL: readonly ShowdownItemKey[] = [
  "LEFTOVERS",
  "SHELL_BELL",
  "FOCUS_BAND",
  "QUICK_CLAW",
  "KINGS_ROCK",
  "TOXIC_ORB",
  "FLAME_ORB",
  "FROSTBITE_ORB",
  "BATON",
] as const;
