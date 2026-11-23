/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 2 / event-effect (Tier B: "my last move was Electric" is the gate inside canApply).
//
// Read by hand from archetypes/recharge-on-electric-terrain.ts and PostVictoryAbAttr in ab-attrs.ts. PostVictory hook (WHEN "when I win
// the fight": FaintPhase dispatches it for the Pokemon whose direct attack landed the knock out), no constructor of its own.
//   canApply is now `gate && residual`, in the ORIGINAL clause order:
//     1. gate, CONDITION (two tests in one expression):
//          `last = pokemon.getLastXMoves(1)[0]`; `last !== undefined && allMoves[last.move]?.type === PokemonType.ELECTRIC`
//        that is, the holder's most recent move exists and its PRINTED type (the move's own type, not the type after ability changes) is Electric
//     2. residual, feasibility: `pokemon.canAddTag(BattlerTagType.CHARGED)`   (the holder can take the Charged state)
//   apply: not when simulated. `pokemon.addTag(CHARGED, 0)`. No random draw, no message of its own.
//
// Clause 1 is the condition staff would change ("after a Water-type KO", "after any KO"). The library has no atom for "my last move was a
// {type}-type move": move.type reads the move slot, which this trigger does not have, and time.last-move names one move, not a type (request
// R-B11-C2-12). The gate is therefore a legacy closure for now. The effect is effect.apply-tag with a fixed tag (Charged); the tag and duration
// are not settings because the class has no constructor argument for them (request R-B11-C2-11).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { RechargeChargedOnElectricKoAbAttr } from "#data/elite-redux/archetypes/recharge-on-electric-terrain";

export default defineDecl(RechargeChargedOnElectricKoAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-win",
  label: "Become charged after an Electric move knocks out a foe",
  summary: () =>
    "When my direct attack knocks out a foe and my last move was an Electric-type move, I become charged: my next Electric move does double damage. Example: Energized.",
  synonyms: [
    "energized",
    "charge after electric ko",
    "recharge on knock out",
    "electric ko charge",
    "double the next electric move",
  ],
  examples: ["Get charged up again when an Electric move knocks out a foe"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the Charged state and its duration (until used) and the Electric type of the last move are fixed in the class. The type test is the condition block, not a setting. Staff cannot change them until the class takes them as arguments (request R-B11-C2-11).",
  conditions: [
    // "My last move was an Electric-type move" (a legacy closure for now, see the header).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["I must be able to take the Charged state (it cannot be added twice)", "Never in a preview"],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a knock out at full HP and at half HP", axes: { hp: ["max", "50%"] } }],
  l2StaticReason:
    "The shipped gate is a legacy closure (the last-move-type test has no library atom, request R-B11-C2-12), so the shared twin cannot rebuild it, and no L2 scenario makes the holder knock a foe out with an Electric move (its moves are Celebrate, Tackle, Swords Dance and Double Slap). test/tests/elite-redux/decomp/B11/chunk2.test.ts drives the original and the rebuild (with the shipped gate handed in) with an Electric, a non-Electric and no previous move.",
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Only user: Energized (5402, attr 2), whose attr 0 charges on entry and attr 1 on Electric Terrain. The gate is bound as a legacy closure. Remark, NOT fixed: the test uses the move's own printed type (`allMoves[...].type`), so a move turned Electric by an ability does not count, and a printed-Electric move turned into another type does.",
});
