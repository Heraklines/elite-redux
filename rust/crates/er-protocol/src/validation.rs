//! Total raw-first Authority V2 envelope validation.

use std::collections::BTreeSet;

use er_types::{
    AuthorityEntryBody, AuthorityReceiptBody, FRAME_PROTOCOL_VERSION, FrameContext, FrameType,
    NetworkFrame, RawFrame, RecoveryAppliedProof, RecoveryBundleBody, RecoveryRequestBody,
    TailRequestBody, TerminalFrameBody,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Map, Value};

const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "body", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidatedFrameBody {
    AuthorityEntry(AuthorityEntryBody),
    AuthorityReceipt(AuthorityReceiptBody),
    TailRequest(TailRequestBody),
    RecoveryRequest(RecoveryRequestBody),
    RecoveryBundle(RecoveryBundleBody),
    RecoveryApplied(RecoveryAppliedProof),
    Terminal(TerminalFrameBody),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedFrame {
    pub frame: NetworkFrame,
    pub body: ValidatedFrameBody,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum InboundFrameResult {
    Valid {
        frame: Box<ValidatedFrame>,
    },
    CosmeticDrop {
        reason: String,
    },
    ProtocolViolation {
        frame_type: Option<String>,
        issues: Vec<String>,
    },
}

#[derive(Clone, Copy, Debug, Default)]
pub struct FrameValidator;

impl FrameValidator {
    pub fn new() -> Self {
        Self
    }

    pub fn validate(&self, raw: &RawFrame) -> InboundFrameResult {
        validate_inbound_frame(raw)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum KnownFrameType {
    AuthorityEntry,
    AuthorityReceipt,
    TailRequest,
    RecoveryRequest,
    RecoveryBundle,
    RecoveryApplied,
    Terminal,
}

impl KnownFrameType {
    fn from_wire(value: &str) -> Option<Self> {
        match value {
            "authorityEntry" => Some(Self::AuthorityEntry),
            "authorityReceipt" => Some(Self::AuthorityReceipt),
            "tailRequest" => Some(Self::TailRequest),
            "recoveryRequest" => Some(Self::RecoveryRequest),
            "recoveryBundle" => Some(Self::RecoveryBundle),
            "recoveryApplied" => Some(Self::RecoveryApplied),
            "terminal" => Some(Self::Terminal),
            _ => None,
        }
    }

    fn wire_name(self) -> &'static str {
        match self {
            Self::AuthorityEntry => "authorityEntry",
            Self::AuthorityReceipt => "authorityReceipt",
            Self::TailRequest => "tailRequest",
            Self::RecoveryRequest => "recoveryRequest",
            Self::RecoveryBundle => "recoveryBundle",
            Self::RecoveryApplied => "recoveryApplied",
            Self::Terminal => "terminal",
        }
    }

    fn frame_type(self) -> FrameType {
        match self {
            Self::AuthorityEntry => FrameType::AuthorityEntry,
            Self::AuthorityReceipt => FrameType::AuthorityReceipt,
            Self::TailRequest => FrameType::TailRequest,
            Self::RecoveryRequest => FrameType::RecoveryRequest,
            Self::RecoveryBundle => FrameType::RecoveryBundle,
            Self::RecoveryApplied => FrameType::RecoveryApplied,
            Self::Terminal => FrameType::Terminal,
        }
    }
}

fn protocol_violation(frame_type: Option<String>, issues: Vec<String>) -> InboundFrameResult {
    InboundFrameResult::ProtocolViolation { frame_type, issues }
}

fn is_protocol_version(value: &Value) -> bool {
    value.as_f64().is_some_and(|version| {
        version.partial_cmp(&(FRAME_PROTOCOL_VERSION as f64)) == Some(std::cmp::Ordering::Equal)
    })
}

fn describe_version(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        Value::Array(_) | Value::Object(_) => "object".to_owned(),
    }
}

/// Classify a raw value in the same order as the TypeScript frame codec:
/// JSON decoding, object shape, version, frame tag, cosmetic tag, then body.
pub fn validate_inbound_frame(raw: &RawFrame) -> InboundFrameResult {
    let value = match raw {
        RawFrame::JsonText(text) => match serde_json::from_str::<Value>(text) {
            Ok(value) => value,
            Err(_) => return protocol_violation(None, vec!["malformed JSON".to_owned()]),
        },
        RawFrame::JsonValue(value) => value.clone(),
    };

    let Some(envelope) = value.as_object() else {
        return protocol_violation(None, vec!["frame is not a JSON object".to_owned()]);
    };

    let Some(version) = envelope.get("v") else {
        return protocol_violation(None, vec!["missing protocol version `v`".to_owned()]);
    };
    if !is_protocol_version(version) {
        return protocol_violation(
            None,
            vec![format!(
                "unsupported frame protocol version: {}",
                describe_version(version)
            )],
        );
    }

    let Some(frame_type_value) = envelope.get("t") else {
        return protocol_violation(
            None,
            vec!["frame type `t` is missing or not a string".to_owned()],
        );
    };
    let Some(frame_type_name) = frame_type_value.as_str() else {
        return protocol_violation(
            None,
            vec!["frame type `t` is missing or not a string".to_owned()],
        );
    };

    let Some(frame_type) = KnownFrameType::from_wire(frame_type_name) else {
        return InboundFrameResult::CosmeticDrop {
            reason: format!("unknown cosmetic frame type: {frame_type_name}"),
        };
    };

    validate_known_frame(frame_type, envelope.get("ctx"), envelope.get("body"))
}

fn validate_known_frame(
    frame_type: KnownFrameType,
    context_value: Option<&Value>,
    body_value: Option<&Value>,
) -> InboundFrameResult {
    let context_issues = match context_value {
        Some(value) => frame_context_issues(value),
        None => vec!["frame context is not an object".to_owned()],
    };
    let body_issues = body_issues_for(frame_type, body_value);

    if !context_issues.is_empty() || !body_issues.is_empty() {
        let mut issues = Vec::with_capacity(context_issues.len() + body_issues.len());
        issues.extend(
            context_issues
                .into_iter()
                .map(|issue| format!("ctx.{issue}")),
        );
        issues.extend(body_issues.into_iter().map(|issue| format!("body.{issue}")));
        return protocol_violation(Some(frame_type.wire_name().to_owned()), issues);
    }

    let Some(context_value) = context_value else {
        return protocol_violation(
            Some(frame_type.wire_name().to_owned()),
            vec!["ctx".to_owned()],
        );
    };
    let Ok(context) = serde_json::from_value::<FrameContext>(context_value.clone()) else {
        return protocol_violation(
            Some(frame_type.wire_name().to_owned()),
            vec!["ctx".to_owned()],
        );
    };

    let Some(body_value) = body_value else {
        return protocol_violation(
            Some(frame_type.wire_name().to_owned()),
            vec!["body".to_owned()],
        );
    };
    let Some(body) = deserialize_validated_body(frame_type, body_value) else {
        return protocol_violation(
            Some(frame_type.wire_name().to_owned()),
            vec!["body".to_owned()],
        );
    };

    InboundFrameResult::Valid {
        frame: Box::new(ValidatedFrame {
            frame: NetworkFrame {
                version: FRAME_PROTOCOL_VERSION,
                frame_type: frame_type.frame_type(),
                context,
                body: body_value.clone(),
            },
            body,
        }),
    }
}

fn deserialize_validated_body(
    frame_type: KnownFrameType,
    value: &Value,
) -> Option<ValidatedFrameBody> {
    fn decode<T: DeserializeOwned>(value: &Value) -> Option<T> {
        serde_json::from_value(value.clone()).ok()
    }

    match frame_type {
        KnownFrameType::AuthorityEntry => decode(value).map(ValidatedFrameBody::AuthorityEntry),
        KnownFrameType::AuthorityReceipt => decode(value).map(ValidatedFrameBody::AuthorityReceipt),
        KnownFrameType::TailRequest => decode(value).map(ValidatedFrameBody::TailRequest),
        KnownFrameType::RecoveryRequest => decode(value).map(ValidatedFrameBody::RecoveryRequest),
        KnownFrameType::RecoveryBundle => decode(value).map(ValidatedFrameBody::RecoveryBundle),
        KnownFrameType::RecoveryApplied => decode(value).map(ValidatedFrameBody::RecoveryApplied),
        KnownFrameType::Terminal => decode(value).map(ValidatedFrameBody::Terminal),
    }
}

pub fn frame_context_issues(value: &Value) -> Vec<String> {
    let Some(context) = value.as_object() else {
        return vec!["frame context is not an object".to_owned()];
    };

    let mut issues = Vec::new();
    if !is_non_empty_string(context.get("sessionId")) {
        issues.push("sessionId".to_owned());
    }
    if !is_non_empty_string(context.get("runId")) {
        issues.push("runId".to_owned());
    }
    if !is_non_negative_safe_integer(context.get("sessionEpoch")) {
        issues.push("sessionEpoch".to_owned());
    }
    if !is_non_empty_string(context.get("seatMapId")) {
        issues.push("seatMapId".to_owned());
    }
    if !is_non_negative_safe_integer(context.get("membershipRevision")) {
        issues.push("membershipRevision".to_owned());
    }
    if !is_non_negative_safe_integer(context.get("senderSeatId")) {
        issues.push("senderSeatId".to_owned());
    }
    if !is_non_negative_safe_integer(context.get("authoritySeatId")) {
        issues.push("authoritySeatId".to_owned());
    }
    if !is_non_negative_safe_integer(context.get("connectionGeneration")) {
        issues.push("connectionGeneration".to_owned());
    }
    issues
}

pub fn frame_contexts_equal(left: &FrameContext, right: &FrameContext) -> bool {
    left == right
}

pub fn frame_contexts_compatible(left: &FrameContext, right: &FrameContext) -> bool {
    left.session_id == right.session_id
        && left.run_id == right.run_id
        && left.session_epoch == right.session_epoch
        && left.seat_map_id == right.seat_map_id
        && left.membership_revision == right.membership_revision
}

fn is_non_empty_string(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::String(value)) if !value.is_empty())
}

