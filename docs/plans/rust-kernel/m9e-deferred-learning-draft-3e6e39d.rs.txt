//! Public current phase entry, using shipped content and real raw bootstrap.
//! The battle HP/speed and XP frontier are explicitly controlled fixtures.
//! This does not claim natural source AI/damage parity or finished evolution.
use er_canonical::canonical_bytes;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{
    AppliedGameMaterialLedgerV1, GameMaterialV6, GamePlatformEffectV2, apply_game_material_v6,
};
use er_kernel::game_kernel_v7::{
    FreshFriendshipStartV7, GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_state::current_victory_execution::CurrentVictoryDescendantV1;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ids::{MoveId, WaveIndex};
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::run_ids::Experience;
use er_types::{GameControlKindV2, SafeU53, SeatId};
use std::{error::Error, sync::Arc};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
fn safe(value: u64) -> Result<SafeU53> {
    Ok(SafeU53::new(value)?)
}
fn seat() -> Result<SeatId> {
    Ok(SeatId::new(safe(1)?))
}
fn content() -> Result<Arc<PreparedGameContentV2>> {
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(
        serde_json::from_slice::<GameContentBundleV2>(BUNDLE)?,
    ))?))
}
fn press(kernel: &mut GameKernelV7, key: PhysicalKey) -> Result<GameKernelStepV7> {
    let result = kernel.raw_input(RawInputEvent::KeyDown {
        code: key.clone(),
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    })?;
    kernel.raw_input(RawInputEvent::KeyUp { code: key })?;
    Ok(result)
}
fn navigate(kernel: &mut GameKernelV7, option: &str) -> Result<()> {
    let count = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .ok_or("actual menu absent")?
        .options
        .len();
    // Start at the actual top row, so clamped menus are navigable too.
    for _ in 0..count {
        press(kernel, PhysicalKey::ArrowUp)?;
    }
    for _ in 0..=count {
        if kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == option)
        {
            return Ok(());
        }
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    Err("actual raw menu option unreachable".into())
}
fn restore(
    snapshot: CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<GameKernelV7> {
    Ok(GameKernelV7::from_snapshot(
        snapshot,
        seat()?,
        GameKernelRoleV7::Authority,
        content,
    )?)
}
fn active(snapshot: &CoreGameKernelSnapshotV7) -> Result<&GameStateV6> {
    match &snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Active(state) => Ok(state),
        _ => Err("actual active lifecycle required".into()),
    }
}
fn natural(content: Arc<PreparedGameContentV2>) -> Result<GameKernelV7> {
    let profile = ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: vec![],
        achievements: vec![],
        challenges: vec![],
        flags: Default::default(),
        dex: DexState::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(safe(1)?)?,
        },
    };
    let mut kernel = GameKernelV7::natural_start_with_fresh_friendship(FreshFriendshipStartV7 {
        profile,
        seed: "m9e-phase-execution-18".to_owned(),
        local_seat: seat()?,
        save_slots: vec!["phase-source-slot".to_owned()],
        content: content.clone(),
        scheduler: KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: vec![],
            pauses: vec![],
            disposed: false,
        },
    })?;
    press(&mut kernel, PhysicalKey::Space)?;
    let mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| {
            mode.supported
                && !mode.cooperative
                && !mode.challenge_selection
                && content
                    .world
                    .mode(mode.mode)
                    .is_some_and(|definition| definition.key == "CLASSIC")
        })
        .ok_or("actual ordinary Classic mode absent")?;
    navigate(&mut kernel, &format!("bootstrap/mode/{}", mode.mode.get()))?;
    press(&mut kernel, PhysicalKey::Space)?;
    let before_clock = kernel.snapshot()?;
    let clocks: Vec<_> = before_clock
        .pending_platform
        .iter()
        .filter_map(|pending| {
            matches!(
                pending.effect,
                GamePlatformEffectV2::StarterPokerusClock { .. }
            )
            .then_some(pending.request_id)
        })
        .collect();
    assert_eq!(
        clocks.len(),
        1,
        "fresh raw entry must actually request source Date"
    );
    let request = clocks[0];
    let mut resumed = restore(
        serde_json::from_slice(&canonical_bytes(&before_clock)?)?,
        content.clone(),
    )?;
    let original = canonical_bytes(&resumed.snapshot()?)?;
    assert!(
        resumed
            .apply_current_utc_clock_result(request, 8_640_000_000_000_001)
            .is_err()
    );
    assert_eq!(canonical_bytes(&resumed.snapshot()?)?, original);
    let left = kernel.apply_current_utc_clock_result(request, 0)?;
    let right = resumed.apply_current_utc_clock_result(request, 0)?;
    assert_eq!(canonical_bytes(&left)?, canonical_bytes(&right)?);
    assert_eq!(
        canonical_bytes(&kernel.snapshot()?)?,
        canonical_bytes(&resumed.snapshot()?)?
    );
    let completed = canonical_bytes(&kernel.snapshot()?)?;
    assert!(kernel.apply_current_utc_clock_result(request, 0).is_err());
    assert_eq!(canonical_bytes(&kernel.snapshot()?)?, completed);
    let snapshot = kernel.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) = &snapshot.lifecycle else {
        return Err("actual starter bootstrap absent".into());
    };
    let starter = bootstrap
        .catalog
        .starters
        .iter()
        .find(|row| row.species_id.get() == 1 && row.form_index == 0 && row.ability_index == 0)
        .ok_or("actual Bulbasaur selection absent")?;
    navigate(
        &mut kernel,
        &format!("bootstrap/starter/{}", starter.pokemon_id.get()),
    )?;
    press(&mut kernel, PhysicalKey::Space)?;
    navigate(&mut kernel, "bootstrap/starter/confirm")?;
    for _ in 0..4 {
        press(&mut kernel, PhysicalKey::Space)?;
    }
    assert_eq!(
        kernel.current_control().map(|control| control.kind),
        Some(GameControlKindV2::BattleCommand)
    );
    assert!(
        kernel
            .state()
            .and_then(|state| state.current_battle_participation.as_ref())
            .and_then(|owner| owner.experience.as_ref())
            .is_some_and(|owner| owner.source_progression.is_some())
    );
    Ok(kernel)
}

