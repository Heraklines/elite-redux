//! Deterministic natural-run construction from BootstrapContentPackV1.

use std::collections::BTreeMap;

use er_rng::audit::{RngCallsiteId, RngDraw, RngReason};
use er_rng::battle::RngRuntime;
use er_state::field::{FieldSlotState, FieldState};
use er_state::m7_state::{
    BATTLE_STATE_SCHEMA_VERSION_V5, BattleStateV5, FactionStateV1,
    INVENTORY_STATE_SCHEMA_VERSION_V1, InventoryStateV1, POKEMON_STATE_SCHEMA_VERSION_V5,
    PokemonStateV5, ProgressionQueueV2, QuestStateV1, RUN_STATE_SCHEMA_VERSION_V3, RunStateV3,
    WORLD_STATE_SCHEMA_VERSION_V1, WorldStateV1,
};
use er_state::m9e_state_v6::{
    GAME_STATE_SCHEMA_VERSION_V6, GameIdentityAllocatorStateV1, GameStateV6,
};
use er_state::mechanic_state_v2::MechanicStateStoreV2;
use er_state::pokemon_v2::{Iv, PermanentStatBonuses};
use er_types::battle_command::CommandCollectionState;
use er_types::battle_ids::{
    BattleFormat, BattleSide, FaintOccurrenceId, FieldSlot, TurnIndex, WaveIndex,
};
use er_types::battle_model::{
    AbilityLoadout, BattleOutcome, BattleStats, GlobalAbilitySuppressionState, MoveSlotState,
    PokemonTyping, StatStages, StatusKind, StatusState, TerrainKind, TerrainState, WeatherKind,
    WeatherState,
};
use er_types::run_ids::{BiomeId, Money, RouteNodeId};
use er_types::{
    FormId, GAME_CONTROL_PLAN_SCHEMA_VERSION_V2, GameControlKindV2, GameControlPlanV2, RunOutcome,
    SafeU53, SeatId,
};
use thiserror::Error;

use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m72_bootstrap::{RunBootstrapMachineV1, RunBootstrapStageV1};

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum NaturalRunV6Error {
    #[error("natural V6 bootstrap selection or content is invalid")]
    Invalid,
    #[error("natural V6 identity or arithmetic exhausted")]
    Exhausted,
    #[error("natural V6 state failed validation: {0}")]
    State(String),
}

