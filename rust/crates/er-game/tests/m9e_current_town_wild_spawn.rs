use std::error::Error;
use std::sync::Arc;

use er_game::current_town_wild_spawn::{
    CurrentTownDayWaveTwoContextV1, CurrentTownDayWildContextV1, CurrentTownGenderV1,
    CurrentTownWildErrorV1, select_current_town_day_wave_one_root,
    select_current_town_day_wave_one_shell, select_current_town_day_wave_two_constructor_prefix,
    select_current_town_day_wave_two_core, select_current_town_day_wave_two_root,
    select_current_town_day_wave_two_shell, select_current_town_day_wave_two_shell_with_identity,
    source_town_ability_id, source_town_day_pools, source_town_form_base_stats,
    source_town_form_types, source_town_initial_level_move_pool, source_town_is_shiny,
    source_town_ivs_from_id, source_town_level_two_form_rows, source_town_level_two_species,
    source_town_male_half_percent, source_town_moveset, source_town_neutral_moveset,
    source_town_neutral_weighted_level_move_pool, source_town_reset_seed, source_town_shiny_xor,
    source_town_time_of_day, source_town_unboosted_wild_double_roll,
    source_town_unmodified_level_two_stats, source_town_unmodified_stats_at_level,
    source_town_wave_cycle_offset, source_town_weighted_level_move_pool,
};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_rng::audit::{RngCallsiteId, RngPublicApi, RngReason};
use er_rng::battle::RngRuntime;
use er_rng::phaser::{PhaserRdg, PhaserRdgState, RunRngState, shift_char_codes};
use er_state::m9e_state_v6::GameIdentityAllocatorStateV1;
use er_types::battle_ids::SpeciesId;
use er_types::battle_model::PokemonType;
use er_types::run_ids::BiomeId;
use er_types::{RunDifficultyV1, SafeU53};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
const SOURCE_GENDER: &[u8] = include_bytes!("../../../fixtures/m9/engineering/town-gender-v1.json");
const SOURCE_FORM_FLAGS: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/town-form-flags-v1.json");
const SOURCE_ABILITY_SLOTS: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/town-ability-slots-v1.json");
const SOURCE_FORM_TYPES: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/town-form-types-v1.json");
const SOURCE_FORM_STATS: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/town-form-stats-v1.json");
const SOURCE_LEVEL_TWO_FORMS: &[u8] = include_bytes!("../src/current_town_level_two_forms.json");
const SOURCE_LEVEL_TWO_META: &[u8] = include_bytes!("../src/current_town_level_two_meta.json");
const SOURCE_LEVEL_TWO_MOVEGEN: &[u8] =
    include_bytes!("../src/current_town_level_two_movegen.json");
const SOURCE_LEVEL_TWO_ABILITIES: &[u8] =
    include_bytes!("../src/current_town_level_two_abilities.json");
const SOURCE_LEVEL_TWO_ABILITY_POWERS: &[u8] =
    include_bytes!("../src/current_town_level_two_ability_powers.json");
const SOURCE_LEVEL_TWO_SIGNATURES: &[u8] =
    include_bytes!("../src/current_town_level_two_signatures.json");
const SOURCE_LEVEL_TWO_USELESS: &[u8] =
    include_bytes!("../src/current_town_level_two_useless.json");
const SOURCE_MOVEGEN_STAGE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/town-movegen-stage-v1.json");
const SOURCE_TYPE_ORDER: [PokemonType; 19] = [
    PokemonType::Normal,
    PokemonType::Fighting,
    PokemonType::Flying,
    PokemonType::Poison,
    PokemonType::Ground,
    PokemonType::Rock,
    PokemonType::Bug,
    PokemonType::Ghost,
    PokemonType::Steel,
    PokemonType::Fire,
    PokemonType::Water,
    PokemonType::Grass,
    PokemonType::Electric,
    PokemonType::Psychic,
    PokemonType::Ice,
    PokemonType::Dragon,
    PokemonType::Dark,
    PokemonType::Fairy,
    PokemonType::Stellar,
];
const SOURCE_BEFORE: &str = "!rnd,789153,0.5761283298488706,0.7223087239544839,0.22977968817576766";
const SOURCE_NAMED_BEFORE: &str =
    "!rnd,653160,0.8672514262143523,0.5963186640292406,0.669155293609947";
const SOURCE_AFTER_WAVE_RESET: &str =
    "!rnd,1,0.3782209656201303,0.3772894029971212,0.5761283298488706";
const SOURCE_AFTER_SELECTION: &str =
    "!rnd,1012145,0.09734400571323931,0.1575480371247977,0.15997060341760516";

