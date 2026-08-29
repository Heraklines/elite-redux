//! Closed game-owner snapshot DTOs for deterministic battle continuation.
//!
//! Validation is only a precondition for the live owner bridge.  DTO
//! round-trips alone do not satisfy M3C-11; restoration must preserve the
//! private runtime history and continue the same battle effects.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_content::pack::ContentPack;
use er_state::snapshot::GameState;
use er_types::SeatId;
use er_types::battle_command::{
    CommandFingerprintEntry, ReplacementProposalFingerprintEntry, ScriptedEnemyPolicyV1,
};
use er_types::battle_control::{
    BattleControl, BattleControlPlan, MAX_CANCEL_HISTORY_DEPTH, SeatMenuInstanceAllocator,
};
use er_types::battle_model::BattleOutcome;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::runtime::{GameRuntime, GameRuntimeError};

/// Integration seam for the private `GameRuntime` owner.
///
/// The implementation belongs beside `GameRuntime` because only that module
/// can read and restore `menu_history`, `authority_remote_paths`, and
/// `pending_no_legal_replacement`.  An implementation must construct a new
/// runtime, validate it completely, and return no partially-mutated owner on
/// error.  The public DTO remains closed; this trait is the fail-atomic bridge
/// rather than a second wire format.
pub trait GameRuntimeSnapshotBridge: Sized {
    fn snapshot_v2(&self) -> Result<GameRuntimeSnapshotV2, SnapshotError>;

    fn from_snapshot_v2(
        snapshot: GameRuntimeSnapshotV2,
        local_seat: SeatId,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError>;
}

/// Validate a bridge-produced game snapshot before it can be exposed as a
/// restorable value.
pub fn snapshot_game_runtime<B: GameRuntimeSnapshotBridge>(
    runtime: &B,
) -> Result<GameRuntimeSnapshotV2, SnapshotError> {
    let snapshot = runtime.snapshot_v2()?;
    snapshot.validate()?;
    Ok(snapshot)
}

/// Validate content identity before delegating to the owner-specific,
/// history-preserving constructor.  The owner implementation must not mutate
/// an existing runtime while performing this operation.
pub fn restore_game_runtime<B: GameRuntimeSnapshotBridge>(
    snapshot: GameRuntimeSnapshotV2,
    local_seat: SeatId,
    content: Arc<ContentPack>,
) -> Result<B, SnapshotError> {
    snapshot.validate()?;
    if snapshot.state.content_hash != content.hash {
        return Err(invalid(
            "state.content_hash",
            "snapshot content identity differs from supplied ContentPack",
        ));
    }
    B::from_snapshot_v2(snapshot, local_seat, content)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SeatControlHistorySnapshotV1 {
    pub seat: SeatId,
    pub controls: Vec<BattleControl>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandAdmissionLedgerSnapshotV1 {
    pub command_tombstones: Vec<CommandFingerprintEntry>,
    pub replacement_tombstones: Vec<ReplacementProposalFingerprintEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameRuntimeSnapshotV2 {
    pub state: GameState,
    pub current_control: BattleControlPlan,
    pub control_history: Vec<SeatControlHistorySnapshotV1>,
    pub command_admission: CommandAdmissionLedgerSnapshotV1,
    pub scripted_enemy_policy: ScriptedEnemyPolicyV1,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
    pub completed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SnapshotError {
    #[error("snapshot field {path} is invalid: {reason}")]
    Invalid { path: String, reason: String },
    #[error("game runtime restoration failed: {reason}")]
    Restoration { reason: String },
}

fn invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn strictly_sorted<T: Ord>(values: &[T], path: &str) -> Result<(), SnapshotError> {
    if values.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(invalid(
            path,
            "entries must be strictly increasing and duplicate-free",
        ));
    }
    Ok(())
}

impl CommandAdmissionLedgerSnapshotV1 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        strictly_sorted(
            &self
                .command_tombstones
                .iter()
                .map(|entry| entry.operation_id.clone())
                .collect::<Vec<_>>(),
            "command_admission.command_tombstones",
        )?;
        strictly_sorted(
            &self
                .replacement_tombstones
                .iter()
                .map(|entry| entry.operation_id.clone())
                .collect::<Vec<_>>(),
            "command_admission.replacement_tombstones",
        )?;
        for entry in &self.command_tombstones {
            entry.validate().map_err(|error| {
                invalid("command_admission.command_tombstones", error.to_string())
            })?;
        }
        for entry in &self.replacement_tombstones {
            entry.validate().map_err(|error| {
                invalid(
                    "command_admission.replacement_tombstones",
                    error.to_string(),
                )
            })?;
        }
        Ok(())
    }
}

impl SeatControlHistorySnapshotV1 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.controls.is_empty() {
            return Err(invalid(
                "control_history.controls",
                "a retained control history must contain at least one control",
            ));
        }
        if self.controls.len() > MAX_CANCEL_HISTORY_DEPTH + 1 {
            return Err(invalid(
                "control_history.controls",
                "control history exceeds the bounded Cancel restoration depth",
            ));
        }
        for control in &self.controls {
            control
                .validate()
                .map_err(|error| invalid("control_history.controls", error.to_string()))?;
        }
        if self
            .controls
            .iter()
            .any(|control| control.owner_seat().is_some_and(|owner| owner != self.seat))
        {
            return Err(invalid(
                "control_history.controls",
                "actionable history controls must belong to their history seat",
            ));
        }
        Ok(())
    }
}

