//! Two real native JSONL clients: natural starts, owned rebind and complete capture.
//! No Worker, Wasm, physical network or arbitrary-frontier recovery claim.
use std::error::Error;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, OnceLock, mpsc};
use std::time::{Duration, Instant};

use er_env::current::{CurrentCoopRebindEventV1, CurrentExternalEvent, CurrentGameSession, CurrentSessionRebindOutputV1};
use er_game::m72_bootstrap::RunBootstrapStageV1;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelStepV7, KernelPresentationOutcomeV2};
use er_kernel::game_kernel_v7::current_coop_rebind_v7::CurrentCoopRebindPhaseV1;
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_kernel_worker::{KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1, KernelSessionIdV1};
use er_lab::kernel_reload::VerifiedKernelExecutableV2;
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_protocol::proposal::ProposalLeaseConfig;
use er_protocol::recovery::RecoveryTransactionConfig;
use er_protocol::replica::AuthorityReplicaConfig;
use er_repro::current::{CurrentReproCapsuleV1, CurrentReproLimitsV1, CurrentReproOutcomeV1, replay_current_capsule_v1};
use er_state::m7_state::{DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics};
use er_types::battle_ids::WaveIndex;
use er_types::{ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey, RawInputEvent, RunId, SafeU53, SeatId, SessionId, TimeClass};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
type Line = Result<Option<Vec<u8>>, String>;
type WriteJob = (Vec<u8>, mpsc::SyncSender<Result<(), String>>);
const SESSION: &str = "gen2-current-cli";
const LINE_BOUND: usize = 4 << 20;
const RESPONSE_BOUND: usize = 8 << 20;
#[path = "support/m9e_coop_cli_process.rs"]
mod process;
use process::Cli;

// Exact source setup from the qualified kernel witness; runtime startup still uses real JSONL.
fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("bounded fixture integer")
}

fn profile() -> Result<ProfileStateV1, Box<dyn Error>> {
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



fn content_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/m9/engineering/game-content-bundle-v2.json")
}
fn content() -> TestResult<Arc<PreparedGameContentV2>> {
    static CONTENT: OnceLock<Result<Arc<PreparedGameContentV2>, String>> = OnceLock::new();
    CONTENT.get_or_init(|| {
        let raw = std::fs::read(content_path()).map_err(|error| error.to_string())?;
        let bundle: GameContentBundleV2 = serde_json::from_slice(&raw).map_err(|error| error.to_string())?;
        PreparedGameContentV2::prepare(Arc::new(bundle)).map(Arc::new).map_err(|error| error.to_string())
    }).as_ref().cloned().map_err(|error| error.clone().into())
}
fn generation(value: u64) -> ConnectionGeneration { ConnectionGeneration::new(safe(value)) }
fn frames(step: &GameKernelStepV7) -> Vec<Vec<u8>> {
    step.effects.iter().filter_map(|effect| match effect {
        GameKernelEffectV7::ProposalReady { bytes, .. } | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()),
        _ => None,
    }).collect()
}
fn one_frame(values: &[Vec<u8>]) -> TestResult<Vec<u8>> {
    let [bytes] = values else { return Err("exactly one actual frame required".into()); };
    Ok(bytes.clone())
}

