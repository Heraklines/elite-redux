//! Actual current kernel/resolver entry witnesses over the shipped content.
//! Natural launch is raw input. Expanded fields, assigned moves/abilities and HP
//! are explicitly controlled same-content mechanics fixtures, not natural roster
//! or full source damage/status/AI-phase parity claims.
use er_battle::current_target_execution::CurrentTargetExecution;
use er_canonical::canonical_bytes;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{GameMaterialV6, apply_game_material_v6};
use er_kernel::game_kernel_v7::{
    FreshFriendshipStartV7, GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::field::{FieldSlotState, FieldState};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics, RunStateV3,
};
use er_state::m9e_state_v6::GameStateV6;

use er_types::battle_ids::{
    AbilityId, BattleFormat, BattleSide, FieldSlot, MoveId, MoveSlotIndex, PokemonId, WaveIndex,
};
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameControlKindV2, SafeU53, SeatId};
use std::{error::Error, sync::Arc};
type Result<T> = std::result::Result<T, Box<dyn Error>>;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("bounded test identity")
}
fn seat() -> SeatId {
    SeatId::new(safe(1))
}
fn slot(side: BattleSide, position: u8) -> FieldSlot {
    FieldSlot { side, position }
}
fn content() -> Result<Arc<PreparedGameContentV2>> {
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(
        serde_json::from_slice::<GameContentBundleV2>(BUNDLE)?,
    ))?))
}
fn profile() -> Result<ProfileStateV1> {
    Ok(ProfileStateV1 {
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
            highest_wave: WaveIndex::new(safe(1))?,
        },
    })
}
fn down(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}
fn press(kernel: &mut GameKernelV7, key: PhysicalKey) -> Result<GameKernelStepV7> {
    let result = kernel.raw_input(down(key.clone()))?;
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
fn natural(content: Arc<PreparedGameContentV2>, index: usize, seed: &str) -> Result<GameKernelV7> {
    let mut kernel = GameKernelV7::natural_start_with_fresh_friendship(FreshFriendshipStartV7 {
        profile: profile()?,
        seed: seed.to_owned(),
        local_seat: seat(),
        save_slots: vec!["target-source-slot".to_owned()],
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
                    .is_some_and(|m| m.key == "CLASSIC")
        })
        .ok_or("ordinary Classic mode absent")?;
    navigate(&mut kernel, &format!("bootstrap/mode/{}", mode.mode.get()))?;
    let entered = press(&mut kernel, PhysicalKey::Space)?;
    let request = entered
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::Platform(
                er_game::m9e_material_v6::GamePlatformEffectV2::StarterPokerusClock {
                    request, ..
                },
            ) => Some(*request),
            _ => None,
        })
        .ok_or("actual StarterSelect clock request absent")?;
    // This is an explicit external UTC sample for the actual emitted request.
    kernel.apply_current_utc_clock_result(request, 0)?;
    let snapshot = kernel.snapshot()?;
    let GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) = snapshot.lifecycle else {
        return Err("starter phase absent".into());
    };
    let starter = content
        .bundle()
        .bootstrap
        .starters
        .get(index)
        .ok_or("source starter absent")?;
    let selected = bootstrap
        .catalog
        .starters
        .iter()
        .find(|row| {
            row.species_id == starter.species_id.get() && row.form_index == starter.form_index
        })
        .ok_or("actual starter owner absent")?;
    navigate(
        &mut kernel,
        &format!("bootstrap/starter/{}", selected.pokemon_id.get()),
    )?;
    press(&mut kernel, PhysicalKey::Space)?;
    navigate(&mut kernel, "bootstrap/starter/confirm")?;
    for _ in 0..4 {
        press(&mut kernel, PhysicalKey::Space)?;
    }
    assert_eq!(
        kernel.current_control().map(|c| c.kind),
        Some(GameControlKindV2::BattleCommand)
    );
    assert!(
        kernel
            .state()
            .ok_or("active state absent")?
            .current_targeting
            .is_some()
    );
    Ok(kernel)
}
fn active(snapshot: &CoreGameKernelSnapshotV7) -> Result<&GameStateV6> {
    match &snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Active(state) => Ok(state),
        _ => Err("active lifecycle required".into()),
    }
}
fn active_mut(snapshot: &mut CoreGameKernelSnapshotV7) -> Result<&mut GameStateV6> {
    match &mut snapshot.lifecycle {
        GameKernelLifecycleSnapshotV7::Active(state) => Ok(state),
        _ => Err("active lifecycle required".into()),
    }
}
fn active_run(state: &GameStateV6) -> Result<&RunStateV3> {
    state.active_run.as_ref().ok_or_else(|| "run absent".into())
}
fn active_run_mut(state: &mut GameStateV6) -> Result<&mut RunStateV3> {
    state.active_run.as_mut().ok_or_else(|| "run absent".into())
}
fn restore(
    snapshot: CoreGameKernelSnapshotV7,
    content: Arc<PreparedGameContentV2>,
) -> Result<GameKernelV7> {
    Ok(GameKernelV7::from_snapshot(
        snapshot,
        seat(),
        GameKernelRoleV7::Authority,
        content,
    )?)
}
fn two_enemies(content: Arc<PreparedGameContentV2>) -> Result<CoreGameKernelSnapshotV7> {
    let mut snapshot = natural(content.clone(), 2, "m9e-defender-ability-27")?.snapshot()?;
    let state = active_mut(&mut snapshot)?;
    let next = state.identities.next_pokemon_id;
    state.identities.next_pokemon_id = safe(next.get().checked_add(1).ok_or("allocator overflow")?);
    let run = active_run_mut(state)?;
    let player = run.party.first().ok_or("player absent")?.id;
    let battle = run.battle.as_mut().ok_or("battle absent")?;
    let mut second = battle.enemy_party.first().ok_or("enemy absent")?.clone();
    second.id = PokemonId::new(next);
    second.hp = 200;
    second.max_hp = 200;
    second.stats.hp = 200;
    battle.enemy_party[0].hp = 200;
    battle.enemy_party[0].max_hp = 200;
    battle.enemy_party[0].stats.hp = 200;
    let first = battle.enemy_party[0].id;
    let other = second.id;
    battle.enemy_party.push(second);
    battle.format = BattleFormat::new(2, 2, vec![])?;
    battle.field = FieldState::new_for_format(
        &battle.format,
        vec![
            FieldSlotState::new(slot(BattleSide::Player, 0), Some(player)),
            FieldSlotState::new(slot(BattleSide::Player, 1), None),
            FieldSlotState::new(slot(BattleSide::Enemy, 0), Some(first)),
            FieldSlotState::new(slot(BattleSide::Enemy, 1), Some(other)),
        ],
    )?;
    // The bounded participation/XP owner only admits a single 1v1 battle; the
    // controlled doubles checkpoint carries no owner rather than a stale roster.
    state.current_battle_participation = None;
    state.current_achievement_tracker.as_mut().ok_or("fresh tracker absent")?.history =
        er_state::current_achievement_tracker::CurrentAchievementHistoryV1::UnobservedMechanicalFixture;
    state.validate_with(content.as_ref())?;
    // This deliberately edited field is a controlled checkpoint, not the state
    // produced by the retained natural bootstrap material. Keep its real next
    // revision but start an empty ledger; never fabricate a matching old digest.
    snapshot.material_ledger = er_game::m9e_material_v6::AppliedGameMaterialLedgerV1::new(
        snapshot.material_ledger.next_authority_revision,
    )?;
    Ok(snapshot)
}
fn assign_move(state: &mut GameStateV6, id: u64) -> Result<()> {
    let player = active_run_mut(state)?
        .party
        .first_mut()
        .ok_or("player absent")?;
    let first = player.moves[0].as_mut().ok_or("move absent")?;
    first.move_id = MoveId::new(safe(id));
    first.pp_used = 0;
    first.pp_ups = 0;
    first.max_pp_override = None;
    Ok(())
}
fn choose_first_move(kernel: &mut GameKernelV7) -> Result<GameKernelStepV7> {
    navigate(kernel, "battle/command/fight")?;
    press(kernel, PhysicalKey::Space)?;
    navigate(kernel, "battle/move/0")?;
    press(kernel, PhysicalKey::Space)
}
fn material(step: &GameKernelStepV7) -> Result<GameMaterialV6> {
    let bytes = step
        .effects
        .iter()
        .find_map(|effect| match effect {
            GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes),
            _ => None,
        })
        .ok_or("actual authority material absent")?;
    Ok(GameMaterialV6::decode(bytes)?)
}

