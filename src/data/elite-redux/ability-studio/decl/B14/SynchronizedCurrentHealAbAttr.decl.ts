/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 5. Tier B event-effect. "At the end of the turn, if my ally is on the field and neither of us attacked, both of us
// recover a share of max HP" (Synchronized Current: 1/4 each).
//
// Source: plusle-minun.ts SynchronizedCurrentHealAbAttr (extends PostTurnAbAttr, dispatched when I am at the end of the turn).
// canApply, original clause order, is now `guards && gate` with no guard and no residual (the whole original is the gate):
//   gate  1. `activeAlly(pokemon) !== undefined`      an ally is on the field and active (the first ally with isActive(true))  (R-B14-5.8)
//   gate  2. `!attackedThisTurn(pokemon)`             I did not attack: `turnData.acted` false, or my last move is a status move,
//                                                     none, or missing                                                        (R-B14-5.10)
//   gate  3. `!attackedThisTurn(ally)`                the same for the ally                                                    (R-B14-5.10)
// apply (original, only the 0.25 became `this.healFraction`):
//   a. `if (simulated) return`                                              (a preview heals nothing)
//   b. `ally = activeAlly(pokemon)`; return when there is none
//   c. reset the shared memory when the wave:turn key changed (`syncHealTurnKey`, `syncHealedThisTurn`, module level)
//   d. syncCurrentHealOnce(pokemon) then syncCurrentHealOnce(ally): skip a mon already healed this turn, a full-HP mon or an inactive
//      one; otherwise remember it and `mon.heal(toDmgValue(maxHp * fraction, 1))` (a whole number, at least 1)
// No random draw. The shared per-turn memory (module level, keyed by wave and turn, holding mon ids) exists so that two partners that
// both carry the ability heal the pair once (1/4), not twice (1/2).
// The gate binding is LEGACY (atoms R-B14-5.8 and R-B14-5.10 are missing). Planned tree, clause order kept:
//   all[ party.ally-active, not time.attacked-this-turn{holder}, not time.attacked-this-turn{ally} ]
// Class edit (pure move of code): the 1/4 is a constructor argument with the old value as default; `syncCurrentHealOnce` takes it.
import { SynchronizedCurrentHealAbAttr } from "#data/elite-redux/abilities/plusle-minun";
import { percentOfMaxHpCodec } from "#data/elite-redux/ability-studio/decl/B14/chunk5-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SynchronizedCurrentHealAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Heal me and my ally by a share of max HP (once a turn each)",
  summary: params =>
    `At the end of the turn, my ally and I each recover ${params.healPercent}% of our max HP, at most once per turn. Example: 25 = a quarter of max HP.`,
  synonyms: [
    "synchronized current",
    "heal both",
    "heal the pair",
    "heal my partner",
    "team recovery",
    "rest together",
    "ally regeneration",
  ],
  examples: [
    "If neither my ally nor I attacked this turn, we both recover a quarter of our max HP, like Synchronized Current",
  ],
  params: [
    {
      id: "healPercent",
      ctorIndex: 0,
      path: "healFraction",
      control: "number",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Share of max HP each one recovers (% of max HP)",
      editable: true,
      default: 25,
      codec: percentOfMaxHpCodec,
      // Only the effect reads it; the gate never repeats it.
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [an active ally exists, I did not attack, the ally did not attack] (bindings.ts, legacy until R-B14-5.8 and 5.10).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing while the game is only previewing",
    "Each of the two recovers at most once per turn, even when both of them have this",
    "A partner that is at full HP or no longer on the field is skipped",
    "Every recovery is a whole number of at least 1 HP",
  ],
  effect: { id: "effect.heal-percent", params: ["healPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "the turn ends with two Pokemon on my side", axes: {} }],
  l2StaticReason:
    "The gate binding is a legacy closure (no atom for an active ally or for attacking this turn yet), so the twin has no rebuilt attr to compare; B14/chunk5.test.ts proves the Tier B split against a literal copy of the original canApply over every state of its clauses and drives apply in a real double battle (heal amounts, once per turn, preview).",
  status: "decomposed",
  notes:
    "Tier B event-effect. Effect = the library heal-percent, whose target options have no 'me and my ally' (R-B14-5.11 asks for that target and for the once-per-turn rule); the 25% is a constructor argument (default 0.25) shown as a whole percent. Users (1): Synchronized Current (5921) attr 2. The gate is a legacy binding (atoms R-B14-5.8 active ally and R-B14-5.10 attacked this turn). 'Attacked' is not `turnData.acted`: it needs acted AND a last move that is not None and not a status move, so a fully paralyzed, asleep, flinched or switched mon counts as not attacking (the class comment calls the old positive 'used a status move' check a bug it fixed). Oddities, not fixed: (1) the heal is `mon.heal(...)` directly, not a heal phase, so Heal Block is not consulted (that check lives in the heal phase) and no heal message or ability flyout is shown; (2) the shared once-per-turn memory is module level and is only reset by the next apply, keyed by wave and turn, so it is shared by every holder in every battle; (3) it heals the ally even when the ally does not carry the ability, which is intended (class comment); (4) in a triple battle only the first active ally is healed. The ability-level conditions are none.",
});
