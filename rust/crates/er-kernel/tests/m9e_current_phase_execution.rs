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
    // Find a shortest route using only the actual control's Up/Down edges.
    // Every edge is still executed as a public physical key down/up pair.
    let route = {
        let menu = kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .ok_or("actual menu absent")?;
        if !menu
            .options
            .iter()
            .any(|row| row.option_id.as_str() == option)
        {
            return Err("actual requested row absent".into());
        }
        let start = menu.selected_option_id.as_str();
        let mut adjacent = std::collections::BTreeMap::<&str, Vec<_>>::new();
        for edge in &menu.navigation {
            if matches!(
                edge.direction,
                er_types::NavigationDirection::Up | er_types::NavigationDirection::Down
            ) {
                adjacent.entry(edge.from.as_str()).or_default().push(edge);
            }
        }
        let mut queue = std::collections::VecDeque::from([start]);
        let mut seen = std::collections::BTreeSet::from([start]);
        let mut previous = std::collections::BTreeMap::new();
        while let Some(node) = queue.pop_front() {
            if node == option {
                break;
            }
            if seen.len() > menu.options.len() {
                return Err("actual navigation exceeds menu option bound".into());
            }
            for edge in adjacent.get(node).into_iter().flatten() {
                if seen.insert(edge.to.as_str()) {
                    let key = match edge.direction {
                        er_types::NavigationDirection::Up => PhysicalKey::ArrowUp,
                        er_types::NavigationDirection::Down => PhysicalKey::ArrowDown,
                        _ => return Err("actual vertical navigation changed direction".into()),
                    };
                    previous.insert(edge.to.as_str(), (node, key));
                    queue.push_back(edge.to.as_str());
                }
            }
        }
        let mut route = Vec::new();
        let mut cursor = option;
        while cursor != start {
            if route.len() >= menu.options.len() {
                return Err("actual raw menu option unreachable within bound".into());
            }
            let (parent, key) = previous
                .get(cursor)
                .ok_or("actual raw menu option unreachable")?;
            route.push((key.clone(), cursor.to_owned()));
            cursor = parent;
        }
        route.reverse();
        route
    };
    for (key, expected) in route {
        press(kernel, key)?;
        if !kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == expected)
        {
            return Err("actual raw navigation did not follow offered edge".into());
        }
    }
    Ok(())
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
    assert_two_neutral_turns_keep_source_counters()?;
    let content = content()?;
    let mut kernel = Box::new(controlled_before_knockout(content.clone(), 5, &[33])?);
    let pokemon = &kernel
        .state()
        .ok_or("state absent")?
        .active_run
        .as_ref()
        .ok_or("run absent")?
        .party[0];
    assert_source_counter_checkpoint(&kernel, content.clone())?;
    let before_xp = pokemon.experience;
    let before_stats = pokemon.stats;
    let (mut live, mut ledger) = admit_knockout(&mut kernel, content.as_ref())?;
    let mut progress = [false; 3];
    let mut faint_events = [None, None];
    // Explicit test watchdog; reaching it is failure, never an implicit drain.
    for _ in 0..96 {
        assert_faint_timeline(&mut kernel, content.clone(), &mut faint_events)?;
        assert_raw_victory_observation(
            &mut kernel,
            content.clone(),
            (before_xp, before_stats),
            &mut progress,
        )?;
        kernel = restore_exact_raw_checkpoint(&kernel, content.clone())?;
        if progress[2] {
            break;
        }
        let step = advance_raw_phase_after_callbacks(&mut kernel, content.clone(), &live)?;
        accept_material(&mut live, &mut ledger, &kernel, content.as_ref(), &step)?;
    }
    assert!(
        progress[2],
        "actual XP and LevelUp presentation did not finish within the watchdog"
    );
    assert_eq!(live.as_ref(), kernel.state());
    assert!(faint_events.iter().all(Option::is_some));
    assert_raw_post_stats_integrity(&kernel, content)?;
    Ok(())
}

#[inline(never)]
fn assert_raw_victory_observation(
    kernel: &mut GameKernelV7,
    content: Arc<PreparedGameContentV2>,
    before: (Experience, er_types::battle_model::BattleStats),
    progress: &mut [bool; 3],
) -> Result<()> {
    let (before_xp, before_stats) = before;
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
                    !progress[0],
                    "same award prompt repeated after its exact acknowledgement"
                );
                progress[0] = true;
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
                assert!(
                    !blocked.effects.iter().any(|effect| matches!(
                        effect,
                        GameKernelEffectV7::AuthorityMaterial { .. }
                    ))
                );
                assert_eq!(kernel.state(), Some(state));
            }
            CurrentVictoryDescendantV1::LevelUpStart { level_up } => {
                progress[1] = true;
                assert!(progress[0]);
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
                assert!(progress[0] && progress[1]);
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
                progress[2] = true;
            }
            _ => {}
        }
    }

    Ok(())
}

