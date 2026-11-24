/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 / Mutual Destruction. Read by hand: bernerd-roster-mechanics.ts `MutualDestructionPostFaintAbAttr`, its base
// PostFaintAbAttr (dispatched from faint-phase.ts:256 with the last attacker and move, or without them at :265 for
// indirect knockouts).
//
// canApply, clause by clause, in the original order (the split is `guards && gate`, no residual):
//   1. guard      a move knocked me out: `!!move`                                         -> `guards`
//   2. guard      the knocker is known: `!!attacker`                                      -> `guards`
//   3. guard      the knocker is still standing: `!attacker.isFainted()`                  -> `guards`
//   4. condition  the knocker is not on my side: `!attacker.getAllies().includes(holder)` -> `gate`, atom side.is (ally), negated
//   apply: unless simulated, attacker.damageAndUpdate(attacker.hp, { result: INDIRECT }) (all of its remaining HP).
// No random draw. Clause 4 reads the attacker's active allies, the atom compares sides directly; the two agree for every
// reachable fight (see notes for the one unreachable difference).
import { MutualDestructionPostFaintAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MutualDestructionPostFaintAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.faint",
  label: "Make the Pokemon that knocked me out faint too",
  summary: () =>
    "When I faint from an attack, the Pokemon that knocked me out loses all of its remaining HP, as long as it is still standing and not on my side.",
  synonyms: [
    "mutual destruction",
    "take it down with me",
    "destiny bond",
    "revenge knockout",
    "innards out",
    "aftermath",
    "faint together",
  ],
  examples: ["When I faint from an attack, the attacker faints too", "Knock out my killer when I go down"],
  params: [],
  noParamsReason:
    "It always removes all of the attacker's remaining HP (damage equal to its current HP), so there is no number, type, stat or status to set.",
  conditions: [
    // The gate: not(side.is { kind: ally }) on the attacker. Bound in bindings.ts.
    { slot: "gate", ctx: "params", lib: "side.is", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "An attack must have knocked me out (not poison, weather or another indirect cause)",
    "The Pokemon that knocked me out must be known and still standing",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // I faint to an ordinary foe hit at any HP, with the foe at full and at low HP.
      name: "faint to a foe attack",
      axes: { foeHp: ["max", "50%"] },
    },
  ],
  l2StaticReason:
    "The shared battle template for the faint trigger never reaches a PostFaint attr (listed as unreached in decomp-l2-reach.json). Verified instead by L0, the L1 attr differential (an event.faint parameter builder was added to harness/world.ts), and real battles in test/tests/elite-redux/decomp/B17/mutual-destruction.test.ts.",
  status: "decomposed",
  notes:
    "Tier B with a PACKAGE effect. Written reason: the effect is one damageAndUpdate(attacker.hp, INDIRECT) call, but no library effect 'knock out another Pokemon / take all of its remaining HP' exists (request R7 in requests/B17.md); recoil and drain scale with a damage or max-HP share and apply to the holder or the damage dealt, not 'all current HP of the other Pokemon'. The trigger (when I faint) and the one real condition (the knocker is not an ally) are separate blocks. The three guards (a move, a known attacker, still standing) have no registry ids (request R8), so they are written as feasibility; they run first, in the original order, before the gate. The condition used to be `!attacker.getAllies().includes(pokemon)`: getAllies() lists the OTHER ACTIVE battlers on the attacker's side, the atom side.is(ally) compares isPlayer() and identity. They differ only if the knocker is on my side but I am no longer in the field array (not reachable: the faint dispatch runs while I am still on the field). The L1 grid never sets a same-side attacker, so test/tests/elite-redux/decomp/B17/gates.test.ts checks both directions with stand-ins (the old canApply, the refactor, the rebuild and a deliberately wrong gate), and mutual-destruction.test.ts runs the foe direction in a real battle. A real double battle for the ally direction is not possible here: the existing innards-out.test.ts double case also times out in this checkout. Users: Mutual Destruction (6104, attr 0) only. The ability also carries the ability-level flag bypassFaint (set in wireBernerdRosterAbility, not an attr), which belongs to the ability blueprint, not to this block. The ability text mentions Pain Split first; the code deals the attacker's whole current HP directly (the comment in apply says that equals the Pain Split plus Innards Out result), so no Pain Split step exists in this attr. No game bug found.",
});
