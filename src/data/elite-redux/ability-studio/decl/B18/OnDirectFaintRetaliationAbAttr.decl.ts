/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 4, Tier B event-effect with a one-piece effect. Ill Will and Tummyache. "When I faint, IF a foe's damaging move knocked me out
// AND the foe is still standing, DO stop it using the same move twice in a row (Torment) or switch off its ability (Gastro Acid)".
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over PostFaintAbAttr (constructor `(moveId)`, showAbility false). Dispatch:
// applyAbAttrs("PostFaintAbAttr", { pokemon: holder, attacker, move }) in faint-phase.ts, with the newest entry of attacksReceived (without
// any entry the dispatch has neither attacker nor move). Both users make their ability bypass the faint check (Ability.makeBypassFaint,
// init-elite-redux-ability-upgrades.ts), so the attr is asked while the holder is already fainted. canApply, in the ORIGINAL order (one
// expression, now guards && gate && residual, every clause a pure read):
//   guard     !!attacker && !!move                      -> something knocked me out (not poison, weather or recoil)
//   gate 1    move.category !== STATUS                  -> condition (library atom move.damaging)
//   gate 2    attacker !== pokemon                      -> condition (library atom side.is kind self, negated)
//   residual  !attacker.isFainted()                     -> feasibility: the one who knocked me out is still standing (request R-B18-33)
// apply     unless simulated (and an attacker exists): GASTRO_ACID -> attacker.suppressAbility() then arena.triggerWeatherBasedFormChangesToNormal();
//           TORMENT -> attacker.addTag(TORMENT, 1). No random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OnDirectFaintRetaliationAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { RETALIATION_OPTIONS, retaliationCodec } from "./b18-chunk4-codecs";

export default defineDecl(OnDirectFaintRetaliationAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.faint",
  label: "Hit back at the foe that knocked me out with a move",
  summary: params =>
    `When a foe's damaging move knocks me out and the foe is still standing, I get back at it: ${String(params.retaliation).toLowerCase()}. Example: Ill Will, Tummyache.`,
  synonyms: [
    "ill will",
    "tummyache",
    "revenge when fainted",
    "curse the attacker",
    "gastro acid on faint",
    "torment on faint",
    "take away its ability when knocked out",
  ],
  examples: [
    "When I am knocked out by a move, the foe cannot use the same move twice in a row, like Ill Will",
    "When I am knocked out by a move, the foe's ability stops working, like Tummyache",
  ],
  params: [
    {
      id: "retaliation",
      ctorIndex: 0,
      path: "moveId",
      control: "select",
      label: "What happens to the foe that knocked me out",
      editable: true,
      gateIndependent: true,
      default: "Stop it using the same move twice in a row",
      options: RETALIATION_OPTIONS,
      codec: retaliationCodec,
    },
  ],
  // The gate is all[move.damaging, not side.is {self}], in the class's own order (see bindings.ts).
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  // The class keeps "something knocked me out" (an attacker and a move exist) in its own `guards` method; no registered guard id says it
  // yet (request R-B18-34), so it is listed as feasibility below and not as a guard id.
  guards: [],
  feasibility: [
    "A foe and its move must have knocked me out (nothing happens after poison, weather or recoil)",
    "The foe that knocked me out must still be standing",
    "Nothing happens when the game only previews the faint",
  ],
  effect: { id: "effect.package", params: ["retaliation"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared faint scenario stops at the start of the FaintPhase, before the faint-time abilities are asked (decomp-l2-reach.json lists event.faint as unreached), so B18/chunk4.test.ts runs the real attr and its rebuild against real knock-outs and compares the answers and the effects.",
  probes: [
    {
      // Both foe moves must be able to knock the holder out (the faint scenario waits for the faint). The status move and the "no move" case
      // cannot be reached by a battle, so B18/chunk4.test.ts drives the attr with them.
      name: "knocked out by two different damaging moves",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "WHY THE EFFECT STAYS ONE PIECE: the effect is one of two fixed actions chosen by the typed `retaliation` setting. 'Switch off a Pokemon's ability' (Gastro Acid, followed by the weather-form refresh) and 'give a Pokemon Torment for one turn count' have no library effect: effect.apply-tag has no turn count and no source and effect.suppress-ability does not exist (request R-B18-35 asks for both, and for the weather refresh to be part of the second). The trigger (event.faint) and the two conditions (the move deals damage, the other Pokemon is not me) are separate blocks. Users (2 attrs): Ill Will (5285, attr 1, Torment) and Tummyache (5653, attr 4, Gastro Acid), both with the bypass-faint flag set after build. Class change (pure move, no behaviour change): gateOverride field, canApply = gatedCanApply, guards = `!!attacker && !!move`, gate = move.category !== STATUS && attacker !== pokemon, residual = !attacker.isFainted(). ODDITIES, not fixed: (1) `attacker !== pokemon` is only false when the first entry of my attacksReceived list came from myself; it is kept as the atom `not side.is self`; (2) the attacker and move are read from the FIRST entry of attacksReceived (faint-phase.ts), which is the newest hit only while the list is filled with unshift, so a faint after several hits in one turn is attributed to whichever hit that entry records; (3) Torment is added with turn count 1, so it lasts a short time, and addTag can refuse it (for example behind an ability that blocks it) silently; (4) Gastro Acid ignores the target's ability flags (suppressAbility is called directly); (5) the banner is not shown (showAbility false). Verified statically in B18/chunk4.test.ts because the shared L2 faint scenario cannot reach the trigger.",
});
