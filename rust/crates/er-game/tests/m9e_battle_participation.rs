//! Bounded real domain witnesses. The scripted commands are not the production AI/CLI journey.
use std::error::Error;
use std::sync::{Arc, OnceLock};

use er_battle::m7_resolver::{TurnAuthorityContextV1, query_simulated_move_damage_v5};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_material_v6::{GameMaterialApplyOutcomeV6, GameMaterialV6, GameMaterialV6Error};
use er_game::m9e_new_run_v6::{
    construct_natural_run_v6, construct_natural_run_v6_with_participation,
};
use er_game::m9e_runtime_v6::{
    GameActionDispatchContextV1, GameDomainExecutionInputV1, GameRuntimeV6, GameRuntimeV6Error,
    PreparedGameTransitionV2,
};
use er_game::m72_bootstrap::{
    BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapMachineV1, RunBootstrapStageV1,
};
use er_save::m9e_save_v2::GameSaveV2;
use er_state::current_battle_participation::{
    CurrentBattleObservationEventV1, CurrentBattleParticipantV1, CurrentBattleParticipationError,
    CurrentBattleParticipationV1, MAX_CURRENT_PARTICIPATION_EVENTS_V1,
};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics, RunStateV3,
};
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1, BattleTargetSelection,
    CommandSet, ScriptedEnemyBattleCommandV1, player_command_operation_id,
    scripted_enemy_command_operation_id,
};
use er_types::battle_ids::{
    BattleSide, FieldSlot, MenuInstanceId, MoveSlotIndex, PartyIndex, PokemonId, WaveIndex,
};
use er_types::battle_model::BattleOutcome;
use er_types::{
    BattleUiActionV1, BootstrapActionV1, GameActionContextV1, GameActionV1, GameControlKindV2,
    OperationId, RewardActionV1, RunDifficultyV1, SafeU53, SeatId, StarterSelectionV1,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
const MAX_SCRIPTED_TURNS: usize = 128;

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn content() -> TestResult<Arc<PreparedGameContentV2>> {
    static CONTENT: OnceLock<Result<Arc<PreparedGameContentV2>, String>> = OnceLock::new();
    CONTENT
        .get_or_init(|| {
            let bundle: GameContentBundleV2 =
                serde_json::from_slice(BUNDLE).map_err(|error| error.to_string())?;
            PreparedGameContentV2::prepare(Arc::new(bundle))
                .map(Arc::new)
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .cloned()
        .map_err(|error| error.clone().into())
}

fn bootstrap(content: &PreparedGameContentV2) -> TestResult<RunBootstrapMachineV1> {
    let owner = SeatId::new(safe(1)?);
    let profile = ProfileStateV1 {
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
            highest_wave: WaveIndex::new(safe(1)?)?,
        },
        dex: DexState::default(),
    };
    let starters = content
        .bundle()
        .bootstrap
        .starters
        .iter()
        .enumerate()
        .map(|(index, starter)| {
            Ok(StarterSelectionV1 {
                pokemon_id: PokemonId::new(safe(u64::try_from(index)? + 1)?),
                species_id: starter.species_id.get(),
                form_index: starter.form_index,
                ability_index: starter.ability_index,
                cost: starter.cost,
                owner_seat: owner,
            })
        })
        .collect::<TestResult<Vec<_>>>()?;
    let first = starters.first().ok_or("starter required")?.clone();
    let second = starters
        .iter()
        .find(|candidate| {
            candidate.species_id != first.species_id
                && u32::from(candidate.cost) + u32::from(first.cost)
                    <= u32::from(content.bundle().bootstrap.maximum_starter_cost)
        })
        .ok_or("second legal natural starter required")?
        .clone();
    let catalog = BootstrapCatalogV1 {
        modes: content
            .bundle()
            .bootstrap
            .modes
            .iter()
            .map(|mode| BootstrapModePolicyV1 {
                mode: mode.mode,
                challenge_selection: mode.challenge_selection,
                cooperative: mode.cooperative,
                supported: mode.supported,
            })
            .collect(),
        challenges: content
            .bundle()
            .bootstrap
            .choices
            .iter()
            .flat_map(|choice| {
                choice
                    .values
                    .iter()
                    .cloned()
                    .map(|value| (choice.id.clone(), value))
            })
            .collect(),
        starters,
        save_slots: vec!["observation".to_owned()],
        automatic_coop_save_slot: None,
        maximum_starter_cost: content.bundle().bootstrap.maximum_starter_cost,
        maximum_starters: content.bundle().bootstrap.maximum_starters,
        local_is_host: true,
        developer_mode: false,
    };
    let mut bootstrap =
        RunBootstrapMachineV1::new(profile, "m9e-natural-run".to_owned(), owner, catalog)?;
    let mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| mode.supported && !mode.cooperative && !mode.challenge_selection)
        .ok_or("solo mode required")?
        .mode;
    assert_eq!(bootstrap.stage, RunBootstrapStageV1::Title);
    for action in [
        BootstrapActionV1::OpenNewGame,
        BootstrapActionV1::SelectMode(mode),
        BootstrapActionV1::SelectStarter(first),
        BootstrapActionV1::SelectStarter(second),
        BootstrapActionV1::ConfirmStarters,
        BootstrapActionV1::Confirm,
        BootstrapActionV1::SelectDifficulty(RunDifficultyV1::Youngster),
        BootstrapActionV1::SelectSaveSlot("observation".to_owned()),
    ] {
        bootstrap.apply_game_action(GameActionV1::Bootstrap { action })?;
        bootstrap.validate()?;
    }
    assert_eq!(bootstrap.stage, RunBootstrapStageV1::Complete);
    Ok(bootstrap)
}

fn context(runtime: &GameRuntimeV6) -> TestResult<GameActionContextV1> {
    if let Some(context) = runtime
        .state()
        .and_then(|state| state.active_run.as_ref())
        .and_then(|run| run.control.action_context.clone())
    {
        return Ok(context);
    }
    Ok(GameActionContextV1 {
        operation_id: OperationId::new(format!(
            "observation/dispatch/{}",
            runtime.next_authority_revision().get()
        ))?,
        authority_seat: SeatId::new(safe(1)?),
        authority_revision: runtime.next_authority_revision(),
        menu_instance: MenuInstanceId::new(safe(1)?),
    })
}

fn dispatch(
    runtime: &mut GameRuntimeV6,
    action: GameActionV1,
    input: GameDomainExecutionInputV1,
) -> TestResult<PreparedGameTransitionV2> {
    let action_context = context(runtime)?;
    Ok(runtime.execute(
        action,
        GameActionDispatchContextV1 {
            action: action_context,
            input,
            authority: true,
        },
    )?)
}

fn pair() -> TestResult<(GameRuntimeV6, GameRuntimeV6)> {
    let content = content()?;
    let bootstrap = bootstrap(&content)?;
    let plain = construct_natural_run_v6(&bootstrap, &content, safe(1)?)?;
    let observed = construct_natural_run_v6_with_participation(&bootstrap, &content, safe(1)?)?;
    assert_eq!(strip(&observed), plain);
    let mut left = GameRuntimeV6::new(None, content.clone(), safe(1)?)?;
    let mut right = GameRuntimeV6::new(None, content, safe(1)?)?;
    let first = dispatch(
        &mut left,
        GameActionV1::Bootstrap {
            action: BootstrapActionV1::Confirm,
        },
        GameDomainExecutionInputV1::BootstrapCandidate(observed),
    )?;
    dispatch(
        &mut right,
        GameActionV1::Bootstrap {
            action: BootstrapActionV1::Confirm,
        },
        GameDomainExecutionInputV1::BootstrapCandidate(plain),
    )?;
    let mut replica = GameRuntimeV6::new(None, left.content().clone(), safe(1)?)?;
    assert_eq!(
        replica.apply_material_bytes(&first.material_bytes)?,
        GameMaterialApplyOutcomeV6::Applied
    );
    assert_eq!(replica.state(), left.state());
    assert_projection(&left, &right)?;
    Ok((left, right))
}

fn run(runtime: &GameRuntimeV6) -> TestResult<&RunStateV3> {
    runtime
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or_else(|| "active natural run required".into())
}
fn owner(runtime: &GameRuntimeV6) -> TestResult<&CurrentBattleParticipationV1> {
    runtime
        .state()
        .and_then(|state| state.current_battle_participation.as_ref())
        .ok_or_else(|| "observation owner required".into())
}
fn strip(state: &GameStateV6) -> GameStateV6 {
    let mut state = state.clone();
    state.current_battle_participation = None;
    state
}
fn assert_projection(observed: &GameRuntimeV6, plain: &GameRuntimeV6) -> TestResult {
    assert_eq!(
        strip(observed.state().ok_or("observed state")?),
        plain.state().ok_or("plain state")?.clone()
    );
    assert_eq!(
        observed.next_authority_revision(),
        plain.next_authority_revision()
    );
    Ok(())
}

fn move_command(
    runtime: &GameRuntimeV6,
    side: BattleSide,
    strongest: bool,
) -> TestResult<BattleCommand> {
    let run = run(runtime)?;
    let battle = run.battle.as_ref().ok_or("battle")?;
    let field = FieldSlot::new(side, 0)?;
    let target = FieldSlot::new(
        if side == BattleSide::Player {
            BattleSide::Enemy
        } else {
            BattleSide::Player
        },
        0,
    )?;
    let actor = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == field)
        .and_then(|entry| entry.occupant)
        .ok_or("actor")?;
    let pokemon = run
        .party
        .iter()
        .chain(&battle.enemy_party)
        .find(|pokemon| pokemon.id == actor)
        .ok_or("Pokemon")?;
    let mut choices = Vec::new();
    for (index, slot) in pokemon.moves.iter().enumerate() {
        if slot.is_none() {
            continue;
        }
        let slot = MoveSlotIndex::new(u8::try_from(index)?)?;
        if let Ok(damage) =
            query_simulated_move_damage_v5(&runtime.content().battle, run, field, slot, target)
        {
            choices.push((damage, slot));
        }
    }
    choices.sort_by_key(|(damage, slot)| (*damage, slot.get()));
    let (_, slot) = if strongest {
        choices.last()
    } else {
        choices.first()
    }
    .ok_or("legal move")?;
    Ok(BattleCommand::fight(
        actor,
        *slot,
        BattleTargetSelection::selected(vec![target])?,
    )?)
}

