#![allow(clippy::too_many_arguments)]

mod snapshot {
    pub(crate) use er_kernel::snapshot::{
        HeldLogicalButtonSnapshotV2, InputButtonLockSnapshotV2, InputRepeatSnapshotV2,
        InputRouterSnapshotV2, PhysicalInputSourceV2, PressedPhysicalInputSnapshotV2,
        SnapshotError,
    };
}

#[allow(dead_code)] // This path-included production module exposes snapshot APIs covered elsewhere.
#[path = "../src/battle_ui.rs"]
mod battle_ui;
#[allow(dead_code)] // This focused UI harness intentionally exercises only the input-routing surface.
#[path = "../src/input_router.rs"]
mod input_router;
#[path = "../src/ui_reducer.rs"]
mod ui_reducer;

use std::error::Error;

use battle_ui::BattleUiAdapter;
use er_protocol::KernelScheduler;
use er_types::battle_control::{
    BattleControl, CommandRootControl, MoveSelectControl, SeatBattleControl,
};
use er_types::battle_ids::{BattleId, BattleSide, MenuInstanceId, PokemonId, TurnIndex, WaveIndex};
use er_types::battle_ui::{
    BATTLE_UI_PROJECTION_SCHEMA_VERSION, BattleMenu, BattleMenuOption, BattleUiProjection,
    MenuNavigationEdge, MenuOptionLayout, MenuOptionVisibility, NavigationDirection,
};
use er_types::{
    ButtonEvent, GameButton, InputFocus, InputMap, KeyBinding, MenuOptionId, OperationId,
    PhysicalKey, RawInputEvent, SafeU53, SeatId,
};
use input_router::BattleButtonEvent;
use ui_reducer::{BattleUiIntent, BattleUiReducer, BattleUiReject};

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::MAX,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn option(id: &str, row: u16, enabled: bool) -> Result<BattleMenuOption, Box<dyn Error>> {
    let option_id = MenuOptionId::new(id)?;
    Ok(BattleMenuOption::new(
        option_id.clone(),
        format!("label.{id}"),
        MenuOptionVisibility::Visible,
        enabled,
        MenuOptionLayout::new(option_id, row, 0, 0),
    )?)
}

fn command_projection(
    instance_id: u64,
    selected: &str,
    switch_enabled: bool,
    navigation: Vec<MenuNavigationEdge>,
) -> Result<BattleUiProjection, Box<dyn Error>> {
    let fight = MenuOptionId::new("command/fight")?;
    let switch = MenuOptionId::new("command/switch")?;
    let menu = BattleMenu::new(
        MenuInstanceId::new(safe(instance_id)),
        seat(1),
        "battle/1/wave/1/turn/1/control/player/0/seat/1/command",
        MenuOptionId::new(selected)?,
        vec![
            option(switch.as_str(), 1, switch_enabled)?,
            option(fight.as_str(), 0, true)?,
        ],
        navigation,
    )?;
    let control = BattleControl::CommandRoot(CommandRootControl::new(
        PokemonId::new(safe(7)),
        er_types::battle_ids::FieldSlot {
            side: BattleSide::Player,
            position: 0,
        },
        menu,
    )?);
    let operation_id = OperationId::new("battle/1/wave/1/turn/1/command/player/0/seat/1")?;
    Ok(BattleUiProjection::new(
        BATTLE_UI_PROJECTION_SCHEMA_VERSION,
        BattleId::new(safe(1)),
        WaveIndex::new(safe(1))?,
        TurnIndex::new(safe(1))?,
        SeatBattleControl::new(seat(1), Some(operation_id), control),
        true,
    )?)
}

