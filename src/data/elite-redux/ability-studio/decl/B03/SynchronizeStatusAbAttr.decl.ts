/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03. Tier B, no random draws, no residual.
//
//   canApply (now guards && gate):
//     guards  a Pokemon set the status (`sourcePokemon` exists), so there is somebody to pass it back to
//     gate    the status that was just set is Burn, Paralysis, Poison or Bad poison
//   apply     the source tries to get the same status, caused by the holder (skipped when simulated)
//
// The gate has no library form yet: the existing `status.has` atom reads the holder's CURRENT status, while the class
// reads the status that the dispatch carries (`effect`). They agree at dispatch time, but a lookalike is not the same
// predicate, so the gate is a legacy closure until the atom `status.just-set` exists (requests/B03.md).
import { SynchronizeStatusAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SynchronizeStatusAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.got-status",
  label: "Pass a burn, paralysis or poison back to whoever caused it",
  summary: () =>
    "When another Pokemon burns, paralyzes or poisons me, it gets the same status. Example: a foe's Will-O-Wisp burns me, and the foe is burned too.",
  synonyms: [
    "synchronize",
    "share status",
    "reflect status",
    "give the status back",
    "status mirror",
    "copycat status",
  ],
  examples: ["When a foe burns or poisons me, it gets the same status"],
  params: [],
  noParamsReason:
    "The list of passed-back statuses (burn, paralysis, poison, bad poison) is fixed inside the class and there are no numbers to tune.",
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "A Pokemon must have caused the status (weather and hazards do not count)",
    "It does not check that the other Pokemon can really receive the status: the ability still shows",
  ],
  effect: { id: "effect.inflict-status", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "foe paralyzes and burns me", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B, one user (Synchronize, attr 1 of ability 28). Gate bound as legacy-closure pending the atom `status.just-set` (the status carried by the dispatch). The effect is 'give the SAME status that I got to whoever caused it', not the library effect.inflict-status with a fixed status, so effect.mirror-status is requested. Bad poison is the same synchronizable group as Poison in the class. The L1 attr differential has no parameter builder for event.got-status, so the refactor is proven by test/tests/elite-redux/decomp/B03/gate-refactor.test.ts instead.",
});
