/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 5. Package (Tier C). "When I enter I link to my nearest living ally; while linked I take a share of the direct damage my ally takes, and my ally gets a share of the direct healing I receive."
//
// Source: src/data/elite-redux/abilities/soulmate.ts, class SoulmateAbAttr (extends PostSummonAbAttr; constructor passes showAbility false, activateOnGain true;
// two constructor arguments now, damageShare and healShare). No canApply of its own (PostSummonAbAttr answers true), so there is no condition, guard or gate in the class.
// apply: unless simulated, formLink(holder) (link.ts, the same function Heartbreak uses): keeps an existing live link; else candidates = holder.getAdjacentAllies() that are active and not
//   already linked; none -> nothing; ONE candidate -> it; several (triples) -> candidates[globalScene.randBattleSeedInt(candidates.length)] (the only random draw, apply side, never when simulated).
// The DAMAGE and HEAL halves are NOT in this class; they are engine seams that find the marker by constructor name:
//   * Pokemon.damageAndUpdate calls erApplySoulmateRedirect(victim, incomingDamage) for DIRECT damage with a source and damage > 0: partner = getLinkedAlly(victim); needs an ACTIVE, unsuppressed
//     Soulmate on the partner (found by constructor name) that is not fainted; share = toDmgValue(damage * damageShare, 1); the partner takes it as a raw INDIRECT damageAndUpdate (no defence
//     recalculation, cannot re-trigger the redirect); the amount is removed from the victim's damage.
//   * Pokemon.heal calls erApplySoulmateHealCopy(holder, healedAmount) with the amount ACTUALLY healed: a module recursion flag (copyingHeal) blocks re-entry; needs healedAmount > 0 and an active
//     Soulmate on the healer; ally = getLinkedAlly(holder) must exist, not be fainted and not be at full HP; copy = toDmgValue(healed * healShare, 1); ally.heal(copy) under the recursion flag.
// Constructor change (behaviour-neutral): damageShare (default 0.25) and healShare (default 0.5), the old literals, are constructor arguments; both seams read them from the live attr
// (soulmateAttrOf finds the same attr the old hasSoulmate test found, with the same isActive(true) first).
import { SoulmateAbAttr } from "#data/elite-redux/abilities/soulmate";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SoulmateAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Link to my ally and share damage and healing with it",
  summary: params =>
    `When I enter I link to my nearest living ally. While linked I take ${Math.round(Number(params.damageShare) * 100)}% of the direct damage my ally takes, and my ally gets ${Math.round(Number(params.healShare) * 100)}% of the direct healing I receive. No ally, no effect.`,
  synonyms: [
    "soulmate",
    "share damage with my partner",
    "split damage with an ally",
    "share healing with my ally",
    "link with my doubles partner",
    "bodyguard for my ally",
    "doubles link",
  ],
  examples: [
    "In doubles I take a quarter of my partner's hits and it gets half of my healing",
    "A soul link that spreads damage and recovery between two allies",
  ],
  params: [
    {
      id: "damageShare",
      ctorIndex: 0,
      path: "damageShare",
      control: "slider",
      min: 0.05,
      max: 1,
      step: 0.05,
      label: "Share of my ally's direct damage that I take (0.25 = 25%)",
      editable: true,
      default: 0.25,
    },
    {
      id: "healShare",
      ctorIndex: 1,
      path: "healShare",
      control: "slider",
      min: 0.05,
      max: 1,
      step: 0.05,
      label: "Share of my direct healing that my ally gets (0.5 = 50%)",
      editable: true,
      default: 0.5,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Needs an adjacent living ally on the field; in singles it does nothing",
    "In triples with two possible allies one is picked with a seeded roll, and an ally that is already linked is skipped",
    "Only direct damage with a source counts; the share I take is raw damage, so my defenses and abilities such as Multiscale do not reduce it",
    "The copied healing never copies again, and an ally at full HP gets nothing",
    "The damage and healing halves are built into the game's damage and healing handling and are not part of this block",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["damageShare", "healShare"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: formLink picks one of several adjacent allies with one seeded draw (triples only, never when simulated)",
    ],
    state: "battle",
    simulated: "respects",
  },
  probes: [{ name: "enter next to an ally", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified. 1 attr in 1 ability: Soulmate (5918 attr 0). The entry trigger is a separate swappable WHEN and the class has no condition, guard or gate (PostSummonAbAttr answers true). The effect is a soul link plus two engine reactions: the library has no 'link two Pokemon' effect (state in link.ts; the same missing block as Heartbreak, R-B15-13), no moment 'when my linked ally takes direct damage' with a 'take a share of it' effect (the same shape as Chivalry's R-B15-2, but through the link instead of the adjacent ally; R-B15-41) and no moment 'when I am healed' with a 'copy a share to my linked ally' effect (R-B15-42). Both shares are typed params read from the holder's live attr by the seams. Why it cannot be split further today: the link is one shared state with the two halves that read it (formLink in apply, getLinkedAlly in both seams), the seams are driven from Pokemon.damageAndUpdate and Pokemon.heal by constructor name, not from a dispatched moment, and a split would need the three library blocks above. Suspected oddities, NOT fixed: (1) the redirect gate reads the link with getLinkedAlly(victim) and then asks the PARTNER for the marker, so the holder redirects damage only while it is itself ACTIVE and not fainted, and a holder that left the field stops sharing (intended); (2) the heal copy is computed from the ACTUAL amount healed, so overheal is not copied; (3) formLink skips allies that are already linked, so a holder next to an ally that Heartbreak linked first gets no link; (4) the recursion guard is a module variable shared by every holder, which is safe only because battle code is single threaded; the copied heal runs inside try/finally so the flag always resets.",
});