/// Keep exactly the bounded control evidence that both live runtime history
/// and public snapshots are allowed to retain.
pub(crate) fn bounded_control_history(
    seat: SeatId,
    historical: Vec<BattleControl>,
    current: &BattleControl,
    remote_anchors: &[BattleControl],
) -> Result<Vec<BattleControl>, SnapshotError> {
    if !historical.is_empty() && historical.last() != Some(current) {
        return Err(invalid(
            format!("control_history[{seat}].controls"),
            "causal history does not end at the current control",
        ));
    }
    for anchor in remote_anchors {
        if anchor.owner_seat().is_some_and(|owner| owner != seat) {
            return Err(invalid(
                format!("control_history[{seat}].controls"),
                "a remote replay anchor belongs to a different seat",
            ));
        }
    }

    let ancestry = cancel_restorable_ancestry(current)?;
    let mut retained = Vec::new();
    for control in &historical {
        if remote_anchors.iter().any(|anchor| anchor == control)
            && !ancestry.iter().any(|ancestor| ancestor == control)
            && !retained.iter().any(|previous| previous == control)
        {
            retained.push(control.clone());
        }
    }
    for anchor in remote_anchors {
        if !ancestry.iter().any(|ancestor| ancestor == anchor)
            && !retained.iter().any(|previous| previous == anchor)
        {
            retained.push(anchor.clone());
        }
    }
    retained.extend(ancestry);
    if retained.len() > MAX_CANCEL_HISTORY_DEPTH + 1 {
        return Err(invalid(
            format!("control_history[{seat}].controls"),
            "the Cancel-restorable ancestry and live remote replay anchors exceed the bounded depth",
        ));
    }
    Ok(retained)
}

fn cancel_restorable_ancestry(
    current: &BattleControl,
) -> Result<Vec<BattleControl>, SnapshotError> {
    let mut reversed = vec![current.clone()];
    let mut cursor = current;
    while let Some(parent) = cancel_parent(cursor) {
        reversed.push(parent.clone());
        if reversed.len() > MAX_CANCEL_HISTORY_DEPTH + 1 {
            return Err(invalid(
                "control_history.controls",
                "the current Cancel-restorable ancestry exceeds the bounded depth",
            ));
        }
        cursor = parent;
    }
    reversed.reverse();
    Ok(reversed)
}

