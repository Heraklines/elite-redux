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

// ===========================================================================================================================
// Chunk 3. attrIndex read from the live game (throwaway dump of every attr of every user).
// ErTerrainSummonAbAttr (Psychic Surge 227, Misty Surge 228, Grassy Surge 229, Hadron Engine 289 attr 0, Psychic Supremacy 20000 attr 2) and
// PostSummonWonderRoomAbAttr (False Equivalence 6007 attr 0) have no closure and need no binding.

// ---------------------------------------------------------------------------------------------------------------------------
// HydromancyEffectChanceAbAttr, Hydromancy (6005) attr 0. Gate = [move.attrs.some(attr => attr.constructor.name === "ErDrenchAttr")].
bindLegacyClosure(
  6005,
  0,
  "The gate is `move.attrs.some(attr => attr.constructor.name === 'ErDrenchAttr')`, 'the move carries the Drench part'. No atom reads the parts of a move; requested as R-B16-16 (move.can-drench) in requests/B16.md.",
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// ElectromancyEffectChanceAbAttr, Electromancy (6037) attr 0. Gate = [move.getAttrs("StatusEffectAttr").some(a => a.effect === PARALYSIS)].
bindLegacyClosure(
  6037,
  0,
  "The gate is `move.getAttrs('StatusEffectAttr').some(attr => attr.effect === boostedStatus)`, 'the move has a part that can inflict the status' (paralysis for the one user). No atom reads the parts of a move; requested as R-B16-15 (move.can-inflict-status) in requests/B16.md.",
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// IrradiatedFistAbAttr, Irradiated Fist (6035) attr 0 (the only attr). ctor:0 = the inherited attackCondition
// `(_user, _target, move) => move.category !== STATUS`. Gate = [move.hasFlag(PUNCHING_MOVE), holder.randBattleSeedInt(100) < 50]: the flag
// test first, then the one draw (rng.chance keeps the position). Guards 1 and 2 (the attack condition, damage > 0) and the residual
// (foe.canSetStatus(TOXIC)) stay in the class.
bindCondition(6035, 0, { id: "move.damaging" }, "ctor:0");
bindCondition(
  6035,
  0,
  {
    all: [
      { id: "move.flag", flag: "PUNCHING_MOVE" },
      { id: "rng.chance", pct: 50 },
    ],
  },
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// HijackAbAttr, Hijack (6038) attr 0 (the only attr). ctor:0 = the inherited attackCondition `move.category !== STATUS`. Gate =
// [holder.getMoveType(move) === ELECTRIC, foe.status?.effect === PARALYSIS]. Residual (the foe's once-per-switch-in flag and its
// Commanded marker) stays in the class.
bindCondition(6038, 0, { id: "move.damaging" }, "ctor:0");
bindCondition(
  6038,
  0,
  {
    all: [
      { id: "move.type", type: "ELECTRIC", effective: true },
      { id: "status.has", who: "other", status: "PARALYSIS" },
    ],
  },
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// EulogyAbAttr, Eulogy (6046) attr 0 (the only attr). Gate = [!holder.battleData.erAbilityProvenance.includes("eulogy:spent")].
bindLegacyClosure(
  6046,
  0,
  "The gate is `!holder.battleData.erAbilityProvenance.includes('eulogy:spent')`, 'I have not used my revival this battle'. time.once-per reads its own memory (a WeakMap by battle data), which this class's apply never writes, so it would not be the same test; an atom that reads the class's own marker is requested as R-B16-17 (time.marker-set) in requests/B16.md.",
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// JackpotBattleBuffAbAttr, Jackpot (6114) attr 1 (attr 0 is PostSummonScriptedMoveAbAttr). Gate (read inside `apply`) =
// [!currentBattle.erJackpotSides?.has(holder.isPlayer())].
bindLegacyClosure(
  6114,
  1,
  "The gate is `!currentBattle.erJackpotSides?.has(holder.isPlayer())`, 'nobody on my side got the boost yet in this battle'. time.once-per keeps its memory per Pokemon, this one lives per side on the battle object; requested as R-B16-18 (time.side-once-per-battle) in requests/B16.md.",
  "gate",
);

// ===========================================================================================================================
// Chunk 4. attrIndex read from the live game (golden-attr-order.json: Knuckle Down has the one attr).

// ---------------------------------------------------------------------------------------------------------------------------
// KnuckleDownAbAttr, Knuckle Down (6099) attr 0 (the only attr). ctor:0 = the inherited attackCondition
// `(_user, _target, move) => move.category !== STATUS`; gate = [move.doesFlagEffectApply({ flag: PUNCHING_MOVE, user: holder, target: foe })].
// Guards 2 and 3 (hitResult < NO_EFFECT, hitCount === hitsLeft) stay in the class (R-B16-17, R-B16-18).
bindCondition(6099, 0, { id: "move.damaging" }, "ctor:0");
bindCondition(6099, 0, { id: "move.flag", flag: "PUNCHING_MOVE" }, "gate");
