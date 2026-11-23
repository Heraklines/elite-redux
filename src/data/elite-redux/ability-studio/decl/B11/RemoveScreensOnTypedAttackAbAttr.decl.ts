/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / event-effect (Tier B: the move-type test is the gate inside canApply).
//
// Read by hand from archetypes/remove-screens-on-typed-attack.ts. PostAttack hook (WHEN "after my attack lands"), constructor
// `{ type }` kept in the private field `moveType`; `super(undefined, false)`: the default attack condition (the move is not a
// status move) and no ability banner.
//   canApply is now `guards && gate`, in the ORIGINAL clause order:
//     1. guards: the parent's attack condition (the move is a damaging move) and "there is a target"  (kept in the class)
//     2. gate:   `pokemon.getMoveType(move) === moveType`                                            (CONDITION: move.type)
//   apply: simulated or no opponent -> nothing. Else removes Reflect, Light Screen and Aurora Veil from the TARGET's side.
// No random draw.
//
// There is no library effect "remove the screens on the target's side" (request R-B11-03 in requests/B11.md), so the effect
// is one piece. The move-type test is now a block of its own: the `type` setting and the compiled gate stay equal through
// `gateParams`, and staff can replace the whole test (for example "the move has the punching property").
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { RemoveScreensOnTypedAttackAbAttr } from "#data/elite-redux/archetypes/remove-screens-on-typed-attack";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(RemoveScreensOnTypedAttackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Break the target's screens when my move is of one type",
  summary: params =>
    `After my damaging ${params.type}-type move hits, the target's side loses Reflect, Light Screen and Aurora Veil. Example: a Fighting move smashes the screens.`,
  synonyms: [
    "break screens",
    "brick break",
    "psychic fangs",
    "shatter reflect",
    "remove light screen",
    "destroy aurora veil",
  ],
  examples: ["My Fighting moves break Reflect and Light Screen", "Break the foe's screens with every Steel move"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      ctorOption: "type",
      path: "moveType",
      control: "select",
      label: "Only when my move is this type",
      editable: true,
      default: "FIGHTING",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  gateParams: [{ param: "type", block: "move.type", field: "type" }],
  conditions: [{ slot: "gate", ctx: "params", lib: "move.type", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "The move must be a damaging move (status moves never break screens)",
    "Needs a target; the screens are removed from the TARGET's side, not from mine",
    "The type is the one my move really has when it is used (after any type change), and it never happens in a preview",
  ],
  effect: { id: "effect.package", params: ["type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a move of the type, one of another type, a status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "BITE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Only user: Warrior's Spear (attr 3, Fighting), whose attr carries an attr-level condition `holder.isOfType(FIGHTING)` set by `addCondition`; `recomposeAttr` copies that onto the rebuild, so it needs no binding of its own. The gate binding is move.type with effective true (`moveUser.getMoveType(move)`, the same call as the class). The screens of the TARGET's side are removed (`opponent.isPlayer() ? PLAYER : ENEMY`). The L1 grid and the L2 twin only see the move type, not the screens being present or removed: test/tests/elite-redux/decomp/B11/chunk3.test.ts is the one place that checks the screen removal (original and rebuild). Edge, NOT fixed: when the attacker hits its own ally in doubles, the screens of its OWN side are removed.",
});
