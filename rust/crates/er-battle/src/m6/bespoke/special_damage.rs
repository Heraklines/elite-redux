//! `SPECIAL_DAMAGE_COUNTER` bespoke family: stored-damage records and
//! counter-retaliation transitions.
//!
//! Implements the closed retaliation surface of the four catalog moves that
//! carry `CounterDamageAttr`/`CounterRedirectAttr`:
//!
//! | Move | Numeric ID | Multiplier | Category filter |
//! |------|------------|------------|-----------------|
//! | Counter | 68 | 2 (`SAFE_INTEGER`) | physical |
//! | Mirror Coat | 243 | 2 (`SAFE_INTEGER`) | special |
//! | Metal Burst | 368 | 1.5 (f64 bits `3ff8000000000000`) | both |
//! | Comeuppance | 894 | 1.5 (f64 bits `3ff8000000000000`) | both |
//!
//! Frozen oracle behavior (`src/data/moves/move.ts:2319-2413`,
//! `src/data/moves/move-utils.ts:249-263`, `src/utils/common.ts:403-405`,
//! `src/data/moves/move-condition.ts:243-270`):
//!
//! - Eligibility reads the received-attack window of the current turn and
//!   keeps the first record whose move category is damaging, matches the
//!   filter, and did not come from an ally.
//! - The retaliation amount is `toDmgValue(damage * multiplier)`:
//!   exact floor division with a frozen minimum of one. Multipliers are
//!   represented as [`ExactRatioV2`] so no floating point enters the kernel;
//!   `2` and `1.5` are exactly representable, so ratio form is bit-exact.
//! - The redirect target is the recorded attacker; in multi-battle formats a
//!   fainted attacker falls back to the first active battler on the same
//!   side, and only then does the transition fail.
//! - Without an eligible source the move fails before any damage is dealt
//!   and without consuming RNG. Every failure path returns the input state
//!   untouched.
//!
//! Ordinary damage formulas (type effectiveness, stats, rolls) stay outside
//! this family: it consumes already-recorded damage values only.

use er_mechanics::condition_v2::ExactRatioV2;
use er_state::bespoke_v2::special_damage::{
    SpecialDamageCategory, SpecialDamageStateError, SpecialDamageStateV2, StoredDamageRecordV2,
};
use er_types::SafeU53;
use thiserror::Error;

/// Counter — 2x physical retaliation.
pub const MOVE_COUNTER: u16 = 68;
/// Mirror Coat — 2x special retaliation.
pub const MOVE_MIRROR_COAT: u16 = 243;
/// Metal Burst — 1.5x retaliation against any category.
pub const MOVE_METAL_BURST: u16 = 368;
/// Comeuppance — 1.5x retaliation against any category.
pub const MOVE_COMEUPPANCE: u16 = 894;

/// Flat ally boundary of the frozen `BattlerIndex` layout
/// (`PLAYER = 0`, `PLAYER_2 = 1`, `ENEMY = 2`, `ENEMY_2 = 3`): indices below
/// the boundary share the player side, indices at or above it share the enemy
/// side (`src/utils/pokemon-utils.ts:165-174`). The TypeScript `ATTACKER`
/// sentinel never enters canonical state, so no sentinel branch exists here.
pub const BATTLER_INDEX_ENEMY_BOUNDARY: u8 = 2;

/// Frozen minimum of `toDmgValue(value, minValue = 1)`
/// (`src/utils/common.ts:403-405`).
const TO_DMG_VALUE_MINIMUM: i64 = 1;

/// JavaScript `Number.MAX_SAFE_INTEGER` (CR-0015 strict signed safe
/// integers): products beyond this bound lose integer precision in the
/// oracle's `Number` arithmetic.
const JS_MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Received-attack filter of a retaliation profile.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpecialDamageFilter {
    Physical,
    Special,
    Both,
}

impl SpecialDamageFilter {
    /// Whether a recorded category passes this filter.
    pub fn accepts(self, category: SpecialDamageCategory) -> bool {
        match self {
            Self::Physical => category == SpecialDamageCategory::Physical,
            Self::Special => category == SpecialDamageCategory::Special,
            Self::Both => true,
        }
    }
}

/// Closed retaliation profile resolved from the frozen move mapping.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RetaliationProfileV2 {
    pub move_id: u16,
    pub multiplier: ExactRatioV2,
    pub filter: SpecialDamageFilter,
}

