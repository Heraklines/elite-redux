use std::error::Error;
use std::fs;
use std::path::PathBuf;

use er_kernel::game_kernel_v7::GameKernelRoleV7;
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_protocol::proposal::ProposalLeaseConfig;
use er_protocol::recovery::RecoveryTransactionConfig;
use er_protocol::replica::AuthorityReplicaConfig;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;

use er_types::{
    ConnectionGeneration, FrameContext, MembershipRevision, RunId, SafeU53, SeatId, SessionId,
    TimeClass,
};

fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
    Ok(SafeU53::new(value)?)
}

fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 {
        next_timer_id: Some(SafeU53::ZERO),
        timers: Vec::new(),
        pauses: Vec::new(),
        disposed: false,
    }
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
            highest_wave: WaveIndex::new(safe(1)?)?,
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
        session_id: SessionId::new("m9e-browser-coop-session")?,
        run_id: RunId::new("m9e-browser-coop-run")?,
        session_epoch: safe(1)?,
        seat_map_id: "m9e-browser-coop-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)?),
        sender_seat_id: sender,
        authority_seat_id: authority,
        connection_generation: generation,
    })
}

fn authority_config(
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
                owner_id: "m9e-browser-coop-authority".to_owned(),
                retain_capacity: safe(32)?,
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(1)?,
                    maximum_ms: safe(64)?,
                    factor_numerator: safe(2)?,
                    factor_denominator: safe(1)?,
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(8)?),
            },
            proposal_capacity: safe(64)?,
        },
    })
}

fn replica_config(
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
                owner_prefix: "m9e-browser-coop-proposal".to_owned(),
                retry_initial_ms: safe(1)?,
                retry_maximum_ms: safe(64)?,
                absolute_ceiling_ms: safe(1_200_000)?,
            },
            recovery: RecoveryTransactionConfig {
                local_context: context,
                request_timeout_ms: safe(300_000)?,
                control_timeout_ms: safe(30_000)?,
                pacing_ms: safe(16)?,
                timer_owner_id: "m9e-browser-coop-recovery".to_owned(),
            },
        },
    })
}

use er_web::contracts_v2::{BrowserSessionContextV2, BrowserSessionInitializationV2};

fn main() -> Result<(), Box<dyn Error>> {
    let output = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("output missing")?;
    fs::create_dir_all(&output)?;
    let host = SeatId::new(safe(1)?);
    let guest = SeatId::new(safe(2)?);
    let generation = ConnectionGeneration::new(safe(1)?);
    for is_host in [true, false] {
        let local_seat = if is_host { host } else { guest };
        let config = if is_host {
            authority_config(host, guest, generation)?
        } else {
            replica_config(host, guest, generation)?
        };
        let initialization = BrowserSessionInitializationV2::NaturalCoop {
            context: BrowserSessionContextV2 {
                local_seat,
                role: if is_host {
                    GameKernelRoleV7::Authority
                } else {
                    GameKernelRoleV7::Replica
                },
                scheduler: scheduler(),
                protocol: Some(initial_battle_protocol_snapshot_v2(&config, local_seat)?),
            },
            profile: profile()?,
            seed: "m9e-browser-owned-coop".to_owned(),
            save_slots: vec!["m9e-browser-owned-coop-slot".to_owned()],
            local_is_host: is_host,
        };
        let bytes = er_canonical::canonical_bytes(&initialization)?;
        if bytes.is_empty() || bytes.len() > 65536 {
            return Err("bounded natural initialization required".into());
        }
        fs::write(
            output.join(if is_host {
                "coop-host-initialization.json"
            } else {
                "coop-guest-initialization.json"
            }),
            bytes,
        )?;
    }
    Ok(())
}