fn accept_material(
    live: &mut Option<GameStateV6>,
    ledger: &mut AppliedGameMaterialLedgerV1,
    kernel: &GameKernelV7,
    content: &PreparedGameContentV2,
    step: &GameKernelStepV7,
) -> Result<GameMaterialV6> {
    let materials: Vec<_> = step
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes),
            _ => None,
        })
        .collect();
    assert_eq!(
        materials.len(),
        1,
        "one source transaction per public phase entry"
    );
    let material = GameMaterialV6::decode(materials[0])?;
    assert_eq!(material.canonical_bytes()?, *materials[0]);
    let presentations: Vec<_> = step
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::Presentation(effect) => Some(effect.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(presentations, material.transition().presentation);
    assert_eq!(
        apply_game_material_v6(live, ledger, content, materials[0])?,
        er_game::m9e_material_v6::GameMaterialApplyOutcomeV6::Applied
    );
    assert_eq!(live.as_ref(), kernel.state());
    assert_eq!(*ledger, kernel.snapshot()?.material_ledger);
    Ok(material)
}

fn controlled_before_knockout(
    content: Arc<PreparedGameContentV2>,
    level: u16,
    moves: &[u64],
) -> Result<GameKernelV7> {
    assert!((1..10).contains(&level));
    assert!(!moves.is_empty() && moves.len() <= 4 && moves[0] == 33);
    let mut snapshot = natural(content.clone())?.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut snapshot.lifecycle else {
        return Err("natural active state absent".into());
    };
    let run = state.active_run.as_mut().ok_or("run absent")?;
    let pokemon = &mut run.party[0];
    assert_eq!(pokemon.level, 5);
    let definition = content
        .progression
        .species(pokemon.species_id, pokemon.form_index)
        .ok_or("species absent")?;
    let growth = content
        .progression
        .growth_rate(definition.growth_rate)
        .ok_or("growth absent")?;
    let threshold =
        er_progression::progression::current_growth_experience_for_level(growth, level + 1)?;
    pokemon.level = level;
    pokemon.experience = Experience::new(safe(
        threshold
            .get()
            .get()
            .checked_sub(1)
            .ok_or("threshold underflow")?,
    )?);
    let species = content.battle.species(pokemon.species_id)?;
    let form = content.battle.form(&er_types::FormId::parse(format!(
        "{}:0",
        pokemon.species_id.get().get()
    ))?)?;
    let nature = content
        .progression
        .pack()
        .natures
        .iter()
        .find(|row| row.id == pokemon.effective_nature)
        .ok_or("actual nature absent")?;
    pokemon.stats = er_progression::current_stats::calculate_current_unmodified_stats(
        pokemon,
        form.stat_override.unwrap_or(species.base_stats),
        nature,
    )?;
    pokemon.max_hp = pokemon.stats.hp;
    pokemon.hp = pokemon.max_hp;
    pokemon.stats.speed = 1;
    pokemon.stats.attack = 500;
    let mut tackle = pokemon.moves[0].ok_or("source move absent")?;
    tackle.move_id = MoveId::new(safe(33)?);
    tackle.pp_used = 0;
    tackle.pp_ups = 0;
    tackle.max_pp_override = None;
    pokemon.moves = [None, None, None, None];
    for (slot, id) in moves.iter().enumerate() {
        let mut entry = tackle;
        entry.move_id = MoveId::new(safe(*id)?);
        pokemon.moves[slot] = Some(entry);
    }
    let battle = run.battle.as_mut().ok_or("battle absent")?;
    assert_eq!(battle.enemy_party.len(), 1);
    let enemy = &mut battle.enemy_party[0];
    enemy.hp = 1;
    enemy.stats.speed = 500;
    enemy.stats.attack = 1;
    enemy.moves = [Some(tackle), None, None, None];
    state.validate_with(content.as_ref())?;
    // This controlled preimage is not the old natural material post-image.
    snapshot.material_ledger =
        AppliedGameMaterialLedgerV1::new(snapshot.material_ledger.next_authority_revision)?;
    restore(snapshot, content)
}

