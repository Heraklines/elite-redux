use std::error::Error;

use er_game::party_menu::{
    PARTY_CANCEL_OPTION_ID, PartyMenuError, build_party_select, navigate_party_menu,
    party_cancel_option_id, party_option_id,
};
use er_game::party_option_menu::{
    PARTY_OPTION_CANCEL_ID, PARTY_OPTION_SEND_OUT_ID, PartyOptionMenuError,
    open_party_option_menu, open_replacement_option_menu, restore_parent_menu,
};
use er_game::replacement_menu::{
    ReplacementMenuResult, build_replacement_menu, navigate_replacement_menu,
};
use er_state::battle::BattleState;
use er_types::SafeU53;
use er_types::battle_control::{
    BattleControl, CommandRootControl,
};
use er_types::battle_ids::{
    AuthorityEpoch, BattleSide, FaintOccurrenceId, FieldSlot, MenuInstanceId, PartyIndex,
    PokemonId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{FaintOccurrence, FaintSource, ReplacementProgress};
use er_types::battle_ui::{
    BattleMenu, BattleMenuOption, MenuNavigationEdge, MenuOptionLayout, MenuOptionVisibility,
    NavigationDirection,
};
use er_types::ids::{MenuOptionId, SeatId};

fn invalid_data(message: &'static str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message)
}

fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
    Ok(SafeU53::new(value)?)
}

fn pokemon(value: u64) -> Result<PokemonId, Box<dyn Error>> {
    Ok(PokemonId::new(safe(value)?))
}

fn seat(value: u64) -> Result<SeatId, Box<dyn Error>> {
    Ok(SeatId::new(safe(value)?))
}

fn instance(value: u64) -> Result<MenuInstanceId, Box<dyn Error>> {
    Ok(MenuInstanceId::new(safe(value)?))
}

fn player_slot(position: u8) -> FieldSlot {
    FieldSlot {
        side: BattleSide::Player,
        position,
    }
}

fn fixture_battle(name: &str) -> Result<BattleState, Box<dyn Error>> {
    let raw = match name {
        "voluntary-switch" => {
            include_str!("../../../fixtures/m3/oracle/battle-cases/voluntary-switch.json")
        }
        "forced-replacement" => {
            include_str!("../../../fixtures/m3/oracle/battle-cases/forced-replacement.json")
        }
        "no-legal-replacement" => {
            include_str!("../../../fixtures/m3/oracle/battle-cases/no-legal-replacement.json")
        }
        _ => return Err(invalid_data("unknown M3 battle fixture").into()),
    };
    let wire: serde_json::Value = serde_json::from_str(raw)?;
    let battle = wire
        .get("initial_state")
        .and_then(|state| state.get("canonical"))
        .and_then(|canonical| canonical.get("battle"))
        .cloned()
        .ok_or_else(|| invalid_data("fixture has no initial canonical battle"))?;
    Ok(serde_json::from_value(battle)?)
}

fn command_root(
    battle: &BattleState,
    actor: PokemonId,
    field_slot: FieldSlot,
    menu_instance_id: MenuInstanceId,
) -> Result<BattleControl, Box<dyn Error>> {
    let fight = MenuOptionId::new("command/fight")?;
    let switch = MenuOptionId::new("command/switch")?;
    let options = vec![
        BattleMenuOption::new(
            fight.clone(),
            "label.command/fight",
            MenuOptionVisibility::Visible,
            true,
            MenuOptionLayout::new(fight.clone(), 0, 0, 0),
        )?,
        BattleMenuOption::new(
            switch.clone(),
            "label.command/switch",
            MenuOptionVisibility::Visible,
            true,
            MenuOptionLayout::new(switch.clone(), 1, 0, 0),
        )?,
    ];
    let navigation = vec![
        MenuNavigationEdge::new(
            fight.clone(),
            NavigationDirection::Down,
            switch.clone(),
        ),
        MenuNavigationEdge::new(switch, NavigationDirection::Up, fight),
    ];
    let owner_seat = seat(u64::from(field_slot.position) + 1)?;
    let control_id = format!(
        "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/command",
        battle.battle_id,
        battle.wave,
        battle.turn,
        field_slot.position,
        owner_seat,
    );
    let menu = BattleMenu::new(
        menu_instance_id,
        owner_seat,
        control_id,
        MenuOptionId::new("command/switch")?,
        options,
        navigation,
    )?;
    Ok(BattleControl::CommandRoot(CommandRootControl::new(
        actor,
        field_slot,
        menu,
    )?))
}

