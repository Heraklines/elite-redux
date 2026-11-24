/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 5. Tier A calc-modifier. "While the game decides a move's type, if the rule holds, change it to a set type"
// (Electrodynamics: a Normal move becomes Electric, like Galvanize, unless an -ate ability or a Tera rule takes it first).
//
// Source: fakemon-pitch-raichu.ts ElectrodynamicsGalvanizeAbAttr (extends MoveTypeChangeAbAttr, dispatched as MoveTypeChangeAbAttr
// from Pokemon.getMoveType). No code of its own; the constructor handed the parent
//   newType = PokemonType.ELECTRIC, condition = (user, _target, move) => canElectrodynamicsConvert(move, user)
// and the parent does the work:
//   canApply  `this.condition(pokemon, opponent, move)`   (the ONE condition, ctor:1; there is no guard)
//   apply     `moveType.value = this.newType`
// Clause breakdown of canElectrodynamicsConvert (fakemon-pitch-raichu.ts), in the original order:
//   1. `move.type !== NORMAL`                        the move's OWN type is Normal                       -> false when not
//   2. `noAbilityTypeOverrideMoves.has(move.id)`     the move is one no ability may retype (Weather Ball, Judgment, Revelation Dance,
//                                                    Multi-Attack, Terrain Pulse, Natural Gift, Techno Blast, Hidden Power) -> false
//   3. `!user.isTerastallized`                       a normal holder: the answer is `!usesAtePriority(user)`
//   4. terastallized: Tera Blast -> false; Tera Starstorm with a Stellar tera type on a Terapagos -> false
//   5. otherwise `!usesAtePriority(user)`            usesAtePriority = holds Aerilate, Pixilate or Refrigerate (hasAbility)
// All of it is pure. As one tree: all[ type Normal (own, not after ability changes), may-be-retyped, not any[ate abilities],
//   not all[ terastallized, any[ is-move Tera Blast, all[ is-move Tera Starstorm, tera type Stellar, species Terapagos ] ] ] ].
// The closure is a LEGACY binding until the four atoms of R-B14-5.4 to R-B14-5.7 exist (may-be-retyped, terastallized, tera type,
// species); the planned tree is checked against the original in B14/chunk5.test.ts. Nothing is random.
// Class edit (pure move of code): the new type and the condition are constructor arguments with the old values as defaults.
import { ElectrodynamicsGalvanizeAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(ElectrodynamicsGalvanizeAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-type",
  label: "Change my move's type (Electrodynamics Galvanize style)",
  summary: params =>
    `A Normal move I use becomes ${params.type} type, unless an -ate ability or a Tera rule takes it first. Example: Normal moves become Electric, like Galvanize.`,
  synonyms: [
    "galvanize",
    "electrodynamics",
    "normal to electric",
    "ate ability",
    "convert move type",
    "retype normal moves",
    "type conversion",
  ],
  examples: ["Normal moves become Electric, with Aerilate, Pixilate and Refrigerate going first, like Electrodynamics"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "newType",
      control: "select",
      label: "Type the move becomes",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [
    // ctor:1 = canElectrodynamicsConvert. Legacy until the atoms of R-B14-5.4 to R-B14-5.7 exist.
    { slot: "ctor:1", ctx: "attack", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.change-move-type", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "I use a Normal move", axes: { foeMove: ["TACKLE"] } }],
  l2StaticReason:
    "The condition binding is a legacy closure (four library atoms are missing), so the twin has no rebuilt attr to compare; B14/chunk5.test.ts compares the closure with a literal copy of the original rule over normal, Tera and -ate states and with the tree requested for the library.",
  status: "decomposed",
  notes:
    "Tier A calc-modifier; the effect is the library change-move-type (the parent's `moveType.value = newType`). The ONE closure is a legacy binding: existing atoms cover `move.type` (own type, effective=false), the -ate abilities (has-ability), and the two Tera moves (is-move); the missing ones are `move.ability-can-change-type` (R-B14-5.4), `mon.terastallized` (R-B14-5.5), `mon.tera-type` (R-B14-5.6) and `mon.species` (R-B14-5.7). Users (1): Electrodynamics (6062) attr 4; attr 5 is the power rider of the same rule. Oddities, not fixed: (1) clause 1 reads the move's own type (`move.type`), not `getMoveType`, so a move that another ability already retyped is not converted again, which is the intended -ate precedence; (2) the Tera Starstorm exception depends on the species Terapagos, so a different Pokemon with a Stellar tera type still converts it. The ability-level conditions are none.",
});