fn admit_knockout(
    kernel: &mut GameKernelV7,
    content: &PreparedGameContentV2,
) -> Result<(Option<GameStateV6>, AppliedGameMaterialLedgerV1)> {
    navigate(kernel, "battle/command/fight")?;
    press(kernel, PhysicalKey::Space)?;
    navigate(kernel, "battle/move/0")?;
    let frontier = kernel.snapshot()?;
    let mut canonical = active(&frontier)?.clone();
    canonical.active_run.as_mut().ok_or("run absent")?.control = frontier
        .private_battle_control
        .as_ref()
        .ok_or("actual private command owner absent")?
        .canonical_control
        .clone();
    let mut live = Some(canonical);
    let mut ledger = frontier.material_ledger.clone();
    let step = press(kernel, PhysicalKey::Space)?;
    accept_material(&mut live, &mut ledger, kernel, content, &step)?;
    Ok((live, ledger))
}

#[test]
fn raw_knockout_waits_for_xp_prompt_then_level_stats_with_exact_material_restore() -> Result<()> {
    let content = content()?;
    let mut kernel = controlled_before_knockout(content.clone(), 5, &[33])?;
    let pokemon = &kernel
        .state()
        .ok_or("state absent")?
        .active_run
        .as_ref()
        .ok_or("run absent")?
        .party[0];
    let before_xp = pokemon.experience;
    let before_stats = pokemon.stats;
    let (mut live, mut ledger) = admit_knockout(&mut kernel, content.as_ref())?;
    let mut saw_award = false;
    let mut saw_level_start = false;
    let mut reached_stats = false;
    // Explicit test watchdog; reaching it is failure, never an implicit drain.
    for _ in 0..96 {
        let checkpoint = kernel.snapshot()?;
        let state = active(&checkpoint)?;
        let pokemon = &state.active_run.as_ref().ok_or("run absent")?.party[0];
        let pending = state
            .current_battle_participation
            .as_ref()
            .and_then(|owner| owner.experience.as_ref())
            .and_then(|owner| {
                owner
                    .pending
                    .iter()
                    .find(|pending| pending.victory.is_some())
            });
        if let Some(victory) = pending.and_then(|pending| pending.victory.as_ref()) {
            match &victory.descendant {
                CurrentVictoryDescendantV1::AwardPresentation { award, event_id } => {
                    assert!(
                        !saw_award,
                        "same award prompt repeated after its exact acknowledgement"
                    );
                    saw_award = true;
                    assert_eq!(pokemon.experience, before_xp);
                    assert_eq!(pokemon.level, 5);
                    assert_eq!(pokemon.stats, before_stats);
                    assert_eq!(award.last_experience, before_xp);
                    assert!(award.experience.get().get() > 0);
                    assert!(
                        checkpoint
                            .pending_presentations
                            .iter()
                            .any(|pending| pending.event_id == *event_id)
                    );
                    let blocked = kernel.advance_time(SafeU53::ZERO)?;
                    assert!(!blocked.effects.iter().any(|effect| matches!(
                        effect,
                        GameKernelEffectV7::AuthorityMaterial { .. }
                    )));
                    assert_eq!(kernel.state(), Some(state));
                }
                CurrentVictoryDescendantV1::LevelUpStart { level_up } => {
                    saw_level_start = true;
                    assert!(saw_award);
                    assert_eq!(pokemon.level, level_up.new_level);
                    assert!(pokemon.level >= 6);
                    assert_eq!(
                        pokemon.stats, before_stats,
                        "stats must wait for actual LevelUp.start"
                    );
                    assert_eq!(
                        pokemon.experience.get().get(),
                        before_xp.get().get() + level_up.award.experience.get().get()
                    );
                }
                CurrentVictoryDescendantV1::LevelUpPresentation { end, event_id } => {
                    assert!(saw_award && saw_level_start);
                    assert_eq!(pokemon.level, end.level_up.new_level);
                    assert_ne!(pokemon.stats, before_stats);
                    assert_eq!(pokemon.max_hp, pokemon.stats.hp);
                    assert!(
                        checkpoint
                            .pending_presentations
                            .iter()
                            .any(|pending| pending.event_id == *event_id)
                    );
                    reached_stats = true;
                }
                _ => {}
            }
        }
        let resumed = restore(
            serde_json::from_slice(&canonical_bytes(&kernel.snapshot()?)?)?,
            content.clone(),
        )?;
        assert_eq!(
            canonical_bytes(&resumed.snapshot()?)?,
            canonical_bytes(&kernel.snapshot()?)?
        );
        kernel = resumed;
        if reached_stats {
            break;
        }
        for presentation in kernel.snapshot()?.pending_presentations {
            kernel.settle_presentation(presentation.event_id)?;
            assert_eq!(live.as_ref(), kernel.state());
        }
        let snapshot = kernel.snapshot()?;
        let step = if let Some(clock) = snapshot.pending_platform.iter().find(|pending| {
            matches!(
                pending.effect,
                GamePlatformEffectV2::CurrentFriendshipClock { .. }
            )
        }) {
            kernel.apply_current_utc_clock_result(clock.request_id, 0)?
        } else {
            kernel.advance_time(SafeU53::ZERO)?
        };
        accept_material(&mut live, &mut ledger, &kernel, content.as_ref(), &step)?;
    }
    assert!(
        reached_stats,
        "actual XP and LevelUp presentation did not finish within the watchdog"
    );
    assert_eq!(live.as_ref(), kernel.state());
    let state = kernel.state().ok_or("final state absent")?;
    let save = er_save::m9e_save_v2::GameSaveV2::new(
        state.content_identity.clone(),
        safe(1)?,
        state.clone(),
    )?;
    assert_eq!(
        er_save::m9e_save_v2::GameSaveV2::decode(&save.encode()?)?.state,
        *state
    );
    Ok(())
}