struct Endpoint { cli: Cli, session: CurrentGameSession, host: bool }
impl Endpoint {
    fn new(host: bool) -> TestResult<Self> {
        let content = content()?;
        let authority = SeatId::new(safe(1));
        let guest = SeatId::new(safe(2));
        let seat = if host { authority } else { guest };
        let config = if host { authority_protocol(authority, guest, generation(1))? }
            else { replica_protocol(authority, guest, generation(1))? };
        let protocol = initial_battle_protocol_snapshot_v2(&config, seat)?;
        let mut session = CurrentGameSession::natural_start(profile()?, "owned-startup".to_owned(), seat,
            vec!["owned-save".to_owned()], host, Arc::clone(&content), Some(protocol.clone()))?;
        session.enable_current_coop_setup()?;
        let mut cli = Cli::new(false, &content)?;
        cli.result("session.create", json!({"session":SESSION,"start":{
            "kind":"NATURAL_COOP","profile":profile()?,"seed":"owned-startup","owner_seat":seat,
            "save_slots":["owned-save"],"local_is_host":host,"protocol":protocol
        }}))?;
        let mut value = Self { cli, session, host };
        value.checkpoint()?;
        Ok(value)
    }
    fn checkpoint(&mut self) -> TestResult<CoreGameKernelSnapshotV7> {
        let snapshot = self.session.snapshot()?;
        assert_eq!(self.cli.result("session.snapshot", json!({"session":SESSION}))?, serde_json::to_value(&snapshot)?);
        Ok(snapshot)
    }
    fn ordinary(&mut self, event: CurrentExternalEvent) -> TestResult<GameKernelStepV7> {
        let step = self.session.apply(event.clone())?;
        let response = self.cli.result("platform.event", json!({"session":SESSION,"event":event}))?;
        assert_eq!(response, json!({"step":step,"observation":self.session.observe()?}));
        Ok(step)
    }
    fn rebind(&mut self, control: CurrentCoopRebindEventV1) -> TestResult<CurrentSessionRebindOutputV1> {
        let output = self.session.apply_rebind(control.clone())?;
        let response = self.cli.result("session.coop.rebind", json!({"session":SESSION,"control":control}))?;
        assert_eq!(response, json!({"rebind":output,"observation":self.session.observe()?}));
        self.checkpoint()?;
        Ok(output)
    }
    fn reject_control(&mut self, control: CurrentCoopRebindEventV1) -> TestResult {
        let before = self.checkpoint()?;
        let error = self.session.apply_rebind(control.clone()).expect_err("wrong-generation control must fail");
        assert_eq!(self.session.snapshot()?, before);
        let response = self.cli.request("session.coop.rebind", json!({"session":SESSION,"control":control}))?;
        assert_eq!(response["error"]["code"], "BACKEND_ERROR");
        assert_eq!(response["error"]["message"], error.to_string());
        assert_eq!(self.checkpoint()?, before);
        let capsule = self.capture()?;
        let last = capsule.attempts.last().ok_or("recorded rejection missing")?;
        assert_eq!(last.origin.as_deref(), Some("session.coop.rebind"));
        assert!(matches!(&last.event, CurrentExternalEvent::CoopRebind { .. }));
        assert!(matches!(&last.outcome, CurrentReproOutcomeV1::KernelRejected { .. }));
        Ok(())
    }
    fn press(&mut self) -> TestResult<Vec<Vec<u8>>> {
        let mut wire = Vec::new();
        for input in [RawInputEvent::KeyDown {code:PhysicalKey::Space,printable:false,browser_repeat:false,focus:InputFocus::Game},
            RawInputEvent::KeyUp {code:PhysicalKey::Space}] {
            wire.extend(frames(&self.ordinary(CurrentExternalEvent::RawInput {input})?));
        }
        Ok(wire)
    }
    fn choose(&mut self, target: &str) -> TestResult<Vec<Vec<u8>>> {
        let before = self.checkpoint()?;
        let description = self.cli.result("control.describe", json!({"session":SESSION}))?;
        let plan = self.cli.result("control.plan_navigation", json!({"session":SESSION,
            "expected_menu_instance":description["description"]["menu_instance"],
            "expected_control_digest":description["control_digest"],"target":target,"submit":true,"maximum_events":4096}))?;
        assert_eq!(self.checkpoint()?, before);
        let inputs: Vec<RawInputEvent> = serde_json::from_value(plan["plan"]["events"].clone())?;
        assert!(!inputs.is_empty());
        let mut wire = Vec::new();
        for input in inputs {wire.extend(frames(&self.ordinary(CurrentExternalEvent::RawInput {input})?));}
        Ok(wire)
    }
    fn starters(&mut self) -> TestResult<Vec<Vec<u8>>> {
        let content = content()?;
        let mode = content.bundle().bootstrap.modes.iter().find(|mode| mode.cooperative && mode.supported).ok_or("co-op mode")?;
        let mut wire = self.press()?;
        wire.extend(self.choose(&format!("bootstrap/mode/{}", mode.mode.get()))?);
        if mode.challenge_selection && self.host {wire.extend(self.choose("bootstrap/challenge/done")?);}
        let GameKernelLifecycleSnapshotV7::Bootstrap(before) = self.checkpoint()?.lifecycle else {return Err("starter stage".into());};
        assert_eq!(before.stage, RunBootstrapStageV1::StarterSelect);
        let starter = before.catalog.starters.iter().find(|starter| starter.cost <= before.catalog.maximum_starter_cost).ok_or("starter")?;
        wire.extend(self.choose(&format!("bootstrap/starter/{}", starter.pokemon_id.get()))?);
        wire.extend(self.choose("bootstrap/starter/confirm")?);
        wire.extend(self.press()?);
        if self.host {
            for _ in 0..4 {
                let snapshot = self.session.snapshot()?;
                if matches!(&snapshot.lifecycle, GameKernelLifecycleSnapshotV7::Active(_))
                    || matches!(&snapshot.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(value) if value.stage == RunBootstrapStageV1::Complete) {break;}
                wire.extend(self.press()?);
            }
        }
        self.checkpoint()?;
        Ok(wire)
    }
    fn capture(&mut self) -> TestResult<CurrentReproCapsuleV1> {
        let value = self.cli.result("session.capsule.export", json!({"session":SESSION}))?;
        let capsule: CurrentReproCapsuleV1 = serde_json::from_value(value["capsule"].clone())?;
        let replay = replay_current_capsule_v1(&capsule, content()?, CurrentReproLimitsV1::default())?;
        assert_eq!(replay.snapshot()?, self.checkpoint()?);
        assert_eq!(replay.observe()?, self.session.observe()?);
        Ok(capsule)
    }
    fn restore_same(&mut self) -> TestResult {
        let snapshot = self.checkpoint()?;
        self.cli.result("session.restore", json!({"session":SESSION,"snapshot":snapshot}))?;
        assert_eq!(self.checkpoint()?, snapshot);
        Ok(())
    }
    fn settle(&mut self) -> TestResult<usize> {
        let mut count = 0;
        for _ in 0..16 {
            let pending = self.session.snapshot()?.pending_presentations;
            if pending.is_empty() {return Ok(count);}
            for presentation in pending {
                self.ordinary(CurrentExternalEvent::PresentationOutcome {event_id:presentation.event_id,outcome:KernelPresentationOutcomeV2::Settled})?;
                count += 1;
            }
        }
        Err("presentation boundary exceeded".into())
    }
    fn next_frame(&mut self) -> TestResult<Vec<u8>> {
        for _ in 0..8 {self.settle()?;let values=self.press()?;if !values.is_empty() {return one_frame(&values);}}
        Err("natural gameplay frame missing".into())
    }
}

