/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Quick Draw and Minigun (Tier B, RNG inside canApply). "While the game decides who jumps the turn order, roll a chance;
// if I chose a damaging move, move before the others of my priority this turn and remember that this ability did it".
//
// Source: ability-upgrades/attrs/bypass-speed-provenance.ts (this class) over BypassSpeedChanceAbAttr (ab-attrs.ts:7011).
// Dispatch: applyAbAttrs("BypassSpeedChanceAbAttr", ...) from the turn-order code (calc.speed-bypass).
//
// canApply, in the ORIGINAL clause order (now guards && gate && residual):
//   guards    !simulated                          a preview never rolls (the parent's TODO: it could move into apply)
//   gate      randBattleSeedInt(100) < chance     the ONLY draw; it happens before the move test, so it is drawn even
//                                                 when the chosen move is a status move
//   residual  the move chosen this turn is physical or special  &&  pokemon.canAddTag(BYPASS_SPEED)
// apply: addTag(BYPASS_SPEED), then claimCommandAbilityProvenance(holder, provenanceKey) (the per-turn memo that Quick
// Draw's own x2 power rider (attr 1 of Quick Draw), the Gunman 1.2 power rider (init-elite-redux-ability-upgrades.ts:940)
// and the Pulse-move heal bonus (data/moves/move.ts:3301) read to know "the speed jump happened this turn").
import { ProvenanceBypassSpeedChanceAbAttr } from "#data/elite-redux/ability-upgrades/attrs/bypass-speed-provenance";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ProvenanceBypassSpeedChanceAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.speed-bypass",
  label: "Sometimes jump ahead in the turn order",
  summary: params =>
    `${params.chance}% chance each turn, when I choose a damaging move, to move before others of the same priority. Example: 30 is about one turn in three.`,
  synonyms: ["quick draw", "minigun", "quick claw", "move first", "jump the queue", "go first sometimes", "speed jump"],
  examples: ["30% chance to move first when I pick an attack, like Quick Draw"],
  params: [
    {
      id: "chance",
      ctorIndex: 0,
      path: "chance",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance each turn (%)",
      editable: true,
      default: 30,
    },
    {
      id: "memoName",
      ctorIndex: 1,
      path: "provenanceKey",
      control: "text",
      label: "Turn memo name that other abilities look for (leave as is)",
      editable: false,
      gateIndependent: true,
      default: "quick-draw:proc",
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is the single atom rng.chance with the user's own chance (bindings.ts).
    { slot: "gate", ctx: "params", lib: "rng.chance", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Nothing is rolled while the game is only previewing the turn order",
    "I must have chosen a damaging (physical or special) move this turn; the chance is still rolled for a status move",
    "I must not already have the speed jump this turn",
  ],
  effect: { id: "effect.package", params: ["memoName"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply gate: one roll of 0 to 99 against the chance, drawn even when the chosen move is a status move, and not drawn while simulated",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [{ name: "a quiet turn where the holder picks a status move", axes: {} }],
  l2StaticReason:
    "The twin template for this trigger only has the holder choose Celebrate (a status move), so the jump itself cannot happen there; B18/quick-draw.test.ts drives the damaging-move case, the status-move case, the simulated case and the draw order directly.",
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: it is two writes that must stay together, adding the BYPASS_SPEED tag and writing the per-turn memo (claimCommandAbilityProvenance) that Quick Draw's x2 power rider, the Gunman 1.2 power rider and move.ts:3301 read; the library has no 'jump the turn order and remember who did it' effect (request R-B18-2), and effect.apply-tag would drop the memo. The trigger (calc.speed-bypass) and the chance (rng.chance, bound as the gate) are separate blocks. Clauses: !simulated is a class guard (no registered guard id fits, request R-B18-1), the chance roll is the gate, 'I chose a damaging move' (turnCommands lookup) and canAddTag are the residual; R-B18-3 asks for an atom for the chosen-move test so only canAddTag stays in the class. KNOWN DIFFERENCE (not fixed): the class always draws randBattleSeedInt(100) even at chance 100, while rng.chance skips the draw at 100 or more; no ability uses 100, so every shipped ability is identical and only a staff-made 100% rule would draw one number fewer. The class overrides canApply and duplicates the parent's clauses (the parent BypassSpeedChanceAbAttr, in ab-attrs.ts, belongs to another batch and is untouched). Users: Quick Draw (259, attr 0), Minigun (5996, attr 0), both 30 and key quick-draw:proc. The memo is turn data, so state is none. PROOF LIMITS: L1 does not notice a wrong pct in the gate binding because recomposeAttr rewrites the binding's pct from the live chance (gateParams), and the grid's seeded rolls never land on exactly 30; B18/chunk1.test.ts therefore pins the draw ranges, the roll boundary (29 passes, 30 fails), the status-move draw, the simulated case and the already-tagged case against the original. Mutation check: removing move.damaging from the first-turn gate binding made L1 fail on Swords Dance for both users.",
});