#[test]
fn entire_town_day_pool_and_actual_wave_two_source_draw_match() -> Result<(), Box<dyn Error>> {
    // Source run35892149923 established that the starter helper silently
    // replaced the requested run seed with "test". BattleScene reset wave 2
    // from this actual seed before battle setup advanced to SOURCE_BEFORE.
    let wave_seed = shift_char_codes("test", 2)?;
    assert_eq!(wave_seed, "vguv");
    let mut wave_rng = PhaserRdg::from_seed(&wave_seed);
    assert_eq!(wave_rng.state().state_string, SOURCE_AFTER_WAVE_RESET);
    // The ordinary source wild battle runs checkIsDouble after resetSeed; its
    // randSeedInt range consumes Phaser's two primitive draws before the
    // queued EncounterPhase calls Arena.randomSpecies.
    wave_rng.rnd();
    wave_rng.rnd();
    assert_eq!(wave_rng.state().state_string, SOURCE_BEFORE);
    // The independently launched source run35894333532 kept its requested
    // seed through Title and Encounter. Its wave-two enemy is level 3, outside
    // this Town level-two constructor, but the battle-setup RNG boundary is
    // still reproducible without borrowing the controlled fixture's state.
    let named_wave_seed = shift_char_codes("m9e-reward-selection-source-v1", 2)?;
    let mut named_wave_rng = PhaserRdg::from_seed(&named_wave_seed);
    assert_eq!(
        named_wave_rng.state().state_string,
        "!rnd,1,0.1938865149859339,0.3122721794061363,0.8672514262143523"
    );
    named_wave_rng.rnd();
    named_wave_rng.rnd();
    assert_eq!(
        named_wave_rng.state().state_string,
        "!rnd,653160,0.8672514262143523,0.5963186640292406,0.669155293609947"
    );
    // Source399d direct queued NextEncounter observation in run34704520605:
    // tier integer 247/512, common pool index 3/24, root263. That probe's
    // retained run stream and its effective DAY pool are directly observed;
    // this isolated selector test does not claim a causal natural reward receipt.
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle))?;
    // The named-seed wave-two enemy is a level-three Lillipup. Its observed
    // identity, ability and unmodified stats are a narrower constructor check;
    // source moves/modifiers and battle settlement remain unsupported here.
    let level_three_species = SpeciesId::new(SafeU53::new(504)?);
    let level_three_ivs = source_town_ivs_from_id(1_776_451_493);
    assert_eq!(level_three_ivs, [20, 30, 4, 31, 29, 5]);
    assert_eq!(
        source_town_ability_id(level_three_species, 0, 2)?
            .get()
            .get(),
        5165
    );
    assert_eq!(
        source_town_unmodified_stats_at_level(
            source_town_form_base_stats(&content, level_three_species, 0)?,
            level_three_ivs,
            18,
            3,
        )?,
        [16, 9, 7, 8, 8, 9]
    );
    let town = content
        .world
        .biome(BiomeId::new(SafeU53::ZERO))
        .ok_or("compiled Town absent")?;
    let pools = source_town_day_pools(town)?;
    assert_eq!(
        pools.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![24, 14, 7, 6, 3]
    );
    assert_eq!(pools.iter().map(Vec::len).sum::<usize>(), 54);
    let mut mapped = 0;
    for root in pools.iter().flatten() {
        let actual = source_town_level_two_species(*root)?;
        let expected = if root.get().get() == 266 {
            265
        } else {
            root.get().get()
        };
        assert_eq!(actual.get().get(), expected);
        mapped += 1;
    }
    assert_eq!(mapped, 54);
    let gender: serde_json::Value = serde_json::from_slice(SOURCE_GENDER)?;
    let form_flags: serde_json::Value = serde_json::from_slice(SOURCE_FORM_FLAGS)?;
    let ability_slots: serde_json::Value = serde_json::from_slice(SOURCE_ABILITY_SLOTS)?;
    let form_types: serde_json::Value = serde_json::from_slice(SOURCE_FORM_TYPES)?;
    let form_stats: serde_json::Value = serde_json::from_slice(SOURCE_FORM_STATS)?;
    let level_two_forms: serde_json::Value = serde_json::from_slice(SOURCE_LEVEL_TWO_FORMS)?;
    let level_two_meta: serde_json::Value = serde_json::from_slice(SOURCE_LEVEL_TWO_META)?;
    let level_two_movegen: serde_json::Value = serde_json::from_slice(SOURCE_LEVEL_TWO_MOVEGEN)?;
    let level_two_abilities: serde_json::Value =
        serde_json::from_slice(SOURCE_LEVEL_TWO_ABILITIES)?;
    let level_two_ability_powers: serde_json::Value =
        serde_json::from_slice(SOURCE_LEVEL_TWO_ABILITY_POWERS)?;
    let level_two_signatures: serde_json::Value =
        serde_json::from_slice(SOURCE_LEVEL_TWO_SIGNATURES)?;
    let level_two_useless: serde_json::Value = serde_json::from_slice(SOURCE_LEVEL_TWO_USELESS)?;
    let movegen_stage: serde_json::Value = serde_json::from_slice(SOURCE_MOVEGEN_STAGE)?;
    assert_eq!(gender["source"], "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7");
    assert_eq!(form_flags["source"], gender["source"]);
    assert_eq!(ability_slots["source"], gender["source"]);
    assert_eq!(form_types["source"], gender["source"]);
    assert_eq!(form_stats["source"], gender["source"]);
    assert_eq!(level_two_forms["source"], gender["source"]);
    assert_eq!(level_two_meta["source"], gender["source"]);
    assert_eq!(level_two_movegen["source"], gender["source"]);
    assert_eq!(level_two_abilities["source"], gender["source"]);
    assert_eq!(level_two_ability_powers["source"], gender["source"]);
    assert_eq!(level_two_signatures["source"], gender["source"]);
    assert_eq!(level_two_useless["source"], gender["source"]);
    assert_eq!(movegen_stage["source"], gender["source"]);
    assert_eq!(gender["rows"].as_array().ok_or("gender rows")?.len(), 163);
    assert_eq!(form_flags["rows"].as_array().ok_or("form rows")?.len(), 163);
    assert_eq!(
        ability_slots["rows"]
            .as_array()
            .ok_or("ability slot rows")?
            .len(),
        163
    );
    assert_eq!(
        form_types["rows"].as_array().ok_or("form type rows")?.len(),
        163
    );
    assert_eq!(
        form_stats["rows"].as_array().ok_or("form stat rows")?.len(),
        163
    );
    assert_eq!(
        level_two_forms["rows"]
            .as_array()
            .ok_or("level-two rows")?
            .len(),
        53
    );
    assert_eq!(
        level_two_meta["rows"]
            .as_array()
            .ok_or("level-two metadata")?
            .len(),
        131
    );
    assert_eq!(
        level_two_movegen["rows"]
            .as_array()
            .ok_or("level-two movegen")?
            .len(),
        131
    );
    assert_eq!(
        level_two_abilities["rows"]
            .as_array()
            .ok_or("level-two abilities")?
            .len(),
        53
    );
    assert_eq!(
        level_two_ability_powers["rows"]
            .as_array()
            .ok_or("level-two ability powers")?
            .len(),
        53
    );
    assert_eq!(
        level_two_signatures["rows"]
            .as_array()
            .ok_or("level-two signatures")?
            .len(),
        53
    );
    let useless_rows = level_two_useless["rows"]
        .as_array()
        .ok_or("level-two usefulness rows")?;
    assert_eq!(useless_rows.len(), 131);
    assert!(useless_rows.iter().all(|row| row[1].as_i64() == Some(-1)));
    assert_eq!(
        level_two_abilities["movegen_modifiers"]
            .as_array()
            .ok_or("movegen modifiers")?
            .len(),
        98
    );
    assert!(
        level_two_meta["rows"]
            .as_array()
            .ok_or("level-two metadata")?
            .iter()
            .all(|row| row[5].as_bool() == Some(false))
    );
    for root in pools.iter().flatten() {
        let id = root.get().get();
        let source_ratio = gender["rows"]
            .as_array()
            .ok_or("gender rows")?
            .iter()
            .find(|row| row[0].as_u64() == Some(id))
            .ok_or("missing source gender")?;
        assert_eq!(
            source_town_male_half_percent(*root)?.map(|value| f64::from(value) / 2.0),
            source_ratio[1].as_f64()
        );
        let effective = if id == 266 { 265 } else { id };
        let flags = form_flags["rows"]
            .as_array()
            .ok_or("form rows")?
            .iter()
            .find(|row| row[0].as_u64() == Some(effective))
            .ok_or("missing source form flags")?;
        assert_eq!(flags[1].as_u64(), Some(0));
        let slots = ability_slots["rows"]
            .as_array()
            .ok_or("ability slot rows")?
            .iter()
            .find(|row| row[0].as_u64() == Some(effective))
            .ok_or("missing source ability slots")?;
        let forms = slots[1].as_array().ok_or("source forms")?;
        let expected_forms = match id {
            664 => 20,
            133 | 172 => 2,
            _ => 1,
        };
        assert!(forms.len() >= expected_forms);
        for (form, active) in forms.iter().take(expected_forms).enumerate() {
            let active = active.as_array().ok_or("source active abilities")?;
            assert_eq!(active.len(), 3);
            for (index, source_id) in active.iter().enumerate() {
                assert_eq!(
                    source_town_ability_id(*root, form as u16, index as u8)?
                        .get()
                        .get(),
                    source_id.as_u64().ok_or("source ability ID")?
                );
            }
        }
        let source_types = form_types["rows"]
            .as_array()
            .ok_or("form type rows")?
            .iter()
            .find(|row| row[0].as_u64() == Some(effective))
            .ok_or("missing source form types")?;
        let source_forms = source_types[1].as_array().ok_or("source form types")?;
        assert!(source_forms.len() >= expected_forms);
        for (form, observed) in source_forms.iter().take(expected_forms).enumerate() {
            assert!(
                observed[2]
                    .as_array()
                    .ok_or("source extra types")?
                    .is_empty()
            );
            let primary = observed[0].as_u64().ok_or("source primary type")? as usize;
            let mut types = vec![*SOURCE_TYPE_ORDER.get(primary).ok_or("source type range")?];
            if let Some(secondary) = observed[1].as_u64() {
                let secondary = *SOURCE_TYPE_ORDER
                    .get(secondary as usize)
                    .ok_or("source type range")?;
                if secondary != types[0] {
                    types.push(secondary);
                }
            }
            assert_eq!(source_town_form_types(*root, form as u16)?, types);
        }
        let source_stats = form_stats["rows"]
            .as_array()
            .ok_or("form stat rows")?
            .iter()
            .find(|row| row[0].as_u64() == Some(effective))
            .ok_or("missing source form stats")?;
        let source_forms = source_stats[1].as_array().ok_or("source form stats")?;
        assert!(source_forms.len() >= expected_forms);
        for (form, observed) in source_forms.iter().take(expected_forms).enumerate() {
            let observed = observed.as_array().ok_or("source base stats")?;
            assert_eq!(observed.len(), 6);
            let source: [u32; 6] =
                std::array::from_fn(|index| observed[index].as_u64().expect("source stat") as u32);
            assert_eq!(
                source_town_form_base_stats(&content, *root, form as u16)?,
                source
            );
        }
        let source_levels = level_two_forms["rows"]
            .as_array()
            .ok_or("level-two rows")?
            .iter()
            .find(|row| row[0].as_u64() == Some(effective))
            .ok_or("missing source level-two forms")?;
        let source_forms = source_levels[1].as_array().ok_or("level-two forms")?;
        assert!(source_forms.len() >= expected_forms);
        for (form, observed) in source_forms.iter().take(expected_forms).enumerate() {
            let expected = observed
                .as_array()
                .ok_or("source level-two pairs")?
                .iter()
                .map(|pair| {
                    Ok((
                        pair[0].as_i64().ok_or("source learn level")? as i16,
                        pair[1].as_u64().ok_or("source move ID")?,
                    ))
                })
                .collect::<Result<Vec<(i16, u64)>, Box<dyn Error>>>()?;
            let actual = source_town_level_two_form_rows(*root, form as u16)?
                .into_iter()
                .map(|(level, id)| (level, id.get().get()))
                .collect::<Vec<_>>();
            assert_eq!(actual, expected);
            assert!(
                source_town_initial_level_move_pool(&content, *root, form as u16)?.len() <= 512
            );
            let source_profiles = level_two_abilities["rows"]
                .as_array()
                .ok_or("ability profiles")?
                .iter()
                .find(|row| row[0].as_u64() == Some(effective))
                .ok_or("ability species")?;
            let source_profile = &source_profiles[1][form];
            let modifiers = level_two_abilities["movegen_modifiers"]
                .as_array()
                .ok_or("movegen modifier IDs")?;
            for ability_index in 0..3 {
                let active = source_profile[0][ability_index]
                    .as_u64()
                    .ok_or("active ability")?;
                let observed_species = level_two_ability_powers["rows"]
                    .as_array()
                    .ok_or("source ability power species")?
                    .iter()
                    .find(|row| row[0].as_u64() == Some(effective))
                    .ok_or("missing source ability power species")?;
                let observed_slots = observed_species[1][form][1]
                    .as_array()
                    .ok_or("source ability power slots")?;
                assert_eq!(observed_slots[ability_index][0].as_u64(), Some(active));
                let observed_powers = observed_slots[ability_index][1]
                    .as_array()
                    .ok_or("source effective powers")?;
                let weighted = source_town_weighted_level_move_pool(
                    &content,
                    *root,
                    form as u16,
                    ability_index as u8,
                    [13, 7, 6, 6, 6, 8],
                )?;
                for row in &weighted {
                    let source_power = observed_powers
                        .iter()
                        .find(|pair| pair[0].as_u64() == Some(row.id.get().get()))
                        .ok_or("missing observed effective power")?[1]
                        .as_f64()
                        .ok_or("observed effective power")?;
                    assert_eq!(row.effective_power, source_power);
                }
                let passive = source_profile[1].as_array().ok_or("passive abilities")?;
                let has_effect = modifiers.iter().any(|id| id.as_u64() == Some(active))
                    || passive
                        .iter()
                        .any(|passive| modifiers.iter().any(|id| id == passive));
                let result = source_town_neutral_weighted_level_move_pool(
                    &content,
                    *root,
                    form as u16,
                    ability_index as u8,
                    [13, 7, 6, 6, 6, 8],
                );
                if has_effect {
                    assert_eq!(
                        result.err(),
                        Some(CurrentTownWildErrorV1::UnsupportedContext)
                    );
                } else {
                    assert!(result?.len() <= 512);
                }
            }
        }
    }
    assert_eq!(
        source_town_level_two_species(SpeciesId::new(SafeU53::new(9999)?)),
        Err(CurrentTownWildErrorV1::SourceContent)
    );
    assert_eq!(
        source_town_ability_id(SpeciesId::new(SafeU53::new(133)?), 2, 0),
        Err(CurrentTownWildErrorV1::SourceContent)
    );
    assert_eq!(
        source_town_ability_id(SpeciesId::new(SafeU53::new(263)?), 0, 3),
        Err(CurrentTownWildErrorV1::SourceContent)
    );
    assert_eq!(
        source_town_ability_id(SpeciesId::new(SafeU53::new(9999)?), 0, 0),
        Err(CurrentTownWildErrorV1::SourceContent)
    );
    assert_eq!(
        source_town_form_types(SpeciesId::new(SafeU53::new(133)?), 2),
        Err(CurrentTownWildErrorV1::SourceContent)
    );
    assert_eq!(
        source_town_form_base_stats(&content, SpeciesId::new(SafeU53::new(133)?), 2),
        Err(CurrentTownWildErrorV1::SourceContent)
    );
    assert_eq!(
        source_town_level_two_form_rows(SpeciesId::new(SafeU53::new(133)?), 2),
        Err(CurrentTownWildErrorV1::SourceContent)
    );
    assert_eq!(
        source_town_initial_level_move_pool(&content, SpeciesId::new(SafeU53::new(133)?), 2),
        Err(CurrentTownWildErrorV1::SourceContent)
    );
    let mut missing = town.clone();
    missing.pokemon_pools[0].species.remove(0);
    assert_eq!(
        source_town_day_pools(&missing),
        Err(CurrentTownWildErrorV1::SourceContent)
    );

    let mode = content
        .bundle()
        .world
        .modes
        .iter()
        .find(|mode| mode.key == "CLASSIC")
        .ok_or("Classic mode absent")?;
    let context = CurrentTownDayWaveTwoContextV1 {
        mode: mode.id,
        biome: town.id,
        difficulty: RunDifficultyV1::Ace,
        wave: 2,
        level: 2,
        luck: 0,
        forced_tier: None,
        encounter_boss_segments: 0,
        regional_boost: false,
        time_override: None,
        effective_pool_time: 1,
        override_species: None,
        golden_bug_net: false,
        excluded_species: &[],
    };
    let mut named_rng = RngRuntime::from_states(
        RunRngState {
            rdg: PhaserRdgState::from_state_string(SOURCE_NAMED_BEFORE)?,
        },
        None,
    )?;
    let named_core = select_current_town_day_wave_two_core(
        &content,
        CurrentTownDayWaveTwoContextV1 {
            level: 3,
            ..context
        },
        &mut named_rng,
    )?;
    assert_eq!(named_core.prefix.root.source_root.get().get(), 504);
    assert_eq!(named_core.prefix.root.effective_species.get().get(), 504);
    assert_eq!(named_core.prefix.pokemon_id, 1_776_451_493);
    assert_eq!(named_core.prefix.ability_index, 2);
    assert_eq!(named_core.prefix.ability_id.get().get(), 5165);
    assert_eq!(named_core.prefix.ivs, [20, 30, 4, 31, 29, 5]);
    assert_eq!(named_core.prefix.nature_index, 18);
    assert_eq!(named_core.stats, [16, 9, 7, 8, 8, 9]);
    assert_eq!(
        named_core
            .moveset
            .moves
            .iter()
            .map(|id| id.get().get())
            .collect::<Vec<_>>(),
        vec![158, 95, 116, 43]
    );
    let mut shell_rng = RngRuntime::from_states(
        RunRngState {
            rdg: PhaserRdgState::from_state_string(SOURCE_NAMED_BEFORE)?,
        },
        None,
    )?;
    let shell = select_current_town_day_wave_two_shell(
        &content,
        CurrentTownDayWaveTwoContextV1 {
            level: 3,
            ..context
        },
        12_345,
        23_456,
        &mut shell_rng,
    )?;
    assert_eq!(shell.core, named_core);
    assert_eq!(shell_rng, named_rng);
    assert_eq!(shell.pokemon.id.get().get(), 1_776_451_493);
    assert_eq!(shell.pokemon.species_id.get().get(), 504);
    assert_eq!(shell.pokemon.level, 3);
    assert_eq!(shell.pokemon.experience.get().get(), 27);
    assert_eq!(shell.pokemon.friendship, 70);
    assert_eq!(shell.pokemon.abilities.active.get().get(), 5165);
    assert_eq!(shell.pokemon.abilities.passives, [None; 3]);
    assert_eq!(shell.pokemon.ivs.map(|iv| iv.get()), [20, 30, 4, 31, 29, 5]);
    assert_eq!(shell.pokemon.nature.get(), 18);
    assert_eq!(shell.pokemon.stats.hp, 16);
    assert_eq!(shell.pokemon.stats.attack, 9);
    assert_eq!(shell.pokemon.stats.defense, 7);
    assert_eq!(shell.pokemon.stats.special_attack, 8);
    assert_eq!(shell.pokemon.stats.special_defense, 8);
    assert_eq!(shell.pokemon.stats.speed, 9);
    assert_eq!(shell.pokemon.hp, 16);
    assert_eq!(shell.pokemon.gender, Some(0));
    assert_eq!(shell.pokemon.pokerus, Some(false));
    assert_eq!(shell.pokemon.types.primary, PokemonType::Normal);
    assert_eq!(shell.pokemon.types.secondary, None);
    assert_eq!(shell.pokemon.tera_type, Some(PokemonType::Normal));
    assert!(!shell.pokemon.shiny);
    assert_eq!(shell.pokemon.variant, 0);
    assert_eq!(
        shell
            .pokemon
            .moves
            .iter()
            .map(|slot| slot
                .as_ref()
                .map(|slot| (slot.move_id.get().get(), slot.pp_used)))
            .collect::<Vec<_>>(),
        vec![Some((158, 0)), Some((95, 0)), Some((116, 0)), Some((43, 0))]
    );
    let mut shiny_rng = RngRuntime::from_states(
        RunRngState {
            rdg: PhaserRdgState::from_state_string(SOURCE_NAMED_BEFORE)?,
        },
        None,
    )?;
    let before_shiny = shiny_rng.clone();
    let source_id = 1_776_451_493_u32;
    assert_eq!(
        select_current_town_day_wave_two_shell(
            &content,
            CurrentTownDayWaveTwoContextV1 {
                level: 3,
                ..context
            },
            ((source_id >> 16) as u16) ^ (source_id as u16),
            0,
            &mut shiny_rng,
        ),
        Err(CurrentTownWildErrorV1::UnsupportedContext)
    );
    assert_eq!(shiny_rng, before_shiny);
    let mut unsupported_level_three = RngRuntime::from_states(
        RunRngState {
            rdg: PhaserRdgState::from_state_string(SOURCE_BEFORE)?,
        },
        None,
    )?;
    let prior_unsupported = unsupported_level_three.clone();
    assert_eq!(
        select_current_town_day_wave_two_core(
            &content,
            CurrentTownDayWaveTwoContextV1 {
                level: 3,
                ..context
            },
            &mut unsupported_level_three,
        ),
        Err(CurrentTownWildErrorV1::UnsupportedContext)
    );
    assert_eq!(unsupported_level_three, prior_unsupported);
    let mut rng = RngRuntime::from_states(
        RunRngState {
            rdg: PhaserRdgState::from_state_string(SOURCE_BEFORE)?,
        },
        None,
    )?;
    let selected = select_current_town_day_wave_two_root(&content, context, &mut rng)?;
    assert_eq!(
        (selected.tier_roll, selected.tier, selected.root_index),
        (247, 0, 3)
    );
    assert_eq!(selected.source_root, SpeciesId::new(SafeU53::new(263)?));
    assert_eq!(selected.effective_species, selected.source_root);
    assert_eq!(selected.audit.len(), 2);
    assert_eq!(selected.audit[0].result.get(), 247);
    assert_eq!(selected.audit[1].result.get(), 3);
    assert_eq!(rng.run_state().rdg.state_string, SOURCE_AFTER_SELECTION);

    let mut constructor_rng = RngRuntime::from_states(
        RunRngState {
            rdg: PhaserRdgState::from_state_string(SOURCE_BEFORE)?,
        },
        None,
    )?;
    let prefix = select_current_town_day_wave_two_constructor_prefix(
        &content,
        context,
        &mut constructor_rng,
    )?;
    assert_eq!(prefix.root, selected);
    assert_eq!(prefix.ability_index, 1);
    assert_eq!(prefix.ability_id.get().get(), 113);
    assert_eq!(prefix.pokemon_id, 3_818_575_047);
    assert_eq!(prefix.ivs, [17, 25, 21, 21, 6, 7]);
    assert_eq!(prefix.ivs, source_town_ivs_from_id(prefix.pokemon_id));
    assert_eq!(prefix.gender, CurrentTownGenderV1::Male);
    assert_eq!(prefix.form_index, 0);
    assert_eq!(prefix.nature_index, 11);
    assert_eq!(prefix.tera_type, PokemonType::Normal);
    let initial_moves =
        source_town_initial_level_move_pool(&content, prefix.root.source_root, prefix.form_index)?;
    assert_eq!(
        initial_moves
            .iter()
            .map(|(id, weight)| (id.get().get(), *weight))
            .collect::<Vec<_>>(),
        vec![(38, 60), (45, 21), (300, 21), (316, 21), (707, 60)]
    );
    assert_eq!(
        source_town_unmodified_level_two_stats(
            source_town_form_base_stats(&content, prefix.root.source_root, prefix.form_index)?,
            prefix.ivs,
            prefix.nature_index,
        )?,
        [13, 7, 6, 6, 6, 8]
    );
    let weighted = source_town_neutral_weighted_level_move_pool(
        &content,
        prefix.root.source_root,
        prefix.form_index,
        prefix.ability_index,
        [13, 7, 6, 6, 6, 8],
    )?;
    let observed_initial = movegen_stage["initial"]
        .as_array()
        .ok_or("source initial pool")?;
    let observed_adjusted = movegen_stage["adjusted"]
        .as_array()
        .ok_or("source adjusted pool")?;
    let observed_weighted = movegen_stage["weighted"]
        .as_array()
        .ok_or("source weighted pool")?;
    assert_eq!(weighted.len(), observed_weighted.len());
    for (index, row) in weighted.iter().enumerate() {
        assert_eq!(
            row.id.get().get(),
            observed_initial[index][0].as_u64().ok_or("move ID")?
        );
        assert_eq!(
            u64::from(row.initial_weight),
            observed_initial[index][1]
                .as_u64()
                .ok_or("initial weight")?
        );
        assert_eq!(
            row.adjusted_weight,
            observed_adjusted[index][1]
                .as_f64()
                .ok_or("adjusted weight")?
        );
        assert_eq!(
            row.weighted_weight,
            observed_weighted[index][1]
                .as_u64()
                .ok_or("weighted weight")?
        );
    }
    assert_eq!(
        weighted[0].weighted_weight + weighted[1].weighted_weight,
        74_296
    );
    let mut moveset_rng = constructor_rng.clone();
    let moveset = source_town_neutral_moveset(
        &content,
        prefix.root.source_root,
        prefix.form_index,
        prefix.ability_index,
        [13, 7, 6, 6, 6, 8],
        &mut moveset_rng,
    )?;
    let mut complete_moveset_rng = constructor_rng.clone();
    let complete_moveset = source_town_moveset(
        &content,
        prefix.root.source_root,
        prefix.form_index,
        prefix.ability_index,
        [13, 7, 6, 6, 6, 8],
        &mut complete_moveset_rng,
    )?;
    assert_eq!(complete_moveset, moveset);
    let mut core_rng = RngRuntime::from_states(
        RunRngState {
            rdg: PhaserRdgState::from_state_string(SOURCE_BEFORE)?,
        },
        None,
    )?;
    let core = select_current_town_day_wave_two_core(&content, context, &mut core_rng)?;
    assert_eq!(core.prefix, prefix);
    assert_eq!(core.stats, [13, 7, 6, 6, 6, 8]);
    assert_eq!(core.moveset, complete_moveset);
    // Causal source run35888899218 observed these actual account IDs, enemy ID,
    // base threshold and reward multiplier after reward CANCEL/newBattle.
    assert_eq!(core.prefix.pokemon_id, 3_818_575_047);
    assert_eq!(
        source_town_shiny_xor(12_345, 23_456, core.prefix.pokemon_id),
        23_748
    );
    assert!(!source_town_is_shiny(
        12_345,
        23_456,
        core.prefix.pokemon_id,
        64
    ));
    assert!(!source_town_is_shiny(
        12_345,
        23_456,
        core.prefix.pokemon_id,
        23_748
    ));
    assert!(source_town_is_shiny(
        12_345,
        23_456,
        core.prefix.pokemon_id,
        23_749
    ));
    assert_eq!(core.audit.as_slice(), complete_moveset_rng.audit_entries());
    assert_eq!(core_rng, complete_moveset_rng);
    assert_eq!(
        moveset
            .moves
            .iter()
            .map(|id| id.get().get())
            .collect::<Vec<_>>(),
        vec![38, 300, 707, 316]
    );
    assert_eq!(moveset.audit.len(), 4);
    assert_eq!(
        moveset
            .audit
            .iter()
            .map(|draw| (draw.cardinality.get(), draw.result.get()))
            .collect::<Vec<_>>(),
        vec![
            (74_296, 2_192),
            (63_399, 8_533),
            (50_350, 37_661),
            (17_354, 8_440)
        ]
    );
    assert_eq!(prefix.audit.len(), 7);
    assert_eq!(prefix.audit[5].public_api, RngPublicApi::RandSeedFloat);
    assert_eq!(
        prefix.audit[5]
            .fraction_bits
            .as_ref()
            .map(|bits| bits.to_f64()),
        Some(0.2272384697785894)
    );
    assert_eq!(
        constructor_rng
            .run_rand_seed_int(
                SafeU53::new(74_296)?,
                SafeU53::ZERO,
                RngReason::RandomSelector,
                RngCallsiteId::mechanics(RngReason::RandomSelector),
            )?
            .get(),
        2_192
    );

    let before = rng.clone();
    let mut unsupported = context;
    unsupported.luck = 1;
    assert_eq!(
        select_current_town_day_wave_two_root(&content, unsupported, &mut rng),
        Err(CurrentTownWildErrorV1::UnsupportedContext)
    );
    assert_eq!(rng, before);
    unsupported = context;
    unsupported.effective_pool_time = 3;
    assert_eq!(
        select_current_town_day_wave_two_root(&content, unsupported, &mut rng),
        Err(CurrentTownWildErrorV1::UnsupportedContext)
    );
    assert_eq!(rng, before);
    unsupported = context;
    unsupported.time_override = Some(1);
    assert_eq!(
        select_current_town_day_wave_two_root(&content, unsupported, &mut rng),
        Err(CurrentTownWildErrorV1::UnsupportedContext)
    );
    assert_eq!(rng, before);
    Ok(())
}

