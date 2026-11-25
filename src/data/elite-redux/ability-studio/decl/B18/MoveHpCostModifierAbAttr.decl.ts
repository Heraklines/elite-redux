/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Shed Skin (Tier C, marker). "While I have this, the listed substitute-making moves cost me a different share of max HP".
//
// Source: ability-upgrades/attrs/move-hp-cost.ts (constructor: moveIds list, replacementFraction; showAbility false).
// Nothing is dispatched. The ONLY reader is `getMoveHpCostFraction(user, move, baseFraction)` (same file), called by
// AddSubstituteAttr.getHpCost (data/moves/move.ts:2745) for Substitute and Shed Tail: it walks `getAllActiveAbilityAttrs()` and, for
// every marker whose list contains the move, REPLACES the fraction (the last matching marker wins; it does not multiply).
// The cost is then `ceil` (Shed Tail) or `toDmgValue` (Substitute) of maxHp * fraction. Note that the marker's own `getCondition` is
// NOT consulted by this reader (unlike the meta-markers), so an attr-level condition does nothing here.
import { MoveHpCostModifierAbAttr } from "#data/elite-redux/ability-upgrades/attrs/move-hp-cost";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MoveId } from "#enums/move-id";

const moveNames = enumListCodec(MoveId, "move");

/** The class keeps the list as a Set, so the live value is read back through its members. */
const moveSetCodec: ParamCodec = {
  toCtor: moveNames.toCtor,
  fromInstance: raw => (raw instanceof Set ? moveNames.fromInstance([...raw]) : moveNames.fromInstance(raw)),
};

export default defineDecl(MoveHpCostModifierAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Change how much HP a substitute move costs me",
  summary: params =>
    `While I have this, ${params.moves} costs me ${Math.round(Number(params.fraction) * 100) / 100} of my max HP instead of the usual share. Example: 0.33 is a third.`,
  synonyms: ["shed skin", "cheaper substitute", "shed tail cost", "hp cost", "substitute cost", "less hp to make a decoy"],
  examples: ["Shed Tail only costs a third of my max HP, like Shed Skin"],
  params: [
    {
      id: "moves",
      ctorIndex: 0,
      path: "moveIds",
      control: "text",
      label: "Moves whose cost changes (comma separated; only Substitute and Shed Tail pay an HP cost)",
      editable: true,
      gateIndependent: true,
      default: "SHED_TAIL",
      options: ["SUBSTITUTE", "SHED_TAIL"],
      codec: moveSetCodec,
    },
    {
      id: "fraction",
      ctorIndex: 1,
      path: "replacementFraction",
      control: "number",
      min: 0.01,
      max: 1,
      step: 0.01,
      label: "New cost (share of max HP: 0.25 = a quarter, 0.33 = a third)",
      editable: true,
      gateIndependent: true,
      default: 1 / 3,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only the moves that make a substitute (Substitute, Shed Tail) ask for this cost",
    "If several of my abilities change the same move's cost, the last one wins",
  ],
  effect: { id: "effect.package", params: ["moves", "fraction"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a plain battle with the marker on the holder", axes: {} }],
  l2StaticReason:
    "The marker is never dispatched; AddSubstituteAttr reads it by name (getMoveHpCostFraction), which no L2 template reaches. B18/meta-markers.test.ts calls the reader for Shed Tail, Substitute and an unlisted move.",
  status: "decomposed",
  notes:
    "PACKAGE (marker), justified: no behaviour in the class (base no-ops); a replacement number that getMoveHpCostFraction asks for by name. The library has no effect that changes a move's HP cost, so the effect is the package and the request is R-B18-9 (effect 'Change a move's HP cost'). `if` is false because the only reader never calls getCondition, so an IF would silently do nothing (a library atom would have to be honoured by that reader first). Both settings are typed: the move list through a codec over the move enum (read back from the class's Set), the fraction as a number from 0.01 to 1. Users: Shed Skin (61, attr 1): [Shed Tail], 1/3. ODDITY (not fixed): the list accepts any move, but only Substitute and Shed Tail ever read it, so naming another move silently does nothing; the picker lists only those two.",
});
