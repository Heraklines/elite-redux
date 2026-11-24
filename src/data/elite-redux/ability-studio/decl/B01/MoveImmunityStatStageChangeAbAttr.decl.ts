/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 3, Tier A calc-modifier with TWO consequences (a block, then a stat change), shown as two branches.
//
// "While the game checks whether a move can hit me, IF <rule about the move and its user>, the move has no effect and
// a stat of mine changes." The class extends MoveImmunityAbAttr (declared in chunk 2) and adds the stat change.
//   canApply: `!params.simulated && super.canApply(params)`, and super is `!cancelled.value && immuneCondition(pokemon, attacker, move)`
//             = feasibility (not a preview, not already blocked) then the CONDITION slot (ctor:0)
//   apply:    1. `super.apply`: `cancelled.value = true`                                  = effect "block it"
//             2. unshift a StatStageChangePhase on the holder (selfTarget true)           = effect "change a stat"
//             The stat is resolved HERE, at apply time, when the constructor got a function (Wind Rider).
//
// The only user, Wind Rider (id 274), passes `erHigherAttackStat` as its stat: "whichever of Attack and Sp. Atk is
// higher (unmodified stats, no stage scaling)". That function is a local constant of init-abilities.ts, so the
// declaration offers it as the choice "Higher attack" through a codec: the codec builds the same comparison for a rebuilt
// instance (`getStat(SPATK, false) > getStat(ATK, false) ? SPATK : ATK`) and reads any function back as that choice
// (the only function the game ever passes).
import { MoveImmunityStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";

const HIGHER_ATTACK = "HIGHER_ATTACK";

/** Same comparison as `erHigherAttackStat` in init-abilities.ts (Wind Rider): the higher attacking stat, unstaged. */
const higherAttackStat = (pokemon: Pokemon): Stat.ATK | Stat.SPATK =>
  pokemon.getStat(Stat.SPATK, false) > pokemon.getStat(Stat.ATK, false) ? Stat.SPATK : Stat.ATK;

const plainStat = enumCodec(Stat, "stat");
const statOrHigherAttack: ParamCodec = {
  toCtor: value => (value === HIGHER_ATTACK ? higherAttackStat : plainStat.toCtor(value)),
  fromInstance: raw => (typeof raw === "function" ? HIGHER_ATTACK : plainStat.fromInstance(raw)),
};

/** The summary prints the player-facing choice ("Higher attack"), spelled out. */
const statWords = (stat: unknown): string => (stat === "Higher attack" ? "higher of Attack and Sp. Atk" : String(stat));

export default defineDecl(MoveImmunityStatStageChangeAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-immunity",
  label: "Block a kind of move and change a stat instead",
  summary: params =>
    `A move that meets the rule you set has no effect, and my ${statWords(params.stat)} changes by ${params.stages} stages instead. Example: wind moves raise Attack by 1, like Wind Rider.`,
  synonyms: [
    "wind rider",
    "block and boost",
    "immune and raise a stat",
    "absorb a move group",
    "stat boost from being blocked",
    "boost from wind moves",
    "immune to wind moves",
  ],
  examples: ["Immune to wind moves and raise my higher attacking stat by one stage when hit by one, like Wind Rider"],
  params: [
    {
      id: "stat",
      ctorIndex: 1,
      path: "stat",
      control: "select",
      label: "Which stat changes (Higher attack picks Attack or Sp. Atk, whichever is greater)",
      editable: true,
      default: HIGHER_ATTACK,
      options: [HIGHER_ATTACK, ...STAT_OPTIONS],
      codec: statOrHigherAttack,
    },
    {
      id: "stages",
      ctorIndex: 2,
      path: "stages",
      control: "number",
      label: "Number of stages (-6 to 6, negative lowers, 0 changes nothing)",
      editable: true,
      default: 1,
      min: -6,
      max: 6,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // Required closure `(pokemon, attacker, move) => boolean`, the `defend` shape of the library. It is a field of the
    // parent class (MoveImmunityAbAttr.immuneCondition).
    { slot: "ctor:0", ctx: "defend", path: "immuneCondition", removable: false, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing when another ability already blocked the move",
    "The stat only changes when the move is really used (not when the game only previews it)",
    "A stat that is already at its limit does not move further",
  ],
  branches: [
    {
      label: "Block the move",
      conditions: [],
      effect: { id: "effect.negate", params: [] },
    },
    {
      label: "Change my stat",
      conditions: [],
      effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a wind move, a status wind move and a plain move",
      axes: { foeMove: ["AIR_CUTTER", "TAILWIND", "TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (1 attr): Wind Rider (274 attr 0, stat 'Higher attack', +1). Its closure is `pokemon !== attacker && move.hasFlag(WIND_MOVE) && move.category !== STATUS`; it stays a legacy-closure because the library flag atom asks doesFlagEffectApply (flags an ability injects count) where the original reads the plain flag (request R-B01-10 move.has-built-in-flag; the rest maps: not side.is self, move.damaging). The condition is declared not removable: without it the class would block every move. Oddity (not fixed): `canApply` returns false for a simulated call, so the damage preview of a wind move does NOT show the immunity, unlike every other MoveImmunity user; the stat change does not need that guard, only the unshifted phase does (the class has a TODO about it). The `cancelled` flag is set by `super.apply` whenever the attr applies. Library note: effect.stat-stage (target = me) describes the phase; the phase itself applies Simple/Contrary/Mist rules.",
});
