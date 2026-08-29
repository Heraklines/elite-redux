//! Typed Authority V2 bodies and recovery state shared by the protocol kernel.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, de};
use serde_json::Value;
use thiserror::Error;

use crate::{
    AckStage, AuthorityEntry, AuthorityEntryKind, ConnectionGeneration, FrameContext, Material,
    MembershipRevision, NextControl, OperationId, Revision, SeatId,
};

const JS_MAX_SAFE_SIGNED_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct SafeI53(i64);

impl SafeI53 {
    pub const ZERO: Self = Self(0);
    pub const MIN: Self = Self(-JS_MAX_SAFE_SIGNED_INTEGER);
    pub const MAX: Self = Self(JS_MAX_SAFE_SIGNED_INTEGER);

    pub fn new(value: i64) -> Result<Self, SafeI53Error> {
        if !(-JS_MAX_SAFE_SIGNED_INTEGER..=JS_MAX_SAFE_SIGNED_INTEGER).contains(&value) {
            Err(SafeI53Error { value })
        } else {
            Ok(Self(value))
        }
    }

    pub const fn get(self) -> i64 {
        self.0
    }

    pub const fn into_inner(self) -> i64 {
        self.0
    }
}

impl<'de> Deserialize<'de> for SafeI53 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(SafeI53Visitor)
    }
}

struct SafeI53Visitor;

