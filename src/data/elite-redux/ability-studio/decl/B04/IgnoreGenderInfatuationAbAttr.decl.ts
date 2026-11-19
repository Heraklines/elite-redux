/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 4 / Tier C while-active flag, no setting, no closure (Beautiful Music).
//
// Class (ab-attrs.ts:4389): `constructor() { super(false) }` and `apply(_params) {}`. Never dispatched; a PRESENCE marker.
// Reader: InfatuatedTag.canAdd (src/data/battler-tags.ts:1234). Clause order there: the fairy-blessing biome rule blocks the tag, the
// source Pokemon must still be known, THEN `source.hasAbilityWithAttr("IgnoreGenderInfatuationAbAttr")` answers true (skipping the gender
// test), else `pokemon.isOppositeGender(source)`. The marker is read on the SOURCE of the infatuation (the Pokemon that causes it), not on
// the victim. Only the gender requirement is lifted: the biome rule and the missing-source check still run first.
// No RNG, no `simulated` read.
import { IgnoreGenderInfatuationAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(IgnoreGenderInfatuationAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "My infatuation works on any gender",
  summary: () =>
    "While I have this, infatuation I cause ignores gender: it can land on same-gender and genderless foes. Example: a male user can charm a male or genderless foe.",
  synonyms: [
    "beautiful music",
    "attract any gender",
    "infatuate everyone",
    "ignore gender",
    "charm anyone",
    "cute charm",
  ],
  examples: ["My infatuation lands on foes of any gender, like Beautiful Music"],
  params: [],
  noParamsReason:
    "A pure presence flag: the game only checks that it exists when it decides whether an infatuation can be applied, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only lifts the gender rule: the infatuation still needs a source and is still blocked in a fairy-blessed biome",
    "Counts on the Pokemon that causes the infatuation, not on the one it lands on",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "an infatuation from the holder onto a same-gender foe", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the shared twin only compares a generic battle with no infatuation. b04-chunk4.test.ts proves it with real battles: the holder uses Attract on a same-gender foe, original ability against its rebuilt shadow, plus a control without the flag.",
  status: "decomposed",
  notes:
    "Flag, presence only. User (live dump, 1 attr): Beautiful Music (id 5326, attr 1, after a 50% infatuate-on-sound-move ChanceBattlerTagOnAttackAbAttr). Read by InfatuatedTag.canAdd on the source Pokemon.",
});
