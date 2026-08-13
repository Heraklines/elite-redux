//! Exact Authority V2 control identity and successor authorization.

use std::{cmp::Ordering, collections::BTreeSet};

use er_types::{
    AuthorityEntry, AuthorityEntryKind, AwaitSuccessorControl, CommandControlTarget,
    ControlAddress, InteractionControlAddress, NextControl, OperationId, SafeU53, SeatId,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
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

/// Derive the complete, unhashed address emitted by the Authority V2
/// `next-control.ts` oracle.
pub fn control_id_of(control: &NextControl) -> String {
    match control {
        NextControl::CommandFrontier(control) => {
            let targets = canonical_command_targets(&control.commands)
                .into_iter()
                .map(|target| {
                    format!(
                        "f{}:s{}:p{}",
                        target.field_index, target.owner_seat_id, target.pokemon_id
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "COMMAND_FRONTIER/e{}/w{}/t{}/{}",
                control.epoch, control.wave, control.turn, targets
            )
        }
        NextControl::Replacement(control) => {
            let remaining = control
                .remaining
                .iter()
                .map(replacement_address_component)
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "REPLACEMENT/{}/s{}/e{}/w{}/t{}/o{}/f{}/remaining:{}",
                encode_uri_component(control.operation_id.as_str()),
                control.owner_seat_id,
                control.epoch,
                control.wave,
                control.turn,
                control.occurrence,
                control.field_index,
                remaining
            )
        }
        NextControl::SharedInteraction(control) => {
            let operation_kinds = canonical_js_strings(&control.successor.operation_kinds)
                .into_iter()
                .collect::<Vec<_>>()
                .join(",");
            let operation_ids = match &control.successor.operation_ids {
                None => "*".to_owned(),
                Some(ids) => canonical_operation_ids(ids)
                    .into_iter()
                    .map(encode_uri_component)
                    .collect::<Vec<_>>()
                    .join(","),
            };
            format!(
                "SHARED_INTERACTION/{}/{}/{}/s{}/e{}/w{}/t{}/results:{}/resultIds:{}",
                encode_uri_component(&control.surface_class),
                encode_uri_component(&control.operation_kind),
                encode_uri_component(control.operation_id.as_str()),
                control.owner_seat_id,
                control.epoch,
                control.wave,
                control.turn,
                operation_kinds,
                operation_ids
            )
        }
        NextControl::AwaitSuccessor(control) => await_successor_id(control),
        NextControl::Terminal(control) => {
            format!("TERMINAL/{}", encode_uri_component(&control.terminal_id))
        }
    }
}

pub fn controls_equal(left: Option<&NextControl>, right: Option<&NextControl>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left), Some(right)) => control_id_of(left) == control_id_of(right),
        _ => false,
    }
}

pub fn same_control_address(left: &NextControl, right: &NextControl) -> bool {
    control_id_of(left) == control_id_of(right)
}

/// Collect every structural and semantic issue in the untrusted wire value.
/// The order mirrors `nextControlIssues()` in the TypeScript oracle.
pub fn next_control_issues(value: &Value) -> Vec<String> {
    let Some(control) = value.as_object() else {
        return vec!["not an object".to_owned()];
    };

    match control.get("kind").and_then(Value::as_str) {
        Some("COMMAND_FRONTIER") => command_frontier_issues(control),
        Some("REPLACEMENT") => replacement_issues(control),
        Some("SHARED_INTERACTION") => shared_interaction_issues(control),
        Some("AWAIT_SUCCESSOR") => successor_wait_issues(control),
        Some("TERMINAL") => terminal_issues(control),
        _ => vec!["kind: unknown control kind".to_owned()],
    }
}

pub fn validate_next_control(value: &Value) -> Result<NextControl, ControlValidationError> {
    // `issues()` is the exhaustive diagnostic surface; the oracle's validate
    // shape exposes only its first reason.
    let issues = next_control_issues(value);
    if let Some(first_issue) = issues.into_iter().next() {
        return Err(ControlValidationError {
            issues: vec![first_issue],
        });
    }

    serde_json::from_value::<NextControl>(value.clone()).map_err(|error| ControlValidationError {
        issues: vec![error.to_string()],
    })
}

pub fn is_valid_next_control(value: &Value) -> bool {
    validate_next_control(value).is_ok()
}

