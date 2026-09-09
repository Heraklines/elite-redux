//! Native equal-frontier rebind and explicitly owned generation-two gameplay.
//! No browser transport, CLI, or lost-reply recovery transaction claim.
//! All decisions, deliveries and restored states use the current runtime.
use std::error::Error;
use std::sync::{Arc, OnceLock};

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m72_bootstrap::RunBootstrapStageV1;
use er_kernel::game_kernel_v7::GameKernelV7;
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7};
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::{KernelSchedulerSnapshotV2, TimeClassPauseSnapshotV2};
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_protocol::proposal::ProposalLeaseConfig;
use er_protocol::recovery::RecoveryTransactionConfig;
use er_protocol::replica::AuthorityReplicaConfig;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::{
    ConnectionGeneration, FrameContext, MembershipRevision, RunId, SessionId, TimeClass,
};
use er_types::{InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};

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

fn restored(
    kernel: &GameKernelV7,
    content: Arc<PreparedGameContentV2>,
    host: bool,
) -> Result<GameKernelV7, Box<dyn Error>> {
    let snapshot = kernel.snapshot()?;
    let encoded = er_canonical::canonical_bytes(&snapshot)?;
    let restored = GameKernelV7::from_snapshot(
        serde_json::from_slice(&encoded)?,
        SeatId::new(safe(if host { 1 } else { 2 })),
        if host {
            GameKernelRoleV7::Authority
        } else {
            GameKernelRoleV7::Replica
        },
        content,
    )?;
    assert_eq!(snapshot, restored.snapshot()?);
    Ok(restored)
}

use er_kernel::game_kernel_v7::current_coop_rebind_v7::{
    CurrentCoopRebindControlV1, CurrentCoopRebindOutputV1, CurrentCoopRebindPhaseV1,
    MAX_CURRENT_REBIND_FRAME_BYTES_V1,
};
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
type TestResult<T = ()> = Result<T, Box<dyn Error>>;

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

fn next_game_frame(kernel: &mut GameKernelV7) -> TestResult<Vec<u8>> {
    for _ in 0..8 {
        for pending in kernel.snapshot()?.pending_presentations {
            kernel.settle_presentation(pending.event_id)?;
        }
        let mut frames = Vec::new();
        capture_press(kernel, &mut frames)?;
        if !frames.is_empty() {
            assert_eq!(frames.len(), 1);
            return Ok(frames.remove(0));
        }
    }
    Err("eight actual presses did not publish a current frame".into())
}

fn frame_bytes(output: &CurrentCoopRebindOutputV1) -> TestResult<Vec<u8>> {
    assert_eq!(output.generation, ConnectionGeneration::new(safe(2)));
    assert_eq!(output.frames.len(), 1);
    Ok(output.frames[0].clone())
}
fn owner(
    snapshot: &CoreGameKernelSnapshotV7,
) -> TestResult<&er_kernel::game_kernel_v7::current_coop_rebind_v7::CurrentCoopRebindSnapshotV1> {
    snapshot
        .current_coop_setup
        .as_ref()
        .and_then(|setup| setup.rebind.as_deref())
        .ok_or_else(|| "rebind owner".into())
}
fn begin(host: &mut GameKernelV7, guest: &mut GameKernelV7) -> TestResult<Vec<u8>> {
    for kernel in [&mut *host, &mut *guest] {
        kernel.transport_changed(ConnectionGeneration::new(safe(1)), false)?;
        assert!(kernel.begin_current_coop_rebind_v1()?.frames.is_empty());
        let staged = kernel.snapshot()?;
        assert_eq!(
            staged
                .protocol
                .as_ref()
                .ok_or("protocol")?
                .frame_context
                .context
                .connection_generation,
            ConnectionGeneration::new(safe(1))
        );
        assert_eq!(
            kernel.begin_current_coop_rebind_v1()?.frames,
            Vec::<Vec<u8>>::new()
        );
        assert_eq!(kernel.snapshot()?, staged);
        kernel.transport_changed(ConnectionGeneration::new(safe(2)), true)?;
        assert_eq!(
            kernel
                .snapshot()?
                .protocol
                .as_ref()
                .ok_or("protocol")?
                .frame_context
                .context
                .connection_generation,
            ConnectionGeneration::new(safe(1))
        );
    }
    frame_bytes(&host.retry_current_coop_rebind_v1()?)
}
fn handshake(host: &mut GameKernelV7, guest: &mut GameKernelV7, mut frame: Vec<u8>) -> TestResult {
    for index in 0usize..8 {
        let receiver = if index.is_multiple_of(2) {
            &mut *guest
        } else {
            &mut *host
        };
        let output =
            receiver.receive_current_coop_rebind_v1(ConnectionGeneration::new(safe(2)), &frame)?;
        if index < 7 {
            frame = frame_bytes(&output)?;
        } else {
            assert!(output.frames.is_empty());
        }
    }
    assert_eq!(
        owner(&host.snapshot()?)?.phase,
        CurrentCoopRebindPhaseV1::Open
    );
    assert_eq!(
        owner(&guest.snapshot()?)?.phase,
        CurrentCoopRebindPhaseV1::Open
    );
    Ok(())
}

fn assert_conserved(
    before: &CoreGameKernelSnapshotV7,
    after: &CoreGameKernelSnapshotV7,
) -> TestResult {
    let mut normalized = after.clone();
    normalized
        .current_coop_setup
        .as_mut()
        .ok_or("setup")?
        .rebind = None;
    normalized.protocol = before.protocol.clone();
    normalized.scheduler = before.scheduler.clone();
    normalized.replay_sequence = before.replay_sequence;
    assert_eq!(&normalized, before); // Includes every gameplay, allocator, input, ledger and pending-presentation field.
    let before_protocol = before.protocol.as_ref().ok_or("protocol")?;
    let after_protocol = after.protocol.as_ref().ok_or("protocol")?;
    let mut expected = before_protocol.clone();
    let two = ConnectionGeneration::new(safe(2));
    expected.frame_context.context.connection_generation = two;
    expected.peer_identity.local.connection_generation = two;
    expected
        .peer_identity
        .peer
        .as_mut()
        .ok_or("peer")?
        .connection_generation = two;
    for connection in &mut expected.connections {
        connection.generation = two;
        connection.state = er_types::TransportState::Connected;
    }
    if let Some(log) = &mut expected.authority_log {
        log.local_context.connection_generation = two;
        for peer in &mut log.peer_bindings {
            peer.generation = two;
        }
    }
    if let Some(replica) = &mut expected.authority_replica {
        replica.receipt_context.connection_generation = two;
        replica.authority_generation = two;
    }
    if let Some(recovery) = &mut expected.recovery {
        recovery.config.local_context.connection_generation = two;
    }
    assert_eq!(&expected, after_protocol); // No generic history, admission fingerprint or config was reset.
    assert_eq!(before.scheduler, after.scheduler);
    Ok(())
}

