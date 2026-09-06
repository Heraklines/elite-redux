//! Pure current-kernel witnesses. Actual Worker/RTC evidence belongs to the browser consumer.
use er_canonical::canonical_bytes;
use er_game::m7_progression_control::generic_vertical_control_v2;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::GameMaterialV6;
use er_kernel::current_proposal_v7::{
    CurrentProposalMaterialReceiptV1, CurrentProposalOwnerSnapshotV1,
    MAX_CURRENT_PROPOSAL_BYTES_V1, MAX_CURRENT_RECEIPT_BYTES_V1,
    MAX_CURRENT_RECEIPT_MATERIAL_BYTES_V1, current_bytes_hex_v1, json_bytes_sha256_v1,
};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7,
};
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_protocol::proposal::ProposalLeaseConfig;
use er_protocol::recovery::RecoveryTransactionConfig;
use er_protocol::replica::AuthorityReplicaConfig;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::input::{PhysicalKey, RawInputEvent};
use er_types::{
    ConnectionGeneration, FrameContext, GameActionV1, GameControlKindV2, GameMenuCancelV2,
    InputFocus, MembershipRevision, OperationId, RunId, SafeU53, SaveActionV1, SeatId, SessionId,
    TimeClass,
};
use std::error::Error;
use std::sync::Arc;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn content() -> Result<Arc<PreparedGameContentV2>, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
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

fn input() -> InputRouterSnapshotV2 {
    InputRouterSnapshotV2 {
        focus: InputFocus::Game,
        pressed: Vec::new(),
        suppressed_printable_keys: Vec::new(),
        held_buttons: Vec::new(),
        locks: Vec::new(),
        repeats: Vec::new(),
        disposed: false,
    }
}

fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 {
        next_timer_id: Some(SafeU53::ZERO),
        timers: Vec::new(),
        pauses: Vec::new(),
        disposed: false,
    }
}

fn press(
    kernel: &mut GameKernelV7,
    code: PhysicalKey,
) -> Result<er_kernel::game_kernel_v7::GameKernelStepV7, Box<dyn Error>> {
    let step = kernel
        .raw_input(RawInputEvent::KeyDown {
            code: code.clone(),
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })
        .map_err(|error| format!("raw key down {code:?} failed: {error}"))?;
    kernel
        .raw_input(RawInputEvent::KeyUp { code })
        .map_err(|error| format!("raw key up failed: {error}"))?;
    Ok(step)
}

fn navigate_down_to(kernel: &mut GameKernelV7, option: &str) -> Result<(), Box<dyn Error>> {
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1)
        .ok_or("current control has no menu")?;
    for _ in 0..bound {
        if kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == option)
        {
            return Ok(());
        }
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    Err(format!("option {option} is unreachable").into())
}

fn natural_coop_state(
    content: Arc<PreparedGameContentV2>,
    host: SeatId,
) -> Result<(GameStateV6, SafeU53, MenuInstanceId), Box<dyn Error>> {
    let cooperative_mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| mode.cooperative && mode.supported)
        .ok_or("supported cooperative mode missing")?;
    let cooperative_mode_id = cooperative_mode.mode;
    let mode_option = format!("bootstrap/mode/{}", cooperative_mode_id.get());
    let protocol = initial_battle_protocol_snapshot_v2(
        &authority_protocol(host, SeatId::new(safe(2)), ConnectionGeneration::new(safe(1)))?,
        host,
    )?;
    let mut kernel = GameKernelV7::natural_start(
        profile()?,
        "m9e-natural-coop".to_owned(),
        host,
        vec!["m9e-coop-slot".to_owned()],
        true,
        content,
        scheduler(),
        Some(protocol),
    )
    .map_err(|error| format!("natural co-op initialization failed: {error}"))?;
    press(&mut kernel, PhysicalKey::Space)?;
    navigate_down_to(&mut kernel, &mode_option)?;
    press(&mut kernel, PhysicalKey::Space)?;
    navigate_down_to(&mut kernel, "bootstrap/challenge/done")?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    navigate_down_to(&mut kernel, "bootstrap/starter/confirm")?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    let state = kernel
        .state()
        .cloned()
        .ok_or("cooperative bootstrap did not install a run")?;
    assert_eq!(
        state.active_run.as_ref().ok_or("run missing")?.mode,
        cooperative_mode_id
    );
    let run = state.active_run.as_ref().ok_or("run missing")?;
    assert_eq!(run.battle.as_ref().ok_or("battle missing")?.format.player_capacity, 2);
    for seat in [host, SeatId::new(safe(2))] {
        assert!(run.party.iter().any(|pokemon| pokemon.owner_seat == Some(seat)));
    }
    let snapshot = kernel
        .snapshot()
        .map_err(|error| format!("natural co-op snapshot failed: {error}"))?;
    Ok((
        state,
        snapshot.material_ledger.next_authority_revision,
        snapshot.next_menu_instance_id,
    ))
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

fn pair_from_state(
    state: GameStateV6,
    revision: SafeU53,
    content: Arc<PreparedGameContentV2>,
) -> Result<(GameKernelV7, GameKernelV7), Box<dyn Error>> {
    pair_from_state_at_generation(state, revision, content, ConnectionGeneration::new(safe(1)))
}

