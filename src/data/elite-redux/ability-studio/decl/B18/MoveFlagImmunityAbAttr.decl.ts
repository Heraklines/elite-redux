/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 4. Ball Fetch. "While the game checks whether a move can hit me, IF the move has one of these properties, DO make me immune".
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over TypeImmunityAbAttr (ab-attrs.ts:458). Constructor `(flags)`; it calls
// `super(PokemonType.UNKNOWN)`, so the parent's type is a placeholder and its condition closure is null. Tier A, no class edit, nothing to
// bind. Dispatch: applyAbAttrs("TypeImmunityAbAttr", { pokemon: holder, opponent: attacker, move, typeMultiplier, cancelled, simulated }) in
// Pokemon.getMoveEffectiveness. Clauses, in the ORIGINAL order (the class overrides canApply, so the parent's rules do NOT apply):
//   canApply 1  !cancelled.value                                  -> feasibility: another immunity has not already blocked the move
//   canApply 2  this.flags.some(flag => move.hasFlag(flag))       -> the property list (the `flags` setting; the raw flag, not doesFlagEffectApply)
//   apply       typeMultiplier = 0, cancelled = true              -> EFFECT (immunity). No random draw, no state.
// SECOND READER: Pokemon.getMoveEffectiveness (pokemon.ts:4257) also finds this class BY NAME on the holder and calls `blocks(move)`
// (the same property test) after the dispatch, so the block does not depend on the trigger alone. Both read the same `flags` field.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { MoveFlagImmunityAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";
import { MOVE_PROPERTY_OPTIONS, movePropertyListCodec } from "./b18-chunk4-codecs";

export default defineDecl(MoveFlagImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Be immune to moves with certain properties",
  summary: params =>
    `Moves with any of these properties do nothing to me: ${params.flags}. Example: ball and bomb moves and throwing moves, like Ball Fetch.`,
  synonyms: [
    "ball fetch",
    "bulletproof",
    "immune to ball moves",
    "immune to throwing moves",
    "block moves by property",
    "immune to sound moves",
    "no damage from certain moves",
  ],
  examples: [
    "Ball and bomb moves and throwing moves do nothing to me, like Ball Fetch",
    "Sound moves do nothing to me",
  ],
  params: [
    {
      id: "flags",
      ctorIndex: 0,
      path: "flags",
      control: "text",
      label: "Move properties I block (comma separated, any one is enough)",
      editable: true,
      default: "Ball and bomb moves, Throwing moves",
      options: MOVE_PROPERTY_OPTIONS,
      codec: movePropertyListCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Nothing is blocked when another immunity has already blocked the move",
    "The game also checks these properties on its own while it works out move matchups, so the block does not depend on the trigger alone",
    "A move only counts if it really carries the property (properties that other abilities hand to moves are not counted)",
  ],
  effect: { id: "effect.negate", params: ["flags"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a ball move, a throwing move, a plain move and a sound move",
      axes: { foeMove: ["SHADOW_BALL", "ROCK_THROW", "TACKLE", "SCREECH"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, 1 attr, nothing to bind: Ball Fetch (237, attr 0, flags Ball and bomb + Throwing, in that order). The property test is the editable `flags` setting of the block, NOT a gate: the engine ALSO reads this very field through `blocks(move)` (pokemon.ts:4257, found by class name), and a replaceable gate would leave that second path untouched, so a staff-edited gate and the engine would disagree. Keeping the list as one setting keeps both readers in step. REMAINING GAP (request R-B18-31): the property test cannot be an IF block today because calc.move-immunity does not provide the `moveUser` slot (the atom move.flag needs it) and move.flag calls doesFlagEffectApply while this class calls the raw move.hasFlag. A staff recipe 'immune to X moves' with a property is therefore built from this block. ODDITIES, not fixed: (1) the class overrides canApply and drops the parent's rules, so a move that targets both sides or my own side, and my own move against me, are blocked too if they carry the property; (2) it uses the raw flag, so a property that another ability injects into a move (Dance, Sound) does not count; (3) the placeholder type UNKNOWN of the parent makes getImmuneType() return UNKNOWN, which other readers of TypeImmunityAbAttr may see; (4) the ability banner is shown (showAbility true). Ball Fetch also has a CopyMoveByFilterAbAttr and a BallRecoveryAbAttr (chunk 1) as separate attrs.",
});
