use std::error::Error;
use std::sync::Arc;

use er_game::m7_progression_control::generic_vertical_control_v2;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{AppliedGameMaterialLedgerV1, GamePlatformEffectV2};
use er_game::m9e_runtime_v6::{
    GameActionDispatchContextV1, GameDomainExecutionInputV1, GameRuntimeV6,
};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7, KernelStorageResultV2,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{
    CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7, PendingPlatformRequestV2,
    SnapshotV7Error, StorageFrontierSnapshotV1,
};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::{MenuInstanceId, WaveIndex};
use er_types::battle_model::BattleOutcome;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{
    GameActionV1, GameControlKindV2, GameControlPlanV2, GameMenuCancelV2, OperationId,
    PlatformRequestId, PresentationEventId, RunOutcome, SafeU53, SaveActionV1, SeatId, TimeClass,
    TimerId,
};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn profile() -> Result<ProfileStateV1, Box<dyn Error>> {
    Ok(ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: Default::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(safe(1))?,
        },
        dex: DexState::default(),
    })
}

fn content() -> Result<Arc<PreparedGameContentV2>, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
}

fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 {
        next_timer_id: Some(SafeU53::ZERO),
        timers: Vec::new(),
        pauses: Vec::new(),
        disposed: false,
    }
}

fn kernel(content: Arc<PreparedGameContentV2>) -> Result<GameKernelV7, Box<dyn Error>> {
    Ok(GameKernelV7::natural_start(
        profile()?,
        "kernel-v7-natural".to_owned(),
        SeatId::new(safe(1)),
        vec!["preview-slot".to_owned()],
        true,
        content,
        scheduler(),
        None,
    )?)
}

fn key_down(key: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code: key,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn press(kernel: &mut GameKernelV7, key: PhysicalKey) -> Result<GameKernelStepV7, Box<dyn Error>> {
    let step = kernel.raw_input(key_down(key.clone()))?;
    kernel.raw_input(RawInputEvent::KeyUp { code: key })?;
    Ok(step)
}

fn gamepad_press(
    kernel: &mut GameKernelV7,
    button: u16,
) -> Result<GameKernelStepV7, Box<dyn Error>> {
    let step = kernel.raw_input(RawInputEvent::GamepadDown { button })?;
    kernel.raw_input(RawInputEvent::GamepadUp { button })?;
    Ok(step)
}

fn navigate_down_to(kernel: &mut GameKernelV7, option: &str) -> Result<(), Box<dyn Error>> {
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1)
        .ok_or("current control has no menu")?;
    for _ in 0..bound {
        let selected = kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .map(|menu| menu.selected_option_id.as_str() == option)
            .unwrap_or(false);
        if selected {
            return Ok(());
        }
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    Err(format!("option {option} was not reachable by Down").into())
}

fn submit_strongest_move(
    kernel: &mut GameKernelV7,
    content: &PreparedGameContentV2,
) -> Result<GameKernelStepV7, Box<dyn Error>> {
    let menu = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .ok_or("move menu is absent")?;
    let state = kernel.state().ok_or("state is absent")?;
    let run = state.active_run.as_ref().ok_or("run is absent")?;
    let actor = run
        .party
        .iter()
        .find(|pokemon| {
            run.battle.as_ref().is_some_and(|battle| {
                battle.field.slots.iter().any(|slot| {
                    slot.slot.side == er_types::battle_ids::BattleSide::Player
                        && slot.occupant == Some(pokemon.id)
                })
            })
        })
        .ok_or("active player is absent")?;
    let target_option = menu
        .options
        .iter()
        .filter_map(|option| {
            let GameActionV1::Battle {
                action: er_types::BattleUiActionV1::SelectMove { move_slot, .. },
            } = option.action
            else {
                return None;
            };
            let move_id = actor.moves[usize::from(move_slot.get())]?.move_id;
            let definition = content.battle.move_definition(move_id).ok()?;
            let power = match definition.power {
                er_types::battle_model::MovePower::None => 0,
                er_types::battle_model::MovePower::Value(power) => power,
            };
            Some((power, option.option_id.clone()))
        })
        .max_by_key(|(power, _)| *power)
        .map(|(_, option)| option)
        .ok_or("no move option is available")?;
    navigate_down_to(kernel, target_option.as_str())?;
    press(kernel, PhysicalKey::Space)
}

fn complete_natural_start(kernel: &mut GameKernelV7) -> Result<(), Box<dyn Error>> {
    press(kernel, PhysicalKey::Space)?;
    press(kernel, PhysicalKey::Space)?;
    press(kernel, PhysicalKey::Space)?;
    navigate_down_to(kernel, "bootstrap/starter/confirm")?;
    press(kernel, PhysicalKey::Space)?;
    press(kernel, PhysicalKey::Space)?;
    press(kernel, PhysicalKey::Space)?;
    press(kernel, PhysicalKey::Space)?;
    Ok(())
}

fn controlled_active_fixture(
    snapshot: CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<GameKernelV7, Box<dyn Error>> {
    // The real bootstrap material describes the original state. Deliberately
    // edited battle setup cannot restore with that material as canonical evidence.
    assert_eq!(snapshot.validate(&content), Err(SnapshotV7Error::Invalid));
    let GameKernelLifecycleSnapshotV7::Active(state) = snapshot.lifecycle else {
        return Err("controlled fixture is not active".into());
    };
    state.validate_with(content.as_ref())?;
    let fixture = GameKernelV7::from_active(
        state,
        snapshot.material_ledger.next_authority_revision,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content.clone(),
        snapshot.input_router,
        snapshot.scheduler,
        snapshot.protocol,
    )?;
    // This explicitly starts fresh fixture bookkeeping at the same frontier;
    // it does not rewrite the old ledger or claim retained bootstrap history.
    let fresh = fixture.snapshot()?;
    let restored = GameKernelV7::from_snapshot(
        serde_json::from_slice(&serde_json::to_vec(&fresh)?)?,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
    )?;
    assert_eq!(restored.snapshot()?, fresh);
    Ok(restored)
}

#[test]
fn raw_keys_complete_natural_start_and_install_serialized_v6_state() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = kernel(content.clone())?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::Title)
    );
    press(&mut kernel, PhysicalKey::Space)?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::ModeSelect)
    );
    press(&mut kernel, PhysicalKey::Space)?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::StarterSelect)
    );
    press(&mut kernel, PhysicalKey::Space)?;
    navigate_down_to(&mut kernel, "bootstrap/starter/confirm")?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    let step = press(&mut kernel, PhysicalKey::Space)?;

    let state = kernel.state().ok_or("natural run did not install state")?;
    state.validate_with(content.as_ref())?;
    assert!(
        state
            .active_run
            .as_ref()
            .and_then(|run| run.battle.as_ref())
            .is_some()
    );
    assert!(
        step.effects
            .iter()
            .any(|effect| matches!(effect, GameKernelEffectV7::AuthorityMaterial { .. }))
    );
    let ai_commands = kernel.prepare_authority_ai_commands()?;
    assert_eq!(ai_commands.len(), 1);
    ai_commands[0].validate()?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::BattleCommand)
    );
    let turn_before = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .and_then(|run| run.battle.as_ref())
        .map(|battle| battle.turn)
        .ok_or("battle turn is absent")?;
    press(&mut kernel, PhysicalKey::Space)?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::BattleMove)
    );
    let turn_step = press(&mut kernel, PhysicalKey::Space)?;
    assert!(
        turn_step
            .effects
            .iter()
            .any(|effect| matches!(effect, GameKernelEffectV7::AuthorityMaterial { .. }))
    );
    let turn_after = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .and_then(|run| run.battle.as_ref())
        .map(|battle| battle.turn)
        .ok_or("battle turn is absent")?;
    assert!(turn_after > turn_before);
    let snapshot = kernel.snapshot()?;
    let mut restored = GameKernelV7::from_snapshot(
        snapshot,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
    )?;
    assert_eq!(restored.state(), kernel.state());
    let restored_ai = restored.prepare_authority_ai_commands()?;
    assert_eq!(restored_ai.len(), 1);
    restored_ai[0].validate()?;
    Ok(())
}