#[inline(never)]
fn restore_exact_raw_checkpoint(
    kernel: &GameKernelV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<Box<GameKernelV7>> {
    let resumed = restore(
        serde_json::from_slice(&canonical_bytes(&kernel.snapshot()?)?)?,
        content.clone(),
    )?;
    assert_eq!(
        canonical_bytes(&resumed.snapshot()?)?,
        canonical_bytes(&kernel.snapshot()?)?
    );
    Ok(Box::new(resumed))
}

#[inline(never)]
fn advance_raw_phase_after_callbacks(
    kernel: &mut Box<GameKernelV7>,
    content: Arc<PreparedGameContentV2>,
    live: &Option<GameStateV6>,
) -> Result<GameKernelStepV7> {
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
    **kernel = restore(
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
    Ok(step)
}

#[inline(never)]
fn assert_raw_post_stats_integrity(
    kernel: &GameKernelV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<()> {
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
    let mut reader = Box::new(GameKernelV7::natural_start(
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
    )?);
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
    *reader = restore(acknowledged, content.clone())?;
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
        if assert_initial_tail_boundary(&mut kernel, content.clone())? {
            return Ok(());
        }
        let snapshot = kernel.snapshot()?;
        for presentation in &snapshot.pending_presentations {
            kernel.settle_presentation(presentation.event_id)?;
        }
        let step = if let Some(clock) = snapshot.pending_platform.iter().find(|p| {
            matches!(
                &p.effect,
                GamePlatformEffectV2::CurrentFriendshipClock { .. }
            )
        }) {
            kernel.apply_current_utc_clock_result(clock.request_id, 0)?
        } else {
            kernel.advance_time(SafeU53::ZERO)?
        };
        accept_material(&mut live, &mut ledger, &kernel, content.as_ref(), &step)?;
    }
    Err("initial owned TurnEnd/BattleEnd boundary not reached".into())
}

#[inline(never)]
fn assert_initial_tail_boundary(
    kernel: &mut GameKernelV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<bool> {
    use er_state::current_initial_victory_tail::CurrentInitialVictoryTailPhaseV1 as T;
    let checkpoint = Box::new(kernel.snapshot()?);
    let state = active(&checkpoint)?;
    let Some(tail) = state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.pending.first())
        .and_then(|p| p.victory_tail.as_ref())
    else {
        return Ok(false);
    };
    assert_eq!(tail.cancelled_from, tail.original_turn.next_action);
    assert_eq!(
        usize::from(tail.cancelled_to),
        tail.original_turn.actions.len()
    );
    assert!(!tail.original_turn.finalization_done);
    let T::RewardSelectionPending {
        accounting,
        field_turns,
        ..
    } = &tail.phase
    else {
        return Ok(false);
    };
    if !tail.reward.as_ref().is_some_and(|reward| {
        matches!(
            reward.stage,
            er_state::current_reward_selection::CurrentRewardStageV1::Choice
        )
    }) {
        return Ok(false);
    }
    let eggs = state
        .current_friendship_profile
        .as_ref()
        .and_then(|p| p.egg_account.as_ref())
        .ok_or("known Egg account absent")?;
    assert!(eggs.eggs.is_empty());
    assert!(!eggs.auto_restock.enabled);
    assert_eq!(eggs.auto_restock.target_count, 50);
    assert_eq!(accounting.battles.get(), 1);
    assert_eq!(accounting.score, tail.faint.score_increase);
    assert_eq!(accounting.money_multiplier.get(), 1);
    assert!(accounting.money_multiplier_captured);
    assert_eq!(field_turns.len(), 1);
    assert_eq!(field_turns[0].turn_count.get(), 2);
    assert_eq!(field_turns[0].wave_turn_count.get(), 2);
    assert_tail_counter_restore_rejects(&checkpoint, content.clone())?;
    assert!(state.current_turn_execution.is_none());
    let battle = state
        .active_run
        .as_ref()
        .and_then(|r| r.battle.as_ref())
        .ok_or("battle absent")?;
    assert_eq!(battle.turn.get().get(), 2);
    assert!(battle.battle_rng.saved_substream.is_none());
    let frozen = canonical_bytes(state)?;
    let restored = restore(*checkpoint.clone(), content.clone())?;
    assert_eq!(
        canonical_bytes(restored.state().ok_or("restored state absent")?)?,
        frozen
    );
    for _ in 0..3 {
        let step = kernel.advance_time(SafeU53::ZERO)?;
        assert!(
            !step
                .effects
                .iter()
                .any(|e| matches!(e, GameKernelEffectV7::AuthorityMaterial { .. }))
        );
        assert_eq!(
            canonical_bytes(kernel.state().ok_or("live state absent")?)?,
            frozen
        );
    }
    let mut forged = *checkpoint;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut forged.lifecycle else {
        return Err("active state absent".into());
    };
    state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.first_mut())
        .and_then(|p| p.victory_tail.as_mut())
        .ok_or("tail absent")?
        .cancelled_to += 1;
    assert!(
        restore(forged, content).is_err(),
        "retained cancelled suffix must bind its exact original action list"
    );
    Ok(true)
}

#[inline(never)]
fn assert_request_title_read_reissues(
    checkpoint: &CoreGameKernelSnapshotV7,
    expected: &GamePlatformEffectV2,
    content: Arc<PreparedGameContentV2>,
) -> Result<()> {
    use er_kernel::game_kernel_v7::KernelStorageResultV2 as S;
    let original = active(checkpoint)?;
    let saved = er_save::m9e_save_v2::GameSaveV2::new(
        original.content_identity.clone(),
        safe(1)?,
        original.clone(),
    )?
    .encode()?;
    let mut reader = Box::new(GameKernelV7::natural_start(
        original.profile.clone(),
        "request-title-read".into(),
        seat()?,
        vec!["request-slot".into()],
        true,
        content.clone(),
        KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: vec![],
            pauses: vec![],
            disposed: false,
        },
        None,
    )?);
    navigate(&mut reader, "bootstrap/title/existing-saves")?;
    let list = press(&mut reader, PhysicalKey::Space)?;
    let list_id = list
        .effects
        .iter()
        .find_map(|e| match e {
            GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageList { request }) => {
                Some(*request)
            }
            _ => None,
        })
        .ok_or("LIST absent")?;
    reader.apply_storage_result(
        list_id,
        S::Slots {
            slots: vec!["request-slot".into()],
        },
    )?;
    let read = press(&mut reader, PhysicalKey::Space)?;
    let read_id = read
        .effects
        .iter()
        .find_map(|e| match e {
            GameKernelEffectV7::Platform(GamePlatformEffectV2::StorageRead { request, .. }) => {
                Some(*request)
            }
            _ => None,
        })
        .ok_or("READ absent")?;
    let before = reader.snapshot()?;
    let loaded = reader.apply_storage_result(
        read_id,
        S::Read {
            bytes: Some(saved.clone()),
        },
    )?;
    let requests: Vec<_> = loaded
        .effects
        .iter()
        .filter_map(|e| match e {
            GameKernelEffectV7::Platform(p) => Some(p),
            _ => None,
        })
        .collect();
    assert_eq!(requests, [expected]);
    assert!(!loaded.effects.iter().any(|e| matches!(
        e,
        GameKernelEffectV7::AuthorityMaterial { .. } | GameKernelEffectV7::Presentation(_)
    )));
    assert!(loaded.internal_events.is_empty());
    let after = reader.snapshot()?;
    assert_eq!(
        after.replay_sequence.get(),
        before.replay_sequence.get() + 1
    );
    assert!(after.pending_current_phase_ack.is_none());
    assert_eq!(after.pending_platform.len(), 1);
    assert_eq!(&after.pending_platform[0].effect, expected);
    let actual = active(&after)?;
    let mut rebound = original.clone();
    rebound.active_run.as_mut().ok_or("run absent")?.control = actual
        .active_run
        .as_ref()
        .ok_or("loaded run absent")?
        .control
        .clone();
    rebound.identities.next_platform_request_id = actual.identities.next_platform_request_id;
    assert_eq!(
        &rebound, actual,
        "READ cannot consume clock/entropy or execute rewards"
    );
    assert!(
        reader
            .apply_storage_result(read_id, S::Read { bytes: Some(saved) })
            .is_err()
    );
    assert_eq!(reader.snapshot()?, after);
    *reader = restore(after.clone(), content)?;
    let blocked = reader.advance_time(SafeU53::ZERO)?;
    assert!(
        !blocked
            .effects
            .iter()
            .any(|e| matches!(e, GameKernelEffectV7::AuthorityMaterial { .. }))
    );
    assert_eq!(reader.snapshot()?.pending_platform, after.pending_platform);
    Ok(())
}

