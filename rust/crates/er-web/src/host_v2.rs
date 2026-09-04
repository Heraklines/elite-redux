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
    GameKernelEffectV7, GameKernelStepV7, GameKernelV7, KernelPresentationOutcomeV2,
    KernelStorageResultV2,
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

#[derive(Debug)]
enum ReproUpdateV2 {
    Keep,
    Append(er_types::RawInputEvent),
    Replace(Box<er_kernel::snapshot_v7::CoreGameKernelSnapshotV7>),
    Clear,
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
    repro_base: Option<er_kernel::snapshot_v7::CoreGameKernelSnapshotV7>,
    repro_inputs: Vec<er_types::RawInputEvent>,
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
            repro_base: None,
            repro_inputs: Vec::new(),
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
        let maximum_response_bytes = maximum_response_bytes.min(MAXIMUM_BROWSER_RESPONSE_BYTES_V2);
        if self.disposed
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
        let evicted = if self.retained.len() == MAXIMUM_RETAINED_REQUESTS_V2 {
            Some(
                self.retained
                    .iter()
                    .min_by_key(|(_, retained)| retained.accepted_sequence)
                    .map(|(request_id, _)| *request_id)
                    .ok_or(BrowserWebErrorV2::Invalid)?,
            )
        } else {
            None
        };
        let (bytes, repro_update) = self.process_request(
            envelope.request,
            envelope.request_id,
            envelope.sequence,
            maximum_response_bytes,
        )?;
        self.update_repro(repro_update);
        self.next_sequence = next_sequence;
        if let Some(evicted) = evicted {
            self.retained.remove(&evicted);
        }
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
    ) -> Result<(Vec<u8>, ReproUpdateV2), BrowserWebErrorV2> {
        let mut generation = self.generation;
        let mut append_input = None;
        let event = match request {
            BrowserRequestV2::Initialize { initialization } => {
                if self.session.is_some() {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                let session = self.initialize(*initialization)?;
                let snapshot = session.snapshot()?;
                let generation = snapshot
                    .protocol
                    .as_ref()
                    .map(|protocol| protocol.frame_context.context.connection_generation.get())
                    .unwrap_or_else(safe_one);
                let bytes = encode_response(
                    BrowserResponseV2::Ready,
                    request_id,
                    sequence,
                    maximum_response_bytes,
                )?;
                self.session = Some(session);
                self.generation = generation;
                return Ok((bytes, ReproUpdateV2::Replace(Box::new(snapshot))));
            }
            BrowserRequestV2::Snapshot => {
                let response = BrowserResponseV2::Snapshot {
                    snapshot: Box::new(self.session()?.snapshot()?),
                };
                let bytes =
                    encode_response(response, request_id, sequence, maximum_response_bytes)?;
                return Ok((bytes, ReproUpdateV2::Keep));
            }
            BrowserRequestV2::ExportRepro => {
                let snapshot = match &self.repro_base {
                    Some(snapshot) => snapshot.clone(),
                    None => self.session()?.snapshot()?,
                };
                let response = BrowserResponseV2::Effects {
                    batch: BrowserEffectBatchV2 {
                        external_sequence: sequence,
                        effects: vec![BrowserEffectV2::ReproReady {
                            snapshot: Box::new(snapshot),
                            inputs: self.repro_inputs.clone(),
                        }],
                    },
                };
                let bytes =
                    encode_response(response, request_id, sequence, maximum_response_bytes)?;
                return Ok((bytes, ReproUpdateV2::Keep));
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
                self.disposed = true;
                return Ok((bytes, ReproUpdateV2::Clear));
            }
            BrowserRequestV2::RawInput { event } => {
                if self.repro_inputs.len() < 4_096 {
                    append_input = Some(event.clone());
                }
                CurrentExternalEvent::RawInput { input: event }
            }
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
        let prepared = self
            .session
            .as_mut()
            .ok_or(BrowserWebErrorV2::Invalid)?
            .apply_with(event, |candidate, step| {
                let response = Self::effects(content.as_ref(), step, generation, sequence)?;
                let repro = match append_input {
                    Some(input) => ReproUpdateV2::Append(input),
                    None => ReproUpdateV2::Replace(Box::new(candidate.snapshot()?)),
                };
                let bytes =
                    encode_response(response, request_id, sequence, maximum_response_bytes)?;
                Ok::<_, BrowserWebErrorV2>((bytes, repro))
            })?;
        self.generation = generation;
        Ok(prepared)
    }

    fn update_repro(&mut self, update: ReproUpdateV2) {
        match update {
            ReproUpdateV2::Keep => {}
            ReproUpdateV2::Append(input) => self.repro_inputs.push(input),
            ReproUpdateV2::Replace(snapshot) => {
                self.repro_base = Some(*snapshot);
                self.repro_inputs.clear();
            }
            ReproUpdateV2::Clear => {
                self.repro_base = None;
                self.repro_inputs.clear();
            }
        }
    }

    fn initialize(
        &self,
        initialization: BrowserSessionInitializationV2,
    ) -> Result<CurrentGameSession, BrowserWebErrorV2> {
        let session = match initialization {
            BrowserSessionInitializationV2::NaturalStart {
                context,
                profile,
                seed,
                save_slots,
                local_is_host,
            } => CurrentGameSession::natural_start_with_scheduler(
                profile,
                seed,
                context.local_seat,
                save_slots,
                local_is_host,
                self.content.clone(),
                context.scheduler,
                context.protocol,
            )?,
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
        };
        Ok(session)
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
                            next_timer_id: None,
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
                }),
            },
        )?;
        let response = host.process_bytes(&bytes)?;
        Ok((host, bytes, response))
    }

    fn evidence(host: &BrowserKernelHostV2) -> Result<Vec<u8>, Box<dyn Error>> {
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
            &host.repro_base,
            &host.repro_inputs,
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
        assert_eq!(host.process_bytes(&initialization)?, ready);
        assert_eq!(host.process_bytes(&event)?, fresh.process_bytes(&event)?);
        assert_eq!(evidence(&host)?, evidence(&fresh)?);
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
        assert_eq!(host.process_bytes(&initialization)?, ready);
        assert_eq!(evidence(&host)?, before);
        Ok(())
    }
}