#[test]
fn naturally_admitted_day_seed_matches_pinned_postreward_enemy() -> Result<(), Box<dyn Error>> {
    // Source run 35910615860 observed this seed twice after actual reward
    // CANCEL and a queued wave-two encounter. Both 2125-byte observations had
    // SHA256 896b56e5d0d4b49d925aeef7cecf30c83bac13271fe518184a464dc91c32b355.
    // Source run 35934274895 additionally observed the scene's seed-derived
    // wave-cycle offset 0 and effective Town pool time DAY at wave two.
    let wave_cycle_offset = source_town_wave_cycle_offset("m9e-town-handoff-308")?;
    assert_eq!(wave_cycle_offset, 0);
    assert_eq!(source_town_time_of_day(2, wave_cycle_offset)?, 1);
    assert_eq!(
        source_town_reset_seed("m9e-town-handoff-308", 2)?
            .rdg
            .state_string,
        "!rnd,1,0.3367574783042073,0.9722058428451419,0.3750058668665588"
    );
    let mut preselection_rng =
        RngRuntime::from_states(source_town_reset_seed("m9e-town-handoff-308", 2)?, None)?;
    // The pinned post-reward seed selects two wave-two wild enemies. This
    // constructor witnesses the first shell only; it does not claim a full
    // 1v1 battle or authorize a participation/XP owner for this encounter.
    assert!(source_town_unboosted_wild_double_roll(
        &mut preselection_rng
    )?);
    assert_eq!(preselection_rng.audit_entries().len(), 1);
    assert_eq!(
        preselection_rng.audit_entries()[0].callsite_id,
        RngCallsiteId::current_wild_double()
    );
    preselection_rng.audit_entries()[0].validate()?;
    assert_eq!(source_town_time_of_day(1, 0)?, 1);
    assert_eq!(source_town_time_of_day(14, 0)?, 1);
    assert_eq!(source_town_time_of_day(15, 0)?, 2);
    assert_eq!(source_town_time_of_day(20, 0)?, 3);
    assert_eq!(source_town_time_of_day(35, 0)?, 0);
    assert_eq!(source_town_time_of_day(40, 0)?, 1);
    assert_eq!(
        source_town_time_of_day(0, 0),
        Err(CurrentTownWildErrorV1::UnsupportedContext)
    );
    assert_eq!(
        source_town_time_of_day(2, 1),
        Err(CurrentTownWildErrorV1::UnsupportedContext)
    );
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle))?;
    let mode = content
        .bundle()
        .world
        .modes
        .iter()
        .find(|mode| mode.key == "CLASSIC")
        .ok_or("Classic mode absent")?;
    let town = content
        .bundle()
        .world
        .biomes
        .iter()
        .find(|biome| biome.key == "biome/0")
        .ok_or("Town absent")?;
    let context = CurrentTownDayWaveTwoContextV1 {
        mode: mode.id,
        biome: town.id,
        difficulty: RunDifficultyV1::Ace,
        wave: 2,
        level: 3,
        luck: 0,
        forced_tier: None,
        encounter_boss_segments: 0,
        regional_boost: false,
        time_override: None,
        effective_pool_time: 1,
        override_species: None,
        golden_bug_net: false,
        excluded_species: &[],
    };
    let mut rng = RngRuntime::from_states(
        RunRngState {
            rdg: PhaserRdgState::from_state_string(
                "!rnd,2033503,0.3750058668665588,0.07516273413784802,0.657086769817397",
            )?,
        },
        None,
    )?;
    assert_eq!(preselection_rng.run_state(), rng.run_state());
    let initial_rng = rng.clone();
    let shell =
        select_current_town_day_wave_two_shell(&content, context, 12_345, 23_456, &mut rng)?;
    let enemy = &shell.pokemon;
    assert_eq!(enemy.id.get().get(), 2_632_721_102);
    let mut identities = GameIdentityAllocatorStateV1::derive(None)?;
    let prior = identities.allocate_pokemon_id()?;
    let before_rejected = identities.clone();
    assert!(identities.adopt_source_pokemon_id(prior).is_err());
    assert_eq!(identities, before_rejected);
    let mut reserved_rng = initial_rng.clone();
    let reserved = select_current_town_day_wave_two_shell_with_identity(
        &content,
        context,
        12_345,
        23_456,
        &mut identities,
        &mut reserved_rng,
    )?;
    assert_eq!(reserved, shell);
    assert_eq!(reserved_rng.run_state(), rng.run_state());
    assert_eq!(identities.next_pokemon_id.get(), 2_632_721_103);
    let before_duplicate = identities.clone();
    let mut rejected_rng = initial_rng;
    let before_rejected_rng = rejected_rng.run_state();
    assert_eq!(
        select_current_town_day_wave_two_shell_with_identity(
            &content,
            context,
            12_345,
            23_456,
            &mut identities,
            &mut rejected_rng,
        ),
        Err(CurrentTownWildErrorV1::IdentityFrontier)
    );
    assert_eq!(identities, before_duplicate);
    assert_eq!(rejected_rng.run_state(), before_rejected_rng);
    assert_eq!(identities.allocate_pokemon_id()?.get().get(), 2_632_721_103);
    assert_eq!(enemy.species_id.get().get(), 504);
    assert_eq!(enemy.form_index, 0);
    assert_eq!(enemy.level, 3);
    assert_eq!(enemy.experience.get().get(), 27);
    assert_eq!(enemy.friendship, 70);
    assert_eq!(shell.core.prefix.ability_index, 1);
    assert_eq!(enemy.abilities.active.get().get(), 198);
    assert_eq!(enemy.ivs.map(|iv| iv.get()), [14, 14, 24, 8, 22, 14]);
    assert_eq!(enemy.nature.get(), 9);
    assert_eq!(
        [
            enemy.stats.hp,
            enemy.stats.attack,
            enemy.stats.defense,
            enemy.stats.special_attack,
            enemy.stats.special_defense,
            enemy.stats.speed,
        ],
        [16, 9, 9, 7, 7, 9]
    );
    assert_eq!(enemy.hp, 16);
    assert_eq!(enemy.gender, Some(0));
    assert!(!enemy.shiny);
    assert_eq!(enemy.variant, 0);
    assert_eq!(enemy.types.primary, PokemonType::Normal);
    assert_eq!(enemy.types.secondary, None);
    assert_eq!(enemy.tera_type, Some(PokemonType::Normal));
    assert_eq!(
        enemy
            .moves
            .iter()
            .map(|slot| slot
                .as_ref()
                .map(|slot| (slot.move_id.get().get(), slot.pp_used)))
            .collect::<Vec<_>>(),
        vec![
            Some((158, 0)),
            Some((95, 0)),
            Some((747, 0)),
            Some((116, 0))
        ]
    );
    Ok(())
}