#[inline(never)]
fn controlled_before_early_knockout(content: Arc<PreparedGameContentV2>) -> Result<GameKernelV7> {
    let mut checkpoint = controlled_before_knockout(content.clone(), 5, &[33])?.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut checkpoint.lifecycle else {
        return Err("active absent".into());
    };
    let run = state.active_run.as_mut().ok_or("run absent")?;
    run.party[0].stats.speed = 500;
    run.battle.as_mut().ok_or("battle absent")?.enemy_party[0]
        .stats
        .speed = 1;
    state.validate_with(content.as_ref())?;
    checkpoint.material_ledger =
        AppliedGameMaterialLedgerV1::new(checkpoint.material_ledger.next_authority_revision)?;
    restore(checkpoint, content)
}

#[test]
fn controlled_early_ko_flash_owns_clock_egg_candy_and_canceled_suffix() -> Result<()> {
    use er_state::current_achievement_execution::CurrentAchievementKeyV1 as K;
    use er_state::current_initial_victory_tail::CurrentInitialVictoryTailPhaseV1 as T;
    let content = content()?;
    let mut kernel = Box::new(controlled_before_early_knockout(content.clone())?);
    let (mut live, mut ledger) = admit_knockout(&mut kernel, content.as_ref())?;
    let mut clock_seen = false;
    let mut egg_seen = false;
    for _ in 0..128 {
        let snapshot = kernel.snapshot()?;
        let state = active(&snapshot)?;
        if let Some(tail) = state
            .current_battle_participation
            .as_ref()
            .and_then(|p| p.experience.as_ref())
            .and_then(|o| o.pending.first())
            .and_then(|p| p.victory_tail.as_ref())
            && matches!(&tail.phase, T::RewardSelectionPending { .. })
            && tail.reward.is_some()
        {
            assert!(clock_seen && egg_seen);
            assert!(
                tail.cancelled_from < tail.cancelled_to,
                "enemy action remained in the canceled suffix"
            );
            let account = state
                .current_friendship_profile
                .as_ref()
                .and_then(|p| p.egg_account.as_ref())
                .ok_or("owned egg account absent")?;
            assert_eq!(account.eggs.len(), 1);
            assert_eq!(account.eggs[0].hatch_waves, 24);
            assert_eq!(
                account.eggs[0].species.get().get(),
                10821,
                "qualified actual source seed projection"
            );
            assert_current_reward_choice_and_pick(
                &mut kernel,
                content.clone(),
                &mut live,
                &mut ledger,
            )?;
            return Ok(());
        }
        if !snapshot.pending_presentations.is_empty() {
            for pending in &snapshot.pending_presentations {
                kernel.settle_presentation(pending.event_id)?;
            }
            continue;
        }
        let step = if let Some(pending) = snapshot.pending_platform.first() {
            assert_request_title_read_reissues(&snapshot, &pending.effect, content.clone())?;
            *kernel = restore(snapshot.clone(), content.clone())?;
            match &pending.effect {
                GamePlatformEffectV2::CurrentFriendshipClock { request } => {
                    kernel.apply_current_utc_clock_result(request.request, 1783641600000)?
                }
                GamePlatformEffectV2::CurrentAchievementClock { request } => {
                    assert_eq!(request.achievement, K::RealisticFlash);
                    assert!(!clock_seen);
                    clock_seen = true;
                    accept_flash_test_clock(&mut kernel, request)?
                }
                GamePlatformEffectV2::CurrentFlashEgg { request } => {
                    assert!(clock_seen && !egg_seen);
                    egg_seen = true;
                    let step = accept_flash_test_egg(&mut kernel, request)?;
                    assert_flash_completed_request_below_frontier(&kernel, content.clone())?;
                    step
                }
                _ => return Err("unexpected request in actual Flash path".into()),
            }
        } else {
            kernel.advance_time(SafeU53::ZERO)?
        };
        let material = accept_material(&mut live, &mut ledger, &kernel, content.as_ref(), &step)?;
        if let Ok(reward) = current_reward(kernel.state().ok_or("reward state absent")?) {
            assert_eq!(
                material.transition().rng_audit,
                reward.rng_audit,
                "RewardBegin common material owns the complete generation audit"
            );
        }
    }
    Err("actual Flash path failed to reach bounded reward frontier".into())
}

