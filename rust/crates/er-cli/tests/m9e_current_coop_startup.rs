//! Real JSONL/native and process-Worker startup, with a native browser-host mirror.
//! Actual Wasm/Worker/WebRTC transport qualification remains a separate platform check.
use er_env::current::CurrentExternalEvent;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m72_bootstrap::RunBootstrapStageV1;
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7};
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1, KernelSessionIdV1,
};
use er_lab::kernel_reload::VerifiedKernelExecutableV2;
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_protocol::proposal::ProposalLeaseConfig;
use er_protocol::recovery::RecoveryTransactionConfig;
use er_protocol::replica::AuthorityReplicaConfig;
use er_repro::current::{CurrentReproCapsuleV1, CurrentReproLimitsV1, replay_current_capsule_v1};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::{
    ConnectionGeneration, FrameContext, GameControlPlanV2, InputFocus, MembershipRevision,
    PhysicalKey, RawInputEvent, RunId, SafeU53, SeatId, SessionId, StarterSelectionV1, TimeClass,
};
use er_web::contracts_v2::{
    BrowserEffectV2, BrowserRequestEnvelopeV2, BrowserRequestV2, BrowserResponseEnvelopeV2,
    BrowserResponseV2, BrowserSessionContextV2, BrowserSessionInitializationV2,
};
use er_web::host_v2::BrowserKernelHostV2;
use serde_json::{Value, json};
use std::error::Error;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

const SESSION: &str = "current-coop-entry";
const SEED: &str = "current-coop-entry";
const LINE_BOUND: usize = 4 << 20;
const RESPONSE_BOUND: usize = 8 << 20;
type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type Line = Result<Option<Vec<u8>>, String>;
type WriteJob = (Vec<u8>, mpsc::SyncSender<Result<(), String>>);
type ChoicePublication = (Vec<StarterSelectionV1>, Vec<Vec<u8>>);
#[path = "support/m9e_coop_cli_process.rs"]
mod process;
use process::Cli;

fn content_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/m9/engineering/game-content-bundle-v2.json")
}
fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("bounded test value")
}
fn profile() -> TestResult<ProfileStateV1> {
    Ok(ProfileStateV1 {
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
            highest_wave: WaveIndex::new(safe(1))?,
        },
        dex: DexState::default(),
    })
}