pub fn construct_natural_run_v6(
    bootstrap: &RunBootstrapMachineV1,
    content: &PreparedGameContentV2,
    authority_revision: SafeU53,
) -> Result<GameStateV6, NaturalRunV6Error> {
    if bootstrap.stage != RunBootstrapStageV1::Complete || authority_revision == SafeU53::ZERO {
        return Err(NaturalRunV6Error::Invalid);
    }
    let mode_id = bootstrap
        .selections
        .mode
        .ok_or(NaturalRunV6Error::Invalid)?;
    let mode = content
        .world
        .mode(mode_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let owner = bootstrap
        .selections
        .starters
        .first()
        .map(|starter| starter.owner_seat)
        .or(bootstrap.control.owner_seat)
        .ok_or(NaturalRunV6Error::Invalid)?;
    if bootstrap.selections.starters.is_empty() {
        return Err(NaturalRunV6Error::Invalid);
    }
    let mut identities =
        GameIdentityAllocatorStateV1::derive(None).map_err(|_| NaturalRunV6Error::Exhausted)?;
    let run_id = identities
        .allocate_run_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let mut rng = RngRuntime::from_run_seed(&bootstrap.seed);
    let mut party = Vec::with_capacity(bootstrap.selections.starters.len());
    for starter in &bootstrap.selections.starters {
        let pokemon_id = identities
            .allocate_pokemon_id()
            .map_err(|_| NaturalRunV6Error::Exhausted)?;
        party.push(pokemon(
            content,
            &mut rng,
            pokemon_id,
            Some(starter.owner_seat),
            er_types::battle_ids::SpeciesId::new(starter.species_id),
            starter.form_index,
            mode.starting_level,
        )?);
    }
    let biome = content
        .world
        .biome(mode.starting_biome)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let enemy_species = select_encounter_species(biome, &mut rng)?;
    let enemy_id = identities
        .allocate_pokemon_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let enemy = pokemon(
        content,
        &mut rng,
        enemy_id,
        None,
        enemy_species,
        0,
        mode.starting_level,
    )?;
    let battle_id = identities
        .allocate_battle_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let wave = WaveIndex::new(safe(1)?).map_err(|_| NaturalRunV6Error::Invalid)?;
    let battle_seed = format!("{}:battle:1", bootstrap.seed);
    let battle_rng = rng
        .initialize_battle(&battle_seed, wave)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let format = BattleFormat::single();
    let player_slot =
        FieldSlot::new(BattleSide::Player, 0).map_err(|_| NaturalRunV6Error::Invalid)?;
    let enemy_slot =
        FieldSlot::new(BattleSide::Enemy, 0).map_err(|_| NaturalRunV6Error::Invalid)?;
    let field = FieldState::new_for_format(
        &format,
        vec![
            FieldSlotState::new(player_slot, Some(party[0].id)),
            FieldSlotState::new(enemy_slot, Some(enemy.id)),
        ],
    )
    .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let control = GameControlPlanV2 {
        schema_version: GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision: authority_revision,
        kind: GameControlKindV2::Waiting,
        owner_seat: None,
        action_context: None,
        menu: None,
        actionable: false,
    };
    let route = RouteNodeId::new(SafeU53::ZERO);
    let run = RunStateV3 {
        schema_version: RUN_STATE_SCHEMA_VERSION_V3,
        run_id,
        seed: bootstrap.seed.clone(),
        mode: mode_id,
        wave,
        run_rng: rng.run_state(),
        party,
        storage: Vec::new(),
        inventory: InventoryStateV1 {
            schema_version: INVENTORY_STATE_SCHEMA_VERSION_V1,
            entries: Vec::new(),
        },
        modifiers: Vec::new(),
        money: Money::new(mode.starting_money),
        world: WorldStateV1 {
            schema_version: WORLD_STATE_SCHEMA_VERSION_V1,
            biome: BiomeId::new(mode.starting_biome.get()),
            route,
            visited_routes: vec![route],
            encounter_sequence: SafeU53::ZERO,
            mode_counters: BTreeMap::new(),
            previous_biome: None,
            recent_biomes: Vec::new(),
            pending_nodes: Vec::new(),
            pending_nodes_ready: false,
            event_revealed_biomes: Vec::new(),
            biome_length: Some(1),
            biome_start_wave: wave,
            leave_biome_now: false,
            overstay_anchor_wave: None,
            map_nodes: Vec::new(),
            travel_target: None,
            authoritative_travel: None,
            treasure_fragments: 0,
            carried_weather: None,
            biome_history: vec![BiomeId::new(mode.starting_biome.get())],
            fairy_luck_bonus: 0,
            fairy_luck_expiry_wave: None,
        },
        scenario: None,
        quests: QuestStateV1::default(),
        factions: FactionStateV1::default(),
        progression_queue: ProgressionQueueV2 {
            next_sequence: safe(1)?,
            tasks: Vec::new(),
            active_index: None,
        },
        battle: Some(BattleStateV5 {
            schema_version: BATTLE_STATE_SCHEMA_VERSION_V5,
            battle_id,
            wave,
            wave_seed: battle_seed,
            turn: TurnIndex::new(safe(1)?).map_err(|_| NaturalRunV6Error::Invalid)?,
            format,
            authority_seat: owner,
            enemy_party: vec![enemy],
            field,
            weather: WeatherState {
                kind: WeatherKind::None,
                remaining_turns: 0,
            },
            terrain: TerrainState {
                kind: TerrainKind::None,
                remaining_turns: 0,
            },
            arena_conditions: Vec::new(),
            global_ability_suppression: GlobalAbilitySuppressionState {
                ignore_abilities: false,
                source: None,
            },
            battle_rng,
            command_state: CommandCollectionState {
                frontier: Vec::new(),
                tombstones: Vec::new(),
            },
            mechanics: MechanicStateStoreV2::default(),
            faint_queue: Vec::new(),
            next_faint_occurrence: FaintOccurrenceId::new(safe(1)?),
            outcome: BattleOutcome::Ongoing,
        }),
        control,
        flags: BTreeMap::new(),
        outcome: RunOutcome::InProgress,
    };
    let mut profile = bootstrap.profile.clone();
    profile.statistics.runs_started = increment(profile.statistics.runs_started)?;
    let state = GameStateV6 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V6,
        content_identity: content.identity().clone(),
        identities,
        profile,
        active_run: Some(run),
    };
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    Ok(state)
}

