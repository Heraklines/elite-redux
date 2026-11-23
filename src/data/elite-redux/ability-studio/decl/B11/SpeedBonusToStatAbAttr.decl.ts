/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 4 / calc-modifier (Tier A: "which moves" is one constructor closure).
//
// Read by hand from archetypes/speed-bonus-to-stat.ts. It extends StatMultiplierAbAttr, so the trigger is "while the game calculates
// one of my stats" (dispatch key StatMultiplierAbAttr, from Pokemon.getEffectiveStat for the holder's own stat and for the
// defender's stat when it is hit). Constructor `(options = { stat, speedFraction, filter?, sourceStat?, replace? }, condition?)`;
// `super(stat, 1)` (the parent's stat test and condition are NOT used: canApply is overridden without `super`), showAbility false.
// The constructor THROWS when `speedFraction` is not above 0. The move test is handed in at constructor argument 1 (slot ctor:1,
// field `moveCondition`, called as `(holder, null, move)`); its DEFAULT is the test of `options.filter` (category and contact).
//   canApply, in the ORIGINAL order:
//     1. `stat !== bonusStat`  -> false                (part of the effect: WHICH stat gets the bonus)
//     2. no move at all        -> true                 (kept: a calculation without a move skips the move test)
//     3. the move test: category physical/special (both tests are `move.is("AttackMove")`, see the notes), contact "only" (the move has
//        the raw MAKES_CONTACT bit) or "non" (it has not)        (CONDITION: ctor:1)
//   apply: `bonus = floor(holder.getStat(sourceStat, false) * speedFraction)`; `statVal = replace ? bonus : statVal + bonus`.
//   No random draw, and `simulated` is not looked at (a stat calculation is a pure read).
//
// The move test is a real condition and is now one condition block (slot ctor:1) that staff can swap or extend. "Add a share of one
// of my stats to another, or use it instead" has no library effect (request R-B11-C4-06), so the effect is one piece with typed
// settings: the stat that gets the bonus, the stat it is taken from, the share and add-or-replace. The contact tests read the move's
// RAW contact bit (`move.hasFlag`), which is not what the library atom move.flag asks (`doesFlagEffectApply`), and that atom also
// needs the holder as the move user, which a stat calculation does not provide: so the two contact variants are legacy closures
// until the atom of request R-B11-13 (a) exists with only the `move` slot as input.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SpeedBonusToStatAbAttr } from "#data/elite-redux/archetypes/speed-bonus-to-stat";
import { BATTLE_STAT_OPTIONS, battleStatCodec } from "./b11-chunk1-codecs";
import { BONUS_MODE_WORDS, bonusModeCodec, SOURCE_STAT_OPTIONS, sourceStatCodec } from "./b11-chunk4-codecs";

export default defineDecl(SpeedBonusToStatAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Add a share of one of my stats to another",
  summary: params =>
    `While my stats are worked out, ${params.fraction} times my ${params.source} is applied to my ${params.stat} (${params.mode}). Example: 0.2 of my Speed added to Attack.`,
  synonyms: [
    "speed to attack",
    "use speed instead of attack",
    "add speed to damage",
    "slipstream",
    "speed force",
    "impulse",
    "stat substitute",
  ],
  examples: ["Add 20% of my Speed to my Attack", "Use my Speed instead of my Defense when hit by contact moves"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      ctorOption: "stat",
      path: "bonusStat",
      control: "select",
      label: "Which stat gets the bonus",
      editable: true,
      default: "Attack",
      options: BATTLE_STAT_OPTIONS,
      codec: battleStatCodec,
    },
    {
      id: "source",
      ctorIndex: 0,
      ctorOption: "sourceStat",
      path: "sourceStat",
      control: "select",
      label: "Which of my stats the bonus is taken from",
      editable: true,
      default: "Speed",
      options: SOURCE_STAT_OPTIONS,
      codec: sourceStatCodec,
    },
    {
      id: "fraction",
      ctorIndex: 0,
      ctorOption: "speedFraction",
      path: "speedFraction",
      control: "number",
      min: 0.05,
      max: 4,
      step: 0.05,
      label: "Share of that stat (0.2 = 20%, 1 = all of it)",
      editable: true,
      default: 0.2,
    },
    {
      id: "mode",
      ctorIndex: 0,
      ctorOption: "replace",
      path: "replace",
      control: "select",
      label: "Add the share to the stat, or use it instead of the stat",
      editable: true,
      default: BONUS_MODE_WORDS[0],
      options: [...BONUS_MODE_WORDS],
      codec: bonusModeCodec,
    },
  ],
  conditions: [
    // Slipstream, Power Core, Max Acceleration, Mach 3, Unstable Core, Sleek Scales, Sky Sovereign: every move. Contact only:
    // Speed Force, Juggernaut, Iron Giant, Sumo Guard, Blur. Non-contact only: Terminal Velocity, Impulse, Elude.
    { slot: "ctor:1", ctx: "attack", path: "moveCondition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The bonus is read from the stat as it is in battle right now, before stat stages and before a Choice Scarf",
    "The share is rounded down to a whole number",
  ],
  effect: { id: "effect.package", params: ["stat", "source", "fraction", "mode"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "my stats while a foe hits me and while I hit",
      axes: { weather: ["NONE", "RAIN"], foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, justified in the header; a package only for the effect (request R-B11-C4-06), the trigger and the move condition are separate blocks. Users, all with a source stat and a mode that the settings read back: Slipstream (5398, Speed, +0.2 to Attack and Sp. Atk), Max Acceleration (5379 attrs 1 and 2), Mach 3 (5635 attrs 2 and 3), Sky Sovereign (20023 attrs 1 and 2) and Power Core (5105: Defense to Attack, Sp. Def to Sp. Atk) and Unstable Core (5721: Defense to Attack, Sp. Def to Sp. Atk) with every move (bound `{ all: [] }`); Sleek Scales (5731: +0.15 of Speed to Defense and Sp. Def, every move); the contact-only ones Speed Force (5093 attrs 0, 1, 2), Juggernaut (5059: Defense to Attack), Iron Giant (5386 attr 3: Defense to Attack), Sumo Guard (5637: Defense to Attack), Blur (5510: Speed REPLACES Defense and Sp. Def); the non-contact-only ones Terminal Velocity (5275), Impulse (5274: Speed REPLACES Attack and Sp. Atk) and Elude (5511: Speed replaces Defense and Sp. Def). The 14 contact-test closures are legacy closures (reason above, request R-B11-13 (a) widened to a `move`-only atom). Max HP is not offered as a source stat. The class keeps the `bonusFilter` field (the default condition reads it), so the V1 runtime-parameters entry `bonusFilter.contact` still works. Remarks, NOT fixed: (1) the `category` filter tests `move.is('AttackMove')` for BOTH physical and special, so it cannot tell the two apart (no shipped user sets it); (2) with no move the filter is skipped (true).",
});
