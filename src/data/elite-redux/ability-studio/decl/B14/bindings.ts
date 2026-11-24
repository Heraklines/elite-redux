/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 instance bindings, chunk 1. Every Tier B gate of this chunk is a LEGACY closure: each one needs an atom the library
// does not have yet (requests/B14.md). A legacy binding keeps the attr reusable as a whole and counted as undecomposed;
// the rest of each class (trigger, guards, effect) is already declared.
//
// attrIndex is the position in `ability.attrs`, read from the live game, not from the .attr() line.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// Perpetual Motion (6022), attrs: 0 trigger, 1 end-of-turn launcher, 2 resolver, 3 progress, 4 power.
// Progress gate = [the move deals damage (inherited attackCondition, default `move.category !== STATUS`),
//                  the move carries ScriptedMoveMarkerAttr key "perpetual-motion"], in that order.
bindLegacyClosure(
  6022,
  3,
  "The second clause (the move is this ability's own scripted follow-up, a ScriptedMoveMarkerAttr with key perpetual-motion) has no library atom; move.scripted-marker is requested in requests/B14.md. The first clause maps to move.damaging.",
  "gate",
);
// Power gate = [the move carries ScriptedMoveMarkerAttr key "perpetual-motion"]; the armed-state clause is a guard in the class.
bindLegacyClosure(
  6022,
  4,
  "The gate is the scripted-move marker test (ScriptedMoveMarkerAttr key perpetual-motion) and no library atom reads that; move.scripted-marker is requested in requests/B14.md.",
  "gate",
);

// Southern Cross Punch (6016), attr 0. Gate = [move.hasFlag(PUNCHING_MOVE)].
bindLegacyClosure(
  6016,
  0,
  "The gate is move.hasFlag(PUNCHING_MOVE), the move's own flag. The library atom move.flag calls doesFlagEffectApply, which also counts flags that abilities inject, so it is not the same predicate; move.has-own-flag is requested in requests/B14.md.",
  "gate",
);

