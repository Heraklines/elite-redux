//! Deterministic trainer and rival party construction policies.
use std::collections::{BTreeMap, BTreeSet};

use er_types::battle_ids::{AbilityId, MoveId, SpeciesId};
use er_types::battle_model::PokemonType;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PartyTemplateStrengthV1 {
    Weak,
    Normal,
    Strong,
    Boss,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainerPartyMemberV1 {
    pub species: SpeciesId,
    pub level: u16,
    pub types: Vec<PokemonType>,
    pub ability: AbilityId,
    pub moves: Vec<MoveId>,
    pub shiny: bool,
    pub variant: u8,
    pub form_index: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainerPartyTemplateV1 {
    pub min_size: u8,
    pub max_size: u8,
    pub strength: PartyTemplateStrengthV1,
    pub balanced: bool,
    pub same_species: bool,
}

impl TrainerPartyTemplateV1 {
    pub const fn new(
        min_size: u8,
        max_size: u8,
        strength: PartyTemplateStrengthV1,
        balanced: bool,
        same_species: bool,
    ) -> Self {
        Self {
            min_size,
            max_size,
            strength,
            balanced,
            same_species,
        }
    }

    pub const fn get_strength(&self) -> PartyTemplateStrengthV1 {
        self.strength
    }

    pub const fn is_same_species(&self) -> bool {
        self.same_species
    }

    pub const fn is_balanced(&self) -> bool {
        self.balanced
    }
}

pub const fn wave_party_template_v1(wave: u32) -> TrainerPartyTemplateV1 {
    if wave >= 180 {
        TrainerPartyTemplateV1::new(6, 6, PartyTemplateStrengthV1::Boss, true, false)
    } else if wave >= 100 {
        TrainerPartyTemplateV1::new(4, 6, PartyTemplateStrengthV1::Strong, true, false)
    } else {
        TrainerPartyTemplateV1::new(2, 4, PartyTemplateStrengthV1::Normal, true, false)
    }
}

pub const fn gym_leader_party_template_v1(wave: u32) -> TrainerPartyTemplateV1 {
    let size = if wave >= 100 { 6 } else { 4 };
    TrainerPartyTemplateV1::new(size, size, PartyTemplateStrengthV1::Boss, true, false)
}

pub const fn evil_grunt_party_template_v1(wave: u32) -> TrainerPartyTemplateV1 {
    let size = if wave >= 100 { 4 } else { 3 };
    TrainerPartyTemplateV1::new(size, size, PartyTemplateStrengthV1::Normal, false, false)
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TrainerPartyConfigV1 {
    pub templates: Vec<TrainerPartyTemplateV1>,
    pub static_party: Vec<TrainerPartyMemberV1>,
    pub member_slots: BTreeMap<u8, TrainerPartyMemberV1>,
}

impl TrainerPartyConfigV1 {
    pub fn set_static_party(&mut self, party: Vec<TrainerPartyMemberV1>) -> &mut Self {
        self.static_party = party;
        self
    }

    pub fn set_party_templates(&mut self, templates: Vec<TrainerPartyTemplateV1>) -> &mut Self {
        self.templates = templates;
        self
    }

    pub fn set_party_template(&mut self, template: TrainerPartyTemplateV1) -> &mut Self {
        self.templates = vec![template];
        self
    }

    pub fn set_party_member(&mut self, slot: u8, member: TrainerPartyMemberV1) -> &mut Self {
        self.member_slots.insert(slot, member);
        self
    }

    pub fn random_party_member<'a>(
        &self,
        candidates: &'a [TrainerPartyMemberV1],
        draw: usize,
    ) -> Option<&'a TrainerPartyMemberV1> {
        (!candidates.is_empty()).then(|| &candidates[draw % candidates.len()])
    }

    pub fn species_filter_random_party_member<'a>(
        &self,
        candidates: &'a [TrainerPartyMemberV1],
        allowed: &BTreeSet<SpeciesId>,
        draw: usize,
    ) -> Option<&'a TrainerPartyMemberV1> {
        let filtered = candidates
            .iter()
            .filter(|member| allowed.contains(&member.species))
            .collect::<Vec<_>>();
        (!filtered.is_empty()).then(|| filtered[draw % filtered.len()])
    }
}

pub fn calc_party_typings_v1(party: &[TrainerPartyMemberV1]) -> BTreeMap<PokemonType, u32> {
    let mut counts = BTreeMap::new();
    for pokemon in party {
        for type_id in &pokemon.types {
            let entry = counts.entry(*type_id).or_insert(0_u32);
            *entry = entry.checked_add(1).unwrap_or(u32::MAX);
        }
    }
    counts
}

pub fn rival_party_member_v1<'a>(
    candidates: &'a [TrainerPartyMemberV1],
    excluded_species: &BTreeSet<SpeciesId>,
    draw: usize,
) -> Option<&'a TrainerPartyMemberV1> {
    let eligible = candidates
        .iter()
        .filter(|member| !excluded_species.contains(&member.species))
        .collect::<Vec<_>>();
    (!eligible.is_empty()).then(|| eligible[draw % eligible.len()])
}

pub fn force_rival_starter_traits_v1(
    member: &mut TrainerPartyMemberV1,
    shiny: bool,
    variant: u8,
    form_index: u16,
) {
    member.shiny = shiny;
    member.variant = variant;
    member.form_index = form_index;
}