#[inline(never)]
fn assert_flash_completed_request_below_frontier(
    kernel: &GameKernelV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<()> {
    let mut forged = kernel.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut forged.lifecycle else {
        return Err("active completed Flash state absent".into());
    };
    let frontier = state.identities.next_platform_request_id;
    let input = state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.iter_mut().find_map(|p| p.victory_tail.as_mut()))
        .and_then(|t| t.flash.as_mut())
        .and_then(|f| f.completed_input.as_mut())
        .ok_or("actual completed Flash input absent")?;
    input.request = er_types::PlatformRequestId::new(frontier);
    assert!(
        restore(forged, content).is_err(),
        "completed Flash input must precede the allocated request frontier"
    );
    Ok(())
}

#[inline(never)]
fn accept_flash_test_clock(
    kernel: &mut GameKernelV7,
    request: &er_state::current_achievement_execution::CurrentAchievementClockRequestV1,
) -> Result<GameKernelStepV7> {
    let rejected = kernel.snapshot()?;
    assert!(
        kernel
            .apply_current_utc_clock_result(request.request, 8_640_000_000_000_001)
            .is_err()
    );
    assert_eq!(kernel.snapshot()?, rejected);
    let step = kernel.apply_current_utc_clock_result(request.request, 0)?;
    let after = kernel.snapshot()?;
    assert!(
        kernel
            .apply_current_utc_clock_result(request.request, 0)
            .is_err()
    );
    assert_eq!(kernel.snapshot()?, after);
    assert!(
        kernel
            .state()
            .and_then(|s| s.current_friendship_profile.as_ref())
            .and_then(|p| p.egg_account.as_ref())
            .ok_or("egg account absent")?
            .eggs
            .is_empty()
    );
    Ok(step)
}

