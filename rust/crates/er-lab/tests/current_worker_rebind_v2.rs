//! Actual subprocess rebind and typed reload-tail witnesses.
//! Only genuine enabled natural Title snapshots are prepared in the parent test;
//! every bootstrap input runs in a real Worker fixture. Each case restores its exact
//! reached snapshots in fresh Workers before any rebind, frame or callback.
use er_env::current::{
    CurrentCoopRebindEventV1, CurrentExternalEvent, CurrentGameSession,
    CurrentSessionRebindOutputV1,
};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m72_bootstrap::RunBootstrapStageV1;
use er_kernel::game_kernel_v7::current_coop_rebind_v7::CurrentCoopRebindPhaseV1;
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7,
    KernelPresentationOutcomeV2,
};
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_kernel_worker::{
    KERNEL_WORKER_ABI_VERSION_V2, KernelGenerationIdentityV2, KernelGenerationV1,
    KernelSessionIdV1, KernelWorkerInitializationV2, MAXIMUM_WORKER_FRAME_BYTES_V2,
};
use er_lab::kernel_reload::{
    ChildKernelGenerationV2, CurrentKernelSupervisorV2, CurrentReloadErrorV2, CurrentTailLimitsV2,
    CurrentTraceRetentionV2, VerifiedKernelExecutableV2,
};
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_protocol::proposal::ProposalLeaseConfig;
use er_protocol::recovery::RecoveryTransactionConfig;
use er_protocol::replica::AuthorityReplicaConfig;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::{
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey, RawInputEvent,
    RunId, SafeU53, SeatId, SessionId, TimeClass,
};
use std::error::Error;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
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

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn artifact(content: &PreparedGameContentV2, host: bool) -> TestResult<VerifiedKernelExecutableV2> {
    let executable = PathBuf::from(std::env::var("ER_M9E_WORKER_EXECUTABLE")?);
    let digest = std::env::var("ER_M9E_WORKER_EXECUTABLE_SHA256")?;
    let identity = KernelGenerationIdentityV2 {
        schema_version: 2,
        session_id: KernelSessionIdV1(
            if host {
                "owned-worker-host"
            } else {
                "owned-worker-guest"
            }
            .to_owned(),
        ),
        generation: KernelGenerationV1(1),
        artifact_sha256: digest.clone(),
        executable_sha256: digest,
        source_git_sha: std::env::var("ER_M9E_WORKER_SOURCE_SHA")?,
        worker_abi_version: KERNEL_WORKER_ABI_VERSION_V2,
        minimum_snapshot_schema: 7,
        maximum_snapshot_schema: 7,
        content_identity: content.identity().clone(),
        build_target: std::env::var("ER_M9E_WORKER_BUILD_TARGET")?,
        build_profile: std::env::var("ER_M9E_WORKER_BUILD_PROFILE")?,
    };
    Ok(VerifiedKernelExecutableV2::verify(
        executable.parent().ok_or("worker parent")?,
        &executable,
        identity,
    )?)
}

fn next_artifact(previous: &VerifiedKernelExecutableV2) -> TestResult<VerifiedKernelExecutableV2> {
    let mut identity = previous.identity().clone();
    identity.generation = KernelGenerationV1(identity.generation.0 + 1);
    Ok(VerifiedKernelExecutableV2::verify(
        previous.allowed_root(),
        previous.executable(),
        identity,
    )?)
}

struct Peer {
    worker: CurrentKernelSupervisorV2,
    reference: CurrentGameSession,
    artifact: VerifiedKernelExecutableV2,
    bundle: GameContentBundleV2,
}