#[test]
fn equal_frontier_native_rebind_commits_two_atomically_without_gameplay() -> TestResult {
    let (mut host, mut guest) = pair()?;
    let before_host = host.snapshot()?;
    let before_guest = guest.snapshot()?;
    let offer = begin(&mut host, &mut guest)?;
    for kernel in [&mut host, &mut guest] {
        let before = kernel.snapshot()?;
        assert!(
            kernel
                .raw_input(RawInputEvent::KeyDown {
                    code: PhysicalKey::Space,
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game
                })
                .is_err()
        );
        assert!(kernel.advance_time(safe(1)).is_err());
        assert_eq!(kernel.snapshot()?, before);
    }
    handshake(&mut host, &mut guest, offer)?;
    assert_conserved(&before_host, &host.snapshot()?)?;
    assert_conserved(&before_guest, &guest.snapshot()?)?;
    assert_eq!(
        owner(&host.snapshot()?)?.transcript,
        owner(&guest.snapshot()?)?.transcript
    );
    assert!(owner(&host.snapshot()?)?.commit_replay_sequence.is_some());
    assert!(owner(&guest.snapshot()?)?.commit_replay_sequence.is_some());
    for kernel in [&mut host, &mut guest] {
        let before = kernel.snapshot()?;
        assert!(
            kernel
                .ingest_network_frame(ConnectionGeneration::new(safe(1)), &[])
                .is_err()
        );
        assert!(
            kernel
                .ingest_network_frame(ConnectionGeneration::new(safe(2)), &[])
                .is_err()
        );
        assert!(kernel.admit_game_proposal(&[0]).is_err());
        assert!(kernel.apply_authority_material(&[0]).is_err());
        assert!(kernel.retry_current_coop_setup().is_err());
        assert_eq!(kernel.snapshot()?, before);
    }
    Ok(())
}

#[test]
fn every_rebind_phase_restores_and_retries_exact_control_without_advancing_replay() -> TestResult {
    let (mut host, mut guest) = pair()?;
    let mut frame = begin(&mut host, &mut guest)?;
    // Include both initial phases, before either endpoint has received a control.
    for (kernel, is_host) in [(&mut host, true), (&mut guest, false)] {
        kernel.transport_changed(ConnectionGeneration::new(safe(2)), false)?;
        *kernel = restored(kernel, content()?, is_host)?;
        assert!(kernel.retry_current_coop_rebind_v1()?.frames.is_empty());
        kernel.transport_changed(ConnectionGeneration::new(safe(2)), true)?;
    }
    assert_eq!(frame_bytes(&host.retry_current_coop_rebind_v1()?)?, frame);
    assert!(guest.retry_current_coop_rebind_v1()?.frames.is_empty());
    for index in 0usize..8 {
        let receiver_is_host = !index.is_multiple_of(2);
        let receiver = if receiver_is_host {
            &mut host
        } else {
            &mut guest
        };
        let before = receiver.snapshot()?;
        let output =
            receiver.receive_current_coop_rebind_v1(ConnectionGeneration::new(safe(2)), &frame)?;
        let accepted = receiver.snapshot()?;
        let retry_output = receiver.retry_current_coop_rebind_v1()?;
        assert_eq!(
            accepted.replay_sequence.get(),
            before.replay_sequence.get() + 1
        );
        assert_eq!(
            receiver.receive_current_coop_rebind_v1(ConnectionGeneration::new(safe(2)), &frame)?,
            output
        );
        assert_eq!(receiver.snapshot()?, accepted);
        receiver.transport_changed(ConnectionGeneration::new(safe(2)), false)?;
        *receiver = restored(receiver, content()?, receiver_is_host)?;
        assert!(receiver.retry_current_coop_rebind_v1()?.frames.is_empty());
        let disconnected = receiver.snapshot()?;
        receiver.transport_changed(ConnectionGeneration::new(safe(2)), false)?;
        assert_eq!(receiver.snapshot()?, disconnected);
        receiver.transport_changed(ConnectionGeneration::new(safe(2)), true)?;
        assert_eq!(receiver.retry_current_coop_rebind_v1()?, retry_output);
        let retried = receiver.snapshot()?;
        assert_eq!(receiver.retry_current_coop_rebind_v1()?, retry_output);
        assert_eq!(receiver.snapshot()?, retried);
        assert_eq!(
            owner(&retried)?.commit_replay_sequence,
            owner(&accepted)?.commit_replay_sequence
        );
        if index < 7 {
            frame = frame_bytes(&output)?;
        } else {
            assert!(output.frames.is_empty());
        }
    }
    assert_eq!(
        owner(&host.snapshot()?)?.phase,
        CurrentCoopRebindPhaseV1::Open
    );
    assert_eq!(
        owner(&guest.snapshot()?)?.phase,
        CurrentCoopRebindPhaseV1::Open
    );
    let transcript = owner(&host.snapshot()?)?.transcript.clone();
    // Old OFFER/JOIN duplicates still return their original immediate response after Open.
    // Duplicate READY returns ACK, and first/duplicate final ACK never creates another READY.
    for index in 0usize..8 {
        let receiver = if index.is_multiple_of(2) {
            &mut guest
        } else {
            &mut host
        };
        let before = receiver.snapshot()?;
        let response = receiver.receive_current_coop_rebind_v1(
            ConnectionGeneration::new(safe(2)),
            &er_canonical::canonical_bytes(&transcript[index])?,
        )?;
        let expected = transcript
            .get(index + 1)
            .map(er_canonical::canonical_bytes)
            .transpose()?
            .into_iter()
            .collect::<Vec<_>>();
        assert_eq!(response.frames, expected);
        assert_eq!(receiver.snapshot()?, before);
    }
    Ok(())
}

