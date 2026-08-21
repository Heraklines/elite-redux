use std::error::Error;

use er_canonical::canonical_bytes;
use er_rng::battle::BattleRngState;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{
    BattleId as BattleIdV1, BattleOutcome as BattleOutcomeV1, BattleSide, BattleState,
    FaintOccurrenceId as FaintOccurrenceIdV1,
};
use er_state::battle_v2::{
    BATTLE_STATE_SCHEMA_VERSION_V2, BattleParticipationState, BattleSettlementState, BattleStateV2,
    DefeatedEnemyRecord,
};
use er_state::conditions::{
    ArenaConditionState, GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind,
    WeatherState,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::BattleFormat;
use er_state::game_v2::{GAME_STATE_SCHEMA_VERSION_V2, GameStateV2};
use er_state::migration::{
    M3_PARITY_ORACLE_SHA, M3BattleCompanion, M3PokemonCompanion, M3PokemonCompanionKey,
    M3ToM4MigrationContext, M4_ORACLE_SHA, MigrationStateSide, migrate_m3_game_state,
};
use er_state::pokemon::{
    AbilityLoadout as AbilityLoadoutV1, BattleStats as BattleStatsV1,
    MoveSlotState as MoveSlotStateV1, PokemonState as PokemonStateV1, PokemonType as PokemonTypeV1,
    PokemonTyping as PokemonTypingV1, StatStages as StatStagesV1, StatusKind as StatusKindV1,
    StatusState as StatusStateV1,
};
use er_state::pokemon_v2::{
    Iv, POKEMON_STATE_SCHEMA_VERSION_V2, PermanentStatBonuses, PokemonProgressionState,
    PokemonStateV2,
};
use er_state::run_v2::{
    BiomeId, BiomeRuntimeState, GameRunId, Money, ProgressionQueue, RUN_STATE_SCHEMA_VERSION,
    RunCounters, RunInteractionSequence, RunModifierInstance, RunOutcome, RunStage, RunStateV2,
    RunSurfaceId, RunTaskId,
};
use er_state::snapshot::GameState as GameStateV1;
use er_types::battle_command::CommandCollectionState;
use er_types::battle_ids::{
    AbilityId, BattleId, ContentPackHash, FaintOccurrenceId, FieldSlot, GameModeId, MoveId,
    PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{
    AbilityLoadout, BattleOutcome, BattleStats, GlobalAbilitySuppressionState as GlobalSuppression,
    PokemonType, PokemonTyping, StatStages, StatusKind, StatusState, TerrainKind as TerrainKindV2,
    TerrainState as TerrainStateV2, WeatherKind as WeatherKindV2, WeatherState as WeatherStateV2,
};
use er_types::run_ids::{Experience, GrowthRateId, NatureId, RunContentPackHash};
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

fn hash(fill: char) -> Result<ContentPackHash, Box<dyn Error>> {
    Ok(ContentPackHash::new(format!(
        "blake3-v1:{}",
        fill.to_string().repeat(64)
    ))?)
}

fn run_hash(fill: char) -> Result<RunContentPackHash, Box<dyn Error>> {
    Ok(RunContentPackHash::new(format!(
        "blake3-v1:{}",
        fill.to_string().repeat(64)
    ))?)
}

fn v2_pokemon(
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
        },
    })
}

fn valid_state() -> Result<GameStateV2, Box<dyn Error>> {
    let wave = wave(1)?;
    let source_battle_id = battle_id(1)?;
    let turn = turn(1)?;
    let seat = SeatId::new(safe(1)?);
    let run_rng = RunRngState {
        rdg: PhaserRdg::from_seed("foundation-properties").state(),
    };
    let format = BattleFormat::single();
    let battle = BattleStateV2 {
        schema_version: BATTLE_STATE_SCHEMA_VERSION_V2,
        battle_id: source_battle_id,
        wave,
        wave_seed: "wave-seed".to_owned(),
        turn,
        format: format.clone(),
        authority_seat: seat,
        enemy_party: vec![v2_pokemon(101, None, false)?],
        field: FieldState::empty_for_format(&format)?,
        weather: WeatherStateV2 {
            kind: WeatherKindV2::None,
            remaining_turns: 0,
        },
        terrain: TerrainStateV2 {
            kind: TerrainKindV2::None,
            remaining_turns: 0,
        },
        arena_conditions: Vec::new(),
        global_ability_suppression: GlobalSuppression {
            ignore_abilities: false,
            source: None,
        },
        battle_rng: BattleRngState::new("battle-seed", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        participation: BattleParticipationState {
            player_participants: vec![pokemon_id(1)?],
            defeated_enemies: Vec::new(),
        },
        settlement: BattleSettlementState {
            source_battle_id,
            settled: false,
            scattered_money: Money::new(safe(37)?),
            wave_reward_evidence: Vec::new(),
        },
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::new(safe(1)?),
        outcome: BattleOutcome::Ongoing,
    };
    Ok(GameStateV2 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V2,
        battle_content_hash: hash('a')?,
        run_content_hash: run_hash('b')?,
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
                schema_version: 1,
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
        player_party: vec![
            v2_pokemon(1, Some(seat), false)?,
            v2_pokemon(2, Some(seat), true)?,
        ],
        battle: Some(battle),
    })
}

