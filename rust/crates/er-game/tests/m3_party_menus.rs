use std::error::Error;

use er_content::pack::{ContentPack, selected_content_pack};
use er_game::party_menu::{
    PARTY_CANCEL_OPTION_ID, PartyMenuError, build_party_select, navigate_party_menu,
    party_cancel_option_id, party_option_id,
};
use er_game::party_option_menu::{
    PARTY_OPTION_CANCEL_ID, PARTY_OPTION_SEND_OUT_ID, PartyOptionMenuError, open_party_option_menu,
    open_replacement_option_menu, restore_parent_menu,
};
use er_game::replacement_menu::{
    ReplacementMenuResult, build_replacement_menu, navigate_replacement_menu,
};
use er_state::battle::BattleState;
use er_state::snapshot::GameState;
use er_types::SafeU53;
use er_types::battle_control::{BattleControl, CommandRootControl};
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

fn is_status_kind_tag(tag: &str) -> bool {
    matches!(
        tag,
        "NONE" | "POISON" | "TOXIC" | "PARALYSIS" | "SLEEP" | "BURN"
    )
}

const LEGACY_ORACLE_CONTENT_DIGEST: &str =
    "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
const LEGACY_ORACLE_CONTENT_HASH: &str =
    "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

fn required_object<'a>(
    value: &'a serde_json::Value,
    field: &'static str,
    error: &'static str,
) -> Result<&'a serde_json::Value, Box<dyn Error>> {
    value
        .get(field)
        .filter(|field| field.is_object())
        .ok_or_else(|| invalid_data(error).into())
}

fn required_string<'a>(
    value: &'a serde_json::Value,
    field: &'static str,
    error: &'static str,
) -> Result<&'a str, Box<dyn Error>> {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| invalid_data(error).into())
}

fn normalize_selected_content_identity(
    document: &serde_json::Value,
    canonical: &mut serde_json::Value,
    content: &ContentPack,
) -> Result<(), Box<dyn Error>> {
    let fixture_hash = required_string(
        canonical,
        "content_hash",
        "initial canonical content_hash is missing or not a string",
    )?
    .to_owned();
    for state_name in ["initial_state", "expected_final_state"] {
        let state = required_object(
            document,
            state_name,
            "published state is missing or not an object",
        )?;
        let peer_canonical = required_object(
            state,
            "canonical",
            "published canonical state is missing or not an object",
        )?;
        let peer_hash = required_string(
            peer_canonical,
            "content_hash",
            "published canonical content_hash is missing or not a string",
        )?;
        if peer_hash != fixture_hash.as_str() {
            return Err(invalid_data("published state content hashes disagree").into());
        }
    }

    let provenance = required_object(
        document,
        "provenance",
        "published provenance is missing or not an object",
    )?;
    let provenance_hash = required_string(
        provenance,
        "content_pack_hash",
        "published provenance content_pack_hash is missing or not a string",
    )?;
    let provenance_oracle_sha = required_string(
        provenance,
        "oracle_game_sha",
        "published provenance oracle_game_sha is missing or not a string",
    )?;
    if provenance_oracle_sha != content.oracle_game_sha {
        return Err(invalid_data("published provenance oracle_game_sha disagrees").into());
    }

    let selected_hash = content.hash.as_str();
    let selected_digest = selected_hash
        .strip_prefix("blake3-v1:")
        .ok_or_else(|| invalid_data("selected content hash has no blake3-v1 prefix"))?;
    if fixture_hash.as_str() == selected_hash {
        if provenance_hash != selected_digest {
            return Err(
                invalid_data("selected content hash disagrees with provenance digest").into(),
            );
        }
        return Ok(());
    }
    if fixture_hash.as_str() != LEGACY_ORACLE_CONTENT_HASH
        || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
    {
        return Err(invalid_data("published content identity is not an allowed pair").into());
    }

    canonical
        .as_object_mut()
        .ok_or_else(|| invalid_data("initial canonical state is not an object"))?
        .insert(
            "content_hash".to_owned(),
            serde_json::Value::String(selected_hash.to_owned()),
        );
    Ok(())
}

