/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 4. Tier B, package for the effect only. "At the end of every turn, while it is raining (ordinary or heavy rain), every one of my moves gets PP back (1 by default, never above its maximum)."
//
// Source: src/data/elite-redux/abilities/rain-pump.ts, class RainPumpAbAttr (extends PostTurnAbAttr; super(true), showAbility stays true). canApply, now guards && gate && residual in the ORIGINAL clause order (no draw):
//   1. gate      isRainingNow(): arena.weather exists, is not effect-suppressed (Cloud Nine and friends), and weatherType is RAIN or HEAVY_RAIN   -> CONDITION (the weather)
//   2. residual  holder.getMoveset().some(m => !!m?.getMove() && m.ppUsed > 0)                       -> feasibility (at least one move has PP to get back)
//   (no guard)
// apply (effect), not when simulated: for every move with a resolved move id, ppUsed = max(0, ppUsed - ppRestored). No message of its own beyond the ability flyout (showAbility true), no draw.
// Constructor change (behaviour-neutral): the PP per tick is a constructor argument (default 1, the old module constant).
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); gate and residual are the two clauses above verbatim. `gateOverride` is declared for the compiler.
import { RainPumpAbAttr } from "#data/elite-redux/abilities/rain-pump";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(RainPumpAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Restore PP to all my moves",
  summary: params =>
    `Every one of my moves gets ${params.ppRestored} PP back at the end of the turn (never above its maximum). By default only while it is raining. Example: 1 = each move recovers 1 PP.`,
  synonyms: ["rain pump", "recover pp", "pp recovery", "refill pp", "regain pp every turn", "restore pp in rain"],
  examples: ["At the end of each turn in rain, every move of mine regains 1 PP, like Rain Pump"],
  params: [
    {
      id: "ppRestored",
      ctorIndex: 0,
      path: "ppRestored",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "PP each move gets back per turn",
      editable: true,
      gateIndependent: true,
      default: 1,
    },
  ],
  conditions: [
    // The gate is the weather clause (rain or heavy rain, effect not suppressed). The library atom field.weather ignores suppression (R-B15-32), so it is bound as a legacy closure.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "At least one of my moves must have used PP, otherwise nothing happens",
    "A move never goes above its maximum PP",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["ppRestored"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Rain and heavy rain are the true cases; clear weather and sun are the false ones. L1 and L2 use the first six combinations.
      name: "rain, heavy rain and other weather at the end of the turn",
      axes: { weather: ["RAIN", "HEAVY_RAIN", "SUNNY", "NONE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, justified; the trigger (end of turn) and the weather condition are separate blocks. 1 attr in 1 ability: Rain Pump (5915 attr 0, 1 PP). The effect cannot be split because the library has no PP effect: a block 'Give PP back to every move of mine' (a direct ppUsed decrement, there is no engine helper) and the condition 'at least one of my moves has used PP'; requested as R-B15-33. The weather gate is bound as a legacy closure: the class asks arena.weather.isEffectSuppressed() before reading the type, while the library atom field.weather reads arena.weatherType, which does not know about suppression, so the two disagree when Cloud Nine or Air Lock is on the field; requested as R-B15-32 (condition 'The weather is being cancelled'). The PP amount is a typed setting (constructor argument, old constant as default). Suspected oddities, NOT fixed: (1) the effect shows the ability name but no restore message; (2) heavy rain counts as rain, as the ability text says.",
});
