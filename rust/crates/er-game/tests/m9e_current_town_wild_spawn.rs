use std::error::Error;
use std::sync::Arc;

use er_game::current_town_wild_spawn::{
    CurrentTownDayWaveTwoContextV1, CurrentTownGenderV1, CurrentTownWildErrorV1,
    select_current_town_day_wave_two_constructor_prefix, select_current_town_day_wave_two_root,
    source_town_ability_id, source_town_day_pools, source_town_ivs_from_id, source_town_level_two_species,
    source_town_male_half_percent,
};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_rng::audit::{RngCallsiteId, RngPublicApi, RngReason};
use er_rng::battle::RngRuntime;
use er_rng::phaser::{PhaserRdgState, RunRngState};
use er_types::battle_ids::SpeciesId;
use er_types::run_ids::BiomeId;
use er_types::{RunDifficultyV1, SafeU53};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
const SOURCE_GENDER: &[u8] = include_bytes!("../../../fixtures/m9/engineering/town-gender-v1.json");
const SOURCE_FORM_FLAGS: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/town-form-flags-v1.json");
const SOURCE_ABILITY_SLOTS: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/town-ability-slots-v1.json");
const SOURCE_BEFORE: &str = "!rnd,789153,0.5761283298488706,0.7223087239544839,0.22977968817576766";
const SOURCE_AFTER_SELECTION: &str =
    "!rnd,1012145,0.09734400571323931,0.1575480371247977,0.15997060341760516";

#[test]
fn entire_town_day_pool_and_actual_wave_two_source_draw_match() -> Result<(), Box<dyn Error>> {
    // Source399d direct queued NextEncounter observation in run34704520605:
    // tier integer 247/512, common pool index 3/24, root263. That probe's
    // retained run stream and its effective DAY pool are directly observed;
    // this isolated selector test does not claim a causal natural reward receipt.
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle))?;
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
    assert_eq!(gender["source"], "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7");
    assert_eq!(form_flags["source"], gender["source"]);
    assert_eq!(ability_slots["source"], gender["source"]);
    assert_eq!(gender["rows"].as_array().ok_or("gender rows")?.len(), 163);
    assert_eq!(form_flags["rows"].as_array().ok_or("form rows")?.len(), 163);
    assert_eq!(ability_slots["rows"].as_array().ok_or("ability slot rows")?.len(), 163);
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