fn adapt_legacy_battle(mut battle: serde_json::Value) -> Result<serde_json::Value, Box<dyn Error>> {
    let battle_object = battle
        .as_object_mut()
        .ok_or_else(|| invalid_data("initial canonical battle is not an object"))?;

    let format_slots = battle_object
        .get("format")
        .and_then(serde_json::Value::as_object)
        .and_then(|format| format.get("slots"))
        .ok_or_else(|| invalid_data("legacy format.slots is missing"))?;
    let field_slots = battle_object
        .get("field")
        .and_then(serde_json::Value::as_object)
        .and_then(|field| field.get("slots"))
        .ok_or_else(|| invalid_data("legacy field.slots is missing"))?;
    if !format_slots.is_array() || !field_slots.is_array() {
        return Err(invalid_data("legacy format.slots and field.slots must be arrays").into());
    }
    if format_slots != field_slots {
        return Err(invalid_data("legacy format.slots differs from field.slots").into());
    }
    battle_object
        .get_mut("format")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or_else(|| invalid_data("legacy format is not an object"))?
        .remove("slots");

    for party_name in ["player_party", "enemy_party"] {
        let party = battle_object
            .get_mut(party_name)
            .and_then(serde_json::Value::as_array_mut)
            .ok_or_else(|| invalid_data("legacy party is not an array"))?;
        for pokemon in party {
            let status = pokemon
                .get_mut("status")
                .and_then(serde_json::Value::as_object_mut)
                .ok_or_else(|| invalid_data("legacy party status is not an object"))?;
            let kind = status
                .get("kind")
                .cloned()
                .ok_or_else(|| invalid_data("legacy party status.kind is missing"))?;
            let normalized = match kind {
                serde_json::Value::String(tag) if is_status_kind_tag(&tag) => {
                    serde_json::Value::String(tag)
                }
                serde_json::Value::String(_) => {
                    return Err(
                        invalid_data("legacy party status.kind has an unsupported value").into(),
                    );
                }
                serde_json::Value::Object(nested) => {
                    if nested.len() != 1 || !nested.contains_key("kind") {
                        return Err(invalid_data(
                            "legacy party status.kind has an unsupported nested wrapper shape",
                        )
                        .into());
                    }
                    let Some(tag) = nested.get("kind").and_then(serde_json::Value::as_str) else {
                        return Err(
                            invalid_data("legacy party status.kind.kind is not a string").into(),
                        );
                    };
                    if !is_status_kind_tag(tag) {
                        return Err(invalid_data(
                            "legacy party status.kind.kind has an unsupported value",
                        )
                        .into());
                    }
                    serde_json::Value::String(tag.to_owned())
                }
                _ => {
                    return Err(
                        invalid_data("legacy party status.kind has an invalid shape").into(),
                    );
                }
            };
            status.insert("kind".to_owned(), normalized);
        }
    }

    for condition_name in ["weather", "terrain"] {
        let condition = battle_object
            .get_mut(condition_name)
            .and_then(serde_json::Value::as_object_mut)
            .ok_or_else(|| invalid_data("legacy weather/terrain is not an object"))?;
        let kind = condition
            .get("kind")
            .cloned()
            .ok_or_else(|| invalid_data("legacy weather/terrain kind is missing"))?;
        let normalized = match kind {
            serde_json::Value::String(tag) => {
                let mut adjacent = serde_json::Map::new();
                adjacent.insert("kind".to_owned(), serde_json::Value::String(tag));
                serde_json::Value::Object(adjacent)
            }
            serde_json::Value::Object(_) => kind,
            _ => {
                return Err(
                    invalid_data("legacy weather/terrain kind has an invalid shape").into(),
                );
            }
        };
        validate_condition_kind(&normalized)?;
        condition.insert("kind".to_owned(), normalized);
    }

    Ok(battle)
}

fn adapt_legacy_state(
    mut canonical: serde_json::Value,
    document: &serde_json::Value,
    content: &ContentPack,
) -> Result<serde_json::Value, Box<dyn Error>> {
    normalize_selected_content_identity(document, &mut canonical, content)?;
    let battle = canonical
        .get("battle")
        .cloned()
        .ok_or_else(|| invalid_data("initial canonical state has no battle"))?;
    let battle = adapt_legacy_battle(battle)?;
    canonical
        .as_object_mut()
        .ok_or_else(|| invalid_data("initial canonical state is not an object"))?
        .insert("battle".to_owned(), battle);
    Ok(canonical)
}

