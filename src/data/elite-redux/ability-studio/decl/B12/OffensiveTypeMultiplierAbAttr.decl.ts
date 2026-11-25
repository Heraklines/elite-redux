/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 4. "My moves get more power against Pokemon of one type" (Dragonslayer, Fae Hunter, Firefighter, Lumberjack, Monster Hunter, King of the Jungle).
//
// Source: src/data/elite-redux/archetypes/type-effectiveness-mod.ts, OffensiveTypeMultiplierAbAttr (extends MovePowerBoostAbAttr).
// Constructor: `(targetDefenderType, multiplier)`; it throws for a multiplier that is not above 0. It hands the parent the closure
// `defenderIsOfType(opponent, type)` and showAbility off. Dispatched while a move's power is calculated
// (applyAbAttrs("MovePowerBoostAbAttr")). Clauses, in the original order (Tier B):
//   canApply  the DEFENDER is of the configured type (`opponent.isOfType(type)`, Tera type included)   GATE (replaceable), the whole old canApply
//   apply     `power *= multiplier` (the parent's apply; the product is not rounded)                  EFFECT (calc)
// No random draw, no state, no `simulated` test (the result is only the power value).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { OffensiveTypeMultiplierAbAttr } from "#data/elite-redux/archetypes/type-effectiveness-mod";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(OffensiveTypeMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Make my moves stronger against one type of Pokemon",
  summary: params =>
    `My moves get ${params.multiplier} times their power against ${params.type}-type Pokemon. Example: 1.5 against Dragon types, like Dragonslayer.`,
  synonyms: [
    "bonus against a type",
    "hit one type harder",
    "type hunter",
    "slayer",
    "stronger against dragons",
    "dragonslayer",
    "fae hunter",
    "firefighter",
    "lumberjack",
    "monster hunter",
    "king of the jungle",
  ],
  examples: [
    "My moves get 1.5 times their power against Dragon types, like Dragonslayer",
    "My moves get 1.5 times their power against Fire types, like Firefighter",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "targetDefenderType",
      control: "select",
      label: "The foe's type that my moves hit harder",
      editable: true,
      default: "DRAGON",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.5 = 50% stronger)",
      editable: true,
      // Only the effect reads it; the gate (the foe's type) never repeats it.
      gateIndependent: true,
      default: 1.5,
    },
  ],
  // The type setting is the same value as the gate's type: moving the setting moves the compiled gate's type.
  gateParams: [{ param: "type", block: "mon.has-type", field: "type" }],
  conditions: [
    // The gate: the foe (the other Pokemon of "while the game calculates a move's power") is of the type.
    { slot: "gate", ctx: "params", lib: "mon.has-type", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Moves that deal fixed damage are not changed by a power boost"],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // The shared grid already puts the foe through Fire, Grass/Poison, Ground, Dragon and Dark/Steel; the probe adds nothing to HP.
      name: "foe types in the shared grid",
      axes: {},
    },
  ],
  l2StaticReason:
    "The shared L2 reports calc.move-power as unreached (it is dispatched under VariableMovePowerAbAttr, see R-B12-19) although the twins are identical; B12's own test (B12/chunk4.test.ts) runs the class on the original and the rebuild for every foe type, with and without Terastallization.",
  status: "decomposed",
  notes:
    "Tier B, 6 attrs, every gate bound to mon.has-type { who: other }: Dragonslayer (5051 attr 0, Dragon x1.5), Fae Hunter (5178 attr 0, Fairy x1.5), Lumberjack (5181 attr 0, Grass x1.5), Monster Hunter (5255 attr 0, Dark x1.5), Firefighter (5505 attr 0, Fire x1.5), King of the Jungle (5729 attr 1, Grass x1.5). The old canApply was the closure the constructor hands to the parent; the gate method now holds the same test (`opponent?.isOfType?.(type) === true`, vanilla isOfType defaults so a Tera type counts) and the closure calls the same helper, so the class is the single source of behaviour. The defensive half of the same archetype (buildTypeEffectivenessModAttrs) is a separate ReceivedTypeDamageMultiplierAbAttr and is another block. Oddities, not fixed: (a) the multiplied power is not rounded; (b) fixed-damage moves are not boosted because appliesToFixedDamage() is false; (c) the ability banner is hidden; (d) a foe whose type is changed by an ability or a move (Soak, Forest's Curse) counts as the new type.",
});