#[test]
fn malformed_rebind_controls_and_generation_bypasses_preserve_full_snapshot() -> TestResult {
    let (mut host, mut guest) = pair()?;
    let offer = begin(&mut host, &mut guest)?;
    let pristine = guest.snapshot()?;
    let mut stripped = pristine.clone();
    stripped.current_coop_setup.as_mut().ok_or("setup")?.rebind = None;
    assert!(
        GameKernelV7::from_snapshot(
            stripped,
            SeatId::new(safe(2)),
            GameKernelRoleV7::Replica,
            content()?
        )
        .is_err()
    );
    for case in 0..8 {
        let mut frame: CurrentCoopRebindControlV1 = serde_json::from_slice(&offer)?;
        match case {
            0 => frame.schema_version = 2,
            1 => frame.sender.sender_seat_id = SeatId::new(safe(99)),
            2 => frame.receiver.connection_generation = ConnectionGeneration::new(safe(3)),
            3 => frame.authority_nonce = SafeU53::ZERO,
            4 => frame.binding_digest = "0".repeat(64),
            5 => frame.previous_digest = Some("0".repeat(64)),
            6 => frame.guest_nonce = Some(safe(1)),
            _ => frame.transaction_id = Some("0".repeat(64)),
        }
        assert!(
            guest
                .receive_current_coop_rebind_v1(
                    ConnectionGeneration::new(safe(2)),
                    &er_canonical::canonical_bytes(&frame)?
                )
                .is_err(),
            "case {case}"
        );
        assert_eq!(guest.snapshot()?, pristine);
    }
    for generation in [0, 1, 3] {
        assert!(
            guest
                .receive_current_coop_rebind_v1(ConnectionGeneration::new(safe(generation)), &offer)
                .is_err()
        );
        assert!(
            guest
                .transport_changed(ConnectionGeneration::new(safe(generation)), true)
                .is_err()
        );
        assert_eq!(guest.snapshot()?, pristine);
    }
    assert!(
        guest
            .receive_current_coop_rebind_v1(
                ConnectionGeneration::new(safe(2)),
                &vec![0; MAX_CURRENT_REBIND_FRAME_BYTES_V1 + 1]
            )
            .is_err()
    );
    let mut unknown: serde_json::Value = serde_json::from_slice(&offer)?;
    unknown
        .get_mut("sender")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or("sender")?
        .insert("unknown_context".to_owned(), serde_json::Value::Bool(true));
    assert!(
        guest
            .receive_current_coop_rebind_v1(
                ConnectionGeneration::new(safe(2)),
                &er_canonical::canonical_bytes(&unknown)?
            )
            .is_err()
    );
    assert!(
        guest
            .ingest_network_frame(ConnectionGeneration::new(safe(2)), &offer)
            .is_err()
    );
    assert_eq!(guest.snapshot()?, pristine);

    let (mut ahead_host, mut behind_guest) = pair()?;
    let undelivered = next_game_frame(&mut ahead_host)?;
    assert!(!undelivered.is_empty());
    assert!(
        ahead_host
            .snapshot()?
            .material_ledger
            .next_authority_revision
            > behind_guest
                .snapshot()?
                .material_ledger
                .next_authority_revision
    );
    let offer = begin(&mut ahead_host, &mut behind_guest)?;
    let before = behind_guest.snapshot()?;
    assert!(
        behind_guest
            .receive_current_coop_rebind_v1(ConnectionGeneration::new(safe(2)), &offer)
            .is_err()
    );
    assert_eq!(behind_guest.snapshot()?, before); // Actual undelivered material, not a forged frontier.

    let (mut pending_host, mut pending_guest) = pair()?;
    let material = next_game_frame(&mut pending_host)?;
    pending_guest.ingest_network_frame(ConnectionGeneration::new(safe(1)), &material)?;
    let proposal = next_game_frame(&mut pending_guest)?;
    assert!(!proposal.is_empty() && pending_guest.snapshot()?.current_proposal.is_some());
    pending_guest.transport_changed(ConnectionGeneration::new(safe(1)), false)?;
    let before = pending_guest.snapshot()?;
    assert!(pending_guest.begin_current_coop_rebind_v1().is_err());
    assert_eq!(pending_guest.snapshot()?, before); // Pending/lost-reply recovery belongs to a later slice.
    Ok(())
}

#[test]
fn rebind_begin_and_replay_exhaustion_reject_without_retiring_existing_owners() -> TestResult {
    let (mut host, mut guest) = pair()?;
    let connected = host.snapshot()?;
    assert!(host.begin_current_coop_rebind_v1().is_err());
    assert_eq!(host.snapshot()?, connected);
    host.transport_changed(ConnectionGeneration::new(safe(1)), false)?;
    let disconnected = host.snapshot()?;
    let mut exhausted = disconnected.clone();
    exhausted.replay_sequence = safe(9_007_199_254_740_991);
    let mut exhausted = GameKernelV7::from_snapshot(
        exhausted,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content()?,
    )?;
    let before = exhausted.snapshot()?;
    assert!(exhausted.begin_current_coop_rebind_v1().is_err());
    assert_eq!(exhausted.snapshot()?, before);
    let mut history = disconnected.clone();
    history
        .protocol
        .as_mut()
        .and_then(|protocol| protocol.authority_log.as_mut())
        .ok_or("log")?
        .capacity_refusals = safe(1);
    let mut history = GameKernelV7::from_snapshot(
        history,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content()?,
    )?;
    let before = history.snapshot()?;
    assert!(history.begin_current_coop_rebind_v1().is_err());
    assert_eq!(history.snapshot()?, before);
    let offer = begin(&mut host, &mut guest)?;
    let mut snapshot = guest.snapshot()?;
    snapshot.replay_sequence = safe(9_007_199_254_740_991);
    let mut exhausted = GameKernelV7::from_snapshot(
        snapshot,
        SeatId::new(safe(2)),
        GameKernelRoleV7::Replica,
        content()?,
    )?;
    let before = exhausted.snapshot()?;
    assert!(
        exhausted
            .receive_current_coop_rebind_v1(ConnectionGeneration::new(safe(2)), &offer)
            .is_err()
    );
    assert_eq!(exhausted.snapshot()?, before);
    assert!(
        exhausted
            .transport_changed(ConnectionGeneration::new(safe(2)), false)
            .is_err()
    );
    assert_eq!(exhausted.snapshot()?, before);
    Ok(())
}