#[test]
fn nonterminal_battle_progresses_to_next_wave() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = kernel(content.clone())?;
    complete_natural_start(&mut kernel)?;
    let mut snapshot = kernel.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut snapshot.lifecycle else {
        return Err("natural run snapshot is not active".into());
    };
    let enemy = state
        .active_run
        .as_mut()
        .and_then(|run| run.battle.as_mut())
        .and_then(|battle| battle.enemy_party.first_mut())
        .ok_or("enemy is absent")?;
    enemy.hp = 1;
    enemy.fainted = false;
    kernel = controlled_active_fixture(snapshot, content.clone())?;
    let initial_wave = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .map(|run| run.wave)
        .ok_or("initial run is absent")?;
    let mut saw_progression = false;
    let mut saw_reward = false;

    for _ in 0..200 {
        let state = kernel.state().ok_or("state is absent")?;
        let run = state.active_run.as_ref().ok_or("run is absent")?;
        if run.wave > initial_wave {
            assert_eq!(run.outcome, RunOutcome::InProgress);
            assert!(run.battle.is_some(), "next wave has no battle");
            assert_eq!(
                kernel.current_control().map(|control| control.kind),
                Some(GameControlKindV2::BattleCommand)
            );
            assert!(saw_progression, "battle victory skipped progression");
            assert!(saw_reward, "battle victory skipped rewards");
            return Ok(());
        }
        let kind = run.control.kind;
        let step = match kind {
            GameControlKindV2::BattleCommand => press(&mut kernel, PhysicalKey::Space)
                .map_err(|error| format!("BattleCommand failed: {error}"))?,
            GameControlKindV2::BattleMove => submit_strongest_move(&mut kernel, &content)
                .map_err(|error| format!("BattleMove failed: {error}"))?,
            GameControlKindV2::Progression
            | GameControlKindV2::MoveLearn
            | GameControlKindV2::Evolution => {
                saw_progression = true;
                press(&mut kernel, PhysicalKey::Space)
                    .map_err(|error| format!("{kind:?} failed: {error}"))?
            }
            GameControlKindV2::Reward => {
                saw_reward = true;
                press(&mut kernel, PhysicalKey::Space)
                    .map_err(|error| format!("Reward failed: {error}"))?
            }
            GameControlKindV2::Complete => {
                return Err(format!(
                    "ordinary wave {initial_wave:?} battle terminated the run as {:?}",
                    run.outcome
                )
                .into());
            }
            GameControlKindV2::Waiting => {
                return Err("post-battle Waiting control has no advancing producer".into());
            }
            other => return Err(format!("unexpected continuation control {other:?}").into()),
        };
        assert!(
            !step
                .effects
                .iter()
                .any(|effect| matches!(effect, GameKernelEffectV7::Terminal(_))),
            "ordinary battle emitted terminal effect"
        );
        for presentation in kernel.snapshot()?.pending_presentations {
            kernel.settle_presentation(presentation.event_id)?;
        }
        if let Some(battle) = kernel
            .state()
            .and_then(|state| state.active_run.as_ref())
            .and_then(|run| run.battle.as_ref())
            && battle.outcome == BattleOutcome::Defeat
        {
            return Err("deterministic continuation fixture lost its first battle".into());
        }
    }

    Err("solo continuation did not reach wave 2".into())
}
#[test]
fn final_wave_victory_terminates_the_run() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = kernel(content.clone())?;
    complete_natural_start(&mut kernel)?;
    let mut snapshot = kernel.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut snapshot.lifecycle else {
        return Err("natural run snapshot is not active".into());
    };
    let final_wave = WaveIndex::new(safe(200))?;
    let run = state.active_run.as_mut().ok_or("run missing")?;
    run.wave = final_wave;
    let battle = run.battle.as_mut().ok_or("battle missing")?;
    battle.wave = final_wave;
    let enemy = battle.enemy_party.first_mut().ok_or("enemy missing")?;
    enemy.hp = 1;
    enemy.fainted = false;
    // Command operation IDs include the wave. Rebind the controlled root to
    // wave 200 using the same actor/field semantics as the kernel's builder.
    let owner = run.control.owner_seat.ok_or("command owner missing")?;
    let field = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Player
                && slot.occupant.is_some_and(|id| {
                    run.party
                        .iter()
                        .any(|pokemon| pokemon.id == id && pokemon.owner_seat == Some(owner))
                })
        })
        .ok_or("command owner has no active player")?;
    let operation = er_types::battle_command::player_command_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
        field.slot,
        owner,
    )?;
    let context = run
        .control
        .action_context
        .as_mut()
        .ok_or("command context missing")?;
    assert_ne!(context.operation_id, operation);
    context.operation_id = operation;
    run.control.validate()?;
    kernel = controlled_active_fixture(snapshot, content.clone())?;
    press(&mut kernel, PhysicalKey::Space)?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::BattleMove)
    );
    let step = submit_strongest_move(&mut kernel, &content)?;
    assert!(step.effects.iter().any(|effect| matches!(
        effect,
        GameKernelEffectV7::Terminal(terminal) if terminal.reason == "VICTORY"
    )));
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::Complete)
    );
    assert_eq!(
        kernel
            .state()
            .and_then(|state| state.active_run.as_ref())
            .map(|run| run.outcome),
        Some(RunOutcome::Victory)
    );
    Ok(())
}