#[inline(never)]
fn accept_flash_test_egg(
    kernel: &mut GameKernelV7,
    request: &er_state::current_achievement_execution::CurrentFlashEggRequestV1,
) -> Result<GameKernelStepV7> {
    use er_state::current_achievement_execution::{CurrentFlashEggInputsV1, CurrentUnseededUnitV1};
    let units = [0.0f64, 0.125, 0.5, 0.875, 1.0 - f64::EPSILON];
    let input = CurrentFlashEggInputsV1 {
        request: request.request,
        pending: request.pending,
        seed_draws: std::array::from_fn(|i| CurrentUnseededUnitV1 {
            ieee754_bits: format!("{:016x}", units[i % 5].to_bits()),
        }),
        id_draw: CurrentUnseededUnitV1 {
            ieee754_bits: format!("{:016x}", units[4].to_bits()),
        },
        egg_utc_milliseconds: 1783641600006,
    };
    let mut invalid = input.clone();
    invalid.id_draw.ieee754_bits = "3ff0000000000000".into();
    let rejected = kernel.snapshot()?;
    assert!(kernel.apply_current_flash_egg_inputs(invalid).is_err());
    assert_eq!(kernel.snapshot()?, rejected);
    let step = kernel.apply_current_flash_egg_inputs(input.clone())?;
    let after = kernel.snapshot()?;
    assert!(kernel.apply_current_flash_egg_inputs(input).is_err());
    assert_eq!(kernel.snapshot()?, after);
    Ok(step)
}

#[inline(never)]
fn current_reward(
    state: &GameStateV6,
) -> Result<&er_state::current_reward_selection::CurrentRewardSelectionV1> {
    state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.pending.first())
        .and_then(|p| p.victory_tail.as_ref())
        .and_then(|tail| tail.reward.as_deref())
        .ok_or_else(|| "actual reward receipt absent".into())
}