/// Independent common material application starts at the actual command
/// admission frontier. Only the source-owned private canonical control is
/// restored before the raw acceptance; subsequent phase frontiers are exact.
struct MaterialJournal {
    live: Option<GameStateV6>,
    ledger: er_game::m9e_material_v6::AppliedGameMaterialLedgerV1,
    materials: Vec<GameMaterialV6>,
}

impl MaterialJournal {
    fn before_command(snapshot: &CoreGameKernelSnapshotV7) -> Result<Self> {
        let mut state = active(snapshot)?.clone();
        active_run_mut(&mut state)?.control = snapshot
            .private_battle_control
            .as_ref()
            .ok_or("actual private command owner absent")?
            .canonical_control
            .clone();
        Ok(Self {
            live: Some(state),
            ledger: snapshot.material_ledger.clone(),
            materials: Vec::new(),
        })
    }

    fn accept(
        &mut self,
        kernel: &GameKernelV7,
        content: &PreparedGameContentV2,
        step: &GameKernelStepV7,
    ) -> Result<()> {
        let emitted: Vec<_> = step
            .effects
            .iter()
            .filter_map(|effect| match effect {
                GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes),
                _ => None,
            })
            .collect();
        assert_eq!(
            emitted.len(),
            1,
            "one actual transaction per public phase entry"
        );
        assert!(
            step.effects.iter().all(|effect| !matches!(
                effect,
                GameKernelEffectV7::Platform(_) | GameKernelEffectV7::Terminal(_)
            )),
            "this non-fainting ordinary turn must not fabricate a clock/reward callback"
        );
        let proof = material(step)?;
        assert_eq!(proof.canonical_bytes()?, *emitted[0]);
        let presentations: Vec<_> = step
            .effects
            .iter()
            .filter_map(|effect| match effect {
                GameKernelEffectV7::Presentation(effect) => Some(effect.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(presentations, proof.transition().presentation);
        let outcome =
            apply_game_material_v6(&mut self.live, &mut self.ledger, content, emitted[0])?;
        assert_eq!(
            outcome,
            er_game::m9e_material_v6::GameMaterialApplyOutcomeV6::Applied
        );
        assert_eq!(self.live.as_ref(), kernel.state());
        assert_eq!(self.ledger, kernel.snapshot()?.material_ledger);
        self.materials.push(proof);
        Ok(())
    }

    fn settle_actual_presentations(&self, kernel: &mut GameKernelV7) -> Result<()> {
        let pending = kernel.snapshot()?.pending_presentations;
        for presentation in pending {
            kernel.settle_presentation(presentation.event_id)?;
            assert_eq!(self.live.as_ref(), kernel.state());
            assert_eq!(self.ledger, kernel.snapshot()?.material_ledger);
        }
        assert!(kernel.snapshot()?.pending_presentations.is_empty());
        Ok(())
    }

    fn drain_non_fainting_turn(
        &mut self,
        kernel: &mut GameKernelV7,
        content: &PreparedGameContentV2,
    ) -> Result<()> {
        use er_state::current_turn_execution::CurrentTurnStageV1;
        let turn = kernel
            .state()
            .and_then(|state| state.current_turn_execution.as_ref())
            .ok_or("raw acceptance did not retain the actual turn")?;
        assert_eq!(turn.stage, CurrentTurnStageV1::ReadyForMove);
        let remaining = turn
            .actions
            .len()
            .checked_sub(usize::from(turn.next_action))
            .ok_or("invalid retained action cursor")?;
        // Exactly the retained action count plus its one real finish phase. No
        // guessed polling bound, unsolicited clock or manufactured gameplay.
        let phase_count = remaining.checked_add(1).ok_or("phase count overflow")?;
        for _ in 0..phase_count {
            self.settle_actual_presentations(kernel)?;
            let turn = kernel
                .state()
                .and_then(|state| state.current_turn_execution.as_ref())
                .ok_or("turn finished before its actual action count")?;
            assert_eq!(turn.stage, CurrentTurnStageV1::ReadyForMove);
            let step = kernel.advance_time(SafeU53::ZERO)?;
            self.accept(kernel, content, &step)?;
            assert!(
                self.materials
                    .last()
                    .ok_or("phase material absent")?
                    .transition()
                    .accepted_action
                    .is_none()
            );
        }
        self.settle_actual_presentations(kernel)?;
        assert!(
            kernel
                .state()
                .ok_or("active state absent")?
                .current_turn_execution
                .is_none()
        );
        assert_eq!(
            kernel.current_control().map(|control| control.kind),
            Some(GameControlKindV2::BattleCommand)
        );
        assert_eq!(
            self.materials.len(),
            phase_count.checked_add(1).ok_or("receipt count overflow")?
        );
        Ok(())
    }
}

use er_battle::m7_resolver::query_simulated_move_damage_with_current_targets;
use er_game::m9e_material_v6::GamePresentationPayloadV1;

fn only_move(pokemon: &mut er_state::m7_state::PokemonStateV5, id: u64) -> Result<()> {
    let mut first = pokemon.moves[0].ok_or("actual move slot absent")?;
    first.move_id = MoveId::new(safe(id));
    first.pp_used = 0;
    first.pp_ups = 0;
    first.max_pp_override = None;
    pokemon.moves = [Some(first), None, None, None];
    Ok(())
}

fn assert_controlled_withdraw(content: &PreparedGameContentV2) -> Result<()> {
    use er_types::battle_model::{MoveAccuracy, MoveCategory, MovePower, MoveTarget};
    let definition = content.battle.move_definition(MoveId::new(safe(110)))?;
    assert_eq!(definition.category, MoveCategory::Status);
    assert_eq!(definition.power, MovePower::None);
    assert_eq!(definition.target, MoveTarget::User);
    assert_eq!(definition.accuracy, MoveAccuracy::AlwaysHits);
    Ok(())
}

#[test]
fn actual_poison_redirect_absorbs_with_ordered_payload_and_material_conservation() -> Result<()> {
    let content = content()?;
    assert_controlled_withdraw(content.as_ref())?;
    for (hp, expected) in [(6, 9), (13, 13)] {
        let mut snapshot = two_enemies(content.clone())?;
        let state = active_mut(&mut snapshot)?;
        assign_move(state, 40)?;
        let run = active_run_mut(state)?;
        run.party[0].abilities.active = AbilityId::new(safe(0));
        run.party[0].abilities.passives = [None, None, None];
        let battle = run.battle.as_mut().ok_or("battle absent")?;
        for enemy in &mut battle.enemy_party {
            enemy.abilities.active = AbilityId::new(safe(0));
            enemy.abilities.passives = [None, None, None];
            only_move(enemy, 110)?; // Actual source Withdraw is USER; no incoming damage.
        }
        let holder = battle.enemy_party[0].id;
        battle.enemy_party[0].abilities.active = AbilityId::new(safe(5082));
        battle.enemy_party[0].max_hp = 13;
        battle.enemy_party[0].stats.hp = 13;
        battle.enemy_party[0].hp = hp;
        state.validate_with(content.as_ref())?;
        let mut kernel = restore(snapshot, content.clone())?;
        choose_first_move(&mut kernel)?;
        navigate(&mut kernel, "battle/target/1")?;
        let before = kernel.snapshot()?;
        let mut journal = MaterialJournal::before_command(&before)?;
        let before_state = journal
            .live
            .as_ref()
            .ok_or("command frontier absent")?
            .clone();
        let step = press(&mut kernel, PhysicalKey::Space)?;
        let proof = material(&step)?;
        assert!(matches!(proof.transition().accepted_action,
            Some(er_types::GameActionV1::Battle {
                action: er_types::BattleUiActionV1::SelectMoveTarget { target, move_slot, .. }
            }) if target == slot(BattleSide::Enemy, 1) && move_slot.get() == 0));
        journal.accept(&kernel, content.as_ref(), &step)?;
        journal
            .drain_non_fainting_turn(&mut kernel, content.as_ref())
            .map_err(|error| format!("defender retained turn drain: {error}"))?;
        let after = kernel.state().ok_or("current state absent")?;
        let enemies = &active_run(after)?
            .battle
            .as_ref()
            .ok_or("battle absent")?
            .enemy_party;
        assert_eq!(enemies[0].hp, expected);
        assert_eq!(enemies[1].hp, 200);
        // Source hitCheck returns immunity before accuracy; immune attacks never
        // enter critical/damage/secondary draws. Both other moves target USER.
        assert!(
            journal
                .materials
                .iter()
                .flat_map(|proof| &proof.transition().rng_audit)
                .all(|draw| !matches!(
                    draw.reason,
                    er_rng::audit::RngReason::Accuracy
                        | er_rng::audit::RngReason::CriticalHit
                        | er_rng::audit::RngReason::DamageVariance
                        | er_rng::audit::RngReason::SecondaryEffect
                ))
        );
        let old_pp = active_run(&before_state)?.party[0].moves[0]
            .as_ref()
            .ok_or("accepted move absent")?
            .pp_used;
        assert_eq!(
            active_run(after)?.party[0].moves[0]
                .as_ref()
                .ok_or("accepted move absent")?
                .pp_used,
            old_pp.checked_add(1).ok_or("PP overflow")?
        );
        let payloads: Vec<_> = journal
            .materials
            .iter()
            .flat_map(|proof| &proof.transition().presentation)
            .filter_map(|effect| effect.payload.clone())
            .collect();
        let mut expected_payloads = vec![GamePresentationPayloadV1::AbilityShown {
            holder,
            ability: AbilityId::new(safe(5082)),
            innate_slot: None,
        }];
        if hp < 13 {
            expected_payloads.push(GamePresentationPayloadV1::HpRestored {
                holder,
                before: hp,
                after: expected,
                requested_heal: 3,
            });
        }
        expected_payloads.push(GamePresentationPayloadV1::AbilityHidden {
            holder,
            ability: AbilityId::new(safe(5082)),
            innate_slot: None,
        });
        if hp == 13 {
            expected_payloads.push(GamePresentationPayloadV1::MoveNoEffect {
                holder,
                move_id: MoveId::new(safe(40)),
            });
        }
        assert_eq!(payloads, expected_payloads);
        let tracked = after
            .current_defender_dispatch
            .as_ref()
            .ok_or("tracked dispatch absent")?;
        tracked.validate(active_run(after)?)?;
        assert_eq!(tracked.holders.len(), 1);
        assert_eq!(tracked.holders[0].pokemon, holder);
        assert!(tracked.holders[0].wave_observed && tracked.holders[0].summon_observed);
        let tracked_bytes = canonical_bytes(tracked)?;
        let live_run = active_run(after)?;
        use er_state::current_defender_dispatch::{
            CurrentDefenderDispatchV1, CurrentDefenderObservationV1,
        };
        let empty = CurrentDefenderDispatchV1::observe(
            Some(tracked),
            live_run,
            live_run,
            &tracked.last_action.operation_id,
            tracked.last_action.authority_revision,
            &[],
        )?
        .ok_or("empty chunk lost tracked owner")?;
        assert_eq!(canonical_bytes(&empty)?, tracked_bytes);
        let repeated = CurrentDefenderDispatchV1::observe(
            Some(tracked),
            live_run,
            live_run,
            &tracked.last_action.operation_id,
            tracked.last_action.authority_revision,
            &[CurrentDefenderObservationV1::Applied {
                ordinal: 0,
                holder,
                innate_slot: None,
            }],
        );
        assert!(repeated.is_err());
        assert_eq!(canonical_bytes(tracked)?, tracked_bytes);
        assert_eq!(journal.live.as_ref(), Some(after));
        assert_eq!(journal.ledger, kernel.snapshot()?.material_ledger);
        let save = GameSaveV2::new(after.content_identity.clone(), safe(1), after.clone())?;
        assert_eq!(GameSaveV2::decode(&save.encode()?)?.state, *after);
        assert_eq!(
            canonical_bytes(&restore(kernel.snapshot()?, content.clone())?.snapshot()?)?,
            canonical_bytes(&kernel.snapshot()?)?
        );
        let actual_snapshot = kernel.snapshot()?;
        let actual_bytes = canonical_bytes(&actual_snapshot)?;
        let next_control_revision = active_run(after)?.control.revision;
        let future_revision = safe(
            next_control_revision
                .get()
                .checked_add(1)
                .ok_or("control revision overflow")?,
        );
        for forged_revision in [next_control_revision, future_revision] {
            let mut forged = actual_snapshot.clone();
            active_mut(&mut forged)?
                .current_defender_dispatch
                .as_mut()
                .ok_or("actual tracked dispatch absent")?
                .last_action
                .authority_revision = forged_revision;
            assert!(
                restore(forged, content.clone()).is_err(),
                "a receipt must precede the actual installed control revision"
            );
            assert_eq!(canonical_bytes(&kernel.snapshot()?)?, actual_bytes);
        }
    }
    assert_actual_spread_hit_check_order(content.clone())?;
    assert_unsupported_source_hit_mode_preserves_checkpoint(content)?;
    Ok(())
}

fn assert_actual_spread_hit_check_order(content: Arc<PreparedGameContentV2>) -> Result<()> {
    use er_rng::audit::RngReason;
    use er_types::battle_model::{MoveAccuracy, MoveCategory, MovePower};
    let definition = content.battle.move_definition(MoveId::new(safe(57)))?;
    // Effective initialized source metadata is independently observed by the
    // same 27-move source prerequisite; no synthetic accuracy/program fixture.
    assert_eq!(definition.accuracy, MoveAccuracy::Percent(100));
    assert_eq!(definition.category, MoveCategory::Special);
    assert_eq!(definition.power, MovePower::Value(90));
    let mut snapshot = two_enemies(content.clone())?;
    let state = active_mut(&mut snapshot)?;
    assign_move(state, 57)?;
    let run = active_run_mut(state)?;
    run.party[0].abilities.active = AbilityId::new(safe(0));
    run.party[0].abilities.passives = [None, None, None];
    run.party[0].stats.special_attack = 1;
    for enemy in &mut run.battle.as_mut().ok_or("battle absent")?.enemy_party {
        enemy.abilities.active = AbilityId::new(safe(0));
        enemy.abilities.passives = [None, None, None];
        enemy.stats.special_defense = 1000;
        only_move(enemy, 110)?;
    }
    state.validate_with(content.as_ref())?;
    let mut kernel = restore(snapshot, content.clone())?;
    navigate(&mut kernel, "battle/command/fight")?;
    press(&mut kernel, PhysicalKey::Space)?;
    navigate(&mut kernel, "battle/move/0")?;
    let mut journal = MaterialJournal::before_command(&kernel.snapshot()?)?;
    let step = press(&mut kernel, PhysicalKey::Space)?;
    assert!(matches!(
        material(&step)?.transition().accepted_action,
        Some(er_types::GameActionV1::Battle { .. })
    ));
    assert_current_damage_observations(
        kernel.state().ok_or("begun state absent")?,
        content.as_ref(),
    )?;
    journal.accept(&kernel, content.as_ref(), &step)?;
    journal
        .drain_non_fainting_turn(&mut kernel, content.as_ref())
        .map_err(|error| format!("defender retained turn drain: {error}"))?;
    let reasons: Vec<_> = journal
        .materials
        .iter()
        .flat_map(|proof| &proof.transition().rng_audit)
        .filter_map(|draw| match draw.reason {
            RngReason::Accuracy => Some("accuracy"),
            RngReason::CriticalHit => Some("critical"),
            RngReason::DamageVariance => Some("variance"),
            RngReason::SecondaryEffect => Some("secondary"),
            _ => None,
        })
        .collect();
    assert_eq!(
        reasons,
        vec![
            "accuracy", "accuracy", "critical", "variance", "critical", "variance"
        ]
    );
    let after = kernel.state().ok_or("after state absent")?;
    assert!(
        active_run(after)?
            .battle
            .as_ref()
            .ok_or("battle absent")?
            .enemy_party
            .iter()
            .all(|enemy| enemy.hp > 0 && enemy.hp < 200)
    );
    assert!(after.current_defender_dispatch.is_none());
    Ok(())
}

fn assert_current_damage_observations(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<()> {
    use er_battle::m7_resolver::{TurnAuthorityContextV1, step_current_turn};
    use er_state::current_battle_source_events::{
        CurrentBattleSourceEventV1, CurrentHitCheckV1, CurrentMoveUseModeV1,
    };
    use er_state::m7_state::{GAME_STATE_SCHEMA_VERSION_V5, GameStateV5};
    use er_types::GameContentIdentity;
    let immutable = canonical_bytes(state)?;
    let mut owner = state
        .current_turn_execution
        .clone()
        .ok_or("actual begun turn absent")?;
    let mut before = GameStateV5 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V5,
        content_identity: GameContentIdentity {
            oracle_sha: state.content_identity.oracle_sha.clone(),
            content_hash: state.content_identity.bundle_hash.clone(),
            battle_content_hash: state.content_identity.battle_hash.clone(),
            semantic_catalog_hash: state.content_identity.semantic_catalog_hash.clone(),
        },
        profile: state.profile.clone(),
        active_run: state.active_run.clone(),
    };
    let authority = TurnAuthorityContextV1 {
        authority_seat: owner.authority,
        revision: owner.authority_revision,
    };
    let targeting = CurrentTargetExecution::from_state(state)?;
    let mut saw_spread = false;
    while usize::from(owner.next_action) < owner.actions.len() {
        let chunk = step_current_turn(&before, &owner, &content.battle, &authority, &targeting)?;
        let events = chunk
            .transition
            .source_events
            .as_ref()
            .ok_or("owned current observations absent")?;
        if let Some(CurrentBattleSourceEventV1::MoveResolution {
            move_id,
            targets,
            first_hit,
            use_mode,
            ..
        }) = events.first()
            && *move_id == MoveId::new(safe(57))
        {
            assert!(!saw_spread);
            saw_spread = true;
            assert!(*first_hit);
            assert_eq!(*use_mode, CurrentMoveUseModeV1::Direct);
            assert_eq!(targets.len(), 2);
            assert_eq!(
                targets.iter().map(|row| row.slot).collect::<Vec<_>>(),
                vec![slot(BattleSide::Enemy, 0), slot(BattleSide::Enemy, 1)]
            );
            assert!(
                targets
                    .iter()
                    .all(|row| row.result == CurrentHitCheckV1::Hit)
            );
            assert_eq!(events.len(), 3);
            for (event, resolved) in events[1..].iter().zip(targets) {
                let CurrentBattleSourceEventV1::MoveDamage {
                    target,
                    target_slot,
                    damage,
                    target_hp_before,
                    target_hp_after,
                    hit_count,
                    hits_left,
                    move_id,
                    ..
                } = event
                else {
                    return Err("resolution must precede actual damage hooks".into());
                };
                assert_eq!(*target, resolved.target);
                assert_eq!(*target_slot, resolved.slot);
                assert_eq!(*move_id, MoveId::new(safe(57)));
                assert_eq!((*hit_count, *hits_left), (1, 1));
                assert!(*damage > 0);
                assert_eq!(
                    *damage,
                    target_hp_before
                        .checked_sub(*target_hp_after)
                        .ok_or("negative actual damage")?
                );
                let live = er_battle::current_target_execution::find_pokemon(
                    chunk
                        .transition
                        .after_state
                        .active_run
                        .as_ref()
                        .ok_or("after run absent")?,
                    *target,
                )
                .ok_or("actual damage target absent")?;
                assert_eq!(live.hp, *target_hp_after);
            }
        }
        before = chunk.transition.after_state;
        owner = chunk.continuation;
    }
    assert!(saw_spread);
    assert_eq!(canonical_bytes(state)?, immutable);
    Ok(())
}

fn assert_unsupported_source_hit_mode_preserves_checkpoint(
    content: Arc<PreparedGameContentV2>,
) -> Result<()> {
    let mut snapshot = two_enemies(content.clone())?;
    let state = active_mut(&mut snapshot)?;
    assign_move(state, 61)?; // Actual initialized Bubble Beam has MultiHitAttr.
    let run = active_run_mut(state)?;
    run.party[0].stats.speed = 1000;
    run.party[0].abilities.active = AbilityId::new(safe(0));
    run.party[0].abilities.passives = [None, None, None];
    for enemy in &mut run.battle.as_mut().ok_or("battle absent")?.enemy_party {
        enemy.stats.speed = 1;
        enemy.abilities.active = AbilityId::new(safe(0));
        enemy.abilities.passives = [None, None, None];
        only_move(enemy, 110)?;
    }
    state.validate_with(content.as_ref())?;
    let mut kernel = restore(snapshot, content.clone())?;
    choose_first_move(&mut kernel)?;
    navigate(&mut kernel, "battle/target/0")?;
    let mut journal = MaterialJournal::before_command(&kernel.snapshot()?)?;
    let step = press(&mut kernel, PhysicalKey::Space)?;
    assert!(matches!(
        material(&step)?.transition().accepted_action,
        Some(er_types::GameActionV1::Battle { .. })
    ));
    journal.accept(&kernel, content.as_ref(), &step)?;
    journal.settle_actual_presentations(&mut kernel)?;
    let player_action_index = {
        let owned = kernel.state().ok_or("owned state absent")?;
        let turn = owned
            .current_turn_execution
            .as_ref()
            .ok_or("actual turn absent")?;
        assert_eq!(usize::from(turn.next_action), 0);
        let player = active_run(owned)?.party[0].id;
        // The priority-1 Withdraw actions resolve before the player's
        // priority-0 move; the unsupported multi-hit is reached only at the
        // player's own step.
        turn.actions
            .iter()
            .position(|action| action.command.actor() == player)
            .ok_or("actual player action absent")?
    };
    for _ in 0..player_action_index {
        let step = kernel.advance_time(SafeU53::ZERO)?;
        journal.accept(&kernel, content.as_ref(), &step)?;
        journal.settle_actual_presentations(&mut kernel)?;
    }
    let before = canonical_bytes(&kernel.snapshot()?)?;
    assert!(
        kernel.advance_time(SafeU53::ZERO).is_err(),
        "a real unsupported multi-hit may not fabricate source single-hit observations"
    );
    assert_eq!(canonical_bytes(&kernel.snapshot()?)?, before);
    Ok(())
}

#[test]
fn actual_innate_absorb_uses_admitted_slot_and_shared_immutable_query() -> Result<()> {
    let content = content()?;
    assert_controlled_withdraw(content.as_ref())?;
    let mut snapshot = natural(content.clone(), 0, "m9e-defender-ability-28")
        .map_err(|error| format!("innate bootstrap: {error}"))?
        .snapshot()?;
    let state = active_mut(&mut snapshot)?;
    let species = active_run(state)?.party[0].species_id;
    {
        let run = active_run_mut(state)?;
        let player = &mut run.party[0];
        player.abilities.active = AbilityId::new(safe(0));
        player.abilities.passives = [
            Some(AbilityId::new(safe(5082))),
            None,
            Some(AbilityId::new(safe(5082))),
        ];
        player.hp = 6;
        player.max_hp = 13;
        player.stats.hp = 13;
        only_move(player, 110)?;
        let enemy = &mut run.battle.as_mut().ok_or("battle absent")?.enemy_party[0];
        enemy.abilities.active = AbilityId::new(safe(0));
        enemy.abilities.passives = [None, None, None];
        only_move(enemy, 40)?;
    }
    // The substituted abilities, moves and HP form a mechanical fixture. Retain
    // its valid single-battle participation shell, but no source XP authority.
    assert!(
        state
            .current_battle_participation
            .as_mut()
            .ok_or("natural participation absent")?
            .experience
            .take()
            .is_some()
    );
    state
        .current_achievement_tracker
        .as_mut()
        .ok_or("natural tracker absent")?
        .history = er_state::current_achievement_tracker::CurrentAchievementHistoryV1::UnobservedMechanicalFixture;
    let mechanical_tracker = state.current_achievement_tracker.clone();
    for (mask, immune) in [(0, false), (16, false), (32, false), (48, true)] {
        state
            .current_friendship_profile
            .as_mut()
            .ok_or("canonical account absent")?
            .accounts
            .iter_mut()
            .find(|row| row.species == species)
            .ok_or("actual species account absent")?
            .passive_attr = mask;
        state.validate_with(content.as_ref())?;
        let bytes = canonical_bytes(state)?;
        let run = active_run(state)?;
        let owner = CurrentTargetExecution::from_state(state)?;
        let result = query_simulated_move_damage_with_current_targets(
            &content.battle,
            run,
            slot(BattleSide::Enemy, 0),
            MoveSlotIndex::new(0)?,
            slot(BattleSide::Player, 0),
            &owner,
        )?;
        assert_eq!(result == 0, immune);
        assert_eq!(canonical_bytes(state)?, bytes);
    }
    // Querying the source effect never creates a tracked dispatch owner.
    assert!(state.current_defender_dispatch.is_none());
    // A prepared move row alone does not admit its unobserved current targeting
    // semantics. Force Palm is a real compiled row, outside this source catalog.
    let original_enemy = active_run(state)?
        .battle
        .as_ref()
        .ok_or("battle absent")?
        .enemy_party[0]
        .clone();
    only_move(
        &mut active_run_mut(state)?
            .battle
            .as_mut()
            .ok_or("battle absent")?
            .enemy_party[0],
        395,
    )?;
    let unknown_bytes = canonical_bytes(state)?;
    let owner = CurrentTargetExecution::from_state(state)?;
    assert!(
        query_simulated_move_damage_with_current_targets(
            &content.battle,
            active_run(state)?,
            slot(BattleSide::Enemy, 0),
            MoveSlotIndex::new(0)?,
            slot(BattleSide::Player, 0),
            &owner
        )
        .is_err()
    );
    assert_eq!(canonical_bytes(state)?, unknown_bytes);
    active_run_mut(state)?
        .battle
        .as_mut()
        .ok_or("battle absent")?
        .enemy_party[0] = original_enemy;
    // An unsupported represented guard cannot be mistaken for the ordinary
    // source heal context. Failure conserves the entire canonical state.
    active_run_mut(state)?.party[0].mechanics.guard_chain_depth = 1;
    let guarded_bytes = canonical_bytes(state)?;
    let owner = CurrentTargetExecution::from_state(state)?;
    assert!(
        query_simulated_move_damage_with_current_targets(
            &content.battle,
            active_run(state)?,
            slot(BattleSide::Enemy, 0),
            MoveSlotIndex::new(0)?,
            slot(BattleSide::Player, 0),
            &owner
        )
        .is_err()
    );
    assert_eq!(canonical_bytes(state)?, guarded_bytes);
    active_run_mut(state)?.party[0].mechanics.guard_chain_depth = 0;
    let holder = active_run(state)?.party[0].id;
    // These declared mechanics edits do not forge the prior natural material.
    snapshot.material_ledger = er_game::m9e_material_v6::AppliedGameMaterialLedgerV1::new(
        snapshot.material_ledger.next_authority_revision,
    )?;
    let mut kernel = restore(snapshot, content.clone())?;
    navigate(&mut kernel, "battle/command/fight")?;
    press(&mut kernel, PhysicalKey::Space)?;
    navigate(&mut kernel, "battle/move/0")?;
    let mut journal = MaterialJournal::before_command(&kernel.snapshot()?)?;
    let step = press(&mut kernel, PhysicalKey::Space)
        .map_err(|error| format!("innate move admission: {error}"))?;
    let proof = material(&step)?;
    // This admitted retained turn is mechanical evidence only. Removing the
    // explicit history marker must not turn its absent XP owner into authority.
    let mut forged_complete = proof.transition().after_state.clone();
    assert!(forged_complete.current_turn_execution.is_some());
    forged_complete
        .current_achievement_tracker
        .as_mut()
        .ok_or("mechanical tracker absent")?
        .history =
        er_state::current_achievement_tracker::CurrentAchievementHistoryV1::FreshComplete;
    assert!(forged_complete.validate_with(content.as_ref()).is_err());
    assert!(matches!(
        proof.transition().accepted_action,
        Some(er_types::GameActionV1::Battle { .. })
    ));
    journal.accept(&kernel, content.as_ref(), &step)?;
    journal
        .drain_non_fainting_turn(&mut kernel, content.as_ref())
        .map_err(|error| format!("defender retained turn drain: {error}"))?;
    let after = kernel.state().ok_or("current state absent")?;
    assert_eq!(active_run(after)?.party[0].hp, 9);
    let shown: Vec<_> = journal
        .materials
        .iter()
        .flat_map(|proof| &proof.transition().presentation)
        .filter_map(|effect| match effect.payload.as_ref() {
            Some(GamePresentationPayloadV1::AbilityShown {
                holder: target,
                ability,
                innate_slot,
            }) => Some((*target, *ability, *innate_slot)),
            _ => None,
        })
        .collect();
    assert_eq!(shown, vec![(holder, AbilityId::new(safe(5082)), Some(2))]);
    assert_eq!(after.current_achievement_tracker, mechanical_tracker);
    assert!(
        after
            .current_battle_participation
            .as_ref()
            .ok_or("retained participation absent")?
            .experience
            .is_none()
    );
    Ok(())
}