pub fn successor_wait_allows(
    wait: &AwaitSuccessorControl,
    predecessor_operation_id: &OperationId,
    next_kind: AuthorityEntryKind,
    next_operation_id: &OperationId,
    session_epoch: SafeU53,
    next_material: &Value,
) -> bool {
    if wait.after_operation_id.as_str() != predecessor_operation_id.as_str()
        || wait.epoch != session_epoch
        || !wait.allowed_kinds.contains(&next_kind)
        || wait
            .expected_operation_id
            .as_ref()
            .is_some_and(|expected| expected != next_operation_id)
    {
        return false;
    }

    let Some(address) = mechanical_address_of(next_kind, session_epoch, next_material) else {
        return false;
    };
    if address.epoch != wait.epoch {
        return false;
    }

    let interaction_operation_kind = interaction_operation_kind_of_entry(next_kind, next_material);
    let interaction_material = next_material.as_object();
    if next_kind == AuthorityEntryKind::InteractionCommit
        && interaction_operation_kind.is_some()
        && wait.allowed_interaction_addresses.is_some()
    {
        let Some(allowed_addresses) = wait.allowed_interaction_addresses.as_ref() else {
            return false;
        };
        return allowed_addresses.iter().any(|allowed| {
            allowed.wave == wait.wave
                && interaction_material
                    .and_then(|material| material.get("surfaceClass"))
                    .and_then(Value::as_str)
                    == Some(allowed.surface_class.as_str())
                && Some(allowed.operation_kind.as_str()) == interaction_operation_kind
                && allowed.wave == address.wave
                && allowed.turn == address.turn
        });
    }

    let control_material = next_material.as_object();
    if next_kind == AuthorityEntryKind::ControlCommit
        && control_material
            .and_then(|material| material.get("kind"))
            .and_then(Value::as_str)
            .is_some_and(|kind| kind == "command-open" || kind == "interaction-open")
        && wait.allowed_control_addresses.is_some()
    {
        let Some(allowed_addresses) = wait.allowed_control_addresses.as_ref() else {
            return false;
        };
        let Some(material_kind) = control_material
            .and_then(|material| material.get("kind"))
            .and_then(Value::as_str)
        else {
            return false;
        };
        return allowed_addresses.iter().any(|allowed| {
            allowed.material_kind == material_kind
                && allowed.wave == address.wave
                && allowed.turn == address.turn
                && allowed
                    .operation_id
                    .as_ref()
                    .is_none_or(|expected| expected == next_operation_id)
        });
    }

    let control_only =
        wait.allowed_kinds.len() == 1 && wait.allowed_kinds[0] == AuthorityEntryKind::ControlCommit;
    let settlement_boundary_wait = wait
        .allowed_kinds
        .contains(&AuthorityEntryKind::WaveAdvance)
        && wait
            .allowed_kinds
            .contains(&AuthorityEntryKind::TerminalCommit);

    if safe_successor_wave(address.wave, wait.wave) {
        let pre_turn_mystery =
            address.turn == SafeU53::ZERO && interaction_operation_kind == Some("ME_PRESENT");
        return wait.allow_next_wave_start && (address.turn == safe_one() || pre_turn_mystery);
    }
    if address.wave != wait.wave {
        return false;
    }
    if next_kind == AuthorityEntryKind::ControlCommit && !control_only {
        return broad_wait_allows_control_commit_turn(
            next_material,
            address.turn,
            wait.turn,
            wait.allowed_kinds.contains(&AuthorityEntryKind::TurnCommit),
        );
    }
    if settlement_boundary_wait
        && (next_kind == AuthorityEntryKind::WaveAdvance
            || next_kind == AuthorityEntryKind::TerminalCommit)
    {
        return address.turn == wait.turn || safe_successor_turn(address.turn, wait.turn);
    }
    address.turn == wait.turn
}

pub fn successor_wait_allows_local_presentation_input(
    wait: &AwaitSuccessorControl,
    proof: &LocalPresentationInputProof,
) -> bool {
    if !wait.allow_next_wave_start
        || proof.session_epoch != wait.epoch
        || !proof.message_handler_actionable
    {
        return false;
    }

    let same_address_level_up =
        proof.wave == wait.wave && proof.turn == wait.turn && proof.phase_name == "LevelUpPhase";
    let next_wave_intro = safe_successor_wave(proof.wave, wait.wave)
        && proof.turn == safe_one()
        && proof.phase_name == "NextEncounterPhase";
    same_address_level_up || next_wave_intro
}

pub fn control_allows_successor_entry(
    control: &NextControl,
    predecessor_operation_id: &OperationId,
    next: &AuthorityEntry,
) -> bool {
    match control {
        NextControl::AwaitSuccessor(wait) => successor_wait_allows(
            wait,
            predecessor_operation_id,
            next.kind,
            &next.operation_id,
            next.context.session_epoch,
            &next.material.payload,
        ),
        NextControl::CommandFrontier(control) => {
            let Some(address) = mechanical_address_of(
                next.kind,
                next.context.session_epoch,
                &next.material.payload,
            ) else {
                return false;
            };
            (next.kind == AuthorityEntryKind::TurnCommit
                || is_exact_turn_resolve_prompt_entry(next))
                && address.epoch == control.epoch
                && address.wave == control.wave
                && address.turn == control.turn
        }
        NextControl::Replacement(control) => {
            let Some(address) = mechanical_address_of(
                next.kind,
                next.context.session_epoch,
                &next.material.payload,
            ) else {
                return false;
            };
            next.kind == AuthorityEntryKind::ReplacementCommit
                && next.operation_id.as_str() == control.operation_id.as_str()
                && address.epoch == control.epoch
                && address.wave == control.wave
                && address.turn == control.turn
        }
        NextControl::SharedInteraction(control) => {
            let Some(result_kind) =
                interaction_operation_kind_of_entry(next.kind, &next.material.payload)
            else {
                return false;
            };
            let Some(address) = mechanical_address_of(
                next.kind,
                next.context.session_epoch,
                &next.material.payload,
            ) else {
                return false;
            };
            next.kind == AuthorityEntryKind::InteractionCommit
                && address.epoch == control.epoch
                && address.wave == control.wave
                && address.turn == control.turn
                && control
                    .successor
                    .operation_kinds
                    .iter()
                    .any(|kind| kind == result_kind)
                && control.successor.operation_ids.as_ref().is_none_or(|ids| {
                    ids.iter()
                        .any(|operation_id| operation_id == &next.operation_id)
                })
        }
        NextControl::Terminal(_) => false,
    }
}

pub fn expected_control_id(entry: &AuthorityEntry) -> String {
    control_id_of(&entry.next_control)
}

pub fn control_owner_seat_id(control: &NextControl) -> Option<SeatId> {
    let owners = control_owner_seat_ids(control);
    if owners.len() == 1 {
        owners.iter().next().copied()
    } else {
        None
    }
}

pub fn control_owner_seat_ids(control: &NextControl) -> BTreeSet<SeatId> {
    match control {
        NextControl::CommandFrontier(control) => control
            .commands
            .iter()
            .map(|command| command.owner_seat_id)
            .collect(),
        NextControl::Replacement(control) => BTreeSet::from([control.owner_seat_id]),
        NextControl::SharedInteraction(control) => BTreeSet::from([control.owner_seat_id]),
        NextControl::AwaitSuccessor(_) | NextControl::Terminal(_) => BTreeSet::new(),
    }
}

pub fn partition_control_for_seat(control: &NextControl, seat: SeatId) -> Option<NextControl> {
    // Partitioning gates installation by seat; it never rewrites the stated
    // control, because doing so would change the shared control address.
    match control {
        NextControl::CommandFrontier(frontier) => frontier
            .commands
            .iter()
            .any(|command| command.owner_seat_id == seat)
            .then(|| control.clone()),
        NextControl::Replacement(_) | NextControl::SharedInteraction(_) => Some(control.clone()),
        NextControl::AwaitSuccessor(_) | NextControl::Terminal(_) => Some(control.clone()),
    }
}