#[test]
fn rebind_restore_checks_decision_binding_and_preserves_unrelated_scheduler_pause() -> TestResult {
    let (host, mut guest) = pair()?;
    let mut initial = host.snapshot()?;
    let mut scheduler = er_protocol::KernelScheduler::new();
    scheduler.pause_class(
        SeatId::new(safe(1)),
        TimeClass::Connected,
        "independent-native-owner",
    )?;
    // Create the unrelated owner's pause through the public scheduler while preserving existing timers and allocator.
    initial
        .scheduler
        .pauses
        .extend(
            scheduler
                .export_restorable_state()
                .pauses
                .into_iter()
                .map(|pause| TimeClassPauseSnapshotV2 {
                    endpoint: pause.endpoint,
                    time_class: pause.time_class,
                    reasons: pause.reasons,
                }),
        );
    let mut host = GameKernelV7::from_snapshot(
        initial,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content()?,
    )?;
    let before = host.snapshot()?;
    let offer = begin(&mut host, &mut guest)?;
    handshake(&mut host, &mut guest, offer)?;
    assert_conserved(&before, &host.snapshot()?)?;
    let complete = host.snapshot()?;
    for case in 0..6 {
        let mut forged = complete.clone();
        let value = forged
            .current_coop_setup
            .as_mut()
            .and_then(|setup| setup.rebind.as_mut())
            .ok_or("owner")?;
        match case {
            0 => value.commit_replay_sequence = None,
            1 => value.phase = CurrentCoopRebindPhaseV1::AwaitJoin,
            2 => {
                value.binding.frontier.next_authority_revision =
                    safe(value.binding.frontier.next_authority_revision.get() + 1)
            }
            3 => {
                value.transcript[0].authority_nonce =
                    safe(value.transcript[0].authority_nonce.get() + 1)
            }
            4 => {
                value.binding.authority_target.connection_generation =
                    ConnectionGeneration::new(safe(3))
            }
            _ => value.transcript.pop().ok_or("transcript").map(|_| ())?,
        }
        assert!(
            GameKernelV7::from_snapshot(
                forged,
                SeatId::new(safe(1)),
                GameKernelRoleV7::Authority,
                content()?
            )
            .is_err(),
            "case {case}"
        );
    }
    let mut missing = complete.clone();
    missing.current_coop_setup.as_mut().ok_or("setup")?.rebind = None;
    assert!(
        GameKernelV7::from_snapshot(
            missing,
            SeatId::new(safe(1)),
            GameKernelRoleV7::Authority,
            content()?
        )
        .is_err()
    );
    assert_eq!(host.snapshot()?, complete);
    Ok(())
}

fn settle_owned_presentations(kernel: &mut GameKernelV7) -> TestResult<usize> {
    let mut count = 0;
    for _ in 0..16 {
        let pending = kernel.snapshot()?.pending_presentations;
        if pending.is_empty() {
            return Ok(count);
        }
        for presentation in pending {
            kernel.settle_presentation(presentation.event_id)?;
            count += 1;
        }
    }
    Err("actual presentation callbacks exceeded sixteen batches".into())
}

fn actual_guest_proposal(
    host: &mut GameKernelV7,
    guest: &mut GameKernelV7,
    generation: u64,
) -> TestResult<(Vec<u8>, Vec<u8>)> {
    settle_owned_presentations(host)?;
    settle_owned_presentations(guest)?;
    let material = next_game_frame(host)?;
    er_game::m9e_material_v6::GameMaterialV6::decode(&material)?;
    guest.ingest_network_frame(ConnectionGeneration::new(safe(generation)), &material)?;
    settle_owned_presentations(host)?;
    settle_owned_presentations(guest)?;
    let proposal = next_game_frame(guest)?;
    let decoded = er_kernel::current_proposal_v7::decode_current_proposal_v1(&proposal)?;
    assert_eq!(
        decoded.connection_generation,
        ConnectionGeneration::new(safe(generation))
    );
    let pending = guest.snapshot()?;
    let retained = pending
        .current_proposal
        .as_ref()
        .ok_or("actual pending guest proposal")?
        .retained();
    assert_eq!(
        retained.publication_context.connection_generation,
        decoded.connection_generation
    );
    assert_eq!(
        er_kernel::current_proposal_v7::decode_current_hex_v1(&retained.proposal_hex, 16_384)?,
        proposal
    );
    assert_eq!(wire(&guest.retry_current_coop_setup()?)?, proposal);
    assert_eq!(guest.snapshot()?, pending);
    Ok((material, proposal))
}

#[test]
fn open_rebind_executes_actual_owned_gameplay_and_retries_strict_v2_receipt() -> TestResult {
    use er_kernel::current_proposal_v7::{
        CurrentProposalMaterialReceiptV1, CurrentProposalMaterialReceiptV2,
    };
    let (mut host, mut guest) = pair()?;
    let offer = begin(&mut host, &mut guest)?;
    handshake(&mut host, &mut guest, offer)?;
    let transcript = owner(&host.snapshot()?)?.transcript.clone();
    let (_, proposal) = actual_guest_proposal(&mut host, &mut guest, 2)?;
    let before = host.snapshot()?;
    assert!(host.admit_game_proposal(&proposal).is_err());
    assert_eq!(host.snapshot()?, before);
    let reply = wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(2)), &proposal)?)?;
    let decoded = CurrentProposalMaterialReceiptV2::decode(&reply)?;
    assert_eq!(decoded.evidence()?.proposal_bytes, proposal);
    assert!(CurrentProposalMaterialReceiptV1::decode(&reply).is_err());
    assert_eq!(
        decoded.authority_context.connection_generation,
        ConnectionGeneration::new(safe(2))
    );
    let host_after = host.snapshot()?;
    assert!(
        host_after
            .current_coop_setup
            .as_ref()
            .ok_or("setup")?
            .last_reply
            .is_none()
    );
    assert_eq!(
        wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(2)), &proposal)?)?,
        reply
    );
    assert_eq!(host.snapshot()?, host_after);
    for kernel in [&mut host, &mut guest] {
        kernel.transport_changed(ConnectionGeneration::new(safe(2)), false)?;
    }
    host = restored(&host, content()?, true)?;
    guest = restored(&guest, content()?, false)?;
    let disconnected = guest.snapshot()?;
    assert!(guest.retry_current_coop_setup().is_err());
    assert!(
        guest
            .ingest_network_frame(ConnectionGeneration::new(safe(2)), &reply)
            .is_err()
    );
    assert_eq!(guest.snapshot()?, disconnected);
    for kernel in [&mut host, &mut guest] {
        kernel.transport_changed(ConnectionGeneration::new(safe(2)), true)?;
    }
    assert_eq!(wire(&guest.retry_current_coop_setup()?)?, proposal);
    let before_retry = host.snapshot()?;
    assert_eq!(
        wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(2)), &proposal)?)?,
        reply
    );
    assert_eq!(host.snapshot()?, before_retry);
    let step = guest.ingest_network_frame(ConnectionGeneration::new(safe(2)), &reply)?;
    assert!(step.effects.iter().all(|effect| matches!(
        effect,
        GameKernelEffectV7::Presentation(_)
            | GameKernelEffectV7::UiChanged(_)
            | GameKernelEffectV7::Terminal(_)
    )));
    assert!(guest.snapshot()?.current_proposal.is_none());
    let applied = guest.snapshot()?;
    assert!(
        guest
            .ingest_network_frame(ConnectionGeneration::new(safe(2)), &reply)?
            .effects
            .is_empty()
    );
    assert_eq!(guest.snapshot()?, applied);
    assert!(settle_owned_presentations(&mut guest)? > 0);
    settle_owned_presentations(&mut host)?;
    assert_eq!(host.state(), guest.state());
    assert_eq!(owner(&host.snapshot()?)?.transcript, transcript);
    assert_eq!(owner(&guest.snapshot()?)?.transcript, transcript);
    restored(&host, content()?, true)?;
    restored(&guest, content()?, false)?;
    Ok(())
}

