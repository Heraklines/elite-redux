/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 / Oracle, first half. Read by hand: fakemon-pitch-mechanics.ts `OracleEntryAbAttr` and `oracleGuardActive`, the
// base PostSummonAbAttr, the dispatch in apply-ab-attrs.ts (the ability flyout is queued on every entry, whether or not
// anything happens) and Oracle's other attrs (ability 6047: 0 scripted Future Sight, 1 this, 2 OracleGuardTickAbAttr,
// 3 ReceivedMoveDamageMultiplierAbAttr with the closure `oracleGuardActive`).
//
// canApply is the inherited `true`, on purpose; the rule runs in `apply`, in the original order:
//   1. feasibility  not simulated
//   2. condition    the first time I enter this battle: `!battleData.erAbilityProvenance.includes("oracle:first-entry")`
//                   -> `gate`, run through gatedCanApply inside apply (NO ATOM: request R3 reads the marker memory)
//   3. effect       battleData.erAbilityProvenance.push("oracle:first-entry"); drop every "oracle:guard:*" marker from
//                   summonData.erAbilityProvenance; push `oracle:guard:${guardTurns}`
// The gate stays in apply and not in canApply because the flyout is queued per entry (apply-ab-attrs.ts), also on a
// re-entry where nothing happens; moving the gate to canApply would remove those flyouts.
// guardTurns used to be the literal 3; it is now the constructor argument (default 3), the shipped ability is unchanged.
import { OracleEntryAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(OracleEntryAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.on-entry",
  label: "Start a timed guard for a few turns",
  summary: params =>
    `The first time I enter this battle, I start a timed guard that lasts ${params.guardTurns} turns. Other effects can look for the guard while it lasts, for example one that halves damage taken.`,
  synonyms: [
    "oracle",
    "first entry shield",
    "opening guard",
    "temporary shield",
    "enter with a barrier",
    "start guard",
  ],
  examples: ["Take half damage for 3 turns after first entering the battle"],
  params: [
    {
      id: "guardTurns",
      ctorIndex: 0,
      path: "guardTurns",
      control: "number",
      label: "How many turns the guard lasts (1-10)",
      editable: true,
      gateIndependent: true,
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // The gate: "this is my first entry in this battle". No atom reads the marker memory yet (request R3).
    {
      slot: "gate",
      ctx: "params",
      lib: "request R3: this is my first entry in the battle (a marker in the battle memory)",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: ["It never does anything for a preview (a simulated entry)"],
  effect: { id: "effect.package", params: ["guardTurns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "enter and wait two quiet turns", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B (the gate runs through gatedCanApply inside apply, see the header) with a PACKAGE effect. Written reason: the effect writes two string markers in the ER provenance memory (battleData 'oracle:first-entry', summonData 'oracle:guard:N'), and a closure of ANOTHER attr (ReceivedMoveDamageMultiplierAbAttr in Oracle, bound legacy in the precedents) reads them back by string prefix; there is no library effect to set a typed marker (request R9) and no atom to read it (request R3). The number of turns is the typed `guardTurns` setting (1 to 10; the class itself accepts any number, 0 or less would start an already-expired guard). The gate binding is legacy-closure-pending-request R3, so the rebuild is skipped by L2. Users: Oracle (6047, attr 1) only. Oddity, not changed: the ability text says incoming attacks are 'treated as not very effective', but the damage attr halves the damage (x0.5), which is what the guard does in code. Replacing an existing guard marker means a second entry in the same battle never restarts the guard (the first-entry memory blocks it).",
});
