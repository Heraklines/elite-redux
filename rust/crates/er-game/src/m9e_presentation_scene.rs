//! Player-safe current scene projection. Browser renderers never need a full
//! mechanical state snapshot to identify actors or draw visible battle values.

use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ids::{BattleSide, FieldSlot, PokemonId, SpeciesId};
use er_types::battle_model::StatusKind;
use er_types::{GameControlPlanV2, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const CURRENT_PRESENTATION_SCENE_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum CurrentVisibleHpV1 {
    PlayerExact { hp: u32, max_hp: u32 },
    EnemyBar { ten_thousandths: u16 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentPresentationActorV1 {
    pub slot: FieldSlot,
    pub pokemon: PokemonId,
    pub species: SpeciesId,
    pub form: u16,
    pub owner_seat: Option<SeatId>,
    pub status: StatusKind,
    pub hp: CurrentVisibleHpV1,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentPresentationSceneV1 {
    pub schema_version: u32,
    pub control: GameControlPlanV2,
    pub actors: Vec<CurrentPresentationActorV1>,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum CurrentPresentationSceneErrorV1 {
    #[error("battle field actor or visible HP is invalid")]
    InvalidActor,
}

pub fn project_current_presentation_scene_v1(
    state: Option<&GameStateV6>,
    control: &GameControlPlanV2,
) -> Result<CurrentPresentationSceneV1, CurrentPresentationSceneErrorV1> {
    let mut actors = Vec::new();
    if let Some(run) = state.and_then(|state| state.active_run.as_ref())
        && let Some(battle) = &run.battle
    {
        actors.reserve(battle.field.slots.len());
        for entry in &battle.field.slots {
            let Some(id) = entry.occupant else { continue };
            let party = match entry.slot.side {
                BattleSide::Player => &run.party,
                BattleSide::Enemy => &battle.enemy_party,
            };
            let pokemon = party
                .iter()
                .find(|pokemon| pokemon.id == id)
                .ok_or(CurrentPresentationSceneErrorV1::InvalidActor)?;
            if pokemon.max_hp == 0 || pokemon.hp > pokemon.max_hp {
                return Err(CurrentPresentationSceneErrorV1::InvalidActor);
            }
            let hp = match entry.slot.side {
                BattleSide::Player => CurrentVisibleHpV1::PlayerExact {
                    hp: pokemon.hp,
                    max_hp: pokemon.max_hp,
                },
                BattleSide::Enemy => CurrentVisibleHpV1::EnemyBar {
                    ten_thousandths: (u64::from(pokemon.hp) * 10_000
                        / u64::from(pokemon.max_hp)) as u16,
                },
            };
            actors.push(CurrentPresentationActorV1 {
                slot: entry.slot,
                pokemon: id,
                species: pokemon.species_id,
                form: pokemon.form_index,
                owner_seat: pokemon.owner_seat,
                status: pokemon.status.kind,
                hp,
            });
        }
    }
    Ok(CurrentPresentationSceneV1 {
        schema_version: CURRENT_PRESENTATION_SCENE_SCHEMA_VERSION_V1,
        control: control.clone(),
        actors,
    })
}
