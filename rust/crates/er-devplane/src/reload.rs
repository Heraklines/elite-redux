//! Fail-atomic content/kernel reload compatibility preflight.

use er_dev_types::{
    AbiCompatibilityReportV1, AbiMigrationAllowanceV1, ExecutionIdentityV1, KernelAbiIdentityV1,
    compare_kernel_abi_v1,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReloadEventEvidenceV1 {
    pub sequence: u64,
    pub mechanical_digest: String,
    pub control_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReloadBaselineV1 {
    pub events: Vec<ReloadEventEvidenceV1>,
    pub final_control_digest: String,
    pub invariant_failures: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReloadPreflightReportV1 {
    pub compatible: bool,
    pub abi: AbiCompatibilityReportV1,
    pub first_divergent_sequence: Option<u64>,
    pub current_digest: Option<String>,
    pub candidate_digest: Option<String>,
    pub control_closed: bool,
    pub invariant_failures: Vec<String>,
    pub failure_stage: Option<String>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ReloadPreflightErrorV1 {
    #[error("reload preflight bound or baseline is invalid")]
    Baseline,
    #[error("reload preflight driver failed at {stage}: {message}")]
    Driver { stage: String, message: String },
}

pub trait ReloadPreflightDriverV1<S, E, C> {
    type Prepared;
    type Error: std::error::Error;

    fn prepare_candidate(&self, content: &C) -> Result<Self::Prepared, Self::Error>;
    fn migrate_snapshot(&self, snapshot: &S, prepared: &Self::Prepared) -> Result<S, Self::Error>;
    fn replay_candidate(
        &self,
        snapshot: S,
        trace: &[E],
        prepared: &Self::Prepared,
    ) -> Result<ReloadBaselineV1, Self::Error>;
}

#[allow(clippy::too_many_arguments)]
pub fn preflight_reload_v1<S, E, C, D>(
    current_abi: &KernelAbiIdentityV1,
    candidate_abi: &KernelAbiIdentityV1,
    current_identity: &ExecutionIdentityV1,
    candidate_identity: &ExecutionIdentityV1,
    migrations: &[AbiMigrationAllowanceV1],
    current_snapshot: &S,
    recent_trace: &[E],
    current_baseline: &ReloadBaselineV1,
    candidate_content: &C,
    maximum_events: usize,
    driver: &D,
) -> Result<ReloadPreflightReportV1, ReloadPreflightErrorV1>
where
    S: Clone,
    D: ReloadPreflightDriverV1<S, E, C>,
{
    if maximum_events == 0
        || recent_trace.len() > maximum_events
        || current_baseline.events.len() != recent_trace.len()
        || current_baseline.final_control_digest.is_empty()
        || current_baseline
            .events
            .iter()
            .any(|event| event.mechanical_digest.is_empty() || event.control_digest.is_empty())
        || current_baseline
            .events
            .windows(2)
            .any(|pair| pair[0].sequence >= pair[1].sequence)
    {
        return Err(ReloadPreflightErrorV1::Baseline);
    }
    let abi = compare_kernel_abi_v1(
        current_abi,
        candidate_abi,
        current_identity,
        candidate_identity,
        migrations,
    );
    if !abi.compatible {
        return Ok(incompatible_report(abi, "abi"));
    }
    let prepared = driver
        .prepare_candidate(candidate_content)
        .map_err(|error| driver_error("prepare", error))?;
    let migrated = driver
        .migrate_snapshot(current_snapshot, &prepared)
        .map_err(|error| driver_error("migrate", error))?;
    let candidate = driver
        .replay_candidate(migrated, recent_trace, &prepared)
        .map_err(|error| driver_error("replay", error))?;
    if candidate.events.len() != current_baseline.events.len() {
        let mut report = incompatible_report(abi, "event-count");
        report.invariant_failures = candidate.invariant_failures;
        return Ok(report);
    }
    for (expected, actual) in current_baseline.events.iter().zip(&candidate.events) {
        if expected.sequence != actual.sequence
            || expected.mechanical_digest != actual.mechanical_digest
            || expected.control_digest != actual.control_digest
        {
            return Ok(ReloadPreflightReportV1 {
                compatible: false,
                abi,
                first_divergent_sequence: Some(expected.sequence.min(actual.sequence)),
                current_digest: Some(expected.mechanical_digest.clone()),
                candidate_digest: Some(actual.mechanical_digest.clone()),
                control_closed: false,
                invariant_failures: candidate.invariant_failures,
                failure_stage: Some("replay-divergence".to_owned()),
            });
        }
    }
    let control_closed = candidate.final_control_digest == current_baseline.final_control_digest;
    let invariant_failures = candidate.invariant_failures;
    let compatible = control_closed && invariant_failures.is_empty();
    Ok(ReloadPreflightReportV1 {
        compatible,
        abi,
        first_divergent_sequence: None,
        current_digest: None,
        candidate_digest: None,
        control_closed,
        invariant_failures,
        failure_stage: (!compatible).then(|| "closure".to_owned()),
    })
}

fn incompatible_report(abi: AbiCompatibilityReportV1, stage: &str) -> ReloadPreflightReportV1 {
    ReloadPreflightReportV1 {
        compatible: false,
        abi,
        first_divergent_sequence: None,
        current_digest: None,
        candidate_digest: None,
        control_closed: false,
        invariant_failures: Vec::new(),
        failure_stage: Some(stage.to_owned()),
    }
}

fn driver_error(error_stage: &str, error: impl ToString) -> ReloadPreflightErrorV1 {
    ReloadPreflightErrorV1::Driver {
        stage: error_stage.to_owned(),
        message: error.to_string(),
    }
}
