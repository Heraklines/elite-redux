/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 4 / event-effect (Tier B).
//
// Read by hand from archetypes/post-defend-hp-gated-self-tag.ts. The class extends PostDefendAbAttr (WHEN "after I am hit"),
// constructor `(hpGate, tagType, turnCount = 0)`, `super(true)`. canApply in the ORIGINAL clause order, all of it the replaceable gate:
//   1. move.category === STATUS -> false                                    gate  (library move.damaging, same test)
//   2. t = toDmgValue(maxHp * hpGate); hp <= t && hp + damage > t           gate  (the hit CROSSED the line; see the notes)
//   3. pokemon.getTag(tagType) === undefined                                gate  (library tag.has, negated)
// no guards, no prepare, no residual, no random draw. apply: simulated -> nothing; else pokemon.addTag(tagType, turnCount, undefined,
// pokemon.id) (the holder is the source of its own tag).
//
// Clause classification: every clause is a rule staff would change (damaging hits only, the HP line, "not twice"), so the whole of
// canApply is the gate. The effect is the library's "apply a lasting effect" aimed at myself, plus the duration. The gate is bound
// legacy: clause 2 uses `toDmgValue`, which is `max(floor(x), 1)`, and the library's `floor-half` crossing is `floor(x)`; they differ
// only at a max HP of 1 (the library line would be 0). A bound atom that tests something else would be a lie (request R-B10-c4-01).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PostDefendHpGatedSelfTagAbAttr } from "#data/elite-redux/archetypes/post-defend-hp-gated-self-tag";
import { fractionAsPercentCodec } from "./b10-codecs";
import { SELF_TAGS } from "./c4-codecs";

export default defineDecl(PostDefendHpGatedSelfTagAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Get a lasting effect when a hit drops me low on HP",
  summary: params =>
    `The first damaging hit that takes me to ${params.hpGate}% HP or less puts "${params.tagType}" on me for ${Number(params.turnCount) > 0 ? `${params.turnCount} turns` : "as long as it lasts"}. It does not repeat while I still have it.`,
  synonyms: [
    "no turning back",
    "trap myself at low hp",
    "cannot switch out",
    "cannot flee",
    "no retreat",
    "self trap",
    "stuck below half hp",
  ],
  examples: [
    "The first time a hit drops me to half HP, I can no longer switch out or flee, like No Turning Back",
    "Below 25% HP I get Aqua Ring once",
  ],
  params: [
    {
      id: "hpGate",
      ctorIndex: 0,
      path: "hpGate",
      control: "number",
      min: 1,
      max: 99,
      step: 1,
      integer: true,
      label: "HP line (% of max HP, the hit must take me to this or below)",
      editable: true,
      default: 50,
      codec: fractionAsPercentCodec,
    },
    {
      id: "tagType",
      ctorIndex: 1,
      path: "tagType",
      control: "select",
      label: "Lasting effect I get (No retreat = cannot switch out or flee)",
      editable: true,
      gateIndependent: true,
      default: "NO_RETREAT",
      options: [...SELF_TAGS],
    },
    {
      id: "turnCount",
      ctorIndex: 2,
      path: "turnCount",
      control: "number",
      min: 0,
      max: 10,
      step: 1,
      integer: true,
      label: "Turns the effect lasts (0 = until it ends by itself)",
      editable: true,
      gateIndependent: true,
      default: 0,
    },
  ],
  // The HP line is the one setting the gate reads: "this hit crossed below the line" (the library crossing atom, ratio = percent / 100).
  gateParams: [{ param: "hpGate", block: "hp.crossed-below", field: "ratio", scale: 0.01 }],
  conditions: [
    // The gate: damaging move, the hit crossed the HP line, the effect is not already on me. Legacy until R-B10-c4-01 exists.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Nothing happens in a preview"],
  effect: { id: "effect.apply-tag", params: ["tagType", "turnCount"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "HP around the half line",
      axes: { hp: ["max", "50%+1", "50%", "50%-1"], foeMove: ["TACKLE", "GROWL"] },
    },
  ],
  l2StaticReason:
    "The only user's gate is a legacy-closure binding, so the rebuild cannot be built and the L2 twin has no rebuilt attr to compare. The B10 test (test/tests/elite-redux/decomp/B10/chunk4-gates.test.ts) drives canApply of the class and of a frozen copy of the original rule over HP, damage, move category and tag states, including a max HP of 1.",
  status: "decomposed",
  notes:
    "Tier B split by hand (no guards, gate = the whole old canApply, no residual). Only user (1 attr): No Turning Back attr 1 (0.5, NO_RETREAT, turnCount 0), next to PostDefendHpGatedStatStageChangeAbAttr attr 0, which uses the same crossing line and the same tag so the boost and the trap fire on one hit. The gate is bound legacy: the class threshold is toDmgValue(maxHp * hpGate) = max(floor(..), 1), the library floor-half threshold is floor(..); they differ at max HP 1 (Shedinja: line 1 vs 0), so a bound library atom would change behaviour there (request R-B10-c4-01, a third rounding on hp.crossed-below). The effect is the library's 'apply a lasting effect' (effect.apply-tag, planned and not compiled yet: request R-B10-c4-04) aimed at me, with the holder as the source of the tag. Oddity, not fixed: canApply has no fainted check, so for a hit that takes the holder to 0 HP with damage above the line it returns true (shown by the B10 test); whether the engine calls the after-hit hook for a fainted target was not checked here.",
});
