/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 2, part 2 of 2 of Decay (Tier B with the gate inside `apply`, event-effect). "At the end of every turn, if I carry the Decay
// marker and I am not poisoned, poison me again."
//
// Source: fakemon-pitch-mechanics.ts, DecayRestoreAbAttr (PostTurnAbAttr; no constructor, the only argument is AbAttr's `showAbility`).
//   canApply  the parent's: ALWAYS true. So the ability pop-up shows at the end of every turn, whether or not anything happens
//             (suspected quirk, see notes; not changed: moving the tests into canApply would change when the pop-up shows).
//   apply     in this clause order (they were one `&&` chain):
//             1. !simulated                                     feasibility: nothing happens while the game only previews
//             2. holder.getTag(ER_DECAY_POISON) is set          -> IF "I carry the Decay marker"  = library atom tag.has
//             3. holder.status?.effect !== POISON               -> IF "I am not poisoned"          = not(status.has POISON)
//             then holder.trySetStatus(POISON, holder)          the effect (trySetStatus itself refuses while I have another status)
// Tier B, but unlike the other Tier B classes the studio split lives in `apply`, because that is where the original clauses were: clauses
// 2 and 3 are the replaceable `gate` (class method `gate`, `gateOverride` set by the compiler), clause 1 is read first, exactly as before.
// No random draw, no state of its own (the marker is a battle effect on the holder, put on by DecayEntryAbAttr).
import { DecayRestoreAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DecayRestoreAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Poison myself again each turn while I carry the marker",
  summary: () =>
    "At the end of every turn, if I carry the Decay marker and am not poisoned, I become poisoned again (if no other status stops it).",
  synonyms: [
    "decay",
    "re poison myself",
    "poison comes back",
    "permanent poison",
    "keep myself poisoned",
    "restore poison each turn",
    "poison upkeep",
  ],
  examples: ["At the end of every turn I get poisoned again if poison was cured, like Decay"],
  params: [],
  noParamsReason:
    "The effect is fixed: it poisons me with ordinary poison (never badly poisoned) when I carry one specific marker. The status is the marker's whole point, so there is no number, stat or type to tune.",
  conditions: [
    // The gate: I carry the Decay marker AND I am not poisoned. Staff may replace it (it is read inside the effect, see the header).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Nothing happens while the game only previews the end of the turn",
    "I only get poisoned if I do not already have another status and nothing stops it (the same checks as any poisoning)",
  ],
  effect: { id: "effect.inflict-status", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The gate reads my own status: poisoned (does nothing), no status and burned (poisons only without a status).
      name: "poisoned, no status and burned at the end of the turn",
      axes: { status: ["POISON", "NONE", "BURN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, gate inside `apply`: trigger (end of every turn), two IFs joined with AND (I carry the Decay marker = tag.has ER_DECAY_POISON on me; I am not poisoned = not status.has POISON on me) and one effect (poison me). The IFs are the replaceable gate, bound once for the one user. The L1 attr differential only compares canApply, which is always true here, so the gate itself is proven in test/tests/elite-redux/decomp/B16/chunk2.test.ts (original `gate` against the library form over the status and marker grid, and the full apply). The effect block effect.inflict-status is implemented in the library; the compiled rule must call trySetStatus(POISON, holder) with the holder as source. User: Decay (6051, attr 1; attr 0 is DecayEntryAbAttr, attr 2 BlockStatusDamageAbAttr, another batch). SUSPECTED GAME QUIRK, not fixed: canApply is always true, so the Decay ability pop-up shows at the end of every turn even when nothing changes (the tests are in apply). Also: Toxic is not Poison, so a badly poisoned holder keeps Toxic (trySetStatus refuses while statused) and the class never converts it.",
});