#[test]
fn source_single_width_town_successor_matches_pinned_shell() -> Result<(), Box<dyn Error>> {
    // Source runs 35938474439 and 35939483631 observed this controlled
    // reward-CANCEL successor twice. Its single wave-two enemy follows a
    // wave-one Town root 440, unlike the old natural Rust bootstrap's 276.
    // These are exact selector/constructor witnesses, not a connected campaign.
    let seed = "m9e-town-handoff-774";
    let offset = source_town_wave_cycle_offset(seed)?;
    assert_eq!(offset, 10);
    assert_eq!(source_town_time_of_day(2, offset)?, 1);
    let mut rng = RngRuntime::from_states(source_town_reset_seed(seed, 2)?, None)?;
    assert_eq!(
        rng.run_state().rdg.state_string,
        "!rnd,1,0.5938717131502926,0.8636611558031291,0.1503892035689205"
    );
    assert!(!source_town_unboosted_wild_double_roll(&mut rng)?);
    assert_eq!(
        rng.run_state().rdg.state_string,
        "!rnd,1806467,0.1503892035689205,0.2362219651695341,0.35655211517587304"
    );
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle))?;
    let mode = content
        .bundle()
        .world
        .modes
        .iter()
        .find(|mode| mode.key == "CLASSIC")
        .ok_or("Classic mode absent")?;
    let town = content
        .bundle()
        .world
        .biomes
        .iter()
        .find(|biome| biome.key == "biome/0")
        .ok_or("Town absent")?;
    let context = CurrentTownDayWaveTwoContextV1 {
        mode: mode.id,
        biome: town.id,
        difficulty: RunDifficultyV1::Ace,
        wave: 2,
        level: 3,
        luck: 0,
        forced_tier: None,
        encounter_boss_segments: 0,
        regional_boost: false,
        time_override: None,
        effective_pool_time: 1,
        override_species: None,
        golden_bug_net: false,
        excluded_species: &[],
    };
    let mut wave_one_rng = RngRuntime::from_states(source_town_reset_seed(seed, 1)?, None)?;
    assert_eq!(
        wave_one_rng.run_state().rdg.state_string,
        "!rnd,1,0.30521855875849724,0.8403703595977277,0.3762277467176318"
    );
    let opening_context = CurrentTownDayWildContextV1 {
        wave: 1,
        level: 2,
        ..context
    };
    let opening =
        select_current_town_day_wave_one_root(&content, opening_context, &mut wave_one_rng)?;
    assert_eq!(opening.source_root.get().get(), 440);
    assert_eq!(opening.effective_species.get().get(), 440);
    assert_eq!(opening.audit.len(), 2);
    let shell =
        select_current_town_day_wave_two_shell(&content, context, 12_345, 23_456, &mut rng)?;
    let enemy = &shell.pokemon;
    assert_eq!(enemy.id.get().get(), 3_131_808_768);
    assert_eq!(enemy.species_id.get().get(), 504);
    assert_eq!(enemy.form_index, 0);
    assert_eq!(enemy.level, 3);
    assert_eq!(enemy.experience.get().get(), 27);
    assert_eq!(enemy.friendship, 70);
    assert_eq!(shell.core.prefix.ability_index, 0);
    assert_eq!(enemy.abilities.active.get().get(), 50);
    assert_eq!(enemy.ivs.map(|iv| iv.get()), [29, 10, 23, 7, 0, 0]);
    assert_eq!(enemy.nature.get(), 9);
    assert_eq!(
        [
            enemy.stats.hp,
            enemy.stats.attack,
            enemy.stats.defense,
            enemy.stats.special_attack,
            enemy.stats.special_defense,
            enemy.stats.speed,
        ],
        [16, 9, 9, 7, 6, 9]
    );
    assert_eq!(enemy.hp, 16);
    assert_eq!(enemy.gender, Some(1));
    assert!(!enemy.shiny);
    assert_eq!(enemy.variant, 0);
    assert_eq!(enemy.types.primary, PokemonType::Normal);
    assert_eq!(enemy.types.secondary, None);
    assert_eq!(enemy.tera_type, Some(PokemonType::Normal));
    assert_eq!(
        enemy
            .moves
            .iter()
            .map(|slot| slot
                .as_ref()
                .map(|slot| (slot.move_id.get().get(), slot.pp_used)))
            .collect::<Vec<_>>(),
        vec![
            Some((158, 0)),
            Some((95, 0)),
            Some((116, 0)),
            Some((747, 0))
        ]
    );
    Ok(())
}