fn edge_target(
    menu: &BattleMenu,
    from: &MenuOptionId,
    direction: NavigationDirection,
) -> Option<MenuOptionId> {
    menu.navigation
        .iter()
        .find(|edge| edge.from == *from && edge.direction == direction)
        .map(|edge| edge.to.clone())
}

fn assert_edge(
    menu: &BattleMenu,
    from: &MenuOptionId,
    direction: NavigationDirection,
    to: &MenuOptionId,
) {
    assert_eq!(edge_target(menu, from, direction), Some(to.clone()));
}

fn assert_no_edge(menu: &BattleMenu, from: &MenuOptionId, direction: NavigationDirection) {
    assert_eq!(edge_target(menu, from, direction), None);
}

fn pending_replacement(mut battle: BattleState) -> Result<BattleState, Box<dyn Error>> {
    let fainted = battle
        .player_party
        .get_mut(0)
        .ok_or_else(|| invalid_data("forced fixture has no fainted actor"))?;
    fainted.hp = 0;
    fainted.fainted = true;
    let occurrence = FaintOccurrenceId::new(safe(9)?);
    battle.faint_queue = vec![FaintOccurrence {
        id: occurrence,
        source: FaintSource {
            epoch: AuthorityEpoch::new(safe(1)?),
            wave: WaveIndex::new(safe(1)?)?,
            resolved_turn: TurnIndex::new(safe(1)?)?,
            turn_occurrence: 2,
        },
        slot: player_slot(0),
        pokemon: fainted.id,
        owner_seat: Some(seat(1)?),
        replacement: ReplacementProgress::Pending,
    }];
    battle.next_faint_occurrence = FaintOccurrenceId::new(safe(10)?);
    Ok(battle)
}

fn no_legal_replacement(mut battle: BattleState) -> Result<BattleState, Box<dyn Error>> {
    for pokemon in &mut battle.player_party {
        pokemon.hp = 0;
        pokemon.fainted = true;
    }
    let actor = battle
        .player_party
        .get(1)
        .ok_or_else(|| invalid_data("no-legal fixture has no partner actor"))?
        .id;
    battle.faint_queue = vec![FaintOccurrence {
        id: FaintOccurrenceId::new(safe(11)?),
        source: FaintSource {
            epoch: AuthorityEpoch::new(safe(1)?),
            wave: WaveIndex::new(safe(1)?)?,
            resolved_turn: TurnIndex::new(safe(1)?)?,
            turn_occurrence: 2,
        },
        slot: player_slot(1),
        pokemon: actor,
        owner_seat: Some(seat(2)?),
        replacement: ReplacementProgress::Pending,
    }];
    battle.next_faint_occurrence = FaintOccurrenceId::new(safe(12)?);
    Ok(battle)
}

