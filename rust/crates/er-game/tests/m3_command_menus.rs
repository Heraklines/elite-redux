use std::error::Error;

use er_game::command_menu::{
    COMMAND_FIGHT_OPTION_ID, COMMAND_SWITCH_OPTION_ID, CommandChoice, CommandMenuAvailability,
    CommandMenuError, CommandRootSelection, build_command_menu,
    build_command_menu_with_availability, build_command_root_control, select_command,
};
use er_game::move_menu::{
    MOVE_SLOT_COUNT, MoveActivation, MoveMenuEntry, MoveSelectionError, build_move_control,
    build_move_menu, move_option_id, select_move,
};
use er_game::target_menu::{
    TargetMenuError, build_target_control, build_target_menu, select_target,
};
use er_types::battle_command::{
    BattleCommandOffer, BattleCommandProposalV1, BattleReplacementProposalV1,
    BattleTargetSelection, OfferedMoveCommand, OfferedSwitchCommand,
};
use er_types::battle_control::{BattleControl, BattleControlPlan};
use er_types::battle_ids::{
    BattleSide, FieldSlot, MenuInstanceId, MoveId, MoveSlotIndex, PartyIndex, PokemonId,
};
use er_types::battle_ui::{MenuNavigationEdge, NavigationDirection};
use er_types::{MenuOptionId, SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn seat(value: u64) -> TestResult<SeatId> {
    Ok(SeatId::new(safe(value)?))
}

fn pokemon(value: u64) -> TestResult<PokemonId> {
    Ok(PokemonId::new(safe(value)?))
}

fn move_id(value: u64) -> TestResult<MoveId> {
    Ok(MoveId::new(safe(value)?))
}

fn menu_instance(value: u64) -> TestResult<MenuInstanceId> {
    Ok(MenuInstanceId::new(safe(value)?))
}

fn slot(side: BattleSide, position: u8) -> FieldSlot {
    FieldSlot { side, position }
}

fn player(position: u8) -> FieldSlot {
    slot(BattleSide::Player, position)
}

fn enemy(position: u8) -> FieldSlot {
    slot(BattleSide::Enemy, position)
}

fn target_selection(targets: Vec<FieldSlot>) -> TestResult<BattleTargetSelection> {
    Ok(BattleTargetSelection::selected(targets)?)
}

fn offer_with(
    fight: Vec<OfferedMoveCommand>,
    switches: Vec<OfferedSwitchCommand>,
) -> TestResult<BattleCommandOffer> {
    Ok(BattleCommandOffer::new(fight, switches)?)
}

fn one_move_offer(targets: Vec<BattleTargetSelection>) -> TestResult<OfferedMoveCommand> {
    Ok(OfferedMoveCommand::new(MoveSlotIndex::ZERO, targets)?)
}

fn edge(from: &str, direction: NavigationDirection, to: &str) -> TestResult<MenuNavigationEdge> {
    Ok(MenuNavigationEdge::new(
        MenuOptionId::new(from)?,
        direction,
        MenuOptionId::new(to)?,
    ))
}

fn command_control_id(kind: &str) -> String {
    format!("battle/1/wave/1/turn/1/control/player/0/seat/1/{kind}")
}

fn command_offer() -> TestResult<BattleCommandOffer> {
    offer_with(
        vec![one_move_offer(vec![target_selection(vec![enemy(0)])?])?],
        vec![OfferedSwitchCommand::new(PartyIndex::new(1)?, pokemon(8)?)],
    )
}

fn move_entries() -> TestResult<[MoveMenuEntry; MOVE_SLOT_COUNT]> {
    Ok([
        MoveMenuEntry::enabled(move_id(1)?, vec![BattleTargetSelection::Implicit])?,
        MoveMenuEntry::enabled(move_id(52)?, vec![target_selection(vec![enemy(0)])?])?,
        MoveMenuEntry::empty(),
        MoveMenuEntry::disabled(move_id(77)?),
    ])
}

#[test]
fn command_control_fixture_is_read_and_root_graph_is_complete() -> TestResult {
    let fixture: BattleControlPlan = serde_json::from_str(include_str!(
        "../../../fixtures/m3/schema/battle-control-plan-v1.json"
    ))?;
    let seat_control = &fixture.seats[0];
    let root = match &seat_control.control {
        BattleControl::CommandRoot(root) => root,
        other => return Err(format!("fixture control was {other:?}").into()),
    };
    assert_eq!(
        root.menu.selected_option_id.as_str(),
        COMMAND_FIGHT_OPTION_ID
    );
    assert_eq!(root.menu.options.len(), 2);
    assert!(
        root.menu
            .contains_option(&MenuOptionId::new(COMMAND_FIGHT_OPTION_ID)?)
    );
    assert!(
        root.menu
            .contains_option(&MenuOptionId::new(COMMAND_SWITCH_OPTION_ID)?)
    );

    let menu = build_command_menu(
        menu_instance(1)?,
        seat(1)?,
        command_control_id("command"),
        &command_offer()?,
        CommandRootSelection::Fight,
    )?;
    let mut expected = vec![
        edge(
            COMMAND_FIGHT_OPTION_ID,
            NavigationDirection::Down,
            COMMAND_SWITCH_OPTION_ID,
        )?,
        edge(
            COMMAND_SWITCH_OPTION_ID,
            NavigationDirection::Up,
            COMMAND_FIGHT_OPTION_ID,
        )?,
    ];
    expected.sort_unstable();
    assert_eq!(menu.navigation, expected);
    assert_eq!(menu.options[0].layout.row, 0);
    assert_eq!(menu.options[1].layout.row, 1);
    Ok(())
}

#[test]
fn command_offer_and_proposal_fixtures_retain_typed_menu_context() -> TestResult {
    let offer: BattleCommandOffer = serde_json::from_str(include_str!(
        "../../../fixtures/m3/schema/battle-command-offer-v1.json"
    ))?;
    offer.validate()?;
    assert_eq!(offer.fight.len(), 1);
    assert_eq!(offer.switches.len(), 1);

    let proposal: BattleCommandProposalV1 = serde_json::from_str(include_str!(
        "../../../fixtures/m3/schema/battle-command-proposal-v1.json"
    ))?;
    proposal.validate()?;
    assert_eq!(proposal.menu_instance_id, menu_instance(1)?);
    assert_eq!(proposal.control_id, command_control_id("command"));

    let replacement: BattleReplacementProposalV1 = serde_json::from_str(include_str!(
        "../../../fixtures/m3/schema/battle-replacement-proposal-v1.json"
    ))?;
    replacement.validate()?;
    assert_eq!(replacement.menu_instance_id, menu_instance(2)?);
    assert!(replacement.selection.is_external_submission());
    Ok(())
}

#[test]
fn command_root_retains_disabled_nodes_and_rejects_no_legal_path() -> TestResult {
    let offer = offer_with(
        Vec::new(),
        vec![OfferedSwitchCommand::new(PartyIndex::new(1)?, pokemon(8)?)],
    )?;
    let menu = build_command_menu(
        menu_instance(2)?,
        seat(1)?,
        command_control_id("command"),
        &offer,
        CommandRootSelection::Fight,
    )?;
    assert!(!menu.options[0].enabled);
    assert!(menu.options[1].enabled);
    assert_eq!(select_command(&menu), Err(CommandMenuError::DisabledOption));

    assert_eq!(
        build_command_menu_with_availability(
            menu_instance(3)?,
            seat(1)?,
            command_control_id("command"),
            CommandMenuAvailability::new(false, false),
            CommandRootSelection::Fight,
        ),
        Err(CommandMenuError::NoLegalOption)
    );

    let switch_menu = build_command_menu_with_availability(
        menu_instance(4)?,
        seat(1)?,
        command_control_id("command"),
        CommandMenuAvailability::new(true, true),
        CommandRootSelection::Switch,
    )?;
    assert_eq!(select_command(&switch_menu), Ok(CommandChoice::Switch));
    Ok(())
}

#[test]
fn move_graph_has_every_explicit_edge_and_never_skips_placeholders() -> TestResult {
    let actor = pokemon(7)?;
    let entries = move_entries()?;
    let menu = build_move_menu(
        menu_instance(5)?,
        seat(1)?,
        command_control_id("move"),
        actor,
        &entries,
        Some(MoveSlotIndex::new(2)?),
        false,
    )?;
    assert_eq!(menu.selected_option_id.as_str(), "move/7/slot/0");
    assert!(menu.options.iter().any(|option| {
        option.option_id.as_str() == "move/7/slot/2"
            && option.visibility.is_visible()
            && !option.enabled
    }));
    assert!(menu.options.iter().any(|option| {
        option.option_id.as_str() == "move/7/slot/3"
            && option.visibility.is_visible()
            && !option.enabled
    }));

    let mut expected = vec![
        edge("move/7/slot/0", NavigationDirection::Right, "move/7/slot/1")?,
        edge("move/7/slot/0", NavigationDirection::Down, "move/7/slot/2")?,
        edge("move/7/slot/1", NavigationDirection::Left, "move/7/slot/0")?,
        edge("move/7/slot/1", NavigationDirection::Down, "move/7/slot/3")?,
        edge("move/7/slot/2", NavigationDirection::Up, "move/7/slot/0")?,
        edge("move/7/slot/2", NavigationDirection::Right, "move/7/slot/3")?,
        edge("move/7/slot/3", NavigationDirection::Up, "move/7/slot/1")?,
        edge("move/7/slot/3", NavigationDirection::Left, "move/7/slot/2")?,
    ];
    expected.sort_unstable();
    assert_eq!(menu.navigation, expected);

    let first_summon = build_move_menu(
        menu_instance(6)?,
        seat(1)?,
        command_control_id("move"),
        actor,
        &entries,
        Some(MoveSlotIndex::new(1)?),
        true,
    )?;
    assert_eq!(first_summon.selected_option_id.as_str(), "move/7/slot/0");

    let remembered_present = build_move_menu(
        menu_instance(7)?,
        seat(1)?,
        command_control_id("move"),
        actor,
        &entries,
        Some(MoveSlotIndex::new(3)?),
        false,
    )?;
    assert_eq!(
        remembered_present.selected_option_id.as_str(),
        "move/7/slot/3"
    );
    Ok(())
}

#[test]
fn move_activation_distinguishes_implicit_single_and_multiple_routes() -> TestResult {
    let actor = pokemon(7)?;
    let mut entries = move_entries()?;
    let menu = build_move_menu(
        menu_instance(8)?,
        seat(1)?,
        command_control_id("move"),
        actor,
        &entries,
        None,
        true,
    )?;
    assert_eq!(
        select_move(&menu, actor, &entries)?,
        MoveActivation::Immediate {
            move_slot: MoveSlotIndex::ZERO,
            targets: BattleTargetSelection::Implicit,
        }
    );

    entries[0] = MoveMenuEntry::enabled(
        move_id(1)?,
        vec![
            target_selection(vec![enemy(0)])?,
            target_selection(vec![enemy(1)])?,
        ],
    )?;
    let choices = build_move_menu(
        menu_instance(9)?,
        seat(1)?,
        command_control_id("move"),
        actor,
        &entries,
        None,
        true,
    )?;
    assert_eq!(
        select_move(&choices, actor, &entries)?,
        MoveActivation::TargetSelect {
            move_slot: MoveSlotIndex::ZERO,
            multiple: false,
            candidate_targets: vec![enemy(0), enemy(1)],
        }
    );

    entries[0] = MoveMenuEntry::enabled(
        move_id(1)?,
        vec![target_selection(vec![enemy(0), enemy(1)])?],
    )?;
    let spread = build_move_menu(
        menu_instance(10)?,
        seat(1)?,
        command_control_id("move"),
        actor,
        &entries,
        None,
        true,
    )?;
    assert_eq!(
        select_move(&spread, actor, &entries)?,
        MoveActivation::TargetSelect {
            move_slot: MoveSlotIndex::ZERO,
            multiple: true,
            candidate_targets: vec![enemy(0), enemy(1)],
        }
    );

    let disabled = build_move_menu(
        menu_instance(11)?,
        seat(1)?,
        command_control_id("move"),
        actor,
        &move_entries()?,
        Some(MoveSlotIndex::new(3)?),
        false,
    )?;
    assert_eq!(
        select_move(&disabled, actor, &move_entries()?),
        Err(MoveSelectionError::DisabledMove)
    );

    let no_legal_entries = [
        MoveMenuEntry::empty(),
        MoveMenuEntry::disabled(move_id(52)?),
        MoveMenuEntry::empty(),
        MoveMenuEntry::disabled(move_id(77)?),
    ];
    let no_legal_menu = build_move_menu(
        menu_instance(21)?,
        seat(1)?,
        command_control_id("move"),
        actor,
        &no_legal_entries,
        None,
        true,
    )?;
    assert_eq!(
        select_move(&no_legal_menu, actor, &no_legal_entries),
        Err(MoveSelectionError::NoLegalOption)
    );
    Ok(())
}

#[test]
fn target_binary_graph_covers_cross_side_and_horizontal_edges() -> TestResult {
    let candidates = vec![player(0), player(1), enemy(0), enemy(1)];
    let menu = build_target_menu(
        menu_instance(12)?,
        seat(1)?,
        command_control_id("target"),
        pokemon(7)?,
        &candidates,
        false,
        Some(player(1)),
        Some(enemy(0)),
    )?;
    assert_eq!(menu.selected_option_id.as_str(), "target/player/1");

    let mut expected = vec![
        edge("target/player/0", NavigationDirection::Up, "target/enemy/0")?,
        edge(
            "target/player/0",
            NavigationDirection::Right,
            "target/player/1",
        )?,
        edge("target/player/1", NavigationDirection::Up, "target/enemy/0")?,
        edge(
            "target/player/1",
            NavigationDirection::Left,
            "target/player/0",
        )?,
        edge(
            "target/enemy/0",
            NavigationDirection::Down,
            "target/player/0",
        )?,
        edge(
            "target/enemy/0",
            NavigationDirection::Right,
            "target/enemy/1",
        )?,
        edge(
            "target/enemy/1",
            NavigationDirection::Down,
            "target/player/0",
        )?,
        edge(
            "target/enemy/1",
            NavigationDirection::Left,
            "target/enemy/0",
        )?,
    ];
    expected.sort_unstable();
    assert_eq!(menu.navigation, expected);

    let remembered = build_target_menu(
        menu_instance(13)?,
        seat(1)?,
        command_control_id("target"),
        pokemon(7)?,
        &candidates,
        false,
        Some(player(2)),
        Some(enemy(1)),
    )?;
    assert_eq!(remembered.selected_option_id.as_str(), "target/enemy/1");

    let missing = build_target_menu(
        menu_instance(14)?,
        seat(1)?,
        command_control_id("target"),
        pokemon(7)?,
        &[enemy(1)],
        false,
        None,
        None,
    )?;
    assert!(missing.navigation.is_empty());
    Ok(())
}

#[test]
fn target_multiple_has_no_directional_edges_and_submits_all_candidates() -> TestResult {
    let candidates = vec![enemy(1), player(0), enemy(0)];
    let menu = build_target_menu(
        menu_instance(15)?,
        seat(1)?,
        command_control_id("target"),
        pokemon(7)?,
        &candidates,
        true,
        Some(enemy(1)),
        None,
    )?;
    assert!(menu.navigation.is_empty());
    assert_eq!(
        select_target(&menu, pokemon(7)?, &candidates, true)?,
        target_selection(vec![player(0), enemy(0), enemy(1)])?
    );

    let stale = build_target_menu(
        menu_instance(16)?,
        seat(1)?,
        command_control_id("target"),
        pokemon(7)?,
        &[enemy(0)],
        false,
        None,
        None,
    )?;
    let mut stale = stale;
    stale.selected_option_id = MenuOptionId::new("target/enemy/1")?;
    assert_eq!(
        select_target(&stale, pokemon(7)?, &[enemy(0)], false),
        Err(TargetMenuError::StaleSelection)
    );
    Ok(())
}

#[test]
fn cancel_history_restores_exact_root_then_move_selection() -> TestResult {
    let actor = pokemon(7)?;
    let field_slot = player(0);
    let offer = command_offer()?;
    let root = build_command_root_control(
        menu_instance(17)?,
        seat(1)?,
        command_control_id("command"),
        actor,
        field_slot,
        &offer,
        CommandRootSelection::Fight,
    )?;
    let move_control = build_move_control(
        menu_instance(18)?,
        seat(1)?,
        command_control_id("move"),
        actor,
        field_slot,
        &move_entries()?,
        None,
        true,
        BattleControl::CommandRoot(root.clone()),
    )?;
    assert_eq!(
        move_control.cancel_to.as_ref(),
        &BattleControl::CommandRoot(root)
    );
    assert_eq!(
        move_control.menu.selected_option_id.as_str(),
        "move/7/slot/0"
    );

    let target_control = build_target_control(
        menu_instance(19)?,
        seat(1)?,
        command_control_id("target"),
        actor,
        field_slot,
        MoveSlotIndex::ZERO,
        false,
        &[enemy(0), enemy(1)],
        None,
        Some(enemy(1)),
        BattleControl::MoveSelect(move_control.clone()),
    )?;
    assert_eq!(
        target_control.cancel_to.as_ref(),
        &BattleControl::MoveSelect(move_control)
    );
    assert_eq!(
        target_control.menu.selected_option_id.as_str(),
        "target/enemy/1"
    );
    assert_ne!(target_control.menu.instance_id, menu_instance(18)?);

    let no_targets = build_target_menu(
        menu_instance(20)?,
        seat(1)?,
        command_control_id("target"),
        actor,
        &[],
        false,
        None,
        None,
    );
    assert_eq!(no_targets, Err(TargetMenuError::NoLegalTargets));
    Ok(())
}

#[test]
fn stable_move_ids_are_actor_and_slot_derived() -> TestResult {
    assert_eq!(
        move_option_id(pokemon(7)?, MoveSlotIndex::new(3)?)?.as_str(),
        "move/7/slot/3"
    );
    Ok(())
}