fn commands(runtime: &GameRuntimeV6, switch: bool, enemy_only: bool) -> TestResult<CommandSet> {
    let run = run(runtime)?;
    let battle = run.battle.as_ref().ok_or("battle")?;
    let mut commands = Vec::new();
    if !enemy_only {
        let field = FieldSlot::new(BattleSide::Player, 0)?;
        let actor = battle
            .field
            .slots
            .iter()
            .find(|entry| entry.slot == field)
            .and_then(|entry| entry.occupant)
            .ok_or("player")?;
        let command = if switch {
            let reserve = run
                .party
                .iter()
                .filter(|pokemon| pokemon.owner_seat == Some(battle.authority_seat))
                .position(|pokemon| {
                    !pokemon.fainted
                        && !battle
                            .field
                            .slots
                            .iter()
                            .any(|entry| entry.occupant == Some(pokemon.id))
                })
                .ok_or("living owner-relative reserve")?;
            BattleCommand::switch(actor, PartyIndex::new(u8::try_from(reserve)?)?)
        } else {
            move_command(runtime, BattleSide::Player, true)?
        };
        commands.push(AcceptedBattleCommand::human(BattleCommandProposalV1::new(
            player_command_operation_id(
                battle.battle_id,
                battle.wave,
                battle.turn,
                field,
                battle.authority_seat,
            )?,
            battle.battle_id,
            battle.wave,
            battle.turn,
            battle.authority_seat,
            actor,
            field,
            command,
            context(runtime)?.menu_instance,
            "observation-natural-command",
        )?));
    }
    let field = FieldSlot::new(BattleSide::Enemy, 0)?;
    let actor = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == field)
        .and_then(|entry| entry.occupant)
        .ok_or("enemy")?;
    let cursor = battle.turn.get();
    commands.push(AcceptedBattleCommand::scripted_enemy(
        ScriptedEnemyBattleCommandV1::new(
            scripted_enemy_command_operation_id(
                battle.battle_id,
                battle.wave,
                battle.turn,
                field,
                cursor,
            )?,
            battle.battle_id,
            battle.wave,
            battle.turn,
            cursor,
            actor,
            field,
            move_command(runtime, BattleSide::Enemy, enemy_only)?,
        )?,
    ));
    Ok(CommandSet::new(commands)?)
}

