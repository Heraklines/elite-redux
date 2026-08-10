use std::error::Error;

use er_battle::accuracy::{
    AccuracyContext, AccuracyContextError, AccuracyDecision, AccuracyError, AccuracyGate,
    AccuracySkipReason, AccuracyUnsupportedReason,
};
use er_battle::critical::{
    CRITICAL_HIT_MULTIPLIER, CRITICAL_ODDS, CriticalContext, CriticalContextError, CriticalError,
    CriticalGate, CriticalUnsupportedReason,
};
use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::{BattleRngState, RngRuntime};
use er_rng::phaser::{PhaserRdgState, RunRngState};
use er_types::SafeU53;
use er_types::battle_ids::TurnIndex;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

// Read-only published oracle evidence from
// rust/fixtures/m3/oracle/battle-cases/{always-hit,miss,critical-hit}.json.
// These constants mirror only the stream states needed by each seam.
const ALWAYS_HIT_RUN_STATE: &str =
    "!rnd,1,0.18032378423959017,0.9995999033562839,0.20317641110159457";
const MISS_RUN_STATE: &str = "!rnd,1,0.2884788236115128,0.2677236401941627,0.32724559400230646";
const MISS_SAVED_SUBSTREAM: &str =
    "!rnd,1859127,0.5025886141229421,0.4581744347233325,0.6846395924221724";
const CRITICAL_RUN_STATE: &str = "!rnd,1,0.5098650357685983,0.4744028700515628,0.6628262170124799";
const CRITICAL_SAVED_SUBSTREAM: &str =
    "!rnd,2073079,0.9976057731546462,0.32632405031472445,0.4190253959968686";

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn runtime_from_published_states(
    battle_seed: &str,
    run_state: &str,
    saved_substream: Option<&str>,
    next_sequence: u64,
) -> TestResult<RngRuntime> {
    let turn = TurnIndex::new(safe(1)?)?;
    let mut battle = BattleRngState::new(battle_seed, turn);
    battle.saved_substream = saved_substream
        .map(PhaserRdgState::from_state_string)
        .transpose()?;
    let run = RunRngState {
        rdg: PhaserRdgState::from_state_string(run_state)?,
    };
    Ok(RngRuntime::from_states_at_sequence(
        run,
        Some(battle),
        safe(next_sequence)?,
    )?)
}

