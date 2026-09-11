//! Actual shared bootstrap controls and natural constructor; no CLI/Worker claim.
use er_game::current_starter_pokerus::{DATE_TIME_CLIP_MILLISECONDS, daily_starter_species};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_new_run_v6::construct_natural_run_v6;
use er_game::m72_bootstrap::{
    BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapMachineV1, RunBootstrapStageV1,
};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::{PokemonId, WaveIndex};
use er_types::{
    BootstrapActionV1, GameButton, PlatformRequestId, RunDifficultyV1, SafeU53, SeatId,
    StarterSelectionV1,
};
use std::{error::Error, sync::Arc};

use er_types::m7_action::GameActionV1;

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> Result<SafeU53> {
    Ok(SafeU53::new(value)?)
}
fn seat() -> Result<SeatId> {
    Ok(SeatId::new(safe(1)?))
}
fn request(value: u64) -> Result<PlatformRequestId> {
    Ok(PlatformRequestId::new(safe(value)?))
}
fn content() -> Result<PreparedGameContentV2> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(PreparedGameContentV2::prepare(Arc::new(bundle))?)
}
fn bootstrap(content: &PreparedGameContentV2, current: bool) -> Result<RunBootstrapMachineV1> {
    let owner = seat()?;
    let profile = ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: vec![],
        achievements: vec![],
        challenges: vec![],
        flags: Default::default(),
        dex: DexState::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(safe(1)?)?,
        },
    };
    let bundle = content.bundle();
    let starters = bundle
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
        .collect::<Result<Vec<_>>>()?;
    let catalog = BootstrapCatalogV1 {
        modes: bundle
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
        challenges: bundle
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
        save_slots: vec!["daily-owned".to_owned()],
        automatic_coop_save_slot: None,
        maximum_starter_cost: bundle.bootstrap.maximum_starter_cost,
        maximum_starters: bundle.bootstrap.maximum_starters,
        local_is_host: true,
        developer_mode: false,
    };
    let mut bootstrap =
        RunBootstrapMachineV1::new(profile, "m9e-starter-pokerus-8".to_owned(), owner, catalog)?;
    if current {
        bootstrap.current_friendship_profile = Some(
            er_game::current_friendship_profile::fresh_profile(content, owner)?,
        );
        bootstrap.enable_current_starter_pokerus()?;
    }
    Ok(bootstrap)
}