fn turn(runtime: &mut GameRuntimeV6, commands: CommandSet) -> TestResult<PreparedGameTransitionV2> {
    let authority = TurnAuthorityContextV1 {
        authority_seat: run(runtime)?
            .battle
            .as_ref()
            .ok_or("battle")?
            .authority_seat,
        revision: runtime.next_authority_revision(),
    };
    dispatch(
        runtime,
        GameActionV1::Battle {
            action: BattleUiActionV1::OpenFight,
        },
        GameDomainExecutionInputV1::BattleTurn {
            commands,
            authority,
        },
    )
}

fn pair_turn(
    observed: &mut GameRuntimeV6,
    plain: &mut GameRuntimeV6,
    switch: bool,
) -> TestResult<PreparedGameTransitionV2> {
    let commands = commands(observed, switch, false)?;
    let left = turn(observed, commands.clone())?;
    let right = turn(plain, commands)?;
    assert_eq!(left.rng_audit, right.rng_audit);
    assert_projection(observed, plain)?;
    Ok(left)
}

fn win(observed: &mut GameRuntimeV6, plain: &mut GameRuntimeV6) -> TestResult {
    for _ in 0..MAX_SCRIPTED_TURNS {
        match run(observed)?.battle.as_ref().ok_or("battle")?.outcome {
            BattleOutcome::Victory => return Ok(()),
            BattleOutcome::Defeat => {
                return Err("natural scripted party lost before the required victory".into());
            }
            BattleOutcome::Ongoing => {}
        }
        if run(observed)?.control.kind == GameControlKindV2::BattleReplacement {
            let (action, _) = observed.selected_action()?;
            dispatch(observed, action.clone(), GameDomainExecutionInputV1::None)?;
            dispatch(plain, action, GameDomainExecutionInputV1::None)?;
            assert_projection(observed, plain)?;
        } else {
            pair_turn(observed, plain, false)?;
        }
    }
    Err("bounded natural victory was not reached".into())
}