#[test]
fn natural_solo_battle_reaches_terminal_using_only_physical_keys() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = kernel(content.clone())?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    navigate_down_to(&mut kernel, "bootstrap/starter/confirm")?;

    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;

    let mut material_count = 1_usize;
    let mut terminal_seen = false;
    for _ in 0..100 {
        let kind = kernel
            .current_control()
            .map(|control| control.kind)
            .ok_or("active control is absent")?;
        let step = match kind {
            GameControlKindV2::BattleCommand => press(&mut kernel, PhysicalKey::Space)?,
            GameControlKindV2::BattleMove => {
                let menu = kernel
                    .current_control()
                    .and_then(|control| control.menu.as_ref())
                    .ok_or("move menu is absent")?;
                let state = kernel.state().ok_or("state is absent")?;
                let run = state.active_run.as_ref().ok_or("run is absent")?;
                let actor = run
                    .party
                    .iter()
                    .find(|pokemon| {
                        run.battle.as_ref().is_some_and(|battle| {
                            battle.field.slots.iter().any(|slot| {
                                slot.slot.side == er_types::battle_ids::BattleSide::Player
                                    && slot.occupant == Some(pokemon.id)
                            })
                        })
                    })
                    .ok_or("active player is absent")?;
                let target_option = menu
                    .options
                    .iter()
                    .filter_map(|option| {
                        let GameActionV1::Battle {
                            action: er_types::BattleUiActionV1::SelectMove { move_slot, .. },
                        } = option.action
                        else {
                            return None;
                        };
                        let move_id = actor.moves[usize::from(move_slot.get())]?.move_id;
                        let definition = content.battle.move_definition(move_id).ok()?;
                        let power = match definition.power {
                            er_types::battle_model::MovePower::None => 0,
                            er_types::battle_model::MovePower::Value(power) => power,
                        };
                        Some((power, option.option_id.clone()))
                    })
                    .max_by_key(|(power, _)| *power)
                    .map(|(_, option)| option)
                    .ok_or("no move option is available")?;
                navigate_down_to(&mut kernel, target_option.as_str())?;
                press(&mut kernel, PhysicalKey::Space)?
            }
            GameControlKindV2::Complete => {
                terminal_seen = true;
                break;
            }
            other => return Err(format!("unexpected solo control {other:?}").into()),
        };
        material_count += step
            .effects
            .iter()
            .filter(|effect| matches!(effect, GameKernelEffectV7::AuthorityMaterial { .. }))
            .count();
        terminal_seen |= step
            .effects
            .iter()
            .any(|effect| matches!(effect, GameKernelEffectV7::Terminal(_)));
        let pending = kernel.snapshot()?.pending_presentations;
        for presentation in pending {
            kernel.settle_presentation(presentation.event_id)?;
        }
        if terminal_seen {
            break;
        }
    }
    assert!(terminal_seen, "solo battle did not reach terminal");
    assert!(material_count > 1);
    assert!(kernel.snapshot()?.pending_presentations.is_empty());
    Ok(())
}
#[test]
fn authority_ai_can_choose_a_legal_enemy_switch() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = kernel(content.clone())?;
    complete_natural_start(&mut kernel)?;
    let mut snapshot = kernel.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut snapshot.lifecycle else {
        return Err("natural run snapshot is not active".into());
    };
    let run = state.active_run.as_mut().ok_or("run missing")?;
    let battle = run.battle.as_mut().ok_or("battle missing")?;
    let active_id = battle.enemy_party[0].id;
    for slot in battle.enemy_party[0].moves.iter_mut().flatten() {
        slot.pp_used = content.battle.move_definition(slot.move_id)?.base_pp;
    }
    let mut bench = battle.enemy_party[0].clone();
    bench.id = state.identities.allocate_pokemon_id()?;
    let bench_id = bench.id;
    battle.enemy_party.push(bench);
    assert_eq!(battle.enemy_party[1].id, bench_id);
    kernel = controlled_active_fixture(snapshot, content)?;
    let commands = kernel.prepare_authority_ai_commands()?;
    assert_eq!(commands.len(), 1);
    let er_types::battle_command::AcceptedBattleCommand::ScriptedEnemy { command, .. } =
        &commands[0]
    else {
        return Err("AI command is not scripted enemy authority".into());
    };
    assert_eq!(command.actor, active_id);
    assert!(matches!(
        command.command,
        er_types::battle_command::BattleCommand::Switch { party_slot, .. }
            if party_slot.get() == 1
    ));
    Ok(())
}