pub fn force_rival_bird_ability_v1(member: &mut TrainerPartyMemberV1, ability: AbilityId) {
    member.ability = ability;
}

pub fn post_process_rival_slot_v1(
    member: &mut TrainerPartyMemberV1,
    minimum_level: u16,
    forced_move: Option<MoveId>,
) {
    member.level = member.level.max(minimum_level);
    if let Some(move_id) = forced_move.filter(|move_id| !member.moves.contains(move_id)) {
        member.moves.push(move_id);
        member.moves.sort();
        member.moves.truncate(4);
    }
}

pub fn rival_party_size_for_type_v1(trainer_rank: u8, wave: u32) -> u8 {
    let base = u32::from(trainer_rank).saturating_add(wave / 50);
    base.clamp(1, 6) as u8
}

pub fn enforce_elite_bst_curve_for_party_v1(
    party: &mut [TrainerPartyMemberV1],
    minimum_level: u16,
) {
    for member in party {
        member.level = member.level.max(minimum_level);
    }
}

pub fn resolve_custom_trainer_party_v1(
    configured: &[TrainerPartyMemberV1],
    party_size: usize,
) -> Vec<TrainerPartyMemberV1> {
    configured.iter().take(party_size.min(6)).cloned().collect()
}

pub fn resolve_party_member_v1(
    configured: Option<TrainerPartyMemberV1>,
    generated: TrainerPartyMemberV1,
) -> TrainerPartyMemberV1 {
    configured.unwrap_or(generated)
}

pub fn trainer_party_levels_v1(base_level: u16, party_size: usize) -> Vec<u16> {
    (0..party_size)
        .map(|index| base_level.checked_sub(index as u16).unwrap_or(1).max(1))
        .collect()
}

pub fn party_member_matchup_scores_v1(
    party: &[TrainerPartyMemberV1],
    opponent_types: &[PokemonType],
) -> Vec<(usize, i32)> {
    party
        .iter()
        .enumerate()
        .map(|(index, member)| {
            let overlap = member
                .types
                .iter()
                .filter(|type_id| opponent_types.contains(type_id))
                .count() as i32;
            (index, i32::from(member.level) - overlap)
        })
        .collect()
}

pub fn sorted_party_member_matchup_scores_v1(scores: &[(usize, i32)]) -> Vec<(usize, i32)> {
    let mut sorted = scores.to_vec();
    sorted.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    sorted
}

pub const fn party_member_modifier_chance_multiplier_v1(party_size: usize) -> u32 {
    match party_size {
        0 | 1 => 100,
        2 | 3 => 80,
        4 | 5 => 60,
        _ => 50,
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommittedCombatDecisionV1 {
    pub actor_slot: u8,
    pub move_slot: u8,
    pub target_slot: Option<u8>,
}

pub const fn capture_committed_combat_decision_v1(
    actor_slot: u8,
    move_slot: u8,
    target_slot: Option<u8>,
) -> CommittedCombatDecisionV1 {
    CommittedCombatDecisionV1 {
        actor_slot,
        move_slot,
        target_slot,
    }
}

pub fn self_party_v1<T>(party: &[T]) -> &[T] {
    party
}

pub fn opponent_party_v1<T>(party: &[T]) -> &[T] {
    party
}

#[cfg(test)]
mod tests {
    use er_types::SafeU53;

    use super::*;

    fn member(species: u64, level: u16, type_id: PokemonType) -> TrainerPartyMemberV1 {
        TrainerPartyMemberV1 {
            species: SpeciesId::new(SafeU53::new(species).expect("species")),
            level,
            types: vec![type_id],
            ability: AbilityId::ZERO,
            moves: Vec::new(),
            shiny: false,
            variant: 0,
            form_index: 0,
        }
    }

    #[test]
    fn trainer_templates_and_party_selection_are_deterministic() {
        assert_eq!(
            wave_party_template_v1(180).get_strength(),
            PartyTemplateStrengthV1::Boss
        );
        let candidates = vec![
            member(1, 10, PokemonType::Fire),
            member(2, 20, PokemonType::Water),
        ];
        let config = TrainerPartyConfigV1::default();
        assert_eq!(
            config
                .random_party_member(&candidates, 3)
                .expect("member")
                .species,
            candidates[1].species
        );
        let typings = calc_party_typings_v1(&candidates);
        assert_eq!(typings.get(&PokemonType::Fire), Some(&1));
        let scores = sorted_party_member_matchup_scores_v1(&party_member_matchup_scores_v1(
            &candidates,
            &[PokemonType::Fire],
        ));
        assert_eq!(scores[0].0, 1);
    }

    #[test]
    fn rival_traits_and_post_processing_are_stable() {
        let mut rival = member(1, 5, PokemonType::Normal);
        force_rival_starter_traits_v1(&mut rival, true, 2, 3);
        post_process_rival_slot_v1(
            &mut rival,
            50,
            Some(MoveId::new(SafeU53::new(9).expect("move"))),
        );
        assert!(rival.shiny);
        assert_eq!(rival.level, 50);
        assert_eq!(rival.moves.len(), 1);
        assert_eq!(rival_party_size_for_type_v1(2, 150), 5);
    }
}