fn safe_integer(value: Option<&Value>) -> Option<u64> {
    let Some(Value::Number(number)) = value else {
        return None;
    };

    if let Some(integer) = number.as_u64() {
        return (integer <= JS_MAX_SAFE_INTEGER).then_some(integer);
    }

    let float = number.as_f64()?;
    if !float.is_finite()
        || float < 0.0
        || float.fract().partial_cmp(&0.0) != Some(std::cmp::Ordering::Equal)
        || float > JS_MAX_SAFE_INTEGER as f64
    {
        return None;
    }
    Some(float as u64)
}

fn is_non_negative_safe_integer(value: Option<&Value>) -> bool {
    safe_integer(value).is_some()
}

fn is_positive_safe_integer(value: Option<&Value>) -> bool {
    safe_integer(value).is_some_and(|value| value > 0)
}

fn is_authority_entry_kind(value: Option<&Value>) -> bool {
    matches!(
        value.and_then(Value::as_str),
        Some(
            "TURN_COMMIT"
                | "REPLACEMENT_COMMIT"
                | "INTERACTION_COMMIT"
                | "CONTROL_COMMIT"
                | "WAVE_ADVANCE"
                | "TERMINAL_COMMIT"
        )
    )
}

fn is_interaction_surface(value: Option<&Value>) -> bool {
    matches!(
        value.and_then(Value::as_str),
        Some(
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
    )
}

fn is_interaction_operation_kind(value: Option<&Value>) -> bool {
    matches!(
        value.and_then(Value::as_str),
        Some(
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
    )
}

fn interaction_surface_matches_kind(operation_kind: &str, surface: &str) -> bool {
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

fn json_values_strict_equal(left: Option<&Value>, right: Option<&Value>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(Value::Null), Some(Value::Null)) => true,
        (Some(Value::Bool(left)), Some(Value::Bool(right))) => left == right,
        (Some(Value::String(left)), Some(Value::String(right))) => left == right,
        (Some(Value::Number(left)), Some(Value::Number(right))) => left
            .as_f64()
            .zip(right.as_f64())
            .is_some_and(|(left, right)| {
                left.partial_cmp(&right) == Some(std::cmp::Ordering::Equal)
            }),
        // JavaScript compares arrays and objects by identity. Distinct JSON
        // fields cannot share identity, so two structured values are unequal.
        _ => false,
    }
}

fn js_string(value: Option<&Value>) -> String {
    match value {
        None => "undefined".to_owned(),
        Some(Value::Null) => "null".to_owned(),
        Some(Value::Bool(value)) => value.to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::String(value)) => value.clone(),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| match value {
                Value::Null => String::new(),
                _ => js_string(Some(value)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".to_owned(),
    }
}

fn material_issues(value: Option<&Value>) -> Vec<String> {
    let Some(material) = value.and_then(Value::as_object) else {
        return vec!["material: not an object".to_owned()];
    };

    let mut issues = Vec::new();
    if !is_non_empty_string(material.get("digest")) {
        issues.push("material.digest".to_owned());
    }
    if !material.contains_key("payload") {
        issues.push("material.payload".to_owned());
    }
    issues
}

fn command_frontier_issues(control: &Map<String, Value>) -> Vec<String> {
    let mut issues = Vec::new();
    if !is_positive_safe_integer(control.get("epoch")) {
        issues.push("epoch".to_owned());
    }
    if !is_positive_safe_integer(control.get("wave")) {
        issues.push("wave".to_owned());
    }
    if !is_positive_safe_integer(control.get("turn")) {
        issues.push("turn".to_owned());
    }

    let Some(commands) = control.get("commands").and_then(Value::as_array) else {
        issues.push("commands".to_owned());
        return issues;
    };
    if commands.is_empty() {
        issues.push("commands".to_owned());
        return issues;
    }

    let mut seen_fields = BTreeSet::new();
    for (index, command_value) in commands.iter().enumerate() {
        let Some(command) = command_value.as_object() else {
            issues.push(format!("commands[{index}]"));
            continue;
        };
        if !is_non_negative_safe_integer(command.get("ownerSeatId")) {
            issues.push(format!("commands[{index}].ownerSeatId"));
        }
        if !is_positive_safe_integer(command.get("pokemonId")) {
            issues.push(format!("commands[{index}].pokemonId"));
        }
        if !is_non_negative_safe_integer(command.get("fieldIndex")) {
            issues.push(format!("commands[{index}].fieldIndex"));
        }
        if let Some(field_index) = safe_integer(command.get("fieldIndex"))
            && !seen_fields.insert(field_index)
        {
            issues.push(format!("commands[{index}].fieldIndex: duplicate"));
        }
    }
    issues
}

fn interaction_issues(control: &Map<String, Value>) -> Vec<String> {
    let mut issues = Vec::new();
    if !is_non_empty_string(control.get("operationId")) {
        issues.push("operationId".to_owned());
    }
    if !is_non_negative_safe_integer(control.get("ownerSeatId")) {
        issues.push("ownerSeatId".to_owned());
    }
    issues
}

fn replacement_control_issues(control: &Map<String, Value>) -> Vec<String> {
    let mut issues = interaction_issues(control);
    if !is_positive_safe_integer(control.get("epoch")) {
        issues.push("epoch".to_owned());
    }
    if !is_positive_safe_integer(control.get("wave")) {
        issues.push("wave".to_owned());
    }
    if !is_positive_safe_integer(control.get("turn")) {
        issues.push("turn".to_owned());
    }
    if !is_non_negative_safe_integer(control.get("occurrence")) {
        issues.push("occurrence".to_owned());
    }
    if !is_non_negative_safe_integer(control.get("fieldIndex")) {
        issues.push("fieldIndex".to_owned());
    }

    let Some(remaining) = control.get("remaining").and_then(Value::as_array) else {
        issues.push("remaining".to_owned());
        return issues;
    };

    let head_epoch = control.get("epoch");
    let head_wave = control.get("wave");
    let head_turn = control.get("turn");
    let mut prior_occurrence = safe_integer(control.get("occurrence"));
    let mut operation_ids = BTreeSet::new();
    if let Some(operation_id) = control.get("operationId").and_then(Value::as_str)
        && !operation_id.is_empty()
    {
        operation_ids.insert(operation_id.to_owned());
    }

    for (index, target_value) in remaining.iter().enumerate() {
        let Some(target) = target_value.as_object() else {
            issues.push(format!("remaining[{index}]"));
            continue;
        };
        if !is_non_empty_string(target.get("operationId")) {
            issues.push(format!("remaining[{index}].operationId"));
        }
        if !is_non_negative_safe_integer(target.get("ownerSeatId")) {
            issues.push(format!("remaining[{index}].ownerSeatId"));
        }
        if !is_positive_safe_integer(target.get("epoch")) {
            issues.push(format!("remaining[{index}].epoch"));
        }
        if !is_positive_safe_integer(target.get("wave")) {
            issues.push(format!("remaining[{index}].wave"));
        }
        if !is_positive_safe_integer(target.get("turn")) {
            issues.push(format!("remaining[{index}].turn"));
        }
        if !is_non_negative_safe_integer(target.get("occurrence")) {
            issues.push(format!("remaining[{index}].occurrence"));
        }
        if !is_non_negative_safe_integer(target.get("fieldIndex")) {
            issues.push(format!("remaining[{index}].fieldIndex"));
        }
        if !json_values_strict_equal(target.get("epoch"), head_epoch)
            || !json_values_strict_equal(target.get("wave"), head_wave)
            || !json_values_strict_equal(target.get("turn"), head_turn)
        {
            issues.push(format!("remaining[{index}]: boundary"));
        }
        if let Some(occurrence) = safe_integer(target.get("occurrence")) {
            if prior_occurrence.is_none_or(|prior| occurrence <= prior) {
                issues.push(format!("remaining[{index}].occurrence: order"));
            }
            prior_occurrence = Some(occurrence);
        }
        if let Some(operation_id) = target.get("operationId").and_then(Value::as_str)
            && !operation_id.is_empty()
            && !operation_ids.insert(operation_id.to_owned())
        {
            issues.push(format!("remaining[{index}].operationId: duplicate"));
        }
    }
    issues
}

fn shared_interaction_issues(control: &Map<String, Value>) -> Vec<String> {
    let mut issues = interaction_issues(control);
    if !is_positive_safe_integer(control.get("epoch")) {
        issues.push("epoch".to_owned());
    }
    if !is_non_negative_safe_integer(control.get("wave")) {
        issues.push("wave".to_owned());
    }
    if !is_non_negative_safe_integer(control.get("turn")) {
        issues.push("turn".to_owned());
    }

    let surface = control.get("surfaceClass").and_then(Value::as_str);
    let operation_kind = control.get("operationKind").and_then(Value::as_str);
    if !is_interaction_surface(control.get("surfaceClass")) {
        issues.push("surfaceClass".to_owned());
    }
    if !is_interaction_operation_kind(control.get("operationKind")) {
        issues.push("operationKind".to_owned());
    } else if let (Some(surface), Some(operation_kind)) = (surface, operation_kind)
        && is_interaction_surface(control.get("surfaceClass"))
        && !interaction_surface_matches_kind(operation_kind, surface)
    {
        issues.push("surfaceClass/operationKind".to_owned());
    }

    let Some(successor) = control.get("successor").and_then(Value::as_object) else {
        issues.push("successor".to_owned());
        return issues;
    };

    let Some(operation_kinds) = successor.get("operationKinds").and_then(Value::as_array) else {
        issues.push("successor.operationKinds".to_owned());
        return successor_operation_ids_issues(successor, issues);
    };
    if operation_kinds.is_empty() {
        issues.push("successor.operationKinds".to_owned());
    } else {
        let mut seen_kinds = BTreeSet::new();
        for (index, kind) in operation_kinds.iter().enumerate() {
            if !is_interaction_operation_kind(Some(kind)) {
                issues.push(format!("successor.operationKinds[{index}]"));
            } else if let Some(kind) = kind.as_str()
                && !seen_kinds.insert(kind.to_owned())
            {
                issues.push(format!("successor.operationKinds[{index}]: duplicate"));
            }
            if let Some(kind) = kind.as_str() {
                seen_kinds.insert(kind.to_owned());
            }
        }
    }
    successor_operation_ids_issues(successor, issues)
}

fn successor_operation_ids_issues(
    successor: &Map<String, Value>,
    mut issues: Vec<String>,
) -> Vec<String> {
    let operation_ids = successor.get("operationIds");
    if !matches!(operation_ids, Some(Value::Null)) {
        let Some(operation_ids) = operation_ids.and_then(Value::as_array) else {
            issues.push("successor.operationIds".to_owned());
            return issues;
        };
        if operation_ids.is_empty() {
            issues.push("successor.operationIds".to_owned());
        } else {
            let mut seen_ids = BTreeSet::new();
            for (index, operation_id) in operation_ids.iter().enumerate() {
                if !is_non_empty_string(Some(operation_id)) {
                    issues.push(format!("successor.operationIds[{index}]"));
                } else if let Some(operation_id) = operation_id.as_str()
                    && !seen_ids.insert(operation_id.to_owned())
                {
                    issues.push(format!("successor.operationIds[{index}]: duplicate"));
                }
                if let Some(operation_id) = operation_id.as_str() {
                    seen_ids.insert(operation_id.to_owned());
                }
            }
        }
    }
    issues
}

fn allowed_kinds_include(value: Option<&Value>, expected: &str) -> bool {
    value
        .and_then(Value::as_array)
        .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(expected)))
}