#[test]
fn natural_bootstrap_switch_and_ko_preserve_legacy_gameplay() -> TestResult {
    let (mut observed, mut plain) = pair()?;
    let original = run(&observed)?.party[0].id;
    let incoming = run(&observed)?.party[1].id;
    assert!(owner(&observed)?.participants.is_empty());
    pair_turn(&mut observed, &mut plain, true)?;
    assert_eq!(
        run(&observed)?.battle.as_ref().ok_or("battle")?.field.slots[0].occupant,
        Some(incoming)
    );
    assert_eq!(
        owner(&observed)?.participants,
        vec![CurrentBattleParticipantV1 {
            pokemon: original,
            owner: SeatId::new(safe(1)?)
        }]
    );
    pair_turn(&mut observed, &mut plain, false)?;
    assert!(
        owner(&observed)?
            .participants
            .iter()
            .any(|participant| participant.pokemon == incoming)
    );
    win(&mut observed, &mut plain)?;
    let faint = owner(&observed)?
        .faints
        .iter()
        .find(|faint| faint.slot.side == BattleSide::Enemy)
        .ok_or("real enemy KO")?;
    assert!(faint.before_hp > 0);
    assert_eq!(faint.owner, None);
    assert!(
        faint
            .participants
            .iter()
            .any(|participant| participant.pokemon == original)
    );
    assert!(
        faint
            .participants
            .iter()
            .any(|participant| participant.pokemon == incoming)
    );
    assert_projection(&observed, &plain)?;
    Ok(())
}

#[test]
fn current_faint_membership_uses_stable_ids_and_removes_player_after_recording() -> TestResult {
    let (mut observed, _) = pair()?;
    let victim = run(&observed)?.party[0].id;
    // Deliberately scripted enemy-only turns isolate a real damage/KO transition on a natural target.
    // This is not a production complete-command or AI witness.
    for _ in 0..MAX_SCRIPTED_TURNS {
        let selected = commands(&observed, false, true)?;
        turn(&mut observed, selected)?;
        if owner(&observed)?
            .faints
            .iter()
            .any(|faint| faint.pokemon == victim)
        {
            break;
        }
    }
    let faint = owner(&observed)?
        .faints
        .iter()
        .find(|faint| faint.pokemon == victim)
        .ok_or("real player KO")?;
    assert_eq!(faint.slot.side, BattleSide::Player);
    assert_eq!(faint.owner, Some(owner(&observed)?.authority));
    assert!(
        faint
            .participants
            .iter()
            .any(|participant| participant.pokemon == victim)
    );
    assert!(
        !owner(&observed)?
            .participants
            .iter()
            .any(|participant| participant.pokemon == victim)
    );
    let incoming = run(&observed)?.party[1].id;
    let (action, _) = observed.selected_action()?;
    assert!(matches!(
        action,
        GameActionV1::Battle {
            action: BattleUiActionV1::SelectReplacement { .. }
        }
    ));
    dispatch(&mut observed, action, GameDomainExecutionInputV1::None)?;
    assert!(
        !owner(&observed)?
            .participants
            .iter()
            .any(|participant| participant.pokemon == incoming)
    );
    let selected = commands(&observed, false, false)?;
    turn(&mut observed, selected)?;
    assert!(
        owner(&observed)?
            .participants
            .iter()
            .any(|participant| participant.pokemon == incoming)
    );
    Ok(())
}

#[test]
fn observed_save_snapshot_and_material_replay_preserve_ownership() -> TestResult {
    let (mut observed, mut plain) = pair()?;
    pair_turn(&mut observed, &mut plain, true)?;
    let state = observed.state().ok_or("state")?.clone();
    let save = GameSaveV2::new(state.content_identity.clone(), safe(1)?, state.clone())?;
    let bytes = save.encode()?;
    assert_eq!(GameSaveV2::decode(&bytes)?.state, state);
    assert_eq!(GameSaveV2::decode(&bytes)?.encode()?, bytes);
    let snapshot = observed.snapshot();
    let snapshot_bytes = serde_json::to_vec(&snapshot)?;
    let mut restored = GameRuntimeV6::from_snapshot(
        serde_json::from_slice(&snapshot_bytes)?,
        observed.content().clone(),
    )?;
    let before = restored.snapshot();
    let selected = commands(&observed, false, false)?;
    let first = turn(&mut observed, selected.clone())?;
    let replay = turn(&mut restored, selected)?;
    assert_eq!(first.material_bytes, replay.material_bytes);
    assert_eq!(restored.state(), observed.state());
    let mut alternate = GameRuntimeV6::from_snapshot(before.clone(), observed.content().clone())?;
    let alternate_commands = commands(&alternate, true, false)?;
    let conflicting = turn(&mut alternate, alternate_commands)?;
    let first_material = GameMaterialV6::decode(&first.material_bytes)?;
    let alternate_material = GameMaterialV6::decode(&conflicting.material_bytes)?;
    assert_eq!(
        alternate_material.transition().operation_id,
        first_material.transition().operation_id
    );
    assert_eq!(
        alternate_material.transition().authority_revision,
        first_material.transition().authority_revision
    );
    assert_eq!(
        alternate_material.transition().before_digest,
        first_material.transition().before_digest
    );
    assert_ne!(conflicting.material_bytes, first.material_bytes);
    assert_ne!(
        alternate_material.transition().after_digest,
        first_material.transition().after_digest
    );
    let mut replica = GameRuntimeV6::from_snapshot(before, observed.content().clone())?;
    assert_eq!(
        replica.apply_material_bytes(&first.material_bytes)?,
        GameMaterialApplyOutcomeV6::Applied
    );
    assert_eq!(
        replica.apply_material_bytes(&first.material_bytes)?,
        GameMaterialApplyOutcomeV6::DuplicateApplied
    );
    assert_eq!(replica.state(), observed.state());
    let accepted = serde_json::to_vec(&replica.snapshot())?;
    // Both candidates came from real dispatches at the same saved frontier.
    let Err(GameRuntimeV6Error::Material(message)) =
        replica.apply_material_bytes(&conflicting.material_bytes)
    else {
        return Err("conflicting material duplicate must be rejected".into());
    };
    assert_eq!(
        message,
        GameMaterialV6Error::ConflictingDuplicate.to_string()
    );
    assert_eq!(serde_json::to_vec(&replica.snapshot())?, accepted);
    Ok(())
}

