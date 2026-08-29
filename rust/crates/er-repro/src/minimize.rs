//! Deterministic, exact-oracle reproduction minimization.

use er_dev_types::ExternalTraceInputV7;
use er_types::{RawInputEvent, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::FailureOracleV1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MinimizationBudgetV1 {
    pub maximum_attempts: usize,
    pub maximum_events: usize,
    pub maximum_state_candidates: usize,
}

impl MinimizationBudgetV1 {
    pub fn validate(self) -> Result<(), MinimizationErrorV1> {
        if self.maximum_attempts == 0
            || self.maximum_events == 0
            || self.maximum_state_candidates == 0
        {
            return Err(MinimizationErrorV1::Bounds);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MinimizationStageV1 {
    Confirm,
    CheckpointRebase,
    EventChunk,
    FaultOutcome,
    VirtualTime,
    RawInput,
    State,
    Content,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MinimizationAttemptV1 {
    pub ordinal: usize,
    pub stage: MinimizationStageV1,
    pub event_count: usize,
    pub state_digest: Option<String>,
    pub valid: bool,
    pub reproduced_exact_oracle: bool,
    pub accepted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MinimizationReportV1 {
    pub original_event_count: usize,
    pub minimized_event_count: usize,
    pub expected_failure: FailureOracleV1,
    pub attempts: Vec<MinimizationAttemptV1>,
    pub exhausted: bool,
    pub exact_failure_confirmed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CandidateEvaluationV1 {
    pub valid: bool,
    pub observed_failure: Option<FailureOracleV1>,
    pub state_digest: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MinimizedReproductionV1<E, S> {
    pub events: Vec<E>,
    pub state: S,
    pub report: MinimizationReportV1,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum MinimizationErrorV1 {
    #[error("minimization bound is zero or input exceeds its bound")]
    Bounds,
    #[error("original reproduction does not produce the exact failure oracle")]
    OracleNotReproduced,
    #[error("candidate evaluator failed: {0}")]
    Evaluator(String),
}

pub trait StateReducerV1<S> {
    fn candidates(&self, state: &S, maximum: usize) -> Vec<S>;
}

pub trait ContentReducerV1<S> {
    fn candidates(&self, state: &S, maximum: usize) -> Vec<S>;
}

pub trait MinimizableEventV1: Clone {
    fn is_independent_fault_or_outcome(&self) -> bool;
    fn simplified_candidates(&self) -> Vec<(MinimizationStageV1, Self)>;
}

impl MinimizableEventV1 for ExternalTraceInputV7 {
    fn is_independent_fault_or_outcome(&self) -> bool {
        matches!(
            self,
            Self::PresentationSettled(_)
                | Self::StorageResult(_)
                | Self::RendererFault(_)
                | Self::AssetResult(_)
        )
    }

    fn simplified_candidates(&self) -> Vec<(MinimizationStageV1, Self)> {
        match self {
            Self::AdvanceTime(duration) if duration.get() > 0 => {
                let mut values = vec![(
                    MinimizationStageV1::VirtualTime,
                    Self::AdvanceTime(SafeU53::ZERO),
                )];
                if duration.get() > 1
                    && let Ok(half) = SafeU53::new(duration.get() / 2)
                {
                    values.push((MinimizationStageV1::VirtualTime, Self::AdvanceTime(half)));
                }
                values
            }
            Self::RawInput(RawInputEvent::KeyDown {
                code,
                printable,
                browser_repeat: true,
                focus,
            }) => vec![(
                MinimizationStageV1::RawInput,
                Self::RawInput(RawInputEvent::KeyDown {
                    code: code.clone(),
                    printable: *printable,
                    browser_repeat: false,
                    focus: *focus,
                }),
            )],
            _ => Vec::new(),
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn minimize_reproduction<E, S, F>(
    initial_events: Vec<E>,
    initial_state: S,
    expected_failure: FailureOracleV1,
    checkpoint_prefixes: &[usize],
    budget: MinimizationBudgetV1,
    mut evaluate: F,
    state_reducer: Option<&dyn StateReducerV1<S>>,
    content_reducer: Option<&dyn ContentReducerV1<S>>,
) -> Result<MinimizedReproductionV1<E, S>, MinimizationErrorV1>
where
    E: MinimizableEventV1,
    S: Clone,
    F: FnMut(&S, &[E]) -> Result<CandidateEvaluationV1, String>,
{
    budget.validate()?;
    if initial_events.len() > budget.maximum_events {
        return Err(MinimizationErrorV1::Bounds);
    }
    let mut attempts = Vec::new();
    let mut events = initial_events;
    let mut state = initial_state;
    let mut exhausted = false;
    let confirmed = evaluate_candidate(
        &state,
        &events,
        &expected_failure,
        MinimizationStageV1::Confirm,
        false,
        budget.maximum_attempts,
        &mut attempts,
        &mut evaluate,
    )?;
    if !confirmed {
        return Err(MinimizationErrorV1::OracleNotReproduced);
    }

    let mut prefixes = checkpoint_prefixes
        .iter()
        .copied()
        .filter(|prefix| *prefix > 0 && *prefix < events.len())
        .collect::<Vec<_>>();
    prefixes.sort_unstable_by(|left, right| right.cmp(left));
    prefixes.dedup();
    for prefix in prefixes {
        let candidate = events[prefix..].to_vec();
        if attempt_or_exhaust(
            &state,
            &candidate,
            &expected_failure,
            MinimizationStageV1::CheckpointRebase,
            budget.maximum_attempts,
            &mut attempts,
            &mut evaluate,
            &mut exhausted,
        )? {
            events = candidate;
            break;
        }
    }

    let mut granularity = 2_usize;
    while events.len() >= 2 && !exhausted {
        let chunk_size = events.len().div_ceil(granularity);
        let mut accepted = false;
        let mut start = 0;
        while start < events.len() && !exhausted {
            let end = start.saturating_add(chunk_size).min(events.len());
            let mut candidate = Vec::with_capacity(events.len() - (end - start));
            candidate.extend_from_slice(&events[..start]);
            candidate.extend_from_slice(&events[end..]);
            if attempt_or_exhaust(
                &state,
                &candidate,
                &expected_failure,
                MinimizationStageV1::EventChunk,
                budget.maximum_attempts,
                &mut attempts,
                &mut evaluate,
                &mut exhausted,
            )? {
                events = candidate;
                granularity = granularity.saturating_sub(1).max(2);
                accepted = true;
                break;
            }
            start = end;
        }
        if !accepted {
            if granularity >= events.len() {
                break;
            }
            granularity = granularity.saturating_mul(2).min(events.len());
        }
    }

    let mut index = 0;
    while index < events.len() && !exhausted {
        if events[index].is_independent_fault_or_outcome() {
            let mut candidate = events.clone();
            candidate.remove(index);
            if attempt_or_exhaust(
                &state,
                &candidate,
                &expected_failure,
                MinimizationStageV1::FaultOutcome,
                budget.maximum_attempts,
                &mut attempts,
                &mut evaluate,
                &mut exhausted,
            )? {
                events = candidate;
                continue;
            }
        }
        index += 1;
    }

    index = 0;
    while index < events.len() && !exhausted {
        let replacements = events[index].simplified_candidates();
        for (stage, replacement) in replacements {
            let mut candidate = events.clone();
            candidate[index] = replacement;
            if attempt_or_exhaust(
                &state,
                &candidate,
                &expected_failure,
                stage,
                budget.maximum_attempts,
                &mut attempts,
                &mut evaluate,
                &mut exhausted,
            )? {
                events = candidate;
                break;
            }
        }
        index += 1;
    }

    if let Some(reducer) = state_reducer {
        for candidate_state in reducer.candidates(&state, budget.maximum_state_candidates) {
            if exhausted {
                break;
            }
            if attempt_or_exhaust(
                &candidate_state,
                &events,
                &expected_failure,
                MinimizationStageV1::State,
                budget.maximum_attempts,
                &mut attempts,
                &mut evaluate,
                &mut exhausted,
            )? {
                state = candidate_state;
            }
        }
    }
    if let Some(reducer) = content_reducer {
        for candidate_state in reducer.candidates(&state, budget.maximum_state_candidates) {
            if exhausted {
                break;
            }
            if attempt_or_exhaust(
                &candidate_state,
                &events,
                &expected_failure,
                MinimizationStageV1::Content,
                budget.maximum_attempts,
                &mut attempts,
                &mut evaluate,
                &mut exhausted,
            )? {
                state = candidate_state;
            }
        }
    }

    Ok(MinimizedReproductionV1 {
        report: MinimizationReportV1 {
            original_event_count: attempts
                .first()
                .map_or(events.len(), |attempt| attempt.event_count),
            minimized_event_count: events.len(),
            expected_failure,
            attempts,
            exhausted,
            exact_failure_confirmed: true,
        },
        events,
        state,
    })
}

#[allow(clippy::too_many_arguments)]
fn attempt_or_exhaust<E, S, F>(
    state: &S,
    events: &[E],
    expected_failure: &FailureOracleV1,
    stage: MinimizationStageV1,
    maximum_attempts: usize,
    attempts: &mut Vec<MinimizationAttemptV1>,
    evaluate: &mut F,
    exhausted: &mut bool,
) -> Result<bool, MinimizationErrorV1>
where
    F: FnMut(&S, &[E]) -> Result<CandidateEvaluationV1, String>,
{
    if attempts.len() == maximum_attempts {
        *exhausted = true;
        return Ok(false);
    }
    evaluate_candidate(
        state,
        events,
        expected_failure,
        stage,
        true,
        maximum_attempts,
        attempts,
        evaluate,
    )
}

#[allow(clippy::too_many_arguments)]
fn evaluate_candidate<E, S, F>(
    state: &S,
    events: &[E],
    expected_failure: &FailureOracleV1,
    stage: MinimizationStageV1,
    accept_if_exact: bool,
    maximum_attempts: usize,
    attempts: &mut Vec<MinimizationAttemptV1>,
    evaluate: &mut F,
) -> Result<bool, MinimizationErrorV1>
where
    F: FnMut(&S, &[E]) -> Result<CandidateEvaluationV1, String>,
{
    if attempts.len() >= maximum_attempts {
        return Ok(false);
    }
    let result = evaluate(state, events).map_err(MinimizationErrorV1::Evaluator)?;
    let exact = result.valid && result.observed_failure.as_ref() == Some(expected_failure);
    attempts.push(MinimizationAttemptV1 {
        ordinal: attempts.len(),
        stage,
        event_count: events.len(),
        state_digest: result.state_digest,
        valid: result.valid,
        reproduced_exact_oracle: exact,
        accepted: accept_if_exact && exact,
    });
    Ok(exact)
}
