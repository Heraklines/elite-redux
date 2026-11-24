/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06, Tier A event-effect with a NUMBER-returning constructor closure and a one-piece effect. See ../PRECEDENTS.md.
//
// "At the end of every turn, with a chance, get back one berry I ate this battle" (Harvest). Clauses in the ORIGINAL order
// (ab-attrs.ts, PostTurnRestoreBerryAbAttr.canApply, then apply):
//   1. feasibility  `berriesUnderCap`: the berries in `pokemon.battleData.berriesEaten` whose held stack is under its cap
//                   (computed from the scene's BerryModifier list, stored in the instance field `berriesUnderCap`). None = false,
//                   BEFORE any random draw.
//   2. RNG draw 1   `pass = randSeedFloat()` (always drawn once there is at least one restorable berry, even when the chance
//                   is 100%), then `this.procChance(pokemon) >= pass`. The chance is a constructor closure returning 0..1.
//   effect-side     `apply` (skips simulated): draw 2 `randSeedInt(berriesUnderCap.length)` picks which berry, removes it from
//                   the memory, adds one to the stack (or creates the modifier), queues the "found a berry" message.
// THE CLOSURE: `procChance` returns a NUMBER from the holder (1 in the sun and 0.5 otherwise for Harvest and its relatives;
// `isReapAndSowSunActive` for Serfdom). It is not a yes/no condition, and the roll uses `randSeedFloat` and a `>=` compare,
// which the library chance atom (`rng.chance`, `randBattleSeedInt(100) < pct`) does not do, so a library form would draw a
// different random number. Every user therefore stays a legacy-closure (counted as undecomposed) until the librarian adds
// the float-roll chance atom (requests/B06.md, R-B06-4). The trigger, the effect and the feasibility are separate already.
import { PostTurnRestoreBerryAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostTurnRestoreBerryAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Get back a berry I ate, with a chance (like Harvest)",
  summary: () =>
    "At the end of every turn, there is a chance to get back one berry I ate in this battle. Example: Harvest is 50%, or 100% in harsh sun.",
  synonyms: ["harvest", "regrow berry", "restore eaten berry", "berry recycling", "berry garden", "get my berry back"],
  examples: ["Get back an eaten berry at the end of the turn, always in the sun, like Harvest"],
  params: [],
  noParamsReason:
    "The only argument is a function that returns the chance as a number from 0 to 1 for the current Pokemon. It cannot be a typed setting until the library has a float-roll chance atom (requests R-B06-4); every user's function is bound as a legacy closure meanwhile.",
  conditions: [
    // A number-returning closure, not a yes/no condition: ctx "none" means no library tree can be compiled into it.
    { slot: "ctor:0", ctx: "none", path: "procChance", removable: false, editable: false },
  ],
  guards: [],
  feasibility: [
    "I must have eaten a berry in this battle that I can still get back (a berry already at its maximum stack does not count)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: {
    rng: "both",
    rngOrder: [
      "canApply: one randSeedFloat for the chance, only after at least one restorable berry was found",
      "apply: randSeedInt over the restorable berries picks which one comes back",
    ],
    state: "battle",
    simulated: "respects",
  },
  probes: [{ name: "end of turn with nothing eaten", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect only. Why the effect cannot be split with today's blocks: it reads and writes the per-battle berry ledger (battleData.berriesEaten), respects each berry stack's cap through the scene's BerryModifier list and picks the berry with the game's own random stream; there is no effect block that adds a specific held item, and effect.use-item eats a berry rather than creating one. The trigger (end of turn) and the chance (a separate IF slot, legacy until R-B06-4) are NOT part of the package, and the restore has no number or type to set (the berry is random). Request R-B06-5 asks for effect.restore-eaten-berry so the package can retire. Users (5 attrs, all legacy-closure, all carry the same chance rule): Harvest (139, attr 0, chance 1 while the weather is Sun or Extremely harsh sunlight via getWeatherCondition, else 0.5), Big Leaves (5111, attr 3), Sun's Bounty (5502, attr 1) and Glycolysis (5970, attr 0) use the same Harvest closure; Serfdom (6055, attr 0) uses `isReapAndSowSunActive(pokemon) ? 1 : 0.5`, where Reap and Sow's own sun is Grassy terrain plus a Reap and Sow holder on the field and the holder not fainted (defined in fakemon-pitch-mechanics.ts; Serfdom is the only ability there that pushes this restore attr, the Reap and Sow case pushes terrain and capability attrs only). Oddity, not fixed: the chance is drawn even when it is 100% (the sun), which burns one random number per turn per Harvest holder that has a berry to restore. The instance field `berriesUnderCap` is set in canApply and read in apply, a per-instance memory of one call.",
});
