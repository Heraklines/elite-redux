/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 3 / event effect, Tier B (the gate lives in canApply). See ../PRECEDENTS.md.
//
// "When I enter the battle, IF a field effect is up on my side, raise a stat of mine by one stage". Subclass of
// PostSummonStatStageChangeAbAttr, which the parent builds as `super([ATK], 1, true, false)` (one stage, on myself, not an Intimidate);
// the constructor adds `(arenaTagType, statResolver?)`. Clauses of canApply, in the ORIGINAL order, now `guards && gate && residual`:
//   1. gate      `arena.getTagOnSide(arenaTagType, holder's own side) ?? false`   the CONDITION "the field effect is up on my side"
//                (library atom field.arena-tag, side holder-side). The tag it looks for is a SETTING (param `arenaTag`, ctor 0), written
//                into the gate through `gateParams`, so moving the setting moves the compiled gate too.
//   2. residual  `super.canApply(params)`   always true (PostSummonAbAttr), kept so the order and the short-circuit stay as they were.
// apply (not simulated): queues a StatStageChangePhase (+1, on myself) for `statResolver(pokemon)` when there is a resolver, else for
// Attack through the parent. The resolver picks the stat at apply time, so it is a setting too (param `stat`).
//
// The class edit is the pure Tier B move of code described in the spec (3.1): `canApply` calls `gatedCanApply`, the tag test moved into
// `gate`, `super.canApply` into `residual`, and `gateOverride` was declared. No clause was added, dropped or reordered.
import { PostSummonStatStageChangeOnArenaAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { ArenaTagType } from "#enums/arena-tag-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";

const HIGHER_ATTACK = "HIGHER_ATTACK";

/** Same comparison as `erHigherAttackStat` in init-abilities.ts (Wind Rider): the higher attacking stat, unstaged. */
const higherAttackStat = (pokemon: Pokemon): Stat.ATK | Stat.SPATK =>
  pokemon.getStat(Stat.SPATK, false) > pokemon.getStat(Stat.ATK, false) ? Stat.SPATK : Stat.ATK;

/** Resolvers this declaration built for a fixed stat, so a rebuilt instance reads back the stat that was chosen. */
const fixedStatOf = new WeakMap<object, string>();

const plainStat = enumCodec(Stat, "stat");

/**
 * The class takes a RESOLVER `(pokemon) => stat`, or nothing for Attack. Staff pick "Higher attack" (Attack or Sp. Atk, whichever is
 * greater, the only function the game passes) or one fixed stat. Attack is the class default, so it is passed as no resolver at all.
 */
const statOrHigherAttack: ParamCodec = {
  toCtor: value => {
    if (value === HIGHER_ATTACK) {
      return higherAttackStat;
    }
    if (value === "ATK") {
      return;
    }
    const stat = plainStat.toCtor(value);
    const resolver = () => stat;
    fixedStatOf.set(resolver, String(value));
    return resolver;
  },
  fromInstance: raw => {
    if (raw === undefined) {
      return "ATK";
    }
    if (typeof raw === "function") {
      return fixedStatOf.get(raw) ?? HIGHER_ATTACK;
    }
    return;
  },
};

/** The summary prints the player-facing choice ("Higher attack"), spelled out. */
const statWords = (stat: unknown): string => (stat === "Higher attack" ? "higher of Attack and Sp. Atk" : String(stat));

/** Every field effect except the empty one. */
const FIELD_EFFECT_OPTIONS = Object.keys(ArenaTagType).filter(name => name !== "NONE");

export default defineDecl(PostSummonStatStageChangeOnArenaAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Raise a stat when I enter and a field effect is up",
  summary: params =>
    `When I enter the battle while ${params.arenaTag} is up on my side, my ${statWords(params.stat)} goes up by 1 stage. Example: Wind Rider with Tailwind.`,
  synonyms: [
    "wind rider",
    "tailwind boost",
    "boost on entry",
    "raise attack when tailwind is up",
    "entry boost with a field effect",
    "stat boost on switch in",
  ],
  examples: ["Raise my higher attacking stat by one stage when I enter while Tailwind is up, like Wind Rider"],
  params: [
    {
      id: "arenaTag",
      ctorIndex: 0,
      path: "arenaTagType",
      control: "select",
      label: "Field effect that must be up on my side",
      editable: true,
      default: "TAILWIND",
      options: FIELD_EFFECT_OPTIONS,
    },
    {
      id: "stat",
      ctorIndex: 1,
      path: "statResolver",
      control: "select",
      label: "Which stat goes up (Higher attack picks Attack or Sp. Atk, whichever is greater)",
      editable: true,
      gateIndependent: true,
      default: HIGHER_ATTACK,
      options: [HIGHER_ATTACK, ...STAT_OPTIONS],
      codec: statOrHigherAttack,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  gateParams: [{ param: "arenaTag", block: "field.arena-tag", field: "tag" }],
  guards: [],
  feasibility: [
    "The stat only moves when I really enter (a simulated preview changes nothing)",
    "A stat that is already at its limit does not move further",
    "The number of stages (one) and the target (me) are fixed",
  ],
  effect: { id: "effect.stat-stage", params: ["stat"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entering with and without the field effect on my side", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B. User (live dump, 1 attr): Wind Rider (274, attr 1): tag TAILWIND, resolver erHigherAttackStat (the same function B01 declares for MoveImmunityStatStageChangeAbAttr). Its attr 0 is that class. The effect is `effect.stat-stage` with the stat setting only: the library effect also offers a target and a number of stages, which this class fixes to me and 1. The stat codec accepts one fixed stat too (a closure the codec builds); the game itself only passes the higher-attack function or nothing. Behaviour check: the gate uses `getTagOnSide(...)` truthiness while the library atom tests `!== undefined`; a tag object is always truthy, so they agree. The class ignores the arena tag's turn count (an expiring tag at its last turn still counts). Library notes in requests/B07.md R-B07-13.",
});
