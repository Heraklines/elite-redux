use std::error::Error;
use std::sync::Arc;

use er_game::m7_progression_control::generic_vertical_control_v2;
use er_game::m9e_content_v2::{
    GameContentBundleV2, PreparedGameContentV2, PresentationCueFamilyV1, PresentationSemanticIdV1,
};
use er_game::m9e_material_v6::{GameMaterialV6, GamePlatformEffectV2, GamePresentationEffectV2};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7, GameKernelV7Error,
    GameProposalEnvelopeV2,
};
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_kernel::snapshot_v7::{PendingPlatformRequestV2, PendingPresentationV3};
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
    MembershipRevision, OperationId, PresentationEventId, RunId, SafeU53, SaveActionV1, SeatId,
    SessionId, TimeClass,
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

#[test]
fn coop_waits_for_all_human_commands() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let host = SeatId::new(safe(1));
    let guest = SeatId::new(safe(2));
    let generation = ConnectionGeneration::new(safe(1));
    let authority_protocol =
        initial_battle_protocol_snapshot_v2(&authority_protocol(host, guest, generation)?, host)?;
    let replica_protocol =
        initial_battle_protocol_snapshot_v2(&replica_protocol(host, guest, generation)?, guest)?;
    let cooperative_mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| mode.cooperative && mode.supported)
        .ok_or("supported cooperative mode missing")?;
    let mut authority = GameKernelV7::natural_start(
        profile()?,
        "m9e-two-human-battle".to_owned(),
        host,
        vec!["m9e-coop-slot".to_owned()],
        true,
        content.clone(),
        scheduler(),
        Some(authority_protocol),
    )?;
    press(&mut authority, PhysicalKey::Space)?;
    navigate_down_to(
        &mut authority,
        &format!("bootstrap/mode/{}", cooperative_mode.mode.get()),
    )?;
    press(&mut authority, PhysicalKey::Space)?;
    navigate_down_to(&mut authority, "bootstrap/challenge/done")?;
    press(&mut authority, PhysicalKey::Space)?;
    press(&mut authority, PhysicalKey::Space)?;
    navigate_down_to(&mut authority, "bootstrap/starter/confirm")?;
    press(&mut authority, PhysicalKey::Space)?;
    press(&mut authority, PhysicalKey::Space)?;
    press(&mut authority, PhysicalKey::Space)?;
    press(&mut authority, PhysicalKey::Space)?;

    let initial_state = authority
        .state()
        .cloned()
        .ok_or("authority state missing")?;
    let initial_battle = initial_state
        .active_run
        .as_ref()
        .and_then(|run| run.battle.as_ref())
        .ok_or("cooperative battle missing")?;
    assert_eq!(initial_battle.format.player_capacity, 2);
    assert_eq!(initial_battle.format.enemy_capacity, 2);
    let initial_turn = initial_battle.turn;
    let revision = authority
        .snapshot()?
        .material_ledger
        .next_authority_revision;
    let mut replica = GameKernelV7::from_active(
        initial_state,
        revision,
        guest,
        GameKernelRoleV7::Replica,
        content.clone(),
        input(),
        scheduler(),
        Some(replica_protocol),
    )?;

    let shared_host_root = authority
        .current_control()
        .cloned()
        .ok_or("host root missing")?;
    // Local guest leaves must retain the exact host-owned canonical root.
    for _ in 0..3 {
        press(&mut replica, PhysicalKey::Space)?;
        let private = replica.snapshot()?;
        let owner = private
            .private_battle_control
            .as_ref()
            .ok_or("private owner missing")?;
        assert_eq!(owner.owner_seat, guest);
        assert_eq!(owner.canonical_control, shared_host_root);
        assert_eq!(owner.canonical_control.owner_seat, Some(host));
        press(&mut replica, PhysicalKey::Escape)?;
        assert_eq!(replica.current_control(), Some(&shared_host_root));
    }
    press(&mut replica, PhysicalKey::Space)?;
    for _ in 0..3 {
        press(&mut authority, PhysicalKey::Space)?;
        press(&mut authority, PhysicalKey::Escape)?;
        assert_eq!(authority.current_control(), Some(&shared_host_root));
    }
    press(&mut authority, PhysicalKey::Space)
        .map_err(|error| format!("host Fight navigation failed: {error}"))?;
    let retained = press(&mut authority, PhysicalKey::Space)
        .map_err(|error| format!("host command retention failed: {error}"))?;
    let retained_material = retained
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(retained_material.len(), 1);
    let retained_battle = authority
        .state()
        .and_then(|state| state.active_run.as_ref())
        .and_then(|run| run.battle.as_ref())
        .ok_or("retained battle missing")?;
    assert_eq!(retained_battle.turn, initial_turn);
    assert_eq!(retained_battle.command_state.frontier.len(), 1);
    assert_eq!(
        authority
            .current_control()
            .and_then(|control| control.owner_seat),
        Some(guest)
    );
    let retained_delivery = replica
        .apply_authority_material(&retained_material[0])
        .map_err(|error| format!("retention replica apply failed: {error}"))?;
    assert_eq!(replica.state(), authority.state());
    let pending_delivery = replica.snapshot()?;
    assert!(pending_delivery.private_battle_control.is_none());
    assert_eq!(
        replica.apply_authority_material(&retained_material[0])?,
        GameKernelStepV7::default()
    );
    assert_eq!(replica.snapshot()?, pending_delivery);
    for effect in retained_delivery.effects {
        if let GameKernelEffectV7::Presentation(presentation) = effect {
            replica.settle_presentation(presentation.event_id)?;
        }
    }

    press(&mut replica, PhysicalKey::Space)
        .map_err(|error| format!("guest Fight navigation failed: {error}"))?;
    assert_eq!(
        replica.current_control().map(|control| control.kind),
        Some(GameControlKindV2::BattleMove)
    );
    let private_move_menu = replica.snapshot()?;
    let encoded_private = serde_json::to_vec(&private_move_menu)?;
    let mut continued = GameKernelV7::from_snapshot(
        serde_json::from_slice(&encoded_private)?,
        guest,
        GameKernelRoleV7::Replica,
        content.clone(),
    )?;
    assert_eq!(continued.snapshot()?, private_move_menu);
    let mut missing_owner = private_move_menu.clone();
    missing_owner.private_battle_control = None;
    assert!(
        GameKernelV7::from_snapshot(
            missing_owner,
            guest,
            GameKernelRoleV7::Replica,
            content.clone()
        )
        .is_err()
    );
    let mut wrong_context = private_move_menu.clone();
    wrong_context
        .private_battle_control
        .as_mut()
        .ok_or("owner missing")?
        .canonical_control
        .action_context
        .as_mut()
        .ok_or("context missing")?
        .authority_revision = safe(1);
    assert!(
        GameKernelV7::from_snapshot(
            wrong_context,
            guest,
            GameKernelRoleV7::Replica,
            content.clone()
        )
        .is_err()
    );
    let mut wrong_owner = private_move_menu.clone();
    wrong_owner
        .private_battle_control
        .as_mut()
        .ok_or("owner missing")?
        .owner_seat = host;
    assert!(
        GameKernelV7::from_snapshot(
            wrong_owner,
            guest,
            GameKernelRoleV7::Replica,
            content.clone()
        )
        .is_err()
    );
    let mut wrong_canonical_selection = private_move_menu.clone();
    let canonical_menu = wrong_canonical_selection
        .private_battle_control
        .as_mut()
        .ok_or("owner missing")?
        .canonical_control
        .menu
        .as_mut()
        .ok_or("canonical menu missing")?;
    canonical_menu.selected_option_id = canonical_menu
        .options
        .iter()
        .find(|option| option.option_id != canonical_menu.selected_option_id)
        .ok_or("alternative canonical option missing")?
        .option_id
        .clone();
    assert!(
        GameKernelV7::from_snapshot(
            wrong_canonical_selection,
            guest,
            GameKernelRoleV7::Replica,
            content.clone()
        )
        .is_err()
    );
    for _ in 0..3 {
        assert_eq!(
            press(&mut replica, PhysicalKey::Escape)?,
            press(&mut continued, PhysicalKey::Escape)?
        );
        assert_eq!(
            press(&mut replica, PhysicalKey::Space)?,
            press(&mut continued, PhysicalKey::Space)?
        );
        assert_eq!(replica.snapshot()?, continued.snapshot()?);
    }
    let private_move_menu = replica.snapshot()?;
    assert_eq!(
        replica.apply_authority_material(&retained_material[0])?,
        GameKernelStepV7::default()
    );
    assert_eq!(replica.snapshot()?, private_move_menu);
    let proposal_step = press(&mut replica, PhysicalKey::Space)
        .map_err(|error| format!("guest proposal failed: {error}"))?;
    assert_eq!(proposal_step, press(&mut continued, PhysicalKey::Space)?);
    assert_eq!(replica.snapshot()?, continued.snapshot()?);
    let proposal = proposal_step
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::ProposalReady { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .ok_or("guest command proposal missing")?;
    let resolved = authority
        .admit_game_proposal(&proposal)
        .map_err(|error| format!("guest command admission failed: {error}"))?;
    let turn_material = resolved
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(turn_material.len(), 1);
    let presentation = resolved
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::Presentation(presentation) => Some(presentation),
            _ => None,
        })
        .ok_or("resolved turn presentation missing")?;
    let mut collision_snapshot = replica.snapshot()?;
    collision_snapshot
        .pending_presentations
        .push(PendingPresentationV3 {
            event_id: presentation.event_id,
            semantic: presentation.semantic,
            blocking: presentation.blocking,
            skip: presentation.skip,
        });
    collision_snapshot
        .pending_presentations
        .sort_by_key(|pending| pending.event_id);
    let mut collision = GameKernelV7::from_snapshot(
        collision_snapshot.clone(),
        guest,
        GameKernelRoleV7::Replica,
        content.clone(),
    )?;
    assert_eq!(
        collision.apply_authority_material(&turn_material[0]),
        Err(GameKernelV7Error::Invalid)
    );
    assert_eq!(collision.snapshot()?, collision_snapshot);
    let resolved_turn = authority
        .state()
        .and_then(|state| state.active_run.as_ref())
        .and_then(|run| run.battle.as_ref())
        .map(|battle| battle.turn)
        .ok_or("resolved battle missing")?;
    assert!(resolved_turn > initial_turn);
    replica.apply_authority_material(&turn_material[0])?;
    assert_eq!(replica.state(), authority.state());
    assert_eq!(replica.current_control(), authority.current_control());
    assert!(authority.admit_game_proposal(&proposal)?.effects.is_empty());
    Ok(())
}

