use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, GameKernelV7};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::{BattleSide, WaveIndex};
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{SafeU53, SeatId};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("controlled safe identity")
}

fn content() -> Result<Arc<PreparedGameContentV2>, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
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

fn press(kernel: &mut GameKernelV7, code: PhysicalKey) -> Result<(), Box<dyn Error>> {
    kernel.raw_input(RawInputEvent::KeyDown {
        code: code.clone(),
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    })?;
    kernel.raw_input(RawInputEvent::KeyUp { code })?;
    Ok(())
}

fn navigate_down(kernel: &mut GameKernelV7, option: &str) -> Result<(), Box<dyn Error>> {
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
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    Err("raw menu target unreachable".into())
}

fn actor_fixture(
    content: Arc<PreparedGameContentV2>,
    cooperative: bool,
) -> Result<GameKernelV7, Box<dyn Error>> {
    let mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| mode.supported && mode.cooperative == cooperative)
        .ok_or("supported mode missing")?;
    let mode_option = format!("bootstrap/mode/{}", mode.mode.get());
    let mut kernel = GameKernelV7::natural_start(
        profile()?,
        "m9e-ai-command-transaction".to_owned(),
        SeatId::new(safe(1)),
        vec!["ai-command-slot".to_owned()],
        true,
        content.clone(),
        KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        None,
    )?;
    // Start from the established raw constructor before controlled expansion.
    // It does not claim independent peer setup or source trainer provenance.
    press(&mut kernel, PhysicalKey::Space)?;
    navigate_down(&mut kernel, &mode_option)?;
    press(&mut kernel, PhysicalKey::Space)?;
    if cooperative {
        navigate_down(&mut kernel, "bootstrap/challenge/done")?;
        press(&mut kernel, PhysicalKey::Space)?;
    }
    press(&mut kernel, PhysicalKey::Space)?;
    navigate_down(&mut kernel, "bootstrap/starter/confirm")?;
    for _ in 0..4 {
        press(&mut kernel, PhysicalKey::Space)?;
    }
    if cooperative {
        let original = kernel.snapshot()?;
        let GameKernelLifecycleSnapshotV7::Active(mut state) = original.lifecycle else {
            return Err("active root missing before controlled expansion".into());
        };
        // Explicit controlled two-actor fixture, using the existing expansion
        // and a fresh ledger root. No peer handshake or natural history claim.
        er_game::m9e_new_run_v6::expand_cooperative_topology_v6(
            &mut state,
            content.as_ref(),
            SeatId::new(safe(2)),
        )?;
        kernel = GameKernelV7::from_active(
            state,
            original.material_ledger.next_authority_revision,
            SeatId::new(safe(1)),
            GameKernelRoleV7::Authority,
            content.clone(),
            original.input_router,
            original.scheduler,
            original.protocol,
        )?;
    }
    let snapshot = kernel.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &snapshot.lifecycle else {
        return Err("natural construction did not finish".into());
    };
    let battle = state
        .active_run
        .as_ref()
        .and_then(|run| run.battle.as_ref())
        .ok_or("battle missing")?;
    let actors = battle
        .field
        .slots
        .iter()
        .filter(|slot| slot.slot.side == BattleSide::Enemy && slot.occupant.is_some())
        .count();
    assert_eq!(actors, if cooperative { 2 } else { 1 });
    Ok(kernel)
}

