//! Canonical party snapshots shared by challenge, Ghost, Moody, and Showdown modes.
use std::collections::{BTreeMap, BTreeSet};

use er_state::m7_state::{HeldItemOwnershipStateV1, PokemonStateV5};
use er_types::battle_ids::{PokemonId, SpeciesId};
use serde::{Deserialize, Serialize};

pub fn compact_eligible_party_into_active_slots_v1(
    active: &mut [Option<PokemonId>],
    party: &[PokemonStateV5],
) {
    let eligible = party
        .iter()
        .filter(|pokemon| !pokemon.fainted && pokemon.hp > 0)
        .map(|pokemon| pokemon.id)
        .collect::<Vec<_>>();
    for (index, slot) in active.iter_mut().enumerate() {
        *slot = eligible.get(index).copied();
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PartyChallengeStateV1 {
    pub starting_roots: BTreeSet<SpeciesId>,
}

impl PartyChallengeStateV1 {
    pub fn apply_party_heal(&self, party: &mut [PokemonStateV5], numerator: u32, denominator: u32) {
        if denominator == 0 {
            return;
        }
        for pokemon in party {
            let heal = pokemon
                .max_hp
                .checked_mul(numerator)
                .map_or(0, |value| value / denominator);
            pokemon.hp = pokemon
                .hp
                .checked_add(heal)
                .unwrap_or(pokemon.max_hp)
                .min(pokemon.max_hp);
            pokemon.fainted = pokemon.hp == 0;
        }
    }

    pub fn apply_pokemon_add_to_party(
        &self,
        party: &mut Vec<PokemonStateV5>,
        pokemon: PokemonStateV5,
    ) -> bool {
        if party.len() >= 6 || party.iter().any(|member| member.id == pokemon.id) {
            return false;
        }
        party.push(pokemon);
        true
    }

    pub fn capture_starting_roots(&mut self, party: &[PokemonStateV5]) {
        self.starting_roots = party.iter().map(|pokemon| pokemon.species_id).collect();
    }
}

pub fn player_party_snake_only_v1(
    party: &[PokemonStateV5],
    snake_species: &BTreeSet<SpeciesId>,
) -> bool {
    !party.is_empty()
        && party
            .iter()
            .all(|pokemon| snake_species.contains(&pokemon.species_id))
}

pub fn enemy_party_has_boss_v1(boss_flags: &BTreeMap<PokemonId, bool>) -> bool {
    boss_flags.values().any(|is_boss| *is_boss)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartySnapshotV1 {
    pub party: Vec<PokemonStateV5>,
}

pub fn capture_ghost_team_v1(party: &[PokemonStateV5]) -> PartySnapshotV1 {
    PartySnapshotV1 {
        party: party.to_vec(),
    }
}

pub fn capture_run_starter_lines_v1(party: &[PokemonStateV5]) -> BTreeSet<SpeciesId> {
    party.iter().map(|pokemon| pokemon.species_id).collect()
}

pub fn capture_run_challenges_v1(challenges: &BTreeMap<u32, i64>) -> BTreeMap<u32, i64> {
    challenges
        .iter()
        .filter(|(_, value)| **value != 0)
        .map(|(id, value)| (*id, *value))
        .collect()
}

pub fn capture_opponent_v1(party: &[PokemonStateV5], field_index: usize) -> Option<PokemonStateV5> {
    party.get(field_index).cloned()
}

pub fn player_party_snapshot_v1(party: &[PokemonStateV5]) -> PartySnapshotV1 {
    PartySnapshotV1 {
        party: party.to_vec(),
    }
}

pub fn moody_party_slot_v1(party: &[PokemonStateV5], slot: usize) -> Option<PokemonStateV5> {
    party.get(slot).cloned()
}

pub fn build_moody_formation_party_snapshot_v1(party: &[PokemonStateV5]) -> PartySnapshotV1 {
    PartySnapshotV1 {
        party: party.to_vec(),
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MoodyTurnSnapshotV1 {
    pub party: PartySnapshotV1,
    pub modifiers: Vec<HeldItemOwnershipStateV1>,
}

pub fn capture_moody_turn_snapshot_v1(party: &[PokemonStateV5]) -> MoodyTurnSnapshotV1 {
    MoodyTurnSnapshotV1 {
        party: PartySnapshotV1 {
            party: party.to_vec(),
        },
        modifiers: party
            .iter()
            .flat_map(|pokemon| pokemon.held_items.clone())
            .collect(),
    }
}

pub fn moody_coordinator_party_modifiers_v1(
    party: &[PokemonStateV5],
) -> Vec<HeldItemOwnershipStateV1> {
    party
        .iter()
        .flat_map(|pokemon| pokemon.held_items.clone())
        .collect()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MoodyCaptureV1 {
    pub pokemon: PokemonStateV5,
    pub destination_slot: Option<usize>,
}

pub fn apply_moody_coordinator_capture_v1(
    party: &mut Vec<PokemonStateV5>,
    capture: MoodyCaptureV1,
) -> bool {
    if party.iter().any(|pokemon| pokemon.id == capture.pokemon.id) {
        return false;
    }
    match capture.destination_slot {
        Some(index) if index < party.len() => party.insert(index, capture.pokemon),
        _ if party.len() < 6 => party.push(capture.pokemon),
        _ => return false,
    }
    true
}

pub fn commit_moody_coordinator_capture_success_v1(
    committed: &mut BTreeSet<PokemonId>,
    pokemon: PokemonId,
) -> bool {
    committed.insert(pokemon)
}

pub fn showdown_manifest_to_serialized_party_v1(party: &[PokemonStateV5]) -> PartySnapshotV1 {
    PartySnapshotV1 {
        party: party.to_vec(),
    }
}

pub fn showdown_party_for_v1<'a>(
    own: &'a [PokemonStateV5],
    opponent: &'a [PokemonStateV5],
    own_side: bool,
) -> &'a [PokemonStateV5] {
    if own_side { own } else { opponent }
}

#[cfg(test)]
mod tests {
    use er_state::m7_state::{EvolutionStateV1, POKEMON_STATE_SCHEMA_VERSION_V5};
    use er_state::mechanic_state_v2::MechanicStateStoreV2;
    use er_state::pokemon::{
        AbilityLoadout, BattleStats, PokemonTyping, StatStages, StatusKind, StatusState,
    };
    use er_state::pokemon_v2::{Iv, PermanentStatBonuses};
    use er_types::SafeU53;
    use er_types::battle_ids::{AbilityId, PokemonId, SpeciesId};
    use er_types::battle_model::PokemonType;
    use er_types::run_ids::{Experience, NatureId};

    use super::*;

    fn pokemon(id: u64, hp: u32) -> PokemonStateV5 {
        PokemonStateV5 {
            schema_version: POKEMON_STATE_SCHEMA_VERSION_V5,
            id: PokemonId::new(SafeU53::new(id).expect("id")),
            owner_seat: None,
            species_id: SpeciesId::new(SafeU53::new(id).expect("species")),
            form_index: 0,
            gender: None,
            level: 10,
            experience: Experience::new(SafeU53::ZERO),
            types: PokemonTyping {
                primary: PokemonType::Normal,
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
            hp,
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
            moves: [None; 4],
            abilities: AbilityLoadout {
                active: AbilityId::ZERO,
                passives: [None; 3],
                active_suppressed: false,
                passive_suppressed: [false; 3],
            },
            ivs: [Iv::new(0).expect("iv"); 6],
            nature: NatureId::new(0),
            effective_nature: NatureId::new(0),
            friendship: 0,
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
            fainted: hp == 0,
        }
    }

    #[test]
    fn active_party_compaction_and_challenge_mutations_are_stable() {
        let mut party = vec![pokemon(1, 0), pokemon(2, 5), pokemon(3, 10)];
        let mut active = [Some(party[0].id), None];
        compact_eligible_party_into_active_slots_v1(&mut active, &party);
        assert_eq!(active, [Some(party[1].id), Some(party[2].id)]);
        PartyChallengeStateV1::default().apply_party_heal(&mut party, 1, 2);
        assert_eq!(party[1].hp, 10);
    }

    #[test]
    fn mode_party_snapshots_clone_and_capture_once() {
        let party = vec![pokemon(1, 10)];
        let mut snapshot = capture_ghost_team_v1(&party);
        snapshot.party[0].hp = 1;
        assert_eq!(party[0].hp, 10);
        let mut committed = BTreeSet::new();
        assert!(commit_moody_coordinator_capture_success_v1(
            &mut committed,
            party[0].id
        ));
        assert!(!commit_moody_coordinator_capture_success_v1(
            &mut committed,
            party[0].id
        ));
    }
}
