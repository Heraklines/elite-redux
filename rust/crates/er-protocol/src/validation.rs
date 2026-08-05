//! Total raw-first Authority V2 envelope validation.

use er_types::{
    AuthorityEntryBody, AuthorityReceiptBody, FrameContext, NetworkFrame, RawFrame,
    RecoveryAppliedProof, RecoveryBundleBody, RecoveryRequestBody, TailRequestBody,
    TerminalFrameBody,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    Valid { frame: ValidatedFrame },
    CosmeticDrop { reason: String },
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

pub fn validate_inbound_frame(_raw: &RawFrame) -> InboundFrameResult {
    InboundFrameResult::ProtocolViolation {
        frame_type: None,
        issues: vec!["frame validator implementation pending".to_owned()],
    }
}

pub fn frame_context_issues(_value: &Value) -> Vec<String> {
    vec!["frame context validator implementation pending".to_owned()]
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
