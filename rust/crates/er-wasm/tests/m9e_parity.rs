use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, GameKernelV7};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameActionV1, GameControlKindV2, SafeU53, SeatId};
use er_wasm::m9e_parity::{M9EParityEventV2, M9EParityRequestV1, replay_m9e_eventwise_native};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn profile() -> ProfileStateV1 {
    ProfileStateV1 {
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
            highest_wave: WaveIndex::new(safe(1)).expect("wave is valid"),
        },
        dex: DexState::default(),
    }
}

fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 {
        next_timer_id: None,
        timers: Vec::new(),
        pauses: Vec::new(),
        disposed: false,
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

fn apply_raw(
    kernel: &mut GameKernelV7,
    events: &mut Vec<M9EParityEventV2>,
    event: RawInputEvent,
) -> Result<(), Box<dyn Error>> {
    kernel.raw_input(event.clone())?;
    events.push(M9EParityEventV2::RawInput { event });
    Ok(())
}

fn settle_presentations(
    kernel: &mut GameKernelV7,
    events: &mut Vec<M9EParityEventV2>,
) -> Result<(), Box<dyn Error>> {
    let pending = kernel.snapshot()?.pending_presentations;
    for pending in pending {
        kernel.settle_presentation(pending.event_id)?;
        events.push(M9EParityEventV2::PresentationSettled {
            event_id: pending.event_id,
        });
    }
    Ok(())
}

fn press(
    kernel: &mut GameKernelV7,
    events: &mut Vec<M9EParityEventV2>,
    code: PhysicalKey,
) -> Result<(), Box<dyn Error>> {
    apply_raw(kernel, events, key_down(code.clone()))?;
    apply_raw(kernel, events, RawInputEvent::KeyUp { code })?;
    settle_presentations(kernel, events)
}

fn navigate_down_to(
    kernel: &mut GameKernelV7,
    events: &mut Vec<M9EParityEventV2>,
    option: &str,
) -> Result<(), Box<dyn Error>> {
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1)
        .ok_or("menu missing")?;
    for _ in 0..bound {
        if kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == option)
        {
            return Ok(());
        }
        press(kernel, events, PhysicalKey::ArrowDown)?;
    }
    Err(format!("option {option} is unreachable").into())
}

fn strongest_move_option(
    kernel: &GameKernelV7,
    content: &PreparedGameContentV2,
) -> Result<String, Box<dyn Error>> {
    let menu = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .ok_or("move menu missing")?;
    let state = kernel.state().ok_or("state missing")?;
    let run = state.active_run.as_ref().ok_or("run missing")?;
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
        .ok_or("player actor missing")?;
    menu.options
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
            Some((power, option.option_id.as_str().to_owned()))
        })
        .max_by_key(|(power, _)| *power)
        .map(|(_, option)| option)
        .ok_or_else(|| "strong move missing".into())
}

