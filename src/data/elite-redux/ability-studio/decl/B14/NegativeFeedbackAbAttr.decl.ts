/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 6. Tier B event-effect with four consequences (four branches). "After my attack lands on a paralyzed foe, cure its
// paralysis, raise my Speed, switch off one of its held items for a while, and turn my next physical move into two types"
// (Negative Feedback).
//
// Source: plusle-minun.ts NegativeFeedbackAbAttr (extends PostAttackAbAttr, dispatched after my hit). canApply is the same as
// PositiveFeedbackAbAttr's, in the ORIGINAL clause order, now `guards && gate`:
//   guards  1. `super.canApply(params)`   the parent's `attackCondition(pokemon, opponent, move)`, constructor argument 0, default
//                                         `move.category !== STATUS` (the move deals damage); swapped through the slot `ctor:0`
//           2. `hitResult < 4`            an ordinary hit (HitResult 4 is ONE_HIT_KO, 5 is NO_EFFECT: see notes)
//   gate    3. `opponent?.status?.effect === StatusEffect.PARALYSIS`    the foe is paralyzed (library: status.has { who: other })
//
// apply, original order (nothing in canApply is random; step c draws once when the foe holds more than one item):
//   a.  `if (simulated || !opponent) return`
//   b.  `opponent.resetStatus(true, false, false, false)`                      cure the foe at once (effect.cure-status)
//   b2. unshift `StatStageChangePhase(holder, selfTarget true, [SPD], +1)`     raise my Speed (effect.stat-stage)
//   c.  `suppressRandomHeldItem(opponent)`: a seeded random pick (`randBattleSeedInt(n)` only when n > 1) among its held items that
//       are not form-change items; the item stays but does nothing until the end of the FOLLOWING turn   (no library effect)
//   d.  `primeDualTypeMove(holder, ELECTRIC, FAIRY)`: my NEXT physical move counts as Electric first and Fairy second (a lasting
//       mark on me that the move code reads and clears)                                                   (no library effect)
// Steps b and b2 exist in the library; steps c and d do not, so those two branches are "works as one piece" parts (requests
// R-B14-6.5 and R-B14-6.6). The class keeps the four in this exact order (the seeded draw sits between the stat stage and the type mark).
// Class edit (pure move of code): a constructor with the old behaviour as defaults, `(attackCondition?, showAbility = true,
// speedStages = 1, primaryType = ELECTRIC, secondType = FAIRY)`.
import { NegativeFeedbackAbAttr } from "#data/elite-redux/abilities/plusle-minun";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(NegativeFeedbackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Consume paralysis: gain Speed, lock an item, two-type move",
  summary: params =>
    `After I hit a paralyzed foe: its paralysis is cured, I gain ${params.speedStages} Speed stage, one of its items stops working for a while, and my next physical move is ${params.primaryType} and ${params.secondType}.`,
  synonyms: [
    "negative feedback",
    "eat paralysis for speed",
    "item lock after paralysis",
    "disable a held item",
    "dual type next move",
    "speed boost from paralysis",
    "convert paralysis",
  ],
  examples: [
    "After I hit a paralyzed foe, I get faster, one of its items is switched off and my next physical move is Electric and Fairy, like Negative Feedback",
  ],
  params: [
    {
      id: "speedStages",
      ctorIndex: 2,
      path: "speedStages",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Speed stages I gain (1-6)",
      editable: true,
      default: 1,
      gateIndependent: true,
    },
    {
      id: "primaryType",
      ctorIndex: 3,
      path: "primaryType",
      control: "select",
      label: "My next physical move becomes this type first",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
      gateIndependent: true,
    },
    {
      id: "secondType",
      ctorIndex: 4,
      path: "secondType",
      control: "select",
      label: "...and this type second",
      editable: true,
      default: "FAIRY",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
      gateIndependent: true,
    },
  ],
  // The constructor's second argument, `showAbility`, is never exposed.
  fixedCtorArgs: { 1: true },
  conditions: [
    // Clause 1: the parent's attack condition, a constructor closure (by default "the move deals damage"). Removable.
    { slot: "ctor:0", ctx: "attack", path: "attackCondition", removable: true, editable: true },
    // Clause 3, the gate = [the foe is paralyzed]. Removable.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only after an ordinary hit: a one-hit KO or a blocked hit does not count",
    "Does nothing while the game is only previewing",
    "The item lock needs the foe to hold at least one item that is not a form-change item; it lifts at the end of the following turn",
    "The dual-type mark only affects my next physical move and is then used up",
  ],
  branches: [
    {
      label: "Cure the foe's paralysis",
      conditions: ["foe is paralyzed"],
      effect: { id: "effect.cure-status", params: [] },
    },
    {
      label: "Raise my Speed",
      conditions: ["foe is paralyzed"],
      effect: { id: "effect.stat-stage", params: ["speedStages"] },
    },
    {
      label: "Switch off one of the foe's held items for a while",
      conditions: ["foe is paralyzed"],
      effect: { id: "effect.package", params: [] },
    },
    {
      label: "Make my next physical move two types",
      conditions: ["foe is paralyzed"],
      effect: { id: "effect.package", params: ["primaryType", "secondType"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: ["apply step c: randBattleSeedInt(items) only when the foe holds more than one item"],
    state: "battle",
    simulated: "respects",
  },
  probes: [{ name: "I hit a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B event-effect, four branches. Branches 1 and 2 are library effects (cure-status, stat-stage on me); branches 3 and 4 are parts that work as one piece because the library has no effect that suppresses a held item for a bounded time (the class uses the module item-suppression: a Map keyed by Pokemon id holding one item type and an expiry turn, read by PokemonHeldItemModifier.shouldApply) and none that marks the holder's next physical move as two types (dual-type-move: a WeakMap prime read by the move code). Requests R-B14-6.5 and R-B14-6.6 ask for them as blocks. Users (1): Negative Feedback (5923), its only attr. Both condition slots are bound (bindings.ts): ctor:0 = move.damaging, gate = status.has { other, PARALYSIS }. The shared L2 scenarios cannot put a status on the FOE, so the paralyzed branch is proven by B14/chunk6.test.ts. The class reads `simulated` only in apply. The one random draw (which item) sits in apply step c, after the Speed stage is queued and before the type mark is set; with a single held item no draw happens. Suspected game bug, not fixed: `hitResult < 4` is a bare number (4 is ONE_HIT_KO, 5 is NO_EFFECT), so a one-hit KO never triggers it. Oddity, not fixed: the ability text says the maintainer chose the self-buff reading of 'its', so the type mark goes on the holder, not the foe.",
});
