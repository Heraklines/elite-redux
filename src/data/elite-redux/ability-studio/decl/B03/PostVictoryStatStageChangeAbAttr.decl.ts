/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03. Tier A with nothing to bind: the class has no canApply (the base class answers true) and no closure.
// `apply` queues a StatStageChangePhase for the holder (skipped when simulated).
//
// The `stats` argument is a single stat (Moxie, the Neighs, As One, Strong-Headed), a list of stats (Battle Bond's
// generic branch: Attack, Sp. Atk and Speed) or a FUNCTION that picks the stat when the KO happens (Beast Boost: the
// highest stat). The codec turns the first two into words ("ATK", "ATK,SPATK,SPD") and the function into "HIGHEST".
//
// Battle Bond (attr 4 of ability 210) carries an attr-level condition (AbAttr.addCondition: not Greninja, no Battle
// Bond form change, not applied yet); the rebuild copies it unchanged, it is not part of this class's own rule.
import { PostVictoryStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { EFFECTIVE_STATS, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";

const BATTLE_STAT_NAMES = ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"] as const;
const HIGHEST = "HIGHEST";
const STATS = Stat as unknown as Readonly<Record<string, number | string>>;

/**
 * "The stat with the highest value", the rule Beast Boost uses. It is the same loop as the one written inline in
 * init-abilities.ts (which cannot be imported): first stat wins a tie, `getStat(stat, false)` is the plain stat.
 * Beast Boost is the only user that passes a function; the L2 twin of Beast Boost proves both pick the same stat.
 */
function highestStat(pokemon: Pokemon): (typeof EFFECTIVE_STATS)[number] {
  let best: (typeof EFFECTIVE_STATS)[number] | undefined;
  let bestValue = 0;
  for (const stat of EFFECTIVE_STATS) {
    const value = pokemon.getStat(stat, false);
    if (value > bestValue) {
      best = stat;
      bestValue = value;
    }
  }
  return best!;
}

const statsCodec: ParamCodec = {
  toCtor: value => {
    const text = String(value).trim();
    if (text === HIGHEST) {
      return highestStat;
    }
    const stats = text
      .split(",")
      .map(part => part.trim())
      .filter(part => part.length > 0)
      .map(part => {
        const resolved = STATS[part];
        if (typeof resolved !== "number" || !(BATTLE_STAT_NAMES as readonly string[]).includes(part)) {
          throw new Error(`"${part}" is not a stat that has stages`);
        }
        return resolved;
      });
    if (stats.length === 0) {
      throw new Error("pick at least one stat");
    }
    // A single stat stays a plain number, like the original `Stat.ATK`, so the instance fields match.
    return stats.length === 1 ? stats[0] : stats;
  },
  fromInstance: raw => {
    if (typeof raw === "function") {
      return HIGHEST;
    }
    const list = Array.isArray(raw) ? raw : [raw];
    const names = list.map(item => (typeof item === "number" ? STATS[item] : undefined));
    return names.every((name): name is string => typeof name === "string") ? names.join(",") : undefined;
  },
};

export default defineDecl(PostVictoryStatStageChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-win",
  label: "Raise my stats after I knock out a Pokemon",
  summary: params =>
    `After I knock out a Pokemon, my stats change by ${params.stages} stage(s): ${params.stats} (Highest means my best stat). Example: +1 Attack.`,
  synonyms: [
    "moxie",
    "beast boost",
    "chilling neigh",
    "grim neigh",
    "snowball",
    "boost after a ko",
    "attack boost on ko",
  ],
  examples: ["Raise my Attack by one stage every time I knock out a Pokemon"],
  params: [
    {
      id: "stats",
      ctorIndex: 0,
      path: "stats",
      control: "text",
      label: "Stats to change (comma separated names, or Highest for my best stat)",
      editable: true,
      default: "ATK",
      options: [...BATTLE_STAT_NAMES, HIGHEST],
      codec: statsCodec,
    },
    {
      id: "stages",
      ctorIndex: 1,
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages to change (+1 raises one stage, -1 lowers one stage)",
      editable: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["The stat must not be at its limit (the game then only says it cannot go any higher)"],
  effect: { id: "effect.stat-stage", params: ["stats", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "knock out a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 12 attrs of 11 ability ids (As One exists under four ids): Moxie (Attack +1), Chilling Neigh / As One Glastrier (Attack +1), Grim Neigh / As One Spectrier (Sp. Atk +1), Crowned King (two attrs), Strong-Headed, Battle Bond generic branch ([Attack, Sp. Atk, Speed] +1, with an attr-level extraCondition) and Beast Boost (function: highest stat). The class has no canApply, so the only gate besides the dispatch is the attr-level condition. The engine only dispatches PostVictoryAbAttr to the Pokemon that dealt the knock-out and is still on the field. `highestStat` repeats Beast Boost's inline loop (same stats, same tie rule); keep them in sync. Quirk recorded: the class unshifts one StatStageChangePhase with the whole stat list, so Battle Bond's three stats rise in a single phase.",
});
