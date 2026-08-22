//! Deterministic M4 run-material delay, duplicate, drop, disconnect, and
//! operation-conflict campaigns.

use std::error::Error;

use er_game::run_runtime::project_terminal_or_wait_control;
use er_kernel::GameKernel;
use er_run::run_material::{
    AuthorityRunMaterial, RUN_MATERIAL_M3_PARITY_ORACLE_SHA, RUN_TERMINAL_MATERIAL_VERSION,
    RunMaterialHeader, RunTerminalMaterialV1, encode_run_material,
};
use er_run::transition::{RunMutation, RunPresentationEvent};
use er_sim::{M4PairError, M4RunPair};
use er_state::digest_v2::MechanicalStateDigestV2;
use er_state::game_v2::GameStateV2;
use er_testkit::m4_fixture::assemble_game_state;
use er_types::battle_ids::{ContentPackHash, MenuInstanceId};
use er_types::run_ids::{Money, RunContentPackHash};
use er_types::{OperationId, SafeU53, SeatId};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m4/oracle/progression/nacli-medium-slow-level-17-v1.json"
);
const ORACLE: &str = "45c89493e7edec9c4da247a98cd7858b1f015c09";

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe u53")
}

fn load_state() -> Result<(GameStateV2, ContentPackHash, RunContentPackHash), Box<dyn Error>> {
    let fixture: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(FIXTURE)?)?;
    let initial = &fixture["initial"];
    let battle = ContentPackHash::new(
        initial["battle_content_hash"]
            .as_str()
            .ok_or("battle content hash")?,
    )?;
    let run = RunContentPackHash::new(
        initial["run_content_hash"]
            .as_str()
            .ok_or("run content hash")?,
    )?;
    let state = assemble_game_state(&fixture, battle.clone(), run.clone(), ORACLE)?;
    Ok((state, battle, run))
}

fn material(
    before: &GameStateV2,
    money_after: u64,
    operation: &str,
    menu_instance: u64,
) -> Result<(Vec<u8>, GameStateV2), Box<dyn Error>> {
    let mut after = before.clone();
    let money_before = after.run.money;
    after.run.money = Money::new(safe(money_after));
    after.validate().map_err(|error| error.to_string())?;
    let before_digest = MechanicalStateDigestV2::compute(before)?;
    let after_digest = MechanicalStateDigestV2::compute(&after)?;
    let owner = SeatId::new(safe(1));
    let next_control = project_terminal_or_wait_control(
        &after,
        format!("run/complete/{menu_instance}"),
        owner,
        MenuInstanceId::new(safe(menu_instance)),
    )?;
    let material = AuthorityRunMaterial::Terminal(RunTerminalMaterialV1 {
        schema_version: RUN_TERMINAL_MATERIAL_VERSION,
        header: RunMaterialHeader {
            m4_oracle_sha: ORACLE.to_owned(),
            m3_parity_oracle_sha: RUN_MATERIAL_M3_PARITY_ORACLE_SHA.to_owned(),
            battle_content_hash: before.battle_content_hash.clone(),
            run_content_hash: before.run_content_hash.clone(),
            operation_id: OperationId::new(operation)?,
            run_id: before.run.run_id,
            wave: before.run.wave,
            before_digest,
            after_digest,
            before_state: before.clone(),
            after_state: after.clone(),
            next_control,
        },
        outcome: after.run.outcome,
        mutations: vec![RunMutation::MoneyChanged {
            before: money_before,
            after: after.run.money,
        }],
        presentation: vec![RunPresentationEvent::MoneyChanged {
            before: money_before,
            after: after.run.money,
        }],
    });
    Ok((encode_run_material(&material)?, after))
}

fn pair(
    state: GameStateV2,
    battle: ContentPackHash,
    run: RunContentPackHash,
) -> Result<M4RunPair, Box<dyn Error>> {
    let host = GameKernel::new_run(state.clone(), battle.clone(), run.clone(), ORACLE)
        .map_err(std::io::Error::other)?;
    let guest = GameKernel::new_run(state, battle, run, ORACLE).map_err(std::io::Error::other)?;
    Ok(M4RunPair::new(host, guest))
}

