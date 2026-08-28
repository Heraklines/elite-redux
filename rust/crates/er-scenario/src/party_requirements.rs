//! Typed party predicates and party-owning mystery encounter transitions.
use std::collections::{BTreeMap, BTreeSet};

use er_state::m7_state::{HeldItemOwnershipStateV1, PokemonStateV5};
use er_state::pokemon::StatusKind;
use er_types::battle_ids::{AbilityId, MoveId, PokemonId, SpeciesId};
use er_types::battle_model::PokemonType;
use er_types::run_ids::NatureId;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PartyRequirementV1 {
    Any,
    CombinationSpecies(BTreeSet<SpeciesId>),
    PartySize {
        minimum: usize,
        maximum: usize,
    },
    Species(BTreeSet<SpeciesId>),
    Nature(NatureId),
    Type(PokemonType),
    Move(MoveId),
    CompatibleMove(MoveId),
    Ability(AbilityId),
    Status(StatusKind),
    FormChangeItem(String),
    HeldItem(String),
    AttackTypeBooster(String),
    Level {
        minimum: u16,
        maximum: Option<u16>,
    },
    Friendship {
        minimum: u16,
    },
    HealthRatio {
        minimum_numerator: u32,
        denominator: u32,
    },
    Weight {
        minimum: u32,
    },
    CanLearnMove(MoveId),
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PartyRequirementContextV1 {
    pub compatible_moves: BTreeMap<PokemonId, BTreeSet<MoveId>>,
    pub learnable_moves: BTreeMap<PokemonId, BTreeSet<MoveId>>,
    pub weights: BTreeMap<PokemonId, u32>,
}

impl PartyRequirementV1 {
    pub fn query_party(
        &self,
        party: &[PokemonStateV5],
        context: &PartyRequirementContextV1,
    ) -> Vec<PokemonId> {
        match self {
            Self::CombinationSpecies(required) => {
                let present = party
                    .iter()
                    .map(|pokemon| pokemon.species_id)
                    .collect::<BTreeSet<_>>();
                if required.is_subset(&present) {
                    party.iter().map(|pokemon| pokemon.id).collect()
                } else {
                    Vec::new()
                }
            }
            Self::PartySize { minimum, maximum } => {
                if self.meets_party_size(party.len()) {
                    party.iter().map(|pokemon| pokemon.id).collect()
                } else {
                    Vec::new()
                }
            }
            _ => party
                .iter()
                .filter(|pokemon| self.matches_pokemon(pokemon, context))
                .map(|pokemon| pokemon.id)
                .collect(),
        }
    }

    pub fn meets_party_size(&self, size: usize) -> bool {
        match self {
            Self::PartySize { minimum, maximum } => size >= *minimum && size <= *maximum,
            _ => false,
        }
    }

    pub fn dialogue_token(&self) -> Option<String> {
        match self {
            Self::PartySize { minimum, maximum } if minimum == maximum => Some(minimum.to_string()),
            Self::PartySize { minimum, maximum } => Some(format!("{minimum}-{maximum}")),
            _ => None,
        }
    }

    fn matches_pokemon(
        &self,
        pokemon: &PokemonStateV5,
        context: &PartyRequirementContextV1,
    ) -> bool {
        match self {
            Self::Any => true,
            Self::Species(species) => species.contains(&pokemon.species_id),
            Self::Nature(nature) => pokemon.effective_nature == *nature,
            Self::Type(type_id) => {
                pokemon.types.primary == *type_id || pokemon.types.secondary == Some(*type_id)
            }
            Self::Move(move_id) => pokemon
                .moves
                .iter()
                .flatten()
                .any(|slot| slot.move_id == *move_id),
            Self::CompatibleMove(move_id) => context
                .compatible_moves
                .get(&pokemon.id)
                .is_some_and(|moves| moves.contains(move_id)),
            Self::Ability(ability) => {
                pokemon.abilities.active == *ability
                    || pokemon
                        .abilities
                        .passives
                        .iter()
                        .flatten()
                        .any(|candidate| candidate == ability)
            }
            Self::Status(status) => pokemon.status.kind == *status,
            Self::FormChangeItem(key) | Self::HeldItem(key) | Self::AttackTypeBooster(key) => {
                pokemon
                    .held_items
                    .iter()
                    .any(|item| item.registry_key == *key)
            }
            Self::Level { minimum, maximum } => {
                pokemon.level >= *minimum && maximum.is_none_or(|maximum| pokemon.level <= maximum)
            }
            Self::Friendship { minimum } => pokemon.friendship >= *minimum,
            Self::HealthRatio {
                minimum_numerator,
                denominator,
            } => {
                *denominator > 0
                    && pokemon.hp.checked_mul(*denominator).is_some_and(|scaled| {
                        pokemon
                            .max_hp
                            .checked_mul(*minimum_numerator)
                            .is_some_and(|minimum| scaled >= minimum)
                    })
            }
            Self::Weight { minimum } => context
                .weights
                .get(&pokemon.id)
                .is_some_and(|weight| weight >= minimum),
            Self::CanLearnMove(move_id) => context
                .learnable_moves
                .get(&pokemon.id)
                .is_some_and(|moves| moves.contains(move_id)),
            Self::CombinationSpecies(_) | Self::PartySize { .. } => false,
        }
    }
}

pub fn find_cursed_party_member_v1<'a>(
    party: &'a [PokemonStateV5],
    cursed: &BTreeSet<PokemonId>,
) -> Option<&'a PokemonStateV5> {
    party.iter().find(|pokemon| cursed.contains(&pokemon.id))
}