#[test]
fn open_rebind_replaces_original_v1_reply_atomically_at_capacity_one() -> TestResult {
    use er_kernel::current_proposal_v7::{
        CurrentProposalMaterialReceiptV1, CurrentProposalMaterialReceiptV2,
    };
    let (mut host, mut guest) = pair_with_capacity(safe(1))?;
    let (old_material, old_proposal) = actual_guest_proposal(&mut host, &mut guest, 1)?;
    let old_reply =
        wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(1)), &old_proposal)?)?;
    let old_receipt = CurrentProposalMaterialReceiptV1::decode(&old_reply)?;
    guest.ingest_network_frame(ConnectionGeneration::new(safe(1)), &old_reply)?;
    settle_owned_presentations(&mut host)?;
    settle_owned_presentations(&mut guest)?;
    let offer = begin(&mut host, &mut guest)?;
    handshake(&mut host, &mut guest, offer)?;
    assert_eq!(
        host.snapshot()?
            .current_coop_setup
            .as_ref()
            .ok_or("setup")?
            .last_reply
            .as_ref()
            .ok_or("original cache")?
            .canonical_bytes()?,
        old_reply
    );
    let (_, proposal) = actual_guest_proposal(&mut host, &mut guest, 2)?;
    let before = host.snapshot()?;
    let mut forged: serde_json::Value = serde_json::from_slice(&proposal)?;
    forged["unknown"] = serde_json::json!(true);
    assert!(
        host.ingest_network_frame(
            ConnectionGeneration::new(safe(2)),
            &er_canonical::canonical_bytes(&forged)?
        )
        .is_err()
    );
    assert_eq!(host.snapshot()?, before);
    let reply = wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(2)), &proposal)?)?;
    let receipt = CurrentProposalMaterialReceiptV2::decode(&reply)?;
    assert_eq!(receipt.evidence()?.proposal_bytes, proposal);
    let after = host.snapshot()?;
    let setup = after.current_coop_setup.as_ref().ok_or("setup")?;
    assert!(setup.last_reply.is_none());
    assert_eq!(
        setup
            .last_reply_v2
            .as_ref()
            .ok_or("V2 cache")?
            .canonical_bytes()?,
        reply
    );
    let fingerprints = &after
        .protocol
        .as_ref()
        .ok_or("protocol")?
        .proposal_admission
        .as_ref()
        .ok_or("admission")?
        .fingerprints;
    assert_eq!(fingerprints.len(), 1);
    assert_eq!(
        fingerprints[0].operation_id,
        receipt.evidence()?.proposal.proposal.context.operation_id
    );
    for generation in [1, 2] {
        let before_host = host.snapshot()?;
        let before_guest = guest.snapshot()?;
        assert!(
            host.ingest_network_frame(ConnectionGeneration::new(safe(generation)), &old_proposal)
                .is_err()
        );
        assert!(
            guest
                .ingest_network_frame(ConnectionGeneration::new(safe(generation)), &old_reply)
                .is_err()
        );
        assert!(
            guest
                .ingest_network_frame(ConnectionGeneration::new(safe(generation)), &old_material)
                .is_err()
        );
        assert_eq!(host.snapshot()?, before_host);
        assert_eq!(guest.snapshot()?, before_guest);
    }
    let mut both = after.clone();
    both.current_coop_setup.as_mut().ok_or("setup")?.last_reply = Some(Box::new(old_receipt));
    assert!(
        GameKernelV7::from_snapshot(
            both,
            SeatId::new(safe(1)),
            GameKernelRoleV7::Authority,
            content()?
        )
        .is_err()
    );
    guest.ingest_network_frame(ConnectionGeneration::new(safe(2)), &reply)?;
    assert!(guest.snapshot()?.current_proposal.is_none());
    assert_eq!(host.snapshot()?, after);
    Ok(())
}