#[test]
fn delayed_out_of_order_duplicate_material_catches_up_after_reconnect() -> Result<(), Box<dyn Error>>
{
    let (state, battle, run) = load_state()?;
    let (first, after_first) = material(&state, 10_000, "1:1:REWARD:900001", 1)?;
    let (second, _) = material(&after_first, 10_500, "1:1:REWARD:900002", 2)?;
    let mut pair = pair(state, battle, run)?;

    let first_packet = pair.commit_authority(first, safe(100))?;
    pair.duplicate_packet(first_packet)?;
    pair.commit_authority(second, SafeU53::ZERO)?;

    assert_eq!(pair.deliver_due()?, 0, "successor waits for its frontier");
    pair.disconnect_guest();
    assert_eq!(pair.advance_time(safe(100))?, 0);
    assert_eq!(pair.queued_packets().len(), 3);
    pair.reconnect_guest();
    assert_eq!(
        pair.deliver_due()?,
        2,
        "each operation applies exactly once"
    );
    assert!(pair.queued_packets().is_empty());
    let (host, guest) = pair.frontiers()?;
    assert_eq!(host, guest);
    let (host_resources, guest_resources) = pair.teardown("fault campaign complete");
    assert_eq!(host_resources, er_types::LiveResourceSnapshot::default());
    assert_eq!(guest_resources, er_types::LiveResourceSnapshot::default());
    Ok(())
}

#[test]
fn dropped_copy_and_conflicting_operation_fail_closed() -> Result<(), Box<dyn Error>> {
    let (state, battle, run) = load_state()?;
    let (bytes, _) = material(&state, 11_000, "1:1:SHOP_BUY:900003", 1)?;
    let (conflict, _) = material(&state, 12_000, "1:1:SHOP_BUY:900003", 2)?;
    let mut pair = pair(state, battle, run)?;

    let original = pair.commit_authority(bytes, SafeU53::ZERO)?;
    pair.duplicate_packet(original)?;
    pair.drop_packet(original)?;
    assert_eq!(pair.deliver_due()?, 1);
    assert_eq!(pair.frontiers()?.0, pair.frontiers()?.1);
    assert!(matches!(
        pair.commit_authority(conflict, SafeU53::ZERO),
        Err(M4PairError::OperationConflict)
    ));
    let (host_resources, guest_resources) = pair.teardown("conflict campaign complete");
    assert_eq!(host_resources, er_types::LiveResourceSnapshot::default());
    assert_eq!(guest_resources, er_types::LiveResourceSnapshot::default());
    Ok(())
}

#[test]
fn invalid_next_menu_aborts_before_state_swap() -> Result<(), Box<dyn Error>> {
    use er_run::run_material::decode_run_material;
    use er_types::run_control::{
        CrossroadsControl, GameControl, GameControlPlan, PresentationBarrier, SeatControlPlan,
        SurfaceControl,
    };
    use er_types::run_ids::{RunInteractionSequence, RunSurfaceId};
    use er_types::ui::CancelPolicy;
    use er_types::ui_menu::{LogicalMenu, LogicalMenuOption};

    let (state, battle, run) = load_state()?;
    let mut runtime =
        er_game::run_runtime::RunRuntime::new(state.clone(), battle.clone(), run.clone(), ORACLE)?;
    let mut kernel =
        GameKernel::new_run(state.clone(), battle, run, ORACLE).map_err(std::io::Error::other)?;
    let before = kernel
        .run_frontier_digest()
        .map_err(std::io::Error::other)?;
    let (bytes, _) = material(&state, 13_000, "1:1:REWARD:900004", 1)?;
    let mut material = decode_run_material(&bytes)?;
    let owner = SeatId::new(safe(1));
    let present = er_types::MenuOptionId::new("crossroads/stay")?;
    let invalid_menu = LogicalMenu {
        instance_id: MenuInstanceId::new(safe(1)),
        owner_seat: owner,
        control_id: "run/invalid-menu".to_owned(),
        selected_option_id: er_types::MenuOptionId::new("crossroads/missing")?,
        options: vec![LogicalMenuOption::new(present, true, None)?],
        navigation: Vec::new(),
        cancel: CancelPolicy::Disabled,
    };
    let control = SurfaceControl::Crossroads(CrossroadsControl::new(
        RunSurfaceId::new(safe(1)),
        RunInteractionSequence::new(SafeU53::ZERO),
        invalid_menu,
    ));
    let invalid_plan = GameControlPlan::new(
        vec![SeatControlPlan {
            seat: owner,
            owner: true,
            control_id: "run/invalid-menu".to_owned(),
            menu_instance_id: MenuInstanceId::new(safe(1)),
            actionable_after: PresentationBarrier::NonBlocking,
            control: GameControl::Surface(control),
        }],
        "run/next".to_owned(),
        MenuInstanceId::new(safe(2)),
    )?;
    let AuthorityRunMaterial::Terminal(value) = &mut material else {
        return Err("fixture helper must produce terminal material".into());
    };
    value.header.next_control = invalid_plan;
    let invalid_bytes = encode_run_material(&material)?;
    assert!(kernel.apply_run_material_bytes(&invalid_bytes).is_err());
    assert_eq!(
        kernel
            .run_frontier_digest()
            .map_err(std::io::Error::other)?,
        before
    );
    let runtime_before = runtime.frontier_digest()?;
    assert!(runtime.apply(&material).is_err());
    assert_eq!(runtime.frontier_digest()?, runtime_before);
    Ok(())
}