#[test]
fn replica_delivers_save_presentation_once_without_repeating_authority_storage()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let host = SeatId::new(safe(1));
    let guest = SeatId::new(safe(2));
    let generation = ConnectionGeneration::new(safe(1));
    let (mut state, revision, menu_instance) = natural_coop_state(content.clone(), host)?;
    // The run is natural; the Save menu is an explicit controlled action seam.
    let mut control = generic_vertical_control_v2(
        menu_instance,
        revision,
        guest,
        OperationId::new("save/guest/presentation")?,
        GameControlKindV2::Save,
        "m9e/coop/save-presentation",
        &[(
            "save/write".to_owned(),
            GameActionV1::Save {
                action: SaveActionV1::Write {
                    slot: "preview-slot".to_owned(),
                },
            },
        )],
        GameMenuCancelV2::Disabled,
    )?;
    control
        .action_context
        .as_mut()
        .ok_or("save context missing")?
        .authority_seat = host;
    state.active_run.as_mut().ok_or("run missing")?.control = control;
    state.validate_with(content.as_ref())?;
    let mut authority = GameKernelV7::from_active(
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
    let mut replica = GameKernelV7::from_active(
        state,
        revision,
        guest,
        GameKernelRoleV7::Replica,
        content.clone(),
        input(),
        scheduler(),
        Some(initial_battle_protocol_snapshot_v2(
            &replica_protocol(host, guest, generation)?,
            guest,
        )?),
    )?;
    let proposal_step = press(&mut replica, PhysicalKey::Space)?;
    let proposal = proposal_step
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::ProposalReady { bytes, .. } => Some(bytes),
            _ => None,
        })
        .ok_or("guest Save proposal missing")?;
    let before_delivery = replica.snapshot()?;
    let before_admission = authority.snapshot()?;
    let mut exhausted_snapshot = before_admission.clone();
    exhausted_snapshot.replay_sequence = SafeU53::MAX;
    let mut exhausted = GameKernelV7::from_snapshot(
        exhausted_snapshot.clone(),
        host,
        GameKernelRoleV7::Authority,
        content.clone(),
    )?;
    assert_eq!(
        exhausted.admit_game_proposal(proposal),
        Err(GameKernelV7Error::Invalid),
        "valid Save admission reaches the exhausted replay sequence after preparing effects"
    );
    assert_eq!(
        exhausted.snapshot()?,
        exhausted_snapshot,
        "late admission rejection must retain state, effects, private control and protocol"
    );
    let authority_step = authority.admit_game_proposal(proposal)?;
    let material = authority_step
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes),
            _ => None,
        })
        .ok_or("Save material missing")?;
    let decoded = GameMaterialV6::decode(material)?;

    let semantic = PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Save);
    let mapping = content
        .presentation(semantic)
        .ok_or("Save presentation mapping missing")?;
    let expected_presentation = GamePresentationEffectV2 {
        event_id: PresentationEventId::new(revision),
        semantic,
        blocking: mapping.blocking,
        skip: mapping.skip,
    };
    let authority_presentations: Vec<_> = authority_step
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::Presentation(presentation) => Some(presentation.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(
        authority_presentations.as_slice(),
        std::slice::from_ref(&expected_presentation)
    );
    assert_eq!(decoded.transition().presentation, authority_presentations);
    let platforms: Vec<_> = authority_step
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::Platform(platform) => Some(platform.clone()),
            _ => None,
        })
        .collect();
    let [
        GamePlatformEffectV2::StorageWrite {
            request,
            slot,
            generation,
            bytes,
        },
    ] = platforms.as_slice()
    else {
        return Err("Save must issue exactly one authority StorageWrite".into());
    };
    assert_eq!(slot, "preview-slot");
    assert_eq!(*generation, safe(1));
    assert!(!bytes.is_empty());
    assert_eq!(decoded.transition().platform_effects, platforms);
    let authority_snapshot = authority.snapshot()?;
    assert_eq!(
        authority_snapshot.pending_platform,
        [PendingPlatformRequestV2 {
            request_id: *request,
            effect: platforms[0].clone(),
        }]
    );
    let pending = PendingPresentationV3 {
        event_id: expected_presentation.event_id,
        semantic: expected_presentation.semantic,
        blocking: expected_presentation.blocking,
        skip: expected_presentation.skip,
    };
    assert_eq!(
        authority_snapshot.pending_presentations.as_slice(),
        std::slice::from_ref(&pending)
    );

    // In this controlled fixture, correct only the exhausted replay frontier.
    // The same real guest proposal must still be available for admission.
    let mut corrected_snapshot = exhausted.snapshot()?;
    corrected_snapshot.replay_sequence = before_admission.replay_sequence;
    assert_eq!(corrected_snapshot, before_admission);
    let mut corrected = GameKernelV7::from_snapshot(
        corrected_snapshot,
        host,
        GameKernelRoleV7::Authority,
        content.clone(),
    )?;
    assert_eq!(corrected.admit_game_proposal(proposal)?, authority_step);
    assert_eq!(corrected.snapshot()?, authority_snapshot);

    // Exact duplicates remain preflight no-ops even when a new admission's
    // replay increment would fail. They must not advance the replay sequence
    // or reinstall effects.
    let mut duplicate_snapshot = authority_snapshot.clone();
    duplicate_snapshot.replay_sequence = SafeU53::MAX;
    let mut duplicate = GameKernelV7::from_snapshot(
        duplicate_snapshot.clone(),
        host,
        GameKernelRoleV7::Authority,
        content.clone(),
    )?;
    assert_eq!(
        duplicate.admit_game_proposal(proposal)?,
        GameKernelStepV7::default()
    );
    assert_eq!(duplicate.snapshot()?, duplicate_snapshot);

    // This is a valid pre-delivery snapshot. The collision is detected only
    // when presentation ownership is installed after common material apply.
    let mut collision_snapshot = before_delivery.clone();
    collision_snapshot
        .pending_presentations
        .push(pending.clone());
    let mut collision = GameKernelV7::from_snapshot(
        collision_snapshot.clone(),
        guest,
        GameKernelRoleV7::Replica,
        content,
    )?;
    assert_eq!(
        collision.apply_authority_material(material),
        Err(GameKernelV7Error::Invalid),
        "replica material must claim pending presentation ownership"
    );
    assert_eq!(collision.snapshot()?, collision_snapshot);

    let delivered = replica.apply_authority_material(material)?;
    assert_eq!(
        delivered,
        GameKernelStepV7 {
            effects: vec![
                GameKernelEffectV7::Presentation(expected_presentation.clone()),
                GameKernelEffectV7::UiChanged(
                    authority
                        .current_control()
                        .cloned()
                        .ok_or("authority control missing")?
                ),
            ],
            internal_events: Vec::new(),
        }
    );
    assert_eq!(replica.state(), authority.state());
    assert_eq!(replica.current_control(), authority.current_control());
    let delivered_snapshot = replica.snapshot()?;
    assert_eq!(delivered_snapshot.pending_presentations, [pending]);
    assert!(delivered_snapshot.pending_platform.is_empty());
    assert_eq!(
        delivered_snapshot.storage_frontiers,
        before_delivery.storage_frontiers
    );
    assert_eq!(
        replica.apply_authority_material(material)?,
        GameKernelStepV7::default()
    );
    assert_eq!(replica.snapshot()?, delivered_snapshot);

    replica.settle_presentation(expected_presentation.event_id)?;
    let settled = replica.snapshot()?;
    assert!(settled.pending_presentations.is_empty());
    assert_eq!(
        replica.apply_authority_material(material)?,
        GameKernelStepV7::default()
    );
    assert_eq!(replica.snapshot()?, settled);
    assert!(authority.admit_game_proposal(proposal)?.effects.is_empty());
    assert_eq!(authority.snapshot()?, authority_snapshot);
    Ok(())
}