#[test]
fn open_rebind_receipt_and_owner_mutations_reject_with_complete_state_conservation() -> TestResult {
    use er_kernel::current_proposal_v7::CurrentProposalMaterialReceiptV2;
    let (mut host, mut guest) = pair()?;
    let offer = begin(&mut host, &mut guest)?;
    handshake(&mut host, &mut guest, offer)?;
    let (_, proposal) = actual_guest_proposal(&mut host, &mut guest, 2)?;
    let reply = wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(2)), &proposal)?)?;
    let receipt = CurrentProposalMaterialReceiptV2::decode(&reply)?;
    assert_eq!(receipt.rebind_transaction_id.len(), 64);
    assert!(
        receipt
            .rebind_transaction_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    );
    let mut different_transaction = receipt.rebind_transaction_id.clone();
    different_transaction.replace_range(
        ..1,
        if receipt.rebind_transaction_id.starts_with('0') {
            "1"
        } else {
            "0"
        },
    );
    assert_ne!(different_transaction, receipt.rebind_transaction_id);
    for case in 0..9 {
        let before = guest.snapshot()?;
        let mut changed = serde_json::to_value(&receipt)?;
        match case {
            0 => changed["schema_version"] = serde_json::json!(1),
            1 => changed["authority_context"]["connectionGeneration"] = serde_json::json!(1),
            2 => changed["authority_context"]["unknown"] = serde_json::json!(true),
            3 => changed["rebind_transaction_id"] = serde_json::json!(&different_transaction),
            4 => {
                changed["material_fingerprint"] =
                    serde_json::json!(format!("blake3-v1:{}", "0".repeat(64)))
            }
            5 => {
                changed["proposal_digest"] =
                    serde_json::json!(format!("sha256-json-bytes-v1:{}", "0".repeat(64)))
            }
            6 => {
                changed["rebind_transaction_id"] =
                    serde_json::json!(format!("blake3-v1:{}", receipt.rebind_transaction_id))
            }
            7 => {
                changed["rebind_transaction_id"] =
                    serde_json::json!(format!("sha256:{}", receipt.rebind_transaction_id))
            }
            _ => changed["rebind_transaction_id"] = serde_json::json!("malformed-transaction"),
        }
        let bytes = er_canonical::canonical_bytes(&changed)?;
        if case == 3 {
            // Valid shape and all original proposal/material evidence, but it
            // belongs to a different handshake: require the owner binding.
            assert!(CurrentProposalMaterialReceiptV2::decode(&bytes).is_ok());
        } else if case >= 6 {
            assert!(CurrentProposalMaterialReceiptV2::decode(&bytes).is_err());
        }
        assert!(
            guest
                .ingest_network_frame(ConnectionGeneration::new(safe(2)), &bytes)
                .is_err(),
            "receipt case {case}"
        );
        assert_eq!(guest.snapshot()?, before);
    }
    let valid = host.snapshot()?;
    for case in 0..6 {
        let mut changed = valid.clone();
        match case {
            0 => changed
                .protocol
                .as_mut()
                .ok_or("protocol")?
                .proposal_admission
                .as_mut()
                .ok_or("admission")?
                .fingerprints
                .clear(),
            1 => changed.current_coop_setup.as_mut().ok_or("setup")?.rebind = None,
            2 => {
                changed
                    .current_coop_setup
                    .as_mut()
                    .ok_or("setup")?
                    .last_reply_v2
                    .as_mut()
                    .ok_or("cache")?
                    .rebind_transaction_id = different_transaction.clone()
            }
            3 => {
                changed
                    .current_coop_setup
                    .as_mut()
                    .ok_or("setup")?
                    .last_reply_v2
                    .as_mut()
                    .ok_or("cache")?
                    .authority_context
                    .run_id = RunId::new("different-protocol-run")?
            }
            4 => {
                changed
                    .current_coop_setup
                    .as_mut()
                    .ok_or("setup")?
                    .rebind
                    .as_mut()
                    .ok_or("rebind")?
                    .transcript
                    .pop()
                    .ok_or("transcript")?;
            }
            _ => changed
                .current_coop_setup
                .as_mut()
                .ok_or("setup")?
                .last_reply_v2
                .as_mut()
                .ok_or("cache")?
                .material_hex
                .push_str("00"),
        }
        assert!(
            GameKernelV7::from_snapshot(
                changed,
                SeatId::new(safe(1)),
                GameKernelRoleV7::Authority,
                content()?
            )
            .is_err(),
            "snapshot case {case}"
        );
        assert_eq!(host.snapshot()?, valid);
    }
    let mut exhausted_snapshot = guest.snapshot()?;
    exhausted_snapshot.replay_sequence = safe(9_007_199_254_740_991);
    let mut exhausted = GameKernelV7::from_snapshot(
        exhausted_snapshot,
        SeatId::new(safe(2)),
        GameKernelRoleV7::Replica,
        content()?,
    )?;
    let before_overflow = exhausted.snapshot()?;
    assert!(
        exhausted
            .ingest_network_frame(ConnectionGeneration::new(safe(2)), &reply)
            .is_err()
    );
    assert_eq!(exhausted.snapshot()?, before_overflow);
    let before_oversize = guest.snapshot()?;
    assert!(
        guest
            .ingest_network_frame(
                ConnectionGeneration::new(safe(2)),
                &vec![0; er_kernel::current_proposal_v7::MAX_CURRENT_RECEIPT_BYTES_V1 + 1]
            )
            .is_err()
    );
    assert_eq!(guest.snapshot()?, before_oversize);
    guest.ingest_network_frame(ConnectionGeneration::new(safe(2)), &reply)?;
    assert!(guest.snapshot()?.current_proposal.is_none());
    Ok(())
}

// Repeated epochs use the same natural setup and real transport entry points as
// the original witnesses above. Only negative snapshots below are mutated.
fn begin_epoch(host: &mut GameKernelV7, guest: &mut GameKernelV7, from: u64) -> TestResult<Vec<u8>> {
    let origin = ConnectionGeneration::new(safe(from));
    let target = ConnectionGeneration::new(safe(from + 1));
    for kernel in [&mut *host, &mut *guest] {
        kernel.transport_changed(origin, false)?;
        let output = kernel.begin_current_coop_rebind_v1()?;
        assert_eq!(output.generation, target);
        assert!(output.frames.is_empty());
        let staged = kernel.snapshot()?;
        assert_eq!(owner(&staged)?.from_generation, origin);
        assert_eq!(owner(&staged)?.to_generation, target);
        assert_eq!(staged.protocol.as_ref().ok_or("protocol")?.frame_context.context.connection_generation, origin);
        assert_eq!(kernel.begin_current_coop_rebind_v1()?, output);
        assert_eq!(kernel.retry_current_coop_rebind_v1()?, output);
        assert_eq!(kernel.snapshot()?, staged);
        assert!(kernel.transport_changed(ConnectionGeneration::new(safe(from + 2)), true).is_err());
        assert_eq!(kernel.snapshot()?, staged);
        kernel.transport_changed(target, true)?;
    }
    epoch_frame(&host.retry_current_coop_rebind_v1()?, target)
}

fn epoch_frame(output: &CurrentCoopRebindOutputV1, generation: ConnectionGeneration) -> TestResult<Vec<u8>> {
    assert_eq!(output.generation, generation);
    assert_eq!(output.frames.len(), 1);
    Ok(output.frames[0].clone())
}

