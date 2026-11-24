/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 6. Tier B. "After the first hit that damages me each turn, I lose one random type (never the protected one, Normal by default)."
//
// Source: src/data/elite-redux/abilities/world-in-pieces.ts, class WorldInPiecesRemoveTypeAbAttr (extends PostDefendAbAttr; showAbility stays the PostDefend default; the constructor now
// takes the protected type, default PokemonType.NORMAL). canApply, now guards && gate && residual. The ORIGINAL clause order was:
//   1. move.category === STATUS || damage <= 0                     -> two clauses: the status test is the CONDITION (gate), damage <= 0 is a safety rule (guard)
//   2. hitResult is NO_EFFECT or IMMUNE                            -> guard (a blocked or immune hit is not a direct hit)
//   3. WORLD_IN_PIECES_REMOVED_THIS_TURN.get(holder) === turnKey() -> guard (the ability's own once-per-turn memory; module WeakMap shared with the AI snapshot)
//   4. removableTypes(holder).length > 0                           -> residual (feasibility: at least one attached type other than the protected one)
// Every clause before the residual is a pure read (no random draw, no write), so putting the guards in front of the gate cannot change any answer. Order now: guards (1b, 2, 3), gate (1a), residual (4).
// apply (not when simulated): snapshot the holder's types once, write the once-per-turn memory, ONE seeded draw randBattleSeedInt(removable.length) picks the type, it is added to the removed
// set, summonData.types is rebuilt without it, and the message "<name> lost its <type> form!" is queued. RNG: exactly one draw per applied hit, after the memory write.
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); the constructor argument protectedType replaces the literal NORMAL (default unchanged); `gateOverride` is declared for the compiler.
//
// Why the effect is a package (honest limit): "remove a random type of mine and remember it so it can be given back" needs a ledger (original types, removed set) that three sibling classes and
// the AI snapshot share. The vocabulary has no effect that takes a type away from a Pokemon and no memory of what was taken, so splitting would re-implement the class. The trigger (after I am hit)
// and the condition (the move deals damage) ARE separate, swappable blocks, and the only setting (the protected type) is a typed param.
import { WorldInPiecesRemoveTypeAbAttr } from "#data/elite-redux/abilities/world-in-pieces";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(WorldInPiecesRemoveTypeAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-hit",
  label: "Lose a random type after a hit (World in Pieces)",
  summary: params =>
    `After the first damaging hit I take each turn, I lose one random type, but never my ${params.protectedType} type. Example: a six-type Pokemon drops to five after the first hit.`,
  synonyms: [
    "world in pieces",
    "lose a type",
    "strip a type",
    "type loss when hit",
    "shed a type",
    "break apart when hit",
    "remove my type",
  ],
  examples: [
    "The first hit each turn strips one of my types at random, but I always keep Normal, like World in Pieces",
    "Lose a random type when I take damage",
  ],
  params: [
    {
      id: "protectedType",
      ctorIndex: 0,
      path: "protectedType",
      control: "select",
      label: "Type that can never be lost",
      editable: true,
      gateIndependent: true,
      default: "NORMAL",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
  ],
  conditions: [
    // The gate is the old `move.category === STATUS` test: the move deals damage (move.damaging).
    { slot: "gate", ctx: "params", lib: "move.damaging", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must have dealt damage and must not be blocked or have no effect (an immune or missing hit does nothing)",
    "It happens only once per turn: after one type is lost, further hits that turn do nothing",
    "I must still have at least one type that is not the protected one",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["protectedType"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: after the once-per-turn memory is written, one globalScene.randBattleSeedInt(removable.length) picks the type to lose (never when simulated)",
    ],
    state: "battle",
    simulated: "respects",
  },
  probes: [
    {
      // A damaging hit and a status move: the gate decides (move.damaging).
      name: "damaging and status foe move",
      axes: { foeMove: ["TACKLE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, package effect with a separate trigger, a bound gate and a typed param. 1 attr in 1 ability: World in Pieces (5917 attr 1). The gate binding is move.damaging (the same `move.category !== STATUS` test). The guards (damage above 0, hit not NO_EFFECT or IMMUNE, own once-per-turn memory free) have no registry id and are listed as feasibility: requested as R-B15-47. The residual and the effect are the class code. Constructor change (behaviour neutral, spec 3.1 spirit): the new argument protectedType defaults to NORMAL, the old literal; removableTypes() takes it as a parameter. The lost-types memory and the 'lose a random type' effect are requested as R-B15-46. Suspected oddities, NOT fixed: (1) the once-per-turn key is waveIndex:turn stored in a WeakMap on the Pokemon, never cleared on leave-field, so it only matters until the next summon (the summon half deletes it); (2) the message uses the lowercase enum name and is hard-coded English; (3) the draw is made after the memory write, so a holder that applies at all always spends one draw per hit that applies.",
});
