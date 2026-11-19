/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 2 / calc modifier, Tier C with typed params. See ../PRECEDENTS.md.
//
// Constructor `(defenderType: PokemonType, allowedMoveTypes: readonly PokemonType[])`, `super(false)`. Dispatched from ONE engine
// place, Pokemon.checkIgnoreTypeImmunity (pokemon.ts), once per defender type while the type chart is read:
//   `applyAbAttrs("IgnoreTypeImmunityAbAttr", { pokemon: source, cancelled, simulated, moveType, defenderType })`
// but only when `ignoreSourceAbility` is false, and AFTER the "exposed" battler tags (Foresight, Odor Sleuth) have already said yes.
// In its original order:
//   canApply  `!cancelled.value && this.defenderType === defenderType && this.allowedMoveTypes.includes(moveType)`
//             `!cancelled.value` is the shared "already decided" check (feasibility). The other two tests compare the engine's
//             (defender type, move type) pair with the two fields: they are the SETTINGS of the class, not closures, so they are
//             params here ("which type is normally immune", "which move types may hit it").
//   apply     `cancelled.value = true`  -> the effect (the type immunity is ignored for this pair).
// The WHEN `calc.ignore-type-immunity` only provides `holder`, not the pair, so no library atom could read it; the params are
// the honest form.
import { IgnoreTypeImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(IgnoreTypeImmunityAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.ignore-type-immunity",
  label: "My moves hit a type that is normally immune",
  summary: params =>
    `My ${params.moveTypes} moves hit ${params.immuneType}-type Pokemon even though they are normally immune. Example: Normal and Fighting moves hit Ghost types.`,
  synonyms: [
    "scrappy",
    "mind's eye",
    "hit ghost types",
    "ignore type immunity",
    "normal hits ghost",
    "get past an immunity",
    "ghost immunity ignored",
  ],
  examples: [
    "Normal and Fighting moves hit Ghost types, like Scrappy",
    "Ghost moves hit Normal types, like Phantom Pain",
  ],
  params: [
    {
      id: "immuneType",
      ctorIndex: 0,
      path: "defenderType",
      control: "select",
      label: "Type that is normally immune",
      editable: true,
      default: "GHOST",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "moveTypes",
      ctorIndex: 1,
      path: "allowedMoveTypes",
      control: "text",
      label: "Move types that can hit it (comma separated)",
      editable: true,
      default: "NORMAL,FIGHTING",
      options: TYPE_OPTIONS,
      codec: enumListCodec(PokemonType, "type"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Does nothing when the immunity was already ignored by something earlier, and is skipped when the target's ability is being ignored on purpose",
  ],
  // No library effect says "ignore a type immunity"; request R-B07-8 (effect.ignore-type-immunity).
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "a Normal, a Fighting and a Ghost move against a Ghost type",
      axes: { foeMove: ["TACKLE", "SHADOW_BALL"] },
    },
  ],
  l2StaticReason:
    "The dispatch sits inside the type chart (Pokemon.checkIgnoreTypeImmunity) and no scenario of the battle twin asks for the matchup of a Ghost or Normal defender; the engine site is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-2.test.ts for the original, the rebuilt attr and a control.",
  status: "decomposed",
  notes:
    "Tier C with two typed params (the two constructor fields; no closure, so no binding). Users and live values (dump): Scrappy (113, attr 0), Mind's Eye (299, attr 0), Fighting Spirit (5038, attr 2), Blind Rage (5397, attr 0), Qigong (5463, attr 4), Bird of Prey (5704, attr 1), Heartless Style (20008, attr 5): defender Ghost (7), move types Normal and Fighting (0, 1); Extermination Vector (20003, attr 0), Phantom Pain (5188, attr 0) and Soul Devourer (5466, attr 1): defender Normal (0), move type Ghost (7). The archetype dispatcher can also build `new IgnoreTypeImmunityAbAttr(NORMAL, [GHOST])`. The class ignores `simulated`.",
});
