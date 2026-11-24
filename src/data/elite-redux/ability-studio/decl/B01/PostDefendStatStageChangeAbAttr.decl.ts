/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 3, Tier A event-effect. "After I am hit, IF <rule about the move and its user>, a stat changes."
// The constructor takes the rule as a closure (slot ctor:0, a PokemonDefendCondition `(target, user, move)`, the
// `defend` shape of the library) and five plain settings:
//   canApply  `this.condition(pokemon, attacker, move)`                       = the CONDITION slot, the only clause
//   apply     (skipped when `simulated`; no random draw)
//             1. `allOthers` or `opponentsOnly`: every ADJACENT foe, plus the adjacent allies unless `opponentsOnly`
//                (one StatStageChangePhase each, selfTarget false)
//             2. otherwise one phase on the holder (`selfTarget`) or on the attacker (not `selfTarget`)
// The three yes/no settings are real constructor arguments (ctor 3, 4 and 5), so they stay three settings; the
// two "every" switches override the first one, which the labels say.
//
// Every live closure, read from the running game (bindings.ts has the per-ability lines):
//   (a) `move.doesFlagEffectApply({flag: MAKES_CONTACT, user, target})`            Weak Armor x2, Tangling Hair, Moustache, Massive Pelt
//   (b) `move.hasFlag(MAKES_CONTACT)`  (the plain flag)                            Gooey, Mucus Membrane, Slime Mold
//   (c) `move.category !== STATUS`                                                 Stamina x2, Crowned Shield, Moustache, Cotton Down
//   (d) `user.getMoveType(move) === T && move.category !== STATUS`                 Water Compaction, Thermal Exchange, Thermal Entropy, Steam Engine, Rattled
// (a), (c), (d) map onto library atoms exactly. (b) stays a legacy-closure: the library flag atom asks doesFlagEffectApply
// (which also honours Long Reach, Punching Glove and flags an ability injects) where these three read the plain flag.
import { PostDefendStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

/** Whose stat the summary talks about, from the three yes/no settings. */
function whoseStat(params: Readonly<Record<string, string | number | boolean>>): string {
  if (params.opponentsOnly === true) {
    return "every adjacent foe's";
  }
  if (params.allOthers === true) {
    return "every other adjacent Pokemon's";
  }
  return params.selfTarget === false ? "the attacker's" : "my";
}

export default defineDecl(PostDefendStatStageChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Change a stat after I am hit by a certain kind of move",
  summary: params =>
    `After I am hit by a move that meets the rule you set, ${whoseStat(params)} ${params.stat} changes by ${params.stages} stages. Example: -1 Speed on the attacker after a contact hit, like Gooey.`,
  synonyms: [
    "gooey",
    "tangling hair",
    "weak armor",
    "stamina",
    "rattled",
    "cotton down",
    "steam engine",
    "water compaction",
    "thermal exchange",
    "stat change when hit",
    "lower speed on contact",
    "boost defense when hit",
  ],
  examples: [
    "Lower the attacker's Speed by one stage when it makes contact, like Gooey",
    "Raise my Defense by one stage whenever I am hit by a damaging move, like Stamina",
  ],
  params: [
    {
      id: "stat",
      ctorIndex: 1,
      path: "stat",
      control: "select",
      label: "Which stat changes",
      editable: true,
      default: "SPD",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 2,
      path: "stages",
      control: "number",
      label: "Number of stages (-6 to 6, negative lowers)",
      editable: true,
      default: -1,
      min: -6,
      max: 6,
      step: 1,
      integer: true,
    },
    {
      id: "selfTarget",
      ctorIndex: 3,
      path: "selfTarget",
      control: "boolean",
      label: "Change my own stat (off: change the attacker's stat)",
      editable: true,
      default: false,
    },
    {
      id: "allOthers",
      ctorIndex: 4,
      path: "allOthers",
      control: "boolean",
      label: "Change every other adjacent Pokemon, allies too (overrides the choice above)",
      editable: true,
      default: false,
    },
    {
      id: "opponentsOnly",
      ctorIndex: 5,
      path: "opponentsOnly",
      control: "boolean",
      label: "Change every adjacent foe only, never the ally (overrides the two choices above)",
      editable: true,
      default: false,
    },
  ],
  conditions: [
    // Required closure `(target, user, move) => boolean`, the `defend` shape: the holder is the target, the attacker the user.
    { slot: "ctor:0", ctx: "defend", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.stat-stage", params: ["stat", "stages", "selfTarget", "allOthers", "opponentsOnly"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Contact and non-contact, damaging and status, and a move type for each of the type rules.
      name: "contact, non-contact, typed and status moves",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "EMBER", "BITE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (18 attrs, 15 abilities): Weak Armor (133 attr 0 Defense -1, attr 1 Speed +2, both contact), Rattled (155, Bug, Ghost or Dark damaging move: Speed +1), Gooey (183), Stamina (192) and its copy (6002), Water Compaction (195, Water, Defense +2), Tangling Hair (221), Cotton Down (238, every adjacent foe, Speed -1, damaging), Steam Engine (243, Fire or Water, Speed +6), Thermal Exchange (270) and Thermal Entropy (5711, Fire, Attack +1), Crowned Shield (5257 attr 2), Moustache (5602 attr 0 and attr 2), Massive Pelt (5647), Mucus Membrane (5685), Slime Mold (5734 attr 1). Bound: every closure of kinds (a), (c) and (d). Legacy-closure (kind b, plain contact flag): Gooey, Mucus Membrane, Slime Mold attr 1 (request R-B01-10). Oddities (not fixed): Gooey, Mucus Membrane and Slime Mold use the plain flag where Tangling Hair, Massive Pelt, Moustache and Weak Armor use doesFlagEffectApply, so only the second group respects Long Reach, Punching Glove and substitutes; the ER vanilla-rebalance patcher rewrites the vanilla closures after construction (init-elite-redux-vanilla-rebalance.ts), so the bindings were read from the live attrs. The subclass FirstDefendAttackerAtkDropAbAttr (archetype consume-on-first-defend) overrides canApply and is a separate declaration in another batch. With `allOthers` or `opponentsOnly` the attacker is not the target, the phase targets each adjacent Pokemon (placement matters in triples); no user sets `allOthers`.",
});