fn restore(
    snapshot: CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<GameKernelV7, Box<dyn Error>> {
    snapshot.validate(&content)?;
    let kernel = GameKernelV7::from_snapshot(
        serde_json::from_slice(&serde_json::to_vec(&snapshot)?)?,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content,
    )?;
    assert_eq!(kernel.snapshot()?, snapshot);
    Ok(kernel)
}

#[test]
fn later_actor_rejection_preserves_the_complete_ai_command_owner() -> Result<(), Box<dyn Error>> {
    let content = content()?;
    let original = actor_fixture(content.clone(), true)?.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(mut state) = original.lifecycle else {
        return Err("active cooperative state missing".into());
    };
    let battle = state
        .active_run
        .as_mut()
        .and_then(|run| run.battle.as_mut())
        .ok_or("battle missing")?;
    let actors = battle
        .field
        .slots
        .iter()
        .filter(|slot| slot.slot.side == BattleSide::Enemy)
        .filter_map(|slot| slot.occupant)
        .collect::<Vec<_>>();
    assert_eq!(actors.len(), 2);
    assert_eq!(battle.enemy_party.len(), 2);
    let first = battle
        .enemy_party
        .iter()
        .find(|pokemon| pokemon.id == actors[0])
        .ok_or("first actor missing")?;
    assert!(first.moves.iter().flatten().next().is_some());
    // Explicitly controlled invalid-choice checkpoint: the second actor has no
    // legal move and both enemies are already active, so it cannot switch.
    battle
        .enemy_party
        .iter_mut()
        .find(|pokemon| pokemon.id == actors[1])
        .ok_or("second actor missing")?
        .moves = [None; 4];
    state.validate_with(content.as_ref())?;
    let mut kernel = GameKernelV7::from_active(
        state,
        original.material_ledger.next_authority_revision,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content.clone(),
        original.input_router,
        original.scheduler,
        original.protocol,
    )?;
    // A new controlled root does not forge or rewrite the natural material log.
    let before = kernel.snapshot()?;
    kernel = restore(before.clone(), content)?;
    assert!(kernel.prepare_authority_ai_commands().is_err());
    assert!(
        kernel.snapshot()? == before,
        "later-actor failure changed the full snapshot"
    );
    assert!(kernel.prepare_authority_ai_commands().is_err());
    assert!(
        kernel.snapshot()? == before,
        "repeated failure changed the full snapshot"
    );
    Ok(())
}

#[test]
fn command_cursor_rejection_preserves_ai_sequence_and_all_other_owners()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let original = actor_fixture(content.clone(), false)?.snapshot()?;
    let maximum = (1_u64 << 53) - 1;
    assert!(SafeU53::new(maximum).is_ok());
    assert!(SafeU53::new(maximum + 1).is_err());
    let mut boundary = original.clone();
    boundary
        .authority_ai
        .as_mut()
        .ok_or("AI owner missing")?
        .decision_sequence = maximum;
    let mut successful = restore(boundary, content.clone())?;
    assert_eq!(successful.prepare_authority_ai_commands()?.len(), 1);
    assert_eq!(
        successful
            .snapshot()?
            .authority_ai
            .ok_or("AI owner missing")?
            .decision_sequence,
        maximum + 1
    );
    let mut exhausted = original;
    exhausted
        .authority_ai
        .as_mut()
        .ok_or("AI owner missing")?
        .decision_sequence = maximum + 1;
    let mut kernel = restore(exhausted.clone(), content)?;
    assert!(kernel.prepare_authority_ai_commands().is_err());
    assert!(
        kernel.snapshot()? == exhausted,
        "cursor failure changed the full snapshot"
    );
    Ok(())
}

#[test]
fn complete_two_actor_preparation_commits_once_and_replays_identical_commands()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = actor_fixture(content.clone(), true)?;
    let before = kernel.snapshot()?;
    let commands = kernel.prepare_authority_ai_commands()?;
    assert_eq!(commands.len(), 2);
    let after = kernel.snapshot()?;
    assert_eq!(
        after
            .authority_ai
            .as_ref()
            .ok_or("AI owner missing")?
            .decision_sequence,
        before
            .authority_ai
            .as_ref()
            .ok_or("AI owner missing")?
            .decision_sequence
            + 2
    );
    let mut conserved = after.clone();
    conserved.authority_ai = before.authority_ai.clone();
    assert_eq!(conserved, before);
    let mut restored = restore(before, content)?;
    assert_eq!(restored.prepare_authority_ai_commands()?, commands);
    assert_eq!(restored.snapshot()?, after);
    Ok(())
}
