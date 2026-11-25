/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1. Tier C, engine-query marker. "In doubles I take half of the direct damage aimed at my ally; in singles, after I switch out on purpose, my replacement
// sends a quarter of the direct damage it takes to me for a while."
//
// Source: src/data/elite-redux/abilities/chivalry.ts, class ChivalryAbAttr (extends AbAttr; showAbility false). NOTHING is dispatched by applyAbAttrs: `apply` is
// empty and there is no canApply. The engine finds the attr BY CONSTRUCTOR NAME (pokemonCarriesChivalry, getAllActiveAbilityAttrs) in two places:
//   1. Pokemon.damageAndUpdate (src/field/pokemon.ts, after the damage animation, only for DIRECT damage with a source and damage > 0):
//      damage -= erApplyChivalry(victim, damage):
//        a. ally transfer: the first living, active ally of the victim that carries Chivalry takes toDmgValue(damage * allyShare, 1) as a RAW hit
//           (damageAndUpdate with result INDIRECT when it is on the field, a plain HP write when it is off the field, never a faint phase off the field); that amount is
//           removed from the victim's damage. Nothing is dealt if the share is 0 or less.
//        b. switch redirect: when the victim carries a mark made by markChivalryRedirect, and the mark has not expired (battle turn <= expiryTurn) and the holder is not
//           fainted, the holder takes toDmgValue((damage - transferred) * switchShare, 1) the same raw way. An expired mark or a fainted holder deletes the mark.
//   2. SwitchSummonPhase (src/phases/switch-summon-phase.ts): when the holder switches out by the menu "Switch" command (not a forced switch), the incoming Pokemon is
//      marked: { holder, expiryTurn = current battle turn + redirectTurns, share = the holder's switchShare }.
// The three numbers were module constants (0.5, 0.25 and +1 turn); they are now constructor arguments with the old values as defaults (behaviour-neutral), and the
// engine functions read them from the holder's live attr (chivalryAttrOf), falling back to the old constants if no attr is found. No random draw.
// State: CHIVALRY_REDIRECT, a WeakMap keyed by the switched-in Pokemon.
//
// Declared `engine-query` (spec 1.4, like the Levitate/Float precedent): the whole effect lives in two engine call sites that the library has no moment for, so the
// foundation owns the routing. The conditions that matter (a direct hit, doubles with a living ally, a voluntary switch, the mark not expired) are inside those
// call sites and cannot be separated until the library has the moments requested below. Tier C: extra IFs cannot be added (`if: false`).
import { ChivalryAbAttr } from "#data/elite-redux/abilities/chivalry";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ChivalryAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Take part of the damage meant for my ally or my replacement",
  summary: params =>
    `While I have this, in doubles I take ${Math.round(Number(params.allyShare) * 100)}% of the direct damage aimed at my ally. In singles, after I switch out on purpose, my replacement sends ${Math.round(Number(params.switchShare) * 100)}% of direct damage to me for ${params.redirectTurns} turn(s).`,
  synonyms: [
    "chivalry",
    "protect ally",
    "share damage",
    "take hits for a partner",
    "damage transfer",
    "knight",
    "guardian",
  ],
  examples: [
    "I take half of the damage my ally would take in doubles",
    "My replacement sends a quarter of its damage to me after I switch out",
  ],
  params: [
    {
      id: "allyShare",
      ctorIndex: 0,
      path: "allyShare",
      control: "number",
      label: "Share of damage to my ally that I take (0.5 = half)",
      editable: true,
      default: 0.5,
      min: 0.05,
      max: 1,
      step: 0.05,
    },
    {
      id: "switchShare",
      ctorIndex: 1,
      path: "switchShare",
      control: "number",
      label: "Share of damage to my replacement that I take after switching out (0.25 = a quarter)",
      editable: true,
      default: 0.25,
      min: 0.05,
      max: 1,
      step: 0.05,
    },
    {
      id: "redirectTurns",
      ctorIndex: 2,
      path: "redirectTurns",
      control: "number",
      label: "Turns the switch redirect lasts (1 = the rest of this turn and the whole next turn)",
      editable: true,
      default: 1,
      min: 1,
      max: 5,
      step: 1,
      integer: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only direct damage from a Pokemon counts; recoil, weather, poison and other indirect damage never moves to me",
    "The part I take is dealt as raw HP loss: my defenses, damage reduction and resistances do not lower it; if I am off the field I just lose the HP and never trigger a faint",
    "The doubles part needs a living ally of the target on the field; the switch part only starts after a switch I chose in the menu, not a forced one",
    "The amount moved is removed from the damage my ally or replacement takes",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "The attr is never dispatched (the engine finds it by name in Pokemon.damageAndUpdate and SwitchSummonPhase), so the twin compares whole battles; B15/chunk1.test.ts drives the transfer and the redirect through the engine functions.",
  probes: [{ name: "a hit on my ally and a hit after a voluntary switch", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C engine-query, 1 attr in 1 ability: Chivalry (5909 attr 0), no binding. Constructor change (behaviour-neutral): allyShare (0.5), switchShare (0.25) and redirectTurns (1) are ctor arguments; the redirect mark stores its own share and expiry. REQUESTS (R-B15-1 to R-B15-3 in requests/B15.md): the flagKeys line for WHEN `while.active`, a moment 'When my ally takes a direct hit' with an effect 'Take a share of that damage as raw HP loss', and a moment 'When I switch out by choice' with an effect 'Mark my replacement so a share of its direct damage comes back to me for N turns'; until they exist the trigger and the effect stay in the engine and this is counted legacy-closure-pending-request. Suspected oddities, NOT fixed: (1) if a victim has more than one ally carrying Chivalry only the first one found takes the share; (2) erApplyChivalry runs before Soulmate's redirect and Endless damage in damageAndUpdate, so the order of the three redirections is fixed by the call order there; (3) the off-field holder can lose HP to 0 without a faint phase (documented as intended in the file header); (4) the share is rounded by toDmgValue(x, 1), so a hit of 1 damage moves at least 1, leaving the victim with 0 from that hit.",
});