fn await_successor_id(control: &AwaitSuccessorControl) -> String {
    let allowed_kinds = canonical_successor_kinds(&control.allowed_kinds)
        .into_iter()
        .map(authority_kind_name)
        .collect::<Vec<_>>()
        .join(",");
    let interaction_addresses = control.allowed_interaction_addresses.as_ref().map_or_else(
        || "*".to_owned(),
        |addresses| canonical_interaction_addresses(addresses),
    );
    let control_addresses = control.allowed_control_addresses.as_ref().map_or_else(
        || "*".to_owned(),
        |addresses| canonical_control_addresses(addresses),
    );
    let expected_operation_id = control.expected_operation_id.as_ref().map_or_else(
        || "*".to_owned(),
        |operation_id| encode_uri_component(operation_id.as_str()),
    );
    format!(
        "AWAIT_SUCCESSOR/{}/e{}/w{}/t{}/{}/interactionAddresses:{}/controlAddresses:{}/nextWave:{}/next:{}",
        encode_uri_component(control.after_operation_id.as_str()),
        control.epoch,
        control.wave,
        control.turn,
        allowed_kinds,
        interaction_addresses,
        control_addresses,
        if control.allow_next_wave_start {
            "1"
        } else {
            "0"
        },
        expected_operation_id
    )
}

fn replacement_address_component(target: &er_types::ReplacementControlAddress) -> String {
    format!(
        "{}:s{}:e{}:w{}:t{}:o{}:f{}",
        encode_uri_component(target.operation_id.as_str()),
        target.owner_seat_id,
        target.epoch,
        target.wave,
        target.turn,
        target.occurrence,
        target.field_index
    )
}

fn canonical_command_targets(commands: &[CommandControlTarget]) -> Vec<&CommandControlTarget> {
    let mut targets = commands.iter().collect::<Vec<_>>();
    targets.sort_by(|left, right| {
        left.field_index
            .cmp(&right.field_index)
            .then_with(|| left.owner_seat_id.cmp(&right.owner_seat_id))
            .then_with(|| left.pokemon_id.cmp(&right.pokemon_id))
    });
    targets
}

fn canonical_operation_ids(ids: &[OperationId]) -> Vec<&str> {
    let mut canonical = Vec::with_capacity(ids.len());
    for operation_id in ids {
        let value = operation_id.as_str();
        if !canonical.contains(&value) {
            canonical.push(value);
        }
    }
    canonical.sort_by(|left, right| js_string_cmp(left, right));
    canonical
}

fn canonical_js_strings(values: &[String]) -> Vec<&str> {
    let mut canonical = Vec::with_capacity(values.len());
    for value in values {
        if !canonical.contains(&value.as_str()) {
            canonical.push(value.as_str());
        }
    }
    canonical.sort_by(|left, right| js_string_cmp(left, right));
    canonical
}

fn canonical_successor_kinds(kinds: &[AuthorityEntryKind]) -> Vec<AuthorityEntryKind> {
    let mut canonical = Vec::with_capacity(kinds.len());
    for kind in kinds {
        if !canonical.contains(kind) {
            canonical.push(*kind);
        }
    }
    canonical.sort_by_key(|kind| authority_kind_order(*kind));
    canonical
}

fn canonical_interaction_addresses(addresses: &[InteractionControlAddress]) -> String {
    let mut canonical = addresses
        .iter()
        .map(|address| {
            format!(
                "{}:{}:w{}:t{}",
                encode_uri_component(&address.surface_class),
                encode_uri_component(&address.operation_kind),
                address.wave,
                address.turn
            )
        })
        .collect::<Vec<_>>();
    canonical.sort_by(|left, right| js_string_cmp(left, right));
    canonical.join(",")
}

fn canonical_control_addresses(addresses: &[ControlAddress]) -> String {
    let mut canonical = addresses
        .iter()
        .map(|address| {
            format!(
                "{}:w{}:t{}:id{}",
                address.material_kind,
                address.wave,
                address.turn,
                address.operation_id.as_ref().map_or_else(
                    || "*".to_owned(),
                    |operation_id| { encode_uri_component(operation_id.as_str()) }
                )
            )
        })
        .collect::<Vec<_>>();
    canonical.sort_by(|left, right| js_string_cmp(left, right));
    canonical.join(",")
}

fn js_string_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn encode_uri_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if is_uri_component_byte(*byte) {
            encoded.push(char::from(*byte));
        } else {
            encoded.push('%');
            encoded.push(hex_digit(byte >> 4));
            encoded.push(hex_digit(byte & 0x0f));
        }
    }
    encoded
}

fn is_uri_component_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
        )
}

fn hex_digit(value: u8) -> char {
    match value {
        0..=9 => char::from(b'0' + value),
        10..=15 => char::from(b'A' + (value - 10)),
        _ => '0',
    }
}

fn authority_kind_name(kind: AuthorityEntryKind) -> &'static str {
    match kind {
        AuthorityEntryKind::TurnCommit => "TURN_COMMIT",
        AuthorityEntryKind::ReplacementCommit => "REPLACEMENT_COMMIT",
        AuthorityEntryKind::InteractionCommit => "INTERACTION_COMMIT",
        AuthorityEntryKind::ControlCommit => "CONTROL_COMMIT",
        AuthorityEntryKind::WaveAdvance => "WAVE_ADVANCE",
        AuthorityEntryKind::TerminalCommit => "TERMINAL_COMMIT",
    }
}

fn authority_kind_order(kind: AuthorityEntryKind) -> u8 {
    match kind {
        AuthorityEntryKind::TurnCommit => 0,
        AuthorityEntryKind::ReplacementCommit => 1,
        AuthorityEntryKind::InteractionCommit => 2,
        AuthorityEntryKind::ControlCommit => 3,
        AuthorityEntryKind::WaveAdvance => 4,
        AuthorityEntryKind::TerminalCommit => 5,
    }
}

fn safe_nonnegative(value: Option<&Value>) -> bool {
    safe_u53_number(value).is_some()
}