fn move_projection(instance_id: u64) -> Result<BattleUiProjection, Box<dyn Error>> {
    let root = command_projection(
        1,
        "command/fight",
        true,
        vec![MenuNavigationEdge::new(
            MenuOptionId::new("command/fight")?,
            NavigationDirection::Down,
            MenuOptionId::new("command/switch")?,
        )],
    )?;
    let BattleControl::CommandRoot(root) = root.seat_control.control else {
        return Err("command fixture did not build a root control".into());
    };
    let mut options = Vec::new();
    for slot in 0..4 {
        options.push(option(&format!("move/7/slot/{slot}"), slot, true)?);
    }
    let menu = BattleMenu::new(
        MenuInstanceId::new(safe(instance_id)),
        seat(1),
        "battle/1/wave/1/turn/1/control/player/0/seat/1/move",
        MenuOptionId::new("move/7/slot/0")?,
        options,
        Vec::new(),
    )?;
    let control = BattleControl::MoveSelect(MoveSelectControl::new(
        root.actor,
        root.field_slot,
        menu,
        Box::new(BattleControl::CommandRoot(root)),
    )?);
    let operation_id = OperationId::new("battle/1/wave/1/turn/1/command/player/0/seat/1")?;
    Ok(BattleUiProjection::new(
        BATTLE_UI_PROJECTION_SCHEMA_VERSION,
        BattleId::new(safe(1)),
        WaveIndex::new(safe(1))?,
        TurnIndex::new(safe(1))?,
        SeatBattleControl::new(seat(1), Some(operation_id), control),
        true,
    )?)
}