// Navigate the real shared vertical menu, then submit its actual selected action.
fn choose(bootstrap: &mut RunBootstrapMachineV1, action: BootstrapActionV1) -> Result<()> {
    if action == BootstrapActionV1::Cancel {
        bootstrap.button(GameButton::Cancel)?;
        return Ok(());
    }
    let wanted = GameActionV1::Bootstrap { action };
    let count = bootstrap
        .control
        .menu
        .as_ref()
        .ok_or("real menu required")?
        .options
        .len();
    for _ in 0..count {
        if !bootstrap.button(GameButton::Up)? {
            break;
        }
    }
    for _ in 0..count {
        if bootstrap
            .control
            .menu
            .as_ref()
            .and_then(|menu| menu.selected_action())
            == Some(&wanted)
        {
            bootstrap.button(GameButton::Submit)?;
            return Ok(());
        }
        bootstrap.button(GameButton::Down)?;
    }
    Err("requested action absent from actual menu".into())
}
fn enter(bootstrap: &mut RunBootstrapMachineV1, content: &PreparedGameContentV2) -> Result<()> {
    choose(bootstrap, BootstrapActionV1::OpenNewGame)?;
    let mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| {
            content
                .world
                .mode(mode.mode)
                .is_some_and(|definition| definition.key == "CLASSIC")
        })
        .ok_or("actual Classic mode required")?
        .mode;
    choose(bootstrap, BootstrapActionV1::SelectMode(mode))?;
    if bootstrap.stage == RunBootstrapStageV1::ChallengeSelect {
        choose(bootstrap, BootstrapActionV1::Confirm)?;
    }
    assert_eq!(bootstrap.stage, RunBootstrapStageV1::StarterSelect);
    Ok(())
}
fn pick(bootstrap: &mut RunBootstrapMachineV1, species: u32) -> Result<()> {
    let starter = bootstrap
        .catalog
        .starters
        .iter()
        .find(|starter| starter.species_id.get() == u64::from(species))
        .ok_or("actual content starter required")?
        .clone();
    choose(bootstrap, BootstrapActionV1::SelectStarter(starter))
}
fn finish(bootstrap: &mut RunBootstrapMachineV1) -> Result<()> {
    choose(bootstrap, BootstrapActionV1::ConfirmStarters)?;
    choose(bootstrap, BootstrapActionV1::Confirm)?;
    choose(
        bootstrap,
        BootstrapActionV1::SelectDifficulty(RunDifficultyV1::Youngster),
    )?;
    choose(
        bootstrap,
        BootstrapActionV1::SelectSaveSlot("daily-owned".to_owned()),
    )?;
    assert_eq!(bootstrap.stage, RunBootstrapStageV1::Complete);
    bootstrap.validate()?;
    Ok(())
}
fn sample(bootstrap: &mut RunBootstrapMachineV1, id: u64, milliseconds: i64) -> Result<()> {
    assert!(bootstrap.needs_starter_pokerus_clock());
    let before = bootstrap.control.clone();
    let context = bootstrap.begin_starter_pokerus_clock(request(id)?, seat()?)?;
    assert_eq!(
        context.menu_instance,
        before.menu.as_ref().ok_or("waiting menu")?.instance_id
    );
    assert_eq!(context.menu_revision, before.revision);
    bootstrap.accept_starter_pokerus_clock(request(id)?, milliseconds, seat()?)?;
    assert!(!bootstrap.needs_starter_pokerus_clock());
    assert!(bootstrap.control.revision > before.revision);
    Ok(())
}

#[test]
fn daily_selection_matches_all_actual_source_dates() -> Result<()> {
    // Exact source observations from two fresh processes, not computed expected
    // values. Raw export SHA9b58691e1c5b3796e2b1bfe511483a445b7ab158e72e895fd15c86e5f9bc4576.
    for (milliseconds, expected) in SOURCE_DATES {
        assert_eq!(daily_starter_species(*milliseconds)?.as_slice(), *expected);
    }
    assert!(daily_starter_species(DATE_TIME_CLIP_MILLISECONDS + 1).is_err());
    assert!(daily_starter_species(-DATE_TIME_CLIP_MILLISECONDS - 1).is_err());
    assert_eq!(
        daily_starter_species(0)?,
        daily_starter_species(86_399_999)?
    );
    assert_eq!(
        daily_starter_species(-1)?,
        daily_starter_species(-86_400_000)?
    );
    Ok(())
}

#[test]
fn pending_clock_cancel_restore_and_request_floor_are_owned() -> Result<()> {
    let content = content()?;
    let mut state = bootstrap(&content, true)?;
    enter(&mut state, &content)?;
    assert_eq!(
        state
            .control
            .menu
            .as_ref()
            .ok_or("waiting menu")?
            .options
            .len(),
        1
    );
    let before = state.clone();
    let starter = state.catalog.starters[0].clone();
    assert!(
        state
            .apply_game_action(GameActionV1::Bootstrap {
                action: BootstrapActionV1::SelectStarter(starter)
            })
            .is_err()
    );
    assert_eq!(state, before);
    state.begin_starter_pokerus_clock(request(7)?, seat()?)?;
    let pending_bytes = serde_json::to_vec(&state)?;
    let mut restored: RunBootstrapMachineV1 = serde_json::from_slice(&pending_bytes)?;
    restored.validate()?;
    assert_eq!(serde_json::to_vec(&restored)?, pending_bytes);
    for (id, milliseconds, owner) in [
        (8, 0, seat()?),
        (7, DATE_TIME_CLIP_MILLISECONDS + 1, seat()?),
        (7, 0, SeatId::new(safe(2)?)),
    ] {
        assert!(
            restored
                .accept_starter_pokerus_clock(request(id)?, milliseconds, owner)
                .is_err()
        );
        assert_eq!(restored, state);
    }
    choose(&mut state, BootstrapActionV1::Cancel)?;
    assert_eq!(state.stage, RunBootstrapStageV1::Title);
    assert_eq!(
        state
            .current_starter_pokerus
            .as_ref()
            .ok_or("owner")?
            .next_platform_request_id,
        safe(8)?
    );
    let cancelled = state.clone();
    assert!(
        state
            .accept_starter_pokerus_clock(request(7)?, 0, seat()?)
            .is_err()
    );
    assert_eq!(state, cancelled);
    enter(&mut state, &content)?;
    let before = state.clone();
    assert!(
        state
            .begin_starter_pokerus_clock(request(7)?, seat()?)
            .is_err()
    );
    assert_eq!(state, before);
    sample(&mut state, 8, -1)?;
    let after = state.clone();
    assert!(
        state
            .accept_starter_pokerus_clock(request(8)?, -1, seat()?)
            .is_err()
    );
    assert_eq!(state, after);
    Ok(())
}

