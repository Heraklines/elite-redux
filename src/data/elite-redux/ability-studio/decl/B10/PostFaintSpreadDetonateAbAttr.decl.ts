/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 4 / package (Tier C).
//
// Read by hand from archetypes/post-faint-spread-detonate.ts. The class extends PostFaintAbAttr (WHEN "when I faint"), constructor
// `{ power = 100, flinch = false, type = NORMAL }`, `super(true)`; throws when power is not positive. canApply, the only clause:
//   pokemon.getAdjacentOpponents(true).length > 0 && !isExplosionBlocked()      feasibility + safety rule, no gate
// (a foe must be next to me; no Damp-class ability on the field: applyAbAttrs("FieldPreventExplosiveMovesAbAttr") for every field
// Pokemon). No guards in the registry sense, no prepare, no residual, no random draw. apply: simulated -> nothing; else for every
// adjacent foe that is alive: damage = target.getAttackDamage({ source: holder, move, isCritical: false, simulated: false }) of a
// one-off Explosion-id move (power, type, category by the higher of Sp. Atk and Attack, no contact); skipped when cancelled, no effect
// or 0 damage; times 0.75 when more than one foe; at least 1; damageAndUpdate(INDIRECT-style result of the calc, source: holder); when
// flinch and the foe is still alive, a FLINCHED tag for 1 turn. It fires on ANY cause of the knock-out and cannot miss.
//
// Clause classification: both clauses of canApply are feasibility ("a foe is there", "Damp blocks explosions"), so there is no gate to
// replace; extra IFs can be ANDed on top (the dispatcher honours attr-level conditions). The effect is a package with three typed
// settings: it computes the damage of a made-up move by hand because a fainted Pokemon cannot run a move phase.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PostFaintSpreadDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-spread-detonate";
import { PokemonType } from "#enums/pokemon-type";

/** The three settings live inside the one options argument; `ctorOption` names the key. */
const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(PostFaintSpreadDetonateAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.faint",
  label: "Blast every adjacent foe when I faint",
  summary: params =>
    `When I faint, whatever the cause, a ${params.power} power ${params.type} blast hits every foe next to me. It cannot miss${params.flinch === true ? " and flinches them" : ""}. Damp stops it.`,
  synonyms: [
    "explode when I faint",
    "revenge blast on ko",
    "victory bomb",
    "balloon bomb",
    "damage foes when I die",
    "spread damage on faint",
    "last words explosion",
  ],
  examples: [
    "When I faint for any reason, a 100 power Fire blast hits every foe next to me, like Victory Bomb",
    "A Normal blast of 60 power that also flinches the foes",
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
      label: "Power of the blast (100 = like Victory Bomb)",
      editable: true,
      default: 100,
    },
    {
      id: "flinch",
      ...IN_OPTIONS,
      ctorOption: "flinch",
      path: "flinch",
      control: "boolean",
      label: "The blast also flinches the foes it leaves standing",
      editable: true,
      default: false,
    },
    {
      id: "type",
      ...IN_OPTIONS,
      ctorOption: "type",
      path: "type",
      control: "select",
      label: "Type of the blast",
      editable: true,
      default: "NORMAL",
      options: [...TYPE_OPTIONS],
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must be next to me",
    "Does nothing while a Damp-style ability is active on the field",
    "The blast uses the higher of my Attack and Sp. Atk (Sp. Atk only when it is higher), cannot miss, and does 0.75 times the damage when it hits more than one foe",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: ["power", "flinch", "type"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "faint with a foe next to me", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  l2StaticReason:
    "In the L2 scenario where the holder faints to the foe's attack the engine never evaluated this attr (the harness reports it), so the twin cannot show the original evaluated. The B10 test (test/tests/elite-redux/decomp/B10/chunk4-effects.test.ts) calls canApply and apply of the original and the rebuild for both users and compares the damage dealt, the flinch rider, the Damp block and the missing-foe case.",
  status: "decomposed",
  notes:
    "Tier C (no gate). Users (2 attrs): Balloon Bomb attr 1 (100 power, no flinch, Normal) and Victory Bomb attr 0 (100 power, no flinch, Fire); nothing to bind. Package justified: a fainted Pokemon cannot run a move phase (MovePhase bails on an inactive user), so the class computes each foe's damage with getAttackDamage for a made-up Explosion-id move and applies it directly; the library 'Use a move' effect needs a real move and a living user, so it cannot be used (request R-B10-c4-09 for a 'hurt every adjacent foe' effect). Typed settings: power, flinch, type. Oddities, NOT fixed: the sibling class of Aftermath (PostFaintDetonateAbAttr) differs in timing, the always-flinch default and reach (that one is a pre-damage clamp that fires on damaging hits only); the class reads simulated only in apply.",
});
