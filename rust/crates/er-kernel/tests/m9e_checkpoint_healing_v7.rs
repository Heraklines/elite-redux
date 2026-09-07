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
    let battle = run.battle.as_ref().ok_or("battle is absent")?;
    let source_slot = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Player && slot.occupant.is_some()
        })
        .ok_or("player field is absent")?
        .slot;
    let target_slot = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Enemy && slot.occupant.is_some()
        })
        .ok_or("enemy field is absent")?
        .slot;
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
            let damage = er_battle::m7_resolver::query_simulated_move_damage_v5(
                &content.battle,
                run,
                source_slot,
                move_slot,
                target_slot,
            )
            .ok()?;
            Some((damage, option.option_id.clone()))
        })
        .max_by_key(|(damage, _)| *damage)
        .map(|(_, option)| option)
        .ok_or("no move option is available")?;
    navigate_down_to(kernel, target_option.as_str())?;
    press(kernel, PhysicalKey::Space)
}

fn progression_checkpoint() -> Result<(GameKernelV7, Arc<PreparedGameContentV2>), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = kernel(content.clone())?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    let GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) = kernel.snapshot()?.lifecycle else {
        return Err("natural starter setup missing".into());
    };
    let mut remaining = bootstrap.catalog.maximum_starter_cost;
    let mut starters = Vec::new();
    let mut choices = bootstrap.catalog.starters.iter().collect::<Vec<_>>();
    choices.sort_by_key(|starter| (starter.cost, starter.pokemon_id));
    for starter in choices {
        if starter.cost <= remaining {
            remaining -= starter.cost;
            starters.push(starter.pokemon_id);
            if starters.len() == 6.min(bootstrap.catalog.maximum_starters) {
                break;
            }
        }
    }
    assert_eq!(starters.len(), 6, "natural six-starter policy unavailable");
    for starter in starters {
        navigate_down_to(&mut kernel, &format!("bootstrap/starter/{}", starter.get()))?;
        press(&mut kernel, PhysicalKey::Space)?;
    }
    navigate_down_to(&mut kernel, "bootstrap/starter/confirm")?;
    for _ in 0..4 {
        press(&mut kernel, PhysicalKey::Space)?;
    }
    for _ in 0..400 {
        for pending in kernel.snapshot()?.pending_presentations {
            kernel.settle_presentation(pending.event_id)?;
        }
        match kernel.current_control().map(|control| control.kind) {
            Some(GameControlKindV2::Progression) => return Ok((kernel, content)),
            Some(GameControlKindV2::BattleCommand | GameControlKindV2::BattleReplacement) => {
                press(&mut kernel, PhysicalKey::Space)?;
            }
            Some(GameControlKindV2::BattleMove) => {
                submit_strongest_move(&mut kernel, &content)?;
            }
            other => return Err(format!("natural progression setup reached {other:?}").into()),
        }
    }
    Err("natural first victory exceeded decision bound".into())
}

/// Constructed wave-boundary scenario: natural first victory and earned XP,
/// then an explicit wave/status fixture. This is not a full natural campaign.
fn checkpoint(wave: u64) -> Result<(GameKernelV7, Arc<PreparedGameContentV2>), Box<dyn Error>> {
    let (mut kernel, content) = progression_checkpoint()?;
    for _ in 0..32 {
        for pending in kernel.snapshot()?.pending_presentations {
            kernel.settle_presentation(pending.event_id)?;
        }
        if kernel.current_control().map(|control| control.kind) == Some(GameControlKindV2::Reward) {
            break;
        }
        press(&mut kernel, PhysicalKey::Space)?;
    }
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::Reward)
    );
    for pending in kernel.snapshot()?.pending_presentations {
        kernel.settle_presentation(pending.event_id)?;
    }
    let snapshot = kernel.snapshot()?;
    let mut state = kernel.state().ok_or("state absent")?.clone();
    let run = state.active_run.as_mut().ok_or("run absent")?;
    run.wave = WaveIndex::new(safe(wave))?;
    run.battle.as_mut().ok_or("battle absent")?.wave = run.wave;
    assert!(run.party.iter().any(|pokemon| pokemon.fainted));
    for pokemon in &mut run.party {
        if !pokemon.fainted {
            pokemon.hp = 1;
            pokemon.status = er_types::battle_model::StatusState {
                kind: er_types::battle_model::StatusKind::Burn,
                toxic_turn_count: 0,
                sleep_turns_remaining: None,
            };
        }
        for slot in pokemon.moves.iter_mut().flatten() {
            slot.pp_used = 1;
        }
    }
    let revision = safe(run.control.revision.get() + 1);
    state.validate_with(content.as_ref())?;
    let kernel = GameKernelV7::from_active(
        state,
        revision,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content.clone(),
        snapshot.input_router,
        snapshot.scheduler,
        None,
    )?;
    Ok((kernel, content))
}

#[test]
fn raw_checkpoint_reward_restores_party_and_replays_from_snapshot() -> Result<(), Box<dyn Error>> {
    let (mut kernel, content) = checkpoint(10)?;
    navigate_down_to(&mut kernel, "reward/decline")?;
    let snapshot = kernel.snapshot()?;
    let before = kernel.state().ok_or("state absent")?.clone();
    let mut restored = GameKernelV7::from_snapshot(
        snapshot,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content.clone(),
    )?;
    assert_eq!(
        press(&mut kernel, PhysicalKey::Space)?,
        press(&mut restored, PhysicalKey::Space)?
    );
    assert_eq!(kernel.snapshot()?, restored.snapshot()?);
    let run = kernel
        .state()
        .ok_or("state absent")?
        .active_run
        .as_ref()
        .ok_or("run absent")?;
    assert_eq!(run.wave.get().get(), 11);
    for (old, pokemon) in before
        .active_run
        .as_ref()
        .ok_or("old run absent")?
        .party
        .iter()
        .zip(&run.party)
    {
        assert_eq!(pokemon.hp, pokemon.max_hp, "checkpoint did not restore HP");
        assert!(
            !pokemon.fainted,
            "default checkpoint did not revive the party"
        );
        assert_eq!(
            pokemon.status.kind,
            er_types::battle_model::StatusKind::None
        );
        assert_eq!(pokemon.status.toxic_turn_count, 0);
        assert_eq!(pokemon.status.sleep_turns_remaining, None);
        assert!(pokemon.moves.iter().flatten().all(|slot| slot.pp_used == 0));
        let mut expected = old.clone();
        expected.hp = old.max_hp;
        expected.fainted = false;
        expected.status = pokemon.status;
        for slot in expected.moves.iter_mut().flatten() {
            slot.pp_used = 0;
        }
        assert_eq!(
            pokemon, &expected,
            "checkpoint changed unrelated persistent data"
        );
    }
    kernel.snapshot()?.validate(content.as_ref())?;
    Ok(())
}

#[test]
fn ordinary_wave_reward_preserves_damage_status_and_used_pp() -> Result<(), Box<dyn Error>> {
    let (mut kernel, content) = checkpoint(9)?;
    let before = kernel
        .state()
        .ok_or("state absent")?
        .active_run
        .as_ref()
        .ok_or("run absent")?
        .party
        .clone();
    navigate_down_to(&mut kernel, "reward/decline")?;
    press(&mut kernel, PhysicalKey::Space)?;
    let run = kernel
        .state()
        .ok_or("state absent")?
        .active_run
        .as_ref()
        .ok_or("run absent")?;
    assert_eq!(run.wave.get().get(), 10);
    assert_eq!(run.party, before, "ordinary wave granted a free restore");
    kernel.snapshot()?.validate(content.as_ref())?;
    Ok(())
}