#[test]
fn voluntary_party_graph_contains_all_edges_and_noops() -> Result<(), Box<dyn Error>> {
    let battle = fixture_battle("voluntary-switch")?;
    let actor = pokemon(1)?;
    let field_slot = player_slot(0);
    let root = command_root(&battle, actor, field_slot, instance(1)?)?;
    let control = build_party_select(
        &battle,
        actor,
        field_slot,
        seat(1)?,
        instance(2)?,
        root,
    )?;
    let slot_zero = party_option_id(pokemon(1)?, PartyIndex::new(0)?)?;
    let slot_one = party_option_id(pokemon(2)?, PartyIndex::new(1)?)?;
    let slot_two = party_option_id(pokemon(3)?, PartyIndex::new(2)?)?;
    let cancel = party_cancel_option_id()?;

    assert_eq!(control.menu.options.len(), 4);
    assert!(!control.menu.option(slot_zero.clone()).ok_or_else(|| invalid_data("slot zero missing"))?.enabled);
    assert!(!control.menu.option(slot_one.clone()).ok_or_else(|| invalid_data("slot one missing"))?.enabled);
    assert!(control.menu.option(slot_two.clone()).ok_or_else(|| invalid_data("slot two missing"))?.enabled);
    assert!(control.menu.option(cancel.clone()).ok_or_else(|| invalid_data("cancel missing"))?.enabled);

    assert_edge(&control.menu, &slot_zero, NavigationDirection::Up, &cancel);
    assert_edge(&control.menu, &slot_zero, NavigationDirection::Down, &slot_one);
    assert_edge(&control.menu, &slot_one, NavigationDirection::Up, &slot_zero);
    assert_edge(&control.menu, &slot_one, NavigationDirection::Down, &slot_two);
    assert_edge(&control.menu, &slot_two, NavigationDirection::Up, &slot_one);
    assert_edge(&control.menu, &slot_two, NavigationDirection::Down, &cancel);
    assert_edge(&control.menu, &cancel, NavigationDirection::Up, &slot_two);
    assert_edge(&control.menu, &cancel, NavigationDirection::Down, &slot_zero);
    assert_edge(&control.menu, &slot_zero, NavigationDirection::Right, &slot_two);
    assert_edge(&control.menu, &slot_one, NavigationDirection::Right, &slot_two);
    assert_edge(&control.menu, &slot_two, NavigationDirection::Left, &slot_zero);
    assert_edge(&control.menu, &cancel, NavigationDirection::Left, &slot_zero);

    for option in [&slot_zero, &slot_one, &slot_two, &cancel] {
        for direction in [NavigationDirection::Up, NavigationDirection::Down] {
            assert!(edge_target(&control.menu, option, direction).is_some());
        }
    }
    for option in [&slot_zero, &slot_one] {
        assert_no_edge(&control.menu, option, NavigationDirection::Left);
    }
    assert_no_edge(&control.menu, &slot_two, NavigationDirection::Right);
    assert_no_edge(&control.menu, &cancel, NavigationDirection::Right);
    assert_no_edge(&control.menu, &slot_zero, NavigationDirection::Left);
    assert_no_edge(&control.menu, &slot_one, NavigationDirection::Left);

    Ok(())
}

#[test]
fn party_navigation_updates_column_memory_without_changing_instance() -> Result<(), Box<dyn Error>> {
    let battle = fixture_battle("voluntary-switch")?;
    let root = command_root(&battle, pokemon(1)?, player_slot(0), instance(1)?)?;
    let control = build_party_select(
        &battle,
        pokemon(1)?,
        player_slot(0),
        seat(1)?,
        instance(2)?,
        root,
    )?;
    let control = navigate_party_menu(
        &battle,
        &control,
        instance(2)?,
        NavigationDirection::Down,
    )?;
    let control = navigate_party_menu(
        &battle,
        &control,
        instance(2)?,
        NavigationDirection::Down,
    )?;
    let slot_zero = party_option_id(pokemon(1)?, PartyIndex::new(0)?)?;
    let slot_two = party_option_id(pokemon(3)?, PartyIndex::new(2)?)?;
    assert_eq!(control.menu.instance_id, instance(2)?);
    assert_eq!(control.menu.selected_option_id, slot_two);
    assert_eq!(control.last_right_option_id, slot_two);
    let control = navigate_party_menu(
        &battle,
        &control,
        instance(2)?,
        NavigationDirection::Left,
    )?;
    assert_eq!(control.menu.selected_option_id, slot_zero);
    assert_eq!(control.last_left_option_id, slot_zero);
    Ok(())
}

