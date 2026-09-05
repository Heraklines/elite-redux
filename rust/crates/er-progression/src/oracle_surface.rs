//! Pinned-oracle data helpers for progression content, levels, moves, nature, and evolution graphs.
use std::collections::{BTreeMap, BTreeSet, VecDeque};

use er_types::battle_ids::{MoveId, SpeciesId};
use er_types::run_ids::NatureId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvolutionEdgeV1 {
    pub source: SpeciesId,
    pub target: SpeciesId,
    pub level: Option<u16>,
    pub item_key: Option<String>,
    pub form_index: Option<u16>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct EvolutionGraphV1 {
    outgoing: BTreeMap<SpeciesId, Vec<EvolutionEdgeV1>>,
    incoming: BTreeMap<SpeciesId, Vec<EvolutionEdgeV1>>,
}

impl EvolutionGraphV1 {
    pub fn initialize(edges: impl IntoIterator<Item = EvolutionEdgeV1>) -> Self {
        let mut graph = Self::default();
        for edge in edges {
            graph.merge_one_edge(edge);
        }
        graph
    }

    pub fn merge_one_edge(&mut self, edge: EvolutionEdgeV1) -> bool {
        let duplicate = self
            .outgoing
            .get(&edge.source)
            .is_some_and(|edges| edges.contains(&edge));
        if duplicate || edge.source == edge.target {
            return false;
        }
        self.outgoing
            .entry(edge.source)
            .or_default()
            .push(edge.clone());
        self.incoming.entry(edge.target).or_default().push(edge);
        for edges in self.outgoing.values_mut().chain(self.incoming.values_mut()) {
            edges.sort_by_key(|edge| (edge.source, edge.target, edge.level, edge.form_index));
        }
        true
    }

    pub fn evolutions(&self, species: SpeciesId) -> &[EvolutionEdgeV1] {
        self.outgoing.get(&species).map_or(&[], Vec::as_slice)
    }

    pub fn pre_evolutions(&self, species: SpeciesId) -> &[EvolutionEdgeV1] {
        self.incoming.get(&species).map_or(&[], Vec::as_slice)
    }

    pub fn recurse_evolutions(&self, root: SpeciesId) -> Vec<SpeciesId> {
        let mut queue = VecDeque::from([root]);
        let mut visited = BTreeSet::new();
        while let Some(species) = queue.pop_front() {
            if !visited.insert(species) {
                continue;
            }
            queue.extend(self.evolutions(species).iter().map(|edge| edge.target));
        }
        visited.into_iter().collect()
    }

    pub fn conditions_fulfilled(edge: &EvolutionEdgeV1, level: u16, item: Option<&str>) -> bool {
        edge.level.is_none_or(|required| level >= required)
            && edge
                .item_key
                .as_deref()
                .is_none_or(|required| item == Some(required))
    }

    pub fn valid_item_evolution(edge: &EvolutionEdgeV1, item: &str) -> bool {
        edge.item_key.as_deref() == Some(item)
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct MovesetSurfaceV1 {
    pub level_moves: BTreeMap<SpeciesId, Vec<(u16, MoveId)>>,
    pub tm_moves: BTreeMap<SpeciesId, BTreeSet<MoveId>>,
}

impl MovesetSurfaceV1 {
    pub fn level_moves(&self, species: SpeciesId) -> Vec<(u16, MoveId)> {
        self.level_moves.get(&species).cloned().unwrap_or_default()
    }

    pub fn learnable_level_moves(&self, species: SpeciesId, level: u16) -> Vec<MoveId> {
        self.level_moves(species)
            .into_iter()
            .filter_map(|(learn_level, move_id)| (learn_level <= level).then_some(move_id))
            .collect()
    }

    pub fn tm_pool(&self, species: SpeciesId) -> Vec<MoveId> {
        self.tm_moves
            .get(&species)
            .map(|moves| moves.iter().copied().collect())
            .unwrap_or_default()
    }

    pub fn add_tm(&mut self, species: SpeciesId, move_id: MoveId) -> bool {
        self.tm_moves.entry(species).or_default().insert(move_id)
    }

    pub fn clone_learnset(&mut self, source: SpeciesId, target: SpeciesId) {
        if let Some(moves) = self.level_moves.get(&source).cloned() {
            self.level_moves.insert(target, moves);
        }
        if let Some(moves) = self.tm_moves.get(&source).cloned() {
            self.tm_moves.insert(target, moves);
        }
    }
}

pub fn weighted_tm_moves_v1(
    moves: &[MoveId],
    weights: &BTreeMap<MoveId, u32>,
) -> Vec<(MoveId, u32)> {
    moves
        .iter()
        .map(|move_id| (*move_id, weights.get(move_id).copied().unwrap_or(1)))
        .collect()
}

pub const fn max_tm_count_v1(party_level: u16) -> usize {
    match party_level {
        0..=19 => 1,
        20..=39 => 2,
        40..=59 => 3,
        _ => 4,
    }
}

pub const fn starter_value_friendship_cap_v1(starter_value: u16) -> u16 {
    50 + starter_value * 10
}

pub const fn egg_hatch_waves_v1(tier: u8) -> u32 {
    match tier {
        0 => 10,
        1 => 25,
        2 => 50,
        _ => 100,
    }
}

pub fn nature_name_key_v1(nature: NatureId) -> String {
    format!("nature:{:02}", nature.get())
}

pub const fn nature_stat_multiplier_percent_v1(
    nature: NatureId,
    increased: NatureId,
    decreased: NatureId,
) -> u16 {
    if nature.get() == increased.get() {
        110
    } else if nature.get() == decreased.get() {
        90
    } else {
        100
    }
}

pub fn encounter_level_for_wave_v1(wave: u32, offset: i32, minimum: u16) -> u16 {
    let base = if wave > u16::MAX as u32 {
        u16::MAX
    } else {
        wave as u16
    };
    let adjusted = if offset >= 0 {
        base.saturating_add(offset as u16)
    } else {
        base.saturating_sub(offset.unsigned_abs() as u16)
    };
    if adjusted < minimum {
        minimum
    } else {
        adjusted
    }
}

pub fn highest_level_index_v1(levels: &[u16]) -> Option<usize> {
    levels
        .iter()
        .enumerate()
        .max_by(|left, right| left.1.cmp(right.1).then_with(|| right.0.cmp(&left.0)))
        .map(|(index, _)| index)
}

pub fn lowest_level_index_v1(levels: &[u16]) -> Option<usize> {
    levels
        .iter()
        .enumerate()
        .min_by(|left, right| left.1.cmp(right.1).then_with(|| left.0.cmp(&right.0)))
        .map(|(index, _)| index)
}

pub fn level_total_exp_v1(
    level: u16,
    growth_numerator: u64,
    growth_denominator: u64,
) -> Option<u64> {
    if growth_denominator == 0 {
        return None;
    }
    let level = u64::from(level);
    level
        .checked_mul(level)
        .and_then(|value| value.checked_mul(level))
        .and_then(|value| value.checked_mul(growth_numerator))
        .map(|value| value / growth_denominator)
}

pub fn level_relative_exp_v1(level: u16, total: u64, next: u64) -> u64 {
    let current = level_total_exp_v1(level, 1, 1).unwrap_or(0);
    next.checked_sub(current)
        .and_then(|span| {
            total
                .checked_sub(current)
                .map(|progress| progress.min(span))
        })
        .unwrap_or(0)
}

pub const fn growth_rate_color_v1(rate: u8) -> u32 {
    match rate {
        0 => 0x78c850,
        1 => 0x6890f0,
        2 => 0xf08030,
        _ => 0xa040a0,
    }
}

pub fn scaled_enemy_level_v1(base: u16, numerator: u32, denominator: u32) -> Option<u16> {
    if denominator == 0 {
        return None;
    }
    let scaled = (base as u32).checked_mul(numerator)? / denominator;
    Some(if scaled > u16::MAX as u32 {
        u16::MAX
    } else {
        scaled as u16
    })
}

#[cfg(test)]
mod tests {
    use er_types::SafeU53;

    use super::*;

    fn species(value: u64) -> SpeciesId {
        SpeciesId::new(SafeU53::new(value).expect("species"))
    }

    fn move_id(value: u64) -> MoveId {
        MoveId::new(SafeU53::new(value).expect("move"))
    }

    #[test]
    fn evolution_graph_is_sorted_acyclic_and_queryable() {
        let graph = EvolutionGraphV1::initialize([
            EvolutionEdgeV1 {
                source: species(1),
                target: species(3),
                level: Some(20),
                item_key: None,
                form_index: None,
            },
            EvolutionEdgeV1 {
                source: species(1),
                target: species(2),
                level: Some(10),
                item_key: None,
                form_index: None,
            },
        ]);
        assert_eq!(graph.evolutions(species(1))[0].target, species(2));
        assert_eq!(graph.pre_evolutions(species(3)).len(), 1);
        assert_eq!(
            graph.recurse_evolutions(species(1)),
            vec![species(1), species(2), species(3)]
        );
        assert!(EvolutionGraphV1::conditions_fulfilled(
            &graph.evolutions(species(1))[0],
            10,
            None
        ));
    }

    #[test]
    fn moves_levels_natures_and_experience_are_deterministic() {
        let mut moves = MovesetSurfaceV1::default();
        moves
            .level_moves
            .insert(species(1), vec![(1, move_id(1)), (10, move_id(2))]);
        assert_eq!(moves.learnable_level_moves(species(1), 5), vec![move_id(1)]);
        assert!(moves.add_tm(species(1), move_id(3)));
        assert_eq!(moves.tm_pool(species(1)), vec![move_id(3)]);
        assert_eq!(encounter_level_for_wave_v1(20, -5, 1), 15);
        assert_eq!(
            nature_stat_multiplier_percent_v1(NatureId::new(1), NatureId::new(1), NatureId::new(2)),
            110
        );
        assert_eq!(level_total_exp_v1(10, 1, 1), Some(1_000));
        assert_eq!(highest_level_index_v1(&[4, 9, 9]), Some(1));
    }
}
