/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B13 (chunk 1): the library form of every constructor closure (slot "ctor:N") and every
// Tier B gate (slot "gate") of Final Season (5972), Foul Harvest (5973) and Porous (5974), keyed by
// (abilityId, attrIndex). "attr N" is the position in `ability.attrs`.
//
// Every line was written by hand from the class source and then checked by the L1 differential over the state grid.
// A line that says legacy-closure names the library atom that is missing; the matching request is in
// requests/B13.md.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// ---------------------------------------------------------------------------------------------
// Final Season (5972)
// ---------------------------------------------------------------------------------------------

// FinalSeasonEntryAbAttr (attr 0), gate: `VOLUNTARY_ENTRY.has(holder)`.
bindLegacyClosure(
  5972,
  0,
  "Final Season entry: VOLUNTARY_ENTRY.has(holder), a private set filled by markGenuineVoluntaryEntry when the switch was a deliberate party command; needs the atom entry.voluntary-switch-in (R-B13-1)",
  "gate",
);

// FinalSeasonFogAbAttr (attr 1), gate: `FINAL_SEASON_PENDING_FOG.has(holder)`.
bindLegacyClosure(
  5972,
  1,
  "Final Season fog: FINAL_SEASON_PENDING_FOG.has(holder), a private set filled by the entry effect (a flag set by the switch-in effect); needs the atom time.armed (R-B13-2)",
  "gate",
);

// FinalSeasonPowerAbAttr (attr 2), gate = clauses 3 and 4 of the original closure, in order:
//   arena.weatherType === EERIE_FOG
//   && [DARK, FLYING].includes(holder.getMoveType(move))
// Clauses 1 and 2 (the fog is my own, still the same Weather instance) are the class's `guards`, see its declaration.
bindCondition(
  5972,
  2,
  {
    all: [
      { id: "field.weather", weather: "EERIE_FOG" },
      {
        any: [
          { id: "move.type", type: "DARK" },
          { id: "move.type", type: "FLYING" },
        ],
      },
    ],
  },
  "gate",
);

// ---------------------------------------------------------------------------------------------
// Foul Harvest (5973)
// ---------------------------------------------------------------------------------------------

// FoulHarvestAbAttr (attr 0), ctor:0 = the base class's default attack condition `move.category !== STATUS`.
bindCondition(5973, 0, { id: "move.damaging" }, "ctor:0");

// FoulHarvestAbAttr (attr 0), gate = clauses 2 to 4 of canApply, in order:
//   damage > 0 && hitResult < NO_EFFECT && my last move record exists and is not the one already counted
bindLegacyClosure(
  5973,
  0,
  "Foul Harvest: damage > 0, hitResult < NO_EFFECT and 'my last move record is new' (a per-Pokemon memory of the last counted move); needs hit.dealt-damage, hit.not-blocked and time.new-move-of-mine (R-B13-3, R-B13-4, R-B13-5)",
  "gate",
);

// ---------------------------------------------------------------------------------------------
// Porous (5974). PorousResetAbAttr (attr 0) has no condition at all, so there is nothing to bind.
// ---------------------------------------------------------------------------------------------

// PorousSoundReductionAbAttr (attr 1), gate: `move.doesFlagEffectApply({ flag: SOUND_BASED, user: attacker })`.
bindCondition(5974, 1, { id: "move.flag", flag: "SOUND_BASED" }, "gate");

// PorousChargeAbAttr (attr 2), gate: `damage > 0 && hitResult < NO_EFFECT && POROUS[holder].lastMoveRecord !== the foe's last record`.
bindLegacyClosure(
  5974,
  2,
  "Porous charge: damage > 0, hitResult < NO_EFFECT and 'the foe's last move record is not the one already counted' (a per-Pokemon memory); needs hit.dealt-damage, hit.not-blocked and time.new-move-of-foe (R-B13-3, R-B13-4, R-B13-6)",
  "gate",
);

