/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 2. "For my first turns on the field, no attack counts as more than not very effective" (Soothsayer, and Forewarn's
// two-turn upgrade).
//
// Source: src/data/elite-redux/archetypes/time-limited-effectiveness-floor.ts, TimeLimitedEffectivenessFloorAbAttr (extends
// FullHpResistTypeAbAttr, ab-attrs.ts:608, so the engine's applyAbAttrs("FullHpResistTypeAbAttr") in Pokemon.getMoveEffectiveness finds
// it). Constructor: one options object `{ turns, activeWindowKey? }`; it throws when `turns <= 0`. Clauses of the OLD canApply, in the
// original order:
//   1. `activeWindowKey === undefined || tempSummonData.abilityEntryWindows.has(activeWindowKey)`   GATE part: the named window is open
//   2. `(tempSummonData?.turnCount ?? 1) <= turns`                                                   GATE part: still within my first turns
//   3. `typeMultiplier instanceof NumberHolder`                                                      GUARD: the engine passed a real holder
//   4. `!move?.hasAttr("FixedDamageAttr")`                                                           GUARD: a fixed-damage move has no matchup
//   5. `typeMultiplier.value > 0.5`                                                                  RESIDUAL: only a matchup above 0.5 is lowered
// Tier B: canApply is gatedCanApply: guards (3, 4), then the gate (1, 2), then the residual (5). Clauses 3 and 4 moved ahead of 1 and 2;
// all five are pure and cannot throw, so the answer is the same (B12/chunk2.test.ts compares the new canApply with the old formula over
// every combination).
// apply (inherited from the full-HP class): `typeMultiplier.value = 0.5; pokemon.turnData.moveEffectiveness = 0.5`, so every hit of a
// multi-hit move is floored. getTriggerMessage is overridden to an empty text (the ability banner is enough). No random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TimeLimitedEffectivenessFloorAbAttr } from "#data/elite-redux/archetypes/time-limited-effectiveness-floor";
import { optionalTextCodec } from "./b12-chunk2-codecs";

const IN_PAYLOAD = { ctorIndex: 0 } as const;

export default defineDecl(TimeLimitedEffectivenessFloorAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.type-matchup",
  label: "Resist every attack for my first turns on the field",
  summary: params =>
    `For my first ${params.turns} turns after I enter, no attack counts as more effective than not very effective (x${params.ceiling}). Weaker matchups are left alone. Fixed-damage moves are skipped.`,
  synonyms: [
    "no super effective hits for a few turns",
    "temporary tera shell",
    "early game shield",
    "entry resistance",
    "turns after entry shield",
    "soothsayer",
    "forewarn",
  ],
  examples: [
    "For three turns after I enter, every attack counts as not very effective, like Soothsayer",
    "For my first two turns on the field, super effective hits count as resisted",
  ],
  params: [
    {
      id: "turns",
      ...IN_PAYLOAD,
      ctorOption: "turns",
      path: "turns",
      control: "number",
      integer: true,
      min: 1,
      max: 99,
      step: 1,
      label: "Number of turns after I enter (1 = only the entry turn)",
      editable: true,
      default: 3,
    },
    {
      id: "ceiling",
      ...IN_PAYLOAD,
      ctorOption: "ceiling",
      path: "ceiling",
      control: "number",
      min: 0,
      max: 4,
      step: 0.25,
      label:
        "Strongest matchup multiplier an attack may keep (0.5 = not very effective, 0.25 = barely effective, 0 = no effect)",
      editable: true,
      // Only the effect reads it; the gate (window and turn count) never repeats it.
      gateIndependent: true,
      default: 0.5,
    },
    {
      id: "activeWindowKey",
      ...IN_PAYLOAD,
      ctorOption: "activeWindowKey",
      path: "activeWindowKey",
      control: "text",
      label: "Name of the timed window that must be open (empty = no window needed)",
      // It decides the SHAPE of the gate (one atom or two), so it is not a setting staff can move.
      editable: false,
      default: "",
      codec: optionalTextCodec,
    },
  ],
  // The turn limit is the same setting as the gate's number of turns.
  gateParams: [{ param: "turns", block: "time.turn-count", field: "n" }],
  conditions: [
    // The gate: [window open (only when a name is given)] and [turn count <= turns]. time.turn-count reads
    // holder.tempSummonData.turnCount. The window atom does not exist yet (R-B12-16).
    { slot: "gate", ctx: "params", lib: "time.turn-count", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Fixed-damage moves (Seismic Toss, Dragon Rage) are not affected",
    "Only a matchup above x0.5 is lowered; an already weaker one (x0.25 or no effect) is never raised",
    "Not used for status moves, and not when the attacker's move ignores abilities",
    "The turn count starts at 1 on the turn I enter and starts again when I switch out and back in",
  ],
  // No library effect caps the type matchup yet (R-B01-15); it is shown as one piece until it exists. Its number is the editable `ceiling` param (default 0.5), read by residual and apply; at B01 merge map it onto the parent's `matchupCeiling`.
  effect: { id: "effect.package", params: ["ceiling"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [
    {
      // A super effective, a neutral and a resisted move against the holder.
      name: "a super effective, a neutral and a fixed-damage move in the first turn",
      axes: { foeMove: ["KARATE_CHOP", "TACKLE", "SEISMIC_TOSS"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 2 attrs. Soothsayer (5474 attr 0, 3 turns, no window) is bound to time.turn-count { lte 3 } with `turns` in gateParams. Forewarn (108 attr 2, 2 turns, window 'upgrade:forewarn:two-turn-soothsayer', opened by ActivateOncePerBattleEntryWindowAbAttr at attr 1) needs 'the window is open' as well, which has no atom (request R-B12-16), so its gate is a legacy-closure. `activeWindowKey` is not editable because it decides the shape of the gate. Effect is shown as effect.package because no library effect caps the type matchup (R-B01-15); the cap number is the `ceiling` constructor option (default 0.5, added in review: residual and an overridden apply read it, so shipped behaviour is unchanged); at B01 merge it should map onto the parent's `matchupCeiling` / B01 decl `ceiling`. The old canApply is split into guards (3, 4), gate (1, 2) and residual (5); the guards moved ahead of the gate, which is safe because every clause is pure and total (the only access that could fail, `tempSummonData.abilityEntryWindows`, is on an object the engine always creates). Oddities, not fixed: (a) the turn count lives in `tempSummonData.turnCount`, which starts at 1, goes up at the end of every turn (turn-end-phase.ts:153) and is lowered by one on a mid-turn switch-in (switch-summon-phase.ts:439), so '3 turns' means the entry turn plus the next two; (b) the inherited trigger message is overridden to an empty text, so no text shows besides the banner.",
});
