/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 3. Tier C, engine-query (a presence marker). "When I hit one foe with a biting or Dragon-type move, up to two side heads also hit other Dragon-type foes at 35% power."
//
// Source: src/data/elite-redux/abilities/hydrapex.ts, class HydrapexAbAttr (extends PostSummonAbAttr; constructor passes showAbility false, activateOnGain stays true; apply is empty,
// there is no canApply of its own). It is a pure marker. Everything happens in erHydrapexOnHit, called from erBatch4OnTargetHit (batch4-on-hit.ts) once per target per hit of an attacking
// move (MoveEffectPhase.applyOnTargetEffects). The seam finds the holder's active HydrapexAbAttr by constructor name and tests, in this order:
//   1. holder carries it (isActive(true), unsuppressed)             -> presence (the marker)
//   2. !move.isMultiTarget()                                        -> condition: the move hits one target
//   3. move.power > 0                                               -> condition: the move has a fixed power
//   4. move.hasFlag(BITING_MOVE) || user.getMoveType(move) === type -> condition: biting (PRINTED flag) or the chosen type (Dragon)
//   5. once per move use: key waveIndex:turn:user.id:move.id vs a module variable -> guard (not once per multi-hit)
//   6. others = foes except the primary target, not fainted, isOfType(type), first N -> target selection (feasibility; none = nothing happens)
//   7. per extra foe: a scripted INDIRECT MovePhase of the same move with power round(power * share) (min 1) and every move attr stripped (no secondary effect)
// Constructor change (behaviour-neutral): the two numbers and the type are constructor arguments (defaults are the old literals); the seam reads them from the holder's live attr.
// No random draw. State: one module variable (the once-per-move key), not per instance.
import { HydrapexAbAttr } from "#data/elite-redux/abilities/hydrapex";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(HydrapexAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Side heads hit other foes with a weaker copy of my move",
  summary: params =>
    `While I have this, when I hit one foe with a single-target biting move or a ${params.sideType}-type move, up to ${params.maxSideHeads} side heads also hit other ${params.sideType}-type foes with it at ${Math.round(Number(params.sidePowerShare) * 100)}% power and no side effects.`,
  synonyms: [
    "hydrapex",
    "extra heads",
    "side heads",
    "multi head bite",
    "hit the other dragon",
    "splash bite",
    "hydra",
  ],
  examples: [
    "My bite also hits the other Dragon-type foe at 35% power",
    "Three-headed dragon whose side heads strike a second and third foe",
  ],
  params: [
    {
      id: "sidePowerShare",
      ctorIndex: 0,
      path: "sidePowerShare",
      control: "slider",
      min: 0.05,
      max: 1,
      step: 0.05,
      label: "Side head power (0.35 = 35% of the move's power)",
      editable: true,
      default: 0.35,
    },
    {
      id: "maxSideHeads",
      ctorIndex: 1,
      path: "maxSideHeads",
      control: "number",
      min: 1,
      max: 4,
      step: 1,
      integer: true,
      label: "Most side heads per move (extra foes struck)",
      editable: true,
      default: 2,
    },
    {
      id: "sideType",
      ctorIndex: 2,
      path: "sideType",
      control: "select",
      label: "Move type that triggers it, and type the extra foes must have",
      editable: true,
      default: "DRAGON",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only a move that hits one target and has a fixed power above 0 qualifies",
    "The move must be a biting move (its own printed property) or a move of the chosen type",
    "It fires once per move use, not once per hit of a multi-hit move",
    "Needs another living foe that has the chosen type; with none (singles) nothing extra happens",
    "Side hits copy only the move's type, category and a reduced power: no stat changes, statuses or extra hits, and they cost no PP",
    "The extra hits are built into the game's hit handling and are not part of this block",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  l2StaticReason:
    "The marker is consulted by the hit handling after a move lands, which is not a dispatched moment; the twin compares whole battles of the one user instead.",
  probes: [{ name: "hit a foe with a biting move", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "Engine-query (presence marker read by erHydrapexOnHit by constructor name), counted apart from the decomposed classes; the foundation owns any abilityQuery routing. 1 attr in 1 ability: Hydrapex (5931 attr 0). The class has no condition, guard or gate of its own; the conditions above live in the engine seam and are listed as feasibility plus requests R-B15-12 (the moment 'when my attack damages a target'), R-B15-6 (the printed-flag atom, biting uses move.hasFlag) and R-B15-20 (the hit-handling effect 'strike other foes of a type with a weaker copy of the move'). The two numbers and the type are typed params. Suspected oddities, NOT fixed: (1) the once-per-move guard is ONE module variable keyed waveIndex:turn:user.id:move.id, so a holder that uses the same move twice in one turn (a repeat effect) fires only once; (2) the side hits are queued with unshiftNew MovePhase before the primary move finishes its remaining hits; (3) the trigger type is the move's EFFECTIVE type (getMoveType, so Pixilate-style changes count) while the biting test is the PRINTED flag.",
});
