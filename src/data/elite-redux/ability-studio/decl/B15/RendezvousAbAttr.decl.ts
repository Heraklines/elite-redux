/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 4. Package (Tier C). "On entry I link to my nearest ally. When we both attack the same foe in a turn, the second attack gets +20% power and we both heal 5% of max HP (once per pair per turn)."
//
// Source: src/data/elite-redux/abilities/rendezvous.ts, class RendezvousAbAttr (extends PostSummonAbAttr; constructor passes showAbility false, activateOnGain stays true). No canApply of its own
// (PostSummonAbAttr answers true), so there is no condition, guard or gate in the class. apply (the entry half), in order:
//   1. if simulated: return                                                   -> effect-side
//   2. formLink(holder): keep a live link, else pick the nearest living ally not already linked (getAdjacentAllies); with exactly one candidate no draw; with two (triples) ONE seeded draw
//      (globalScene.randBattleSeedInt(candidates.length)). Singles: nothing to link to, the ability is inert.
// The REAL mechanic is NOT in apply; two engine seams find the holder's attr by constructor name (either end of the linked pair may carry it):
//   a. erRendezvousPowerMultiplier(user, target), read in Move.calculateBattlePower (src/data/moves/move.ts:1435): rendezvousPair(user) (the linked partner, and a Rendezvous attr on user or partner);
//      when attr.gateHolds({ user, partner, target }) (gate = the partner already hit THIS target this turn, turn-attack-ledger.ts allyHitTargetThisTurn) -> power *= powerMultiplier (1.2), else 1   -> gate condition + effect.multiply-power
//   b. erRendezvousOnHit(user, target), read in batch3-on-hit.ts after a hit: same pair and the same gate; then the residual (once per PAIR per turn: module variable healedKey = wave:turn:lowest id, now behind healKeyOf) -> for user and
//      partner, unless fainted or at full HP: heal(toDmgValue(maxHp * healFraction, 1)) (5%)                                                                       -> condition + memory + effect
// Refactor (pure move of code, spec 3.1): the ledger test is the class's `gate` (replaceable, `gateOverride`, read through gateHolds by both seams) and the once-per-pair-per-turn test is its `residual` (heal seam only). Same tests, same order.
// Constructor change (behaviour-neutral): the power factor and the heal share are constructor arguments (defaults 1.2 and 0.05, the old module constants); both seams read them from the live attr.
import { RendezvousAbAttr } from "#data/elite-redux/abilities/rendezvous";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";

/** Staff see a percent (5), the constructor wants a fraction (0.05). */
const percentCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? Math.round(raw * 10000) / 100 : undefined),
};

export default defineDecl(RendezvousAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Link to my ally so attacks on the same foe boost and heal us",
  summary: params =>
    `On entry I link to my nearest ally. When we both hit the same foe in a turn, the second hit gets x${params.powerMultiplier} power and we both heal ${params.healPercent}% of max HP, once per turn.`,
  synonyms: [
    "team up on one target",
    "partner attack bonus",
    "double team boost",
    "ally combo",
    "linked allies",
    "same target bonus",
  ],
  examples: ["In doubles, when my partner and I hit the same foe, the second hit is 20% stronger and we both heal 5%"],
  params: [
    {
      id: "powerMultiplier",
      ctorIndex: 0,
      path: "powerMultiplier",
      control: "number",
      min: 1,
      max: 4,
      step: 0.05,
      label: "Power multiplier of the second attack (1.2 = 20% stronger)",
      editable: true,
      gateIndependent: true,
      default: 1.2,
    },
    {
      id: "healPercent",
      ctorIndex: 1,
      path: "healFraction",
      control: "number",
      min: 0,
      max: 100,
      step: 1,
      integer: true,
      label: "HP both partners heal (% of max HP)",
      editable: true,
      gateIndependent: true,
      default: 5,
      codec: percentCodec,
    },
  ],
  conditions: [
    // The gate is 'my linked ally already hit this target this turn' (turn attack ledger). Legacy closure: no library atom reads the ledger yet (R-B15-37).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Needs a living ally on the field to link to; in singles it does nothing",
    "Both partners must still be on the field and linked; the link ends when either leaves",
    "The heal needs the partner to have hit the SAME target earlier this turn (the same test as the power boost, the gate)",
    "The heal happens once per pair per turn, even for a spread move, and skips a partner that has fainted or is at full HP",
    "The power boost and the heal are built into the game's damage handling, not into this block's entry moment; the link is made on entry",
    "It does nothing in a preview",
  ],
  // Two seams, two effects, one shared gate. The link itself is the entry moment (this class's apply).
  branches: [
    {
      label: "Boost the second hit",
      conditions: ["gate: my linked ally already hit this target this turn"],
      effect: { id: "effect.multiply-power", params: ["powerMultiplier"] },
    },
    {
      label: "Heal both of us",
      conditions: [
        "gate: my linked ally already hit this target this turn",
        "this pair has not healed yet this turn (kept in the class)",
      ],
      // Package: no block heals me and a linked ally by a share of max HP once per turn (R-B15-37).
      effect: { id: "effect.package", params: ["healPercent"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply (entry): only in triples with two eligible allies, ONE seeded draw picks the partner; with one candidate there is no draw",
    ],
    state: "battle",
    simulated: "respects",
  },
  l2StaticReason:
    "The class apply only forms the link on entry (and needs a doubles ally to do anything); the power boost and the heal are read by the damage and hit handling by constructor name, which is not a dispatched moment; the twin compares whole battles of the one user instead.",
  probes: [{ name: "enter and let two turns pass", axes: {} }],
  status: "decomposed",
  notes:
    "Partly a package. 1 attr in 1 ability: Rendezvous (5919 attr 0, x1.2 and 5%). The class is the entry link (R-B15-13) plus two seams that read it by constructor name. The condition 'my linked ally already hit THIS target this turn' is now the class's own `gate` (bound as a legacy closure in bindings.ts, 5919 attr 0, because no library atom reads the turn attack ledger) and the once-per-pair-per-turn test is its `residual`; both seams run the same gate. The power boost is the library effect effect.multiply-power (branch 1, not a package); only the heal (branch 2: heal me and my linked ally by N% of max HP once per turn) and the link are packages or requests, R-B15-37. The moments 'while the game calculates my move's power' and 'after the second attack on a target' are still engine seams, not WHENs. Both numbers are typed settings (constructor arguments, old constants as defaults; the heal is shown as a percent). The only draw is the partner pick in triples. Suspected oddities, NOT fixed: (1) the heal memory (healedKey) is ONE module variable shared by every pair in the game and holds only the latest key: if a second pair heals in the same turn it overwrites the first pair's key, so the first pair could heal a second time that turn; (2) the code comment says the holder's Rendezvous grants the effect to whichever of the two acts second, so the partner without the ability is boosted too; (3) with several Rendezvous holders in triples only the first attr found on the user or partner supplies the numbers; (4) singles: inert, as documented.",
});