/// Historical fixture expansion. Current owned setup supplies both seats' choices.
pub fn expand_cooperative_topology_v6(
    state: &mut GameStateV6,
    content: &PreparedGameContentV2,
    partner_seat: SeatId,
) -> Result<(), NaturalRunV6Error> {
    let species = state
        .active_run
        .as_ref()
        .and_then(|run| run.party.first())
        .map(|pokemon| pokemon.species_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let starter = content
        .bundle()
        .bootstrap
        .starters
        .iter()
        .find(|starter| starter.species_id != species)
        .ok_or(NaturalRunV6Error::Invalid)?;
    expand_selected_cooperative_topology_v7(
        state,
        content,
        partner_seat,
        &[(starter.species_id, starter.form_index)],
    )
}

/// Form the partner party from confirmed choices; no fallback selects a species.
/// The caller must additionally validate causal peer identity and confirmation.
/// This operation stages identities, RNG and all party/field changes atomically.
pub fn expand_cooperative_choices_v7(
    state: &mut GameStateV6,
    content: &PreparedGameContentV2,
    partner_seat: SeatId,
    starters: &[er_types::StarterSelectionV1],
) -> Result<(), NaturalRunV6Error> {
    if starters.is_empty()
        || starters.len() > content.bundle().bootstrap.maximum_starters
        || starters
            .iter()
            .any(|starter| starter.owner_seat != partner_seat)
        || starters.iter().enumerate().any(|(index, starter)| {
            starters[..index]
                .iter()
                .any(|other| other.pokemon_id == starter.pokemon_id)
        })
    {
        return Err(NaturalRunV6Error::Invalid);
    }
    let mut cost = 0_u16;
    for starter in starters {
        let index = usize::try_from(starter.pokemon_id.get().get())
            .ok()
            .and_then(|index| index.checked_sub(1))
            .ok_or(NaturalRunV6Error::Invalid)?;
        let entry = content
            .bundle()
            .bootstrap
            .starters
            .get(index)
            .ok_or(NaturalRunV6Error::Invalid)?;
        if entry.species_id.get() != starter.species_id
            || entry.form_index != starter.form_index
            || entry.ability_index != starter.ability_index
            || entry.cost != starter.cost
        {
            return Err(NaturalRunV6Error::Invalid);
        }
        cost = cost
            .checked_add(starter.cost)
            .ok_or(NaturalRunV6Error::Invalid)?;
    }
    if cost > content.bundle().bootstrap.maximum_starter_cost {
        return Err(NaturalRunV6Error::Invalid);
    }
    let choices = starters
        .iter()
        .map(|starter| {
            (
                er_types::battle_ids::SpeciesId::new(starter.species_id),
                starter.form_index,
            )
        })
        .collect::<Vec<_>>();
    let mut candidate = state.clone();
    expand_selected_cooperative_topology_v7(&mut candidate, content, partner_seat, &choices)?;
    *state = candidate;
    Ok(())
}

fn expand_selected_cooperative_topology_v7(
    state: &mut GameStateV6,
    content: &PreparedGameContentV2,
    partner_seat: SeatId,
    starters: &[(er_types::battle_ids::SpeciesId, u16)],
) -> Result<(), NaturalRunV6Error> {
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let (mode_id, biome_id, enemy_species, run_rng) = {
        let run = state
            .active_run
            .as_ref()
            .ok_or(NaturalRunV6Error::Invalid)?;
        let mode = content
            .world
            .mode(run.mode)
            .ok_or(NaturalRunV6Error::Invalid)?;
        if !mode.cooperative
            || run
                .party
                .iter()
                .any(|pokemon| pokemon.owner_seat == Some(partner_seat))
        {
            return Err(NaturalRunV6Error::Invalid);
        }
        let battle = run.battle.as_ref().ok_or(NaturalRunV6Error::Invalid)?;
        if battle.format != BattleFormat::single() || battle.enemy_party.len() != 1 {
            return Err(NaturalRunV6Error::Invalid);
        }
        (
            run.mode,
            run.world.biome,
            battle.enemy_party[0].species_id,
            run.run_rng.clone(),
        )
    };
    let mode = content
        .world
        .mode(mode_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let biome = content
        .world
        .biome(biome_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let partner_enemy_species = biome
        .pokemon_pools
        .iter()
        .flat_map(|pool| pool.species.iter().copied())
        .find(|species| *species != enemy_species)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let mut rng = RngRuntime::from_states(run_rng, None)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let mut partners = Vec::with_capacity(starters.len());
    for &(species, form) in starters {
        let id = state
            .identities
            .allocate_pokemon_id()
            .map_err(|_| NaturalRunV6Error::Exhausted)?;
        partners.push(pokemon(
            content,
            &mut rng,
            id,
            Some(partner_seat),
            species,
            form,
            mode.starting_level,
        )?);
    }
    let partner_id = partners
        .first()
        .map(|pokemon| pokemon.id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let partner_enemy_id = state
        .identities
        .allocate_pokemon_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let partner_enemy = pokemon(
        content,
        &mut rng,
        partner_enemy_id,
        None,
        partner_enemy_species,
        0,
        mode.starting_level,
    )?;
    let run = state
        .active_run
        .as_mut()
        .ok_or(NaturalRunV6Error::Invalid)?;
    run.run_rng = rng.run_state();
    let battle = run.battle.as_mut().ok_or(NaturalRunV6Error::Invalid)?;
    let player_id = run
        .party
        .first()
        .map(|pokemon| pokemon.id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let enemy_id = battle
        .enemy_party
        .first()
        .map(|pokemon| pokemon.id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    run.party.extend(partners);
    battle.enemy_party.push(partner_enemy);
    battle.format = BattleFormat::forced_coop_doubles();
    battle.field = FieldState::new_for_format(
        &battle.format,
        vec![
            FieldSlotState::new(
                FieldSlot::new(BattleSide::Player, 0).map_err(|_| NaturalRunV6Error::Invalid)?,
                Some(player_id),
            ),
            FieldSlotState::new(
                FieldSlot::new(BattleSide::Player, 1).map_err(|_| NaturalRunV6Error::Invalid)?,
                Some(partner_id),
            ),
            FieldSlotState::new(
                FieldSlot::new(BattleSide::Enemy, 0).map_err(|_| NaturalRunV6Error::Invalid)?,
                Some(enemy_id),
            ),
            FieldSlotState::new(
                FieldSlot::new(BattleSide::Enemy, 1).map_err(|_| NaturalRunV6Error::Invalid)?,
                Some(partner_enemy_id),
            ),
        ],
    )
    .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))
}

pub fn advance_to_next_encounter_v6(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<(GameStateV6, Vec<RngDraw>), NaturalRunV6Error> {
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let mut next = state.clone();
    let (previous, next_wave_value, biome_id, mode_id, run_rng, run_seed, player_id) = {
        let run = next.active_run.as_ref().ok_or(NaturalRunV6Error::Invalid)?;
        let previous = run.battle.clone().ok_or(NaturalRunV6Error::Invalid)?;
        if previous.outcome != BattleOutcome::Victory
            || previous.enemy_party.iter().any(|pokemon| !pokemon.fainted)
        {
            return Err(NaturalRunV6Error::Invalid);
        }
        let next_wave_value = run
            .wave
            .get()
            .get()
            .checked_add(1)
            .ok_or(NaturalRunV6Error::Exhausted)?;
        let player_id = run
            .party
            .iter()
            .find(|pokemon| !pokemon.fainted)
            .map(|pokemon| pokemon.id)
            .ok_or(NaturalRunV6Error::Invalid)?;
        (
            previous,
            next_wave_value,
            run.world.biome,
            run.mode,
            run.run_rng.clone(),
            run.seed.clone(),
            player_id,
        )
    };
    let next_wave = WaveIndex::new(safe(next_wave_value)?)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let biome = content
        .world
        .biome(biome_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let mut rng = RngRuntime::from_states(run_rng, None)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let enemy_species = select_encounter_species(biome, &mut rng)?;
    let mode = content
        .world
        .mode(mode_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let level_gain = u16::try_from((next_wave_value.saturating_sub(1)) / 2)
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let level = mode
        .starting_level
        .checked_add(level_gain)
        .ok_or(NaturalRunV6Error::Exhausted)?;
    let enemy_id = next
        .identities
        .allocate_pokemon_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let enemy = pokemon(content, &mut rng, enemy_id, None, enemy_species, 0, level)?;
    let battle_id = next
        .identities
        .allocate_battle_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let format = BattleFormat::single();
    let player_slot =
        FieldSlot::new(BattleSide::Player, 0).map_err(|_| NaturalRunV6Error::Invalid)?;
    let enemy_slot =
        FieldSlot::new(BattleSide::Enemy, 0).map_err(|_| NaturalRunV6Error::Invalid)?;
    let field = FieldState::new_for_format(
        &format,
        vec![
            FieldSlotState::new(player_slot, Some(player_id)),
            FieldSlotState::new(enemy_slot, Some(enemy.id)),
        ],
    )
    .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let battle_seed = format!("{run_seed}:battle:{next_wave_value}");
    let battle_rng = rng
        .initialize_battle(&battle_seed, next_wave)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let audit = rng.audit_entries().to_vec();
    let run = next.active_run.as_mut().ok_or(NaturalRunV6Error::Invalid)?;
    run.run_rng = rng.run_state();
    run.wave = next_wave;
    run.world.encounter_sequence = safe(
        run.world
            .encounter_sequence
            .get()
            .checked_add(1)
            .ok_or(NaturalRunV6Error::Exhausted)?,
    )?;
    run.battle = Some(BattleStateV5 {
        schema_version: BATTLE_STATE_SCHEMA_VERSION_V5,
        battle_id,
        wave: next_wave,
        wave_seed: battle_seed,
        turn: battle_rng.turn,
        format,
        authority_seat: previous.authority_seat,
        enemy_party: vec![enemy],
        field,
        weather: WeatherState {
            kind: WeatherKind::None,
            remaining_turns: 0,
        },
        terrain: TerrainState {
            kind: TerrainKind::None,
            remaining_turns: 0,
        },
        arena_conditions: Vec::new(),
        global_ability_suppression: GlobalAbilitySuppressionState {
            ignore_abilities: false,
            source: None,
        },
        battle_rng,
        command_state: CommandCollectionState {
            frontier: Vec::new(),
            tombstones: Vec::new(),
        },
        mechanics: MechanicStateStoreV2::default(),
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::new(safe(1)?),
        outcome: BattleOutcome::Ongoing,
    });
    if next.profile.statistics.highest_wave < next_wave {
        next.profile.statistics.highest_wave = next_wave;
    }
    next.validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    Ok((next, audit))
}

fn select_encounter_species(
    biome: &er_world::content_v2::BiomeDefinitionV2,
    rng: &mut RngRuntime,
) -> Result<er_types::battle_ids::SpeciesId, NaturalRunV6Error> {
    let tier_roll = rng
        .run_rand_seed_int(
            safe(512)?,
            SafeU53::ZERO,
            RngReason::RandomSelector,
            RngCallsiteId::mechanics(RngReason::RandomSelector),
        )
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?
        .get();
    let mut tier = if tier_roll >= 156 {
        0_i16
    } else if tier_roll >= 32 {
        1
    } else if tier_roll >= 6 {
        2
    } else if tier_roll >= 1 {
        3
    } else {
        4
    };
    let candidates = loop {
        let mut candidates = biome
            .pokemon_pools
            .iter()
            .filter(|pool| pool.tier == tier && pool.time_of_day == -1)
            .flat_map(|pool| pool.species.iter().copied())
            .collect::<Vec<_>>();
        if candidates.is_empty() {
            candidates.extend(
                biome
                    .pokemon_pools
                    .iter()
                    .filter(|pool| pool.tier == tier)
                    .flat_map(|pool| pool.species.iter().copied()),
            );
        }
        candidates.sort_unstable();
        candidates.dedup();
        if !candidates.is_empty() || tier == 0 {
            break candidates;
        }
        tier -= 1;
    };
    if candidates.is_empty() {
        return Err(NaturalRunV6Error::Invalid);
    }
    let selected = rng
        .run_pick_index(
            candidates.len(),
            RngReason::RandomSelector,
            RngCallsiteId::mechanics(RngReason::RandomSelector),
        )
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    Ok(candidates[selected])
}

fn pokemon(
    content: &PreparedGameContentV2,
    rng: &mut RngRuntime,
    id: er_types::battle_ids::PokemonId,
    owner_seat: Option<SeatId>,
    species_id: er_types::battle_ids::SpeciesId,
    form_index: u16,
    level: u16,
) -> Result<PokemonStateV5, NaturalRunV6Error> {
    let species = content
        .battle
        .species(species_id)
        .map_err(|_| NaturalRunV6Error::Invalid)?;
    let form_id = FormId::parse(format!("{}:{form_index}", species_id.get().get()))
        .map_err(|_| NaturalRunV6Error::Invalid)?;
    let form = content
        .battle
        .form(&form_id)
        .map_err(|_| NaturalRunV6Error::Invalid)?;
    let base = form.stat_override.unwrap_or(species.base_stats);
    let typing = form.typing_override.unwrap_or(species.typing);
    let abilities = form
        .ability_override
        .as_ref()
        .unwrap_or(&species.ability_slots);
    let progression = content
        .progression
        .species(species_id, form_index)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let growth = content
        .progression
        .growth_rate(progression.growth_rate)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let experience = growth
        .experience_by_level
        .get(usize::from(level.saturating_sub(1)))
        .copied()
        .ok_or(NaturalRunV6Error::Invalid)?;
    let mut ivs = [Iv::new(0).map_err(|_| NaturalRunV6Error::Invalid)?; 6];
    for iv in &mut ivs {
        let draw = rng
            .run_integer_in_range(
                SafeU53::ZERO,
                safe(31)?,
                RngReason::RandomStat,
                RngCallsiteId::mechanics(RngReason::RandomStat),
            )
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
        *iv = Iv::new(u8::try_from(draw.get()).map_err(|_| NaturalRunV6Error::Invalid)?)
            .map_err(|_| NaturalRunV6Error::Invalid)?;
    }
    let nature_index = rng
        .run_pick_index(
            content.progression.pack().natures.len(),
            RngReason::RandomSelector,
            RngCallsiteId::mechanics(RngReason::RandomSelector),
        )
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let nature = content
        .progression
        .pack()
        .natures
        .get(nature_index)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let stats = stats(base, level, &ivs, nature)?;
    let moves = progression
        .level_moves
        .iter()
        .filter(|entry| entry.level > 0 && entry.level <= level as i16)
        .map(|entry| entry.move_id)
        .fold(Vec::new(), |mut moves, move_id| {
            if !moves.contains(&move_id) {
                moves.push(move_id);
            }
            moves
        });
    let selected = moves.into_iter().rev().take(4).collect::<Vec<_>>();
    if selected.is_empty() {
        return Err(NaturalRunV6Error::Invalid);
    }
    let mut move_slots = [None; 4];
    for (index, move_id) in selected.into_iter().rev().enumerate() {
        move_slots[index] = Some(MoveSlotState {
            move_id,
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        });
    }
    Ok(PokemonStateV5 {
        schema_version: POKEMON_STATE_SCHEMA_VERSION_V5,
        id,
        owner_seat,
        species_id,
        form_index,
        level,
        experience,
        types: PokemonTyping {
            primary: typing.primary,
            secondary: typing.secondary,
        },
        stats,
        hp: stats.hp,
        max_hp: stats.hp,
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
        moves: move_slots,
        abilities: AbilityLoadout {
            active: abilities.active,
            passives: abilities.passives,
            active_suppressed: false,
            passive_suppressed: [false; 3],
        },
        ivs,
        gender: None,
        nature: nature.id,
        effective_nature: nature.id,
        friendship: progression.base_friendship,
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
        evolution: er_state::m7_state::EvolutionStateV1 {
            last_completed: None,
            cancelled: Vec::new(),
        },
        tera_type: None,
        shiny: false,
        variant: 0,
        capture: None,
        fainted: false,
    })
}

fn stats(
    base: er_content::species::SpeciesBaseStats,
    level: u16,
    ivs: &[Iv; 6],
    nature: &er_progression::NatureDefinitionV1,
) -> Result<BattleStats, NaturalRunV6Error> {
    let regular = |base: u32, iv: Iv, stat: er_types::battle_model::BattleStat| {
        let raw = (base
            .checked_mul(2)?
            .checked_add(u32::from(iv.get()))?
            .checked_mul(u32::from(level))?
            / 100)
            .checked_add(5)?;
        if nature.increased_stat == Some(stat) && nature.decreased_stat != Some(stat) {
            raw.checked_mul(110).map(|value| value / 100)
        } else if nature.decreased_stat == Some(stat) && nature.increased_stat != Some(stat) {
            raw.checked_mul(90).map(|value| value / 100)
        } else {
            Some(raw)
        }
    };
    let hp = base
        .hp
        .checked_mul(2)
        .and_then(|value| value.checked_add(u32::from(ivs[0].get())))
        .and_then(|value| value.checked_mul(u32::from(level)))
        .map(|value| value / 100)
        .and_then(|value| value.checked_add(u32::from(level)))
        .and_then(|value| value.checked_add(10))
        .ok_or(NaturalRunV6Error::Exhausted)?;
    use er_types::battle_model::BattleStat;
    Ok(BattleStats {
        hp,
        attack: regular(base.attack, ivs[1], BattleStat::Attack)
            .ok_or(NaturalRunV6Error::Exhausted)?,
        defense: regular(base.defense, ivs[2], BattleStat::Defense)
            .ok_or(NaturalRunV6Error::Exhausted)?,
        special_attack: regular(base.special_attack, ivs[3], BattleStat::SpecialAttack)
            .ok_or(NaturalRunV6Error::Exhausted)?,
        special_defense: regular(base.special_defense, ivs[4], BattleStat::SpecialDefense)
            .ok_or(NaturalRunV6Error::Exhausted)?,
        speed: regular(base.speed, ivs[5], BattleStat::Speed)
            .ok_or(NaturalRunV6Error::Exhausted)?,
    })
}

fn safe(value: u64) -> Result<SafeU53, NaturalRunV6Error> {
    SafeU53::new(value).map_err(|_| NaturalRunV6Error::Exhausted)
}

fn increment(value: SafeU53) -> Result<SafeU53, NaturalRunV6Error> {
    let next = value
        .get()
        .checked_add(1)
        .ok_or(NaturalRunV6Error::Exhausted)?;
    safe(next)
}
