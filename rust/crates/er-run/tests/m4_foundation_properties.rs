use std::error::Error;

use er_canonical::canonical_bytes;
use er_rng::battle::BattleRngState;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_run::settlement::{BattleSettlementInput, SettlementError, prepare_battle_settlement};
use er_state::battle_v2::{
    BATTLE_STATE_SCHEMA_VERSION_V2, BattleParticipationState, BattleSettlementState, BattleStateV2,
    DefeatedEnemyRecord, WaveRewardEvidence,
};
use er_state::field::FieldState;
use er_state::game_v2::{GAME_STATE_SCHEMA_VERSION_V2, GameStateV2};
use er_state::pokemon_v2::{
    Iv, POKEMON_STATE_SCHEMA_VERSION_V2, PermanentStatBonuses, PokemonProgressionState,
    PokemonStateV2,
};
use er_state::run_v2::{
    BiomeRuntimeState, PROGRESSION_QUEUE_SCHEMA_VERSION, ProgressionQueue,
    RUN_STATE_SCHEMA_VERSION, RunCounters, RunStateV2,
};
use er_types::battle_command::CommandCollectionState;
use er_types::battle_ids::{
    AbilityId, BattleFormat, BattleId, ContentPackHash, FaintOccurrenceId, GameModeId, PokemonId,
    SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{
    AbilityLoadout, BattleOutcome, BattleStats, GlobalAbilitySuppressionState, PokemonType,
    PokemonTyping, StatStages, StatusKind, StatusState, TerrainKind, TerrainState, WeatherKind,
    WeatherState,
};
use er_types::run_ids::{
    BiomeId as BiomeIdType, Experience, GameRunId, GrowthRateId, Money, RunContentPackHash,
    RunInteractionSequence, RunSurfaceId, RunTaskId,
};
use er_types::run_model::{RunOutcome, RunStage};
use er_types::{SafeU53, SeatId};

fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
    Ok(SafeU53::new(value)?)
}

fn battle_id(value: u64) -> Result<BattleId, Box<dyn Error>> {
    Ok(BattleId::new(safe(value)?))
}

fn pokemon_id(value: u64) -> Result<PokemonId, Box<dyn Error>> {
    Ok(PokemonId::new(safe(value)?))
}

fn wave(value: u64) -> Result<WaveIndex, Box<dyn Error>> {
    Ok(WaveIndex::new(safe(value)?)?)
}

fn turn(value: u64) -> Result<TurnIndex, Box<dyn Error>> {
    Ok(TurnIndex::new(safe(value)?)?)
}

fn hash() -> String {
    format!("blake3-v1:{}", "0".repeat(64))
}

fn pokemon(
    id: u64,
    owner_seat: Option<SeatId>,
    fainted: bool,
) -> Result<PokemonStateV2, Box<dyn Error>> {
    let iv = Iv::new(0)?;
    Ok(PokemonStateV2 {
        schema_version: POKEMON_STATE_SCHEMA_VERSION_V2,
        id: pokemon_id(id)?,
        owner_seat,
        species_id: SpeciesId::new(safe(1)?),
        form_index: 0,
        level: 1,
        types: PokemonTyping {
            primary: PokemonType::Normal,
            secondary: None,
        },
        stats: BattleStats {
            hp: 10,
            attack: 10,
            defense: 10,
            special_attack: 10,
            special_defense: 10,
            speed: 10,
        },
        hp: if fainted { 0 } else { 10 },
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
            active: AbilityId::new(safe(0)?),
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        fainted,
        progression: PokemonProgressionState {
            experience: Experience::new(safe(0)?),
            growth_rate: GrowthRateId::new(3),
            ivs: [iv; 6],
            nature: er_types::run_ids::NatureId::new(0),
            effective_nature: er_types::run_ids::NatureId::new(0),
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
        },
    })
}

