/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 3. "After my damaging move of one type lands, I take recoil" (Electric Burst, Infernal Rage, Doom Blast, Two-Faced).
//
// Source: src/data/elite-redux/archetypes/type-damage-boost.ts, TypeRecoilAbAttr (extends PostAttackAbAttr).
// Constructor: one options object `{ type, recoilPct }` (recoilPct is a fraction, 0.1 = 10%); it throws for a share that is not above 0.
// Dispatched after every hit of a move (applyAbAttrs("PostAttackAbAttr")). Clauses, in the original order (Tier B):
//   canApply 1  `super.canApply`: the move is a damaging move (category is not Status)               GATE (replaceable) ...
//   canApply 2  the move's type AFTER other abilities changed it is `type` (`user.getMoveType(move)`)    ... the same gate
//   apply 1     `simulated` -> nothing                                                                   respects the preview flag
//   apply 2     no damage dealt (0 or undefined) -> nothing                                              FEASIBILITY
//   apply 3     Rock Head (BlockRecoilDamageAttr) or Magic Guard (BlockNonDirectDamageAbAttr) cancels it  FEASIBILITY (engine query)
//   apply 4     `recoil = toDmgValue(damage * recoilPct, 1)`; zero -> nothing                             EFFECT
//   apply 5     `min(recoil, hp - 1)`; zero or less -> nothing                                             EFFECT: it never knocks the holder out
//   apply 6     the holder takes it as indirect damage (ignores segments) and `turnData.damageTaken` rises  EFFECT
// No random draw, no state. Each hit of a multi-hit move recoils on its own damage.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypeRecoilAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { PokemonType } from "#enums/pokemon-type";
import { percentOfFractionCodec } from "./b12-chunk3-codecs";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(TypeRecoilAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Take recoil from my damaging moves of one type",
  summary: params =>
    `After my ${params.type} damaging move lands, I take ${params.recoilPercent}% of the damage it dealt, but never enough to knock me out. Rock Head and Magic Guard block it. Example: 10% on Dark moves, like Doom Blast.`,
  synonyms: [
    "recoil",
    "self damage",
    "life orb style",
    "downside of a boost",
    "pay for power",
    "recoil for one type",
    "doom blast",
    "electric burst",
    "infernal rage",
  ],
  examples: [
    "Take 10% of the damage I deal as recoil when I use an Electric move, like Electric Burst",
    "Take 5% recoil on Fire moves, like Infernal Rage",
  ],
  params: [
    {
      id: "type",
      ...IN_OPTIONS,
      ctorOption: "type",
      path: "type",
      control: "select",
      label: "Move type that causes recoil",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "recoilPercent",
      ...IN_OPTIONS,
      ctorOption: "recoilPct",
      path: "recoilPct",
      control: "number",
      min: 0.5,
      max: 100,
      step: 0.5,
      label: "Recoil (% of the damage I deal, 10 = a tenth)",
      editable: true,
      // Only the effect reads it; the gate (the move type) never repeats it.
      gateIndependent: true,
      default: 10,
      codec: percentOfFractionCodec,
    },
  ],
  // The type setting is the same value as the gate's type: moving the setting moves the compiled gate's type.
  gateParams: [{ param: "type", block: "move.type", field: "type" }],
  conditions: [
    // The gate: the move deals damage AND its type after other abilities changed it is `type`: all[ move.damaging, move.type { effective: true } ].
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Nothing happens when the move dealt no damage",
    "Rock Head and Magic Guard stop the recoil",
    "The recoil never takes more than my HP minus 1, so it cannot knock me out",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.recoil", params: ["recoilPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "recoil with room to spare, with 1 HP of room and with no room",
      axes: { hp: ["max", "max-1", 1] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 5 attrs, every gate bound to all[ move.damaging, move.type { effective: true } ]: Electric Burst (5074 attr 1, Electric 10%), Infernal Rage (5168 attr 1, Fire 5%), Doom Blast (5458 attr 1, Dark 10%), Two-Faced (5486 attr 6 Electric 10% and attr 7 Dark 10%). The old canApply is the whole gate (the parent's damaging-move test, then the type test). The effect is the library recoil effect; its extra safety (never below 1 HP, Rock Head and Magic Guard, no damage no recoil) stays in the class and is listed as feasibility. Oddities, not fixed: (a) the recoil is a share of the damage of THIS hit, so a multi-hit move recoils once per hit; (b) `turnData.damageTaken` rises by the recoil, which other abilities that read damage taken this turn will see; (c) the holder takes it as indirect damage that ignores shield segments; (d) Two-Faced has both an Electric and a Dark recoil attr, each firing only for its own type, so one move never recoils twice; (e) the recoil is skipped when the game only previews the move; (f) the ability banner shows (the parent's default is on) even when the recoil ends up zero.",
});
