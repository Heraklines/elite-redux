//! Canonical charge/recharge/action-lock state for the M6 bespoke
//! `CHARGE_RECHARGE_LOCK` family.
//!
//! The canonical store holds at most one coherent action lock. A lock binds a
//! single actor to a single locked move for a strictly positive number of
//! turns, either as a two-turn charge (`ActionLockStage::Charging`) or as the
//! mandatory post-move recharge skip (`ActionLockStage::Recharging`). Every
//! release is explicit: the battle-side transitions in
//! `er-battle::m6::bespoke::action_lock` are the only writers, and no path
//! unlocks implicitly or bypasses the locked identity through a semantic
//! command shortcut.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_types::BehaviorUnitId;
use er_types::MechanicScope;
use er_types::battle_ids::MoveId;

/// Which half of the charge/recharge contract the lock enforces.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActionLockStage {
    /// Two-turn move charge: the actor must continue the locked move.
    Charging,
    /// Post-move recharge: the actor must skip its next action entirely.
    Recharging,
}

/// The single canonical action lock.
///
/// One instance describes the whole lock: its stage, the bound actor, the
/// locked move identity, the behavior-unit provenance that acquired it, and
/// the positive number of turns it still spans.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionLockStateV2 {
    pub stage: ActionLockStage,
    /// Battler bound by the lock. Always a `Pokemon` scope.
    pub owner: MechanicScope,
    /// The only move identity a charge lock may continue.
    pub locked_move_id: MoveId,
    /// Frozen catalog identity of the behavior unit that acquired the lock.
    pub source_behavior_unit: BehaviorUnitId,
    /// Turns the lock still spans. Strictly positive.
    pub remaining_turns: u16,
}

impl ActionLockStateV2 {
    /// Validates the canonical lock invariants: a battler-scoped owner, a
    /// positive locked move identity, a positive duration, and a valid
    /// behavior-unit provenance.
    pub fn validate(&self) -> Result<(), ActionLockStateError> {
        if !matches!(self.owner, MechanicScope::Pokemon { .. }) {
            return Err(ActionLockStateError::OwnerNotAPokemonScope);
        }
        if self.locked_move_id == MoveId::ZERO {
            return Err(ActionLockStateError::ZeroLockedMoveId);
        }
        if self.remaining_turns == 0 {
            return Err(ActionLockStateError::ZeroRemainingTurns);
        }
        self.source_behavior_unit
            .validate()
            .map_err(|_| ActionLockStateError::InvalidBehaviorUnit)?;
        Ok(())
    }
}

/// Canonical action-lock invariant violations.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ActionLockStateError {
    #[error("action lock owner must be a Pokemon scope")]
    OwnerNotAPokemonScope,
    #[error("action lock must bind a positive move identity")]
    ZeroLockedMoveId,
    #[error("action lock duration must be positive")]
    ZeroRemainingTurns,
    #[error("action lock behavior-unit identity is invalid")]
    InvalidBehaviorUnit,
}