#[test]
fn held_action_cannot_cross_bootstrap_menu_instance() -> Result<(), Box<dyn Error>> {
    let mut kernel = kernel(content()?)?;
    kernel.raw_input(key_down(PhysicalKey::Space))?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::ModeSelect)
    );
    let repeated = kernel.raw_input(key_down(PhysicalKey::Space))?;
    assert!(repeated.effects.is_empty());
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::ModeSelect)
    );
    kernel.raw_input(RawInputEvent::KeyUp {
        code: PhysicalKey::Space,
    })?;
    Ok(())
}

struct ReadRebindFixture {
    content: Arc<PreparedGameContentV2>,
    saved: GameSaveV2,
    bytes: Vec<u8>,
    pending: CoreGameKernelSnapshotV7,
    request: PlatformRequestId,
    natural: CoreGameKernelSnapshotV7,
    write_pending: PendingPlatformRequestV2,
    preload_control: GameControlPlanV2,
}

fn restore_read_fixture(
    snapshot: CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<GameKernelV7, Box<dyn Error>> {
    Ok(GameKernelV7::from_snapshot(
        snapshot,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
    )?)
}

fn controlled_read_save_menu(
    natural: &CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
    action: SaveActionV1,
    menu: u64,
    revision: u64,
    platform: u64,
) -> Result<GameKernelV7, Box<dyn Error>> {
    let GameKernelLifecycleSnapshotV7::Active(mut state) = natural.lifecycle.clone() else {
        return Err("natural source is not active".into());
    };
    state.identities.next_platform_request_id = state
        .identities
        .next_platform_request_id
        .max(safe(platform));
    state
        .active_run
        .as_mut()
        .ok_or("natural run absent")?
        .control = generic_vertical_control_v2(
        MenuInstanceId::new(safe(menu)),
        safe(revision),
        SeatId::new(safe(1)),
        OperationId::new(format!("read-rebind/controlled/{menu}"))?,
        GameControlKindV2::Save,
        "read-rebind/controlled-save",
        &[
            ("save/action".to_owned(), GameActionV1::Save { action }),
            (
                "save/cancel".to_owned(),
                GameActionV1::Save {
                    action: SaveActionV1::Cancel,
                },
            ),
        ],
        GameMenuCancelV2::Back {
            action: Box::new(GameActionV1::Save {
                action: SaveActionV1::Cancel,
            }),
        },
    )?;
    // Fresh, explicitly controlled Save boundary; never rewrite the natural ledger.
    Ok(GameKernelV7::from_active(
        state,
        safe(revision),
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
        natural.input_router.clone(),
        natural.scheduler.clone(),
        None,
    )?)
}

fn read_rebind_fixture() -> Result<ReadRebindFixture, Box<dyn Error>> {
    let content = content()?;
    let mut natural = kernel(content.clone())?;
    complete_natural_start(&mut natural)?;
    for pending in natural.snapshot()?.pending_presentations {
        natural.settle_presentation(pending.event_id)?;
    }
    let natural = natural.snapshot()?;
    let mut writer = controlled_read_save_menu(
        &natural,
        content.clone(),
        SaveActionV1::Write {
            slot: "read-rebind-slot".to_owned(),
        },
        30,
        10,
        1,
    )?;
    let bytes = press(&mut writer, PhysicalKey::Space)?
        .effects
        .into_iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageWrite {
                bytes,
                generation,
                ..
            }) => {
                assert_eq!(generation, safe(1));
                Some(bytes)
            }
            _ => None,
        })
        .ok_or("actual Save emitted no bytes")?;
    let saved = GameSaveV2::decode(&bytes)?;
    let write_pending = writer
        .snapshot()?
        .pending_platform
        .into_iter()
        .next()
        .ok_or("actual Write owner absent")?;
    let mut loader = controlled_read_save_menu(
        &natural,
        content.clone(),
        SaveActionV1::Load {
            slot: "read-rebind-slot".to_owned(),
        },
        80,
        20,
        40,
    )?;
    let preload_control = loader
        .current_control()
        .ok_or("Load control absent")?
        .clone();
    // Keep the actual initiating key held across the asynchronous READ.
    let request = loader
        .raw_input(key_down(PhysicalKey::Space))?
        .effects
        .into_iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageRead { request, .. }) => {
                Some(request)
            }
            _ => None,
        })
        .ok_or("actual Load emitted no READ")?;
    let pending = loader.snapshot()?;
    assert!(!pending.input_router.pressed.is_empty());
    assert_eq!(pending.pending_platform.len(), 1);
    assert_eq!(pending.pending_presentations.len(), 1);
    Ok(ReadRebindFixture {
        content,
        saved,
        bytes,
        pending,
        request,
        natural,
        write_pending,
        preload_control,
    })
}

