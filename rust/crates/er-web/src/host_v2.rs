//! BrowserKernelHostV2: typed Wasm/browser owner over GameKernelV7.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_canonical::{canonical_bytes, content_digest};
use er_game::m9e_content_v2::{
    GameContentBundleV2, PreparedGameContentV2, PresentationSemanticIdV1,
};
use er_game::m9e_material_v6::{GamePlatformEffectV2, GameTelemetryEventV2};
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelStepV7, GameKernelV7};
use er_types::{SafeU53, ScenarioId};
use thiserror::Error;
use wasm_bindgen::prelude::*;

use crate::contracts_v2::{
    BROWSER_WORKER_PROTOCOL_VERSION_V2, BrowserEffectBatchV2, BrowserEffectV2,
    BrowserLifecycleEventV2, BrowserRequestEnvelopeV2, BrowserRequestV2, BrowserResponseEnvelopeV2,
    BrowserResponseV2, BrowserSessionInitializationV2, BrowserStorageRequestKindV2,
    BrowserStorageRequestV2, MAXIMUM_BROWSER_REQUEST_BYTES_V2, MAXIMUM_BROWSER_RESPONSE_BYTES_V2,
};

const MAXIMUM_RETAINED_REQUESTS_V2: usize = 2_048;

#[derive(Clone, Debug)]
struct RetainedBrowserRequestV2 {
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

#[wasm_bindgen]
#[derive(Debug)]
pub struct BrowserKernelHostV2 {
    content: Arc<PreparedGameContentV2>,
    kernel: Option<GameKernelV7>,
    next_sequence: SafeU53,
    generation: SafeU53,
    retained: BTreeMap<SafeU53, RetainedBrowserRequestV2>,
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
            kernel: None,
            next_sequence: SafeU53::ZERO,
            generation: safe_one(),
            retained: BTreeMap::new(),
            disposed: false,
        }
    }

    pub fn process_bytes(&mut self, request_bytes: &[u8]) -> Result<Vec<u8>, BrowserWebErrorV2> {
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
        if envelope.sequence != self.next_sequence
            || self.retained.len() >= MAXIMUM_RETAINED_REQUESTS_V2
        {
            return Err(BrowserWebErrorV2::Invalid);
        }
        let response = self.process_request(envelope.request)?;
        let response = BrowserResponseEnvelopeV2 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V2,
            request_id: envelope.request_id,
            accepted_sequence: envelope.sequence,
            response,
        };
        let bytes = canonical_bytes(&response).map_err(canonical_error)?;
        if bytes.len() > MAXIMUM_BROWSER_RESPONSE_BYTES_V2 {
            return Err(BrowserWebErrorV2::Invalid);
        }
        self.next_sequence = increment(self.next_sequence)?;
        self.retained.insert(
            envelope.request_id,
            RetainedBrowserRequestV2 {
                fingerprint,
                response: bytes.clone(),
            },
        );
        Ok(bytes)
    }

    pub fn kernel_ref(&self) -> Option<&GameKernelV7> {
        self.kernel.as_ref()
    }

    fn process_request(
        &mut self,
        request: BrowserRequestV2,
    ) -> Result<BrowserResponseV2, BrowserWebErrorV2> {
        match request {
            BrowserRequestV2::Initialize { initialization } => {
                if self.kernel.is_some() {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                self.initialize(*initialization)?;
                Ok(BrowserResponseV2::Ready)
            }
            BrowserRequestV2::RawInput { event } => {
                let step = self.kernel_mut()?.raw_input(event).map_err(kernel_error)?;
                self.effects(step)
            }
            BrowserRequestV2::ProposalFrame { bytes } => {
                let step = self
                    .kernel_mut()?
                    .admit_game_proposal(&bytes)
                    .map_err(kernel_error)?;
                self.effects(step)
            }
            BrowserRequestV2::AuthorityMaterial { bytes } => {
                let step = self
                    .kernel_mut()?
                    .apply_authority_material(&bytes)
                    .map_err(kernel_error)?;
                self.effects(step)
            }
            BrowserRequestV2::PresentationSettled { event_id } => {
                self.kernel_mut()?
                    .settle_presentation(event_id)
                    .map_err(kernel_error)?;
                self.effects(GameKernelStepV7::default())
            }
            BrowserRequestV2::StorageResult { request_id, .. } => {
                self.kernel_mut()?
                    .settle_platform_request(request_id)
                    .map_err(kernel_error)?;
                self.effects(GameKernelStepV7::default())
            }
            BrowserRequestV2::Lifecycle { event } => {
                if matches!(
                    event,
                    BrowserLifecycleEventV2::Suspend
                        | BrowserLifecycleEventV2::Hidden
                        | BrowserLifecycleEventV2::PageHide
                ) {
                    self.kernel_mut()?
                        .raw_input(er_types::RawInputEvent::WindowBlurred)
                        .map_err(kernel_error)?;
                }
                self.effects(GameKernelStepV7::default())
            }
            BrowserRequestV2::Snapshot => Ok(BrowserResponseV2::Snapshot {
                snapshot: Box::new(self.kernel()?.snapshot().map_err(kernel_error)?),
            }),
            BrowserRequestV2::ExportRepro => {
                let snapshot = self.kernel()?.snapshot().map_err(kernel_error)?;
                Ok(BrowserResponseV2::Effects {
                    batch: BrowserEffectBatchV2 {
                        external_sequence: self.next_sequence,
                        effects: vec![BrowserEffectV2::ReproReady {
                            snapshot: Box::new(snapshot),
                        }],
                    },
                })
            }
            BrowserRequestV2::Dispose => {
                self.kernel = None;
                self.disposed = true;
                Ok(BrowserResponseV2::Disposed)
            }
            BrowserRequestV2::AdvanceTime { .. }
            | BrowserRequestV2::NetworkFrame { .. }
            | BrowserRequestV2::TransportChanged { .. } => {
                self.effects(GameKernelStepV7::default())
            }
        }
    }

    fn initialize(
        &mut self,
        initialization: BrowserSessionInitializationV2,
    ) -> Result<(), BrowserWebErrorV2> {
        let kernel = match initialization {
            BrowserSessionInitializationV2::NaturalStart {
                context,
                profile,
                seed,
                save_slots,
                local_is_host,
            } => GameKernelV7::natural_start(
                profile,
                seed,
                context.local_seat,
                save_slots,
                local_is_host,
                self.content.clone(),
                context.scheduler,
                context.protocol,
            )
            .map_err(kernel_error)?,
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
                GameKernelV7::from_active(
                    save.state,
                    revision,
                    context.local_seat,
                    context.role,
                    self.content.clone(),
                    empty_input_router(),
                    context.scheduler,
                    context.protocol,
                )
                .map_err(kernel_error)?
            }
            BrowserSessionInitializationV2::Snapshot { context, snapshot } => {
                GameKernelV7::from_snapshot(
                    snapshot,
                    context.local_seat,
                    context.role,
                    self.content.clone(),
                )
                .map_err(kernel_error)?
            }
            BrowserSessionInitializationV2::Scenario {
                context,
                snapshot,
                scenario,
            } => {
                let kernel = GameKernelV7::from_snapshot(
                    snapshot,
                    context.local_seat,
                    context.role,
                    self.content.clone(),
                )
                .map_err(kernel_error)?;
                if active_scenario(&kernel) != Some(scenario) {
                    return Err(BrowserWebErrorV2::Invalid);
                }
                kernel
            }
            BrowserSessionInitializationV2::ReproCapsule {
                context,
                snapshot,
                inputs,
            } => {
                let mut kernel = GameKernelV7::from_snapshot(
                    snapshot,
                    context.local_seat,
                    context.role,
                    self.content.clone(),
                )
                .map_err(kernel_error)?;
                for input in inputs {
                    kernel.raw_input(input).map_err(kernel_error)?;
                }
                kernel
            }
        };
        self.generation = kernel
            .snapshot()
            .ok()
            .and_then(|snapshot| {
                snapshot
                    .protocol
                    .map(|protocol| protocol.frame_context.context.connection_generation.get())
            })
            .unwrap_or_else(safe_one);
        self.kernel = Some(kernel);
        Ok(())
    }

    fn effects(&self, step: GameKernelStepV7) -> Result<BrowserResponseV2, BrowserWebErrorV2> {
        let mut effects = Vec::new();
        for effect in step.effects {
            match effect {
                GameKernelEffectV7::UiChanged(control) => {
                    let semantic = PresentationSemanticIdV1::Control(control.kind);
                    effects.push(BrowserEffectV2::UiChanged { control });
                    if let Some(mapping) = self.content.presentation(semantic) {
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
                    effects.push(BrowserEffectV2::SendNetworkFrame {
                        generation: self.generation,
                        bytes,
                    });
                }
                GameKernelEffectV7::AuthorityMaterial { bytes, .. } => {
                    effects.push(BrowserEffectV2::SendNetworkFrame {
                        generation: self.generation,
                        bytes,
                    });
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
                external_sequence: self.next_sequence,
                effects,
            },
        })
    }

    fn kernel(&self) -> Result<&GameKernelV7, BrowserWebErrorV2> {
        self.kernel.as_ref().ok_or(BrowserWebErrorV2::Invalid)
    }

    fn kernel_mut(&mut self) -> Result<&mut GameKernelV7, BrowserWebErrorV2> {
        self.kernel.as_mut().ok_or(BrowserWebErrorV2::Invalid)
    }
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

fn kernel_error(error: er_kernel::game_kernel_v7::GameKernelV7Error) -> BrowserWebErrorV2 {
    BrowserWebErrorV2::Kernel(error.to_string())
}

fn js_error(error: BrowserWebErrorV2) -> JsValue {
    JsValue::from_str(&error.to_string())
}
