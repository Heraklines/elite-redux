/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 1. Tier C, package. "At the end of every turn, hurt every sleeping foe by a share of its max HP."
//
// Source: src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts, ErBadDreamsAbAttr (extends PostTurnHurtIfSleepingAbAttr, which
// extends PostTurnAbAttr; dispatched as PostTurnAbAttr). It replaces the vanilla attr of Bad Dreams through `patchBadDreams`.
//   canApply  INHERITED from PostTurnHurtIfSleepingAbAttr (ab-attrs.ts): some foe `getOpponentsGenerator()` is asleep
//             (status SLEEP, or comatose-like), is NOT protected from indirect damage (BlockNonDirectDamageAbAttr),
//             does NOT carry BadDreamsImmunityAbAttr and is not switching out. It is ONE joint test on a single foe, so it cannot be
//             split into separate holder-level conditions (any-asleep AND any-unprotected is not the same as one foe that is both).
//             It is the effect's own "there is someone to hurt" check: feasibility.
//   apply     (overridden) simulated: nothing. For every foe: asleep or comatose, not switching out, not protected from
//             indirect damage -> damage = max(1, floor(maxHp * percent / 100)), dealt as INDIRECT damage. The original code
//             was `floor(maxHp / 4)`; `percent` (default 25) is the same number for every whole max HP (m * 25 / 100 is exactly m / 4).
// No random draw, no private state, no message (the vanilla class queues a message, the ER override does not).
import { ErBadDreamsAbAttr } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ErBadDreamsAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.end-of-turn",
  label: "Hurt every sleeping foe a little at the end of each turn",
  summary: params =>
    `At the end of every turn, each sleeping foe on the field loses ${params.percent}% of its max HP (at least 1 HP). 25 means a quarter.`,
  synonyms: [
    "bad dreams",
    "nightmare",
    "hurt sleeping foes",
    "damage while asleep",
    "sleep punisher",
    "punish sleepers",
    "sleep damage",
  ],
  examples: ["Foes that are asleep lose a quarter of their max HP every turn, like Bad Dreams"],
  params: [
    {
      id: "percent",
      ctorIndex: 0,
      path: "damagePercent",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Share of the foe's max HP lost each turn (%)",
      editable: true,
      default: 25,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must be asleep (or comatose), still on the field, not about to switch out, not protected from indirect damage and not immune to Bad Dreams",
    "Each foe that is awake, about to switch out or protected from indirect damage is skipped, and nothing changes while the game only previews the turn",
  ],
  effect: { id: "effect.package", params: ["percent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "end of turn against a foe that is awake", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified: the effect hurts every foe that passes a per-foe filter (asleep or comatose, not switching out, not protected from indirect damage). The effect library has no damage effect and no 'for each foe that ...' target filter, so the effect cannot be built from existing blocks (requested as effect.hurt-percent-of-max-hp with a 'only foes that are asleep' filter, R-B16-1 in requests/B16.md). The trigger (end of turn) is a separate block, the class has no IF of its own (every clause of the inherited canApply is feasibility, see the header), and the one number is a typed param. Constructor change (behaviour-neutral): damagePercent, default 25, replaces the literal /4. Users: Bad Dreams (123, attr 0) only; nothing to bind. SUSPECTED BUG, NOT FIXED: the inherited canApply refuses foes with BadDreamsImmunityAbAttr (Honk Shoo has it), but the ER apply override never tests it, so with TWO foes where one is immune and one is asleep, the immune foe is hurt as well (the vanilla apply tests it). Also the vanilla apply checks BlockNonDirectDamageAbAttr on the HOLDER by mistake (applyAbAttrs with pokemon); the ER override tests it on the foe (correct). The L2 twin cannot put a foe to sleep (the harness axis `status` sets the holder), so the sleeping-foe path is proven in test/tests/elite-redux/decomp/B16/chunk1.test.ts.",
});
