/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 3 / event-effect (Tier B).
//
// Read by hand from archetypes/post-damage-force-attacker-out.ts. The class extends PostDamageAbAttr (WHEN "after I take any
// damage"; engine parameters: holder, source = the attacker, damage), constructor `(contactRequired = false)`, default `super()`
// (banner shown). Field: helper = new ForceSwitchOutHelper(SwitchType.SWITCH). canApply in the ORIGINAL clause order:
//   1. there is a living attacker that is not me, and I have not fainted                  guards  (feasibility)
//   2. the attacker is an opponent (pokemon.isOpponent(source))                           guards  (a safety rule: never force out
//                                                                                          an ally; library side.is would also fit)
//   3. once per switch-in: summonData.forceAttackerOutUsed is not set                     guards  (memory in the class, R-B10-18 family)
//   4. the attacker's last move exists, is not NONE and is not a status move              guards  (a safety rule: only react to the
//                                                                                          attacker's own attack, not weather or poison)
//   5. contactRequired: the attacker's last move makes contact (doesFlagEffectApply, user: attacker, target: holder)
//                                                                                          gate    (no library atom, R-B10-c3-02)
//   6. helper.getSwitchOutCondition(attacker, holder): the attacker can be switched out    residual (feasibility)
// no prepare, no random draw. apply: simulated or no attacker -> nothing; else summonData.forceAttackerOutUsed = true on the
// holder and helper.switchOutLogic(attacker).
//
// Clause classification: "the move makes contact" is the one rule staff would change (any hit, only contact hits), so it is the
// replaceable gate. The rest are safety rules and feasibility that stay in the class. The library gate cannot read the attacker's
// move at this moment (the frame has no `move`), so both live users are bound as a written legacy gate. The effect "switch out
// the attacker" has no library block (the library's switch-out acts on the holder), so it is a package without settings.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostDamageForceAttackerOutAbAttr } from "#data/elite-redux/archetypes/post-damage-force-attacker-out";

export default defineDecl(PostDamageForceAttackerOutAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-taking-damage",
  label: "Force the attacker out once each time I enter the battle",
  summary: params =>
    `The first time a foe's ${params.contactRequired === true ? "contact " : ""}attack hurts me after I enter the battle, that foe is switched out. It comes back again at my next entry.`,
  synonyms: [
    "force the attacker to switch",
    "dragon tail on hit",
    "red card",
    "eject the attacker",
    "roar when hit",
    "restraining order",
    "chuckster",
  ],
  examples: [
    "The first foe that hits me after I enter is forced out, like Restraining Order",
    "The first contact hit on me forces the attacker to switch out, like Chuckster",
  ],
  params: [
    {
      id: "contactRequired",
      ctorIndex: 0,
      path: "contactRequired",
      control: "boolean",
      label: "Built-in rule: only contact moves count (replaced by the condition block you set)",
      editable: false,
      default: false,
    },
  ],
  conditions: [
    // The gate: the attacker's last move makes contact (only when contactRequired). Both live users are bound legacy: the frame of this
    // moment has no move (R-B10-c3-02).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A living foe must have hurt me with its own attack (weather, poison and hazards do not count) and I must still be in the battle",
    "Once each time I enter the battle",
    "The foe must be able to be switched out (it is not trapped and has a teammate to send in)",
    "Nothing happens in a preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "a hit with and without contact", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  l2StaticReason:
    "Both users are legacy-closure gates, so the rebuild cannot be built and the L2 twin has no rebuilt attr to compare. The B10 test (test/tests/elite-redux/decomp/B10/chunk3-gates.test.ts) drives canApply of the class and of a frozen copy of the original rule over every state the clauses can reach.",
  status: "decomposed",
  notes:
    "Tier B split by hand (guards: clauses 1 to 4; gate: contact; residual: the attacker can be switched out). Users (2 attrs): Restraining Order attr 0 and Chuckster attr 1, both with contactRequired TRUE (the header comment of the class says Restraining Order leaves it false, but the dispatcher passes true for both: the comment is stale), both bound as legacy-closure gates until the library frame of 'after I take any damage' carries the attacker's move (R-B10-c3-02) and a memory atom shares the class's once-per-entry flag (R-B10-18 family, same as Chuckster's damage half; the flag here is summonData.forceAttackerOutUsed). Package justified: the library 'Switch out' acts on the holder and has no target setting (R-B10-c3-08); this effect has no number, type or stat to set. Oddities, NOT fixed: the class reads the attacker's LAST move from move history, which for a multi-hit move is the same move on every hit, so the flag is spent on the first hit; the once-per-entry flag lives on summonData and is cleared whenever summonData resets; `simulated` is respected only in apply (canApply has no side effect).",
});
