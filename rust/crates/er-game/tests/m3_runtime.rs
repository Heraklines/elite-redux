use std::sync::Arc;

use er_content::pack::selected_content_pack;
use er_content::species::find_species;
use er_game::internal_event::{
    ButtonEventPayload, InternalEvent, InternalEventKind, InternalEventQueue,
    InternalEventQueueError,
};
use er_game::runtime::GameRuntime;
use er_rng::battle::BattleRngState;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{BattleOutcome, BattleState, CommandCollectionState};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::BattleFormat;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommand, BattleCommandProposalV1, ScriptedEnemyPolicyV1, player_command_operation_id,
};
use er_types::battle_control::{
    BATTLE_CONTROL_PLAN_SCHEMA_VERSION, BattleControl, BattleControlPlan, BattleMenu,
    BattleMenuOption, CommandRootControl, SeatBattleControl, SeatMenuInstanceAllocator,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId,
    MenuInstanceId, PartyIndex, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_ui::{
    MenuOptionLayout, MenuOptionVisibility,
};
use er_types::{ButtonEvent, GameButton, MenuOptionId, SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn single_button(endpoint: u64, menu: u64) -> TestResult<InternalEvent> {
    Ok(InternalEvent::Button(ButtonEventPayload {
        endpoint: SeatId::new(safe(endpoint)?),
        menu_instance_id: MenuInstanceId::new(safe(menu)?),
        event: ButtonEvent::Pressed(GameButton::Submit),
    }))
}

#[test]
fn internal_fifo_preserves_source_order_and_kind_evidence() -> TestResult {
    let mut queue = InternalEventQueue::new();
    queue.push(single_button(1, 1)?);
    queue.push(single_button(1, 2)?);
    queue.push(single_button(1, 3)?);

    assert_eq!(queue.len(), 3);
    assert_eq!(queue.processed(), 0);
    for menu in 1..=3 {
        let event = queue.pop()?.expect("queued event");
        assert_eq!(event.kind(), InternalEventKind::Button);
        let InternalEvent::Button(payload) = event else {
            unreachable!("kind assertion above guarantees Button");
        };
        assert_eq!(payload.menu_instance_id.get().get(), menu);
    }
    assert!(queue.pop()?.is_none());
    assert!(queue.is_empty());
    assert_eq!(queue.processed(), 3);
    Ok(())
}

#[test]
fn internal_fifo_rejects_event_4097_without_dropping_the_remaining_queue() -> TestResult {
    let mut queue = InternalEventQueue::new();
    for menu in 1..=4_097 {
        queue.push(single_button(1, menu)?);
    }
    for _ in 0..4_096 {
        assert!(queue.pop()?.is_some());
    }
    let error = queue.pop().expect_err("event 4097 must exceed the fixed budget");
    assert_eq!(
        error,
        InternalEventQueueError::InternalEventBudgetExceeded {
            processed: 4_096,
            remaining: 1,
            remaining_kinds: vec![InternalEventKind::Button],
        }
    );
    assert_eq!(queue.len(), 1);
    assert_eq!(queue.processed(), 4_096);
    Ok(())
}

fn fixture_runtime() -> TestResult<GameRuntime> {
    let content = selected_content_pack()?;
    let species = find_species(&content.species, SpeciesId::new(safe(19)?))?;
    let player = pokemon(
        &content,
        1,
        Some(SeatId::new(safe(1)?)),
        species.id,
    )?;
    let enemy = pokemon(&content, 2, None, species.id)?;
    let format = BattleFormat::single();
    let player_slot = FieldSlot::new(BattleSide::Player, 0)?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)?;
    let wave = WaveIndex::new(safe(1)?)?;
    let turn = TurnIndex::new(safe(1)?)?;
    let battle = BattleState {
        battle_id: BattleId::new(safe(1)?),
        wave,
        wave_seed: "m3-runtime-test-wave".to_owned(),
        turn,
        format,
        authority_seat: SeatId::new(safe(1)?),
        player_party: vec![player.clone()],
        enemy_party: vec![enemy.clone()],
        field: FieldState::new_for_format(
            &BattleFormat::single(),
            vec![
                FieldSlotState::new(player_slot, Some(player.id)),
                FieldSlotState::new(enemy_slot, Some(enemy.id)),
            ],
        )?,
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
        battle_rng: BattleRngState::new("m3-runtime-test-battle", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    };
    let state = GameState::new(
        content.hash.clone(),
        GameModeId::new(safe(1)?),
        wave,
        BattleId::new(safe(2)?),
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-runtime-test-run").state(),
        },
        Some(battle),
    )?;
    let operation_id = player_command_operation_id(
        BattleId::new(safe(1)?),
        wave,
        turn,
        player_slot,
        SeatId::new(safe(1)?),
    )?;
    let control_id = "battle/1/wave/1/turn/1/control/player/0/seat/1/command".to_owned();
    let option_id = MenuOptionId::new("command/fight/0")?;
    let option = BattleMenuOption::new(
        option_id.clone(),
        "battle.command.fight",
        MenuOptionVisibility::Visible,
        true,
        MenuOptionLayout::new(option_id.clone(), 0, 0, 0),
    )?;
    let menu = BattleMenu::new(
        MenuInstanceId::new(safe(1)?),
        SeatId::new(safe(1)?),
        control_id,
        option_id,
        vec![option],
        Vec::new(),
    )?;
    let control = BattleControl::CommandRoot(CommandRootControl::new(
        player.id,
        player_slot,
        menu,
    )?);
    let control = BattleControlPlan::new(
        BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
        BattleId::new(safe(1)?),
        wave,
        turn,
        vec![SeatBattleControl::new(
            SeatId::new(safe(1)?),
            Some(operation_id),
            control,
        )],
        vec![SeatMenuInstanceAllocator::new(
            SeatId::new(safe(1)?),
            MenuInstanceId::new(safe(2)?),
        )?],
    )?;
    Ok(GameRuntime::from_parts(
        state,
        control,
        SeatId::new(safe(1)?),
        ScriptedEnemyPolicyV1::new(SafeU53::ZERO, Vec::new())?,
        Vec::new(),
        Vec::new(),
        Arc::new(content),
    )?)
}

fn pokemon(
    content: &er_content::pack::ContentPack,
    id: u64,
    owner_seat: Option<SeatId>,
    species_id: er_types::battle_ids::SpeciesId,
) -> TestResult<PokemonState> {
    let species = find_species(&content.species, species_id)?;
    Ok(PokemonState::new(
        PokemonId::new(safe(id)?),
        owner_seat,
        species.id,
        0,
        25,
        species.base_types,
        BattleStats {
            hp: 100,
            attack: 100,
            defense: 100,
            special_attack: 100,
            special_defense: 100,
            speed: 100,
        },
        100,
        100,
        StatusState {
            kind: er_types::battle_model::StatusKind::None,
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
        [None, None, None, None],
        AbilityLoadout {
            active: er_types::battle_ids::AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

#[test]
fn game_transaction_failure_is_atomic_and_commit_into_swaps_only_validated_state() -> TestResult {
    let runtime = fixture_runtime()?;
    let mut transaction = runtime.transaction();
    let before = transaction.staged().clone();
    let operation_id = player_command_operation_id(
        BattleId::new(safe(1)?),
        WaveIndex::new(safe(1)?)?,
        TurnIndex::new(safe(1)?)?,
        FieldSlot::new(BattleSide::Player, 0)?,
        SeatId::new(safe(1)?),
    )?;
    let proposal = BattleCommandProposalV1::new(
        operation_id,
        BattleId::new(safe(1)?),
        WaveIndex::new(safe(1)?)?,
        TurnIndex::new(safe(1)?)?,
        SeatId::new(safe(1)?),
        PokemonId::new(safe(1)?),
        FieldSlot::new(BattleSide::Player, 0)?,
        BattleCommand::switch(PokemonId::new(safe(1)?), PartyIndex::ZERO),
        MenuInstanceId::new(safe(1)?),
        "battle/1/wave/1/turn/1/control/player/0/seat/1/command",
    )?;
    let result = transaction.reduce(er_game::internal_event::GameIntent::CommandProposal {
        proposal,
        authority_epoch: AuthorityEpoch::new(safe(1)?),
    });
    assert!(result.is_err());
    assert_eq!(transaction.staged(), &before);

    let mut live = runtime.clone();
    transaction.commit_into(&mut live)?;
    assert_eq!(live, runtime);
    Ok(())
}
