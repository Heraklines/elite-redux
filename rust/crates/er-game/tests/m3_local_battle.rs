//! Contract tests for the production local-battle lifecycle adapter.
//!
//! The crate root is integration-owned and does not link this module on the
//! isolated lane base. Including the owned source here keeps these tests
//! runnable as soon as the integration root wires `local_battle` while still
//! exercising the exact implementation rather than a copied test helper.

#[path = "../src/local_battle.rs"]
mod local_battle;

use std::error::Error;

use er_battle::resolver::BattleNextDecision;
use er_content::pack::selected_content_pack;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::digest::compute_mechanical_state_digest;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommand, BattleCommandProposalV1, BattleReplacementProposalV1, BattleTargetSelection,
    ReplacementSelection, ScriptedEnemyPolicyV1, player_command_operation_id,
    replacement_operation_id,
};
use er_types::battle_control::{
    BATTLE_CONTROL_PLAN_SCHEMA_VERSION, BattleControl, BattleControlPlan, SeatBattleControl,
    SeatMenuInstanceAllocator,
};
use er_types::battle_ids::{
    AbilityId, AuthorityEpoch, BattleId, BattlePresentationEventId, BattleSide, FieldSlot,
    GameModeId, MenuInstanceId, MoveSlotIndex, PartyIndex, PokemonId, TurnIndex, WaveIndex,
};
use er_types::battle_model::BattleOutcome;
use er_types::battle_ui::{
    BattlePresentationEvent, BattlePresentationKind, PresentationBlockingPolicy,
    PresentationPlanDigest, PresentationSkipPolicy,
};
use er_types::{OperationId, SafeU53, SeatId};
use thiserror::Error;

