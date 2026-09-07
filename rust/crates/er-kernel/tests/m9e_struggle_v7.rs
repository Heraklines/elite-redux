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

fn exhausted_fixture(
    player: bool,
) -> Result<(GameKernelV7, Arc<PreparedGameContentV2>), Box<dyn Error>> {
    let content = content()?;
    let mut natural = kernel(content.clone())?;
    for _ in 0..3 {
        press(&mut natural, PhysicalKey::Space)?;
    }
    navigate_down_to(&mut natural, "bootstrap/starter/confirm")?;
    for _ in 0..4 {
        press(&mut natural, PhysicalKey::Space)?;
    }
    for pending in natural.snapshot()?.pending_presentations {
        natural.settle_presentation(pending.event_id)?;
    }
    let mut snapshot = natural.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut snapshot.lifecycle else {
        return Err("natural battle absent".into());
    };
    let run = state.active_run.as_mut().ok_or("run absent")?;
    let battle = run.battle.as_mut().ok_or("battle absent")?;
    assert_eq!(run.party.len(), 1);
    assert_eq!(battle.enemy_party.len(), 1);
    // Explicit constructed PP boundary, not a claim of natural battle history.
    for pokemon in run.party.iter_mut().chain(battle.enemy_party.iter_mut()) {
        pokemon.hp = 400;
        pokemon.max_hp = 400;
        pokemon.stats.hp = 400;
    }
    let actor = if player {
        &mut run.party[0]
    } else {
        &mut battle.enemy_party[0]
    };
    for slot in actor.moves.iter_mut().flatten() {
        let definition = content.battle.move_definition(slot.move_id)?;
        slot.pp_used = er_state::pokemon::calculate_max_pp(
            definition.base_pp,
            slot.pp_ups,
            slot.max_pp_override,
        )?;
    }
    let GameKernelLifecycleSnapshotV7::Active(state) = snapshot.lifecycle else {
        return Err("active fixture absent".into());
    };
    let actual = GameKernelV7::from_active(
        state,
        snapshot.material_ledger.next_authority_revision,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content.clone(),
        snapshot.input_router,
        snapshot.scheduler,
        snapshot.protocol,
    )?;
    actual.snapshot()?.validate(&content)?;
    Ok((actual, content))
}

fn restored(
    actual: &GameKernelV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<GameKernelV7, Box<dyn Error>> {
    Ok(GameKernelV7::from_snapshot(
        serde_json::from_slice(&serde_json::to_vec(&actual.snapshot()?)?)?,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
    )?)
}

fn raw_turn_and_replay(
    actual: &mut GameKernelV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<(), Box<dyn Error>> {
    let mut replay = restored(actual, content)?;
    for _ in 0..2 {
        assert_eq!(
            press(actual, PhysicalKey::Space)?,
            press(&mut replay, PhysicalKey::Space)?
        );
        assert_eq!(actual.snapshot()?, replay.snapshot()?);
    }
    Ok(())
}

#[test]
fn exhausted_player_struggle_is_typeless_preserves_pp_and_replays() -> Result<(), Box<dyn Error>> {
    let (mut actual, content) = exhausted_fixture(true)?;
    let before = actual.snapshot()?;
    let run = actual
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run absent")?;
    let battle = run.battle.as_ref().ok_or("battle absent")?;
    let source = battle
        .field
        .slots
        .iter()
        .find(|slot| slot.occupant == Some(run.party[0].id))
        .ok_or("source absent")?
        .slot;
    let target = battle
        .field
        .slots
        .iter()
        .find(|slot| slot.occupant == Some(battle.enemy_party[0].id))
        .ok_or("target absent")?
        .slot;
    let move_slot = er_types::battle_ids::MoveSlotIndex::new(0)?;
    let damage = er_battle::m7_resolver::query_simulated_move_damage_v5(
        &content.battle,
        run,
        source,
        move_slot,
        target,
    )?;
    assert!(damage > 0, "exhausted moves require Struggle damage");
    let mut ghost = run.clone();
    ghost.battle.as_mut().ok_or("battle absent")?.enemy_party[0].types =
        er_types::battle_model::PokemonTyping {
            primary: er_types::battle_model::PokemonType::Ghost,
            secondary: None,
        };
    assert_eq!(
        damage,
        er_battle::m7_resolver::query_simulated_move_damage_v5(
            &content.battle,
            &ghost,
            source,
            move_slot,
            target,
        )?,
        "Struggle must not use Normal type effectiveness"
    );
    assert_eq!(
        actual.snapshot()?,
        before,
        "damage queries changed the checkpoint"
    );
    let before_moves = run.party[0].moves;
    let before_turn = battle.turn;
    raw_turn_and_replay(&mut actual, content)?;
    let run = actual
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run absent")?;
    assert_eq!(
        run.party[0].moves, before_moves,
        "Struggle consumed normal move PP"
    );
    assert!(
        run.party[0].hp <= 300,
        "Struggle did not apply max-HP recoil"
    );
    let battle = run.battle.as_ref().ok_or("battle absent")?;
    assert!(
        battle.enemy_party[0].hp < 400,
        "Struggle did not damage the target"
    );
    assert!(
        battle.turn > before_turn,
        "exhaustion stalled the actual turn"
    );
    Ok(())
}

#[test]
fn exhausted_authority_ai_struggle_commits_once_and_replays() -> Result<(), Box<dyn Error>> {
    let (mut actual, content) = exhausted_fixture(false)?;
    let before = actual.snapshot()?;
    let mut choice = restored(&actual, content.clone())?;
    let commands = choice.prepare_authority_ai_commands()?;
    assert_eq!(commands.len(), 1, "exhausted enemy has no Struggle command");
    let mut expected = before.clone();
    expected
        .authority_ai
        .as_mut()
        .ok_or("AI owner absent")?
        .decision_sequence += 1;
    assert_eq!(
        choice.snapshot()?,
        expected,
        "AI fallback changed other owners or RNG"
    );
    let before_moves = actual
        .state()
        .and_then(|state| state.active_run.as_ref())
        .and_then(|run| run.battle.as_ref())
        .ok_or("battle absent")?
        .enemy_party[0]
        .moves;
    raw_turn_and_replay(&mut actual, content)?;
    assert_eq!(actual.snapshot()?.authority_ai, expected.authority_ai);
    let run = actual
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run absent")?;
    assert!(
        run.party[0].hp < 400,
        "AI Struggle did not damage its target"
    );
    let enemy = &run.battle.as_ref().ok_or("battle absent")?.enemy_party[0];
    assert_eq!(
        enemy.moves, before_moves,
        "AI Struggle consumed normal move PP"
    );
    assert!(enemy.hp <= 300, "AI Struggle did not apply max-HP recoil");
    Ok(())
}