fn batch(
    kernel: &GameKernelV7,
) -> Result<er_state::current_experience_settlement::CurrentLearnMoveBatchV1> {
    kernel
        .state()
        .and_then(|state| state.current_battle_participation.as_ref())
        .and_then(|owner| owner.experience.as_ref())
        .and_then(|owner| {
            owner.pending.iter().find_map(|pending| {
                pending
                    .victory
                    .as_ref()
                    .and_then(|victory| match &victory.descendant {
                        CurrentVictoryDescendantV1::LearnMoveBatch { batch } => Some(batch.clone()),
                        _ => None,
                    })
            })
        })
        .ok_or_else(|| "actual retained learn batch absent".into())
}

fn settle_presentations(kernel: &mut GameKernelV7, live: &Option<GameStateV6>) -> Result<()> {
    for pending in kernel.snapshot()?.pending_presentations {
        kernel.settle_presentation(pending.event_id)?;
        assert_eq!(live.as_ref(), kernel.state());
    }
    Ok(())
}

fn raw_batch_option(
    kernel: &mut GameKernelV7,
    content: &PreparedGameContentV2,
    option: &str,
    live: &mut Option<GameStateV6>,
    ledger: &mut AppliedGameMaterialLedgerV1,
) -> Result<()> {
    settle_presentations(kernel, live)?;
    navigate(kernel, option)?;
    let step = press(kernel, PhysicalKey::Space)?;
    // Replay from the last committed image, not an image patched to match the
    // authority's private selected row. Menu navigation cannot forge history.
    let material = accept_material(live, ledger, kernel, content, &step)?;
    assert!(matches!(
        material.transition().accepted_action,
        Some(er_types::GameActionV1::CurrentLearnMoveBatch { .. })
    ));
    Ok(())
}