impl Peer {
    fn new(
        bundle: &GameContentBundleV2,
        content: Arc<PreparedGameContentV2>,
        host: bool,
        limits: CurrentTailLimitsV2,
    ) -> TestResult<Self> {
        let title = owned_title(Arc::clone(&content), host)?.snapshot()?;
        assert!(
            matches!(&title.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) if bootstrap.stage == RunBootstrapStageV1::Title)
        );
        assert!(
            title
                .current_coop_setup
                .as_ref()
                .is_some_and(|owner| owner.started.is_none())
        );
        assert!(title.current_proposal.is_none());
        Self::from_snapshot(bundle, content, host, limits, title)
    }

    fn from_snapshot(
        bundle: &GameContentBundleV2,
        content: Arc<PreparedGameContentV2>,
        host: bool,
        limits: CurrentTailLimitsV2,
        title: CoreGameKernelSnapshotV7,
    ) -> TestResult<Self> {
        let seat = SeatId::new(safe(if host { 1 } else { 2 }));
        let role = if host {
            GameKernelRoleV7::Authority
        } else {
            GameKernelRoleV7::Replica
        };
        let artifact = artifact(&content, host)?;
        let reference = CurrentGameSession::from_snapshot(title.clone(), seat, role, content)?;
        let mut child = ChildKernelGenerationV2::spawn(&artifact)?;
        let observation = child.initialize(
            bundle.clone(),
            KernelWorkerInitializationV2::Snapshot {
                snapshot_bytes: serde_json::to_vec(&title)?,
                local_seat: seat,
                role,
            },
        )?;
        assert_eq!(observation, reference.observe()?);
        assert_eq!(child.snapshot()?, title);
        let worker = CurrentKernelSupervisorV2::new(child, limits)?;
        Ok(Self {
            worker,
            reference,
            artifact,
            bundle: bundle.clone(),
        })
    }

    fn snapshot(&mut self) -> TestResult<CoreGameKernelSnapshotV7> {
        let snapshot = self.worker.snapshot()?;
        assert_eq!(snapshot, self.reference.snapshot()?);
        Ok(snapshot)
    }

    fn ordinary(&mut self, event: CurrentExternalEvent) -> TestResult<GameKernelStepV7> {
        let expected = self.reference.apply(event.clone())?;
        let actual = self.worker.dispatch(event)?;
        assert_eq!(actual.evidence.step, expected);
        assert_eq!(actual.evidence.observation, self.reference.observe()?);
        Ok(actual.evidence.step)
    }

    fn rebind(
        &mut self,
        control: CurrentCoopRebindEventV1,
    ) -> TestResult<CurrentSessionRebindOutputV1> {
        let expected = self.reference.apply_rebind(control.clone())?;
        let actual = self
            .worker
            .dispatch_rebind(control, MAXIMUM_WORKER_FRAME_BYTES_V2)?;
        assert_eq!(actual.evidence.output, expected);
        assert_eq!(actual.evidence.observation, self.reference.observe()?);
        let wire = serde_json::to_value(&actual.evidence)?;
        assert!(wire.get("output").is_some());
        assert!(wire.get("step").is_none());
        self.snapshot()?;
        Ok(actual.evidence.output)
    }

    fn press(&mut self, code: PhysicalKey) -> TestResult<Vec<Vec<u8>>> {
        let mut frames = Vec::new();
        for input in [
            RawInputEvent::KeyDown {
                code: code.clone(),
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
            RawInputEvent::KeyUp { code },
        ] {
            for effect in self
                .ordinary(CurrentExternalEvent::RawInput { input })?
                .effects
            {
                match effect {
                    GameKernelEffectV7::ProposalReady { bytes, .. }
                    | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => frames.push(bytes),
                    _ => {}
                }
            }
        }
        Ok(frames)
    }

    fn navigate(&mut self, id: &str) -> TestResult {
        let bound = self
            .reference
            .observe()?
            .control
            .ok_or("natural control")?
            .menu
            .ok_or("natural menu")?
            .options
            .len()
            + 1;
        for _ in 0..bound {
            if self
                .reference
                .observe()?
                .control
                .and_then(|control| control.menu)
                .is_some_and(|menu| menu.selected_option_id.as_str() == id)
            {
                return Ok(());
            }
            assert!(self.press(PhysicalKey::ArrowDown)?.is_empty());
        }
        Err(format!("actual Worker raw option {id} unreachable").into())
    }

    fn choose(&mut self, content: &PreparedGameContentV2, host: bool) -> TestResult<Vec<Vec<u8>>> {
        let mode = content
            .bundle()
            .bootstrap
            .modes
            .iter()
            .find(|mode| mode.cooperative && mode.supported)
            .ok_or("cooperative mode")?;
        let mut frames = self.press(PhysicalKey::Space)?;
        self.navigate(&format!("bootstrap/mode/{}", mode.mode.get()))?;
        frames.extend(self.press(PhysicalKey::Space)?);
        if mode.challenge_selection && host {
            self.navigate("bootstrap/challenge/done")?;
            frames.extend(self.press(PhysicalKey::Space)?);
        }
        let GameKernelLifecycleSnapshotV7::Bootstrap(before) = self.snapshot()?.lifecycle else {
            return Err("actual starter lifecycle".into());
        };
        assert_eq!(before.stage, RunBootstrapStageV1::StarterSelect);
        let starter = before
            .catalog
            .starters
            .iter()
            .find(|starter| starter.cost <= before.catalog.maximum_starter_cost)
            .ok_or("affordable starter")?;
        self.navigate(&format!("bootstrap/starter/{}", starter.pokemon_id.get()))?;
        frames.extend(self.press(PhysicalKey::Space)?);
        self.navigate("bootstrap/starter/confirm")?;
        frames.extend(self.press(PhysicalKey::Space)?);
        frames.extend(self.press(PhysicalKey::Space)?);
        if host {
            for _ in 0..4 {
                let snapshot = self.snapshot()?;
                if matches!(
                    &snapshot.lifecycle,
                    GameKernelLifecycleSnapshotV7::Active(_)
                        | GameKernelLifecycleSnapshotV7::Terminal { .. }
                ) || matches!(&snapshot.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) if bootstrap.stage == RunBootstrapStageV1::Complete)
                {
                    break;
                }
                frames.extend(self.press(PhysicalKey::Space)?);
            }
        }
        Ok(frames)
    }

    fn settle(&mut self) -> TestResult<usize> {
        let mut count = 0;
        for _ in 0..16 {
            let pending = self.snapshot()?.pending_presentations;
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
        Err("actual presentation callback bound".into())
    }

    fn next_frame(&mut self) -> TestResult<Vec<u8>> {
        for _ in 0..8 {
            self.settle()?;
            let frames = self.press(PhysicalKey::Space)?;
            if let [bytes] = frames.as_slice() {
                return Ok(bytes.clone());
            }
            assert!(frames.is_empty());
        }
        Err("actual Worker gameplay frame bound".into())
    }
}