fn cancel_parent(control: &BattleControl) -> Option<&BattleControl> {
    match control {
        BattleControl::MoveSelect(value) => Some(value.cancel_to.as_ref()),
        BattleControl::TargetSelect(value) => Some(value.cancel_to.as_ref()),
        BattleControl::PartySelect(value) => Some(value.cancel_to.as_ref()),
        BattleControl::PartyOptionSelect(value) => Some(value.cancel_to.as_ref()),
        BattleControl::CommandRoot(_)
        | BattleControl::ReplacementSelect(_)
        | BattleControl::Waiting(_)
        | BattleControl::Complete(_) => None,
    }
}

impl GameRuntimeSnapshotV2 {
    /// Validate every game-owned invariant without mutating a runtime.
    pub fn validate(&self) -> Result<(), SnapshotError> {
        self.state
            .validate()
            .map_err(|error| invalid("state", error.to_string()))?;
        self.current_control
            .validate()
            .map_err(|error| invalid("current_control", error.to_string()))?;
        let battle =
            self.state.battle.as_ref().ok_or_else(|| {
                invalid("state.battle", "M3 game snapshots require an active battle")
            })?;
        if self.current_control.battle_id != battle.battle_id
            || self.current_control.wave != battle.wave
        {
            return Err(invalid(
                "current_control",
                "control plan coordinates must equal the canonical battle",
            ));
        }
        let human_seats = er_state::format::human_seats(&battle.format)
            .map_err(|error| invalid("state.battle.format", error.to_string()))?;
        if self.current_control.seats.len() != human_seats.len()
            || self
                .current_control
                .seats
                .iter()
                .zip(&human_seats)
                .any(|(actual, expected)| actual.seat != *expected)
        {
            return Err(invalid(
                "current_control.seats",
                "control plan must cover the canonical human seats in order",
            ));
        }
        self.scripted_enemy_policy
            .validate()
            .map_err(|error| invalid("scripted_enemy_policy", error.to_string()))?;
        self.command_admission.validate()?;
        strictly_sorted(
            &self
                .control_history
                .iter()
                .map(|entry| entry.seat)
                .collect::<Vec<_>>(),
            "control_history",
        )?;
        for entry in &self.control_history {
            entry.validate()?;
            let current = self
                .current_control
                .seat(entry.seat)
                .ok_or_else(|| invalid("control_history", "history seat has no current control"))?;
            if entry.controls.last() != Some(&current.control) {
                return Err(invalid(
                    "control_history.controls",
                    "history must end at the current control for that seat",
                ));
            }
        }
        strictly_sorted(
            &self
                .menu_allocators
                .iter()
                .map(|entry| entry.seat)
                .collect::<Vec<_>>(),
            "menu_allocators",
        )?;
        for allocator in &self.menu_allocators {
            allocator
                .validate()
                .map_err(|error| invalid("menu_allocators", error.to_string()))?;
        }
        if self.menu_allocators != self.current_control.menu_allocators {
            return Err(invalid(
                "menu_allocators",
                "allocator vector must equal current_control.menu_allocators",
            ));
        }
        let completed_from_state = self
            .state
            .battle
            .as_ref()
            .is_some_and(|battle| battle.outcome != BattleOutcome::Ongoing);
        if self.completed != completed_from_state {
            return Err(invalid(
                "completed",
                "completion flag must equal the canonical battle outcome",
            ));
        }
        let mut operation_ids = self
            .command_admission
            .command_tombstones
            .iter()
            .map(|entry| entry.operation_id.clone())
            .collect::<Vec<_>>();
        operation_ids.extend(
            self.command_admission
                .replacement_tombstones
                .iter()
                .map(|entry| entry.operation_id.clone()),
        );
        operation_ids.sort_unstable();
        if operation_ids.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(invalid(
                "command_admission",
                "command and replacement tombstones must not share an operation identity",
            ));
        }
        Ok(())
    }

    /// Project the currently public portion of a game runtime into its V2
    /// owner snapshot.  The existing runtime exposes transition history as
    /// `MenuHistoryEntry { from, to }`; contiguous transitions are folded into
    /// one causal control stack per seat without duplicating shared endpoints.
    /// Only the current Cancel ancestry and live remote replay anchors cross
    /// the snapshot boundary; older menu transitions are not restorable state.
    pub fn from_runtime(runtime: &GameRuntime) -> Result<Self, SnapshotError> {
        let mut history = BTreeMap::<SeatId, Vec<BattleControl>>::new();
        for entry in runtime.menu_history() {
            let controls = history.entry(entry.seat).or_default();
            if let Some(previous) = controls.last() {
                if previous != &entry.from {
                    return Err(invalid(
                        "control_history.controls",
                        "runtime menu transitions are not contiguous for one seat",
                    ));
                }
            } else {
                controls.push(entry.from.clone());
            }
            controls.push(entry.to.clone());
        }
        let remote_anchors = runtime.restorable_remote_control_anchors();
        for seat in remote_anchors.keys() {
            history.entry(*seat).or_default();
        }
        let control_history = history
            .into_iter()
            .map(|(seat, historical)| {
                let current = runtime.control().seat(seat).ok_or_else(|| {
                    invalid(
                        "control_history",
                        "history seat has no current control entry",
                    )
                })?;
                let anchors = remote_anchors.get(&seat).map(Vec::as_slice).unwrap_or(&[]);
                let controls =
                    bounded_control_history(seat, historical, &current.control, anchors)?;
                Ok(SeatControlHistorySnapshotV1 { seat, controls })
            })
            .collect::<Result<Vec<_>, SnapshotError>>()?;
        let mut command_tombstones = runtime.command_fingerprints().to_vec();
        command_tombstones.sort_by_key(|entry| entry.operation_id.clone());
        let mut replacement_tombstones = runtime.replacement_fingerprints().to_vec();
        replacement_tombstones.sort_by_key(|entry| entry.operation_id.clone());
        let snapshot = Self {
            state: runtime.state().clone(),
            current_control: runtime.control().clone(),
            control_history,
            command_admission: CommandAdmissionLedgerSnapshotV1 {
                command_tombstones,
                replacement_tombstones,
            },
            scripted_enemy_policy: runtime.scripted_enemy_policy().clone(),
            menu_allocators: runtime.control().menu_allocators.clone(),
            completed: runtime
                .state()
                .battle
                .as_ref()
                .is_some_and(|battle| battle.outcome != BattleOutcome::Ongoing),
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    /// Restore through the current public owner constructor when no private
    /// history is present.  This is a narrow compatibility helper, not the
    /// M3 live restore path: a non-empty history is rejected rather than
    /// silently dropped.  The integration owner must use
    /// [`GameRuntimeSnapshotBridge`] for complete continuation restoration.
    pub fn into_runtime(
        self,
        local_seat: SeatId,
        content: Arc<ContentPack>,
    ) -> Result<GameRuntime, SnapshotError> {
        self.validate()?;
        if self.state.content_hash != content.hash {
            return Err(invalid(
                "state.content_hash",
                "snapshot content identity differs from supplied ContentPack",
            ));
        }
        if !self
            .current_control
            .seats
            .iter()
            .any(|entry| entry.seat == local_seat)
        {
            return Err(invalid(
                "local_seat",
                "seat must have a current control entry",
            ));
        }
        if !self.control_history.is_empty() {
            return Err(SnapshotError::Restoration {
                reason:
                    "GameRuntime::from_parts cannot restore control_history on this integration SHA"
                        .to_owned(),
            });
        }
        GameRuntime::from_parts(
            self.state,
            self.current_control,
            local_seat,
            self.scripted_enemy_policy,
            self.command_admission.command_tombstones,
            self.command_admission.replacement_tombstones,
            content,
        )
        .map_err(|error: GameRuntimeError| SnapshotError::Restoration {
            reason: error.to_string(),
        })
    }
}