// Bitter Drill (6044), attr 0. Gate = [move.hasFlag(DRILL_BASED)].
bindLegacyClosure(
  6044,
  0,
  "The gate is move.hasFlag(DRILL_BASED), the move's own flag. The library atom move.flag calls doesFlagEffectApply, which also counts flags that abilities inject, so it is not the same predicate; move.has-own-flag is requested in requests/B14.md.",
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// Chunk 2. attrIndex read from the live game (a throwaway dump of ability.attrs).
// ---------------------------------------------------------------------------------------------------------------------------

// Bitter Drill (6044), attr 1 (BitterDrillDamageAbAttr). Gate = [move.hasFlag(DRILL_BASED), opponent has the ER_EMBEDDED tag].
bindLegacyClosure(
  6044,
  1,
  "Clause 1 of the gate is move.hasFlag(DRILL_BASED), the move's own flag. The library atom move.flag calls doesFlagEffectApply, which also counts flags that abilities inject, so it is not the same predicate; move.has-own-flag is requested in requests/B14.md. Clause 2 (target is Embedded) is tag.has, but a legacy binding covers the gate as a whole.",
  "gate",
);

// Slab's Curse (6066), attr 0. Gate = [the culprit is a foe, the faint came from a damaging move] (clauses 3 to 5; clause 4,
// `move !== undefined`, is what move.damaging answers false for). Guards 1 and 2 stay in the class.
bindCondition(6066, 0, { all: [{ id: "side.is", kind: "foe" }, { id: "move.damaging" }] }, "gate");

// Booby Trap (6067), attr 0 (BoobyTrapAbAttr). Gate = [damaging move, attacker is a foe] (clauses 4 to 6; clause 5,
// opponent !== pokemon, is implied by clause 6). Guards 1 to 3 and the residual (can add the tag, once per entry) stay in the class.
bindCondition(6067, 0, { all: [{ id: "move.damaging" }, { id: "side.is", kind: "foe" }] }, "gate");

// Booby Trap (6067), attr 1 (BoobyTrapItemLostAbAttr). Gate = [the culprit is a foe] (clauses 3 and 4; 3 is implied by 4).
bindCondition(6067, 1, { id: "side.is", kind: "foe" }, "gate");

// Ofuda (6070), attr 0. Gate = [30% chance]; the chance is repeated from the live `chance` param through gateParams.
bindCondition(6070, 0, { id: "rng.chance", pct: 30 }, "gate");

// ---------------------------------------------------------------------------------------------------------------------------
// Chunk 3. attrIndex read from the live game (a throwaway dump of ability.attrs).
// ---------------------------------------------------------------------------------------------------------------------------

// Low Tide (6071), attr 2 (LowTideWaterSurfAbAttr; attrs 0 and 1 are the redirect and the immunity of other batches).
// Gate = [the move deals damage (category !== STATUS), the attacker's move type after ability changes is Water], in that order.
// Guard 1 (not a preview) stays in the class.
bindCondition(6071, 2, { all: [{ id: "move.damaging" }, { id: "move.type", type: "WATER", effective: true }] }, "gate");

// Celestial Jelly (6078), attr 0. Gate = [Misty Terrain read raw, OR Rain / Heavy Rain whose effect is not suppressed].
bindLegacyClosure(
  6078,
  0,
  "The gate is arena.terrain?.terrainType === MISTY (raw, not hidden by Clueless) OR a Rain or Heavy Rain weather that is not suppressed (weather.isEffectSuppressed()). The library atoms field.terrain (reads arena.terrainType, hidden by Clueless) and field.weather (reads arena.weatherType, ignores Cloud Nine style suppression) are not the same predicates; field.terrain-unhidden and field.weather-unsuppressed are requested in requests/B14.md.",
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// Chunk 4. attrIndex read from the live game (a throwaway dump of ability.attrs). Registered classes only: the gates of the parked
// classes (Subversion, Mudball, Grit) are in pending/bindings.chunk4.pending.ts.
// ---------------------------------------------------------------------------------------------------------------------------

// Demodulator (6059) and Modulator (6060), attrs 0 and 1 (RaichuTerrainStatMultiplierAbAttr, Attack/Defense and Sp. Atk/Sp. Def).
// Gate = [the terrain is Electric]. The guard (the stat match) stays in the class. The terrain is repeated from the live `terrain`
// param through gateParams.
bindCondition(6059, 0, { id: "field.terrain", terrain: "ELECTRIC" }, "gate");
bindCondition(6059, 1, { id: "field.terrain", terrain: "ELECTRIC" }, "gate");
bindCondition(6060, 0, { id: "field.terrain", terrain: "ELECTRIC" }, "gate");
bindCondition(6060, 1, { id: "field.terrain", terrain: "ELECTRIC" }, "gate");

// Demodulator (6059) and Modulator (6060), attrs 2 and 3 (RaichuAllyStatMultiplierAbAttr, the partner's stats).
// Gate = [the terrain is Electric]. The guard (the stat match) and the residual (a battle with more than one Pokemon per side)
// stay in the class.
bindCondition(6059, 2, { id: "field.terrain", terrain: "ELECTRIC" }, "gate");
bindCondition(6059, 3, { id: "field.terrain", terrain: "ELECTRIC" }, "gate");
bindCondition(6060, 2, { id: "field.terrain", terrain: "ELECTRIC" }, "gate");
bindCondition(6060, 3, { id: "field.terrain", terrain: "ELECTRIC" }, "gate");

// ---------------------------------------------------------------------------------------------------------------------------
// Chunk 5. attrIndex read from the live game (golden-attr-order.json, checked by a throwaway dump of ability.attrs). The marker
// SynchronizedCurrentAbAttr (5921 attr 0) has no closure and no gate, so it needs no binding (its declaration is parked).
// ---------------------------------------------------------------------------------------------------------------------------

// Surges Up (6061), attr 2 (RaichuAllTerrainSurgeSurferAbAttr), ctor:2 = `() => isAnyTerrainActive()` = the terrain is not None.
bindCondition(6061, 2, { not: { id: "field.terrain", terrain: "NONE" } }, "ctor:2");

// Psionic (6063), attr 0 (PsionicTerrainPowerAbAttr), ctor:0 = getRaichuTerrainMoveMultiplier(user, effective move type) > 1.
bindLegacyClosure(
  6063,
  0,
  "Needs two atoms the library does not have: 'my battle slot is charged' (isElectrodynamicsPosition, R-B14-5.2) and 'has the ability' for an ER ability id such as Psionic and Electrodynamics, which are not in the AbilityId enum the atom accepts (R-B14-5.3). The rest maps to move.type (with ability changes), field.terrain and mon.grounded; the exact planned tree is in PsionicTerrainPowerAbAttr.decl.ts.",
  "ctor:0",
);

// Electrodynamics (6062), attr 0 (ElectrodynamicsTerrainPowerAbAttr), ctor:0 = not Psionic and the same terrain rule.
bindLegacyClosure(
  6062,
  0,
  "Needs 'my battle slot is charged' (isElectrodynamicsPosition, R-B14-5.2) and 'has the ability' for the ER abilities Psionic and Electrodynamics (not in the AbilityId enum, R-B14-5.3). The rest maps to move.type (with ability changes) and field.terrain; the exact planned tree is in ElectrodynamicsTerrainPowerAbAttr.decl.ts.",
  "ctor:0",
);

// Electrodynamics (6062), attrs 4 and 5 (ElectrodynamicsGalvanizeAbAttr ctor:1, ElectrodynamicsGalvanizePowerAbAttr ctor:0):
// both closures are canElectrodynamicsConvert(move, user).
bindLegacyClosure(
  6062,
  4,
  "canElectrodynamicsConvert needs four atoms the library does not have: 'an ability may change this move's type' (not in noAbilityTypeOverrideMoves, R-B14-5.4), 'is Terastallized' (R-B14-5.5), 'Tera type is' (R-B14-5.6) and 'is the species' (R-B14-5.7). The rest maps to move.type (own type), has-ability (Aerilate, Pixilate, Refrigerate) and move.is-move (Tera Blast, Tera Starstorm); the planned tree is in ElectrodynamicsGalvanizeAbAttr.decl.ts.",
  "ctor:1",
);
bindLegacyClosure(
  6062,
  5,
  "The same function as attr 4 (canElectrodynamicsConvert), so it needs the same four atoms: R-B14-5.4 (an ability may change this move's type), R-B14-5.5 (is Terastallized), R-B14-5.6 (Tera type is) and R-B14-5.7 (is the species).",
  "ctor:0",
);

// Synchronized Current (5921), attr 1 (SynchronizedCurrentBothAttackPowerAbAttr). Gate = [the move deals damage, an active ally has
// chosen a damaging move this turn]. No guard, no residual.
bindLegacyClosure(
  5921,
  1,
  "Clause 1 (the move deals damage) is move.damaging, but clauses 2 and 3 (an ACTIVE ally exists and its selected command this turn is a damaging move, read from currentBattle.turnCommands) have no atom: party.ally-chose-damaging-move is requested in requests/B14.md (R-B14-5.9). The library party.ally-exists uses getAlly(), which is not active-filtered.",
  "gate",
);

// Synchronized Current (5921), attr 2 (SynchronizedCurrentHealAbAttr). Gate = [an active ally exists, I did not attack this turn,
// the ally did not attack this turn]. No guard, no residual.
bindLegacyClosure(
  5921,
  2,
  "Needs 'an active ally is on the field' (R-B14-5.8, the first ally with isActive(true); party.ally-exists uses getAlly() which is not active-filtered) and 'attacked this turn' (R-B14-5.10: turnData.acted and a last move that is neither None nor a status move; time.acted reads only turnData.acted).",
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// Chunk 6. attrIndex read from the live game (golden-attr-order.json). Closed Circuit (5924) is a marker with no closure and no
// gate (its declaration is parked), Capacitor Bank Absorb (5925 attr 1) and Fault Current (5926 attr 0) have no condition slot, so
// they need no binding.
// ---------------------------------------------------------------------------------------------------------------------------

// Positive Feedback (5922), attr 0 (PositiveFeedbackPowerAbAttr). Gate = [the foe I aim at is paralyzed]. No guard, no residual.
bindCondition(5922, 0, { id: "status.has", who: "other", status: "PARALYSIS" }, "gate");

// Positive Feedback (5922), attr 1 (PositiveFeedbackAbAttr). ctor:0 = the parent attackCondition, default `move.category !== STATUS`.
// Gate = [the foe is paralyzed]. Guard 2 (`hitResult < 4`) stays in the class.
bindCondition(5922, 1, { id: "move.damaging" }, "ctor:0");
bindCondition(5922, 1, { id: "status.has", who: "other", status: "PARALYSIS" }, "gate");

// Negative Feedback (5923), attr 0 (NegativeFeedbackAbAttr). Same two slots as Positive Feedback.
bindCondition(5923, 0, { id: "move.damaging" }, "ctor:0");
bindCondition(5923, 0, { id: "status.has", who: "other", status: "PARALYSIS" }, "gate");

// Capacitor Bank (5925), attr 0 (CapacitorBankGainAbAttr). Gate = [the move deals damage (category !== STATUS)]. The residual
// (damage dealt, not blocked, below the maximum stacks, this move not counted yet) stays in the class.
bindCondition(5925, 0, { id: "move.damaging" }, "gate");

// Overloaded (5927), attr 0 (OverloadedPowerAbAttr). Gate = [I hold exactly the maximum stacks, I carry the Overloaded marker, the
// move is Electric after ability changes], in that order.
bindLegacyClosure(
  5927,
  0,
  "Clauses 1 and 2 have no atom: I hold exactly the maximum charge stacks (mon.charge-stacks, R-B14-6.2) and I carry an active ability attr named OverloadedChipAbAttr (mon.has-active-attr, R-B14-6.10). Clause 3 is move.type ELECTRIC with effective true; the exact planned tree is in OverloadedPowerAbAttr.decl.ts.",
  "gate",
);

// ---------------------------------------------------------------------------------------------------------------------------
// Chunk 7. attrIndex read from the live game (Overloaded: 0 power, 1 priority, 2 chip).
// ---------------------------------------------------------------------------------------------------------------------------

// Overloaded (5927), attr 1 (OverloadedPriorityAbAttr). ctor:0 = the same rule as the power half: [I hold exactly the maximum stacks,
// I carry the Overloaded marker, the move is Electric after ability changes], in that order.
bindLegacyClosure(
  5927,
  1,
  "Clauses 1 and 2 have no atom: I hold exactly the maximum charge stacks (mon.charge-stacks, R-B14-6.2) and I carry an active ability attr named OverloadedChipAbAttr (mon.has-active-attr, R-B14-6.10). Clause 3 is move.type ELECTRIC with effective true; the exact planned tree is in OverloadedPriorityAbAttr.decl.ts.",
  "ctor:0",
);

// Overloaded (5927), attr 2 (OverloadedChipAbAttr). Gate = [I hold exactly the maximum stacks]. The guard (not fainted) stays in the class.
bindLegacyClosure(
  5927,
  2,
  "I hold exactly the maximum charge stacks (getCharge(pokemon) === CHARGE_STACK_MAX) has no atom: mon.charge-stacks is requested in requests/B14.md (R-B14-6.2); the planned tree is mon.charge-stacks { holder, '=', 4 }.",
  "gate",
);
