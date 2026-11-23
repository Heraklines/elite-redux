/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14. Tier B. "After a punching move of mine hits, every move still queued that aims at a foe is re-aimed at the
// next foe along."
//
// canApply, original clause order, now `guards && gate && residual`:
//   guards    1. !simulated                            not while the game only previews a hit
//             2. damage > 0                            the hit dealt damage
//             3. hitResult < HitResult.NO_EFFECT       it was a real hit (EFFECTIVE .. ONE_HIT_KO), not a block
//   gate      4. move.hasFlag(PUNCHING_MOVE)           the move's OWN punching flag (not doesFlagEffectApply)
//   residual  5. the holder has an active SouthernCrossPunchAbAttr   (true whenever this attr was dispatched; it only
//                matters if the attr is rebuilt onto another ability or the ability is suppressed)
// Nothing is random. Clauses 1 to 3 are not conditions: if staff removed them the effect would fire on a move that
// did nothing, which is a bug, not a design choice (guards requested in requests/B14.md, listed under feasibility
// until they exist). Clause 4 is the condition.
//
// apply: `rotateSouthernCrossPunchTargets(holder)`: needs at least two active foes; maps each foe slot to the next one
// (cyclic), and rewrites `targets` of EVERY command of `battle.turnCommands` (also commands that already ran).
//
// The gate binding is LEGACY: clause 4 uses `move.hasFlag`, which differs from the library atom `move.flag`
// (doesFlagEffectApply also counts flags that abilities inject). An atom `move.has-own-flag` is requested.
// The effect is a package: it rewrites the battle's queued commands and the library has nothing like it.
import { SouthernCrossPunchAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SouthernCrossPunchAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-my-hit",
  label: "Re-aim queued attacks at the next foe",
  summary: () =>
    "Every move still queued this turn that aims at a foe is re-aimed at the next foe over. Example: with two foes, the targets swap.",
  synonyms: [
    "southern cross punch",
    "retarget",
    "redirect attacks",
    "swap targets",
    "rotate targets",
    "punch",
    "double battle",
  ],
  examples: ["After a punch hits, the foes' targets are shifted one slot to the right"],
  params: [],
  noParamsReason:
    "The class takes no constructor argument: the flag (punching moves) and the shift (one foe slot along) are fixed inside it, and the effect has no number or type to set.",
  conditions: [
    // Gate = [move has its own PUNCHING_MOVE flag]. Removable: "after any hit" is a valid design.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must really have hurt the target (it dealt damage and was not blocked), and the game must not be only previewing",
    "I must still have this ability active",
    "There must be at least two foes on the field to rotate between",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder attacks", axes: {} }],
  l2StaticReason:
    "The gate binding is a legacy closure (no atom for a move's own flag yet), so the twin has no rebuilt attr to compare; the Tier B split is proven by test/tests/elite-redux/decomp/B14/gate-split.test.ts instead.",
  status: "decomposed",
  notes:
    "Package, reason: the effect rewrites `battle.turnCommands[*].targets` and `command.move.targets` for every queued command; no library effect touches the turn queue (requested as effect.rotate-queued-targets). Users (1): Southern Cross Punch (6016) attr 0 (its only attr). Gate legacy-closure pending move.has-own-flag; the guards need not-simulated and hit-dealt-damage (requested). The inherited attackCondition (constructor argument 0, default `move.category !== STATUS`) is never read: this canApply does not call super. Oddities, not fixed: (1) the class rewrites commands that already executed this turn as well as later ones, harmless but wider than the description 'later intended targets'; (2) the rotation also re-aims the holder's own queued command and its ally's; (3) clause 5 is redundant for the shipped ability.",
});
