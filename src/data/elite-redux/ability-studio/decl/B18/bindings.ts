/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B18 (spec 2.1): the library form of every Tier B gate of the three gated classes, keyed by
// (abilityId, attrIndex). The five marker classes (BiomeRevealBonusAbAttr, ExperienceGainMultiplierAbAttr,
// MoneyGainMultiplierAbAttr, BallRecoveryAbAttr, MoveHpCostModifierAbAttr) have no condition slot, so they need no binding.
//
// "attr N" is the position in `ability.attrs`. Every line was read by hand from the class source and the live attr, then
// mapped to the atom that calls the SAME engine predicate, in the ORIGINAL clause order (that order is the order of the
// random draw and of the short-circuits). The L1 differential evaluates the class's own `gate` against the library form
// over the state grid and fails on any difference.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// =============================================================================================
// ProvenanceBypassSpeedChanceAbAttr (Tier B). Slot "gate": the chance roll, `randBattleSeedInt(100) < chance`.
// The class guard (`!simulated`) runs before it and the residual (damaging move chosen, canAddTag) after it, both inside the class.
// =============================================================================================
bindCondition(259, 0, { id: "rng.chance", pct: 30 }, "gate"); // Quick Draw
bindCondition(5996, 0, { id: "rng.chance", pct: 30 }, "gate"); // Minigun

// =============================================================================================
// FirstTurnDirectDamageMultiplierAbAttr (Tier B). Slot "gate":
//   holder.tempSummonData.waveTurnCount === 1  &&  move.category !== STATUS
// =============================================================================================
const firstTurnDamagingMove = { all: [{ id: "time.first-turn" }, { id: "move.damaging" }] };
bindCondition(5278, 0, firstTurnDamagingMove, "gate"); // Readied Action
bindCondition(5320, 0, firstTurnDamagingMove, "gate"); // Demolitionist

// =============================================================================================
// PostDefendSuppressFirstInnateAbAttr (Tier B). Slot "gate", in the original order:
//   move.doesFlagEffectApply(MAKES_CONTACT, attacker -> holder)  &&  !hasMummyFamilyAbility(attacker)
// where the family is Mummy, Lingering Aroma, Wandering Spirit (`MUMMY_FAMILY.some(hasAbility)`). The residual (the attacker has
// an active first innate) stays in the class.
// =============================================================================================
const contactFromANonMummy = {
  all: [
    { id: "move.flag", flag: "MAKES_CONTACT" },
    {
      not: {
        any: [
          { id: "mon.has-ability", who: "other", ability: "MUMMY" },
          { id: "mon.has-ability", who: "other", ability: "LINGERING_AROMA" },
          { id: "mon.has-ability", who: "other", ability: "WANDERING_SPIRIT" },
        ],
      },
    },
  ],
};
bindCondition(152, 0, contactFromANonMummy, "gate"); // Mummy
bindCondition(268, 0, contactFromANonMummy, "gate"); // Lingering Aroma
bindCondition(6084, 0, contactFromANonMummy, "gate"); // Lingering Musk

// =============================================================================================
// CHUNK 2. Tier B gates of IgnoreOptionalMoveEffectsAbAttr, UserFieldIgnoreOptionalMoveEffectsAbAttr, FirstEntryPartyHealAbAttr and
// BreakScreensOnAttackAbAttr. The other four classes of the chunk (HolderAndAlliesRecoveryAbAttr, FieldPoisonWeaknessOnEntryAbAttr,
// TelekineticStruggleOnEntryAbAttr, PreLeaveFieldRemoveLinkedTailwindAbAttr) have no condition slot and need no binding.
// =============================================================================================

// Aroma Veil (165). Both halves share one gate in the class: `0 < chance.value < 100` (isOptionalEffectChance,
// optional-secondary-effect.ts:13). The effect chance is a number the frame does not carry yet, so no atom can read it.
const optionalEffectChanceReason =
  "Aroma Veil: the gate is `0 < chance.value < 100` on the move's effect chance (a NumberHolder of the calc), and the frame has no effect-chance slot, so no atom can read it (request R-B18-11: slot effectChance and atom move.effect-chance-between)";
bindLegacyClosure(165, 1, optionalEffectChanceReason, "gate"); // IgnoreOptionalMoveEffectsAbAttr, the holder
bindLegacyClosure(165, 2, optionalEffectChanceReason, "gate"); // UserFieldIgnoreOptionalMoveEffectsAbAttr, the side

// FirstEntryPartyHealAbAttr (Tier B). Slot "gate": `!pokemon.waveData.entryEffectsFired.has(key)`, where the class prefixes the
// constructor key with "ability-upgrade:first-entry-party-heal:". time.once-per with scope wave reads that very Set under the same key.
bindCondition(
  257,
  1,
  { id: "time.once-per", scope: "wave", key: "ability-upgrade:first-entry-party-heal:pastel-veil" },
  "gate",
); // Pastel Veil
bindCondition(
  175,
  3,
  { id: "time.once-per", scope: "wave", key: "ability-upgrade:first-entry-party-heal:sweet-veil" },
  "gate",
); // Sweet Veil (P)

