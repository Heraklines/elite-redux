use std::error::Error;
use std::sync::Arc;

use er_game::current_town_wild_spawn::{
    CurrentTownDayWaveTwoContextV1, CurrentTownWildErrorV1, select_current_town_day_wave_two_root,
    source_town_day_pools, source_town_level_two_species,
};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_rng::battle::RngRuntime;
use er_rng::phaser::{PhaserRdg, PhaserRdgState, RunRngState};
use er_types::battle_ids::SpeciesId;
use er_types::run_ids::BiomeId;
use er_types::{RunDifficultyV1, SafeU53};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
const SOURCE_BEFORE: &str = "!rnd,789153,0.5761283298488706,0.7223087239544839,0.22977968817576766";
const SOURCE_AFTER_SELECTION: &str =
    "!rnd,1012145,0.09734400571323931,0.1575480371247977,0.15997060341760516";

#[test]
fn entire_town_day_pool_and_actual_wave_two_source_draw_match() -> Result<(), Box<dyn Error>> {
    // Source399d direct queued NextEncounter observation in run34704520605:
    // tier integer 247/512, common pool index 3/24, root263. It records the
    // exact run stream on both sides of randomSpecies, not a sampled lookup.
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
    assert_eq!(
        source_town_level_two_species(SpeciesId::new(SafeU53::new(9999)?)),
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
        run_seed: "test",
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
        override_species: None,
        golden_bug_net: false,
        excluded_species: &[],
    };
    let mut offset_probe = PhaserRdg::from_seed(context.run_seed);
    let offset = offset_probe
        .rand_seed_int(SafeU53::new(8)?, SafeU53::ZERO)?
        .get()
        * 5;
    eprintln!(
        "town context oracle={} mode={} supported={} cooperative={} challenge={} wave_offset={} time_remainder={}",
        content.identity().oracle_sha,
        mode.key,
        mode.supported,
        mode.cooperative,
        mode.challenge_selection,
        offset,
        (u64::from(context.wave) + offset) % 40
    );
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

    let before = rng.clone();
    let mut unsupported = context;
    unsupported.luck = 1;
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
