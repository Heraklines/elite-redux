/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 6. Package. "While the game calculates my Speed, it grows by 20% for every type I have lost."
//
// Source: src/data/elite-redux/abilities/world-in-pieces.ts, class WorldInPiecesSpeedAbAttr (extends StatMultiplierAbAttr; showAbility false from the base). The constructor now takes
// (stat = Stat.SPD, bonusPerMissingType = 0.2) and calls super(stat, 1); the base multiplier is a fixed 1 and is NOT used (apply is overridden). canApply (overridden, no draw):
//   1. stat === this.stat                                  -> the stat being calculated is the one this attr grows. This is the setting of the effect itself (the stat param), not a swappable condition.
//      (the base class also tests an optional `condition` closure; this subclass never sets one)
// apply: statVal.value *= 1 + bonusPerMissingType * worldInPiecesMissingCount(holder). The count is the size of the removed set of the module WeakMap WORLD_IN_PIECES_STATE (0 when no entry).
// No random draw. No simulated test (a stat calculation has none).
// Refactor (behaviour neutral): the two literals Stat.SPD (constructor) and WORLD_IN_PIECES_SPEED_PER_MISSING (apply) became constructor arguments with the same defaults; canApply reads this.stat.
//
// Why a package (honest limit): effect.multiply-stat multiplies by a fixed number. This multiplier is 1 + bonus x (how many types I have lost), a count that comes from the ability's private ledger;
// the vocabulary has no value that counts lost types and no multiplier that scales with a count. The trigger (while the game calculates one of my stats) is the separate, swappable WHEN, and
// both numbers (which stat, the bonus per lost type) are typed params. Requested: R-B15-46 (the count) and R-B15-48 (the scaling multiplier).
import { WorldInPiecesSpeedAbAttr } from "#data/elite-redux/abilities/world-in-pieces";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

export default defineDecl(WorldInPiecesSpeedAbAttr, {
  tier: "C",
  kind: "package",
  when: "calc.stat-value",
  label: "Raise a stat for every type I have lost (World in Pieces)",
  summary: params =>
    `While my ${params.stat} is calculated, it is multiplied by 1 + ${params.bonusPerMissingType} for every type I have lost. Example: 0.2 and three lost types = x1.6 Speed.`,
  synonyms: [
    "world in pieces",
    "speed per lost type",
    "stat boost per missing type",
    "faster the more I lose",
    "scale with lost types",
    "speed up as I break apart",
  ],
  examples: ["+20% Speed for every type I have lost, like World in Pieces"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat grows",
      editable: true,
      default: "SPD",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "bonusPerMissingType",
      ctorIndex: 1,
      path: "bonusPerMissingType",
      control: "slider",
      min: 0.01,
      max: 1,
      step: 0.01,
      label: "Bonus for each lost type (0.2 = +20% of the stat)",
      editable: true,
      default: 0.2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The bonus only counts types I have lost with this ability's own memory; with none lost the stat is unchanged",
    "Only the chosen stat is changed; every other stat calculation is left alone",
  ],
  effect: { id: "effect.package", params: ["stat", "bonusPerMissingType"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "a normal turn with the holder on the field", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified (see the header). 1 attr in 1 ability: World in Pieces (5917 attr 2). No closure, so no binding. The stat check of canApply is the effect's own setting (param stat), so conditions stays empty: a staff-made rule adds IFs on top of it. Constructor change (behaviour neutral): stat and bonusPerMissingType default to Speed and 0.2 (WORLD_IN_PIECES_SPEED_PER_MISSING); the inherited multiplier stays 1 and is unused. The stat enum has no ACC/EVA in the multiplier dispatch in practice, but the select lists the same STAT_OPTIONS as every stat param. Requested: R-B15-46, R-B15-48, plus the stat condition R-B15-28. Suspected oddity, NOT fixed: the base class StatMultiplierAbAttr declares its own private condition and multiplier; this subclass overrides both canApply and apply and so ignores them, which is why the declaration lists no multiplier param.",
});