#[test]
fn source_single_width_successor_with_matching_natural_opening() -> Result<(), Box<dyn Error>> {
    // Pinned-source run 35940592984 observed this actual reward-CANCEL path
    // twice from a controlled Bulbasaur. Unlike seed 774, the Town wave-one
    // source selection is species 915, admitted by the natural Rust bootstrap.
    // This still witnesses a selector and shell, not a settled Rust reward.
    let seed = "m9e-town-handoff-5042";
    let offset = source_town_wave_cycle_offset(seed)?;
    assert_eq!(offset, 0);
    assert_eq!(source_town_time_of_day(1, offset)?, 1);
    assert_eq!(source_town_time_of_day(2, offset)?, 1);
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle))?;
    let mode = content
        .bundle()
        .world
        .modes
        .iter()
        .find(|mode| mode.key == "CLASSIC")
        .ok_or("Classic mode absent")?;
    let town = content
        .bundle()
        .world
        .biomes
        .iter()
        .find(|biome| biome.key == "biome/0")
        .ok_or("Town absent")?;
    let context = CurrentTownDayWildContextV1 {
        mode: mode.id,
        biome: town.id,
        difficulty: RunDifficultyV1::Ace,
        wave: 2,
        level: 2,
        luck: 0,
        forced_tier: None,
        encounter_boss_segments: 0,
        regional_boost: false,
        time_override: None,
        effective_pool_time: 1,
        override_species: None,
        golden_bug_net: false,
        excluded_species: &[],
    };
    let mut opening_rng = RngRuntime::from_states(source_town_reset_seed(seed, 1)?, None)?;
    assert_eq!(
        opening_rng.run_state().rdg.state_string,
        "!rnd,1,0.0892196528147906,0.9993383588735014,0.6896555596031249"
    );
    let opening = select_current_town_day_wave_one_root(
        &content,
        CurrentTownDayWildContextV1 { wave: 1, ..context },
        &mut opening_rng,
    )?;
    assert_eq!(opening.source_root.get().get(), 915);
    assert_eq!(opening.effective_species.get().get(), 915);
    let mut rng = RngRuntime::from_states(source_town_reset_seed(seed, 2)?, None)?;
    assert_eq!(
        rng.run_state().rdg.state_string,
        "!rnd,1,0.4178936784155667,0.8274163634050637,0.9964935819152743"
    );
    assert!(!source_town_unboosted_wild_double_roll(&mut rng)?);
    assert_eq!(
        rng.run_state().rdg.state_string,
        "!rnd,1730656,0.9964935819152743,0.7156274577137083,0.33513971720822155"
    );
    let shell =
        select_current_town_day_wave_two_shell(&content, context, 12_345, 23_456, &mut rng)?;
    let enemy = &shell.pokemon;
    assert_eq!(enemy.id.get().get(), 3_273_058_121);
    assert_eq!(enemy.species_id.get().get(), 504);
    assert_eq!(enemy.form_index, 0);
    assert_eq!(enemy.level, 2);
    assert_eq!(enemy.experience.get().get(), 8);
    assert_eq!(enemy.friendship, 70);
    assert_eq!(shell.core.prefix.ability_index, 1);
    assert_eq!(enemy.abilities.active.get().get(), 198);
    assert_eq!(enemy.ivs.map(|iv| iv.get()), [1, 17, 13, 25, 26, 9]);
    assert_eq!(enemy.nature.get(), 23);
    assert_eq!(
        [
            enemy.stats.hp,
            enemy.stats.attack,
            enemy.stats.defense,
            enemy.stats.special_attack,
            enemy.stats.special_defense,
            enemy.stats.speed,
        ],
        [13, 7, 6, 5, 8, 8]
    );
    assert_eq!(enemy.hp, 13);
    assert_eq!(enemy.gender, Some(0));
    assert!(!enemy.shiny);
    assert_eq!(enemy.variant, 0);
    assert_eq!(enemy.types.primary, PokemonType::Normal);
    assert_eq!(enemy.types.secondary, None);
    assert_eq!(enemy.tera_type, Some(PokemonType::Normal));
    assert_eq!(
        enemy
            .moves
            .iter()
            .map(|slot| slot
                .as_ref()
                .map(|slot| (slot.move_id.get().get(), slot.pp_used)))
            .collect::<Vec<_>>(),
        vec![
            Some((158, 0)),
            Some((747, 0)),
            Some((116, 0)),
            Some((95, 0))
        ]
    );
    Ok(())
}

