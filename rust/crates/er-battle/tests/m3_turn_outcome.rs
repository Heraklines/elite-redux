use std::error::Error;

use er_battle::ability::INTIMIDATE_ABILITY_ID;
use er_battle::faint::{FaintCandidate, queue_faint};
use er_battle::legality::{build_command_offer, build_scripted_enemy_offer};
use er_battle::outcome::derive_battle_outcome;
use er_battle::resolver::{BattleMutation, BattleNextDecision};
use er_battle::{resolve_replacement, resolve_turn};
use er_content::pack::{ContentPack, selected_content_pack, selected_m4_content_pack};
use er_content::species::find_species;
use er_rng::audit::RngReason;
use er_rng::battle::BattleRngState;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{BattleOutcome, BattleState, CommandCollectionState, ReplacementProgress};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::digest::MechanicalStateDigest;
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::BattleFormat;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1, BattleTargetSelection,
    CommandAdmissionSource, CommandFrontierEntry, CommandFrontierStatus, CommandSet,
    ReplacementSelection, ScriptedEnemyBattleCommandV1, player_command_operation_id,
    replacement_operation_id, scripted_enemy_command_operation_id, turn_result_operation_id,
};
use er_types::battle_ids::{
    AbilityId, AuthorityEpoch, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId,
    MenuInstanceId, MoveId, MoveSlotIndex, PartyIndex, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{ActionDisposition, ResolvedActionKind, StatusKind};
use er_types::battle_ui::BattlePresentationKind;
use er_types::{OperationId, SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn seat(value: u64) -> TestResult<SeatId> {
    Ok(SeatId::new(safe(value)?))
}

fn slot(side: BattleSide, position: u8) -> TestResult<FieldSlot> {
    Ok(FieldSlot::new(side, position)?)
}

fn pokemon_id(value: u64) -> TestResult<PokemonId> {
    Ok(PokemonId::new(safe(value)?))
}

fn move_id(value: u64) -> TestResult<MoveId> {
    Ok(MoveId::new(safe(value)?))
}

fn turn(value: u64) -> TestResult<TurnIndex> {
    Ok(TurnIndex::new(safe(value)?)?)
}

fn wave(value: u64) -> TestResult<WaveIndex> {
    Ok(WaveIndex::new(safe(value)?)?)
}

fn pokemon(
    content: &ContentPack,
    id: u64,
    owner_seat: Option<SeatId>,
    moves: &[u64],
    hp: u32,
    status_kind: StatusKind,
    speed: u32,
) -> TestResult<PokemonState> {
    let species = find_species(&content.species, SpeciesId::new(safe(19)?))?;
    let mut move_slots = [None, None, None, None];
    for (index, value) in moves.iter().copied().enumerate() {
        let destination = move_slots
            .get_mut(index)
            .ok_or("test fixture exceeded four move slots")?;
        *destination = Some(MoveSlotState {
            move_id: move_id(value)?,
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        });
    }

    Ok(PokemonState::new(
        pokemon_id(id)?,
        owner_seat,
        species.id,
        0,
        25,
        species.base_types,
        BattleStats {
            hp: 100,
            attack: 100,
            defense: 100,
            special_attack: 100,
            special_defense: 100,
            speed,
        },
        hp,
        100,
        StatusState {
            kind: status_kind,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        },
        StatStages {
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
            accuracy: 0,
            evasion: 0,
        },
        move_slots,
        AbilityLoadout {
            active: AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        hp == 0,
    )?)
}

fn state_with_parties(
    content: &ContentPack,
    player_party: Vec<PokemonState>,
    enemy_party: Vec<PokemonState>,
) -> TestResult<GameState> {
    let player_actor = player_party
        .first()
        .ok_or("test state requires a player party")?
        .id;
    let enemy_actor = enemy_party
        .first()
        .ok_or("test state requires an enemy party")?
        .id;
    let format = BattleFormat::single();
    let battle_wave = wave(1)?;
    let battle_turn = turn(1)?;
    let player_slot = slot(BattleSide::Player, 0)?;
    let enemy_slot = slot(BattleSide::Enemy, 0)?;
    let field = FieldState::new_for_format(
        &format,
        vec![
            FieldSlotState::new(player_slot, Some(player_actor)),
            FieldSlotState::new(enemy_slot, Some(enemy_actor)),
        ],
    )?;
    let battle = BattleState {
        battle_id: BattleId::new(safe(1)?),
        wave: battle_wave,
        wave_seed: "m3-turn-outcome-wave".to_owned(),
        turn: battle_turn,
        format,
        authority_seat: seat(1)?,
        player_party,
        enemy_party,
        field,
        weather: WeatherState {
            kind: WeatherKind::None,
            remaining_turns: 0,
        },
        terrain: TerrainState {
            kind: TerrainKind::None,
            remaining_turns: 0,
        },
        arena_conditions: Vec::new(),
        global_ability_suppression: GlobalAbilitySuppressionState {
            ignore_abilities: false,
            source: None,
        },
        battle_rng: BattleRngState::new("m3-turn-outcome-battle", battle_turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    };

    Ok(GameState::new(
        content.hash.clone(),
        GameModeId::new(safe(1)?),
        battle_wave,
        BattleId::new(safe(2)?),
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-turn-outcome-run").state(),
        },
        Some(battle),
    )?)
}

fn battle(state: &GameState) -> TestResult<&BattleState> {
    state.battle.as_ref().ok_or_else(|| "missing battle".into())
}

fn battle_mut(state: &mut GameState) -> TestResult<&mut BattleState> {
    state.battle.as_mut().ok_or_else(|| "missing battle".into())
}

fn command_for_move(
    actor: PokemonId,
    move_value: u64,
    target: FieldSlot,
) -> TestResult<BattleCommand> {
    let targets = if move_value == 589 {
        BattleTargetSelection::selected(vec![target])?
    } else {
        BattleTargetSelection::implicit()
    };
    Ok(BattleCommand::fight(actor, MoveSlotIndex::ZERO, targets)?)
}

fn admit_single_fights(
    state: &mut GameState,
    content: &ContentPack,
    player_move: u64,
    enemy_move: u64,
) -> TestResult<CommandSet> {
    let player_slot = slot(BattleSide::Player, 0)?;
    let enemy_slot = slot(BattleSide::Enemy, 0)?;
    let (battle_id, battle_wave, battle_turn, player_actor, enemy_actor) = {
        let current = battle(state)?;
        (
            current.battle_id,
            current.wave,
            current.turn,
            current
                .player_party
                .first()
                .ok_or("missing player actor")?
                .id,
            current.enemy_party.first().ok_or("missing enemy actor")?.id,
        )
    };

    let player_command = command_for_move(player_actor, player_move, enemy_slot)?;
    let enemy_command = command_for_move(enemy_actor, enemy_move, player_slot)?;
    let player_offer = build_command_offer(state, player_slot, content)?;
    let enemy_offer = build_scripted_enemy_offer(state, enemy_slot, &enemy_command, content)?;
    let player_operation =
        player_command_operation_id(battle_id, battle_wave, battle_turn, player_slot, seat(1)?)?;
    let enemy_operation = scripted_enemy_command_operation_id(
        battle_id,
        battle_wave,
        battle_turn,
        enemy_slot,
        SafeU53::ZERO,
    )?;
    let player_proposal = BattleCommandProposalV1::new(
        player_operation.clone(),
        battle_id,
        battle_wave,
        battle_turn,
        seat(1)?,
        player_actor,
        player_slot,
        player_command,
        MenuInstanceId::new(safe(1)?),
        "turn/player",
    )?;
    let enemy_command = ScriptedEnemyBattleCommandV1::new(
        enemy_operation.clone(),
        battle_id,
        battle_wave,
        battle_turn,
        SafeU53::ZERO,
        enemy_actor,
        enemy_slot,
        enemy_command,
    )?;
    let player_accepted = AcceptedBattleCommand::human(player_proposal);
    let enemy_accepted = AcceptedBattleCommand::scripted_enemy(enemy_command);
    let frontier = vec![
        CommandFrontierEntry::new(
            player_operation,
            Some(seat(1)?),
            player_actor,
            player_slot,
            player_offer,
            CommandFrontierStatus::Admitted {
                command: player_accepted.clone(),
                source: CommandAdmissionSource::AuthorityLocalInternal,
            },
        )?,
        CommandFrontierEntry::new(
            enemy_operation,
            None,
            enemy_actor,
            enemy_slot,
            enemy_offer,
            CommandFrontierStatus::Admitted {
                command: enemy_accepted.clone(),
                source: CommandAdmissionSource::ScriptedEnemy,
            },
        )?,
    ];
    battle_mut(state)?.command_state = CommandCollectionState::new(frontier, Vec::new())?;
    Ok(CommandSet::new(vec![player_accepted, enemy_accepted])?)
}

fn turn_operation(state: &GameState) -> TestResult<OperationId> {
    let current = battle(state)?;
    Ok(turn_result_operation_id(
        current.battle_id,
        current.wave,
        current.turn,
    )?)
}

#[test]
fn outcome_precedence_prefers_defeat_when_both_parties_are_empty() -> TestResult {
    let content = selected_content_pack()?;
    let mut state = state_with_parties(
        &content,
        vec![pokemon(
            &content,
            1,
            Some(seat(1)?),
            &[],
            100,
            StatusKind::None,
            100,
        )?],
        vec![pokemon(&content, 2, None, &[], 100, StatusKind::None, 100)?],
    )?;
    let battle = battle_mut(&mut state)?;
    assert_eq!(derive_battle_outcome(battle), BattleOutcome::Ongoing);

    battle.enemy_party[0].hp = 0;
    battle.enemy_party[0].fainted = true;
    assert_eq!(derive_battle_outcome(battle), BattleOutcome::Victory);

    battle.player_party[0].hp = 0;
    battle.player_party[0].fainted = true;
    assert_eq!(derive_battle_outcome(battle), BattleOutcome::Defeat);
    Ok(())
}

#[test]
fn successful_ongoing_turn_advances_once_clears_frontier_and_preserves_before_input() -> TestResult
{
    let content = selected_content_pack()?;
    let mut state = state_with_parties(
        &content,
        vec![pokemon(
            &content,
            1,
            Some(seat(1)?),
            &[589],
            100,
            StatusKind::None,
            200,
        )?],
        vec![pokemon(
            &content,
            2,
            None,
            &[589],
            100,
            StatusKind::None,
            100,
        )?],
    )?;
    let commands = admit_single_fights(&mut state, &content, 589, 589)?;
    let before = state.clone();
    let operation = turn_operation(&before)?;
    let transition = resolve_turn(
        &before,
        &commands,
        AuthorityEpoch::new(safe(5)?),
        &operation,
        &content,
    )?;

    assert_eq!(transition.before_state, before);
    assert_eq!(transition.outcome, BattleOutcome::Ongoing);
    assert_eq!(
        transition.next_decision,
        BattleNextDecision::CommandFrontier
    );
    let before_battle = battle(&before)?;
    let after_battle = battle(&transition.after_state)?;
    assert_eq!(before_battle.turn, turn(1)?);
    assert_eq!(after_battle.turn, turn(2)?);
    assert_eq!(after_battle.turn, after_battle.battle_rng.turn);
    assert!(after_battle.command_state.frontier.is_empty());
    assert_eq!(
        transition.after_digest,
        MechanicalStateDigest::compute(&transition.after_state)?
    );
    assert_eq!(transition.rng_audit.len(), 1);
    assert_eq!(
        transition
            .mutations
            .iter()
            .filter(|mutation| matches!(mutation, BattleMutation::BattleRngChanged { .. }))
            .count(),
        1
    );
    assert_eq!(
        transition
            .mutations
            .iter()
            .filter(|mutation| matches!(mutation, BattleMutation::TurnAdvanced { .. }))
            .count(),
        1
    );
    let move_events = transition
        .presentation
        .iter()
        .filter(|event| matches!(&event.kind, BattlePresentationKind::MoveUsed { .. }))
        .collect::<Vec<_>>();
    assert_eq!(move_events.len(), 2);
    for (index, event) in transition.presentation.iter().enumerate() {
        assert_eq!(event.event_id.operation_id, operation);
        assert_eq!(event.event_id.sequence, safe(u64::try_from(index)?)?);
    }
    Ok(())
}

#[test]
fn trusted_turn_finalizer_metadata_and_digest_use_finalized_state() -> TestResult {
    let content = selected_content_pack()?;
    let mut state = state_with_parties(
        &content,
        vec![pokemon(
            &content,
            1,
            Some(seat(1)?),
            &[589],
            100,
            StatusKind::None,
            200,
        )?],
        vec![pokemon(
            &content,
            2,
            None,
            &[589],
            100,
            StatusKind::None,
            100,
        )?],
    )?;
    let commands = admit_single_fights(&mut state, &content, 589, 589)?;
    let before = state.clone();
    let mut finalizer_called = false;
    let transition = er_battle::resolve_turn_trusted_with_finalizer(
        &before,
        &commands,
        AuthorityEpoch::new(safe(5)?),
        &turn_operation(&before)?,
        &content,
        |before_seen, after, mutations, decision_hint| {
            finalizer_called = true;
            assert_eq!(before_seen, &before);
            assert_eq!(decision_hint, BattleNextDecision::CommandFrontier);
            let battle = after
                .battle
                .as_mut()
                .expect("resolved candidate must retain its battle");
            assert!(battle.command_state.frontier.is_empty());
            let (enemy, hp_before) = {
                let enemy = battle
                    .enemy_party
                    .first_mut()
                    .expect("resolved candidate must retain its enemy");
                let enemy_id = enemy.id;
                let hp_before = enemy.hp;
                assert!(hp_before > 0);
                enemy.hp = 0;
                enemy.fainted = true;
                (enemy_id, hp_before)
            };
            mutations.push(BattleMutation::HpChanged {
                pokemon: enemy,
                before: hp_before,
                after: 0,
            });
            let field_slot = {
                let entry = battle
                    .field
                    .slots
                    .iter_mut()
                    .find(|entry| entry.occupant == Some(enemy))
                    .expect("resolved candidate must retain the enemy field occupant");
                entry.occupant = None;
                entry.slot
            };
            mutations.push(BattleMutation::FieldChanged {
                slot: field_slot,
                before: Some(enemy),
                after: None,
            });
            let outcome_before = battle.outcome;
            battle.outcome = BattleOutcome::Victory;
            mutations.push(BattleMutation::OutcomeChanged {
                before: outcome_before,
                after: BattleOutcome::Victory,
            });
            Ok::<(), er_battle::error::BattleResolveError>(())
        },
    )?;

    assert!(finalizer_called);
    assert_eq!(
        battle(&transition.after_state)?.outcome,
        BattleOutcome::Victory
    );
    assert_eq!(transition.outcome, BattleOutcome::Victory);
    assert_eq!(
        transition.next_decision,
        BattleNextDecision::Complete(BattleOutcome::Victory)
    );
    assert_eq!(
        transition.after_digest,
        MechanicalStateDigest::compute(&transition.after_state)?
    );
    assert!(matches!(
        transition.presentation.last().map(|event| &event.kind),
        Some(&BattlePresentationKind::BattleWon)
    ));
    Ok(())
}

#[test]
fn zero_authority_and_wrong_turn_operation_reject_atomically() -> TestResult {
    let content = selected_content_pack()?;
    let mut state = state_with_parties(
        &content,
        vec![pokemon(
            &content,
            1,
            Some(seat(1)?),
            &[589],
            100,
            StatusKind::None,
            200,
        )?],
        vec![pokemon(
            &content,
            2,
            None,
            &[589],
            100,
            StatusKind::None,
            100,
        )?],
    )?;
    let commands = admit_single_fights(&mut state, &content, 589, 589)?;
    let before = state.clone();
    let operation = turn_operation(&before)?;

    let zero_epoch = resolve_turn(
        &before,
        &commands,
        AuthorityEpoch::ZERO,
        &operation,
        &content,
    );
    assert!(zero_epoch.is_err());
    assert_eq!(state, before);

    let stale_operation =
        turn_result_operation_id(battle(&before)?.battle_id, battle(&before)?.wave, turn(2)?)?;
    let stale = resolve_turn(
        &before,
        &commands,
        AuthorityEpoch::new(safe(5)?),
        &stale_operation,
        &content,
    );
    assert!(stale.is_err());
    assert_eq!(state, before);
    Ok(())
}

#[test]
fn queued_fainted_actor_is_skipped_without_enemy_pp_or_rng() -> TestResult {
    let content = selected_content_pack()?;
    let player_id = pokemon_id(1)?;
    let enemy_id = pokemon_id(2)?;
    let mut state = state_with_parties(
        &content,
        vec![pokemon(
            &content,
            1,
            Some(seat(1)?),
            &[351],
            100,
            StatusKind::None,
            200,
        )?],
        vec![
            pokemon(&content, 2, None, &[351], 1, StatusKind::None, 100)?,
            pokemon(&content, 3, None, &[], 100, StatusKind::None, 100)?,
        ],
    )?;
    let commands = admit_single_fights(&mut state, &content, 351, 351)?;
    let before = state.clone();
    let enemy_operation = scripted_enemy_command_operation_id(
        battle(&before)?.battle_id,
        battle(&before)?.wave,
        battle(&before)?.turn,
        slot(BattleSide::Enemy, 0)?,
        SafeU53::ZERO,
    )?;
    let transition = resolve_turn(
        &before,
        &commands,
        AuthorityEpoch::new(safe(6)?),
        &turn_operation(&before)?,
        &content,
    )?;

    let skipped = transition
        .action_order
        .iter()
        .find(|action| action.actor == enemy_id && action.kind == ResolvedActionKind::Move)
        .ok_or("missing queued enemy action")?;
    assert_eq!(skipped.kind, ResolvedActionKind::Move);
    assert_eq!(skipped.disposition, ActionDisposition::SkippedActorInactive);
    assert_eq!(skipped.command_operation_id, Some(enemy_operation));
    let enemy_pp = battle(&transition.after_state)?
        .enemy_party
        .first()
        .and_then(|pokemon| pokemon.moves[0].as_ref())
        .ok_or("missing enemy move after skipped action")?;
    assert_eq!(enemy_pp.pp_used, 0);
    assert!(!transition.mutations.iter().any(|mutation| {
        matches!(
            mutation,
            BattleMutation::PpChanged { pokemon, .. } if *pokemon == enemy_id
        )
    }));
    assert_eq!(transition.rng_audit.len(), 3);
    assert_eq!(
        transition
            .rng_audit
            .iter()
            .map(|draw| draw.reason)
            .collect::<Vec<_>>(),
        vec![
            RngReason::SpeedTie,
            RngReason::CriticalHit,
            RngReason::DamageVariance,
        ]
    );
    assert_eq!(battle(&transition.after_state)?.enemy_party[0].id, enemy_id);
    assert_eq!(
        battle(&transition.after_state)?.player_party[0].id,
        player_id
    );
    assert!(transition.presentation.iter().any(|event| {
        matches!(
            &event.kind,
            BattlePresentationKind::MoveUsed { actor, .. } if *actor == player_id
        )
    }));
    assert!(!transition.presentation.iter().any(|event| {
        matches!(
            &event.kind,
            BattlePresentationKind::MoveUsed { actor, .. } if *actor == enemy_id
        )
    }));
    Ok(())
}

#[test]
fn residual_ko_queues_before_turn_advance_with_exact_source_occurrence() -> TestResult {
    let content = selected_content_pack()?;
    let enemy_id = pokemon_id(2)?;
    let mut state = state_with_parties(
        &content,
        vec![pokemon(
            &content,
            1,
            Some(seat(1)?),
            &[589],
            100,
            StatusKind::None,
            200,
        )?],
        vec![
            pokemon(&content, 2, None, &[589], 1, StatusKind::Poison, 100)?,
            pokemon(&content, 3, None, &[], 100, StatusKind::None, 100)?,
        ],
    )?;
    let commands = admit_single_fights(&mut state, &content, 589, 589)?;
    let before = state.clone();
    let source_epoch = AuthorityEpoch::new(safe(23)?);
    let before_turn = battle(&before)?.turn;
    let transition = resolve_turn(
        &before,
        &commands,
        source_epoch,
        &turn_operation(&before)?,
        &content,
    )?;

    let residual_index = transition
        .mutations
        .iter()
        .position(|mutation| {
            matches!(
                mutation,
                BattleMutation::HpChanged {
                    pokemon,
                    before: 1,
                    after: 0,
                } if *pokemon == enemy_id
            )
        })
        .ok_or("missing residual KO mutation")?;
    let turn_index = transition
        .mutations
        .iter()
        .position(|mutation| matches!(mutation, BattleMutation::TurnAdvanced { .. }))
        .ok_or("missing turn boundary mutation")?;
    assert!(residual_index < turn_index);

    let queued = transition
        .mutations
        .iter()
        .find_map(|mutation| match mutation {
            BattleMutation::FaintQueued { occurrence } if occurrence.pokemon == enemy_id => {
                Some(*occurrence)
            }
            _ => None,
        })
        .ok_or("missing residual faint queue mutation")?;
    assert_eq!(queued.source.epoch, source_epoch);
    assert_eq!(queued.source.wave, battle(&before)?.wave);
    assert_eq!(queued.source.resolved_turn, before_turn);
    assert_eq!(queued.source.turn_occurrence, 0);
    assert_eq!(queued.replacement, ReplacementProgress::NotRequired);
    let hp_event = transition
        .presentation
        .iter()
        .position(|event| {
            matches!(
                &event.kind,
                BattlePresentationKind::HpChanged {
                    pokemon,
                    before: 1,
                    after: 0,
                } if *pokemon == enemy_id
            )
        })
        .ok_or("missing residual HP presentation event")?;
    let faint_event = transition
        .presentation
        .iter()
        .position(|event| {
            matches!(
                &event.kind,
                BattlePresentationKind::Fainted { pokemon, occurrence }
                    if *pokemon == enemy_id && *occurrence == queued.id
            )
        })
        .ok_or("missing residual faint presentation event")?;
    assert!(hp_event < faint_event);
    assert_eq!(transition.rng_audit.len(), 1);
    assert_eq!(battle(&transition.after_state)?.turn, turn(2)?);
    Ok(())
}

#[test]
fn player_faint_stays_pending_until_replacement_material_resolves_it() -> TestResult {
    let content = selected_content_pack()?;
    for with_reserve in [true, false] {
        let active_id = pokemon_id(1)?;
        let reserve_id = pokemon_id(2)?;
        let mut player_party = vec![pokemon(
            &content,
            1,
            Some(seat(1)?),
            &[589],
            1,
            StatusKind::None,
            50,
        )?];
        if with_reserve {
            player_party.push(pokemon(
                &content,
                2,
                Some(seat(1)?),
                &[],
                100,
                StatusKind::None,
                100,
            )?);
        }
        let mut state = state_with_parties(
            &content,
            player_party,
            vec![pokemon(
                &content,
                3,
                None,
                &[351],
                100,
                StatusKind::None,
                200,
            )?],
        )?;
        let commands = admit_single_fights(&mut state, &content, 589, 351)?;
        let before = state.clone();
        let transition = resolve_turn(
            &before,
            &commands,
            AuthorityEpoch::new(safe(8)?),
            &turn_operation(&before)?,
            &content,
        )?;
        let after_battle = battle(&transition.after_state)?;
        let occurrence = after_battle
            .faint_queue
            .first()
            .ok_or("missing player faint occurrence")?;

        assert_eq!(transition.outcome, BattleOutcome::Ongoing);
        assert_eq!(occurrence.replacement, ReplacementProgress::Pending);
        assert_eq!(
            transition.next_decision,
            BattleNextDecision::Replacement {
                occurrence: occurrence.id,
            }
        );
        assert_eq!(
            after_battle
                .field
                .occupant(&after_battle.format, slot(BattleSide::Player, 0)?)?,
            Some(active_id)
        );
        assert_eq!(after_battle.turn, turn(2)?);

        if with_reserve {
            assert_eq!(after_battle.player_party[1].id, reserve_id);
        } else {
            assert!(
                !transition
                    .presentation
                    .iter()
                    .any(|event| matches!(&event.kind, BattlePresentationKind::BattleLost))
            );
            let occurrence = *occurrence;
            let before_replacement = transition.after_state.clone();
            let before_replacement_battle = battle(&before_replacement)?;
            let operation = replacement_operation_id(
                occurrence.source.epoch,
                before_replacement_battle.battle_id,
                occurrence.source.wave,
                occurrence.source.resolved_turn,
                occurrence.source.turn_occurrence,
                occurrence.slot,
                occurrence.owner_seat.ok_or("missing replacement owner")?,
            )?;
            let replacement = resolve_replacement(
                &before_replacement,
                occurrence.id,
                &ReplacementSelection::NoLegalReplacement,
                &operation,
                &content,
            )?;
            let replacement_battle = battle(&replacement.after_state)?;
            assert_eq!(replacement.before_state, before_replacement);
            assert_eq!(
                replacement.selection,
                ReplacementSelection::NoLegalReplacement
            );
            assert_eq!(
                replacement.occurrence.replacement,
                ReplacementProgress::Applied
            );
            assert_eq!(replacement.outcome, BattleOutcome::Defeat);
            assert_eq!(
                replacement.next_decision,
                BattleNextDecision::Complete(BattleOutcome::Defeat)
            );
            assert_eq!(
                replacement_battle
                    .field
                    .occupant(&replacement_battle.format, occurrence.slot)?,
                None
            );
            assert_eq!(replacement_battle.turn, after_battle.turn);
            assert_eq!(replacement_battle.battle_rng, after_battle.battle_rng);
            assert_eq!(replacement.presentation.len(), 1);
            assert!(matches!(
                &replacement.presentation[0].kind,
                BattlePresentationKind::BattleLost
            ));
            assert_eq!(replacement.presentation[0].event_id.operation_id, operation);
        }
    }
    Ok(())
}

#[test]
fn replacement_authenticates_stored_occurrence_consumes_no_turn_or_rng_and_drains_tail()
-> TestResult {
    let content = selected_content_pack()?;
    let player_active = pokemon_id(1)?;
    let player_reserve = pokemon_id(2)?;
    let enemy_active = pokemon_id(3)?;
    let mut state = state_with_parties(
        &content,
        vec![
            pokemon(&content, 1, Some(seat(1)?), &[], 100, StatusKind::None, 100)?,
            pokemon(&content, 2, Some(seat(1)?), &[], 100, StatusKind::None, 100)?,
        ],
        vec![
            pokemon(&content, 3, None, &[], 100, StatusKind::None, 100)?,
            pokemon(&content, 4, None, &[], 100, StatusKind::None, 100)?,
        ],
    )?;
    let source_epoch = AuthorityEpoch::new(safe(9)?);
    battle_mut(&mut state)?.player_party[1].abilities.active = INTIMIDATE_ABILITY_ID;
    let (head, tail) = {
        let battle = battle_mut(&mut state)?;
        battle.player_party[0].hp = 0;
        battle.player_party[0].fainted = true;
        let head = queue_faint(
            battle,
            FaintCandidate::new(player_active, slot(BattleSide::Player, 0)?),
            source_epoch,
            3,
        )?
        .occurrence;
        battle.enemy_party[0].hp = 0;
        battle.enemy_party[0].fainted = true;
        let tail = queue_faint(
            battle,
            FaintCandidate::new(enemy_active, slot(BattleSide::Enemy, 0)?),
            source_epoch,
            4,
        )?
        .occurrence;
        (head, tail)
    };
    let before = state.clone();
    let stored = before
        .battle
        .as_ref()
        .and_then(|battle| battle.faint_queue.first().copied())
        .ok_or("missing stored replacement head")?;
    let owner = stored
        .owner_seat
        .ok_or("missing stored replacement owner")?;
    let player_slot = slot(BattleSide::Player, 0)?;
    let correct_operation = replacement_operation_id(
        stored.source.epoch,
        battle(&before)?.battle_id,
        stored.source.wave,
        stored.source.resolved_turn,
        stored.source.turn_occurrence,
        player_slot,
        owner,
    )?;
    let wrong_operation = replacement_operation_id(
        stored.source.epoch,
        battle(&before)?.battle_id,
        stored.source.wave,
        stored.source.resolved_turn,
        stored.source.turn_occurrence + 1,
        player_slot,
        owner,
    )?;
    let selection = ReplacementSelection::selected(PartyIndex::new(1)?, player_reserve);
    let rejected = resolve_replacement(&before, head.id, &selection, &wrong_operation, &content);
    assert!(rejected.is_err());
    assert_eq!(state, before);

    let before_turn = battle(&before)?.turn;
    let before_rng = battle(&before)?.battle_rng.clone();
    let transition =
        resolve_replacement(&before, head.id, &selection, &correct_operation, &content)?;
    assert_eq!(transition.before_state, before);
    assert_eq!(transition.selection, selection);
    let after_battle = battle(&transition.after_state)?;
    assert_eq!(after_battle.turn, before_turn);
    assert_eq!(after_battle.battle_rng, before_rng);
    assert_eq!(transition.after_state.run_rng, before.run_rng);
    assert_eq!(transition.outcome, BattleOutcome::Ongoing);
    assert_eq!(
        transition.next_decision,
        BattleNextDecision::CommandFrontier
    );
    assert_eq!(after_battle.faint_queue.len(), 2);
    assert_eq!(after_battle.faint_queue[0].id, head.id);
    assert_eq!(after_battle.faint_queue[1].id, tail.id);
    assert!(
        after_battle
            .faint_queue
            .iter()
            .all(|occurrence| occurrence.replacement == ReplacementProgress::Applied)
    );
    assert_eq!(
        after_battle
            .field
            .occupant(&after_battle.format, player_slot)?,
        Some(player_reserve)
    );
    assert_eq!(
        after_battle
            .field
            .occupant(&after_battle.format, slot(BattleSide::Enemy, 0)?)?,
        None
    );
    assert_eq!(
        transition
            .mutations
            .iter()
            .filter(|mutation| matches!(mutation, BattleMutation::FaintResolved { .. }))
            .count(),
        2
    );
    assert_eq!(transition.presentation.len(), 2);
    assert!(matches!(
        &transition.presentation[0].kind,
        BattlePresentationKind::Switched {
            slot,
            incoming,
            ..
        } if *slot == player_slot && *incoming == player_reserve
    ));
    assert!(matches!(
        &transition.presentation[1].kind,
        BattlePresentationKind::AbilityActivated {
            pokemon,
            ability_id,
        } if *pokemon == player_reserve && *ability_id == INTIMIDATE_ABILITY_ID
    ));
    Ok(())
}

#[test]
fn m4_hyper_fang_flinch_cancels_a_slower_pending_action() -> TestResult {
    let content = selected_m4_content_pack()?;
    let player = pokemon(
        &content,
        1,
        Some(seat(1)?),
        &[158],
        100,
        StatusKind::None,
        200,
    )?;
    let enemy = pokemon(&content, 2, None, &[1], 100, StatusKind::None, 100)?;
    let enemy_id = pokemon_id(2)?;
    let mut winning_seed = None;
    for index in 0..512 {
        let mut state = state_with_parties(&content, vec![player.clone()], vec![enemy.clone()])?;
        let battle_turn = battle(&state)?.turn;
        battle_mut(&mut state)?.battle_rng =
            BattleRngState::new(format!("m4-turn-flinch-{index}"), battle_turn);
        let commands = admit_single_fights(&mut state, &content, 158, 1)?;
        let operation = turn_operation(&state)?;
        let transition = resolve_turn(
            &state,
            &commands,
            AuthorityEpoch::new(safe(9)?),
            &operation,
            &content,
        )?;
        if transition.action_order.iter().any(|action| {
            action.actor == enemy_id && action.disposition == ActionDisposition::CancelledByFlinch
        }) {
            winning_seed = Some(index);
            break;
        }
    }
    assert!(
        winning_seed.is_some(),
        "no deterministic pre-action flinch found in 512 seeds"
    );
    Ok(())
}
