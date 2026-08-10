//! Contract tests for the pure M3 TURN/REPLACEMENT presentation planner.

mod error {
    pub use er_battle::error::*;
}

mod resolver {
    pub use er_battle::resolver::*;
}

#[path = "../src/presentation.rs"]
mod presentation;

use er_battle::error::{BattleAfterStateFailure, BattleInvariantError};
use er_battle::resolver::BattleMutation;
use er_types::OperationId;
use er_types::SafeU53;
use er_types::battle_ids::{
    AbilityId, AuthorityEpoch, BattlePresentationEventId, BattleSide, FaintOccurrenceId, FieldSlot,
    MoveId, PokemonId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{
    ActionDisposition, BattleOutcome, BattleStat, FaintOccurrence, FaintSource,
    ReplacementProgress, ResolvedAction, ResolvedActionKind, StatusKind, StatusState,
};
use er_types::battle_ui::{BattlePresentationEvent, BattlePresentationKind};
use presentation::{
    PRESENTATION_BLOCKING_POLICY, PRESENTATION_SKIP_POLICY, PresentationCausalEvent,
    PresentationCause, PresentationStep, PresentationTransitionInput, ReplacementPresentationInput,
    TurnPresentationInput, build_presentation_plan, build_replacement_plan,
    build_replacement_presentation_plan, build_turn_plan, build_turn_presentation_plan,
    presentation_event_id_for_position,
};

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn operation(value: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(value.to_owned())?)
}

fn pokemon(value: u64) -> TestResult<PokemonId> {
    Ok(PokemonId::new(safe(value)?))
}

fn move_id(value: u64) -> TestResult<MoveId> {
    Ok(MoveId::new(safe(value)?))
}

fn ability_id(value: u64) -> TestResult<AbilityId> {
    Ok(AbilityId::new(safe(value)?))
}

fn field(side: BattleSide, position: u8) -> TestResult<FieldSlot> {
    Ok(FieldSlot::new(side, position)?)
}

fn status(kind: StatusKind, toxic_turn_count: u16) -> StatusState {
    StatusState {
        kind,
        toxic_turn_count,
        sleep_turns_remaining: None,
    }
}

fn occurrence(id: u64, slot: FieldSlot, pokemon: PokemonId) -> TestResult<FaintOccurrence> {
    Ok(FaintOccurrence {
        id: FaintOccurrenceId::new(safe(id)?),
        source: FaintSource {
            epoch: AuthorityEpoch::new(safe(1)?),
            wave: WaveIndex::new(safe(1)?)?,
            resolved_turn: TurnIndex::new(safe(1)?)?,
            turn_occurrence: 0,
        },
        slot,
        pokemon,
        owner_seat: None,
        replacement: ReplacementProgress::NotRequired,
    })
}

fn action(
    sequence: u64,
    kind: ResolvedActionKind,
    actor: PokemonId,
    source_slot: FieldSlot,
    disposition: ActionDisposition,
) -> TestResult<ResolvedAction> {
    let sequence = safe(sequence)?;
    Ok(ResolvedAction {
        sequence,
        kind,
        actor,
        source_slot,
        command_operation_id: None,
        effective_speed: 100,
        timing_modifier: 0,
        move_priority: 0,
        bracket_modifier: 0,
        tie_order: sequence,
        disposition,
    })
}

fn tags(plan: &[BattlePresentationEvent]) -> Vec<&'static str> {
    plan.iter()
        .map(|event| match &event.kind {
            BattlePresentationKind::MoveUsed { .. } => "MOVE_USED",
            BattlePresentationKind::AbilityActivated { .. } => "ABILITY_ACTIVATED",
            BattlePresentationKind::HpChanged { .. } => "HP_CHANGED",
            BattlePresentationKind::StatusApplied { .. } => "STATUS_APPLIED",
            BattlePresentationKind::StatStageChanged { .. } => "STAT_STAGE_CHANGED",
            BattlePresentationKind::Switched { .. } => "SWITCHED",
            BattlePresentationKind::Fainted { .. } => "FAINTED",
            BattlePresentationKind::BattleWon => "BATTLE_WON",
            BattlePresentationKind::BattleLost => "BATTLE_LOST",
        })
        .collect()
}