fn safe_positive(value: Option<&Value>) -> bool {
    safe_u53_number(value).is_some_and(|value| value > 0)
}

fn nonempty_string(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
}

fn object_field<'a>(object: &'a Map<String, Value>, field: &str) -> Option<&'a Value> {
    object.get(field)
}

fn command_frontier_issues(control: &Map<String, Value>) -> Vec<String> {
    let mut issues = Vec::new();
    push_if_invalid(
        &mut issues,
        "epoch",
        safe_positive(control_field(control, "epoch")),
    );
    push_if_invalid(
        &mut issues,
        "wave",
        safe_positive(control_field(control, "wave")),
    );
    push_if_invalid(
        &mut issues,
        "turn",
        safe_positive(control_field(control, "turn")),
    );

    let Some(commands) = control_field(control, "commands").and_then(Value::as_array) else {
        issues.push("commands".to_owned());
        return issues;
    };
    if commands.is_empty() {
        issues.push("commands".to_owned());
        return issues;
    }

    let mut seen_fields = BTreeSet::new();
    for (index, command) in commands.iter().enumerate() {
        let Some(command) = command.as_object() else {
            issues.push(format!("commands[{index}]"));
            continue;
        };
        push_if_invalid(
            &mut issues,
            &format!("commands[{index}].ownerSeatId"),
            safe_nonnegative(command_field(command, "ownerSeatId")),
        );
        push_if_invalid(
            &mut issues,
            &format!("commands[{index}].pokemonId"),
            safe_positive(command_field(command, "pokemonId")),
        );
        let field_index = command_field(command, "fieldIndex");
        let valid_field = safe_nonnegative(field_index);
        push_if_invalid(
            &mut issues,
            &format!("commands[{index}].fieldIndex"),
            valid_field,
        );
        if let Some(field_index) = field_index.and_then(|value| safe_u53_number(Some(value)))
            && !seen_fields.insert(field_index)
        {
            issues.push(format!("commands[{index}].fieldIndex: duplicate"));
        }
    }
    issues
}

fn replacement_issues(control: &Map<String, Value>) -> Vec<String> {
    let mut issues = Vec::new();
    push_if_invalid(
        &mut issues,
        "operationId",
        nonempty_string(control_field(control, "operationId")),
    );
    push_if_invalid(
        &mut issues,
        "ownerSeatId",
        safe_nonnegative(control_field(control, "ownerSeatId")),
    );
    push_if_invalid(
        &mut issues,
        "epoch",
        safe_positive(control_field(control, "epoch")),
    );
    push_if_invalid(
        &mut issues,
        "wave",
        safe_positive(control_field(control, "wave")),
    );
    push_if_invalid(
        &mut issues,
        "turn",
        safe_positive(control_field(control, "turn")),
    );
    push_if_invalid(
        &mut issues,
        "occurrence",
        safe_nonnegative(control_field(control, "occurrence")),
    );
    push_if_invalid(
        &mut issues,
        "fieldIndex",
        safe_nonnegative(control_field(control, "fieldIndex")),
    );

    let Some(remaining) = control_field(control, "remaining").and_then(Value::as_array) else {
        issues.push("remaining".to_owned());
        return issues;
    };

    let head_epoch = control_field(control, "epoch");
    let head_wave = control_field(control, "wave");
    let head_turn = control_field(control, "turn");
    let mut prior_occurrence =
        control_field(control, "occurrence").and_then(|value| safe_u53_number(Some(value)));
    let mut operation_ids = Vec::new();
    if let Some(operation_id) = control_field(control, "operationId")
        .and_then(Value::as_str)
        .filter(|operation_id| !operation_id.is_empty())
    {
        operation_ids.push(operation_id.to_owned());
    }

    for (index, target) in remaining.iter().enumerate() {
        let Some(target) = target.as_object() else {
            issues.push(format!("remaining[{index}]"));
            continue;
        };
        push_if_invalid(
            &mut issues,
            &format!("remaining[{index}].operationId"),
            nonempty_string(target_field(target, "operationId")),
        );
        push_if_invalid(
            &mut issues,
            &format!("remaining[{index}].ownerSeatId"),
            safe_nonnegative(target_field(target, "ownerSeatId")),
        );
        push_if_invalid(
            &mut issues,
            &format!("remaining[{index}].epoch"),
            safe_positive(target_field(target, "epoch")),
        );
        push_if_invalid(
            &mut issues,
            &format!("remaining[{index}].wave"),
            safe_positive(target_field(target, "wave")),
        );
        push_if_invalid(
            &mut issues,
            &format!("remaining[{index}].turn"),
            safe_positive(target_field(target, "turn")),
        );
        let occurrence = target_field(target, "occurrence");
        let valid_occurrence = safe_nonnegative(occurrence);
        push_if_invalid(
            &mut issues,
            &format!("remaining[{index}].occurrence"),
            valid_occurrence,
        );
        push_if_invalid(
            &mut issues,
            &format!("remaining[{index}].fieldIndex"),
            safe_nonnegative(target_field(target, "fieldIndex")),
        );

        if !js_value_equal(target_field(target, "epoch"), head_epoch)
            || !js_value_equal(target_field(target, "wave"), head_wave)
            || !js_value_equal(target_field(target, "turn"), head_turn)
        {
            issues.push(format!("remaining[{index}]: boundary"));
        }
        if let Some(occurrence) = occurrence.and_then(|value| safe_u53_number(Some(value))) {
            let order_invalid = prior_occurrence.is_none_or(|prior| occurrence <= prior);
            if order_invalid {
                issues.push(format!("remaining[{index}].occurrence: order"));
            }
            prior_occurrence = Some(occurrence);
        }
        if let Some(operation_id) = target_field(target, "operationId")
            .and_then(Value::as_str)
            .filter(|operation_id| !operation_id.is_empty())
        {
            if operation_ids.iter().any(|seen| seen == operation_id) {
                issues.push(format!("remaining[{index}].operationId: duplicate"));
            }
            operation_ids.push(operation_id.to_owned());
        }
    }
    issues
}