#[test]
fn picks_retain_their_source_day_through_reentry_and_natural_construction() -> Result<()> {
    let content = content()?;
    let mut state = bootstrap(&content, true)?;
    enter(&mut state, &content)?;
    sample(&mut state, 1, 1_468_800_000)?; // Actual source day17 includes Bulbasaur.
    pick(&mut state, 1)?;
    choose(&mut state, BootstrapActionV1::ConfirmStarters)?;
    choose(&mut state, BootstrapActionV1::Cancel)?;
    sample(&mut state, 2, 4_492_800_000)?; // Actual day52 includes Charmander, not Bulbasaur.
    pick(&mut state, 4)?;
    finish(&mut state)?;
    let bindings = state
        .current_starter_pokerus_selections()?
        .ok_or("owned selections")?;
    assert_eq!(
        bindings
            .iter()
            .map(|row| (row.selection.species_id.get(), row.pokerus))
            .collect::<Vec<_>>(),
        vec![(1, true), (4, true)]
    );
    let restored: RunBootstrapMachineV1 = serde_json::from_slice(&serde_json::to_vec(&state)?)?;
    assert_eq!(restored, state);
    let natural = construct_natural_run_v6(&restored, &content, safe(10)?)?;
    natural.validate_with(&content)?;
    let party = &natural
        .active_run
        .as_ref()
        .ok_or("actual natural run")?
        .party;
    assert_eq!(
        party
            .iter()
            .map(|pokemon| (pokemon.species_id.get().get(), pokemon.pokerus))
            .collect::<Vec<_>>(),
        vec![(1, Some(true)), (4, Some(true))]
    );
    Ok(())
}

#[test]
fn clock_counter_overflow_and_forged_restore_fail_atomically() -> Result<()> {
    let content = content()?;
    let mut state = bootstrap(&content, true)?;
    enter(&mut state, &content)?;
    let before = state.clone();
    assert!(
        state
            .begin_starter_pokerus_clock(request(9_007_199_254_740_991)?, seat()?)
            .is_err()
    );
    assert_eq!(state, before);
    state.begin_starter_pokerus_clock(request(1)?, seat()?)?;
    let original = serde_json::to_value(&state)?;
    for field in ["request_id", "menu_revision", "local_seat"] {
        let mut forged = original.clone();
        if field == "request_id" {
            forged["current_starter_pokerus"]["display"]["value"][field] = serde_json::json!(99);
        } else {
            forged["current_starter_pokerus"]["display"]["value"]["context"][field] =
                serde_json::json!(99);
        }
        let restored: RunBootstrapMachineV1 = serde_json::from_value(forged)?;
        assert!(restored.validate().is_err());
    }
    // Controlled allocator-boundary fixture; all pending/control correspondence
    // is kept valid so the callback reaches its checked menu allocation.
    let mut overflow = original;
    let maximum = serde_json::json!(9_007_199_254_740_991_u64);
    overflow["menu_instance_high_water"] = maximum.clone();
    overflow["control"]["menu"]["instance_id"] = maximum.clone();
    overflow["control"]["action_context"]["menu_instance"] = maximum.clone();
    overflow["current_starter_pokerus"]["display"]["value"]["context"]["menu_instance"] = maximum;
    let mut overflow: RunBootstrapMachineV1 = serde_json::from_value(overflow)?;
    overflow.validate()?;
    let before = overflow.clone();
    assert!(
        overflow
            .accept_starter_pokerus_clock(request(1)?, 0, seat()?)
            .is_err()
    );
    assert_eq!(overflow, before);
    Ok(())
}

