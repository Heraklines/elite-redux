/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 3 / Splash Damage (also half of Two-Chambered). Read by hand: fakemon-pitch-mechanics.ts `SplashDamageAbAttr`, its base
// PostAttackAbAttr (ab-attrs.ts, attackCondition = constructor argument 0, default `move.category !== STATUS`), the dispatch
// `applyAbAttrs("PostAttackAbAttr", ...)` in move-effect-phase.ts (once per hit, per target) and `scriptedPokemonMove`
// (archetypes/scripted-move-util.ts).
//
// canApply, clause by clause, in the order they run (the split is `canApply = guards && gate`; `damage > 0` is a pure read of the frame,
// so it may run first):
//   1. condition  the move deals damage: PostAttackAbAttr's attackCondition, `move.category !== STATUS`  -> `gate`, atom move.damaging
//   2. guard      the hit really dealt damage: `damage > 0`                                            -> `guards`, no registry guard yet (request R6)
//   3. condition  the move is not a status move (the same test as clause 1, written again)             -> `gate`, atom move.damaging (duplicate, kept in place)
//   4. condition  the move targets one other Pokemon: `[NEAR_ENEMY, OTHER, NEAR_OTHER].includes(move.moveTarget)`
//                                                                                                      -> `gate`, NO EXACT ATOM (request R28)
//   5. condition  no splash happened yet this turn: `!turnData.erAbilityProvenance.includes("splash-damage:guard")`
//                                                                                                      -> `gate`, atom R3 (marker, turn memory)
//   6. condition  the foe I hit has a standing neighbour: `opponent.getAdjacentAllies().some(ally => !ally.isFainted())`
//                                                                                                      -> `gate`, NO ATOM (request R29)
// apply, unless simulated: take the first standing neighbour of the foe I hit (stop if none), push the marker "splash-damage:guard" into
// this turn's memory, then queue a MovePhase of the SAME move at that neighbour with power `max(1, floor(move.power * share))`,
// MoveUseMode.INDIRECT. No random draw. The indirect hit raises PostAttack again for the holder; the marker makes clause 5 refuse it.
import { SplashDamageAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SplashDamageAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-my-hit",
  label: "Repeat my hit on the foe's neighbour at reduced power",
  summary: params =>
    `After my single-target attack lands, the same move also hits the foe's standing neighbour at ${params.powerPercent}% of its power (at least 1), once per turn. Example: 50 = half power.`,
  synonyms: [
    "splash damage",
    "two chambered",
    "spread damage",
    "hit the neighbour too",
    "echo attack",
    "half damage to the ally of the target",
  ],
  examples: [
    "Also hit the foe next to my target for half damage",
    "After a single-target hit, splash 50% of the move's power onto the other foe",
  ],
  params: [
    {
      id: "powerPercent",
      ctorIndex: 0,
      path: "powerShare",
      control: "number",
      label: "Power of the repeated hit (% of the move's power, 50 = half)",
      editable: true,
      gateIndependent: true,
      default: 50,
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      // The class stores a ratio (0.5); staff see a whole percent.
      codec: {
        toCtor: value => Number(value) / 100,
        fromInstance: raw => (typeof raw === "number" ? Math.round(raw * 100) : undefined),
      },
    },
  ],
  conditions: [
    // The gate: all[move.damaging, move.damaging, <single-target move kinds (R28)>, not <marker "splash-damage:guard" is set (R3)>,
    // <foe has a standing neighbour (R29)>], in that order. Three clauses have no atom yet, so the whole gate is legacy.
    {
      slot: "gate",
      ctx: "params",
      lib: "move.damaging, plus requests R28 (the exact single-target list), R3 (marker in turn memory) and R29 (the foe has a standing neighbour)",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: [
    "The hit must have dealt at least 1 damage",
    "It never queues the repeated hit for a preview (a simulated hit)",
    "The repeated hit is a real, indirect use of the same move: it cannot trigger another splash in the same turn",
  ],
  effect: { id: "effect.package", params: ["powerPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The grid foe has no neighbour in a single battle, so the gate is false there; the gate clauses and the apply (marker, power
      // floor, minimum 1) are driven by hand in test/.../B17/chunk3.test.ts with stand-in Pokemon.
      name: "single-target hit on a healthy and a half-health foe",
      axes: { foeHp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, PACKAGE for the effect only, with a written reason: effect.scripted-move takes a FIXED move id and a FIXED power, and always targets the foe that was hit. This rule repeats the move that was just used, at a share of THAT move's power (never below 1), against a different Pokemon (the standing neighbour of the foe), and leaves a marker so it happens once per turn; request R35 extends effect.scripted-move with 'repeat the move I just used', 'power as a share of the move's power' and 'target the neighbour of the foe I hit'. The power share is a typed setting (the old literal 0.5 in apply is now the constructor argument `powerShare`, default 0.5, shown to staff as a whole percent; floor(power * 50 / 100) equals floor(power * 0.5), proved in chunk3.test.ts). The trigger and every condition are separate blocks. Source edit (pure move of code, spec 3.1): `damage > 0` moved into a `guards` method (a pure read of the frame; the first clause of the old canApply is the inherited attack condition, which stays first inside `gate`, so only one pure read was moved in front of it); the rest is `gate` in the old order. The gate is legacy-closure-pending-request (R28, R3, R29). Users: Splash Damage (6025, attr 0) and Two-Chambered (6086, attr 2, next to the HitMultiplier archetype attrs of other batches); both use the default share. Suspected game bugs, NOT fixed: (1) for a move with variable or no listed power (power -1 or 0, for example a fixed-damage or weight move) the repeated hit gets power max(1, floor(-0.5)) = 1, an almost harmless 1-power copy that still counts as a splash; (2) the marker is turn memory per holder, so with a multi-hit move only the FIRST landed hit splashes, which may or may not be intended (Two-Chambered hits twice). No other oddity found.",
});
