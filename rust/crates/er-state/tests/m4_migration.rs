use std::error::Error;

use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{BattleId, BattleOutcome, BattleSide, BattleState, FaintOccurrenceId};
use er_state::battle_v2::{BattleParticipationState, BattleRngState, BattleSettlementState};
use er_state::conditions::{
    ArenaConditionState, GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind,
    WeatherState,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::BattleFormat;
use er_state::migration::{
    M3_PARITY_ORACLE_SHA, M3BattleCompanion, M3PokemonCompanion, M3PokemonCompanionKey,
    M3ToM4MigrationContext, M4_ORACLE_SHA, MigrationError, MigrationStateSide,
    migrate_m3_game_state,
};
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, PokemonType, PokemonTyping,
    StatStages, StatusKind, StatusState,
};
use er_state::pokemon_v2::{Iv, PermanentStatBonuses};
use er_state::run_v2::{
    BiomeId, BiomeRuntimeState, GameRunId, Money, ProgressionQueue, RunCounters,
    RunInteractionSequence, RunOutcome, RunStage, RunStateV2, RunSurfaceId, RunTaskId,
};
use er_state::snapshot::GameState;
use er_types::battle_ids::{
    ContentPackHash, FieldSlot, GameModeId, MoveId, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::{SafeU53, SeatId};

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn hash(fill: char) -> Result<ContentPackHash, Box<dyn Error>> {
    Ok(ContentPackHash::new(format!(
        "blake3-v1:{}",
        fill.to_string().repeat(64)
    ))?)
}

fn run_rng() -> RunRngState {
    RunRngState {
        rdg: PhaserRdg::from_seed("migration-test").state(),
    }
}

fn pokemon(id: u64, owner: Option<SeatId>) -> Result<PokemonState, Box<dyn Error>> {
    Ok(PokemonState::new(
        PokemonId::new(safe(id)),
        owner,
        SpeciesId::new(safe(id + 100)),
        0,
        25,
        PokemonTyping {
            primary: PokemonType::Normal,
            secondary: None,
        },
        BattleStats {
            hp: 100,
            attack: 50,
            defense: 50,
            special_attack: 50,
            special_defense: 50,
            speed: 50,
        },
        100,
        100,
        StatusState {
            kind: StatusKind::None,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        },
        StatStages {
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
            accuracy: 0,
            evasion: 0,
        },
        [
            Some(MoveSlotState {
                move_id: MoveId::new(safe(1)),
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            }),
            None,
            None,
            None,
        ],
        AbilityLoadout {
            active: er_state::pokemon::AbilityId::new(safe(0)),
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

fn sample_input() -> Result<GameState, Box<dyn Error>> {
    let format = BattleFormat::single();
    let turn = TurnIndex::new(safe(1))?;
    let wave = WaveIndex::new(safe(2))?;
    let player = pokemon(17, Some(SeatId::new(safe(1))))?;
    let enemy = pokemon(18, None)?;
    let field = FieldState::new_for_format(
        &format,
        vec![
            FieldSlotState::new(FieldSlot::new(BattleSide::Player, 0)?, Some(player.id)),
            FieldSlotState::new(FieldSlot::new(BattleSide::Enemy, 0)?, Some(enemy.id)),
        ],
    )?;
    let battle = BattleState {
        battle_id: BattleId::new(safe(7)),
        wave,
        wave_seed: "migration-wave".to_owned(),
        turn,
        format,
        authority_seat: SeatId::new(safe(1)),
        player_party: vec![player],
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
        arena_conditions: Vec::<ArenaConditionState>::new(),
        global_ability_suppression: GlobalAbilitySuppressionState {
            ignore_abilities: false,
            source: None,
        },
        battle_rng: BattleRngState::new("migration-battle", turn),
        command_state: er_state::battle::CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    };
    Ok(GameState::new(
        hash('a')?,
        GameModeId::new(safe(1)),
        wave,
        BattleId::new(safe(8)),
        run_rng(),
        Some(battle),
    )?)
}

fn companion(
    id: u64,
    side: BattleSide,
    source: u8,
    stable: u8,
    owner: Option<SeatId>,
) -> Result<M3PokemonCompanion, Box<dyn Error>> {
    Ok(M3PokemonCompanion {
        key: M3PokemonCompanionKey {
            fixture_id: "sample".to_owned(),
            state_side: MigrationStateSide::Final,
            party_side: side,
            pokemon_id: PokemonId::new(safe(id)),
        },
        source_party_index: source,
        stable_roster_index: stable,
        owner_seat: owner,
        experience: er_types::run_ids::Experience::new(safe(1234)),
        growth_rate: er_types::run_ids::GrowthRateId::new(3),
        ivs: [Iv::new(31)?; 6],
        nature: er_types::run_ids::NatureId::new(0),
        effective_nature: er_types::run_ids::NatureId::new(0),
        friendship: 42,
        permanent_bonuses: PermanentStatBonuses {
            hp: 0,
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
        },
        pause_evolutions: false,
    })
}

fn context(
    input: &GameState,
    companions: Vec<M3PokemonCompanion>,
) -> Result<M3ToM4MigrationContext, Box<dyn Error>> {
    let Some(source_battle) = input.battle.as_ref() else {
        return Err("sample input must contain a battle".into());
    };
    let battle = M3BattleCompanion {
        fixture_id: "sample".to_owned(),
        state_side: MigrationStateSide::Final,
        participation: BattleParticipationState {
            player_participants: vec![PokemonId::new(safe(17))],
            defeated_enemies: Vec::new(),
        },
        settlement: BattleSettlementState {
            source_battle_id: source_battle.battle_id,
            settled: false,
            scattered_money: Money::ZERO,
            wave_reward_evidence: Vec::new(),
        },
    };
    Ok(M3ToM4MigrationContext {
        m3_parity_oracle_sha: M3_PARITY_ORACLE_SHA.to_owned(),
        m4_oracle_sha: M4_ORACLE_SHA.to_owned(),
        battle_content_hash: input.content_hash.clone(),
        run_content_hash: er_types::run_ids::RunContentPackHash::new(format!(
            "blake3-v1:{}",
            "b".repeat(64)
        ))?,
        run: RunStateV2 {
            schema_version: 1,
            run_id: GameRunId::new(safe(1)),
            seed: "migration-test".to_owned(),
            wave: input.wave,
            next_battle_id: input.next_battle_id,
            run_rng: input.run_rng.clone(),
            stage: RunStage::Battle,
            outcome: RunOutcome::InProgress,
            money: Money::ZERO,
            modifiers: Vec::new(),
            progression: ProgressionQueue {
                schema_version: 1,
                tasks: Vec::new(),
                active_index: None,
                next_task_id: RunTaskId::new(safe(1)),
            },
            active_surface: None,
            biome: BiomeRuntimeState {
                biome: BiomeId::new(safe(1)),
                source_wave: input.wave,
                route_node: None,
                previous_biome: None,
                recent_biomes: [None, None],
                structure_start_wave: input.wave,
                structure_length: None,
                leave_biome_now: false,
                overstay_anchor_wave: None,
            },
            counters: RunCounters {
                interaction: RunInteractionSequence::new(safe(0)),
                pending_remote_interaction: None,
                next_surface_id: RunSurfaceId::new(safe(1)),
                per_stream_action_ordinals: Vec::new(),
            },
        },
        fixture_id: "sample".to_owned(),
        state_side: MigrationStateSide::Final,
        companions,
        battle: Some(battle),
    })
}

#[test]
fn migration_copies_typed_progression_and_battle_evidence() -> Result<(), Box<dyn Error>> {
    let input = sample_input()?;
    let context = context(
        &input,
        vec![
            companion(17, BattleSide::Player, 0, 0, Some(SeatId::new(safe(1))))?,
            companion(18, BattleSide::Enemy, 0, 0, None)?,
        ],
    )?;
    let migrated = migrate_m3_game_state(&input, &context)?;
    assert_eq!(
        migrated.player_party[0].progression.experience.get().get(),
        1234
    );
    assert_eq!(migrated.player_party[0].progression.ivs[0].get(), 31);
    let Some(battle) = migrated.battle.as_ref() else {
        return Err("migration dropped battle".into());
    };
    assert_eq!(
        battle.participation.player_participants,
        vec![PokemonId::new(safe(17))]
    );
    Ok(())
}

#[test]
fn missing_companion_rejects_without_mutating_m3_input() -> Result<(), Box<dyn Error>> {
    let input = sample_input()?;
    let before = input.clone();
    let context = context(
        &input,
        vec![companion(
            17,
            BattleSide::Player,
            0,
            0,
            Some(SeatId::new(safe(1))),
        )?],
    )?;
    assert_eq!(
        migrate_m3_game_state(&input, &context),
        Err(MigrationError::MissingCompanion)
    );
    assert_eq!(input, before);
    Ok(())
}

#[test]
fn duplicate_typed_key_is_rejected_before_state_conversion() -> Result<(), Box<dyn Error>> {
    let input = sample_input()?;
    let first = companion(17, BattleSide::Player, 0, 0, Some(SeatId::new(safe(1))))?;
    let context = context(&input, vec![first.clone(), first])?;
    assert_eq!(
        migrate_m3_game_state(&input, &context),
        Err(MigrationError::DuplicateCompanion)
    );
    Ok(())
}
