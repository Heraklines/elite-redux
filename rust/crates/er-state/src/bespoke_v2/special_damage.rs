//! Canonical typed state for the `SPECIAL_DAMAGE_COUNTER` bespoke family.
//!
//! Stores the frozen per-turn received-attack records that the counter-like
//! retaliation surface (`Counter` 68, `Mirror Coat` 243, `Metal Burst` 368,
//! `Comeuppance` 894) reads, plus the Bide-style multi-turn stored-damage
//! accumulator. Oracle evidence: `src/data/moves/move.ts:2319-2413`
//! (`CounterDamageAttr`, `CounterRedirectAttr`),
//! `src/data/moves/move-utils.ts:249-263` (`getCounterAttackTarget`), and
//! `src/utils/common.ts:403-405` (`toDmgValue`). The TypeScript oracle clears
//! `turnData.attacksReceived` every turn, so the record window is per-turn;
//! Bide-style accumulation deliberately survives turn boundaries until it is
//! released or reset. (Bide itself is forbidden content in Elite Redux,
//! `src/data/balance/moves/forbidden-moves.ts:68`; the accumulator exists as
//! the family's stored-damage substrate only.)
//!
//! Every transition is pure: it validates the request, clones the state,
//! validates the result, and returns it. On error the input state is never
//! observed mutated because no mutation is ever constructed.

use er_types::SafeU53;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Frozen capacity of the received-attack record window.
///
/// Doubles exposes at most three attackers per side; triples six. Eight
/// leaves headroom without admitting unbounded growth.
pub const SPECIAL_DAMAGE_RECORDS_MAX: usize = 8;

/// Damage category of a recorded attack. Status moves are never eligible and
/// therefore have no variant here; recording one is a typed rejection.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpecialDamageCategory {
    Physical,
    Special,
}

impl SpecialDamageCategory {
    /// Maps the frozen `MoveCategory` numeric order
    /// (`PHYSICAL = 0`, `SPECIAL = 1`, `STATUS = 2`) onto an eligible
    /// category. `STATUS` is not storable and yields [`SpecialDamageStateError::StatusCategoryIneligible`].
    pub fn from_move_category(move_category: u8) -> Result<Self, SpecialDamageStateError> {
        match move_category {
            0 => Ok(Self::Physical),
            1 => Ok(Self::Special),
            _ => Err(SpecialDamageStateError::StatusCategoryIneligible),
        }
    }
}

/// One received damaging attack in receipt order.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredDamageRecordV2 {
    /// Battler index of the attacker. Real indices only; the TypeScript
    /// `ATTACKER = -1` sentinel never appears in canonical state.
    pub attacker_index: u8,
    pub category: SpecialDamageCategory,
    /// Exact damage dealt by the attack, positive.
    pub damage: SafeU53,
    /// Turn index on which the attack was received.
    pub turn_index: i64,
}

impl StoredDamageRecordV2 {
    /// Validates one record in isolation.
    pub fn validate(&self) -> Result<(), SpecialDamageStateError> {
        if self.damage.get() == 0 {
            return Err(SpecialDamageStateError::ZeroRecordDamage);
        }
        Ok(())
    }
}

/// Typed request for [`SpecialDamageStateV2::record_attack`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StoredDamageRequestV2 {
    pub attacker_index: u8,
    /// Frozen `MoveCategory` numeric value (`0` physical, `1` special).
    pub move_category: u8,
    pub damage: u64,
    pub turn_index: i64,
}

/// Canonical special-damage family state for one battler scope.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecialDamageStateV2 {
    /// Received attacks of the current turn window, strictly in receipt
    /// order with non-decreasing turn indices.
    pub records: Vec<StoredDamageRecordV2>,
    /// Bide-style stored total that survives turn boundaries.
    pub accumulated_damage: SafeU53,
    /// Whether the Bide-style accumulator is accepting damage.
    pub accumulating: bool,
    /// Completed accumulation turns while [`Self::accumulating`] holds.
    pub accumulation_turns: u16,
    /// Turn index of the currently open accumulation turn, when one is open.
    pub open_accumulation_turn: Option<i64>,
}

impl SpecialDamageStateV2 {
    /// Validates the whole state against the family invariants.
    pub fn validate(&self) -> Result<(), SpecialDamageStateError> {
        let mut previous_turn: Option<i64> = None;
        for record in &self.records {
            record.validate()?;
            if previous_turn.is_some_and(|turn| record.turn_index < turn) {
                return Err(SpecialDamageStateError::RecordsOutOfOrder);
            }
            previous_turn = Some(record.turn_index);
        }
        if !self.accumulating && self.accumulation_turns != 0 {
            return Err(SpecialDamageStateError::TurnsWithoutAccumulation);
        }
        Ok(())
    }