fn accept_read(
    loader: &mut GameKernelV7,
    request: PlatformRequestId,
    bytes: &[u8],
) -> Result<GameKernelStepV7, Box<dyn Error>> {
    Ok(loader.apply_storage_result(
        request,
        KernelStorageResultV2::Read {
            bytes: Some(bytes.to_vec()),
        },
    )?)
}

#[test]
fn read_rebind_preserves_saved_semantics_and_executes_write_after_restore()
-> Result<(), Box<dyn Error>> {
    let fixture = read_rebind_fixture()?;
    let mut loader = restore_read_fixture(fixture.pending.clone(), fixture.content.clone())?;
    let step = accept_read(&mut loader, fixture.request, &fixture.bytes)?;
    let loaded = loader.snapshot()?;
    let mut expected_state = fixture.saved.state.clone();
    let GameKernelLifecycleSnapshotV7::Active(live_state) = &fixture.pending.lifecycle else {
        return Err("pending READ is not active".into());
    };
    expected_state.identities.next_platform_request_id =
        live_state.identities.next_platform_request_id;
    assert!(
        live_state.identities.next_platform_request_id
            > fixture.saved.state.identities.next_platform_request_id
    );
    let revision = fixture.pending.material_ledger.next_authority_revision;
    let instance = fixture.pending.next_menu_instance_id;
    let expected_control = &mut expected_state
        .active_run
        .as_mut()
        .ok_or("saved run absent")?
        .control;
    expected_control.revision = revision;
    expected_control
        .menu
        .as_mut()
        .ok_or("saved menu absent")?
        .instance_id = instance;
    let context = expected_control
        .action_context
        .as_mut()
        .ok_or("saved context absent")?;
    context.authority_revision = revision;
    context.menu_instance = instance;
    let expected_control = expected_control.clone();
    let mut expected = fixture.pending.clone();
    expected.lifecycle = GameKernelLifecycleSnapshotV7::Active(expected_state);
    expected.material_ledger = AppliedGameMaterialLedgerV1::new(revision)?;
    expected.next_menu_instance_id = MenuInstanceId::new(safe(instance.get().get() + 1));
    expected.pending_platform.clear();
    expected.storage_frontiers = vec![StorageFrontierSnapshotV1 {
        slot: "read-rebind-slot".to_owned(),
        generation: safe(1),
    }];
    expected.replay_sequence = safe(expected.replay_sequence.get() + 1);
    expected.input_router.pressed.clear();
    expected.input_router.held_buttons.clear();
    expected.input_router.locks.clear();
    assert_eq!(loaded, expected);
    assert_eq!(
        step.effects,
        vec![GameKernelEffectV7::UiChanged(expected_control)]
    );
    assert!(step.internal_events.is_empty());
    assert!(
        loader
            .raw_input(RawInputEvent::KeyUp {
                code: PhysicalKey::Space
            })?
            .effects
            .is_empty()
    );
    assert_eq!(loader.snapshot()?, loaded);
    let mut restored = restore_read_fixture(
        serde_json::from_slice(&serde_json::to_vec(&loaded)?)?,
        fixture.content.clone(),
    )?;
    for pending in loaded.pending_presentations {
        loader.settle_presentation(pending.event_id)?;
        restored.settle_presentation(pending.event_id)?;
    }
    assert_eq!(loader.snapshot()?, restored.snapshot()?);
    let next = press(&mut loader, PhysicalKey::Space)?;
    assert_eq!(next, press(&mut restored, PhysicalKey::Space)?);
    assert_eq!(loader.snapshot()?, restored.snapshot()?);
    let next_presentation = next
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::Presentation(value) => Some(value.event_id),
            _ => None,
        })
        .ok_or("post-load Write presentation absent")?;
    assert_eq!(next_presentation.get(), revision);
    assert!(
        fixture
            .pending
            .pending_presentations
            .iter()
            .all(|pending| pending.event_id < next_presentation)
    );
    let (request, bytes) = next
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageWrite {
                request,
                slot,
                generation,
                bytes,
            }) => {
                assert_eq!(slot, "read-rebind-slot");
                assert_eq!(*generation, safe(2));
                Some((*request, bytes))
            }
            _ => None,
        })
        .ok_or("post-load raw Write did not execute")?;
    assert!(request > fixture.request);
    let written = GameSaveV2::decode(bytes)?;
    assert_eq!(written.generation, safe(2));
    written.state.validate_with(fixture.content.as_ref())?;
    loader.apply_storage_result(request, KernelStorageResultV2::Written)?;
    assert_eq!(loader.snapshot()?.storage_frontiers[0].generation, safe(2));
    let after = loader.snapshot()?;
    assert!(
        loader
            .apply_storage_result(
                fixture.request,
                KernelStorageResultV2::Read {
                    bytes: Some(fixture.bytes)
                }
            )
            .is_err()
    );
    assert_eq!(loader.snapshot()?, after);
    Ok(())
}