fn assert_event_identity(
    event: &BattlePresentationEvent,
    operation_id: &OperationId,
    position: u64,
) -> TestResult {
    assert_eq!(&event.event_id.operation_id, operation_id);
    assert_eq!(event.event_id.sequence, safe(position)?);
    assert_eq!(event.policy, PRESENTATION_BLOCKING_POLICY);
    assert_eq!(event.skip_policy, PRESENTATION_SKIP_POLICY);
    Ok(())
}

#[test]
fn turn_plan_orders_closed_events_and_filters_cancelled_moves_and_noops() -> TestResult {
    let operation_id = operation("battle/1/turn/1")?;
    let player = pokemon(1)?;
    let enemy = pokemon(2)?;
    let incoming = pokemon(3)?;
    let player_slot = field(BattleSide::Player, 0)?;
    let enemy_slot = field(BattleSide::Enemy, 0)?;
    let move_id = move_id(10)?;
    let ability_id = ability_id(20)?;
    let occurrence = occurrence(7, enemy_slot, enemy)?;
    let status_before = status(StatusKind::None, 0);
    let status_after = status(StatusKind::Burn, 0);

    let action_order = vec![
        action(
            0,
            ResolvedActionKind::Move,
            player,
            player_slot,
            ActionDisposition::Executed,
        )?,
        action(
            1,
            ResolvedActionKind::Switch,
            player,
            player_slot,
            ActionDisposition::Executed,
        )?,
        action(
            2,
            ResolvedActionKind::Move,
            enemy,
            enemy_slot,
            ActionDisposition::CancelledByParalysis,
        )?,
        action(
            3,
            ResolvedActionKind::Move,
            enemy,
            enemy_slot,
            ActionDisposition::NoEffect,
        )?,
    ];

    let causal_events: Vec<PresentationCause> = vec![
        PresentationCausalEvent::move_used(safe(0)?, player, move_id, vec![enemy_slot]),
        PresentationCausalEvent::mutation(BattleMutation::PpChanged {
            pokemon: player,
            move_slot: er_types::battle_ids::MoveSlotIndex::ZERO,
            before: 10,
            after: 9,
        }),
        PresentationCausalEvent::mutation(BattleMutation::HpChanged {
            pokemon: enemy,
            before: 100,
            after: 80,
        }),
        PresentationCausalEvent::mutation(BattleMutation::StatusChanged {
            pokemon: enemy,
            before: status_before,
            after: status_after,
        }),
        PresentationCausalEvent::mutation(BattleMutation::StatStageChanged {
            pokemon: enemy,
            stat: BattleStat::Defense,
            before: 0,
            after: -1,
        }),
        PresentationCausalEvent::mutation(BattleMutation::FieldChanged {
            slot: player_slot,
            before: Some(player),
            after: Some(incoming),
        }),
        PresentationCausalEvent::ability_activated(incoming, ability_id),
        PresentationCausalEvent::mutation(BattleMutation::StatStageChanged {
            pokemon: enemy,
            stat: BattleStat::Attack,
            before: 0,
            after: 1,
        }),
        PresentationCausalEvent::mutation(BattleMutation::FaintQueued { occurrence }),
        PresentationCausalEvent::mutation(BattleMutation::FieldChanged {
            slot: enemy_slot,
            before: Some(enemy),
            after: None,
        }),
        PresentationCausalEvent::ability_activated(player, AbilityId::ZERO),
        PresentationCausalEvent::move_used(safe(2)?, enemy, move_id, vec![player_slot]),
        PresentationCausalEvent::move_used(safe(3)?, enemy, move_id, vec![]),
        PresentationCausalEvent::mutation(BattleMutation::OutcomeChanged {
            before: BattleOutcome::Ongoing,
            after: BattleOutcome::Victory,
        }),
        PresentationCausalEvent::mutation(BattleMutation::HpChanged {
            pokemon: enemy,
            before: 80,
            after: 80,
        }),
    ];

    let steps: &[PresentationStep] = &causal_events;
    let input =
        TurnPresentationInput::new(&operation_id, &action_order, steps, BattleOutcome::Victory);
    let plan = build_turn_presentation_plan(input.clone())?;
    let dispatched = build_presentation_plan(PresentationTransitionInput::Turn(input.clone()))?;
    let compatibility = build_turn_plan(input)?;

    assert_eq!(plan, dispatched);
    assert_eq!(plan, compatibility);

    assert_eq!(
        tags(&plan),
        vec![
            "MOVE_USED",
            "HP_CHANGED",
            "STATUS_APPLIED",
            "STAT_STAGE_CHANGED",
            "SWITCHED",
            "ABILITY_ACTIVATED",
            "STAT_STAGE_CHANGED",
            "FAINTED",
            "MOVE_USED",
            "BATTLE_WON",
        ]
    );
    for (position, event) in plan.iter().enumerate() {
        assert_event_identity(event, &operation_id, position as u64)?;
    }

    assert_eq!(
        &plan[0].kind,
        &BattlePresentationKind::MoveUsed {
            actor: player,
            move_id,
            targets: vec![enemy_slot],
        }
    );
    assert_eq!(
        &plan[1].kind,
        &BattlePresentationKind::HpChanged {
            pokemon: enemy,
            before: 100,
            after: 80,
        }
    );
    assert_eq!(
        &plan[2].kind,
        &BattlePresentationKind::StatusApplied {
            pokemon: enemy,
            before: status_before,
            after: status_after,
        }
    );
    assert_eq!(
        &plan[4].kind,
        &BattlePresentationKind::Switched {
            slot: player_slot,
            outgoing: Some(player),
            incoming,
        }
    );
    assert_eq!(
        &plan[7].kind,
        &BattlePresentationKind::Fainted {
            pokemon: enemy,
            occurrence: occurrence.id,
        }
    );
    assert!(matches!(
        plan.last().map(|event| &event.kind),
        Some(&BattlePresentationKind::BattleWon)
    ));
    Ok(())
}