// PorousPowerAbAttr (attr 3), gate = clause 1 of the original closure: `holder.getMoveType(move) === GROUND`.
// Clause 2 (a charge is stored) is the class's `residual`, see its declaration.
bindCondition(5974, 3, { id: "move.type", type: "GROUND" }, "gate");

// ---------------------------------------------------------------------------------------------
// Chunk 2: Glam Rock (5975), Two-Faced Unleashed (5977), Anneal (5979), Vapor Body (5981), Heavyweight (5982) and
// Meteor Mass (5997). Anneal's reset (attr 0), Sediment Bloom (5976) and the Heavyweight constructor arguments have
// no condition to bind.
// ---------------------------------------------------------------------------------------------

// GlamRockAbAttr (Glam Rock attr 1), gate: any of the eight hazards is on the holder's own side, listed in the class's
// own HAZARDS order: HAZARDS.some(tag => !!arena.getTagOnSide(tag, ownSide(holder))).
bindCondition(
  5975,
  1,
  {
    any: [
      { id: "field.arena-tag", tag: "SPIKES", side: "holder-side" },
      { id: "field.arena-tag", tag: "TOXIC_SPIKES", side: "holder-side" },
      { id: "field.arena-tag", tag: "STEALTH_ROCK", side: "holder-side" },
      { id: "field.arena-tag", tag: "STICKY_WEB", side: "holder-side" },
      { id: "field.arena-tag", tag: "HOT_COALS", side: "holder-side" },
      { id: "field.arena-tag", tag: "FOAMY_WEB", side: "holder-side" },
      { id: "field.arena-tag", tag: "CREEPING_THORNS", side: "holder-side" },
      { id: "field.arena-tag", tag: "ER_INFESTATION_TRAP", side: "holder-side" },
    ],
  },
  "gate",
);

// TwoFacedPowerAbAttr (Two-Faced Unleashed attr 0), gate = clause 1 of the original closure: `move.category !== STATUS`.
// Clause 2 (my other face is out this turn) is the class's `residual`, see its declaration.
bindCondition(5977, 0, { id: "move.damaging" }, "gate");

// AnnealAbAttr (Anneal attr 1), gate = clauses 3 and 4 of canApply, in order:
//   holder.getMoveEffectiveness(foe, move) <= 0.5 && holder.getMoveEffectiveness(foe, move) > 0
// Clauses 1 and 2 (damage > 0, hitResult < NO_EFFECT) are the class's `guards`, clauses 5 and 6 (the raise counter and
// the once-per-foe-move memory) its `residual`; see its declaration.
bindCondition(
  5979,
  1,
  {
    all: [
      { id: "move.effectiveness", cmp: "lte", n: 0.5 },
      { id: "move.effectiveness", cmp: "gt", n: 0 },
    ],
  },
  "gate",
);

// VaporBodyAccuracyAbAttr (Vapor Body attr 0), ctor:0 = the class's own default closure
//   (holder, attacker, move) => move.doesFlagEffectApply({ MAKES_CONTACT, user: attacker, target: holder }).
bindCondition(5981, 0, { id: "move.flag", flag: "MAKES_CONTACT" }, "ctor:0");

// HeavyweightPowerAbAttr (Heavyweight attr 0, Meteor Mass attr 1), gate = the original closure `isHeavyweightMove(move)`:
//   move.id === HEAVY_SLAM || move.id === HEAT_CRASH || move.hasFlag(PUNCHING_MOVE)
const HEAVYWEIGHT_MOVE = {
  any: [
    { id: "move.is-move", moveId: "HEAVY_SLAM" },
    { id: "move.is-move", moveId: "HEAT_CRASH" },
    { id: "move.flag", flag: "PUNCHING_MOVE" },
  ],
};
bindCondition(5982, 0, HEAVYWEIGHT_MOVE, "gate");
bindCondition(5997, 1, HEAVYWEIGHT_MOVE, "gate");

// HeavyweightDropAbAttr (Heavyweight attr 1), ctor:0 = the base class's default attack condition `move.category !== STATUS`.
bindCondition(5982, 1, { id: "move.damaging" }, "ctor:0");