#[test]
fn raw_level_move_batch_retains_slot_cancel_undo_and_learning_stamp_across_restore() -> Result<()> {
    let content = content()?;
    let species = er_types::battle_ids::SpeciesId::new(safe(1)?);
    let definition = content
        .progression
        .species(species, 0)
        .ok_or("actual Bulbasaur content absent")?;
    let initial_moves = [33_u64, 45, 230, 580];
    let level = (2_u16..=10)
        .find(|level| {
            let novel: std::collections::BTreeSet<_> = definition
                .level_moves
                .iter()
                .filter(|row| {
                    i32::from(row.level) == i32::from(*level)
                        && !initial_moves.contains(&row.move_id.get().get())
                })
                .map(|row| row.move_id)
                .collect();
            novel.len() >= 2
        })
        .ok_or("source low-level simultaneous learn pair required")?;
    let mut kernel = controlled_before_knockout(content.clone(), level - 1, &initial_moves)?;
    let (mut live, mut ledger) = admit_knockout(&mut kernel, content.as_ref())?;
    let mut reached_batch = false;
    for _ in 0..96 {
        if batch(&kernel).is_ok() {
            reached_batch = true;
            break;
        }
        settle_presentations(&mut kernel, &live)?;
        kernel = restore(
            serde_json::from_slice(&canonical_bytes(&kernel.snapshot()?)?)?,
            content.clone(),
        )?;
        let checkpoint = kernel.snapshot()?;
        let step = if let Some(clock) = checkpoint.pending_platform.iter().find(|pending| {
            matches!(
                pending.effect,
                GamePlatformEffectV2::CurrentFriendshipClock { .. }
            )
        }) {
            kernel.apply_current_utc_clock_result(clock.request_id, 0)?
        } else {
            kernel.advance_time(SafeU53::ZERO)?
        };
        accept_material(&mut live, &mut ledger, &kernel, content.as_ref(), &step)?;
    }
    assert!(
        reached_batch,
        "actual KO/XP/LevelUp did not reach source learn batch"
    );
    let initial = batch(&kernel)?;
    assert!(initial.offered.len() >= 2);
    assert!(initial.original_moves.iter().all(Option::is_some));
    let move_id = initial.offered[0];
    let move_option = format!("current/learn-batch/move/{}", move_id.get());
    raw_batch_option(
        &mut kernel,
        content.as_ref(),
        "current/learn-batch/done",
        &mut live,
        &mut ledger,
    )?;
    assert!(batch(&kernel)?.cancel_confirmation);
    assert_eq!(
        kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .ok_or("actual confirmation absent")?
            .selected_option_id
            .as_str(),
        "current/learn-batch/cancel/no"
    );
    let step = press(&mut kernel, PhysicalKey::Escape)?;
    accept_material(&mut live, &mut ledger, &kernel, content.as_ref(), &step)?;
    assert!(!batch(&kernel)?.cancel_confirmation);
    assert!(!batch(&kernel)?.complete);
    raw_batch_option(
        &mut kernel,
        content.as_ref(),
        &move_option,
        &mut live,
        &mut ledger,
    )?;
    assert_eq!(batch(&kernel)?.pending_move, Some(move_id));
    assert!(batch(&kernel)?.assignments.is_empty());
    let step = press(&mut kernel, PhysicalKey::Escape)?;
    accept_material(&mut live, &mut ledger, &kernel, content.as_ref(), &step)?;
    assert_eq!(batch(&kernel)?.pending_move, None);
    assert_eq!(
        kernel
            .state()
            .ok_or("state absent")?
            .active_run
            .as_ref()
            .ok_or("run absent")?
            .party[0]
            .moves,
        initial.original_moves
    );
    raw_batch_option(
        &mut kernel,
        content.as_ref(),
        &move_option,
        &mut live,
        &mut ledger,
    )?;
    raw_batch_option(
        &mut kernel,
        content.as_ref(),
        &format!("current/learn-batch/{}/slot/0", move_id.get()),
        &mut live,
        &mut ledger,
    )?;
    assert_eq!(batch(&kernel)?.assignments.len(), 1);
    assert!(!batch(&kernel)?.complete);
    let state = kernel.state().ok_or("state absent")?;
    let wave = state.active_run.as_ref().ok_or("run absent")?.wave;
    let stamps = &state
        .current_achievement_tracker
        .as_ref()
        .ok_or("real tracker absent")?
        .persistent
        .learned_move_stamps;
    assert_eq!(stamps.get(&move_id), Some(&wave));
    let stamp_image = stamps.clone();
    let checkpoint = kernel.snapshot()?;
    kernel = restore(
        serde_json::from_slice(&canonical_bytes(&checkpoint)?)?,
        content.clone(),
    )?;
    assert_eq!(
        canonical_bytes(&kernel.snapshot()?)?,
        canonical_bytes(&checkpoint)?
    );
    raw_batch_option(
        &mut kernel,
        content.as_ref(),
        "current/learn-batch/undo",
        &mut live,
        &mut ledger,
    )?;
    let undone = batch(&kernel)?;
    assert!(!undone.complete && undone.assignments.is_empty());
    let state = kernel.state().ok_or("state absent")?;
    assert_eq!(
        state.active_run.as_ref().ok_or("run absent")?.party[0].moves,
        initial.original_moves
    );
    assert_eq!(
        state
            .current_achievement_tracker
            .as_ref()
            .ok_or("real tracker absent")?
            .persistent
            .learned_move_stamps,
        stamp_image,
        "source Undo restores moves only, never tracker history"
    );
    raw_batch_option(
        &mut kernel,
        content.as_ref(),
        &move_option,
        &mut live,
        &mut ledger,
    )?;
    raw_batch_option(
        &mut kernel,
        content.as_ref(),
        &format!("current/learn-batch/{}/slot/1", move_id.get()),
        &mut live,
        &mut ledger,
    )?;
    raw_batch_option(
        &mut kernel,
        content.as_ref(),
        "current/learn-batch/done",
        &mut live,
        &mut ledger,
    )?;
    let state = kernel.state().ok_or("state absent")?;
    let pokemon = &state.active_run.as_ref().ok_or("run absent")?.party[0];
    let learned = pokemon.moves[1]
        .as_ref()
        .ok_or("actual learned slot absent")?;
    assert_eq!(learned.move_id, move_id);
    assert_eq!(
        (learned.pp_used, learned.pp_ups, learned.max_pp_override),
        (0, 0, None)
    );
    assert_eq!(
        state
            .current_achievement_tracker
            .as_ref()
            .ok_or("real tracker absent")?
            .persistent
            .learned_move_stamps
            .get(&move_id),
        Some(&wave)
    );
    let save = er_save::m9e_save_v2::GameSaveV2::new(
        state.content_identity.clone(),
        safe(1)?,
        state.clone(),
    )?;
    assert_eq!(
        er_save::m9e_save_v2::GameSaveV2::decode(&save.encode()?)?.state,
        *state
    );
    assert_eq!(live.as_ref(), Some(state));
    Ok(())
}
