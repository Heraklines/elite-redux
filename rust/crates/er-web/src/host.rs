//! Browser Wasm owner over the production M7 game kernel.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_canonical::{canonical_bytes, content_digest};
use er_game::m7_content::{GameContentBundleV1, PreparedGameContentV1};
use er_game::m7_material::mechanical_digest;
use er_kernel::game_kernel_v6::GameKernelV6;
use er_kernel::snapshot_v6::RestorableKernelSnapshotV6;
use er_types::SafeU53;
use serde_json::{Value, json};
use thiserror::Error;
use wasm_bindgen::prelude::*;

use crate::contracts::{
    BROWSER_WORKER_PROTOCOL_VERSION_V1, BrowserEffectBatchV1, BrowserEffectV1,
    BrowserExecutionModeV1, BrowserRequestEnvelopeV1, BrowserRequestV1, BrowserResponseEnvelopeV1,
    BrowserResponseV1,
};

const MAXIMUM_REQUEST_BYTES: usize = 1_048_576;
const MAXIMUM_RESPONSE_BYTES: usize = 4_194_304;
const MAXIMUM_BATCH_REQUESTS: usize = 256;
const MAXIMUM_LEDGER_ENTRIES: usize = 2_048;

#[derive(Clone, Debug)]
struct RetainedRequestV1 {
    fingerprint: String,
    response: BrowserResponseEnvelopeV1,
}

#[derive(Debug, Error)]
pub enum BrowserWebErrorV1 {
    #[error("browser message is empty, oversized, malformed, or versioned incorrectly")]
    InvalidMessage,
    #[error("browser request sequence is stale, conflicting, or non-monotonic")]
    Sequence,
    #[error("browser initialization identity differs from the loaded content or snapshot")]
    Identity,
    #[error("browser host is disposed")]
    Disposed,
    #[error("browser kernel transition failed: {0}")]
    Kernel(String),
    #[error("browser canonical encoding failed: {0}")]
    Canonical(String),
}

#[wasm_bindgen]
#[derive(Debug)]
pub struct BrowserKernelHostV1 {
    kernel: Option<GameKernelV6>,
    content_identity_bytes: Vec<u8>,
    initial_snapshot_bytes: Vec<u8>,
    accepted_sequence: SafeU53,
    retained: BTreeMap<SafeU53, RetainedRequestV1>,
    last_wakeup_micros: SafeU53,
}

#[wasm_bindgen]
impl BrowserKernelHostV1 {
    pub fn create(content_bytes: &[u8], init_bytes: &[u8]) -> Result<BrowserKernelHostV1, JsValue> {
        validate_bytes(content_bytes, MAXIMUM_RESPONSE_BYTES).map_err(js_error)?;
        validate_bytes(init_bytes, MAXIMUM_RESPONSE_BYTES).map_err(js_error)?;
        let bundle: GameContentBundleV1 = serde_json::from_slice(content_bytes)
            .map_err(|_| js_error(BrowserWebErrorV1::InvalidMessage))?;
        let content = Arc::new(
            PreparedGameContentV1::prepare(Arc::new(bundle))
                .map_err(|error| js_error(BrowserWebErrorV1::Kernel(error.to_string())))?,
        );
        let snapshot: RestorableKernelSnapshotV6 = serde_json::from_slice(init_bytes)
            .map_err(|_| js_error(BrowserWebErrorV1::InvalidMessage))?;
        let kernel = GameKernelV6::from_snapshot(snapshot, content.clone())
            .map_err(|error| js_error(BrowserWebErrorV1::Kernel(error.to_string())))?;
        let content_identity_bytes = canonical_bytes(content.identity())
            .map_err(|error| js_error(BrowserWebErrorV1::Canonical(error.to_string())))?;
        let initial_snapshot_bytes = canonical_bytes(&kernel.snapshot())
            .map_err(|error| js_error(BrowserWebErrorV1::Canonical(error.to_string())))?;
        Ok(Self {
            kernel: Some(kernel),
            content_identity_bytes,
            initial_snapshot_bytes,
            accepted_sequence: SafeU53::ZERO,
            retained: BTreeMap::new(),
            last_wakeup_micros: SafeU53::ZERO,
        })
    }

    pub fn dispatch_batch(&mut self, request_bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
        self.dispatch_batch_inner(request_bytes).map_err(js_error)
    }

    pub fn snapshot(&self) -> Result<Vec<u8>, JsValue> {
        let kernel = self
            .kernel
            .as_ref()
            .ok_or_else(|| js_error(BrowserWebErrorV1::Disposed))?;
        canonical_bytes(&kernel.snapshot())
            .map_err(|error| js_error(BrowserWebErrorV1::Canonical(error.to_string())))
    }