#[test]
fn historical_owner_absence_preserves_canonical_bytes() -> TestResult {
    let content = content()?;
    let state = construct_natural_run_v6(&bootstrap(&content)?, &content, safe(1)?)?;
    assert!(state.current_battle_participation.is_none());
    let bytes = er_canonical::canonical_bytes(&state)?;
    let mut historical = serde_json::to_value(&state)?;
    assert!(
        historical
            .as_object_mut()
            .ok_or("object")?
            .remove("current_battle_participation")
            .is_none()
    );
    let decoded: GameStateV6 = serde_json::from_value(historical)?;
    assert_eq!(er_canonical::canonical_bytes(&decoded)?, bytes);
    let save = GameSaveV2::new(state.content_identity.clone(), safe(1)?, state)?;
    let historical_bytes = save.encode()?;
    assert_eq!(
        GameSaveV2::decode(&historical_bytes)?.encode()?,
        historical_bytes
    );
    let (mut observed, mut plain) = pair()?;
    pair_turn(&mut observed, &mut plain, false)?;
    assert_projection(&observed, &plain)?;
    Ok(())
}

#[test]
fn malformed_evidence_capacity_and_counter_failures_roll_back() -> TestResult {
    let (mut observed, mut plain) = pair()?;
    let pristine = observed.state().ok_or("state")?.clone();
    let original_owner = owner(&observed)?.clone();
    let source_run = run(&observed)?.clone();
    let bogus = CurrentBattleObservationEventV1::HpChanged {
        pokemon: source_run.party[0].id,
        before: source_run.party[0]
            .hp
            .checked_add(1)
            .ok_or("HP test bound")?,
        after: 0,
    };
    assert_eq!(
        original_owner.observe_turn(
            &source_run,
            &source_run,
            &vec![bogus; MAX_CURRENT_PARTICIPATION_EVENTS_V1 + 1]
        ),
        Err(CurrentBattleParticipationError::Unsupported)
    );
    assert_eq!(observed.state(), Some(&pristine));
    let mut oversized = source_run.clone();
    let duplicated = oversized.party[0].clone();
    oversized.party.resize(7, duplicated);
    assert_eq!(
        CurrentBattleParticipationV1::fresh(&oversized, safe(1)?),
        Err(CurrentBattleParticipationError::Unsupported)
    );
    pair_turn(&mut observed, &mut plain, false)?;
    // The actual next-turn state satisfies the turn frontier, so this reaches the bad before-HP evidence.
    assert_eq!(
        original_owner.observe_turn(&source_run, run(&observed)?, &[bogus]),
        Err(CurrentBattleParticipationError::Invalid)
    );
    assert_eq!(
        owner(&observed)?.next_turn,
        run(&observed)?.battle.as_ref().ok_or("battle")?.turn
    );
    win(&mut observed, &mut plain)?;
    let settled = observed.state().ok_or("state")?.clone();
    for case in 0..6 {
        let mut forged = settled.clone();
        let value = forged
            .current_battle_participation
            .as_mut()
            .ok_or("owner")?;
        match case {
            0 => value.next_occurrence = safe(value.next_occurrence.get() + 1)?,
            1 => value.authority = SeatId::new(safe(99)?),
            2 => value.faints[0].owner = Some(value.authority),
            3 => value.faints[0].before_hp = u32::MAX,
            4 => value.participants.push(value.participants[0]),
            _ => value.faints.push(value.faints[0].clone()),
        }
        assert!(forged.validate().is_err(), "forgery {case}");
    }
    let mut revived = settled.clone();
    let victim = revived
        .current_battle_participation
        .as_ref()
        .ok_or("owner")?
        .faints[0]
        .pokemon;
    let active = revived.active_run.as_mut().ok_or("run")?;
    let battle = active.battle.as_mut().ok_or("battle")?;
    let pokemon = active
        .party
        .iter_mut()
        .chain(&mut battle.enemy_party)
        .find(|pokemon| pokemon.id == victim)
        .ok_or("victim")?;
    pokemon.hp = 1;
    pokemon.fainted = false;
    assert!(revived.validate().is_err());

    // A valid maximum counter is accepted until a real KO would consume it; then the entire dispatch rolls back.
    let mut exhausted_state = pristine;
    exhausted_state
        .current_battle_participation
        .as_mut()
        .ok_or("owner")?
        .next_occurrence = safe(9_007_199_254_740_991)?;
    let revision = exhausted_state
        .active_run
        .as_ref()
        .ok_or("run")?
        .control
        .revision;
    let mut exhausted = GameRuntimeV6::new(Some(exhausted_state), content()?, revision)?;
    let mut rejected = false;
    for _ in 0..MAX_SCRIPTED_TURNS {
        let before = serde_json::to_vec(&exhausted.snapshot())?;
        let selected = commands(&exhausted, false, false)?;
        match turn(&mut exhausted, selected) {
            Ok(_) => {}
            Err(error) => {
                assert!(
                    error.to_string().contains("counter is exhausted"),
                    "{error}"
                );
                assert_eq!(serde_json::to_vec(&exhausted.snapshot())?, before);
                rejected = true;
                break;
            }
        }
    }
    assert!(
        rejected,
        "real KO must reach the checked occurrence frontier"
    );
    Ok(())
}

