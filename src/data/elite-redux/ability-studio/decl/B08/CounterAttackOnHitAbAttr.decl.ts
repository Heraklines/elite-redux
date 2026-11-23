/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3 / event-effect, Tier B with RNG in the gate. Read from the source (archetypes/counter-attack-on-hit.ts, the
// dispatch in move-effect-phase.ts applyOnGetHitAbEffects) and from the live instances of all 17 users. canApply is now
// `guards && gate`, in the original clause order:
//
//   guards  1. the attacker is missing, fainted, or the holder has fainted                      -> false  (feasibility: both must stand)
//           2. the attacker is the holder, the move is not an attack, or it is an INDIRECT move -> false  (feasibility: no self-hit loop, no counter to a counter)
//   gate    3. contactRequired and !move.hasFlag(MAKES_CONTACT)                                 -> false  atom move.inherent-flag
//           4. contactExcluded and move.hasFlag(MAKES_CONTACT)                                  -> false  not(move.inherent-flag)
//           5. filter.flag set and the move lacks it                                            -> false  atom move.inherent-flag
//           6. filter.category physical or special and !move.is("AttackMove")                   -> false  (always passes after guard 2: see notes)
//           7. chance < 100 and holder.randBattleSeedInt(100) >= chance                         -> false  atom rng.chance, LAST: the ONE random draw
//   apply   queues a MovePhase for the holder, aimed at the attacker, with the scripted counter move (INDIRECT: no PP, not in the
//           move history). Skipped when simulated. No second draw.
//
// The contact and move-property settings decide the SHAPE of the gate, so they are not editable: each user's gate binding spells
// out its own shape (bindings.ts). The chance is repeated in the gate's `rng.chance` atom and kept equal through gateParams.
// The class reads the move's OWN contact flag (hasFlag), so the atom is `move.inherent-flag` (Long Reach does not change it).
import {
  ALL_MOVE_NAMES,
  COUNTER_FILTER_CHOICES,
  counterFilterCodec,
  EVERY_HIT,
  OWN_STYLE,
  STYLE_CHOICES,
  singleMoveCodec,
  styleCodec,
} from "#data/elite-redux/ability-studio/decl/B08/chunk3-choices";
import { zeroMeansDefaultCodec } from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";

export default defineDecl(CounterAttackOnHitAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Strike back with a move when I am hit",
  summary: params => {
    const power = Number(params.power) === 0 ? "its normal power" : `${params.power} power`;
    return `When I am hit (${String(params.filter).toLowerCase()}), there is a ${params.chance}% chance I answer with ${params.moveId} at ${power}, for free.`;
  },
  synonyms: [
    "counter attack",
    "retaliate",
    "strike back",
    "revenge",
    "punish the attacker",
    "free move when hit",
    "ice downfall",
    "deflect",
    "rocky helmet",
  ],
  examples: ["Use a 20 power Vacuum Wave on the attacker every time I am hit by a contact move"],
  params: [
    {
      id: "moveId",
      ctorIndex: 0,
      ctorOption: "moveId",
      path: "moveId",
      control: "text",
      label: "Counter move",
      editable: true,
      gateIndependent: true,
      default: "Icicle spear",
      options: ALL_MOVE_NAMES,
      codec: singleMoveCodec,
    },
    {
      id: "power",
      ctorIndex: 0,
      ctorOption: "power",
      path: "power",
      control: "number",
      min: 0,
      max: 250,
      step: 1,
      integer: true,
      label: "Power of the counter (0 = the move's own power)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: zeroMeansDefaultCodec,
    },
    {
      id: "chance",
      ctorIndex: 0,
      ctorOption: "chance",
      path: "chance",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance (%)",
      editable: true,
      default: 100,
    },
    {
      id: "filter",
      ctorIndex: 0,
      ctorOption: "filter",
      path: "filter",
      control: "select",
      label: "Which hits are answered (set by the conditions)",
      // One atom in the gate (the contact test or a move property): the choice decides the SHAPE of the gate.
      editable: false,
      default: EVERY_HIT,
      options: COUNTER_FILTER_CHOICES,
      codec: counterFilterCodec,
    },
    {
      id: "style",
      ctorIndex: 0,
      ctorOption: "category",
      path: "category",
      control: "select",
      label: "Damage style of the counter (Physical or Special; or the move's own)",
      editable: true,
      gateIndependent: true,
      default: OWN_STYLE,
      options: STYLE_CHOICES,
      codec: styleCodec,
    },
    {
      id: "healMultiplier",
      ctorIndex: 0,
      ctorOption: "healMultiplier",
      path: "healMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Healing of the counter, times its normal healing (0 = unchanged; 0.5 = half)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: zeroMeansDefaultCodec,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is a group of atoms per user shape, in the original order (bindings.ts):
    //   [move.inherent-flag MAKES_CONTACT | not move.inherent-flag MAKES_CONTACT | move.inherent-flag F]?, then rng.chance LAST
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Both Pokemon must still be standing",
    "The attacker must be another Pokemon, never myself",
    "Only attacking moves are answered",
    "A counter that was itself a follow-up never starts another counter",
  ],
  effect: { id: "effect.scripted-move", params: ["moveId", "power", "style", "healMultiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply gate: one roll of 100 against the chance (skipped at 100%), only after the guards and every check before it passed",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      // A contact move, a non-contact move, a sound move and a status move: the roll must only be drawn when the cheap checks pass.
      // The enemy is level 100: a counter would otherwise knock out the default level 30 enemy in the middle of the scenario.
      name: "contact, non-contact, sound and status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "HYPER_VOICE", "GROWL"], foeLevel: [100] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = guards && gate (a pure move of the original clauses; the one random draw stays LAST). Users (17, all 17 gates bound): contact only Cold Rebound, Parry, Clap Trap, Ice Downfall, Ultra Instinct, Faraday Cage, Malodor, Chilling Pellets, Bribery, Snowball Fight; non-contact only Failed Check; sound moves only Break it Down; every hit Guard Dog, Brain Mass (50%, and 0.5x healing), Acid Reflux, Wind Chimes, Deflect. Malodor also sets the counter's damage style to Special. The library effect `effect.scripted-move` already covers the move and the power; request R-B08-25 asks for its two missing settings (damage style, healing multiplier) and a 'normal power' value. SUSPECTED GAME BUG, NOT FIXED: the class's category filter (physical or special) tests `!move.is(\"AttackMove\")`, which can never be true after guard 2, so a category filter does nothing; no live ability sets one. The class file header also names Thunder Clouds, Sludge Spit, Aftershock and Retribution Blow, but none of them uses this class today (the live users are the 17 above). The class draws its chance roll even for a simulated call (the library atom rng.chance answers true without a draw when simulated; no live path asks simulated). A counter move with a power override uses scriptedPokemonMove, shared with every scripted-move class. Siblings (PostAttackScriptedMoveAbAttr) are separate classes.",
});