fn battle_input_map() -> InputMap {
    InputMap {
        keyboard: vec![
            KeyBinding {
                key: PhysicalKey::ArrowUp,
                button: GameButton::Up,
            },
            KeyBinding {
                key: PhysicalKey::ArrowDown,
                button: GameButton::Down,
            },
            KeyBinding {
                key: PhysicalKey::Enter,
                button: GameButton::Submit,
            },
            KeyBinding {
                key: PhysicalKey::Space,
                button: GameButton::Action,
            },
            KeyBinding {
                key: PhysicalKey::Backspace,
                button: GameButton::Cancel,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(999),
        repeat_interval_ms: safe(999),
    }
}

fn key_down(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

#[test]
fn battle_reducer_uses_only_explicit_edges_and_preserves_legacy_reducer_path() -> TestResult {
    let fight = MenuOptionId::new("command/fight")?;
    let switch = MenuOptionId::new("command/switch")?;
    let mut reducer = BattleUiReducer::new(command_projection(
        1,
        "command/fight",
        true,
        vec![
            MenuNavigationEdge::new(fight.clone(), NavigationDirection::Down, switch.clone()),
            MenuNavigationEdge::new(switch.clone(), NavigationDirection::Up, fight.clone()),
        ],
    )?)?;

    let no_edge = reducer.reduce(seat(1), ButtonEvent::Pressed(GameButton::Up))?;
    assert!(!no_edge.changed);
    assert_eq!(
        reducer.projection().seat_control.control.clone(),
        command_projection(
            1,
            "command/fight",
            true,
            vec![
                MenuNavigationEdge::new(fight.clone(), NavigationDirection::Down, switch.clone(),),
                MenuNavigationEdge::new(switch.clone(), NavigationDirection::Up, fight.clone()),
            ],
        )?
        .seat_control
        .control
    );
    let moved = reducer.reduce(seat(1), ButtonEvent::Pressed(GameButton::Down))?;
    assert!(moved.changed);
    let Some(current_menu) = reducer.current_menu() else {
        return Err("root menu was not retained after navigation".into());
    };
    assert_eq!(current_menu.selected_option_id.clone(), switch);
    assert!(
        !reducer
            .reduce(seat(1), ButtonEvent::Pressed(GameButton::Right))?
            .changed
    );

    let mut legacy = input_router::InputRouter::new(battle_input_map());
    let mut scheduler = KernelScheduler::new();
    let legacy_output = legacy.handle(seat(1), key_down(PhysicalKey::ArrowDown), &mut scheduler)?;
    assert_eq!(
        legacy_output.events,
        vec![ButtonEvent::Pressed(GameButton::Down)]
    );
    Ok(())
}

#[test]
fn battle_reducer_fences_seat_and_menu_instance_before_mutation() -> TestResult {
    let projection = command_projection(
        7,
        "command/fight",
        true,
        vec![MenuNavigationEdge::new(
            MenuOptionId::new("command/fight")?,
            NavigationDirection::Down,
            MenuOptionId::new("command/switch")?,
        )],
    )?;
    let mut reducer = BattleUiReducer::new(projection.clone())?;
    let before = reducer.projection().clone();
    assert_eq!(
        reducer.reduce_at(
            seat(2),
            MenuInstanceId::new(safe(7)),
            ButtonEvent::Pressed(GameButton::Down),
        ),
        Err(BattleUiReject::WrongSeat)
    );
    assert_eq!(reducer.projection(), &before);
    assert_eq!(
        reducer.reduce_at(
            seat(1),
            MenuInstanceId::new(safe(8)),
            ButtonEvent::Pressed(GameButton::Down),
        ),
        Err(BattleUiReject::StaleMenuInstance)
    );
    assert_eq!(reducer.projection(), &before);
    Ok(())
}

#[test]
fn battle_disabled_options_remain_navigation_endpoints_but_reject_activation() -> TestResult {
    let mut reducer = BattleUiReducer::new(command_projection(
        1,
        "command/fight",
        false,
        vec![MenuNavigationEdge::new(
            MenuOptionId::new("command/fight")?,
            NavigationDirection::Down,
            MenuOptionId::new("command/switch")?,
        )],
    )?)?;
    assert!(
        reducer
            .reduce(seat(1), ButtonEvent::Pressed(GameButton::Down))?
            .changed
    );
    assert_eq!(
        reducer.reduce(seat(1), ButtonEvent::Pressed(GameButton::Action)),
        Err(BattleUiReject::DisabledOption)
    );
    Ok(())
}

#[test]
fn battle_raw_repeat_duplicate_keyup_blur_and_stale_timer_are_deterministic() -> TestResult {
    let projection = command_projection(
        1,
        "command/fight",
        true,
        vec![MenuNavigationEdge::new(
            MenuOptionId::new("command/fight")?,
            NavigationDirection::Down,
            MenuOptionId::new("command/switch")?,
        )],
    )?;
    let mut adapter = BattleUiAdapter::new(seat(1), projection, battle_input_map())?;
    let mut scheduler = KernelScheduler::new();

    let first =
        adapter.handle_raw_input(seat(1), key_down(PhysicalKey::ArrowDown), &mut scheduler)?;
    assert!(first.projection_changed);
    assert_eq!(first.timers.len(), 1);
    assert_eq!(
        first.timers[0],
        er_types::InputTimerCommand::Schedule {
            timer_id: er_types::TimerId::new(safe(0)),
            delay_ms: safe(250),
        }
    );
    let duplicate =
        adapter.handle_raw_input(seat(1), key_down(PhysicalKey::ArrowDown), &mut scheduler)?;
    assert_eq!(duplicate, battle_ui::BattleUiOutput::default());

    let repeated = adapter.timer_fired(seat(1), er_types::TimerId::new(safe(0)), &mut scheduler)?;
    assert!(repeated.rejection.is_none());
    assert_eq!(repeated.timers.len(), 1);
    let released = adapter.handle_raw_input(
        seat(1),
        RawInputEvent::KeyUp {
            code: PhysicalKey::ArrowDown,
        },
        &mut scheduler,
    )?;
    assert_eq!(released.timers.len(), 1);
    assert!(scheduler.live_timers().is_empty());
    assert_eq!(adapter.input().held_count(), 0);
    assert_eq!(adapter.input().lock_count(), 0);

    let held = adapter.handle_raw_input(seat(1), key_down(PhysicalKey::Space), &mut scheduler)?;
    assert_eq!(held.timers.len(), 1);
    let blurred =
        adapter.handle_raw_input(seat(1), RawInputEvent::WindowBlurred, &mut scheduler)?;
    assert_eq!(blurred.timers.len(), 1);
    assert_eq!(adapter.input().held_count(), 0);
    assert_eq!(adapter.input().lock_count(), 0);
    assert_eq!(adapter.input().repeat_count(), 0);
    assert!(scheduler.live_timers().is_empty());

    let held = adapter.handle_raw_input(seat(1), key_down(PhysicalKey::Space), &mut scheduler)?;
    assert_eq!(held.timers.len(), 1);
    adapter.install_projection(move_projection(2)?)?;
    let stale = adapter.timer_fired(seat(1), er_types::TimerId::new(safe(3)), &mut scheduler)?;
    assert_eq!(stale.rejection, Some(BattleUiReject::StaleMenuInstance));
    assert!(stale.intents.is_empty());
    assert!(scheduler.live_timers().is_empty());
    let stale_release = adapter.handle_raw_input(
        seat(1),
        RawInputEvent::KeyUp {
            code: PhysicalKey::Space,
        },
        &mut scheduler,
    )?;
    assert!(stale_release.intents.is_empty());
    assert_eq!(adapter.input().held_count(), 0);
    Ok(())
}

#[test]
fn battle_input_route_and_one_button_reduction_are_separate_stages() -> TestResult {
    let projection = command_projection(
        1,
        "command/fight",
        true,
        vec![MenuNavigationEdge::new(
            MenuOptionId::new("command/fight")?,
            NavigationDirection::Down,
            MenuOptionId::new("command/switch")?,
        )],
    )?;
    let mut adapter = BattleUiAdapter::new(seat(1), projection.clone(), battle_input_map())?;
    let mut scheduler = KernelScheduler::new();

    let routed =
        adapter.route_raw_input(seat(1), key_down(PhysicalKey::ArrowDown), &mut scheduler)?;
    assert_eq!(routed.events.len(), 1);
    assert_eq!(routed.timers.len(), 1);
    assert_eq!(adapter.projection(), &projection);
    let captured = routed.events[0];
    assert_eq!(
        captured,
        BattleButtonEvent::Pressed {
            seat: seat(1),
            button: GameButton::Down,
            menu_instance_id: MenuInstanceId::new(safe(1)),
        }
    );

    let reduction = adapter.reduce_one_button(captured)?;
    assert!(reduction.changed);
    assert!(reduction.intents.is_empty());
    assert_ne!(adapter.projection(), &projection);

    let repeated =
        adapter.route_timer_fired(seat(1), er_types::TimerId::new(safe(0)), &mut scheduler)?;
    assert_eq!(repeated.events.len(), 1);
    assert_eq!(repeated.timers.len(), 1);
    assert_eq!(
        adapter.reduce_one_button(repeated.events[0])?,
        ui_reducer::BattleUiReduction {
            changed: false,
            intents: Vec::new(),
        }
    );

    assert_eq!(
        adapter.reduce_one_button(BattleButtonEvent::Released {
            seat: seat(1),
            button: GameButton::Down,
            menu_instance_id: MenuInstanceId::new(safe(1)),
        }),
        Err(BattleUiReject::UnsupportedButton)
    );
    let released = adapter.route_raw_input(
        seat(1),
        RawInputEvent::KeyUp {
            code: PhysicalKey::ArrowDown,
        },
        &mut scheduler,
    )?;
    assert_eq!(released.events.len(), 1);
    assert_eq!(released.timers.len(), 1);
    assert!(scheduler.live_timers().is_empty());
    Ok(())
}

#[test]
fn battle_action_and_cancel_emit_only_private_ui_intents_and_teardown_is_idempotent() -> TestResult
{
    let projection = command_projection(1, "command/fight", true, Vec::new())?;
    let mut adapter = BattleUiAdapter::new(seat(1), projection, battle_input_map())?;
    let mut scheduler = KernelScheduler::new();
    let action = adapter.handle_raw_input(seat(1), key_down(PhysicalKey::Enter), &mut scheduler)?;
    assert_eq!(
        action.intents,
        vec![BattleUiIntent::Activate {
            seat: seat(1),
            menu_instance_id: MenuInstanceId::new(safe(1)),
            control_id: "battle/1/wave/1/turn/1/control/player/0/seat/1/command".to_owned(),
            option_id: MenuOptionId::new("command/fight")?,
        }]
    );
    let _ = adapter.handle_raw_input(
        seat(1),
        RawInputEvent::KeyUp {
            code: PhysicalKey::Enter,
        },
        &mut scheduler,
    )?;
    assert!(
        adapter
            .handle_raw_input(
                seat(1),
                RawInputEvent::KeyDown {
                    code: PhysicalKey::Backspace,
                    printable: false,
                    browser_repeat: false,
                    focus: InputFocus::Game,
                },
                &mut scheduler
            )?
            .rejection
            .is_some()
    );
    let disposed = adapter.dispose(&mut scheduler);
    assert!(scheduler.live_timers().is_empty());
    assert_eq!(adapter.input().held_count(), 0);
    assert_eq!(
        adapter.dispose(&mut scheduler),
        battle_ui::BattleUiOutput::default()
    );
    assert!(matches!(
        adapter.handle_raw_input(seat(1), RawInputEvent::WindowFocused, &mut scheduler),
        Err(battle_ui::BattleUiAdapterError::Disposed)
    ));
    assert!(disposed.intents.is_empty());
    Ok(())
}
