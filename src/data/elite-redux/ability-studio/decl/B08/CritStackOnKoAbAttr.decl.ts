/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3 / event-effect, Tier A (nothing to bind, nothing to gate). Read from the source (archetypes/crit-stack-on-ko.ts, the
// parent PostVictoryAbAttr in ab-attrs.ts, the dispatch in phases/faint-phase.ts, the READER in field/pokemon.ts getCritStage)
// and from the live instances of the 2 users (Pretentious, Way of Swiftness).
//
//   dispatch   FaintPhase: when a Pokemon faints from a move, applyAbAttrs("PostVictoryAbAttr", { pokemon: defeatSource }).
//   canApply   the parent's always-true answer (no clause).
//   apply      unless simulated: stacks = min(stacks + perKo, cap), kept in a symbol-keyed field of the holder's Pokemon object.
//   reader     Pokemon.getCritStage scans the attacker's ability attrs BY CLASS NAME ("CritStackOnKoAbAttr") and adds
//              currentStacks(source) to the critical-hit stage. So the class name must never change.
//
// The effect is a package PLACEHOLDER: no library effect keeps a stacking critical-hit bonus (request R-B08-31).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { CritStackOnKoAbAttr } from "#data/elite-redux/archetypes/crit-stack-on-ko";

export default defineDecl(CritStackOnKoAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-win",
  label: "Land critical hits more often after each knock-out",
  summary: params =>
    `Each time I knock out a Pokemon, my critical-hit stage goes up by ${params.perKo}, up to ${params.cap} in total. Example: +1 per knock-out, at most +6.`,
  synonyms: [
    "crit stack",
    "snowball crits",
    "knock out crit boost",
    "critical hit after knock out",
    "pretentious",
    "grows crit rate with kills",
  ],
  examples: ["Each knock-out raises my critical-hit stage by one"],
  params: [
    {
      id: "perKo",
      ctorIndex: 0,
      path: "perKo",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Critical-hit stages gained per knock-out (1-6)",
      editable: true,
      default: 1,
    },
    {
      id: "cap",
      ctorIndex: 1,
      path: "cap",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Most critical-hit stages this can add up to (1-6)",
      editable: true,
      default: 6,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: ["perKo", "cap"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "none",
    rngOrder: [],
    state: "battle",
    simulated: "respects",
  },
  probes: [{ name: "the holder knocks out the foe", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, nothing to bind: the class has no closure and no gate (the parent's canApply is always true). The effect is a package PLACEHOLDER, written reason: the pieces share a counter that lives on the holder (a symbol-keyed field) and is READ by name inside Pokemon.getCritStage, so it cannot be split into library blocks without re-implementing the class; request R-B08-31 asks for `effect.stack-crit-stage`. Typed settings: stages per KO and the cap (the stacks are clamped with Math.min, not validated in the constructor, so the sliders stop at 6). ODDITIES, NOT FIXED: (1) the counter is stored on the Pokemon object, which is never rebuilt between waves for the player's party, so the stacks are NEVER reset: not by switching out, not by the next battle (the file header says only 'accumulating, capped'); `state` is recorded as battle because that is the closest value, it really lives for the whole run. (2) getCritStage reads the stacks of EVERY CritStackOnKoAbAttr the holder has, so two such attrs would each add the same counter (the counter is shared per Pokemon, not per attr). (3) The on-win moment is only dispatched when the defeated Pokemon took at least one attack this turn. Users (2): Pretentious, Way of Swiftness (attr 0 each). The class name is read by the engine, so it must not be renamed.",
});
