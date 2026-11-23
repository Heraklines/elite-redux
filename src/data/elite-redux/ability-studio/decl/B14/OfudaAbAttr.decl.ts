/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 2. Tier B, event-effect, RNG in canApply. "Sometimes, whatever move hits me, its user gets cursed."
//
// Source: fakemon-pitch-mechanics.ts OfudaAbAttr (extends PostDefendAbAttr; dispatched as PostDefendAbAttr).
// canApply, original clause order, now `guards && gate && residual`:
//   guards    1. !simulated                          not while the game only previews a hit
//             2. hitResult < HitResult.NO_EFFECT      a real hit, not a block (no damage test: a hit that deals 0 still counts)
//             3. opponent !== pokemon                 not myself
//   gate      4. pokemon.randBattleSeedInt(100) < chance      the chance roll, the ONLY random draw
//   residual  5. opponent.canAddTag(tag)              the attacker can take the effect (asked only after the roll passed)
// The draw happens after the three cheap guards and BEFORE the can-add check, so a roll is spent even when the attacker turns
// out to be uncursable, and no roll is spent for a simulated call, a blocked hit or a self-hit. The library gate keeps
// rng.chance in the same place. Clauses 1 to 3 are guards; clause 3 could also be read as "only foes", but the original allows
// allies, so it stays a locked safety rule rather than a side condition.
// There is no contact test: any move that hits counts ("contact-independent").
//
// apply: `opponent.addTag(tag, 0, move.id, holder.id)`, nothing else (no second roll).
import { OfudaAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { LINGERING_EFFECT_WORDS, lingeringEffectCodec } from "./chunk2-codecs";

export default defineDecl(OfudaAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Sometimes curse the attacker when I am hit",
  summary: params =>
    `${params.chance}% chance, each time a move hits me, that its user gets ${params.tag}. Contact is not needed. Example: 30% chance to curse the attacker.`,
  synonyms: [
    "ofuda",
    "curse the attacker",
    "curse on hit",
    "hex attacker",
    "talisman",
    "random curse",
    "sometimes curse",
  ],
  examples: ["30% chance to curse any Pokemon that hits me, even with a ranged move"],
  params: [
    {
      id: "chance",
      ctorIndex: 0,
      path: "chance",
      control: "slider",
      min: 1,
      max: 99,
      step: 1,
      integer: true,
      label: "Chance (%)",
      editable: true,
      default: 30,
    },
    {
      id: "tag",
      ctorIndex: 1,
      path: "tag",
      control: "select",
      label: "Lingering effect laid on the attacker",
      editable: true,
      default: "Curse",
      options: Object.keys(LINGERING_EFFECT_WORDS),
      codec: lingeringEffectCodec,
      gateIndependent: true,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // Gate = [rng.chance pct] and nothing else; the binding repeats the chance, gateParams keeps it equal to the param.
    { slot: "gate", ctx: "params", lib: "rng.chance", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must be a real hit (not blocked) and the game must not be only previewing, and the attacker must not be me",
    "The attacker must be able to receive the effect (it is not already affected and nothing blocks it); this is asked after the chance roll",
  ],
  effect: { id: "effect.apply-tag", params: ["tag"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply gate: one draw of 0 to 99 on the holder (randBattleSeedInt(100)), only after the not-previewing, real-hit and not-myself checks, and before the can-be-cursed check",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [{ name: "a foe's contact and non-contact move hit the holder", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B with RNG in canApply (precedent: PostDefendContactApplyStatusEffectAbAttr). The 30% and the Curse were hard-coded; they are now constructor arguments 0 and 1 (defaults 30 and Curse) and params, and `chance` is repeated into the bound rng.chance atom through gateParams. Users (1): Ofuda (6070) attr 0. Draw order: one randBattleSeedInt(100) per eligible hit, none otherwise. The slider stops at 99 on purpose: the library atom rng.chance skips the draw at 100 and answers true without a draw when simulated, whereas the class always draws, so 100 would change the number of draws in a rebuilt gate (staff who want no roll remove the chance condition instead). Oddity, not fixed: the class does not call super.canApply, so the inherited attackCondition (default damaging moves only) is ignored; a status move reports HitResult.STATUS, which fails the real-hit guard, so only moves that hit with a damaging result roll.",
});