fn successor_wait_issues(control: &Map<String, Value>) -> Vec<String> {
    let mut issues = Vec::new();
    if !is_non_empty_string(control.get("afterOperationId")) {
        issues.push("afterOperationId".to_owned());
    }
    if !is_positive_safe_integer(control.get("epoch")) {
        issues.push("epoch".to_owned());
    }
    if !is_non_negative_safe_integer(control.get("wave")) {
        issues.push("wave".to_owned());
    }
    if !is_non_negative_safe_integer(control.get("turn")) {
        issues.push("turn".to_owned());
    }
    if !matches!(control.get("allowNextWaveStart"), Some(Value::Bool(_))) {
        issues.push("allowNextWaveStart".to_owned());
    }

    if let Some(allowed_kinds) = control.get("allowedKinds").and_then(Value::as_array) {
        if allowed_kinds.is_empty() {
            issues.push("allowedKinds".to_owned());
        } else {
            let mut seen = BTreeSet::new();
            for (index, kind) in allowed_kinds.iter().enumerate() {
                if !is_authority_entry_kind(Some(kind)) {
                    issues.push(format!("allowedKinds[{index}]"));
                } else if let Some(kind) = kind.as_str()
                    && !seen.insert(kind.to_owned())
                {
                    issues.push(format!("allowedKinds[{index}]: duplicate"));
                }
                if let Some(kind) = kind.as_str() {
                    seen.insert(kind.to_owned());
                }
            }
        }
    } else {
        issues.push("allowedKinds".to_owned());
    }

    if !matches!(control.get("expectedOperationId"), Some(Value::Null))
        && !is_non_empty_string(control.get("expectedOperationId"))
    {
        issues.push("expectedOperationId".to_owned());
    }

    successor_wait_address_issues(control, issues)
}