// HeavyweightDropAbAttr (Heavyweight attr 1), gate = clause 3 of canApply (the heavyweight move test, as above).
// Clauses 1 and 2 (the base attack condition, damage > 0) are the class's `guards`, clause 4 (not yet used this turn)
// its `residual`.
bindCondition(5982, 1, HEAVYWEIGHT_MOVE, "gate");

// ---------------------------------------------------------------------------------------------
// Chunk 3: Two-Faced Unleashed (5977, attr 1), Ring General (5987), Setlist (5989) and Fan Favorite (5990).
// The resets and the entry note (SetlistResetAbAttr, RingGeneralEntryAbAttr, TwoFacedPowerAbAttr's attr 0 is chunk 2) have
// no condition to bind.
// ---------------------------------------------------------------------------------------------

// TwoFacedRecoilAbAttr (Two-Faced Unleashed attr 1), ctor:0 = the base class's default attack condition
// `move.category !== STATUS`.
bindCondition(5977, 1, { id: "move.damaging" }, "ctor:0");

// TwoFacedRecoilAbAttr (Two-Faced Unleashed attr 1), gate = clause 3 of canApply: `TWO_FACED_ACTIVE_TURN[holder] === turnKey()`.
// Clauses 1 and 2 (base attack condition, damage > 0) are the class's `guards`, clauses 4 and 5 (a last move record
// exists and is not the one already counted) its `residual`; see its declaration.
bindLegacyClosure(
  5977,
  1,
  "Two-Faced recoil: TWO_FACED_ACTIVE_TURN[holder] === 'wave:turn', a private per-Pokemon memory set when the other face comes out; needs the atom time.armed-this-turn (R-B13-22)",
  "gate",
);

// RingGeneralTrapAbAttr (Ring General attr 1), gate = the whole original closure, in order: `holder.getHpRatio() > 0.5`
// (whole percents, R-B13-31), `RING_ENTRY_TURN.get(holder) !== turnKey()` (I did not come in this turn, R-B13-30) and
// `!target.isOfType(GHOST)`. Clause 4 (the engine's own trapping rules, which repeat the Ghost test) is the class's `residual`.
bindLegacyClosure(
  5987,
  1,
  "Ring General trap: my HP is above half (rounded whole percents) and I did not come in this turn (a private per-Pokemon memory) and the foe is not a Ghost; needs the atoms hp.above-rounded (R-B13-31) and time.entered-this-turn (R-B13-30), the Ghost part is mon.has-type",
  "gate",
);

// SetlistPowerAbAttr (Setlist attr 1), gate = the whole original closure: `setlistNextLevel(holder, move) > 0`
//   (the pattern holds two moves and the move being used is the one expected next).
bindLegacyClosure(
  5989,
  1,
  "Setlist power: setlistNextLevel(holder, move) > 0, i.e. the pattern holds two moves and this is the one expected next (a private per-Pokemon state machine); needs the atom time.expected-move (R-B13-25)",
  "gate",
);

// SetlistAccuracyAbAttr (Setlist attr 2), gate = clause 2 of canApply: the same `setlistNextLevel(holder, move) > 0`.
// Clause 1 (accuracy > 0) is the class's `guards`.
bindLegacyClosure(
  5989,
  2,
  "Setlist accuracy: setlistNextLevel(holder, move) > 0, i.e. the pattern holds two moves and this is the one expected next (a private per-Pokemon state machine); needs the atom time.expected-move (R-B13-25)",
  "gate",
);

// FanFavoritePowerAbAttr (Fan Favorite attr 0), gate = clause 1 of the original closure: `move.category === SPECIAL`.
// Clause 2 (a healthy teammate waits on the bench) is the class's `residual`, see its declaration.
bindCondition(5990, 0, { id: "move.category", category: "SPECIAL" }, "gate");

