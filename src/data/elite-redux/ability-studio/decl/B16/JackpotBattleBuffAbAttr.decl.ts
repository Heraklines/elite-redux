/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 3 (Tier B with the gate inside `apply`, event-effect). "When I enter the battle, my side gets +1 critical-hit stage and I get
// +1 Luck for the rest of the battle. Only one Pokemon per side gets it per battle."
//
// Source: bernerd-roster-mechanics.ts, JackpotBattleBuffAbAttr (extends PostSummonAbAttr; no constructor, the parent's arguments are
// `showAbility` and `activateOnGain`).
//   canApply  the parent's: ALWAYS true (no condition)
//   apply     in this clause order:
//             1. simulated -> return                                          nothing happens while the game only previews the entry
//             2. battle.erJackpotSides ??= new Set()                          the battle's set of sides that already got the buff
//             3. sides.has(holder.isPlayer()) -> return                       -> the replaceable `gate`: "nobody on my side got it yet"
//             4. sides.add(holder.isPlayer())                                 this side now has the +1 crit stage (read by Pokemon.getCritStage
//                                                                             for every attacker of that side, pokemon.ts, `jackpotSides?.has(source.isPlayer())`)
//             5. holder.waveData.erJackpotLuck = true                         +1 Luck for me for this wave (read by Pokemon.getLuck, pokemon.ts)
// The gate is pure and the set is created before it is read, exactly as in the original, so the studio split only moves clause 3 into
// the `gate` method (and `gateOverride`). No random draw.
import { JackpotBattleBuffAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(JackpotBattleBuffAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Give my side a critical-hit and luck boost for the battle",
  summary: () =>
    "When I enter the battle, my side's attacks get +1 critical-hit stage and I get +1 Luck, for the rest of the battle. Only one Pokemon per side gets it per battle.",
  synonyms: [
    "jackpot",
    "lucky crits",
    "crit boost for the team",
    "luck boost",
    "battle long crit",
    "team critical chance",
    "lucky streak",
  ],
  examples: ["When I come in, my whole side lands critical hits more often for the rest of the battle, like Jackpot"],
  params: [],
  noParamsReason:
    "The two bonuses (+1 critical-hit stage and +1 Luck) are not numbers this class stores: it only sets two flags (the side set and the Luck flag), and the engine reads them and adds the fixed +1 in its own code (Pokemon.getCritStage and Pokemon.getLuck). There is nothing in the class to expose as a setting.",
  conditions: [
    // The gate: nobody on my side has received the buff yet in this battle. Staff may replace it (read inside the effect, see the header).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Nothing happens while the game only previews the entry"],
  branches: [
    {
      label: "Raise my side's critical-hit stage by 1 for the battle",
      conditions: [],
      effect: { id: "effect.package", params: [] },
    },
    {
      label: "Raise my Luck by 1 for this wave",
      conditions: [],
      effect: { id: "effect.package", params: [] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "entry as the first Pokemon of the battle", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B, gate inside `apply` (like DecayRestoreAbAttr): trigger (on entry), one IF in the gate (my side has not received this boost yet in this battle) and two effects written as two branches that BOTH happen in this order (side crit stage, then my own Luck). Both effects are packages because the class only sets hidden flags (`currentBattle.erJackpotSides`, `waveData.erJackpotLuck`) that the engine reads by name in pokemon.ts; no library effect writes such a flag: requested as R-B16-23 (`effect.raise-side-crit-stage` for the battle and `effect.raise-luck` for the wave). The gate has no library atom: time.once-per keeps its memory per Pokemon (a WeakMap by battle data), whereas this memory is per SIDE and lives on the battle object, so the compiled form would give one boost per Pokemon instead of per side: R-B16-18 (`time.side-once-per-battle`). Its binding is a legacy closure until then. The L1 grid only compares canApply, which is always true here, so the gate and the effect are proven in test/tests/elite-redux/decomp/B16/chunk3.test.ts (original `gate` against a stand-in, and apply driven for both sides). User: Jackpot (6114, attr 1; attr 0 is PostSummonScriptedMoveAbAttr which uses Happy Hour once per battle, another batch). SUSPECTED GAME QUIRKS, not fixed: (1) the class comment says +1 crit and +1 Luck 'for this battle', but the Luck flag lives on `waveData` (this WAVE only, and only for the holder) while the crit bonus is per side for the whole battle; (2) the side's crit bonus applies to every Pokemon of the side, including ones that enter later, even after the holder faints; (3) the set is never emptied by the class itself, it dies with the battle object.",
});