fn successor_wait_address_issues(
    control: &Map<String, Value>,
    mut issues: Vec<String>,
) -> Vec<String> {
    if let Some(addresses_value) = control.get("allowedInteractionAddresses") {
        let Some(addresses) = addresses_value.as_array() else {
            issues.push("allowedInteractionAddresses".to_owned());
            return successor_wait_control_addresses(control, issues);
        };
        if addresses.is_empty()
            || !allowed_kinds_include(control.get("allowedKinds"), "INTERACTION_COMMIT")
        {
            issues.push("allowedInteractionAddresses".to_owned());
        } else {
            let mut seen = BTreeSet::new();
            for (index, candidate_value) in addresses.iter().enumerate() {
                let Some(candidate) = candidate_value.as_object() else {
                    issues.push(format!("allowedInteractionAddresses[{index}]"));
                    continue;
                };
                let operation_kind = candidate.get("operationKind").and_then(Value::as_str);
                let surface = candidate.get("surfaceClass").and_then(Value::as_str);
                let key = format!(
                    "{}:{}:{}:{}",
                    js_string(candidate.get("surfaceClass")),
                    js_string(candidate.get("operationKind")),
                    js_string(candidate.get("wave")),
                    js_string(candidate.get("turn")),
                );
                let valid = operation_kind.is_some_and(is_interaction_operation_kind_str)
                    && surface.is_some_and(is_interaction_surface_str)
                    && operation_kind.zip(surface).is_some_and(|(kind, surface)| {
                        interaction_surface_matches_kind(kind, surface)
                    })
                    && is_non_negative_safe_integer(candidate.get("wave"))
                    && json_values_strict_equal(candidate.get("wave"), control.get("wave"))
                    && is_non_negative_safe_integer(candidate.get("turn"));
                if !valid {
                    issues.push(format!("allowedInteractionAddresses[{index}]"));
                } else if !seen.insert(key.clone()) {
                    issues.push(format!("allowedInteractionAddresses[{index}]: duplicate"));
                }
                seen.insert(key);
            }
        }
    }
    successor_wait_control_addresses(control, issues)
}