// BreakScreensOnAttackAbAttr (Tier B). Slot "gate", in the class's own order: the move is not a status move (the inherited
// default attack condition), the move makes contact (`doesFlagEffectApply(MAKES_CONTACT, user: holder, target: opponent)`, only
// when contactRequired), the move carries the option's flag (`hasFlag`, only when a flag is set). The "opponent standing" clause
// is the class's own guard and is not in the gate.
bindCondition(5059, 2, { all: [{ id: "move.damaging" }, { id: "move.flag", flag: "MAKES_CONTACT" }] }, "gate"); // Juggernaut: contactRequired
bindCondition(5112, 2, { all: [{ id: "move.damaging" }, { id: "move.flag", flag: "PUNCHING_MOVE" }] }, "gate"); // Precise Fist: flag PUNCHING_MOVE

// =============================================================================================
// CHUNK 3. Tier B gates of AttackerTypeDamageReductionAbAttr, FullHpMoveTypeDamageReductionAbAttr, ReverseNegativeStatChangesAbAttr,
// PostDefendAddTagAbAttr, SameTypeStabOtherwiseBoostAbAttr, HigherStatMultiplierAbAttr and AllyHigherStatMultiplierAbAttr.
// FaintedAllyStatMultiplierAbAttr has no condition slot (its parent gets no closure) and needs no binding.
// Every gate is read by hand from the class source (requested-combat-riders.ts) in the class's own clause order.
// =============================================================================================

// AttackerTypeDamageReductionAbAttr (Tier B). Slot "gate" = the constructor closure the class used to pass to its parent:
//   move.category !== STATUS  &&  attacker.isOfType(attackerType)
// The attacker is the frame's `other` while the holder defends. The type is repeated in mon.has-type (gateParams keeps it in step).
const damagingMoveFromAWaterAttacker = {
  all: [{ id: "move.damaging" }, { id: "mon.has-type", who: "other", type: "WATER" }],
};
const damagingMoveFromAGrassAttacker = {
  all: [{ id: "move.damaging" }, { id: "mon.has-type", who: "other", type: "GRASS" }],
};
bindCondition(5127, 2, damagingMoveFromAWaterAttacker, "gate"); // Marine Apex, Water attackers
bindCondition(5729, 2, damagingMoveFromAGrassAttacker, "gate"); // King of the Jungle, Grass attackers

// FullHpMoveTypeDamageReductionAbAttr (Tier B). Slot "gate" = the constructor closure:
//   target.isFullHp()  &&  move.category !== STATUS  &&  attacker.getMoveType(move) === moveType
bindCondition(
  5690,
  2,
  {
    all: [
      { id: "hp.full", who: "holder" },
      { id: "move.damaging" },
      { id: "move.type", type: "DRAGON", effective: true },
    ],
  },
  "gate",
); // Drakelp Head, Dragon moves at full HP

// ReverseNegativeStatChangesAbAttr (Tier B). Slot "gate" = `stages < 0` (the stat is being lowered). The guard (`!cancelled.value`)
// and the residual (`source !== null`, no atom yet: request R-B18-25) stay in the class.
bindCondition(5234, 1, { id: "stage.just-changed", direction: "lowered" }, "gate"); // Change of Heart

// PostDefendAddTagAbAttr (Tier B). Slot "gate", in the class's own order:
//   pokemon !== opponent  &&  move.category !== STATUS  &&  opponent.getMoveType(move) === moveType
// The residual (`!pokemon.getTag(tag)`) stays in the class. `side.is self` is `other === holder`, so its negation is `pokemon !== opponent`.
bindCondition(
  5548,
  1,
  {
    all: [
      { not: { id: "side.is", kind: "self" } },
      { id: "move.damaging" },
      { id: "move.type", type: "ELECTRIC", effective: true },
    ],
  },
  "gate",
); // Lightning Born, Electric moves

// SameTypeStabOtherwiseBoostAbAttr (Tier B). Slot "gate" = the inherited rule, then the test that used to be inside `apply`:
//   holder.getMoveType(move) === type  &&  !holder.isOfType(type)
bindCondition(
  5041,
  0,
  {
    all: [
      { id: "move.type", type: "ROCK", effective: true },
      { not: { id: "mon.has-type", who: "holder", type: "ROCK" } },
    ],
  },
  "gate",
); // Fossilized, Rock moves
bindCondition(
  5075,
  0,
  {
    all: [
      { id: "move.type", type: "GRASS", effective: true },
      { not: { id: "mon.has-type", who: "holder", type: "GRASS" } },
    ],
  },
  "gate",
); // Raw Wood, Grass moves

