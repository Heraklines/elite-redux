use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{
    CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7, SnapshotV7Error,
};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::battle_model::BattleOutcome;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameActionV1, GameControlKindV2, RunOutcome, SafeU53, SeatId};

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
