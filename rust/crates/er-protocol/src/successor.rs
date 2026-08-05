//! Exact Authority V2 control identity and successor authorization.

use std::collections::BTreeSet;

use er_types::{
    AuthorityEntry, AuthorityEntryKind, AwaitSuccessorControl, NextControl, OperationId, SafeU53,
    SeatId,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[error("invalid next control: {issues:?}")]
pub struct ControlValidationError {
    pub issues: Vec<String>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SuccessorValidator;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPresentationInputProof {
    pub session_epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub phase_name: String,
    pub message_handler_actionable: bool,
}

impl SuccessorValidator {
    pub fn new() -> Self {
        Self
    }

    pub fn issues(&self, value: &Value) -> Vec<String> {
        next_control_issues(value)
    }

    pub fn validate(&self, value: &Value) -> Result<NextControl, ControlValidationError> {
        validate_next_control(value)
    }

    pub fn allows(
        &self,
        control: &NextControl,
        predecessor_operation_id: &OperationId,
        next: &AuthorityEntry,
    ) -> bool {
        control_allows_successor_entry(control, predecessor_operation_id, next)
    }
}

pub fn control_id_of(control: &NextControl) -> String {
    format!("M2-CONTRACT/{control:?}")
}

pub fn controls_equal(left: Option<&NextControl>, right: Option<&NextControl>) -> bool {
    left == right
}

pub fn same_control_address(left: &NextControl, right: &NextControl) -> bool {
    controls_equal(Some(left), Some(right))
}

pub fn next_control_issues(_value: &Value) -> Vec<String> {
    vec!["next-control validator implementation pending".to_owned()]
}

pub fn validate_next_control(value: &Value) -> Result<NextControl, ControlValidationError> {
    serde_json::from_value::<NextControl>(value.clone()).map_err(|error| ControlValidationError {
        issues: vec![error.to_string()],
    })
}

pub fn is_valid_next_control(value: &Value) -> bool {
    validate_next_control(value).is_ok() && next_control_issues(value).is_empty()
}

pub fn successor_wait_allows(
    _wait: &AwaitSuccessorControl,
    _predecessor_operation_id: &OperationId,
    _next_kind: AuthorityEntryKind,
    _next_operation_id: &OperationId,
    _session_epoch: SafeU53,
    _next_material: &Value,
) -> bool {
    false
}

pub fn successor_wait_allows_local_presentation_input(
    _wait: &AwaitSuccessorControl,
    _proof: &LocalPresentationInputProof,
) -> bool {
    false
}

pub fn control_allows_successor_entry(
    _control: &NextControl,
    _predecessor_operation_id: &OperationId,
    _next: &AuthorityEntry,
) -> bool {
    false
}

pub fn expected_control_id(entry: &AuthorityEntry) -> String {
    control_id_of(&entry.next_control)
}

pub fn control_owner_seat_id(_control: &NextControl) -> Option<SeatId> {
    None
}

pub fn control_owner_seat_ids(_control: &NextControl) -> BTreeSet<SeatId> {
    BTreeSet::new()
}

pub fn partition_control_for_seat(_control: &NextControl, _seat: SeatId) -> Option<NextControl> {
    None
}