#[test]
fn historical_absence_remains_unknown_and_requires_actual_fresh_profile() -> Result<()> {
    let content = content()?;
    let mut state = bootstrap(&content, false)?;
    let original = serde_json::to_vec(&state)?;
    assert!(!String::from_utf8(original.clone())?.contains("current_starter_pokerus"));
    assert!(state.enable_current_starter_pokerus().is_err());
    assert_eq!(serde_json::to_vec(&state)?, original);
    enter(&mut state, &content)?;
    assert!(!state.needs_starter_pokerus_clock());
    pick(&mut state, 1)?;
    finish(&mut state)?;
    let natural = construct_natural_run_v6(&state, &content, safe(2)?)?;
    assert_eq!(
        natural.active_run.as_ref().ok_or("natural run")?.party[0].pokerus,
        None
    );
    Ok(())
}

#[test]
fn removed_and_corrupted_picks_cannot_reuse_an_unrelated_daily_receipt() -> Result<()> {
    let content = content()?;
    let mut state = bootstrap(&content, true)?;
    enter(&mut state, &content)?;
    sample(&mut state, 1, 1_468_800_000)?;
    pick(&mut state, 1)?;
    choose(&mut state, BootstrapActionV1::ConfirmStarters)?;
    choose(&mut state, BootstrapActionV1::Cancel)?;
    sample(&mut state, 2, 4_492_800_000)?;
    choose(&mut state, BootstrapActionV1::Cancel)?; // Pop the existing pick without reopening this display.
    assert!(!state.needs_starter_pokerus_clock());
    pick(&mut state, 1)?;
    finish(&mut state)?;
    assert!(
        !state
            .current_starter_pokerus_selections()?
            .ok_or("bindings")?[0]
            .pokerus
    );
    let original = serde_json::to_value(&state)?;
    for property in ["selection", "receipt"] {
        let mut forged = original.clone();
        if property == "selection" {
            forged["current_starter_pokerus"]["selected"][0][property]["species_id"] =
                serde_json::json!(4);
        } else {
            forged["current_starter_pokerus"]["selected"][0][property]["species"] =
                serde_json::json!([1]);
        }
        let restored: RunBootstrapMachineV1 = serde_json::from_value(forged)?;
        assert!(restored.validate().is_err());
        assert!(construct_natural_run_v6(&restored, &content, safe(2)?).is_err());
    }
    Ok(())
}

const SOURCE_DATES: &[(i64, &[u32])] = &[
    (0, &[806, 203, 672, 932, 190, 621, 10710, 211]),
    (1, &[806, 203, 672, 932, 190, 621, 10710, 211]),
    (86399999, &[806, 203, 672, 932, 190, 621, 10710, 211]),
    (86400000, &[10, 10706, 829, 2019, 98, 418, 10623, 751]),
    (-1, &[10666, 459, 543, 335, 43, 142, 850, 486]),
    (-86400000, &[10666, 459, 543, 335, 43, 142, 850, 486]),
    (-86400001, &[948, 41, 118, 10735, 283, 339, 1015, 590]),
    (1783641600000, &[54, 190, 173, 775, 167, 10877, 175, 25]),
    (
        8640000000000000,
        &[632, 8194, 850, 4144, 848, 10766, 627, 629],
    ),
    (
        -8640000000000000,
        &[441, 222, 4554, 493, 10843, 10797, 878, 228],
    ),
    (0, &[806, 203, 672, 932, 190, 621, 10710, 211]),
    (1468800000, &[415, 595, 896, 10708, 622, 6100, 420, 1]),
    (2851200000, &[8128, 883, 688, 519, 403, 7, 393, 875]),
    (4492800000, &[548, 751, 386, 316, 4, 771, 854, 734]),
];