#[test]
fn valid_state_round_trips_and_validates_without_reordering_owned_vectors()
-> Result<(), Box<dyn Error>> {
    for reverse_roster in [false, true] {
        let mut state = valid_state()?;
        if reverse_roster {
            state.player_party.reverse();
        }
        state.run.modifiers = vec![
            RunModifierInstance {
                modifier_id: er_state::run_v2::ModifierId::new(safe(9)?),
                stacks: 1,
            },
            RunModifierInstance {
                modifier_id: er_state::run_v2::ModifierId::new(safe(4)?),
                stacks: 2,
            },
            RunModifierInstance {
                modifier_id: er_state::run_v2::ModifierId::new(safe(7)?),
                stacks: 1,
            },
        ];
        state.validate()?;

        let bytes = serde_json::to_vec(&state)?;
        let decoded: GameStateV2 = serde_json::from_slice(&bytes)?;
        decoded.validate()?;
        assert_eq!(decoded, state);
        assert_eq!(canonical_bytes(&decoded)?, canonical_bytes(&state)?);
        let expected_party = if reverse_roster {
            vec![pokemon_id(2)?, pokemon_id(1)?]
        } else {
            vec![pokemon_id(1)?, pokemon_id(2)?]
        };
        assert_eq!(
            decoded
                .player_party
                .iter()
                .map(|pokemon| pokemon.id)
                .collect::<Vec<_>>(),
            expected_party
        );
        assert_eq!(
            decoded
                .run
                .modifiers
                .iter()
                .map(|modifier| modifier.modifier_id)
                .collect::<Vec<_>>(),
            vec![
                er_state::run_v2::ModifierId::new(safe(9)?),
                er_state::run_v2::ModifierId::new(safe(4)?),
                er_state::run_v2::ModifierId::new(safe(7)?),
            ]
        );
    }
    Ok(())
}

#[test]
fn duplicate_ids_and_references_are_rejected_before_acceptance() -> Result<(), Box<dyn Error>> {
    let mut duplicate_party = valid_state()?;
    duplicate_party.player_party[1].id = duplicate_party.player_party[0].id;
    assert!(matches!(
        duplicate_party.validate(),
        Err(er_state::validation_v2::StateValidationErrorV2::DuplicatePokemonId { .. })
    ));

    let mut duplicate_cross_owner = valid_state()?;
    duplicate_cross_owner
        .battle
        .as_mut()
        .ok_or("missing battle")?
        .enemy_party[0]
        .id = duplicate_cross_owner.player_party[0].id;
    assert!(matches!(
        duplicate_cross_owner.validate(),
        Err(er_state::validation_v2::StateValidationErrorV2::DuplicatePokemonId { .. })
    ));

    let mut duplicate_participant = valid_state()?;
    duplicate_participant
        .battle
        .as_mut()
        .ok_or("missing battle")?
        .participation
        .player_participants = vec![pokemon_id(1)?, pokemon_id(1)?];
    assert!(matches!(
        duplicate_participant.validate(),
        Err(er_state::validation_v2::StateValidationErrorV2::DuplicateParticipant { .. })
    ));

    let mut unknown_participant = valid_state()?;
    unknown_participant
        .battle
        .as_mut()
        .ok_or("missing battle")?
        .participation
        .player_participants = vec![pokemon_id(999)?];
    assert!(matches!(
        unknown_participant.validate(),
        Err(er_state::validation_v2::StateValidationErrorV2::UnknownParticipant { .. })
    ));

    let mut duplicate_defeated = valid_state()?;
    let battle = duplicate_defeated.battle.as_mut().ok_or("missing battle")?;
    battle.enemy_party[0] = v2_pokemon(101, None, true)?;
    battle.outcome = BattleOutcome::Victory;
    battle.participation.defeated_enemies = vec![
        DefeatedEnemyRecord {
            pokemon: pokemon_id(101)?,
            owner_seat: None,
        },
        DefeatedEnemyRecord {
            pokemon: pokemon_id(101)?,
            owner_seat: None,
        },
    ];
    assert!(matches!(
        duplicate_defeated.validate(),
        Err(er_state::validation_v2::StateValidationErrorV2::DuplicateDefeatedEnemy { .. })
    ));
    Ok(())
}