fn validate_condition_kind(value: &serde_json::Value) -> Result<(), Box<dyn Error>> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid_data("weather/terrain kind is not an object"))?;
    let kind = object
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| invalid_data("weather/terrain kind tag is not a string"))?;
    match kind {
        "NONE" if object.len() == 1 => Ok(()),
        "UNSUPPORTED_ORACLE_CODE"
            if object.len() == 2
                && object
                    .get("value")
                    .and_then(serde_json::Value::as_u64)
                    .is_some_and(|value| u16::try_from(value).is_ok()) =>
        {
            Ok(())
        }
        _ => Err(invalid_data("weather/terrain kind has an invalid enum shape").into()),
    }
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
    let canonical = wire
        .get("initial_state")
        .and_then(|state| state.get("canonical"))
        .cloned()
        .ok_or_else(|| invalid_data("fixture has no initial canonical state"))?;
    let content = selected_content_pack()?;
    let canonical = adapt_legacy_state(canonical, &wire, &content)?;
    let state: GameState = serde_json::from_value(canonical)?;
    state
        .battle
        .ok_or_else(|| invalid_data("initial canonical state has no typed battle").into())
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
        MenuNavigationEdge::new(fight.clone(), NavigationDirection::Down, switch.clone()),
        MenuNavigationEdge::new(switch, NavigationDirection::Up, fight),
    ];
    let owner_seat = seat(u64::from(field_slot.position) + 1)?;
    let control_id = format!(
        "battle/{}/wave/{}/turn/{}/control/player/{}/seat/{}/command",
        battle.battle_id, battle.wave, battle.turn, field_slot.position, owner_seat,
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
        actor, field_slot, menu,
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
    let control = build_party_select(&battle, actor, field_slot, seat(1)?, instance(2)?, root)?;
    let slot_zero = party_option_id(pokemon(1)?, PartyIndex::new(0)?)?;
    let slot_one = party_option_id(pokemon(2)?, PartyIndex::new(1)?)?;
    let slot_two = party_option_id(pokemon(3)?, PartyIndex::new(2)?)?;
    let cancel = party_cancel_option_id()?;

    assert_eq!(control.menu.options.len(), 4);
    assert!(
        !control
            .menu
            .option(slot_zero.clone())
            .ok_or_else(|| invalid_data("slot zero missing"))?
            .enabled
    );
    assert!(
        !control
            .menu
            .option(slot_one.clone())
            .ok_or_else(|| invalid_data("slot one missing"))?
            .enabled
    );
    assert!(
        control
            .menu
            .option(slot_two.clone())
            .ok_or_else(|| invalid_data("slot two missing"))?
            .enabled
    );
    assert!(
        control
            .menu
            .option(cancel.clone())
            .ok_or_else(|| invalid_data("cancel missing"))?
            .enabled
    );

    assert_edge(&control.menu, &slot_zero, NavigationDirection::Up, &cancel);
    assert_edge(
        &control.menu,
        &slot_zero,
        NavigationDirection::Down,
        &slot_one,
    );
    assert_edge(
        &control.menu,
        &slot_one,
        NavigationDirection::Up,
        &slot_zero,
    );
    assert_edge(
        &control.menu,
        &slot_one,
        NavigationDirection::Down,
        &slot_two,
    );
    assert_edge(&control.menu, &slot_two, NavigationDirection::Up, &slot_one);
    assert_edge(&control.menu, &slot_two, NavigationDirection::Down, &cancel);
    assert_edge(&control.menu, &cancel, NavigationDirection::Up, &slot_two);
    assert_edge(
        &control.menu,
        &cancel,
        NavigationDirection::Down,
        &slot_zero,
    );
    assert_edge(
        &control.menu,
        &slot_zero,
        NavigationDirection::Right,
        &slot_two,
    );
    assert_edge(
        &control.menu,
        &slot_one,
        NavigationDirection::Right,
        &slot_two,
    );
    assert_edge(
        &control.menu,
        &slot_two,
        NavigationDirection::Left,
        &slot_zero,
    );
    assert_edge(
        &control.menu,
        &cancel,
        NavigationDirection::Left,
        &slot_zero,
    );

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
fn party_navigation_updates_column_memory_without_changing_instance() -> Result<(), Box<dyn Error>>
{
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
    let control = navigate_party_menu(&battle, &control, instance(2)?, NavigationDirection::Down)?;
    let control = navigate_party_menu(&battle, &control, instance(2)?, NavigationDirection::Down)?;
    let slot_one = party_option_id(pokemon(2)?, PartyIndex::new(1)?)?;
    let slot_two = party_option_id(pokemon(3)?, PartyIndex::new(2)?)?;
    assert_eq!(control.menu.instance_id, instance(2)?);
    assert_eq!(control.menu.selected_option_id, slot_two);
    assert_eq!(control.last_right_option_id, slot_two);
    let control = navigate_party_menu(&battle, &control, instance(2)?, NavigationDirection::Left)?;
    assert_eq!(control.menu.selected_option_id, slot_one);
    assert_eq!(control.last_left_option_id, slot_one);
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

    let party = navigate_party_menu(&battle, &party, instance(2)?, NavigationDirection::Down)?;
    let party = navigate_party_menu(&battle, &party, instance(2)?, NavigationDirection::Down)?;
    let option = open_party_option_menu(&battle, &party, instance(2)?, instance(3)?)?;
    assert_eq!(
        option.menu.selected_option_id.as_str(),
        PARTY_OPTION_SEND_OUT_ID
    );
    assert_eq!(option.menu.options.len(), 2);
    assert!(
        option
            .menu
            .option(MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID)?)
            .is_some()
    );
    assert!(
        option
            .menu
            .option(MenuOptionId::new(PARTY_OPTION_CANCEL_ID)?)
            .is_some()
    );
    let send_out = MenuOptionId::new(PARTY_OPTION_SEND_OUT_ID)?;
    let option_cancel = MenuOptionId::new(PARTY_OPTION_CANCEL_ID)?;
    assert_edge(
        &option.menu,
        &send_out,
        NavigationDirection::Up,
        &option_cancel,
    );
    assert_edge(
        &option.menu,
        &send_out,
        NavigationDirection::Down,
        &option_cancel,
    );
    assert_edge(
        &option.menu,
        &option_cancel,
        NavigationDirection::Up,
        &send_out,
    );
    assert_edge(
        &option.menu,
        &option_cancel,
        NavigationDirection::Down,
        &send_out,
    );
    assert_no_edge(&option.menu, &send_out, NavigationDirection::Left);
    assert_no_edge(&option.menu, &send_out, NavigationDirection::Right);

    let restored = restore_parent_menu(&battle, &option, instance(3)?, instance(4)?)?;
    let BattleControl::PartySelect(restored) = restored else {
        return Err(invalid_data("party-option Cancel did not restore PartySelect").into());
    };
    assert_eq!(restored.menu.instance_id, instance(4)?);
    assert_eq!(
        restored.menu.selected_option_id,
        party.menu.selected_option_id
    );
    assert_eq!(restored.last_right_option_id, party.last_right_option_id);

    let stale = open_party_option_menu(&battle, &party, instance(3)?, instance(5)?);
    assert_eq!(
        stale,
        Err(PartyOptionMenuError::Party(
            PartyMenuError::StaleMenuInstance
        ))
    );
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
    assert!(
        !control
            .menu
            .option(MenuOptionId::new(PARTY_CANCEL_OPTION_ID)?)
            .ok_or_else(|| invalid_data("replacement cancel missing"))?
            .enabled
    );

    let slot_zero = party_option_id(pokemon(1)?, PartyIndex::new(0)?)?;
    let slot_one = party_option_id(pokemon(2)?, PartyIndex::new(1)?)?;
    let slot_two = party_option_id(pokemon(3)?, PartyIndex::new(2)?)?;
    let cancel = party_cancel_option_id()?;
    assert_edge(
        &control.menu,
        &slot_zero,
        NavigationDirection::Down,
        &slot_one,
    );
    assert_edge(
        &control.menu,
        &slot_one,
        NavigationDirection::Down,
        &slot_two,
    );
    assert_edge(&control.menu, &slot_two, NavigationDirection::Down, &cancel);
    assert_edge(&control.menu, &cancel, NavigationDirection::Up, &slot_two);
    assert_edge(
        &control.menu,
        &slot_zero,
        NavigationDirection::Right,
        &slot_two,
    );
    assert_edge(
        &control.menu,
        &slot_two,
        NavigationDirection::Left,
        &slot_zero,
    );
    for option in [&slot_zero, &slot_one, &cancel] {
        assert!(
            !control
                .menu
                .option(option.clone())
                .ok_or_else(|| invalid_data("replacement option missing"))?
                .enabled
        );
    }
    assert!(
        control
            .menu
            .option(slot_two.clone())
            .ok_or_else(|| invalid_data("legal replacement missing"))?
            .enabled
    );

    let control =
        navigate_replacement_menu(&battle, &control, instance(2)?, NavigationDirection::Down)?;
    let control =
        navigate_replacement_menu(&battle, &control, instance(2)?, NavigationDirection::Down)?;
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
    assert!(
        navigate_replacement_menu(
            &battle,
            &wrong_occurrence,
            instance(2)?,
            NavigationDirection::Down,
        )
        .is_err()
    );

    let mut wrong_source = control;
    wrong_source.source.turn_occurrence = 3;
    assert!(
        navigate_replacement_menu(
            &battle,
            &wrong_source,
            instance(2)?,
            NavigationDirection::Down,
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn no_legal_replacement_is_an_internal_result_without_a_menu() -> Result<(), Box<dyn Error>> {
    let battle = no_legal_replacement(fixture_battle("no-legal-replacement")?)?;
    let result = build_replacement_menu(&battle, FaintOccurrenceId::new(safe(11)?), instance(2)?)?;
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