fn wire(step: &GameKernelStepV7) -> TestResult<Vec<u8>> {
    let frames = step
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::ProposalReady { bytes, .. }
            | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let [bytes] = frames.as_slice() else {
        return Err("exact actual gameplay frame".into());
    };
    Ok(bytes.clone())
}

fn pair(limits: CurrentTailLimitsV2) -> TestResult<(Peer, Peer)> {
    // Keep only immutable snapshots from a real two-process Title journey.
    // No live process, supervisor frontier or rebind mutation is shared by cases.
    static STARTUP: OnceLock<Result<(CoreGameKernelSnapshotV7, CoreGameKernelSnapshotV7), String>> =
        OnceLock::new();
    let snapshots = STARTUP.get_or_init(|| {
        (|| -> TestResult<_> {
            let (mut host, mut guest) = build_pair(CurrentTailLimitsV2::default())?;
            let snapshots = (host.snapshot()?, guest.snapshot()?);
            host.worker.dispose()?;
            guest.worker.dispose()?;
            Ok(snapshots)
        })()
        .map_err(|error| error.to_string())
    });
    let (host_snapshot, guest_snapshot) = snapshots.as_ref().map_err(Clone::clone)?;
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?);
    let mut host = Peer::from_snapshot(
        &bundle, Arc::clone(&content), true, limits, host_snapshot.clone(),
    )?;
    let mut guest = Peer::from_snapshot(
        &bundle, content, false, limits, guest_snapshot.clone(),
    )?;
    assert_ne!(host.worker.process_id(), guest.worker.process_id());
    assert_eq!(host.snapshot()?, *host_snapshot);
    assert_eq!(guest.snapshot()?, *guest_snapshot);
    Ok((host, guest))
}

