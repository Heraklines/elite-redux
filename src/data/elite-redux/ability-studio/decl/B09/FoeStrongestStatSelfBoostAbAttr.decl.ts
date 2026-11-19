/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
// B09 chunk 3. "When I enter, I raise the defense that answers the foes' stronger attacking stat" (Spyware).
//
// Source: src/data/elite-redux/archetypes/foe-strongest-stat-self-boost.ts, class FoeStrongestStatSelfBoostAbAttr (extends
// PostSummonAbAttr). Dispatched when the holder enters (`applyAbAttrs("PostSummonAbAttr")`).
// Clauses, in order:
//   canApply: `pokemon.getOpponents().some(o => o && !o.isFainted())`    at least one foe is still standing  -> feasibility
//   apply:    1. simulated -> do nothing
//             2. over every standing foe take the HIGHEST `getStat(ATK, false)` and the HIGHEST `getStat(SPATK, false)`
//                (the highest of each across foes, not the stats of one foe)
//             3. target = `foePhysical >= foeSpecial ? physicalCounter : specialCounter`   (a tie goes to the physical answer)
//             4. queue a StatStageChangePhase on the holder (self-targeted) raising `target` by `stages`
// Constructor: ({ stages, physicalCounter, specialCounter }), one options object; `super(true)` so the popup always shows.
// No random draw, no state. Spyware passes stages 2, DEF and SPDEF.
//
// Package: the stat that is raised is DECIDED inside the effect from the foes' stats, so no condition can be pulled out and the
// effect is not the plain "raise this stat" block (whose stat is fixed). Reusable as a whole with its three settings.
import { FoeStrongestStatSelfBoostAbAttr } from "#data/elite-redux/archetypes/foe-strongest-stat-self-boost";
import { Stat } from "#enums/stat";

/** The three settings live in one `opts` object on the instance; each param reads its own key. */
type OptsKey = "stages" | "physicalCounter" | "specialCounter";
const pickOpt = (key: OptsKey, raw: unknown): unknown =>
  typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)[key] : undefined;

const statOptCodec = (key: "physicalCounter" | "specialCounter"): ParamCodec => {
  const stat = enumCodec(Stat, "stat");
  return { toCtor: stat.toCtor, fromInstance: raw => stat.fromInstance(pickOpt(key, raw)) };
};

const stagesCodec: ParamCodec = {
  toCtor: value => Number(value),
  fromInstance: raw => {
    const value = pickOpt("stages", raw);
    return typeof value === "number" ? value : undefined;
  },
};

export default defineDecl(FoeStrongestStatSelfBoostAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Raise a defense that matches the foe's stronger attack",
  summary: params =>
    `When I enter the battle, I raise my ${params.physicalCounter} by ${params.stages} stages if the foes' Attack is at least as high as their Sp. Atk, otherwise my ${params.specialCounter}.`,
  synonyms: [
    "spyware",
    "counter the foe's best attack",
    "read the foe",
    "adapt defense",
    "raise defense by the foe's attack type",
    "scout the foe",
  ],
  examples: ["Sharply raise Defense if the foes hit physically, or Sp. Def if they hit specially, like Spyware"],
  params: [
    {
      id: "stages",
      ctorIndex: 0,
      ctorOption: "stages",
      path: "opts",
      control: "number",
      label: "Number of stages (1-6)",
      editable: true,
      integer: true,
      min: 1,
      max: 6,
      step: 1,
      default: 2,
      codec: stagesCodec,
    },
    {
      id: "physicalCounter",
      ctorIndex: 0,
      ctorOption: "physicalCounter",
      path: "opts",
      control: "select",
      label: "Stat I raise when the foes' Attack is the higher one",
      editable: true,
      default: "DEF",
      options: STAT_OPTIONS,
      codec: statOptCodec("physicalCounter"),
    },
    {
      id: "specialCounter",
      ctorIndex: 0,
      ctorOption: "specialCounter",
      path: "opts",
      control: "select",
      label: "Stat I raise when the foes' Sp. Atk is the higher one",
      editable: true,
      default: "SPDEF",
      options: STAT_OPTIONS,
      codec: statOptCodec("specialCounter"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must still be standing",
    "The foes' highest Attack and highest Sp. Atk are compared; a tie counts as Attack",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: ["stages", "physicalCounter", "specialCounter"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "entering while I am at full HP and one HP below full",
      axes: { hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Package, justified: the stat that gets raised is picked inside apply from the highest Attack and highest Sp. Atk among the standing foes, so there is no plain condition to pull out and no fixed stat for the stat-stage effect. 1 attr: Spyware (5597 attr 0: stages 2, Defense, Sp. Def). The three settings sit together in the private `opts` object, so each param reads it through `path: opts` with its own codec. Behaviour kept as it is: showAbility is always true, so the popup shows on entry even when no foe stands (canApply is false then, so it does not); the comparison uses the highest value of each stat ACROSS foes, which can mix two different foes; a tie goes to the physical answer. Oddity, not fixed: the stats are read with getStat(stat, false), i.e. without stat stages. The raise goes through a normal StatStageChangePhase on the holder itself.",
});