#[test]
fn read_rebind_rejects_stale_action_context_and_preserves_canonical_battle_root()
-> Result<(), Box<dyn Error>> {
    let fixture = read_rebind_fixture()?;
    let mut loader = restore_read_fixture(fixture.pending.clone(), fixture.content.clone())?;
    accept_read(&mut loader, fixture.request, &fixture.bytes)?;
    let loaded = loader.snapshot()?;
    let state = loader.state().ok_or("loaded state absent")?.clone();
    let mut runtime = GameRuntimeV6::new(
        Some(state),
        fixture.content.clone(),
        loaded.material_ledger.next_authority_revision,
    )?;
    let old_control = &fixture
        .saved
        .state
        .active_run
        .as_ref()
        .ok_or("saved run absent")?
        .control;
    let before = runtime.snapshot();
    for control in [old_control, &fixture.preload_control] {
        let old_action = control
            .menu
            .as_ref()
            .ok_or("old menu absent")?
            .selected_action()
            .ok_or("old action absent")?
            .clone();
        let input = if matches!(
            &old_action,
            GameActionV1::Save {
                action: SaveActionV1::Write { .. }
            }
        ) {
            GameDomainExecutionInputV1::SaveGeneration(safe(2))
        } else {
            GameDomainExecutionInputV1::None
        };
        for update_revision in [false, true] {
            let mut stale = control.action_context.clone().ok_or("old context absent")?;
            if update_revision {
                stale.authority_revision = loaded.material_ledger.next_authority_revision;
            }
            assert!(
                runtime
                    .execute(
                        old_action.clone(),
                        GameActionDispatchContextV1 {
                            action: stale,
                            input: input.clone(),
                            authority: true,
                        }
                    )
                    .is_err()
            );
            assert_eq!(runtime.snapshot(), before);
        }
    }

    let GameKernelLifecycleSnapshotV7::Active(battle_state) = fixture.natural.lifecycle else {
        return Err("natural battle absent".into());
    };
    let original_control = battle_state
        .active_run
        .as_ref()
        .ok_or("natural run absent")?
        .control
        .clone();
    // Canonical natural battle state in a real encoded save; no private leaf/root fabrication.
    let battle_save = GameSaveV2::new(fixture.content.identity().clone(), safe(1), battle_state)?;
    let mut battle = restore_read_fixture(fixture.pending.clone(), fixture.content.clone())?;
    accept_read(&mut battle, fixture.request, &battle_save.encode()?)?;
    let rebound = battle
        .current_control()
        .ok_or("battle control absent")?
        .clone();
    assert_eq!(
        rebound
            .action_context
            .as_ref()
            .map(|context| &context.operation_id),
        original_control
            .action_context
            .as_ref()
            .map(|context| &context.operation_id)
    );
    assert!(
        rebound
            .menu
            .as_ref()
            .ok_or("rebound menu absent")?
            .instance_id
            > original_control
                .menu
                .as_ref()
                .ok_or("old menu absent")?
                .instance_id
    );
    for pending in battle.snapshot()?.pending_presentations {
        battle.settle_presentation(pending.event_id)?;
    }
    press(&mut battle, PhysicalKey::Space)?;
    assert_eq!(
        battle.current_control().map(|control| control.kind),
        Some(GameControlKindV2::BattleMove)
    );
    let leaf = battle.snapshot()?;
    assert_eq!(
        leaf.private_battle_control
            .as_ref()
            .map(|owner| &owner.canonical_control),
        Some(&rebound)
    );
    leaf.validate(fixture.content.as_ref())?;
    let private_save = GameSaveV2::new(
        fixture.content.identity().clone(),
        safe(1),
        battle.state().ok_or("private state absent")?.clone(),
    )?;
    let mut rejected = restore_read_fixture(fixture.pending.clone(), fixture.content.clone())?;
    assert!(accept_read(&mut rejected, fixture.request, &private_save.encode()?).is_err());
    assert_eq!(rejected.snapshot()?, fixture.pending);
    Ok(())
}

