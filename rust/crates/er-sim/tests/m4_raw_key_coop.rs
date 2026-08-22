//! Two-endpoint M4 physical-input ownership campaign.

use std::error::Error;

use er_kernel::{GameKernel, RunKernelRole};
use er_sim::{M4PairError, M4RunPair, PairEndpoint};
use er_state::run_v2::{
    CrossroadsSurfaceState, RUN_SURFACE_STATE_SCHEMA_VERSION, RunSurfaceState, SurfaceHeader,
};
use er_testkit::m4_fixture::assemble_selected_game_state;
use er_types::battle_ids::MenuInstanceId;
use er_types::input::{GameButton, InputFocus, InputMap, KeyBinding, PhysicalKey, RawInputEvent};
use er_types::run_control::{
    CrossroadsControl, GameControl, GameControlPlan, PresentationBarrier, SeatControlPlan,
    SurfaceControl,
};
use er_types::run_ids::{RunInteractionSequence, RunSurfaceId, SurfaceDigest};
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
const ENCOUNTER_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m4/oracle/encounters/plains-wave-11-captured-v1.json"
);
const ORACLE: &str = "45c89493e7edec9c4da247a98cd7858b1f015c09";

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe u53")
}

fn captured_encounter(
    state: &er_state::game_v2::GameStateV2,
) -> Result<er_run::encounter_plan::EncounterPlan, Box<dyn Error>> {
    let fixture: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(ENCOUNTER_FIXTURE)?)?;
    let enemy_value = fixture["final"]["canonical"]["save_data"]["enemyParty"]
        .as_array()
        .and_then(|party| party.first())
        .ok_or("captured enemy missing")?;
    let enemy_id = er_types::battle_ids::PokemonId::new(safe(
        enemy_value["id"].as_u64().ok_or("captured enemy ID")?,
    ));
    let enemy = er_testkit::m4_fixture::convert_pokemon(enemy_value, enemy_id, None)?;
    Ok(er_run::encounter_plan::EncounterPlan {
        schema_version: er_run::encounter_plan::ENCOUNTER_PLAN_SCHEMA_VERSION,
        encounter_id: er_types::run_ids::EncounterId::new(safe(1)),
        run_id: state.run.run_id,
        wave: er_types::battle_ids::WaveIndex::new(safe(11))?,
        biome: er_types::run_ids::BiomeId::new(safe(1)),
        format: er_types::battle_ids::BattleFormat::single(),
        enemy_party: vec![enemy],
        enemy_leads: vec![enemy_id],
        player_leads: vec![state.player_party[0].id],
        scripted_policy: er_types::battle_command::ScriptedEnemyPolicyV1::new(
            SafeU53::ZERO,
            Vec::new(),
        )?,
        battle_seed: fixture["final"]["canonical"]["runtime"]["battle_seed"]
            .as_str()
            .ok_or("captured battle seed")?
            .to_owned(),
        generation_audit: Vec::new(),
        source: er_run::content::EncounterPlanSource::OracleCaptureRequired,
        content_hash: Some(state.run_content_hash.clone()),
    })
}

fn kernels() -> Result<(GameKernel, GameKernel, SeatId, SeatId), Box<dyn Error>> {
    let fixture: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(FIXTURE)?)?;
    let (mut state, content) = assemble_selected_game_state(&fixture, ORACLE)?;
    state.run.wave = er_types::battle_ids::WaveIndex::new(safe(10))?;
    let owner = SeatId::new(safe(1));
    let watcher = SeatId::new(safe(2));
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
    let encounter = captured_encounter(&state)?;
    let host = GameKernel::new_run_endpoint_with_encounter(
        state.clone(),
        content.clone(),
        input_map.clone(),
        plan.clone(),
        RunKernelRole::Authority,
        encounter.clone(),
    )
    .map_err(std::io::Error::other)?;
    let guest = GameKernel::new_run_endpoint_with_encounter(
        state,
        content,
        input_map,
        plan,
        RunKernelRole::Replica,
        encounter,
    )
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
    pair.step_raw(PairEndpoint::Guest, owner, raw(PhysicalKey::Space, true))?;
    pair.step_raw(PairEndpoint::Guest, owner, raw(PhysicalKey::Space, false))?;
    assert_eq!(
        pair.take_actions(PairEndpoint::Guest),
        vec![
            RunSurfaceAction::Crossroads(CrossroadsAction::MoveOn),
            RunSurfaceAction::BiomeSelect(er_types::run_model::BiomeSelectAction {
                route_node: er_types::run_ids::RouteNodeId::new(safe(1)),
                biome: er_types::run_ids::BiomeId::new(safe(1)),
            }),
        ]
    );
    assert!(pair.take_actions(PairEndpoint::Host).is_empty());
    assert_eq!(
        pair.frontiers()?.0,
        pair.frontiers()?.1,
        "guest proposal must resolve once on authority and apply on both endpoints"
    );
    Ok(())
}

#[test]
fn delayed_duplicate_guest_action_recovers_without_replica_resolution() -> Result<(), Box<dyn Error>>
{
    let (host, guest, owner, _) = kernels()?;
    let mut pair = M4RunPair::new(host, guest);
    pair.delay_next_material(safe(100));

    for key in [PhysicalKey::ArrowDown, PhysicalKey::Space] {
        pair.step_raw(PairEndpoint::Guest, owner, raw(key.clone(), true))?;
        pair.step_raw(PairEndpoint::Guest, owner, raw(key, false))?;
    }
    assert_ne!(pair.frontiers()?.0, pair.frontiers()?.1);
    assert_eq!(pair.queued_packets().len(), 1);
    let packet_id = pair.queued_packets()[0].packet_id;
    pair.duplicate_packet(packet_id)?;

    pair.disconnect_guest();
    assert_eq!(pair.advance_time(safe(100))?, 0);
    pair.reconnect_guest();
    assert_eq!(pair.deliver_due()?, 1);
    assert!(pair.queued_packets().is_empty());
    assert_eq!(pair.frontiers()?.0, pair.frontiers()?.1);
    assert_eq!(
        pair.take_actions(PairEndpoint::Guest),
        vec![RunSurfaceAction::Crossroads(CrossroadsAction::MoveOn)]
    );
    assert!(pair.take_actions(PairEndpoint::Host).is_empty());
    Ok(())
}
