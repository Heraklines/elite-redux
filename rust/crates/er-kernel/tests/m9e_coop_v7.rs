use std::error::Error;
use std::sync::Arc;

use er_game::m7_progression_control::generic_vertical_control_v2;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelV7, GameProposalEnvelopeV2,
};
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
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
    ConnectionGeneration, FrameContext, GAME_ACTION_SCHEMA_VERSION_V1, GameActionContextV1,
    GameActionV1, GameControlKindV2, GameMenuCancelV2, GameProposalV1, InputFocus,
    MembershipRevision, OperationId, RunId, SafeU53, SaveActionV1, SeatId, SessionId, TimeClass,
};

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
        next_timer_id: None,
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
    let mut kernel = GameKernelV7::natural_start(
        profile()?,
        "m9e-natural-coop".to_owned(),
        host,
        vec!["m9e-coop-slot".to_owned()],
        true,
        content,
        scheduler(),
        None,
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

fn envelope(
    guest: SeatId,
    generation: ConnectionGeneration,
    context: GameActionContextV1,
    action: GameActionV1,
) -> Result<Vec<u8>, Box<dyn Error>> {
    let value = GameProposalEnvelopeV2 {
        schema_version: 2,
        sender_seat: guest,
        connection_generation: generation,
        proposal: GameProposalV1 {
            schema_version: GAME_ACTION_SCHEMA_VERSION_V1,
            context,
            action,
        },
    };
    Ok(er_canonical::canonical_bytes(&value)?)
}

#[test]
fn natural_coop_raw_proposal_converges_and_generation_is_fenced() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let host = SeatId::new(safe(1));
    let guest = SeatId::new(safe(2));
    let generation = ConnectionGeneration::new(safe(1));
    let (mut state, revision, menu_instance) = natural_coop_state(content.clone(), host)?;
    let operation = OperationId::new("save/guest/1")?;
    let mut control = generic_vertical_control_v2(
        menu_instance,
        revision,
        guest,
        operation.clone(),
        GameControlKindV2::Save,
        "m9e/coop/save",
        &[(
            "save/cancel".to_owned(),
            GameActionV1::Save {
                action: SaveActionV1::Cancel,
            },
        )],
        GameMenuCancelV2::Disabled,
    )?;
    let context = control
        .action_context
        .as_mut()
        .ok_or("co-op control context missing")?;
    context.authority_seat = host;
    let proposal_context = context.clone();
    state.active_run.as_mut().ok_or("run missing")?.control = control;
    state
        .validate_with(content.as_ref())
        .map_err(|error| format!("natural co-op state validation failed: {error}"))?;

    let authority_protocol =
        initial_battle_protocol_snapshot_v2(&authority_protocol(host, guest, generation)?, host)
            .map_err(|error| format!("authority protocol initialization failed: {error}"))?;
    let replica_protocol =
        initial_battle_protocol_snapshot_v2(&replica_protocol(host, guest, generation)?, guest)
            .map_err(|error| format!("replica protocol initialization failed: {error}"))?;
    let mut authority = GameKernelV7::from_active(
        state.clone(),
        revision,
        host,
        GameKernelRoleV7::Authority,
        content.clone(),
        input(),
        scheduler(),
        Some(authority_protocol),
    )
    .map_err(|error| format!("authority initialization failed: {error}"))?;
    let mut replica = GameKernelV7::from_active(
        state,
        revision,
        guest,
        GameKernelRoleV7::Replica,
        content.clone(),
        input(),
        scheduler(),
        Some(replica_protocol),
    )
    .map_err(|error| format!("replica initialization failed: {error}"))?;
    let mut forged_context = proposal_context.clone();
    forged_context.operation_id = OperationId::new("save/guest/forged")?;
    let forged = envelope(
        guest,
        generation,
        forged_context,
        GameActionV1::Save {
            action: SaveActionV1::Cancel,
        },
    )?;
    assert!(authority.admit_game_proposal(&forged).is_err());
    let proposal_step = press(&mut replica, PhysicalKey::Space)
        .map_err(|error| format!("guest raw proposal failed: {error}"))?;
    let bytes = proposal_step
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::ProposalReady { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .ok_or("guest raw input did not emit a proposal")?;
    let first = authority
        .admit_game_proposal(&bytes)
        .map_err(|error| format!("authority proposal admission failed: {error}"))?;
    let material = first
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .ok_or("authority did not emit material")?;
    replica
        .apply_authority_material(&material)
        .map_err(|error| format!("replica material apply failed: {error}"))?;
    assert_eq!(replica.state(), authority.state());
    assert_eq!(replica.current_control(), authority.current_control());
    assert!(authority.admit_game_proposal(&bytes)?.effects.is_empty());

    let snapshot = authority.snapshot()?;
    let mut recovered =
        GameKernelV7::from_snapshot(snapshot, host, GameKernelRoleV7::Authority, content)?;
    assert!(recovered.admit_game_proposal(&bytes)?.effects.is_empty());
    let conflict = envelope(
        guest,
        generation,
        proposal_context.clone(),
        GameActionV1::Save {
            action: SaveActionV1::Delete {
                slot: "preview-slot".to_owned(),
            },
        },
    )?;
    assert!(authority.admit_game_proposal(&conflict).is_err());
    let stale = envelope(
        guest,
        ConnectionGeneration::new(safe(2)),
        proposal_context,
        GameActionV1::Save {
            action: SaveActionV1::Cancel,
        },
    )?;
    assert!(authority.admit_game_proposal(&stale).is_err());
    Ok(())
}
