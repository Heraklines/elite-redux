//! Actual initial Classic wild Battle constructor's isolated seed/level work.
//! Caller admission must own the ordinary solo Town context and curve values.
use crate::m9e_runtime_v6::GameRuntimeV6Error;
#[cfg(test)]
use er_rng::phaser::PhaserRdgState;
use er_rng::phaser::{PhaserRdg, shift_char_codes};
use er_types::SafeU53;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CurrentInitialBattleConstructionV1 {
    pub wave_seed: String,
    pub battle_seed: String,
    pub enemy_level: u16,
    #[cfg(test)]
    pub level_rng_before: PhaserRdgState,
    #[cfg(test)]
    pub level_rng_after: PhaserRdgState,
}

/// The source's field initializer consumes randomString(16, true) before
/// getLevelForWave. Both execute under offset (wave << 3) from the wave seed;
/// their temporary RNG never mutates the outer encounter-generation stream.
/// This only implements the initial ordinary wave, not trainer/boss, Hell,
/// Jungle, notoriety, gauntlet or editor-overridden level contexts.
pub(crate) fn construct_current_initial_battle(
    run_seed: &str,
    wave_slope: f64,
    quadratic_divisor: f64,
) -> Result<CurrentInitialBattleConstructionV1, GameRuntimeV6Error> {
    let failure = || GameRuntimeV6Error::Action;
    if run_seed.is_empty()
        || !wave_slope.is_finite()
        || wave_slope <= 0.0
        || !quadratic_divisor.is_finite()
        || quadratic_divisor <= 0.0
    {
        return Err(failure());
    }
    let wave_seed = shift_char_codes(run_seed, 1).map_err(|_| failure())?;
    let scoped_seed = shift_char_codes(&wave_seed, 8).map_err(|_| failure())?;
    let mut rng = PhaserRdg::from_seed(&scoped_seed);
    const ALPHABET: &[u8; 62] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut battle_seed = String::with_capacity(16);
    for _ in 0..16 {
        let index = rng
            .integer_in_range(SafeU53::ZERO, SafeU53::new(61).map_err(|_| failure())?)
            .map_err(|_| failure())?
            .get() as usize;
        battle_seed.push(char::from(*ALPHABET.get(index).ok_or_else(failure)?));
    }
    #[cfg(test)]
    let level_rng_before = rng.state();
    let mut sum = 0.0;
    for _ in 0..10 {
        sum += rng.frac();
    }
    // Preserve source Number evaluation order and Math.round on positive values.
    let base = 1.0 + 1.0 / wave_slope + (1.0 / quadratic_divisor).powi(2);
    let rounded = (base + (sum / 10.0_f64).abs()).round().max(1.0);
    if !rounded.is_finite() || rounded > f64::from(u16::MAX) {
        return Err(failure());
    }
    Ok(CurrentInitialBattleConstructionV1 {
        wave_seed,
        battle_seed,
        enemy_level: rounded as u16,
        #[cfg(test)]
        level_rng_before,
        #[cfg(test)]
        level_rng_after: rng.state(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_classic_constructor_matches_actual_source_seed_and_level() {
        // Source399d actual GameManager constructor, qualified by two identical
        // observations in run34694155305 on b220ef92 (not a desired output).
        let constructed = construct_current_initial_battle("test", 2.0, 25.0)
            .expect("qualified ordinary initial constructor");
        assert_eq!(constructed.wave_seed, "uftu");
        assert_eq!(constructed.battle_seed, "jfJR8ChSJpD2mvUt");
        assert_eq!(constructed.enemy_level, 2);
        // V6 source observer run34694502130/a1cdc06f records both sides
        // of the delegated actual getLevelForWave call, not a reimplementation.
        assert_eq!(
            constructed.level_rng_before.state_string,
            "!rnd,696234,0.050779115641489625,0.7305614135693759,0.37434818921610713"
        );
        assert_eq!(
            constructed.level_rng_after.state_string,
            "!rnd,604786,0.44064633874222636,0.9905349549371749,0.02510642446577549"
        );
        let mut runtime = er_rng::battle::RngRuntime::from_run_seed("outer-encounter-stream");
        let before = runtime.run_state();
        let battle = runtime
            .initialize_battle(
                &constructed.wave_seed,
                er_types::battle_ids::WaveIndex::new(SafeU53::new(1).expect("safe wave"))
                    .expect("positive wave"),
            )
            .expect("current battle seed admission");
        assert_eq!(battle.battle_seed, constructed.battle_seed);
        assert_eq!(
            runtime.run_state(),
            before,
            "isolated constructor preserves encounter RNG"
        );
    }
}
