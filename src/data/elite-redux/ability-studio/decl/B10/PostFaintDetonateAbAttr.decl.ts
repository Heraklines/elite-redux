/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 4 / package (Tier B).
//
// Read by hand from archetypes/post-faint-detonate.ts. The class extends PreDefendFullHpEndureAbAttr (the Sturdy damage clamp), so it
// is dispatched at the moment the game calculates the damage I take (WHEN calc.damage-taken lists that key). It is NOT a faint hook:
// a fainted Pokemon cannot run a move, so the class keeps the holder alive at 1 HP on a lethal damaging hit and has it use a one-off
// 100 power explosion while briefly alive. Constructor `{ power = 100, flinch = true, type = NORMAL }`, `super()` (banner shown); throws
// when power is not positive. canApply in the ORIGINAL clause order:
//   1. maxHp <= 1 or damage < hp -> false                      gate      (the hit would knock me out; no library atom, R-B10-c4-03)
//   2. ARMED_TURN has the current wave:turn key -> true        residual  (keep enduring the rest of a multi-hit volley)
//      a stale arming key from an earlier turn is deleted      residual  (side effect inside canApply)
//   3. a STURDY tag is already on me -> false                  residual  (do not arm on top of Sturdy / Focus Sash)
//   4. a Damp-class ability is active on the field -> false    residual  (no explosion, so no clamp; FieldPreventExplosiveMovesAbAttr)
// no random draw. apply: when armed this turn (sub-hit): damage = max(0, hp - 1), nothing else. Else super.apply adds the STURDY tag
// (the damage pipeline then clamps this hit to 1 HP); when not simulated the arming key is stored, the attacker's volley is cut so
// this strike is its last (hitCount, hitsLeft), the category is picked (Sp. Atk above Attack = special, else physical) and a
// MovePhase is queued for the holder with a one-off Explosion-id move (power, type, always flinch if flinch, no contact, all adjacent
// targets, self-KO), use mode FOLLOW_UP, timing FIRST.
//
// Clause classification: clause 1 is the trigger's own question ("would this hit knock me out?") and the part staff may want to change
// (for example an explosion on a hit that takes me below a share of HP), so it is the replaceable gate. The multi-hit memory, the
// Sturdy test and the Damp block are safety rules of the mechanic and stay in the class as the residual. The effect is a package: it
// clamps the damage, cuts the attacker's volley, builds a custom move and queues it at the front, as one piece.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PostFaintDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-detonate";
import { PokemonType } from "#enums/pokemon-type";

/** The three settings live inside the one options argument; `ctorOption` names the key. */
const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(PostFaintDetonateAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.damage-taken",
  label: "Survive a knockout hit and explode (like Aftermath)",
  summary: params =>
    `When a hit would knock me out, I stay at 1 HP and use a ${params.power} power ${params.type} blast on every Pokemon next to me, then faint${params.flinch === true ? ". It always flinches them" : ""}. Damp stops it.`,
  synonyms: [
    "aftermath",
    "explode when knocked out",
    "last gasp explosion",
    "self destruct on faint",
    "blast when ko",
    "perish body",
    "unstable core",
  ],
  examples: [
    "When a hit would knock me out, I explode with 100 power on everything next to me, like Aftermath",
    "A Fire type blast with 80 power that does not flinch",
  ],
  params: [
    {
      id: "power",
      ...IN_OPTIONS,
      ctorOption: "power",
      path: "power",
      control: "number",
      min: 1,
      max: 250,
      step: 1,
      integer: true,
      label: "Power of the blast (100 = like Aftermath)",
      editable: true,
      gateIndependent: true,
      default: 100,
    },
    {
      id: "flinch",
      ...IN_OPTIONS,
      ctorOption: "flinch",
      path: "flinch",
      control: "boolean",
      label: "The blast always flinches the Pokemon it hits",
      editable: true,
      gateIndependent: true,
      default: true,
    },
    {
      id: "type",
      ...IN_OPTIONS,
      ctorOption: "type",
      path: "type",
      control: "select",
      label: "Type of the blast",
      editable: true,
      gateIndependent: true,
      default: "NORMAL",
      options: [...TYPE_OPTIONS],
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [
    // The gate: the hit would knock me out (max HP above 1 and damage at least my current HP). All four users are legacy until the
    // library has a would-knock-out atom (R-B10-c4-03).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Keeps enduring the remaining hits of a multi-hit move in the same turn, and drops that memory on the next turn",
    "Does nothing when I already have a Sturdy-style survival effect on this hit",
    "Does nothing while a Damp-style ability is active on the field (then I simply faint)",
    "The blast is a free move that cannot be cancelled by a flinch, and it knocks me out when it is used",
    "Nothing is armed in a preview",
  ],
  effect: { id: "effect.package", params: ["power", "flinch", "type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      name: "a hit that would knock me out and one that would not",
      axes: { hp: ["max", "50%"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "All four users are legacy-closure gates, so the rebuild cannot be built and the L2 twin has no rebuilt attr to compare. The B10 test (test/tests/elite-redux/decomp/B10/chunk4-gates.test.ts) drives canApply of the class and of a frozen copy of the original rule over HP, damage, max HP, the multi-hit memory, Sturdy and Damp states.",
  status: "decomposed",
  notes:
    "Tier B split by hand (gate: the lethal-hit test; residual: multi-hit memory, Sturdy test, Damp block). Users (4 attrs): Aftermath attr 0, Perish Body attr 1, Unstable Core attr 2 and Pungency attr 1, all `{ power: 100, flinch: true }` with the default Normal type (the dispatcher replaces the vanilla contact-chip attr in place, patchAftermath). All four gates are legacy: the library has no atom for 'the damage of this hit is at least my HP' (request R-B10-c4-03). Package justified: the effect (a) leaves the holder at 1 HP through the Sturdy tag and a direct clamp of later sub-hits, (b) cuts the attacker's multi-hit volley, (c) builds a one-off Explosion-id move with the chosen power, type, always-flinch rider, no contact, all-adjacent targets and a self-KO, and (d) queues it as a FOLLOW_UP move ahead of every other move. Library pieces exist for (a) only (effect.cap-damage), not for (b), (c) or (d), and splitting (a) from the rest would let a rule survive without exploding (request R-B10-c4-08). Typed settings: power, always-flinch, type. Oddities, NOT fixed: the class name says PostFaint but it is a pre-damage clamp; the KO is credited to the explosion, not to the attacker (class comment); a hit that would knock out a holder under a Damp-class ability faints it normally; the explosion category is chosen with getEffectiveStat at the moment of the hit.",
});
