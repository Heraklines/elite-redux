//! Renderer-independent Showdown-compatible team validation.

use er_content::pack::m6_prepared::PreparedBattleContentV3;
use er_types::battle_ids::{AbilityId, MoveId, SpeciesId};
use er_types::run_ids::NatureId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShowdownTeamV1 {
    pub members: Vec<ShowdownPokemonV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShowdownPokemonV1 {
    pub species: SpeciesId,
    pub form_index: u16,
    pub level: u16,
    pub nature: NatureId,
    pub moves: Vec<MoveId>,
    pub active_ability: AbilityId,
    pub passive_abilities: [Option<AbilityId>; 3],
    pub held_items: Vec<String>,
    pub tera_type: Option<er_types::battle_model::PokemonType>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ShowdownValidationError {
    #[error("team must contain one through six Pokémon")]
    TeamSize,
    #[error("team member {index} references unknown species, form, move, ability, or item content")]
    Content { index: usize },
    #[error("team member {index} has invalid level, move closure, passive order, or item order")]
    Member { index: usize },
}

pub fn validate_showdown_team(
    team: &ShowdownTeamV1,
    content: &PreparedBattleContentV3,
) -> Result<(), ShowdownValidationError> {
    if team.members.is_empty() || team.members.len() > 6 {
        return Err(ShowdownValidationError::TeamSize);
    }
    for (index, member) in team.members.iter().enumerate() {
        let species = content
            .species(member.species)
            .map_err(|_| ShowdownValidationError::Content { index })?;
        if member.level == 0
            || member.level > 10_000
            || member.moves.is_empty()
            || member.moves.len() > 4
            || member.moves.windows(2).any(|pair| pair[0] >= pair[1])
            || member.held_items.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err(ShowdownValidationError::Member { index });
        }
        let expected_form_count = species.form_ids.len().max(1);
        if usize::from(member.form_index) >= expected_form_count
            || member.active_ability != species.ability_slots.active
            || member.passive_abilities != species.ability_slots.passives
        {
            return Err(ShowdownValidationError::Content { index });
        }
        for move_id in &member.moves {
            content
                .move_definition(*move_id)
                .map_err(|_| ShowdownValidationError::Content { index })?;
        }
        content
            .ability_definition(member.active_ability)
            .map_err(|_| ShowdownValidationError::Content { index })?;
        for ability in member.passive_abilities.iter().flatten() {
            content
                .ability_definition(*ability)
                .map_err(|_| ShowdownValidationError::Content { index })?;
        }
        for item in &member.held_items {
            content
                .held_item(item)
                .map_err(|_| ShowdownValidationError::Content { index })?;
        }
    }
    Ok(())
}
