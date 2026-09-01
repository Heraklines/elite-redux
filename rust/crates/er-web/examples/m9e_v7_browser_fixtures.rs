use std::error::Error;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, GameKernelV7};
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
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{
    ConnectionGeneration, FrameContext, MembershipRevision, RunId, SafeU53, SeatId, SessionId,
    TimeClass,
};

fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
    Ok(SafeU53::new(value)?)
}

fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 {
        next_timer_id: None,
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

fn navigate(kernel: &mut GameKernelV7, option: &str) -> Result<(), Box<dyn Error>> {
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1)
        .ok_or("menu missing")?;
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

fn main() -> Result<(), Box<dyn Error>> {
    let output = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("output directory argument missing")?;
    fs::create_dir_all(&output)?;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let bytes = fs::read(root.join("fixtures/m9/engineering/game-content-bundle-v2.json"))?;
    let bundle: GameContentBundleV2 = serde_json::from_slice(&bytes)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let host = SeatId::new(safe(1)?);
    let guest = SeatId::new(safe(2)?);
    let generation = ConnectionGeneration::new(safe(1)?);
    let authority_protocol =
        initial_battle_protocol_snapshot_v2(&authority_config(host, guest, generation)?, host)?;
    let replica_protocol =
        initial_battle_protocol_snapshot_v2(&replica_config(host, guest, generation)?, guest)?;
    let cooperative_mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| mode.cooperative && mode.supported)
        .ok_or("cooperative mode missing")?;
    let mut authority = GameKernelV7::natural_start(
        profile()?,
        "m9e-browser-coop".to_owned(),
        host,
        vec!["m9e-browser-coop-slot".to_owned()],
        true,
        content.clone(),
        scheduler(),
        Some(authority_protocol),
    )?;
    press(&mut authority, PhysicalKey::Space)?;
    navigate(
        &mut authority,
        &format!("bootstrap/mode/{}", cooperative_mode.mode.get()),
    )?;
    press(&mut authority, PhysicalKey::Space)?;
    navigate(&mut authority, "bootstrap/challenge/done")?;
    press(&mut authority, PhysicalKey::Space)?;
    press(&mut authority, PhysicalKey::Space)?;
    navigate(&mut authority, "bootstrap/starter/confirm")?;
    press(&mut authority, PhysicalKey::Space)?;
    press(&mut authority, PhysicalKey::Space)?;
    press(&mut authority, PhysicalKey::Space)?;
    press(&mut authority, PhysicalKey::Space)?;
    let authority_snapshot = authority.snapshot()?;
    let state = authority
        .state()
        .cloned()
        .ok_or("authority state missing")?;
    let revision = authority_snapshot.material_ledger.next_authority_revision;
    let replica = GameKernelV7::from_active(
        state,
        revision,
        guest,
        GameKernelRoleV7::Replica,
        content,
        er_kernel::snapshot::InputRouterSnapshotV2 {
            focus: InputFocus::Game,
            pressed: Vec::new(),
            suppressed_printable_keys: Vec::new(),
            held_buttons: Vec::new(),
            locks: Vec::new(),
            repeats: Vec::new(),
            disposed: false,
        },
        scheduler(),
        Some(replica_protocol),
    )?;
    fs::write(
        output.join("coop-authority-snapshot.json"),
        er_canonical::canonical_bytes(&authority_snapshot)?,
    )?;
    fs::write(
        output.join("coop-replica-snapshot.json"),
        er_canonical::canonical_bytes(&replica.snapshot()?)?,
    )?;
    Ok(())
}
