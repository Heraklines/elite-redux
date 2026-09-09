//! Actual current kernel/resolver entry witnesses over the shipped content.
//! Natural launch is raw input. Expanded fields, assigned moves/abilities and HP
//! are explicitly controlled same-content mechanics fixtures, not natural roster
//! or full source damage/status/AI-phase parity claims.
use er_battle::current_target_execution::CurrentTargetExecution;
use er_battle::m7_resolver::{TurnAuthorityContextV1, resolve_turn_v5_with_current_targets};
use er_canonical::canonical_bytes;
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{GameMaterialV6, apply_game_material_v6, game_state_digest};
use er_kernel::game_kernel_v7::{
    FreshFriendshipStartV7, GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7, GameKernelV7,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::field::{FieldSlotState, FieldState};
use er_state::m7_state::{
    DexState, GameStateV5, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
    RunStateV3,
};
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1, BattleTargetSelection,
    CommandSet, ScriptedEnemyBattleCommandV1, player_command_operation_id,
    scripted_enemy_command_operation_id,
};
use er_types::battle_ids::{
    AbilityId, BattleFormat, BattleSide, FieldSlot, MoveId, MoveSlotIndex, PokemonId, WaveIndex,
};
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{
    BehaviorSourceId, GameActionV1, GameContentIdentity, GameControlKindV2, SafeU53, SeatId,
};
use std::{error::Error, sync::Arc};
type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[test]
fn retained_turn_matches_uninterrupted_actions_rng_and_finalization() -> Result<()> {
    use er_battle::m7_resolver::{begin_current_turn, finish_current_turn, step_current_turn};
    use er_state::current_turn_execution::{CurrentTurnExecutionV1, CurrentTurnStageV1};
    let content = content()?;
    let mut snapshot = two_enemies(content.clone())?;
    let state = active_mut(&mut snapshot)?;
    assign_move(state, 33)?;
    let run = active_run_mut(state)?;
    run.party[0].hp = 200;
    run.party[0].max_hp = 200;
    run.party[0].stats.attack = 1;
    for enemy in &mut run.battle.as_mut().ok_or("battle absent")?.enemy_party {
        enemy.moves[0].as_mut().ok_or("move absent")?.move_id = MoveId::new(safe(33));
        enemy.moves[0].as_mut().ok_or("move absent")?.pp_used = 0;
        enemy.stats.attack = 1;
    }
    let accepted = commands(
        state,
        &[
            slot(BattleSide::Enemy, 0),
            slot(BattleSide::Player, 0),
            slot(BattleSide::Player, 0),
        ],
        content.as_ref(),
    )?;
    let targeting = CurrentTargetExecution::from_state(state)?;
    let before = project(state);
    let authority = TurnAuthorityContextV1 {
        authority_seat: seat(),
        revision: active_run(state)?.control.revision,
    };
    let whole = resolve_turn_v5_with_current_targets(
        &before,
        &accepted,
        &content.battle,
        &authority,
        &targeting,
    )?;
    let mut chunk = begin_current_turn(
        &before,
        &accepted,
        &content.battle,
        &authority,
        &targeting,
        SafeU53::ZERO,
    )?;
    let mut audit = chunk.transition.rng_audit.clone();
    let mut actions = Vec::new();
    let mut mutations = Vec::new();
    let mut cues = Vec::new();
    let selected_order = chunk.continuation.actions.clone();
    let original_turn = active_run(state)?
        .battle
        .as_ref()
        .ok_or("battle absent")?
        .turn;
    assert!(chunk.transition.action_order.is_empty());
    assert!(
        finish_current_turn(
            &chunk.transition.after_state,
            &chunk.continuation,
            &content.battle,
            &authority,
            &targeting
        )
        .is_err()
    );
    while usize::from(chunk.continuation.next_action) < chunk.continuation.actions.len() {
        // A real serde round trip between every action retains the exact queue/RNG frontier.
        let owner: CurrentTurnExecutionV1 =
            serde_json::from_slice(&canonical_bytes(&chunk.continuation)?)?;
        assert_eq!(owner, chunk.continuation);
        let mut stale = authority;
        stale.revision = safe(authority.revision.get() + 1);
        assert!(
            step_current_turn(
                &chunk.transition.after_state,
                &owner,
                &content.battle,
                &stale,
                &targeting
            )
            .is_err()
        );
        chunk = step_current_turn(
            &chunk.transition.after_state,
            &owner,
            &content.battle,
            &authority,
            &targeting,
        )?;
        assert_eq!(chunk.continuation.stage, CurrentTurnStageV1::ReadyForMove);
        assert_eq!(chunk.continuation.actions, selected_order);
        assert_eq!(
            chunk
                .transition
                .after_state
                .active_run
                .as_ref()
                .ok_or("run absent")?
                .battle
                .as_ref()
                .ok_or("battle absent")?
                .turn,
            original_turn
        );
        audit.extend(chunk.transition.rng_audit.clone());
        actions.extend(chunk.transition.action_order.clone());
        mutations.extend(chunk.transition.mutations.clone());
        cues.extend(chunk.transition.presentation.clone());
    }
    assert!(
        step_current_turn(
            &chunk.transition.after_state,
            &chunk.continuation,
            &content.battle,
            &authority,
            &targeting
        )
        .is_err()
    );
    chunk = finish_current_turn(
        &chunk.transition.after_state,
        &chunk.continuation,
        &content.battle,
        &authority,
        &targeting,
    )?;
    audit.extend(chunk.transition.rng_audit.clone());
    mutations.extend(chunk.transition.mutations.clone());
    cues.extend(chunk.transition.presentation.clone());
    assert_eq!(chunk.continuation.stage, CurrentTurnStageV1::Complete);
    assert!(chunk.continuation.finalization_done);
    assert_eq!(chunk.transition.after_state, whole.after_state);
    assert_eq!(audit, whole.rng_audit);
    assert_eq!(actions, whole.action_order);
    assert_eq!(mutations, whole.mutations);
    assert_eq!(cues, whole.presentation);
    assert!(
        finish_current_turn(
            &chunk.transition.after_state,
            &chunk.continuation,
            &content.battle,
            &authority,
            &targeting
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn retained_turn_faint_blocks_later_move_at_live_reward_preimage() -> Result<()> {
    use er_battle::m7_resolver::{begin_current_turn, finish_current_turn, step_current_turn};
    use er_state::current_turn_execution::{CurrentTurnExecutionV1, CurrentTurnStageV1};
    let content = content()?;
    let mut snapshot = two_enemies(content.clone())?;
    let state = active_mut(&mut snapshot)?;
    assign_move(state, 33)?;
    let run = active_run_mut(state)?;
    run.party[0].hp = 1;
    run.party[0].stats.speed = 500;
    run.party[0].stats.attack = 500;
    let actor = run.party[0].id;
    let battle = run.battle.as_mut().ok_or("battle absent")?;
    for enemy in &mut battle.enemy_party {
        enemy.moves[0].as_mut().ok_or("move absent")?.move_id = MoveId::new(safe(33));
        enemy.moves[0].as_mut().ok_or("move absent")?.pp_used = 0;
        enemy.stats.speed = 1;
        enemy.stats.attack = 500;
    }
    battle.enemy_party[1].hp = 1;
    let defeated = battle.enemy_party[1].id;
    let accepted = commands(
        state,
        &[
            slot(BattleSide::Enemy, 1),
            slot(BattleSide::Player, 0),
            slot(BattleSide::Player, 0),
        ],
        content.as_ref(),
    )?;
    let targeting = CurrentTargetExecution::from_state(state)?;
    let authority = TurnAuthorityContextV1 {
        authority_seat: seat(),
        revision: active_run(state)?.control.revision,
    };
    let begin = begin_current_turn(
        &project(state),
        &accepted,
        &content.battle,
        &authority,
        &targeting,
        safe(37),
    )?;
    let selected = begin.continuation.actions.clone();
    let chunk = step_current_turn(
        &begin.transition.after_state,
        &begin.continuation,
        &content.battle,
        &authority,
        &targeting,
    )?;
    let CurrentTurnStageV1::AwaitingInterlude { faints } = &chunk.continuation.stage else {
        return Err("missing actual faint interlude".into());
    };
    assert_eq!(faints.len(), 1);
    assert_eq!(faints[0].id, SafeU53::ZERO);
    assert_eq!(faints[0].pokemon, defeated);
    assert_eq!(faints[0].slot, slot(BattleSide::Enemy, 1));
    let run = chunk
        .transition
        .after_state
        .active_run
        .as_ref()
        .ok_or("run absent")?;
    assert_eq!(run.party[0].id, actor);
    assert_eq!(run.party[0].hp, 1);
    assert_eq!(
        run.battle.as_ref().ok_or("battle absent")?.enemy_party[0].moves[0]
            .as_ref()
            .ok_or("move absent")?
            .pp_used,
        0
    );
    assert_eq!(chunk.continuation.actions, selected);
    assert_eq!(chunk.continuation.accepted_commands, accepted);
    assert_eq!(chunk.continuation.next_action, 1);
    let restored: CurrentTurnExecutionV1 =
        serde_json::from_slice(&canonical_bytes(&chunk.continuation)?)?;
    assert_eq!(restored, chunk.continuation);
    let frozen = canonical_bytes(&chunk.transition.after_state)?;
    assert!(
        step_current_turn(
            &chunk.transition.after_state,
            &restored,
            &content.battle,
            &authority,
            &targeting
        )
        .is_err()
    );
    assert!(
        finish_current_turn(
            &chunk.transition.after_state,
            &restored,
            &content.battle,
            &authority,
            &targeting
        )
        .is_err()
    );
    assert_eq!(canonical_bytes(&chunk.transition.after_state)?, frozen);
    // This test stops at the actual boundary. Only the integrated phase owner may
    // release it after consuming real Faint/Victory/XP records, never a test flag.
    Ok(())
}
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
    let bound = kernel
        .current_control()
        .and_then(|c| c.menu.as_ref())
        .ok_or("menu absent")?
        .options
        .len()
        + 1;
    for _ in 0..bound {
        if kernel
            .current_control()
            .and_then(|c| c.menu.as_ref())
            .is_some_and(|m| m.selected_option_id.as_str() == option)
        {
            return Ok(());
        }
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    Err("actual raw option unreachable".into())
}
fn natural(content: Arc<PreparedGameContentV2>, index: usize) -> Result<GameKernelV7> {
    let mut kernel = GameKernelV7::natural_start_with_fresh_friendship(FreshFriendshipStartV7 {
        profile: profile()?,
        seed: format!("m9e-target-execution-source-{index}"),
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
    press(&mut kernel, PhysicalKey::Space)?;
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
    let mut snapshot = natural(content.clone(), 2)?.snapshot()?;
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
    battle.enemy_party[0].hp = 200;
    battle.enemy_party[0].max_hp = 200;
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
fn choose_first_move(kernel: &mut GameKernelV7) -> Result<GameKernelStepV7> {
    navigate(kernel, "battle/command/fight")?;
    press(kernel, PhysicalKey::Space)?;
    navigate(kernel, "battle/move/0")?;
    press(kernel, PhysicalKey::Space)
}
fn project(state: &GameStateV6) -> GameStateV5 {
    GameStateV5 {
        schema_version: er_state::m7_state::GAME_STATE_SCHEMA_VERSION_V5,
        content_identity: GameContentIdentity {
            oracle_sha: state.content_identity.oracle_sha.clone(),
            content_hash: state.content_identity.bundle_hash.clone(),
            battle_content_hash: state.content_identity.battle_hash.clone(),
            semantic_catalog_hash: state.content_identity.semantic_catalog_hash.clone(),
        },
        profile: state.profile.clone(),
        active_run: state.active_run.clone(),
    }
}
fn commands(
    state: &GameStateV6,
    targets: &[FieldSlot],
    prepared: &PreparedGameContentV2,
) -> Result<CommandSet> {
    let run = active_run(state)?;
    let battle = run.battle.as_ref().ok_or("battle absent")?;
    let menu = run.control.menu.as_ref().ok_or("root menu absent")?;
    let mut entries = Vec::new();
    for (index, row) in battle
        .field
        .slots
        .iter()
        .filter(|row| row.occupant.is_some())
        .enumerate()
    {
        let Some(actor) = row.occupant else {
            continue;
        };
        let target = *targets.get(index).ok_or("exact command targets required")?;
        let pokemon =
            er_battle::current_target_execution::find_pokemon(run, actor).ok_or("actor absent")?;
        let move_id = pokemon.moves[0].as_ref().ok_or("move absent")?.move_id;
        // Resolve canonical choices through the same actual source owner. A sole
        // candidate uses Implicit; Selected is retained only for real choice sets.
        let plan = CurrentTargetExecution::from_state(state)?.plan(
            run,
            actor,
            prepared.battle.move_definition(move_id)?,
        )?;
        let selection = plan
            .selections()?
            .into_iter()
            .find(|selection| {
                plan.retain(selection)
                    .is_ok_and(|targets| targets.contains(&target))
            })
            .ok_or("requested controlled target is not a canonical legal choice")?;
        let command = BattleCommand::fight(actor, MoveSlotIndex::new(0)?, selection)?;
        if row.slot.side == BattleSide::Player {
            entries.push(AcceptedBattleCommand::human(BattleCommandProposalV1::new(
                player_command_operation_id(
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    row.slot,
                    seat(),
                )?,
                battle.battle_id,
                battle.wave,
                battle.turn,
                seat(),
                actor,
                row.slot,
                command,
                menu.instance_id,
                menu.control_id.clone(),
            )?));
        } else {
            let cursor = safe(u64::try_from(index)?);
            entries.push(AcceptedBattleCommand::scripted_enemy(
                ScriptedEnemyBattleCommandV1::new(
                    scripted_enemy_command_operation_id(
                        battle.battle_id,
                        battle.wave,
                        battle.turn,
                        row.slot,
                        cursor,
                    )?,
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    cursor,
                    actor,
                    row.slot,
                    command,
                )?,
            ));
        }
    }
    Ok(CommandSet::new(entries)?)
}

#[test]
fn natural_raw_turn_uses_current_targets_and_preserves_save_material() -> Result<()> {
    let content = content()?;
    let mut kernel = natural(content.clone(), 2)?;
    let before = kernel.snapshot()?;
    let state = active(&before)?;
    let actor = active_run(state)?.party[0].id;
    let sources = CurrentTargetExecution::from_state(state)?
        .ability_sources(active_run(state)?, &active_run(state)?.party[0])?;
    assert_eq!(
        sources
            .iter()
            .filter(|s| matches!(s, BehaviorSourceId::PassiveAbility { .. }))
            .count(),
        0
    );
    let plan = CurrentTargetExecution::from_state(state)?.plan(
        active_run(state)?,
        actor,
        content.battle.move_definition(
            active_run(state)?.party[0].moves[0]
                .as_ref()
                .ok_or("move absent")?
                .move_id,
        )?,
    )?;
    assert_eq!(plan.selections()?, vec![BattleTargetSelection::implicit()]);
    assert!(
        plan.retain(&BattleTargetSelection::selected(vec![slot(
            BattleSide::Enemy,
            0
        )])?)
        .is_err()
    );
    let step = choose_first_move(&mut kernel)?;
    let actual = material(&step)?;
    assert_eq!(
        actual.transition().after_state.current_targeting,
        state.current_targeting
    );
    assert_eq!(
        actual.transition().after_state.current_friendship_profile,
        state.current_friendship_profile
    );
    let after = kernel.state().ok_or("after state absent")?;
    assert_eq!(
        active_run(after)?
            .party
            .iter()
            .find(|p| p.id == actor)
            .ok_or("actor absent")?
            .moves[0]
            .as_ref()
            .ok_or("move absent")?
            .pp_used,
        1
    );
    let mut live = Some(state.clone());
    let mut ledger = before.material_ledger.clone();
    apply_game_material_v6(
        &mut live,
        &mut ledger,
        content.as_ref(),
        &actual.canonical_bytes()?,
    )?;
    assert_eq!(live.as_ref(), Some(after));
    let save = GameSaveV2::new(after.content_identity.clone(), safe(1), after.clone())?;
    assert_eq!(GameSaveV2::decode(&save.encode()?)?.state, *after);
    let restored = restore(kernel.snapshot()?, content)?;
    assert_eq!(
        canonical_bytes(&restored.snapshot()?)?,
        canonical_bytes(&kernel.snapshot()?)?
    );
    Ok(())
}

#[test]
fn actual_target_menu_retains_move_restore_and_cancel_owner() -> Result<()> {
    let content = content()?;
    let snapshot = two_enemies(content.clone())?;
    let mut kernel = restore(snapshot, content.clone())?;
    choose_first_move(&mut kernel)?;
    assert_eq!(
        kernel.current_control().map(|c| c.kind),
        Some(GameControlKindV2::BattleTarget)
    );
    let leaf = kernel.snapshot()?;
    let control = kernel.current_control().ok_or("target leaf absent")?;
    assert_eq!(
        control
            .menu
            .as_ref()
            .ok_or("target menu absent")?
            .options
            .len(),
        2
    );
    assert!(control.menu.as_ref().ok_or("menu absent")?.options.iter().all(|option|
        matches!(option.action, GameActionV1::Battle { action: er_types::BattleUiActionV1::SelectMoveTarget { move_slot, .. } } if move_slot.get() == 0)));
    let mut restored = restore(leaf.clone(), content.clone())?;
    assert_eq!(
        canonical_bytes(&restored.snapshot()?)?,
        canonical_bytes(&leaf)?
    );
    let mut forged = leaf.clone();
    let forged_control = &mut active_run_mut(active_mut(&mut forged)?)?.control;
    let option = forged_control
        .menu
        .as_mut()
        .ok_or("menu absent")?
        .options
        .first_mut()
        .ok_or("option absent")?;
    if let GameActionV1::Battle {
        action: er_types::BattleUiActionV1::SelectMoveTarget { move_slot, .. },
    } = &mut option.action
    {
        *move_slot = MoveSlotIndex::new(3)?;
    } else {
        return Err("actual typed target option required".into());
    }
    assert!(restore(forged, content).is_err());
    press(&mut restored, PhysicalKey::Escape)?;
    assert_eq!(
        restored.current_control().map(|c| c.kind),
        Some(GameControlKindV2::BattleCommand)
    );
    navigate(&mut kernel, "battle/target/1")?;
    let step = press(&mut kernel, PhysicalKey::Space)?;
    let actual = material(&step)?;
    assert!(
        matches!(actual.transition().accepted_action, Some(GameActionV1::Battle {
        action: er_types::BattleUiActionV1::SelectMoveTarget { target, move_slot, .. }
    }) if target == slot(BattleSide::Enemy,1) && move_slot.get() == 0)
    );
    Ok(())
}

#[test]
fn source_spread_group_executes_all_opponents_and_multihit_exception() -> Result<()> {
    let content = content()?;
    let mut snapshot = two_enemies(content.clone())?;
    assign_move(active_mut(&mut snapshot)?, 57)?; // Genuine source Surf, ALL_NEAR_OTHERS.
    let prior = active(&snapshot)?.clone();
    let plan = CurrentTargetExecution::from_state(&prior)?.plan(
        active_run(&prior)?,
        active_run(&prior)?.party[0].id,
        content.battle.move_definition(MoveId::new(safe(57)))?,
    )?;
    assert!(plan.multiple);
    assert_eq!(
        plan.ordered,
        vec![slot(BattleSide::Enemy, 0), slot(BattleSide::Enemy, 1)]
    );
    let mut kernel = restore(snapshot.clone(), content.clone())?;
    let step = choose_first_move(&mut kernel)?;
    material(&step)?;
    let after = active_run(kernel.state().ok_or("state absent")?)?
        .battle
        .as_ref()
        .ok_or("battle absent")?;
    assert!(after.enemy_party.iter().all(|p| p.hp < 200));
    let state = active_mut(&mut snapshot)?;
    let chatter = content.battle.move_definition(MoveId::new(safe(448)))?;
    assert!(
        chatter
            .flags
            .contains(&er_types::battle_model::MoveFlag::SoundBased)
    );
    assign_move(state, 448)?;
    active_run_mut(state)?.party[0].abilities.active = AbilityId::new(safe(5115));
    let actor = active_run(state)?.party[0].id;
    let spread = CurrentTargetExecution::from_state(state)?.plan(
        active_run(state)?,
        actor,
        content.battle.move_definition(MoveId::new(safe(448)))?,
    )?;
    assert!(spread.multiple);
    assert_eq!(
        spread.ordered,
        vec![slot(BattleSide::Enemy, 0), slot(BattleSide::Enemy, 1)]
    );
    let mut sound_kernel = restore(snapshot.clone(), content.clone())?;
    let sound_step = choose_first_move(&mut sound_kernel)?;
    material(&sound_step)?;
    assert!(
        active_run(sound_kernel.state().ok_or("state absent")?)?
            .battle
            .as_ref()
            .ok_or("battle absent")?
            .enemy_party
            .iter()
            .all(|p| p.hp < 200)
    );
    let state = active_mut(&mut snapshot)?;
    assign_move(state, 497)?;
    active_run_mut(state)?.party[0].abilities.active = AbilityId::new(safe(5115));
    let actor = active_run(state)?.party[0].id;
    let plan = CurrentTargetExecution::from_state(state)?.plan(
        active_run(state)?,
        actor,
        content.battle.move_definition(MoveId::new(safe(497)))?,
    )?;
    assert!(!plan.multiple);
    assert_eq!(plan.selections()?.len(), 2);
    Ok(())
}

#[test]
fn poison_redirect_and_source_passive_gate_share_actual_owner() -> Result<()> {
    let content = content()?;
    let mut snapshot = two_enemies(content.clone())?;
    // Controlled eligibility queries share the actual canonical account object;
    // they do not pretend these edited levels/masks arose from a natural run.
    for (mask, expected) in [(0, 0), (1, 0), (2, 0), (3, 1), (12, 1), (48, 1), (63, 3)] {
        let mut controlled = active(&snapshot)?.clone();
        let species = active_run(&controlled)?.party[0].species_id;
        let profile = controlled
            .current_friendship_profile
            .as_mut()
            .ok_or("profile absent")?;
        let account = profile
            .accounts
            .iter_mut()
            .find(|a| a.species == species)
            .ok_or("account absent")?;
        account.passive_attr = mask;
        let run = active_run(&controlled)?;
        let sources =
            CurrentTargetExecution::from_state(&controlled)?.ability_sources(run, &run.party[0])?;
        assert_eq!(
            sources
                .iter()
                .filter(|s| matches!(s, BehaviorSourceId::PassiveAbility { .. }))
                .count(),
            expected
        );
    }
    for (level, expected) in [(14, 1), (15, 2), (23, 2), (24, 3)] {
        let mut controlled = active(&snapshot)?.clone();
        active_run_mut(&mut controlled)?
            .battle
            .as_mut()
            .ok_or("battle absent")?
            .enemy_party[0]
            .level = level;
        let run = active_run(&controlled)?;
        let enemy = &run.battle.as_ref().ok_or("battle absent")?.enemy_party[0];
        let sources =
            CurrentTargetExecution::from_state(&controlled)?.ability_sources(run, enemy)?;
        assert_eq!(
            sources
                .iter()
                .filter(|s| matches!(s, BehaviorSourceId::PassiveAbility { .. }))
                .count(),
            expected
        );
    }
    let state = active_mut(&mut snapshot)?;
    assign_move(state, 40)?;
    let run = active_run_mut(state)?;
    run.battle.as_mut().ok_or("battle absent")?.enemy_party[0]
        .abilities
        .active = AbilityId::new(safe(5082));
    let state = active(&snapshot)?;
    let run = active_run(state)?;
    let actor = run.party[0].id;
    let owner = CurrentTargetExecution::from_state(state)?;
    let definition = content.battle.move_definition(MoveId::new(safe(40)))?;
    assert_eq!(
        owner.execution_targets(run, actor, definition, &[slot(BattleSide::Enemy, 1)])?,
        vec![slot(BattleSide::Enemy, 0)]
    );
    let mut kernel = restore(snapshot, content)?;
    choose_first_move(&mut kernel)?;
    navigate(&mut kernel, "battle/target/1")?;
    let step = press(&mut kernel, PhysicalKey::Space)?;
    material(&step)?;
    let enemies = &active_run(kernel.state().ok_or("state absent")?)?
        .battle
        .as_ref()
        .ok_or("battle absent")?
        .enemy_party;
    // This pins which slot the current executor reached, not source-equivalent HP:
    // defender TypeAbsorbHeal and other damage hooks remain separate missing work.
    assert!(enemies[0].hp < 200);
    assert_eq!(enemies[1].hp, 200);
    Ok(())
}

#[test]
fn queued_faint_retargets_opponents_but_preserves_same_side_cancellation() -> Result<()> {
    let content = content()?;
    let mut snapshot = two_enemies(content.clone())?;
    let state = active_mut(&mut snapshot)?;
    assign_move(state, 33)?;
    let run = active_run_mut(state)?;
    run.party[0].stats.speed = 500;
    run.party[0].stats.attack = 500;
    let battle = run.battle.as_mut().ok_or("battle absent")?;
    for enemy in &mut battle.enemy_party {
        enemy.moves[0].as_mut().ok_or("move absent")?.move_id = MoveId::new(safe(33));
        enemy.moves[0].as_mut().ok_or("move absent")?.pp_used = 0;
        enemy.stats.speed = 1;
    }
    battle.enemy_party[1].hp = 1;
    state.validate_with(content.as_ref())?;
    // Source redirectMoves only retargets an opposing attacker. This queued
    // enemy deliberately targeted its own ally, so faint redirection cannot apply.
    let accepted = commands(
        state,
        &[
            slot(BattleSide::Enemy, 1),
            slot(BattleSide::Enemy, 1),
            slot(BattleSide::Player, 0),
        ],
        content.as_ref(),
    )?;
    let before = canonical_bytes(state)?;
    let owner = CurrentTargetExecution::from_state(state)?;
    let result = resolve_turn_v5_with_current_targets(
        &project(state),
        &accepted,
        &content.battle,
        &TurnAuthorityContextV1 {
            authority_seat: seat(),
            revision: active_run(state)?.control.revision,
        },
        &owner,
    )?;
    let after = result
        .after_state
        .active_run
        .as_ref()
        .ok_or("run absent")?
        .battle
        .as_ref()
        .ok_or("battle absent")?;
    assert_eq!(after.enemy_party[1].hp, 0);
    assert_eq!(
        after.enemy_party[0].moves[0]
            .as_ref()
            .ok_or("move absent")?
            .pp_used,
        0
    );
    assert_eq!(canonical_bytes(state)?, before);

    // Positive source double case: the second player selected the same enemy
    // before the first player's KO. The actual pending owner redirects only its
    // remaining one-target vector to the live enemy ally, preserving the command.
    let mut double = state.clone();
    let next_id = double.identities.next_pokemon_id;
    double.identities.next_pokemon_id =
        safe(next_id.get().checked_add(1).ok_or("allocator overflow")?);
    let run = active_run_mut(&mut double)?;
    let mut second = run.party[0].clone();
    second.id = PokemonId::new(next_id);
    second.stats.speed = 400;
    second.stats.attack = 1;
    let second_id = second.id;
    run.party.push(second);
    run.battle
        .as_mut()
        .ok_or("battle absent")?
        .field
        .slots
        .iter_mut()
        .find(|row| row.slot == slot(BattleSide::Player, 1))
        .ok_or("second player field absent")?
        .occupant = Some(second_id);
    double.validate_with(content.as_ref())?;
    let accepted = commands(
        &double,
        &[
            slot(BattleSide::Enemy, 1),
            slot(BattleSide::Enemy, 1),
            slot(BattleSide::Player, 0),
            slot(BattleSide::Player, 0),
        ],
        content.as_ref(),
    )?;
    let commands_before = canonical_bytes(&accepted)?;
    let owner = CurrentTargetExecution::from_state(&double)?;
    let mut unremoved = vec![slot(BattleSide::Enemy, 1)];
    let live_enemy = active_run(&double)?
        .battle
        .as_ref()
        .ok_or("battle absent")?
        .enemy_party[1]
        .id;
    assert!(
        owner
            .retarget_pending_after_faint(
                active_run(&double)?,
                live_enemy,
                second_id,
                &mut unremoved
            )
            .is_err()
    );
    assert_eq!(unremoved, vec![slot(BattleSide::Enemy, 1)]);
    let result = resolve_turn_v5_with_current_targets(
        &project(&double),
        &accepted,
        &content.battle,
        &TurnAuthorityContextV1 {
            authority_seat: seat(),
            revision: active_run(&double)?.control.revision,
        },
        &owner,
    )?;
    let after = result.after_state.active_run.as_ref().ok_or("run absent")?;
    let battle = after.battle.as_ref().ok_or("battle absent")?;
    assert_eq!(battle.enemy_party[1].hp, 0);
    assert!(battle.enemy_party[0].hp < 200);
    assert_eq!(
        after
            .party
            .iter()
            .find(|pokemon| pokemon.id == second_id)
            .ok_or("second actor absent")?
            .moves[0]
            .as_ref()
            .ok_or("second move absent")?
            .pp_used,
        1
    );
    assert_eq!(canonical_bytes(&accepted)?, commands_before);
    Ok(())
}

#[test]
fn unsupported_selection_and_owner_stripping_fail_atomically() -> Result<()> {
    let content = content()?;
    let mut kernel = natural(content.clone(), 2)?;
    let before = kernel.snapshot()?;
    let step = choose_first_move(&mut kernel)?;
    let actual = material(&step)?;
    let mut stripped = actual.clone();
    let GameMaterialV6::BattleTurn(transition) = &mut stripped else {
        return Err("actual turn material required".into());
    };
    transition.after_state.current_targeting = None;
    transition.after_digest = game_state_digest(&transition.after_state)?;
    for mutation in &mut transition.mutations {
        mutation.after_digest = transition.after_digest.clone();
    }
    stripped.validate()?;
    let mut live = Some(active(&before)?.clone());
    let mut ledger = before.material_ledger.clone();
    let unchanged = canonical_bytes(&(live.clone(), ledger.clone()))?;
    assert_eq!(
        apply_game_material_v6(
            &mut live,
            &mut ledger,
            content.as_ref(),
            &stripped.canonical_bytes()?
        ),
        Err(er_game::m9e_material_v6::GameMaterialV6Error::CurrentTargetOwnership)
    );
    assert_eq!(canonical_bytes(&(live.clone(), ledger.clone()))?, unchanged);
    let mut unknown = two_enemies(content.clone())?;
    assign_move(active_mut(&mut unknown)?, 165)?;
    let mut unsupported = restore(unknown, content.clone())?;
    press(&mut unsupported, PhysicalKey::Space)?;
    let before_input = canonical_bytes(&unsupported.snapshot()?)?;
    assert!(unsupported.raw_input(down(PhysicalKey::Space)).is_err());
    assert_eq!(canonical_bytes(&unsupported.snapshot()?)?, before_input);
    let mut forged = before.clone();
    active_mut(&mut forged)?
        .current_targeting
        .as_mut()
        .ok_or("owner absent")?
        .run_id = er_types::run_ids::GameRunId::new(safe(999));
    assert!(restore(forged, content).is_err());
    Ok(())
}
