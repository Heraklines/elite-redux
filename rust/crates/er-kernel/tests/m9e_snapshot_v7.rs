use std::collections::BTreeSet;
use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{
    GameContentBundleV2, PreparedGameContentV2, PresentationSemanticIdV1,
};
use er_game::m9e_material_v6::{
    AppliedGameMaterialLedgerV1, GamePlatformEffectV2, GameTelemetryEventV2,
};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_kernel::snapshot_v6::{
    RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V6, RestorableKernelSnapshotV6,
};
use er_kernel::snapshot_v7::{
    CORE_GAME_KERNEL_SNAPSHOT_SCHEMA_VERSION_V7, CoreGameKernelSnapshotV7,
    GameKernelLifecycleSnapshotV7, PendingPlatformRequestV2, PendingPresentationV3,
};
use er_state::m7_state::{
    DexState, GAME_STATE_SCHEMA_VERSION_V5, GameStateV5, PROFILE_STATE_SCHEMA_VERSION_V1,
    ProfileStateV1, ProfileStatistics,
};
use er_state::m9e_state_v6::{
    GAME_STATE_SCHEMA_VERSION_V6, GameIdentityAllocatorStateV1, GameStateV6,
};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::battle_ui::{PresentationBlockingPolicy, PresentationSkipPolicy};
use er_types::{
    GAME_CONTROL_PLAN_SCHEMA_VERSION_V2, GameContentIdentity, GameControlKindV2, GameControlPlanV2,
    InputFocus, PresentationEventId, SafeU53, TerminalState,
};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn prepared() -> Result<PreparedGameContentV2, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(PreparedGameContentV2::prepare(Arc::new(bundle))?)
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
        next_timer_id: Some(SafeU53::ZERO),
        timers: Vec::new(),
        pauses: Vec::new(),
        disposed: false,
    }
}

fn active_snapshot(
    content: &PreparedGameContentV2,
) -> Result<CoreGameKernelSnapshotV7, Box<dyn Error>> {
    Ok(CoreGameKernelSnapshotV7 {
        schema_version: CORE_GAME_KERNEL_SNAPSHOT_SCHEMA_VERSION_V7,
        lifecycle: GameKernelLifecycleSnapshotV7::Active(state(content)?),
        private_battle_control: None,
        current_proposal: None,
        current_coop_setup: None,
        authority_ai: None,
        input_router: input(),
        scheduler: scheduler(),
        protocol: None,
        next_menu_instance_id: MenuInstanceId::new(safe(1)),
        pending_presentations: Vec::new(),
        pending_platform: Vec::new(),
        storage_frontiers: Vec::new(),
        material_ledger: AppliedGameMaterialLedgerV1::new(safe(1))?,
        replay_sequence: SafeU53::ZERO,
        prepared_transaction: None,
    })
}

#[test]
fn active_snapshot_round_trips_at_a_quiescent_boundary() -> Result<(), Box<dyn Error>> {
    let content = prepared()?;
    let snapshot = active_snapshot(&content)?;
    snapshot.validate(&content)?;
    let bytes = serde_json::to_vec(&snapshot)?;
    let restored: CoreGameKernelSnapshotV7 = serde_json::from_slice(&bytes)?;
    assert_eq!(restored, snapshot);
    restored.validate(&content)?;
    Ok(())
}

#[test]
fn typed_pending_effects_cross_validate_allocator_and_content() -> Result<(), Box<dyn Error>> {
    let content = prepared()?;
    let mut snapshot = active_snapshot(&content)?;
    let state = match &mut snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Active(state) => state,
        _ => return Err("fixture is not active".into()),
    };
    let request = state.identities.allocate_platform_request_id()?;
    snapshot.pending_platform.push(PendingPlatformRequestV2 {
        request_id: request,
        effect: GamePlatformEffectV2::Telemetry {
            request,
            event: GameTelemetryEventV2::ActionApplied,
        },
    });
    let event = PresentationEventId::new(safe(1));
    snapshot.pending_presentations.push(PendingPresentationV3 {
        event_id: event,
        semantic: PresentationSemanticIdV1::Control(GameControlKindV2::Waiting),
        blocking: PresentationBlockingPolicy::NonBlocking,
        skip: PresentationSkipPolicy::Allowed,
    });
    snapshot.validate(&content)?;

    let state = match &mut snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Active(state) => state,
        _ => return Err("fixture is not active".into()),
    };
    state.identities.next_platform_request_id = request.get();
    assert!(snapshot.validate(&content).is_err());
    Ok(())
}

#[test]
fn terminal_lifecycle_requires_complete_control_and_terminal_identity() -> Result<(), Box<dyn Error>>
{
    let content = prepared()?;
    let mut snapshot = active_snapshot(&content)?;
    let state = match snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Active(state) => state,
        _ => return Err("fixture is not active".into()),
    };
    snapshot.lifecycle = GameKernelLifecycleSnapshotV7::Terminal {
        state,
        control: GameControlPlanV2 {
            schema_version: GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
            revision: safe(1),
            kind: GameControlKindV2::Complete,
            owner_seat: None,
            action_context: None,
            menu: None,
            actionable: false,
        },
        terminal: TerminalState {
            terminal_id: "terminal/1".to_owned(),
            reason: "VICTORY".to_owned(),
        },
    };
    snapshot.validate(&content)?;
    let GameKernelLifecycleSnapshotV7::Terminal { terminal, .. } = &mut snapshot.lifecycle else {
        return Err("fixture is not terminal".into());
    };
    terminal.reason.clear();
    assert!(snapshot.validate(&content).is_err());
    Ok(())
}

#[test]
fn quiescent_v6_snapshot_migrates_without_gameplay_side_effects() -> Result<(), Box<dyn Error>> {
    let content = prepared()?;
    let v6_state = state(&content)?;
    let identity = GameContentIdentity {
        oracle_sha: content.identity().oracle_sha.clone(),
        content_hash: content.identity().bundle_hash.clone(),
        battle_content_hash: content.identity().battle_hash.clone(),
        semantic_catalog_hash: content.identity().semantic_catalog_hash.clone(),
    };
    let source = RestorableKernelSnapshotV6 {
        schema_version: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V6,
        content_identity: identity.clone(),
        game_state: GameStateV5 {
            schema_version: GAME_STATE_SCHEMA_VERSION_V5,
            content_identity: identity,
            profile: v6_state.profile,
            active_run: None,
        },
        input_router: input(),
        scheduler: scheduler(),
        protocol: None,
        pending_presentations: Vec::new(),
        prepared_transactions: Vec::new(),
        replay_sequence: safe(7),
        terminal: None,
        pressed_keys: BTreeSet::new(),
    };
    let migrated = CoreGameKernelSnapshotV7::migrate_from_v6(source, &content)?;
    migrated.validate(&content)?;
    assert_eq!(migrated.replay_sequence, safe(7));
    assert!(migrated.material_ledger.records.is_empty());
    assert_eq!(migrated.material_ledger.next_authority_revision, safe(1));
    let GameKernelLifecycleSnapshotV7::Active(state) = migrated.lifecycle else {
        return Err("migrated snapshot is not active".into());
    };
    assert_eq!(&state.content_identity, content.identity());
    assert_eq!(
        state.identities,
        GameIdentityAllocatorStateV1::derive(None)?
    );
    Ok(())
}
