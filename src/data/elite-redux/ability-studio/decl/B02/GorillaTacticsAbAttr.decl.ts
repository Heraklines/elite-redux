/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 4. "When my move starts, lock me into the first move I use, and raise my Attack" (Gorilla Tactics).
//
// Source: src/data/abilities/ab-attrs.ts GorillaTacticsAbAttr, an ExecutedMoveAbAttr. Dispatched from
// MoveEffectPhase.postAnimCallback (src/phases/move-effect-phase.ts:455) right after the move is pushed to the move history,
// only for the first hit of a move that is not a delayed attack (`applyAbAttrs("ExecutedMoveAbAttr", { pokemon: user })`).
// canApply: `!pokemon.getTag(BattlerTagType.GORILLA_TACTICS)`. One clause: it is the stacking rule ("already locked"),
// not a design choice players know, so it stays in the class as feasibility. It is also the class's only clause, so there is
// nothing to split (Tier C, atomic).
// apply: `if (!simulated) pokemon.addTag(GORILLA_TACTICS)`. The tag does the real work, in src/data/battler-tags.ts
// GorillaTacticsTag: `canAdd` needs a last non-virtual move that is not Struggle (feasibility), `onAdd` remembers that move
// as the only usable one and does `pokemon.setStat(ATK, getStat(ATK) * 1.5)` (the Attack boost is the tag's, not the attr's),
// and the tag restricts every other move for the rest of the time the Pokemon stays in.
import { GorillaTacticsAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(GorillaTacticsAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.my-move-starts",
  label: "Lock me into my first move and boost my Attack",
  summary: () =>
    "After the first move I use, I can only use that move while I stay in, and my Attack is multiplied by 1.5. Example: the Choice Band effect without the item.",
  synonyms: [
    "gorilla tactics",
    "choice band",
    "locked into a move",
    "move lock",
    "choice lock",
    "only use one move",
    "attack boost but locked",
  ],
  examples: ["Be locked into the first move I use but hit 50% harder, like Gorilla Tactics"],
  params: [],
  noParamsReason:
    "The class takes only the ability-flash flag (never exposed, always false). The locking battle effect and its 1.5 Attack factor are fixed by the class and its battle effect, not by constructor arguments.",
  fixedCtorArgs: { 0: false },
  conditions: [],
  guards: [],
  feasibility: [
    "I am not already locked into a move",
    "I have already used a real move (not Struggle) that I can be locked into",
  ],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "first move and second move", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier C. One user: Gorilla Tactics (255, attr 0; it also has an AI move-generation attr that is a different class). The effect is the library's 'apply a battle effect' block aimed at myself with the fixed battle effect GORILLA_TACTICS; the class has no constructor argument for it, so it is described here and not a setting. The lock and the x1.5 Attack are done by the battle effect (battler-tags.ts:601), they cannot be split from it without editing the tag. `simulated` is read only by `apply` (no tag when simulated); `canApply` ignores it (TODO in the source). The sibling class SagePowerMoveLockAbAttr differs only in the tag and in the missing Attack boost.",
});