fn build_pair(limits: CurrentTailLimitsV2) -> TestResult<(Peer, Peer)> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?);
    let mut host = Peer::new(&bundle, Arc::clone(&content), true, limits)?;
    let mut guest = Peer::new(&bundle, Arc::clone(&content), false, limits)?;
    assert_ne!(host.worker.process_id(), guest.worker.process_id());
    let choices = guest.choose(&content, false)?;
    let waiting = host.choose(&content, true)?;
    let [choice] = choices.as_slice() else {
        return Err("actual guest setup publication".into());
    };
    assert!(waiting.is_empty());
    let started = wire(&host.ordinary(CurrentExternalEvent::NetworkFrame {
        generation: generation(1),
        bytes: choice.clone(),
    })?)?;
    guest.ordinary(CurrentExternalEvent::NetworkFrame {
        generation: generation(1),
        bytes: started,
    })?;
    assert!(matches!(
        host.snapshot()?.lifecycle,
        GameKernelLifecycleSnapshotV7::Active(_)
    ));
    assert!(matches!(
        guest.snapshot()?.lifecycle,
        GameKernelLifecycleSnapshotV7::Active(_)
    ));
    assert_eq!(
        host.reference.kernel_ref()?.state(),
        guest.reference.kernel_ref()?.state()
    );
    assert!(guest.snapshot()?.current_proposal.is_none());
    Ok((host, guest))
}

fn control_frame(output: &CurrentSessionRebindOutputV1) -> TestResult<Vec<u8>> {
    assert_eq!(output.generation, generation(2));
    let [bytes] = output.frames.as_slice() else {
        return Err("exact actual rebind frame".into());
    };
    Ok(bytes.clone())
}

fn begin(host: &mut Peer, guest: &mut Peer) -> TestResult<Vec<u8>> {
    for peer in [&mut *host, &mut *guest] {
        peer.ordinary(CurrentExternalEvent::TransportChanged {
            generation: generation(1),
            connected: false,
        })?;
        assert!(
            peer.rebind(CurrentCoopRebindEventV1::Begin)?
                .frames
                .is_empty()
        );
        let before = peer.snapshot()?;
        assert!(
            peer.rebind(CurrentCoopRebindEventV1::Begin)?
                .frames
                .is_empty()
        );
        assert_eq!(peer.snapshot()?, before);
        peer.ordinary(CurrentExternalEvent::TransportChanged {
            generation: generation(2),
            connected: true,
        })?;
    }
    control_frame(&host.rebind(CurrentCoopRebindEventV1::Retry)?)
}

fn handshake(host: &mut Peer, guest: &mut Peer, mut bytes: Vec<u8>) -> TestResult {
    for index in 0usize..8 {
        let peer = if index.is_multiple_of(2) {
            &mut *guest
        } else {
            &mut *host
        };
        let output = peer.rebind(CurrentCoopRebindEventV1::Receive {
            generation: generation(2),
            bytes,
        })?;
        bytes = if index < 7 {
            control_frame(&output)?
        } else {
            assert!(output.frames.is_empty());
            Vec::new()
        };
    }
    for peer in [host, guest] {
        let snapshot = peer.snapshot()?;
        let owner = snapshot
            .current_coop_setup
            .as_ref()
            .and_then(|owner| owner.rebind.as_deref())
            .ok_or("retained rebind owner")?;
        assert_eq!(owner.phase, CurrentCoopRebindPhaseV1::Open);
        assert_eq!(owner.transcript.len(), 8);
    }
    Ok(())
}

