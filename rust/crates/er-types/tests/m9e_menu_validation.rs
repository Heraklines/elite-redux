use er_types::battle_ids::MenuInstanceId;
use er_types::m7_action::{GameActionError, GameActionV1, SaveActionV1};
use er_types::m7_menu::{GameMenuCancelV2, GameMenuError, GameMenuOptionV2, GameMenuV2};
use er_types::ui_menu::{LogicalMenuError, MenuNavigationEdge, MenuOptionLayout, NavigationDirection};
use er_types::{MenuOptionId, SafeU53, SeatId};

fn id(value: &str) -> MenuOptionId {
    MenuOptionId::new(value).expect("valid test option identity")
}

fn option(value: &str, enabled: bool, visible: bool) -> GameMenuOptionV2 {
    GameMenuOptionV2 {
        option_id: id(value),
        enabled,
        visible,
        action: GameActionV1::Save {
            action: SaveActionV1::Cancel,
        },
        layout: None,
    }
}

fn menu() -> GameMenuV2 {
    GameMenuV2 {
        instance_id: MenuInstanceId::new(SafeU53::new(1).expect("nonzero test instance")),
        owner_seat: SeatId::new(SafeU53::ZERO),
        control_id: "test/menu".to_owned(),
        selected_option_id: id("a"),
        options: vec![
            option("b", true, true),
            option("hidden", true, false),
            option("a", false, true),
        ],
        navigation: vec![
            MenuNavigationEdge::new(id("b"), NavigationDirection::Up, id("a")),
            MenuNavigationEdge::new(id("a"), NavigationDirection::Down, id("b")),
        ],
        cancel: GameMenuCancelV2::Select { option_id: id("b") },
    }
}

fn invalid_action() -> GameActionV1 {
    GameActionV1::Save {
        action: SaveActionV1::Write {
            slot: String::new(),
        },
    }
}

#[test]
fn visible_graph_allows_disabled_nodes_unsorted_storage_and_hidden_duplicate_ids() {
    let mut value = menu();
    value.options.push(option("a", true, false));
    assert_eq!(value.validate(), Ok(()));
    let logical = value.logical_menu().expect("valid visible graph");
    assert_eq!(logical.options.len(), 2);
    assert_eq!(logical.options[0].option_id, id("a"));
    assert!(!logical.options[0].enabled);
    assert_eq!(logical.options[1].option_id, id("b"));
    assert_eq!(logical.navigation.len(), 2);
    assert_eq!(logical.navigation[0].from, id("a"));
    assert_eq!(logical.navigation[0].to, id("b"));
    assert_eq!(logical.navigation[1].from, id("b"));
    assert_eq!(logical.navigation[1].to, id("a"));
}

#[test]
fn hidden_and_missing_selection_or_edge_endpoints_reject_before_cancel_and_duplicates() {
    for invalid_id in ["hidden", "missing"] {
        for endpoint in 0..3 {
            let mut value = menu();
            value.options.push(option("b", true, true));
            value.cancel = GameMenuCancelV2::Select {
                option_id: id("missing"),
            };
            match endpoint {
                0 => value.selected_option_id = id(invalid_id),
                1 => value.navigation[0].from = id(invalid_id),
                _ => value.navigation[0].to = id(invalid_id),
            }
            assert_eq!(value.validate(), Err(GameMenuError::HiddenNavigation));
        }
    }
}

#[test]
fn option_action_and_layout_errors_precede_visibility_even_for_hidden_options() {
    let mut value = menu();
    value.selected_option_id = id("missing");
    value.options[1].action = invalid_action();
    value.options[1].layout = Some(MenuOptionLayout::new(id("other"), 0, 0, 0));
    assert_eq!(
        value.validate(),
        Err(GameMenuError::Action(GameActionError::EmptySaveSlot))
    );
    value.options[1].action = GameActionV1::Save {
        action: SaveActionV1::Cancel,
    };
    assert_eq!(value.validate(), Err(GameMenuError::LayoutIdentity));
}

#[test]
fn cancel_requires_visible_enabled_option_before_logical_duplicate_validation() {
    for invalid_id in ["a", "hidden", "missing"] {
        let mut value = menu();
        value.options.push(option("b", true, true));
        value.options.push(option("a", true, false));
        value.cancel = GameMenuCancelV2::Select {
            option_id: id(invalid_id),
        };
        assert_eq!(value.validate(), Err(GameMenuError::InvalidCancelSelection));
    }
    let mut value = menu();
    value.options.push(option("b", true, true));
    assert_eq!(
        value.validate(),
        Err(GameMenuError::Logical(LogicalMenuError::DuplicateOption))
    );
    for cancel in [
        GameMenuCancelV2::Back {
            action: Box::new(invalid_action()),
        },
        GameMenuCancelV2::Close {
            action: Box::new(invalid_action()),
        },
    ] {
        value.cancel = cancel;
        assert_eq!(
            value.validate(),
            Err(GameMenuError::Action(GameActionError::EmptySaveSlot))
        );
    }
}

#[test]
fn visible_membership_does_not_hide_duplicate_navigation_keys() {
    let mut value = menu();
    value.navigation.push(value.navigation[0].clone());
    assert_eq!(
        value.validate(),
        Err(GameMenuError::Logical(
            LogicalMenuError::DuplicateNavigationEdge
        ))
    );
}
