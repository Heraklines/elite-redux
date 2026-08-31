//! Pinned-oracle M9 natural new-run construction.

use std::collections::BTreeMap;

use er_battle::m7_resolver::TurnAuthorityContextV1;
use er_rng::audit::{
    RngAuditState, RngCallsiteId, RngDraw, RngPublicApi, RngReason, RngStream,
    rng_state_fingerprint,
};
use er_rng::battle::RngRuntime;
use er_rng::phaser::{PhaserRdgState, RunRngState};
use er_state::field::{FieldSlotState, FieldState};
use er_state::m7_state::{
    BATTLE_STATE_SCHEMA_VERSION_V5, BattleStateV5, EvolutionStateV1, FactionStateV1,
    GAME_STATE_SCHEMA_VERSION_V5, GameStateV5, INVENTORY_STATE_SCHEMA_VERSION_V1, InventoryEntryV1,
    InventoryStateV1, POKEMON_STATE_SCHEMA_VERSION_V5, PokemonStateV5, ProfileStateV1,
    ProgressionQueueV2, QuestStateV1, RUN_STATE_SCHEMA_VERSION_V3, RunStateV3,
    WORLD_STATE_SCHEMA_VERSION_V1, WorldStateV1,
};
use er_state::mechanic_state_v2::MechanicStateStoreV2;
use er_state::pokemon_v2::{Iv, PermanentStatBonuses};
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1, BattleTargetSelection,
    CommandCollectionState, CommandSet, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    player_command_operation_id, scripted_enemy_command_operation_id, turn_result_operation_id,
};
use er_types::battle_ids::{
    AbilityId, BattleFormat, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId,
    MenuInstanceId, MoveId, MoveSlotIndex, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{
    AbilityLoadout, BattleOutcome, BattleStats, GlobalAbilitySuppressionState, MoveSlotState,
    PokemonType, PokemonTyping, StatStages, StatusKind, StatusState, TerrainKind, TerrainState,
    WeatherKind, WeatherState,
};
use er_types::run_ids::{BiomeId, Experience, GameRunId, Money, NatureId, RouteNodeId};
use er_types::run_model::RunOutcome;
use er_types::{
    GAME_CONTROL_PLAN_SCHEMA_VERSION_V2, GameControlKindV2, GameControlPlanV2, InventoryItemId,
    SafeU53, SeatId, StarterSelectionV1,
};
use serde::Deserialize;
use thiserror::Error;

use crate::m7_content::PreparedGameContentV1;
use crate::m7_runtime::{GameRuntimeV5, PreparedTurnV5};
use crate::m72_bootstrap::{
    BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapMachineV1, RunBootstrapSelectionsV1,
};
use crate::m72_new_run_material::{NewRunMaterialErrorV1, NewRunMaterialV1};

pub const M9_NEW_RUN_ORACLE_SHA: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

#[derive(Clone, Debug, Deserialize)]
struct StarterOracleV1 {
    schema_version: u32,
    oracle_sha: String,
    seed: String,
    mode: OracleModeV1,
    starter: OracleStarterV1,
    constructed_player: OraclePokemonV1,
    generated_enemy: OraclePokemonV1,
    battle: OracleBattleV1,
    rng: OracleRngV1,
}

#[derive(Clone, Debug, Deserialize)]
struct OracleModeV1 {
    mode_id: u64,
    starting_level: u16,
    starting_money: u64,
    starting_biome_id: u64,
}

#[derive(Clone, Debug, Deserialize)]
struct OracleStarterV1 {
    species_id: u64,
    form_index: u16,
    starter_cost: u16,
}

#[derive(Clone, Debug, Deserialize)]
struct OracleBattleV1 {
    wave_index: u64,
    turn: u64,
    battle_seed: String,
    rng_state: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct OracleRngV1 {
    after_state: String,
    draws: Vec<OracleRngDrawV1>,
}

#[derive(Clone, Debug, Deserialize)]
struct OracleRngDrawV1 {
    sequence: u64,
    min: u64,
    max: u64,
    result: u64,
    before_state: String,
    after_state: String,
    callsite: String,
}

#[derive(Clone, Debug, Deserialize)]
struct OraclePokemonV1 {
    id: u64,
    species_id: u64,
    form_index: u16,
    level: u16,
    experience: u64,
    ability_id: u64,
    passive_ability_ids: Vec<u64>,
    passive_enabled: bool,
    ivs: [u8; 6],
    nature: u64,
    gender: u8,
    friendship: u16,
    shiny: bool,
    variant: u8,
    pause_evolutions: bool,
    tera_type_name: PokemonType,
    type_names: Vec<PokemonType>,
    stats: [u32; 6],
    hp: u32,
    max_hp: u32,
    moves: Vec<OracleMoveSlotV1>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct OracleMoveSlotV1 {
    move_id: u64,
    pp_used: u16,
    max_pp: u16,
}

#[derive(Debug, Error)]
pub enum M9NewRunError {
    #[error("M9 starter frontier mismatch: {0}")]
    Frontier(&'static str),
    #[error("M9 starter oracle is malformed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("M9 starter oracle, bootstrap, or content identity differs")]
    Identity,
    #[error("M9 new-run state construction failed: {0}")]
    State(String),
    #[error("M9 new-run material failed: {0}")]
    Material(#[from] NewRunMaterialErrorV1),
}
pub fn build_m9_bootstrap_machine(
    profile: ProfileStateV1,
    owner: SeatId,
    save_slots: Vec<String>,
    local_is_host: bool,
    starter_oracle_bytes: &[u8],
) -> Result<RunBootstrapMachineV1, M9NewRunError> {
    let oracle: StarterOracleV1 = serde_json::from_slice(starter_oracle_bytes)?;
    if oracle.schema_version != 1
        || oracle.oracle_sha != M9_NEW_RUN_ORACLE_SHA
        || save_slots.is_empty()
        || save_slots.iter().any(String::is_empty)
    {
        return Err(M9NewRunError::Identity);
    }
    let catalog = BootstrapCatalogV1 {
        modes: vec![BootstrapModePolicyV1 {
            mode: GameModeId::new(safe(oracle.mode.mode_id)?),
            challenge_selection: false,
            cooperative: false,
            supported: true,
        }],
        challenges: Vec::new(),
        starters: vec![StarterSelectionV1 {
            pokemon_id: PokemonId::new(safe(oracle.constructed_player.id)?),
            species_id: safe(oracle.starter.species_id)?,
            form_index: oracle.starter.form_index,
            ability_index: 0,
            cost: oracle.starter.starter_cost,
            owner_seat: owner,
        }],
        save_slots,
        automatic_coop_save_slot: None,
        maximum_starter_cost: 10,
        maximum_starters: 6,
        local_is_host,
        developer_mode: false,
    };
    RunBootstrapMachineV1::new(profile, oracle.seed, owner, catalog)
        .map_err(|error| M9NewRunError::State(error.to_string()))
}

pub fn prepare_m9_new_run_material(
    bootstrap: &RunBootstrapMachineV1,
    content: &PreparedGameContentV1,
    starter_oracle_bytes: &[u8],
) -> Result<NewRunMaterialV1, M9NewRunError> {
    let oracle: StarterOracleV1 = serde_json::from_slice(starter_oracle_bytes)?;
    validate_frontier(bootstrap, content, &oracle)?;
    let rng_audit = oracle_rng_audit(&oracle)?;
    NewRunMaterialV1::prepare(bootstrap, content, |selections, prepared| {
        construct_state(bootstrap, selections, prepared, &oracle)
            .map(|(state, control)| (state, control, rng_audit))
            .map_err(|error| error.to_string())
    })
    .map_err(M9NewRunError::Material)
}

pub fn construct_m9_new_run_state(
    bootstrap: &RunBootstrapMachineV1,
    content: &PreparedGameContentV1,
    starter_oracle_bytes: &[u8],
) -> Result<(GameStateV5, GameControlPlanV2), M9NewRunError> {
    let oracle: StarterOracleV1 = serde_json::from_slice(starter_oracle_bytes)?;
    validate_frontier(bootstrap, content, &oracle)?;
    construct_state(bootstrap, &bootstrap.selections, content, &oracle)
}

fn validate_frontier(
    bootstrap: &RunBootstrapMachineV1,
    content: &PreparedGameContentV1,
    oracle: &StarterOracleV1,
) -> Result<(), M9NewRunError> {
    bootstrap
        .validate()
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    if oracle.schema_version != 1
        || oracle.oracle_sha != M9_NEW_RUN_ORACLE_SHA
        || oracle.seed != bootstrap.seed
        || content.identity().oracle_sha.as_str() != M9_NEW_RUN_ORACLE_SHA
    {
        return Err(M9NewRunError::Frontier("schema, oracle, content, or seed"));
    }
    if oracle
        .rng
        .draws
        .iter()
        .enumerate()
        .any(|(index, draw)| usize::try_from(draw.sequence).ok() != Some(index))
    {
        return Err(M9NewRunError::Frontier("RNG draw sequence"));
    }
    let mode = bootstrap
        .selections
        .mode
        .ok_or(M9NewRunError::Frontier("selected mode missing"))?;
    if mode.get().get() != oracle.mode.mode_id
        || oracle.constructed_player.level != oracle.mode.starting_level
        || oracle.battle.wave_index == 0
        || oracle.battle.turn == 0
        || oracle.battle.battle_seed.is_empty()
        || oracle.battle.rng_state.is_some()
    {
        return Err(M9NewRunError::Frontier(
            "mode, level, wave, turn, or battle RNG",
        ));
    }
    let starter = bootstrap
        .selections
        .starters
        .first()
        .ok_or(M9NewRunError::Frontier("selected starter missing"))?;
    if bootstrap.selections.starters.len() != 1
        || starter.species_id
            != SafeU53::new(oracle.constructed_player.species_id)
                .map_err(|_| M9NewRunError::Frontier("starter species ID"))?
        || starter.form_index != oracle.constructed_player.form_index
        || starter.ability_index != 0
    {
        return Err(M9NewRunError::Frontier(
            "starter count, species, form, or ability index",
        ));
    }
    Ok(())
}

fn oracle_rng_audit(oracle: &StarterOracleV1) -> Result<Vec<RngDraw>, M9NewRunError> {
    let mut audit = Vec::with_capacity(oracle.rng.draws.len());
    for draw in &oracle.rng.draws {
        if draw.max < draw.min
            || draw.result < draw.min
            || draw.result > draw.max
            || !draw.callsite.contains("randSeed")
        {
            return Err(M9NewRunError::Frontier("RNG draw shape"));
        }
        let cardinality = draw
            .max
            .checked_sub(draw.min)
            .and_then(|value| value.checked_add(1))
            .ok_or(M9NewRunError::Frontier("RNG draw cardinality"))?;
        let before_state = RngAuditState {
            run: PhaserRdgState::from_state_string(&draw.before_state)
                .map_err(|error| M9NewRunError::State(error.to_string()))?,
            battle: None,
            seed_offset: None,
        };
        let after_state = RngAuditState {
            run: PhaserRdgState::from_state_string(&draw.after_state)
                .map_err(|error| M9NewRunError::State(error.to_string()))?,
            battle: None,
            seed_offset: None,
        };
        let consumed = cardinality > 1;
        let evidence = RngDraw {
            sequence: safe(draw.sequence)?,
            stream: RngStream::Run,
            reason: RngReason::RandomSelector,
            public_api: RngPublicApi::RandSeedInt,
            callsite_id: RngCallsiteId::mechanics(RngReason::RandomSelector),
            minimum: safe(draw.min)?,
            cardinality: safe(cardinality)?,
            result: safe(draw.result)?,
            consumed,
            primitive_draw_count: if consumed { 2 } else { 0 },
            before_fingerprint: rng_state_fingerprint(&before_state)
                .map_err(|error| M9NewRunError::State(error.to_string()))?,
            after_fingerprint: rng_state_fingerprint(&after_state)
                .map_err(|error| M9NewRunError::State(error.to_string()))?,
            before_state,
            after_state,
        };
        evidence
            .validate()
            .map_err(|error| M9NewRunError::State(error.to_string()))?;
        audit.push(evidence);
    }
    if audit.is_empty() || audit.len() != oracle.rng.draws.len() {
        return Err(M9NewRunError::Frontier("RNG audit"));
    }
    Ok(audit)
}

fn construct_state(
    bootstrap: &RunBootstrapMachineV1,
    selections: &RunBootstrapSelectionsV1,
    content: &PreparedGameContentV1,
    oracle: &StarterOracleV1,
) -> Result<(GameStateV5, GameControlPlanV2), M9NewRunError> {
    let owner = bootstrap
        .control
        .owner_seat
        .or_else(|| {
            selections
                .starters
                .first()
                .map(|starter| starter.owner_seat)
        })
        .ok_or(M9NewRunError::Identity)?;
    let player = pokemon_state(&oracle.constructed_player, Some(owner))?;
    let enemy = pokemon_state(&oracle.generated_enemy, None)?;
    let wave = WaveIndex::new(safe(oracle.battle.wave_index)?)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let run_state = RunRngState {
        rdg: PhaserRdgState::from_state_string(&oracle.rng.after_state)
            .map_err(|error| M9NewRunError::State(error.to_string()))?,
    };
    let mut rng = RngRuntime::from_states(run_state, None)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let battle_rng = rng
        .initialize_battle(&oracle.battle.battle_seed, wave)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let format = BattleFormat::single();
    let player_slot = FieldSlot::new(BattleSide::Player, 0)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let field = FieldState::new_for_format(
        &format,
        vec![
            FieldSlotState::new(player_slot, Some(player.id)),
            FieldSlotState::new(enemy_slot, Some(enemy.id)),
        ],
    )
    .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let control = GameControlPlanV2 {
        schema_version: GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision: SafeU53::ZERO,
        kind: GameControlKindV2::BattleCommand,
        owner_seat: Some(owner),
        action_context: None,
        menu: None,
        actionable: false,
    };
    control
        .validate()
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let mode = GameModeId::new(safe(oracle.mode.mode_id)?);
    let route = RouteNodeId::new(SafeU53::ZERO);
    let biome = BiomeId::new(safe(oracle.mode.starting_biome_id)?);
    let run = RunStateV3 {
        schema_version: RUN_STATE_SCHEMA_VERSION_V3,
        run_id: GameRunId::new(safe(1)?),
        seed: oracle.seed.clone(),
        mode,
        wave,
        run_rng: rng.run_state(),
        party: vec![player],
        storage: Vec::new(),
        inventory: InventoryStateV1 {
            schema_version: INVENTORY_STATE_SCHEMA_VERSION_V1,
            entries: Vec::new(),
        },
        modifiers: Vec::new(),
        money: Money::new(safe(oracle.mode.starting_money)?),
        world: WorldStateV1 {
            schema_version: WORLD_STATE_SCHEMA_VERSION_V1,
            biome,
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
            biome_history: vec![biome],
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
            battle_id: BattleId::new(safe(1)?),
            wave,
            wave_seed: oracle.battle.battle_seed.clone(),
            turn: battle_rng.turn,
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
        control: control.clone(),
        flags: BTreeMap::new(),
        outcome: RunOutcome::InProgress,
    };
    let state = GameStateV5 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V5,
        content_identity: content.identity().clone(),
        profile: bootstrap.profile.clone(),
        active_run: Some(run),
    };
    state
        .validate()
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    Ok((state, control))
}

pub fn settle_m9_victory_and_start_next_encounter(
    state: &GameStateV5,
    content: &PreparedGameContentV1,
) -> Result<GameStateV5, M9NewRunError> {
    let mut next = state.clone();
    let run = next.active_run.as_mut().ok_or(M9NewRunError::Identity)?;
    let previous = run.battle.take().ok_or(M9NewRunError::Identity)?;
    if previous.outcome != BattleOutcome::Victory
        || previous.enemy_party.iter().any(|enemy| !enemy.fainted)
        || content
            .world
            .encounter(er_types::run_ids::EncounterId::new(SafeU53::ZERO))
            .is_none()
    {
        return Err(M9NewRunError::Frontier("battle victory or next encounter"));
    }
    let next_wave_value = run
        .wave
        .get()
        .get()
        .checked_add(1)
        .ok_or(M9NewRunError::Identity)?;
    let next_wave = WaveIndex::new(safe(next_wave_value)?)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let next_battle_id = BattleId::new(safe(
        previous
            .battle_id
            .get()
            .get()
            .checked_add(1)
            .ok_or(M9NewRunError::Identity)?,
    )?);
    let mut enemy = previous
        .enemy_party
        .first()
        .cloned()
        .ok_or(M9NewRunError::Identity)?;
    enemy.hp = enemy.max_hp;
    enemy.fainted = false;
    enemy.status = StatusState {
        kind: StatusKind::None,
        toxic_turn_count: 0,
        sleep_turns_remaining: None,
    };
    enemy.stat_stages = StatStages {
        attack: 0,
        defense: 0,
        special_attack: 0,
        special_defense: 0,
        speed: 0,
        accuracy: 0,
        evasion: 0,
    };
    enemy.mechanics = MechanicStateStoreV2::default();
    for slot in enemy.moves.iter_mut().flatten() {
        slot.pp_used = 0;
    }
    let player = run.party.first().ok_or(M9NewRunError::Identity)?;
    let player_slot = FieldSlot::new(BattleSide::Player, 0)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let field = FieldState::new_for_format(
        &previous.format,
        vec![
            FieldSlotState::new(player_slot, Some(player.id)),
            FieldSlotState::new(enemy_slot, Some(enemy.id)),
        ],
    )
    .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let wave_seed = format!("{}/wave/{}", run.seed, next_wave_value);
    let mut rng = RngRuntime::from_states(run.run_rng.clone(), None)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let battle_rng = rng
        .initialize_battle(&wave_seed, next_wave)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    run.run_rng = rng.run_state();
    run.wave = next_wave;
    run.world.encounter_sequence = safe(
        run.world
            .encounter_sequence
            .get()
            .checked_add(1)
            .ok_or(M9NewRunError::Identity)?,
    )?;
    let reward_item = InventoryItemId::new(safe(400)?);
    if let Some(entry) = run
        .inventory
        .entries
        .iter_mut()
        .find(|entry| entry.item == reward_item)
    {
        entry.count = entry.count.checked_add(1).ok_or(M9NewRunError::Identity)?;
    } else {
        run.inventory.entries.push(InventoryEntryV1 {
            item: reward_item,
            registry_key: "POKEBALL".to_owned(),
            count: 1,
        });
        run.inventory.entries.sort_by_key(|entry| entry.item);
    }
    run.control = GameControlPlanV2 {
        schema_version: GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision: safe(
            previous
                .turn
                .get()
                .get()
                .checked_add(1)
                .ok_or(M9NewRunError::Identity)?,
        )?,
        kind: GameControlKindV2::BattleCommand,
        owner_seat: Some(previous.authority_seat),
        action_context: None,
        menu: None,
        actionable: false,
    };
    run.battle = Some(BattleStateV5 {
        schema_version: BATTLE_STATE_SCHEMA_VERSION_V5,
        battle_id: next_battle_id,
        wave: next_wave,
        wave_seed,
        turn: battle_rng.turn,
        format: previous.format,
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
    next.profile.statistics.battles_won = safe(
        next.profile
            .statistics
            .battles_won
            .get()
            .checked_add(1)
            .ok_or(M9NewRunError::Identity)?,
    )?;
    next.validate()
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    Ok(next)
}

fn pokemon_state(
    oracle: &OraclePokemonV1,
    owner: Option<SeatId>,
) -> Result<PokemonStateV5, M9NewRunError> {
    if oracle.type_names.is_empty()
        || oracle.type_names.len() > 2
        || oracle.moves.is_empty()
        || oracle.moves.len() > 4
        || oracle.hp > oracle.max_hp
    {
        return Err(M9NewRunError::Identity);
    }
    let mut moves = [None; 4];
    for (index, slot) in oracle.moves.iter().enumerate() {
        moves[index] = Some(MoveSlotState {
            move_id: MoveId::try_from_u64(slot.move_id)
                .map_err(|error| M9NewRunError::State(error.to_string()))?,
            pp_used: slot.pp_used,
            pp_ups: 0,
            max_pp_override: Some(slot.max_pp),
        });
    }
    let mut passives = [None; 3];
    if oracle.passive_enabled {
        for (slot, value) in oracle
            .passive_ability_ids
            .iter()
            .copied()
            .take(3)
            .enumerate()
        {
            passives[slot] = Some(
                AbilityId::try_from_u64(value)
                    .map_err(|error| M9NewRunError::State(error.to_string()))?,
            );
        }
    }
    let ivs = oracle
        .ivs
        .into_iter()
        .map(|value| Iv::new(value).map_err(|error| M9NewRunError::State(error.to_string())))
        .collect::<Result<Vec<_>, _>>()?
        .try_into()
        .map_err(|_| M9NewRunError::Identity)?;
    Ok(PokemonStateV5 {
        schema_version: POKEMON_STATE_SCHEMA_VERSION_V5,
        id: PokemonId::new(safe(oracle.id)?),
        owner_seat: owner,
        species_id: SpeciesId::try_from_u64(oracle.species_id)
            .map_err(|error| M9NewRunError::State(error.to_string()))?,
        form_index: oracle.form_index,
        level: oracle.level,
        experience: Experience::new(safe(oracle.experience)?),
        types: PokemonTyping {
            primary: oracle.type_names[0],
            secondary: oracle.type_names.get(1).copied(),
        },
        stats: BattleStats {
            hp: oracle.stats[0],
            attack: oracle.stats[1],
            defense: oracle.stats[2],
            special_attack: oracle.stats[3],
            special_defense: oracle.stats[4],
            speed: oracle.stats[5],
        },
        hp: oracle.hp,
        max_hp: oracle.max_hp,
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
        moves,
        abilities: AbilityLoadout {
            active: AbilityId::try_from_u64(oracle.ability_id)
                .map_err(|error| M9NewRunError::State(error.to_string()))?,
            passives,
            active_suppressed: false,
            passive_suppressed: [false; 3],
        },
        ivs,
        gender: Some(oracle.gender),
        nature: NatureId::new(
            u8::try_from(oracle.nature).map_err(|error| M9NewRunError::State(error.to_string()))?,
        ),
        effective_nature: NatureId::new(
            u8::try_from(oracle.nature).map_err(|error| M9NewRunError::State(error.to_string()))?,
        ),
        friendship: oracle.friendship,
        permanent_bonuses: PermanentStatBonuses {
            hp: 0,
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
        },
        pause_evolutions: oracle.pause_evolutions,
        held_items: Vec::new(),
        mechanics: MechanicStateStoreV2::default(),
        fusion: None,
        evolution: EvolutionStateV1 {
            last_completed: None,
            cancelled: Vec::new(),
        },
        tera_type: Some(oracle.tera_type_name),
        shiny: oracle.shiny,
        variant: oracle.variant,
        capture: None,
        fainted: oracle.hp == 0,
    })
}

fn safe(value: u64) -> Result<SafeU53, M9NewRunError> {
    SafeU53::new(value).map_err(|error| M9NewRunError::State(error.to_string()))
}

pub fn scripted_enemy_policy_for_m9(
    state: &GameStateV5,
) -> Result<ScriptedEnemyPolicyV1, M9NewRunError> {
    let run = state.active_run.as_ref().ok_or(M9NewRunError::Identity)?;
    let battle = run.battle.as_ref().ok_or(M9NewRunError::Identity)?;
    let enemy = battle.enemy_party.first().ok_or(M9NewRunError::Identity)?;
    let target = FieldSlot::new(BattleSide::Player, 0)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let mut commands = Vec::with_capacity(64);
    for offset in 0_u64..64 {
        let cursor = safe(offset)?;
        let turn = TurnIndex::new(safe(
            battle
                .turn
                .get()
                .get()
                .checked_add(offset)
                .ok_or(M9NewRunError::Identity)?,
        )?)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
        let command = er_types::battle_command::BattleCommand::fight(
            enemy.id,
            // The M9 deterministic policy selects the pinned Sand Attack slot; enemy AI remains deferred.
            er_types::battle_ids::MoveSlotIndex::new(2)
                .map_err(|error| M9NewRunError::State(error.to_string()))?,
            er_types::battle_command::BattleTargetSelection::selected(vec![target])
                .map_err(|error| M9NewRunError::State(error.to_string()))?,
        )
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
        let operation_id = scripted_enemy_command_operation_id(
            battle.battle_id,
            battle.wave,
            turn,
            enemy_slot,
            cursor,
        )
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
        commands.push(
            ScriptedEnemyBattleCommandV1::new(
                operation_id,
                battle.battle_id,
                battle.wave,
                turn,
                cursor,
                enemy.id,
                enemy_slot,
                command,
            )
            .map_err(|error| M9NewRunError::State(error.to_string()))?,
        );
    }
    ScriptedEnemyPolicyV1::new(SafeU53::ZERO, commands)
        .map_err(|error| M9NewRunError::State(error.to_string()))
}

pub fn resolve_m9_vertical_turn(
    runtime: &mut GameRuntimeV5,
    policy: &ScriptedEnemyPolicyV1,
    cursor: usize,
) -> Result<PreparedTurnV5, M9NewRunError> {
    let (battle_id, wave, turn, authority_seat, player_id) = {
        let run = runtime
            .state()
            .active_run
            .as_ref()
            .ok_or(M9NewRunError::Identity)?;
        let battle = run.battle.as_ref().ok_or(M9NewRunError::Identity)?;
        let player = run.party.first().ok_or(M9NewRunError::Identity)?;
        (
            battle.battle_id,
            battle.wave,
            battle.turn,
            battle.authority_seat,
            player.id,
        )
    };
    let enemy = policy
        .commands
        .get(cursor)
        .cloned()
        .ok_or(M9NewRunError::Frontier("scripted enemy policy exhausted"))?;
    if enemy.turn != turn {
        return Err(M9NewRunError::Frontier(
            "scripted enemy turn does not match battle frontier",
        ));
    }
    let player_slot = FieldSlot::new(BattleSide::Player, 0)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let operation_id =
        player_command_operation_id(battle_id, wave, turn, player_slot, authority_seat)
            .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let command = BattleCommand::fight(
        player_id,
        MoveSlotIndex::new(0).map_err(|error| M9NewRunError::State(error.to_string()))?,
        BattleTargetSelection::selected(vec![enemy_slot])
            .map_err(|error| M9NewRunError::State(error.to_string()))?,
    )
    .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let menu_value = u64::try_from(cursor)
        .ok()
        .and_then(|value| value.checked_add(1))
        .ok_or(M9NewRunError::Identity)?;
    let proposal = BattleCommandProposalV1::new(
        operation_id,
        battle_id,
        wave,
        turn,
        authority_seat,
        player_id,
        player_slot,
        command,
        MenuInstanceId::new(safe(menu_value)?),
        format!("m9/battle/command/{menu_value}"),
    )
    .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let commands = CommandSet::new(vec![
        AcceptedBattleCommand::human(proposal),
        AcceptedBattleCommand::scripted_enemy(enemy),
    ])
    .map_err(|error| M9NewRunError::State(error.to_string()))?;
    let result_operation = turn_result_operation_id(battle_id, wave, turn)
        .map_err(|error| M9NewRunError::State(error.to_string()))?;
    runtime
        .resolve_and_apply_authoritative_turn(
            result_operation,
            &commands,
            &TurnAuthorityContextV1 {
                authority_seat,
                revision: safe(menu_value)?,
            },
        )
        .map_err(|error| M9NewRunError::State(error.to_string()))
}
