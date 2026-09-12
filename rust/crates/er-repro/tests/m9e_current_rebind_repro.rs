//! Actual owned current sessions, chronological rebind controls and generation-two replay.
//! Natural checkpoints use the qualified kernel witness setup; no handshake is fabricated.
use std::error::Error;
use std::sync::{Arc, OnceLock};

use er_env::current::{
    CurrentCoopRebindEventV1, CurrentExternalEvent, CurrentGameObservation, CurrentGameSession,
    CurrentSessionError, CurrentSessionRebindOutputV1,
};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m72_bootstrap::RunBootstrapStageV1;
use er_kernel::game_kernel_v7::current_coop_rebind_v7::CurrentCoopRebindPhaseV1;
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7, GameKernelV7Error,
    KernelPresentationOutcomeV2,
};
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_protocol::proposal::ProposalLeaseConfig;
use er_protocol::recovery::RecoveryTransactionConfig;
use er_protocol::replica::AuthorityReplicaConfig;
use er_repro::current::{
    CurrentCaptureStatusV1, CurrentReproCapsuleV1, CurrentReproLimitsV1, CurrentReproOutcomeV1,
    CurrentReproRecorderV1, replay_current_capsule_v1,
};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::{
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey, RawInputEvent,
    RunId, SafeU53, SeatId, SessionId, TimeClass,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
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

fn press(kernel: &mut GameKernelV7, code: PhysicalKey) -> Result<(), Box<dyn Error>> {
    kernel.raw_input(RawInputEvent::KeyDown {
        code: code.clone(),
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    })?;
    kernel.raw_input(RawInputEvent::KeyUp { code })?;
    Ok(())
}

fn navigate(kernel: &mut GameKernelV7, id: &str) -> Result<(), Box<dyn Error>> {
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .ok_or("missing natural menu")?
        .options
        .len()
        + 1;
    for _ in 0..bound {
        if kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == id)
        {
            return Ok(());
        }
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    let selected = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map_or("<no-menu>", |menu| menu.selected_option_id.as_str());
    Err(format!("raw option {id} is unreachable from {selected}").into())
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

fn owned_title(
    content: Arc<PreparedGameContentV2>,
    host: bool,
) -> Result<GameKernelV7, Box<dyn Error>> {
    owned_title_with_capacity(content, host, safe(64))
}

fn owned_title_with_capacity(
    content: Arc<PreparedGameContentV2>,
    host: bool,
    capacity: SafeU53,
) -> Result<GameKernelV7, Box<dyn Error>> {
    let authority = SeatId::new(safe(1));
    let replica = SeatId::new(safe(2));
    let seat = if host { authority } else { replica };
    let generation = ConnectionGeneration::new(safe(1));
    let mut config = if host {
        authority_protocol(authority, replica, generation)?
    } else {
        replica_protocol(authority, replica, generation)?
    };
    if let BattleProtocolRoleConfig::Authority {
        proposal_capacity, ..
    } = &mut config.role
    {
        *proposal_capacity = capacity;
    }
    let protocol = initial_battle_protocol_snapshot_v2(&config, seat)?;
    let mut kernel = GameKernelV7::natural_start(
        profile()?,
        "owned-startup".to_owned(),
        seat,
        vec!["owned-save".to_owned()],
        host,
        content,
        KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        Some(protocol),
    )?;
    let before = kernel.snapshot()?;
    assert!(
        before.current_coop_setup.is_none(),
        "capability must not activate by default"
    );
    kernel.enable_current_coop_setup()?;
    assert!(kernel.current_control().is_some());
    Ok(kernel)
}

fn capture_press(
    kernel: &mut GameKernelV7,
    frames: &mut Vec<Vec<u8>>,
) -> Result<(), Box<dyn Error>> {
    for input in [
        RawInputEvent::KeyDown {
            code: PhysicalKey::Space,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp {
            code: PhysicalKey::Space,
        },
    ] {
        for effect in kernel.raw_input(input)?.effects {
            match effect {
                GameKernelEffectV7::ProposalReady { bytes, .. }
                | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => frames.push(bytes),
                _ => {}
            }
        }
    }
    Ok(())
}

fn wire(step: &GameKernelStepV7) -> Result<Vec<u8>, Box<dyn Error>> {
    let bytes = step
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::ProposalReady { bytes, .. }
            | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(bytes.len(), 1);
    Ok(bytes[0].clone())
}

fn content() -> TestResult<Arc<PreparedGameContentV2>> {
    static CONTENT: OnceLock<Result<Arc<PreparedGameContentV2>, String>> = OnceLock::new();
    CONTENT
        .get_or_init(|| {
            let bundle: GameContentBundleV2 =
                serde_json::from_slice(BUNDLE).map_err(|error| error.to_string())?;
            PreparedGameContentV2::prepare(Arc::new(bundle))
                .map(Arc::new)
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .cloned()
        .map_err(|error| error.clone().into())
}

fn choose_first_natural_starter(kernel: &mut GameKernelV7, host: bool) -> TestResult<Vec<Vec<u8>>> {
    let content = content()?;
    let mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| mode.cooperative && mode.supported)
        .ok_or("co-op mode")?;
    let mut frames = Vec::new();
    capture_press(kernel, &mut frames)?;
    navigate(kernel, &format!("bootstrap/mode/{}", mode.mode.get()))?;
    capture_press(kernel, &mut frames)?;
    if mode.challenge_selection && host {
        navigate(kernel, "bootstrap/challenge/done")?;
        capture_press(kernel, &mut frames)?;
    }
    let GameKernelLifecycleSnapshotV7::Bootstrap(before) = kernel.snapshot()?.lifecycle else {
        return Err("natural starter stage".into());
    };
    assert_eq!(before.stage, RunBootstrapStageV1::StarterSelect);
    let starter = before
        .catalog
        .starters
        .iter()
        .find(|starter| starter.cost <= before.catalog.maximum_starter_cost)
        .ok_or("affordable starter")?;
    navigate(
        kernel,
        &format!("bootstrap/starter/{}", starter.pokemon_id.get()),
    )?;
    capture_press(kernel, &mut frames)?;
    navigate(kernel, "bootstrap/starter/confirm")?;
    capture_press(kernel, &mut frames)?;
    capture_press(kernel, &mut frames)?;
    if host {
        for _ in 0..4 {
            if kernel.state().is_some()
                || matches!(kernel.snapshot()?.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(ref bootstrap) if bootstrap.stage == RunBootstrapStageV1::Complete)
            {
                break;
            }
            capture_press(kernel, &mut frames)?;
        }
    }
    Ok(frames)
}

fn pair() -> TestResult<(GameKernelV7, GameKernelV7)> {
    pair_with_capacity(safe(64))
}

fn pair_with_capacity(capacity: SafeU53) -> TestResult<(GameKernelV7, GameKernelV7)> {
    let mut host = if capacity == safe(64) {
        owned_title(content()?, true)?
    } else {
        owned_title_with_capacity(content()?, true, capacity)?
    };
    let mut guest = if capacity == safe(64) {
        owned_title(content()?, false)?
    } else {
        owned_title_with_capacity(content()?, false, capacity)?
    };
    let choices = choose_first_natural_starter(&mut guest, false)?;
    let waiting = choose_first_natural_starter(&mut host, true)?;
    assert_eq!(choices.len(), 1);
    assert!(waiting.is_empty());
    let started =
        wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(1)), &choices[0])?)?;
    guest.ingest_network_frame(ConnectionGeneration::new(safe(1)), &started)?;
    assert!(host.state().is_some() && guest.state().is_some());
    assert_eq!(host.state(), guest.state());
    assert!(guest.snapshot()?.current_proposal.is_none());
    Ok((host, guest))
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn reference_event(
    kernel: &mut GameKernelV7,
    event: CurrentExternalEvent,
) -> Result<GameKernelStepV7, GameKernelV7Error> {
    match event {
        CurrentExternalEvent::CoopRebind { .. } => Err(GameKernelV7Error::Invalid),
        CurrentExternalEvent::CurrentUtcClockResult {
            request_id,
            utc_milliseconds,
        } => kernel.apply_current_utc_clock_result(request_id, utc_milliseconds),
        CurrentExternalEvent::CurrentFlashEggInputs { input } => kernel.apply_current_flash_egg_inputs(input),
        CurrentExternalEvent::RetryCoopSetup => kernel.retry_current_coop_setup(),
        CurrentExternalEvent::RawInput { input } => kernel.raw_input(input),
        CurrentExternalEvent::AdvanceTime { milliseconds } => kernel.advance_time(milliseconds),
        CurrentExternalEvent::NetworkFrame { generation, bytes } => {
            kernel.ingest_network_frame(generation, &bytes)
        }
        CurrentExternalEvent::ProposalFrame { bytes } => kernel.admit_game_proposal(&bytes),
        CurrentExternalEvent::AuthorityMaterial { bytes } => {
            kernel.apply_authority_material(&bytes)
        }
        CurrentExternalEvent::TransportChanged {
            generation,
            connected,
        } => {
            kernel.transport_changed(generation, connected)?;
            Ok(GameKernelStepV7::default())
        }
        CurrentExternalEvent::PresentationOutcome { event_id, outcome } => {
            kernel.settle_presentation_outcome(event_id, outcome)?;
            Ok(GameKernelStepV7::default())
        }
        CurrentExternalEvent::StorageResult { request_id, result } => {
            kernel.apply_storage_result(request_id, result)
        }
    }
}

struct Captured {
    session: CurrentGameSession,
    reference: GameKernelV7,
    recorder: CurrentReproRecorderV1,
}

impl Captured {
    fn new(reference: GameKernelV7, host: bool) -> TestResult<Self> {
        let seat = SeatId::new(safe(if host { 1 } else { 2 }));
        let role = if host {
            GameKernelRoleV7::Authority
        } else {
            GameKernelRoleV7::Replica
        };
        let snapshot = reference.snapshot()?;
        let session = CurrentGameSession::from_snapshot(snapshot.clone(), seat, role, content()?)?;
        let recorder = CurrentReproRecorderV1::new(
            snapshot,
            seat,
            role,
            content()?,
            CurrentReproLimitsV1::default(),
        )?;
        let value = Self {
            session,
            reference,
            recorder,
        };
        value.check()?;
        Ok(value)
    }

    fn check(&self) -> TestResult {
        assert_eq!(self.session.snapshot()?, self.reference.snapshot()?);
        let expected = CurrentGameObservation {
            kernel_version: 7,
            content_identity: content()?.identity().clone(),
            mechanical_digest: self
                .reference
                .state()
                .map(er_canonical::content_digest)
                .transpose()?
                .map(|digest| format!("blake3-v1:{digest}")),
            control: self.reference.current_control().cloned(),
        };
        assert_eq!(self.session.observe()?, expected);
        Ok(())
    }

    fn ordinary(&mut self, event: CurrentExternalEvent) -> TestResult<GameKernelStepV7> {
        let before = self.session.snapshot()?;
        let mut candidate = self.reference.clone();
        let expected = reference_event(&mut candidate, event.clone())?;
        candidate.validate()?;
        let result = self.session.apply(event.clone());
        let actual = result.as_ref().map_err(|error| error.to_string())?;
        assert_eq!(actual, &expected);
        self.reference = candidate;
        self.check()?;
        let after = self.session.snapshot()?;
        let observation = self.session.observe()?;
        assert!(matches!(
            self.recorder
                .record(&before, event, result.as_ref(), &after, &observation),
            CurrentCaptureStatusV1::Available { .. }
        ));
        Ok(result?)
    }

    fn rebind(
        &mut self,
        control: CurrentCoopRebindEventV1,
    ) -> TestResult<Result<CurrentSessionRebindOutputV1, CurrentSessionError>> {
        let before = self.session.snapshot()?;
        let mut candidate = self.reference.clone();
        let expected = match &control {
            CurrentCoopRebindEventV1::Begin => candidate.begin_current_coop_rebind_v1(),
            CurrentCoopRebindEventV1::Retry => candidate.retry_current_coop_rebind_v1(),
            CurrentCoopRebindEventV1::Receive { generation, bytes } => {
                candidate.receive_current_coop_rebind_v1(*generation, bytes)
            }
        };
        let result = self.session.apply_rebind(control.clone());
        match (&result, expected) {
            (Ok(actual), Ok(expected)) => {
                assert_eq!(actual.generation, expected.generation);
                assert_eq!(actual.frames, expected.frames);
                assert_eq!(
                    serde_json::from_slice::<CurrentSessionRebindOutputV1>(&serde_json::to_vec(
                        actual
                    )?)?,
                    *actual
                );
                candidate.validate()?;
                self.reference = candidate;
            }
            (Err(actual), Err(expected)) => {
                assert_eq!(actual.to_string(), expected.to_string());
                assert_eq!(self.session.snapshot()?, before);
            }
            _ => return Err("typed rebind result differs from actual kernel".into()),
        }
        self.check()?;
        let after = self.session.snapshot()?;
        let observation = self.session.observe()?;
        assert!(matches!(
            self.recorder.record_rebind_with_origin(
                &before,
                control,
                result.as_ref(),
                &after,
                &observation,
                Some("session.coop.rebind")
            ),
            CurrentCaptureStatusV1::Available { .. }
        ));
        Ok(result)
    }

    fn replay(&self) -> TestResult<CurrentReproCapsuleV1> {
        let capsule = self.recorder.export()?;
        let bytes = serde_json::to_vec(&capsule)?;
        let decoded: CurrentReproCapsuleV1 = serde_json::from_slice(&bytes)?;
        assert_eq!(decoded, capsule);
        let replayed =
            replay_current_capsule_v1(&decoded, content()?, CurrentReproLimitsV1::default())?;
        assert_eq!(replayed.snapshot()?, self.session.snapshot()?);
        assert_eq!(replayed.observe()?, self.session.observe()?);
        Ok(capsule)
    }

    fn restore_midphase(&mut self) -> TestResult {
        let snapshot = self.session.snapshot()?;
        let capsule = self.replay()?;
        let encoded = er_canonical::canonical_bytes(&snapshot)?;
        let (seat, role) = self.session.session_context()?;
        self.session = CurrentGameSession::from_snapshot(
            serde_json::from_slice(&encoded)?,
            seat,
            role,
            content()?,
        )?;
        self.reference =
            GameKernelV7::from_snapshot(serde_json::from_slice(&encoded)?, seat, role, content()?)?;
        let (recorder, replayed) = CurrentReproRecorderV1::from_capsule(
            capsule,
            content()?,
            CurrentReproLimitsV1::default(),
        )?;
        assert_eq!(replayed.snapshot()?, snapshot);
        self.recorder = recorder;
        self.check()?;
        assert_eq!(self.session.snapshot()?, snapshot);
        Ok(())
    }

    fn press(&mut self) -> TestResult<Vec<Vec<u8>>> {
        let mut frames = Vec::new();
        for input in [
            RawInputEvent::KeyDown {
                code: PhysicalKey::Space,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
            RawInputEvent::KeyUp {
                code: PhysicalKey::Space,
            },
        ] {
            let step = self.ordinary(CurrentExternalEvent::RawInput { input })?;
            for effect in step.effects {
                match effect {
                    GameKernelEffectV7::ProposalReady { bytes, .. }
                    | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => frames.push(bytes),
                    _ => {}
                }
            }
        }
        Ok(frames)
    }

    fn settle(&mut self) -> TestResult<usize> {
        let mut count = 0;
        for _ in 0..16 {
            let pending = self.session.snapshot()?.pending_presentations;
            if pending.is_empty() {
                return Ok(count);
            }
            for presentation in pending {
                self.ordinary(CurrentExternalEvent::PresentationOutcome {
                    event_id: presentation.event_id,
                    outcome: KernelPresentationOutcomeV2::Settled,
                })?;
                count += 1;
            }
        }
        Err("actual presentation callbacks exceeded sixteen batches".into())
    }

    fn next_frame(&mut self) -> TestResult<Vec<u8>> {
        for _ in 0..8 {
            self.settle()?;
            let frames = self.press()?;
            if !frames.is_empty() {
                let [frame] = frames.as_slice() else {
                    return Err("one actual gameplay frame required".into());
                };
                return Ok(frame.clone());
            }
        }
        Err("eight actual presses did not publish current gameplay".into())
    }
}

fn captured_pair() -> TestResult<(Captured, Captured)> {
    let (host, guest) = pair()?;
    Ok((Captured::new(host, true)?, Captured::new(guest, false)?))
}

fn control_frame(output: &CurrentSessionRebindOutputV1) -> TestResult<Vec<u8>> {
    assert_eq!(output.generation, generation(2));
    let [bytes] = output.frames.as_slice() else {
        return Err("exactly one actual control frame".into());
    };
    Ok(bytes.clone())
}

fn begin_sessions(host: &mut Captured, guest: &mut Captured) -> TestResult<Vec<u8>> {
    for peer in [&mut *host, &mut *guest] {
        peer.ordinary(CurrentExternalEvent::TransportChanged {
            generation: generation(1),
            connected: false,
        })?;
        assert!(
            peer.rebind(CurrentCoopRebindEventV1::Begin)??
                .frames
                .is_empty()
        );
        let before = peer.session.snapshot()?;
        let position = peer.recorder.export()?.final_position;
        assert!(
            peer.rebind(CurrentCoopRebindEventV1::Begin)??
                .frames
                .is_empty()
        );
        assert_eq!(peer.session.snapshot()?, before);
        assert_eq!(peer.recorder.export()?.final_position, position + 1);
        peer.ordinary(CurrentExternalEvent::TransportChanged {
            generation: generation(2),
            connected: true,
        })?;
    }
    control_frame(&host.rebind(CurrentCoopRebindEventV1::Retry)??)
}

fn handshake_sessions(host: &mut Captured, guest: &mut Captured, mut bytes: Vec<u8>) -> TestResult {
    for index in 0usize..8 {
        let peer = if index.is_multiple_of(2) {
            &mut *guest
        } else {
            &mut *host
        };
        let output = peer.rebind(CurrentCoopRebindEventV1::Receive {
            generation: generation(2),
            bytes,
        })??;
        if index < 7 {
            bytes = control_frame(&output)?;
        } else {
            assert!(output.frames.is_empty());
            bytes = Vec::new();
        }
        if index == 2 {
            let before = peer.session.snapshot()?;
            let position = peer.recorder.export()?.final_position;
            peer.restore_midphase()?;
            let retry = peer.rebind(CurrentCoopRebindEventV1::Retry)??;
            assert_eq!(retry, output);
            assert_eq!(peer.session.snapshot()?, before);
            assert_eq!(peer.recorder.export()?.final_position, position + 1);
            bytes = control_frame(&retry)?;
        }
    }
    for peer in [host, guest] {
        let snapshot = peer.session.snapshot()?;
        let owner = snapshot
            .current_coop_setup
            .as_ref()
            .and_then(|setup| setup.rebind.as_deref())
            .ok_or("actual owner missing")?;
        assert_eq!(owner.phase, CurrentCoopRebindPhaseV1::Open);
        assert_eq!(owner.transcript.len(), 8);
        peer.replay()?;
    }
    Ok(())
}
#[test]
fn natural_rebind_controls_and_generation_two_gameplay_replay_exactly() -> TestResult {
    let (mut host, mut guest) = captured_pair()?;
    let offer = begin_sessions(&mut host, &mut guest)?;
    handshake_sessions(&mut host, &mut guest, offer)?;
    host.settle()?;
    guest.settle()?;
    host.ordinary(CurrentExternalEvent::AdvanceTime {
        milliseconds: SafeU53::ZERO,
    })?;
    let material = host.next_frame()?;
    er_game::m9e_material_v6::GameMaterialV6::decode(&material)?;
    guest.ordinary(CurrentExternalEvent::NetworkFrame {
        generation: generation(2),
        bytes: material,
    })?;
    host.settle()?;
    guest.settle()?;
    let proposal = guest.next_frame()?;
    let decoded = er_kernel::current_proposal_v7::decode_current_proposal_v1(&proposal)?;
    assert_eq!(decoded.connection_generation, generation(2));
    let pending = guest.session.snapshot()?;
    assert_eq!(
        wire(&guest.ordinary(CurrentExternalEvent::RetryCoopSetup)?)?,
        proposal
    );
    assert_eq!(guest.session.snapshot()?, pending);
    let reply = wire(&host.ordinary(CurrentExternalEvent::NetworkFrame {
        generation: generation(2),
        bytes: proposal.clone(),
    })?)?;
    let receipt = er_kernel::current_proposal_v7::CurrentProposalMaterialReceiptV2::decode(&reply)?;
    assert_eq!(receipt.evidence()?.proposal_bytes, proposal);
    assert_eq!(
        receipt.authority_context.connection_generation,
        generation(2)
    );
    assert!(
        er_kernel::current_proposal_v7::CurrentProposalMaterialReceiptV1::decode(&reply).is_err()
    );
    let host_after = host.session.snapshot()?;
    assert_eq!(
        wire(&host.ordinary(CurrentExternalEvent::NetworkFrame {
            generation: generation(2),
            bytes: proposal
        })?)?,
        reply
    );
    assert_eq!(host.session.snapshot()?, host_after);
    guest.restore_midphase()?;
    guest.ordinary(CurrentExternalEvent::NetworkFrame {
        generation: generation(2),
        bytes: reply.clone(),
    })?;
    assert!(guest.session.snapshot()?.current_proposal.is_none());
    let guest_after = guest.session.snapshot()?;
    assert!(
        guest
            .ordinary(CurrentExternalEvent::NetworkFrame {
                generation: generation(2),
                bytes: reply
            })?
            .effects
            .is_empty()
    );
    assert_eq!(guest.session.snapshot()?, guest_after);
    assert!(guest.settle()? > 0);
    host.settle()?;
    assert_eq!(
        host.session.kernel_ref()?.state(),
        guest.session.kernel_ref()?.state()
    );
    for peer in [&host, &guest] {
        let capsule = peer.replay()?;
        assert_eq!(capsule.schema_version, 1);
        assert!(capsule.attempts.iter().any(|attempt| matches!(
            &attempt.event,
            CurrentExternalEvent::PresentationOutcome { .. }
        )));
        assert!(capsule.attempts.iter().any(|attempt| matches!(
            &attempt.event,
            CurrentExternalEvent::TransportChanged { .. }
        )));
        let received = capsule
            .attempts
            .iter()
            .filter(|attempt| {
                matches!(
                    &attempt.event,
                    CurrentExternalEvent::CoopRebind {
                        control: CurrentCoopRebindEventV1::Receive { .. }
                    }
                )
            })
            .count();
        assert_eq!(received, 4);
        assert!(
            capsule
                .attempts
                .iter()
                .filter(|attempt| matches!(&attempt.event, CurrentExternalEvent::CoopRebind { .. }))
                .all(|attempt| attempt.origin.as_deref() == Some("session.coop.rebind"))
        );
        assert!(capsule.attempts.iter().any(|attempt| matches!(
            &attempt.outcome,
            CurrentReproOutcomeV1::RebindApplied { .. }
        )));
        // Existing ordinary event/outcome encodings remain the original schema.
        let ordinary = capsule
            .attempts
            .iter()
            .find(|attempt| !matches!(&attempt.event, CurrentExternalEvent::CoopRebind { .. }))
            .ok_or("ordinary event missing")?;
        let value = serde_json::to_value(ordinary)?;
        assert_eq!(value["outcome"]["kind"], "APPLIED");
        assert!(value["outcome"].get("step").is_some());
        assert!(value["outcome"].get("output").is_none());
    }
    assert_eq!(
        serde_json::to_string(&CurrentExternalEvent::AdvanceTime {
            milliseconds: safe(1)
        })?,
        r#"{"kind":"ADVANCE_TIME","milliseconds":1}"#
    );
    Ok(())
}

#[derive(Debug)]
enum AdmissionError {
    Session(CurrentSessionError),
    ResponseBudget,
}
impl From<CurrentSessionError> for AdmissionError {
    fn from(error: CurrentSessionError) -> Self {
        Self::Session(error)
    }
}

#[test]
fn rebind_response_admission_and_rejections_preserve_complete_session() -> TestResult {
    let (mut host, mut guest) = captured_pair()?;
    let offer = begin_sessions(&mut host, &mut guest)?;
    let before = guest.session.snapshot()?;
    let observation = guest.session.observe()?;
    for control in [
        CurrentCoopRebindEventV1::Receive {
            generation: generation(1),
            bytes: offer.clone(),
        },
        CurrentCoopRebindEventV1::Receive {
            generation: generation(2),
            bytes: vec![255],
        },
    ] {
        let position = guest.recorder.export()?.final_position;
        assert!(guest.rebind(control)?.is_err());
        assert_eq!(guest.session.snapshot()?, before);
        assert_eq!(guest.session.observe()?, observation);
        assert_eq!(guest.recorder.export()?.final_position, position + 1);
    }
    let rejected = guest.replay()?;
    assert_eq!(
        rejected
            .attempts
            .iter()
            .filter(|attempt| matches!(
                &attempt.outcome,
                CurrentReproOutcomeV1::KernelRejected { .. }
            ))
            .count(),
        2
    );
    for malformed in [
        r#"{"kind":"BEGIN","unknown":true}"#,
        r#"{"kind":"RETRY","bytes":[]}"#,
        r#"{"kind":"RECEIVE","generation":2,"bytes":[],"unknown":0}"#,
        r#"{"kind":"UNKNOWN"}"#,
    ] {
        assert!(serde_json::from_str::<CurrentCoopRebindEventV1>(malformed).is_err());
    }
    let control = CurrentCoopRebindEventV1::Receive {
        generation: generation(2),
        bytes: offer.clone(),
    };
    let admission: Result<(), AdmissionError> = guest.session.apply_rebind_with(control.clone(), |candidate, output| {
        assert_eq!(output.frames.len(), 1);
        assert_ne!(candidate.snapshot()?, before);
        let response = serde_json::json!({"output":output,"observation":candidate.observe()?,"snapshot":candidate.snapshot()?});
        let bytes = serde_json::to_vec(&response).map_err(|error| AdmissionError::Session(CurrentSessionError::Digest(error.to_string())))?;
        if bytes.len() > 1 { return Err(AdmissionError::ResponseBudget); }
        Ok(())
    });
    match admission {
        Err(AdmissionError::ResponseBudget) => {}
        Err(AdmissionError::Session(error)) => return Err(error.into()),
        Ok(()) => return Err("one-byte response admission unexpectedly succeeded".into()),
    }
    assert_eq!(guest.session.snapshot()?, before);
    assert_eq!(guest.session.observe()?, observation);
    guest.check()?;
    assert!(matches!(
        guest
            .recorder
            .invalidate_attempt("response byte admission rejected"),
        CurrentCaptureStatusV1::Unavailable { .. }
    ));
    assert!(guest.recorder.export().is_err());
    let output = guest.rebind(control)??;
    assert_eq!(output.frames.len(), 1);
    let suffix = guest.replay()?;
    assert_eq!(suffix.attempts.len(), 1);
    assert_eq!(suffix.final_position, suffix.base_position + 1);

    let before = host.session.snapshot()?;
    let observation = host.session.observe()?;
    let (seat, role) = host.session.session_context()?;
    let origin_recorder = CurrentReproRecorderV1::new(
        before.clone(),
        seat,
        role,
        content()?,
        CurrentReproLimitsV1::default(),
    )?;
    let retry = host.session.apply_rebind(CurrentCoopRebindEventV1::Retry)?;
    assert_eq!(host.session.snapshot()?, before);
    let mut without_origin = origin_recorder.clone();
    assert!(matches!(
        without_origin.record_rebind(
            &before,
            CurrentCoopRebindEventV1::Retry,
            Ok(&retry),
            &before,
            &observation
        ),
        CurrentCaptureStatusV1::Available { .. }
    ));
    assert!(without_origin.export()?.attempts[0].origin.is_none());
    for length in [128, 129] {
        let mut recorder = origin_recorder.clone();
        let origin = "x".repeat(length);
        let status = recorder.record_rebind_with_origin(
            &before,
            CurrentCoopRebindEventV1::Retry,
            Ok(&retry),
            &before,
            &observation,
            Some(&origin),
        );
        if length == 128 {
            assert!(matches!(status, CurrentCaptureStatusV1::Available { .. }));
            let capsule = recorder.export()?;
            assert_eq!(capsule.attempts[0].origin.as_deref(), Some(origin.as_str()));
            assert_eq!(
                replay_current_capsule_v1(&capsule, content()?, CurrentReproLimitsV1::default())?
                    .snapshot()?,
                before
            );
        } else {
            assert!(matches!(status, CurrentCaptureStatusV1::Unavailable { .. }));
            assert!(recorder.export().is_err());
        }
    }
    let before = host.session.snapshot()?;
    let misuse = CurrentExternalEvent::CoopRebind {
        control: CurrentCoopRebindEventV1::Retry,
    };
    let outcome = host.session.apply(misuse.clone());
    assert!(outcome.is_err());
    assert_eq!(host.session.snapshot()?, before);
    let observation = host.session.observe()?;
    assert!(matches!(
        host.recorder
            .record(&before, misuse, outcome.as_ref(), &before, &observation),
        CurrentCaptureStatusV1::Unavailable { .. }
    ));
    assert!(host.recorder.export().is_err());
    host.check()?;
    Ok(())
}

fn renumber(capsule: &mut CurrentReproCapsuleV1) {
    for (index, attempt) in capsule.attempts.iter_mut().enumerate() {
        attempt.position = capsule.base_position + index as u64 + 1;
    }
    capsule.final_position = capsule.base_position + capsule.attempts.len() as u64;
}

#[test]
fn deleted_reordered_or_forged_rebind_attempts_fail_replay() -> TestResult {
    let (mut host, mut guest) = captured_pair()?;
    let offer = begin_sessions(&mut host, &mut guest)?;
    handshake_sessions(&mut host, &mut guest, offer)?;
    let original = guest.replay()?;
    let receives = original
        .attempts
        .iter()
        .enumerate()
        .filter_map(|(index, attempt)| {
            matches!(
                &attempt.event,
                CurrentExternalEvent::CoopRebind {
                    control: CurrentCoopRebindEventV1::Receive { .. }
                }
            )
            .then_some(index)
        })
        .collect::<Vec<_>>();
    assert_eq!(receives.len(), 4);
    let limits = CurrentReproLimitsV1::default();
    let mut deleted = original.clone();
    deleted.attempts.remove(receives[0]);
    renumber(&mut deleted);
    assert!(replay_current_capsule_v1(&deleted, content()?, limits).is_err());
    let mut reordered = original.clone();
    reordered.attempts.swap(receives[0], receives[1]);
    renumber(&mut reordered);
    assert!(replay_current_capsule_v1(&reordered, content()?, limits).is_err());
    let mut forged = original.clone();
    let CurrentReproOutcomeV1::RebindApplied { output, .. } =
        &mut forged.attempts[receives[0]].outcome
    else {
        return Err("actual typed control outcome missing".into());
    };
    assert_eq!(output.frames.len(), 1);
    let byte = output.frames[0]
        .first_mut()
        .ok_or("actual control frame empty")?;
    *byte ^= 1;
    assert!(replay_current_capsule_v1(&forged, content()?, limits).is_err());
    let mut wrong_kind = original.clone();
    let CurrentReproOutcomeV1::RebindApplied {
        observation,
        snapshot_digest,
        ..
    } = wrong_kind.attempts[receives[0]].outcome.clone()
    else {
        return Err("typed control outcome missing".into());
    };
    wrong_kind.attempts[receives[0]].outcome = CurrentReproOutcomeV1::Applied {
        step: Box::new(GameKernelStepV7::default()),
        observation,
        snapshot_digest,
    };
    assert!(wrong_kind.validate(limits).is_err());
    let mut wrong_event = original.clone();
    wrong_event.attempts[receives[0]].event = CurrentExternalEvent::AdvanceTime {
        milliseconds: SafeU53::ZERO,
    };
    assert!(wrong_event.validate(limits).is_err());
    assert_eq!(guest.recorder.export()?, original);
    guest.check()?;
    Ok(())
}
