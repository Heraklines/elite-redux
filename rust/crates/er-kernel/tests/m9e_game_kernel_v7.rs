use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{
    GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameControlKindV2, SafeU53, SeatId};

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
        next_timer_id: None,
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
