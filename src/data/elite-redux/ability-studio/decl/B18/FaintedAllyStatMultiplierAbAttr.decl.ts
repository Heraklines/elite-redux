/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 3, Tier C package (effect only). "While the game works out my Attack (or Sp. Atk), DO multiply it by 1 plus a few percent
// for every OTHER party member that has fainted."
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts, a subclass of StatMultiplierAbAttr (constructor `(stat, perFaintedAlly =
// 0.05)`, it passes the stat and a multiplier of 1 to the parent, no closure). Dispatched while a stat is calculated
// (Pokemon.getEffectiveStat, once per stat per calculation; also read for Accuracy and Evasion, which this class never matches).
//   canApply  inherited `stat === this.stat && (!this.condition || ...)`: only "the stat the game asks about is the chosen one"
//             (the parent has no closure here) -> that is WHICH stat, a setting of the effect, not a condition
//   apply     party = holder's side party; faintedAllies = members with `id !== holder.id && isFainted()`;
//             `statVal.value *= 1 + faintedAllies * perFaintedAlly`. No random draw, no state, `simulated` is not read.
// WHY THE EFFECT STAYS ONE PIECE: the multiplier is not a fixed number but 1 + (a count) x (a share), and the count is the number
// of fainted party members. effect.multiply-stat takes one fixed multiplier, and the library has no way to feed it a count (request
// R-B18-29: a multiply-stat effect whose multiplier grows with a counted fact, with the atom party.fainted-count as the count).
// Both settings (which stat, the share per fainted ally) are typed. The trigger is its own block; no condition exists to split.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { FaintedAllyStatMultiplierAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { Stat } from "#enums/stat";
import { fractionAsPercentCodec } from "./b18-chunk3-codecs";

export default defineDecl(FaintedAllyStatMultiplierAbAttr, {
  tier: "C",
  kind: "package",
  when: "calc.stat-value",
  label: "Raise an attack stat for every fainted party member",
  summary: params =>
    `My ${params.stat} goes up by ${params.perFaintedAlly}% for every other party member that has fainted. Example: 5% with 2 fainted gives x1.10.`,
  synonyms: [
    "avenger",
    "revenge boost",
    "stronger for each fallen ally",
    "fainted teammate boost",
    "attack up per ko",
    "grow stronger when allies faint",
  ],
  examples: [
    "Raise my Attack by 5% for every fainted teammate, like Avenger",
    "Raise my Sp. Atk by 10% for each ally that has fallen",
  ],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which attack stat grows (Attack or Sp. Atk)",
      editable: true,
      default: "ATK",
      options: ["ATK", "SPATK"],
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "perFaintedAlly",
      ctorIndex: 1,
      path: "perFaintedAlly",
      control: "number",
      min: 0.5,
      max: 100,
      step: 0.5,
      label: "Boost for each fainted party member (% of the stat, 5 = 5%)",
      editable: true,
      default: 5,
      codec: fractionAsPercentCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only the chosen stat is changed",
    "Only the other members of my own side's party count (I am never counted)",
    "Nothing changes while no party member has fainted (the count starts at 0)",
  ],
  effect: { id: "effect.package", params: ["stat", "perFaintedAlly"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a stat is asked for with every stat of the grid", axes: {} }],
  status: "decomposed",
  notes:
    "Package for the effect only, justified in the header (request R-B18-29); the trigger is a separate block and the class owns no condition. Tier C: nothing to bind (the parent gets no closure). Users (2 attrs, both in Avenger 5030): attr 3 Attack and attr 4 Sp. Atk, each 0.05 (5%). The share is stored as a fraction (0.05) and shown to staff as a whole percent (5) through fractionAsPercentCodec; 5 / 100 is exactly the literal 0.05, so a rebuild is identical. Oddities, not fixed: (a) the parent `multiplier` stays 1, so code that reads it (the studio's reflection) sees 1, not the formula; (b) the multiplier is applied on every stat query including previews and the AI, and the party is read live each time; (c) the count is not capped (a full party of 5 fainted allies gives x1.25); (d) a party of the enemy side counts the enemy party, including benched members; (e) the class declares only the offensive stats in its type, but any stat would work.",
});