#[test]
fn source_town_opening_shell_matches_classic_level_five_trace() -> Result<(), Box<dyn Error>> {
    // Pinned-source run35942477027 observed the opening before the actual
    // level-five Bulbasaur's two-turn victory and reward-CANCEL handoff.
    // The later explicit-starter probe (run35948078136) captured this exact
    // pre-constructor RNG state and the source-chosen Bulbasaur identity. It
    // does not prove that the full raw starter UI reaches this state.
    let starter_state = PhaserRdgState::from_state_string(
        "!rnd,1,0.16302004898898304,0.7822124343365431,0.41194894444197416",
    )?;
    let mut starter_rng = RngRuntime::from_states(RunRngState { rdg: starter_state }, None)?;
    let starter_id = starter_rng.run_rand_seed_int(
        SafeU53::new(1_u64 << 32)?,
        SafeU53::ZERO,
        RngReason::RandomSelector,
        RngCallsiteId::mechanics(RngReason::RandomSelector),
    )?;
    assert_eq!(starter_id.get(), 396_198_998);
    // Source run35958164614 observed one further constructor draw: Phaser
    // RND.pick chooses the starter's Tera type from Grass/Poison in that order.
    let tera_index = starter_rng.run_pick_index(
        2,
        RngReason::RandomSelector,
        RngCallsiteId::mechanics(RngReason::RandomSelector),
    )?;
    assert_eq!(tera_index, 0);
    assert_eq!(
        starter_rng.run_state().rdg.state_string,
        "!rnd,192947,0.03402264299802482,0.47858460200950503,0.9830058687366545"
    );
    let seed = "m9e-town-handoff-5042";
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle))?;
    let mode = content
        .bundle()
        .world
        .modes
        .iter()
        .find(|mode| mode.key == "CLASSIC")
        .ok_or("Classic mode absent")?;
    let town = content
        .bundle()
        .world
        .biomes
        .iter()
        .find(|biome| biome.key == "biome/0")
        .ok_or("Town absent")?;
    let context = CurrentTownDayWildContextV1 {
        mode: mode.id,
        biome: town.id,
        difficulty: RunDifficultyV1::Ace,
        wave: 1,
        level: 2,
        luck: 0,
        forced_tier: None,
        encounter_boss_segments: 0,
        regional_boost: false,
        time_override: None,
        effective_pool_time: 1,
        override_species: None,
        golden_bug_net: false,
        excluded_species: &[],
    };
    let mut rng = RngRuntime::from_states(source_town_reset_seed(seed, 1)?, None)?;
    let shell =
        select_current_town_day_wave_one_shell(&content, context, 12_345, 23_456, &mut rng)?;
    let enemy = &shell.pokemon;
    assert_eq!(enemy.id.get().get(), 1_173_608_932);
    assert_eq!(enemy.species_id.get().get(), 915);
    assert_eq!(enemy.form_index, 0);
    assert_eq!(enemy.level, 2);
    assert_eq!(enemy.experience.get().get(), 8);
    assert_eq!(enemy.friendship, 50);
    assert_eq!(shell.core.prefix.ability_index, 0);
    assert_eq!(enemy.abilities.active.get().get(), 268);
    assert_eq!(enemy.ivs.map(|iv| iv.get()), [2, 31, 7, 22, 15, 4]);
    assert_eq!(enemy.nature.get(), 1);
    assert_eq!(
        [
            enemy.stats.hp,
            enemy.stats.attack,
            enemy.stats.defense,
            enemy.stats.special_attack,
            enemy.stats.special_defense,
            enemy.stats.speed,
        ],
        [14, 9, 6, 6, 7, 6]
    );
    assert_eq!(enemy.hp, 14);
    assert_eq!(enemy.gender, Some(0));
    assert!(!enemy.shiny);
    assert_eq!(enemy.variant, 0);
    assert_eq!(enemy.types.primary, PokemonType::Normal);
    assert_eq!(enemy.types.secondary, None);
    assert_eq!(enemy.tera_type, Some(PokemonType::Normal));
    assert_eq!(
        enemy
            .moves
            .iter()
            .map(|slot| slot
                .as_ref()
                .map(|slot| (slot.move_id.get().get(), slot.pp_used)))
            .collect::<Vec<_>>(),
        vec![Some((158, 0)), Some((230, 0)), Some((39, 0)), Some((98, 0))]
    );
    Ok(())
}
