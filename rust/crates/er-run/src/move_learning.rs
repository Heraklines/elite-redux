//! Owned move-learning task transitions for the selected M4 slice.
//!
//! Contract: `rust/contracts/m4-progression.md` and the frozen option
//! identities in `rust/contracts/m4-game-control.md`
//! (`learn/candidate/{moveId}`, `learn/replace/{pokemonId}/{moveSlot}`,
//! `learn/undo`, `learn/cancel`). Decisions are menu-independent; the caller
//! owns menus and raw input.

use er_types::battle_ids::MoveId;
use er_types::battle_model::MoveSlotState;

/// The number of move slots admitted by the frozen battle model.
pub const MOVE_SLOT_COUNT: usize = 4;

/// One atomic move-learning resolution over a four-slot moveset.
///
/// The moveset is passed and returned as plain slot data so the function stays
/// total, pure, and independently testable against the published fixture
/// (`moves [1,52,77,78]` with candidate `34` replacing slot 0 produces
/// `[34,52,77,78]`).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LearnMoveOutcome {
    /// The moveset after the decision, in canonical slot order.
    pub moves: [Option<MoveSlotState>; MOVE_SLOT_COUNT],
    /// The candidate that was applied or declined.
    pub candidate: MoveId,
}

/// Applies one batch-surface decision to a moveset.
///
/// - [`er_types::run_model::LearnMoveDecision::Candidate`] records the offered
///   move as pending (the surface shows replacement choices). It does not
///   mutate the moveset.
/// - `Replace { slot }` writes the candidate into the chosen slot. The slot
///   index is bounds-checked; PP state resets for the learned move.
/// - `Undo` restores the previous moveset snapshot taken at Candidate time.
/// - `Cancel` declines the candidate and leaves the moveset unchanged.
///
/// `pending_snapshot` is the exact moveset captured when the candidate was
/// first recorded; `Undo` requires it.
pub fn apply_learn_move_decision(
    current: &[Option<MoveSlotState>; MOVE_SLOT_COUNT],
    pending_snapshot: &[Option<MoveSlotState>; MOVE_SLOT_COUNT],
    candidate: MoveId,
    decision: &er_types::run_model::LearnMoveDecision,
) -> Result<LearnMoveOutcome, ProgressionError> {
    use er_types::run_model::LearnMoveDecision as Decision;
    match decision {
        Decision::Candidate { .. } => Ok(LearnMoveOutcome {
            moves: *current,
            candidate,
        }),
        Decision::Replace { slot } => {
            let index = usize::from(slot.get());
            if index >= MOVE_SLOT_COUNT {
                return Err(ProgressionError::UnknownReplacementSlot);
            }
            let mut moves = *current;
            moves[index] = Some(MoveSlotState {
                move_id: candidate,
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            });
            Ok(LearnMoveOutcome {
                moves,
                candidate,
            })
        }
        Decision::Undo => Ok(LearnMoveOutcome {
            moves: *pending_snapshot,
            candidate,
        }),
        Decision::Cancel => Ok(LearnMoveOutcome {
            moves: *current,
            candidate,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::SafeU53;
    use er_types::run_model::LearnMoveDecision;
    use er_types::battle_ids::MoveSlotIndex;

    fn move_id(value: u64) -> MoveId {
        MoveId::new(SafeU53::new(value).expect("safe move"))
    }

    fn slot(value: u64) -> Option<MoveSlotState> {
        Some(MoveSlotState {
            move_id: move_id(value),
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        })
    }

    fn initial_moveset() -> [Option<MoveSlotState>; MOVE_SLOT_COUNT] {
        [slot(1), slot(52), slot(77), slot(78)]
    }

    #[test]
    fn replace_slot_zero_matches_the_published_parity_vector() {
        let outcome = apply_learn_move_decision(
            &initial_moveset(),
            &initial_moveset(),
            move_id(34),
            &LearnMoveDecision::Replace {
                slot: MoveSlotIndex::ZERO,
            },
        )
        .expect("replace");
        let ids: Vec<u64> = outcome
            .moves
            .iter()
            .map(|entry| entry.expect("filled").move_id.get().get())
            .collect();
        assert_eq!(ids, vec![34, 52, 77, 78]);
        // The learned move starts with fresh PP.
        assert_eq!(outcome.moves[0].expect("slot").pp_used, 0);
    }

    #[test]
    fn candidate_records_without_mutating_the_moveset() {
        let outcome = apply_learn_move_decision(
            &initial_moveset(),
            &initial_moveset(),
            move_id(34),
            &LearnMoveDecision::Candidate { move_id: move_id(34) },
        )
        .expect("candidate");
        assert_eq!(outcome.moves, initial_moveset());
        assert_eq!(outcome.candidate.get().get(), 34);
    }

    #[test]
    fn undo_restores_the_pending_snapshot_exactly() {
        let mut replaced = initial_moveset();
        replaced[0] = slot(34);
        let outcome = apply_learn_move_decision(
            &replaced,
            &initial_moveset(),
            move_id(34),
            &LearnMoveDecision::Undo,
        )
        .expect("undo");
        assert_eq!(outcome.moves, initial_moveset());
    }

    #[test]
    fn cancel_declines_and_keeps_current_state() {
        let outcome = apply_learn_move_decision(
            &initial_moveset(),
            &initial_moveset(),
            move_id(34),
            &LearnMoveDecision::Cancel,
        )
        .expect("cancel");
        assert_eq!(outcome.moves, initial_moveset());
    }
}