// Same controlled combat and original seed. The test consumes the actual menu;
// it never rewrites RNG, filters production offers, or searches alternate seeds.
#[inline(never)]
fn assert_current_reward_choice_and_pick(
    kernel: &mut GameKernelV7,
    content: Arc<PreparedGameContentV2>,
    live: &mut Option<GameStateV6>,
    ledger: &mut AppliedGameMaterialLedgerV1,
) -> Result<()> {
    use er_state::current_reward_selection::CurrentRewardStageV1 as Stage;
    let checkpoint = Box::new(kernel.snapshot()?);
    let selected = current_reward(active(&checkpoint)?)?.clone();
    assert!(matches!(selected.stage, Stage::Choice));
    assert!((1..=3).contains(&selected.offers.len()));
    assert!(!selected.rng_audit.is_empty());
    assert!(selected.rng_audit.len() <= 4096);
    for draw in &selected.rng_audit {
        draw.validate()?;
    }
    assert_eq!(
        selected
            .rng_audit
            .last()
            .ok_or("reward audit absent")?
            .after_state
            .run
            .state_string,
        selected.rng_after
    );
    *kernel = restore(*checkpoint.clone(), content.clone())?;
    assert_eq!(
        canonical_bytes(&kernel.snapshot()?)?,
        canonical_bytes(&*checkpoint)?
    );
    assert_reward_forgery_rejected(&checkpoint, content.clone(), false)?;
    assert_reward_forgery_rejected(&checkpoint, content.clone(), true)?;
    for pending in kernel.snapshot()?.pending_presentations {
        kernel.settle_presentation(pending.event_id)?;
    }
    let frozen = canonical_bytes(kernel.state().ok_or("reward state absent")?)?;
    for _ in 0..3 {
        let unchanged = kernel.advance_time(SafeU53::ZERO)?;
        assert!(
            !unchanged
                .effects
                .iter()
                .any(|e| matches!(e, GameKernelEffectV7::AuthorityMaterial { .. })),
            "waiting at Choice must not redraw or grant"
        );
        assert_eq!(
            canonical_bytes(kernel.state().ok_or("reward state absent")?)?,
            frozen
        );
        assert_eq!(
            current_reward(kernel.state().ok_or("reward state absent")?)?,
            &selected
        );
    }
    let pokemon = &selected.party_before[0];
    let index = selected.offers.iter().position(|offer| {
        offer.args.is_none()
            && match offer.source_id.as_str() {
                "POKEBALL" | "GREAT_BALL" | "ULTRA_BALL" | "ROGUE_BALL" | "MASTER_BALL"
                | "LURE" | "SUPER_LURE" | "MAX_LURE" => true,
                "POTION" | "SUPER_POTION" | "HYPER_POTION" | "MAX_POTION" => {
                    pokemon.hp > 0 && pokemon.hp < pokemon.max_hp
                }
                _ => false,
            }
    });
    let Some(index) = index else {
        eprintln!(
            "M9_REWARD_CHOICE_ONLY: fixed controlled seed produced {:?}; selected descendants remain unsupported",
            selected
                .offers
                .iter()
                .map(|offer| offer.source_id.as_str())
                .collect::<Vec<_>>()
        );
        return Ok(());
    };
    let option=kernel.current_control().and_then(|c|c.menu.as_ref()).and_then(|menu|menu.options.iter().find(|row|
        matches!(&row.action,er_types::GameActionV1::Reward{action:er_types::RewardActionV1::Select{option_ordinal}} if *option_ordinal==index as u32)))
        .ok_or("actual reward option absent")?.option_id.as_str().to_owned();
    navigate(kernel, &option)?;
    // Raw navigation is presentation-only; the common material starts from the
    // same authoritative state, not the local highlighted menu cursor.
    let before_live = Box::new(live.clone());
    let before_ledger = ledger.clone();
    let step = press(kernel, PhysicalKey::Space)?;
    let mut accepted = accept_material(live, ledger, kernel, content.as_ref(), &step)?;
    assert_reward_material_forgery_rejected(
        &before_live,
        &before_ledger,
        content.as_ref(),
        &accepted,
    )?;
    if matches!(
        current_reward(kernel.state().ok_or("reward state absent")?)?.stage,
        Stage::Holder { .. }
    ) {
        for pending in kernel.snapshot()?.pending_presentations {
            kernel.settle_presentation(pending.event_id)?;
        }
        let holder_checkpoint = Box::new(kernel.snapshot()?);
        *kernel = restore(*holder_checkpoint.clone(), content.clone())?;
        assert_eq!(
            canonical_bytes(&kernel.snapshot()?)?,
            canonical_bytes(&*holder_checkpoint)?
        );
        let before_live = Box::new(live.clone());
        let before_ledger = ledger.clone();
        let step = press(kernel, PhysicalKey::Space)?;
        accepted = accept_material(live, ledger, kernel, content.as_ref(), &step)?;
        assert_reward_material_forgery_rejected(
            &before_live,
            &before_ledger,
            content.as_ref(),
            &accepted,
        )?;
    }
    let after = Box::new(kernel.snapshot()?);
    let reward = current_reward(active(&after)?)?;
    assert!(matches!(reward.stage,Stage::Applied{offer,..} if usize::from(offer)==index));
    assert_eq!(reward.offers, selected.offers);
    assert_eq!(
        reward.rng_audit, selected.rng_audit,
        "selection must not consume generation RNG again"
    );
    assert_eq!(reward.party_before, selected.party_before);
    assert_eq!(reward.run_before, selected.run_before);
    assert_reward_effect(active(&after)?, &selected, index)?;
    let settled = canonical_bytes(live)?;
    let settled_ledger = ledger.clone();
    assert_eq!(
        apply_game_material_v6(live, ledger, content.as_ref(), &accepted.canonical_bytes()?)?,
        er_game::m9e_material_v6::GameMaterialApplyOutcomeV6::DuplicateApplied
    );
    assert_eq!(canonical_bytes(live)?, settled);
    assert_eq!(*ledger, settled_ledger);
    let restored = restore(*after, content.clone())?;
    assert_eq!(
        canonical_bytes(restored.state().ok_or("restored reward absent")?)?,
        canonical_bytes(kernel.state().ok_or("reward absent")?)?
    );
    let before_again = canonical_bytes(kernel.state().ok_or("reward absent")?)?;
    let again = press(kernel, PhysicalKey::Space)?;
    assert!(
        !again
            .effects
            .iter()
            .any(|e| matches!(e, GameKernelEffectV7::AuthorityMaterial { .. }))
    );
    assert_eq!(
        canonical_bytes(kernel.state().ok_or("reward absent")?)?,
        before_again,
        "Applied reward cannot be selected a second time"
    );
    Ok(())
}

#[inline(never)]
fn assert_reward_forgery_rejected(
    checkpoint: &CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
    alter_rng: bool,
) -> Result<()> {
    let mut forged = Box::new(checkpoint.clone());
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut forged.lifecycle else {
        return Err("reward state absent".into());
    };
    let reward = state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.first_mut())
        .and_then(|p| p.victory_tail.as_mut())
        .and_then(|t| t.reward.as_mut())
        .ok_or("reward absent")?;
    if alter_rng {
        let draw = reward.rng_audit.first_mut().ok_or("reward audit absent")?;
        assert!(draw.before_state.battle.is_some() && draw.after_state.battle.is_some());
        draw.before_state.battle = None;
        draw.after_state.battle = None;
        draw.before_fingerprint = er_rng::audit::rng_state_fingerprint(&draw.before_state)?;
        draw.after_fingerprint = er_rng::audit::rng_state_fingerprint(&draw.after_state)?;
        draw.validate()?;
    } else {
        reward.offers[0].name.push_str(" forged");
    }
    assert!(
        restore(*forged, content).is_err(),
        "restore must regenerate full names/identities, not trust snapshot offers"
    );
    Ok(())
}

