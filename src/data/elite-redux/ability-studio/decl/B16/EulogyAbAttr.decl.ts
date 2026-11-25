/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 3 (Tier B, event-effect). "When I faint, one fainted party member (not a boss) comes back with half its HP and no status.
// Works once per battle."
//
// Source: fakemon-pitch-mechanics.ts, EulogyAbAttr (extends PostFaintAbAttr). Constructor `(revivePercent = 50)`: the new argument
// replaces the literal `0.5` (`Math.floor(maxHp * 50 / 100)` equals `Math.floor(maxHp * 0.5)` for every whole max HP).
// canApply, original clause order, now `gate && residual`:
//   gate      1. !holder.battleData.erAbilityProvenance.includes("eulogy:spent")   "I have not used my one revival this battle"
//                                                                                  -> NO library atom yet (R-B16-17)
//   residual  2. party.some(ally => ally !== holder && ally.isFainted() && !ally.isBoss())   a party member exists to bring back
//                (party = the holder's own side: player party, or enemy party for an enemy holder)
// apply (skipped when `simulated`), in this order:
//   a. ally = the FIRST party member that is not me, is fainted and is not a boss (party order)
//   b. holder.battleData.erAbilityProvenance.push("eulogy:spent")                 the marker is written BEFORE the revival
//   c. ally.resetStatus(true, false, false, false)                               clears its status
//   d. ally.hp = Math.max(1, Math.floor(ally.getMaxHp() * revivePercent / 100))   brings it back
//   e. ally.updateInfo()
// No random draw. State: the marker lives in the holder's BATTLE memory (it survives switching out and lasts until the battle ends).
import { EulogyAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(EulogyAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.faint",
  label: "Bring back a fainted party member when I faint (once)",
  summary: params =>
    `When I faint, one fainted party member (never a boss) comes back with ${params.percent}% of its max HP and no status. Works once per battle. Example: 50 = half HP.`,
  synonyms: [
    "eulogy",
    "revive a teammate",
    "bring back an ally",
    "last wish",
    "resurrect",
    "revive on faint",
    "second chance for an ally",
  ],
  examples: ["When I faint, revive one fainted teammate at half HP, once per battle"],
  params: [
    {
      id: "percent",
      ctorIndex: 0,
      path: "revivePercent",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "HP the party member comes back with (% of its max HP)",
      editable: true,
      gateIndependent: true,
      default: 50,
    },
  ],
  conditions: [
    // The gate: I have not used my revival this battle. Staff may replace or drop it (without it the revival repeats on every faint).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A fainted party member that is not a boss must exist (never myself); the first one in party order is brought back",
    "Its status is cleared and it comes back with at least 1 HP",
    "The revival is marked as used the moment it happens, before the party member is changed",
    "Nothing happens while the game only previews the faint",
  ],
  effect: { id: "effect.package", params: ["percent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "I faint with no fainted party member behind me", axes: { hp: ["max"] } }],
  status: "decomposed",
  l2StaticReason:
    "The shared faint scenario has a single-Pokemon party, so no fainted party member can exist; the shared L1 grid compares canApply and the gate for the one-member party only. test/tests/elite-redux/decomp/B16/chunk3.test.ts builds a party with fainted members (one boss, one ordinary) and drives the original attr and the rebuild side by side.",
  notes:
    "Tier B: trigger (when I faint), one IF in the gate (I have not used my revival this battle) and one effect (bring back a fainted party member at a typed share of its max HP). The effect has no library block (nothing in the library revives a fainted party member: heal-percent targets Pokemon that are alive), so it is effect.package: the reason it cannot be split is that the four steps (mark the revival as used, clear the status, set the HP, refresh the display) act on a fainted party member through direct field writes (`ally.hp = ...`, no revive phase), and a library 'heal' would go through the heal phase and refuse a fainted target. Requested as R-B16-22 (`effect.revive-party-member`). The gate cannot use time.once-per: that atom reads its own memory (a WeakMap keyed by the battle data) and the class's `apply` never writes it, so a rebuilt rule would revive again and again; a marker atom that reads this class's own marker is R-B16-17. `residual` (a fainted non-boss party member exists) is feasibility, not a condition: it is 'the effect has somebody to act on'. User: Eulogy (6046, attr 0). SUSPECTED GAME QUIRKS, not fixed: (1) canApply is checked while the holder is still counted as fainted, which is why the holder is excluded by identity; (2) the revived member is set to alive by writing hp only: it is not re-added to the field and gets no revive animation or message; (3) with `simulated` the marker is not written, so a preview can say 'yes' repeatedly; (4) the marker sits in the holder's battle memory, so a holder that is itself revived and faints again cannot use it again (intended: once per battle).",
});
