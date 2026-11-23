/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 5 / calc-modifier (Tier A: both move tests are constructor closures).
//
// Read by hand from archetypes/stab-add.ts. It extends MovePowerBoostAbAttr, so the trigger is "while the game calculates a move's
// power" (dispatch key MovePowerBoostAbAttr, from the damage calculation and the power preview). The ability multiplies the move's
// power, nothing else: the class never touches the real same-type bonus (it cannot, the bonus is only added when the move type is
// already one of the holder's types), so "the move gains STAB" is modelled as a power multiplier of x1.5.
// Constructor `(opts = { targetType?, multiplier? }, typeCondition?, offTypeCondition?)`; `super(combined, multiplier, false)`
// (no banner). The constructor THROWS when the multiplier is not above 0. The old single closure had two parts, now two closures
// that are combined in the same order (`typeCondition && offTypeCondition`, both pure):
//   1. `pokemon === null` -> false                                     (never true in the game; kept inside both defaults)
//   2. the move's resolved type is the target type (no target type: any type)   `pokemon.getMoveType(move) === targetType`
//        (CONDITION: ctor:1, library atom move.type with the ability-changed type)
//   3. the move's resolved type is NOT one of my own types (Tera type not counted): `!pokemon.getTypes(false, false).includes(moveType)`
//        (CONDITION: ctor:2, no library atom yet, request R-B11-C5-01)
//   apply: the parent's `power.value *= powerMultiplier` (the library effect "multiply the move's power").
// No random draw, no state, and `simulated` is not looked at (a power calculation is a pure read). The resolved type comes from
// `getMoveType`, which is a pure read (simulated by default), so asking for it in both halves does not change anything.
//
// Both closures are new optional constructor arguments with the old behaviour as the default, so every shipped
// `new StabAddAbAttr({ targetType })` is unchanged. `targetType` stays a (locked) setting so a rebuilt attr keeps the same fields
// and `getTargetType()` answer; the move type that really matters at run time is the one in the first condition.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { ANY_MOVE_TYPE, MOVE_TYPE_WORDS, optionalMoveTypeCodec } from "./b11-chunk5-codecs";