#[test]
fn party_option_open_cancel_and_disabled_selection_are_fail_closed() -> Result<(), Box<dyn Error>> {
    let battle = fixture_battle("voluntary-switch")?;
    let root = command_root(&battle, pokemon(1)?, player_slot(0), instance(1)?)?;
    let party = build_party_select(
        &battle,
        pokemon(1)?,
        player_slot(0),
        seat(1)?,
        instance(2)?,
        root.clone(),
    )?;
    let disabled = open_party_option_menu(&battle, &party, instance(2)?, instance(3)?);
    assert_eq!(disabled, Err(PartyOptionMenuError::DisabledSelection));

    let party = navigate_party_menu(
        &battle,
        &party,
        instance(2)?,
        NavigationDirection::Down,
    )?;
    let party = navigate_party_menu(
        &battle,
        &party,
        instance(2)?,
        NavigationDirection::Down,
    )?;
    let option = open_party_option_menu(&battle, &party, instance(2)?, instance(3)?)?;
    assert_eq!(option.menu.selected_option_id.as_str(), PARTY_OPTION_SEND_OUT_ID);
    assert_eq!(option.menu.options.len(), 2);
    assert!(option.menu.option(MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID)?).is_some());
    assert!(option.menu.option(MenuOptionId::new(PARTY_OPTION_CANCEL_ID)?).is_some());
    let send_out = MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID)?;
    let option_cancel = MenuOptionId::new(PARTY_OPTION_CANCEL_ID)?;
    assert_edge(&option.menu, &send_out, NavigationDirection::Up, &option_cancel);
    assert_edge(&option.menu, &send_out, NavigationDirection::Down, &option_cancel);
    assert_edge(&option.menu, &option_cancel, NavigationDirection::Up, &send_out);
    assert_edge(&option.menu, &option_cancel, NavigationDirection::Down, &send_out);
    assert_no_edge(&option.menu, &send_out, NavigationDirection::Left);
    assert_no_edge(&option.menu, &send_out, NavigationDirection::Right);

    let restored = restore_parent_menu(&battle, &option, instance(3)?, instance(4)?)?;
    let BattleControl::PartySelect(restored) = restored else {
        return Err(invalid_data("party-option Cancel did not restore PartySelect").into());
    };
    assert_eq!(restored.menu.instance_id, instance(4)?);
    assert_eq!(restored.menu.selected_option_id, party.menu.selected_option_id);
    assert_eq!(restored.last_right_option_id, party.last_right_option_id);

    let stale = open_party_option_menu(&battle, &party, instance(3)?, instance(5)?);
    assert_eq!(stale, Err(PartyOptionMenuError::Party(PartyMenuError::StaleMenuInstance)));
    Ok(())
}

#[test]
fn stale_party_selection_cannot_open_a_submenu() -> Result<(), Box<dyn Error>> {
    let battle = fixture_battle("voluntary-switch")?;
    let root = command_root(&battle, pokemon(1)?, player_slot(0), instance(1)?)?;
    let mut stale = build_party_select(
        &battle,
        pokemon(1)?,
        player_slot(0),
        seat(1)?,
        instance(2)?,
        root,
    )?;
    stale.menu.selected_option_id = party_option_id(pokemon(2)?, PartyIndex::new(1)?)?;
    let result = open_party_option_menu(&battle, &stale, instance(2)?, instance(3)?);
    assert!(matches!(
        result,
        Err(PartyOptionMenuError::Party(
            PartyMenuError::StaleNavigation | PartyMenuError::StaleMenuState
        ))
    ));
    Ok(())
}