// FanFavoriteAccuracyAbAttr (Fan Favorite attr 1), gate = clause 2 of canApply: `livingBenchCount(holder) > 0`
//   (a party member of my side that is neither fainted nor on the field). Clause 1 (accuracy > 0) is the class's `guards`.
bindLegacyClosure(
  5990,
  1,
  "Fan Favorite accuracy: livingBenchCount(holder) > 0, i.e. a party member of my side that is neither fainted nor on the field; needs the atom party.bench-count (R-B13-29)",
  "gate",
);

// ---------------------------------------------------------------------------------------------
// Chunk 4: Eclipse Wing (5971, attr 1), Spirit Punch (5983), Deadeye Draw (5984, attrs 0 and 1), Center of Attention
// (5993, attr 0). The marker classes (DeadeyeMarkerAbAttr, CenterOfAttentionAbAttr) and the entry reset
// (EncoreSetResetAbAttr) have no condition to bind.
// ---------------------------------------------------------------------------------------------

// DeadeyeMarkAbAttr (Deadeye Draw attr 0), ctor:0 = the base class's default attack condition `move.category !== STATUS`.
bindCondition(5984, 0, { id: "move.damaging" }, "ctor:0");

// DeadeyeMarkAbAttr (Deadeye Draw attr 0), gate = clause 3 of canApply: `move.hasFlag(ARROW_BASED) || move.hasFlag(PULSE_MOVE)`.
// Clauses 1 and 2 (base attack condition, damage > 0) are the class's `guards`.
bindCondition(
  5984,
  0,
  {
    any: [
      { id: "move.flag", flag: "ARROW_BASED" },
      { id: "move.flag", flag: "PULSE_MOVE" },
    ],
  },
  "gate",
);

// DeadeyeCritAbAttr (Deadeye Draw attr 1), gate = the pulse-move clause of the old closure `deadeyeApplies`:
// `move.hasFlag(PULSE_MOVE)`. "Not already critical" and "a target exists" are the class's `guards`; "the target is my
// mark and on the field" is its `residual` (a private memory, R-B13-34).
bindCondition(5984, 1, { id: "move.flag", flag: "PULSE_MOVE" }, "gate");

// CenterSpreadReductionAbAttr (Center of Attention attr 0), gate = the old closure `move.isMultiTarget()`.
bindLegacyClosure(
  5993,
  0,
  "Center of Attention spread reduction: move.isMultiTarget(), i.e. the move's target kind is one of ALL_OTHERS, ALL_NEAR_OTHERS, ALL_NEAR_ENEMIES, ALL_ENEMIES, USER_AND_ALLIES, ALL, USER_SIDE, ENEMY_SIDE, BOTH_SIDES; move.target-kind groups these differently (PARTY, USER, NEAR_ALLY, ALLY and USER_OR_NEAR_ALLY would match too); needs the atom move.hits-several-targets (R-B13-39)",
  "gate",
);

// EclipseWingTurnEndAbAttr (Eclipse Wing attr 1), gate = clause 1 of canApply:
// `ECLIPSE_COUNTER_TARGET.get(holder)?.isFainted() === true` (clause 2, "I have not fainted", is the guard not-fainted).
bindLegacyClosure(
  5971,
  1,
  "Eclipse Wing turn end: ECLIPSE_COUNTER_TARGET.get(holder)?.isFainted() === true, a private per-Pokemon memory filled by tryEclipseWing with the foe my counter-strike aimed at; needs the atom for 'the foe I struck back at has fainted' (R-B13-35)",
  "gate",
);

// SpiritPunchAbAttr (Spirit Punch attr 0), ctor:0 = the base class's default attack condition `move.category !== STATUS`.
bindCondition(5983, 0, { id: "move.damaging" }, "ctor:0");

// SpiritPunchAbAttr (Spirit Punch attr 0), gate = clause 4 of canApply: `move.hasFlag(PUNCHING_MOVE)`.
// Clauses 1 to 3 (base attack condition, damage > 0, hit not blocked) are the class's `guards`, clauses 5 to 8 (a
// single-hit move, not a follow-up move, a last move record that was not counted yet) its `residual`.
bindCondition(5983, 0, { id: "move.flag", flag: "PUNCHING_MOVE" }, "gate");

