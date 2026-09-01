//! Eventwise native/Wasm parity boundary for the M9 Engineering V7 kernel.

use std::sync::Arc;

use er_canonical::{canonicalize, content_digest};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::GameKernelV7;
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_state::m7_state::ProfileStateV1;
use er_types::input::RawInputEvent;
use er_types::{GameControlKindV2, SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

pub const M9E_PARITY_REPORT_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M9EParityRequestV1 {
    pub bundle: GameContentBundleV2,
    pub profile: ProfileStateV1,
    pub seed: String,
    pub local_seat: SeatId,
    pub save_slots: Vec<String>,
    pub local_is_host: bool,
    pub events: Vec<RawInputEvent>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M9EParityObservationV1 {
    pub sequence: SafeU53,
    pub input_digest: String,
    pub effect_digest: String,
    pub internal_event_digest: String,
    pub mechanical_state_digest: String,
    pub kernel_determinism_digest: String,
    pub control_kind: Option<GameControlKindV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct M9EParityReportV1 {
    pub schema_version: u32,
    pub content_identity_digest: String,
    pub observations: Vec<M9EParityObservationV1>,
    pub final_snapshot_digest: String,
}

pub fn replay_m9e_eventwise_native(
    request: M9EParityRequestV1,
) -> Result<M9EParityReportV1, String> {
    let content = Arc::new(
        PreparedGameContentV2::prepare(Arc::new(request.bundle))
            .map_err(|error| error.to_string())?,
    );
    let content_identity_digest =
        content_digest(content.identity()).map_err(|error| error.to_string())?;
    let mut kernel = GameKernelV7::natural_start(
        request.profile,
        request.seed,
        request.local_seat,
        request.save_slots,
        request.local_is_host,
        content,
        KernelSchedulerSnapshotV2 {
            next_timer_id: None,
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        None,
    )
    .map_err(|error| error.to_string())?;

    let mut observations = Vec::with_capacity(request.events.len());
    for (index, event) in request.events.into_iter().enumerate() {
        let input_digest = content_digest(&event).map_err(|error| error.to_string())?;
        let step = kernel.raw_input(event).map_err(|error| error.to_string())?;
        let snapshot = kernel.snapshot().map_err(|error| error.to_string())?;
        observations.push(M9EParityObservationV1 {
            sequence: SafeU53::new((index + 1) as u64).map_err(|error| error.to_string())?,
            input_digest,
            effect_digest: content_digest(&step.effects).map_err(|error| error.to_string())?,
            internal_event_digest: content_digest(&step.internal_events)
                .map_err(|error| error.to_string())?,
            mechanical_state_digest: content_digest(&kernel.state())
                .map_err(|error| error.to_string())?,
            kernel_determinism_digest: content_digest(&snapshot)
                .map_err(|error| error.to_string())?,
            control_kind: kernel.current_control().map(|control| control.kind),
        });
    }
    let final_snapshot = kernel.snapshot().map_err(|error| error.to_string())?;
    Ok(M9EParityReportV1 {
        schema_version: M9E_PARITY_REPORT_SCHEMA_VERSION_V1,
        content_identity_digest,
        observations,
        final_snapshot_digest: content_digest(&final_snapshot)
            .map_err(|error| error.to_string())?,
    })
}

#[wasm_bindgen]
pub fn replay_m9e_eventwise_json(input: &str) -> Result<String, JsValue> {
    let request: M9EParityRequestV1 = serde_json::from_str(input).map_err(js_error)?;
    let report = replay_m9e_eventwise_native(request).map_err(js_error)?;
    canonicalize(&report).map_err(js_error)
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
