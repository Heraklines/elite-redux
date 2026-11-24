/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 3, Tier B event-effect. "After I am hit, IF the attacker is another Pokemon AND the move deals damage AND (optionally)
// its type is <type>, I gain a battle effect (Charged)."
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over PostDefendAbAttr (constructor `(tag, moveType?)`, showAbility false).
// Dispatch: applyAbAttrs("PostDefendAbAttr", { pokemon: holder, opponent: attacker, move, damage, hitResult, simulated }) in move-effect-phase.
//   canApply, in the ORIGINAL clause order (now gate && residual, every clause a pure read, no random draw):
//     gate 1    pokemon !== opponent                                           -> condition (not: library atom side.is, kind self)
//     gate 2    move.category !== STATUS                                       -> condition (library atom move.damaging)
//     gate 3    moveType === undefined || opponent.getMoveType(move) === moveType
//                                                                              -> condition (library atom move.type, effective: true)
//     residual  !pokemon.getTag(tag)                                           -> feasibility: I do not carry the effect yet
//   apply     unless simulated: pokemon.addTag(tag) (turn count 0, no source move). No random draw.
// The "I do not have it yet" clause stays in the residual: it is the effect's own precondition (adding an effect that is already
// there does nothing). All three gate clauses are separate blocks, and `moveType` is repeated in the gate binding (gateParams).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PostDefendAddTagAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(PostDefendAddTagAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Get a battle effect after another Pokemon damages me",
  summary: params =>
    `After a damaging ${params.moveType}-type move from another Pokemon hits me, I get the battle effect ${params.tag} (if I do not have it yet). Example: Electric hits charge me.`,
  synonyms: [
    "charge when hit by electric",
    "get charged after a hit",
    "power up when hit",
    "gain an effect when hit",
    "lightning born",
    "electromorphosis for one type",
  ],
  examples: [
    "Become Charged when an Electric move hits me, like Lightning Born",
    "Gain a battle effect whenever another Pokemon damages me",
  ],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      path: "tag",
      control: "select",
      label: "Battle effect I gain (Charged: my next Electric move is twice as strong)",
      // Not editable: the class gives the effect with no turn count and no source, which is only right for a lasting effect
      // such as Charged; a timed effect (Taunt, Encore ...) would end at once. Request R-B18-28 asks for a curated list.
      editable: false,
      default: "CHARGED",
      options: ["CHARGED"],
    },
    {
      id: "moveType",
      ctorIndex: 1,
      path: "moveType",
      control: "select",
      label: "Only moves of this type give it",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  // The gate is all[not side.is self, move.damaging, move.type {type, effective: true}], in the class's own order (see bindings.ts).
  gateParams: [{ param: "moveType", block: "move.type", field: "type" }],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Nothing happens if I already have the battle effect",
    "Nothing happens when the game only previews the hit",
  ],
  effect: { id: "effect.apply-tag", params: ["tag"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "an Electric hit, a Normal hit and a sound hit",
      axes: { foeMove: ["THUNDER_SHOCK", "TACKLE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package: every gate clause maps to a library atom and the effect is the library's apply-tag. User (1 attr): Lightning Born (5548 attr 1, Charged, Electric). Binding: all[not side.is self, move.damaging, move.type {ELECTRIC, effective true}]. `side.is self` is `other === holder` (the class tests `pokemon !== opponent`; the atom answers false without an `other`, so its negation is true, the same as `pokemon !== undefined`). `move.type` with `who` of the attacker is `opponent.getMoveType(move)`. Class change (pure move, no behaviour change): gateOverride field, canApply = gatedCanApply, gate = clauses 1 to 3, residual = clause 4. The `tag` setting is shown but not editable (a timed effect added with turn count 0 would end at once); the `moveType` argument is optional in the class (undefined = any type); the setting offers every type, and an 'any type' rule is built by removing the move.type block. The ability user passes ELECTRIC. Different from B01's PostDefendApplyBattlerTagAbAttr (its condition is a constructor closure, it shows the message, and its 'already has it' test is in apply). No oddity found.",
});
