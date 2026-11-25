/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 3. "Some of my moves change to another type" (Immolate, Pixilate-style Normal conversions, Sand Song, Crystallize...).
//
// Source: src/data/elite-redux/archetypes/type-conversion.ts, TypeConversionAbAttr (extends MoveTypeChangeAbAttr, a PreAttackAbAttr).
// Constructor: one options object `{ source, newType }`. `source` is `{ kind: "type", type }` (every move of that type) or
// `{ kind: "flag", flag, requireType? }` (every move with that property, optionally only when it also has that type). The constructor
// still hands the parent a closure `matchesSource(source, user, move)`; it throws for newType UNKNOWN, an empty property, or an UNKNOWN source type.
// Dispatched while the game decides a move's type (applyAbAttrs("MoveTypeChangeAbAttr") from Pokemon.getMoveType). Clauses (Tier B):
//   canApply  `matchesSource(source, user, move)`   GATE (replaceable), the whole old canApply. It reads the move's OWN type (`move.type`),
//             never `user.getMoveType(move)`: the second would call this very ability again and loop forever (the old comment says it froze the fight menu)
//   apply     `moveType.value = newType`           EFFECT (calc)
// No random draw, no state, no `simulated` test (the result is only the type value).
//
// `source` is not editable: it decides the shape of the gate (a type test, or a property test with an optional type test), which staff
// change with the move blocks. The new type is the setting.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypeConversionAbAttr } from "#data/elite-redux/archetypes/type-conversion";
import { PokemonType } from "#enums/pokemon-type";
import { conversionSourceCodec } from "./b12-chunk3-codecs";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(TypeConversionAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-type",
  label: "Turn my moves of one type or kind into another type",
  summary: params => {
    const source = String(params.source);
    const moves = /moves/i.test(source) ? source : `${source} moves`;
    return `My ${moves} become ${params.newType} type when I use them. Example: Normal moves become Fire type, like Immolate. The extra power some of these abilities add is a separate block.`;
  },
  synonyms: [
    "aerilate",
    "pixilate",
    "galvanize",
    "refrigerate",
    "normal moves become",
    "convert move type",
    "ate ability",
    "sound moves become",
    "immolate",
    "crystallize",
  ],
  examples: [
    "Normal moves become Fire type, like Immolate",
    "Sound moves that are Normal become Ground type, like Sand Song",
    "Rock moves become Ice type, like Crystallize",
  ],
  params: [
    {
      id: "source",
      ...IN_OPTIONS,
      ctorOption: "source",
      path: "source",
      control: "text",
      label: "Which moves change, like 'Normal' or 'Sound moves that are Normal'",
      // It decides the shape of the gate, which staff change with the move blocks.
      editable: false,
      default: "Normal",
      codec: conversionSourceCodec,
    },
    {
      id: "newType",
      ...IN_OPTIONS,
      ctorOption: "newType",
      path: "configuredNewType",
      control: "select",
      label: "Type they become",
      editable: true,
      // Only the effect reads it; the gate (which moves) never repeats it.
      gateIndependent: true,
      default: "FIRE",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [
    // The gate: the move's own type is the source type, or the move has the source property (and the source type, when one is named).
    // A type source maps to move.type { effective: false }; a property source needs the plain property atom (R-B12-04), so those users are legacy.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The move's own type is checked, before any other ability changes it (so it can never loop)"],
  effect: { id: "effect.change-move-type", params: ["newType"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "the holder's moves of the source types and properties",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 39 attrs. Type sources, gate bound to move.type { effective: false } (33 attrs): Normal to Fire Immolate (5017), Solar Flare (5104 attr 1) and Blaze Release (6108); Normal to Fighting Fighting Spirit (5038), Qigong (5463 attr 2), Warrior's Spear (5730 attr 1) and Heartless Style (20008 attr 3); Normal to Ground Tectonize (5046); Normal to Poison Intoxicate (5063) and Sludgy Mix (5428); Normal to Bug Pollinate (5118) and Steel Beetle (5404 attr 2); Normal to Ghost Spectral Shroud (5124 attr 0); Normal to Rock Mineralize (5140), Molten Coat (5557) and Lead Claws (5621 attr 1); Normal to Dragon Draconize (5149), Draconic Might (5542), Komodo (5552 and 5957) and Dragonfruit (5619 and 5956); Normal to Psychic Emanate (5190), Enlightened (5219), Nucleus (6036 attr 2) and Brainpower (5940); Normal to Grass Fertilize (5237); Normal to Fairy Unicorn (5351 attr 2) and Twinkle Toes (5457 attr 1); Rock to Ice Crystallize (5018 attr 0) and Bejeweled (6111 attr 0); Steel to Electric Superconductor (5363 attr 0); Flying to Fairy Cosmic Wings (5639). Property sources, every gate a legacy-closure (6 attrs): Sound moves that are Normal become Ground Sand Song (5012), Ghost Banshee (5268), Ice Snow Song (5328), Steel Power Metal (5361); Drill moves that are Normal become Ghost Grievous Spear (5959) and Grim Jab (5964). Those need the plain property atom (request R-B12-04, already filed for another class): the library flag atom asks doesFlagEffectApply, which also counts abilities that grant a property, so it is not the same test. The old canApply is the whole gate. Oddities, not fixed: (a) the conversion looks at the move's base type only, so a move another ability already changed (for example by a second conversion ability) is not converted again, which is why the class avoids getMoveType; (b) it fires even when the move already has the new type (a harmless rewrite); (c) the power boost that pairs with some conversions is a separate attr with its own filter: Sand Song, Banshee, Snow Song and Power Metal boost EVERY sound move while only Normal sound moves change type, Grievous Spear and Grim Jab boost the same moves they convert.",
});
