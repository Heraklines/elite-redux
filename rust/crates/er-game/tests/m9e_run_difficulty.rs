//! Actual completed bootstrap choices retained across canonical runtime boundaries.
use std::error::Error;
use std::sync::{Arc, OnceLock};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{GameMaterialApplyOutcomeV6, GameMaterialV6, game_state_digest};
use er_game::m9e_new_run_v6::construct_natural_run_v6;
use er_game::m9e_runtime_v6::{GameActionDispatchContextV1, GameDomainExecutionInputV1, GameRuntimeV6};
use er_game::m72_bootstrap::{BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapMachineV1, RunBootstrapStageV1};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::{DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics};
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ids::{MenuInstanceId, PokemonId, WaveIndex};
use er_types::{BootstrapActionV1, GameActionContextV1, GameActionV1, OperationId, RunDifficultyV1, SafeU53, SaveActionV1, SeatId, StarterSelectionV1};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn content() -> TestResult<Arc<PreparedGameContentV2>> {
    static CONTENT: OnceLock<Result<Arc<PreparedGameContentV2>, String>> = OnceLock::new();
    CONTENT
        .get_or_init(|| {
            let bundle: GameContentBundleV2 =
                serde_json::from_slice(BUNDLE).map_err(|error| error.to_string())?;
            PreparedGameContentV2::prepare(Arc::new(bundle))
                .map(Arc::new)
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .cloned()
        .map_err(|error| error.clone().into())
}

fn bootstrap(content: &PreparedGameContentV2, difficulty: RunDifficultyV1) -> TestResult<RunBootstrapMachineV1> {
    let owner = SeatId::new(safe(1)?);
    let profile = ProfileStateV1 {
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
    };
    let starters = content
        .bundle()
        .bootstrap
        .starters
        .iter()
        .enumerate()
        .map(|(index, starter)| {
            Ok(StarterSelectionV1 {
                pokemon_id: PokemonId::new(safe(u64::try_from(index)? + 1)?),
                species_id: starter.species_id.get(),
                form_index: starter.form_index,
                ability_index: starter.ability_index,
                cost: starter.cost,
                owner_seat: owner,
            })
        })
        .collect::<TestResult<Vec<_>>>()?;
    let first = starters.first().ok_or("starter required")?.clone();
    let second = starters
        .iter()
        .find(|candidate| {
            candidate.species_id != first.species_id
                && u32::from(candidate.cost) + u32::from(first.cost)
                    <= u32::from(content.bundle().bootstrap.maximum_starter_cost)
        })
        .ok_or("second legal natural starter required")?
        .clone();
    let catalog = BootstrapCatalogV1 {
        modes: content
            .bundle()
            .bootstrap
            .modes
            .iter()
            .map(|mode| BootstrapModePolicyV1 {
                mode: mode.mode,
                challenge_selection: mode.challenge_selection,
                cooperative: mode.cooperative,
                supported: mode.supported,
            })
            .collect(),
        challenges: content
            .bundle()
            .bootstrap
            .choices
            .iter()
            .flat_map(|choice| {
                choice
                    .values
                    .iter()
                    .cloned()
                    .map(|value| (choice.id.clone(), value))
            })
            .collect(),
        starters,
        save_slots: vec!["observation".to_owned()],
        automatic_coop_save_slot: None,
        maximum_starter_cost: content.bundle().bootstrap.maximum_starter_cost,
        maximum_starters: content.bundle().bootstrap.maximum_starters,
        local_is_host: true,
        developer_mode: false,
    };
    let mut bootstrap =
        RunBootstrapMachineV1::new(profile, "m9e-natural-run".to_owned(), owner, catalog)?;
    let mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| mode.supported && !mode.cooperative && !mode.challenge_selection)
        .ok_or("solo mode required")?
        .mode;
    assert_eq!(bootstrap.stage, RunBootstrapStageV1::Title);
    for action in [
        BootstrapActionV1::OpenNewGame,
        BootstrapActionV1::SelectMode(mode),
        BootstrapActionV1::SelectStarter(first),
        BootstrapActionV1::SelectStarter(second),
        BootstrapActionV1::ConfirmStarters,
        BootstrapActionV1::Confirm,
        BootstrapActionV1::SelectDifficulty(difficulty),
        BootstrapActionV1::SelectSaveSlot("observation".to_owned()),
    ] {
        bootstrap.apply_game_action(GameActionV1::Bootstrap { action })?;
        bootstrap.validate()?;
    }
    assert_eq!(bootstrap.stage, RunBootstrapStageV1::Complete);
    Ok(bootstrap)
}

fn context(revision: u64, input: GameDomainExecutionInputV1) -> TestResult<GameActionDispatchContextV1> {
    Ok(GameActionDispatchContextV1 {
        action: GameActionContextV1 {
            operation_id: OperationId::new(format!("difficulty/{revision}"))?,
            authority_seat: SeatId::new(safe(1)?),
            authority_revision: safe(revision)?,
            menu_instance: MenuInstanceId::new(safe(1)?),
        },
        input,
        authority: true,
    })
}

#[test]
fn natural_choices_survive_material_save_restore_and_continued_dispatch() -> TestResult {
    let content = content()?;
    for difficulty in [RunDifficultyV1::Youngster, RunDifficultyV1::Ace, RunDifficultyV1::Elite, RunDifficultyV1::Hell] {
        let setup = bootstrap(&content, difficulty)?;
        let candidate = construct_natural_run_v6(&setup, &content, safe(1)?)?;
        let owner = candidate.current_run_difficulty.ok_or("difficulty owner")?;
        assert_eq!(owner.difficulty, difficulty);
        assert_eq!(owner.run_id, candidate.active_run.as_ref().ok_or("run")?.run_id);
        let mut authority = GameRuntimeV6::new(None, content.clone(), safe(1)?)?;
        let first = authority.execute(
            GameActionV1::Bootstrap { action: BootstrapActionV1::Confirm },
            context(1, GameDomainExecutionInputV1::BootstrapCandidate(candidate))?,
        )?;
        let mut replica = GameRuntimeV6::new(None, content.clone(), safe(1)?)?;
        assert_eq!(replica.apply_material_bytes(&first.material_bytes)?, GameMaterialApplyOutcomeV6::Applied);
        assert_eq!(replica.state(), authority.state());
        let save = GameSaveV2::new(content.identity().clone(), safe(1)?, first.candidate.clone())?;
        let encoded = save.encode()?;
        let loaded = GameSaveV2::decode(&encoded)?;
        assert_eq!(loaded.encode()?, encoded);
        assert_eq!(loaded.state.current_run_difficulty, Some(owner));
        let mut restored = GameRuntimeV6::from_snapshot(
            serde_json::from_slice(&serde_json::to_vec(&authority.snapshot())?)?, content.clone(),
        )?;
        for runtime in [&mut authority, &mut restored] {
            let saved = runtime.execute(
                GameActionV1::Save { action: SaveActionV1::Write { slot: "difficulty".to_owned() } },
                context(2, GameDomainExecutionInputV1::SaveGeneration(safe(2)?))?,
            )?;
            assert_eq!(saved.candidate.current_run_difficulty, Some(owner));
        }
        assert_eq!(authority.snapshot(), restored.snapshot());
    }
    Ok(())
}

#[test]
fn malformed_completed_selection_and_wrong_run_ownership_are_rejected() -> TestResult {
    let content = content()?;
    let mut setup = bootstrap(&content, RunDifficultyV1::Hell)?;
    setup.selections.difficulty = None;
    assert!(construct_natural_run_v6(&setup, &content, safe(1)?).is_err());
    setup.selections.difficulty = Some(RunDifficultyV1::Mystery);
    assert!(construct_natural_run_v6(&setup, &content, safe(1)?).is_err());
    setup.selections.difficulty = Some(RunDifficultyV1::Elite);
    let mut state = construct_natural_run_v6(&setup, &content, safe(1)?)?;
    state.current_run_difficulty.as_mut().ok_or("owner")?.run_id = er_types::run_ids::GameRunId::new(safe(99)?);
    assert!(state.validate().is_err());
    let mut state = construct_natural_run_v6(&setup, &content, safe(1)?)?;
    state.active_run = None;
    assert!(state.validate().is_err());
    Ok(())
}

#[test]
fn historical_absence_remains_unknown_and_canonical_on_save_restore() -> TestResult {
    let content = content()?;
    let natural = construct_natural_run_v6(&bootstrap(&content, RunDifficultyV1::Elite)?, &content, safe(1)?)?;
    let mut old = serde_json::to_value(&natural)?;
    assert!(old.as_object_mut().ok_or("object")?.remove("current_run_difficulty").is_some());
    let state: GameStateV6 = serde_json::from_value(old.clone())?;
    state.validate_with(content.as_ref())?;
    assert!(state.current_run_difficulty.is_none());
    assert_eq!(serde_json::to_value(&state)?, old);
    let save = GameSaveV2::new(content.identity().clone(), safe(1)?, state)?;
    let bytes = save.encode()?;
    let restored = GameSaveV2::decode(&bytes)?;
    assert_eq!(restored.encode()?, bytes);
    assert!(restored.state.current_run_difficulty.is_none());
    Ok(())
}

#[test]
fn same_run_material_cannot_change_erase_or_invent_difficulty() -> TestResult {
    let content = content()?;
    let natural = construct_natural_run_v6(&bootstrap(&content, RunDifficultyV1::Elite)?, &content, safe(1)?)?;
    let owner = natural.current_run_difficulty.ok_or("owner")?;
    for historical in [false, true] {
        let mut state = natural.clone();
        if historical { state.current_run_difficulty = None; }
        let mut authority = GameRuntimeV6::new(Some(state), content.clone(), safe(2)?)?;
        let before = authority.snapshot();
        let saved = authority.execute(
            GameActionV1::Save { action: SaveActionV1::Write { slot: "difficulty".to_owned() } },
            context(2, GameDomainExecutionInputV1::SaveGeneration(safe(2)?))?,
        )?;
        let material = GameMaterialV6::decode(&saved.material_bytes)?;
        let replacements = if historical { vec![Some(owner)] } else {
            vec![None, Some(er_state::m9e_state_v6::CurrentRunDifficultyV1 { difficulty: RunDifficultyV1::Hell, ..owner })]
        };
        for replacement in replacements {
            let mut transition = material.transition().clone();
            transition.after_state.current_run_difficulty = replacement;
            transition.after_digest = game_state_digest(&transition.after_state)?;
            let forged = GameMaterialV6::GameAction(transition);
            forged.validate()?;
            let mut replica = GameRuntimeV6::from_snapshot(before.clone(), content.clone())?;
            assert!(replica.apply_material_bytes(&forged.canonical_bytes()?).is_err());
            assert_eq!(replica.snapshot(), before);
            assert_eq!(replica.apply_material_bytes(&saved.material_bytes)?, GameMaterialApplyOutcomeV6::Applied);
            assert_eq!(replica.state(), authority.state());
        }
    }
    Ok(())
}