fn handshake_epoch(
    host: &mut GameKernelV7,
    guest: &mut GameKernelV7,
    mut frame: Vec<u8>,
    generation: u64,
) -> TestResult<Vec<Vec<u8>>> {
    let generation = ConnectionGeneration::new(safe(generation));
    let mut frames = Vec::new();
    for index in 0usize..8 {
        frames.push(frame.clone());
        let receiver = if index.is_multiple_of(2) { &mut *guest } else { &mut *host };
        let output = receiver.receive_current_coop_rebind_v1(generation, &frame)?;
        assert_eq!(output.generation, generation);
        let accepted = receiver.snapshot()?;
        assert_eq!(receiver.receive_current_coop_rebind_v1(generation, &frame)?, output);
        receiver.retry_current_coop_rebind_v1()?;
        assert_eq!(receiver.snapshot()?, accepted);
        if index < 7 {
            frame = epoch_frame(&output, generation)?;
        } else {
            assert!(output.frames.is_empty());
        }
        if index == 3 {
            // A real asymmetric commit checkpoint, restored without editing it.
            *host = restored(host, content()?, true)?;
            *guest = restored(guest, content()?, false)?;
        }
    }
    for kernel in [&*host, &*guest] {
        let snapshot = kernel.snapshot()?;
        let epoch = owner(&snapshot)?;
        assert_eq!(epoch.phase, CurrentCoopRebindPhaseV1::Open);
        assert_eq!(epoch.to_generation, generation);
        assert_eq!(epoch.transcript.len(), 8);
        assert_eq!(snapshot.protocol.as_ref().ok_or("protocol")?.frame_context.context.connection_generation, generation);
    }
    assert_eq!(owner(&host.snapshot()?)?.transcript, owner(&guest.snapshot()?)?.transcript);
    Ok(frames)
}

fn assert_epoch_conserved(before: &CoreGameKernelSnapshotV7, after: &CoreGameKernelSnapshotV7, generation: u64) -> TestResult {
    let old_setup = before.current_coop_setup.as_ref().ok_or("setup")?;
    let new_setup = after.current_coop_setup.as_ref().ok_or("setup")?;
    let expected_retired = if old_setup.last_reply_v2.is_some() {
        old_setup.retired_reply_rebind.clone().or_else(|| {
            let mut retired = old_setup.rebind.clone()?;
            retired.candidate_connected = false;
            Some(retired)
        })
    } else {
        None
    };
    assert_eq!(new_setup.retired_reply_rebind, expected_retired);
    let mut normalized = after.clone();
    let setup = normalized.current_coop_setup.as_mut().ok_or("setup")?;
    setup.rebind = old_setup.rebind.clone();
    setup.retired_reply_rebind = old_setup.retired_reply_rebind.clone();
    normalized.protocol = before.protocol.clone();
    normalized.scheduler = before.scheduler.clone();
    normalized.replay_sequence = before.replay_sequence;
    // Exact setup anchors, private controls, allocator, RNG, state, ledger,
    // pending presentations, input owner, fingerprints and raw cached reply.
    assert_eq!(&normalized, before);
    let mut expected = before.protocol.clone().ok_or("protocol")?;
    let target = ConnectionGeneration::new(safe(generation));
    expected.frame_context.context.connection_generation = target;
    expected.peer_identity.local.connection_generation = target;
    expected.peer_identity.peer.as_mut().ok_or("peer")?.connection_generation = target;
    for connection in &mut expected.connections {
        connection.generation = target;
        connection.state = er_types::TransportState::Connected;
    }
    if let Some(log) = &mut expected.authority_log {
        log.local_context.connection_generation = target;
        for peer in &mut log.peer_bindings { peer.generation = target; }
    }
    if let Some(replica) = &mut expected.authority_replica {
        replica.receipt_context.connection_generation = target;
        replica.authority_generation = target;
    }
    if let Some(recovery) = &mut expected.recovery {
        recovery.config.local_context.connection_generation = target;
    }
    assert_eq!(after.protocol.as_ref(), Some(&expected));
    assert_eq!(before.scheduler, after.scheduler);
    assert!(after.replay_sequence > before.replay_sequence);
    Ok(())
}

fn reject_retired_snapshot(snapshot: CoreGameKernelSnapshotV7) -> TestResult {
    assert!(GameKernelV7::from_snapshot(snapshot, SeatId::new(safe(1)), GameKernelRoleV7::Authority, content()?).is_err());
    Ok(())
}

#[test]
fn repeated_rebind_natural_three_generations_preserve_old_receipt_and_execute_new_gameplay() -> TestResult {
    use er_kernel::current_proposal_v7::CurrentProposalMaterialReceiptV2;
    let (mut host, mut guest) = pair_with_capacity(safe(1))?;
    let offer = begin(&mut host, &mut guest)?;
    let old_controls = handshake_epoch(&mut host, &mut guest, offer, 2)?;
    let absent = er_canonical::canonical_bytes(&host.snapshot()?)?;
    assert!(!String::from_utf8(absent)?.contains("retired_reply_rebind"));
    let (old_material, old_proposal) = actual_guest_proposal(&mut host, &mut guest, 2)?;
    let old_reply = wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(2)), &old_proposal)?)?;
    let old_receipt = CurrentProposalMaterialReceiptV2::decode(&old_reply)?;
    guest.ingest_network_frame(ConnectionGeneration::new(safe(2)), &old_reply)?;
    settle_owned_presentations(&mut host)?;
    settle_owned_presentations(&mut guest)?;
    assert_eq!(host.state(), guest.state());
    let before_host = host.snapshot()?;
    let before_guest = guest.snapshot()?;
    let offer = begin_epoch(&mut host, &mut guest, 2)?;
    let staged = host.snapshot()?;
    let staged_setup = staged.current_coop_setup.as_ref().ok_or("setup")?;
    let retired = staged_setup.retired_reply_rebind.as_ref().ok_or("retired owner")?.clone();
    assert_eq!(retired.to_generation, ConnectionGeneration::new(safe(2)));
    assert_eq!(retired.transcript, owner(&before_host)?.transcript);
    assert_eq!(staged_setup.last_reply_v2.as_ref().ok_or("old receipt")?.canonical_bytes()?, old_reply);
    let controls = handshake_epoch(&mut host, &mut guest, offer, 3)?;
    assert_ne!(controls, old_controls);
    assert_epoch_conserved(&before_host, &host.snapshot()?, 3)?;
    assert_epoch_conserved(&before_guest, &guest.snapshot()?, 3)?;
    for outer in [2, 3] {
        let before_host = host.snapshot()?;
        let before_guest = guest.snapshot()?;
        let generation = ConnectionGeneration::new(safe(outer));
        assert!(host.ingest_network_frame(generation, &old_proposal).is_err());
        assert!(guest.ingest_network_frame(generation, &old_reply).is_err());
        assert!(guest.ingest_network_frame(generation, &old_material).is_err());
        assert!(guest.receive_current_coop_rebind_v1(generation, &old_controls[0]).is_err());
        assert!(host.receive_current_coop_rebind_v1(generation, &old_controls[1]).is_err());
        assert_eq!(host.snapshot()?, before_host);
        assert_eq!(guest.snapshot()?, before_guest);
    }
    let (_, proposal) = actual_guest_proposal(&mut host, &mut guest, 3)?;
    let before_rejection = host.snapshot()?;
    let mut malformed: serde_json::Value = serde_json::from_slice(&proposal)?;
    malformed["extra"] = serde_json::json!(true);
    assert!(host.ingest_network_frame(ConnectionGeneration::new(safe(3)), &er_canonical::canonical_bytes(&malformed)?).is_err());
    assert_eq!(host.snapshot()?, before_rejection);
    let reply = wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(3)), &proposal)?)?;
    let receipt = CurrentProposalMaterialReceiptV2::decode(&reply)?;
    assert_eq!(receipt.evidence()?.proposal_bytes, proposal);
    assert_eq!(receipt.authority_context.connection_generation, ConnectionGeneration::new(safe(3)));
    assert_ne!(receipt.rebind_transaction_id, old_receipt.rebind_transaction_id);
    assert_eq!(Some(&receipt.rebind_transaction_id), owner(&host.snapshot()?)?.transcript.last().ok_or("transcript")?.transaction_id.as_ref());
    let applied = host.snapshot()?;
    assert!(applied.current_coop_setup.as_ref().ok_or("setup")?.retired_reply_rebind.is_none());
    assert_eq!(wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(3)), &proposal)?)?, reply);
    assert_eq!(host.snapshot()?, applied);
    guest.ingest_network_frame(ConnectionGeneration::new(safe(3)), &reply)?;
    assert!(guest.snapshot()?.current_proposal.is_none());
    let applied_guest = guest.snapshot()?;
    assert!(guest.ingest_network_frame(ConnectionGeneration::new(safe(3)), &reply)?.effects.is_empty());
    assert_eq!(guest.snapshot()?, applied_guest);
    settle_owned_presentations(&mut host)?;
    settle_owned_presentations(&mut guest)?;
    assert_eq!(host.state(), guest.state());
    restored(&host, content()?, true)?;
    restored(&guest, content()?, false)?;
    Ok(())
}

