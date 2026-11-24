/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / while-active flag. See ../PRECEDENTS.md.
//
// No behaviour in the class. `Pokemon.canApplyAbility` (pokemon.ts:3835) switches off a Pokemon's suppressable ability when
//   !ignoreMentalPollution && ability.suppressable && this.isOnField()
//   && !this.hasActiveMentalPollution()                                         (the holder is self-exempt)
//   && getField(true).some(p => p !== this && p.getTag(ER_ENRAGE) != null && p.hasActiveMentalPollution())
// so the condition "the holder is enraged" is written in the engine (an `ER_ENRAGE` battler tag check), not in the class.
// `hasActiveMentalPollution` re-reads the flag through the ordinary source gates but skips this very field rule,
// which stops two holders from asking each other forever.
import { SuppressFieldAbilitiesWhenEnragedAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SuppressFieldAbilitiesWhenEnragedAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Switch off other Pokemon's abilities while I am enraged",
  summary: () =>
    "While I am enraged, every other Pokemon on the field (foes and allies) has its abilities switched off for as long as it stays out. I keep my own ability.",
  synonyms: [
    "mental pollution",
    "suppress abilities",
    "ability suppression",
    "neutralizing gas",
    "gastro acid",
    "silence abilities",
    "enrage",
  ],
  examples: ["Everyone else loses their ability while I am enraged, like Mental Pollution"],
  params: [],
  noParamsReason:
    "A pure presence flag: the ability check only asks whether an enraged Pokemon on the field has it, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "It only starts once I am enraged, and it ends when I stop being enraged (for example when I switch out) or when the other Pokemon leaves the field",
    "Abilities that cannot be suppressed (the ones Neutralizing Gas also cannot switch off) stay on",
    "It stops working while the holder's own ability is itself suppressed or the holder has fainted",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "an enraged holder and a foe with an ability", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The ability check (Pokemon.canApplyAbility) is driven directly in test/tests/elite-redux/decomp/B05/flag-sites.test.ts with the enrage tag added and removed.",
  status: "decomposed",
  notes:
    "While-active flag, Tier C. User: Mental Pollution (attr 0, its only attr: the ability has no way to enrage itself, so it only works when something else enrages the holder). Nothing to bind. The IF 'I have the enrage tag' (library atom tag.has ER_ENRAGE) and the DO 'switch off the abilities of others' both live in the engine check, so they cannot be separated until the engine reads the flag through a conditional hook (requests/B05.md, R-B05-5). Observation (not fixed): the field rule only looks at p.getTag(ER_ENRAGE) on the holder, so the suppression follows the TAG, not the 'enraged' status text, and a holder that was enraged by a foe also triggers it.",
});
