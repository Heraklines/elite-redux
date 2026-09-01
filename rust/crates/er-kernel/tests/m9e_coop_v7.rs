use std::error::Error;
use std::sync::Arc;

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
use er_state::m9e_state_v6::{
    GAME_STATE_SCHEMA_VERSION_V6, GameIdentityAllocatorStateV1, GameStateV6,
};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::{
    ConnectionGeneration, FrameContext, GAME_ACTION_SCHEMA_VERSION_V1, GameActionContextV1,
    GameActionV1, GameProposalV1, InputFocus, MembershipRevision, OperationId, RunId, SafeU53,
    SaveActionV1, SeatId, SessionId, TimeClass,
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

fn state(content: &PreparedGameContentV2) -> Result<GameStateV6, Box<dyn Error>> {
    Ok(GameStateV6 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V6,
        content_identity: content.identity().clone(),
        identities: GameIdentityAllocatorStateV1::derive(None)?,
        profile: ProfileStateV1 {
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
        },
        active_run: None,
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
    host: SeatId,
    generation: ConnectionGeneration,
    action: GameActionV1,
) -> Result<Vec<u8>, Box<dyn Error>> {
    let value = GameProposalEnvelopeV2 {
        schema_version: 2,
        sender_seat: guest,
        connection_generation: generation,
        proposal: GameProposalV1 {
            schema_version: GAME_ACTION_SCHEMA_VERSION_V1,
            context: GameActionContextV1 {
                operation_id: OperationId::new("save/guest/1")?,
                authority_seat: host,
                authority_revision: safe(1),
                menu_instance: MenuInstanceId::new(safe(1)),
            },
            action,
        },
    };
    Ok(er_canonical::canonical_bytes(&value)?)
}

#[test]
fn authority_admits_once_replica_applies_once_and_generation_is_fenced()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let state = state(&content)?;
    let host = SeatId::new(safe(1));
    let guest = SeatId::new(safe(2));
    let generation = ConnectionGeneration::new(safe(1));
    let authority_protocol =
        initial_battle_protocol_snapshot_v2(&authority_protocol(host, guest, generation)?, host)?;
    let replica_protocol =
        initial_battle_protocol_snapshot_v2(&replica_protocol(host, guest, generation)?, guest)?;
    let mut authority = GameKernelV7::from_active(
        state.clone(),
        safe(1),
        host,
        GameKernelRoleV7::Authority,
        content.clone(),
        input(),
        scheduler(),
        Some(authority_protocol),
    )?;
    let mut replica = GameKernelV7::from_active(
        state,
        safe(1),
        guest,
        GameKernelRoleV7::Replica,
        content.clone(),
        input(),
        scheduler(),
        Some(replica_protocol),
    )?;
    let bytes = envelope(
        guest,
        host,
        generation,
        GameActionV1::Save {
            action: SaveActionV1::Cancel,
        },
    )?;
    let first = authority.admit_game_proposal(&bytes)?;
    let material = first
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .ok_or("authority did not emit material")?;
    replica.apply_authority_material(&material)?;
    assert_eq!(replica.state(), authority.state());
    assert!(authority.admit_game_proposal(&bytes)?.effects.is_empty());

    let snapshot = authority.snapshot()?;
    let mut recovered =
        GameKernelV7::from_snapshot(snapshot, host, GameKernelRoleV7::Authority, content)?;
    assert!(recovered.admit_game_proposal(&bytes)?.effects.is_empty());
    let conflict = envelope(
        guest,
        host,
        generation,
        GameActionV1::Save {
            action: SaveActionV1::Delete {
                slot: "preview-slot".to_owned(),
            },
        },
    )?;
    assert!(authority.admit_game_proposal(&conflict).is_err());
    let stale = envelope(
        guest,
        host,
        ConnectionGeneration::new(safe(2)),
        GameActionV1::Save {
            action: SaveActionV1::Cancel,
        },
    )?;
    assert!(authority.admit_game_proposal(&stale).is_err());
    Ok(())
}