/// Resolves the frozen per-move profile. Any other move id is a typed
/// rejection: there is no fallback mapping.
pub fn retaliation_profile(move_id: u16) -> Result<RetaliationProfileV2, SpecialDamageError> {
    let (multiplier, filter) = match move_id {
        MOVE_COUNTER => (
            ExactRatioV2 { numerator: 2, denominator: 1 },
            SpecialDamageFilter::Physical,
        ),
        MOVE_MIRROR_COAT => (
            ExactRatioV2 { numerator: 2, denominator: 1 },
            SpecialDamageFilter::Special,
        ),
        MOVE_METAL_BURST | MOVE_COMEUPPANCE => (
            ExactRatioV2 { numerator: 3, denominator: 2 },
            SpecialDamageFilter::Both,
        ),
        _ => return Err(SpecialDamageError::UnsupportedRetaliationMove(move_id)),
    };
    Ok(RetaliationProfileV2 { move_id, multiplier, filter })
}

/// Typed view of the live field used for target selection. Sorted ascending,
/// unique, real battler indices only.
#[derive(Clone, Copy, Debug)]
pub struct CounterFieldView<'a> {
    /// Battler indices currently active on the field.
    pub active_indices: &'a [u8],
    /// Total battler count of the format (1 for singles, more otherwise).
    pub battler_count: usize,
}

impl<'a> CounterFieldView<'a> {
    fn validate(&self) -> Result<(), SpecialDamageError> {
        if self.battler_count == 0 {
            return Err(SpecialDamageError::InvalidField(
                "battler count must be positive",
            ));
        }
        let mut previous: Option<u8> = None;
        for index in self.active_indices {
            if previous.is_some_and(|prior| *index <= prior) {
                return Err(SpecialDamageError::InvalidField(
                    "active indices must be strictly ascending",
                ));
            }
            previous = Some(*index);
        }
        Ok(())
    }

    fn is_active(&self, index: u8) -> bool {
        self.active_indices.binary_search(&index).is_ok()
    }

    /// First active index on the same flat side as `index`, ascending order.
    fn first_active_on_same_side(&self, index: u8) -> Option<u8> {
        self.active_indices
            .iter()
            .copied()
            .find(|candidate| is_ally(*candidate, index))
    }
}

fn is_ally(left: u8, right: u8) -> bool {
    (left < BATTLER_INDEX_ENEMY_BOUNDARY) == (right < BATTLER_INDEX_ENEMY_BOUNDARY)
}

/// Target-selection evidence for one retaliation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CounterTargetSelection {
    /// The recorded attacker is delivered directly.
    Direct(u8),
    /// The recorded attacker left the field and the first active battler on
    /// the attacker's side was delivered instead (multi-battle fallback).
    SideFallback { recorded_index: u8, delivered_index: u8 },
}

impl CounterTargetSelection {
    pub fn delivered_index(&self) -> u8 {
        match *self {
            Self::Direct(index) | Self::SideFallback { delivered_index: index, .. } => index,
        }
    }
    pub fn recorded_index(&self) -> u8 {
        match *self {
            Self::Direct(index) | Self::SideFallback { recorded_index: index, .. } => index,
        }
    }
}

/// Selects the retaliation target from the stored record window.
///
/// Mirrors `getCounterAttackTarget` plus the redirect application in
/// `CounterRedirectAttr.apply`: eligibility is category/source/turn only,
/// activity matters exclusively in multi-battle formats.
pub fn select_counter_target(
    state: &SpecialDamageStateV2,
    owner_index: u8,
    profile: &RetaliationProfileV2,
    turn_index: i64,
    field: &CounterFieldView<'_>,
) -> Result<(StoredDamageRecordV2, CounterTargetSelection), SpecialDamageError> {
    state.validate()?;
    field.validate()?;
    let matching: Vec<&StoredDamageRecordV2> = state
        .records
        .iter()
        .filter(|record| {
            profile.filter.accepts(record.category) && !is_ally(record.attacker_index, owner_index)
        })
        .collect();
    if matching.is_empty() {
        return Err(SpecialDamageError::NoEligibleSource);
    }
    let current_turn: Vec<&StoredDamageRecordV2> = matching
        .iter()
        .copied()
        .filter(|record| record.turn_index == turn_index)
        .collect();
    if current_turn.is_empty() {
        // Matching attacks exist but none from the requested turn window:
        // stale evidence can never drive retaliation.
        return Err(SpecialDamageError::StaleRecordsOnly);
    }
    // Receipt order: the first current-turn match wins, exactly like the
    // oracle's `attacksReceived.find`.
    let record = *current_turn[0];
    if field.battler_count <= 1 || field.is_active(record.attacker_index) {
        return Ok((record, CounterTargetSelection::Direct(record.attacker_index)));
    }
    match field.first_active_on_same_side(record.attacker_index) {
        Some(delivered_index) => Ok((
            record,
            CounterTargetSelection::SideFallback {
                recorded_index: record.attacker_index,
                delivered_index,
            },
        )),
        None => Err(SpecialDamageError::SourceDisappeared),
    }
}

