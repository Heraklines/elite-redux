/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 1 / event-effect (Tier B: "the Pokemon that fainted is a teammate" is the gate inside canApply).
//
// Read by hand from archetypes/power-boost-on-ally-faint.ts and FaintPhase (`applyAbAttrs("PostKnockOutAbAttr", { pokemon: p,
// victim: pokemon })` runs for EVERY Pokemon on the field whenever any Pokemon faints). First of the three cooperating attrs of
// Avenger and Cursed Spirit: this one ARMS a per-holder timer (a Symbol-keyed number on the Pokemon), the power attr reads it
// and the expire attr counts it down. PostKnockOut hook (WHEN "when a Pokemon is knocked out"; `other` is the victim).
//   canApply is now the gate alone (nothing is left as a residual):
//     gate: `victim.id !== pokemon.id && victim.isPlayer() === pokemon.isPlayer()`   (CONDITION: a TEAMMATE fainted, not me)
//   apply: not when simulated. Then the timer is set to `turns` (it was the constant 2: the rest of this turn plus the whole next
//     turn). No random draw. The constructor argument `turns` (default 2) was added with its default so the shipped call
//     `new AllyFaintPowerBoostTriggerAbAttr()` behaves exactly as before.
//
// The gate is exactly the library atom side.is with "ally" (`other !== holder && other.isPlayer() === holder.isPlayer()`, the
// victim is `other`), so both users are bound to it. The effect is one piece: arming a timed boost has no implemented
// library effect (effect.arm-effect exists but is not implemented) and the timer lives in a private Symbol store that no atom can
// read (requests R-B11-C1-09 and R-B11-C1-10). The WHEN fires for any Pokemon that is knocked out, not only for a knock out the
// holder caused: its library name says "When I knock out a Pokemon", which is not what this class needs (request R-B11-C1-12).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AllyFaintPowerBoostTriggerAbAttr } from "#data/elite-redux/archetypes/power-boost-on-ally-faint";

export default defineDecl(AllyFaintPowerBoostTriggerAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-ko",
  label: "Start a short power boost when a teammate faints",
  summary: params =>
    `When a teammate of mine faints, a boost timer starts and lasts ${params.turns} turn ends (2 = the rest of this turn and the next full turn). It only works together with a power boost block that reads the timer.`,
  synonyms: [
    "avenger",
    "cursed spirit",
    "revenge boost",
    "teammate fainted",
    "ally down boost",
    "power up after a loss",
  ],
  examples: ["When a teammate faints, my moves get stronger until the end of next turn"],
  params: [
    {
      id: "turns",
      ctorIndex: 0,
      path: "turns",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "How many turn ends the boost lasts (2 = rest of this turn plus the next one)",
      editable: true,
      gateIndependent: true,
      default: 2,
    },
  ],
  conditions: [
    // "The Pokemon that fainted is my teammate": side.is ally for both shipped users. Staff may swap or extend it.
    { slot: "gate", ctx: "params", lib: "side.is", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only for a holder that is on the field when the teammate faints, so a teammate that faints on the bench is not seen",
    "Never in a preview",
  ],
  effect: { id: "effect.package", params: ["turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      name: "a knock out at full HP and at half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Users: Avenger (5030 attr 0) and Cursed Spirit (6095 attr 1), each followed by AllyFaintPowerBoostAbAttr and AllyFaintPowerBoostExpireAbAttr; the gate is bound to side.is ally on both. The timer is state of the Pokemon (a Symbol key), not of the attr, so a rebuilt trio shares it with the shipped one. The L2 scenario for this moment has the holder knock out the FOE, so the 'a teammate fainted' gate is evaluated (false for both versions) and the timer is never armed there; test/tests/elite-redux/decomp/B11/chunk1.test.ts drives the original and the rebuild with a stand-in teammate and checks the timer. Remark, NOT fixed: the ability description says a party Pokemon fainting starts the boost, but a benched teammate fainting never reaches this hook (it is only dispatched for Pokemon on the field), so the boost is reliable only in double battles or when the holder is out. The class comment already admits this.",
});