#[test]
fn private_party_reopens_restore_exact_root_and_apply_canonical_material()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let host = SeatId::new(safe(1));
    let guest = SeatId::new(safe(2));
    let generation = ConnectionGeneration::new(safe(1));
    let (mut state, revision, _) = natural_coop_state(content.clone(), host)?;
    er_game::m9e_new_run_v6::expand_cooperative_topology_v6(&mut state, content.as_ref(), guest)?;
    // Natural startup plus explicit legal bench fixtures for both Party menus.
    for seat in [host, guest] {
        let id = state.identities.allocate_pokemon_id()?;
        let run = state.active_run.as_mut().ok_or("run missing")?;
        let mut bench = run
            .party
            .iter()
            .find(|pokemon| pokemon.owner_seat == Some(seat))
            .ok_or("seat actor missing")?
            .clone();
        bench.id = id;
        run.party.push(bench);
    }
    state.validate_with(content.as_ref())?;
    let canonical_digest = er_game::m9e_material_v6::game_state_digest(&state)?;
    let canonical_root = state
        .active_run
        .as_ref()
        .ok_or("run missing")?
        .control
        .clone();
    let mut authority = GameKernelV7::from_active(
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
    let mut replica = GameKernelV7::from_active(
        state,
        revision,
        guest,
        GameKernelRoleV7::Replica,
        content.clone(),
        input(),
        scheduler(),
        Some(initial_battle_protocol_snapshot_v2(
            &replica_protocol(host, guest, generation)?,
            guest,
        )?),
    )?;
    for kernel in [&mut authority, &mut replica] {
        navigate_down_to(kernel, "battle/command/party")?;
        let selected_root = kernel.current_control().cloned().ok_or("root missing")?;
        assert_eq!(
            selected_root
                .menu
                .as_ref()
                .ok_or("menu missing")?
                .selected_option_id
                .as_str(),
            "battle/command/party"
        );
        for _ in 0..3 {
            press(kernel, PhysicalKey::Space)?;
            assert_eq!(
                kernel.current_control().map(|control| control.kind),
                Some(GameControlKindV2::BattleSwitch)
            );
            let snapshot = kernel.snapshot()?;
            let owner = snapshot
                .private_battle_control
                .as_ref()
                .ok_or("owner missing")?;
            assert_eq!(owner.canonical_control, canonical_root);
            assert_eq!(owner.return_control, selected_root);
            press(kernel, PhysicalKey::Escape)?;
            assert_eq!(kernel.current_control(), Some(&selected_root));
        }
        press(kernel, PhysicalKey::Space)?;
    }
    let private_authority = authority.snapshot()?;
    let mut restored = GameKernelV7::from_snapshot(
        serde_json::from_slice(&serde_json::to_vec(&private_authority)?)?,
        host,
        GameKernelRoleV7::Authority,
        content.clone(),
    )?;
    assert_eq!(restored.snapshot()?, private_authority);
    let applied = press(&mut authority, PhysicalKey::Space)?;
    assert_eq!(applied, press(&mut restored, PhysicalKey::Space)?);
    assert_eq!(authority.snapshot()?, restored.snapshot()?);
    let material = applied
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes),
            _ => None,
        })
        .ok_or("Party command retention material missing")?;
    assert_eq!(
        GameMaterialV6::decode(material)?.transition().before_digest,
        canonical_digest
    );
    replica.apply_authority_material(material)?;
    assert_eq!(replica.state(), authority.state());
    let pending = replica.snapshot()?;
    assert!(pending.private_battle_control.is_none());
    assert_eq!(
        replica.apply_authority_material(material)?,
        GameKernelStepV7::default()
    );
    assert_eq!(replica.snapshot()?, pending);
    for presentation in pending.pending_presentations {
        replica.settle_presentation(presentation.event_id)?;
    }
    let canonical_snapshot = replica.snapshot()?;
    assert!(canonical_snapshot.private_battle_control.is_none());
    assert_eq!(
        GameKernelV7::from_snapshot(
            canonical_snapshot.clone(),
            guest,
            GameKernelRoleV7::Replica,
            content.clone()
        )?
        .snapshot()?,
        canonical_snapshot
    );
    navigate_down_to(&mut replica, "battle/command/party")?;
    let mut stripped_root = replica.snapshot()?;
    assert!(stripped_root.private_battle_control.is_some());
    stripped_root.private_battle_control = None;
    assert!(
        GameKernelV7::from_snapshot(
            stripped_root,
            guest,
            GameKernelRoleV7::Replica,
            content.clone()
        )
        .is_err()
    );
    press(&mut replica, PhysicalKey::Space)?;
    let settled_private = replica.snapshot()?;
    assert_eq!(
        replica.apply_authority_material(material)?,
        GameKernelStepV7::default()
    );
    assert_eq!(replica.snapshot()?, settled_private);
    Ok(())
}