fn state() -> Result<GameStateV2, Box<dyn Error>> {
    let wave = wave(1)?;
    let source_battle_id = battle_id(1)?;
    let turn = turn(1)?;
    let seat = SeatId::new(safe(1)?);
    let format = BattleFormat::single();
    let battle = BattleStateV2 {
        schema_version: BATTLE_STATE_SCHEMA_VERSION_V2,
        battle_id: source_battle_id,
        wave,
        wave_seed: "wave-seed".to_owned(),
        turn,
        format: format.clone(),
        authority_seat: seat,
        enemy_party: vec![pokemon(101, None, true)?],
        field: FieldState::empty_for_format(&format)?,
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
        battle_rng: BattleRngState::new("battle-seed", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        participation: BattleParticipationState {
            player_participants: vec![pokemon_id(1)?, pokemon_id(2)?],
            defeated_enemies: vec![DefeatedEnemyRecord {
                pokemon: pokemon_id(101)?,
                owner_seat: None,
            }],
        },
        settlement: BattleSettlementState {
            source_battle_id,
            settled: false,
            scattered_money: Money::new(safe(37)?),
            wave_reward_evidence: vec![WaveRewardEvidence {
                pokemon: pokemon_id(1)?,
                experience: Experience::new(safe(9)?),
            }],
        },
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::new(safe(1)?),
        outcome: BattleOutcome::Victory,
    };
    Ok(GameStateV2 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V2,
        battle_content_hash: ContentPackHash::new(hash())?,
        run_content_hash: RunContentPackHash::new(hash())?,
        mode: GameModeId::new(safe(1)?),
        run: RunStateV2 {
            schema_version: RUN_STATE_SCHEMA_VERSION,
            run_id: GameRunId::new(safe(1)?),
            seed: "run-seed".to_owned(),
            wave,
            next_battle_id: battle_id(2)?,
            run_rng: RunRngState {
                rdg: PhaserRdg::from_seed("settlement-properties").state(),
            },
            stage: RunStage::Battle,
            outcome: RunOutcome::InProgress,
            money: Money::new(safe(100)?),
            modifiers: Vec::new(),
            progression: ProgressionQueue {
                schema_version: PROGRESSION_QUEUE_SCHEMA_VERSION,
                tasks: Vec::new(),
                active_index: None,
                next_task_id: RunTaskId::new(safe(1)?),
            },
            active_surface: None,
            biome: BiomeRuntimeState {
                biome: BiomeIdType::new(safe(1)?),
                source_wave: wave,
                route_node: None,
                previous_biome: None,
                recent_biomes: [None, None],
                structure_start_wave: wave,
                structure_length: None,
                leave_biome_now: false,
                overstay_anchor_wave: None,
            },
            counters: RunCounters {
                interaction: RunInteractionSequence::new(safe(0)?),
                pending_remote_interaction: None,
                next_surface_id: RunSurfaceId::new(safe(1)?),
                per_stream_action_ordinals: Vec::new(),
            },
        },
        player_party: vec![
            pokemon(1, Some(seat), false)?,
            pokemon(2, Some(seat), true)?,
        ],
        battle: Some(battle),
    })
}

fn input(source_battle_id: u64, wave_value: u64) -> Result<BattleSettlementInput, Box<dyn Error>> {
    Ok(BattleSettlementInput {
        source_battle_id: battle_id(source_battle_id)?,
        wave: wave(wave_value)?,
    })
}

#[test]
fn settlement_is_exactly_once_and_freezes_terminal_stage_evidence() -> Result<(), Box<dyn Error>> {
    let before = state()?;
    before.validate()?;
    let request = input(1, 1)?;
    let prepared = prepare_battle_settlement(&before, &request)?;

    assert_eq!(
        prepared.evidence.retained_participants,
        vec![pokemon_id(1)?]
    );
    assert_eq!(prepared.evidence.defeated_enemies.len(), 1);
    assert!(prepared.evidence.rng_unchanged);
    assert_eq!(
        prepared.after_state.run.stage,
        RunStage::AwaitingWaveAdvance
    );
    assert!(
        prepared
            .after_state
            .battle
            .as_ref()
            .ok_or("missing after battle")?
            .settlement
            .settled
    );
    prepared.after_state.validate()?;

    assert_eq!(
        prepare_battle_settlement(&prepared.after_state, &request),
        Err(SettlementError::AlreadySettled)
    );
    Ok(())
}

#[test]
fn rejected_settlement_never_mutates_input_and_same_input_is_deterministic()
-> Result<(), Box<dyn Error>> {
    let before = state()?;
    let snapshot = before.clone();
    let wrong_source = input(99, 1)?;
    assert_eq!(
        prepare_battle_settlement(&before, &wrong_source),
        Err(SettlementError::WrongSourceBattle)
    );
    assert_eq!(before, snapshot);

    let wrong_wave = input(1, 2)?;
    assert_eq!(
        prepare_battle_settlement(&before, &wrong_wave),
        Err(SettlementError::WrongWave)
    );
    assert_eq!(before, snapshot);

    let request = input(1, 1)?;
    let first = prepare_battle_settlement(&before, &request)?;
    let second = prepare_battle_settlement(&before, &request)?;
    assert_eq!(first, second);
    assert_eq!(canonical_bytes(&first)?, canonical_bytes(&second)?);
    assert_eq!(before, snapshot);
    Ok(())
}
