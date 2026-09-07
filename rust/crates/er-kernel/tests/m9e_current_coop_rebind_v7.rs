//! Native equal-frontier rebind only. No browser transport or generation-two gameplay claim.
//! All decisions, deliveries and restored states use the current runtime.
use std::error::Error;
use std::sync::{Arc, OnceLock};

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m72_bootstrap::RunBootstrapStageV1;
use er_kernel::game_kernel_v7::GameKernelV7;
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7};
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
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
    let authority = SeatId::new(safe(1));
    let replica = SeatId::new(safe(2));
    let seat = if host { authority } else { replica };
    let generation = ConnectionGeneration::new(safe(1));
    let config = if host {
        authority_protocol(authority, replica, generation)?
    } else {
        replica_protocol(authority, replica, generation)?
    };
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
    let mut host = owned_title(content()?, true)?;
    let mut guest = owned_title(content()?, false)?;
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
                .raw_input(RawInputEvent::KeyDown {
                    code: PhysicalKey::Space,
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game
                })
                .is_err()
        );
        assert!(kernel.advance_time(safe(1)).is_err());
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
    let mut scheduler = initial.scheduler.clone().into_scheduler()?;
    scheduler.pause_class(
        SeatId::new(safe(1)),
        TimeClass::Connected,
        "independent-native-owner",
    )?;
    initial.scheduler = KernelSchedulerSnapshotV2::from_scheduler(&scheduler)?;
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
