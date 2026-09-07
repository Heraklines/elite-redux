use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelStepV7, GameKernelV7};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
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

/// One deterministic policy attempt from genuine empty Title setup. A loss,
/// unsupported handler, capacity failure, or shortened run is not completion.
#[test]
fn natural_current_campaign_reaches_policy_terminal_without_state_injection()
-> Result<(), Box<dyn Error>> {
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
    let mut maximum_wave = 0;
    let mut saw_reward = false;
    let mut saw_progression = false;
    for step_index in 0..20_000 {
        for pending in kernel.snapshot()?.pending_presentations {
            kernel.settle_presentation(pending.event_id)?;
        }
        let state = kernel.state().ok_or("current campaign state absent")?;
        let run = state
            .active_run
            .as_ref()
            .ok_or("current campaign run absent")?;
        let wave = run.wave.get().get();
        if wave > maximum_wave {
            assert_eq!(wave, maximum_wave + 1, "campaign skipped a natural wave");
            maximum_wave = wave;
        }
        if run.outcome != RunOutcome::InProgress {
            assert_eq!(wave, 200, "short campaign is not the full policy witness");
            assert_eq!(run.outcome, RunOutcome::Victory, "campaign did not win");
            assert!(
                saw_reward && saw_progression,
                "campaign bypassed progression or rewards"
            );
            assert_eq!(
                kernel.current_control().map(|control| control.kind),
                Some(GameControlKindV2::Complete)
            );
            kernel.snapshot()?.validate(&content)?;
            return Ok(());
        }
        let kind = kernel
            .current_control()
            .map(|control| control.kind)
            .ok_or("campaign control absent")?;
        let action = match kind {
            GameControlKindV2::BattleMove => submit_strongest_move(&mut kernel, &content),
            GameControlKindV2::BattleCommand
            | GameControlKindV2::BattleTarget
            | GameControlKindV2::BattleSwitch => press(&mut kernel, PhysicalKey::Space),
            GameControlKindV2::Progression
            | GameControlKindV2::MoveLearn
            | GameControlKindV2::Evolution => {
                saw_progression = true;
                press(&mut kernel, PhysicalKey::Space)
            }
            GameControlKindV2::Reward => {
                saw_reward = true;
                press(&mut kernel, PhysicalKey::Space)
            }
            other => return Err(format!(
                "unhandled natural campaign control {other:?} at wave={wave}, decision={step_index}"
            )
            .into()),
        };
        action.map_err(|error| format!("natural campaign failed at wave={wave}, decision={step_index}, control={kind:?}: {error}"))?;
    }
    Err(format!("natural campaign exhausted decision bound at wave={maximum_wave}").into())
}