#[inline(never)]
fn assert_reward_material_forgery_rejected(
    before: &Option<GameStateV6>,
    ledger: &AppliedGameMaterialLedgerV1,
    content: &PreparedGameContentV2,
    material: &GameMaterialV6,
) -> Result<()> {
    let mut forged = material.clone();
    let transition = match &mut forged {
        GameMaterialV6::NewRun(t)
        | GameMaterialV6::BattleTurn(t)
        | GameMaterialV6::BattleReplacement(t)
        | GameMaterialV6::GameAction(t)
        | GameMaterialV6::Terminal(t) => t,
    };
    transition.accepted_action = Some(er_types::GameActionV1::Reward {
        action: er_types::RewardActionV1::Select {
            option_ordinal: u32::MAX,
        },
    });
    let mut live = before.clone();
    let mut candidate_ledger = ledger.clone();
    assert!(
        apply_game_material_v6(
            &mut live,
            &mut candidate_ledger,
            content,
            &canonical_bytes(&forged)?
        )
        .is_err(),
        "otherwise identical material cannot nominate a different hidden ordinal"
    );
    assert_eq!(live, *before);
    assert_eq!(candidate_ledger, *ledger);
    Ok(())
}

#[inline(never)]
fn assert_reward_effect(
    state: &GameStateV6,
    before: &er_state::current_reward_selection::CurrentRewardSelectionV1,
    index: usize,
) -> Result<()> {
    let run = state.active_run.as_ref().ok_or("reward run absent")?;
    let owned = state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.source_progression.as_ref())
        .and_then(|s| s.reward_run.as_ref())
        .ok_or("owned reward inventory absent")?;
    let id = before.offers[index].source_id.as_str();
    let ball = match id {
        "POKEBALL" => Some(0),
        "GREAT_BALL" => Some(1),
        "ULTRA_BALL" => Some(2),
        "ROGUE_BALL" => Some(3),
        "MASTER_BALL" => Some(4),
        _ => None,
    };
    if let Some(ball) = ball {
        let mut expected = before.run_before.clone();
        expected.balls[ball] = (expected.balls[ball] + if ball == 4 { 1 } else { 5 }).min(99);
        assert_eq!(*owned, expected);
        assert_eq!(run.party, before.party_before);
    } else if matches!(id, "LURE" | "SUPER_LURE" | "MAX_LURE") {
        let duration = match id {
            "LURE" => 10,
            "SUPER_LURE" => 15,
            _ => 30,
        };
        assert_eq!(owned.balls, before.run_before.balls);
        assert_eq!(owned.map_owned, before.run_before.map_owned);
        assert_eq!(
            owned.lures,
            vec![er_state::current_reward_run::CurrentRewardLureV1 {
                duration,
                remaining: duration
            }]
        );
        assert_eq!(
            run.party, before.party_before,
            "Lure is a run modifier, not a Pokemon mutation"
        );
    } else {
        let mut expected = before.party_before.clone();
        let p = &mut expected[0];
        let (points, percent) = match id {
            "POTION" => (20_u64, 10_u64),
            "SUPER_POTION" => (50, 25),
            "HYPER_POTION" => (200, 50),
            "MAX_POTION" => (0, 100),
            _ => return Err("unexpected supported reward".into()),
        };
        let amount = (u64::from(p.max_hp) * percent / 100).max(points).max(1);
        p.hp = (u64::from(p.hp) + amount).min(u64::from(p.max_hp)) as u32;
        assert_eq!(run.party, expected);
        assert_eq!(owned, &before.run_before);
    }
    Ok(())
}

