use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{
    APPLIED_MATERIAL_LEDGER_SCHEMA_VERSION_V1, AppliedGameMaterialLedgerV1, GameActionDomainV2,
    GameIdentityDomainV1, GameMaterialApplyOutcomeV6, GameMaterialV6, GameMaterialV6Error,
    GameMutationEvidenceV2, GameMutationKindV2, GamePlatformEffectV2, GameTelemetryEventV2,
    GameTransitionMaterialV6, apply_game_material_v6, empty_game_state_digest, game_state_digest,
};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_state::m9e_state_v6::{
    GAME_STATE_SCHEMA_VERSION_V6, GameIdentityAllocatorStateV1, GameStateV6,
};
use er_types::battle_ids::WaveIndex;
use er_types::{
    BootstrapActionV1, GAME_CONTROL_PLAN_SCHEMA_VERSION_V2, GameActionV1, GameControlKindV2,
    GameControlPlanV2, OperationId, SafeU53, SeatId,
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

fn new_run_material(
    content: &PreparedGameContentV2,
    operation: &str,
    revision: u64,
) -> Result<GameMaterialV6, Box<dyn Error>> {
    let mut after_state = state(content)?;
    let platform_request = after_state.identities.allocate_platform_request_id()?;
    let authority_revision = safe(revision);
    Ok(GameMaterialV6::NewRun(GameTransitionMaterialV6 {
        schema_version: 6,
        domain: GameActionDomainV2::NewRun,
        operation_id: OperationId::new(operation)?,
        authority_seat: SeatId::new(safe(1)),
        authority_revision,
        content_identity: content.identity().clone(),
        accepted_action: Some(GameActionV1::Bootstrap {
            action: BootstrapActionV1::Confirm,
        }),
        before_digest: empty_game_state_digest()?,
        after_digest: game_state_digest(&after_state)?,
        mutations: vec![GameMutationEvidenceV2 {
            ordinal: 0,
            domain: GameActionDomainV2::NewRun,
            kind: GameMutationKindV2::IdentityAllocated {
                domain: GameIdentityDomainV1::PlatformRequest,
                identity: platform_request.get(),
            },
            before_digest: empty_game_state_digest()?,
            after_digest: game_state_digest(&after_state)?,
        }],
        rng_audit: Vec::new(),
        after_state,
        next_control: GameControlPlanV2 {
            schema_version: GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
            revision: safe(revision + 1),
            kind: GameControlKindV2::Title,
            owner_seat: None,
            action_context: None,
            menu: None,
            actionable: false,
        },
        presentation: Vec::new(),
        platform_effects: vec![GamePlatformEffectV2::Telemetry {
            request: platform_request,
            event: GameTelemetryEventV2::RunStarted,
        }],
    }))
}

#[test]
fn common_applier_is_idempotent_conflict_safe_and_snapshot_stable() -> Result<(), Box<dyn Error>> {
    let content = prepared()?;
    let material = new_run_material(&content, "new-run/1", 1)?;
    let bytes = material.canonical_bytes()?;
    let candidate = material.transition().after_state.clone();
    let mut live = None;
    let mut ledger = AppliedGameMaterialLedgerV1::new(safe(1))?;

    assert_eq!(
        apply_game_material_v6(&mut live, &mut ledger, &content, &bytes)?,
        GameMaterialApplyOutcomeV6::Applied
    );
    assert_eq!(live.as_ref(), Some(&candidate));
    assert_eq!(ledger.next_authority_revision, safe(2));
    assert_eq!(ledger.records.len(), 1);
    assert_eq!(
        apply_game_material_v6(&mut live, &mut ledger, &content, &bytes)?,
        GameMaterialApplyOutcomeV6::DuplicateApplied
    );
    assert_eq!(ledger.records.len(), 1);

    let ledger_bytes = serde_json::to_vec(&ledger)?;
    let mut restored: AppliedGameMaterialLedgerV1 = serde_json::from_slice(&ledger_bytes)?;
    assert_eq!(
        restored.schema_version,
        APPLIED_MATERIAL_LEDGER_SCHEMA_VERSION_V1
    );
    assert_eq!(
        apply_game_material_v6(&mut live, &mut restored, &content, &bytes)?,
        GameMaterialApplyOutcomeV6::DuplicateApplied
    );

    let mut conflicting = material;
    let Some(GamePlatformEffectV2::Telemetry { event, .. }) =
        conflicting.transition_mut().platform_effects.first_mut()
    else {
        return Err("fixture platform effect is not telemetry".into());
    };
    *event = GameTelemetryEventV2::ActionApplied;
    let conflicting_bytes = conflicting.canonical_bytes()?;
    assert_eq!(
        apply_game_material_v6(&mut live, &mut restored, &content, &conflicting_bytes),
        Err(GameMaterialV6Error::ConflictingDuplicate)
    );
    Ok(())
}

#[test]
fn material_rejects_variant_domain_revision_and_mutation_gaps() -> Result<(), Box<dyn Error>> {
    let content = prepared()?;
    let base = new_run_material(&content, "new-run/1", 1)?;

    let mismatched = GameMaterialV6::Terminal(base.transition().clone());
    assert_eq!(mismatched.validate(), Err(GameMaterialV6Error::Invalid));

    let mut gapped = base;
    let after_digest = gapped.transition().after_digest.clone();
    gapped
        .transition_mut()
        .mutations
        .push(GameMutationEvidenceV2 {
            ordinal: 2,
            domain: GameActionDomainV2::NewRun,
            kind: GameMutationKindV2::StateChanged,
            before_digest: empty_game_state_digest()?,
            after_digest,
        });
    assert_eq!(gapped.validate(), Err(GameMaterialV6Error::Invalid));
    Ok(())
}

trait TransitionMut {
    fn transition_mut(&mut self) -> &mut GameTransitionMaterialV6;
}

impl TransitionMut for GameMaterialV6 {
    fn transition_mut(&mut self) -> &mut GameTransitionMaterialV6 {
        match self {
            Self::NewRun(value)
            | Self::BattleTurn(value)
            | Self::BattleReplacement(value)
            | Self::GameAction(value)
            | Self::Terminal(value) => value,
        }
    }
}
