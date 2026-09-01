use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_new_run_v6::construct_natural_run_v6;
use er_game::m72_bootstrap::{
    BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapMachineV1, RunBootstrapStageV1,
};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::{PokemonId, WaveIndex};
use er_types::{RunDifficultyV1, SafeU53, SeatId, StarterSelectionV1};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
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

#[test]
fn complete_bootstrap_builds_a_deterministic_playable_v6_state() -> Result<(), Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle))?;
    let owner = SeatId::new(safe(1));
    let starters = content
        .bundle()
        .bootstrap
        .starters
        .iter()
        .enumerate()
        .map(|(index, starter)| {
            Ok(StarterSelectionV1 {
                pokemon_id: PokemonId::new(safe(u64::try_from(index)? + 1)),
                species_id: starter.species_id.get(),
                form_index: starter.form_index,
                ability_index: starter.ability_index,
                cost: starter.cost,
                owner_seat: owner,
            })
        })
        .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
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
        starters: starters.clone(),
        save_slots: vec!["preview-slot".to_owned()],
        automatic_coop_save_slot: None,
        maximum_starter_cost: content.bundle().bootstrap.maximum_starter_cost,
        maximum_starters: content.bundle().bootstrap.maximum_starters,
        local_is_host: true,
        developer_mode: false,
    };
    let mut bootstrap =
        RunBootstrapMachineV1::new(profile()?, "m9e-natural-run".to_owned(), owner, catalog)?;
    bootstrap.stage = RunBootstrapStageV1::Complete;
    bootstrap.selections.mode = Some(content.bundle().bootstrap.modes[0].mode);
    bootstrap.selections.starters = vec![starters[0].clone()];
    bootstrap.selections.difficulty = Some(RunDifficultyV1::Youngster);
    bootstrap.selections.save_slot = Some("preview-slot".to_owned());
    bootstrap.validate()?;

    let first = construct_natural_run_v6(&bootstrap, &content, safe(1))?;
    let second = construct_natural_run_v6(&bootstrap, &content, safe(1))?;
    assert_eq!(first, second);
    first.validate_with(&content)?;
    let run = first.active_run.as_ref().expect("natural run is active");
    assert_eq!(run.party.len(), 1);
    assert_eq!(
        run.battle
            .as_ref()
            .expect("battle exists")
            .enemy_party
            .len(),
        1
    );
    assert_eq!(first.identities.next_run_id, safe(2));
    assert_eq!(first.identities.next_pokemon_id, safe(3));
    assert_eq!(first.identities.next_battle_id, safe(2));
    Ok(())
}
