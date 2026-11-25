/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 4 / event-effect (Tier B: "I am not bleeding right now" is the gate inside canApply).
//
// Read by hand from archetypes/self-persistent-bleed.ts. PostTurn hook (WHEN "at the end of every turn"), no constructor arguments,
// the default ability banner (showAbility true).
//   canApply is now `gate && residual`, in the ORIGINAL clause order:
//     1. gate:     `!pokemon.getTag(ER_BLEED)`   (CONDITION: tag.has, negated)
//     2. residual: `pokemon.canAddTag(ER_BLEED)` (feasibility: ErBleedTag.canAdd refuses Rock and Ghost types and a holder that
//                  already has another Elite Redux major condition such as Frostbite or Fear)
//   apply: simulated -> nothing. Else `pokemon.addTag(ER_BLEED)` (the tag lasts until it is cured). No random draw.
//
// The effect is "give myself a battle effect", the library effect.apply-tag (it is declared but not implemented in the library yet).
// The class has no constructor argument: the condition kept up is always bleeding. Staff reach other conditions by composing
// the same three blocks (end of turn + "I am not affected by X" + apply a battle effect), so the block has no setting.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SelfPersistentBleedAbAttr } from "#data/elite-redux/archetypes/self-persistent-bleed";

export default defineDecl(SelfPersistentBleedAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Start bleeding again at the end of the turn",
  summary: () =>
    "At the end of every turn, if I am not bleeding, I start bleeding again (Rock and Ghost types cannot bleed). Example: a heal that cures the bleeding is undone at turn end.",
  synonyms: [
    "permanent bleed",
    "always bleeding",
    "reapply bleed",
    "blood stain",
    "keep bleeding",
    "unremovable bleed",
  ],
  examples: [
    "Make this Pokemon bleed again at the end of every turn if it stopped",
    "Always bleeding, even after a cure",
  ],
  params: [],
  noParamsReason:
    "The class has no constructor argument: the condition kept up is always bleeding. The three pieces (end of turn, 'I am not affected by X', 'give myself a battle effect') are separate blocks, so staff reach another condition by composing them; a setting would only repeat the choice of the effect block.",
  conditions: [{ slot: "gate", ctx: "params", lib: "tag.has", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Bleeding must be possible: Rock and Ghost types are immune, and so is a Pokemon that already has another Elite Redux major condition (Frostbite, Fear)",
    "Never in a preview",
  ],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "end of a quiet turn", axes: { hp: ["max", "50%"] } }],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Only user: Blood Stain (5377, attr 1; attr 0 is the summon-time PostSummonAddBattlerTagAbAttr that first applies the tag). The gate is not(tag.has ER_BLEED): `getTag(ER_BLEED)` is undefined or the tag, so `!getTag` and `getTag === undefined` agree. The library effect effect.apply-tag is declared but not implemented, so the effect has no params yet (the tag id is the fixed bleeding). The L1 grid cannot give the holder the tag, so test/tests/elite-redux/decomp/B11/chunk4.test.ts drives canApply and apply for both the original and the rebuild with and without the tag and with a Rock holder.",
});