#[test]
fn next_natural_battle_retains_occurrence_highwater() -> TestResult {
    let (mut observed, mut plain) = pair()?;
    win(&mut observed, &mut plain)?;
    let previous_battle = owner(&observed)?.battle;
    let next = owner(&observed)?.next_occurrence;
    assert!(!owner(&observed)?.faints.is_empty());
    for _ in 0..12 {
        if run(&observed)?.control.kind != GameControlKindV2::Progression {
            break;
        }
        let (action, _) = observed.selected_action()?;
        dispatch(
            &mut observed,
            action.clone(),
            GameDomainExecutionInputV1::None,
        )?;
        dispatch(&mut plain, action, GameDomainExecutionInputV1::None)?;
        assert_projection(&observed, &plain)?;
    }
    assert_eq!(run(&observed)?.control.kind, GameControlKindV2::Reward);
    let decline = GameActionV1::Reward {
        action: RewardActionV1::Decline,
    };
    dispatch(
        &mut observed,
        decline.clone(),
        GameDomainExecutionInputV1::None,
    )?;
    dispatch(&mut plain, decline, GameDomainExecutionInputV1::None)?;
    assert_projection(&observed, &plain)?;
    assert_ne!(owner(&observed)?.battle, previous_battle);
    assert_eq!(owner(&observed)?.next_occurrence, next);
    assert!(owner(&observed)?.faints.is_empty());
    assert!(owner(&observed)?.participants.is_empty());
    pair_turn(&mut observed, &mut plain, false)?;
    assert!(!owner(&observed)?.participants.is_empty());
    assert_projection(&observed, &plain)?;
    Ok(())
}

// XP owner witnesses below require the separately audited regenerated bundle remotely.
// They use natural actors and real current resolver turns; no TS phase or neutral award oracle is claimed.
fn experience_state() -> TestResult<GameStateV6> {
    use er_state::current_experience_owner::CurrentExperienceCapPolicyV1;
    let content = content()?;
    let base = bootstrap(&content)?;
    // Each seed is a constructor input. No party, field, HP or compiled row is patched.
    for index in 0..64 {
        let mut selection = base.clone();
        selection.seed = format!("m9e-pending-experience/{index}");
        selection.validate()?;
        let observed = construct_natural_run_v6_with_participation(&selection, &content, safe(1)?)?;
        let battle = observed.active_run.as_ref().and_then(|run| run.battle.as_ref()).ok_or("natural battle")?;
        if battle.enemy_party.iter().all(|pokemon| content.progression
            .experience_for_compiled_form(pokemon.species_id, pokemon.form_index).is_ok()) {
            return Ok(er_game::m9e_new_run_v6::construct_natural_run_v6_with_pending_experience(
                &selection, &content, safe(1)?, CurrentExperienceCapPolicyV1::NormalClassic)?);
        }
    }
    Err("64 natural seeds found no unambiguous XP source; regenerated metadata is mandatory".into())
}

fn experience_runtime() -> TestResult<GameRuntimeV6> {
    let state = experience_state()?;
    let mut runtime = GameRuntimeV6::new(None, content()?, safe(1)?)?;
    dispatch(&mut runtime, GameActionV1::Bootstrap { action: BootstrapActionV1::Confirm },
        GameDomainExecutionInputV1::BootstrapCandidate(state))?;
    Ok(runtime)
}

fn experience(runtime: &GameRuntimeV6) -> TestResult<&er_state::current_experience_owner::CurrentExperienceOwnerV1> {
    owner(runtime)?.experience.as_ref().ok_or_else(|| "pending XP context required".into())
}

fn reach_pending_experience(runtime: &mut GameRuntimeV6) -> TestResult {
    for _ in 0..MAX_SCRIPTED_TURNS {
        if !experience(runtime)?.pending.is_empty() { return Ok(()); }
        if run(runtime)?.battle.as_ref().ok_or("battle")?.outcome != BattleOutcome::Ongoing {
            return Err("natural battle ended without the required enemy faint".into());
        }
        if run(runtime)?.control.kind == GameControlKindV2::BattleReplacement {
            let (action, _) = runtime.selected_action()?;
            dispatch(runtime, action, GameDomainExecutionInputV1::None)?;
        } else {
            let selected = commands(runtime, false, false)?;
            turn(runtime, selected)?;
        }
    }
    Err("bounded natural enemy faint did not occur".into())
}