// ---------------------------------------------------------------------------------------------
// Chunk 5: Eclipse Wing (5971, attr 0), Living Chrome (5980, attr 1), Skyhook (5978), Boot Hill (5985), Encore Set (5988, attr 1)
// and Reduction (5991). The markers (EclipseWingMarkerAbAttr) and the entry restore (CrackedVesselRestoreTypesAbAttr, Cracked
// Vessel 5992) have no condition to bind.
// ---------------------------------------------------------------------------------------------

// EclipseWingPowerAbAttr (Eclipse Wing attr 0), gate = the type clause of the old closure, in the original form:
// `[DARK, FLYING].includes(holder.getMoveType(move))`. The HP clause (`getHpRatio() < 1 / 3`) is the class's `residual`.
bindCondition(
  5971,
  0,
  {
    any: [
      { id: "move.type", type: "DARK" },
      { id: "move.type", type: "FLYING" },
    ],
  },
  "gate",
);

// SkyhookAbAttr (Skyhook attr 0), ctor:0 = the base class's default attack condition `move.category !== STATUS`.
bindCondition(5978, 0, { id: "move.damaging" }, "ctor:0");

// SkyhookAbAttr (Skyhook attr 0), gate = clause 4 of canApply: `SKYHOOK_TURN.get(holder) !== turnKey()`.
// Clauses 1 to 3 (base attack condition, damage > 0, the final hit) are the class's `guards`, clause 5 (every foe allows
// my switch) its `residual`.
bindLegacyClosure(
  5978,
  0,
  "Skyhook: SKYHOOK_TURN.get(holder) !== 'wave:turn', i.e. I have not pivoted out yet this turn (a private per-Pokemon memory that apply writes); needs the atom time.not-yet-this-turn (R-B13-17)",
  "gate",
);

// LivingChromeReductionAbAttr (Living Chrome attr 1), gate = the whole old closure: a shape memory of this wave and this turn
// exists, and (it is the flat Eevee memory or the attacker's move type is one of the remembered types).
bindLegacyClosure(
  5980,
  1,
  "Living Chrome: SHAPE_MEMORY[holder] exists, was made this wave and this turn, and (state.flat or its types include the attacker's move type); a private per-Pokemon memory written by recordLivingChromeTransformation; needs the atom for 'I hold a shape memory from this turn that covers the attacker's move type' (R-B13-50)",
  "gate",
);

// BootHillAbAttr (Boot Hill attr 0), ctor:0 = the base class's default attack condition `move.category !== STATUS`.
bindCondition(5985, 0, { id: "move.damaging" }, "ctor:0");

// BootHillAbAttr (Boot Hill attr 0), gate = clause 3 of canApply: `opponent.isFainted()`.
// Clauses 1 and 2 (base attack condition, damage > 0) are the class's `guards`, clause 4 (not a follow-up move) its `residual`.
bindLegacyClosure(
  5985,
  0,
  "Boot Hill: opponent.isFainted(), i.e. the target was knocked out by this hit; no library atom reads whether a Pokemon has fainted; needs the atom mon.fainted{who} (R-B13-44)",
  "gate",
);

// EncoreSetAbAttr (Encore Set attr 1), ctor:0 = the base class's default attack condition `move.category !== STATUS`.
// The other clauses stay in canApply (Tier A), see its declaration.
bindCondition(5988, 1, { id: "move.damaging" }, "ctor:0");

// ReductionPowerAbAttr (Reduction attr 0), gate = the whole old closure: `REDUCTION_ACTIVE[holder].move === move && .turn === turnKey()`.
bindLegacyClosure(
  5991,
  0,
  "Reduction power: REDUCTION_ACTIVE.get(holder) holds this very move and this turn's key, i.e. prepareReductionMove consumed the field for this move (a private per-Pokemon memory written by an engine call by name); needs the atom for 'the field was consumed for this move' (R-B13-48)",
  "gate",
);
