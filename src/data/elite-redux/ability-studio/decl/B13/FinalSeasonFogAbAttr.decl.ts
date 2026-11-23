/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Final Season, part 2 of 3 (Tier B, event-effect). "At the end of the turn I armed, set Eerie Fog for 5 turns."
//
// Source: abilities/newcomer-signature-mechanics.ts, FinalSeasonFogAbAttr (PostTurnAbAttr).
//   canApply  one clause: the holder is in FINAL_SEASON_PENDING_FOG (armed by FinalSeasonEntryAbAttr.apply).
//             -> the gate. No library atom for "an earlier effect of mine armed this" (the effect side,
//             effect.arm-effect, exists; its condition side does not): legacy-closure + request `time.armed`.
//   apply     1. FINAL_SEASON_PENDING_FOG.delete(holder)   (even when simulated)
//             2. not simulated and arena.trySetWeather(EERIE_FOG, holder, 5) succeeded:
//                remember the holder as the fog's owner and remember the Weather instance (read by
//                FinalSeasonPowerAbAttr to know "this is MY fog")
//   No RNG. Effect = set the weather, an existing effect block (effect.set-weather).
import { FinalSeasonFogAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FinalSeasonFogAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Set Eerie Fog for 5 turns at turn end once armed",
  summary: () =>
    "At the end of a turn, if my switch-in effect readied it, Eerie Fog covers the field for 5 turns and I remember it as my own fog.",
  synonyms: ["delayed weather", "fog", "eerie fog", "end of turn weather", "set weather later", "final season"],
  examples: ["Set Eerie Fog at the end of the turn after my special switch-in"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the Eerie Fog weather and its 5 turns are fixed in its code. Staff reach the same behaviour with a composed rule (an end-of-turn trigger, an 'armed earlier' condition and the set-weather block).",
  conditions: [
    // The one clause of canApply. Legacy closure until the librarian adds the atom (see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The field must accept Eerie Fog (a primal weather such as Heavy Rain or Harsh Sun cannot be overwritten)",
  ],
  effect: { id: "effect.set-weather", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // The armed flag is never set in a plain battle, so the gate is false; the armed case is in B13/final-season.test.ts.
      name: "turn end with nothing armed",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Users: Final Season (5972, attr 1). Gate = FINAL_SEASON_PENDING_FOG.has(holder), legacy-closure pending request `time.armed`. Effect = trySetWeather(EERIE_FOG, holder, 5); the arena's own feasibility (a primal weather blocks it) stays in the class. Bookkeeping that rides along: the holder and the Weather instance are stored in module-level variables (finalSeasonFogOwner, finalSeasonFogInstance) so FinalSeasonPowerAbAttr can tell the fog is the holder's own. ODDITIES (not fixed): (1) apply deletes the armed flag BEFORE the simulated and trySetWeather checks, so a blocked fog (primal weather) or a simulated call still spends the arming; (2) the owner/instance variables are single module-level slots shared by every Final Season holder in the game, so a second holder that sets its own fog takes the boost away from the first; they are also never cleared when the holder leaves.",
});
