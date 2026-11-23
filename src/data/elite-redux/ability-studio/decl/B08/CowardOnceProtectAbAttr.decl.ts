/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3 / event-effect, Tier B. Read from the source (archetypes/coward-once-protect.ts, PostSummonAbAttr, the
// battle-data reset in field/pokemon.ts resetBattleAndWaveData) and from the one user (Coward). canApply is now `gate`:
//
//   gate     1. battleData.cowardProtectUsed is true                      -> false   atom time.once-per (scope: battle)
//   apply    sets battleData.cowardProtectUsed = true, then adds the PROTECTED lasting effect to the holder for 1 turn.
//            Skipped when simulated. No random draw anywhere.
//
// The memory is a field of the holder's per-battle data, which is replaced by a fresh object at the start of every battle
// (`resetBattleAndWaveData`): "once per battle", re-armed by the next battle. The library atom `time.once-per` with scope
// "battle" keeps its memory in a WeakMap keyed by that same per-battle object, so both forget at the same moment. They are
// two separate memories, though: see the notes for the one case where they differ.
//
// The effect has no setting: the lasting effect (Protect), its 1 turn and the target (myself) are fixed in the class.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { CowardOnceProtectAbAttr } from "#data/elite-redux/archetypes/coward-once-protect";

export default defineDecl(CowardOnceProtectAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Protect myself when I enter, once per battle",
  summary: () =>
    "When I enter the battle I protect myself for one turn (attacks aimed at me fail), but only the first time in each battle.",
  synonyms: [
    "protect on entry",
    "coward",
    "shield on switch in",
    "first turn protect",
    "detect on entry",
    "once per battle protect",
  ],
  examples: ["Protect myself the first time I switch in, once per battle"],
  params: [],
  noParamsReason:
    "The class takes no settings: it always gives the holder Protect for 1 turn, once per battle. Request R-B08-17 asks for the library effect 'apply a lasting effect' to carry the effect, the turns and the target as settings.",
  conditions: [
    // The gate is the one-time memory (bindings.ts): time.once-per { scope: battle, key: coward-protect }.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The lasting effect Protect must be able to land on me (nothing blocks it)"],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "none",
    rngOrder: [],
    state: "battle",
    simulated: "respects",
  },
  probes: [{ name: "enter the battle (first entry, then a later entry)", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B: the whole canApply is the gate (the one-time memory), a pure move of the original clause. The effect is `effect.apply-tag` (PROTECTED, 1 turn, on the holder); that library effect is still planned, not wired (request R-B08-17), so the declaration names it with no settings and the class stays the single source of behaviour. Coward is the only user. The class memory (battleData.cowardProtectUsed) and the library memory (time.once-per, scope battle: a WeakMap keyed by the same battle-data object) are two separate stores that are reset at the same moment. They differ in one case: when a Pokemon is rebuilt from data (field/pokemon.ts, system/pokemon-data.ts and the co-op engine call `new PokemonBattleData(source)`), the constructor carries cowardProtectUsed over if the source has it, which the WeakMap never sees. Only a rule rebuilt from the library gate could notice (it would protect once more after such a rebuild); the shipped Coward uses the class's own gate and is unaffected. Request R-B08-26 asks for a battle-memory flavour of the once-per atom that reads a named flag of the battle data. Oddity, not fixed: the memory is per holder battle data, so a Coward that switches out and back in stays used up for the rest of the battle (as the class comment intends).",
});