    pub fn export_repro(&self) -> Result<Vec<u8>, JsValue> {
        self.snapshot()
    }

    pub fn dispose(&mut self) {
        self.kernel = None;
        self.retained.clear();
        self.content_identity_bytes.fill(0);
        self.initial_snapshot_bytes.fill(0);
    }
}

impl BrowserKernelHostV1 {
    fn dispatch_batch_inner(&mut self, request_bytes: &[u8]) -> Result<Vec<u8>, BrowserWebErrorV1> {
        if self.kernel.is_none() {
            return Err(BrowserWebErrorV1::Disposed);
        }
        validate_bytes(request_bytes, MAXIMUM_REQUEST_BYTES)?;
        let requests: Vec<BrowserRequestEnvelopeV1> =
            serde_json::from_slice(request_bytes).map_err(|_| BrowserWebErrorV1::InvalidMessage)?;
        if requests.is_empty() || requests.len() > MAXIMUM_BATCH_REQUESTS {
            return Err(BrowserWebErrorV1::InvalidMessage);
        }
        if requests[..requests.len() - 1]
            .iter()
            .any(|request| matches!(&request.request, BrowserRequestV1::Dispose))
        {
            return Err(BrowserWebErrorV1::InvalidMessage);
        }
        let canonical_request_bytes = canonical_bytes(&requests)
            .map_err(|error| BrowserWebErrorV1::Canonical(error.to_string()))?;
        if canonical_request_bytes != request_bytes {
            return Err(BrowserWebErrorV1::InvalidMessage);
        }
        let fingerprints = requests
            .iter()
            .map(request_fingerprint)
            .collect::<Result<Vec<_>, _>>()?;
        let retained = requests
            .iter()
            .zip(&fingerprints)
            .map(|(request, fingerprint)| {
                self.retained
                    .get(&request.sequence)
                    .filter(|entry| entry.fingerprint == *fingerprint)
                    .map(|entry| entry.response.clone())
            })
            .collect::<Vec<_>>();
        if retained.iter().all(Option::is_some) {
            let responses = retained.into_iter().flatten().collect::<Vec<_>>();
            return encode_responses(&responses);
        }
        if retained.iter().any(Option::is_some) {
            return Err(BrowserWebErrorV1::Sequence);
        }

        let mut expected = next_safe(self.accepted_sequence)?;
        for request in &requests {
            if request.version != BROWSER_WORKER_PROTOCOL_VERSION_V1 || request.sequence != expected
            {
                return Err(BrowserWebErrorV1::Sequence);
            }
            expected = next_safe(expected)?;
        }

        let mut staged_kernel = self.kernel.clone().ok_or(BrowserWebErrorV1::Disposed)?;
        let mut staged_wakeup = self.last_wakeup_micros;
        let mut responses = Vec::with_capacity(requests.len());
        for request in &requests {
            let response = process_request(
                &mut staged_kernel,
                &self.content_identity_bytes,
                &self.initial_snapshot_bytes,
                &mut staged_wakeup,
                request,
            )?;
            let digest = mechanical_digest(staged_kernel.state())
                .map_err(|error| BrowserWebErrorV1::Kernel(error.to_string()))?;
            responses.push(BrowserResponseEnvelopeV1 {
                version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
                request_id: request.request_id,
                accepted_sequence: request.sequence,
                after_mechanical_digest: digest,
                response,
            });
        }
        let encoded = encode_responses(&responses)?;
        let disposed = requests
            .last()
            .is_some_and(|request| matches!(request.request, BrowserRequestV1::Dispose));
        self.accepted_sequence = requests
            .last()
            .map(|request| request.sequence)
            .ok_or(BrowserWebErrorV1::InvalidMessage)?;
        self.last_wakeup_micros = staged_wakeup;
        self.kernel = if disposed { None } else { Some(staged_kernel) };
        for ((request, fingerprint), response) in
            requests.into_iter().zip(fingerprints).zip(responses)
        {
            self.retained.insert(
                request.sequence,
                RetainedRequestV1 {
                    fingerprint,
                    response,
                },
            );
        }
        while self.retained.len() > MAXIMUM_LEDGER_ENTRIES {
            let Some(first) = self.retained.keys().next().copied() else {
                break;
            };
            self.retained.remove(&first);
        }
        if disposed {
            self.retained.clear();
            self.content_identity_bytes.fill(0);
            self.initial_snapshot_bytes.fill(0);
        }
        Ok(encoded)
    }
}

