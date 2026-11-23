/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  DEFAULT_INJECTION_SCOPE,
  INJECTION_SCOPE_OPTIONS,
  injectionScopeCodec,
} from "#data/elite-redux/ability-studio/decl/B09/chunk5-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveFlagInjectionAbAttr } from "#data/elite-redux/archetypes/move-flag-injection";
import { MoveFlags } from "#enums/move-flags";
// B09 chunk 5. "Some of my moves also count as another kind of move" (Taekkyeon: attacks are dances; Musical Notes: status moves
// are sound moves; Backstreet Boy: kicks are dances; Festivities: sound moves are dances and dance moves are sound moves).
//
// Source: src/data/elite-redux/archetypes/move-flag-injection.ts, class MoveFlagInjectionAbAttr (extends AbAttr; the constructor
// passes showAbility = false). NOTHING is dispatched. `Move.doesFlagEffectApply` (src/data/moves/move.ts:1079 and :1106) walks the
// USER's active ability attrs and asks every attr that has a duck-typed `injects(flag, move)` method; the first yes makes the flag
// "apply". Only consumers that ask through doesFlagEffectApply (Dancer, Soundproof, Punk Rock, Liquid Voice, the substitute bypass of
// sound moves) see the injected property; a consumer that reads the printed property with move.hasFlag does not.
// The rule of `injects(flag, move)`:
//   1. `flag !== injectFlag` -> false                       only the one property this attr injects
//   2. then by scope: all-moves -> true; sound-moves -> move.hasFlag(SOUND_BASED); dance-moves -> move.hasFlag(DANCE_MOVE);
//      kicking-moves -> move.hasFlag(KICKING_MOVE); status-moves -> category is STATUS; anything else (all-attacks, the default)
//      -> category is not STATUS.
//   The scope tests read the PRINTED property of the move (hasFlag), never an injected one, so two injectors never chain.
// Constructor: (injectFlag, scope = "all-attacks"). No random draw, no state, nothing reads `simulated`.
//
// Tier C (spec 2.3): there is no gate to split. The whole rule is one flag lookup the engine does by itself, so the block is one
// "while I have this" piece with two settings. Extra IFs cannot be added (`if: false`): the engine never builds a frame for it.
// No binding is needed (no constructor closure).
export default defineDecl(MoveFlagInjectionAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "While I have this, some of my moves count as another kind",
  summary: params =>
    `${params.scope} also count as "${params.flag}" moves for anything that checks that property, such as Dancer or Soundproof. The moves themselves do not change.`,
  synonyms: [
    "taekkyeon",
    "all attacks are dances",
    "kicks are dances",
    "sound moves are dances",
    "status moves are sound",
    "counts as a dance move",
    "counts as a sound move",
    "extra move property",
    "move becomes dance",
    "move becomes sound",
    "festivities",
    "musical notes",
    "backstreet boy",
  ],
  examples: [
    "All my damaging moves count as dance moves, like Taekkyeon",
    "My kicking moves count as dance moves, like Backstreet Boy",
    "My status moves count as sound moves, like Musical Notes",
    "My sound moves count as dance moves, like Festivities",
  ],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      path: "injectFlag",
      control: "select",
      label: "Property my moves also count as (for example Dance move or Sound based)",
      editable: true,
      default: "DANCE_MOVE",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "move property"),
    },
    {
      id: "scope",
      ctorIndex: 1,
      path: "scope",
      control: "select",
      label: "Which of my moves get the extra property",
      editable: true,
      default: DEFAULT_INJECTION_SCOPE,
      options: INJECTION_SCOPE_OPTIONS,
      codec: injectionScopeCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only abilities and effects that ask the game whether a move counts as that property notice it; anything that reads the move's own printed property does not",
    "Which of my moves qualify is decided from the move's own printed properties and category, never from a property another ability added",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "my attack against a foe that uses a damaging move", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  l2StaticReason:
    "A property injection has no dispatch moment (no trace event): the engine asks it from Move.doesFlagEffectApply. The twin compares the whole battle, and B09/chunk5.test.ts proves the truth table of every user through the engine function itself.",
  status: "decomposed",
  notes:
    "Tier C, 5 attrs in 4 abilities, none needs a binding: Taekkyeon (5435 attr 0: Dance, all-attacks), Backstreet Boy (5675 attr 2: Dance, kicking-moves), Musical Notes (5612 attr 0: Sound, status-moves), Festivities (5543 attr 0: Dance on sound-moves, attr 1: Sound on dance-moves). The scope all-attacks and the class's default branch are the same rule (any non-status move). Open design issue, NOT fixed (request R-B09-38): Backstreet Boy's text says 'Kicking moves are Dance moves and vice-versa', but only kicking -> dance is an injection. The vice-versa half (dance moves count as kicking) is wired as a separate FlagDamageBoost on dance moves (x1.3, the Striker bonus, archetype-dispatcher.ts:2326), which reads the printed property, so any other consumer of the kicking property does not see dance moves as kicks. Behaviour is kept exactly as it is; a staff rule built from this block can add the missing half (kicking, my dance moves) without new code, and the owner decides whether the ability should. Second oddity, not fixed: only consumers that go through doesFlagEffectApply see an injection; consumers that call move.hasFlag ignore it (header of archetypes/move-flag-injection.ts).",
});
