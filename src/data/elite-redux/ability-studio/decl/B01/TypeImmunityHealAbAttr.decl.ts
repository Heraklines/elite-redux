/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 2, Tier A calc-modifier with TWO consequences (an immunity, then a heal), shown as two branches.
//
// "While the game checks whether a move can hit me, I am immune to <type> moves, and if I am hurt I heal a share of my
// max HP instead." The class inherits `canApply` from TypeImmunityAbAttr (four feasibility clauses, no condition) and
// has no constructor closure, so there is nothing to bind. `apply` runs these steps in this order:
//   1. `super.apply`: `typeMultiplier.value = 0`                                          = effect "block it"
//   2. `if (!pokemon.isFullHp() && !simulated)`: unshift a PokemonHealPhase for
//      `toDmgValue(maxHp * healShare)` with the "typeImmunityHeal" message, then
//      `cancelled.value = true` (hides the "no effect" message)                          = effect "heal", feasibility "I must be hurt"
// At full HP, or in a simulated call, nothing is healed and `cancelled` stays false, so the game still prints "no
// effect" (the move still does nothing because the multiplier is 0). That is the original behaviour, kept.
//
// The heal share used to be a literal `/ 4`. It is now the second constructor argument `healShare` (default 1/4) and a
// field the declaration reads back; the arithmetic is the same (`maxHp * 0.25` equals `maxHp / 4` exactly).
import { TypeImmunityHealAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

/** healShare (0..1 of max HP) <-> whole percent, rounded so 0.25 reads back as 25. */
const percentCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? Number((raw * 100).toPrecision(12)) : undefined),
};

export default defineDecl(TypeImmunityHealAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Absorb a type of move and heal instead",
  summary: params =>
    `Moves of the ${params.type} type do nothing, and if this Pokemon is hurt it heals ${params.healPercent}% of its max HP instead. Example: 25 means a quarter of its HP.`,
  synonyms: [
    "absorb",
    "water absorb",
    "volt absorb",
    "earth eater",
    "dry skin",
    "heal from a type",
    "immune and heal",
    "drain a type of move",
  ],
  examples: ["Immune to Water moves and heal a quarter of max HP when hit by one, like Water Absorb"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "immuneType",
      control: "select",
      label: "Immune to this type",
      editable: true,
      default: "WATER",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "healPercent",
      ctorIndex: 1,
      path: "healShare",
      control: "slider",
      label: "Heal this share of max HP (%)",
      editable: true,
      default: 25,
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      codec: percentCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Moves that hit every Pokemon or a whole side (Spikes, Rain Dance) are never blocked",
    "A Pokemon never blocks its own move",
    "The heal only happens when I am hurt and the move is really used (not when the game only previews it)",
  ],
  branches: [
    {
      label: "Block the move",
      conditions: [],
      effect: { id: "effect.immune-to-type", params: ["type"] },
    },
    {
      label: "Heal while hurt",
      conditions: ["not hp.full (holder)"],
      effect: { id: "effect.heal-percent", params: ["healPercent"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "half HP and full HP against an Electric move, a Ground move and a neutral move",
      axes: { foeMove: ["THUNDER_SHOCK", "MUD_SLAP", "TACKLE"], hp: ["50%", "max"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (9 attrs): Volt Absorb (10, Electric), Water Absorb (11, Water), Dry Skin (87 attr 3, Water), Earth Eater (297, Ground), Elemental Vortex (5369 attr 1, Water), Desolate Sun (5447 attr 4, Ground), Reservoir (5450, Water), Exo Armor (20004, Electric), Old Ocean Relic (20009 attr 1, Water). All use the default quarter heal and no closure. The two effects are one attr: the declaration lists them as two branches (an immunity and a heal) instead of a package, because both exist in the library (effect.immune-to-type, effect.heal-percent); the heal's 'only when hurt' test sits in apply and stays in the class. The library heal may round differently; the class keeps toDmgValue(maxHp * share), the rounding these abilities always had. The ER archetype TypeAbsorbHealAbAttr extends this class but overrides apply and keeps its own heal share (field healFraction); it is another batch's declaration. Oddity (not fixed): a simulated call neither heals nor sets `cancelled`, and at full HP `cancelled` stays false, so the 'no effect' message shows then (the move itself still does nothing). L2 note: the shared probe holds no Water move, because Desolate Sun makes the harsh sun fizzle every Water move before this attr is evaluated (the all-mode reach check failed for it). The five Water users are twinned, with a mutation, in test/tests/elite-redux/decomp/B01/absorb-heal-twin.test.ts. Note for the declaration of TypeAbsorbHealAbAttr (another batch): it inherits the private field healShare (default 0.25) from this class, but its own apply ignores it, so its snapshot will show healShare.",
});