#[test]
fn natural_enemy_faint_owns_unresolved_experience_without_applying_amount() -> TestResult {
    let mut runtime = experience_runtime()?;
    let original = run(&runtime)?.party.iter().map(|pokemon| (pokemon.id, pokemon.level, pokemon.experience)).collect::<Vec<_>>();
    let source = experience(&runtime)?.enemy_sources.clone();
    reach_pending_experience(&mut runtime)?;
    let pending = &experience(&runtime)?.pending;
    assert_eq!(pending.len(), 1);
    let faint = owner(&runtime)?.faints.iter().find(|faint| faint.slot.side == BattleSide::Enemy).ok_or("enemy faint")?;
    assert_eq!(pending[0].observation, faint.occurrence);
    assert_eq!(pending[0].participants, faint.participants);
    assert_eq!(pending[0].source, source[0]);
    assert_eq!(pending[0].id, safe(1)?);
    assert_eq!(experience(&runtime)?.next_pending_id, safe(2)?);
    assert_eq!(experience(&runtime)?.next_observation, owner(&runtime)?.next_occurrence);
    assert_eq!(run(&runtime)?.party.iter().map(|pokemon| (pokemon.id, pokemon.level, pokemon.experience)).collect::<Vec<_>>(), original);
    assert_eq!(pending[0].recipients.len(), run(&runtime)?.party.len());
    for (recipient, pokemon) in pending[0].recipients.iter().zip(&run(&runtime)?.party) {
        assert_eq!((recipient.pokemon, recipient.hp, recipient.level, recipient.experience),
            (pokemon.id, pokemon.hp, pokemon.level, pokemon.experience));
    }
    assert!(run(&runtime)?.progression_queue.tasks.is_empty());
    assert_eq!(run(&runtime)?.control.kind, GameControlKindV2::Waiting);
    assert!(!run(&runtime)?.control.actionable);
    assert_eq!(pending[0].continuation, er_state::current_experience_owner::CurrentExperienceContinuationV1::WaveVictoryTail);
    Ok(())
}

#[test]
fn pending_experience_survives_real_save_replay_and_rejects_owner_stripping_material() -> TestResult {
    use er_game::m9e_material_v6::{GamePlatformEffectV2, game_state_digest};
    let mut runtime = experience_runtime()?;
    reach_pending_experience(&mut runtime)?;
    let snapshot = runtime.snapshot();
    let snapshot_bytes = er_canonical::canonical_bytes(&snapshot)?;
    let mut replica = GameRuntimeV6::from_snapshot(serde_json::from_slice(&snapshot_bytes)?, content()?)?;
    assert_eq!(er_canonical::canonical_bytes(&replica.snapshot())?, snapshot_bytes);
    let expected = experience(&runtime)?.clone();
    let saved = dispatch(&mut runtime,
        GameActionV1::Save { action: er_types::SaveActionV1::Write { slot: "pending-xp".to_owned() } },
        GameDomainExecutionInputV1::SaveGeneration(safe(1)?))?;
    let bytes = saved.platform_effects.iter().find_map(|effect| match effect {
        GamePlatformEffectV2::StorageWrite { bytes, .. } => Some(bytes),
        _ => None,
    }).ok_or("actual Save write")?;
    let decoded = GameSaveV2::decode(bytes)?;
    assert_eq!(&decoded.encode()?, bytes);
    assert_eq!(decoded.state.current_battle_participation.as_ref().and_then(|owner| owner.experience.as_ref()), Some(&expected));
    assert_eq!(replica.apply_material_bytes(&saved.material_bytes)?, GameMaterialApplyOutcomeV6::Applied);
    assert_eq!(replica.apply_material_bytes(&saved.material_bytes)?, GameMaterialApplyOutcomeV6::DuplicateApplied);
    assert_eq!(replica.snapshot(), runtime.snapshot());
    assert_eq!(experience(&runtime)?, &expected);

    let mut stripped = saved.material.clone();
    let GameMaterialV6::GameAction(transition) = &mut stripped else { return Err("Save GameAction material required".into()); };
    transition.after_state.current_battle_participation.as_mut().ok_or("owner")?.experience = None;
    transition.after_state.validate_with(content()?.as_ref())?;
    transition.after_digest = game_state_digest(&transition.after_state)?;
    for mutation in &mut transition.mutations { mutation.after_digest = transition.after_digest.clone(); }
    stripped.validate()?; // Otherwise valid material and state; only before→after XP conservation rejects it.
    let mut guarded = GameRuntimeV6::from_snapshot(snapshot, content()?)?;
    let before = er_canonical::canonical_bytes(&guarded.snapshot())?;
    let error = guarded.apply_material_bytes(&stripped.canonical_bytes()?).err().ok_or("stripped owner must fail")?;
    assert_eq!(error, GameRuntimeV6Error::Material(GameMaterialV6Error::Invalid.to_string()));
    assert_eq!(er_canonical::canonical_bytes(&guarded.snapshot())?, before);
    Ok(())
}