#[test]
fn replacement_plan_preserves_switch_ability_stage_terminal_causality() -> TestResult {
    let operation_id = operation("battle/1/replacement/7")?;
    let incoming = pokemon(4)?;
    let slot = field(BattleSide::Enemy, 0)?;
    let ability_id = ability_id(44)?;
    let causal_events = vec![
        PresentationCausalEvent::mutation(BattleMutation::FieldChanged {
            slot,
            before: None,
            after: Some(incoming),
        }),
        PresentationCausalEvent::ability_activated(incoming, ability_id),
        PresentationCausalEvent::mutation(BattleMutation::StatStageChanged {
            pokemon: incoming,
            stat: BattleStat::Attack,
            before: 0,
            after: -1,
        }),
        PresentationCausalEvent::mutation(BattleMutation::OutcomeChanged {
            before: BattleOutcome::Ongoing,
            after: BattleOutcome::Defeat,
        }),
    ];
    let input =
        ReplacementPresentationInput::new(&operation_id, &causal_events, BattleOutcome::Ongoing);

    let direct = build_replacement_presentation_plan(input.clone())?;
    let dispatched =
        build_presentation_plan(PresentationTransitionInput::Replacement(input.clone()))?;
    let compatibility = build_replacement_plan(input)?;

    assert_eq!(direct, dispatched);
    assert_eq!(direct, compatibility);
    assert_eq!(
        tags(&direct),
        vec![
            "SWITCHED",
            "ABILITY_ACTIVATED",
            "STAT_STAGE_CHANGED",
            "BATTLE_LOST",
        ]
    );
    for (position, event) in direct.iter().enumerate() {
        assert_event_identity(event, &operation_id, position as u64)?;
    }
    assert_eq!(
        &direct[0].kind,
        &BattlePresentationKind::Switched {
            slot,
            outgoing: None,
            incoming,
        }
    );
    assert!(matches!(
        direct.last().map(|event| &event.kind),
        Some(&BattlePresentationKind::BattleLost)
    ));
    Ok(())
}