fn shared_interaction_issues(control: &Map<String, Value>) -> Vec<String> {
    let mut issues = Vec::new();
    push_if_invalid(
        &mut issues,
        "operationId",
        nonempty_string(control_field(control, "operationId")),
    );
    push_if_invalid(
        &mut issues,
        "ownerSeatId",
        safe_nonnegative(control_field(control, "ownerSeatId")),
    );
    push_if_invalid(
        &mut issues,
        "epoch",
        safe_positive(control_field(control, "epoch")),
    );
    push_if_invalid(
        &mut issues,
        "wave",
        safe_nonnegative(control_field(control, "wave")),
    );
    push_if_invalid(
        &mut issues,
        "turn",
        safe_nonnegative(control_field(control, "turn")),
    );

    let surface = control_field(control, "surfaceClass").and_then(Value::as_str);
    if surface.is_none_or(|surface| !is_known_surface(surface)) {
        issues.push("surfaceClass".to_owned());
    }
    let operation_kind = control_field(control, "operationKind").and_then(Value::as_str);
    if operation_kind.is_none_or(|operation_kind| !is_known_operation_kind(operation_kind)) {
        issues.push("operationKind".to_owned());
    } else if let (Some(surface), Some(operation_kind)) = (surface, operation_kind)
        && is_known_surface(surface)
        && !operation_kind_allows_surface(operation_kind, surface)
    {
        issues.push("surfaceClass/operationKind".to_owned());
    }

    let Some(successor) = control_field(control, "successor").and_then(Value::as_object) else {
        issues.push("successor".to_owned());
        return issues;
    };
    let Some(operation_kinds) =
        successor_field(successor, "operationKinds").and_then(Value::as_array)
    else {
        issues.push("successor.operationKinds".to_owned());
        operation_ids_issues(&mut issues, successor);
        return issues;
    };
    if operation_kinds.is_empty() {
        issues.push("successor.operationKinds".to_owned());
    } else {
        let mut seen_kinds = Vec::new();
        for (index, kind) in operation_kinds.iter().enumerate() {
            let valid = kind.as_str().is_some_and(is_known_operation_kind);
            if !valid {
                issues.push(format!("successor.operationKinds[{index}]"));
            } else if let Some(kind) = kind.as_str()
                && seen_kinds.iter().any(|seen| seen == kind)
            {
                issues.push(format!("successor.operationKinds[{index}]: duplicate"));
            }
            if let Some(kind) = kind.as_str() {
                seen_kinds.push(kind.to_owned());
            }
        }
    }
    operation_ids_issues(&mut issues, successor);
    issues
}

fn operation_ids_issues(issues: &mut Vec<String>, successor: &Map<String, Value>) {
    let Some(operation_ids) = successor_field(successor, "operationIds") else {
        issues.push("successor.operationIds".to_owned());
        return;
    };
    if operation_ids.is_null() {
        return;
    }
    let Some(operation_ids) = operation_ids.as_array() else {
        issues.push("successor.operationIds".to_owned());
        return;
    };
    if operation_ids.is_empty() {
        issues.push("successor.operationIds".to_owned());
        return;
    }
    let mut seen_ids = Vec::new();
    for (index, operation_id) in operation_ids.iter().enumerate() {
        if !nonempty_string(Some(operation_id)) {
            issues.push(format!("successor.operationIds[{index}]"));
        } else if let Some(operation_id) = operation_id.as_str()
            && seen_ids.iter().any(|seen| seen == operation_id)
        {
            issues.push(format!("successor.operationIds[{index}]: duplicate"));
        }
        if let Some(operation_id) = operation_id.as_str() {
            seen_ids.push(operation_id.to_owned());
        }
    }
}

fn successor_wait_issues(control: &Map<String, Value>) -> Vec<String> {
    let mut issues = Vec::new();
    push_if_invalid(
        &mut issues,
        "afterOperationId",
        nonempty_string(control_field(control, "afterOperationId")),
    );
    push_if_invalid(
        &mut issues,
        "epoch",
        safe_positive(control_field(control, "epoch")),
    );
    push_if_invalid(
        &mut issues,
        "wave",
        safe_nonnegative(control_field(control, "wave")),
    );
    push_if_invalid(
        &mut issues,
        "turn",
        safe_nonnegative(control_field(control, "turn")),
    );
    push_if_invalid(
        &mut issues,
        "allowNextWaveStart",
        control_field(control, "allowNextWaveStart")
            .and_then(Value::as_bool)
            .is_some(),
    );

    let allowed_kinds = control_field(control, "allowedKinds").and_then(Value::as_array);
    if allowed_kinds.is_none_or(|allowed_kinds| allowed_kinds.is_empty()) {
        issues.push("allowedKinds".to_owned());
    } else if let Some(allowed_kinds) = allowed_kinds {
        let mut seen = Vec::new();
        for (index, kind) in allowed_kinds.iter().enumerate() {
            let valid = kind.as_str().is_some_and(is_authority_kind_name);
            if !valid {
                issues.push(format!("allowedKinds[{index}]"));
            } else if let Some(kind) = kind.as_str()
                && seen.iter().any(|seen| seen == kind)
            {
                issues.push(format!("allowedKinds[{index}]: duplicate"));
            }
            if let Some(kind) = kind.as_str() {
                seen.push(kind.to_owned());
            }
        }
    }

    let expected_operation_id = control_field(control, "expectedOperationId");
    if !expected_operation_id.is_some_and(Value::is_null) && !nonempty_string(expected_operation_id)
    {
        issues.push("expectedOperationId".to_owned());
    }

    if let Some(addresses) = control.get("allowedInteractionAddresses") {
        let allowed_interaction = allowed_kinds_contains(allowed_kinds, "INTERACTION_COMMIT");
        let Some(addresses) = addresses.as_array() else {
            issues.push("allowedInteractionAddresses".to_owned());
            return control_addresses_issues(issues, control, allowed_kinds);
        };
        if addresses.is_empty() || !allowed_interaction {
            issues.push("allowedInteractionAddresses".to_owned());
        } else {
            let mut seen = Vec::new();
            for (index, candidate) in addresses.iter().enumerate() {
                let Some(candidate) = candidate.as_object() else {
                    issues.push(format!("allowedInteractionAddresses[{index}]"));
                    continue;
                };
                let operation_kind =
                    candidate_field(candidate, "operationKind").and_then(Value::as_str);
                let surface = candidate_field(candidate, "surfaceClass").and_then(Value::as_str);
                let wave = candidate_field(candidate, "wave");
                let turn = candidate_field(candidate, "turn");
                let valid = operation_kind.is_some_and(is_known_operation_kind)
                    && surface.is_some_and(is_known_surface)
                    && operation_kind
                        .zip(surface)
                        .is_some_and(|(operation_kind, surface)| {
                            operation_kind_allows_surface(operation_kind, surface)
                        })
                    && safe_nonnegative(wave)
                    && js_value_equal(wave, control_field(control, "wave"))
                    && safe_nonnegative(turn);
                let key = validation_key(&[
                    candidate_field(candidate, "surfaceClass"),
                    candidate_field(candidate, "operationKind"),
                    wave,
                    turn,
                ]);
                if !valid {
                    issues.push(format!("allowedInteractionAddresses[{index}]"));
                } else if seen.iter().any(|seen| seen == &key) {
                    issues.push(format!("allowedInteractionAddresses[{index}]: duplicate"));
                }
                seen.push(key);
            }
        }
    }
    control_addresses_issues(issues, control, allowed_kinds)
}

