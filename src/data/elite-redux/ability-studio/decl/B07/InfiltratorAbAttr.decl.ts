/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 2 / calc modifier (a bypass check), Tier C. See ../PRECEDENTS.md.
//
// The class has no constructor argument (`constructor() { super(false) }`), no closure and no field. It is dispatched from four
// engine places, each of them "does the attacker get past this protection?":
//   - Pokemon.isSafeguarded (pokemon.ts):            `applyAbAttrs("InfiltratorAbAttr", { pokemon: attacker, bypassed })`
//   - Move.hitsSubstitute (move.ts):                 same call with the user (the code says TODO allow simulating)
//   - the stat-drop shield Mist (arena-tag.ts):      same call with the source, passing `simulated`
//   - the damage-weakening screens (arena-tag.ts):   same call with the attacker (Light Screen, Reflect, Aurora Veil)
// In its original order:
//   canApply  `!bypassed.value`  -> the shared "already decided" check of the cancel family (feasibility, not a staff condition)
//   apply     `bypassed.value = true`  -> the effect (this attacker's move gets past the protection being asked about)
import { InfiltratorAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(InfiltratorAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.infiltrate",
  label: "My moves bypass screens, Substitute, Safeguard and Mist",
  summary: () =>
    "My moves ignore the foe's Light Screen, Reflect, Aurora Veil, Safeguard, Mist and Substitute. Example: my Tackle still hits a Pokemon hiding behind a Substitute.",
  synonyms: [
    "infiltrator",
    "ignore screens",
    "bypass substitute",
    "ignore reflect and light screen",
    "ignore safeguard",
    "ignore mist",
    "get past barriers",
  ],
  examples: ["My moves ignore Reflect, Light Screen and Substitute, like the classic screen-ignoring ability"],
  params: [],
  noParamsReason:
    "A fixed rule with nothing to choose: every protection listed is bypassed. The class has no constructor argument (showAbility is fixed inside it).",
  conditions: [],
  guards: [],
  feasibility: ["Does nothing when something earlier already decided that the protection is bypassed"],
  // No library effect says "get past the foe's protections" (effect.negate would read as "Block it"); request R-B07-7.
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "Safeguard, Substitute, Mist and a screen are checked for the holder", axes: {} }],
  l2StaticReason:
    "The attr is asked when the HOLDER attacks into a protection (Substitute, Safeguard, Mist, a screen), which the shared twin scenarios never set up; the engine sites are driven directly in test/tests/elite-redux/decomp/B07/flag-sites-2.test.ts for the original, the rebuilt attr and a control.",
  status: "decomposed",
  notes:
    "Tier C. Users (live dump): Infiltrator (151, attr 0), Marine Apex (5127, attr 0), Duality (5725, attr 0), King of the Jungle (5729, attr 0), Thundercall (5126, attr 1), Current Crash (5708, attr 2), Thunder Gods Vessel (20005, attr 7) and Malicious Empathy (20006, attr 7); showAbility false for all (the class fixes it). No closure, so no binding. The effect is 'package' until request R-B07-7 gives the library an effect that says what happens. The attr ignores `simulated` itself; the Mist call passes it and Substitute does not (an engine TODO). NOTE for staff: the whole set is bypassed together; there is no way to bypass only Substitute with this class. The ER move flag IGNORE_SUBSTITUTE is a separate mechanism.",
});