/// Computes `toDmgValue(damage * multiplier)` with exact integer arithmetic.
///
/// The multiplication is checked against the JavaScript safe-integer domain
/// (CR-0015): a product beyond `2^53 - 1` would lose integer precision in the
/// oracle's `Number` arithmetic and is a typed failure, never truncation. The
/// floor comes from exact division by the ratio denominator, and the frozen
/// `toDmgValue` minimum of one applies.
pub fn compute_retaliation_amount(
    recorded_damage: SafeU53,
    multiplier: ExactRatioV2,
) -> Result<i64, SpecialDamageError> {
    if multiplier.denominator == 0 {
        return Err(SpecialDamageError::InvalidRatio);
    }
    if multiplier.numerator < 0 {
        return Err(SpecialDamageError::InvalidRatio);
    }
    let damage = i64::try_from(recorded_damage.get())
        .map_err(|_| SpecialDamageError::ArithmeticOverflow)?;
    let scaled = damage
        .checked_mul(i64::from(multiplier.numerator))
        .ok_or(SpecialDamageError::ArithmeticOverflow)?;
    if scaled > JS_MAX_SAFE_INTEGER {
        return Err(SpecialDamageError::ArithmeticOverflow);
    }
    // Both operands are non-negative, so truncating division is floor.
    let floored = scaled / i64::from(multiplier.denominator);
    Ok(floored.max(TO_DMG_VALUE_MINIMUM))
}

/// Request for [`execute_retaliation`].
#[derive(Clone, Copy, Debug)]
pub struct RetaliationRequestV2<'a> {
    pub move_id: u16,
    /// Battler index of the retaliating Pokemon.
    pub owner_index: u8,
    /// Turn index of the retaliation; only records from this turn qualify.
    pub turn_index: i64,
    pub field: CounterFieldView<'a>,
}

/// Complete output of one successful retaliation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetaliationTransitionV2 {
    pub move_id: u16,
    pub multiplier: ExactRatioV2,
    pub filter: SpecialDamageFilter,
    /// The record the retaliation consumed as its evidence.
    pub record: StoredDamageRecordV2,
    pub selection: CounterTargetSelection,
    /// Exact retaliation damage after the frozen rounding rule.
    pub retaliation_damage: i64,
}

/// Executes one counter-family retaliation over typed state.
///
/// Pure: validates inputs, computes the full evidence, and returns the
/// validated successor state together with the transition. The successor
/// equals the input because the oracle keeps `turnData.attacksReceived` until
/// the next turn boundary; clearing happens through
/// [`SpecialDamageStateV2::clear_record_window`] at that boundary. On any
/// failure the input state is returned untouched inside the error-free path —
/// no mutation is ever constructed.
pub fn execute_retaliation(
    state: &SpecialDamageStateV2,
    request: RetaliationRequestV2<'_>,
) -> Result<(SpecialDamageStateV2, RetaliationTransitionV2), SpecialDamageError> {
    let profile = retaliation_profile(request.move_id)?;
    let (record, selection) =
        select_counter_target(state, request.owner_index, &profile, request.turn_index, &request.field)?;
    let retaliation_damage = compute_retaliation_amount(record.damage, profile.multiplier)?;
    let transition = RetaliationTransitionV2 {
        move_id: profile.move_id,
        multiplier: profile.multiplier,
        filter: profile.filter,
        record,
        selection,
        retaliation_damage,
    };
    let successor = state.clone();
    successor.validate()?;
    Ok((successor, transition))
}