fn control_addresses_issues(
    mut issues: Vec<String>,
    control: &Map<String, Value>,
    allowed_kinds: Option<&Vec<Value>>,
) -> Vec<String> {
    let Some(addresses) = control.get("allowedControlAddresses") else {
        return issues;
    };
    let allowed_control = allowed_kinds_contains(allowed_kinds, "CONTROL_COMMIT");
    let Some(addresses) = addresses.as_array() else {
        issues.push("allowedControlAddresses".to_owned());
        return issues;
    };
    if addresses.is_empty() || !allowed_control {
        issues.push("allowedControlAddresses".to_owned());
        return issues;
    }

    let allow_next_wave = control_field(control, "allowNextWaveStart")
        .and_then(Value::as_bool)
        .is_some_and(|value| value);
    let control_wave = control_field(control, "wave");
    let mut seen = Vec::new();
    for (index, candidate) in addresses.iter().enumerate() {
        let Some(candidate) = candidate.as_object() else {
            issues.push(format!("allowedControlAddresses[{index}]"));
            continue;
        };
        let material_kind = candidate_field(candidate, "materialKind").and_then(Value::as_str);
        let wave = candidate_field(candidate, "wave");
        let turn = candidate_field(candidate, "turn");
        let operation_id = candidate_field(candidate, "operationId");
        let operation_id_valid =
            operation_id.is_some_and(Value::is_null) || nonempty_string(operation_id);
        let wave_valid = safe_nonnegative(wave)
            && (js_value_equal(wave, control_wave)
                || (allow_next_wave && safe_successor_value(wave, control_wave)));
        let valid = material_kind
            .is_some_and(|kind| kind == "command-open" || kind == "interaction-open")
            && wave_valid
            && safe_positive(turn)
            && operation_id_valid;
        let key = validation_key(&[
            candidate_field(candidate, "materialKind"),
            wave,
            turn,
            operation_id,
        ]);
        if !valid {
            issues.push(format!("allowedControlAddresses[{index}]"));
        } else if seen.iter().any(|seen| seen == &key) {
            issues.push(format!("allowedControlAddresses[{index}]: duplicate"));
        }
        seen.push(key);
    }
    issues
}

fn terminal_issues(control: &Map<String, Value>) -> Vec<String> {
    if nonempty_string(control_field(control, "terminalId")) {
        Vec::new()
    } else {
        vec!["terminalId".to_owned()]
    }
}

fn push_if_invalid(issues: &mut Vec<String>, field: &str, valid: bool) {
    if !valid {
        issues.push(field.to_owned());
    }
}

fn control_field<'a>(control: &'a Map<String, Value>, field: &str) -> Option<&'a Value> {
    object_field(control, field)
}

fn command_field<'a>(control: &'a Map<String, Value>, field: &str) -> Option<&'a Value> {
    object_field(control, field)
}

fn target_field<'a>(target: &'a Map<String, Value>, field: &str) -> Option<&'a Value> {
    object_field(target, field)
}

fn successor_field<'a>(successor: &'a Map<String, Value>, field: &str) -> Option<&'a Value> {
    object_field(successor, field)
}

fn candidate_field<'a>(candidate: &'a Map<String, Value>, field: &str) -> Option<&'a Value> {
    object_field(candidate, field)
}

fn js_value_equal(left: Option<&Value>, right: Option<&Value>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(Value::Number(left)), Some(Value::Number(right))) => left.as_f64() == right.as_f64(),
        (Some(left), Some(right)) => left == right,
        _ => false,
    }
}

fn validation_key(values: &[Option<&Value>]) -> String {
    values
        .iter()
        .map(|value| match value {
            None => "undefined".to_owned(),
            Some(value) => js_string_value(value),
        })
        .collect::<Vec<_>>()
        .join(":")
}