fn request() -> Result<M9EParityRequestV1, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle.clone()))?);
    let seat = SeatId::new(safe(1));
    let mut bootstrap = GameKernelV7::natural_start(
        profile(),
        "m9e-native-wasm-longitudinal".to_owned(),
        seat,
        vec!["m9e-parity-slot".to_owned()],
        true,
        content.clone(),
        scheduler(),
        None,
    )?;
    let mut ignored = Vec::new();
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    navigate_down_to(&mut bootstrap, &mut ignored, "bootstrap/starter/confirm")?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;
    press(&mut bootstrap, &mut ignored, PhysicalKey::Space)?;

    let mut snapshot = bootstrap.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut snapshot.lifecycle else {
        return Err("bootstrap snapshot is not active".into());
    };
    let run = state.active_run.as_mut().ok_or("run missing")?;
    let player = run.party.first_mut().ok_or("player missing")?;
    player.stats.hp = 10_000;
    player.stats.attack = 10_000;
    player.stats.defense = 10_000;
    player.stats.special_attack = 10_000;
    player.stats.special_defense = 10_000;
    player.stats.speed = 10_000;
    player.hp = 10_000;
    player.max_hp = 10_000;
    player.permanent_bonuses.hp = 9_000;
    player.permanent_bonuses.attack = 9_000;
    player.permanent_bonuses.defense = 9_000;
    player.permanent_bonuses.special_attack = 9_000;
    player.permanent_bonuses.special_defense = 9_000;
    player.permanent_bonuses.speed = 9_000;
    if let Some(enemy) = run
        .battle
        .as_mut()
        .and_then(|battle| battle.enemy_party.first_mut())
    {
        enemy.hp = 1;
        enemy.fainted = false;
    }
    snapshot.pending_presentations.clear();
    let initial_snapshot = snapshot.clone();
    let mut driver =
        GameKernelV7::from_snapshot(snapshot, seat, GameKernelRoleV7::Authority, content.clone())?;
    let mut events = Vec::new();
    for _ in 0..300 {
        let wave = driver
            .state()
            .and_then(|state| state.active_run.as_ref())
            .map(|run| run.wave.get().get())
            .ok_or("wave missing")?;
        if wave >= 3
            && driver.current_control().map(|control| control.kind)
                == Some(GameControlKindV2::BattleCommand)
        {
            break;
        }
        match driver
            .current_control()
            .map(|control| control.kind)
            .ok_or("control missing")?
        {
            GameControlKindV2::BattleCommand => {
                press(&mut driver, &mut events, PhysicalKey::Space)?;
            }
            GameControlKindV2::BattleMove => {
                let option = strongest_move_option(&driver, &content)?;
                navigate_down_to(&mut driver, &mut events, &option)?;
                press(&mut driver, &mut events, PhysicalKey::Space)?;
            }
            GameControlKindV2::Progression
            | GameControlKindV2::MoveLearn
            | GameControlKindV2::Evolution
            | GameControlKindV2::Reward => {
                press(&mut driver, &mut events, PhysicalKey::Space)?;
            }
            other => return Err(format!("longitudinal trace stalled at {other:?}").into()),
        }
    }
    assert!(
        driver
            .state()
            .and_then(|state| state.active_run.as_ref())
            .is_some_and(|run| run.wave.get().get() >= 3)
    );
    Ok(M9EParityRequestV1 {
        bundle,
        profile: profile(),
        seed: "unused-with-snapshot".to_owned(),
        local_seat: seat,
        role: GameKernelRoleV7::Authority,
        save_slots: Vec::new(),
        local_is_host: true,
        initial_snapshot: Some(initial_snapshot),
        events,
    })
}

fn assert_eventwise_parity_contract() -> Result<(), Box<dyn Error>> {
    let request = request()?;
    let event_count = request.events.len();
    let report = replay_m9e_eventwise_native(request)?;
    assert_eq!(report.observations.len(), event_count);
    assert!(
        report
            .observations
            .iter()
            .any(|item| { item.control_kind == Some(GameControlKindV2::Progression) })
    );
    assert!(
        report
            .observations
            .iter()
            .any(|item| item.control_kind == Some(GameControlKindV2::Reward))
    );
    assert!(
        report
            .observations
            .last()
            .and_then(|item| item.wave)
            .is_some_and(|wave| wave.get().get() >= 3)
    );
    for (index, observation) in report.observations.iter().enumerate() {
        assert_eq!(observation.sequence.get(), (index + 1) as u64);
        assert!(!observation.input_digest.is_empty());
        assert!(!observation.effect_digest.is_empty());
        assert!(!observation.internal_event_digest.is_empty());
        assert!(!observation.mechanical_state_digest.is_empty());
        assert!(!observation.kernel_determinism_digest.is_empty());
    }
    let report_digest = er_canonical::content_digest(&report)?;
    assert_eq!(
        report_digest,
        "ee3f694f9f766c2a8e730fbad3c81d533b0ce39dd97c7e673da3f67478cd584b"
    );
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn native_replays_v7_raw_inputs_eventwise() -> Result<(), Box<dyn Error>> {
    assert_eventwise_parity_contract()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm_replays_v7_raw_inputs_eventwise() -> Result<(), wasm_bindgen::JsValue> {
    assert_eventwise_parity_contract()
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
}