struct Endpoint {
    cli: Cli,
    browser: BrowserKernelHostV2,
    browser_sequence: u64,
    host: bool,
    observed_control: Option<GameControlPlanV2>,
}
impl Endpoint {
    fn new(content: Arc<PreparedGameContentV2>, worker: bool, host: bool) -> TestResult<Self> {
        let authority = SeatId::new(safe(1));
        let guest = SeatId::new(safe(2));
        let local = if host { authority } else { guest };
        let generation = ConnectionGeneration::new(safe(1));
        let config = if host {
            authority_protocol(authority, guest, generation)?
        } else {
            replica_protocol(authority, guest, generation)?
        };
        let protocol = initial_battle_protocol_snapshot_v2(&config, local)?;
        let mut cli = Cli::new(worker, content.as_ref())?;
        cli.result(
            "session.create",
            json!({"session": SESSION, "start": {
                "kind": "NATURAL_COOP", "profile": profile()?, "seed": SEED, "owner_seat": local,
                "save_slots": ["entry-slot"], "local_is_host": host, "protocol": protocol,
            }}),
        )?;
        let mut endpoint = Self {
            cli,
            browser: BrowserKernelHostV2::from_content(content),
            browser_sequence: 0,
            host,
            observed_control: None,
        };
        endpoint.browser_request(BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::NaturalCoop {
                context: BrowserSessionContextV2 {
                    local_seat: local,
                    role: if host {
                        GameKernelRoleV7::Authority
                    } else {
                        GameKernelRoleV7::Replica
                    },
                    scheduler: KernelSchedulerSnapshotV2 {
                        next_timer_id: Some(SafeU53::ZERO),
                        timers: Vec::new(),
                        pauses: Vec::new(),
                        disposed: false,
                    },
                    protocol: Some(protocol),
                },
                profile: profile()?,
                seed: SEED.to_owned(),
                save_slots: vec!["entry-slot".to_owned()],
                local_is_host: host,
            }),
        })?;
        endpoint.checkpoint()?;
        Ok(endpoint)
    }
    fn browser_request(&mut self, request: BrowserRequestV2) -> TestResult<BrowserResponseV2> {
        let sequence = self.browser_sequence;
        let envelope = BrowserRequestEnvelopeV2 {
            version: 2,
            request_id: safe(sequence + 1),
            sequence: safe(sequence),
            request,
        };
        let bytes = self
            .browser
            .process_bytes(&er_canonical::canonical_bytes(&envelope)?)?;
        let response: BrowserResponseEnvelopeV2 = serde_json::from_slice(&bytes)?;
        assert_eq!(response.request_id, envelope.request_id);
        assert_eq!(response.accepted_sequence, envelope.sequence);
        assert!(
            !matches!(response.response, BrowserResponseV2::Fault { .. }),
            "browser rejected valid entry request"
        );
        self.browser_sequence += 1;
        Ok(response.response)
    }
    fn checkpoint(&mut self) -> TestResult<CoreGameKernelSnapshotV7> {
        let snapshot: CoreGameKernelSnapshotV7 = serde_json::from_value(
            self.cli
                .result("session.snapshot", json!({"session":SESSION}))?,
        )?;
        let BrowserResponseV2::Snapshot { snapshot: browser } =
            self.browser_request(BrowserRequestV2::Snapshot)?
        else {
            return Err("browser snapshot absent".into());
        };
        assert_eq!(
            &snapshot,
            browser.as_ref(),
            "complete browser-host and actual CLI snapshot diverged"
        );
        Ok(snapshot)
    }
    fn control(&mut self) -> TestResult<GameControlPlanV2> {
        if let Some(control) = &self.observed_control {
            return Ok(control.clone());
        }
        let value = self.cli.result("session.observe", json!({"session":SESSION}))?;
        let control: GameControlPlanV2 = serde_json::from_value(value["control"].clone())?;
        self.observed_control = Some(control.clone());
        Ok(control)
    }
    fn event(&mut self, event: CurrentExternalEvent) -> TestResult<GameKernelStepV7> {
        let (method, params, request) = match event {
            CurrentExternalEvent::RawInput { input } => (
                "session.raw_input",
                json!({"session":SESSION,"input":input}),
                BrowserRequestV2::RawInput { event: input },
            ),
            CurrentExternalEvent::NetworkFrame { generation, bytes } => (
                "session.network_frame",
                json!({"session":SESSION,"generation":generation,"bytes":bytes}),
                BrowserRequestV2::NetworkFrame {
                    generation: generation.get(),
                    bytes,
                },
            ),
            CurrentExternalEvent::RetryCoopSetup => (
                "session.coop.retry",
                json!({"session":SESSION}),
                BrowserRequestV2::RetryCoopSetup,
            ),
            _ => return Err("unsupported focused event".into()),
        };
        let result = self.cli.result(method, params)?;
        self.observed_control = serde_json::from_value(result["observation"]["control"].clone())?;
        let step: GameKernelStepV7 = serde_json::from_value(result["step"].clone())?;
        let BrowserResponseV2::Effects { batch } = self.browser_request(request)? else {
            return Err("browser effect response absent".into());
        };
        let frames = network_frames(&step);
        let browser_frames = batch
            .effects
            .iter()
            .filter_map(|effect| match effect {
                BrowserEffectV2::SendNetworkFrame { generation, bytes } => {
                    assert_eq!(*generation, safe(1));
                    Some(bytes.clone())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            frames, browser_frames,
            "actual outgoing startup frames differ by entry"
        );
        let native_presentation = step
            .effects
            .iter()
            .filter_map(|effect| match effect {
                GameKernelEffectV7::Presentation(effect) => Some(effect),
                _ => None,
            })
            .collect::<Vec<_>>();
        let browser_presentation = batch
            .effects
            .iter()
            .filter_map(|effect| match effect {
                BrowserEffectV2::Presentation { effect } => Some(effect),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(native_presentation, browser_presentation);
        if !self.host {
            assert!(
                step.effects
                    .iter()
                    .all(|effect| !matches!(effect, GameKernelEffectV7::Platform(_)))
            );
            assert!(
                batch
                    .effects
                    .iter()
                    .all(|effect| !matches!(effect, BrowserEffectV2::StorageRequest { .. }))
            );
        }
        Ok(step)
    }
    fn press(&mut self, key: PhysicalKey) -> TestResult<Vec<Vec<u8>>> {
        let mut frames = Vec::new();
        for input in [
            RawInputEvent::KeyDown {
                code: key.clone(),
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
            RawInputEvent::KeyUp { code: key },
        ] {
            frames.extend(network_frames(
                &self.event(CurrentExternalEvent::RawInput { input })?,
            ));
        }
        Ok(frames)
    }
    fn navigate(&mut self, target: &str) -> TestResult {
        let initial = self.control()?;
        let bound = initial.menu.as_ref().ok_or("menu absent")?.options.len() + 1;
        for _ in 0..bound {
            let control = self.control()?;
            let menu = control.menu.as_ref().ok_or("menu disappeared")?;
            if menu.selected_option_id.as_str() == target {
                return Ok(());
            }
            let current = menu
                .options
                .iter()
                .position(|option| option.option_id == menu.selected_option_id)
                .ok_or("selected option absent")?;
            let wanted = menu
                .options
                .iter()
                .position(|option| option.option_id.as_str() == target)
                .ok_or("target absent")?;
            // The actual bootstrap graph is a non-wrapping ordered list.
            let key = if wanted < current { PhysicalKey::ArrowUp } else { PhysicalKey::ArrowDown };
            assert!(self.press(key)?.is_empty());
        }
        Err(format!("raw target {target} unreachable from {:?}", self.control()?.menu.map(|menu| menu.selected_option_id)).into())
    }
    fn choose(&mut self, content: &PreparedGameContentV2) -> TestResult<ChoicePublication> {
        let mode = content
            .bundle()
            .bootstrap
            .modes
            .iter()
            .find(|mode| mode.cooperative && mode.supported)
            .ok_or("cooperative mode absent")?;
        let mut frames = self.press(PhysicalKey::Space)?;
        self.navigate(&format!("bootstrap/mode/{}", mode.mode.get()))?;
        frames.extend(self.press(PhysicalKey::Space)?);
        if mode.challenge_selection && self.host {
            self.navigate("bootstrap/challenge/done")?;
            frames.extend(self.press(PhysicalKey::Space)?);
        }
        let GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) = self.checkpoint()?.lifecycle
        else {
            return Err("raw starter menu absent".into());
        };
        assert_eq!(bootstrap.stage, RunBootstrapStageV1::StarterSelect);
        let count = if self.host { 1 } else { 2 };
        let mut chosen = Vec::new();
        let mut budget = bootstrap.catalog.maximum_starter_cost;
        for starter in bootstrap
            .catalog
            .starters
            .iter()
            .skip(if self.host { 0 } else { 2 })
        {
            if starter.cost <= budget {
                budget -= starter.cost;
                chosen.push(starter.clone());
                if chosen.len() == count {
                    break;
                }
            }
        }
        assert_eq!(chosen.len(), count);
        for starter in &chosen {
            self.navigate(&format!("bootstrap/starter/{}", starter.pokemon_id.get()))?;
            frames.extend(self.press(PhysicalKey::Space)?);
        }
        self.navigate("bootstrap/starter/confirm")?;
        frames.extend(self.press(PhysicalKey::Space)?);
        frames.extend(self.press(PhysicalKey::Space)?);
        if self.host {
            for _ in 0..4 {
                let snapshot = self.checkpoint()?;
                if matches!(snapshot.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(ref setup) if setup.stage == RunBootstrapStageV1::Complete)
                {
                    break;
                }
                frames.extend(self.press(PhysicalKey::Space)?);
            }
        }
        Ok((chosen, frames))
    }
    fn replay_capture(&mut self, content: Arc<PreparedGameContentV2>, native: bool) -> TestResult {
        let expected = self.checkpoint()?;
        if native {
            let exported = self
                .cli
                .result("session.capsule.export", json!({"session":SESSION}))?;
            let capsule: CurrentReproCapsuleV1 =
                serde_json::from_value(exported["capsule"].clone())?;
            assert!(
                capsule
                    .attempts
                    .iter()
                    .any(|attempt| matches!(attempt.event, CurrentExternalEvent::RetryCoopSetup))
            );
            assert!(
                capsule.attempts.iter().any(|attempt| matches!(
                    attempt.event,
                    CurrentExternalEvent::NetworkFrame { .. }
                ))
            );
            assert_eq!(
                replay_current_capsule_v1(
                    &capsule,
                    content.clone(),
                    CurrentReproLimitsV1::default()
                )?
                .snapshot()?,
                expected
            );
        }
        let BrowserResponseV2::Effects { batch } =
            self.browser_request(BrowserRequestV2::ExportRepro)?
        else {
            return Err("browser capsule effect absent".into());
        };
        let bytes = batch
            .effects
            .iter()
            .find_map(|effect| match effect {
                BrowserEffectV2::CurrentReproReady { capsule_bytes } => Some(capsule_bytes),
                _ => None,
            })
            .ok_or("browser capsule absent")?;
        let capsule: CurrentReproCapsuleV1 = serde_json::from_slice(bytes)?;
        assert!(
            capsule
                .attempts
                .iter()
                .any(|attempt| matches!(attempt.event, CurrentExternalEvent::RetryCoopSetup))
        );
        assert_eq!(
            replay_current_capsule_v1(&capsule, content, CurrentReproLimitsV1::default())?
                .snapshot()?,
            expected
        );
        Ok(())
    }
    fn finish(mut self) -> TestResult {
        self.cli
            .result("session.close", json!({"session":SESSION}))?;
        self.browser_request(BrowserRequestV2::Dispose)?;
        self.cli.finish()
    }
}
fn network_frames(step: &GameKernelStepV7) -> Vec<Vec<u8>> {
    step.effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::ProposalReady { bytes, .. }
            | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .collect()
}
fn exercise(worker: bool) -> TestResult {
    let bundle: GameContentBundleV2 = serde_json::from_slice(&std::fs::read(content_path())?)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let mut host = Endpoint::new(content.clone(), worker, true)?;
    let mut guest = Endpoint::new(content.clone(), worker, false)?;
    let (host_choices, frames) = host.choose(content.as_ref())?;
    assert!(frames.is_empty());
    assert!(
        matches!(host.checkpoint()?.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(ref setup) if setup.stage == RunBootstrapStageV1::Complete)
    );
    let (guest_choices, frames) = guest.choose(content.as_ref())?;
    assert_eq!(frames.len(), 1);
    let choices = &frames[0];
    let retried = guest.event(CurrentExternalEvent::RetryCoopSetup)?;
    assert_eq!(network_frames(&retried), frames);
    assert_eq!(retried.effects.len(), 1);
    let admitted = host.event(CurrentExternalEvent::NetworkFrame {
        generation: ConnectionGeneration::new(safe(1)),
        bytes: choices.clone(),
    })?;
    let replies = network_frames(&admitted);
    assert_eq!(replies.len(), 1);
    let host_before = host.checkpoint()?;
    let retry = host.event(CurrentExternalEvent::RetryCoopSetup)?;
    assert_eq!(network_frames(&retry), replies);
    assert_eq!(retry.effects.len(), 1);
    assert_eq!(host.checkpoint()?, host_before);
    let duplicate = host.event(CurrentExternalEvent::NetworkFrame {
        generation: ConnectionGeneration::new(safe(1)),
        bytes: choices.clone(),
    })?;
    assert_eq!(network_frames(&duplicate), replies);
    assert_eq!(duplicate.effects.len(), 1);
    let applied = guest.event(CurrentExternalEvent::NetworkFrame {
        generation: ConnectionGeneration::new(safe(1)),
        bytes: replies[0].clone(),
    })?;
    assert!(network_frames(&applied).is_empty());
    let guest_before = guest.checkpoint()?;
    assert_eq!(host_before.lifecycle, guest_before.lifecycle);
    assert_eq!(host_before.material_ledger, guest_before.material_ledger);
    assert_eq!(
        host_before.pending_presentations,
        guest_before.pending_presentations
    );
    let GameKernelLifecycleSnapshotV7::Active(state) = &guest_before.lifecycle else {
        return Err("co-op did not activate".into());
    };
    let run = state.active_run.as_ref().ok_or("run absent")?;
    assert_eq!(run.party.len(), host_choices.len() + guest_choices.len());
    for (pokemon, selected) in run
        .party
        .iter()
        .zip(host_choices.iter().chain(&guest_choices))
    {
        assert_eq!(pokemon.owner_seat, Some(selected.owner_seat));
        assert_eq!(pokemon.species_id.get(), selected.species_id);
        assert_eq!(pokemon.form_index, selected.form_index);
    }
    assert!(
        guest
            .event(CurrentExternalEvent::NetworkFrame {
                generation: ConnectionGeneration::new(safe(1)),
                bytes: replies[0].clone()
            })?
            .effects
            .is_empty()
    );
    assert_eq!(guest.checkpoint()?, guest_before);
    host.replay_capture(content.clone(), !worker)?;
    guest.replay_capture(content, !worker)?;
    host.finish()?;
    guest.finish()
}
#[test]
fn current_native_cli_owned_coop_retry_replay_matches_browser_host() -> TestResult {
    exercise(false)
}
#[test]
fn current_process_worker_owned_coop_retry_replay_matches_browser_host() -> TestResult {
    exercise(true)
}
fn frame(
    sender: SeatId,
    authority: SeatId,
    generation: ConnectionGeneration,
) -> Result<FrameContext, Box<dyn Error>> {
    Ok(FrameContext {
        session_id: SessionId::new("m9e-coop-session")?,
        run_id: RunId::new("m9e-coop-run")?,
        session_epoch: safe(1),
        seat_map_id: "m9e-coop-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: sender,
        authority_seat_id: authority,
        connection_generation: generation,
    })
}

fn authority_protocol(
    host: SeatId,
    guest: SeatId,
    generation: ConnectionGeneration,
) -> Result<BattleProtocolConfig, Box<dyn Error>> {
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: frame(host, host, generation)?,
                peer_bindings: vec![PeerBinding {
                    seat_id: guest,
                    connection_generation: generation,
                }],
                owner_id: "m9e-coop-authority".to_owned(),
                retain_capacity: safe(32),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(1),
                    maximum_ms: safe(64),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(8)),
            },
            proposal_capacity: safe(64),
        },
    })
}

fn replica_protocol(
    host: SeatId,
    guest: SeatId,
    generation: ConnectionGeneration,
) -> Result<BattleProtocolConfig, Box<dyn Error>> {
    let context = frame(guest, host, generation)?;
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Replica {
            replica: AuthorityReplicaConfig {
                receipt_context: context.clone(),
                authority_seat_id: host,
                authority_connection_generation: generation,
            },
            proposal_leases: ProposalLeaseConfig {
                owner_prefix: "m9e-coop-proposal".to_owned(),
                retry_initial_ms: safe(1),
                retry_maximum_ms: safe(64),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: context,
                request_timeout_ms: safe(300_000),
                control_timeout_ms: safe(30_000),
                pacing_ms: safe(16),
                timer_owner_id: "m9e-coop-recovery".to_owned(),
            },
        },
    })
}
