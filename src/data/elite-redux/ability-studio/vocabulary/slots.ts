/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Shared with the editor worker via vocabulary.json.

/**
 * The typed frame every WHEN provides and every IF / DO requires (spec section 1.1).
 *
 * `hits` is the one slot beyond the original table: the multi-hit counters that the
 * `multi-hit`, `hit-index` and `last-hit` atoms read.
 */
export const SLOT_IDS = [
  "holder",
  "other",
  "move",
  "moveUser",
  "damage",
  "hitResult",
  "stat",
  "stages",
  "weather",
  "terrain",
  "status",
  "tag",
  "ally",
  "simulated",
  "hits",
] as const;

export type SlotId = (typeof SLOT_IDS)[number];

export interface SlotDef {
  readonly id: SlotId;
  readonly label: string;
  readonly meaning: string;
}

export const SLOTS: readonly SlotDef[] = [
  { id: "holder", label: "The ability owner", meaning: "The Pokemon that owns the ability." },
  {
    id: "other",
    label: "The other Pokemon",
    meaning: "The attacker, target, opponent or source, as the trigger defines it.",
  },
  { id: "move", label: "The move", meaning: "The move currently being used or resolved." },
  {
    id: "moveUser",
    label: "The move user",
    meaning: "The Pokemon whose type, category and flags are read for the move.",
  },
  {
    id: "damage",
    label: "The damage",
    meaning: "The effective damage. For after-taking-damage this includes the multi-hit rewrite.",
  },
  { id: "hitResult", label: "The hit result", meaning: "How the hit turned out (normal, super effective, and so on)." },
  { id: "stat", label: "The stat", meaning: "The stat involved." },
  { id: "stages", label: "The stage change", meaning: "How many stages the stat moved." },
  { id: "weather", label: "The weather", meaning: "The current weather." },
  { id: "terrain", label: "The terrain", meaning: "The current terrain." },
  { id: "status", label: "The status", meaning: "The status condition involved." },
  { id: "tag", label: "The battle effect", meaning: "The battler tag (volatile effect) involved." },
  { id: "ally", label: "The ally", meaning: "The holder's ally." },
  { id: "simulated", label: "Simulation flag", meaning: "Whether the call is only a preview, with no side effects." },
  { id: "hits", label: "The hit counters", meaning: "The hit count and hit index of a multi-hit move." },
];

/**
 * The V1 `ABILITY_STUDIO_RUNTIME_HOOK_CONTEXTS` strings map 1:1 to slots here, so V1 validation
 * and the slot system agree. Strings that carry no slot (pure state descriptions) map to `null`.
 */
export const LEGACY_CONTEXT_STRING_TO_SLOT: Readonly<Record<string, SlotId | null>> = {
  holder: "holder",
  attacker: "other",
  target: "other",
  ally: "ally",
  "defeated Pokemon": "other",
  opponent: "other",
  "move user": "moveUser",
  move: "move",
  targets: "other",
  "incoming damage": "damage",
  "damage dealt": "damage",
  "hit result": "hitResult",
  "changed stats": "stat",
  "stage delta": "stages",
  source: "other",
  status: "status",
  "volatile effect": "tag",
  weather: "weather",
  terrain: "terrain",
  "simulation state": "simulated",
  "move calculation": null,
  "battle initialization": null,
  "entry state": null,
  "switch state": null,
  "field-leave state": null,
  "cancellation state": null,
  "wake-up state": null,
  "turn-end state": null,
  biome: null,
  "lost-item state": null,
  "victory state": null,
  "pre-entry state": null,
  "redirection state": null,
  "flinch state": null,
  "direct engine check": null,
};

export function isSlotId(value: unknown): value is SlotId {
  return typeof value === "string" && (SLOT_IDS as readonly string[]).includes(value);
}

/** Returns the slots in `requires` that `provides` does not cover (empty means usable). */
export function missingSlots(requires: readonly SlotId[], provides: readonly SlotId[]): SlotId[] {
  const have = new Set(provides);
  return requires.filter(slot => !have.has(slot));
}
