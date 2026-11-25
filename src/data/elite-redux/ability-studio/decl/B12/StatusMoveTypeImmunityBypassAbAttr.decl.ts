/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 2. PARKED until the librarian adds the class to the `flagKeys` of the WHEN `while.active` (request R-B12-13); rename this
// file to StatusMoveTypeImmunityBypassAbAttr.decl.ts afterwards. The registry only collects `*.decl.ts`, so it does not load yet.
//
// "My status moves ignore type immunities" (Mycelium Might).
//
// Source: src/data/elite-redux/archetypes/status-move-type-bypass.ts, StatusMoveTypeImmunityBypassAbAttr (extends AbAttr directly,
// `super(false)`). A registration-free marker: it has no canApply and no apply of its own, and is never dispatched. The only reader is
// Pokemon.getMoveEffectiveness (pokemon.ts:4183), which looks for the attr BY CONSTRUCTOR NAME:
//   `move.category === STATUS && typeMultiplier.value === 0 && !ignoreSourceAbility
//     && source.getAllActiveAbilityAttrs().some(a => a.constructor.name === "StatusMoveTypeImmunityBypassAbAttr")`  ->  typeMultiplier = 1
// It undoes only the TYPE chart zero and the powder-vs-Grass zero; ability immunities, tag immunities and a substitute still hold, and
// the status-application immunities (Toxic vs Steel) live in canSetStatus and are handled by IgnoreTypeStatusEffectImmunityAbAttr.
// init-elite-redux-vanilla-rebalance.ts:492 pushes one onto Mycelium Might only when it has none.
// No constructor argument, no closure, no random draw, no state. Tier C, kind while-active, same shape as the IgnoreContact precedent.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { StatusMoveTypeImmunityBypassAbAttr } from "#data/elite-redux/archetypes/status-move-type-bypass";

export default defineDecl(StatusMoveTypeImmunityBypassAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "My status moves ignore type immunities",
  summary: () =>
    "While I have this, my status moves treat a type immunity as a normal hit. Example: Thunder Wave can paralyse a Ground type. Ability immunities still work.",
  synonyms: [
    "status moves bypass immunity",
    "thunder wave on ground",
    "ignore type immunity for status moves",
    "hit ghost with status",
    "mycelium might",
    "no type immunity",
  ],
  examples: ["My status moves hit Pokemon that are normally immune to them by type, like Mycelium Might"],
  params: [],
  noParamsReason:
    "A pure presence flag: the engine only checks that the attr exists (by its class name), so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only status moves are affected; damaging moves keep their type immunities",
    "Immunities that come from an ability, a substitute or a move effect still hold",
    "Does not work when the move ignores the user's abilities",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "Thunder Wave on a Ground type, and on a Pokemon with an immunity ability", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder uses a status move on an immune type.",
  status: "decomposed",
  notes:
    "legacy-closure-pending-request: the WHEN `while.active` does not list this class in its flagKeys (R-B12-13), so L0 cannot accept the declaration yet and the file is parked. Tier C, 1 attr: Mycelium Might (298 attr 3, pushed by the vanilla-rebalance patch; the ability's own text also makes it move last in its bracket, which is another class). The reader matches the attr by constructor NAME (`constructor.name === 'StatusMoveTypeImmunityBypassAbAttr'`), so a rebuilt attr must keep the class name; the engine-query routing (abilityQuery) belongs to the foundation, not to this declaration. Oddity, not fixed: the name scan runs on every effectiveness check of a status move against an immune target and builds the list of the source's active attrs each time.",
});
