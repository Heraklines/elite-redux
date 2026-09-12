//! Initial solo Flash Egg descendant. Its caller owns the first-unlock request.
//! The pool is generated remotely from the initialized pinned source registry.
use er_rng::phaser::PhaserRdg;
use er_state::current_achievement_execution::CurrentFlashEggInputsV1;
use er_state::current_egg_account::{CurrentEggAccountV1, CurrentSourceEggV1};
use er_types::{SafeU53, battle_ids::SpeciesId};

use crate::m9e_runtime_v6::GameRuntimeV6Error;

#[path = "current_flash_egg_pool.rs"]
mod pool;

fn failure() -> GameRuntimeV6Error {
    GameRuntimeV6Error::Action
}

/// A local temporary source RNG reproduces executeWithSeedOffset(seed, 0).
/// No live run/battle RNG is passed to, borrowed by, or changed in this helper.
/// Account admission and exact outstanding request validation remain mandatory
/// in the common material dispatcher; this arithmetic helper is not authority.
pub(crate) fn prepare_initial_flash_egg(
    account: &CurrentEggAccountV1,
    input: &CurrentFlashEggInputsV1,
) -> Result<CurrentEggAccountV1, GameRuntimeV6Error> {
    account.validate().map_err(|_| failure())?;
    if !input.valid()
        || !account.eggs.is_empty()
        || account.unlock_pity != [SafeU53::ZERO; 4]
        || !account.same_species_counters.is_empty()
    {
        return Err(failure());
    }
    const ALPHABET: &[u8; 62] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut seed = String::with_capacity(24);
    for draw in &input.seed_draws {
        let index = (draw.value().ok_or_else(failure)? * 62.0).floor() as usize;
        seed.push(char::from(*ALPHABET.get(index).ok_or_else(failure)?));
    }
    let id = (input.id_draw.value().ok_or_else(failure)? * 1_073_741_824.0).floor() as u64
        + 1_073_741_824;
    let mut rng = PhaserRdg::from_seed(&seed);
    let total = u64::from(pool::RARE_EVENT_POOL.last().ok_or_else(failure)?.1);
    let draw = rng
        .integer_in_range(
            SafeU53::ZERO,
            SafeU53::new(total - 1).map_err(|_| failure())?,
        )
        .map_err(|_| failure())?
        .get();
    let &(species, _, fresh_caught) = pool::RARE_EVENT_POOL
        .iter()
        .find(|(_, upper, _)| draw < u64::from(*upper))
        .ok_or_else(failure)?;
    let rare = rng
        .integer_in_range(
            SafeU53::ZERO,
            SafeU53::new(pool::RARE_EGG_MOVE_RATE - 1).map_err(|_| failure())?,
        )
        .map_err(|_| failure())?
        .get();
    let egg_move_index = if rare == 0 {
        3
    } else {
        u8::try_from(
            rng.integer_in_range(SafeU53::ZERO, SafeU53::new(2).map_err(|_| failure())?)
                .map_err(|_| failure())?
                .get(),
        )
        .map_err(|_| failure())?
    };
    let mut candidate = account.clone();
    candidate.unlock_pity[1] = SafeU53::new(u64::from(fresh_caught)).map_err(|_| failure())?;
    candidate.eggs.push(CurrentSourceEggV1 {
        id: SafeU53::new(id).map_err(|_| failure())?,
        tier: 1,
        source_type: 4,
        hatch_waves: 25,
        timestamp: input.egg_utc_milliseconds,
        variant_tier: 0,
        is_shiny: false,
        species: SpeciesId::new(SafeU53::new(u64::from(species)).map_err(|_| failure())?),
        egg_move_index,
        override_hidden_ability: false,
    });
    candidate.validate().map_err(|_| failure())?;
    Ok(candidate)
}
