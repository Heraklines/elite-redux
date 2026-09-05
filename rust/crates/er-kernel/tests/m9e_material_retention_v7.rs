//! Current V7 material delivery on a controlled fresh quiescent state.
//! No network, proposal-reply recovery or natural-campaign claim.

use std::error::Error;
use std::sync::{Arc, OnceLock};

use er_canonical::content_digest;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2, PresentationCueFamilyV1, PresentationSemanticIdV1};
use er_game::m9e_material_v6::{
    AppliedGameMaterialRecordV1, AppliedMaterialRetentionV1, GameMaterialV6,
    GameMaterialV6Error, GamePlatformEffectV2, GamePresentationEffectV2,
    MAX_APPLIED_MATERIAL_RECORDS_V1, game_state_digest,
};
use er_game::m9e_runtime_v6::{GameActionDispatchContextV1, GameDomainExecutionInputV1, GameRuntimeV6, GameRuntimeV6Error, PreparedGameTransitionV2};
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7, GameKernelV7Error};
use er_kernel::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7, PendingPresentationV3};
use er_state::m7_state::{DexState, ProfileStateV1, ProfileStatistics, PROFILE_STATE_SCHEMA_VERSION_V1};
use er_state::m9e_state_v6::{GameIdentityAllocatorStateV1, GameStateV6, GAME_STATE_SCHEMA_VERSION_V6};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::{GameActionContextV1, GameActionV1, InputFocus, OperationId, PlatformRequestId, PresentationEventId, SafeU53, SaveActionV1, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
const BUNDLE: &[u8] = include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("bounded fixture integer")
}

fn content() -> TestResult<Arc<PreparedGameContentV2>> {
    static CONTENT: OnceLock<Result<Arc<PreparedGameContentV2>, String>> = OnceLock::new();
    CONTENT.get_or_init(|| {
        let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE).map_err(|error| error.to_string())?;
        PreparedGameContentV2::prepare(Arc::new(bundle)).map(Arc::new).map_err(|error| error.to_string())
    }).as_ref().map(Arc::clone).map_err(|error| error.clone().into())
}

fn state(content: &PreparedGameContentV2) -> TestResult<GameStateV6> {
    Ok(GameStateV6 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V6,
        content_identity: content.identity().clone(),
        identities: GameIdentityAllocatorStateV1::derive(None)?,
        profile: ProfileStateV1 {
            schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
            unlocks: Vec::new(), achievements: Vec::new(), challenges: Vec::new(), flags: Default::default(),
            statistics: ProfileStatistics {
                runs_started: SafeU53::ZERO, runs_won: SafeU53::ZERO, runs_lost: SafeU53::ZERO,
                battles_won: SafeU53::ZERO, pokemon_captured: SafeU53::ZERO,
                highest_wave: WaveIndex::new(safe(1))?,
            },
            dex: DexState::default(),
        },
        active_run: None,
    })
}

fn kernel(state: GameStateV6, content: Arc<PreparedGameContentV2>) -> TestResult<GameKernelV7> {
    Ok(GameKernelV7::from_active(state, safe(1), SeatId::new(safe(1)), GameKernelRoleV7::Replica, content,
        InputRouterSnapshotV2 {
            focus: InputFocus::Game, pressed: Vec::new(), suppressed_printable_keys: Vec::new(),
            held_buttons: Vec::new(), locks: Vec::new(), repeats: Vec::new(), disposed: false,
        },
        KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO), timers: Vec::new(), pauses: Vec::new(), disposed: false,
        }, None)? )
}

fn restored(snapshot: &CoreGameKernelSnapshotV7, content: Arc<PreparedGameContentV2>) -> TestResult<GameKernelV7> {
    let decoded = serde_json::from_slice(&serde_json::to_vec(snapshot)?)?;
    Ok(GameKernelV7::from_snapshot(decoded, SeatId::new(safe(1)), GameKernelRoleV7::Replica, content)?)
}

