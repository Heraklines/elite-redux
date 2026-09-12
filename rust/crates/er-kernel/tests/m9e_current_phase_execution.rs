//! Public current phase entry, using shipped content and real raw bootstrap.
//! Battle HP, attack, speed, move slots and XP are explicitly controlled fixtures.
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
    for _ in 0..=count {
        let menu = kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .ok_or("actual menu absent")?;
        if menu.selected_option_id.as_str() == option {
            return Ok(());
        }
        let selected = menu
            .options
            .iter()
            .position(|row| row.option_id == menu.selected_option_id)
            .ok_or("actual selected row absent")?;
        let wanted = menu
            .options
            .iter()
            .position(|row| row.option_id.as_str() == option)
            .ok_or("actual requested row absent")?;
        press(
            kernel,
            if wanted < selected {
                PhysicalKey::ArrowUp
            } else {
                PhysicalKey::ArrowDown
            },
        )?;
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

#[inline(never)]
fn assert_faint_timeline(
    kernel: &mut GameKernelV7,
    content: Arc<PreparedGameContentV2>,
    seen: &mut [Option<er_types::PresentationEventId>; 2],
) -> Result<()> {
    use er_game::m9e_material_v6::GamePresentationPayloadV1 as P;
    use er_state::current_faint_execution::CurrentFaintPhaseV1 as F;
    let checkpoint = kernel.snapshot()?;
    let state = active(&checkpoint)?;
    let owner = state
        .current_battle_participation
        .as_ref()
        .and_then(|owner| owner.experience.as_ref())
        .ok_or("experience owner absent")?;
    let faint = &owner
        .source_progression
        .as_ref()
        .ok_or("source owner absent")?
        .initial_faint;
    let Some(phase) = &faint.phase else {
        return Ok(());
    };
    let address = phase.address();
    assert_eq!(faint.enemy_faints, 1);
    assert_eq!(faint.history.len(), 1);
    assert_eq!(faint.history[0].pokemon, address.pokemon);
    assert_eq!(faint.history[0].turn, address.turn);
    let battle = state
        .active_run
        .as_ref()
        .and_then(|run| run.battle.as_ref())
        .ok_or("battle absent")?;
    let slot = battle
        .field
        .slots
        .iter()
        .find(|slot| slot.slot == address.slot)
        .ok_or("faint slot absent")?;
    let enemy = battle
        .enemy_party
        .iter()
        .find(|enemy| enemy.id == address.pokemon)
        .ok_or("faint enemy absent")?;
    let tracker = state
        .current_achievement_tracker
        .as_ref()
        .and_then(|tracker| tracker.battle.as_ref())
        .ok_or("tracker absent")?;
    assert_eq!(
        tracker.enemy_ko_turns.get(&address.pokemon),
        Some(&address.turn)
    );
    assert!(tracker.enemy_field_faints.contains(&address.pokemon));
    let (index, event_id, payload) = match phase {
        F::Animation { event_id, .. } => {
            assert_eq!(
                slot.occupant,
                Some(address.pokemon),
                "leaveField must wait for the animation callback"
            );
            assert_eq!(faint.battle_score, SafeU53::ZERO);
            (
                0,
                *event_id,
                P::FaintAnimation {
                    holder: address.pokemon,
                    tween_milliseconds: 500,
                },
            )
        }
        F::Message { event_id, .. } => {
            assert!(seen[0].is_some(), "faint message cannot bypass animation");
            assert_eq!(slot.occupant, None);
            assert_eq!(faint.battle_score, address.score_increase);
            assert_eq!(enemy.status.kind, er_types::battle_model::StatusKind::None);
            assert_ne!(
                Some(*event_id),
                seen[0],
                "message owns a distinct presentation event"
            );
            (
                1,
                *event_id,
                P::FaintMessage {
                    holder: address.pokemon,
                },
            )
        }
        F::ReadyForVictory { .. } => {
            assert!(
                seen.iter().all(Option::is_some),
                "Victory must follow both actual faint callbacks"
            );
            assert_eq!(slot.occupant, None);
            assert_eq!(faint.battle_score, address.score_increase);
            return Ok(());
        }
        F::MessageReady { .. } => {
            return Err("unpublished intermediate faint state escaped its transaction".into());
        }
    };
    assert!(seen[index].is_none(), "acknowledged faint phase repeated");
    seen[index] = Some(event_id);
    assert!(
        owner
            .pending
            .iter()
            .all(|pending| pending.victory.is_none()),
        "Victory started before Faint finished"
    );
    let effect = checkpoint
        .pending_presentations
        .iter()
        .find(|pending| pending.event_id == event_id)
        .ok_or("owned faint presentation absent")?;
    assert_eq!(effect.payload.as_ref(), Some(&payload));
    let original = canonical_bytes(&checkpoint)?;
    if index == 0 {
        assert!(
            kernel
                .settle_presentation_outcome(
                    event_id,
                    er_kernel::game_kernel_v7::KernelPresentationOutcomeV2::IntentionallySkipped
                )
                .is_err()
        );
        assert_eq!(canonical_bytes(&kernel.snapshot()?)?, original);
    }
    let blocked = kernel.advance_time(SafeU53::ZERO)?;
    assert!(
        !blocked
            .effects
            .iter()
            .any(|effect| matches!(effect, GameKernelEffectV7::AuthorityMaterial { .. }))
    );
    assert_eq!(kernel.state(), Some(state));
    assert_missing_phase_wait_rejected(&checkpoint, event_id, content)?;
    Ok(())
}

#[inline(never)]
fn assert_missing_phase_wait_rejected(
    checkpoint: &CoreGameKernelSnapshotV7,
    event_id: er_types::PresentationEventId,
    content: Arc<PreparedGameContentV2>,
) -> Result<()> {
    assert_phase_title_read_reissues(checkpoint, event_id, content.clone())?;
    let mut missing = checkpoint.clone();
    missing
        .pending_presentations
        .retain(|pending| pending.event_id != event_id);
    assert!(
        restore(missing, content.clone()).is_err(),
        "removing a presentation is not acknowledgement"
    );
    let mut changed = checkpoint.clone();
    changed
        .pending_presentations
        .iter_mut()
        .find(|pending| pending.event_id == event_id)
        .ok_or("owned presentation absent")?
        .payload = None;
    assert!(
        restore(changed, content).is_err(),
        "presentation payload must match the exact phase receipt"
    );
    Ok(())
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
    let mut faint_events = [None, None];
    // Explicit test watchdog; reaching it is failure, never an implicit drain.
    for _ in 0..96 {
        assert_faint_timeline(&mut kernel, content.clone(), &mut faint_events)?;
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
                    assert_phase_title_read_reissues(&checkpoint, *event_id, content.clone())?;
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
                    let mut forged = checkpoint.clone();
                    let GameKernelLifecycleSnapshotV7::Active(forged_state) = &mut forged.lifecycle
                    else {
                        return Err("active level-start snapshot absent".into());
                    };
                    let retained = forged_state
                        .current_battle_participation
                        .as_mut()
                        .and_then(|owner| owner.experience.as_mut())
                        .and_then(|owner| {
                            owner
                                .pending
                                .iter_mut()
                                .find_map(|pending| pending.victory.as_mut())
                        })
                        .ok_or("actual retained victory absent")?;
                    let CurrentVictoryDescendantV1::LevelUpStart { level_up } =
                        &mut retained.descendant
                    else {
                        return Err("actual level-start cursor absent".into());
                    };
                    level_up.previous_stats.attack = level_up
                        .previous_stats
                        .attack
                        .checked_add(1)
                        .ok_or("stat overflow")?;
                    assert!(
                        restore(forged, content.clone()).is_err(),
                        "retained previous stats must match the captured Faint preimage"
                    );
                }
                CurrentVictoryDescendantV1::LevelUpPresentation { end, event_id } => {
                    assert_phase_title_read_reissues(&checkpoint, *event_id, content.clone())?;
                    assert!(saw_award && saw_level_start);
                    assert_eq!(pokemon.level, end.level_up.new_level);
                    assert_eq!(
                        state
                            .current_friendship_profile
                            .as_ref()
                            .and_then(|profile| profile.rewards.as_ref())
                            .ok_or("actual fresh account rewards absent")?
                            .highest_level
                            .get(),
                        u64::from(pokemon.level),
                        "highestLevel must be updated before the stat presentation"
                    );
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
            let settled = canonical_bytes(&kernel.snapshot()?)?;
            assert!(kernel.settle_presentation(presentation.event_id).is_err());
            assert_eq!(
                canonical_bytes(&kernel.snapshot()?)?,
                settled,
                "duplicate presentation callback must be rejected atomically"
            );
            assert_eq!(live.as_ref(), kernel.state());
        }
        let snapshot = kernel.snapshot()?;
        kernel = restore(
            serde_json::from_slice(&canonical_bytes(&snapshot)?)?,
            content.clone(),
        )?;
        assert_eq!(
            canonical_bytes(&kernel.snapshot()?)?,
            canonical_bytes(&snapshot)?,
            "the actual settled presentation acknowledgement must survive restore before its material step"
        );
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
    assert!(faint_events.iter().all(Option::is_some));
    let legitimate = kernel.snapshot()?;
    let original = canonical_bytes(&legitimate)?;
    let mut wrong_xp = legitimate.clone();
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut wrong_xp.lifecycle else {
        return Err("active post-award state absent".into());
    };
    let pokemon = &mut state.active_run.as_mut().ok_or("run absent")?.party[0];
    pokemon.experience = Experience::new(safe(
        pokemon
            .experience
            .get()
            .get()
            .checked_add(1)
            .ok_or("XP overflow")?,
    )?);
    assert!(
        restore(wrong_xp, content.clone()).is_err(),
        "post-award XP must match the retained source arithmetic"
    );
    let mut wrong_hp = legitimate.clone();
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut wrong_hp.lifecycle else {
        return Err("active post-stat state absent".into());
    };
    let pokemon = &mut state.active_run.as_mut().ok_or("run absent")?.party[0];
    assert!(pokemon.hp > 1);
    pokemon.hp -= 1;
    assert!(
        restore(wrong_hp, content.clone()).is_err(),
        "post-stat HP must match the captured pre-stat maximum"
    );
    assert_eq!(canonical_bytes(&kernel.snapshot()?)?, original);
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

// Called at the actual Faint and XP boundaries of the existing raw witness.
// Save bytes use the real retained state; this does not claim a mid-phase Save UI.
#[inline(never)]
fn assert_phase_title_read_reissues(
    checkpoint: &CoreGameKernelSnapshotV7,
    event_id: er_types::PresentationEventId,
    content: Arc<PreparedGameContentV2>,
) -> Result<()> {
    use er_game::m9e_material_v6::GamePresentationEffectV2;
    use er_kernel::game_kernel_v7::KernelStorageResultV2;
    let original = active(checkpoint)?;
    let pending = checkpoint
        .pending_presentations
        .iter()
        .find(|pending| pending.event_id == event_id)
        .ok_or("phase prompt absent")?;
    let expected = GamePresentationEffectV2 {
        event_id,
        semantic: pending.semantic,
        blocking: pending.blocking,
        skip: pending.skip,
        payload: pending.payload.clone(),
    };
    let saved = er_save::m9e_save_v2::GameSaveV2::new(
        original.content_identity.clone(),
        safe(1)?,
        original.clone(),
    )?
    .encode()?;
    let mut reader = GameKernelV7::natural_start(
        original.profile.clone(),
        "phase-title-read".to_owned(),
        seat()?,
        vec!["phase-source-slot".to_owned()],
        true,
        content.clone(),
        KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: vec![],
            pauses: vec![],
            disposed: false,
        },
        None,
    )?;
    navigate(&mut reader, "bootstrap/title/existing-saves")?;
    let listed = press(&mut reader, PhysicalKey::Space)?;
    let list_request = listed
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageList { request }) => {
                Some(*request)
            }
            _ => None,
        })
        .ok_or("Title LIST absent")?;
    reader.apply_storage_result(
        list_request,
        KernelStorageResultV2::Slots {
            slots: vec!["phase-source-slot".to_owned()],
        },
    )?;
    let reading = press(&mut reader, PhysicalKey::Space)?;
    let request = reading
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageRead { request, slot })
                if slot == "phase-source-slot" =>
            {
                Some(*request)
            }
            _ => None,
        })
        .ok_or("actual Title READ absent")?;
    let before_read = reader.snapshot()?;
    let mut malformed = saved.clone();
    malformed.push(b' ');
    assert!(
        reader
            .apply_storage_result(
                request,
                KernelStorageResultV2::Read {
                    bytes: Some(malformed),
                }
            )
            .is_err()
    );
    assert_eq!(
        reader.snapshot()?,
        before_read,
        "failed READ must preserve its request"
    );
    let loaded = reader.apply_storage_result(
        request,
        KernelStorageResultV2::Read {
            bytes: Some(saved.clone()),
        },
    )?;
    let presentations: Vec<_> = loaded
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::Presentation(effect) => Some(effect),
            _ => None,
        })
        .collect();
    assert_eq!(presentations, vec![&expected]);
    assert!(loaded.internal_events.is_empty());
    assert!(!loaded.effects.iter().any(|effect| matches!(
        effect,
        GameKernelEffectV7::AuthorityMaterial { .. } | GameKernelEffectV7::Platform(_)
    )));
    let after_read = reader.snapshot()?;
    assert_eq!(after_read.pending_presentations, vec![pending.clone()]);
    assert!(after_read.pending_current_phase_ack.is_none());
    assert_eq!(
        after_read.replay_sequence.get(),
        before_read.replay_sequence.get() + 1
    );
    let actual = active(&after_read)?;
    let mut rebound = original.clone();
    rebound
        .active_run
        .as_mut()
        .ok_or("saved run absent")?
        .control = actual
        .active_run
        .as_ref()
        .ok_or("loaded run absent")?
        .control
        .clone();
    rebound.identities.next_platform_request_id = actual.identities.next_platform_request_id;
    assert_eq!(
        &rebound, actual,
        "READ may rebind control/platform frontier, never payout or receipts"
    );
    assert!(
        reader
            .apply_storage_result(request, KernelStorageResultV2::Read { bytes: Some(saved) })
            .is_err()
    );
    assert_eq!(reader.snapshot()?, after_read);
    let blocked = reader.advance_time(SafeU53::ZERO)?;
    assert!(
        !blocked
            .effects
            .iter()
            .any(|effect| matches!(effect, GameKernelEffectV7::AuthorityMaterial { .. }))
    );
    reader.settle_presentation(event_id)?;
    let acknowledged = reader.snapshot()?;
    assert!(acknowledged.pending_presentations.is_empty());
    assert_eq!(
        acknowledged
            .pending_current_phase_ack
            .ok_or("actual READ prompt ack absent")?
            .event_id,
        event_id
    );
    reader = restore(acknowledged, content.clone())?;
    let mut live = reader.state().cloned();
    let mut ledger = reader.snapshot()?.material_ledger;
    let continuation = reader.advance_time(SafeU53::ZERO)?;
    accept_material(&mut live, &mut ledger, &reader, &content, &continuation)?;
    assert!(reader.snapshot()?.pending_current_phase_ack.is_none());
    Ok(())
}

