use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{GameMaterialApplyOutcomeV6, GamePlatformEffectV2};
use er_game::m9e_runtime_v6::{
    GameActionDispatchContextV1, GameDomainExecutionInputV1, GameRuntimeV6,
};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_state::m9e_state_v6::{
    GAME_STATE_SCHEMA_VERSION_V6, GameIdentityAllocatorStateV1, GameStateV6,
};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::{
    BootstrapActionV1, GameActionContextV1, GameActionV1, OperationId, SafeU53, SaveActionV1,
    SeatId,
};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn prepared() -> Result<Arc<PreparedGameContentV2>, Box<dyn Error>> {
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

fn context(
    operation: &str,
    revision: u64,
    input: GameDomainExecutionInputV1,
) -> Result<GameActionDispatchContextV1, Box<dyn Error>> {
    Ok(GameActionDispatchContextV1 {
        action: GameActionContextV1 {
            operation_id: OperationId::new(operation)?,
            authority_seat: SeatId::new(safe(1)),
            authority_revision: safe(revision),
            menu_instance: MenuInstanceId::new(safe(1)),
        },
        input,
    })
}

#[test]
fn bootstrap_candidate_is_serialized_and_installed_through_the_common_applier()
-> Result<(), Box<dyn Error>> {
    let content = prepared()?;
    let candidate = state(&content)?;
    let mut authority = GameRuntimeV6::new(None, content.clone(), safe(1))?;
    let prepared = authority.execute(
        GameActionV1::Bootstrap {
            action: BootstrapActionV1::Confirm,
        },
        context(
            "new-run/1",
            1,
            GameDomainExecutionInputV1::BootstrapCandidate(candidate.clone()),
        )?,
    )?;
    assert_eq!(authority.state(), Some(&candidate));
    assert_eq!(prepared.candidate, candidate);

    let mut replica = GameRuntimeV6::new(None, content, safe(1))?;
    assert_eq!(
        replica.apply_material_bytes(&prepared.material_bytes)?,
        GameMaterialApplyOutcomeV6::Applied
    );
    assert_eq!(replica.state(), authority.state());
    assert_eq!(
        replica.apply_material_bytes(&prepared.material_bytes)?,
        GameMaterialApplyOutcomeV6::DuplicateApplied
    );
    Ok(())
}

#[test]
fn save_action_allocates_one_typed_request_and_emits_canonical_save_v2()
-> Result<(), Box<dyn Error>> {
    let content = prepared()?;
    let candidate = state(&content)?;
    let mut runtime = GameRuntimeV6::new(Some(candidate), content, safe(2))?;
    let prepared = runtime.execute(
        GameActionV1::Save {
            action: SaveActionV1::Write {
                slot: "preview-slot".to_owned(),
            },
        },
        context(
            "save/1",
            2,
            GameDomainExecutionInputV1::SaveGeneration(safe(1)),
        )?,
    )?;
    let [
        GamePlatformEffectV2::StorageWrite {
            request,
            slot,
            generation,
            bytes,
        },
    ] = prepared.platform_effects.as_slice()
    else {
        return Err("save did not emit exactly one storage write".into());
    };
    assert_eq!(request.get(), safe(1));
    assert_eq!(slot, "preview-slot");
    assert_eq!(*generation, safe(1));
    let save = GameSaveV2::decode(bytes)?;
    assert_eq!(save.state, prepared.candidate);
    assert_eq!(prepared.mutations.len(), 2);
    Ok(())
}