// HigherStatMultiplierAbAttr and AllyHigherStatMultiplierAbAttr (Tier B). Slot "gate" = "this stat is the highest of the listed stats",
// the loop `highest = candidates[0]; for each other candidate: if getStat(c, false) > getStat(highest, false) then highest = c;
// stat === highest` (the holder's stats for the first class, the receiving ally's stats for the second). No library atom compares
// the stats of a Pokemon with each other, so these four stay legacy-closure (request R-B18-23). The class's own guard (which stats
// the boost may touch) is not part of the gate.
const highestStatReason =
  "Flower Gift: the gate is 'the stat being worked out is the highest of the listed stats' (a loop over getStat(candidate, false), strict greater-than, ties to the first listed); no library atom compares a Pokemon's own stats with each other (request R-B18-23)";
bindLegacyClosure(122, 3, highestStatReason, "gate"); // HigherStatMultiplierAbAttr, Attack and Sp. Atk of the holder
bindLegacyClosure(122, 4, highestStatReason, "gate"); // HigherStatMultiplierAbAttr, Defense and Sp. Def of the holder
bindLegacyClosure(
  122,
  5,
  `${highestStatReason}; for the ally class the compared stats belong to the receiving ally and the frame has no slot for it`,
  "gate",
); // AllyHigherStatMultiplierAbAttr, Attack and Sp. Atk of the ally
bindLegacyClosure(
  122,
  6,
  `${highestStatReason}; for the ally class the compared stats belong to the receiving ally and the frame has no slot for it`,
  "gate",
); // AllyHigherStatMultiplierAbAttr, Defense and Sp. Def of the ally

// =============================================================================================
// CHUNK 4. Tier B gates of OnceLowHpStatRaiseAbAttr, OnDirectFaintRetaliationAbAttr, ChancePostAttackStealHeldItemAbAttr and
// PostSummonSnowCloakAuroraVeilAbAttr. The other four classes of the chunk need no binding: TypeImmunityHigherDefenseStatRaiseAbAttr and
// MoveFlagImmunityAbAttr (Tier A, no closure slot: the parent's condition is always null and the property list is a setting),
// PreLeaveFieldRemoveSnowCloakAuroraVeilAbAttr (Tier C, no condition slot) and AbilityStudioRuntimeCapabilityAbAttr (a flag, never dispatched).
// Every gate is read by hand from the class source in the class's own clause order.
// =============================================================================================

// OnceLowHpStatRaiseAbAttr (Tier B). Slot "gate", in the class's own order:
//   !pokemon.waveData.entryEffectsFired.has(key)  &&  move.category !== STATUS  &&  pokemon.isOpponent(opponent)
// The HP line (`max(1, floor(maxHp * threshold))` crossed by this hit) is the class's residual (request R-B18-30). The memory key is repeated
// in time.once-per (gateParams keeps it in step); the class's apply writes the very same key into the same wave Set.
bindCondition(
  129,
  2,
  {
    all: [
      { id: "time.once-per", scope: "wave", key: "requested:defeatist:ten-percent-comeback" },
      { id: "move.damaging" },
      { id: "side.is", kind: "foe" },
    ],
  },
  "gate",
); // Defeatist, 10% line

// OnDirectFaintRetaliationAbAttr (Tier B). Slot "gate", in the class's own order:
//   move.category !== STATUS  &&  attacker !== pokemon
// The guard (an attacker and a move exist) runs first inside the class and the residual (the attacker has not fainted) last. `side.is self`
// is `other === holder`, so its negation is `attacker !== pokemon`.
const damagingMoveFromAnotherPokemon = { all: [{ id: "move.damaging" }, { not: { id: "side.is", kind: "self" } }] };
bindCondition(5285, 1, damagingMoveFromAnotherPokemon, "gate"); // Ill Will, Torment
bindCondition(5653, 4, damagingMoveFromAnotherPokemon, "gate"); // Tummyache, Gastro Acid

// ChancePostAttackStealHeldItemAbAttr (Tier B, RNG in canApply). Slot "gate": the chance roll, `simulated || randBattleSeedInt(100) < chance`.
// The inherited rules (damaging move, !simulated, hit result, the move and contact filters, the random item pick) are the class's residual,
// unchanged and still after the roll. The pct is repeated from the live chance (gateParams).
bindCondition(82, 2, { id: "rng.chance", pct: 30 }, "gate"); // Gluttony, berries on contact
bindCondition(5121, 1, { id: "rng.chance", pct: 30 }, "gate"); // Low Blow, Feint Attack
bindCondition(5164, 1, { id: "rng.chance", pct: 30 }, "gate"); // Cheap Tactics, Scratch

// PostSummonSnowCloakAuroraVeilAbAttr (Tier B). Slot "gate" = the old canApply, one clause: arena.weatherType is HAIL or SNOW.
const hailOrSnow = {
  any: [
    { id: "field.weather", weather: "HAIL" },
    { id: "field.weather", weather: "SNOW" },
  ],
};
bindCondition(81, 0, hailOrSnow, "gate"); // Snow Cloak
bindCondition(5526, 2, hailOrSnow, "gate"); // Glacial Ghost
