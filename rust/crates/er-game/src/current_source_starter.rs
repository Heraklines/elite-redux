//! Selected source starter construction from an already owned UI RNG frontier.
//! The caller must preserve the actual account selection and Title routing
//! history; this function does not infer either from a species ID.

use super::{NaturalRunV6Error, pokemon};
use crate::m9e_content_v2::PreparedGameContentV2;
use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::RngRuntime;
use er_rng::phaser::PhaserRdg;
use er_state::m7_state::PokemonStateV5;
use er_state::pokemon_v2::Iv;
use er_types::battle_ids::{MoveId, SpeciesId};
use er_types::battle_model::{MoveSlotState, PokemonType};
use er_types::{FormId, SafeU53, SeatId};

// Pinned source constants.ts defaultStarterSpecies, in UI order.
const FRESH_STARTER_SPECIES: [u32; 27] = [
    1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722, 725,
    728, 810, 813, 816, 906, 909, 912,
];
const NEUTRAL_NATURES: [u8; 5] = [0, 6, 12, 18, 24];
// Source initBiomes has 36 entries. Fresh Town routing excludes Town itself,
// End (non-travel), and Plains (Town's sole base link).
const FRESH_TOWN_EXTRA_CANDIDATES: usize = 33;

/// Consume the actual TitlePhase.end Town route rolls before starter selection.
/// The graph is cleared at new-run launch, but these run-stream draws persist.
/// This is only the fresh Town / no-previous-biome source configuration.
pub fn advance_current_town_title_routes_v1(
    rng: &mut RngRuntime,
) -> Result<usize, NaturalRunV6Error> {
    let mut staged = rng.clone();
    let mut extras = 0;
    let mut attempts = 0;
    for _ in 0..FRESH_TOWN_EXTRA_CANDIDATES {
        if extras == 3 {
            break;
        }
        let roll = staged
            .run_rand_seed_int(
                SafeU53::new(100).map_err(|_| NaturalRunV6Error::Invalid)?,
                SafeU53::ZERO,
                RngReason::RandomSelector,
                RngCallsiteId::mechanics(RngReason::RandomSelector),
            )
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
        attempts += 1;
        if roll.get() < 50 {
            extras += 1;
        }
    }
    *rng = staged;
    Ok(attempts)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentFreshStarterAccountEntryV1 {
    pub species: SpeciesId,
    pub seen_attr: u64,
    pub caught_attr: u64,
    pub nature_attr: u32,
    pub ivs: [u8; 6],
    pub ability_attr: u8,
    pub passive_attr: u8,
    pub egg_moves: u8,
    pub has_saved_moveset: bool,
}

/// Reproduce the source's fresh dex and starter-data defaults in their UI order.
/// executeWithSeedOffset(0, "default") uses an isolated Phaser stream, so
/// these draws never change the owned run RNG.
pub fn current_fresh_starter_account_v1()
-> Result<Vec<CurrentFreshStarterAccountEntryV1>, NaturalRunV6Error> {
    let mut rng = PhaserRdg::from_seed("default");
    FRESH_STARTER_SPECIES
        .into_iter()
        .map(|species| {
            let species = SpeciesId::new(
                SafeU53::new(u64::from(species)).map_err(|_| NaturalRunV6Error::Invalid)?,
            );
            let nature_index = rng
                .pick_index(NEUTRAL_NATURES.len())
                .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
            let nature = NEUTRAL_NATURES[nature_index];
            Ok(CurrentFreshStarterAccountEntryV1 {
                species,
                seen_attr: 157,
                caught_attr: 157,
                nature_attr: 1_u32 << (nature + 1),
                ivs: [15; 6],
                ability_attr: 1,
                passive_attr: 0,
                egg_moves: 0,
                has_saved_moveset: false,
            })
        })
        .collect()
}

/// The fresh starter grid seeds its moves from the first four distinct level
/// moves at levels 1–5, in source order. Fresh accounts have no saved moveset
/// or unlocked egg moves to alter this initial choice.
pub fn current_fresh_starter_moves_v1(
    content: &PreparedGameContentV2,
    species: SpeciesId,
) -> Result<Vec<MoveId>, NaturalRunV6Error> {
    if !FRESH_STARTER_SPECIES
        .contains(&u32::try_from(species.get().get()).map_err(|_| NaturalRunV6Error::Invalid)?)
    {
        return Err(NaturalRunV6Error::Invalid);
    }
    let progression = content
        .progression
        .species(species, 0)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let mut moves = Vec::new();
    for entry in &progression.level_moves {
        if entry.level > 0
            && entry.level <= 5
            && !moves.contains(&entry.move_id)
            && content.battle.move_definition(entry.move_id).is_ok()
        {
            moves.push(entry.move_id);
            if moves.len() == 4 {
                break;
            }
        }
    }
    if moves.is_empty() {
        return Err(NaturalRunV6Error::Invalid);
    }
    Ok(moves)
}

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

/// Rebuild the untouched fresh starter-grid selection. The source defaults to
/// male, first ability, its sole fresh-account nature, the first four early
/// moves, and the species' primary Tera type. Alternate UI choices must be
/// carried explicitly through CurrentSourceStarterInputV1 instead.
pub fn current_fresh_default_starter_input_v1(
    content: &PreparedGameContentV2,
    species: SpeciesId,
    owner: SeatId,
    pokerus: bool,
) -> Result<CurrentSourceStarterInputV1, NaturalRunV6Error> {
    let account = current_fresh_starter_account_v1()?
        .into_iter()
        .find(|entry| entry.species == species)
        .ok_or(NaturalRunV6Error::Invalid)?;
    if !account.nature_attr.is_power_of_two() {
        return Err(NaturalRunV6Error::Invalid);
    }
    let nature_bit = account.nature_attr.trailing_zeros();
    let nature_index = u8::try_from(nature_bit.checked_sub(1).ok_or(NaturalRunV6Error::Invalid)?)
        .map_err(|_| NaturalRunV6Error::Invalid)?;
    let tera_type = content
        .battle
        .species(species)
        .map_err(|_| NaturalRunV6Error::Invalid)?
        .typing
        .primary;
    Ok(CurrentSourceStarterInputV1 {
        species,
        form_index: 0,
        ability_index: 0,
        level: 5,
        owner,
        gender: 0,
        shiny: false,
        variant: 0,
        ivs: account.ivs,
        nature_index,
        moves: current_fresh_starter_moves_v1(content, species)?,
        tera_type,
        pokerus,
    })
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
        // The constructor's random Tera choice is consumed, then
        // SelectStarterPhase overwrites it with the UI-selected type.
        staged
            .run_pick_index(types.len(), reason, callsite)
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
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
