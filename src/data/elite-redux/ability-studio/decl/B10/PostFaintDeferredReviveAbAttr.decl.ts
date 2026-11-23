/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 4 / event-effect (Tier B).
//
// Read by hand from archetypes/post-faint-deferred-revive.ts. The class extends PostFaintAbAttr (WHEN "when I faint"), constructor
// `{ hpFraction, requireWeather?, requireTerrain? }` (hpFraction must be in (0, 1], else it throws), `super(true)`. canApply in the
// ORIGINAL clause order:
//   1. USED_THIS_BATTLE.get(pokemon) -> false                          guards  (once-per-Pokemon latch kept in this file)
//   2. requireWeather set: arena.weather?.weatherType must be on the list   gate  (library field.weather, any-of)
//   3. requireTerrain set: (arena.terrain?.terrainType ?? NONE) on the list  gate  (the terrain OBJECT, not negated by Clueless)
// no prepare, no residual, no random draw. apply: simulated -> nothing; else USED_THIS_BATTLE.set(pokemon, true) and
// PENDING_REVIVE.set(pokemon, hpFraction). The revive itself happens later, in SummonPhase.onEnd -> erApplyPendingRevives(isPlayer):
// every fainted party member with a pending fraction gets hp = max(1, floor(maxHp * fraction)), its status is reset, a message is queued.
//
// Clause classification: the environment test is the rule staff would change (fog, a terrain, no requirement), so it is the gate. The
// once-per-Pokemon latch is a design rule too, but its memory is a private WeakMap that the library's once-per atom cannot read, so it
// stays a guard in the class (request R-B10-c4-05). The effect is a two-step state machine across turns (arm now, revive at the next
// send-out), which no library effect does: a package with one typed setting, the share of max HP.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostFaintDeferredReviveAbAttr } from "#data/elite-redux/archetypes/post-faint-deferred-revive";
import { fractionAsPercentCodec } from "./b10-codecs";
import { NO_REQUIREMENT, terrainListCodec, weatherListCodec } from "./c4-codecs";

/** Every setting lives inside the one options argument; `ctorOption` names the key the builder fills. */
const IN_OPTIONS = { ctorIndex: 0 } as const;

const isNone = (value: unknown): boolean => value === NO_REQUIREMENT || value === "None";

export default defineDecl(PostFaintDeferredReviveAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.faint",
  label: "Come back to the party after fainting, only once ever",
  summary: params => {
    const rules = [
      isNone(params.requireWeather) ? "" : `the weather is ${params.requireWeather}`,
      isNone(params.requireTerrain) ? "" : `the terrain is ${params.requireTerrain}`,
    ].filter(rule => rule.length > 0);
    return `${rules.length > 0 ? `If I faint while ${rules.join(" and ")}, ` : "When I faint, "}I am revived at ${params.hpFraction}% HP as a reserve the next time my side sends out a Pokemon. This works only once for this Pokemon: it never resets, not even in the next battle.`;
  },
  synonyms: [
    "revive after fainting",
    "second life",
    "come back from the dead",
    "shallow grave",
    "backup power",
    "delayed revive",
    "phoenix",
  ],
  examples: [
    "If I faint in fog, I come back at 25% HP when my next Pokemon is sent out, like Shallow Grave",
    "If I faint in Electric Terrain, I am revived at 25% HP once, like Backup Power",
  ],
  params: [
    {
      id: "hpFraction",
      ...IN_OPTIONS,
      ctorOption: "hpFraction",
      path: "hpFraction",
      control: "number",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "HP I come back with (% of max HP, at least 1 HP)",
      editable: true,
      gateIndependent: true,
      default: 25,
      codec: fractionAsPercentCodec,
    },
    {
      id: "requireWeather",
      ...IN_OPTIONS,
      ctorOption: "requireWeather",
      path: "requireWeather",
      control: "text",
      label: "Built-in rule: weather needed when I faint (a list; None = any; your condition block replaces it)",
      editable: false,
      default: NO_REQUIREMENT,
      codec: weatherListCodec,
    },
    {
      id: "requireTerrain",
      ...IN_OPTIONS,
      ctorOption: "requireTerrain",
      path: "requireTerrain",
      control: "text",
      label: "Built-in rule: terrain needed when I faint (a list; None = any; your condition block replaces it)",
      editable: false,
      default: NO_REQUIREMENT,
      codec: terrainListCodec,
    },
  ],
  conditions: [
    // The gate: the weather and the terrain that must be active at faint time. Shallow Grave has an exact form, any-of the two fog weathers, but both users are legacy for now (R-B10-c4-12);
    // Backup Power cannot map (the class reads the terrain object, the library atom reads the negated terrain, request R-B10-c4-02).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only once for this Pokemon in the whole run: the latch is kept per Pokemon object and nothing ever clears it, so it does not start again with the next battle (game behaviour kept as is, see the oddities)",
    "I really do faint and leave the field; the revive comes when my side next sends out a Pokemon, and I return as a reserve, not onto the field",
    "Nothing is armed in a preview",
  ],
  effect: { id: "effect.package", params: ["hpFraction"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "faint with and without fog", axes: { weather: ["FOG", "SUNNY"] } }],
  l2StaticReason:
    "Both users are legacy-closure gates, so the rebuild cannot be built and the L2 twin has no rebuilt attr to compare (the library has no event.faint scenario builder yet either). The B10 tests (test/tests/elite-redux/decomp/B10/chunk4-gates.test.ts and chunk4-effects.test.ts) drive canApply and apply of the original, of the class with its own gate and, for Shallow Grave, of the exact two-atom library gate over weather, terrain and the latch, and erApplyPendingRevives for the deferred half.",
  status: "decomposed",
  notes:
    "Tier B split by hand (guard: the once-per-Pokemon latch; gate: weather and terrain requirement; no residual). Users (2 attrs): Shallow Grave attr 0 (25%, weather Fog or Eerie fog, no terrain) has an exact library form, any-of two field.weather atoms (the class reads arena.weather?.weatherType and the atom reads arena.weatherType, which is `weather?.weatherType ?? NONE`; proved in chunk4-gates.test.ts), but it is bound legacy until the L1 harness can drive a library gate for the trigger when I faint (request R-B10-c4-12: world.ts needs an engine-parameter builder for it); Backup Power attr 0 (25%, Electric terrain, no weather) is bound legacy because the class reads arena.terrain?.terrainType (the terrain object) while the library field.terrain reads arena.terrainType, which returns NONE while a Clueless holder negates the terrain (request R-B10-c4-02). Package justified: the effect arms a per-Pokemon record now and restores HP and clears the faint status at a later send-out (SummonPhase.onEnd calls erApplyPendingRevives); there is no library effect that waits for another moment, and the revive is applied to an off-field reserve (no heal phase). It has one typed setting, the share of max HP (request R-B10-c4-05 for an effect and a shared once-per-battle atom). Oddities, NOT fixed: a Pokemon that faints twice in one battle is not revived the second time (the latch is per Pokemon and is never reset, not inside a battle and not between battles, so in practice it is once per Pokemon for the whole run; suspected game bug, NOT fixed); erApplyPendingRevives revives EVERY flagged fainted member of the side at each send-out, not only the holder; the latch and the pending record are module-level WeakMaps, not part of a saved game (a reload forgets both).",
});
