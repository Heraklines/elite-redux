/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  SWAP_CHOICES,
  SWAP_FLAG_CHOICES,
  swapCodec,
  swapFlagCodec,
} from "#data/elite-redux/ability-studio/decl/B08/chunk4-choices";
// B08 chunk 4 / calc-modifier, Tier B. Read from the source (archetypes/defense-stat-swap-on-flag.ts, its parent MovePowerBoostAbAttr in
// ab-attrs.ts, the dispatch Pokemon.getAttackDamage -> applyFilteredAbAttrs("MovePowerBoostAbAttr", { pokemon: source, opponent: this,
// move, power })) and from the live instances of the 5 users. The parent's closure is the constant `() => true` and its multiplier 1, so the
// parent never filtered anything: the two tests that matter used to open `apply` as early returns. canApply is now
// `guards && gate`, in the ORIGINAL order:
//
//   guards   1. there is an opponent                                                   (else nothing happens)
//   gate     2. the move has the configured property: move.hasFlag(opts.flag)         -> atom move.inherent-flag (the move's OWN flag)
//   apply    3. def = opponent.getStat(DEF, false), spdef = opponent.getStat(SPDEF, false); either at most 0 -> nothing
//            4. swap "target-spdef-instead-of-def" and a physical move:  power *= def / spdef
//               swap "target-def-instead-of-spdef" and a special move:   power *= spdef / def
//               swap "target-lower-defense": physical and spdef < def:  power *= def / spdef; special and def < spdef: power *= spdef / def
//   (no random draw; the stats are the raw stats WITHOUT stat stages, as the original read them)
//
// The property decides which moves are changed and is the gate; it is not editable here (staff change the IF block). The swap mode is only
// read by apply and is editable. The mode's own category tests (physical, special) belong to the mode's formula and stay in the effect.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { DefenseStatSwapOnFlagAbAttr } from "#data/elite-redux/archetypes/defense-stat-swap-on-flag";

export default defineDecl(DefenseStatSwapOnFlagAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Make my moves hit a different defense stat of the foe",
  summary: params => {
    const mode = String(params.swap);
    return `${String(params.flag)} I use are changed so that ${mode.charAt(0).toLowerCase()}${mode.slice(1)}. The move's power is scaled by the ratio of the foe's two defenses.`;
  },
  synonyms: [
    "power fists",
    "power edge",
    "roundhouse",
    "soul crusher",
    "kyokushin",
    "hit the weaker defense",
    "target special defense with physical moves",
    "psyshock",
    "defense swap",
  ],
  examples: [
    "My punching moves hit the foe's Sp. Def instead of Defense like Psyshock",
    "My kicking moves always hit the foe's weaker defense",
  ],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "opts",
      control: "select",
      label: "Property of the moves that are changed (set by the conditions)",
      // The property IS the gate (each user's binding spells it out), so changing it here would not change the compiled rule.
      editable: false,
      default: "Punching moves",
      options: SWAP_FLAG_CHOICES,
      codec: swapFlagCodec,
    },
    {
      id: "swap",
      ctorIndex: 0,
      ctorOption: "swap",
      path: "opts",
      control: "select",
      label: "Which defense stat the changed moves hit",
      editable: true,
      gateIndependent: true,
      default: SWAP_CHOICES[0],
      options: SWAP_CHOICES,
      codec: swapCodec,
    },
  ],
  conditions: [
    // The gate is [move.inherent-flag F] (bindings.ts): the move has the configured property.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["There must be an opponent to compare", "Both of the foe's defense stats must be above 0"],
  effect: { id: "effect.package", params: ["swap"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", rngOrder: [], state: "none", simulated: "respects" },
  probes: [
    {
      // A punching, a kicking, a hammer-style and a plain move, so the property test is both true and false.
      name: "moves with and without the property",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "EARTHQUAKE"] },
    },
  ],
  l2StaticReason:
    "The shared L2 harness cannot show the move-power hook evaluated (decomp-l2-reach.json lists calc.move-power as unreached: the engine never evaluated a MovePowerBoostAbAttr attr of the holder during the trace). The B08 test (test/tests/elite-redux/decomp/B08/chunk4-gates.test.ts) compares the frozen original canApply plus apply, the refactored attr and the rebuilt library gate for every live user over every registered move, with real Pokemon of different Defense and Sp. Def.",
  status: "decomposed",
  notes:
    "Tier B split by hand: the two early returns that opened `apply` (no opponent; the move lacks the property) are the guard and the replaceable gate now, and apply keeps only the stat arithmetic (a pure move of code: when apply was reached, the attr had already been asked canApply, which was the parent's constant true, so the engine saw the same result). The existing unit test defense-stat-swap-lower.test.ts called apply directly; it now asks canApply first, like the engine does. The EFFECT is a package PLACEHOLDER with the typed setting `swap`: written reason: no library effect scales a move's power by a ratio of the foe's own stats (effect.multiply-power takes a fixed number); the formula needs the foe's raw Defense and Sp. Def at the moment of the hit. Request R-B08-39 asks for `effect.scale-power-by-defense-ratio` with the three modes. It cannot be split further without inventing a library effect. Users (5, all bound): Power Fists (5011, attr 1, Punching moves, Physical moves hit Sp. Def instead of Defense), Soul Crusher (5349, attr 0, Hammer moves, same swap), Power Edge (5362, attr 0, Slicing moves, same swap), Roundhouse (5139, attr 1, Kicking moves, lowest defense) and Kyokushin (6089, attr 1, Kicking moves, lowest defense). The gate is move.hasFlag, not doesFlagEffectApply (the class never asked the engine's flag rule), so the atom is move.inherent-flag. SUSPECTED ODDITIES, NOT FIXED: (1) the class mutates the power holder of EVERY dispatch of MovePowerBoostAbAttr, which the fixed-damage path also uses, but appliesToFixedDamage() is false, so that path filters the class out; (2) the ratio uses raw stats without stat stages while the real damage formula uses staged stats, so the 'same final damage' claim in the class comment holds only at +0; (3) 'target-def-instead-of-spdef' is not used by any live ability. showAbility is false (the parent's argument).",
});
