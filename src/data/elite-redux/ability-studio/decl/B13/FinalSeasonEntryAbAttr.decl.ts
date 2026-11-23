/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Final Season, part 1 of 3 (Tier B, event-effect). "When I switch in on purpose, every foe moves last for 2 turns."
//
// Source: abilities/newcomer-signature-mechanics.ts, FinalSeasonEntryAbAttr (PostSummonAbAttr).
//   canApply  one clause: the holder is in the VOLUNTARY_ENTRY set. markGenuineVoluntaryEntry() adds it from
//             SwitchSummonPhase when the switch type is SWITCH and the turn command was a party command.
//             -> the gate. No library atom for "came in by a deliberate switch" exists: legacy-closure + request
//             `entry.voluntary-switch-in` (requests/B13.md).
//   apply     1. VOLUNTARY_ENTRY.delete(holder)            (even when simulated)
//             2. simulated: stop
//             3. every opponent gets the ER_QUASHED tag for 2 turns (source move NONE, source id = holder)
//             4. a message
//             5. the holder is armed for the end-of-turn fog (FINAL_SEASON_PENDING_FOG), read by FinalSeasonFogAbAttr
//   Constructor (added in the review fix, defaults = the old literals): quashTag (ER_QUASHED), quashTurns (2).
//   No RNG. The effect is "apply a battle effect to every foe", an existing effect block (effect.apply-tag).
import { FinalSeasonEntryAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { BattlerTagType } from "#enums/battler-tag-type";

// Player-facing names for the battle effect put on the foes. Only effects whose meaning matches the label
// ("make foes move last") are offered, so the label and the setting cannot contradict each other.
const FOE_EFFECT_CHOICES: Record<string, BattlerTagType> = {
  "Move last (Quash-like)": BattlerTagType.ER_QUASHED,
};

export default defineDecl(FinalSeasonEntryAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Make foes move last when I switch in on purpose",
  summary: params =>
    `When I switch in on purpose, every foe gets the effect "${params.tag}" for ${params.turns} turns (it moves last in its priority group), and my end-of-turn weather effect is made ready.`,
  synonyms: ["quash", "move last", "slow the foes", "delay the opponent", "switch in debuff", "final season"],
  examples: ["Foes move last for 2 turns when I am switched in by choice"],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      path: "quashTag",
      control: "select",
      label: "Effect put on every foe",
      editable: true,
      gateIndependent: true,
      default: "Move last (Quash-like)",
      options: Object.keys(FOE_EFFECT_CHOICES),
      codec: {
        toCtor: value => {
          const resolved = FOE_EFFECT_CHOICES[String(value)];
          if (resolved === undefined) {
            throw new Error(`"${String(value)}" is not a known effect for foes`);
          }
          return resolved;
        },
        fromInstance: raw => Object.keys(FOE_EFFECT_CHOICES).find(name => FOE_EFFECT_CHOICES[name] === raw),
      },
    },
    {
      id: "turns",
      ctorIndex: 1,
      path: "quashTurns",
      control: "number",
      label: "Turns the effect lasts",
      editable: true,
      gateIndependent: true,
      default: 2,
      min: 1,
      max: 10,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // The one clause of canApply. Legacy closure until the librarian adds the atom (see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.apply-tag", params: ["tag", "turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // A battle's first Pokemon is not a deliberate switch, so the gate is false; the deliberate case is in B13/final-season.test.ts.
      name: "entry as the first Pokemon of the battle",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Users: Final Season (5972, attr 0). Gate = VOLUNTARY_ENTRY.has(holder), legacy-closure pending request `entry.voluntary-switch-in`. The effect is one existing block (apply a battle effect to the foes) plus two bookkeeping side effects that ride along in the same apply: the message, and arming FINAL_SEASON_PENDING_FOG, which FinalSeasonFogAbAttr reads at turn end. ODDITY (not fixed): apply deletes the voluntary-entry flag BEFORE its simulated check, so a simulated PostSummon call would spend the flag without doing anything. No engine path simulates PostSummon today. Review fix: the battle effect (ER_QUASHED) and its duration (2) are now trailing constructor arguments with the old values as defaults and are params here. The target (every foe) stays fixed: it is the meaning of the ability, and the message and the arming of the fog ride along in the class.",
});
