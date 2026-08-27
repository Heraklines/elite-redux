//! Deterministic M7 route, encounter, and wave selection.

use std::collections::BTreeSet;

use er_state::m7_state::{GameStateV5, PendingRouteNodeV1, RouteRevealSourceV1, WorldStateV1};
use er_types::battle_ids::WaveIndex;
use er_types::run_ids::{BiomeId, EncounterId, RouteNodeId};
use er_types::run_model::RunOutcome;
use er_types::{GameControlKindV2, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{EncounterDefinitionV1, PreparedWorldContentV1, WeightedEncounterV1, WeightedRouteV1};

pub trait AuditedWorldRng {
    fn draw_weighted(&mut self, upper_exclusive: u64) -> Result<u64, WorldRuntimeError>;
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldTransitionV1 {
    pub after_state: GameStateV5,
    pub selected_route: Option<RouteNodeId>,
    pub selected_encounter: Option<EncounterId>,
    pub audit: WorldSelectionAuditV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldSelectionAuditV1 {
    pub total_weight: u64,
    pub draw: u64,
    pub selected_ordinal: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RouteGraphDrawReasonV1 {
    ConditionalBaseLink,
    UnexpectedBiome,
    BiomeLength,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouteGraphDrawAuditV1 {
    pub reason: RouteGraphDrawReasonV1,
    pub upper_exclusive: u64,
    pub result: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouteGraphTransitionV1 {
    pub after_state: GameStateV5,
    pub draws: Vec<RouteGraphDrawAuditV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeStructureTransitionV1 {
    pub after_state: GameStateV5,
    pub draws: Vec<RouteGraphDrawAuditV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum WorldRuntimeError {
    #[error("game state is invalid: {0}")]
    State(String),
    #[error("active run, biome, route, encounter, or mode content is absent")]
    Content,
    #[error("weighted table is empty, unsorted, or overflows")]
    Weight,
    #[error("world RNG returned {draw} outside 0..{upper}")]
    Draw { draw: u64, upper: u64 },
    #[error("wave counter overflowed")]
    Wave,
}

const MAX_RECENT_BIOMES: usize = 8;
const NO_LOOPBACK_WINDOW: usize = 2;
const BASE_VISIBLE_NODES: usize = 2;
const MAX_EXTRA_NODES: usize = 3;
const EXTRA_NODE_CHANCE: u64 = 50;
const BIOME_LENGTH_MIN: u64 = 7;
const BIOME_LENGTH_MAX: u64 = 25;

pub fn record_biome_entry(
    before: &GameStateV5,
    biome: BiomeId,
    route: RouteNodeId,
) -> Result<GameStateV5, WorldRuntimeError> {
    let mut after = before.clone();
    let run = after
        .active_run
        .as_mut()
        .ok_or(WorldRuntimeError::Content)?;
    let previous = run.world.biome;
    run.world.previous_biome = Some(previous);
    run.world.recent_biomes.push(previous);
    if run.world.recent_biomes.len() > MAX_RECENT_BIOMES {
        let remove = run.world.recent_biomes.len() - MAX_RECENT_BIOMES;
        run.world.recent_biomes.drain(..remove);
    }
    run.world.biome = biome;
    run.world.route = route;
    run.world.visited_routes.push(route);
    run.world.pending_nodes.clear();
    run.world.pending_nodes_ready = false;
    run.world.event_revealed_biomes.clear();
    run.world.biome_length = None;
    run.world.biome_start_wave = run.wave;
    run.world.leave_biome_now = false;
    run.world.overstay_anchor_wave = None;
    validate_after(after)
}

pub fn mark_pending_nodes_awaiting_authority(
    before: &GameStateV5,
) -> Result<GameStateV5, WorldRuntimeError> {
    update_world(before, |world| {
        world.pending_nodes.clear();
        world.pending_nodes_ready = false;
    })
}

pub fn set_pending_route_nodes(
    before: &GameStateV5,
    nodes: Vec<PendingRouteNodeV1>,
) -> Result<GameStateV5, WorldRuntimeError> {
    let mut after = before.clone();
    let world = world_mut(&mut after)?;
    world.pending_nodes = nodes;
    world.pending_nodes_ready = true;
    validate_after(after)
}

pub fn reset_routing_state(before: &GameStateV5) -> Result<GameStateV5, WorldRuntimeError> {
    update_world(before, |world| {
        world.previous_biome = None;
        world.recent_biomes.clear();
        world.pending_nodes.clear();
        world.pending_nodes_ready = false;
        world.event_revealed_biomes.clear();
    })
}

pub fn restore_routing_state(
    before: &GameStateV5,
    previous_biome: Option<BiomeId>,
    recent_biomes: Vec<BiomeId>,
    pending_nodes: Vec<PendingRouteNodeV1>,
    pending_nodes_ready: bool,
    event_revealed_biomes: Vec<BiomeId>,
) -> Result<GameStateV5, WorldRuntimeError> {
    let mut after = before.clone();
    let world = world_mut(&mut after)?;
    world.previous_biome = previous_biome;
    world.recent_biomes = recent_biomes;
    world.pending_nodes = pending_nodes;
    world.pending_nodes_ready = pending_nodes_ready;
    world.event_revealed_biomes = event_revealed_biomes;
    validate_after(after)
}

pub fn reveal_all_pending_nodes(
    before: &GameStateV5,
) -> Result<(GameStateV5, usize), WorldRuntimeError> {
    let mut after = before.clone();
    let world = world_mut(&mut after)?;
    let mut revealed = 0;
    for node in &mut world.pending_nodes {
        if !node.revealed {
            node.revealed = true;
            node.source = RouteRevealSourceV1::Event;
            revealed += 1;
        }
    }
    Ok((validate_after(after)?, revealed))
}

pub fn reveal_next_pending_node(
    before: &GameStateV5,
) -> Result<(GameStateV5, bool), WorldRuntimeError> {
    let mut after = before.clone();
    let world = world_mut(&mut after)?;
    let revealed = if let Some(node) = world.pending_nodes.iter_mut().find(|node| !node.revealed) {
        node.revealed = true;
        node.source = RouteRevealSourceV1::Event;
        true
    } else {
        false
    };
    Ok((validate_after(after)?, revealed))
}

pub fn add_event_revealed_biome(
    before: &GameStateV5,
    biome: BiomeId,
) -> Result<GameStateV5, WorldRuntimeError> {
    let mut after = before.clone();
    let world = world_mut(&mut after)?;
    let excluded = loopback_exclusions(world);
    if excluded.contains(&biome) {
        return Ok(before.clone());
    }
    if !world.event_revealed_biomes.contains(&biome) {
        world.event_revealed_biomes.push(biome);
    }
    if world.pending_nodes_ready && !world.pending_nodes.iter().any(|node| node.biome == biome) {
        world.pending_nodes.push(PendingRouteNodeV1 {
            biome,
            revealed: true,
            source: RouteRevealSourceV1::Event,
        });
    }
    validate_after(after)
}

pub fn roll_next_biome_nodes<R: AuditedWorldRng>(
    before: &GameStateV5,
    content: &PreparedWorldContentV1,
    visible_count: usize,
    rng: &mut R,
) -> Result<RouteGraphTransitionV1, WorldRuntimeError> {
    let run = before
        .active_run
        .as_ref()
        .ok_or(WorldRuntimeError::Content)?;
    let current = content
        .biome(run.world.biome)
        .ok_or(WorldRuntimeError::Content)?;
    let mode = content.mode(run.mode).ok_or(WorldRuntimeError::Content)?;
    if !mode.branching_routes {
        return Err(WorldRuntimeError::Content);
    }
    let mut draws = Vec::new();
    let mut seen = loopback_exclusions(&run.world);
    let mut chosen = Vec::new();
    collect_base_links(current, content, rng, &mut draws, &mut seen, &mut chosen)?;
    let mut extras = 0;
    for candidate in &content.pack().biomes {
        if extras >= MAX_EXTRA_NODES {
            break;
        }
        if !candidate.travel_allowed || seen.contains(&candidate.id) {
            continue;
        }
        let draw = draw_checked(rng, 100)?;
        draws.push(RouteGraphDrawAuditV1 {
            reason: RouteGraphDrawReasonV1::UnexpectedBiome,
            upper_exclusive: 100,
            result: draw,
        });
        if draw < EXTRA_NODE_CHANCE {
            seen.insert(candidate.id);
            chosen.push(candidate.id);
            extras += 1;
        }
    }
    if chosen.is_empty() {
        collect_base_links(
            current,
            content,
            rng,
            &mut draws,
            &mut BTreeSet::new(),
            &mut chosen,
        )?;
    }
    if chosen.is_empty() {
        let fallback = content
            .pack()
            .biomes
            .iter()
            .find(|candidate| candidate.travel_allowed)
            .ok_or(WorldRuntimeError::Content)?;
        chosen.push(fallback.id);
    }
    let reveal_limit = visible_count.max(1);
    let mut nodes: Vec<_> = chosen
        .into_iter()
        .enumerate()
        .map(|(index, biome)| PendingRouteNodeV1 {
            biome,
            revealed: index < reveal_limit,
            source: if index < BASE_VISIBLE_NODES {
                RouteRevealSourceV1::Base
            } else {
                RouteRevealSourceV1::Upgrade
            },
        })
        .collect();
    for biome in &run.world.event_revealed_biomes {
        if !nodes.iter().any(|node| node.biome == *biome) {
            nodes.push(PendingRouteNodeV1 {
                biome: *biome,
                revealed: true,
                source: RouteRevealSourceV1::Event,
            });
        }
    }
    let mut after = before.clone();
    let world = world_mut(&mut after)?;
    world.pending_nodes = nodes;
    world.pending_nodes_ready = true;
    Ok(RouteGraphTransitionV1 {
        after_state: validate_after(after)?,
        draws,
    })
}

pub fn plan_biome_structure<R: AuditedWorldRng>(
    before: &GameStateV5,
    content: &PreparedWorldContentV1,
    rng: &mut R,
) -> Result<BiomeStructureTransitionV1, WorldRuntimeError> {
    let run = before
        .active_run
        .as_ref()
        .ok_or(WorldRuntimeError::Content)?;
    let mode = content.mode(run.mode).ok_or(WorldRuntimeError::Content)?;
    let start = u32::try_from(run.wave.get().get()).map_err(|_| WorldRuntimeError::Wave)?;
    let mut length = None;
    let mut draws = Vec::new();
    if mode.branching_routes {
        let finale_start = mode
            .finale_routing_start_wave
            .or_else(|| mode.terminal_wave.and_then(|wave| wave.checked_sub(30)));
        if mode.sprint_structure {
            if finale_start.is_none_or(|finale| start < finale) {
                let finale = finale_start.ok_or(WorldRuntimeError::Content)?;
                let maximum_stints = ((finale.saturating_sub(start)) / 5).clamp(1, 3);
                let draw = draw_checked(rng, 100)?;
                draws.push(RouteGraphDrawAuditV1 {
                    reason: RouteGraphDrawReasonV1::BiomeLength,
                    upper_exclusive: 100,
                    result: draw,
                });
                let stints = match maximum_stints {
                    1 => 1,
                    2 if draw < 15 => 1,
                    2 => 2,
                    _ if draw < 15 => 1,
                    _ if draw < 70 => 2,
                    _ => 3,
                };
                length = Some(u16::try_from(stints * 5).map_err(|_| WorldRuntimeError::Wave)?);
            }
        } else if finale_start.is_none_or(|finale| {
            start < finale && start.saturating_add(BIOME_LENGTH_MAX as u32 - 1) < finale
        }) {
            let first = draw_checked(rng, BIOME_LENGTH_MAX - BIOME_LENGTH_MIN + 1)?;
            let second = draw_checked(rng, BIOME_LENGTH_MAX - BIOME_LENGTH_MIN + 1)?;
            for result in [first, second] {
                draws.push(RouteGraphDrawAuditV1 {
                    reason: RouteGraphDrawReasonV1::BiomeLength,
                    upper_exclusive: BIOME_LENGTH_MAX - BIOME_LENGTH_MIN + 1,
                    result,
                });
            }
            length = Some(
                u16::try_from(BIOME_LENGTH_MIN + first.max(second))
                    .map_err(|_| WorldRuntimeError::Wave)?,
            );
        }
    }
    let mut after = before.clone();
    let world = world_mut(&mut after)?;
    world.biome_length = length;
    world.biome_start_wave =
        WaveIndex::new(SafeU53::new(u64::from(start)).map_err(|_| WorldRuntimeError::Wave)?)
            .map_err(|_| WorldRuntimeError::Wave)?;
    world.leave_biome_now = false;
    world.overstay_anchor_wave = None;
    Ok(BiomeStructureTransitionV1 {
        after_state: validate_after(after)?,
        draws,
    })
}

pub fn restore_biome_structure(
    before: &GameStateV5,
    length: Option<u16>,
    start_wave: WaveIndex,
    overstay_anchor_wave: Option<WaveIndex>,
) -> Result<GameStateV5, WorldRuntimeError> {
    let mut after = before.clone();
    let world = world_mut(&mut after)?;
    world.biome_length = length;
    world.biome_start_wave = start_wave;
    world.overstay_anchor_wave = overstay_anchor_wave;
    world.leave_biome_now = false;
    validate_after(after)
}

pub fn set_biome_structure_extent(
    before: &GameStateV5,
    length: Option<u16>,
    start_wave: WaveIndex,
) -> Result<GameStateV5, WorldRuntimeError> {
    let mut after = before.clone();
    let world = world_mut(&mut after)?;
    world.biome_length = length;
    world.biome_start_wave = start_wave;
    validate_after(after)
}

pub fn set_biome_overstay_anchor(
    before: &GameStateV5,
    anchor: Option<WaveIndex>,
) -> Result<GameStateV5, WorldRuntimeError> {
    update_world(before, |world| world.overstay_anchor_wave = anchor)
}

pub fn mark_biome_stay(
    before: &GameStateV5,
    content: &PreparedWorldContentV1,
) -> Result<GameStateV5, WorldRuntimeError> {
    let mut after = before.clone();
    let run = after
        .active_run
        .as_mut()
        .ok_or(WorldRuntimeError::Content)?;
    let mode = content.mode(run.mode).ok_or(WorldRuntimeError::Content)?;
    let elapsed = waves_in_current_biome(&run.world, run.wave)?;
    let free_waves = if mode.sprint_structure { 5 } else { 10 };
    if run.world.overstay_anchor_wave.is_none() && elapsed >= free_waves {
        run.world.overstay_anchor_wave = Some(run.wave);
    }
    validate_after(after)
}

pub fn mark_leave_biome(before: &GameStateV5) -> Result<GameStateV5, WorldRuntimeError> {
    update_world(before, |world| world.leave_biome_now = true)
}

pub const MAP_MAX_UPGRADE_TIER: u32 = 3;

pub fn map_upgrade_tier(total_map_stacks: u32) -> u32 {
    total_map_stacks.saturating_sub(1).min(MAP_MAX_UPGRADE_TIER)
}

pub fn visible_route_node_count(
    total_map_stacks: u32,
    relic_extra_nodes: u32,
    ability_extra_nodes: u32,
) -> usize {
    usize::try_from(
        2_u32
            .saturating_add(map_upgrade_tier(total_map_stacks))
            .saturating_add(relic_extra_nodes)
            .saturating_add(ability_extra_nodes)
            .max(1),
    )
    .unwrap_or(usize::MAX)
}

pub fn biome_just_entered_after_wave(world: &WorldStateV1, wave: WaveIndex) -> bool {
    world.biome_start_wave.get().get() == wave.get().get().saturating_add(1)
}

pub fn biome_end_rule(
    world: &WorldStateV1,
    wave: WaveIndex,
    mode: &crate::GameModeDefinitionV1,
) -> Result<Option<bool>, WorldRuntimeError> {
    if in_late_game_zone(mode, wave) || world.biome_length.is_none() {
        return Ok(None);
    }
    if world.leave_biome_now {
        return Ok(Some(true));
    }
    let elapsed = waves_in_current_biome(world, wave)?;
    Ok(Some(
        elapsed >= u64::from(world.biome_length.ok_or(WorldRuntimeError::Content)?),
    ))
}

pub fn should_raise_crossroads(
    world: &WorldStateV1,
    wave: WaveIndex,
    mode: &crate::GameModeDefinitionV1,
) -> Result<bool, WorldRuntimeError> {
    let Some(length) = world.biome_length else {
        return Ok(false);
    };
    if world.leave_biome_now || in_late_game_zone(mode, wave) {
        return Ok(false);
    }
    let elapsed = waves_in_current_biome(world, wave)?;
    Ok(elapsed > 0 && elapsed % 5 == 0 && elapsed < u64::from(length))
}

pub fn in_late_game_zone(mode: &crate::GameModeDefinitionV1, wave: WaveIndex) -> bool {
    mode.finale_routing_start_wave
        .or_else(|| {
            mode.terminal_wave
                .and_then(|terminal| terminal.checked_sub(30))
        })
        .is_some_and(|threshold| wave.get().get() >= u64::from(threshold))
}

pub fn biome_should_end(world: &WorldStateV1, wave: WaveIndex) -> Result<bool, WorldRuntimeError> {
    if world.leave_biome_now {
        return Ok(true);
    }
    let elapsed = waves_in_current_biome(world, wave)?;
    Ok(world
        .biome_length
        .map_or(wave.get().get() % 10 == 0, |length| {
            elapsed >= u64::from(length)
        }))
}

fn collect_base_links<R: AuditedWorldRng>(
    current: &crate::BiomeDefinitionV1,
    content: &PreparedWorldContentV1,
    rng: &mut R,
    draws: &mut Vec<RouteGraphDrawAuditV1>,
    seen: &mut BTreeSet<BiomeId>,
    chosen: &mut Vec<BiomeId>,
) -> Result<(), WorldRuntimeError> {
    for link in &current.routing_exits {
        if let Some(denominator) = link.inclusion_denominator {
            let draw = draw_checked(rng, u64::from(denominator))?;
            draws.push(RouteGraphDrawAuditV1 {
                reason: RouteGraphDrawReasonV1::ConditionalBaseLink,
                upper_exclusive: u64::from(denominator),
                result: draw,
            });
            if draw != 0 {
                continue;
            }
        }
        let route = content
            .route(link.route)
            .ok_or(WorldRuntimeError::Content)?;
        let biome = content
            .biome(route.biome)
            .ok_or(WorldRuntimeError::Content)?;
        if biome.travel_allowed && seen.insert(biome.id) {
            chosen.push(biome.id);
        }
    }
    Ok(())
}

fn loopback_exclusions(world: &WorldStateV1) -> BTreeSet<BiomeId> {
    let mut excluded = BTreeSet::from([world.biome]);
    if let Some(previous) = world.previous_biome {
        excluded.insert(previous);
    }
    excluded.extend(
        world
            .recent_biomes
            .iter()
            .rev()
            .take(NO_LOOPBACK_WINDOW)
            .copied(),
    );
    excluded
}

fn waves_in_current_biome(world: &WorldStateV1, wave: WaveIndex) -> Result<u64, WorldRuntimeError> {
    wave.get()
        .get()
        .checked_sub(world.biome_start_wave.get().get())
        .and_then(|elapsed| elapsed.checked_add(1))
        .ok_or(WorldRuntimeError::Wave)
}

fn draw_checked<R: AuditedWorldRng>(
    rng: &mut R,
    upper_exclusive: u64,
) -> Result<u64, WorldRuntimeError> {
    if upper_exclusive == 0 {
        return Err(WorldRuntimeError::Weight);
    }
    let draw = rng.draw_weighted(upper_exclusive)?;
    if draw >= upper_exclusive {
        return Err(WorldRuntimeError::Draw {
            draw,
            upper: upper_exclusive,
        });
    }
    Ok(draw)
}

fn world_mut(state: &mut GameStateV5) -> Result<&mut WorldStateV1, WorldRuntimeError> {
    state
        .active_run
        .as_mut()
        .map(|run| &mut run.world)
        .ok_or(WorldRuntimeError::Content)
}

fn update_world(
    before: &GameStateV5,
    update: impl FnOnce(&mut WorldStateV1),
) -> Result<GameStateV5, WorldRuntimeError> {
    let mut after = before.clone();
    update(world_mut(&mut after)?);
    validate_after(after)
}

fn validate_after(after: GameStateV5) -> Result<GameStateV5, WorldRuntimeError> {
    after
        .validate()
        .map_err(|error| WorldRuntimeError::State(error.to_string()))?;
    Ok(after)
}

pub fn choose_biome_exit<R: AuditedWorldRng>(
    before: &GameStateV5,
    content: &PreparedWorldContentV1,
    rng: &mut R,
) -> Result<WorldTransitionV1, WorldRuntimeError> {
    let run = before
        .active_run
        .as_ref()
        .ok_or(WorldRuntimeError::Content)?;
    let biome = content
        .biome(run.world.biome)
        .ok_or(WorldRuntimeError::Content)?;
    let (selected, audit) = choose_weighted_route(&biome.exits, rng)?;
    let route = content.route(selected).ok_or(WorldRuntimeError::Content)?;
    let mut after = before.clone();
    let run = after
        .active_run
        .as_mut()
        .ok_or(WorldRuntimeError::Content)?;
    run.world.route = selected;
    run.world.biome = route.biome;
    if run.world.visited_routes.binary_search(&selected).is_err() {
        run.world.visited_routes.push(selected);
        run.world.visited_routes.sort();
    }
    after
        .validate()
        .map_err(|error| WorldRuntimeError::State(error.to_string()))?;
    Ok(WorldTransitionV1 {
        after_state: after,
        selected_route: Some(selected),
        selected_encounter: None,
        audit,
    })
}

pub fn choose_encounter<R: AuditedWorldRng>(
    before: &GameStateV5,
    content: &PreparedWorldContentV1,
    rng: &mut R,
) -> Result<(WorldTransitionV1, EncounterDefinitionV1), WorldRuntimeError> {
    let run = before
        .active_run
        .as_ref()
        .ok_or(WorldRuntimeError::Content)?;
    let biome = content
        .biome(run.world.biome)
        .ok_or(WorldRuntimeError::Content)?;
    let (selected, audit) = choose_weighted_encounter(&biome.encounters, rng)?;
    let encounter = content
        .encounter(selected)
        .ok_or(WorldRuntimeError::Content)?
        .clone();
    let mut after = before.clone();
    let run = after
        .active_run
        .as_mut()
        .ok_or(WorldRuntimeError::Content)?;
    run.world.encounter_sequence = run
        .world
        .encounter_sequence
        .get()
        .checked_add(1)
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(WorldRuntimeError::Wave)?;
    after
        .validate()
        .map_err(|error| WorldRuntimeError::State(error.to_string()))?;
    Ok((
        WorldTransitionV1 {
            after_state: after,
            selected_route: None,
            selected_encounter: Some(selected),
            audit,
        },
        encounter,
    ))
}

pub fn advance_wave(
    before: &GameStateV5,
    content: &PreparedWorldContentV1,
) -> Result<GameStateV5, WorldRuntimeError> {
    let mut after = before.clone();
    let run = after
        .active_run
        .as_mut()
        .ok_or(WorldRuntimeError::Content)?;
    let mode = content.mode(run.mode).ok_or(WorldRuntimeError::Content)?;
    let next = run
        .wave
        .get()
        .get()
        .checked_add(1)
        .and_then(|value| SafeU53::new(value).ok())
        .and_then(|value| er_types::battle_ids::WaveIndex::new(value).ok())
        .ok_or(WorldRuntimeError::Wave)?;
    run.wave = next;
    if mode
        .terminal_wave
        .is_some_and(|terminal| u64::from(next) > u64::from(terminal))
    {
        run.outcome = RunOutcome::Victory;
        run.control.kind = GameControlKindV2::Complete;
        run.control.actionable = false;
        run.control.menu = None;
    }
    after
        .validate()
        .map_err(|error| WorldRuntimeError::State(error.to_string()))?;
    Ok(after)
}

fn choose_weighted_route<R: AuditedWorldRng>(
    values: &[WeightedRouteV1],
    rng: &mut R,
) -> Result<(RouteNodeId, WorldSelectionAuditV1), WorldRuntimeError> {
    choose_weighted(values, |entry| entry.weight, |entry| entry.route, rng)
}

fn choose_weighted_encounter<R: AuditedWorldRng>(
    values: &[WeightedEncounterV1],
    rng: &mut R,
) -> Result<(EncounterId, WorldSelectionAuditV1), WorldRuntimeError> {
    choose_weighted(values, |entry| entry.weight, |entry| entry.encounter, rng)
}

fn choose_weighted<T, K: Copy, R: AuditedWorldRng>(
    values: &[T],
    weight: impl Fn(&T) -> u32,
    key: impl Fn(&T) -> K,
    rng: &mut R,
) -> Result<(K, WorldSelectionAuditV1), WorldRuntimeError> {
    if values.is_empty() {
        return Err(WorldRuntimeError::Weight);
    }
    let total = values
        .iter()
        .try_fold(0_u64, |total, entry| {
            total.checked_add(u64::from(weight(entry)))
        })
        .ok_or(WorldRuntimeError::Weight)?;
    if total == 0 {
        return Err(WorldRuntimeError::Weight);
    }
    let draw = rng.draw_weighted(total)?;
    if draw >= total {
        return Err(WorldRuntimeError::Draw { draw, upper: total });
    }
    let mut frontier = 0_u64;
    for (ordinal, entry) in values.iter().enumerate() {
        frontier = frontier
            .checked_add(u64::from(weight(entry)))
            .ok_or(WorldRuntimeError::Weight)?;
        if draw < frontier {
            return Ok((
                key(entry),
                WorldSelectionAuditV1 {
                    total_weight: total,
                    draw,
                    selected_ordinal: ordinal,
                },
            ));
        }
    }
    Err(WorldRuntimeError::Weight)
}