impl<'de> de::Visitor<'de> for SafeI53Visitor {
    type Value = SafeI53;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a signed JavaScript-safe integer")
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        SafeI53::new(value).map_err(E::custom)
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let value = i64::try_from(value).map_err(E::custom)?;
        self.visit_i64(value)
    }

    fn visit_i128<E>(self, value: i128) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let value = i64::try_from(value).map_err(E::custom)?;
        self.visit_i64(value)
    }

    fn visit_u128<E>(self, value: u128) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let value = i64::try_from(value).map_err(E::custom)?;
        self.visit_i64(value)
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        let safe_bound = JS_MAX_SAFE_SIGNED_INTEGER as f64;
        if !value.is_finite()
            || value.fract() != 0.0
            || !(-safe_bound..=safe_bound).contains(&value)
        {
            return Err(E::custom(format_args!(
                "{value} is not a signed JavaScript-safe integer"
            )));
        }
        self.visit_i64(value as i64)
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("{value} is outside JavaScript's signed safe-integer range")]
pub struct SafeI53Error {
    pub value: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RawFrame {
    JsonText(String),
    JsonValue(Value),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalMessage {
    pub operation_id: OperationId,
    pub fingerprint: String,
    pub from: SeatId,
    pub to: SeatId,
    pub connection_generation: ConnectionGeneration,
    pub payload: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NetworkPayload {
    Frame(RawFrame),
    Proposal(ProposalMessage),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum MaterialApplicationOutcome {
    Applied,
    Deferred,
    Rejected { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ControlProjectionOutcome {
    Installed { control_id: String },
    AlreadyInstalled { control_id: String },
    Deferred,
    Rejected { reason: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityEntryBody {
    pub revision: Revision,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
    pub material: Material,
    pub next_control: NextControl,
    pub subsumes: Vec<Revision>,
}

impl AuthorityEntryBody {
    pub fn with_context(self, context: FrameContext) -> AuthorityEntry {
        AuthorityEntry {
            context,
            revision: self.revision,
            operation_id: self.operation_id,
            kind: self.kind,
            material: self.material,
            next_control: self.next_control,
            subsumes: self.subsumes,
        }
    }
}

impl From<&AuthorityEntry> for AuthorityEntryBody {
    fn from(entry: &AuthorityEntry) -> Self {
        Self {
            revision: entry.revision,
            operation_id: entry.operation_id.clone(),
            kind: entry.kind,
            material: entry.material.clone(),
            next_control: entry.next_control.clone(),
            subsumes: entry.subsumes.clone(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityReceiptBody {
    pub revision: Revision,
    pub operation_id: OperationId,
    pub stage: AckStage,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub control_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TailRequestBody {
    pub from_revision: Revision,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub request_id: Option<OperationId>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub candidate_revision: Option<Revision>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub candidate_operation_id: Option<OperationId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TailProofPhase {
    Manifest,
    Complete,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TailProofBody {
    pub phase: TailProofPhase,
    pub request_id: OperationId,
    pub from_revision: Revision,
    pub candidate_revision: Revision,
    pub candidate_operation_id: OperationId,
    pub head_revision: Revision,
    pub source_revisions: Vec<Revision>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryRequestBody {
    pub request_id: String,
    pub captured_frontier: Revision,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryBundleBody {
    pub request_id: String,
    pub material: Material,
    pub frontier: Revision,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub frontier_operation_id: Option<OperationId>,
    pub membership_revision: MembershipRevision,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub next_control: Option<NextControl>,
    pub required_tail: Vec<AuthorityEntryBody>,
}

impl RecoveryBundleBody {
    pub fn with_context(self, context: FrameContext) -> RecoveryBundle {
        let required_tail = self
            .required_tail
            .into_iter()
            .map(|entry| entry.with_context(context.clone()))
            .collect();
        RecoveryBundle {
            request_id: self.request_id,
            context,
            material: self.material,
            frontier: self.frontier,
            frontier_operation_id: self.frontier_operation_id,
            membership_revision: self.membership_revision,
            next_control: self.next_control,
            required_tail,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryBundle {
    pub request_id: String,
    pub context: FrameContext,
    pub material: Material,
    pub frontier: Revision,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub frontier_operation_id: Option<OperationId>,
    pub membership_revision: MembershipRevision,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub next_control: Option<NextControl>,
    pub required_tail: Vec<AuthorityEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityRecoverySlice {
    pub frontier: Revision,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub frontier_operation_id: Option<OperationId>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub next_control: Option<NextControl>,
    pub required_tail: Vec<AuthorityEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryAppliedProof {
    pub request_id: String,
    pub frontier: Revision,
    pub material_digest: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub control_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalFrameBody {
    pub terminal_id: String,
    pub reason: String,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityFrontier {
    pub received: Revision,
    pub material: Revision,
    pub control: Revision,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecoveryPhase {
    FenceAcquired,
    FrontierCaptured,
    Requested,
    Validated,
    MaterialApplied,
    FrontierInstalled,
    ControlInstalled,
    Acked,
    Released,
    Terminalized,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecoveryFenceState {
    Open,
    Held,
    Terminal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryFenceView {
    pub state: RecoveryFenceState,
    pub command_admission_frozen: bool,
    pub control_surface_start_frozen: bool,
    pub progression_frozen: bool,
    pub materialization_frozen: bool,
    pub authority_wait_creation_frozen: bool,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub terminal_reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredFrontierTerminal {
    pub operation_id: OperationId,
    pub next_control: NextControl,
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod safe_i53_tests {
    use super::*;

    #[test]
    fn serde_accepts_javascript_integral_number_forms() -> Result<(), serde_json::Error> {
        for (input, expected) in [
            ("-9.007199254740991e15", -JS_MAX_SAFE_SIGNED_INTEGER),
            ("-9007199254740991", -JS_MAX_SAFE_SIGNED_INTEGER),
            ("-9007199254740991.0", -JS_MAX_SAFE_SIGNED_INTEGER),
            ("-9007199254740991.1", -JS_MAX_SAFE_SIGNED_INTEGER),
            ("-1e0", -1),
            ("-1e-400", 0),
            ("-0", 0),
            ("-0.0", 0),
            ("0.0", 0),
            ("0e0", 0),
            ("1.0", 1),
            ("1e0", 1),
            ("1e-400", 0),
            ("9007199254740990.5", JS_MAX_SAFE_SIGNED_INTEGER - 1),
            ("9007199254740991.1", JS_MAX_SAFE_SIGNED_INTEGER),
            ("9007199254740991.0", JS_MAX_SAFE_SIGNED_INTEGER),
            ("9.007199254740991e15", JS_MAX_SAFE_SIGNED_INTEGER),
        ] {
            let decoded: SafeI53 = serde_json::from_str(input)?;
            assert_eq!(decoded.get(), expected, "input: {input}");
            assert_eq!(serde_json::to_string(&decoded)?, expected.to_string());
        }
        Ok(())
    }

    #[test]
    fn serde_rejects_non_integral_and_out_of_range_numbers() {
        for input in [
            "-9007199254740992",
            "9007199254740992",
            "9007199254740991.5",
            "1.5",
            "1e400",
            "\"1\"",
            "true",
            "null",
            "[]",
            "{}",
        ] {
            assert!(
                serde_json::from_str::<SafeI53>(input).is_err(),
                "accepted {input}"
            );
        }
    }
}