#[inline(never)]
fn assert_source_counter_checkpoint(
    kernel: &GameKernelV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<()> {
    let checkpoint = Box::new(kernel.snapshot()?);
    let state = active(&checkpoint)?;
    let source = state
        .current_battle_participation
        .as_ref()
        .and_then(|owner| owner.experience.as_ref())
        .and_then(|owner| owner.source_progression.as_ref())
        .ok_or("source provenance absent")?;
    let counts = source
        .turn_progress
        .as_ref()
        .ok_or("source counters absent")?;
    assert_eq!(counts.turn.get().get(), 1);
    assert!(counts.pokemon.iter().all(|row| row.turn_count.get() == 1
        && row.wave_turn_count.get() == 1
        && row.damage_taken == SafeU53::ZERO));
    assert_counter_restore_rejects(&checkpoint, content.clone(), false)?;
    assert_counter_restore_rejects(&checkpoint, content, true)?;
    Ok(())
}

#[inline(never)]
fn assert_counter_restore_rejects(
    checkpoint: &CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
    missing: bool,
) -> Result<()> {
    let mut forged = Box::new(checkpoint.clone());
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut forged.lifecycle else {
        return Err("active state absent".into());
    };
    let source = state
        .current_battle_participation
        .as_mut()
        .and_then(|owner| owner.experience.as_mut())
        .and_then(|owner| owner.source_progression.as_mut())
        .ok_or("source provenance absent")?;
    if missing {
        source.turn_progress = None;
    } else {
        source.turn_progress.as_mut().ok_or("counters absent")?.turn =
            er_types::battle_ids::TurnIndex::new(safe(2)?)?;
    }
    assert!(restore(*forged, content).is_err());
    Ok(())
}

#[inline(never)]
fn assert_two_neutral_turns_keep_source_counters() -> Result<()> {
    let content = content()?;
    let mut kernel = controlled_neutral_turns(content.clone())?;
    for expected_turn in [2_u64, 3] {
        let run = kernel
            .state()
            .and_then(|state| state.active_run.as_ref())
            .ok_or("run absent")?;
        let before_hp = [
            run.party[0].hp,
            run.battle.as_ref().ok_or("battle absent")?.enemy_party[0].hp,
        ];
        let (mut live, mut ledger) = admit_knockout(&mut kernel, content.as_ref())?;
        let mut finished = false;
        for _ in 0..32 {
            let turn = kernel
                .state()
                .and_then(|state| state.active_run.as_ref())
                .and_then(|run| run.battle.as_ref())
                .ok_or("battle absent")?
                .turn
                .get()
                .get();
            if turn == expected_turn {
                finished = true;
                break;
            }
            let snapshot = Box::new(kernel.snapshot()?);
            for presentation in &snapshot.pending_presentations {
                kernel.settle_presentation(presentation.event_id)?;
            }
            let step = kernel.advance_time(SafeU53::ZERO)?;
            accept_material(&mut live, &mut ledger, &kernel, content.as_ref(), &step)?;
            kernel = restore_exact_raw_checkpoint(&kernel, content.clone())?;
        }
        assert!(
            finished,
            "neutral source turn did not finish within the watchdog"
        );
        assert_eq!(
            kernel.current_control().map(|control| control.kind),
            Some(GameControlKindV2::BattleCommand)
        );
        let state = kernel.state().ok_or("state absent")?;
        let run = state.active_run.as_ref().ok_or("run absent")?;
        let battle = run.battle.as_ref().ok_or("battle absent")?;
        let counts = state
            .current_battle_participation
            .as_ref()
            .and_then(|owner| owner.experience.as_ref())
            .and_then(|owner| owner.source_progression.as_ref())
            .and_then(|source| source.turn_progress.as_ref())
            .ok_or("source counters absent")?;
        assert_eq!(counts.turn, battle.turn);
        for (index, pokemon) in [&run.party[0], &battle.enemy_party[0]]
            .into_iter()
            .enumerate()
        {
            let row = counts
                .pokemon
                .iter()
                .find(|row| row.pokemon == pokemon.id)
                .ok_or("holder absent")?;
            assert_eq!(row.turn_count.get(), expected_turn);
            assert_eq!(row.wave_turn_count.get(), expected_turn);
            assert_eq!(row.last_reset_turn.get().get(), expected_turn - 1);
            assert_eq!(
                row.damage_taken.get(),
                u64::from(before_hp[index] - pokemon.hp)
            );
            assert!(row.damage_taken.get() > 0);
        }
    }
    Ok(())
}

#[inline(never)]
fn controlled_neutral_turns(content: Arc<PreparedGameContentV2>) -> Result<Box<GameKernelV7>> {
    let mut checkpoint =
        Box::new(controlled_before_knockout(content.clone(), 5, &[33])?.snapshot()?);
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut checkpoint.lifecycle else {
        return Err("active state absent".into());
    };
    let run = state.active_run.as_mut().ok_or("run absent")?;
    run.party[0].stats.attack = 1;
    let enemy = &mut run.battle.as_mut().ok_or("battle absent")?.enemy_party[0];
    enemy.hp = enemy.max_hp;
    state.validate_with(content.as_ref())?;
    Ok(Box::new(restore(*checkpoint, content)?))
}

#[inline(never)]
fn assert_tail_counter_restore_rejects(
    checkpoint: &CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<()> {
    let mut forged = Box::new(checkpoint.clone());
    let GameKernelLifecycleSnapshotV7::Active(state) = &mut forged.lifecycle else {
        return Err("active state absent".into());
    };
    let tail = state
        .current_battle_participation
        .as_mut()
        .and_then(|owner| owner.experience.as_mut())
        .and_then(|owner| owner.pending.first_mut())
        .and_then(|pending| pending.victory_tail.as_mut())
        .ok_or("tail absent")?;
    let counts = tail
        .original_turn_progress
        .as_mut()
        .ok_or("historical counters absent")?;
    assert_eq!(counts.turn.get().get(), 1);
    assert_eq!(counts.pokemon[0].turn_count.get(), 1);
    counts.pokemon[0].turn_count = safe(2)?;
    assert!(restore(*forged, content).is_err());
    Ok(())
}