use local_battle::{
    BATTLE_START_SCHEMA_VERSION, BattleGameConfig, BattleStartV1, LocalAdmission,
    LocalBattleError, LocalBattleFrontier, LocalBattleMaterialResult, LocalBattleProgress,
    LocalBattleRequest, LocalBattleRuntime, LocalMaterialKind, reduce_local_request,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn pokemon_id(value: u64) -> PokemonId {
    PokemonId::new(safe(value))
}

fn single_party_pokemon(id: u64, owner_seat: Option<SeatId>) -> TestResult<PokemonState> {
    let content = selected_content_pack()?;
    let species = content
        .species
        .first()
        .ok_or("selected content has no species")?;
    Ok(PokemonState::new(
        pokemon_id(id),
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
            speed: 100,
        },
        100,
        100,
        StatusState {
            kind: er_types::battle_model::StatusKind::None,
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
        [
            Some(MoveSlotState {
                move_id: er_types::battle_ids::MoveId::ZERO,
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            }),
            None,
            None,
            None,
        ],
        AbilityLoadout {
            active: AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

fn run_state() -> TestResult<GameState> {
    let content = selected_content_pack()?;
    Ok(GameState::new(
        content.hash,
        GameModeId::new(safe(1)),
        WaveIndex::new(safe(1))?,
        BattleId::new(safe(1)),
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-local-lifecycle").state(),
        },
        None,
    )?)
}

fn valid_config() -> TestResult<BattleGameConfig> {
    let content = selected_content_pack()?;
    let config = BattleGameConfig {
        run_state: run_state()?,
        start: BattleStartV1 {
            schema_version: BATTLE_START_SCHEMA_VERSION,
            format: er_state::format::BattleFormat::single(),
            player_party: vec![single_party_pokemon(1, Some(seat(1)))?],
            enemy_party: vec![single_party_pokemon(2, None)?],
            player_leads: vec![PartyIndex::ZERO],
            enemy_leads: vec![PartyIndex::ZERO],
        },
        local_seat: seat(1),
        scripted_enemy_policy: ScriptedEnemyPolicyV1::new(safe(0), Vec::new())?,
    };
    config.validate(&content)?;
    Ok(config)
}

fn control() -> TestResult<BattleControlPlan> {
    let allocator = SeatMenuInstanceAllocator::new(seat(1), MenuInstanceId::new(safe(1)))?;
    let seat_control = SeatBattleControl::new(
        seat(1),
        None,
        BattleControl::complete(BattleOutcome::Victory)?,
    );
    Ok(BattleControlPlan::new(
        BATTLE_CONTROL_PLAN_SCHEMA_VERSION,
        BattleId::new(safe(1)),
        WaveIndex::new(safe(1))?,
        TurnIndex::new(safe(1))?,
        vec![seat_control],
        vec![allocator],
    )?)
}

fn presentation_digest() -> TestResult<PresentationPlanDigest> {
    Ok(PresentationPlanDigest::new(format!(
        "blake3-v1:{}",
        "0".repeat(64)
    ))?)
}

fn material_result() -> TestResult<LocalBattleMaterialResult> {
    let state = run_state()?;
    let digest = compute_mechanical_state_digest(&state)?;
    let plan = control()?;
    let presentation_digest = presentation_digest()?;
    Ok(LocalBattleMaterialResult {
        kind: LocalMaterialKind::Turn,
        operation_id: OperationId::new("battle/1/wave/1/turn/1/result")?,
        before_state: state.clone(),
        before_digest: digest.clone(),
        candidate_after_state: state.clone(),
        candidate_after_digest: digest.clone(),
        applied_after_state: state,
        applied_after_digest: digest,
        candidate_outcome: BattleOutcome::Victory,
        applied_outcome: BattleOutcome::Victory,
        candidate_next_decision: BattleNextDecision::Complete(BattleOutcome::Victory),
        applied_next_decision: BattleNextDecision::Complete(BattleOutcome::Victory),
        candidate_control: plan.clone(),
        applied_control: plan,
        candidate_presentation: Vec::new(),
        applied_presentation: Vec::new(),
        candidate_presentation_digest: presentation_digest.clone(),
        applied_presentation_digest: presentation_digest,
    })
}

fn command_request() -> TestResult<LocalBattleRequest> {
    let battle_id = BattleId::new(safe(1));
    let wave = WaveIndex::new(safe(1))?;
    let turn = TurnIndex::new(safe(1))?;
    let field_slot = FieldSlot::new(BattleSide::Player, 0)?;
    let owner = seat(1);
    let actor = pokemon_id(1);
    let operation_id = player_command_operation_id(battle_id, wave, turn, field_slot, owner)?;
    let command = BattleCommand::fight(
        actor,
        MoveSlotIndex::ZERO,
        BattleTargetSelection::implicit(),
    )?;
    Ok(LocalBattleRequest::Command(BattleCommandProposalV1::new(
        operation_id,
        battle_id,
        wave,
        turn,
        owner,
        actor,
        field_slot,
        command,
        MenuInstanceId::new(safe(1)),
        "battle/1/wave/1/turn/1/control/player/0/seat/1/command",
    )?))
}

fn replacement_request(selection: ReplacementSelection) -> TestResult<LocalBattleRequest> {
    let battle_id = BattleId::new(safe(1));
    let wave = WaveIndex::new(safe(1))?;
    let resolved_turn = TurnIndex::new(safe(1))?;
    let field_slot = FieldSlot::new(BattleSide::Player, 0)?;
    let owner = seat(1);
    let occurrence = er_types::battle_ids::FaintOccurrenceId::new(safe(7));
    let operation_id = replacement_operation_id(
        AuthorityEpoch::new(safe(3)),
        battle_id,
        wave,
        resolved_turn,
        0,
        field_slot,
        owner,
    )?;
    Ok(LocalBattleRequest::Replacement(
        BattleReplacementProposalV1::with_schema_version(
            1,
            operation_id,
            battle_id,
            wave,
            resolved_turn,
            owner,
            occurrence,
            0,
            field_slot,
            selection,
            MenuInstanceId::new(safe(1)),
            "RC/e3/b1/w1/t1/o0/f0/s1/control/replacement",
        )?,
    ))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FailurePoint {
    None,
    Resolver,
    Encode,
    Decode,
    Apply,
    Control,
    FinalValidation,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Call {
    AdmitCommand,
    AdmitReplacement,
    InternalNoLegalReplacement,
    Resolve,
    Encode,
    Decode,
    Apply,
    Control,
    FinalValidation,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[error("injected local production-path failure at {0:?}")]
struct TestRuntimeError(FailurePoint);

#[derive(Clone, Debug, Eq, PartialEq)]
struct TestRuntime {
    phase: LocalBattleFrontier,
    complete_command_frontier: bool,
    material: LocalBattleMaterialResult,
    no_legal_selection: ReplacementSelection,
    failure: FailurePoint,
    calls: Vec<Call>,
}

impl TestRuntime {
    fn new(material: LocalBattleMaterialResult) -> Self {
        Self {
            phase: LocalBattleFrontier::Command,
            complete_command_frontier: true,
            material,
            no_legal_selection: ReplacementSelection::NoLegalReplacement,
            failure: FailurePoint::None,
            calls: Vec::new(),
        }
    }

    fn fail_if(&self, point: FailurePoint) -> Result<(), TestRuntimeError> {
        if self.failure == point {
            Err(TestRuntimeError(point))
        } else {
            Ok(())
        }
    }

    fn prepare(&mut self) -> Result<LocalBattleMaterialResult, TestRuntimeError> {
        self.calls.push(Call::Resolve);
        self.fail_if(FailurePoint::Resolver)?;
        self.calls.push(Call::Encode);
        self.fail_if(FailurePoint::Encode)?;
        self.calls.push(Call::Decode);
        self.fail_if(FailurePoint::Decode)?;
        self.calls.push(Call::Apply);
        self.fail_if(FailurePoint::Apply)?;
        self.calls.push(Call::Control);
        self.fail_if(FailurePoint::Control)?;
        self.calls.push(Call::FinalValidation);
        self.fail_if(FailurePoint::FinalValidation)?;
        self.phase = LocalBattleFrontier::Complete(BattleOutcome::Victory);
        Ok(self.material.clone())
    }
}

impl LocalBattleRuntime for TestRuntime {
    type Error = TestRuntimeError;

    fn local_frontier(&self) -> LocalBattleFrontier {
        self.phase
    }

    fn command_frontier_complete(&self) -> bool {
        self.complete_command_frontier
    }

    fn admit_local_command(
        &mut self,
        _proposal: &BattleCommandProposalV1,
    ) -> Result<LocalAdmission, Self::Error> {
        self.calls.push(Call::AdmitCommand);
        Ok(if self.complete_command_frontier {
            LocalAdmission::Admitted
        } else {
            LocalAdmission::FrontierIncomplete
        })
    }

    fn admit_local_replacement(
        &mut self,
        _proposal: &BattleReplacementProposalV1,
    ) -> Result<LocalAdmission, Self::Error> {
        self.calls.push(Call::AdmitReplacement);
        Ok(LocalAdmission::Admitted)
    }

    fn internal_no_legal_replacement(
        &mut self,
        _occurrence: er_types::battle_ids::FaintOccurrenceId,
    ) -> Result<ReplacementSelection, Self::Error> {
        self.calls.push(Call::InternalNoLegalReplacement);
        Ok(self.no_legal_selection)
    }

    fn prepare_turn_material_commit(
        &mut self,
    ) -> Result<LocalBattleMaterialResult, Self::Error> {
        self.prepare()
    }

    fn prepare_replacement_material_commit(
        &mut self,
        _occurrence: er_types::battle_ids::FaintOccurrenceId,
        _selection: ReplacementSelection,
    ) -> Result<LocalBattleMaterialResult, Self::Error> {
        self.prepare()
    }
}

fn atomic_drive(
    runtime: &mut TestRuntime,
    request: LocalBattleRequest,
) -> Result<LocalBattleProgress, LocalBattleError<TestRuntimeError>> {
    let original = runtime.clone();
    let mut staged = runtime.clone();
    let result = reduce_local_request(&mut staged, request);
    if result.is_ok() {
        *runtime = staged;
    } else {
        assert_eq!(*runtime, original, "failed staged work must not escape");
    }
    result
}

#[test]
fn config_uses_the_frozen_start_shape_and_rejects_bad_lead_ownership() -> TestResult {
    let config = valid_config()?;
    assert_eq!(config.start.schema_version, BATTLE_START_SCHEMA_VERSION);
    assert!(config.run_state.battle.is_none());

    let mut invalid = config.start.clone();
    invalid.player_leads = vec![PartyIndex::new(1)?];
    assert!(matches!(
        invalid.validate(),
        Err(local_battle::LocalBattleConfigError::LeadOutsideParty { .. })
    ));
    Ok(())
}

#[test]
fn command_frontier_gates_resolution_until_all_scripted_and_local_commands_exist() -> TestResult {
    let material = material_result()?;
    let mut runtime = TestRuntime::new(material);
    runtime.complete_command_frontier = false;
    let progress = atomic_drive(&mut runtime, command_request()?)?;
    assert!(matches!(
        progress,
        LocalBattleProgress::Waiting {
            frontier: LocalBattleFrontier::Command
        }
    ));
    assert_eq!(runtime.calls, vec![Call::AdmitCommand]);

    runtime.complete_command_frontier = true;
    let progress = atomic_drive(&mut runtime, command_request()?)?;
    assert!(matches!(progress, LocalBattleProgress::MaterialInstalled(_)));
    assert_eq!(
        runtime.calls,
        vec![
            Call::AdmitCommand,
            Call::AdmitCommand,
            Call::Resolve,
            Call::Encode,
            Call::Decode,
            Call::Apply,
            Call::Control,
            Call::FinalValidation,
        ]
    );
    Ok(())
}

#[test]
fn selected_and_no_legal_replacement_use_the_stored_occurrence_frontier() -> TestResult {
    let mut selected_runtime = TestRuntime::new(material_result()?);
    selected_runtime.phase = LocalBattleFrontier::Replacement {
        occurrence: er_types::battle_ids::FaintOccurrenceId::new(safe(7)),
    };
    let selected = replacement_request(ReplacementSelection::Selected {
        party_slot: PartyIndex::new(1)?,
        pokemon: pokemon_id(3),
    })?;
    assert!(matches!(
        atomic_drive(&mut selected_runtime, selected)?,
        LocalBattleProgress::MaterialInstalled(_)
    ));
    assert_eq!(selected_runtime.calls[0], Call::AdmitReplacement);

    let mut automatic_runtime = TestRuntime::new(material_result()?);
    automatic_runtime.phase = LocalBattleFrontier::Replacement {
        occurrence: er_types::battle_ids::FaintOccurrenceId::new(safe(7)),
    };
    let automatic = LocalBattleRequest::InternalNoLegalReplacement {
        occurrence: er_types::battle_ids::FaintOccurrenceId::new(safe(7)),
    };
    assert!(matches!(
        atomic_drive(&mut automatic_runtime, automatic)?,
        LocalBattleProgress::MaterialInstalled(_)
    ));
    assert_eq!(
        &automatic_runtime.calls[..2],
        &[Call::InternalNoLegalReplacement, Call::Resolve]
    );

    let mut invalid_runtime = TestRuntime::new(material_result()?);
    invalid_runtime.phase = LocalBattleFrontier::Replacement {
        occurrence: er_types::battle_ids::FaintOccurrenceId::new(safe(7)),
    };
    let external_no_legal = LocalBattleRequest::Replacement(BattleReplacementProposalV1 {
        schema_version: 1,
        operation_id: replacement_operation_id(
            AuthorityEpoch::new(safe(3)),
            BattleId::new(safe(1)),
            WaveIndex::new(safe(1))?,
            TurnIndex::new(safe(1))?,
            0,
            FieldSlot::new(BattleSide::Player, 0)?,
            seat(1),
        )?,
        battle_id: BattleId::new(safe(1)),
        wave: WaveIndex::new(safe(1))?,
        resolved_turn: TurnIndex::new(safe(1))?,
        owner_seat: seat(1),
        occurrence: er_types::battle_ids::FaintOccurrenceId::new(safe(7)),
        turn_occurrence: 0,
        field_slot: FieldSlot::new(BattleSide::Player, 0)?,
        selection: ReplacementSelection::NoLegalReplacement,
        menu_instance_id: MenuInstanceId::new(safe(1)),
        control_id: "RC/e3/b1/w1/t1/o0/f0/s1/control/replacement".to_owned(),
    });
    assert!(matches!(
        atomic_drive(&mut invalid_runtime, external_no_legal),
        Err(LocalBattleError::ExternalNoLegalReplacement)
    ));
    assert!(invalid_runtime.calls.is_empty());
    Ok(())
}

#[test]
fn material_round_trip_requires_candidate_and_applied_values_to_match() -> TestResult {
    let mut valid = material_result()?;
    valid.validate()?;

    let mut divergent = valid.clone();
    divergent.applied_after_state.wave = WaveIndex::new(safe(2))?;
    divergent.applied_after_digest = compute_mechanical_state_digest(&divergent.applied_after_state)?;
    assert!(matches!(
        divergent.validate(),
        Err(local_battle::LocalMaterialValidationError::CandidateAppliedStateMismatch)
    ));

    let mut divergent_control = valid.clone();
    divergent_control.applied_outcome = BattleOutcome::Defeat;
    assert!(matches!(
        divergent_control.validate(),
        Err(local_battle::LocalMaterialValidationError::OutcomeMismatch)
    ));
    Ok(())
}

#[test]
fn control_and_presentation_evidence_stays_ordered_and_failure_is_atomic() -> TestResult {
    let mut result = material_result()?;
    let operation_id = result.operation_id.clone();
    result.candidate_presentation = vec![
        BattlePresentationEvent::new(
            BattlePresentationEventId {
                operation_id: operation_id.clone(),
                sequence: safe(0),
            },
            PresentationBlockingPolicy::BlocksHumanInput,
            PresentationSkipPolicy::Forbidden,
            BattlePresentationKind::BattleWon,
        ),
        BattlePresentationEvent::new(
            BattlePresentationEventId {
                operation_id: operation_id.clone(),
                sequence: safe(1),
            },
            PresentationBlockingPolicy::NonBlocking,
            PresentationSkipPolicy::Allowed,
            BattlePresentationKind::BattleLost,
        ),
    ];
    result.applied_presentation = result.candidate_presentation.clone();

    let mut runtime = TestRuntime::new(result.clone());
    let progress = atomic_drive(&mut runtime, command_request()?)?;
    let LocalBattleProgress::MaterialInstalled(installed) = progress else {
        return Err("complete command must install material".into());
    };
    assert_eq!(installed.candidate_presentation, result.candidate_presentation);
    assert_eq!(installed.candidate_control, installed.applied_control);

    for failure in [
        FailurePoint::Resolver,
        FailurePoint::Encode,
        FailurePoint::Decode,
        FailurePoint::Apply,
        FailurePoint::Control,
        FailurePoint::FinalValidation,
    ] {
        let mut failing_runtime = TestRuntime::new(result.clone());
        failing_runtime.failure = failure;
        let error = atomic_drive(&mut failing_runtime, command_request()?)
            .expect_err("injected production-path failure must reject the staged step");
        assert!(matches!(error, LocalBattleError::Runtime(_)));
        assert!(matches!(
            failing_runtime.phase,
            LocalBattleFrontier::Command
        ));
        assert!(failing_runtime.calls.is_empty());
    }
    Ok(())
}