#[test]
fn read_rebind_rolls_back_menu_revision_presentation_and_replay_exhaustion()
-> Result<(), Box<dyn Error>> {
    let fixture = read_rebind_fixture()?;
    for case in 0..5 {
        let mut pending = fixture.pending.clone();
        let mut saved = fixture.saved.state.clone();
        match case {
            0 => pending.next_menu_instance_id = MenuInstanceId::new(SafeU53::MAX),
            1 => {
                let control = &mut saved.active_run.as_mut().ok_or("saved run absent")?.control;
                control
                    .menu
                    .as_mut()
                    .ok_or("saved menu absent")?
                    .instance_id = MenuInstanceId::new(SafeU53::MAX);
                control
                    .action_context
                    .as_mut()
                    .ok_or("saved context absent")?
                    .menu_instance = MenuInstanceId::new(SafeU53::MAX);
            }
            2 => {
                let control = &mut saved.active_run.as_mut().ok_or("saved run absent")?.control;
                control.revision = SafeU53::MAX;
                control
                    .action_context
                    .as_mut()
                    .ok_or("saved context absent")?
                    .authority_revision = SafeU53::MAX;
            }
            3 => pending.pending_presentations[0].event_id = PresentationEventId::new(SafeU53::MAX),
            _ => pending.replay_sequence = SafeU53::MAX,
        }
        let bytes =
            GameSaveV2::new(fixture.content.identity().clone(), safe(1), saved)?.encode()?;
        let mut loader = restore_read_fixture(pending.clone(), fixture.content.clone())?;
        assert!(
            accept_read(&mut loader, fixture.request, &bytes).is_err(),
            "case {case}"
        );
        assert_eq!(loader.snapshot()?, pending, "case {case}");
    }
    Ok(())
}

#[test]
fn read_rebind_keeps_larger_saved_floors_and_no_active_run_behavior() -> Result<(), Box<dyn Error>>
{
    let fixture = read_rebind_fixture()?;
    let mut state = fixture.saved.state.clone();
    state.identities.next_platform_request_id = safe(500);
    let control = &mut state.active_run.as_mut().ok_or("saved run absent")?.control;
    control
        .menu
        .as_mut()
        .ok_or("saved menu absent")?
        .instance_id = MenuInstanceId::new(safe(600));
    control
        .action_context
        .as_mut()
        .ok_or("saved context absent")?
        .menu_instance = MenuInstanceId::new(safe(600));
    let mut pending = fixture.pending.clone();
    pending.pending_presentations[0].event_id = PresentationEventId::new(safe(700));
    let bytes = GameSaveV2::new(fixture.content.identity().clone(), safe(1), state)?.encode()?;
    let mut loader = restore_read_fixture(pending.clone(), fixture.content.clone())?;
    accept_read(&mut loader, fixture.request, &bytes)?;
    let loaded = loader.snapshot()?;
    assert_eq!(
        loader
            .state()
            .ok_or("loaded state absent")?
            .identities
            .next_platform_request_id,
        safe(500)
    );
    assert_eq!(loaded.next_menu_instance_id, MenuInstanceId::new(safe(602)));
    assert_eq!(
        loader.current_control().map(|control| control.revision),
        Some(safe(701))
    );
    assert_eq!(loaded.pending_presentations, pending.pending_presentations);

    let mut no_run = fixture.saved.state;
    no_run.active_run = None;
    let bytes =
        GameSaveV2::new(fixture.content.identity().clone(), safe(1), no_run.clone())?.encode()?;
    let mut loader = restore_read_fixture(fixture.pending.clone(), fixture.content.clone())?;
    let step = accept_read(&mut loader, fixture.request, &bytes)?;
    let loaded = loader.snapshot()?;
    assert!(loader.current_control().is_none());
    assert!(step.effects.is_empty());
    no_run.identities.next_platform_request_id = loader
        .state()
        .ok_or("loaded profile state absent")?
        .identities
        .next_platform_request_id;
    assert_eq!(loader.state(), Some(&no_run));
    assert!(no_run.identities.next_platform_request_id > fixture.request.get());
    assert_eq!(
        loaded.next_menu_instance_id,
        fixture.pending.next_menu_instance_id
    );
    assert_eq!(
        loaded.pending_presentations,
        fixture.pending.pending_presentations
    );
    loaded.validate(fixture.content.as_ref())?;
    Ok(())
}