#[test]
fn natural_owned_workers_rebind_and_continue_generation_two_gameplay() -> TestResult {
    let (mut host, mut guest) = pair(CurrentTailLimitsV2::default())?;
    let offer = begin(&mut host, &mut guest)?;
    handshake(&mut host, &mut guest, offer)?;
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
    assert_eq!(
        er_kernel::current_proposal_v7::decode_current_proposal_v1(&proposal)?
            .connection_generation,
        generation(2)
    );
    let pending = guest.snapshot()?;
    assert_eq!(
        wire(&guest.ordinary(CurrentExternalEvent::RetryCoopSetup)?)?,
        proposal
    );
    assert_eq!(guest.snapshot()?, pending);
    let receipt = wire(&host.ordinary(CurrentExternalEvent::NetworkFrame {
        generation: generation(2),
        bytes: proposal.clone(),
    })?)?;
    assert_eq!(
        er_kernel::current_proposal_v7::CurrentProposalMaterialReceiptV2::decode(&receipt)?
            .evidence()?
            .proposal_bytes,
        proposal
    );
    let committed = host.snapshot()?;
    assert_eq!(
        wire(&host.ordinary(CurrentExternalEvent::NetworkFrame {
            generation: generation(2),
            bytes: proposal.clone()
        })?)?,
        receipt
    );
    assert_eq!(host.snapshot()?, committed);
    let before = host.snapshot()?;
    let frontier = host.worker.frontier();
    assert!(
        host.worker
            .dispatch(CurrentExternalEvent::NetworkFrame {
                generation: generation(1),
                bytes: proposal
            })
            .is_err()
    );
    assert_eq!(host.worker.frontier(), frontier);
    assert_eq!(host.snapshot()?, before);
    assert!(!host.worker.is_fenced());
    guest.ordinary(CurrentExternalEvent::NetworkFrame {
        generation: generation(2),
        bytes: receipt.clone(),
    })?;
    assert!(guest.snapshot()?.current_proposal.is_none());
    let committed = guest.snapshot()?;
    assert!(
        guest
            .ordinary(CurrentExternalEvent::NetworkFrame {
                generation: generation(2),
                bytes: receipt
            })?
            .effects
            .is_empty()
    );
    assert_eq!(guest.snapshot()?, committed);
    assert!(guest.settle()? > 0);
    host.settle()?;
    assert_eq!(
        host.reference.kernel_ref()?.state(),
        guest.reference.kernel_ref()?.state()
    );
    host.worker.dispose()?;
    guest.worker.dispose()?;
    Ok(())
}

#[test]
fn rebind_result_budget_rejection_preserves_worker_state_and_frontier() -> TestResult {
    let (mut host, mut guest) = pair(CurrentTailLimitsV2::default())?;
    let offer = begin(&mut host, &mut guest)?;
    let control = CurrentCoopRebindEventV1::Receive {
        generation: generation(2),
        bytes: offer.clone(),
    };
    let before = guest.snapshot()?;
    let frontier = guest.worker.frontier();
    for budget in [0, MAXIMUM_WORKER_FRAME_BYTES_V2 + 1, 1] {
        let health = guest.worker.health()?;
        assert!(
            guest
                .worker
                .dispatch_rebind(control.clone(), budget)
                .is_err()
        );
        let after_health = guest.worker.health()?;
        assert_eq!(after_health.applied_events, health.applied_events);
        // The only accepted request between these health responses is the latter health request.
        assert_eq!(
            after_health.accepted_sequence,
            health
                .accepted_sequence
                .and_then(|sequence| sequence.checked_add(1))
        );
        assert_eq!(guest.worker.frontier(), frontier);
        assert_eq!(guest.snapshot()?, before);
        assert!(!guest.worker.is_fenced());
    }
    assert!(
        guest
            .worker
            .dispatch(CurrentExternalEvent::CoopRebind {
                control: control.clone()
            })
            .is_err()
    );
    assert_eq!(guest.worker.frontier(), frontier);
    assert_eq!(guest.snapshot()?, before);
    assert!(
        guest
            .worker
            .dispatch_rebind(
                CurrentCoopRebindEventV1::Receive {
                    generation: generation(1),
                    bytes: offer
                },
                MAXIMUM_WORKER_FRAME_BYTES_V2
            )
            .is_err()
    );
    assert_eq!(guest.worker.frontier(), frontier);
    assert_eq!(guest.snapshot()?, before);
    let output = guest.rebind(control)?;
    assert!(!output.frames.is_empty());
    assert_ne!(guest.snapshot()?, before);
    let admitted = guest.snapshot()?;
    assert_eq!(guest.rebind(CurrentCoopRebindEventV1::Retry)?, output);
    assert_eq!(guest.snapshot()?, admitted);
    host.worker.dispose()?;
    guest.worker.dispose()?;
    Ok(())
}