    /// Records one received damaging attack. Rejects status-category damage,
    /// zero damage, a full record window, and non-monotonic turn indices.
    pub fn record_attack(
        &self,
        request: StoredDamageRequestV2,
    ) -> Result<Self, SpecialDamageStateError> {
        let category = SpecialDamageCategory::from_move_category(request.move_category)?;
        let damage = SafeU53::new(request.damage)
            .map_err(|_| SpecialDamageStateError::DamageAboveSafeInteger)?;
        let record = StoredDamageRecordV2 {
            attacker_index: request.attacker_index,
            category,
            damage,
            turn_index: request.turn_index,
        };
        record.validate()?;
        if self.records.len() >= SPECIAL_DAMAGE_RECORDS_MAX {
            return Err(SpecialDamageStateError::RecordWindowFull);
        }
        if self
            .records
            .last()
            .is_some_and(|last| record.turn_index < last.turn_index)
        {
            return Err(SpecialDamageStateError::RecordsOutOfOrder);
        }
        if self.accumulating && record.turn_index != self.current_accumulation_turn() {
            // Accumulating states only accept damage inside their open turn.
            return Err(SpecialDamageStateError::StaleAccumulationTurn);
        }
        let mut next = self.clone();
        next.records.push(record);
        if self.accumulating {
            let sum = self
                .accumulated_damage
                .get()
                .checked_add(record.damage.get())
                .ok_or(SpecialDamageStateError::AccumulatorOverflow)?;
            next.accumulated_damage =
                SafeU53::new(sum).map_err(|_| SpecialDamageStateError::AccumulatorOverflow)?;
        }
        next.validate()?;
        Ok(next)
    }

    /// Clears the per-turn record window exactly like the oracle's turn-data
    /// reset. The Bide-style accumulator is untouched.
    pub fn clear_record_window(&self) -> Self {
        let mut next = self.clone();
        next.records.clear();
        next
    }

    /// Opens the Bide-style accumulator. Fails when already open so a double
    /// activation can never silently merge two windows.
    pub fn begin_accumulation(&self, turn_index: i64) -> Result<Self, SpecialDamageStateError> {
        if self.accumulating {
            return Err(SpecialDamageStateError::AccumulationAlreadyOpen);
        }
        let mut next = self.clone();
        next.accumulating = true;
        next.accumulated_damage = SafeU53::ZERO;
        next.accumulation_turns = 0;
        next.open_accumulation_turn = Some(turn_index);
        next.validate()?;
        Ok(next)
    }

    /// Closes the open accumulation turn and returns the updated state.
    pub fn close_accumulation_turn(&self) -> Result<Self, SpecialDamageStateError> {
        if !self.accumulating {
            return Err(SpecialDamageStateError::NotAccumulating);
        }
        let turns = self
            .accumulation_turns
            .checked_add(1)
            .ok_or(SpecialDamageStateError::AccumulatorOverflow)?;
        let mut next = self.clone();
        next.accumulation_turns = turns;
        next.open_accumulation_turn = None;
        next.validate()?;
        Ok(next)
    }

    /// Opens the next accumulation turn after a closed one. Fails when the
    /// accumulator is closed or a turn is still open.
    pub fn open_next_accumulation_turn(
        &self,
        turn_index: i64,
    ) -> Result<Self, SpecialDamageStateError> {
        if !self.accumulating {
            return Err(SpecialDamageStateError::NotAccumulating);
        }
        if self.open_accumulation_turn.is_some() {
            return Err(SpecialDamageStateError::AccumulationTurnStillOpen);
        }
        let mut next = self.clone();
        next.open_accumulation_turn = Some(turn_index);
        next.validate()?;
        Ok(next)
    }

    /// Releases the stored total for retaliation and closes the accumulator.
    /// Returns the exact stored amount together with the successor state.
    pub fn release_accumulation(&self) -> Result<(Self, SafeU53), SpecialDamageStateError> {
        if !self.accumulating {
            return Err(SpecialDamageStateError::NotAccumulating);
        }
        let mut next = self.clone();
        let released = next.accumulated_damage;
        next.accumulated_damage = SafeU53::ZERO;
        next.accumulating = false;
        next.accumulation_turns = 0;
        next.open_accumulation_turn = None;
        next.validate()?;
        Ok((next, released))
    }

    /// Full reset to the empty state (records, accumulator, flag, turns).
    pub fn reset(&self) -> Self {
        Self::default()
    }