fn next(authority: &mut GameRuntimeV6) -> TestResult<PreparedGameTransitionV2> {
    let revision = authority.next_authority_revision();
    Ok(authority.execute(
        GameActionV1::Save { action: SaveActionV1::Delete { slot: "v7-retention".to_owned() } },
        GameActionDispatchContextV1 {
            action: GameActionContextV1 {
                operation_id: OperationId::new(format!("v7-retention/{}", revision.get()))?,
                authority_seat: SeatId::new(safe(2)), authority_revision: revision,
                menu_instance: MenuInstanceId::new(safe(1)),
            },
            input: GameDomainExecutionInputV1::None, authority: true,
        },
    )?)
}

fn reject_material(kernel: &mut GameKernelV7, bytes: &[u8], expected: GameMaterialV6Error) -> TestResult {
    let before = kernel.snapshot()?;
    let Err(GameKernelV7Error::Runtime(message)) = kernel.apply_authority_material(bytes) else {
        return Err("expected material rejection through actual kernel".into());
    };
    assert_eq!(message, GameRuntimeV6Error::Material(expected.to_string()).to_string());
    assert_eq!(kernel.snapshot()?, before);
    Ok(())
}

#[test]
fn v7_material_rollover_restores_pending_effects_and_continues_exact_snapshots() -> TestResult {
    let content = content()?;
    let initial = state(&content)?;
    let mut authority = GameRuntimeV6::new_with_retention(Some(initial.clone()), Arc::clone(&content), safe(1),
        AppliedMaterialRetentionV1::BoundedSuffix { maximum_records: MAX_APPLIED_MATERIAL_RECORDS_V1 })?;
    let mut live = kernel(initial.clone(), Arc::clone(&content))?;
    let mut expected = live.snapshot()?;
    let mut resumed: Option<GameKernelV7> = None;
    let semantic = PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Save);
    let mapping = content.presentation(semantic).ok_or("save presentation mapping")?;
    let mut first = Vec::new();
    let capacity = MAX_APPLIED_MATERIAL_RECORDS_V1 as u64;
    for revision in 1..=capacity + 2 {
        let material = next(&mut authority)?;
        if revision == 1 { first = material.material_bytes.clone(); }
        let event_id = PresentationEventId::new(safe(revision));
        let presentation = GamePresentationEffectV2 { event_id, semantic, blocking: mapping.blocking, skip: mapping.skip };
        assert_eq!(material.presentation, vec![presentation.clone()]);
        assert_eq!(material.platform_effects, vec![GamePlatformEffectV2::StorageDelete {
            request: PlatformRequestId::new(safe(revision)), slot: "v7-retention".to_owned(),
        }]);
        let expected_step = GameKernelStepV7 { effects: vec![GameKernelEffectV7::Presentation(presentation)], internal_events: Vec::new() };
        assert_eq!(live.apply_authority_material(&material.material_bytes)?, expected_step);
        if let Some(restored) = &mut resumed {
            assert_eq!(restored.apply_authority_material(&material.material_bytes)?, expected_step);
        }
        let mut expected_state = initial.clone();
        expected_state.identities.next_platform_request_id = safe(revision + 1);
        assert_eq!(material.candidate, expected_state);
        expected.material_ledger.records.push(AppliedGameMaterialRecordV1 {
            operation_id: OperationId::new(format!("v7-retention/{revision}"))?,
            material_fingerprint: format!("blake3-v1:{}", content_digest(&material.material_bytes)?),
            authority_revision: safe(revision), after_digest: game_state_digest(&expected_state)?,
        });
        if expected.material_ledger.records.len() > MAX_APPLIED_MATERIAL_RECORDS_V1 {
            expected.material_ledger.records.remove(0);
        }
        expected.material_ledger.next_authority_revision = safe(revision + 1);
        expected.lifecycle = GameKernelLifecycleSnapshotV7::Active(expected_state);
        expected.replay_sequence = safe(2 * revision - 1);
        expected.pending_presentations = vec![PendingPresentationV3 { event_id, semantic, blocking: mapping.blocking, skip: mapping.skip }];
        assert_eq!(live.snapshot()?, expected);
        if revision == capacity {
            resumed = Some(restored(&expected, Arc::clone(&content))?);
            assert_eq!(resumed.as_ref().ok_or("restored kernel")?.snapshot()?, expected);
            // Force failure after common application would retire the first record:
            // the next valid material reuses the still-pending presentation ID.
            let mut preview_authority = authority.clone();
            let mut collision = next(&mut preview_authority)?.material;
            let GameMaterialV6::GameAction(transition) = &mut collision else { return Err("save material variant".into()); };
            transition.presentation[0].event_id = event_id;
            let bytes = collision.canonical_bytes()?;
            assert!(matches!(live.apply_authority_material(&bytes), Err(GameKernelV7Error::Invalid)));
            assert_eq!(live.snapshot()?, expected);
            let restored = resumed.as_mut().ok_or("restored kernel")?;
            assert!(matches!(restored.apply_authority_material(&bytes), Err(GameKernelV7Error::Invalid)));
            assert_eq!(restored.snapshot()?, expected);
        }
        if revision >= capacity {
            assert_eq!(live.apply_authority_material(&material.material_bytes)?, GameKernelStepV7::default());
            assert_eq!(live.snapshot()?, expected);
            let restored = resumed.as_mut().ok_or("restored kernel")?;
            assert_eq!(restored.apply_authority_material(&material.material_bytes)?, GameKernelStepV7::default());
            assert_eq!(restored.snapshot()?, expected);
        }
        live.settle_presentation(event_id)?;
        if let Some(restored) = &mut resumed { restored.settle_presentation(event_id)?; }
        expected.pending_presentations.clear();
        expected.replay_sequence = safe(2 * revision);
        assert_eq!(live.snapshot()?, expected);
        if let Some(restored) = &mut resumed { assert_eq!(restored.snapshot()?, expected); }
        if revision > capacity {
            reject_material(&mut live, &first, GameMaterialV6Error::StaleUnverifiable)?;
            reject_material(resumed.as_mut().ok_or("restored kernel")?, &first, GameMaterialV6Error::StaleUnverifiable)?;
            let mut conflict = material.material.clone();
            let GameMaterialV6::GameAction(transition) = &mut conflict else { return Err("save material variant".into()); };
            transition.accepted_action = Some(GameActionV1::Save { action: SaveActionV1::Delete { slot: "different-slot".to_owned() } });
            let bytes = conflict.canonical_bytes()?;
            reject_material(&mut live, &bytes, GameMaterialV6Error::ConflictingDuplicate)?;
            assert_eq!(live.apply_authority_material(&material.material_bytes)?, GameKernelStepV7::default());
            assert_eq!(live.snapshot()?, expected); // Settled presentation remains absent.
        }
    }
    Ok(())
}

