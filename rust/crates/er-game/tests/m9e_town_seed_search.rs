//! Bounded remote-only diagnostic for a natural Town wave-two successor seed.
use std::{error::Error, sync::Arc};

use er_game::current_town_wild_spawn::{
    CurrentTownDayWaveTwoContextV1, select_current_town_day_wave_two_root,
};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_rng::battle::RngRuntime;
use er_rng::phaser::{PhaserRdg, RunRngState, shift_char_codes};
use er_types::{RunDifficultyV1, SafeU53};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

#[test]
fn bounded_source_wave_two_seed_candidates() -> Result<(), Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle))?;
    let world = &content.bundle().world;
    let mode = world
        .modes
        .iter()
        .find(|mode| mode.key == "CLASSIC")
        .ok_or("Classic mode absent")?;
    let town = world
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
    let mut found = 0;
    for index in 0..4096 {
        let seed = format!("m9e-town-handoff-{index}");
        // Source BattleScene.setSeed computes a stable time-cycle offset from
        // randSeedInt(8) * 5 before the first encounter. Retain only seeds
        // whose wave-one and wave-two Town pools are both actually DAY.
        let mut time_rng = PhaserRdg::from_seed(&seed);
        let time_offset = time_rng
            .rand_seed_int(SafeU53::new(8)?, SafeU53::ZERO)?
            .get()
            * 5;
        if (1 + time_offset) % 40 >= 15 || (2 + time_offset) % 40 >= 15 {
            continue;
        }
        let mut wave_rng = PhaserRdg::from_seed(&shift_char_codes(&seed, 2)?);
        // The first source wave-two draw is the ordinary 1-in-8 wild width
        // roll. The currently observed seed chooses a double battle, which
        // cannot carry the existing 1v1 participation and XP owner.
        if wave_rng.rand_seed_int(SafeU53::new(8)?, SafeU53::ZERO)? == SafeU53::ZERO {
            continue;
        }
        let mut rng = RngRuntime::from_states(
            RunRngState {
                rdg: wave_rng.state(),
            },
            None,
        )?;
        if let Ok(root) = select_current_town_day_wave_two_root(&content, context, &mut rng) {
            assert_eq!(root.source_root.get().get(), 504);
            println!(
                "candidate={seed} before={} time_offset={time_offset}",
                wave_rng.state().state_string
            );
            found += 1;
            if found == 24 {
                break;
            }
        }
    }
    assert_eq!(
        found, 24,
        "bounded search did not find twenty-four source DAY Town candidates"
    );
    Ok(())
}