fn reject_actual_control_response(peer: &mut Endpoint, control: CurrentCoopRebindEventV1) -> TestResult {
    let before = peer.checkpoint()?;
    let original_capture = peer.capture()?;
    let (seat, role) = peer.session.session_context()?;
    peer.cli.result("session.from_snapshot", json!({"session":"admission-probe","snapshot":before,"owner_seat":seat,"role":role}))?;
    let mut candidate = peer.session.fork()?;
    let expected = candidate.apply_rebind(control.clone())?;
    assert_ne!(candidate.snapshot()?, before);
    let params = json!({"session":"admission-probe","control":control});
    let empty = json!({"protocol_version":1,"id":"","method":"session.coop.rebind","params":params});
    let long_id = "r".repeat(LINE_BOUND-serde_json::to_vec(&empty)?.len()-2);
    let success = json!({"protocol_version":1,"id":long_id,"artifact":null,"error":null,
        "result":{"rebind":expected,"observation":candidate.observe()?}});
    assert!(serde_json::to_vec(&success)?.len()+1 > LINE_BOUND);
    drop(success);
    let denied = peer.cli.request_id("session.coop.rebind", params.clone(), &long_id)?;
    assert_eq!(denied["error"]["code"],"BACKEND_ERROR");
    assert!(denied["error"]["message"].as_str().is_some_and(|message|message.contains("success response JSONL")));
    drop(denied);drop(long_id);
    assert_eq!(peer.cli.result("session.snapshot",json!({"session":"admission-probe"}))?,serde_json::to_value(&before)?);
    assert_eq!(peer.cli.result("session.capsule.status",json!({"session":"admission-probe"}))?["status"]["kind"],"UNAVAILABLE");
    assert_eq!(peer.capture()?,original_capture);
    let accepted = peer.cli.result("session.coop.rebind",params)?;
    assert_eq!(accepted,json!({"rebind":expected,"observation":candidate.observe()?}));
    assert_eq!(peer.cli.result("session.snapshot",json!({"session":"admission-probe"}))?,serde_json::to_value(candidate.snapshot()?)?);
    let suffix: CurrentReproCapsuleV1 = serde_json::from_value(peer.cli.result("session.capsule.export",json!({"session":"admission-probe"}))?["capsule"].clone())?;
    assert_eq!(suffix.attempts.len(),1);
    assert_eq!(*suffix.checkpoint,before);
    assert_eq!(replay_current_capsule_v1(&suffix,content()?,CurrentReproLimitsV1::default())?.snapshot()?,candidate.snapshot()?);
    peer.cli.result("session.close",json!({"session":"admission-probe"}))?;
    Ok(())
}