fn successor_wait_control_addresses(
    control: &Map<String, Value>,
    mut issues: Vec<String>,
) -> Vec<String> {
    if let Some(addresses_value) = control.get("allowedControlAddresses") {
        let Some(addresses) = addresses_value.as_array() else {
            issues.push("allowedControlAddresses".to_owned());
            return issues;
        };
        if addresses.is_empty()
            || !allowed_kinds_include(control.get("allowedKinds"), "CONTROL_COMMIT")
        {
            issues.push("allowedControlAddresses".to_owned());
        } else {
            let mut seen = BTreeSet::new();
            for (index, candidate_value) in addresses.iter().enumerate() {
                let Some(candidate) = candidate_value.as_object() else {
                    issues.push(format!("allowedControlAddresses[{index}]"));
                    continue;
                };
                let operation_id_valid = matches!(candidate.get("operationId"), Some(Value::Null))
                    || is_non_empty_string(candidate.get("operationId"));
                let candidate_wave = safe_integer(candidate.get("wave"));
                let control_wave = safe_integer(control.get("wave"));
                let allow_next_wave =
                    matches!(control.get("allowNextWaveStart"), Some(Value::Bool(true)));
                let wave_valid = candidate_wave.is_some_and(|wave| {
                    control_wave.is_some_and(|control_wave| {
                        wave == control_wave || (allow_next_wave && wave == control_wave + 1)
                    })
                });
                let key = format!(
                    "{}:{}:{}:{}",
                    js_string(candidate.get("materialKind")),
                    js_string(candidate.get("wave")),
                    js_string(candidate.get("turn")),
                    js_string(candidate.get("operationId")),
                );
                let material_kind_valid = matches!(
                    candidate.get("materialKind").and_then(Value::as_str),
                    Some("command-open" | "interaction-open")
                );
                let valid = material_kind_valid
                    && wave_valid
                    && is_positive_safe_integer(candidate.get("turn"))
                    && operation_id_valid;
                if !valid {
                    issues.push(format!("allowedControlAddresses[{index}]"));
                } else if !seen.insert(key.clone()) {
                    issues.push(format!("allowedControlAddresses[{index}]: duplicate"));
                }
                seen.insert(key);
            }
        }
    }
    issues
}