pub fn party_has_fire_source_v1(party: &[PokemonStateV5], fire_moves: &BTreeSet<MoveId>) -> bool {
    party.iter().any(|pokemon| {
        pokemon.types.primary == PokemonType::Fire
            || pokemon.types.secondary == Some(PokemonType::Fire)
            || pokemon
                .moves
                .iter()
                .flatten()
                .any(|slot| fire_moves.contains(&slot.move_id))
    })
}

pub fn burn_party_v1(party: &mut [PokemonStateV5]) -> Vec<PokemonId> {
    let mut burned = Vec::new();
    for pokemon in party.iter_mut().filter(|pokemon| !pokemon.fainted) {
        pokemon.status.kind = StatusKind::Burn;
        pokemon.status.toxic_turn_count = 0;
        pokemon.status.sleep_turns_remaining = None;
        burned.push(pokemon.id);
    }
    burned
}

pub fn give_party_reviver_seeds_v1(
    party: &mut [PokemonStateV5],
    seed_template: &HeldItemOwnershipStateV1,
) -> Vec<PokemonId> {
    let mut changed = Vec::new();
    for pokemon in party {
        if !pokemon.fainted
            && !pokemon
                .held_items
                .iter()
                .any(|item| item.registry_key == seed_template.registry_key)
        {
            pokemon.held_items.push(seed_template.clone());
            changed.push(pokemon.id);
        }
    }
    changed
}