fn process_request(
    kernel: &mut GameKernelV6,
    content_identity_bytes: &[u8],
    initial_snapshot_bytes: &[u8],
    last_wakeup_micros: &mut SafeU53,
    envelope: &BrowserRequestEnvelopeV1,
) -> Result<BrowserResponseV1, BrowserWebErrorV1> {
    match &envelope.request {
        BrowserRequestV1::Initialize(init) => {
            if envelope.sequence != SafeU53::new(1).map_err(|_| BrowserWebErrorV1::Sequence)?
                || init.mode == BrowserExecutionModeV1::LegacyTypeScript
                || init.execution_identity_bytes != content_identity_bytes
                || init.session_start_bytes != initial_snapshot_bytes
                || init.maximum_pending_requests == 0
                || init.maximum_pending_requests > MAXIMUM_BATCH_REQUESTS
            {
                return Err(BrowserWebErrorV1::Identity);
            }
            Ok(BrowserResponseV1::Ready {
                identity_bytes: content_identity_bytes.to_vec(),
            })
        }
        BrowserRequestV1::RawInput(event) => {
            kernel
                .raw_input(event.clone())
                .map_err(|error| BrowserWebErrorV1::Kernel(error.to_string()))?;
            Ok(BrowserResponseV1::Effects(effect_batch(
                kernel,
                envelope.sequence,
            )?))
        }
        BrowserRequestV1::AdvanceTime(milliseconds) => {
            kernel
                .advance_time(*milliseconds)
                .map_err(|error| BrowserWebErrorV1::Kernel(error.to_string()))?;
            Ok(BrowserResponseV1::Effects(effect_batch(
                kernel,
                envelope.sequence,
            )?))
        }
        BrowserRequestV1::TimerWakeup { monotonic_micros } => {
            if *monotonic_micros < *last_wakeup_micros {
                return Err(BrowserWebErrorV1::Sequence);
            }
            let delta_micros = monotonic_micros
                .get()
                .checked_sub(last_wakeup_micros.get())
                .ok_or(BrowserWebErrorV1::Sequence)?;
            let milliseconds =
                SafeU53::new(delta_micros / 1_000).map_err(|_| BrowserWebErrorV1::Sequence)?;
            kernel
                .advance_time(milliseconds)
                .map_err(|error| BrowserWebErrorV1::Kernel(error.to_string()))?;
            *last_wakeup_micros = *monotonic_micros;
            Ok(BrowserResponseV1::Effects(effect_batch(
                kernel,
                envelope.sequence,
            )?))
        }
        BrowserRequestV1::NetworkFrame { .. } | BrowserRequestV1::TransportChanged { .. } => {
            Err(BrowserWebErrorV1::Kernel(
                "browser transport is unavailable in Rust-local authority mode".to_owned(),
            ))
        }
        BrowserRequestV1::PresentationSettled { .. } => {
            kernel.clear_presentations();
            Ok(BrowserResponseV1::Effects(effect_batch(
                kernel,
                envelope.sequence,
            )?))
        }
        BrowserRequestV1::Observe { .. } => Ok(BrowserResponseV1::Observation(
            canonical_bytes(&kernel.snapshot())
                .map_err(|error| BrowserWebErrorV1::Canonical(error.to_string()))?,
        )),
        BrowserRequestV1::Snapshot => Ok(BrowserResponseV1::Snapshot(
            canonical_bytes(&kernel.snapshot())
                .map_err(|error| BrowserWebErrorV1::Canonical(error.to_string()))?,
        )),
        BrowserRequestV1::ExportRepro => Ok(BrowserResponseV1::Repro(
            canonical_bytes(&kernel.snapshot())
                .map_err(|error| BrowserWebErrorV1::Canonical(error.to_string()))?,
        )),
        BrowserRequestV1::Dispose => Ok(BrowserResponseV1::Disposed),
        BrowserRequestV1::StorageResult { .. } | BrowserRequestV1::Lifecycle(_) => Ok(
            BrowserResponseV1::Effects(effect_batch(kernel, envelope.sequence)?),
        ),
    }
}