#[test]
fn read_rebind_clears_real_repeat_ownership_without_cancelling_unrelated_work()
-> Result<(), Box<dyn Error>> {
    let fixture = read_rebind_fixture()?;
    let GameKernelLifecycleSnapshotV7::Active(mut state) = fixture.natural.lifecycle.clone() else {
        return Err("natural run absent".into());
    };
    state.identities.next_platform_request_id = safe(fixture.request.get().get() + 1);
    let revision = state
        .active_run
        .as_ref()
        .ok_or("run absent")?
        .control
        .revision;
    // Explicit concurrent-owner fixture: retain the exact emitted WRITE and READ,
    // but start a fresh canonical BattleCommand boundary with no presentation block.
    let source = GameKernelV7::from_active(
        state,
        revision,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        fixture.content.clone(),
        fixture.natural.input_router.clone(),
        fixture.natural.scheduler.clone(),
        None,
    )?;
    let mut source = source.snapshot()?;
    source.pending_platform = vec![
        fixture.write_pending.clone(),
        fixture.pending.pending_platform[0].clone(),
    ];
    source
        .pending_platform
        .sort_by_key(|pending| pending.request_id);
    let mut source = restore_read_fixture(source, fixture.content.clone())?;
    source.raw_input(key_down(PhysicalKey::ArrowDown))?;
    let mut before = source.snapshot()?;
    assert_eq!(before.input_router.repeats.len(), 1);
    let mut unrelated = before.scheduler.timers[0].clone();
    unrelated.registration.timer_id = TimerId::new(safe(100));
    unrelated.registration.owner.owner_id = "read-rebind-external-owner".to_owned();
    unrelated.registration.owner.reason = "not-a-navigation-repeat".to_owned();
    unrelated.registration.time_class = TimeClass::Absolute;
    unrelated.registration.delay_ms = safe(1000);
    unrelated.original_delay_ms = safe(1000);
    unrelated.remaining_active_ms = safe(1000);
    before.scheduler.timers.push(unrelated.clone());
    before.scheduler.next_timer_id = Some(safe(101));
    let mut exhausted = before.clone();
    exhausted.replay_sequence = SafeU53::MAX;
    let mut rejected = restore_read_fixture(exhausted.clone(), fixture.content.clone())?;
    assert!(accept_read(&mut rejected, fixture.request, &fixture.bytes).is_err());
    assert_eq!(rejected.snapshot()?, exhausted);
    let mut loader = restore_read_fixture(before.clone(), fixture.content.clone())?;
    accept_read(&mut loader, fixture.request, &fixture.bytes)?;
    let after = loader.snapshot()?;
    assert!(after.input_router.pressed.is_empty());
    assert!(after.input_router.held_buttons.is_empty());
    assert!(after.input_router.locks.is_empty());
    assert!(after.input_router.repeats.is_empty());
    let mut expected_scheduler = before.scheduler;
    expected_scheduler.timers = vec![unrelated];
    assert_eq!(after.scheduler, expected_scheduler);
    assert_eq!(after.pending_platform, vec![fixture.write_pending]);
    assert!(
        loader
            .raw_input(RawInputEvent::KeyUp {
                code: PhysicalKey::ArrowDown
            })?
            .effects
            .is_empty()
    );
    assert_eq!(loader.snapshot()?, after);
    let selected = loader.current_control().cloned();
    assert!(loader.advance_time(safe(500))?.effects.is_empty());
    assert_eq!(loader.current_control().cloned(), selected);
    Ok(())
}

#[test]
fn gamepad_buttons_drive_bootstrap_and_active_controls() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = kernel(content.clone())?;
    gamepad_press(&mut kernel, 0)?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::ModeSelect)
    );
    gamepad_press(&mut kernel, 0)?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::StarterSelect)
    );
    gamepad_press(&mut kernel, 0)?;
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1)
        .ok_or("starter menu missing")?;
    for _ in 0..bound {
        if kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == "bootstrap/starter/confirm")
        {
            break;
        }
        gamepad_press(&mut kernel, 13)?;
    }
    gamepad_press(&mut kernel, 0)?;
    gamepad_press(&mut kernel, 0)?;
    gamepad_press(&mut kernel, 0)?;
    gamepad_press(&mut kernel, 0)?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::BattleCommand)
    );
    gamepad_press(&mut kernel, 0)?;
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::BattleMove)
    );
    Ok(())
}