    fn current_accumulation_turn(&self) -> i64 {
        self.open_accumulation_turn.unwrap_or(i64::MIN)
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SpecialDamageStateError {
    #[error("status-category damage is not eligible for special-damage storage")]
    StatusCategoryIneligible,
    #[error("stored damage must be positive")]
    ZeroRecordDamage,
    #[error("an accumulation turn is still open")]
    AccumulationTurnStillOpen,
    #[error("recorded damage exceeds the safe-integer bound")]
    DamageAboveSafeInteger,
    #[error("received-attack record window is full")]
    RecordWindowFull,
    #[error("received-attack records must keep non-decreasing turn order")]
    RecordsOutOfOrder,
    #[error("accumulating state rejected damage from outside its open accumulation turn")]
    StaleAccumulationTurn,
    #[error("Bide-style accumulation is not open")]
    NotAccumulating,
    #[error("Bide-style accumulation is already open")]
    AccumulationAlreadyOpen,
    #[error("Bide-style accumulator overflowed the safe-integer bound")]
    AccumulatorOverflow,
    #[error("closed accumulation cannot carry completed turns")]
    TurnsWithoutAccumulation,
}

#[cfg(test)]
mod tests {
    use super::*;

    const TURN: i64 = 7;

    fn request(damage: u64, category: u8) -> StoredDamageRequestV2 {
        StoredDamageRequestV2 {
            attacker_index: 2,
            move_category: category,
            damage,
            turn_index: TURN,
        }
    }

    #[test]
    fn records_eligible_attacks_in_receipt_order() {
        let base = SpecialDamageStateV2::default();
        let after_physical = base.record_attack(request(120, 0)).unwrap();
        let after_special = after_physical.record_attack(request(40, 1)).unwrap();
        assert_eq!(after_special.records.len(), 2);
        assert_eq!(
            after_special.records[0].category,
            SpecialDamageCategory::Physical
        );
        assert_eq!(
            after_special.records[1].category,
            SpecialDamageCategory::Special
        );
        assert_eq!(after_special.records[0].damage, SafeU53::new(120).unwrap(),);
    }

    #[test]
    fn rejects_status_category_zero_damage_and_stale_order_without_mutating_input() {
        let base = SpecialDamageStateV2::default();
        assert_eq!(
            base.record_attack(request(10, 2)),
            Err(SpecialDamageStateError::StatusCategoryIneligible),
        );
        assert_eq!(
            base.record_attack(request(0, 0)),
            Err(SpecialDamageStateError::ZeroRecordDamage),
        );
        let seeded = base.record_attack(request(10, 0)).unwrap();
        let stale = StoredDamageRequestV2 {
            turn_index: 6,
            ..request(10, 1)
        };
        assert_eq!(
            seeded.record_attack(stale),
            Err(SpecialDamageStateError::RecordsOutOfOrder),
        );
        assert_eq!(seeded.records.len(), 1);
    }

    #[test]
    fn rejects_full_record_window() {
        let mut state = SpecialDamageStateV2::default();
        for ordinal in 0..SPECIAL_DAMAGE_RECORDS_MAX as i64 {
            let filled = state
                .record_attack(StoredDamageRequestV2 {
                    attacker_index: 2,
                    move_category: 0,
                    damage: 1,
                    turn_index: TURN + ordinal,
                })
                .unwrap();
            state = filled;
        }
        assert_eq!(
            state.record_attack(request(1, 0)),
            Err(SpecialDamageStateError::RecordWindowFull),
        );
    }

    #[test]
    fn accumulates_and_releases_bide_style_totals_exactly() {
        let opened = SpecialDamageStateV2::default()
            .begin_accumulation(TURN)
            .unwrap();
        let first_hit = opened.record_attack(request(100, 0)).unwrap();
        let closed_first = first_hit.close_accumulation_turn().unwrap();
        let reopened = closed_first.open_next_accumulation_turn(TURN + 1).unwrap();
        let second_turn = StoredDamageRequestV2 {
            turn_index: TURN + 1,
            ..request(30, 1)
        };
        let second_hit = reopened.record_attack(second_turn).unwrap();
        let (released_state, released) = second_hit.release_accumulation().unwrap();
        assert_eq!(released, SafeU53::new(130).unwrap());
        assert!(!released_state.accumulating);
        assert_eq!(released_state.accumulated_damage, SafeU53::ZERO);

        assert_eq!(
            SpecialDamageStateV2::default().release_accumulation(),
            Err(SpecialDamageStateError::NotAccumulating),
        );
        assert_eq!(
            opened.begin_accumulation(TURN),
            Err(SpecialDamageStateError::AccumulationAlreadyOpen),
        );
    }

    #[test]
    fn clear_window_keeps_accumulator_and_reset_clears_everything() {
        let opened = SpecialDamageStateV2::default()
            .begin_accumulation(TURN)
            .unwrap();
        let hit = opened.record_attack(request(55, 1)).unwrap();
        let cleared = hit.clear_record_window();
        assert!(cleared.records.is_empty());
        assert_eq!(cleared.accumulated_damage, SafeU53::new(55).unwrap());
        assert!(cleared.accumulating);
        assert_eq!(cleared.reset(), SpecialDamageStateV2::default());
    }
}