#[test]
fn terminal_and_settled_states_must_agree_with_run_stage() -> Result<(), Box<dyn Error>> {
    let mut settled_in_battle = valid_state()?;
    settled_in_battle
        .battle
        .as_mut()
        .ok_or("missing battle")?
        .settlement
        .settled = true;
    assert!(matches!(
        settled_in_battle.validate(),
        Err(er_state::validation_v2::StateValidationErrorV2::SettledBattleInBattleStage)
    ));

    let mut awaiting_unsettled = valid_state()?;
    awaiting_unsettled.run.stage = RunStage::AwaitingWaveAdvance;
    assert!(matches!(
        awaiting_unsettled.validate(),
        Err(er_state::validation_v2::StateValidationErrorV2::StageInvariant)
    ));

    let mut terminal = valid_state()?;
    terminal.run.stage = RunStage::AwaitingWaveAdvance;
    let battle = terminal.battle.as_mut().ok_or("missing battle")?;
    battle.enemy_party[0] = v2_pokemon(101, None, true)?;
    battle.outcome = BattleOutcome::Victory;
    battle.settlement.settled = true;
    battle.participation.defeated_enemies = vec![DefeatedEnemyRecord {
        pokemon: pokemon_id(101)?,
        owner_seat: None,
    }];
    terminal.validate()?;
    Ok(())
}