fn pair_from_state_at_generation(
    state: GameStateV6,
    revision: SafeU53,
    content: Arc<PreparedGameContentV2>,
    generation: ConnectionGeneration,
) -> Result<(GameKernelV7, GameKernelV7), Box<dyn Error>> {
    let host = SeatId::new(safe(1));
    let guest = SeatId::new(safe(2));
    let authority = GameKernelV7::from_active(
        state.clone(),
        revision,
        host,
        GameKernelRoleV7::Authority,
        content.clone(),
        input(),
        scheduler(),
        Some(initial_battle_protocol_snapshot_v2(
            &authority_protocol(host, guest, generation)?,
            host,
        )?),
    )?;
    let replica = GameKernelV7::from_active(
        state,
        revision,
        guest,
        GameKernelRoleV7::Replica,
        content,
        input(),
        scheduler(),
        Some(initial_battle_protocol_snapshot_v2(
            &replica_protocol(host, guest, generation)?,
            guest,
        )?),
    )?;
    Ok((authority, replica))
}

fn save_checkpoint(
    state: &mut GameStateV6,
    revision: SafeU53,
    menu: MenuInstanceId,
) -> Result<(), Box<dyn Error>> {
    let mut control = generic_vertical_control_v2(
        menu,
        revision,
        SeatId::new(safe(2)),
        OperationId::new("current-owner/save-cancel")?,
        GameControlKindV2::Save,
        "current-owner/save",
        &[(
            "save/cancel".to_owned(),
            GameActionV1::Save {
                action: SaveActionV1::Cancel,
            },
        )],
        GameMenuCancelV2::Disabled,
    )?;
    control
        .action_context
        .as_mut()
        .ok_or("save context missing")?
        .authority_seat = SeatId::new(safe(1));
    state.active_run.as_mut().ok_or("run missing")?.control = control;
    Ok(())
}

fn bind_battle_root(state: &mut GameStateV6, owner: SeatId) -> Result<(), Box<dyn Error>> {
    let run = state.active_run.as_mut().ok_or("run missing")?;
    let battle = run.battle.as_ref().ok_or("battle missing")?;
    let field = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Player
                && slot.occupant.is_some_and(|id| {
                    run.party
                        .iter()
                        .any(|pokemon| pokemon.id == id && pokemon.owner_seat == Some(owner))
                })
        })
        .ok_or("controlled command owner has no active actor")?;
    let operation = er_types::battle_command::player_command_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
        field.slot,
        owner,
    )?;
    run.control.owner_seat = Some(owner);
    run.control
        .menu
        .as_mut()
        .ok_or("root menu missing")?
        .owner_seat = owner;
    let context = run
        .control
        .action_context
        .as_mut()
        .ok_or("root context missing")?;
    context.authority_seat = SeatId::new(safe(1));
    context.operation_id = operation;
    run.control.validate()?;
    Ok(())
}