#[test]
fn plan_ids_are_deterministic_and_material_operation_scoped() -> TestResult {
    let operation_id = operation("battle/1/turn/2")?;
    let other_operation_id = operation("battle/1/turn/3")?;
    let actor = pokemon(8)?;
    let slot = field(BattleSide::Player, 0)?;
    let move_id = move_id(9)?;
    let causal_events = vec![PresentationCausalEvent::move_used(
        safe(0)?,
        actor,
        move_id,
        vec![slot],
    )];
    let action_order = vec![action(
        0,
        ResolvedActionKind::Move,
        actor,
        slot,
        ActionDisposition::Executed,
    )?];

    let first = build_turn_presentation_plan(TurnPresentationInput::new(
        &operation_id,
        &action_order,
        &causal_events,
        BattleOutcome::Ongoing,
    ))?;
    let second = build_turn_presentation_plan(TurnPresentationInput::new(
        &operation_id,
        &action_order,
        &causal_events,
        BattleOutcome::Ongoing,
    ))?;
    let other = build_turn_presentation_plan(TurnPresentationInput::new(
        &other_operation_id,
        &action_order,
        &causal_events,
        BattleOutcome::Ongoing,
    ))?;

    assert_eq!(first, second);
    assert_eq!(first.len(), 1);
    assert_eq!(
        first[0].event_id,
        BattlePresentationEventId::new(operation_id.clone(), SafeU53::ZERO)
    );
    assert_ne!(first[0].event_id, other[0].event_id);
    assert_eq!(other[0].event_id.operation_id, other_operation_id);
    Ok(())
}

#[test]
fn empty_and_non_presentational_mutations_produce_no_events() -> TestResult {
    let operation_id = operation("battle/1/replacement/empty")?;
    let actor = pokemon(11)?;
    let slot = field(BattleSide::Player, 0)?;
    let same_status = status(StatusKind::Poison, 1);
    let faint = occurrence(12, slot, actor)?;
    let empty: [PresentationCausalEvent; 0] = [];

    let empty_plan = build_replacement_presentation_plan(ReplacementPresentationInput::new(
        &operation_id,
        &empty,
        BattleOutcome::Ongoing,
    ))?;
    assert!(empty_plan.is_empty());

    let noops = vec![
        PresentationCausalEvent::mutation(BattleMutation::PpChanged {
            pokemon: actor,
            move_slot: er_types::battle_ids::MoveSlotIndex::ZERO,
            before: 3,
            after: 2,
        }),
        PresentationCausalEvent::mutation(BattleMutation::HpChanged {
            pokemon: actor,
            before: 42,
            after: 42,
        }),
        PresentationCausalEvent::mutation(BattleMutation::StatusChanged {
            pokemon: actor,
            before: same_status,
            after: same_status,
        }),
        PresentationCausalEvent::mutation(BattleMutation::StatStageChanged {
            pokemon: actor,
            stat: BattleStat::Speed,
            before: 0,
            after: 0,
        }),
        PresentationCausalEvent::mutation(BattleMutation::FieldChanged {
            slot,
            before: None,
            after: None,
        }),
        PresentationCausalEvent::mutation(BattleMutation::FaintProgressChanged {
            occurrence: faint.id,
            before: ReplacementProgress::NotRequired,
            after: ReplacementProgress::NotRequired,
        }),
        PresentationCausalEvent::mutation(BattleMutation::FaintResolved {
            occurrence: faint.id,
        }),
        PresentationCausalEvent::mutation(BattleMutation::OutcomeChanged {
            before: BattleOutcome::Ongoing,
            after: BattleOutcome::Ongoing,
        }),
        PresentationCausalEvent::ability_activated(actor, AbilityId::ZERO),
    ];

    let noop_plan = build_replacement_presentation_plan(ReplacementPresentationInput::new(
        &operation_id,
        &noops,
        BattleOutcome::Ongoing,
    ))?;
    assert!(noop_plan.is_empty());
    Ok(())
}

#[test]
fn presentation_sequence_overflow_is_a_battle_invariant() -> TestResult {
    let operation_id = operation("battle/1/turn/overflow")?;
    let impossible_position = usize::try_from(SafeU53::MAX.get() + 1)?;
    let result = presentation_event_id_for_position(&operation_id, impossible_position);

    assert!(matches!(
        result,
        Err(BattleInvariantError::InvalidAfterState {
            source: BattleAfterStateFailure::PresentationSequenceOverflow { index }
        }) if index == impossible_position
    ));
    Ok(())
}