fn effect_batch(
    kernel: &mut GameKernelV6,
    external_sequence: SafeU53,
) -> Result<BrowserEffectBatchV1, BrowserWebErrorV1> {
    let snapshot = kernel.snapshot();
    let observation_bytes = canonical_bytes(&snapshot)
        .map_err(|error| BrowserWebErrorV1::Canonical(error.to_string()))?;
    let mut effects = vec![BrowserEffectV1::UiChanged(ui_projection(kernel)?)];
    for (index, presentation) in kernel.pending_presentations().iter().enumerate() {
        let detail =
            serde_json::to_value(presentation).map_err(|_| BrowserWebErrorV1::InvalidMessage)?;
        let kind = detail
            .get("kind")
            .and_then(Value::as_str)
            .ok_or(BrowserWebErrorV1::InvalidMessage)?;
        let projection = json!({
            "event_id": format!("presentation/{}/{}", external_sequence, index),
            "kind": kind,
            "blocking_policy": "BLOCKS_HUMAN_INPUT",
            "text": kind.replace('_', " "),
            "duration_ms": 180,
            "detail": detail,
        });
        effects.push(BrowserEffectV1::Presentation(
            canonical_bytes(&projection)
                .map_err(|error| BrowserWebErrorV1::Canonical(error.to_string()))?,
        ));
    }
    let next_wakeup_micros = snapshot
        .scheduler
        .timers
        .iter()
        .map(|timer| timer.remaining_active_ms.get())
        .min()
        .and_then(|milliseconds| milliseconds.checked_mul(1_000))
        .and_then(|micros| SafeU53::new(micros).ok());
    Ok(BrowserEffectBatchV1 {
        external_sequence,
        effects,
        observation_bytes,
        next_wakeup_micros,
    })
}

fn ui_projection(kernel: &GameKernelV6) -> Result<Vec<u8>, BrowserWebErrorV1> {
    let run = kernel.state().active_run.as_ref();
    let control = run.map(|run| &run.control);
    let menu = control.and_then(|control| control.menu.as_ref());
    let options = menu
        .map(|menu| {
            menu.options
                .iter()
                .map(|option| {
                    let (row, column) = option
                        .layout
                        .as_ref()
                        .map(|layout| (layout.row, layout.column))
                        .unwrap_or((0, 0));
                    json!({
                        "option_id": option.option_id.as_str(),
                        "label": option.option_id.as_str(),
                        "disabled": !option.enabled,
                        "hidden": !option.visible,
                        "selected": option.option_id == menu.selected_option_id,
                        "row": row,
                        "column": column,
                    })
                })
                .collect::<Vec<Value>>()
        })
        .unwrap_or_default();
    let control_kind = control
        .map(|control| serde_json::to_value(control.kind))
        .transpose()
        .map_err(|_| BrowserWebErrorV1::InvalidMessage)?
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "TITLE".to_owned());
    let terminal = run.and_then(|run| {
        if format!("{:?}", run.outcome) == "InProgress" {
            None
        } else {
            Some(format!("{:?}", run.outcome).to_uppercase())
        }
    });
    canonical_bytes(&json!({
        "control_id": menu.map(|menu| menu.control_id.as_str()).unwrap_or("profile/title"),
        "control_kind": control_kind,
        "menu_instance_id": menu.map(|menu| menu.instance_id.get().get()).unwrap_or(0),
        "actionable": control.is_some_and(|control| control.actionable),
        "title": control_kind,
        "options": options,
        "status_lines": [],
        "terminal": terminal,
        "fault": null,
    }))
    .map_err(|error| BrowserWebErrorV1::Canonical(error.to_string()))
}

fn request_fingerprint(request: &BrowserRequestEnvelopeV1) -> Result<String, BrowserWebErrorV1> {
    let bytes = canonical_bytes(request)
        .map_err(|error| BrowserWebErrorV1::Canonical(error.to_string()))?;
    content_digest(&bytes).map_err(|error| BrowserWebErrorV1::Canonical(error.to_string()))
}

fn encode_responses(
    responses: &Vec<BrowserResponseEnvelopeV1>,
) -> Result<Vec<u8>, BrowserWebErrorV1> {
    let encoded = canonical_bytes(responses)
        .map_err(|error| BrowserWebErrorV1::Canonical(error.to_string()))?;
    validate_bytes(&encoded, MAXIMUM_RESPONSE_BYTES)?;
    Ok(encoded)
}

fn validate_bytes(bytes: &[u8], maximum: usize) -> Result<(), BrowserWebErrorV1> {
    if bytes.is_empty() || bytes.len() > maximum {
        return Err(BrowserWebErrorV1::InvalidMessage);
    }
    Ok(())
}

fn next_safe(value: SafeU53) -> Result<SafeU53, BrowserWebErrorV1> {
    value
        .get()
        .checked_add(1)
        .and_then(|next| SafeU53::new(next).ok())
        .ok_or(BrowserWebErrorV1::Sequence)
}

fn js_error(error: BrowserWebErrorV1) -> JsValue {
    JsValue::from_str(&error.to_string())
}
