/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Two-Faced Unleashed, part 1 of 2 (Tier B, package effect). "While my other face is out, my damaging moves have 1.5x power, and Electric and Dark moves a further 1.4x."
//
// Source: abilities/newcomer-signature-mechanics.ts, TwoFacedPowerAbAttr (MovePowerBoostAbAttr; the constructor now takes
// unleashedMultiplier, typeBonusMultiplier, bonusTypeA and bonusTypeB, defaults = the old literals).
//   canApply (the original closure, two clauses in this order):
//     1. move.category !== STATUS                       -> gate, library atom move.damaging
//     2. TWO_FACED_ACTIVE_TURN[holder] === "wave:turn"  -> residual, private memory (set by prepareTwoFacedMove in
//        phases/move-effect-phase.ts:230 when a damaging move starts and the face is ready, cleared by finishTwoFacedMove)
//   apply (overridden): power *= unleashedMultiplier; then, if the move's type (after ability changes) is bonusTypeA or
//     bonusTypeB, power *= typeBonusMultiplier  (two multiplications in this order, never one product)
// No RNG. The recoil half of the ability is TwoFacedRecoilAbAttr (another chunk).
import { TwoFacedPowerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PokemonType } from "#enums/pokemon-type";

// Player-facing type names (never the enum constants).
const TYPE_CHOICES: Record<string, PokemonType> = {
  Normal: PokemonType.NORMAL,
  Fighting: PokemonType.FIGHTING,
  Flying: PokemonType.FLYING,
  Poison: PokemonType.POISON,
  Ground: PokemonType.GROUND,
  Rock: PokemonType.ROCK,
  Bug: PokemonType.BUG,
  Ghost: PokemonType.GHOST,
  Steel: PokemonType.STEEL,
  Fire: PokemonType.FIRE,
  Water: PokemonType.WATER,
  Grass: PokemonType.GRASS,
  Electric: PokemonType.ELECTRIC,
  Psychic: PokemonType.PSYCHIC,
  Ice: PokemonType.ICE,
  Dragon: PokemonType.DRAGON,
  Dark: PokemonType.DARK,
  Fairy: PokemonType.FAIRY,
};

const typeCodec = {
  toCtor: (value: unknown): PokemonType => {
    const resolved = TYPE_CHOICES[String(value)];
    if (resolved === undefined) {
      throw new Error(`"${String(value)}" is not a known move type`);
    }
    return resolved;
  },
  fromInstance: (raw: unknown): string | undefined =>
    Object.keys(TYPE_CHOICES).find(name => TYPE_CHOICES[name] === raw),
};

export default defineDecl(TwoFacedPowerAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.move-power",
  label: "Boost my damaging moves while my other face is out",
  summary: params =>
    `While my other face is out, my damaging moves have ${params.unleashedMultiplier} times their power, and ${params.bonusTypeA} or ${params.bonusTypeB} moves a further ${params.typeBonusMultiplier} times.`,
  synonyms: [
    "alternate turn boost",
    "second face",
    "every other turn power",
    "jekyll and hyde",
    "unleashed form",
    "dual personality",
  ],
  examples: ["On the turns my second face is out, my attacks are 1.5 times stronger, Electric and Dark ones even more"],
  params: [
    {
      id: "unleashedMultiplier",
      ctorIndex: 0,
      path: "unleashedMultiplier",
      control: "number",
      label: "Power multiplier for every damaging move (times)",
      editable: true,
      gateIndependent: true,
      default: 1.5,
      min: 0,
      max: 8,
      step: 0.05,
    },
    {
      id: "typeBonusMultiplier",
      ctorIndex: 1,
      path: "typeBonusMultiplier",
      control: "number",
      label: "Extra power multiplier for the two favoured move types (times)",
      editable: true,
      gateIndependent: true,
      default: 1.4,
      min: 0,
      max: 8,
      step: 0.05,
    },
    {
      id: "bonusTypeA",
      ctorIndex: 2,
      path: "bonusTypeA",
      control: "select",
      label: "First favoured move type",
      editable: true,
      gateIndependent: true,
      default: "Electric",
      options: Object.keys(TYPE_CHOICES),
      codec: typeCodec,
    },
    {
      id: "bonusTypeB",
      ctorIndex: 3,
      path: "bonusTypeB",
      control: "select",
      label: "Second favoured move type",
      editable: true,
      gateIndependent: true,
      default: "Dark",
      options: Object.keys(TYPE_CHOICES),
      codec: typeCodec,
    },
  ],
  conditions: [
    // Clause 1 of the original closure: the move deals damage (library atom). Clause 2 is the class's residual.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "My other face must be out this turn: it comes out on the first damaging move of every other turn (a private memory inside the class, set when the move starts)",
  ],
  effect: {
    id: "effect.package",
    params: ["unleashedMultiplier", "typeBonusMultiplier", "bonusTypeA", "bonusTypeB"],
  },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "The trigger's registered dispatch key (MovePowerBoostAbAttr) is never dispatched by the engine, which dispatches VariableMovePowerAbAttr, so the shared reach probe cannot see it (decomp-l2-reach.json, request R-B13-12). The twin still shows the original evaluating this attr when a damaging move is used, and B13/two-faced.test.ts drives the real unleash flow.",
  probes: [
    {
      // The face is never out in a plain battle, so the residual decides it; the unleashed case is in B13/two-faced.test.ts.
      name: "damaging and status moves without the other face out",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only; the trigger (move power) and the damaging-move condition are separate and bound to a library atom. Why the effect cannot be split with today's blocks: one effect does TWO multiplications, the second only for two move types, in a single apply (a conditional inside the effect; two effect.multiply-power blocks would be two attrs). Requested as R-B13-21 (a conditional multiply, or letting two attrs share the unleash memory). The 'face is out' clause stays in the class as the residual (second position, as in the original) and is listed under 'also requires'; request R-B13-22 adds a condition that reads that memory. Review of the numbers: 1.5, 1.4 and the types Electric and Dark were literals, now trailing constructor arguments with the old values as defaults. Users: Two-Faced Unleashed (5977, attr 0; attr 1 is TwoFacedRecoilAbAttr in another chunk). The ability is unsuppressable, uncopiable and unreplaceable (ability-level flags set by the builder, not by this class). ODDITIES (not fixed): (1) the unleash memory is written by prepareTwoFacedMove/finishTwoFacedMove in move-effect-phase.ts (found by class name), so the effect depends on engine call sites the declaration cannot show; (2) the 'every other turn' timing lives in twoFacedReady, also outside the class; (3) the ability text says 'damage', the class multiplies move power.",
});
