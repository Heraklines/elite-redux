//! BrowserKernelHostV2: typed Wasm/browser adapter over the shared current session.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_canonical::{canonical_bytes, content_digest};
use er_env::current::{CurrentExternalEvent, CurrentGameSession, CurrentSessionError};
use er_game::m9e_content_v2::{
    GameContentBundleV2, PreparedGameContentV2, PresentationSemanticIdV1,
};
use er_game::m9e_material_v6::{GamePlatformEffectV2, GameTelemetryEventV2};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7,
    KernelPresentationOutcomeV2, KernelStorageResultV2,
};
use er_repro::current::{
    CurrentCaptureStatusV1, CurrentReproCapsuleV1, CurrentReproLimitsV1, CurrentReproRecorderV1,
};
use er_types::{SafeU53, ScenarioId};
use thiserror::Error;
use wasm_bindgen::prelude::*;

use crate::contracts_v2::{
    BROWSER_WORKER_PROTOCOL_VERSION_V2, BrowserEffectBatchV2, BrowserEffectV2,
    BrowserLifecycleEventV2, BrowserPresentationOutcomeV2, BrowserRequestEnvelopeV2,
    BrowserRequestV2, BrowserResponseEnvelopeV2, BrowserResponseV2, BrowserSessionInitializationV2,
    BrowserStorageRequestKindV2, BrowserStorageRequestV2, BrowserStorageResultV2,
    MAXIMUM_BROWSER_REQUEST_BYTES_V2, MAXIMUM_BROWSER_RESPONSE_BYTES_V2,
};

const MAXIMUM_RETAINED_REQUESTS_V2: usize = 2_048;
// Serialized response payloads only. Map nodes, IDs, fingerprints, allocation
// capacity, and the currently returned response are additional memory.
const MAXIMUM_RETAINED_RESPONSE_BYTES_V2: usize = 64 << 20;

#[derive(Debug)]
enum BrowserCompletionErrorV2 {
    Session(CurrentSessionError),
    Adapter(BrowserWebErrorV2),
}

impl From<CurrentSessionError> for BrowserCompletionErrorV2 {
    fn from(error: CurrentSessionError) -> Self {
        Self::Session(error)
    }
}