fn v1_pokemon(id: u64, owner: Option<SeatId>) -> Result<PokemonStateV1, Box<dyn Error>> {
    Ok(PokemonStateV1::new(
        PokemonId::new(safe(id)?),
        owner,
        SpeciesId::new(safe(id + 100)?),
        0,
        25,
        PokemonTypingV1 {
            primary: PokemonTypeV1::Normal,
            secondary: None,
        },
        BattleStatsV1 {
            hp: 100,
            attack: 50,
            defense: 50,
            special_attack: 50,
            special_defense: 50,
            speed: 50,
        },
        100,
        100,
        StatusStateV1 {
            kind: StatusKindV1::None,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        },
        StatStagesV1 {
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
            accuracy: 0,
            evasion: 0,
        },
        [
            Some(MoveSlotStateV1 {
                move_id: MoveId::new(safe(1)?),
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            }),
            None,
            None,
            None,
        ],
        AbilityLoadoutV1 {
            active: er_state::pokemon::AbilityId::new(safe(0)?),
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

fn migration_input() -> Result<GameStateV1, Box<dyn Error>> {
    let format = BattleFormat::single();
    let turn = turn(1)?;
    let wave = wave(2)?;
    let seat = SeatId::new(safe(1)?);
    let first = v1_pokemon(17, Some(seat))?;
    let second = v1_pokemon(19, Some(seat))?;
    let enemy = v1_pokemon(18, None)?;
    let field = FieldState::new_for_format(
        &format,
        vec![
            FieldSlotState::new(FieldSlot::new(BattleSide::Player, 0)?, Some(first.id)),
            FieldSlotState::new(FieldSlot::new(BattleSide::Enemy, 0)?, Some(enemy.id)),
        ],
    )?;
    let battle = BattleState {
        battle_id: BattleIdV1::new(safe(7)?),
        wave,
        wave_seed: "migration-wave".to_owned(),
        turn,
        format,
        authority_seat: seat,
        player_party: vec![first, second],
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
        battle_rng: er_state::battle::BattleRngState::new("migration-battle", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceIdV1::ZERO,
        outcome: BattleOutcomeV1::Ongoing,
    };
    Ok(GameStateV1::new(
        hash('a')?,
        GameModeId::new(safe(1)?),
        wave,
        BattleIdV1::new(safe(8)?),
        RunRngState {
            rdg: PhaserRdg::from_seed("migration-properties").state(),
        },
        Some(battle),
    )?)
}

fn companion(
    id: u64,
    side: BattleSide,
    source_index: u8,
    stable_index: u8,
    owner_seat: Option<SeatId>,
) -> Result<M3PokemonCompanion, Box<dyn Error>> {
    Ok(M3PokemonCompanion {
        key: M3PokemonCompanionKey {
            fixture_id: "foundation".to_owned(),
            state_side: MigrationStateSide::Final,
            party_side: side,
            pokemon_id: pokemon_id(id)?,
        },
        source_party_index: source_index,
        stable_roster_index: stable_index,
        owner_seat,
        experience: Experience::new(safe(u64::from(id))?),
        growth_rate: GrowthRateId::new(3),
        ivs: [Iv::new(31)?; 6],
        nature: NatureId::new(0),
        effective_nature: NatureId::new(0),
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

fn migration_context(
    input: &GameStateV1,
    companions: Vec<M3PokemonCompanion>,
) -> Result<M3ToM4MigrationContext, Box<dyn Error>> {
    let source_battle = input.battle.as_ref().ok_or("missing source battle")?;
    Ok(M3ToM4MigrationContext {
        m3_parity_oracle_sha: M3_PARITY_ORACLE_SHA.to_owned(),
        m4_oracle_sha: M4_ORACLE_SHA.to_owned(),
        battle_content_hash: input.content_hash.clone(),
        run_content_hash: run_hash('b')?,
        run: RunStateV2 {
            schema_version: RUN_STATE_SCHEMA_VERSION,
            run_id: GameRunId::new(safe(1)?),
            seed: "migration-properties".to_owned(),
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
                next_task_id: RunTaskId::new(safe(1)?),
            },
            active_surface: None,
            biome: BiomeRuntimeState {
                biome: BiomeId::new(safe(1)?),
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
                interaction: RunInteractionSequence::new(safe(0)?),
                pending_remote_interaction: None,
                next_surface_id: RunSurfaceId::new(safe(1)?),
                per_stream_action_ordinals: Vec::new(),
            },
        },
        fixture_id: "foundation".to_owned(),
        state_side: MigrationStateSide::Final,
        companions,
        battle: Some(M3BattleCompanion {
            fixture_id: "foundation".to_owned(),
            state_side: MigrationStateSide::Final,
            participation: BattleParticipationState {
                player_participants: vec![pokemon_id(17)?],
                defeated_enemies: Vec::new(),
            },
            settlement: BattleSettlementState {
                source_battle_id: source_battle.battle_id,
                settled: false,
                scattered_money: Money::ZERO,
                wave_reward_evidence: Vec::new(),
            },
        }),
    })
}

#[test]
fn migration_preserves_stable_identity_and_orders_roster_by_stable_index()
-> Result<(), Box<dyn Error>> {
    let input = migration_input()?;
    let context = migration_context(
        &input,
        vec![
            companion(17, BattleSide::Player, 0, 1, Some(SeatId::new(safe(1)?)))?,
            companion(19, BattleSide::Player, 1, 0, Some(SeatId::new(safe(1)?)))?,
            companion(18, BattleSide::Enemy, 0, 0, None)?,
        ],
    )?;
    let migrated = migrate_m3_game_state(&input, &context)?;
    migrated.validate()?;

    assert_eq!(
        migrated
            .player_party
            .iter()
            .map(|pokemon| pokemon.id)
            .collect::<Vec<_>>(),
        vec![pokemon_id(19)?, pokemon_id(17)?]
    );
    assert_eq!(
        migrated.player_party[0].progression.experience.get().get(),
        19
    );
    assert_eq!(
        migrated.player_party[1].progression.experience.get().get(),
        17
    );
    assert_eq!(
        migrated.player_party[0].owner_seat,
        Some(SeatId::new(safe(1)?))
    );
    assert_eq!(
        migrated.player_party[1].owner_seat,
        Some(SeatId::new(safe(1)?))
    );
    assert_eq!(
        migrated
            .battle
            .as_ref()
            .ok_or("missing migrated battle")?
            .enemy_party[0]
            .id,
        pokemon_id(18)?
    );
    Ok(())
}

#[test]
fn rejected_migration_never_mutates_the_v1_input() -> Result<(), Box<dyn Error>> {
    let input = migration_input()?;
    let before = input.clone();
    let context = migration_context(
        &input,
        vec![
            companion(17, BattleSide::Player, 0, 1, Some(SeatId::new(safe(1)?)))?,
            companion(19, BattleSide::Player, 0, 0, Some(SeatId::new(safe(1)?)))?,
            companion(18, BattleSide::Enemy, 0, 0, None)?,
        ],
    )?;
    assert!(matches!(
        migrate_m3_game_state(&input, &context),
        Err(er_state::migration::MigrationError::PartyOrderConflict)
    ));
    assert_eq!(input, before);
    Ok(())
}