#[test]
fn replacement_graph_uses_stored_source_and_exact_legality() -> Result<(), Box<dyn Error>> {
    let battle = pending_replacement(fixture_battle("forced-replacement")?)?;
    let result = build_replacement_menu(&battle, FaintOccurrenceId::new(safe(9)?), instance(2)?)?;
    let ReplacementMenuResult::Menu(control) = result else {
        return Err(invalid_data("legal replacement unexpectedly returned no-legal").into());
    };
    assert_eq!(control.occurrence, FaintOccurrenceId::new(safe(9)?));
    assert_eq!(control.source.turn_occurrence, 2);
    assert_eq!(control.actor, pokemon(1)?);
    assert_eq!(control.owner_seat, seat(1)?);
    assert_eq!(
        control.menu.control_id,
        "RC/e1/b1/w1/t1/o2/f0/s1/control/replacement"
    );
    assert!(!control.menu.option(MenuOptionId::new(PARTY_CANCEL_OPTION_ID)?).ok_or_else(|| invalid_data("replacement cancel missing"))?.enabled);

    let slot_zero = party_option_id(pokemon(1)?, PartyIndex::new(0)?)?;
    let slot_one = party_option_id(pokemon(2)?, PartyIndex::new(1)?)?;
    let slot_two = party_option_id(pokemon(3)?, PartyIndex::new(2)?)?;
    let cancel = party_cancel_option_id()?;
    assert_edge(&control.menu, &slot_zero, NavigationDirection::Down, &slot_one);
    assert_edge(&control.menu, &slot_one, NavigationDirection::Down, &slot_two);
    assert_edge(&control.menu, &slot_two, NavigationDirection::Down, &cancel);
    assert_edge(&control.menu, &cancel, NavigationDirection::Up, &slot_two);
    assert_edge(&control.menu, &slot_zero, NavigationDirection::Right, &slot_two);
    assert_edge(&control.menu, &slot_two, NavigationDirection::Left, &slot_zero);
    for option in [&slot_zero, &slot_one, &cancel] {
        assert!(control.menu.option(option.clone()).ok_or_else(|| invalid_data("replacement option missing"))?.enabled == false);
    }
    assert!(control.menu.option(slot_two.clone()).ok_or_else(|| invalid_data("legal replacement missing"))?.enabled);

    let control = navigate_replacement_menu(
        &battle,
        &control,
        instance(2)?,
        NavigationDirection::Down,
    )?;
    let control = navigate_replacement_menu(
        &battle,
        &control,
        instance(2)?,
        NavigationDirection::Down,
    )?;
    let option = open_replacement_option_menu(&battle, &control, instance(2)?, instance(3)?)?;
    assert_eq!(option.selected_party_slot, PartyIndex::new(2)?);
    let BattleControl::ReplacementSelect(parent) = option.cancel_to.as_ref() else {
        return Err(invalid_data("replacement option lost its parent").into());
    };
    assert_eq!(parent.source, control.source);
    assert_eq!(parent.actor, control.actor);
    let restored = restore_parent_menu(&battle, &option, instance(3)?, instance(4)?)?;
    let BattleControl::ReplacementSelect(restored) = restored else {
        return Err(invalid_data("replacement option Cancel did not restore parent").into());
    };
    assert_eq!(restored.menu.instance_id, instance(4)?);
    assert_eq!(restored.menu.selected_option_id, slot_two);
    Ok(())
}

#[test]
fn replacement_stale_occurrence_and_source_fail_closed() -> Result<(), Box<dyn Error>> {
    let battle = pending_replacement(fixture_battle("forced-replacement")?)?;
    let result = build_replacement_menu(&battle, FaintOccurrenceId::new(safe(9)?), instance(2)?)?;
    let ReplacementMenuResult::Menu(control) = result else {
        return Err(invalid_data("legal replacement unexpectedly returned no-legal").into());
    };
    let mut wrong_occurrence = control.clone();
    wrong_occurrence.occurrence = FaintOccurrenceId::new(safe(10)?);
    assert!(navigate_replacement_menu(
        &battle,
        &wrong_occurrence,
        instance(2)?,
        NavigationDirection::Down,
    )
    .is_err());

    let mut wrong_source = control;
    wrong_source.source.turn_occurrence = 3;
    assert!(navigate_replacement_menu(
        &battle,
        &wrong_source,
        instance(2)?,
        NavigationDirection::Down,
    )
    .is_err());
    Ok(())
}

#[test]
fn no_legal_replacement_is_an_internal_result_without_a_menu() -> Result<(), Box<dyn Error>> {
    let battle = no_legal_replacement(fixture_battle("no-legal-replacement")?)?;
    let result = build_replacement_menu(
        &battle,
        FaintOccurrenceId::new(safe(11)?),
        instance(2)?,
    )?;
    let ReplacementMenuResult::NoLegalReplacement {
        occurrence,
        source,
        actor,
        field_slot,
        owner_seat,
    } = result
    else {
        return Err(invalid_data("no-legal fixture installed a replacement menu").into());
    };
    assert_eq!(occurrence, FaintOccurrenceId::new(safe(11)?));
    assert_eq!(source.turn_occurrence, 2);
    assert_eq!(actor, pokemon(2)?);
    assert_eq!(field_slot, player_slot(1));
    assert_eq!(owner_seat, seat(2)?);
    Ok(())
}
