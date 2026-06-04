import type { NarrativeOnlyBeat } from "#data/llm-director/beat-schema";

/**
 * Generic prefab `narrative_only` beats used as a fallback when the
 * pre-generation queue underruns (i.e., the LLM call hasn't completed in
 * time for the upcoming beat slot).
 *
 * Lines are deliberately tone-neutral so they fit on top of any story bible
 * the player rolled. Pick one at random in the underrun handler; the queue
 * keeps generating in the background and the next 1-ahead beat will be
 * ready for the following slot.
 */

export const FILLER_BEATS: readonly NarrativeOnlyBeat[] = [
  {
    beatId: "filler-quiet-stretch",
    type: "narrative_only",
    introText: "The road quiets for a stretch.",
    bodyText: "You catch your breath, listen to the wind, and press on.",
  },
  {
    beatId: "filler-distant-thunder",
    type: "narrative_only",
    introText: "Distant thunder.",
    bodyText: "Whatever's coming, it's still a few hours away. You keep moving.",
  },
  {
    beatId: "filler-wandering-trainer",
    type: "narrative_only",
    introText: "A wandering trainer crosses your path without a word.",
    bodyText: "They nod once, watch your team for a long second, and walk on.",
  },
  {
    beatId: "filler-ration-stop",
    type: "narrative_only",
    introText: "A short rest.",
    bodyText: "You eat what you carry, refill what you can, and check the team's bandages.",
  },
  {
    beatId: "filler-old-marker",
    type: "narrative_only",
    introText: "An old route marker, carved into a stone.",
    bodyText: "Someone walked this same path before, long ago. You can't tell who, or where they ended up.",
  },
];

/**
 * Pick a filler beat at random. Pure-ish — uses Math.random rather than the
 * scene's seeded RNG so a Director run's filler choices don't accidentally
 * become deterministic across reloads (the Director run is already flagged
 * `nonDeterministic: true`).
 */
export function pickFillerBeat(): NarrativeOnlyBeat {
  const idx = Math.floor(Math.random() * FILLER_BEATS.length);
  return FILLER_BEATS[idx];
}