fn is_interaction_surface_str(value: &str) -> bool {
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

fn is_interaction_operation_kind_str(value: &str) -> bool {
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

fn terminal_issues(control: &Map<String, Value>) -> Vec<String> {
    if is_non_empty_string(control.get("terminalId")) {
        Vec::new()
    } else {
        vec!["terminalId".to_owned()]
    }
}

fn canonical_next_control_issues(value: Option<&Value>) -> Vec<String> {
    let Some(control) = value.and_then(Value::as_object) else {
        return vec!["not an object".to_owned()];
    };

    match control.get("kind").and_then(Value::as_str) {
        Some("COMMAND_FRONTIER") => command_frontier_issues(control),
        Some("REPLACEMENT") => replacement_control_issues(control),
        Some("SHARED_INTERACTION") => shared_interaction_issues(control),
        Some("AWAIT_SUCCESSOR") => successor_wait_issues(control),
        Some("TERMINAL") => terminal_issues(control),
        _ => vec!["kind: unknown control kind".to_owned()],
    }
}

fn mechanical_next_control_issues(value: Option<&Value>) -> Vec<String> {
    if matches!(value, Some(Value::Null)) {
        return vec!["nextControl: required".to_owned()];
    }
    canonical_next_control_issues(value)
        .into_iter()
        .map(|issue| format!("nextControl.{issue}"))
        .collect()
}

fn recovery_next_control_issues(value: Option<&Value>) -> Vec<String> {
    if matches!(value, Some(Value::Null)) {
        return Vec::new();
    }
    canonical_next_control_issues(value)
        .into_iter()
        .map(|issue| format!("nextControl.{issue}"))
        .collect()
}

fn entry_control_compatible(kind: Option<&Value>, control: Option<&Value>) -> bool {
    let Some(kind) = kind.and_then(Value::as_str) else {
        return false;
    };
    let Some(control_kind) = control
        .and_then(Value::as_object)
        .and_then(|control| control.get("kind"))
        .and_then(Value::as_str)
    else {
        return false;
    };
    if kind == "TERMINAL_COMMIT" {
        control_kind == "TERMINAL"
    } else {
        control_kind != "TERMINAL"
    }
}

fn authority_entry_body_issues(value: Option<&Value>) -> Vec<String> {
    let Some(body) = value.and_then(Value::as_object) else {
        return vec!["not an object".to_owned()];
    };

    let mut issues = Vec::new();
    if !is_positive_safe_integer(body.get("revision")) {
        issues.push("revision".to_owned());
    }
    if !is_non_empty_string(body.get("operationId")) {
        issues.push("operationId".to_owned());
    }
    if !is_authority_entry_kind(body.get("kind")) {
        issues.push("kind".to_owned());
    }
    issues.extend(material_issues(body.get("material")));

    let next_control = body.get("nextControl");
    issues.extend(mechanical_next_control_issues(next_control));
    let canonical_issues = canonical_next_control_issues(next_control);
    if is_authority_entry_kind(body.get("kind"))
        && canonical_issues.is_empty()
        && !entry_control_compatible(body.get("kind"), next_control)
    {
        issues.push("nextControl: incompatible with entry kind".to_owned());
    }

    let Some(subsumes) = body.get("subsumes").and_then(Value::as_array) else {
        issues.push("subsumes".to_owned());
        return issues;
    };
    if !subsumes
        .iter()
        .all(|revision| is_positive_safe_integer(Some(revision)))
    {
        issues.push("subsumes".to_owned());
    }
    issues
}

fn authority_receipt_body_issues(value: Option<&Value>) -> Vec<String> {
    let Some(body) = value.and_then(Value::as_object) else {
        return vec!["not an object".to_owned()];
    };

    let mut issues = Vec::new();
    if !is_non_negative_safe_integer(body.get("revision")) {
        issues.push("revision".to_owned());
    }
    if !is_non_empty_string(body.get("operationId")) {
        issues.push("operationId".to_owned());
    }
    if !matches!(
        body.get("stage").and_then(Value::as_str),
        Some("admitted" | "materialApplied" | "controlInstalled" | "presentationSettled")
    ) {
        issues.push("stage".to_owned());
    }
    if body.contains_key("controlId") && !is_non_empty_string(body.get("controlId")) {
        issues.push("controlId".to_owned());
    }
    issues
}

fn tail_request_body_issues(value: Option<&Value>) -> Vec<String> {
    let Some(body) = value.and_then(Value::as_object) else {
        return vec!["not an object".to_owned()];
    };
    if is_non_negative_safe_integer(body.get("fromRevision")) {
        Vec::new()
    } else {
        vec!["fromRevision".to_owned()]
    }
}

fn recovery_request_body_issues(value: Option<&Value>) -> Vec<String> {
    let Some(body) = value.and_then(Value::as_object) else {
        return vec!["not an object".to_owned()];
    };

    let mut issues = Vec::new();
    if !is_non_empty_string(body.get("requestId")) {
        issues.push("requestId".to_owned());
    }
    if !is_non_negative_safe_integer(body.get("capturedFrontier")) {
        issues.push("capturedFrontier".to_owned());
    }
    if !is_non_empty_string(body.get("reason")) {
        issues.push("reason".to_owned());
    }
    issues
}

fn recovery_bundle_body_issues(value: Option<&Value>) -> Vec<String> {
    let Some(body) = value.and_then(Value::as_object) else {
        return vec!["not an object".to_owned()];
    };

    let mut issues = Vec::new();
    if !is_non_empty_string(body.get("requestId")) {
        issues.push("requestId".to_owned());
    }
    issues.extend(material_issues(body.get("material")));

    let frontier = safe_integer(body.get("frontier"));
    if frontier.is_none() {
        issues.push("frontier".to_owned());
    }
    if frontier.is_none() {
        issues.push("frontierOperationId".to_owned());
    } else if frontier == Some(0) {
        if !matches!(body.get("frontierOperationId"), Some(Value::Null)) {
            issues.push("frontierOperationId".to_owned());
        }
    } else if !is_non_empty_string(body.get("frontierOperationId")) {
        issues.push("frontierOperationId".to_owned());
    }
    if !is_non_negative_safe_integer(body.get("membershipRevision")) {
        issues.push("membershipRevision".to_owned());
    }

    if frontier == Some(0) {
        if !matches!(body.get("nextControl"), Some(Value::Null)) {
            issues.push("nextControl: must be null at frontier zero".to_owned());
        }
    } else if frontier.is_some() {
        issues.extend(mechanical_next_control_issues(body.get("nextControl")));
    } else {
        issues.extend(recovery_next_control_issues(body.get("nextControl")));
    }

    let Some(required_tail) = body.get("requiredTail").and_then(Value::as_array) else {
        issues.push("requiredTail".to_owned());
        return issues;
    };
    for (index, entry) in required_tail.iter().enumerate() {
        for issue in authority_entry_body_issues(Some(entry)) {
            issues.push(format!("requiredTail[{index}].{issue}"));
        }
    }
    issues
}

fn recovery_applied_body_issues(value: Option<&Value>) -> Vec<String> {
    let Some(body) = value.and_then(Value::as_object) else {
        return vec!["not an object".to_owned()];
    };

    let mut issues = Vec::new();
    if !is_non_empty_string(body.get("requestId")) {
        issues.push("requestId".to_owned());
    }
    if !is_non_negative_safe_integer(body.get("frontier")) {
        issues.push("frontier".to_owned());
    }
    if !is_non_empty_string(body.get("materialDigest")) {
        issues.push("materialDigest".to_owned());
    }
    if body.contains_key("controlId") && !is_non_empty_string(body.get("controlId")) {
        issues.push("controlId".to_owned());
    }
    issues
}

fn terminal_body_issues(value: Option<&Value>) -> Vec<String> {
    let Some(body) = value.and_then(Value::as_object) else {
        return vec!["not an object".to_owned()];
    };

    let mut issues = Vec::new();
    if !is_non_empty_string(body.get("terminalId")) {
        issues.push("terminalId".to_owned());
    }
    if !is_non_empty_string(body.get("reason")) {
        issues.push("reason".to_owned());
    }
    issues
}

fn body_issues_for(frame_type: KnownFrameType, body: Option<&Value>) -> Vec<String> {
    match frame_type {
        KnownFrameType::AuthorityEntry => authority_entry_body_issues(body),
        KnownFrameType::AuthorityReceipt => authority_receipt_body_issues(body),
        KnownFrameType::TailRequest => tail_request_body_issues(body),
        KnownFrameType::RecoveryRequest => recovery_request_body_issues(body),
        KnownFrameType::RecoveryBundle => recovery_bundle_body_issues(body),
        KnownFrameType::RecoveryApplied => recovery_applied_body_issues(body),
        KnownFrameType::Terminal => terminal_body_issues(body),
    }
}
