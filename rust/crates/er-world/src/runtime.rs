//! Deterministic M7 route, encounter, and wave selection.

use er_state::m7_state::GameStateV5;
use er_types::run_ids::{EncounterId, RouteNodeId};
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
