//! Selected source starter construction from an already owned UI RNG frontier.
//! The caller must preserve the actual account selection and Title routing
//! history; this function does not infer either from a species ID.

use super::{NaturalRunV6Error, pokemon};
use crate::m9e_content_v2::PreparedGameContentV2;
use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::RngRuntime;
use er_state::m7_state::PokemonStateV5;
use er_state::pokemon_v2::Iv;
use er_types::battle_ids::{MoveId, SpeciesId};
use er_types::battle_model::{MoveSlotState, PokemonType};
use er_types::{FormId, SafeU53, SeatId};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentSourceStarterInputV1 {
    pub species: SpeciesId,
    pub form_index: u16,
    pub ability_index: u8,
    pub level: u16,
    pub owner: SeatId,
    pub gender: u8,
    pub shiny: bool,
    pub variant: u8,
    pub ivs: [u8; 6],
    pub nature_index: u8,
    pub moves: Vec<MoveId>,
    pub tera_type: PokemonType,
    pub pokerus: bool,
}

/// Consume the source Pokemon constructor's ID and type-pick draws atomically.
/// For now this admits the fresh ordinary nonshiny, first-ability form-zero
/// subset. It does not authenticate account unlocks or the prior UI route roll.
pub fn construct_current_source_starter_v1(
    content: &PreparedGameContentV2,
    input: &CurrentSourceStarterInputV1,
    rng: &mut RngRuntime,
) -> Result<PokemonStateV5, NaturalRunV6Error> {
    if input.species.get() == SafeU53::ZERO
        || input.level == 0
        || input.owner.get() == SafeU53::ZERO
        || input.form_index != 0
        || input.ability_index != 0
        || input.gender > 1
        || input.shiny
        || input.variant != 0
        || input.moves.is_empty()
        || input.moves.len() > 4
        || input.moves.iter().enumerate().any(|(index, id)| {
            input.moves[..index].contains(id) || content.battle.move_definition(*id).is_err()
        })
    {
        return Err(NaturalRunV6Error::Invalid);
    }
    let species = content
        .battle
        .species(input.species)
        .map_err(|_| NaturalRunV6Error::Invalid)?;
    let form_id = FormId::parse(format!(
        "{}:{}",
        input.species.get().get(),
        input.form_index
    ))
    .map_err(|_| NaturalRunV6Error::Invalid)?;
    let form = content
        .battle
        .form(&form_id)
        .map_err(|_| NaturalRunV6Error::Invalid)?;
    let typing = form.typing_override.unwrap_or(species.typing);
    let types = if let Some(secondary) = typing.secondary {
        vec![typing.primary, secondary]
    } else {
        vec![typing.primary]
    };
    if !types.contains(&input.tera_type) {
        return Err(NaturalRunV6Error::Invalid);
    }
    let nature = content
        .progression
        .pack()
        .natures
        .iter()
        .find(|nature| nature.id.get() == input.nature_index)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let ivs = input
        .ivs
        .map(|value| Iv::new(value).map_err(|_| NaturalRunV6Error::Invalid))
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?
        .try_into()
        .map_err(|_| NaturalRunV6Error::Invalid)?;
    let mut staged = rng.clone();
    let reason = RngReason::RandomSelector;
    let callsite = RngCallsiteId::mechanics(reason);
    let id = staged
        .run_rand_seed_int(
            SafeU53::new(1_u64 << 32).map_err(|_| NaturalRunV6Error::Invalid)?,
            SafeU53::ZERO,
            reason,
            callsite.clone(),
        )
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    if id == SafeU53::ZERO {
        return Err(NaturalRunV6Error::Invalid);
    }
    if types.len() > 1 {
        let selected_index = staged
            .run_pick_index(types.len(), reason, callsite)
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
        if types[selected_index] != input.tera_type {
            return Err(NaturalRunV6Error::Invalid);
        }
    }
    let id = er_types::battle_ids::PokemonId::new(id);
    // The generic constructor fills stable state fields. Its own IV/nature
    // draws run on a disposable copy; selected account values and the source
    // constructor's two actual draws determine the committed state.
    let mut disposable_rng = staged.clone();
    let mut pokemon = pokemon(
        content,
        &mut disposable_rng,
        id,
        Some(input.owner),
        input.species,
        input.form_index,
        input.level,
    )?;
    pokemon.ivs = ivs;
    pokemon.gender = Some(input.gender);
    pokemon.nature = nature.id;
    pokemon.effective_nature = nature.id;
    pokemon.shiny = input.shiny;
    pokemon.variant = input.variant;
    pokemon.pokerus = Some(input.pokerus);
    pokemon.tera_type = Some(input.tera_type);
    pokemon.moves = std::array::from_fn(|index| {
        input.moves.get(index).map(|move_id| MoveSlotState {
            move_id: *move_id,
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        })
    });
    let base = form.stat_override.unwrap_or(species.base_stats);
    let stats =
        er_progression::current_stats::calculate_current_unmodified_stats(&pokemon, base, nature)
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    pokemon.stats = stats;
    pokemon.max_hp = stats.hp;
    pokemon.hp = stats.hp;
    *rng = staged;
    Ok(pokemon)
}
