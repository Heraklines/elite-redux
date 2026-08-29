use std::error::Error;

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
    BiomeId, Experience, GameRunId, GrowthRateId, Money, RunContentPackHash,
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
    let seat_one = SeatId::new(safe(1)?);
    let player_one = pokemon(1, Some(seat_one), false)?;
    let player_two = pokemon(2, Some(seat_one), true)?;
    let enemy_one = pokemon(101, None, true)?;
    let enemy_two = pokemon(102, None, true)?;
    let run_rng = RunRngState {
        rdg: PhaserRdg::from_seed("settlement").state(),
    };
    let format = BattleFormat::single();
    let battle = BattleStateV2 {
        schema_version: BATTLE_STATE_SCHEMA_VERSION_V2,
        battle_id: source_battle_id,
        wave,
        wave_seed: "wave-seed".to_owned(),
        turn,
        format: format.clone(),
        authority_seat: seat_one,
        enemy_party: vec![enemy_one, enemy_two],
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
            defeated_enemies: vec![
                DefeatedEnemyRecord {
                    pokemon: pokemon_id(101)?,
                    owner_seat: None,
                },
                DefeatedEnemyRecord {
                    pokemon: pokemon_id(102)?,
                    owner_seat: None,
                },
            ],
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
            run_rng,
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
                biome: BiomeId::new(safe(1)?),
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
        player_party: vec![player_one, player_two],
        battle: Some(battle),
    })
}

#[test]
fn settlement_freezes_order_prunes_fainted_and_preserves_rng() -> Result<(), Box<dyn Error>> {
    let before = state()?;
    let before_snapshot = before.clone();
    let input = BattleSettlementInput {
        source_battle_id: battle_id(1)?,
        wave: wave(1)?,
    };
    let prepared = prepare_battle_settlement(&before, &input)?;

    assert_eq!(before, before_snapshot);
    assert_eq!(
        prepared.evidence.retained_participants,
        vec![pokemon_id(1)?]
    );
    assert_eq!(
        prepared.evidence.defeated_enemies,
        before
            .battle
            .as_ref()
            .ok_or("battle missing")?
            .participation
            .defeated_enemies
            .clone()
    );
    assert_eq!(prepared.evidence.scattered_money, Money::new(safe(37)?));
    assert_eq!(prepared.evidence.wave_reward_evidence.len(), 1);
    assert!(prepared.evidence.rng_unchanged);
    assert_eq!(prepared.after_state.run.run_rng, before.run.run_rng);
    assert_eq!(
        prepared
            .after_state
            .battle
            .as_ref()
            .ok_or("battle missing")?
            .battle_rng,
        before.battle.as_ref().ok_or("battle missing")?.battle_rng
    );
    assert_eq!(
        prepared.after_state.run.stage,
        RunStage::AwaitingWaveAdvance
    );
    assert!(
        prepared
            .after_state
            .battle
            .as_ref()
            .ok_or("battle missing")?
            .settlement
            .settled
    );
    assert_eq!(prepared.after_state.run.wave, before.run.wave);
    assert_eq!(prepared.after_state.run.progression, before.run.progression);
    Ok(())
}

#[test]
fn settlement_rejects_wrong_source_and_wave() -> Result<(), Box<dyn Error>> {
    let before = state()?;
    let wrong_source = BattleSettlementInput {
        source_battle_id: battle_id(2)?,
        wave: wave(1)?,
    };
    assert_eq!(
        prepare_battle_settlement(&before, &wrong_source),
        Err(SettlementError::WrongSourceBattle)
    );
    let wrong_wave = BattleSettlementInput {
        source_battle_id: battle_id(1)?,
        wave: wave(2)?,
    };
    assert_eq!(
        prepare_battle_settlement(&before, &wrong_wave),
        Err(SettlementError::WrongWave)
    );
    Ok(())
}

#[test]
fn settlement_rejects_duplicate_participants_and_enemies() -> Result<(), Box<dyn Error>> {
    let mut duplicate_participant = state()?;
    duplicate_participant
        .battle
        .as_mut()
        .ok_or("battle missing")?
        .participation
        .player_participants
        .push(pokemon_id(1)?);
    let input = BattleSettlementInput {
        source_battle_id: battle_id(1)?,
        wave: wave(1)?,
    };
    assert_eq!(
        prepare_battle_settlement(&duplicate_participant, &input),
        Err(SettlementError::DuplicateParticipant)
    );

    let mut duplicate_enemy = state()?;
    duplicate_enemy
        .battle
        .as_mut()
        .ok_or("battle missing")?
        .participation
        .defeated_enemies
        .push(DefeatedEnemyRecord {
            pokemon: pokemon_id(101)?,
            owner_seat: None,
        });
    assert_eq!(
        prepare_battle_settlement(&duplicate_enemy, &input),
        Err(SettlementError::DuplicateDefeatedEnemy)
    );
    Ok(())
}

#[test]
fn settlement_rejects_inconsistent_outcomes_and_repeated_boundaries() -> Result<(), Box<dyn Error>>
{
    let mut inconsistent = state()?;
    inconsistent
        .battle
        .as_mut()
        .ok_or("battle missing")?
        .enemy_party[0]
        .fainted = false;
    inconsistent
        .battle
        .as_mut()
        .ok_or("battle missing")?
        .enemy_party[0]
        .hp = 10;
    let input = BattleSettlementInput {
        source_battle_id: battle_id(1)?,
        wave: wave(1)?,
    };
    assert_eq!(
        prepare_battle_settlement(&inconsistent, &input),
        Err(SettlementError::OutcomeMismatch)
    );

    let mut defeat_with_living_party = state()?;
    defeat_with_living_party
        .battle
        .as_mut()
        .ok_or("battle missing")?
        .outcome = BattleOutcome::Defeat;
    assert_eq!(
        prepare_battle_settlement(&defeat_with_living_party, &input),
        Err(SettlementError::OutcomeMismatch)
    );

    let prepared = prepare_battle_settlement(&state()?, &input)?;
    assert_eq!(
        prepare_battle_settlement(&prepared.after_state, &input),
        Err(SettlementError::AlreadySettled)
    );
    Ok(())
}

#[test]
fn settlement_rejects_unknown_participants_and_living_defeated_enemies()
-> Result<(), Box<dyn Error>> {
    let mut unknown = state()?;
    unknown
        .battle
        .as_mut()
        .ok_or("battle missing")?
        .participation
        .player_participants
        .push(pokemon_id(999)?);
    let input = BattleSettlementInput {
        source_battle_id: battle_id(1)?,
        wave: wave(1)?,
    };
    assert_eq!(
        prepare_battle_settlement(&unknown, &input),
        Err(SettlementError::UnknownParticipant)
    );

    let mut living_enemy = state()?;
    living_enemy
        .battle
        .as_mut()
        .ok_or("battle missing")?
        .enemy_party[0]
        .fainted = false;
    living_enemy
        .battle
        .as_mut()
        .ok_or("battle missing")?
        .enemy_party[0]
        .hp = 10;
    living_enemy
        .player_party
        .get_mut(0)
        .ok_or("player missing")?
        .hp = 0;
    living_enemy
        .player_party
        .get_mut(0)
        .ok_or("player missing")?
        .fainted = true;
    living_enemy
        .battle
        .as_mut()
        .ok_or("battle missing")?
        .outcome = BattleOutcome::Defeat;
    assert_eq!(
        prepare_battle_settlement(&living_enemy, &input),
        Err(SettlementError::LivingDefeatedEnemy)
    );
    Ok(())
}
