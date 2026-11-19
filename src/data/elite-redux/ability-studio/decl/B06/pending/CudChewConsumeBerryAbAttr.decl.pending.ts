/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06, Tier B event-effect. PARKED: the finished declaration waits here because its WHEN does not exist yet. The registry only
// collects `*.decl.ts`, so this file is not loaded; rename it to `CudChewConsumeBerryAbAttr.decl.ts` once the librarian has
// added the WHEN `event.berry-phase-end` (requests/B06.md, R-B06-9) and moved the dispatch key out of UNEXPOSED_DISPATCH_KEYS.
// Status of the class meanwhile: legacy-closure-pending-request (the missing WHEN, and the missing IF atom for the gate).
//
// "When the berry phase of a turn ends, if I ate a berry the turn before, eat those berries again" (Cud Chew). The class does not
// extend PostTurnAbAttr: BerryPhase calls `applyAbAttrs("CudChewConsumeBerryAbAttr", { pokemon })` itself for every Pokemon
// (berry-phase.ts:23), right after the normal berry eating, and that is the only dispatch. Clauses in the ORIGINAL order:
//   1. gate        `pokemon.summonData.berriesEatenLast.length > 0` (ab-attrs.ts, CudChewConsumeBerryAbAttr.gate): "I ate a
//                  berry last turn". There is no library atom for it (R-B06-9); the binding would be a legacy-closure.
//   effect-side    `apply`: queues the use-item animation, then for every remembered berry runs the berry's own effect
//                  (`getBerryEffectFunc(berry)(pokemon)`) and fires a BerryUsedEvent for the message. No item is consumed and it
//                  does not count as eating (so Unnerve, Stuff Cheeks and Unburden do not see it). `simulated` is ignored (a TODO
//                  in the class).
// Binding to add together with the rename (bindings.ts), in plain words:
//   bindLegacyClosure(291, 0, "no atom for 'I ate a berry last turn' (summonData.berriesEatenLast.length > 0), R-B06-9", "gate");
import { CudChewConsumeBerryAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CudChewConsumeBerryAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.berry-phase-end",
  label: "Eat last turn's berries again",
  summary: () =>
    "When the berries of a turn have been eaten, I eat again every berry I ate the turn before, for free. Example: Cud Chew.",
  synonyms: ["cud chew", "eat berry twice", "replay berry", "second berry meal", "berry encore", "chew again"],
  examples: ["Eat the same berry again one turn later without using it up, like Cud Chew"],
  params: [],
  noParamsReason:
    "The class has no constructor argument and no number, type or status: it replays whatever berries the memory block remembered.",
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: ["Needs the block that remembers the berries I ate (its pair), otherwise the memory stays empty"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [{ name: "berry phase after eating nothing", axes: {} }],
  l2StaticReason:
    "No battle scenario template reaches the berry-phase moment (it is not in the WHEN registry yet), so the class is checked by test/tests/elite-redux/decomp/B06/b06-classes.test.ts, which drives canApply and apply directly.",
  status: "decomposed",
  notes:
    "PACKAGE for the effect only: replaying 'whatever berries I remembered' needs the per-berry effect table (getBerryEffectFunc) and a free animation; effect.use-item eats the HELD item and consumes it, which is not what happens here (request R-B06-6 asks for effect.eat-remembered-berries). The trigger and the gate are separate blocks. Only user: Cud Chew (291, attr 0; attr 1 is CudChewRecordBerryAbAttr). The class comment says it must only be used by Cud Chew. The code has a commented-out line to let Cheek Pouch heal on the replay (HealFromBerryUseAbAttr); it is not active, so Cheek Pouch does not trigger on a Cud Chew replay (design note, not changed).",
});
