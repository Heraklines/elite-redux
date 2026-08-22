//! Two-endpoint M4 physical-input ownership campaign.

use std::error::Error;

use er_kernel::GameKernel;
use er_sim::{M4PairError, M4RunPair, PairEndpoint};
use er_state::run_v2::{
    CrossroadsSurfaceState, RUN_SURFACE_STATE_SCHEMA_VERSION, RunSurfaceState, SurfaceHeader,
};
use er_testkit::m4_fixture::assemble_game_state;
use er_types::battle_ids::{ContentPackHash, MenuInstanceId};
use er_types::input::{GameButton, InputFocus, InputMap, KeyBinding, PhysicalKey, RawInputEvent};
use er_types::run_control::{
    CrossroadsControl, GameControl, GameControlPlan, PresentationBarrier, SeatControlPlan,
    SurfaceControl,
};
use er_types::run_ids::{RunContentPackHash, RunInteractionSequence, RunSurfaceId, SurfaceDigest};
use er_types::run_model::{
    CrossroadsAction, RunOutcome, RunStage, RunSurfaceAction, RunSurfaceKind,
};
use er_types::ui::CancelPolicy;
use er_types::ui_menu::{LogicalMenu, LogicalMenuOption, MenuNavigationEdge, NavigationDirection};
use er_types::{OperationId, SafeU53, SeatId};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m4/oracle/progression/nacli-medium-slow-level-17-v1.json"
);
const ORACLE: &str = "45c89493e7edec9c4da247a98cd7858b1f015c09";

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe u53")
}

fn kernels() -> Result<(GameKernel, GameKernel, SeatId, SeatId), Box<dyn Error>> {
    let fixture: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(FIXTURE)?)?;
    let initial = &fixture["initial"];
    let battle_hash = ContentPackHash::new(
        initial["battle_content_hash"]
            .as_str()
            .ok_or("battle content hash")?,
    )?;
    let run_hash = RunContentPackHash::new(
        initial["run_content_hash"]
            .as_str()
            .ok_or("run content hash")?,
    )?;
    let mut state = assemble_game_state(&fixture, battle_hash.clone(), run_hash.clone(), ORACLE)?;
    let watcher = SeatId::new(safe(1));
    let owner = SeatId::new(safe(2));
    let surface_id = RunSurfaceId::new(safe(1));
    let interaction = RunInteractionSequence::new(SafeU53::ZERO);
    let instance = MenuInstanceId::new(safe(1));
    let stay = er_types::MenuOptionId::new("crossroads/stay")?;
    let leave = er_types::MenuOptionId::new("crossroads/leave")?;
    let menu = LogicalMenu::new(
        instance,
        owner,
        "run/crossroads/guest",
        stay.clone(),
        vec![
            LogicalMenuOption::new(stay.clone(), true, None)?,
            LogicalMenuOption::new(leave.clone(), true, None)?,
        ],
        vec![MenuNavigationEdge::new(
            stay,
            NavigationDirection::Down,
            leave,
        )],
        CancelPolicy::Disabled,
    )?;
    state.run.stage = RunStage::Surface;
    state.run.outcome = RunOutcome::InProgress;
    state.run.active_surface = Some(RunSurfaceState::Crossroads(CrossroadsSurfaceState {
        header: SurfaceHeader {
            schema_version: RUN_SURFACE_STATE_SCHEMA_VERSION,
            surface_id,
            kind: RunSurfaceKind::Crossroads,
            owner_seat: owner,
            interaction_sequence: interaction,
            action_ordinal: 0,
            operation_id: OperationId::new("1:2:CROSSROADS_PICK:9600001")?,
            menu: menu.clone(),
            surface_digest: SurfaceDigest::new(format!("blake3-v1:{}", "0".repeat(64)))?,
        },
        source_wave: state.run.wave,
    }));
    state.validate().map_err(|error| error.to_string())?;

    let surface = SurfaceControl::Crossroads(CrossroadsControl::new(
        surface_id,
        interaction,
        menu.clone(),
    ));
    let plan = GameControlPlan::new(
        vec![
            SeatControlPlan {
                seat: watcher,
                owner: false,
                control_id: menu.control_id.clone(),
                menu_instance_id: instance,
                actionable_after: PresentationBarrier::NonBlocking,
                control: GameControl::Surface(surface.clone()),
            },
            SeatControlPlan {
                seat: owner,
                owner: true,
                control_id: menu.control_id.clone(),
                menu_instance_id: instance,
                actionable_after: PresentationBarrier::NonBlocking,
                control: GameControl::Surface(surface),
            },
        ],
        "run/crossroads/next".to_owned(),
        MenuInstanceId::new(safe(2)),
    )?;
    let input_map = InputMap {
        keyboard: vec![
            KeyBinding {
                key: PhysicalKey::ArrowDown,
                button: GameButton::Down,
            },
            KeyBinding {
                key: PhysicalKey::Space,
                button: GameButton::Submit,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: safe(250),
        repeat_interval_ms: safe(250),
    };
    let host = GameKernel::new_run_with_control(
        state.clone(),
        battle_hash.clone(),
        run_hash.clone(),
        ORACLE,
        input_map.clone(),
        plan.clone(),
    )
    .map_err(std::io::Error::other)?;
    let guest =
        GameKernel::new_run_with_control(state, battle_hash, run_hash, ORACLE, input_map, plan)
            .map_err(std::io::Error::other)?;
    Ok((host, guest, owner, watcher))
}

fn raw(key: PhysicalKey, down: bool) -> RawInputEvent {
    if down {
        RawInputEvent::KeyDown {
            printable: matches!(key, PhysicalKey::Space),
            code: key,
            browser_repeat: false,
            focus: InputFocus::Game,
        }
    } else {
        RawInputEvent::KeyUp { code: key }
    }
}

#[test]
fn guest_owner_acts_by_physical_keys_while_watcher_and_disconnected_input_fail_closed()
-> Result<(), Box<dyn Error>> {
    let (host, guest, owner, watcher) = kernels()?;
    let mut pair = M4RunPair::new(host, guest);

    assert!(matches!(
        pair.step_raw(PairEndpoint::Host, watcher, raw(PhysicalKey::Space, true)),
        Err(M4PairError::Kernel(_))
    ));
    assert!(pair.take_actions(PairEndpoint::Host).is_empty());

    pair.disconnect_guest();
    assert!(matches!(
        pair.step_raw(
            PairEndpoint::Guest,
            owner,
            raw(PhysicalKey::ArrowDown, true)
        ),
        Err(M4PairError::DisconnectedInput)
    ));
    pair.reconnect_guest();

    for key in [PhysicalKey::ArrowDown, PhysicalKey::Space] {
        pair.step_raw(PairEndpoint::Guest, owner, raw(key.clone(), true))?;
        pair.step_raw(PairEndpoint::Guest, owner, raw(key, false))?;
    }
    assert_eq!(
        pair.take_actions(PairEndpoint::Guest),
        vec![RunSurfaceAction::Crossroads(CrossroadsAction::MoveOn)]
    );
    assert!(pair.take_actions(PairEndpoint::Host).is_empty());
    Ok(())
}