pub fn throw_encounter_pokeball_v1(caught: bool, party_has_room: bool) -> bool {
    caught && party_has_room
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DetachedPartyPokemonV1 {
    pub pokemon: PokemonStateV5,
    pub held_items: Vec<HeldItemOwnershipStateV1>,
}

pub fn remove_party_pokemon_and_store_items_v1(
    party: &mut Vec<PokemonStateV5>,
    pokemon: PokemonId,
) -> Option<DetachedPartyPokemonV1> {
    let index = party.iter().position(|candidate| candidate.id == pokemon)?;
    let mut pokemon = party.remove(index);
    let held_items = std::mem::take(&mut pokemon.held_items);
    Some(DetachedPartyPokemonV1 {
        pokemon,
        held_items,
    })
}

pub fn restore_party_and_held_items_v1(
    party: &mut Vec<PokemonStateV5>,
    mut detached: DetachedPartyPokemonV1,
) -> bool {
    if party
        .iter()
        .any(|pokemon| pokemon.id == detached.pokemon.id)
    {
        return false;
    }
    detached.pokemon.held_items = detached.held_items;
    party.push(detached.pokemon);
    true
}

pub fn breeder_party_config_v1(pokemon: &PokemonStateV5) -> PokemonStateV5 {
    pokemon.clone()
}

pub fn encounter_add_to_party_v1(
    party: &mut Vec<PokemonStateV5>,
    pokemon: PokemonStateV5,
    party_limit: usize,
) -> bool {
    if party.len() >= party_limit || party.iter().any(|member| member.id == pokemon.id) {
        return false;
    }
    party.push(pokemon);
    true
}

#[cfg(test)]
mod tests {
    use er_state::m7_state::{EvolutionStateV1, POKEMON_STATE_SCHEMA_VERSION_V5};
    use er_state::mechanic_state_v2::MechanicStateStoreV2;
    use er_state::pokemon::{AbilityLoadout, BattleStats, PokemonTyping, StatStages, StatusState};
    use er_state::pokemon_v2::{Iv, PermanentStatBonuses};
    use er_types::SafeU53;
    use er_types::battle_ids::{AbilityId, PokemonId, SpeciesId};
    use er_types::run_ids::{Experience, NatureId};

    use super::*;

    fn pokemon(id: u64, type_id: PokemonType) -> PokemonStateV5 {
        PokemonStateV5 {
            schema_version: POKEMON_STATE_SCHEMA_VERSION_V5,
            id: PokemonId::new(SafeU53::new(id).expect("id")),
            owner_seat: None,
            species_id: SpeciesId::new(SafeU53::new(id).expect("species")),
            form_index: 0,
            level: 10,
            experience: Experience::new(SafeU53::ZERO),
            types: PokemonTyping {
                primary: type_id,
                secondary: None,
            },
            stats: BattleStats {
                hp: 10,
                attack: 5,
                defense: 5,
                special_attack: 5,
                special_defense: 5,
                speed: 5,
            },
            hp: 10,
            max_hp: 10,
            status: StatusState {
                kind: StatusKind::None,
                toxic_turn_count: 0,
                sleep_turns_remaining: None,
            },
            stat_stages: StatStages {
                attack: 0,
                defense: 0,
                special_attack: 0,
                special_defense: 0,
                speed: 0,
                accuracy: 0,
                evasion: 0,
            },
            moves: [None, None, None, None],
            abilities: AbilityLoadout {
                active: AbilityId::ZERO,
                passives: [None; 3],
                active_suppressed: false,
                passive_suppressed: [false; 3],
            },
            ivs: [Iv::new(0).expect("iv"); 6],
            nature: NatureId::new(0),
            effective_nature: NatureId::new(0),
            friendship: 20,
            permanent_bonuses: PermanentStatBonuses {
                hp: 0,
                attack: 0,
                defense: 0,
                special_attack: 0,
                special_defense: 0,
                speed: 0,
            },
            pause_evolutions: false,
            held_items: Vec::new(),
            mechanics: MechanicStateStoreV2::default(),
            fusion: None,
            evolution: EvolutionStateV1 {
                last_completed: None,
                cancelled: Vec::new(),
            },
            tera_type: None,
            shiny: false,
            variant: 0,
            capture: None,
            fainted: false,
        }
    }

    #[test]
    fn party_requirements_query_exact_stable_ids() {
        let party = vec![
            pokemon(1, PokemonType::Fire),
            pokemon(2, PokemonType::Water),
        ];
        let ids = PartyRequirementV1::Type(PokemonType::Fire)
            .query_party(&party, &PartyRequirementContextV1::default());
        assert_eq!(ids, vec![party[0].id]);
        let size = PartyRequirementV1::PartySize {
            minimum: 2,
            maximum: 3,
        };
        assert!(size.meets_party_size(party.len()));
        assert_eq!(size.dialogue_token().as_deref(), Some("2-3"));
        assert!(party_has_fire_source_v1(&party, &BTreeSet::new()));
    }

    #[test]
    fn party_status_detach_and_restore_are_atomic() {
        let mut party = vec![
            pokemon(1, PokemonType::Normal),
            pokemon(2, PokemonType::Water),
        ];
        assert_eq!(burn_party_v1(&mut party).len(), 2);
        let id = party[0].id;
        let detached = remove_party_pokemon_and_store_items_v1(&mut party, id).expect("detach");
        assert_eq!(party.len(), 1);
        assert!(restore_party_and_held_items_v1(&mut party, detached));
        assert_eq!(party.len(), 2);
    }
}