#[test]
fn published_always_hit_skips_accuracy_draw() -> TestResult {
    let mut runtime =
        runtime_from_published_states("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None, 0)?;
    let context = AccuracyContext::always_hits(0, 6, AccuracyGate::Eligible);

    let decision = context.resolve(&mut runtime)?;

    assert!(decision.is_hit());
    assert!(decision.draw().is_none());
    assert_eq!(
        decision.skipped_evidence().map(|evidence| evidence.reason),
        Some(AccuracySkipReason::AlwaysHits)
    );
    assert!(runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn ordinary_accuracy_uses_integer_boundaries_without_rounding() -> TestResult {
    let context = AccuracyContext::ordinary(75, 0, 0, AccuracyGate::Eligible);

    let low = context.evaluate_draw(safe(74)?)?;
    let high = context.evaluate_draw(safe(75)?)?;

    assert!(matches!(low, AccuracyDecision::Hit(_)));
    assert!(matches!(high, AccuracyDecision::Miss(_)));
    assert_eq!(low.threshold(), Some(75.0));
    assert_eq!(high.draw(), Some(safe(75)?));
    Ok(())
}

#[test]
fn accuracy_stage_multiplier_preserves_source_order() -> TestResult {
    let neutral = AccuracyContext::ordinary(75, 0, 0, AccuracyGate::Eligible);
    let source_up = AccuracyContext::ordinary(75, 1, 0, AccuracyGate::Eligible);
    let target_up = AccuracyContext::ordinary(75, 0, 1, AccuracyGate::Eligible);
    let widely_separated = AccuracyContext::ordinary(75, 6, -6, AccuracyGate::Eligible);

    let neutral_evidence = neutral
        .evaluate_draw(safe(74)?)?
        .roll_evidence()
        .map(|evidence| {
            (
                evidence.stage_difference,
                evidence.stage_multiplier,
                evidence.threshold,
            )
        });
    let source_evidence = source_up
        .evaluate_draw(safe(99)?)?
        .roll_evidence()
        .map(|evidence| {
            (
                evidence.stage_difference,
                evidence.stage_multiplier,
                evidence.threshold,
            )
        });
    let target_decision = target_up.evaluate_draw(safe(56)?)?;
    let target_evidence = target_decision
        .roll_evidence()
        .map(|evidence| (evidence.stage_difference, evidence.stage_multiplier));
    let separated_decision = widely_separated.evaluate_draw(safe(99)?)?;
    let separated_evidence = separated_decision
        .roll_evidence()
        .map(|evidence| (evidence.stage_difference, evidence.stage_multiplier));

    assert_eq!(neutral_evidence, Some((0, 1.0, 75.0)));
    assert_eq!(source_evidence, Some((1, 4.0 / 3.0, 100.0)));
    assert_eq!(target_evidence.map(|value| value.0), Some(-1));
    assert_eq!(target_evidence.map(|value| value.1), Some(0.75));
    assert_eq!(target_decision.threshold(), Some(56.25));
    assert_eq!(separated_evidence.map(|value| value.0), Some(6));
    assert_eq!(separated_evidence.map(|value| value.1), Some(3.0));
    assert_eq!(separated_decision.threshold(), Some(225.0));
    Ok(())
}

#[test]
fn published_accuracy_miss_keeps_first_divergence_identity() -> TestResult {
    let mut runtime = runtime_from_published_states(
        "Uq64enRikQt0xgcb",
        MISS_RUN_STATE,
        Some(MISS_SAVED_SUBSTREAM),
        10,
    )?;
    let context = AccuracyContext::ordinary(75, 0, 0, AccuracyGate::Eligible);

    let decision = context.resolve(&mut runtime)?;

    assert!(decision.is_miss());
    assert_eq!(decision.draw(), Some(safe(94)?));
    assert_eq!(decision.threshold(), Some(75.0));
    assert_eq!(runtime.audit_entries().len(), 1);
    let audit = &runtime.audit_entries()[0];
    assert_eq!(audit.sequence, safe(10)?);
    assert_eq!(audit.reason, RngReason::Accuracy);
    assert_eq!(audit.callsite_id, RngCallsiteId::accuracy());
    assert_eq!(audit.cardinality, safe(100)?);
    assert_eq!(audit.minimum, SafeU53::ZERO);
    assert_eq!(audit.result, safe(94)?);
    assert!(audit.consumed);
    Ok(())
}

#[test]
fn published_critical_fixture_uses_stage_zero_noncritical_draw() -> TestResult {
    let mut runtime = runtime_from_published_states(
        "WFd4Ex68hX13CHgC",
        CRITICAL_RUN_STATE,
        Some(CRITICAL_SAVED_SUBSTREAM),
        6,
    )?;

    let decision = CriticalContext::ordinary().resolve(&mut runtime)?;

    assert!(decision.is_noncritical());
    assert_eq!(decision.draw(), Some(safe(3)?));
    assert_eq!(decision.multiplier(), 1.0);
    assert!(
        decision
            .roll_evidence()
            .is_some_and(|evidence| !evidence.critical)
    );
    assert_eq!(runtime.audit_entries().len(), 1);
    let audit = &runtime.audit_entries()[0];
    assert_eq!(audit.sequence, safe(6)?);
    assert_eq!(audit.reason, RngReason::CriticalHit);
    assert_eq!(audit.callsite_id, RngCallsiteId::critical_hit());
    assert_eq!(audit.cardinality, safe(24)?);
    assert_eq!(audit.minimum, SafeU53::ZERO);
    assert_eq!(audit.result, safe(3)?);
    assert!(audit.consumed);
    Ok(())
}

#[test]
fn critical_zero_is_the_only_hit_and_odds_follow_selected_slice() -> TestResult {
    for (stage, odds) in CRITICAL_ODDS.iter().copied().enumerate() {
        let context = CriticalContext::new(i8::try_from(stage)?, CriticalGate::Eligible);
        let decision = context.evaluate_draw(SafeU53::ZERO)?;

        assert!(decision.is_critical());
        assert_eq!(decision.multiplier(), CRITICAL_HIT_MULTIPLIER);
        assert_eq!(decision.draw(), Some(SafeU53::ZERO));
        assert_eq!(
            decision
                .roll_evidence()
                .map(|evidence| evidence.draw_cardinality),
            Some(safe(odds)?)
        );
        assert_eq!(
            decision.roll_evidence().map(|evidence| evidence.consumed),
            Some(odds > 1)
        );
    }
    Ok(())
}

#[test]
fn guaranteed_selected_odds_record_a_non_consuming_cardinality_one_audit() -> TestResult {
    let mut runtime =
        runtime_from_published_states("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None, 0)?;
    let context = CriticalContext::new(3, CriticalGate::Eligible);

    let decision = context.resolve(&mut runtime)?;

    assert!(decision.is_critical());
    assert_eq!(decision.draw(), Some(SafeU53::ZERO));
    assert!(
        decision
            .roll_evidence()
            .is_some_and(|evidence| !evidence.consumed)
    );
    assert_eq!(runtime.audit_entries().len(), 1);
    let audit = &runtime.audit_entries()[0];
    assert_eq!(audit.cardinality, safe(1)?);
    assert_eq!(audit.result, SafeU53::ZERO);
    assert!(!audit.consumed);
    assert_eq!(audit.primitive_draw_count, 0);
    assert_eq!(audit.before_state, audit.after_state);
    Ok(())
}

#[test]
fn no_effect_and_unsupported_branches_consume_no_draw() -> TestResult {
    let mut accuracy_runtime =
        runtime_from_published_states("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None, 0)?;
    let no_effect_accuracy = AccuracyContext::ordinary(75, 0, 0, AccuracyGate::NoEffect);
    let accuracy_decision = no_effect_accuracy.resolve(&mut accuracy_runtime)?;
    assert!(accuracy_decision.draw().is_none());
    assert!(accuracy_runtime.audit_entries().is_empty());

    let mut critical_runtime =
        runtime_from_published_states("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None, 0)?;
    let no_effect_critical = CriticalContext::new(0, CriticalGate::NoEffect);
    let critical_decision = no_effect_critical.resolve(&mut critical_runtime)?;
    assert!(critical_decision.draw().is_none());
    assert!(critical_runtime.audit_entries().is_empty());

    let unsupported_accuracy = AccuracyContext::ordinary(
        75,
        0,
        0,
        AccuracyGate::Unsupported(AccuracyUnsupportedReason::CustomAccuracyModifier),
    );
    assert!(matches!(
        unsupported_accuracy.resolve(&mut accuracy_runtime),
        Err(AccuracyError::Unsupported { .. })
    ));
    assert!(accuracy_runtime.audit_entries().is_empty());

    let unsupported_critical = CriticalContext::new(
        0,
        CriticalGate::Unsupported(CriticalUnsupportedReason::CriticalBlock),
    );
    assert!(matches!(
        unsupported_critical.resolve(&mut critical_runtime),
        Err(CriticalError::Unsupported { .. })
    ));
    assert!(critical_runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn invalid_contexts_fail_closed_before_rng_access() -> TestResult {
    let mut accuracy_runtime =
        runtime_from_published_states("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None, 0)?;
    let invalid_accuracy = AccuracyContext::ordinary(0, 0, 0, AccuracyGate::Eligible);
    assert!(matches!(
        invalid_accuracy.resolve(&mut accuracy_runtime),
        Err(AccuracyError::InvalidContext(
            AccuracyContextError::InvalidBaseAccuracy { accuracy: 0 }
        ))
    ));
    assert!(accuracy_runtime.audit_entries().is_empty());

    let invalid_accuracy_stage = AccuracyContext::ordinary(75, 7, 0, AccuracyGate::Eligible);
    assert!(matches!(
        invalid_accuracy_stage.resolve(&mut accuracy_runtime),
        Err(AccuracyError::InvalidContext(
            AccuracyContextError::InvalidSourceAccuracyStage { stage: 7 }
        ))
    ));
    assert!(accuracy_runtime.audit_entries().is_empty());

    let mut critical_runtime =
        runtime_from_published_states("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None, 0)?;
    let invalid_critical = CriticalContext::new(4, CriticalGate::Eligible);
    assert!(matches!(
        invalid_critical.resolve(&mut critical_runtime),
        Err(CriticalError::InvalidContext(
            CriticalContextError::StageOutOfRange { stage: 4 }
        ))
    ));
    assert!(critical_runtime.audit_entries().is_empty());
    Ok(())
}