// Append to m9e_current_phase_execution.rs; explicit prior source-account grant
// at epoch zero plus friendship 252 are controlled inputs to this regression.
#[test]
fn epoch_zero_max_unlock_does_not_request_or_repeat_achievement_reward() -> Result<()> {
    use er_state::current_experience_owner::CurrentFriendshipClockPurposeV1;
    use er_state::current_friendship_profile::{
        CURRENT_FRIENDSHIP_RIBBON_V1, CurrentFriendshipRibbonV1,
    };
    let content = content()?;
    let kernel = controlled_before_knockout(content.clone(), 5, &[33])?;
    let mut snapshot = kernel.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut snapshot.lifecycle else {
        return Err("actual pre-knockout state absent".into());
    };
    let pokemon = &mut state.active_run.as_mut().ok_or("run absent")?.party[0];
    pokemon.friendship = 252;
    let species = pokemon.species_id;
    let profile = state
        .current_friendship_profile
        .as_mut()
        .ok_or("fresh account absent")?;
    let rewards = profile.rewards.as_mut().ok_or("reward owner absent")?;
    rewards.max_friendship_unlocked_at = Some(0);
    rewards.ribbons = vec![CurrentFriendshipRibbonV1 {
        species,
        bits: safe(CURRENT_FRIENDSHIP_RIBBON_V1)?,
    }];
    rewards.cosmetic_bits = vec![0, 0, 0, 0, 128, 1];
    let previous_candy = profile
        .accounts
        .iter()
        .map(|row| (row.species, row.candy_count))
        .collect::<Vec<_>>();
    state.validate_with(content.as_ref())?;
    snapshot.material_ledger =
        AppliedGameMaterialLedgerV1::new(snapshot.material_ledger.next_authority_revision)?;
    let mut kernel = restore(snapshot, content.clone())?;
    let (mut live, mut ledger) = admit_knockout(&mut kernel, &content)?;
    for _ in 0..96 {
        let current = kernel.snapshot()?;
        for pending in &current.pending_platform {
            if let GamePlatformEffectV2::CurrentFriendshipClock { request } = &pending.effect {
                assert_eq!(
                    request.purpose,
                    CurrentFriendshipClockPurposeV1::TimedEvent,
                    "Object.hasOwn treats epoch-zero unlock as present: no second achievement clock"
                );
                let state = active(&current)?;
                let profile = state
                    .current_friendship_profile
                    .as_ref()
                    .ok_or("account absent")?;
                assert_eq!(
                    profile
                        .rewards
                        .as_ref()
                        .ok_or("rewards absent")?
                        .max_friendship_unlocked_at,
                    Some(0)
                );
                assert_eq!(
                    profile
                        .accounts
                        .iter()
                        .map(|row| (row.species, row.candy_count))
                        .collect::<Vec<_>>(),
                    previous_candy
                );
                let restored = restore(current.clone(), content.clone())?;
                assert_eq!(restored.snapshot()?, current);
                return Ok(());
            }
        }
        for pending in current.pending_presentations {
            kernel.settle_presentation(pending.event_id)?;
        }
        let step = kernel.advance_time(SafeU53::ZERO)?;
        accept_material(&mut live, &mut ledger, &kernel, &content, &step)?;
    }
    Err("source friendship clock was never reached".into())
}

