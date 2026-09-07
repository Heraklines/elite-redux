use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, GameKernelStepV7, GameKernelV7};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameActionV1, GameControlKindV2, SafeU53, SeatId};

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
        "m9e-natural-campaign-200-v1".to_owned(),
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

fn replacement_checkpoint() -> Result<(GameKernelV7, Arc<PreparedGameContentV2>), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = kernel(content.clone())?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    let GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) = kernel.snapshot()?.lifecycle else {
        return Err("natural starter setup missing".into());
    };
    let mut remaining = bootstrap.catalog.maximum_starter_cost;
    let mut starters = Vec::new();
    for starter in &bootstrap.catalog.starters {
        if starter.cost <= remaining {
            remaining -= starter.cost;
            starters.push(starter.pokemon_id);
            if starters.len() == 3.min(bootstrap.catalog.maximum_starters) {
                break;
            }
        }
    }
    assert_eq!(
        starters.len(),
        3,
        "natural three-starter policy unavailable"
    );
    for starter in starters {
        navigate_down_to(&mut kernel, &format!("bootstrap/starter/{}", starter.get()))?;
        press(&mut kernel, PhysicalKey::Space)?;
    }
    navigate_down_to(&mut kernel, "bootstrap/starter/confirm")?;
    for _ in 0..4 {
        press(&mut kernel, PhysicalKey::Space)?;
    }
    for _ in 0..32 {
        for pending in kernel.snapshot()?.pending_presentations {
            kernel.settle_presentation(pending.event_id)?;
        }
        match kernel
            .current_control()
            .map(|control| control.kind)
            .ok_or("natural control absent")?
        {
            GameControlKindV2::BattleReplacement => return Ok((kernel, content)),
            GameControlKindV2::BattleCommand => {
                press(&mut kernel, PhysicalKey::Space)?;
            }
            GameControlKindV2::BattleMove => {
                submit_strongest_move(&mut kernel, &content)?;
            }
            other => return Err(format!("natural replacement setup reached {other:?}").into()),
        }
    }
    Err("natural replacement did not occur".into())
}

#[test]
fn natural_faint_offers_owned_reserves_restores_and_continues_raw_battle()
-> Result<(), Box<dyn Error>> {
    let (mut kernel, content) = replacement_checkpoint()?;
    let before = kernel.snapshot()?;
    let mut restored = GameKernelV7::from_snapshot(
        before.clone(),
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content.clone(),
    )?;
    let state = kernel.state().ok_or("natural state missing")?;
    let run = state.active_run.as_ref().ok_or("natural run missing")?;
    let battle = run.battle.as_ref().ok_or("natural battle missing")?;
    let menu = run
        .control
        .menu
        .as_ref()
        .ok_or("replacement menu missing")?;
    assert_eq!(run.control.owner_seat, Some(SeatId::new(safe(1))));
    assert_eq!(menu.options.len(), 2);
    let selected = menu
        .options
        .iter()
        .find(|option| option.option_id == menu.selected_option_id)
        .ok_or("selected replacement absent")?;
    let GameActionV1::Battle {
        action:
            er_types::BattleUiActionV1::SelectReplacement {
                occurrence,
                field,
                party_slot,
            },
    } = selected.action
    else {
        return Err("actual replacement action missing".into());
    };
    let selected_id = run.party[usize::from(party_slot.get())].id;
    let party = run.party.clone();
    let run_rng = run.run_rng.clone();
    let battle_rng = battle.battle_rng.clone();
    let turn = battle.turn;
    assert_eq!(
        press(&mut kernel, PhysicalKey::Space)?,
        press(&mut restored, PhysicalKey::Space)?
    );
    let after = kernel.snapshot()?;
    assert_eq!(after, restored.snapshot()?);
    assert_eq!(after.authority_ai, before.authority_ai);
    let run = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("replacement run missing")?;
    let battle = run.battle.as_ref().ok_or("replacement battle missing")?;
    assert_eq!(run.party, party);
    assert_eq!(run.run_rng, run_rng);
    assert_eq!(battle.battle_rng, battle_rng);
    assert_eq!(battle.turn, turn);
    assert!(
        battle
            .field
            .slots
            .iter()
            .any(|slot| slot.slot == field && slot.occupant == Some(selected_id))
    );
    assert!(battle.faint_queue.iter().any(|faint| faint.id == occurrence
        && faint.replacement == er_types::battle_model::ReplacementProgress::Applied));
    assert_eq!(run.control.kind, GameControlKindV2::BattleCommand);
    for peer in [&mut kernel, &mut restored] {
        for pending in peer.snapshot()?.pending_presentations {
            peer.settle_presentation(pending.event_id)?;
        }
        press(peer, PhysicalKey::Space)?;
        submit_strongest_move(peer, &content)?;
    }
    assert_eq!(kernel.snapshot()?, restored.snapshot()?);
    let advanced = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .and_then(|run| run.battle.as_ref())
        .ok_or("continued battle missing")?;
    assert!(
        advanced.turn > turn,
        "replacement could not submit a genuine next command"
    );
    Ok(())
}

#[test]
fn natural_replacement_rejects_wrong_receipt_field_and_fainted_party_choice()
-> Result<(), Box<dyn Error>> {
    use er_game::m9e_runtime_v6::{
        GameActionDispatchContextV1, GameActionDispatcherV1, GameDomainExecutionInputV1,
    };
    let (kernel, content) = replacement_checkpoint()?;
    let snapshot = kernel.snapshot()?;
    let state = kernel.state().ok_or("replacement state missing")?;
    let run = state.active_run.as_ref().ok_or("replacement run missing")?;
    let menu = run
        .control
        .menu
        .as_ref()
        .ok_or("replacement menu missing")?;
    let selected = menu
        .options
        .iter()
        .find(|option| option.option_id == menu.selected_option_id)
        .ok_or("replacement selection missing")?;
    let GameActionV1::Battle {
        action:
            er_types::BattleUiActionV1::SelectReplacement {
                occurrence,
                field,
                party_slot,
            },
    } = selected.action
    else {
        return Err("replacement action missing".into());
    };
    let context = GameActionDispatchContextV1 {
        action: run
            .control
            .action_context
            .clone()
            .ok_or("replacement action context missing")?,
        input: GameDomainExecutionInputV1::None,
        authority: true,
    };
    assert!(
        GameActionDispatcherV1::prepare(
            Some(state),
            &content,
            &snapshot.material_ledger,
            selected.action.clone(),
            context.clone()
        )
        .is_ok()
    );
    let mut wrong_field = field;
    wrong_field.side = er_types::battle_ids::BattleSide::Enemy;
    let bad = [
        (
            er_types::battle_ids::FaintOccurrenceId::new(safe(999)),
            field,
            party_slot,
        ),
        (occurrence, wrong_field, party_slot),
        (occurrence, field, er_types::battle_ids::PartyIndex::new(0)?),
        (occurrence, field, er_types::battle_ids::PartyIndex::new(3)?),
    ];
    for (occurrence, field, party_slot) in bad {
        let action = GameActionV1::Battle {
            action: er_types::BattleUiActionV1::SelectReplacement {
                occurrence,
                field,
                party_slot,
            },
        };
        assert!(
            GameActionDispatcherV1::prepare(
                Some(state),
                &content,
                &snapshot.material_ledger,
                action,
                context.clone()
            )
            .is_err()
        );
        assert_eq!(kernel.snapshot()?, snapshot);
    }
    Ok(())
}
