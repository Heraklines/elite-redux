/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 2. Tier B. "Once per battle, the hit that takes me to half HP or less plants Leech Seed on every foe and lowers its Speed by 2 stages."
//
// Source: src/data/elite-redux/abilities/dandelion-burst.ts, class DandelionBurstAbAttr (extends PostDamageAbAttr; showAbility true).
// canApply is now `guards && gate && residual`, in the ORIGINAL clause order:
//   1. guard      pokemon.hp <= 0 -> false                                  (named guard not-fainted: isFainted() is exactly hp <= 0)
//   2. guard*     DANDELION_BURST_USED.get(pokemon) === waveIndex -> false  (once per battle; the ability's OWN WeakMap, see "legacy" below)
//   3. gate       hp <= max*ratio && hp + damage > max*ratio                (condition: the hit CROSSED the line; library hp.crossed-below, floor-half)
//   4. residual   pokemon.getOpponents().some(o => o?.isActive(true))       (feasibility: a living foe to act on)
// apply (unless simulated): remember the wave, then for EVERY active foe in order: addTag(SEEDED, Leech Seed, holder.id) and unshift a StatStageChangePhase
// for the stat/stages (default Speed, -2, "Cotton Spore"), which honours Clear Body, Mist, Contrary.
// Why gate = floor-half and not exact: for an integer hp, `hp <= T` equals `hp <= floor(T)` and `hp + d > T` equals `hp + d > floor(T)` (T = max * ratio),
// so the float test of the class is the floor-half form, and it has NO Shell Bell term (the exact form of Wimp Out has one).
// Dispatch: PostDamageAbAttr (WHEN event.after-taking-damage). The class tests the RAW damage of the hit; the shared frame rewrites it to the whole turn's damage
// for a multi-hit move (effectiveDamageAfterMultiHit), which could only differ on a LATER hit of a multi-hit move that already crossed, and the once-per
// guard stops exactly that. Constructor change (behaviour-neutral): ratio, stat and stages are constructor arguments with the old values as defaults.
// No random draw. State: the module WeakMap (holder -> wave index), also read by the AI snapshot (erDandelionBurstUsedWave).
import { DandelionBurstAbAttr } from "#data/elite-redux/abilities/dandelion-burst";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

export default defineDecl(DandelionBurstAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-taking-damage",
  label: "Seed every foe and change a stat once when my HP gets low",
  summary: params =>
    `Once per battle, the hit that takes me to ${Math.round(Number(params.hpRatio) * 100)}% HP or less plants Leech Seed on every foe and changes its ${params.stat} by ${params.stages} stages.`,
  synonyms: [
    "dandelion burst",
    "leech seed all foes",
    "cotton spore",
    "seed the foes",
    "slow the foes at low hp",
    "once per battle at half hp",
  ],
  examples: [
    "At half HP, once per battle, seed all foes and drop their Speed by 2",
    "Low-HP panic button that seeds the whole enemy side",
  ],
  params: [
    {
      id: "hpRatio",
      ctorIndex: 0,
      path: "hpRatio",
      control: "slider",
      min: 0.01,
      max: 0.99,
      step: 0.01,
      label: "HP line to fall to or below (0.5 = half of max HP)",
      editable: true,
      default: 0.5,
    },
    {
      id: "stat",
      ctorIndex: 1,
      path: "stat",
      control: "select",
      label: "Stat each foe loses",
      editable: true,
      default: "SPD",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
      gateIndependent: true,
    },
    {
      id: "stages",
      ctorIndex: 2,
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stat stages changed on each foe (-2 = two stages lower)",
      editable: true,
      default: -2,
      gateIndependent: true,
    },
  ],
  gateParams: [{ param: "hpRatio", block: "hp.crossed-below", field: "ratio" }],
  conditions: [{ slot: "gate", ctx: "params", lib: "hp.crossed-below", removable: true, editable: true }],
  guards: ["not-fainted"],
  feasibility: [
    "Only once per battle (the ability remembers this itself; it is not yet a swappable block, see the requests)",
    "At least one foe must still be standing",
    "Leech Seed does not stick to Grass types, and the stat change honours Clear Body, Mist and Contrary",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // Well above the line, just above it (the hit crosses), on it and just below it (no crossing).
      name: "HP around the half line",
      axes: { hp: ["max", "50%+1", "50%", "50%-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, PACKAGE for the effect only. 1 attr in 1 ability: Dandelion Burst (5907 attr 0). The trigger (after taking damage), the crossing condition (hp.crossed-below, floor-half, ratio param linked by gateParams) and the not-fainted guard are separate blocks; the effect does two things per foe in one loop (plant Leech Seed with the source move Leech Seed, and a stat-stage phase). Why the effect is a package: effect.apply-tag is not implemented in the library, so the seeding cannot be an existing block; the stat half could be effect.stat-stage on the opposing side but the two are interleaved per foe in one loop and splitting them WOULD change phase order for several foes: SeedTag.onAdd calls phaseManager.queueMessage (not deferred, so it unshifts a MessagePhase), hence per foe the queue gets [seeded message, stat phase] and a split would get [all seeded messages, all stat phases]. This is PROVEN by a phase-order trace in test/tests/elite-redux/decomp/B15/chunk2.test.ts (two foes; the interleaved order differs from the split order). Once effect.apply-tag exists (R-B15-8) and a rule can run two effects per foe in the same loop, the stat drop becomes effect.stat-stage; until then stat and stages stay typed params of this package (see requests R-B15-8). The Leech Seed tag and its source move are fixed (the pair SEEDED + Leech Seed); stat and stages are typed params. LEGACY part: the once-per-battle memory (clause 2) is the ability's own WeakMap keyed by holder with the wave index as value, which the AI snapshot also reads (erDandelionBurstUsedWave); library time.once-per (wave scope) uses waveData.entryEffectsFired, a different memory, and adding a key there would change the AI state, so clause 2 stays in guards() and is listed as feasibility until the librarian adds a scope that can share a caller-owned memory (R-B15-7). Suspected oddities, NOT fixed: (1) Cotton Spore is modelled as a Speed drop to EACH active foe (by design, documented in the source), (2) a foe's stat-stage phase is queued even when the Leech Seed tag was refused (Grass type), by design; (3) the once-per mark is written before any foe is acted on, so a holder whose foes all faint in the loop still uses it up.",
});
