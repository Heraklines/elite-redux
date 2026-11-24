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
//      when the partner already hit THIS target this turn (turn-attack-ledger.ts allyHitTargetThisTurn) -> power *= powerMultiplier (1.2), else 1                     -> condition + effect
//   b. erRendezvousOnHit(user, target), read in batch3-on-hit.ts after a hit: same pair and ledger test; then once per PAIR per turn (module variable healedKey = wave:turn:lowest id) -> for user and
//      partner, unless fainted or at full HP: heal(toDmgValue(maxHp * healFraction, 1)) (5%)                                                                       -> condition + memory + effect
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
      default: 5,
      codec: percentCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Needs a living ally on the field to link to; in singles it does nothing",
    "Both partners must still be on the field and linked; the link ends when either leaves",
    "Only when the partner already hit the SAME target earlier this turn",
    "The heal happens once per pair per turn, even for a spread move, and skips a partner that has fainted or is at full HP",
    "The power boost and the heal are built into the game's damage handling, not into this block's entry moment; the link is made on entry",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["powerMultiplier", "healPercent"] },
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
    "PACKAGE, justified. 1 attr in 1 ability: Rendezvous (5919 attr 0, x1.2 and 5%). The entry trigger is a separate swappable WHEN and the class has no condition of its own, but the two conditions that make the ability work (the linked ally already hit THIS target this turn; the heal only once per pair per turn) live in the engine seams, not in the class, so they cannot be separate blocks today. It cannot be split because the library has none of the pieces: 'link to my nearest ally' (the same effect Heartbreak needs, R-B15-13), a calc moment 'while the game calculates my move's power' with the condition 'my linked ally already hit this target this turn' (the existing effect.multiply-power would then do the boost), and a moment 'after the second attack on a target' with the effect 'heal me and my linked ally by N% of max HP once per turn'; requested as R-B15-37. Both numbers are typed settings (constructor arguments, old constants as defaults; the heal is shown as a percent). The only draw is the partner pick in triples. Suspected oddities, NOT fixed: (1) the heal memory (healedKey) is ONE module variable shared by every pair in the game and holds only the latest key: if a second pair heals in the same turn it overwrites the first pair's key, so the first pair could heal a second time that turn; (2) the code comment says the holder's Rendezvous grants the effect to whichever of the two acts second, so the partner without the ability is boosted too; (3) with several Rendezvous holders in triples only the first attr found on the user or partner supplies the numbers; (4) singles: inert, as documented.",
});