#[test]
fn pending_experience_unsettled_tail_rejects_actions_and_next_encounter() -> TestResult {
    let mut runtime = experience_runtime()?;
    reach_pending_experience(&mut runtime)?;
    let before = er_canonical::canonical_bytes(&runtime.snapshot())?;
    for action in [
        GameActionV1::Terminal { action: er_types::TerminalActionV1::ReturnToTitle },
        GameActionV1::Save { action: er_types::SaveActionV1::Load { slot: "pending-xp".to_owned() } },
        GameActionV1::Reward { action: RewardActionV1::Decline },
        GameActionV1::Battle { action: BattleUiActionV1::OpenFight },
    ] {
        assert!(dispatch(&mut runtime, action, GameDomainExecutionInputV1::None).is_err());
        assert_eq!(er_canonical::canonical_bytes(&runtime.snapshot())?, before);
    }
    assert!(er_game::m9e_new_run_v6::advance_to_next_encounter_v6(runtime.state().ok_or("state")?, runtime.content()).is_err());
    assert_eq!(er_canonical::canonical_bytes(&runtime.snapshot())?, before);
    Ok(())
}

#[test]
fn pending_experience_restore_rejects_source_policy_and_frontier_forgeries() -> TestResult {
    use er_state::current_experience_owner::{CurrentExperienceCapPolicyV1, CurrentExperienceEncounterV1};
    let mut runtime = experience_runtime()?;
    reach_pending_experience(&mut runtime)?;
    let original = runtime.snapshot();
    for case in 0..8 {
        let mut forged = original.clone();
        let xp = forged.state.as_mut().and_then(|state| state.current_battle_participation.as_mut())
            .and_then(|owner| owner.experience.as_mut()).ok_or("owner")?;
        match case {
            0 => xp.cap_policy = CurrentExperienceCapPolicyV1::Ignored,
            1 => xp.cap_policy = CurrentExperienceCapPolicyV1::Override(100),
            2 => xp.encounter = CurrentExperienceEncounterV1::OrdinaryTrainer,
            3 => xp.next_pending_id = safe(3)?,
            4 => xp.next_observation = safe(xp.next_observation.get() + 1)?,
            5 => { xp.enemy_sources[0].unadjusted_base_exp = safe(xp.enemy_sources[0].unadjusted_base_exp.get() + 1)?; xp.pending[0].source = xp.enemy_sources[0].clone(); }
            6 => xp.pending[0].recipients.reverse(),
            _ => xp.enemy_sources[0].source_form = Some(0),
        }
        assert!(GameRuntimeV6::from_snapshot(forged, content()?).is_err(), "forgery {case}");
    }
    let other_mode = content()?.bundle().bootstrap.modes.iter().find(|mode| mode.key != "CLASSIC")
        .map(|mode| mode.mode).ok_or("non-Classic content mode required")?;
    let mut forged_mode = original.clone();
    let state = forged_mode.state.as_mut().ok_or("state")?;
    state.active_run.as_mut().ok_or("run")?.mode = other_mode;
    state.current_battle_participation.as_mut().and_then(|owner| owner.experience.as_mut()).ok_or("owner")?.mode = other_mode;
    state.validate()?; // Structural match alone is insufficient: prepared content rejects this mode.
    assert!(GameRuntimeV6::from_snapshot(forged_mode, content()?).is_err());
    let mut unknown = serde_json::to_value(experience(&runtime)?)?;
    unknown.as_object_mut().ok_or("owner object")?.insert("summon_override".to_owned(), serde_json::Value::Bool(true));
    assert!(serde_json::from_value::<er_state::current_experience_owner::CurrentExperienceOwnerV1>(unknown).is_err());
    assert_eq!(runtime.snapshot(), original);
    Ok(())
}

#[test]
fn pending_experience_counter_exhaustion_rolls_back_real_enemy_faint() -> TestResult {
    let mut state = experience_state()?;
    state.current_battle_participation.as_mut().and_then(|owner| owner.experience.as_mut()).ok_or("owner")?
        .next_pending_id = safe(9_007_199_254_740_991)?;
    state.validate_with(content()?.as_ref())?;
    let mut runtime = GameRuntimeV6::new(Some(state), content()?, safe(1)?)?;
    for _ in 0..MAX_SCRIPTED_TURNS {
        let before = er_canonical::canonical_bytes(&runtime.snapshot())?;
        let selected = commands(&runtime, false, false)?;
        match turn(&mut runtime, selected) {
            Ok(_) => {}
            Err(error) => {
                assert!(error.to_string().contains("counter is exhausted"), "{error}");
                assert_eq!(er_canonical::canonical_bytes(&runtime.snapshot())?, before);
                assert!(experience(&runtime)?.pending.is_empty());
                return Ok(());
            }
        }
    }
    Err("bounded real enemy faint never reached the checked XP identity frontier".into())
}