#[test]
fn v7_restore_rejects_historical_gapped_evidence_and_continues_a_valid_suffix() -> TestResult {
    let content = content()?;
    let initial = state(&content)?;
    let mut authority = GameRuntimeV6::new(Some(initial.clone()), Arc::clone(&content), safe(1))?;
    let mut live = kernel(initial, Arc::clone(&content))?;
    for _ in 0..3 {
        let material = next(&mut authority)?;
        live.apply_authority_material(&material.material_bytes)?;
        live.settle_presentation(material.presentation[0].event_id)?;
    }
    let before = live.snapshot()?;
    let mut gap = before.clone();
    gap.material_ledger.records.remove(1);
    gap.material_ledger.validate()?; // Historical ledger schema permits this gap.
    gap.validate(&content)?; // Wire schema is unchanged; current runtime policy rejects it.
    assert!(GameKernelV7::from_snapshot(gap, SeatId::new(safe(1)), GameKernelRoleV7::Replica, Arc::clone(&content)).is_err());
    assert_eq!(live.snapshot()?, before);
    let mut resumed = restored(&before, Arc::clone(&content))?;
    let material = next(&mut authority)?;
    assert_eq!(live.apply_authority_material(&material.material_bytes)?, resumed.apply_authority_material(&material.material_bytes)?);
    assert_eq!(live.snapshot()?, resumed.snapshot()?);
    assert_eq!(live.state(), Some(&material.candidate));
    Ok(())
}
