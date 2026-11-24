/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 instance bindings, chunk 1. attrIndex is the position in `ability.attrs`, read from the live game (a throwaway dump of
// every attr of the users). The library form of each constructor closure (slot "ctor:N") and each Tier B gate (slot "gate").
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// ---------------------------------------------------------------------------------------------------------------------------
// BallasterAbAttr, Ballaster (6006), attrs: 0 BallasterResetAbAttr, 1 BallasterAbAttr.
// Gate = [move.category !== STATUS] (clause 4); guards 1 to 3 (damage above 0, nobody fainted) stay in the class.
bindCondition(6006, 1, { id: "move.damaging" }, "gate");

// ---------------------------------------------------------------------------------------------------------------------------
// ConfectiousAttackAbAttr, Confectious (6034), attrs: 0 ConfectiousEntryAbAttr, 1 ConfectiousAttackAbAttr, 2 ConfectiousDefendAbAttr.
// ctor:0 = the inherited attackCondition `(_user, _target, move) => move.category !== MoveCategory.STATUS`.
bindCondition(6034, 1, { id: "move.damaging" }, "ctor:0");
// Gate = [appliesContact(holder, foe, move)] = move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: holder, target: foe }).
bindCondition(6034, 1, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate");

// ---------------------------------------------------------------------------------------------------------------------------
// StellarizeTypeAbAttr. Stellarize (6053) attrs: 0 StellarizeTypeAbAttr, 1 StabAddAbAttr, 2 StellarizePowerAbAttr.
// Bejeweled (6111) attrs: 0 TypeConversionAbAttr, 1 TypeConversionPowerBoostAbAttr, 2 StellarizeTypeAbAttr, 3 StabAddAbAttr, 4 StellarizePowerAbAttr.
// ctor:1 = `(_user, _target, move) => move.type === PokemonType.NORMAL`: the move's OWN printed type (effective: false; the default
// `true` asks getMoveType, which dispatches this very class again).
const PRINTED_NORMAL_MOVE = { id: "move.type", type: "NORMAL", effective: false };
bindCondition(6053, 0, PRINTED_NORMAL_MOVE, "ctor:1"); // Stellarize
bindCondition(6111, 2, PRINTED_NORMAL_MOVE, "ctor:1"); // Bejeweled

// ---------------------------------------------------------------------------------------------------------------------------
// StellarizePowerAbAttr. Gate = [holder.getTypes(true, false).includes(STELLAR)] = holder.isOfType(STELLAR).
const HOLDER_IS_STELLAR = { id: "mon.has-type", who: "holder", type: "STELLAR" };
bindCondition(6053, 2, HOLDER_IS_STELLAR, "gate"); // Stellarize
bindCondition(6111, 4, HOLDER_IS_STELLAR, "gate"); // Bejeweled

// ctor:0 = `(_user, target, move) => !!target && move.type === NORMAL && (target.isTerastallized || target.isMega() || /gmax|gigantamax/i.test(target.getFormKey()))`.
const FOE_SPECIAL_FORM_REASON =
  "The closure is `!!target && move.type === NORMAL && (target.isTerastallized || target.isMega() || /gmax|gigantamax/i.test(target.getFormKey()))`. The first two tests map to move.type (printed type, effective false) and to an atom that answers false without a foe, but 'the foe is Terastallized', 'the foe is Mega Evolved' and 'the foe is Gigantamax (form key)' have no library atom; requested as R-B16-8, R-B16-9 and R-B16-10 in requests/B16.md.";
bindLegacyClosure(6053, 2, FOE_SPECIAL_FORM_REASON, "ctor:0"); // Stellarize
bindLegacyClosure(6111, 4, FOE_SPECIAL_FORM_REASON, "ctor:0"); // Bejeweled

// ===========================================================================================================================
// Chunk 2. attrIndex read from the live game (throwaway dump of every attr of every user).

// ---------------------------------------------------------------------------------------------------------------------------
// ConfectiousDefendAbAttr, Confectious (6034) attr 2. Gate = [appliesContact(attacker, holder, move)]
// = move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: attacker, target: holder }); the clause before it (damage > 0) is a class guard.
bindCondition(6034, 2, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate");

// ---------------------------------------------------------------------------------------------------------------------------
// CyberkineticAbAttr, Cyberkinetic (6040) attr 0 (the only attr). ctor:0 = the inherited attackCondition
// `(_user, _target, move) => move.category !== STATUS`; gate = [appliesContact(holder, foe, move)].
bindCondition(6040, 0, { id: "move.damaging" }, "ctor:0");
bindCondition(6040, 0, { id: "move.flag", flag: "MAKES_CONTACT" }, "gate");

// ---------------------------------------------------------------------------------------------------------------------------
// ContaminatedHitMultiplierAbAttr, Contaminated (6050) attr 0 (attr 1 is HitMultiplierPowerAbAttr). ctor:1 = `anyPoisonedOnField`:
// `globalScene.getField(true).some(p => p.status?.effect === POISON || p.status?.effect === TOXIC)`, every active Pokemon of BOTH sides.
bindLegacyClosure(
  6050,
  0,
  "The closure is `getField(true).some(poisoned or badly poisoned)` over every active Pokemon of both sides. status.has reads one Pokemon (holder, other or ally), and no atom asks whether ANY Pokemon on the field has a status; requested as R-B16-12 in requests/B16.md.",
  "ctor:1",
);

// ---------------------------------------------------------------------------------------------------------------------------
// DecayRestoreAbAttr, Decay (6051) attr 1 (attr 0 is DecayEntryAbAttr, attr 2 BlockStatusDamageAbAttr). Gate (read inside `apply`) =
// [holder.getTag(ER_DECAY_POISON) && holder.status?.effect !== POISON]. DecayEntryAbAttr has no closure and needs no binding.
bindCondition(
  6051,
  1,
  {
    all: [
      { id: "tag.has", who: "holder", tag: "ER_DECAY_POISON" },
      { not: { id: "status.has", who: "holder", status: "POISON" } },
    ],
  },
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// ErDefeatistStatMultiplierAbAttr, Defeatist (129) attrs 0 (Attack) and 1 (Sp. Atk); attr 2 is OnceLowHpStatRaiseAbAttr. ctor:2 (the
// parent's optional attack condition) is absent on both instances, so it needs no binding. Gate = [pokemon.getHpRatio() <= 1 / 3].
const DEFEATIST_GATE_REASON =
  "The gate is `pokemon.getHpRatio() <= 1 / 3`, and getHpRatio() rounds the ratio to two decimals (round(hp / max * 100) / 100), so at 33.4 percent HP it passes. hp.at-most (exact) tests hp * 100 <= max * 33 and fails there, and floor-half differs again; no atom calls the game's rounded ratio. Requested as R-B16-11 (hp.ratio-at-most) in requests/B16.md.";
bindLegacyClosure(129, 0, DEFEATIST_GATE_REASON, "gate");
bindLegacyClosure(129, 1, DEFEATIST_GATE_REASON, "gate");