// Controlled preimage, actual raw command/callback/material path. This does not
// claim natural unmodified combat or a nonempty cancelled suffix.
#[test]
fn controlled_raw_initial_victory_tail_settles_once_and_retains_boundary() -> Result<()> {
    let content = content()?;
    let mut kernel = Box::new(controlled_before_knockout(content.clone(), 5, &[33])?);
    let (mut live, mut ledger) = admit_knockout(&mut kernel, content.as_ref())?;
    for _ in 0..96 {
        if assert_initial_tail_boundary(&mut kernel, content.clone())? { return Ok(()); }
        let snapshot = kernel.snapshot()?;
        for presentation in &snapshot.pending_presentations {
            kernel.settle_presentation(presentation.event_id)?;
        }
        let step = if let Some(clock) = snapshot.pending_platform.iter().find(|p|
            matches!(&p.effect, GamePlatformEffectV2::CurrentFriendshipClock { .. })) {
            kernel.apply_current_utc_clock_result(clock.request_id, 0)?
        } else { kernel.advance_time(SafeU53::ZERO)? };
        accept_material(&mut live, &mut ledger, &kernel, content.as_ref(), &step)?;
    }
    Err("initial owned TurnEnd/BattleEnd boundary not reached".into())
}

#[inline(never)]
fn assert_initial_tail_boundary(kernel: &mut GameKernelV7, content: Arc<PreparedGameContentV2>) -> Result<bool> {
    use er_state::current_initial_victory_tail::CurrentInitialVictoryTailPhaseV1 as T;
    let checkpoint = Box::new(kernel.snapshot()?);
    let state = active(&checkpoint)?;
    let Some(tail) = state.current_battle_participation.as_ref().and_then(|p| p.experience.as_ref())
        .and_then(|o| o.pending.first()).and_then(|p| p.victory_tail.as_ref()) else { return Ok(false); };
    assert_eq!(tail.cancelled_from, tail.original_turn.next_action);
    assert_eq!(usize::from(tail.cancelled_to), tail.original_turn.actions.len());
    assert!(!tail.original_turn.finalization_done);
    let T::EggLapse { accounting, field_turns, .. } = &tail.phase else { return Ok(false); };
    assert_eq!(accounting.battles.get(), 1);
    assert_eq!(accounting.score, tail.faint.score_increase);
    assert_eq!(accounting.money_multiplier.get(), 1);
    assert!(accounting.money_multiplier_captured);
    assert_eq!(field_turns.len(), 1);
    assert_eq!(field_turns[0].turn_count.get(), 1);
    assert_eq!(field_turns[0].wave_turn_count.get(), 1);
    assert!(state.current_turn_execution.is_none());
    let battle = state.active_run.as_ref().and_then(|r| r.battle.as_ref()).ok_or("battle absent")?;
    assert_eq!(battle.turn.get().get(), 2);
    assert!(battle.battle_rng.saved_substream.is_none());
    let frozen = canonical_bytes(state)?;
    let restored = restore(*checkpoint.clone(), content.clone())?;
    assert_eq!(canonical_bytes(restored.state().ok_or("restored state absent")?)?, frozen);
    for _ in 0..3 {
        let step = kernel.advance_time(SafeU53::ZERO)?;
        assert!(!step.effects.iter().any(|e| matches!(e, GameKernelEffectV7::AuthorityMaterial { .. })));
        assert_eq!(canonical_bytes(kernel.state().ok_or("live state absent")?)?, frozen);
    }
    let mut forged = *checkpoint;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut forged.lifecycle else { return Err("active state absent".into()); };
    state.current_battle_participation.as_mut().and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.first_mut()).and_then(|p| p.victory_tail.as_mut())
        .ok_or("tail absent")?.cancelled_to += 1;
    assert!(restore(forged, content).is_err(), "retained cancelled suffix must bind its exact original action list");
    Ok(true)
}