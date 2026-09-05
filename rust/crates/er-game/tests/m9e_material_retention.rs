//! Controlled quiescent save actions exercise real dispatch and common application.
//! This is not a V7 campaign, transport recovery or external storage witness.

use std::error::Error;
use std::sync::{Arc, OnceLock};

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{
    AppliedMaterialRetentionV1, GameMaterialApplyOutcomeV6, GameMaterialV6,
    GameMaterialV6Error, GamePlatformEffectV2, MAX_APPLIED_MATERIAL_RECORDS_V1,
    apply_game_material_v6, apply_game_material_v6_with_retention,
};
use er_game::m9e_runtime_v6::{
    GameActionDispatchContextV1, GameActionDispatcherV1, GameDomainExecutionInputV1,
    GameRuntimeSnapshotV6, GameRuntimeV6, GameRuntimeV6Error, PreparedGameTransitionV2,
};
use er_state::m7_state::{DexState, ProfileStateV1, ProfileStatistics, PROFILE_STATE_SCHEMA_VERSION_V1};
use er_state::m9e_state_v6::{GameIdentityAllocatorStateV1, GameStateV6, GAME_STATE_SCHEMA_VERSION_V6};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::{GameActionContextV1, GameActionV1, OperationId, PlatformRequestId, PresentationEventId, SafeU53, SaveActionV1, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
const BUNDLE: &[u8] = include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("bounded fixture revision")
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

fn action() -> GameActionV1 {
    GameActionV1::Save { action: SaveActionV1::Delete { slot: "retention-slot".to_owned() } }
}

fn context(revision: SafeU53) -> TestResult<GameActionDispatchContextV1> {
    Ok(GameActionDispatchContextV1 {
        action: GameActionContextV1 {
            operation_id: OperationId::new(format!("retention/{}", revision.get()))?,
            authority_seat: SeatId::new(safe(1)), authority_revision: revision,
            menu_instance: MenuInstanceId::new(safe(1)),
        },
        input: GameDomainExecutionInputV1::None,
        authority: true,
    })
}

fn execute(runtime: &mut GameRuntimeV6) -> TestResult<PreparedGameTransitionV2> {
    Ok(runtime.execute(action(), context(runtime.next_authority_revision())?)?)
}

fn assert_rejected_unchanged(
    snapshot: &GameRuntimeSnapshotV6,
    content: &PreparedGameContentV2,
    bytes: &[u8],
    retention: AppliedMaterialRetentionV1,
    expected: GameMaterialV6Error,
) {
    let mut candidate = snapshot.clone();
    assert_eq!(apply_game_material_v6_with_retention(
        &mut candidate.state, &mut candidate.material_ledger, content, bytes, retention,
    ), Err(expected));
    assert_eq!(&candidate, snapshot);
}

fn conflicting(bytes: &[u8]) -> TestResult<Vec<u8>> {
    let mut material = GameMaterialV6::decode(bytes)?;
    let GameMaterialV6::GameAction(transition) = &mut material else { return Err("save material variant".into()); };
    transition.accepted_action = Some(GameActionV1::Save {
        action: SaveActionV1::Delete { slot: "conflicting-slot".to_owned() },
    });
    Ok(material.canonical_bytes()?)
}

#[test]
fn bounded_material_suffix_crosses_three_full_4096_windows_through_dispatch_and_apply() -> TestResult {
    let content = content()?;
    let retention = AppliedMaterialRetentionV1::BoundedSuffix { maximum_records: MAX_APPLIED_MATERIAL_RECORDS_V1 };
    let initial = state(&content)?;
    let mut authority = GameRuntimeV6::new_with_retention(Some(initial.clone()), Arc::clone(&content), safe(1), retention)?;
    let mut replica = authority.clone();
    assert_eq!(replica.material_retention(), retention);
    let count = 3 * MAX_APPLIED_MATERIAL_RECORDS_V1 as u64 + 1;
    let mut first = Vec::new();
    for revision in 1..=count {
        let prepared = execute(&mut authority)?;
        if revision == 1 { first = prepared.material_bytes.clone(); }
        assert_eq!(prepared.platform_effects, vec![GamePlatformEffectV2::StorageDelete {
            request: PlatformRequestId::new(safe(revision)), slot: "retention-slot".to_owned(),
        }]);
        assert_eq!(prepared.presentation.len(), 1);
        assert_eq!(prepared.presentation[0].event_id, PresentationEventId::new(safe(revision)));
        assert_eq!(prepared.next_control.revision, safe(revision + 1));
        assert_eq!(replica.apply_material_bytes(&prepared.material_bytes)?, GameMaterialApplyOutcomeV6::Applied);
        let mut expected = initial.clone();
        expected.identities.next_platform_request_id = safe(revision + 1);
        assert_eq!(authority.state(), Some(&expected));
        assert_eq!(replica.state(), Some(&expected));
        assert_eq!(replica.material_ledger(), authority.material_ledger());
        let ledger = authority.material_ledger();
        assert_eq!(ledger.next_authority_revision, safe(revision + 1));
        assert_eq!(ledger.records.len(), usize::try_from(revision)?.min(MAX_APPLIED_MATERIAL_RECORDS_V1));
        assert_eq!(ledger.records.first().ok_or("suffix start")?.authority_revision,
            safe(revision.saturating_sub(MAX_APPLIED_MATERIAL_RECORDS_V1 as u64 - 1).max(1)));
        if revision.is_multiple_of(MAX_APPLIED_MATERIAL_RECORDS_V1 as u64) {
            let before = authority.snapshot();
            let preview = GameActionDispatcherV1::prepare_with_retention(authority.state(), &content,
                authority.material_ledger(), action(), context(safe(revision + 1))?, retention)?;
            assert_eq!(authority.snapshot(), before);
            let mut resumed = GameRuntimeV6::from_snapshot_with_retention(
                serde_json::from_slice(&serde_json::to_vec(&before)?)?, Arc::clone(&content), retention,
            )?;
            assert_eq!(execute(&mut resumed)?, preview);
            assert_eq!(resumed.next_authority_revision(), safe(revision + 2));
            let mut historical = GameRuntimeV6::from_snapshot(before.clone(), Arc::clone(&content))?;
            assert_eq!(historical.material_retention(), AppliedMaterialRetentionV1::HistoricalHardStop);
            assert_eq!(historical.execute(action(), context(safe(revision + 1))?),
                Err(GameRuntimeV6Error::Material(GameMaterialV6Error::Ledger.to_string())));
            assert_eq!(historical.snapshot(), before);
            let mut legacy_apply = before.clone();
            assert_eq!(apply_game_material_v6(&mut legacy_apply.state, &mut legacy_apply.material_ledger,
                &content, &preview.material_bytes), Err(GameMaterialV6Error::Ledger));
            assert_eq!(legacy_apply, before);
        }
        if revision == count {
            let before = replica.snapshot();
            assert_eq!(replica.apply_material_bytes(&prepared.material_bytes)?, GameMaterialApplyOutcomeV6::DuplicateApplied);
            assert_eq!(replica.snapshot(), before);
            assert_rejected_unchanged(&before, &content, &first, retention, GameMaterialV6Error::StaleUnverifiable);
            assert_rejected_unchanged(&before, &content, &conflicting(&first)?, retention, GameMaterialV6Error::StaleUnverifiable);
        }
    }
    Ok(())
}

#[test]
fn small_suffix_retained_conflicts_late_invalid_and_stale_material_preserve_full_frontier() -> TestResult {
    let content = content()?;
    let retention = AppliedMaterialRetentionV1::BoundedSuffix { maximum_records: 3 };
    let mut runtime = GameRuntimeV6::new_with_retention(Some(state(&content)?), Arc::clone(&content), safe(1), retention)?;
    let mut materials = Vec::new();
    for _ in 0..10 { materials.push(execute(&mut runtime)?.material_bytes); }
    let before = runtime.snapshot();
    assert_eq!(before.material_ledger.records.iter().map(|record| record.authority_revision).collect::<Vec<_>>(), vec![safe(8), safe(9), safe(10)]);
    for bytes in &materials[7..] {
        assert_eq!(runtime.apply_material_bytes(bytes)?, GameMaterialApplyOutcomeV6::DuplicateApplied);
        assert_eq!(runtime.snapshot(), before);
        assert_rejected_unchanged(&before, &content, &conflicting(bytes)?, retention, GameMaterialV6Error::ConflictingDuplicate);
    }
    for bytes in &materials[..7] {
        assert_rejected_unchanged(&before, &content, bytes, retention, GameMaterialV6Error::StaleUnverifiable);
    }
    let mut candidate = runtime.clone();
    let next = execute(&mut candidate)?;
    let mut invalid = next.material.clone();
    let GameMaterialV6::GameAction(transition) = &mut invalid else { return Err("save material variant".into()); };
    transition.before_digest = format!("blake3-v1:{}", "0".repeat(64));
    let bytes = invalid.canonical_bytes()?; // Valid material, wrong live frontier: late admission failure.
    assert_rejected_unchanged(&before, &content, &bytes, retention, GameMaterialV6Error::Frontier);
    assert!(runtime.apply_material_bytes(&bytes).is_err());
    assert_eq!(runtime.snapshot(), before);
    assert_eq!(runtime.apply_material_bytes(&next.material_bytes)?, GameMaterialApplyOutcomeV6::Applied);
    assert_eq!(runtime.snapshot(), candidate.snapshot());
    // A retired operation string can be reused at a new revision; no lifetime-ID promise.
    let mut next_context = context(runtime.next_authority_revision())?;
    next_context.action.operation_id = OperationId::new("retention/1")?;
    runtime.execute(action(), next_context)?;
    assert_eq!(runtime.next_authority_revision(), safe(13));
    assert_rejected_unchanged(&runtime.snapshot(), &content, &materials[0], retention, GameMaterialV6Error::StaleUnverifiable);
    Ok(())
}

#[test]
fn retention_policy_restore_and_revision_exhaustion_reject_without_retirement() -> TestResult {
    let content = content()?;
    for maximum_records in [0, MAX_APPLIED_MATERIAL_RECORDS_V1 + 1] {
        assert_eq!(AppliedMaterialRetentionV1::BoundedSuffix { maximum_records }.validate(), Err(GameMaterialV6Error::Ledger));
    }
    let retention = AppliedMaterialRetentionV1::BoundedSuffix { maximum_records: 2 };
    let mut runtime = GameRuntimeV6::new_with_retention(Some(state(&content)?), Arc::clone(&content),
        safe(SafeU53::MAX.get() - 2), retention)?;
    execute(&mut runtime)?;
    let last = execute(&mut runtime)?;
    let before = runtime.snapshot();
    assert_eq!(before.material_ledger.next_authority_revision, SafeU53::MAX);
    assert!(runtime.execute(action(), context(SafeU53::MAX)?).is_err());
    assert_eq!(runtime.snapshot(), before);
    let mut overflow = last.material.clone();
    let GameMaterialV6::GameAction(transition) = &mut overflow else { return Err("save material variant".into()); };
    transition.authority_revision = SafeU53::MAX;
    let bytes = er_canonical::canonical_bytes(&overflow)?;
    assert_rejected_unchanged(&before, &content, &bytes, retention, GameMaterialV6Error::Revision);
    assert_eq!(runtime.apply_material_bytes(&last.material_bytes)?, GameMaterialApplyOutcomeV6::DuplicateApplied);
    assert_eq!(runtime.snapshot(), before);
    let mut gap = before.clone();
    gap.material_ledger.records[0].authority_revision = safe(SafeU53::MAX.get() - 3);
    gap.material_ledger.validate()?; // Historical shape allows gaps; bounded suffix does not.
    assert_eq!(gap.material_ledger.validate_with_retention(retention), Err(GameMaterialV6Error::Ledger));
    assert!(GameRuntimeV6::from_snapshot_with_retention(gap, Arc::clone(&content), retention).is_err());
    assert!(GameRuntimeV6::from_snapshot_with_retention(before.clone(), Arc::clone(&content),
        AppliedMaterialRetentionV1::BoundedSuffix { maximum_records: 1 }).is_err());
    assert_eq!(runtime.snapshot(), before);
    Ok(())
}