fn noncurrent_generation_raw_compatibility(
    content: Arc<PreparedGameContentV2>,
) -> Result<(), Box<dyn Error>> {
    let (mut state, revision, menu) = natural_coop_state(content.clone(), SeatId::new(safe(1)))?;
    save_checkpoint(&mut state, revision, menu)?;
    let generation = ConnectionGeneration::new(safe(9));
    let (mut authority, mut replica) = pair_from_state_at_generation(state, revision, content, generation)?;
    let bytes = proposal(&press(&mut replica, PhysicalKey::Space)?)?;
    assert!(replica.snapshot()?.current_proposal.is_none());
    let envelope = er_kernel::current_proposal_v7::decode_current_proposal_v1(&bytes)?;
    assert_eq!(envelope.connection_generation, generation);
    let before = authority.snapshot()?;
    assert!(authority.ingest_network_frame(ConnectionGeneration::new(safe(8)), &bytes).is_err());
    assert_eq!(authority.snapshot()?, before);
    let raw = material(&authority.ingest_network_frame(generation, &bytes)?)?;
    GameMaterialV6::decode(&raw)?;
    assert!(CurrentProposalMaterialReceiptV1::decode(&raw).is_err());
    replica.ingest_network_frame(generation, &raw)?;
    assert_eq!(replica.state(), authority.state());
    assert!(replica.snapshot()?.current_proposal.is_none());
    assert!(authority.snapshot()?.current_proposal.is_none());
    let completed = replica.snapshot()?;
    assert_eq!(replica.ingest_network_frame(generation, &raw)?, GameKernelStepV7::default());
    assert_eq!(replica.snapshot()?, completed);
    Ok(())
}
fn ordinary_publication_atomicity(
    content: Arc<PreparedGameContentV2>,
) -> Result<(), Box<dyn Error>> {
    let (mut state, revision, menu) = natural_coop_state(content.clone(), SeatId::new(safe(1)))?;
    save_checkpoint(&mut state, revision, menu)?;
    let (_, replica) = pair_from_state(state, revision, content.clone())?;
    for event in [
        RawInputEvent::KeyDown {
            code: PhysicalKey::Space,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::GamepadDown { button: 0 },
    ] {
        let mut snapshot = replica.snapshot()?;
        snapshot.replay_sequence = safe(9_007_199_254_740_991);
        let mut exhausted = restore(snapshot, content.clone())?;
        let before = exhausted.snapshot()?;
        assert!(exhausted.raw_input(event.clone()).is_err());
        assert_eq!(
            exhausted.snapshot()?,
            before,
            "ordinary Save press must roll back every physical and allocator field"
        );
        let mut normal = restore(replica.snapshot()?, content.clone())?;
        let bytes = proposal(&normal.raw_input(event)?)?;
        assert_eq!(
            normal
                .snapshot()?
                .current_proposal
                .as_ref()
                .ok_or("Save owner missing")?
                .retained()
                .proposal_hex,
            current_bytes_hex_v1(&bytes)
        );
    }
    Ok(())
}
fn proposal(step: &GameKernelStepV7) -> Result<Vec<u8>, Box<dyn Error>> {
    let bytes = step
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::ProposalReady { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(bytes.len(), 1);
    bytes
        .into_iter()
        .next()
        .ok_or_else(|| "expected exactly one owned effect".into())
}

fn material(step: &GameKernelStepV7) -> Result<Vec<u8>, Box<dyn Error>> {
    let bytes = step
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(bytes.len(), 1);
    bytes
        .into_iter()
        .next()
        .ok_or_else(|| "expected exactly one owned effect".into())
}

fn restore(
    snapshot: CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<GameKernelV7, Box<dyn Error>> {
    Ok(GameKernelV7::from_snapshot(
        serde_json::from_slice(&canonical_bytes(&snapshot)?)?,
        SeatId::new(safe(2)),
        GameKernelRoleV7::Replica,
        content,
    )?)
}

fn reject_restore(
    value: serde_json::Value,
    content: Arc<PreparedGameContentV2>,
) -> Result<(), Box<dyn Error>> {
    if let Ok(snapshot) = serde_json::from_value::<CoreGameKernelSnapshotV7>(value) {
        assert!(restore(snapshot, content).is_err());
    }
    Ok(())
}

fn reject_ingress(kernel: &mut GameKernelV7, bytes: &[u8]) -> Result<(), Box<dyn Error>> {
    let before = kernel.snapshot()?;
    assert!(
        kernel
            .ingest_network_frame(ConnectionGeneration::new(safe(1)), bytes)
            .is_err()
    );
    assert_eq!(kernel.snapshot()?, before);
    Ok(())
}

// Test-only public scheduler state bridges preserve every owned field. The
// production snapshot conversion methods intentionally remain crate-private.
fn live_scheduler(
    snapshot: &KernelSchedulerSnapshotV2,
) -> Result<er_protocol::KernelScheduler, Box<dyn Error>> {
    snapshot.validate()?;
    let state = er_protocol::KernelSchedulerRestorableState {
        next_timer_id: snapshot.next_timer_id,
        timers: snapshot
            .timers
            .iter()
            .map(|timer| er_protocol::KernelSchedulerTimerState {
                registration: timer.registration.clone(),
                original_delay_ms: timer.original_delay_ms,
                remaining_active_ms: timer.remaining_active_ms,
            })
            .collect(),
        pauses: snapshot
            .pauses
            .iter()
            .map(|pause| er_protocol::KernelSchedulerPauseState {
                endpoint: pause.endpoint,
                time_class: pause.time_class,
                reasons: pause.reasons.clone(),
            })
            .collect(),
        disposed: snapshot.disposed,
    };
    let scheduler = er_protocol::KernelScheduler::import_restorable_state(state)?;
    assert_eq!(scheduler_snapshot(&scheduler)?, *snapshot);
    Ok(scheduler)
}

fn scheduler_snapshot(
    scheduler: &er_protocol::KernelScheduler,
) -> Result<KernelSchedulerSnapshotV2, Box<dyn Error>> {
    let state = scheduler.export_restorable_state();
    let snapshot = KernelSchedulerSnapshotV2 {
        next_timer_id: state.next_timer_id,
        timers: state
            .timers
            .into_iter()
            .map(|timer| er_kernel::snapshot::RestorableTimerSnapshotV2 {
                registration: timer.registration,
                original_delay_ms: timer.original_delay_ms,
                remaining_active_ms: timer.remaining_active_ms,
            })
            .collect(),
        pauses: state
            .pauses
            .into_iter()
            .map(|pause| er_kernel::snapshot::TimeClassPauseSnapshotV2 {
                endpoint: pause.endpoint,
                time_class: pause.time_class,
                reasons: pause.reasons,
            })
            .collect(),
        disposed: state.disposed,
    };
    snapshot.validate()?;
    Ok(snapshot)
}
fn historical_owner_rejection(
    pending: &CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<(), Box<dyn Error>> {
    use er_protocol::proposal::{ProposalLeaseManager, ProposalLeaseSpec};
    use er_protocol::snapshot::ProposalLeaseSnapshotBridge;
    let guest = SeatId::new(safe(2));
    let mut scheduler = live_scheduler(&pending.scheduler)?;
    let mut protocol = pending.protocol.clone().ok_or("protocol missing")?;
    let config = protocol
        .proposal_leases
        .as_ref()
        .ok_or("historical owner missing")?
        .config
        .clone();
    let mut leases = ProposalLeaseManager::new(config)?;
    let operation = OperationId::new("historical/current-owner-overlap")?;
    let _armed = leases.arm(
        ProposalLeaseSpec {
            proposal: er_types::ProposalMessage {
                operation_id: operation.clone(),
                fingerprint: "historical-current-owner".to_owned(),
                from: guest,
                to: SeatId::new(safe(1)),
                connection_generation: ConnectionGeneration::new(safe(1)),
                payload: serde_json::json!({"historical": true}),
            },
            absolute_ceiling_ms: None,
        },
        &mut scheduler,
    )?;
    protocol.proposal_leases = Some(leases.snapshot_v2()?);
    protocol.validate()?;
    let historical_scheduler = scheduler_snapshot(&scheduler)?;
    historical_scheduler.validate()?;
    assert_eq!(
        protocol
            .proposal_leases
            .as_ref()
            .ok_or("leases absent")?
            .leases
            .len(),
        1
    );
    assert_eq!(historical_scheduler.timers.len(), 2);
    let mut overlap = pending.clone();
    overlap.protocol = Some(protocol.clone());
    overlap.scheduler = historical_scheduler.clone();
    assert!(restore(overlap, content.clone()).is_err());
    // The legacy snapshot itself remains valid. Current migration must reject
    // its actual retained lease and timers instead of adopting or dropping them.
    let GameKernelLifecycleSnapshotV7::Active(state) = &pending.lifecycle else {
        return Err("active missing".into());
    };
    let identity = er_types::GameContentIdentity {
        oracle_sha: content.identity().oracle_sha.clone(),
        content_hash: content.identity().bundle_hash.clone(),
        battle_content_hash: content.identity().battle_hash.clone(),
        semantic_catalog_hash: content.identity().semantic_catalog_hash.clone(),
    };
    let historical = er_kernel::snapshot_v6::RestorableKernelSnapshotV6 {
        schema_version: er_kernel::snapshot_v6::RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V6,
        content_identity: identity.clone(),
        game_state: er_state::m7_state::GameStateV5 {
            schema_version: er_state::m7_state::GAME_STATE_SCHEMA_VERSION_V5,
            content_identity: identity,
            profile: state.profile.clone(),
            active_run: None,
        },
        input_router: input(),
        scheduler: historical_scheduler,
        protocol: Some(protocol),
        pending_presentations: Vec::new(),
        prepared_transactions: Vec::new(),
        replay_sequence: safe(7),
        terminal: None,
        pressed_keys: Default::default(),
    };
    historical.validate()?;
    assert!(CoreGameKernelSnapshotV7::migrate_from_v6(historical.clone(), &content).is_err());
    let mut orphaned_timers = historical.clone();
    orphaned_timers.protocol = pending.protocol.clone();
    assert!(CoreGameKernelSnapshotV7::migrate_from_v6(orphaned_timers, &content).is_err());
    let (retired, _) = leases.observe_committed(&operation, &mut scheduler);
    assert!(retired);
    let mut quiescent = historical;
    quiescent
        .protocol
        .as_mut()
        .ok_or("protocol missing")?
        .proposal_leases = Some(leases.snapshot_v2()?);
    quiescent.scheduler = scheduler_snapshot(&scheduler)?;
    quiescent.validate()?;
    let migrated = CoreGameKernelSnapshotV7::migrate_from_v6(quiescent.clone(), &content)?;
    assert!(migrated.current_proposal.is_none());
    assert_eq!(
        migrated.protocol, quiescent.protocol,
        "inert historical tombstones survive migration"
    );
    assert_eq!(migrated.scheduler, quiescent.scheduler);
    let mut collision = pending.clone();
    let owner = pending.current_proposal.as_ref().ok_or("owner missing")?;
    let proposal_bytes = er_kernel::current_proposal_v7::decode_current_hex_v1(
        &owner.retained().proposal_hex,
        MAX_CURRENT_PROPOSAL_BYTES_V1,
    )?;
    let envelope = er_kernel::current_proposal_v7::decode_current_proposal_v1(&proposal_bytes)?;
    collision
        .protocol
        .as_mut()
        .ok_or("protocol missing")?
        .proposal_leases
        .as_mut()
        .ok_or("leases missing")?
        .committed_tombstones = vec![envelope.proposal.context.operation_id];
    collision
        .protocol
        .as_ref()
        .ok_or("protocol missing")?
        .validate()?;
    assert!(restore(collision, content).is_err());
    Ok(())
}
#[test]
fn current_proposal_publication_receipt_and_snapshot_conserve_ownership()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let generation = ConnectionGeneration::new(safe(1));
    ordinary_publication_atomicity(content.clone())?;
    noncurrent_generation_raw_compatibility(content.clone())?;
    let (mut state, revision, _) = natural_coop_state(content.clone(), SeatId::new(safe(1)))?;
    // Controlled guest-first canonical root, not a natural guest-first claim.
    // The actual retention material must still await the other human's command.
    bind_battle_root(&mut state, SeatId::new(safe(2)))?;
    let (mut authority, mut replica) = pair_from_state(state, revision, content.clone())?;
    let original_authority = authority.clone();
    press(&mut replica, PhysicalKey::Space)?;
    let initial = replica.snapshot()?;
    let mut exhausted_publication = initial.clone();
    exhausted_publication.replay_sequence = safe(9_007_199_254_740_991);
    let mut exhausted_publication = restore(exhausted_publication, content.clone())?;
    let before_publication = exhausted_publication.snapshot()?;
    assert!(press(&mut exhausted_publication, PhysicalKey::Space).is_err());
    assert_eq!(exhausted_publication.snapshot()?, before_publication);
    assert!(initial.current_proposal.is_none());
    assert!(
        serde_json::to_value(&initial)?
            .get("current_proposal")
            .is_none()
    );
    let bytes = proposal(&press(&mut replica, PhysicalKey::Space)?)?;
    let pending = replica.snapshot()?;
    assert_eq!(
        pending.replay_sequence.get(),
        initial.replay_sequence.get() + 1
    );
    let mut expected_publication = initial.clone();
    expected_publication.current_proposal = pending.current_proposal.clone();
    expected_publication.replay_sequence = pending.replay_sequence;
    assert_eq!(
        pending, expected_publication,
        "publication changes only exact owner and replay, preserving state/RNG and allocators"
    );
    let owner = pending
        .current_proposal
        .as_ref()
        .ok_or("pending owner missing")?;
    let retained = owner.retained();
    assert_eq!(retained.proposal_hex, current_bytes_hex_v1(&bytes));
    assert_eq!(retained.proposal_digest, json_bytes_sha256_v1(&bytes)?);
    assert_ne!(
        retained.publication_context.run_id.as_str(),
        retained.publication_game_run_id.get().to_string()
    );
    assert_eq!(
        restore(pending.clone(), content.clone())?.snapshot()?,
        pending
    );
    assert_eq!(proposal(&press(&mut replica, PhysicalKey::Space)?)?, bytes);
    assert_eq!(
        replica.snapshot()?,
        pending,
        "exact re-publication cannot reset the owner or replay"
    );
    historical_owner_rejection(&pending, content.clone())?;
    let pending_json = serde_json::to_value(&pending)?;
    for (field, value) in [
        ("schema_version", serde_json::json!(2)),
        (
            "proposal_digest",
            serde_json::json!("sha256-json-bytes-v1:wrong"),
        ),
        (
            "publication_game_run_id",
            serde_json::json!(9_007_199_254_740_991_u64),
        ),
        (
            "publication_before_digest",
            serde_json::json!(format!("blake3-v1:{}", "0".repeat(64))),
        ),
        (
            "publication_next_authority_revision",
            serde_json::json!(9_007_199_254_740_991_u64),
        ),
        ("publication_menu_highwater", serde_json::json!(0)),
        ("publication_replay_sequence", serde_json::json!(0)),
        ("unknown", serde_json::json!(true)),
    ] {
        let mut changed = pending_json.clone();
        changed["current_proposal"]["retained"][field] = value;
        reject_restore(changed, content.clone())?;
    }
    for field in ["publication_context", "authority_peer_context"] {
        let mut changed = pending_json.clone();
        changed["current_proposal"]["retained"][field]["unknown"] = serde_json::json!(true);
        reject_restore(changed, content.clone())?;
    }
    let mut changed = pending_json.clone();
    changed["current_proposal"]["retained"]["proposal_hex"] =
        serde_json::json!("0".repeat(MAX_CURRENT_PROPOSAL_BYTES_V1 * 2 + 2));
    reject_restore(changed, content.clone())?;
    let mut wrong_role = pending.clone();
    wrong_role.current_proposal = initial.current_proposal.clone();
    assert!(
        GameKernelV7::from_snapshot(
            pending.clone(),
            SeatId::new(safe(1)),
            GameKernelRoleV7::Authority,
            content.clone()
        )
        .is_err()
    );
    assert!(restore(wrong_role, content.clone()).is_ok());

    let mut exhausted = pending.clone();
    exhausted.replay_sequence = safe(9_007_199_254_740_991);
    let mut exhausted = restore(exhausted, content.clone())?;
    let before = exhausted.snapshot()?;
    assert!(exhausted.transport_changed(generation, false).is_err());
    assert_eq!(exhausted.snapshot()?, before);
    for invalid_generation in [0, 2] {
        let before = replica.snapshot()?;
        assert!(
            replica
                .transport_changed(ConnectionGeneration::new(safe(invalid_generation)), true)
                .is_err()
        );
        assert_eq!(replica.snapshot()?, before);
    }
    replica.transport_changed(generation, false)?;
    let disconnected = replica.snapshot()?;
    assert_eq!(disconnected.current_proposal, pending.current_proposal);
    assert_eq!(
        disconnected.replay_sequence.get(),
        pending.replay_sequence.get() + 1
    );
    replica = restore(disconnected.clone(), content.clone())?;
    assert!(press(&mut replica, PhysicalKey::Space).is_err());
    assert_eq!(replica.snapshot()?, disconnected);

    // Independently admitted different proposal from the SAME canonical root.
    // Its receipt applies real retention material but cannot retire our owner.
    let mut alternative = restore(initial.clone(), content.clone())?;
    press(&mut alternative, PhysicalKey::ArrowDown)?;
    let other_bytes = proposal(&press(&mut alternative, PhysicalKey::Space)?)?;
    assert_ne!(other_bytes, bytes);
    let mut other_authority = original_authority;
    let other_receipt = material(&other_authority.ingest_network_frame(generation, &other_bytes)?)?;
    let mut other_delivery = restore(pending.clone(), content.clone())?;
    other_delivery.ingest_network_frame(generation, &other_receipt)?;
    assert_eq!(
        other_delivery.snapshot()?.current_proposal,
        pending.current_proposal
    );
    assert_eq!(other_delivery.state(), other_authority.state());
    assert_eq!(
        other_delivery.snapshot()?.replay_sequence.get(),
        pending.replay_sequence.get() + 1
    );
    let admitted = authority.ingest_network_frame(generation, &bytes)?;
    let receipt_bytes = material(&admitted)?;
    let receipt = CurrentProposalMaterialReceiptV1::decode(&receipt_bytes)?;
    let evidence = receipt.evidence()?;
    assert_eq!(
        authority
            .state()
            .and_then(|state| state.active_run.as_ref())
            .and_then(|run| run.battle.as_ref())
            .ok_or("retained battle missing")?
            .command_state
            .frontier
            .len(),
        1
    );
    assert_eq!(evidence.proposal_bytes, bytes);
    assert_eq!(receipt.canonical_bytes()?, receipt_bytes);
    assert!(receipt_bytes.len() <= MAX_CURRENT_RECEIPT_BYTES_V1);
    assert!(evidence.material_bytes.len() <= MAX_CURRENT_RECEIPT_MATERIAL_BYTES_V1);
    assert!(
        authority
            .ingest_network_frame(generation, &bytes)?
            .effects
            .is_empty(),
        "lost reply is not regenerated"
    );
    reject_ingress(&mut replica, &receipt_bytes)?;
    replica.transport_changed(generation, true)?;
    assert_eq!(
        replica.snapshot()?.current_proposal,
        pending.current_proposal
    );
    // Internally canonical material with the SAME envelope but a wrong before
    // frontier is independently decodable; only the retained binding rejects it.
    let mut wrong_before_value: serde_json::Value =
        serde_json::from_slice(&evidence.material_bytes)?;
    wrong_before_value["value"]["before_digest"] =
        serde_json::json!(format!("blake3-v1:{}", "0".repeat(64)));
    let wrong_before_bytes = canonical_bytes(&wrong_before_value)?;
    GameMaterialV6::decode(&wrong_before_bytes)?;
    let wrong_before = CurrentProposalMaterialReceiptV1::from_admission(
        &bytes,
        &wrong_before_bytes,
        receipt.authority_context.clone(),
    )?
    .canonical_bytes()?;
    reject_ingress(&mut replica, &wrong_before)?;
    let mut wrong_revision_value: serde_json::Value =
        serde_json::from_slice(&evidence.material_bytes)?;
    wrong_revision_value["value"]["authority_revision"] =
        serde_json::json!(evidence.material.transition().authority_revision.get() + 1);
    let wrong_revision_bytes = canonical_bytes(&wrong_revision_value)?;
    assert!(
        CurrentProposalMaterialReceiptV1::from_admission(
            &bytes,
            &wrong_revision_bytes,
            receipt.authority_context.clone()
        )
        .is_err()
    );
    let receipt_json = serde_json::to_value(&receipt)?;
    for (field, value) in [
        ("schema_version", serde_json::json!(2)),
        (
            "proposal_digest",
            serde_json::json!("sha256-json-bytes-v1:wrong"),
        ),
        (
            "material_digest",
            serde_json::json!("sha256-json-bytes-v1:wrong"),
        ),
        ("material_fingerprint", serde_json::json!("blake3-v1:wrong")),
        ("material_hex", serde_json::json!("AA")),
        ("unknown", serde_json::json!(true)),
    ] {
        let mut changed = receipt_json.clone();
        changed[field] = value;
        reject_ingress(&mut replica, &canonical_bytes(&changed)?)?;
    }
    let mut wrong_context = receipt_json.clone();
    wrong_context["authority_context"]["runId"] = serde_json::json!("another-opaque-run");
    reject_ingress(&mut replica, &canonical_bytes(&wrong_context)?)?;
    for (field, value) in [
        ("unknown", serde_json::json!(true)),
        ("connectionGeneration", serde_json::json!(0)),
        ("senderSeatId", serde_json::json!(2)),
        ("sessionId", serde_json::json!("other-session")),
        ("membershipRevision", serde_json::json!(2)),
    ] {
        let mut changed = receipt_json.clone();
        changed["authority_context"][field] = value;
        reject_ingress(&mut replica, &canonical_bytes(&changed)?)?;
    }
    for field in ["proposal_hex", "material_hex"] {
        let mut changed = receipt_json.clone();
        let maximum = if field == "proposal_hex" {
            MAX_CURRENT_PROPOSAL_BYTES_V1
        } else {
            MAX_CURRENT_RECEIPT_MATERIAL_BYTES_V1
        };
        changed[field] = serde_json::json!("0".repeat(maximum * 2 + 2));
        reject_ingress(&mut replica, &canonical_bytes(&changed)?)?;
    }
    let mut noncanonical = receipt_bytes.clone();
    noncanonical.push(b' ');
    reject_ingress(&mut replica, &noncanonical)?;
    reject_ingress(&mut replica, &vec![b' '; MAX_CURRENT_RECEIPT_BYTES_V1 + 1])?;

    // Raw compatibility material has no receipt authority and cannot settle even this exact proposal.
    let raw = replica.apply_authority_material(&evidence.material_bytes)?;
    assert!(
        !raw.effects
            .iter()
            .any(|effect| matches!(effect, GameKernelEffectV7::Platform(_)))
    );
    assert_eq!(
        replica.snapshot()?.current_proposal,
        pending.current_proposal
    );
    press(&mut replica, PhysicalKey::Space)?;
    let private = replica.snapshot()?;
    assert!(private.private_battle_control.is_some());
    // Controlled empty retained suffix at the real advanced frontier; no claim
    // of executing 4096 turns. A valid receipt now lacks duplicate evidence.
    let mut evicted = private.clone();
    evicted.material_ledger.records.clear();
    let mut evicted = restore(evicted, content.clone())?;
    reject_ingress(&mut evicted, &receipt_bytes)?;
    let mut duplicate_max = private.clone();
    duplicate_max.replay_sequence = safe(9_007_199_254_740_991);
    let mut duplicate_max = restore(duplicate_max, content.clone())?;
    reject_ingress(&mut duplicate_max, &receipt_bytes)?;
    let mut expected = private.clone();
    expected.current_proposal = None;
    expected.replay_sequence = safe(private.replay_sequence.get() + 1);
    assert_eq!(
        replica.ingest_network_frame(generation, &receipt_bytes)?,
        GameKernelStepV7::default()
    );
    assert_eq!(
        replica.snapshot()?,
        expected,
        "duplicate retirement must preserve ORIGINAL private state and every other owner"
    );
    assert_eq!(
        replica.ingest_network_frame(generation, &receipt_bytes)?,
        GameKernelStepV7::default()
    );
    assert_eq!(replica.snapshot()?, expected);
    // A fresh receipt follows the same single replay advance and presentation-only fanout.
    let mut fresh = restore(pending.clone(), content.clone())?;
    let delivered = fresh.ingest_network_frame(generation, &receipt_bytes)?;
    assert!(
        !delivered
            .effects
            .iter()
            .any(|effect| matches!(effect, GameKernelEffectV7::Platform(_)))
    );
    assert!(fresh.snapshot()?.current_proposal.is_none());
    assert_eq!(
        fresh.snapshot()?.replay_sequence.get(),
        pending.replay_sequence.get() + 1
    );
    assert_eq!(fresh.state(), authority.state());
    Ok(())
}
fn submit_strongest_move(
    kernel: &mut GameKernelV7,
    content: &PreparedGameContentV2,
) -> Result<GameKernelStepV7, Box<dyn Error>> {
    let menu = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .ok_or("move menu is absent")?;
    let state = kernel.state().ok_or("state is absent")?;
    let run = state.active_run.as_ref().ok_or("run is absent")?;
    let actor = run
        .party
        .iter()
        .find(|pokemon| {
            run.battle.as_ref().is_some_and(|battle| {
                battle.field.slots.iter().any(|slot| {
                    slot.slot.side == er_types::battle_ids::BattleSide::Player
                        && slot.occupant == Some(pokemon.id)
                })
            })
        })
        .ok_or("active player is absent")?;
    let target_option = menu
        .options
        .iter()
        .filter_map(|option| {
            let GameActionV1::Battle {
                action: er_types::BattleUiActionV1::SelectMove { move_slot, .. },
            } = option.action
            else {
                return None;
            };
            let move_id = actor.moves[usize::from(move_slot.get())]?.move_id;
            let definition = content.battle.move_definition(move_id).ok()?;
            let power = match definition.power {
                er_types::battle_model::MovePower::None => 0,
                er_types::battle_model::MovePower::Value(power) => power,
            };
            Some((power, option.option_id.clone()))
        })
        .max_by_key(|(power, _)| *power)
        .map(|(_, option)| option)
        .ok_or("no move option is available")?;
    navigate_down_to(kernel, target_option.as_str())?;
    press(kernel, PhysicalKey::Space)
}

#[test]
fn current_proposal_rejection_duplicate_and_terminal_are_transactional()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let host = SeatId::new(safe(1));
    let guest = SeatId::new(safe(2));
    let generation = ConnectionGeneration::new(safe(1));
    // Natural cooperative bootstrap followed by an explicit final-wave checkpoint:
    // one living enemy, two runtime human-seat actors, and unchanged content/RNG rules.
    let (mut state, revision, _) = natural_coop_state(content.clone(), host)?;
    let run = state.active_run.as_mut().ok_or("run missing")?;
    let final_wave = WaveIndex::new(safe(200))?;
    run.wave = final_wave;
    let battle = run.battle.as_mut().ok_or("battle missing")?;
    battle.wave = final_wave;
    let first_enemy = battle.enemy_party.first().ok_or("enemy missing")?.id;
    for enemy in &mut battle.enemy_party {
        enemy.hp = if enemy.id == first_enemy { 1 } else { 0 };
        enemy.fainted = enemy.id != first_enemy;
    }
    for slot in &mut battle.field.slots {
        if slot.slot.side == er_types::battle_ids::BattleSide::Enemy
            && slot.occupant != Some(first_enemy)
        {
            slot.occupant = None;
        }
    }
    bind_battle_root(&mut state, host)?;
    let (mut authority, mut replica) = pair_from_state(state, revision, content.clone())?;
    press(&mut authority, PhysicalKey::Space)?;
    let first_material = material(&press(&mut authority, PhysicalKey::Space)?)?;
    replica.apply_authority_material(&first_material)?;
    let earlier = replica
        .snapshot()?
        .material_ledger
        .records
        .last()
        .cloned()
        .ok_or("earlier record absent")?;
    assert_eq!(
        replica
            .current_control()
            .and_then(|control| control.owner_seat),
        Some(guest)
    );
    for pending in replica.snapshot()?.pending_presentations {
        replica.settle_presentation(pending.event_id)?;
    }
    press(&mut replica, PhysicalKey::Space)?;
    let terminal_proposal = proposal(&submit_strongest_move(&mut replica, &content)?)?;
    let pending = replica.snapshot()?;
    assert!(matches!(
        pending.current_proposal,
        Some(CurrentProposalOwnerSnapshotV1::Pending { .. })
    ));
    let resolved = authority.ingest_network_frame(generation, &terminal_proposal)?;
    assert!(resolved.effects.iter().any(|effect| matches!(effect,
        GameKernelEffectV7::Terminal(terminal) if terminal.reason == "VICTORY")));
    let receipt_bytes = material(&resolved)?;
    let receipt = CurrentProposalMaterialReceiptV1::decode(&receipt_bytes)?;
    let inner = receipt.evidence()?.material_bytes;
    let terminal_material = GameMaterialV6::decode(&inner)?;
    assert_ne!(
        terminal_material.transition().operation_id,
        earlier.operation_id
    );
    let mut accepted = restore(pending.clone(), content.clone())?;
    accepted.ingest_network_frame(generation, &receipt_bytes)?;
    assert!(accepted.snapshot()?.current_proposal.is_none());
    let accepted_snapshot = accepted.snapshot()?;
    assert_eq!(
        accepted.ingest_network_frame(generation, &receipt_bytes)?,
        GameKernelStepV7::default()
    );
    assert_eq!(accepted.snapshot()?, accepted_snapshot);

    // Raw terminal compatibility delivery during a real disconnect has no exact
    // acceptance authority. The original proposal is conserved as abandoned.
    let mut paused = replica.snapshot()?;
    let mut unrelated_scheduler = live_scheduler(&paused.scheduler)?;
    let _pause =
        unrelated_scheduler.pause_class(guest, TimeClass::HumanInput, "current-owner-unrelated")?;
    paused.scheduler = scheduler_snapshot(&unrelated_scheduler)?;
    paused
        .protocol
        .as_mut()
        .ok_or("protocol missing")?
        .proposal_leases
        .as_mut()
        .ok_or("leases missing")?
        .committed_tombstones
        .push(OperationId::new("historical/inert")?);
    replica = restore(paused, content.clone())?;
    replica.transport_changed(generation, false)?;
    let disconnected = replica.snapshot()?;
    let original_owner = disconnected
        .current_proposal
        .clone()
        .ok_or("owner missing")?;
    let original_protocol = disconnected.protocol.clone();
    let original_pauses = disconnected.scheduler.pauses.clone();
    let terminal_step = replica.apply_authority_material(&inner)?;
    assert!(
        !terminal_step
            .effects
            .iter()
            .any(|effect| matches!(effect, GameKernelEffectV7::Platform(_)))
    );
    let abandoned = replica.snapshot()?;
    assert_eq!(abandoned.protocol, original_protocol);
    assert_eq!(abandoned.scheduler.pauses, original_pauses);
    assert_eq!(
        abandoned.replay_sequence.get(),
        disconnected.replay_sequence.get() + 1
    );
    let Some(CurrentProposalOwnerSnapshotV1::TerminalAbandoned { audit }) =
        &abandoned.current_proposal
    else {
        return Err("terminal raw delivery did not abandon owner".into());
    };
    assert_eq!(&audit.retained, original_owner.retained());
    assert_eq!(audit.terminal_reason, "VICTORY");
    assert_eq!(
        audit.terminal_operation_id,
        terminal_material.transition().operation_id
    );
    assert_eq!(
        audit.terminal_after_digest,
        terminal_material.transition().after_digest
    );
    assert_eq!(
        audit.terminal_authority_revision.get() + 1,
        abandoned.material_ledger.next_authority_revision.get()
    );
    assert_eq!(
        restore(abandoned.clone(), content.clone())?.snapshot()?,
        abandoned
    );
    let mut wrong_anchor = serde_json::to_value(&abandoned)?;
    wrong_anchor["current_proposal"]["audit"]["retained"]["publication_before_digest"] =
        serde_json::json!(format!("blake3-v1:{}", "0".repeat(64)));
    reject_restore(wrong_anchor, content.clone())?;
    assert_eq!(abandoned.material_ledger.records.len(), 2);
    // All four fields describe a REAL earlier record, so mere ledger membership
    // would accept this forgery. It must still fail the terminal-frontier binding.
    let mut older_audit = abandoned.clone();
    let Some(CurrentProposalOwnerSnapshotV1::TerminalAbandoned { audit }) =
        &mut older_audit.current_proposal
    else {
        return Err("audit missing".into());
    };
    audit.terminal_operation_id = earlier.operation_id;
    audit.terminal_material_fingerprint = earlier.material_fingerprint;
    audit.terminal_authority_revision = earlier.authority_revision;
    audit.terminal_after_digest = earlier.after_digest;
    assert!(restore(older_audit, content.clone()).is_err());
    for (field, value) in [
        ("terminal_id", serde_json::json!("wrong-terminal")),
        ("terminal_reason", serde_json::json!("DEFEAT")),
        ("abandonment_replay_sequence", serde_json::json!(0)),
        ("unknown", serde_json::json!(true)),
    ] {
        let mut changed = serde_json::to_value(&abandoned)?;
        changed["current_proposal"]["audit"][field] = value;
        reject_restore(changed, content.clone())?;
    }
    let mut relabeled = serde_json::to_value(&abandoned)?;
    relabeled["current_proposal"] = serde_json::to_value(original_owner)?;
    reject_restore(relabeled, content.clone())?;
    replica = restore(abandoned, content.clone())?;
    reject_ingress(&mut replica, &receipt_bytes)?;
    replica.transport_changed(generation, true)?;
    let reconnected = replica.snapshot()?;
    assert_eq!(
        replica.ingest_network_frame(generation, &receipt_bytes)?,
        GameKernelStepV7::default()
    );
    assert_eq!(
        replica.snapshot()?,
        reconnected,
        "duplicate receipt cannot relabel abandonment as acceptance"
    );
    assert_eq!(replica.state(), authority.state());
    assert_eq!(host, receipt.authority_context.sender_seat_id);
    Ok(())
}
