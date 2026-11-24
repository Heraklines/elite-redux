/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 4, Tier B event-effect. Defeatist. "After I am hit, IF I have not used this up this wave AND the move deals damage AND
// it comes from a foe AND the hit took my HP down to the line, DO raise some stats by some stages".
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over PostDefendAbAttr (constructor `(key, threshold, stats, stages)`,
// showAbility true). Dispatch: applyAbAttrs("PostDefendAbAttr", { pokemon: holder, opponent: attacker, move, damage, hitResult, simulated })
// in move-effect-phase (applyOnGetHitAbEffects). canApply, in the ORIGINAL clause order (now gate && residual, every clause a pure read,
// no random draw):
//   gate 1    !pokemon.waveData.entryEffectsFired.has(key)                      -> condition (library atom time.once-per, scope wave)
//   gate 2    move.category !== STATUS                                          -> condition (library atom move.damaging)
//   gate 3    pokemon.isOpponent(opponent)                                      -> condition (library atom side.is, kind foe)
//   residual  t = max(1, floor(maxHp * threshold)); hp <= t && hp + damage > t  -> the HP line; stays in the class until the library has
//             the rounding "floor with a minimum of 1" (request R-B18-30, the same as R-B01-21). hp.crossed-below floor-half is NOT it: it
//             floors to 0 for a Pokemon whose max HP times the line is below 1 (Defeatist at 10% with max HP under 10).
// apply     unless simulated: add `key` to waveData.entryEffectsFired, then queue ONE StatStageChangePhase on the holder for ALL the listed
//           stats by `stages`. No random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OnceLowHpStatRaiseAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { fractionAsPercentCodec } from "./b18-chunk3-codecs";
import { STAT_LIST_OPTIONS, statListCodec } from "./b18-chunk4-codecs";

export default defineDecl(OnceLowHpStatRaiseAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Raise stats once per wave when a hit drops me to low HP",
  summary: params =>
    `Once per wave, the foe's damaging hit that takes my HP to ${params.threshold}% or lower raises ${params.stats} by ${params.stages} ${Number(params.stages) === 1 ? "stage" : "stages"}. Example: 10%, +2, like Defeatist.`,
  synonyms: [
    "defeatist comeback",
    "boost at low hp",
    "last stand",
    "once per wave boost",
    "comeback",
    "power up when nearly down",
    "raise stats when almost fainting",
  ],
  examples: [
    "Raise Attack, Sp. Atk and Speed by two stages the first time a hit drops me to 10% HP, like Defeatist",
    "Once per battle, a hit that takes me to a quarter HP boosts my Defense by one stage",
  ],
  params: [
    {
      id: "key",
      ctorIndex: 0,
      path: "key",
      control: "text",
      label: "Name of the once-per-wave record (use a different name for each rule)",
      editable: true,
      default: "requested:defeatist:ten-percent-comeback",
    },
    {
      id: "threshold",
      ctorIndex: 1,
      path: "threshold",
      control: "number",
      min: 1,
      max: 99,
      step: 1,
      integer: true,
      label: "HP line (% of max HP, 10 = ten percent)",
      editable: true,
      gateIndependent: true,
      default: 10,
      codec: fractionAsPercentCodec,
    },
    {
      id: "stats",
      ctorIndex: 2,
      path: "stats",
      control: "text",
      label: "Stats that rise (comma separated: Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy, Evasion)",
      editable: true,
      gateIndependent: true,
      default: "Attack, Sp. Atk, Speed",
      options: STAT_LIST_OPTIONS,
      codec: statListCodec,
    },
    {
      id: "stages",
      ctorIndex: 3,
      path: "stages",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages each stat rises (1-6)",
      editable: true,
      gateIndependent: true,
      default: 2,
    },
  ],
  // The memory name is repeated in the gate's once-per atom, so moving it moves the compiled gate too.
  gateParams: [{ param: "key", block: "time.once-per", field: "key" }],
  // The gate is all[time.once-per {wave, key}, move.damaging, side.is {foe}], in the class's own order (see bindings.ts).
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "My HP must have just dropped to the line or below from above it (checked by the game itself until the library can express its exact rounding, which never lets the line fall below 1 HP)",
    "Nothing happens when the game only previews the hit",
  ],
  effect: { id: "effect.stat-stage", params: ["stats", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // Just above the line (a hit crosses it), on it, and below it (already past it). Full HP is left to L1: the ability-level condition of
      // Defeatist (HP at half or less) keeps every attr of the ability from being asked above half HP, so a battle twin would prove nothing.
      name: "HP around the ten percent line",
      axes: { hp: ["10%+1", "10%", "10%-1"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package: the stat change is the library's effect.stat-stage (a list of stats and a number of stages, both typed settings) and three of the four clauses are separate library blocks. User (1 attr): Defeatist (129, attr 2, record key requested:defeatist:ten-percent-comeback, 10%, Attack + Sp. Atk + Speed, +2). Class change (pure move, no behaviour change): gateOverride field, canApply = gatedCanApply, gate = clauses 1 to 3, residual = the HP line, which is still evaluated last as in the old canApply. REMAINING GAP (status legacy-closure-pending-request): the HP line is not a block. The library atom hp.crossed-below has `exact` and `floor-half`; this class floors with a minimum of 1 (the toDmgValue rounding), request R-B18-30 asks for a third rounding. Until then the line is the class's residual and its percentage is the editable `threshold` setting (a locked 'also requires' line, not a removable block). The memory is the per-WAVE set pokemon.waveData.entryEffectsFired (not per battle as the class comment says): time.once-per with scope wave reads and writes that very Set under the same key, and the atom only writes when the rule applies (apply also adds the key itself, as before). The record name is an editable setting and a gateParams entry so the binding's key follows it. ODDITIES, not fixed: (1) the effect is queued for every listed stat in ONE phase, so a stat at +6 simply does not move; (2) the comment says once per battle but the memory resets every wave; (3) the ER description says the ability keeps its Attack and Sp. Atk reductions at low HP, which is a different attr of Defeatist, not this one; (4) a hit that crosses the line while another attr already used the key blocks it, because the key is shared by name.",
});