/// JavaScript's String(value) for JSON values used by duplicate-key diagnostics.
///
/// Arrays are the one special case: Array#toString delegates to join(","), so
/// null elements become empty strings and nested arrays recurse through the
/// same conversion. Plain JSON objects stringify as "[object Object]".
fn js_string_value(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => js_number_string(value),
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(js_array_element_string)
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

fn js_array_element_string(value: &Value) -> String {
    if value.is_null() {
        String::new()
    } else {
        js_string_value(value)
    }
}

fn js_number_string(value: &serde_json::Number) -> String {
    let Some(value_as_f64) = value
        .as_f64()
        .or_else(|| value.to_string().parse::<f64>().ok())
    else {
        return value.to_string();
    };
    if value_as_f64 == 0.0 {
        return "0".to_owned();
    }
    if value_as_f64.is_infinite() {
        return if value_as_f64.is_sign_negative() {
            "-Infinity".to_owned()
        } else {
            "Infinity".to_owned()
        };
    }

    let rendered = serde_json::to_string(&value_as_f64).unwrap_or_else(|_| value.to_string());
    let negative = rendered.starts_with('-');
    let unsigned = if negative { &rendered[1..] } else { &rendered };
    let exponent_index = unsigned.find('e').or_else(|| unsigned.find('E'));
    let (mantissa, exponent) = exponent_index.map_or((unsigned, 0), |index| {
        (
            &unsigned[..index],
            unsigned[index + 1..].parse::<i32>().unwrap_or(0),
        )
    });
    let decimal_index = mantissa.find('.').unwrap_or(mantissa.len()) as i32;
    let mut digits = mantissa
        .chars()
        .filter(|character| *character != '.')
        .collect::<String>();
    let mut decimal_position = decimal_index + exponent;

    while digits.starts_with('0') {
        digits.remove(0);
        decimal_position -= 1;
    }
    while digits.ends_with('0') {
        digits.pop();
    }
    if digits.is_empty() {
        return "0".to_owned();
    }

    let absolute = value_as_f64.abs();
    let body = if !(1e-6..1e21).contains(&absolute) {
        let exponent = decimal_position - 1;
        let mantissa = if digits.len() == 1 {
            digits.clone()
        } else {
            format!("{}.{}", &digits[..1], &digits[1..])
        };
        if exponent >= 0 {
            format!("{mantissa}e+{exponent}")
        } else {
            format!("{mantissa}e{exponent}")
        }
    } else if decimal_position <= 0 {
        format!("0.{}{}", "0".repeat((-decimal_position) as usize), digits)
    } else if decimal_position as usize >= digits.len() {
        format!(
            "{}{}",
            digits,
            "0".repeat(decimal_position as usize - digits.len())
        )
    } else {
        format!(
            "{}.{}",
            &digits[..decimal_position as usize],
            &digits[decimal_position as usize..]
        )
    };

    if negative { format!("-{body}") } else { body }
}

fn safe_u53_number(value: Option<&Value>) -> Option<u64> {
    let value = value?.as_f64()?;
    if !value.is_finite()
        || value < 0.0
        || value.fract() != 0.0
        || value > SafeU53::MAX.get() as f64
    {
        return None;
    }
    Some(value as u64)
}

fn allowed_kinds_contains(allowed_kinds: Option<&Vec<Value>>, wanted: &str) -> bool {
    allowed_kinds.is_some_and(|kinds| kinds.iter().any(|kind| kind.as_str() == Some(wanted)))
}

fn safe_successor_value(value: Option<&Value>, base: Option<&Value>) -> bool {
    let Some(value) = value.and_then(|value| safe_u53_number(Some(value))) else {
        return false;
    };
    let Some(base) = base.and_then(|value| safe_u53_number(Some(value))) else {
        return false;
    };
    base < SafeU53::MAX.get() && value == base + 1
}

fn safe_successor_wave(value: SafeU53, base: SafeU53) -> bool {
    base.get() < SafeU53::MAX.get() && value.get() == base.get() + 1
}

fn safe_successor_turn(value: SafeU53, base: SafeU53) -> bool {
    safe_successor_wave(value, base)
}

fn safe_one() -> SafeU53 {
    match SafeU53::new(1) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn mechanical_address_of(
    kind: AuthorityEntryKind,
    context_epoch: SafeU53,
    material: &Value,
) -> Option<MechanicalAddress> {
    let payload = material.as_object()?;
    let mut epoch = context_epoch;
    let (wave, turn) = match kind {
        AuthorityEntryKind::TurnCommit => {
            if let Some(payload_epoch) = payload.get("epoch")
                && !payload_epoch.is_null()
            {
                epoch = safe_positive_value(payload_epoch)?;
            }
            // Legacy Authority TURN payloads name this coordinate `turn`;
            // the frozen M3 battle material names the same coordinate
            // `resolved_turn`. Accept exactly one spelling so a payload can
            // never smuggle two divergent successor addresses.
            let turn = match (payload.get("turn"), payload.get("resolved_turn")) {
                (Some(turn), None) | (None, Some(turn)) => turn,
                (Some(_), Some(_)) | (None, None) => return None,
            };
            (
                safe_nonnegative_value(payload.get("wave")?)?,
                safe_nonnegative_value(turn)?,
            )
        }
        AuthorityEntryKind::ReplacementCommit => {
            let (source_epoch, wave, turn) = replacement_address_of(payload)?;
            epoch = source_epoch;
            (wave, turn)
        }
        AuthorityEntryKind::InteractionCommit => {
            let envelope = payload.get("envelope")?.as_object()?;
            epoch = safe_positive_value(envelope.get("sessionEpoch")?)?;
            (
                safe_nonnegative_value(envelope.get("wave")?)?,
                safe_nonnegative_value(envelope.get("turn")?)?,
            )
        }
        AuthorityEntryKind::ControlCommit
        | AuthorityEntryKind::WaveAdvance
        | AuthorityEntryKind::TerminalCommit => (
            safe_nonnegative_value(payload.get("wave")?)?,
            safe_nonnegative_value(payload.get("turn")?)?,
        ),
    };
    if epoch == SafeU53::ZERO {
        return None;
    }
    Some(MechanicalAddress { epoch, wave, turn })
}

fn replacement_address_of(payload: &Map<String, Value>) -> Option<(SafeU53, SafeU53, SafeU53)> {
    if let Some(source) = payload.get("sourceAddress") {
        let source = source.as_object()?;
        let epoch = safe_positive_value(source.get("epoch")?)?;
        let wave = safe_nonnegative_value(source.get("wave")?)?;
        let turn = safe_nonnegative_value(source.get("turn")?)?;
        return Some((epoch, wave, turn));
    }

    let occurrence = payload.get("occurrence")?.as_object()?;
    let source = occurrence.get("source")?.as_object()?;
    let epoch = safe_positive_value(source.get("epoch")?)?;
    let wave = safe_nonnegative_value(source.get("wave")?)?;
    let turn = safe_nonnegative_value(source.get("resolved_turn")?)?;
    safe_nonnegative_value(source.get("turn_occurrence")?)?;
    Some((epoch, wave, turn))
}

fn safe_positive_value(value: &Value) -> Option<SafeU53> {
    let value = safe_u53_number(Some(value))?;
    if value == 0 {
        return None;
    }
    SafeU53::new(value).ok()
}

fn safe_nonnegative_value(value: &Value) -> Option<SafeU53> {
    let value = safe_u53_number(Some(value))?;
    SafeU53::new(value).ok()
}

#[derive(Clone, Copy)]
struct MechanicalAddress {
    epoch: SafeU53,
    wave: SafeU53,
    turn: SafeU53,
}

fn interaction_operation_kind_of_entry(kind: AuthorityEntryKind, material: &Value) -> Option<&str> {
    if kind != AuthorityEntryKind::InteractionCommit {
        return None;
    }
    let envelope = material.as_object()?.get("envelope")?.as_object()?;
    let operation = envelope.get("pendingOperation")?.as_object()?;
    let operation_kind = operation.get("kind")?.as_str()?;
    is_known_operation_kind(operation_kind).then_some(operation_kind)
}

fn is_exact_turn_resolve_prompt_entry(next: &AuthorityEntry) -> bool {
    if next.kind != AuthorityEntryKind::InteractionCommit {
        return false;
    }
    let Some(wrapper) = next.material.payload.as_object() else {
        return false;
    };
    let Some(envelope) = wrapper.get("envelope").and_then(Value::as_object) else {
        return false;
    };
    let Some(operation) = envelope.get("pendingOperation").and_then(Value::as_object) else {
        return false;
    };
    let Some(operation_kind) = operation.get("kind").and_then(Value::as_str) else {
        return false;
    };
    let Some(expected_surface) = turn_resolve_prompt_surface(operation_kind) else {
        return false;
    };
    let Some(payload) = operation.get("payload").and_then(Value::as_object) else {
        return false;
    };
    wrapper.get("kind").and_then(Value::as_str) == Some("OPERATION_ENVELOPE_V1")
        && envelope.get("logicalPhase").and_then(Value::as_str) == Some("TURN_RESOLVE")
        && operation.get("id").and_then(Value::as_str) == Some(next.operation_id.as_str())
        && wrapper.get("surfaceClass").and_then(Value::as_str) == Some(expected_surface)
        && operation.get("status").and_then(Value::as_str) == Some("applied")
        && payload.get("type").and_then(Value::as_str) == Some("prompt")
}

fn turn_resolve_prompt_surface(operation_kind: &str) -> Option<&'static str> {
    match operation_kind {
        "CATCH_FULL" => Some("op:catchFull"),
        "LEARN_MOVE" | "LEARN_MOVE_BATCH" => Some("op:learnMove"),
        "REVIVAL" => Some("op:revival"),
        _ => None,
    }
}

fn broad_wait_allows_control_commit_turn(
    material: &Value,
    next_turn: SafeU53,
    wait_turn: SafeU53,
    allow_same_turn_command: bool,
) -> bool {
    let Some(kind) = material
        .as_object()
        .and_then(|material| material.get("kind"))
        .and_then(Value::as_str)
    else {
        return false;
    };
    match kind {
        "interaction-open" => next_turn == wait_turn,
        "command-open" => {
            if allow_same_turn_command {
                next_turn == wait_turn
            } else {
                safe_successor_turn(next_turn, wait_turn)
            }
        }
        _ => false,
    }
}

fn is_authority_kind_name(value: &str) -> bool {
    matches!(
        value,
        "TURN_COMMIT"
            | "REPLACEMENT_COMMIT"
            | "INTERACTION_COMMIT"
            | "CONTROL_COMMIT"
            | "WAVE_ADVANCE"
            | "TERMINAL_COMMIT"
    )
}

fn is_known_surface(value: &str) -> bool {
    matches!(
        value,
        "op:ability"
            | "op:bargain"
            | "op:biome"
            | "op:catchFull"
            | "op:colosseum"
            | "op:learnMove"
            | "op:me"
            | "op:revival"
            | "op:reward"
            | "op:stormglass"
    )
}

fn is_known_operation_kind(value: &str) -> bool {
    matches!(
        value,
        "ABILITY_PRESENT"
            | "ABILITY_PICK"
            | "BARGAIN_PRESENT"
            | "BARGAIN"
            | "BIOME_PICK"
            | "CATCH_FULL"
            | "COLO_PICK"
            | "CROSSROADS_PICK"
            | "LEARN_MOVE"
            | "LEARN_MOVE_BATCH"
            | "ME_BUTTON"
            | "ME_PICK"
            | "ME_PRESENT"
            | "ME_SUB"
            | "ME_TERMINAL"
            | "QUIZ_ANSWER"
            | "REVIVAL"
            | "REWARD"
            | "REWARD_PRESENT"
            | "SHOP_BUY"
            | "SHOP_PRESENT"
            | "STORMGLASS_PRESENT"
            | "STORMGLASS"
    )
}

fn operation_kind_allows_surface(operation_kind: &str, surface: &str) -> bool {
    match operation_kind {
        "ABILITY_PRESENT" | "ABILITY_PICK" => surface == "op:ability",
        "BARGAIN_PRESENT" | "BARGAIN" => surface == "op:bargain",
        "BIOME_PICK" | "CROSSROADS_PICK" => surface == "op:biome",
        "CATCH_FULL" => surface == "op:catchFull",
        "COLO_PICK" => surface == "op:colosseum",
        "LEARN_MOVE" | "LEARN_MOVE_BATCH" => surface == "op:learnMove",
        "ME_BUTTON" | "ME_PICK" | "ME_PRESENT" | "ME_SUB" | "QUIZ_ANSWER" => surface == "op:me",
        "ME_TERMINAL" => matches!(surface, "op:me" | "op:reward" | "op:biome"),
        "REVIVAL" => surface == "op:revival",
        "REWARD" | "REWARD_PRESENT" | "SHOP_BUY" | "SHOP_PRESENT" => surface == "op:reward",
        "STORMGLASS_PRESENT" | "STORMGLASS" => surface == "op:stormglass",
        _ => false,
    }
}