#[derive(Clone, Debug)]
struct RetainedBrowserRequestV2 {
    accepted_sequence: SafeU53,
    fingerprint: String,
    response: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum BrowserWebErrorV2 {
    #[error("browser V2 request, sequence, payload, or lifecycle is invalid")]
    Invalid,
    #[error("browser V2 request identity was reused with different bytes")]
    Conflict,
    #[error("browser V2 kernel failed: {0}")]
    Kernel(String),
    #[error("browser V2 canonical encoding failed: {0}")]
    Canonical(String),
    #[error("browser V2 current capture failed: {0}")]
    Repro(String),
}

impl From<CurrentSessionError> for BrowserWebErrorV2 {
    fn from(error: CurrentSessionError) -> Self {
        match error {
            CurrentSessionError::Disposed => Self::Invalid,
            CurrentSessionError::Kernel(error) => Self::Kernel(error.to_string()),
            CurrentSessionError::Digest(message) => Self::Canonical(message),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct BrowserKernelHostV2 {
    content: Arc<PreparedGameContentV2>,
    session: Option<CurrentGameSession>,
    next_sequence: SafeU53,
    generation: SafeU53,
    retained: BTreeMap<SafeU53, RetainedBrowserRequestV2>,
    retained_response_bytes: usize,
    repro: Option<CurrentReproRecorderV1>,
    disposed: bool,
}

#[wasm_bindgen]
impl BrowserKernelHostV2 {
    #[wasm_bindgen(constructor)]
    pub fn new(bundle_bytes: &[u8]) -> Result<BrowserKernelHostV2, JsValue> {
        Self::from_bundle_bytes(bundle_bytes).map_err(js_error)
    }

    pub fn process(&mut self, request_bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
        self.process_bytes(request_bytes).map_err(js_error)
    }
}

impl BrowserKernelHostV2 {
    pub fn from_bundle_bytes(bundle_bytes: &[u8]) -> Result<Self, BrowserWebErrorV2> {
        if bundle_bytes.is_empty() || bundle_bytes.len() > MAXIMUM_BROWSER_RESPONSE_BYTES_V2 {
            return Err(BrowserWebErrorV2::Invalid);
        }
        let bundle: GameContentBundleV2 =
            serde_json::from_slice(bundle_bytes).map_err(|_| BrowserWebErrorV2::Invalid)?;
        let content = PreparedGameContentV2::prepare(Arc::new(bundle))
            .map_err(|error| BrowserWebErrorV2::Kernel(error.to_string()))?;
        Ok(Self::from_content(Arc::new(content)))
    }

    pub fn from_content(content: Arc<PreparedGameContentV2>) -> Self {
        Self {
            content,
            session: None,
            next_sequence: SafeU53::ZERO,
            generation: safe_one(),
            retained: BTreeMap::new(),
            retained_response_bytes: 0,
            repro: None,
            disposed: false,
        }
    }

    pub fn process_bytes(&mut self, request_bytes: &[u8]) -> Result<Vec<u8>, BrowserWebErrorV2> {
        self.process_bytes_with_response_limit(request_bytes, MAXIMUM_BROWSER_RESPONSE_BYTES_V2)
    }

    fn process_bytes_with_response_limit(
        &mut self,
        request_bytes: &[u8],
        maximum_response_bytes: usize,
    ) -> Result<Vec<u8>, BrowserWebErrorV2> {
        self.process_bytes_with_limits(
            request_bytes,
            maximum_response_bytes,
            MAXIMUM_RETAINED_RESPONSE_BYTES_V2,
        )
    }

    fn process_bytes_with_limits(
        &mut self,
        request_bytes: &[u8],
        maximum_response_bytes: usize,
        maximum_retained_response_bytes: usize,
    ) -> Result<Vec<u8>, BrowserWebErrorV2> {
        let previous_capture = self.capture_status();
        let mut read_only = false;
        let result = self.process_bytes_inner(
            request_bytes,
            maximum_response_bytes,
            maximum_retained_response_bytes,
            &mut read_only,
        );
        if let Err(error) = &result
            && !read_only
            && self.capture_status() == previous_capture
            && let Some(recorder) = &mut self.repro
        {
            recorder
                .invalidate_attempt(&format!("browser admission or response rejection: {error}"));
        }
        result
    }

    pub fn capture_status(&self) -> Option<CurrentCaptureStatusV1> {
        self.repro.as_ref().map(CurrentReproRecorderV1::status)
    }

    fn process_bytes_inner(
        &mut self,
        request_bytes: &[u8],
        maximum_response_bytes: usize,
        maximum_retained_response_bytes: usize,
        read_only: &mut bool,
    ) -> Result<Vec<u8>, BrowserWebErrorV2> {
        // Private test limits may be smaller. Admit any new response against
        // both limits before its session transaction can commit. Production's
        // 64 MiB cache always fits every valid <=32 MiB response.
        let maximum_response_bytes = maximum_response_bytes
            .min(MAXIMUM_BROWSER_RESPONSE_BYTES_V2)
            .min(maximum_retained_response_bytes);
        if maximum_retained_response_bytes == 0
            || maximum_retained_response_bytes > MAXIMUM_RETAINED_RESPONSE_BYTES_V2
            || self.disposed
            || request_bytes.is_empty()
            || request_bytes.len() > MAXIMUM_BROWSER_REQUEST_BYTES_V2
        {
            return Err(BrowserWebErrorV2::Invalid);
        }
        let envelope: BrowserRequestEnvelopeV2 =
            serde_json::from_slice(request_bytes).map_err(|_| BrowserWebErrorV2::Invalid)?;
        if envelope.version != BROWSER_WORKER_PROTOCOL_VERSION_V2
            || canonical_bytes(&envelope).map_err(canonical_error)? != request_bytes
        {
            return Err(BrowserWebErrorV2::Invalid);
        }
        let fingerprint = content_digest(&envelope).map_err(canonical_error)?;
        if let Some(previous) = self.retained.get(&envelope.request_id) {
            return if previous.fingerprint == fingerprint {
                Ok(previous.response.clone())
            } else {
                Err(BrowserWebErrorV2::Conflict)
            };
        }
        if envelope.sequence != self.next_sequence {
            return Err(BrowserWebErrorV2::Invalid);
        }
        let next_sequence = increment(self.next_sequence)?;
        *read_only = matches!(
            &envelope.request,
            BrowserRequestV2::Snapshot | BrowserRequestV2::ExportRepro
        );
        let bytes = self.process_request(
            envelope.request,
            envelope.request_id,
            envelope.sequence,
            maximum_response_bytes,
        )?;
        self.next_sequence = next_sequence;
        if self.disposed {
            // Disposed hosts reject all further requests, including retries.
            self.retained.clear();
            self.retained_response_bytes = 0;
            return Ok(bytes);
        }
        // Encoding already proved bytes.len() <= the retained payload budget.
        // Eviction/accounting cannot introduce a new rejected-operation result
        // after process_request has committed the game. Only the new response
        // is cloned; retained response payloads are never copied during append.
        while (self.retained.len() >= MAXIMUM_RETAINED_REQUESTS_V2
            || self.retained_response_bytes > maximum_retained_response_bytes - bytes.len())
            && let Some(oldest) = self
                .retained
                .iter()
                .min_by_key(|(_, retained)| retained.accepted_sequence)
                .map(|(request_id, _)| *request_id)
        {
            if let Some(evicted) = self.retained.remove(&oldest) {
                self.retained_response_bytes -= evicted.response.len();
            }
        }
        self.retained_response_bytes += bytes.len();
        self.retained.insert(
            envelope.request_id,
            RetainedBrowserRequestV2 {
                accepted_sequence: envelope.sequence,
                fingerprint,
                response: bytes.clone(),
            },
        );
        Ok(bytes)
    }

    pub fn kernel_ref(&self) -> Option<&GameKernelV7> {
        self.session
            .as_ref()
            .and_then(|session| session.kernel_ref().ok())
    }

    fn process_request(
        &mut self,
        request: BrowserRequestV2,
        request_id: SafeU53,
        sequence: SafeU53,
        maximum_response_bytes: usize,
    ) -> Result<Vec<u8>, BrowserWebErrorV2> {
        let mut generation = self.generation;
        let mut origin = None;
        let event = match request {
            BrowserRequestV2::Initialize { initialization } => {
                if self.session.is_some() {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                let (session, recorder, generation) = self.initialize(*initialization)?;
                let bytes = encode_response(
                    BrowserResponseV2::Ready,
                    request_id,
                    sequence,
                    maximum_response_bytes,
                )?;
                self.session = Some(session);
                self.repro = Some(recorder);
                self.generation = generation;
                return Ok(bytes);
            }
            BrowserRequestV2::Snapshot => {
                let response = BrowserResponseV2::Snapshot {
                    snapshot: Box::new(self.session()?.snapshot()?),
                };
                let bytes =
                    encode_response(response, request_id, sequence, maximum_response_bytes)?;
                return Ok(bytes);
            }
            BrowserRequestV2::ExportRepro => {
                let capsule = self
                    .repro
                    .as_ref()
                    .ok_or(BrowserWebErrorV2::Invalid)?
                    .export()
                    .map_err(|error| BrowserWebErrorV2::Repro(error.to_string()))?;
                let response = BrowserResponseV2::Effects {
                    batch: BrowserEffectBatchV2 {
                        external_sequence: sequence,
                        effects: vec![BrowserEffectV2::CurrentReproReady {
                            capsule_bytes: canonical_bytes(&capsule).map_err(canonical_error)?,
                        }],
                    },
                };
                let bytes =
                    encode_response(response, request_id, sequence, maximum_response_bytes)?;
                return Ok(bytes);
            }
            BrowserRequestV2::Dispose => {
                let bytes = encode_response(
                    BrowserResponseV2::Disposed,
                    request_id,
                    sequence,
                    maximum_response_bytes,
                )?;
                if let Some(session) = &mut self.session {
                    session.dispose();
                }
                self.session = None;
                self.repro = None;
                self.disposed = true;
                return Ok(bytes);
            }
            BrowserRequestV2::RetryCoopSetup => CurrentExternalEvent::RetryCoopSetup,
            BrowserRequestV2::RawInput { event } => CurrentExternalEvent::RawInput { input: event },
            BrowserRequestV2::ProposalFrame { bytes } => {
                CurrentExternalEvent::ProposalFrame { bytes }
            }
            BrowserRequestV2::AuthorityMaterial { bytes } => {
                CurrentExternalEvent::AuthorityMaterial { bytes }
            }
            BrowserRequestV2::AdvanceTime { milliseconds } => {
                CurrentExternalEvent::AdvanceTime { milliseconds }
            }
            BrowserRequestV2::NetworkFrame {
                generation: incoming,
                bytes,
            } => {
                if incoming != generation {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                CurrentExternalEvent::NetworkFrame {
                    generation: er_types::ConnectionGeneration::new(incoming),
                    bytes,
                }
            }
            BrowserRequestV2::TransportChanged {
                generation: incoming,
                connected,
            } => {
                if incoming < generation {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                generation = incoming;
                CurrentExternalEvent::TransportChanged {
                    generation: er_types::ConnectionGeneration::new(incoming),
                    connected,
                }
            }
            BrowserRequestV2::PresentationSettled { event_id, outcome } => {
                let outcome = match outcome {
                    BrowserPresentationOutcomeV2::Settled => KernelPresentationOutcomeV2::Settled,
                    BrowserPresentationOutcomeV2::IntentionallySkipped => {
                        KernelPresentationOutcomeV2::IntentionallySkipped
                    }
                    BrowserPresentationOutcomeV2::Failed { reason } => {
                        KernelPresentationOutcomeV2::Failed { reason }
                    }
                };
                CurrentExternalEvent::PresentationOutcome { event_id, outcome }
            }
            BrowserRequestV2::StorageResult { request_id, result } => {
                let result = match result {
                    BrowserStorageResultV2::Read { bytes } => KernelStorageResultV2::Read { bytes },
                    BrowserStorageResultV2::Written => KernelStorageResultV2::Written,
                    BrowserStorageResultV2::Deleted => KernelStorageResultV2::Deleted,
                    BrowserStorageResultV2::Slots { slots } => {
                        KernelStorageResultV2::Slots { slots }
                    }
                    BrowserStorageResultV2::Failed { reason } => {
                        KernelStorageResultV2::Failed { reason }
                    }
                    BrowserStorageResultV2::Conflict { current_generation } => {
                        KernelStorageResultV2::Conflict { current_generation }
                    }
                    BrowserStorageResultV2::Uncertain { reason } => {
                        KernelStorageResultV2::Uncertain { reason }
                    }
                };
                CurrentExternalEvent::StorageResult { request_id, result }
            }
            BrowserRequestV2::Lifecycle { event } => {
                origin = Some(match &event {
                    BrowserLifecycleEventV2::Suspend => "browser.lifecycle.SUSPEND",
                    BrowserLifecycleEventV2::Resume => "browser.lifecycle.RESUME",
                    BrowserLifecycleEventV2::Hidden => "browser.lifecycle.HIDDEN",
                    BrowserLifecycleEventV2::Visible => "browser.lifecycle.VISIBLE",
                    BrowserLifecycleEventV2::PageHide => "browser.lifecycle.PAGE_HIDE",
                    BrowserLifecycleEventV2::PageShow => "browser.lifecycle.PAGE_SHOW",
                });
                let input = match event {
                    BrowserLifecycleEventV2::Suspend
                    | BrowserLifecycleEventV2::Hidden
                    | BrowserLifecycleEventV2::PageHide => er_types::RawInputEvent::WindowBlurred,
                    BrowserLifecycleEventV2::Resume
                    | BrowserLifecycleEventV2::Visible
                    | BrowserLifecycleEventV2::PageShow => er_types::RawInputEvent::WindowFocused,
                };
                CurrentExternalEvent::RawInput { input }
            }
        };
        let content = Arc::clone(&self.content);
        let before = self.session()?.snapshot().ok();
        let prepared = self
            .session
            .as_mut()
            .ok_or(BrowserWebErrorV2::Invalid)?
            .apply_with(event.clone(), |_candidate, step| {
                let response = Self::effects(content.as_ref(), step.clone(), generation, sequence)
                    .map_err(BrowserCompletionErrorV2::Adapter)?;
                let bytes = encode_response(response, request_id, sequence, maximum_response_bytes)
                    .map_err(BrowserCompletionErrorV2::Adapter)?;
                Ok::<_, BrowserCompletionErrorV2>((bytes, step))
            });
        let outcome = match &prepared {
            Ok((_, step)) => Some(Ok(step)),
            Err(BrowserCompletionErrorV2::Session(error)) => Some(Err(error)),
            Err(BrowserCompletionErrorV2::Adapter(_)) => None,
        };
        if let Some(outcome) = outcome
            && let Some(recorder) = &mut self.repro
        {
            let evidence = self
                .session
                .as_ref()
                .and_then(|session| Some((session.snapshot().ok()?, session.observe().ok()?)));
            if let (Some(before), Some((after, observation))) = (before, evidence) {
                let after_generation = if outcome.is_ok() {
                    generation
                } else {
                    self.generation
                };
                recorder.record_with_browser_transport(
                    &before,
                    event,
                    outcome,
                    &after,
                    &observation,
                    origin,
                    self.generation,
                    after_generation,
                );
            } else {
                recorder.invalidate_attempt(
                    "browser event diagnostic snapshot or observation unavailable",
                );
            }
        }
        match prepared {
            Ok((bytes, _)) => {
                self.generation = generation;
                Ok(bytes)
            }
            Err(BrowserCompletionErrorV2::Session(error)) => Err(error.into()),
            Err(BrowserCompletionErrorV2::Adapter(error)) => Err(error),
        }
    }

    fn initialize(
        &self,
        initialization: BrowserSessionInitializationV2,
    ) -> Result<(CurrentGameSession, CurrentReproRecorderV1, SafeU53), BrowserWebErrorV2> {
        let session = match initialization {
            BrowserSessionInitializationV2::NaturalCoop {
                context,
                profile,
                seed,
                save_slots,
                local_is_host,
            } => {
                let expected_role = match context
                    .protocol
                    .as_ref()
                    .ok_or(BrowserWebErrorV2::Invalid)?
                    .role
                {
                    er_protocol::EndpointRole::Authority => GameKernelRoleV7::Authority,
                    er_protocol::EndpointRole::Replica => GameKernelRoleV7::Replica,
                };
                if context.role != expected_role {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                let mut session = CurrentGameSession::natural_start_with_scheduler(
                    profile,
                    seed,
                    context.local_seat,
                    save_slots,
                    local_is_host,
                    self.content.clone(),
                    context.scheduler,
                    context.protocol,
                )?;
                session.enable_current_coop_setup()?;
                session
            }
            BrowserSessionInitializationV2::NaturalStart {
                context,
                profile,
                seed,
                save_slots,
                local_is_host,
                existing_saves,
            } => {
                if existing_saves && context.role != GameKernelRoleV7::Authority {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                let mut session = CurrentGameSession::natural_start_with_scheduler(
                    profile,
                    seed,
                    context.local_seat,
                    save_slots,
                    local_is_host,
                    self.content.clone(),
                    context.scheduler,
                    context.protocol,
                )?;
                if existing_saves {
                    session.enable_current_title_storage()?;
                }
                session
            }
            BrowserSessionInitializationV2::ExistingSave { context, save } => {
                save.validate().map_err(|_| BrowserWebErrorV2::Invalid)?;
                if &save.content_identity != self.content.identity() {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                let revision = save
                    .state
                    .active_run
                    .as_ref()
                    .map(|run| run.control.revision)
                    .unwrap_or_else(safe_one);
                CurrentGameSession::from_active(
                    save.state,
                    revision,
                    context.local_seat,
                    context.role,
                    self.content.clone(),
                    empty_input_router(),
                    context.scheduler,
                    context.protocol,
                )?
            }
            BrowserSessionInitializationV2::Snapshot { context, snapshot } => {
                CurrentGameSession::from_snapshot(
                    snapshot,
                    context.local_seat,
                    context.role,
                    self.content.clone(),
                )?
            }
            BrowserSessionInitializationV2::Scenario {
                context,
                snapshot,
                scenario,
            } => {
                let session = CurrentGameSession::from_snapshot(
                    snapshot,
                    context.local_seat,
                    context.role,
                    self.content.clone(),
                )?;
                if active_scenario(session.kernel_ref()?) != Some(scenario) {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                session
            }
            BrowserSessionInitializationV2::ReproCapsule {
                context,
                snapshot,
                inputs,
            } => {
                let mut session = CurrentGameSession::from_snapshot(
                    snapshot,
                    context.local_seat,
                    context.role,
                    self.content.clone(),
                )?;
                for input in inputs {
                    session.apply(CurrentExternalEvent::RawInput { input })?;
                }
                session
            }
            BrowserSessionInitializationV2::CurrentReproCapsule { capsule_bytes } => {
                let limits = CurrentReproLimitsV1::default();
                if capsule_bytes.is_empty() || capsule_bytes.len() > limits.maximum_bytes {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                let capsule: CurrentReproCapsuleV1 = serde_json::from_slice(&capsule_bytes)
                    .map_err(|_| BrowserWebErrorV2::Invalid)?;
                let generation = capsule
                    .browser_transport
                    .as_ref()
                    .ok_or_else(|| {
                        BrowserWebErrorV2::Repro("browser transport context missing".to_owned())
                    })?
                    .final_generation;
                let (recorder, session) = CurrentReproRecorderV1::from_capsule(
                    capsule,
                    Arc::clone(&self.content),
                    limits,
                )
                .map_err(|error| BrowserWebErrorV2::Repro(error.to_string()))?;
                return Ok((session, recorder, generation));
            }
        };
        let (local_seat, role) = session.session_context()?;
        let snapshot = session.snapshot()?;
        let generation = snapshot
            .protocol
            .as_ref()
            .map(|protocol| protocol.frame_context.context.connection_generation.get())
            .unwrap_or_else(safe_one);
        let recorder = CurrentReproRecorderV1::new_with_browser_transport(
            snapshot,
            local_seat,
            role,
            Arc::clone(&self.content),
            CurrentReproLimitsV1::default(),
            generation,
        )
        .map_err(|error| BrowserWebErrorV2::Repro(error.to_string()))?;
        Ok((session, recorder, generation))
    }

    fn effects(
        content: &PreparedGameContentV2,
        step: GameKernelStepV7,
        generation: SafeU53,
        external_sequence: SafeU53,
    ) -> Result<BrowserResponseV2, BrowserWebErrorV2> {
        let mut effects = Vec::new();
        for effect in step.effects {
            match effect {
                GameKernelEffectV7::UiChanged(control) => {
                    let semantic = PresentationSemanticIdV1::Control(control.kind);
                    effects.push(BrowserEffectV2::UiChanged { control });
                    if let Some(mapping) = content.presentation(semantic) {
                        effects.extend(
                            mapping
                                .assets
                                .iter()
                                .copied()
                                .map(|asset| BrowserEffectV2::AssetRequest { asset }),
                        );
                        if let Some(cue) = mapping.audio_cue {
                            effects.push(BrowserEffectV2::AudioCue { cue });
                        }
                    }
                }
                GameKernelEffectV7::ProposalReady { bytes, .. } => {
                    effects.push(BrowserEffectV2::SendNetworkFrame { generation, bytes });
                }
                GameKernelEffectV7::AuthorityMaterial { bytes, .. } => {
                    effects.push(BrowserEffectV2::SendNetworkFrame { generation, bytes });
                    effects.push(BrowserEffectV2::Telemetry {
                        event: GameTelemetryEventV2::ActionApplied,
                    });
                }
                GameKernelEffectV7::Presentation(effect) => {
                    effects.push(BrowserEffectV2::PresentationSceneChanged {
                        semantic: effect.semantic,
                    });
                    effects.push(BrowserEffectV2::Presentation { effect });
                }
                GameKernelEffectV7::Platform(effect) => map_platform(effect, &mut effects)?,
                GameKernelEffectV7::Terminal(terminal) => {
                    effects.push(BrowserEffectV2::Terminal { terminal });
                }
            }
        }
        Ok(BrowserResponseV2::Effects {
            batch: BrowserEffectBatchV2 {
                external_sequence,
                effects,
            },
        })
    }

    fn session(&self) -> Result<&CurrentGameSession, BrowserWebErrorV2> {
        self.session.as_ref().ok_or(BrowserWebErrorV2::Invalid)
    }
}

fn encode_response(
    response: BrowserResponseV2,
    request_id: SafeU53,
    accepted_sequence: SafeU53,
    maximum_bytes: usize,
) -> Result<Vec<u8>, BrowserWebErrorV2> {
    let envelope = BrowserResponseEnvelopeV2 {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V2,
        request_id,
        accepted_sequence,
        response,
    };
    let bytes = canonical_bytes(&envelope).map_err(canonical_error)?;
    if bytes.len() > maximum_bytes {
        return Err(BrowserWebErrorV2::Invalid);
    }
    Ok(bytes)
}

fn map_platform(
    effect: GamePlatformEffectV2,
    output: &mut Vec<BrowserEffectV2>,
) -> Result<(), BrowserWebErrorV2> {
    match effect {
        GamePlatformEffectV2::StorageRead { request, slot } => {
            output.push(BrowserEffectV2::StorageRequest {
                request: BrowserStorageRequestV2 {
                    request_id: request,
                    kind: BrowserStorageRequestKindV2::Read,
                    slot: Some(slot),
                    generation: None,
                    bytes: Vec::new(),
                },
            });
        }
        GamePlatformEffectV2::StorageWrite {
            request,
            slot,
            generation,
            bytes,
        } => output.push(BrowserEffectV2::StorageRequest {
            request: BrowserStorageRequestV2 {
                request_id: request,
                kind: BrowserStorageRequestKindV2::Write,
                slot: Some(slot),
                generation: Some(generation),
                bytes,
            },
        }),
        GamePlatformEffectV2::StorageDelete { request, slot } => {
            output.push(BrowserEffectV2::StorageRequest {
                request: BrowserStorageRequestV2 {
                    request_id: request,
                    kind: BrowserStorageRequestKindV2::Delete,
                    slot: Some(slot),
                    generation: None,
                    bytes: Vec::new(),
                },
            });
        }
        GamePlatformEffectV2::StorageList { request } => {
            output.push(BrowserEffectV2::StorageRequest {
                request: BrowserStorageRequestV2 {
                    request_id: request,
                    kind: BrowserStorageRequestKindV2::List,
                    slot: None,
                    generation: None,
                    bytes: Vec::new(),
                },
            });
        }
        GamePlatformEffectV2::AssetRequest { asset, .. } => {
            output.push(BrowserEffectV2::AssetRequest { asset });
        }
        GamePlatformEffectV2::AudioCue { cue, .. } => {
            output.push(BrowserEffectV2::AudioCue { cue });
        }
        GamePlatformEffectV2::Telemetry { event, .. } => {
            output.push(BrowserEffectV2::Telemetry { event });
        }
        GamePlatformEffectV2::ReproReady { .. } => {
            return Err(BrowserWebErrorV2::Invalid);
        }
    }
    Ok(())
}

fn active_scenario(kernel: &GameKernelV7) -> Option<ScenarioId> {
    kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .and_then(|run| run.scenario.as_ref())
        .map(|scenario| scenario.scenario)
}

fn empty_input_router() -> er_kernel::snapshot::InputRouterSnapshotV2 {
    er_kernel::snapshot::InputRouterSnapshotV2 {
        focus: er_types::InputFocus::Game,
        pressed: Vec::new(),
        suppressed_printable_keys: Vec::new(),
        held_buttons: Vec::new(),
        locks: Vec::new(),
        repeats: Vec::new(),
        disposed: false,
    }
}

fn increment(value: SafeU53) -> Result<SafeU53, BrowserWebErrorV2> {
    let next = value
        .get()
        .checked_add(1)
        .ok_or(BrowserWebErrorV2::Invalid)?;
    SafeU53::new(next).map_err(|_| BrowserWebErrorV2::Invalid)
}

fn safe_one() -> SafeU53 {
    SafeU53::new(1).unwrap_or(SafeU53::MAX)
}

fn canonical_error(error: impl std::fmt::Display) -> BrowserWebErrorV2 {
    BrowserWebErrorV2::Canonical(error.to_string())
}

fn js_error(error: BrowserWebErrorV2) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[cfg(test)]
mod transaction_tests {
    use super::*;
    use std::error::Error;

    use er_kernel::game_kernel_v7::GameKernelRoleV7;
    use er_kernel::snapshot::KernelSchedulerSnapshotV2;
    use er_state::m7_state::{
        DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
    };
    use er_types::battle_ids::WaveIndex;
    use er_types::{GameControlKindV2, InputFocus, PhysicalKey, RawInputEvent, SeatId};

    use crate::contracts_v2::BrowserSessionContextV2;

    fn request(
        id: SafeU53,
        sequence: SafeU53,
        request: BrowserRequestV2,
    ) -> Result<Vec<u8>, Box<dyn Error>> {
        Ok(canonical_bytes(&BrowserRequestEnvelopeV2 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V2,
            request_id: id,
            sequence,
            request,
        })?)
    }

    type InitializedHost = (BrowserKernelHostV2, Vec<u8>, Vec<u8>);

    fn initialized() -> Result<InitializedHost, Box<dyn Error>> {
        let bundle: GameContentBundleV2 = serde_json::from_slice(include_bytes!(
            "../../../fixtures/m9/engineering/game-content-bundle-v2.json"
        ))?;
        let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
        let mut host = BrowserKernelHostV2::from_content(content);
        let profile = ProfileStateV1 {
            schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
            unlocks: Vec::new(),
            achievements: Vec::new(),
            challenges: Vec::new(),
            flags: Default::default(),
            statistics: ProfileStatistics {
                runs_started: SafeU53::ZERO,
                runs_won: SafeU53::ZERO,
                runs_lost: SafeU53::ZERO,
                battles_won: SafeU53::ZERO,
                pokemon_captured: SafeU53::ZERO,
                highest_wave: WaveIndex::new(safe_one())?,
            },
            dex: DexState::default(),
        };
        let bytes = request(
            safe_one(),
            SafeU53::ZERO,
            BrowserRequestV2::Initialize {
                initialization: Box::new(BrowserSessionInitializationV2::NaturalStart {
                    context: BrowserSessionContextV2 {
                        local_seat: SeatId::new(safe_one()),
                        role: GameKernelRoleV7::Authority,
                        scheduler: KernelSchedulerSnapshotV2 {
                            next_timer_id: Some(SafeU53::ZERO),
                            timers: Vec::new(),
                            pauses: Vec::new(),
                            disposed: false,
                        },
                        protocol: None,
                    },
                    profile,
                    seed: "browser-transaction".to_owned(),
                    save_slots: vec!["preview-slot".to_owned()],
                    local_is_host: true,
                    existing_saves: false,
                }),
            },
        )?;
        let response = host.process_bytes(&bytes)?;
        Ok((host, bytes, response))
    }

    fn evidence(host: &BrowserKernelHostV2) -> Result<Vec<u8>, Box<dyn Error>> {
        // Diagnostic attempts intentionally advance on rejection. Keep the
        // complete game/transport/cache evidence strict and assert capture
        // availability and positions separately in each rejection test.
        let retained = host
            .retained
            .iter()
            .map(|(id, entry)| {
                (
                    id,
                    entry.accepted_sequence,
                    &entry.fingerprint,
                    &entry.response,
                )
            })
            .collect::<Vec<_>>();
        Ok(canonical_bytes(&(
            host.session()?.snapshot()?,
            host.next_sequence,
            host.generation,
            retained,
            host.retained_response_bytes,
            host.disposed,
        ))?)
    }

    fn enter() -> BrowserRequestV2 {
        BrowserRequestV2::RawInput {
            event: RawInputEvent::KeyDown {
                code: PhysicalKey::Enter,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        }
    }

    #[test]
    fn late_response_limit_rejection_preserves_state_cache_and_retry() -> Result<(), Box<dyn Error>>
    {
        let (mut host, initialization, ready) = initialized()?;
        let mut fresh = host.clone();
        let before = evidence(&host)?;
        let event = request(SafeU53::new(2)?, safe_one(), enter())?;
        assert_eq!(
            host.session()?
                .observe()?
                .control
                .map(|control| control.kind),
            Some(GameControlKindV2::Title)
        );
        assert!(matches!(
            host.process_bytes_with_response_limit(&event, 1),
            Err(BrowserWebErrorV2::Invalid)
        ));
        assert_eq!(evidence(&host)?, before);
        let unavailable = host.capture_status();
        assert!(matches!(
            unavailable,
            Some(CurrentCaptureStatusV1::Unavailable { position: 1, .. })
        ));
        let export = request(SafeU53::new(3)?, safe_one(), BrowserRequestV2::ExportRepro)?;
        assert!(matches!(
            host.process_bytes(&export),
            Err(BrowserWebErrorV2::Repro(_))
        ));
        assert_eq!(host.capture_status(), unavailable);
        assert_eq!(evidence(&host)?, before);
        assert_eq!(host.process_bytes(&initialization)?, ready);
        assert_eq!(host.capture_status(), unavailable);
        assert_eq!(host.process_bytes(&event)?, fresh.process_bytes(&event)?);
        assert_eq!(evidence(&host)?, evidence(&fresh)?);
        assert_eq!(
            host.capture_status(),
            Some(CurrentCaptureStatusV1::Available {
                base_position: 1,
                final_position: 2
            })
        );
        assert_eq!(
            fresh.capture_status(),
            Some(CurrentCaptureStatusV1::Available {
                base_position: 0,
                final_position: 1
            })
        );
        assert_eq!(
            host.session()?
                .observe()?
                .control
                .map(|control| control.kind),
            Some(GameControlKindV2::ModeSelect)
        );
        Ok(())
    }

    #[test]
    fn read_only_response_limit_failure_preserves_capture() -> Result<(), Box<dyn Error>> {
        let (mut host, _, _) = initialized()?;
        let before = evidence(&host)?;
        let capture = host.capture_status();
        for query in [BrowserRequestV2::Snapshot, BrowserRequestV2::ExportRepro] {
            let bytes = request(SafeU53::new(2)?, safe_one(), query)?;
            assert!(matches!(
                host.process_bytes_with_response_limit(&bytes, 1),
                Err(BrowserWebErrorV2::Invalid)
            ));
            assert_eq!(evidence(&host)?, before);
            assert_eq!(host.capture_status(), capture);
        }
        let dispose = request(SafeU53::new(2)?, safe_one(), BrowserRequestV2::Dispose)?;
        host.process_bytes(&dispose)?;
        assert_eq!(host.capture_status(), None);
        assert!(host.retained.is_empty());
        assert_eq!(host.retained_response_bytes, 0);
        Ok(())
    }

    fn assert_retained_accounting(host: &BrowserKernelHostV2, limit: usize) {
        assert_eq!(
            host.retained_response_bytes,
            host.retained
                .values()
                .map(|entry| entry.response.len())
                .sum::<usize>()
        );
        assert!(host.retained_response_bytes <= limit);
        assert!(host.retained.len() <= MAXIMUM_RETAINED_REQUESTS_V2);
    }

    #[test]
    fn retained_response_byte_boundary_evicts_by_acceptance_and_preserves_retry()
    -> Result<(), Box<dyn Error>> {
        let (mut oracle, initialization, _) = initialized()?;
        let first = request(SafeU53::new(90)?, safe_one(), enter())?;
        let second = request(
            SafeU53::new(20)?,
            SafeU53::new(2)?,
            BrowserRequestV2::AdvanceTime {
                milliseconds: safe_one(),
            },
        )?;
        let third = request(
            SafeU53::new(50)?,
            SafeU53::new(3)?,
            BrowserRequestV2::AdvanceTime {
                milliseconds: safe_one(),
            },
        )?;
        let first_response = oracle.process_bytes(&first)?;
        assert_eq!(
            oracle
                .session()?
                .observe()?
                .control
                .ok_or("mode control")?
                .kind,
            GameControlKindV2::ModeSelect
        );
        let second_response = oracle.process_bytes(&second)?;
        let after_second = oracle.session()?.snapshot()?;
        let capture_after_second = oracle.capture_status();
        let third_response = oracle.process_bytes(&third)?;
        let after_third = oracle.session()?.snapshot()?;
        let pair_bytes = first_response.len() + second_response.len();
        assert!(second_response.len() + third_response.len() < pair_bytes);

        for exact in [true, false] {
            let budget = pair_bytes - usize::from(!exact);
            let mut host = BrowserKernelHostV2::from_content(Arc::clone(&oracle.content));
            host.process_bytes_with_limits(
                &initialization,
                MAXIMUM_BROWSER_RESPONSE_BYTES_V2,
                budget,
            )?;
            assert_eq!(
                host.process_bytes_with_limits(&first, MAXIMUM_BROWSER_RESPONSE_BYTES_V2, budget)?,
                first_response
            );
            assert_eq!(
                host.process_bytes_with_limits(&second, MAXIMUM_BROWSER_RESPONSE_BYTES_V2, budget)?,
                second_response
            );
            assert_retained_accounting(&host, budget);
            assert!(
                !host.retained.contains_key(&safe_one()),
                "initialization is oldest"
            );
            assert_eq!(host.retained.contains_key(&SafeU53::new(90)?), exact);
            assert!(host.retained.contains_key(&SafeU53::new(20)?));
            if exact {
                assert_eq!(host.retained_response_bytes, budget);
            } else {
                assert_eq!(host.retained_response_bytes, second_response.len());
            }
            let before_retry = evidence(&host)?;
            assert_eq!(
                host.process_bytes_with_limits(&second, MAXIMUM_BROWSER_RESPONSE_BYTES_V2, budget)?,
                second_response
            );
            assert_eq!(evidence(&host)?, before_retry);
            assert_eq!(host.capture_status(), capture_after_second);
            assert_eq!(host.session()?.snapshot()?, after_second);

            assert_eq!(
                host.process_bytes_with_limits(&third, MAXIMUM_BROWSER_RESPONSE_BYTES_V2, budget)?,
                third_response
            );
            assert_retained_accounting(&host, budget);
            // ID90 is older than ID20 even though BTreeMap orders ID20 first.
            assert!(!host.retained.contains_key(&SafeU53::new(90)?));
            assert!(host.retained.contains_key(&SafeU53::new(20)?));
            assert!(host.retained.contains_key(&SafeU53::new(50)?));
            assert_eq!(host.session()?.snapshot()?, after_third);
            let before_rejection = evidence(&host)?;
            assert!(matches!(
                host.process_bytes_with_limits(&first, MAXIMUM_BROWSER_RESPONSE_BYTES_V2, budget),
                Err(BrowserWebErrorV2::Invalid)
            ));
            assert_eq!(evidence(&host)?, before_rejection);
            assert!(matches!(
                host.capture_status(),
                Some(CurrentCaptureStatusV1::Unavailable { .. })
            ));
            let conflict = request(
                SafeU53::new(50)?,
                SafeU53::new(3)?,
                BrowserRequestV2::Snapshot,
            )?;
            assert!(matches!(
                host.process_bytes_with_limits(
                    &conflict,
                    MAXIMUM_BROWSER_RESPONSE_BYTES_V2,
                    budget
                ),
                Err(BrowserWebErrorV2::Conflict)
            ));
            assert_eq!(evidence(&host)?, before_rejection);
            let capture = host.capture_status();
            assert_eq!(
                host.process_bytes_with_limits(&third, MAXIMUM_BROWSER_RESPONSE_BYTES_V2, budget)?,
                third_response
            );
            assert_eq!(evidence(&host)?, before_rejection);
            assert_eq!(host.capture_status(), capture);
        }
        Ok(())
    }

    #[test]
    fn single_response_cache_boundary_rejects_before_commit_and_disposal_clears_payloads()
    -> Result<(), Box<dyn Error>> {
        let (mut oracle, initialization, _) = initialized()?;
        let event = request(SafeU53::new(2)?, safe_one(), enter())?;
        let response = oracle.process_bytes(&event)?;
        let mut host = BrowserKernelHostV2::from_content(Arc::clone(&oracle.content));
        host.process_bytes(&initialization)?;
        let before = evidence(&host)?;
        assert!(matches!(
            host.process_bytes_with_limits(
                &event,
                MAXIMUM_BROWSER_RESPONSE_BYTES_V2,
                response.len() - 1
            ),
            Err(BrowserWebErrorV2::Invalid)
        ));
        assert_eq!(evidence(&host)?, before);
        assert!(matches!(
            host.capture_status(),
            Some(CurrentCaptureStatusV1::Unavailable { position: 1, .. })
        ));
        assert_eq!(
            host.process_bytes_with_limits(
                &event,
                MAXIMUM_BROWSER_RESPONSE_BYTES_V2,
                response.len()
            )?,
            response
        );
        assert_eq!(host.session()?.snapshot()?, oracle.session()?.snapshot()?);
        assert_retained_accounting(&host, response.len());
        assert_eq!(host.retained.len(), 1);
        assert_eq!(host.retained_response_bytes, response.len());
        let accepted = evidence(&host)?;
        let capture = host.capture_status();
        assert_eq!(
            host.process_bytes_with_limits(
                &event,
                MAXIMUM_BROWSER_RESPONSE_BYTES_V2,
                response.len()
            )?,
            response
        );
        assert_eq!(evidence(&host)?, accepted);
        assert_eq!(host.capture_status(), capture);
        let dispose = request(
            SafeU53::new(3)?,
            SafeU53::new(2)?,
            BrowserRequestV2::Dispose,
        )?;
        host.process_bytes(&dispose)?;
        assert!(host.retained.is_empty());
        assert_eq!(host.retained_response_bytes, 0);
        assert!(host.session.is_none());
        assert!(host.repro.is_none());
        assert!(host.disposed);
        assert!(matches!(
            host.process_bytes(&dispose),
            Err(BrowserWebErrorV2::Invalid)
        ));
        let replacement = BrowserKernelHostV2::from_content(Arc::clone(&oracle.content));
        assert!(replacement.retained.is_empty());
        assert_eq!(replacement.retained_response_bytes, 0);
        assert_eq!(replacement.next_sequence, SafeU53::ZERO);
        Ok(())
    }

    #[test]
    fn sequence_exhaustion_preflight_preserves_current_session_and_cached_response()
    -> Result<(), Box<dyn Error>> {
        let (mut host, initialization, ready) = initialized()?;
        host.next_sequence = SafeU53::MAX;
        let before = evidence(&host)?;
        let event = request(SafeU53::new(2)?, SafeU53::MAX, enter())?;
        assert!(matches!(
            host.process_bytes(&event),
            Err(BrowserWebErrorV2::Invalid)
        ));
        assert_eq!(evidence(&host)?, before);
        let unavailable = host.capture_status();
        assert!(matches!(
            unavailable,
            Some(CurrentCaptureStatusV1::Unavailable { position: 1, .. })
        ));
        assert_eq!(host.process_bytes(&initialization)?, ready);
        assert_eq!(evidence(&host)?, before);
        assert_eq!(host.capture_status(), unavailable);
        Ok(())
    }
}
