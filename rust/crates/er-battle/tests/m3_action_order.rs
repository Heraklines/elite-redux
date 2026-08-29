use std::error::Error;

use er_battle::action_order::{
    ActionOrderError, ActionOrderOptions, PendingAction, UnsupportedOrdering,
    build_pending_action_queue_from_commands, effective_speed, order_pending_actions_from_commands,
};
use er_battle::command::NormalizedBattleCommand;
use er_content::pack::{ContentPack, selected_content_pack};
use er_content::species::find_species;
use er_rng::audit::{RngPublicApi, RngReason};
use er_rng::battle::{BattleRngState, RngRuntime};
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{BattleOutcome, BattleState, CommandCollectionState};
use er_state::conditions::{
    ArenaConditionScope, ArenaConditionState, GlobalAbilitySuppressionState, TerrainKind,
    TerrainState, WeatherKind, WeatherState,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::BattleFormat;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_ids::{
    ArenaConditionId, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId, MoveId,
    MoveSlotIndex, PartyIndex, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{ResolvedActionKind, StatusKind};
use er_types::{OperationId, SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn pokemon_id(value: u64) -> TestResult<PokemonId> {
    Ok(PokemonId::new(safe(value)?))
}

fn species_id(value: u64) -> TestResult<SpeciesId> {
    Ok(SpeciesId::new(safe(value)?))
}

fn move_id(value: u64) -> TestResult<MoveId> {
    Ok(MoveId::new(safe(value)?))
}

fn slot(side: BattleSide, position: u8) -> TestResult<FieldSlot> {
    Ok(FieldSlot::new(side, position)?)
}

fn operation(value: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(value.to_owned())?)
}

fn seat(value: u64) -> TestResult<SeatId> {
    Ok(SeatId::new(safe(value)?))
}

fn pokemon(
    content: &ContentPack,
    id: u64,
    owner_seat: Option<SeatId>,
    speed: u32,
    status_kind: StatusKind,
    speed_stage: i8,
    moves: &[u64],
) -> TestResult<PokemonState> {
    let species = find_species(&content.species, species_id(19)?)?;
    let mut move_slots = [None, None, None, None];
    for (index, value) in moves.iter().copied().enumerate() {
        let destination = move_slots
            .get_mut(index)
            .ok_or("test fixture exceeded four move slots")?;
        *destination = Some(MoveSlotState {
            move_id: move_id(value)?,
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        });
    }
    Ok(PokemonState::new(
        pokemon_id(id)?,
        owner_seat,
        species.id,
        0,
        100,
        species.base_types,
        BattleStats {
            hp: 100,
            attack: 100,
            defense: 100,
            special_attack: 100,
            special_defense: 100,
            speed,
        },
        100,
        100,
        StatusState {
            kind: status_kind,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        },
        StatStages {
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: speed_stage,
            accuracy: 0,
            evasion: 0,
        },
        move_slots,
        AbilityLoadout {
            active: er_types::battle_ids::AbilityId::new(safe(0)?),
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

fn game_state(
    content: &ContentPack,
    format: BattleFormat,
    player_party: Vec<PokemonState>,
    enemy_party: Vec<PokemonState>,
    occupants: Vec<Option<PokemonId>>,
) -> TestResult<GameState> {
    let turn = TurnIndex::new(safe(1)?)?;
    let wave = WaveIndex::new(safe(1)?)?;
    let slots = match (format.player_capacity, format.enemy_capacity) {
        (1, 1) => vec![slot(BattleSide::Player, 0)?, slot(BattleSide::Enemy, 0)?],
        (2, 2) => vec![
            slot(BattleSide::Player, 0)?,
            slot(BattleSide::Player, 1)?,
            slot(BattleSide::Enemy, 0)?,
            slot(BattleSide::Enemy, 1)?,
        ],
        _ => return Err("unsupported test format".into()),
    };
    if occupants.len() != slots.len() {
        return Err("test field occupancy does not match format".into());
    }
    let field = FieldState::new_for_format(
        &format,
        slots
            .into_iter()
            .zip(occupants)
            .map(|(field_slot, occupant)| FieldSlotState::new(field_slot, occupant))
            .collect(),
    )?;
    let battle = BattleState {
        battle_id: BattleId::new(safe(1)?),
        wave,
        wave_seed: "m3-action-order-wave".to_owned(),
        turn,
        format,
        authority_seat: seat(1)?,
        player_party,
        enemy_party,
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
        battle_rng: BattleRngState::new("m3-action-order-battle", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    };
    Ok(GameState::new(
        content.hash.clone(),
        GameModeId::new(safe(1)?),
        wave,
        BattleId::new(safe(2)?),
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-action-order-run").state(),
        },
        Some(battle),
    )?)
}

fn double_state(content: &ContentPack) -> TestResult<GameState> {
    let player_zero = pokemon(content, 1, Some(seat(1)?), 180, StatusKind::None, 0, &[1])?;
    let player_one = pokemon(content, 2, Some(seat(2)?), 180, StatusKind::None, 0, &[1])?;
    let reserve_zero = pokemon(content, 3, Some(seat(1)?), 146, StatusKind::None, 0, &[1])?;
    let enemy_zero = pokemon(content, 4, None, 189, StatusKind::None, 0, &[1])?;
    let enemy_one = pokemon(content, 5, None, 194, StatusKind::None, 0, &[1])?;
    game_state(
        content,
        BattleFormat::coop_double(),
        vec![player_zero, player_one, reserve_zero],
        vec![enemy_zero, enemy_one],
        vec![
            Some(pokemon_id(1)?),
            Some(pokemon_id(2)?),
            Some(pokemon_id(4)?),
            Some(pokemon_id(5)?),
        ],
    )
}

fn single_state(
    content: &ContentPack,
    player_speed: u32,
    player_status: StatusKind,
    player_stage: i8,
    player_moves: &[u64],
    enemy_speed: u32,
    enemy_moves: &[u64],
) -> TestResult<GameState> {
    let player = pokemon(
        content,
        1,
        Some(seat(1)?),
        player_speed,
        player_status,
        player_stage,
        player_moves,
    )?;
    let enemy = pokemon(
        content,
        2,
        None,
        enemy_speed,
        StatusKind::None,
        0,
        enemy_moves,
    )?;
    game_state(
        content,
        BattleFormat::single(),
        vec![player],
        vec![enemy],
        vec![Some(pokemon_id(1)?), Some(pokemon_id(2)?)],
    )
}

fn fight(
    operation_name: &str,
    actor: u64,
    side: BattleSide,
    move_value: u64,
    target_side: BattleSide,
) -> TestResult<NormalizedBattleCommand> {
    fight_at(operation_name, actor, side, 0, move_value, target_side, 0)
}

fn fight_at(
    operation_name: &str,
    actor: u64,
    side: BattleSide,
    position: u8,
    move_value: u64,
    target_side: BattleSide,
    target_position: u8,
) -> TestResult<NormalizedBattleCommand> {
    Ok(NormalizedBattleCommand::Fight {
        operation_id: operation(operation_name)?,
        actor: pokemon_id(actor)?,
        field_slot: slot(side, position)?,
        move_slot: MoveSlotIndex::ZERO,
        move_id: move_id(move_value)?,
        targets: vec![slot(target_side, target_position)?],
    })
}

fn switch(operation_name: &str) -> TestResult<NormalizedBattleCommand> {
    Ok(NormalizedBattleCommand::Switch {
        operation_id: operation(operation_name)?,
        actor: pokemon_id(1)?,
        field_slot: slot(BattleSide::Player, 0)?,
        party_slot: PartyIndex::new(2)?,
        incoming: pokemon_id(3)?,
    })
}

fn runtime(state: &GameState) -> TestResult<RngRuntime> {
    let battle = state.battle.as_ref().ok_or("missing battle")?;
    Ok(RngRuntime::from_states(
        state.run_rng.clone(),
        Some(battle.battle_rng.clone()),
    )?)
}

fn actor_sequence(actions: &[PendingAction]) -> Vec<u64> {
    actions
        .iter()
        .map(|action| u64::from(action.actor))
        .collect()
}

#[test]
fn voluntary_switch_is_constructed_before_the_move_stage() -> TestResult {
    let content = selected_content_pack()?;
    let state = double_state(&content)?;
    let commands = vec![
        fight_at(
            "move-player-one",
            2,
            BattleSide::Player,
            1,
            1,
            BattleSide::Enemy,
            0,
        )?,
        fight(
            "move-enemy-zero",
            4,
            BattleSide::Enemy,
            1,
            BattleSide::Player,
        )?,
        fight_at(
            "move-enemy-one",
            5,
            BattleSide::Enemy,
            1,
            1,
            BattleSide::Player,
            0,
        )?,
        switch("switch-player-zero")?,
    ];
    let mut rng = runtime(&state)?;
    let ordered = order_pending_actions_from_commands(&state, &commands, &content, &mut rng)?;
    let first = ordered.first().ok_or("empty action order")?;
    assert_eq!(first.kind, ResolvedActionKind::Switch);
    assert_eq!(first.actor, pokemon_id(1)?);
    assert_eq!(first.effective_speed, 180);
    assert_eq!(first.command_operation_id, operation("switch-player-zero")?);
    let remaining = ordered.get(1..).ok_or("missing move stage")?;
    assert!(
        remaining
            .iter()
            .all(|action| action.kind == ResolvedActionKind::Move)
    );
    Ok(())
}

#[test]
fn special_hit_priority_beats_a_faster_normal_move() -> TestResult {
    let content = selected_content_pack()?;
    let state = single_state(&content, 80, StatusKind::None, 0, &[351], 200, &[1])?;
    let commands = vec![
        fight(
            "priority-move",
            1,
            BattleSide::Player,
            351,
            BattleSide::Enemy,
        )?,
        fight("normal-move", 2, BattleSide::Enemy, 1, BattleSide::Player)?,
    ];
    let mut rng = runtime(&state)?;
    let ordered = order_pending_actions_from_commands(&state, &commands, &content, &mut rng)?;
    let first = ordered.first().ok_or("empty action order")?;
    assert_eq!(first.actor, pokemon_id(1)?);
    assert_eq!(first.effective_speed, 80);
    assert_eq!(first.move_priority, 2);
    assert_eq!(first.timing_modifier, 1);
    assert_eq!(first.bracket_modifier, 1);
    Ok(())
}

#[test]
fn paralysis_and_stage_math_are_applied_to_live_speed() -> TestResult {
    let content = selected_content_pack()?;
    let state = single_state(&content, 180, StatusKind::Paralysis, 0, &[1], 100, &[1])?;
    let player = state
        .battle
        .as_ref()
        .and_then(|battle| battle.player_party.first())
        .ok_or("missing player")?;
    assert_eq!(effective_speed(player)?, 90);

    let staged = single_state(&content, 180, StatusKind::None, 2, &[1], 100, &[1])?;
    let staged_player = staged
        .battle
        .as_ref()
        .and_then(|battle| battle.player_party.first())
        .ok_or("missing staged player")?;
    assert_eq!(effective_speed(staged_player)?, 360);

    let commands = vec![
        fight("paralyzed", 1, BattleSide::Player, 1, BattleSide::Enemy)?,
        fight("faster-normal", 2, BattleSide::Enemy, 1, BattleSide::Player)?,
    ];
    let mut queue = build_pending_action_queue_from_commands(&state, &commands, &content)?;
    let mut live = state.clone();
    let live_player = live
        .battle
        .as_mut()
        .and_then(|battle| battle.player_party.first_mut())
        .ok_or("missing live player")?;
    live_player.stat_stages.speed = 2;
    let mut rng = runtime(&live)?;
    let first = queue.pop_next(&live, &mut rng)?.ok_or("empty live queue")?;
    assert_eq!(first.actor, pokemon_id(1)?);
    assert_eq!(first.effective_speed, 180);
    let second = queue
        .pop_next(&live, &mut rng)?
        .ok_or("missing second action")?;
    assert_eq!(second.actor, pokemon_id(2)?);
    assert_eq!(second.effective_speed, 100);
    Ok(())
}

#[test]
fn toxic_and_sleep_fail_before_the_speed_shuffle() -> TestResult {
    let content = selected_content_pack()?;
    let state = single_state(&content, 180, StatusKind::None, 0, &[1], 180, &[1])?;
    let commands = vec![
        fight("status-player", 1, BattleSide::Player, 1, BattleSide::Enemy)?,
        fight("status-enemy", 2, BattleSide::Enemy, 1, BattleSide::Player)?,
    ];
    let expected_actor = pokemon_id(1)?;

    for status in [StatusKind::Toxic, StatusKind::Sleep] {
        let mut queue = build_pending_action_queue_from_commands(&state, &commands, &content)?;
        let mut live = state.clone();
        let live_player = live
            .battle
            .as_mut()
            .and_then(|battle| battle.player_party.first_mut())
            .ok_or("missing live player")?;
        live_player.status.kind = status;
        let mut rng = runtime(&live)?;

        let result = queue.pop_next(&live, &mut rng);
        assert!(matches!(
            result,
            Err(ActionOrderError::UnsupportedSpeedStatus {
                actor,
                status: actual_status,
            }) if actor == expected_actor && actual_status == status
        ));
        assert_eq!(queue.len(), 2);
        assert!(rng.audit_entries().is_empty());
    }
    Ok(())
}

#[test]
fn speed_tie_uses_the_exact_seed_offset_shuffle_and_audit() -> TestResult {
    let content = selected_content_pack()?;
    let state = single_state(&content, 180, StatusKind::None, 0, &[1], 180, &[1])?;
    let commands = vec![
        fight("tie-player", 1, BattleSide::Player, 1, BattleSide::Enemy)?,
        fight("tie-enemy", 2, BattleSide::Enemy, 1, BattleSide::Player)?,
    ];
    let mut first_rng = runtime(&state)?;
    let first_order =
        order_pending_actions_from_commands(&state, &commands, &content, &mut first_rng)?;
    let mut second_rng = runtime(&state)?;
    let second_order =
        order_pending_actions_from_commands(&state, &commands, &content, &mut second_rng)?;
    assert_eq!(first_order, second_order);
    assert_eq!(first_rng.audit_entries().len(), 1);
    let draw = first_rng
        .audit_entries()
        .first()
        .ok_or("missing speed-tie audit")?;
    assert_eq!(draw.reason, RngReason::SpeedTie);
    assert_eq!(draw.public_api, RngPublicApi::FisherYatesSwap);
    assert_eq!(draw.cardinality, SafeU53::new(2)?);
    assert_eq!(draw.minimum, SafeU53::ZERO);
    let offset = draw
        .before_state
        .seed_offset
        .as_ref()
        .ok_or("missing seed-offset audit context")?;
    assert_eq!(offset.offset, SafeU53::new(1002)?);
    assert_eq!(offset.wave_seed, "m3-action-order-wave");
    assert!(first_rng.seed_offset_context().is_none());
    Ok(())
}

#[test]
fn equal_move_keys_preserve_seeded_order_without_id_fallback() -> TestResult {
    let content = selected_content_pack()?;
    let state = single_state(&content, 180, StatusKind::None, 0, &[1], 180, &[1])?;
    let commands = vec![
        fight("stable-player", 1, BattleSide::Player, 1, BattleSide::Enemy)?,
        fight("stable-enemy", 2, BattleSide::Enemy, 1, BattleSide::Player)?,
    ];
    let mut first_rng = runtime(&state)?;
    let first = order_pending_actions_from_commands(&state, &commands, &content, &mut first_rng)?;
    let mut second_rng = runtime(&state)?;
    let second = order_pending_actions_from_commands(&state, &commands, &content, &mut second_rng)?;
    assert_eq!(actor_sequence(&first), actor_sequence(&second));
    assert_eq!(
        first
            .iter()
            .map(|action| action.command_operation_id.clone())
            .collect::<Vec<_>>(),
        second
            .iter()
            .map(|action| action.command_operation_id.clone())
            .collect::<Vec<_>>()
    );
    assert!(first.iter().all(|action| action.timing_modifier == 1));
    assert!(first.iter().all(|action| action.bracket_modifier == 1));
    Ok(())
}

#[test]
fn unsupported_ordering_is_rejected_before_rng_consumption() -> TestResult {
    let content = selected_content_pack()?;
    let state = single_state(&content, 180, StatusKind::None, 0, &[1], 180, &[1])?;
    let commands = vec![
        fight(
            "unsupported-player",
            1,
            BattleSide::Player,
            1,
            BattleSide::Enemy,
        )?,
        fight(
            "unsupported-enemy",
            2,
            BattleSide::Enemy,
            1,
            BattleSide::Player,
        )?,
    ];
    let options = ActionOrderOptions {
        trick_room: true,
        ..ActionOrderOptions::default()
    };
    let rng = runtime(&state)?;
    let result = er_battle::action_order::build_pending_action_queue_with_options(
        &state, &commands, &content, &options,
    );
    assert!(matches!(
        result,
        Err(ActionOrderError::Unsupported(
            UnsupportedOrdering::TrickRoom
        ))
    ));
    assert!(rng.audit_entries().is_empty());
    Ok(())
}

#[test]
fn unsupported_arena_state_is_rejected_before_the_shuffle_boundary() -> TestResult {
    let content = selected_content_pack()?;
    let mut state = single_state(&content, 180, StatusKind::None, 0, &[1], 180, &[1])?;
    let battle = state.battle.as_mut().ok_or("missing battle")?;
    battle.arena_conditions.push(ArenaConditionState {
        condition: ArenaConditionId::new("unsupported-arena-condition")?,
        scope: ArenaConditionScope::Both,
        turn_count: 1,
        layers: 1,
    });
    let commands = vec![
        fight("arena-player", 1, BattleSide::Player, 1, BattleSide::Enemy)?,
        fight("arena-enemy", 2, BattleSide::Enemy, 1, BattleSide::Player)?,
    ];
    let rng = runtime(&state)?;
    let result = build_pending_action_queue_from_commands(&state, &commands, &content);
    assert!(matches!(
        result,
        Err(ActionOrderError::Unsupported(
            UnsupportedOrdering::ArenaCondition
        ))
    ));
    assert!(rng.audit_entries().is_empty());
    Ok(())
}

#[test]
fn operation_identity_and_tie_order_are_carried_on_pending_entries() -> TestResult {
    let content = selected_content_pack()?;
    let state = single_state(&content, 180, StatusKind::None, 0, &[1], 180, &[1])?;
    let commands = vec![
        fight(
            "identity-player",
            1,
            BattleSide::Player,
            1,
            BattleSide::Enemy,
        )?,
        fight(
            "identity-enemy",
            2,
            BattleSide::Enemy,
            1,
            BattleSide::Player,
        )?,
    ];
    let mut rng = runtime(&state)?;
    let ordered = order_pending_actions_from_commands(&state, &commands, &content, &mut rng)?;
    for action in &ordered {
        assert_eq!(action.operation_id(), &action.command_operation_id);
        assert_eq!(action.command.operation_id(), &action.command_operation_id);
        assert!(action.tie_order.get() <= 1);
    }
    Ok(())
}

#[test]
fn selected_content_and_state_constructors_reject_unsupported_move_identity() -> TestResult {
    let content = selected_content_pack()?;
    let state = single_state(&content, 180, StatusKind::None, 0, &[1], 180, &[999])?;
    let commands = vec![
        fight("known-player", 1, BattleSide::Player, 1, BattleSide::Enemy)?,
        NormalizedBattleCommand::Fight {
            operation_id: operation("unknown-move")?,
            actor: pokemon_id(2)?,
            field_slot: slot(BattleSide::Enemy, 0)?,
            move_slot: MoveSlotIndex::ZERO,
            move_id: move_id(999)?,
            targets: vec![slot(BattleSide::Player, 0)?],
        },
    ];
    let unknown_move = move_id(999)?;
    let rng = runtime(&state)?;
    let result = build_pending_action_queue_from_commands(&state, &commands, &content);
    assert!(matches!(
        result,
        Err(ActionOrderError::UnsupportedMove { move_id }) if move_id == unknown_move
    ));
    assert!(rng.audit_entries().is_empty());
    Ok(())
}