#[test]
fn repeated_rebind_retains_one_receipt_witness_across_idle_epochs_and_rejects_forged_history() -> TestResult {
    let (mut host, mut guest) = pair_with_capacity(safe(1))?;
    let offer = begin(&mut host, &mut guest)?;
    handshake(&mut host, &mut guest, offer)?;
    let (_, proposal) = actual_guest_proposal(&mut host, &mut guest, 2)?;
    let reply = wire(&host.ingest_network_frame(ConnectionGeneration::new(safe(2)), &proposal)?)?;
    // A disconnected replica with a real pending publication cannot roll over.
    guest.transport_changed(ConnectionGeneration::new(safe(2)), false)?;
    let pending = guest.snapshot()?;
    assert!(guest.begin_current_coop_rebind_v1().is_err());
    assert_eq!(guest.snapshot()?, pending);
    guest.transport_changed(ConnectionGeneration::new(safe(2)), true)?;
    guest.ingest_network_frame(ConnectionGeneration::new(safe(2)), &reply)?;
    settle_owned_presentations(&mut host)?;
    settle_owned_presentations(&mut guest)?;
    let mut retained_bytes = None;
    for from in [2, 3] {
        let before_host = host.snapshot()?;
        let before_guest = guest.snapshot()?;
        let offer = begin_epoch(&mut host, &mut guest, from)?;
        let valid = host.snapshot()?;
        let setup = valid.current_coop_setup.as_ref().ok_or("setup")?;
        let witness = setup.retired_reply_rebind.as_ref().ok_or("retired")?;
        let bytes = er_canonical::canonical_bytes(witness)?;
        assert!(bytes.len() <= er_kernel::game_kernel_v7::current_coop_rebind_v7::MAX_CURRENT_REBIND_OWNER_BYTES_V1);
        assert_eq!(witness.to_generation, ConnectionGeneration::new(safe(2)));
        assert_eq!(witness.transcript.len(), 8);
        assert!(!String::from_utf8(bytes.clone())?.contains("retired_reply_rebind"));
        if let Some(previous) = &retained_bytes { assert_eq!(previous, &bytes); }
        retained_bytes = Some(bytes);
        assert_eq!(setup.last_reply_v2.as_ref().ok_or("receipt")?.canonical_bytes()?, reply);
        for case in 0..10 {
            let mut forged = valid.clone();
            let setup = forged.current_coop_setup.as_mut().ok_or("setup")?;
            match case {
                0 => setup.retired_reply_rebind = None,
                1 => setup.last_reply_v2 = None,
                2 => setup.retired_reply_rebind.as_mut().ok_or("retired")?.transcript.pop().ok_or("transcript").map(|_| ())?,
                3 => setup.retired_reply_rebind.as_mut().ok_or("retired")?.commit_replay_sequence = Some(owner(&valid)?.begin_replay_sequence),
                4 => setup.retired_reply_rebind.as_mut().ok_or("retired")?.binding.authority_origin.run_id = RunId::new("forged-origin")?,
                5 => setup.retired_reply_rebind.as_mut().ok_or("retired")?.binding.frontier.next_authority_revision = safe(1),
                6 => setup.last_reply_v2.as_mut().ok_or("receipt")?.rebind_transaction_id = "0".repeat(64),
                7 => setup.last_reply_v2.as_mut().ok_or("receipt")?.authority_context.connection_generation = ConnectionGeneration::new(safe(from + 1)),
                8 => setup.rebind.as_mut().ok_or("owner")?.from_generation = ConnectionGeneration::new(safe(9_007_199_254_740_991)),
                _ => setup.retired_reply_rebind = setup.rebind.clone(),
            }
            reject_retired_snapshot(forged)?;
            assert_eq!(host.snapshot()?, valid);
        }
        handshake_epoch(&mut host, &mut guest, offer, from + 1)?;
        assert_epoch_conserved(&before_host, &host.snapshot()?, from + 1)?;
        assert_epoch_conserved(&before_guest, &guest.snapshot()?, from + 1)?;
    }
    let complete = host.snapshot()?;
    let mut orphan = complete.clone();
    orphan.current_coop_setup.as_mut().ok_or("setup")?.last_reply_v2 = None;
    reject_retired_snapshot(orphan)?;
    assert_eq!(host.snapshot()?, complete);
    assert_eq!(host.state(), guest.state());
    restored(&host, content()?, true)?;
    restored(&guest, content()?, false)?;
    Ok(())
}
