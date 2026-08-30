//! Frozen M8 browser worker request, response, effect, and fault schemas.

use er_types::{RawInputEvent, SafeU53};
use serde::{Deserialize, Serialize};

pub const BROWSER_WORKER_PROTOCOL_VERSION_V1: u32 = 1;
pub const MAXIMUM_BROWSER_REQUEST_BYTES_V1: usize = 1_048_576;
pub const MAXIMUM_BROWSER_EFFECT_BYTES_V1: usize = 4_194_304;
pub const MAXIMUM_BROWSER_BATCH_REQUESTS_V1: usize = 256;
pub const MAXIMUM_BROWSER_PENDING_REQUESTS_V1: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BrowserVisibilityV1 {
    Hidden,
    Visible,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationSettlementOutcomeV1 {
    Settled,
    IntentionallySkipped,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BrowserExecutionModeV1 {
    #[serde(rename = "LEGACY_TYPESCRIPT")]
    LegacyTypeScript,
    #[serde(rename = "TYPESCRIPT_WITH_RUST_SHADOW")]
    TypeScriptWithRustShadow,
    RustLocalAuthority,
    RustStagingAuthority,
    RustProductionAuthority,
    RustCanaryAuthority,
    RustShadowSample,
    LegacyTransition,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum BrowserLifecycleEventV1 {
    VisibilityChanged(BrowserVisibilityV1),
    PageHidden,
    PageShown,
    PageFreeze,
    PageResume,
    BeforeUnload,
    NetworkOnline,
    NetworkOffline,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserInitV1 {
    pub mode: BrowserExecutionModeV1,
    pub execution_identity_bytes: Vec<u8>,
    pub session_start_bytes: Vec<u8>,
    pub maximum_pending_requests: usize,
    #[serde(default)]
    pub production_release_id: Option<String>,
    #[serde(default)]
    pub production_generation: Option<SafeU53>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum BrowserRequestV1 {
    Initialize(BrowserInitV1),
    RawInput(RawInputEvent),
    AdvanceTime(SafeU53),
    TimerWakeup {
        monotonic_micros: SafeU53,
    },
    NetworkFrame {
        generation: SafeU53,
        bytes: Vec<u8>,
    },
    TransportChanged {
        generation: SafeU53,
        connected: bool,
    },
    StorageResult {
        request_id: SafeU53,
        bytes: Vec<u8>,
    },
    PresentationSettled {
        event_id: String,
        outcome: PresentationSettlementOutcomeV1,
    },
    Lifecycle(BrowserLifecycleEventV1),
    Observe {
        profile: String,
    },
    Snapshot,
    ExportRepro,
    Dispose,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserRequestEnvelopeV1 {
    pub version: u32,
    pub request_id: SafeU53,
    pub sequence: SafeU53,
    pub request: BrowserRequestV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum BrowserEffectV1 {
    UiChanged(Vec<u8>),
    Presentation(Vec<u8>),
    PresentationSceneChanged(Vec<u8>),
    SendNetworkFrame { generation: SafeU53, bytes: Vec<u8> },
    StorageRequest(Vec<u8>),
    AssetRequest(Vec<u8>),
    AudioCue(Vec<u8>),
    Terminal(Vec<u8>),
    Telemetry(Vec<u8>),
    ReproReady(Vec<u8>),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserEffectBatchV1 {
    pub external_sequence: SafeU53,
    pub effects: Vec<BrowserEffectV1>,
    pub observation_bytes: Vec<u8>,
    pub next_wakeup_micros: Option<SafeU53>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserKernelFaultV1 {
    pub code: String,
    pub message: String,
    pub normalized_panic: Option<String>,
    pub repro_reference: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum BrowserResponseV1 {
    Ready { identity_bytes: Vec<u8> },
    Effects(BrowserEffectBatchV1),
    Observation(Vec<u8>),
    Snapshot(Vec<u8>),
    Repro(Vec<u8>),
    Fault(BrowserKernelFaultV1),
    Disposed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserResponseEnvelopeV1 {
    pub version: u32,
    pub request_id: SafeU53,
    pub accepted_sequence: SafeU53,
    pub after_mechanical_digest: String,
    pub response: BrowserResponseV1,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        BROWSER_WORKER_PROTOCOL_VERSION_V1, BrowserExecutionModeV1, BrowserInitV1,
        BrowserRequestEnvelopeV1, BrowserRequestV1,
    };
    use er_types::SafeU53;

    #[test]
    fn execution_mode_wire_names_match_the_browser_contract()
    -> Result<(), Box<dyn std::error::Error>> {
        assert_eq!(
            serde_json::to_value(BrowserExecutionModeV1::LegacyTypeScript)?,
            json!("LEGACY_TYPESCRIPT")
        );
        assert_eq!(
            serde_json::to_value(BrowserExecutionModeV1::TypeScriptWithRustShadow)?,
            json!("TYPESCRIPT_WITH_RUST_SHADOW")
        );
        Ok(())
    }

    #[test]
    fn unit_request_encoding_is_closed_and_versioned() -> Result<(), Box<dyn std::error::Error>> {
        let envelope = BrowserRequestEnvelopeV1 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
            request_id: SafeU53::new(1)?,
            sequence: SafeU53::new(1)?,
            request: BrowserRequestV1::Snapshot,
        };
        assert_eq!(
            serde_json::to_value(envelope)?,
            json!({
                "version": 1,
                "request_id": 1,
                "sequence": 1,
                "request": {"kind": "SNAPSHOT"}
            })
        );
        Ok(())
    }

    #[test]
    fn legacy_m8_initialize_defaults_production_identity_fields()
    -> Result<(), Box<dyn std::error::Error>> {
        let value: BrowserInitV1 = serde_json::from_value(json!({
            "mode": "RUST_STAGING_AUTHORITY",
            "execution_identity_bytes": [1],
            "session_start_bytes": [2],
            "maximum_pending_requests": 8
        }))?;
        assert_eq!(value.production_release_id, None);
        assert_eq!(value.production_generation, None);
        Ok(())
    }
}