/// Executes a Bide-style release through the battle surface: releases the
/// stored total from the accumulator and reports the doubled retaliation
/// amount using the same frozen rounding rule as the counter moves.
///
/// Bide itself is forbidden content in Elite Redux; this transition exists
/// for the stored-damage substrate the family owns and rejects any state
/// without an open accumulator.
pub fn execute_accumulated_release(
    state: &SpecialDamageStateV2,
    multiplier: ExactRatioV2,
) -> Result<(SpecialDamageStateV2, RetaliationTransitionV2), SpecialDamageError> {
    let (successor, released) = state.release_accumulation()?;
    let retaliation_damage = compute_retaliation_amount(released, multiplier)?;
    let transition = RetaliationTransitionV2 {
        move_id: 0,
        multiplier,
        filter: SpecialDamageFilter::Both,
        record: StoredDamageRecordV2 {
            attacker_index: 0,
            category: SpecialDamageCategory::Physical,
            damage: released,
            turn_index: 0,
        },
        selection: CounterTargetSelection::Direct(0),
        retaliation_damage,
    };
    Ok((successor, transition))
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SpecialDamageError {
    #[error("move {0} carries no counter-retaliation profile in the frozen family mapping")]
    UnsupportedRetaliationMove(u16),
    #[error("no eligible received attack matches the category and source filters")]
    NoEligibleSource,
    #[error("matching received attacks exist only outside the requested turn window")]
    StaleRecordsOnly,
    #[error("recorded retaliation source disappeared with no alive replacement on its side")]
    SourceDisappeared,
    #[error("counter field view is invalid: {0}")]
    InvalidField(&'static str),
    #[error("retaliation multiplier must be positive")]
    InvalidRatio,
    #[error("retaliation arithmetic overflowed the safe-integer domain")]
    ArithmeticOverflow,
    #[error("special-damage state rejected the transition: {0}")]
    State(#[from] SpecialDamageStateError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_state::bespoke_v2::special_damage::StoredDamageRequestV2;

    const OWNER: u8 = 0;
    const ENEMY_A: u8 = 2;
    const ENEMY_B: u8 = 3;
    const TURN: i64 = 11;

    fn hit(attacker_index: u8, move_category: u8, damage: u64, turn_index: i64) -> StoredDamageRequestV2 {
        StoredDamageRequestV2 {
            attacker_index,
            move_category,
            damage,
            turn_index,
        }
    }

    fn doubles_field(active: &[u8]) -> CounterFieldView<'_> {
        CounterFieldView { active_indices: active, battler_count: 2 }
    }

    #[test]
    fn profiles_match_the_frozen_move_mapping() {
        let counter = retaliation_profile(MOVE_COUNTER).unwrap();
        assert_eq!(counter.multiplier.numerator, 2);
        assert_eq!(counter.multiplier.denominator, 1);
        assert_eq!(counter.filter, SpecialDamageFilter::Physical);

        let mirror_coat = retaliation_profile(MOVE_MIRROR_COAT).unwrap();
        assert_eq!(mirror_coat.filter, SpecialDamageFilter::Special);

        for move_id in [MOVE_METAL_BURST, MOVE_COMEUPPANCE] {
            let burst = retaliation_profile(move_id).unwrap();
            assert_eq!(burst.multiplier.numerator, 3);
            assert_eq!(burst.multiplier.denominator, 2);
            assert_eq!(burst.filter, SpecialDamageFilter::Both);
        }

        assert_eq!(
            retaliation_profile(1),
            Err(SpecialDamageError::UnsupportedRetaliationMove(1)),
        );
    }

    #[test]
    fn counter_retaliates_at_double_recorded_damage_against_the_attacker() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 100, TURN))
            .unwrap();
        let (successor, transition) = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A]),
            },
        )
        .unwrap();
        assert_eq!(transition.retaliation_damage, 200);
        assert_eq!(
            transition.selection,
            CounterTargetSelection::Direct(ENEMY_A),
        );
        assert_eq!(transition.record.damage.get(), 100);
        assert_eq!(successor, state);
    }

    #[test]
    fn mirror_coat_rejects_wrong_category_without_consuming_records_or_rng() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 100, TURN))
            .unwrap();
        let outcome = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_MIRROR_COAT,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A]),
            },
        );
        assert_eq!(outcome.unwrap_err(), SpecialDamageError::NoEligibleSource);
        assert_eq!(state.records.len(), 1);
    }

    #[test]
    fn metal_burst_rounds_down_and_enforces_the_frozen_minimum() {
        assert_eq!(
            compute_retaliation_amount(SafeU53::new(5).unwrap(), ExactRatioV2 { numerator: 3, denominator: 2 }).unwrap(),
            7,
        );
        assert_eq!(
            compute_retaliation_amount(SafeU53::new(1).unwrap(), ExactRatioV2 { numerator: 3, denominator: 2 }).unwrap(),
            TO_DMG_VALUE_MINIMUM,
        );
        assert_eq!(
            compute_retaliation_amount(SafeU53::new(0).unwrap(), ExactRatioV2 { numerator: 2, denominator: 1 }).unwrap(),
            TO_DMG_VALUE_MINIMUM,
        );
    }

    #[test]
    fn first_current_turn_match_wins_in_receipt_order() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 1, 40, TURN))
            .unwrap()
            .record_attack(hit(ENEMY_B, 0, 90, TURN))
            .unwrap();
        let (_, transition) = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_METAL_BURST,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A, ENEMY_B]),
            },
        )
        .unwrap();
        assert_eq!(transition.record.attacker_index, ENEMY_A);
        assert_eq!(transition.selection, CounterTargetSelection::Direct(ENEMY_A));
        assert_eq!(transition.retaliation_damage, 60);
    }

    #[test]
    fn stale_turn_evidence_is_rejected() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 100, TURN - 1))
            .unwrap();
        let outcome = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A]),
            },
        );
        assert_eq!(outcome.unwrap_err(), SpecialDamageError::StaleRecordsOnly);
    }

    #[test]
    fn ally_sourced_damage_is_never_eligible() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(1, 0, 100, TURN))
            .unwrap();
        let outcome = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, 1]),
            },
        );
        assert_eq!(outcome.unwrap_err(), SpecialDamageError::NoEligibleSource);
    }

    #[test]
    fn disappeared_source_falls_back_to_alive_same_side_battler_in_doubles() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 100, TURN))
            .unwrap();
        let (_, transition) = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_B]),
            },
        )
        .unwrap();
        assert_eq!(
            transition.selection,
            CounterTargetSelection::SideFallback {
                recorded_index: ENEMY_A,
                delivered_index: ENEMY_B,
            },
        );
    }

    #[test]
    fn fully_disappeared_side_fails_the_transition() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 100, TURN))
            .unwrap();
        let outcome = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER]),
            },
        );
        assert_eq!(outcome.unwrap_err(), SpecialDamageError::SourceDisappeared);
    }

    #[test]
    fn singles_skip_the_activity_check_like_the_oracle() {
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, 10, TURN))
            .unwrap();
        let (_, transition) = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: CounterFieldView { active_indices: &[OWNER], battler_count: 1 },
            },
        )
        .unwrap();
        assert_eq!(transition.selection, CounterTargetSelection::Direct(ENEMY_A));
    }

    #[test]
    fn overflow_is_a_typed_failure_that_preserves_input() {
        let huge = SafeU53::MAX;
        let state = SpecialDamageStateV2::default()
            .record_attack(hit(ENEMY_A, 0, huge.get(), TURN))
            .unwrap();
        let outcome = execute_retaliation(
            &state,
            RetaliationRequestV2 {
                move_id: MOVE_COUNTER,
                owner_index: OWNER,
                turn_index: TURN,
                field: doubles_field(&[OWNER, ENEMY_A]),
            },
        );
        assert_eq!(outcome.unwrap_err(), SpecialDamageError::ArithmeticOverflow);
        assert_eq!(state.records.len(), 1);
    }

    #[test]
    fn accumulated_release_uses_the_same_frozen_rounding_rule() {
        let opened = SpecialDamageStateV2::default().begin_accumulation(TURN).unwrap();
        let hit_one = opened.record_attack(hit(ENEMY_A, 0, 30, TURN)).unwrap();
        let closed = hit_one.close_accumulation_turn().unwrap();
        let reopened = closed.open_next_accumulation_turn(TURN + 1).unwrap();
        let hit_two = reopened
            .record_attack(hit(ENEMY_B, 1, 25, TURN + 1))
            .unwrap();
        let (successor, transition) =
            execute_accumulated_release(&hit_two, ExactRatioV2 { numerator: 2, denominator: 1 })
                .unwrap();
        assert_eq!(transition.retaliation_damage, 110);
        assert!(!successor.accumulating);
        assert_eq!(successor.accumulated_damage.get(), 0);
        assert_eq!(
            execute_accumulated_release(&successor, ExactRatioV2 { numerator: 2, denominator: 1 })
                .unwrap_err(),
            SpecialDamageError::State(SpecialDamageStateError::NotAccumulating),
        );
    }

    #[test]
    fn reset_clears_every_family_state_surface() {
        let opened = SpecialDamageStateV2::default().begin_accumulation(TURN).unwrap();
        let hit_one = opened.record_attack(hit(ENEMY_A, 0, 30, TURN)).unwrap();
        let cleared = hit_one.clear_record_window();
        assert!(cleared.records.is_empty());
        assert_eq!(cleared.reset(), SpecialDamageStateV2::default());
    }
}