#[test]
fn midphase_rebind_tail_reloads_and_explicit_gaps_expire_old_tickets() -> TestResult {
    let (mut host, mut guest) = pair(CurrentTailLimitsV2::default())?;
    let offer = begin(&mut host, &mut guest)?;
    let ticket = guest.worker.begin_reload()?;
    let output = guest.rebind(CurrentCoopRebindEventV1::Receive {
        generation: generation(2),
        bytes: offer,
    })?;
    let before = guest.snapshot()?;
    let frontier = guest.worker.frontier();
    let next = next_artifact(&guest.artifact)?;
    let prepared = guest
        .worker
        .prepare_reload(ticket, &next, guest.bundle.clone())?;
    assert_eq!(prepared.replayed_events(), 1);
    assert_ne!(prepared.process_id(), guest.worker.process_id());
    assert_eq!(guest.snapshot()?, before);
    let accepted = guest.worker.commit_reload(prepared)?;
    assert_eq!(accepted.replayed_events, 1);
    assert_eq!(guest.worker.frontier(), frontier);
    assert_eq!(guest.snapshot()?, before);
    assert_eq!(guest.rebind(CurrentCoopRebindEventV1::Retry)?, output);
    assert_eq!(guest.snapshot()?, before);
    let current = guest.worker.begin_reload()?;
    let mut candidate_identity = next.identity().clone();
    candidate_identity.generation = KernelGenerationV1(candidate_identity.generation.0 + 1);
    let third = VerifiedKernelExecutableV2::verify(
        next.allowed_root(),
        next.executable(),
        candidate_identity,
    )?;
    let prepared = guest
        .worker
        .prepare_reload(current, &third, guest.bundle.clone())?;
    guest.rebind(CurrentCoopRebindEventV1::Retry)?;
    assert!(matches!(
        guest.worker.commit_reload(prepared),
        Err(CurrentReloadErrorV2::StalePrepared)
    ));
    assert_eq!(guest.snapshot()?, before);
    // Reuse the genuine midphase snapshot unchanged, with a separately bounded tail.
    let mut child = ChildKernelGenerationV2::spawn(&third)?;
    child.initialize(
        guest.bundle.clone(),
        KernelWorkerInitializationV2::Snapshot {
            snapshot_bytes: serde_json::to_vec(&before)?,
            local_seat: SeatId::new(safe(2)),
            role: GameKernelRoleV7::Replica,
        },
    )?;
    let mut bounded = CurrentKernelSupervisorV2::new(
        child,
        CurrentTailLimitsV2 {
            maximum_events: 1,
            maximum_bytes: 1,
        },
    )?;
    let ticket = bounded.begin_reload()?;
    let result = bounded.dispatch_rebind(
        CurrentCoopRebindEventV1::Retry,
        MAXIMUM_WORKER_FRAME_BYTES_V2,
    )?;
    assert_eq!(result.evidence.output, output);
    assert_eq!(result.retention, CurrentTraceRetentionV2::Gap);
    assert_eq!(bounded.snapshot()?, before);
    assert!(matches!(
        bounded.prepare_reload(ticket, &next_artifact(&third)?, guest.bundle.clone()),
        Err(CurrentReloadErrorV2::TicketExpired { .. })
    ));
    bounded.dispose()?;
    host.worker.dispose()?;
    guest.worker.dispose()?;
    Ok(())
}
