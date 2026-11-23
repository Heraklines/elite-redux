/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1. Package (entry half). "When I enter, my base Speed and the fastest foe's base Speed are swapped; over the next 3 turn ends it fades back."
//
// Source: src/data/elite-redux/abilities/borrowed-time.ts, class BorrowedTimeSummonAbAttr (extends PostSummonAbAttr; showAbility true, activateOnGain true).
// Clauses, in order:
//   canApply  `pokemon.getOpponents().some(o => o?.isActive(true))`                        -> feasibility (the swap needs a foe on the field)
//   apply     1. `if (simulated) return`                                                   -> effect-side (respects simulated)
//             2. opponents = active foes; none -> return (the same test again, harmless)
//             3. partner = the foe with the highest RAW Speed (getStat(SPD), a strict `>` so the first foe in field order wins a tie)
//             4. state = { partner, holderBase, partnerBase, diff = holderBase - partnerBase, elapsed 0, turns = decayTurns }, stored in BORROWED_TIME_STATE (a WeakMap keyed by the holder)
//             5. applyDecay: holder.setStat(SPD, max(1, round(holderBase - diff * remaining / turns))) and the mirror value for the partner, remaining = turns - elapsed = turns
// No random draw (a stat comparison; ties by field order). State: the WeakMap above, shared with BorrowedTimeDecayAbAttr.
//
// Why a package (honest limit): the effect reads and writes the PERMANENT Speed stat of two Pokemon (setStat, below stat stages and items), chooses a partner by
// comparing stats, and remembers both originals so the decay half can restore them exactly. The vocabulary has no "swap a raw stat with a foe" effect and no memory of
// stored numbers, so splitting would re-implement the class. The trigger (on entry) is the separate WHEN; the one clause of canApply is feasibility, not a rule staff
// would change. The only number (how many turn ends the swap takes to fade) is a typed param, stored in the state so the decay half follows it.
import { BorrowedTimeSummonAbAttr } from "#data/elite-redux/abilities/borrowed-time";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BorrowedTimeSummonAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Swap Speed with the fastest foe (Borrowed Time)",
  summary: params =>
    `When I enter, my base Speed and the fastest foe's base Speed are swapped. At the end of each of the next ${params.decayTurns} turns, a share of the original gap returns, until both are back to normal.`,
  synonyms: [
    "borrowed time",
    "speed swap",
    "swap speed with foe",
    "steal speed",
    "trade speed stat",
    "speed gap fades",
  ],
  examples: ["When I enter, trade Speed with the fastest foe, then let it fade back over 3 turns"],
  params: [
    {
      id: "decayTurns",
      ctorIndex: 0,
      path: "decayTurns",
      control: "number",
      label: "Turns until both Speeds are back to normal",
      editable: true,
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      integer: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must be on the field",
    "It swaps base Speed (before stat stages and held items), so those still apply on top; the partner is the foe with the highest base Speed, and the first foe wins a tie",
    "Nothing changes in a preview",
  ],
  effect: { id: "effect.package", params: ["decayTurns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "enter against a faster and a slower foe", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified (see the header). 1 attr in 1 ability: Borrowed Time (5910 attr 0). The ability is TWO attrs that share a WeakMap: this entry half and BorrowedTimeDecayAbAttr (attr 1); a rule that uses only one half does nothing useful. Constructor change (behaviour-neutral): the ctor takes decayTurns (default BORROWED_TIME_DECAY_TURNS = 3) and the state remembers it (a new `turns` field), so the decay half and applyDecay follow the number; 3 gives the original arithmetic exactly (diff * remaining / 3). decayTurns must be at least 1 (0 would divide by zero). The swapped stat (Speed) is fixed: the partner is chosen by Speed too, so it is not a free param. Suspected oddity, NOT fixed: the source comment says ties are broken by battler index, but the strict `>` in reduce keeps the first foe in getOpponents() order, which is the same only when that order is the battler order. Another: the swap writes the permanent stat, and a foe that leaves the field keeps decaying off-field by design (documented in the header of borrowed-time.ts).",
});