export default defineDecl(StabAddAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Give moves of a type the same-type attack bonus",
  summary: params =>
    `${
      params.targetType === ANY_MOVE_TYPE
        ? "Every move whose type I do not share"
        : `My ${params.targetType}-type moves`
    } get the same-type bonus: their power is multiplied by ${params.multiplier}. Not when the move already is one of my own types. Example: Water moves for a Normal Pokemon.`,
  synonyms: [
    "stab",
    "same type attack bonus",
    "extra stab",
    "gain stab",
    "all moves get stab",
    "aurora borealis",
    "mystic power",
    "pixilate bonus",
    "type bonus",
  ],
  examples: [
    "Water moves get the same-type bonus even if I am not a Water type",
    "Every move of mine gets a 1.5x STAB-style bonus",
  ],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "multiplier",
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.5 = the usual same-type bonus, 2 = double)",
      editable: true,
      default: 1.5,
    },
    {
      id: "targetType",
      ctorIndex: 0,
      ctorOption: "targetType",
      path: "targetType",
      control: "select",
      label: "Move type this was built for (Any type = all moves); change the move type in the first condition",
      editable: false,
      default: ANY_MOVE_TYPE,
      options: [...MOVE_TYPE_WORDS],
      codec: optionalMoveTypeCodec,
    },
  ],
  conditions: [
    // Which moves: "the move is of this type" (Immolate: Fire, Aurora Borealis: Ice, Amphibious: Water, ...); the users that boost
    // every off-type move (Mystic Power, Arcane Force, Color Spectrum, Unown Power, Brain Food, Psychic Supremacy) are bound to
    // an always-true test.
    { slot: "ctor:1", ctx: "attack", lib: "move.type", path: "typeCondition", removable: true, editable: true },
    // The move's type is NOT one of my own types. Legacy closure for now (request R-B11-C5-01).
    { slot: "ctor:2", ctx: "attack", path: "offTypeCondition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The type is the move's type after abilities such as Aerilate have changed it",
    "My own types are counted without a Tera type, so a Terastallized Pokemon still counts as its normal types here",
  ],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "my moves against a foe that uses a Normal move and a Water move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, justified in the header (the class code only gained two optional constructor arguments with the old behaviour as default). Users (every one multiplier 1.5; type given as the first-condition binding): Immolate (5017 attr 1, Fire), Mystic Power (5025 attr 0, any), Aurora Borealis (5029 attr 0, Ice), Amphibious (5035 attr 0, Water), Fighting Spirit (5038 attr 1, Fighting), Tectonize (5046 attr 1, Ground), Hydrate (5053 attr 1, Water), Intoxicate (5063 attr 1, Poison), Lunar Eclipse (5103 attrs 0 Fairy and 1 Dark), Solar Flare (5104 attr 2, Fire), Pollinate (5118 attr 1, Bug), Spectralize (5123 attr 1, Ghost), Mineralize (5140 attr 1, Rock), Draconize (5149 attr 1, Dragon), Emanate (5190 attr 1, Psychic), Moon Spirit (5209 attrs 0 Fairy and 1 Dark), Enlightened (5219 attr 1, Psychic), Arcane Force (5224 attr 0, any), Fertilize (5237 attr 1, Grass), Old Mariner (5324 attr 2, Water), Unicorn (5351 attr 3, Fairy), Color Spectrum (5403 attr 2, any), Steel Beetle (5404 attr 3, Bug), Sludgy Mix (5428 attr 1, Poison), Twinkle Toes (5457 attr 2, Fairy), Acidic Slime (5461 attr 2, Poison), Qigong (5463 attr 3, Fighting), Unown Power (5477 attr 0, any), Two-Faced (5486 attr 11, Dark; its attr-level 'only in the hangry form' condition is copied by the rebuild), Deviate (5501 attr 1, Dark), Tender Affection (5527 attr 2, Fairy), Stainless Steel (5530 and 6003 attr 5, Steel), Draconic Might (5542 attr 1, Dragon), Komodo (5552, 5957 attr 1, Dragon), Molten Coat (5557 attr 1, Rock), Dragonfruit (5619, 5956 attr 1, Dragon), Lead Claws (5621 attr 2, Rock), Hand Barnacles (5668 attr 1, Water), Storm Cloud (5688 attr 1, Electric), Waterborne (5689, 5955 attr 1, Water), Mob Boss (5714 attr 2, Dark), Warrior's Spear (5730 attr 2, Fighting), Brain Food (5936 attr 0, any), Brainpower (5940 attr 1, Psychic), Nucleus (6036 attr 3, Psychic), Stellarize (6053 attr 1, Stellar), Moonarch (6074 attrs 1 Fairy and 2 Dark), Bodhisattva (6076 attr 1, Water), Blaze Release (6108 attr 1, Fire), Bejeweled (6111 attr 3, Stellar), Psychic Supremacy (20000 attr 0, any), Heartless Style (20008 attr 4, Fighting). All first conditions are bound; all second conditions are legacy closures (request R-B11-C5-01: the atom 'the move's type is one of my own types', with the Tera type left out). Remarks, NOT fixed: (1) the real same-type bonus counts a Tera type (a Terastallized holder keeps STAB only on its Tera type), but the off-type test here uses the types without Tera, so a Terastallized holder that gets a type boosted by this ability can also get the real STAB bonus from its Tera type on top: possible double bonus. (2) the effect is a power multiplier, not the real same-type bonus, so it shows in the power preview and stacks with every other power boost. (3) 'Stellar' is offered as a type; the engine treats Stellar specially (Stellarize and Bejeweled use it), so check a Stellar rule before shipping it.",
});
