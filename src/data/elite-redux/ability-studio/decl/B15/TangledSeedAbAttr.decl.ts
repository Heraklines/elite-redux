/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 5. Tier C, engine-query (a presence marker). "When I plant Leech Seed on a foe, the seeded foe cannot voluntarily switch out for a number of turns (forced switches still work)."
//
// Source: src/data/elite-redux/abilities/tangled-seed.ts, class TangledSeedAbAttr (extends AbAttr; constructor passes showAbility false; apply is empty, there is no canApply of its own).
// One constructor argument now: trapTurns (default 2, the old TANGLED_SEED_TRAP_TURNS literal). The effect lives in SeedTag.onAdd (src/data/battler-tags.ts), after the seeded message:
//   1. source = the Pokemon that planted the seed (getSourcePokemon); no source -> the tag returns before this point
//   2. the first of source.getAllActiveAbilityAttrs() whose constructor name is "TangledSeedAbAttr" (found by name; the marker is the presence test)   -> presence
//   3. foe.addTag(TRAPPED, tangledSeed.trapTurns, LEECH_SEED, source.id)                                                                              -> effect (the seam now reads trapTurns from the live attr)
// TRAPPED blocks the voluntary switch command (Pokemon.isTrapped) but not forced switches (Roar, Whirlwind, Dragon Tail). It is applied mid-turn, survives that turn's end and, with 2 turns,
// expires at the end of the following turn. Nothing is dispatched, so the L2 harness treats the declaration as presence-only (the whole battle is compared). No random draw, no state of its own.
import { TangledSeedAbAttr } from "#data/elite-redux/abilities/tangled-seed";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(TangledSeedAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Trap the foes I plant Leech Seed on",
  summary: params =>
    `While I have this, a foe that I plant Leech Seed on cannot switch out by choice for ${params.trapTurns} turns (forced switches such as Roar still work). Example: 2 = until the end of the following turn.`,
  synonyms: [
    "tangled seed",
    "leech seed traps",
    "seeded foe cannot switch",
    "trap the seeded foe",
    "no escape from leech seed",
    "block switching",
    "mean look with seeds",
  ],
  examples: [
    "A foe I seed cannot switch out for two turns, like Tangled Seed",
    "Leech Seed that also works like Mean Look",
  ],
  params: [
    {
      id: "trapTurns",
      ctorIndex: 0,
      path: "trapTurns",
      control: "number",
      min: 1,
      max: 8,
      step: 1,
      integer: true,
      label: "Number of turns the seeded foe cannot switch out (2 = until the end of the following turn)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "It only happens when Leech Seed really lands on the foe (a Grass type, or a foe that already has the seed, is not seeded and not trapped)",
    "Forced switches such as Roar, Whirlwind and Dragon Tail still work",
    "The Leech Seed has to come from me (the seed remembers who planted it)",
    "It is built into the Leech Seed battle effect and is not part of this block",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The marker is consulted by the Leech Seed tag when it is added, which is not a dispatched moment; the twin compares whole battles of the one user instead.",
  probes: [{ name: "plant Leech Seed on a foe", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query (presence marker read by SeedTag.onAdd by constructor name), counted apart from the decomposed classes; the foundation owns any abilityQuery routing. 1 attr in 1 ability: Tangled Seed (5903 attr 0; also an innate of the newcomer species in er-newcomer-forms.ts). The class has no condition of its own; the trigger ('when I plant Leech Seed on a foe') and the effect ('apply the Trapped battle effect to that foe for N turns') live in the tag and are requested as library blocks: R-B15-43 (the moment, with the seeded foe and me as the slots; the effect itself is the library effect.apply-tag with tag TRAPPED, which is not implemented yet, R-B15-8). The only number is typed (trapTurns, read by the seam from the seeder's live attr, default 2). The declaration uses WHEN while.active, which needs TangledSeedAbAttr in that WHEN's flagKeys; it was added to that list locally (same one-line change as R-B15-1), see R-B15-45. Suspected oddities, NOT fixed: (1) the Trapped effect is a separate battle effect with its own turn count, so it ends on its own timer even if the seed is removed earlier (cleared by Rapid Spin style moves) or lasts longer; the ability text only talks about the seed landing, so this matches it; (2) the seam asks the seeder's active attrs only at the moment the seed is added, so gaining or losing the ability later changes nothing for a seed that is already planted; (3) the attr is found with find(), so if a holder carried two copies only the first one's number would count.",
});
