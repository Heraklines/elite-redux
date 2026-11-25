/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Vapor Body (Tier A, engine-query, effect is a package). "Contact moves aimed at me have 0.7x accuracy."
//
// Source: abilities/newcomer-signature-mechanics.ts, VaporBodyAccuracyAbAttr (extends AbAttr directly: it has NO hook
// of its own; apply is empty). The engine reads it BY NAME:
//   Move.calculateBattlerAccuracy (data/moves/move.ts:1255) calls applyVaporBodyAccuracy(user, target, move, accuracy):
//     accuracy.value > 0                         -> a guard that stays in that function (never-miss moves keep 0)
//     the holder has the attr                    -> the presence test
//     condition(holder, attacker, move)          -> constructor argument 0 (added in this chunk): by default
//                                                   move.doesFlagEffectApply({ MAKES_CONTACT, user: attacker, target: holder })
//                                                   = library atom move.flag {MAKES_CONTACT}
//     accuracy.value *= accuracyMultiplier       -> constructor argument 1 (added in this chunk, default 0.7)
//   Pokemon.getTrapped path (field/pokemon.ts:4075) calls hasEffectiveMoveTrap: a trapping move that makes contact does not
//   trap the holder. That second half is a fixed engine rule (see notes), not a constructor argument.
// No RNG, no state. Tier A: the condition is a constructor closure (ctor:0).
import { VaporBodyAccuracyAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(VaporBodyAccuracyAbAttr, {
  tier: "A",
  kind: "engine-query",
  when: "while.active",
  label: "Lower the accuracy of contact moves aimed at me",
  summary: params =>
    `Contact moves used against me have their accuracy multiplied by ${params.accuracyMultiplier}. Example: 0.7 turns a 100% move into 70%. Moves that never miss are not changed.`,
  synonyms: ["evasion", "dodge contact moves", "contact accuracy drop", "vapor", "slippery", "miss more often"],
  examples: ["Foes' contact moves are 30% more likely to miss me"],
  params: [
    {
      id: "accuracyMultiplier",
      ctorIndex: 1,
      path: "accuracyMultiplier",
      control: "number",
      label: "Accuracy multiplier (0.7 = 70% of the normal chance)",
      editable: true,
      gateIndependent: true,
      default: 0.7,
      min: 0.1,
      max: 2,
      step: 0.05,
    },
  ],
  conditions: [
    // The one clause the class's own default closure tests: the incoming move makes contact (library atom move.flag).
    { slot: "ctor:0", ctx: "defend", lib: "move.flag", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Moves that never miss (accuracy 0 or below) are left alone (checked by the game's accuracy code)",
    "Contact moves that trap the holder (such as Wrap or Fire Spin) also fail to trap it (a fixed rule in the game's trapping check)",
  ],
  effect: { id: "effect.package", params: ["accuracyMultiplier"] },
  provides: ["holder", "other", "move", "moveUser"],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The class never takes part in a dispatched moment: the engine finds it by name inside Move.calculateBattlerAccuracy (applyVaporBodyAccuracy) and in hasEffectiveMoveTrap, so no trace event can show it evaluated and the twin compares whole battles (presence only). B13/vapor-body.test.ts drives the real accuracy calculation and the trapping check instead.",
  probes: [
    {
      // Contact (Tackle) and non-contact (Water Gun) foe moves decide the one condition.
      name: "contact and non-contact moves aimed at the holder",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users: Vapor Body (5981, attr 0). Declared as an ENGINE QUERY (the engine asks 'does the target have this?' by class name; it is never dispatched, so the always-on trigger is the honest WHEN, and a twin can only compare whole battles) with one real condition (contact, ctor:0 slot, bound to move.flag MAKES_CONTACT) and a typed multiplier. The EFFECT is a package only because the library has no 'multiply accuracy' effect (requested as R-B13-20). Edit made to the engine helper (same file): applyVaporBodyAccuracy now finds the attr and asks IT (condition and multiplier) instead of hard-coding contact and 0.7; with the defaults this is the identical test and the identical multiplication. LIBRARY GAP (L0 will report it until the librarian acts): the class extends AbAttr directly, so no WHEN dispatch key is an ancestor of it (while.active lists its flag classes by name and the accuracy trigger calc.incoming-accuracy dispatches WonderSkinAbAttr); requested as R-B13-19 (list the marker classes as flag keys of while.active, or dispatch them). The decl overrides `provides` because the engine call has the attacker and the move in hand even though the always-on trigger lists only the holder. NOT DECOMPOSED (engine rule, listed under 'also requires'): the trapping half lives in hasEffectiveMoveTrap, which tests presence by class name and the TrapTag's source move for the contact flag; no param or condition is attached to it (R-B13-20). ODDITIES (not fixed): the trap check uses the move's static contact flag (allMoves[...].hasFlag) while the accuracy path uses doesFlagEffectApply, so a contact-ignoring attacker (Long Reach) is not slowed by the accuracy path but its already-applied trap is still ignored.",
});