#[test]
fn actual_native_cli_rebind_preserves_capture_admission_restore_and_gameplay() -> TestResult {
    let mut host = Endpoint::new(true)?;
    let mut guest = Endpoint::new(false)?;
    let choices = one_frame(&guest.starters()?)?;
    assert!(host.starters()?.is_empty());
    let started = one_frame(&frames(&host.ordinary(CurrentExternalEvent::NetworkFrame {generation:generation(1),bytes:choices})?))?;
    guest.ordinary(CurrentExternalEvent::NetworkFrame {generation:generation(1),bytes:started})?;
    assert_eq!(host.session.kernel_ref()?.state(), guest.session.kernel_ref()?.state());
    for peer in [&mut host,&mut guest] {
        assert!(matches!(peer.checkpoint()?.lifecycle, GameKernelLifecycleSnapshotV7::Active(_)));
        // Reset capture at its own genuine started checkpoint, before any rebind input.
        peer.restore_same()?;
        peer.ordinary(CurrentExternalEvent::TransportChanged {generation:generation(1),connected:false})?;
        assert!(peer.rebind(CurrentCoopRebindEventV1::Begin)?.frames.is_empty());
        peer.ordinary(CurrentExternalEvent::TransportChanged {generation:generation(2),connected:true})?;
    }
    let mut wire = one_frame(&host.rebind(CurrentCoopRebindEventV1::Retry)?.frames)?;
    guest.reject_control(CurrentCoopRebindEventV1::Receive {generation:generation(1),bytes:wire.clone()})?;
    reject_actual_control_response(&mut guest, CurrentCoopRebindEventV1::Receive {generation:generation(2),bytes:wire.clone()})?;
    for index in 0usize..8 {
        let peer = if index.is_multiple_of(2) {&mut guest} else {&mut host};
        let output = peer.rebind(CurrentCoopRebindEventV1::Receive {generation:generation(2),bytes:wire})?;
        let before = peer.checkpoint()?;
        let capsule = peer.capture()?;
        let retried = peer.rebind(CurrentCoopRebindEventV1::Retry)?;
        assert_eq!(peer.checkpoint()?, before);
        assert_eq!(peer.capture()?.final_position, capsule.final_position+1);
        if index < 7 {assert_eq!(retried,output);wire=one_frame(&retried.frames)?;}
        else {assert!(output.frames.is_empty());wire=Vec::new();}
        if index == 2 {
            // Import the complete current capsule through the actual CLI into another session.
            let imported = peer.capture()?;
            peer.cli.result("session.from_capsule", json!({"session":"restored-midphase","capsule":imported}))?;
            assert_eq!(peer.cli.result("session.snapshot", json!({"session":"restored-midphase"}))?,serde_json::to_value(&before)?);
            let response=peer.cli.result("session.coop.rebind", json!({"session":"restored-midphase","control":CurrentCoopRebindEventV1::Retry}))?;
            assert_eq!(response,json!({"rebind":retried,"observation":peer.session.observe()?}));
            peer.cli.result("session.close",json!({"session":"restored-midphase"}))?;
        }
    }
    for peer in [&mut host,&mut guest] {
        let snapshot=peer.checkpoint()?;
        let owner=snapshot.current_coop_setup.as_ref().and_then(|setup|setup.rebind.as_deref()).ok_or("rebind owner")?;
        assert_eq!(owner.phase,CurrentCoopRebindPhaseV1::Open);
        assert_eq!(owner.transcript.len(),8);
        let capsule=peer.capture()?;
        let receives=capsule.attempts.iter().enumerate().filter_map(|(index,attempt)|matches!(&attempt.event,CurrentExternalEvent::CoopRebind{control:CurrentCoopRebindEventV1::Receive{..}}).then_some(index)).collect::<Vec<_>>();
        assert_eq!(receives.len(),if peer.host {4} else {5});
        assert!(capsule.attempts.iter().filter(|attempt|matches!(&attempt.event,CurrentExternalEvent::CoopRebind{..})).all(|attempt|attempt.origin.as_deref()==Some("session.coop.rebind") && matches!(&attempt.outcome,CurrentReproOutcomeV1::RebindApplied{..}|CurrentReproOutcomeV1::KernelRejected{..})));
        let accepted = receives.iter().copied().filter(|index|matches!(&capsule.attempts[*index].outcome,CurrentReproOutcomeV1::RebindApplied{..})).collect::<Vec<_>>();
        assert_eq!(accepted.len(),4);
        let mut missing=capsule.clone();missing.attempts.remove(accepted[0]);
        for(index,attempt)in missing.attempts.iter_mut().enumerate(){attempt.position=missing.base_position+index as u64+1;}
        missing.final_position=missing.base_position+missing.attempts.len() as u64;
        assert!(replay_current_capsule_v1(&missing,content()?,CurrentReproLimitsV1::default()).is_err());
        let denied=peer.cli.request("session.from_capsule",json!({"session":"missing-control","capsule":missing}))?;
        assert_eq!(denied["error"]["code"],"BACKEND_ERROR");
        assert_eq!(peer.capture()?,capsule);
    }
    host.settle()?;guest.settle()?;
    let material=host.next_frame()?;
    guest.ordinary(CurrentExternalEvent::NetworkFrame{generation:generation(2),bytes:material})?;
    host.settle()?;guest.settle()?;
    let proposal=guest.next_frame()?;
    let reply=one_frame(&frames(&host.ordinary(CurrentExternalEvent::NetworkFrame{generation:generation(2),bytes:proposal.clone()})?))?;
    let receipt=er_kernel::current_proposal_v7::CurrentProposalMaterialReceiptV2::decode(&reply)?;
    assert_eq!(receipt.evidence()?.proposal_bytes,proposal);
    assert_eq!(receipt.authority_context.connection_generation,generation(2));
    let host_after=host.checkpoint()?;
    assert_eq!(one_frame(&frames(&host.ordinary(CurrentExternalEvent::NetworkFrame{generation:generation(2),bytes:proposal})?))?,reply);
    assert_eq!(host.checkpoint()?,host_after);
    guest.ordinary(CurrentExternalEvent::NetworkFrame{generation:generation(2),bytes:reply})?;
    assert!(guest.settle()?>0);host.settle()?;
    assert_eq!(host.session.kernel_ref()?.state(),guest.session.kernel_ref()?.state());
    host.capture()?;guest.capture()?;

    let before=host.checkpoint()?;
    for control in [json!({"kind":"BEGIN","unknown":true}),json!({"kind":"UNKNOWN"})] {
        assert_eq!(host.cli.request("session.coop.rebind",json!({"session":SESSION,"control":control}))?["error"]["code"],"INVALID_REQUEST");
        assert_eq!(host.checkpoint()?,before);
    }
    for (method, code) in [
        ("session.coop.rebind.extra", "METHOD_NOT_FOUND"),
        ("session.coop.rebind_begin", "METHOD_NOT_FOUND"),
        ("session.coop.resolve_turn", "METHOD_FORBIDDEN"),
    ] {
        assert_eq!(host.cli.request(method, json!({"session":SESSION,"control":{"kind":"RETRY"}}))?["error"]["code"], code);
        assert_eq!(host.checkpoint()?, before);
    }
    host.cli.finish()?;guest.cli.finish()?;
    Ok(())
}
