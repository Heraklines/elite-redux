use std::collections::BTreeMap;

use er_kernel_worker::KernelGenerationIdentityV1;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    BoundedPerformanceSummaryV1, FailureFingerprintV1, ProductionContractErrorV1,
    ProductionReleaseId, RolloutHardStopRuleV1, RolloutRingId, valid_sha256,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BrowserClassV1 {
    Chromium,
    Firefox,
    WebKit,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlatformClassV1 {
    Desktop,
    Mobile,
    Tablet,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductionHealthEventKindV1 {
    BootstrapSuccess,
    BootstrapFailure,
    WorkerInitialization,
    SaveMigration,
    SaveRead,
    SaveWrite,
    SaveConflict,
    KernelFault,
    ProtocolPairing,
    ReconnectRecovery,
    PresentationFailure,
    ServiceWorkerMismatch,
    CacheFailure,
    TerminalCompletion,
    PerformanceOutlier,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionHealthEventV1 {
    pub schema_version: u32,
    pub release_id: ProductionReleaseId,
    pub kernel_generation: KernelGenerationIdentityV1,
    pub browser_class: BrowserClassV1,
    pub platform_class: PlatformClassV1,
    pub event: ProductionHealthEventKindV1,
    pub failure_fingerprint: Option<FailureFingerprintV1>,
    pub performance: Option<BoundedPerformanceSummaryV1>,
    pub hard_stop_rule: Option<RolloutHardStopRuleV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShadowSamplingPolicyV1 {
    pub schema_version: u32,
    pub percentage_basis_points: u16,
    pub eligible_rings: Vec<RolloutRingId>,
    pub maximum_events: u64,
    pub maximum_cpu_overhead_percent: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerformanceObservationV1 {
    pub elapsed_micros: u64,
    pub memory_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FailureFingerprintAggregateV1 {
    pub fingerprint: FailureFingerprintV1,
    pub count: u64,
}

impl ProductionHealthEventV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        self.release_id.validate("health release")?;
        self.kernel_generation
            .validate()
            .map_err(|_| ProductionContractErrorV1::Telemetry("kernel generation"))?;
        if self.schema_version != 1 {
            return Err(ProductionContractErrorV1::Telemetry("schema"));
        }
        if self
            .failure_fingerprint
            .as_ref()
            .is_some_and(|fingerprint| !valid_sha256(&fingerprint.0))
            || self.hard_stop_rule.is_some() && self.failure_fingerprint.is_none()
        {
            return Err(ProductionContractErrorV1::Telemetry("failure fingerprint"));
        }
        if self.performance.as_ref().is_some_and(|performance| {
            performance.samples == 0
                || performance.samples > 10_000
                || performance.median_micros > performance.p95_micros
                || performance.p95_micros > performance.p99_micros
                || performance.p99_micros > performance.maximum_micros
                || performance.maximum_micros > 86_400_000_000
                || performance.memory_bytes > 1_099_511_627_776
        }) {
            return Err(ProductionContractErrorV1::Telemetry("performance summary"));
        }
        Ok(())
    }
}

impl ShadowSamplingPolicyV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        if self.schema_version != 1
            || self.percentage_basis_points > 10_000
            || self.maximum_events == 0
            || self.maximum_events > 10_000
            || self.maximum_cpu_overhead_percent > 25
            || self.eligible_rings.len() > 8
        {
            return Err(ProductionContractErrorV1::Telemetry("shadow policy"));
        }
        Ok(())
    }
}

pub fn normalized_failure_fingerprint_v1(
    release: &ProductionReleaseId,
    generation: u64,
    subsystem: &str,
    error_class: &str,
    causal_code: &str,
) -> Result<FailureFingerprintV1, ProductionContractErrorV1> {
    release.validate("fingerprint release")?;
    if generation == 0
        || generation > 9_007_199_254_740_991
        || !normalized_code(subsystem, 64, false)
        || !normalized_code(error_class, 64, false)
        || !normalized_code(causal_code, 128, true)
    {
        return Err(ProductionContractErrorV1::Telemetry("fingerprint input"));
    }
    let digest = Sha256::digest(
        format!(
            "{}:{generation}:{subsystem}:{error_class}:{causal_code}",
            release.0
        )
        .as_bytes(),
    );
    Ok(FailureFingerprintV1(format!("{digest:x}")))
}

pub fn aggregate_performance_summary_v1(
    observations: &[PerformanceObservationV1],
) -> Result<BoundedPerformanceSummaryV1, ProductionContractErrorV1> {
    if observations.is_empty() || observations.len() > 10_000 {
        return Err(ProductionContractErrorV1::Telemetry(
            "performance observations",
        ));
    }
    let mut elapsed = Vec::with_capacity(observations.len());
    let mut memory_bytes = 0;
    for observation in observations {
        if observation.elapsed_micros > 86_400_000_000
            || observation.memory_bytes > 1_099_511_627_776
        {
            return Err(ProductionContractErrorV1::Telemetry(
                "performance observation",
            ));
        }
        elapsed.push(observation.elapsed_micros);
        memory_bytes = memory_bytes.max(observation.memory_bytes);
    }
    elapsed.sort_unstable();
    Ok(BoundedPerformanceSummaryV1 {
        samples: elapsed.len() as u64,
        median_micros: percentile(&elapsed, 50),
        p95_micros: percentile(&elapsed, 95),
        p99_micros: percentile(&elapsed, 99),
        maximum_micros: *elapsed.last().expect("non-empty observations"),
        memory_bytes,
    })
}

pub fn aggregate_failure_fingerprints_v1(
    events: &[ProductionHealthEventV1],
) -> Result<Vec<FailureFingerprintAggregateV1>, ProductionContractErrorV1> {
    let mut counts = BTreeMap::<FailureFingerprintV1, u64>::new();
    for event in events {
        event.validate()?;
        if let Some(fingerprint) = &event.failure_fingerprint {
            *counts.entry(fingerprint.clone()).or_default() += 1;
        }
    }
    Ok(counts
        .into_iter()
        .map(|(fingerprint, count)| FailureFingerprintAggregateV1 { fingerprint, count })
        .collect())
}

fn normalized_code(value: &str, maximum: usize, allow_digits: bool) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value.bytes().all(|byte| {
            byte.is_ascii_uppercase()
                || byte == b'_'
                || allow_digits && (byte.is_ascii_digit() || byte == b':' || byte == b'-')
        })
}

fn percentile(sorted: &[u64], percentile: usize) -> u64 {
    let index = (percentile * sorted.len()).div_ceil(100).saturating_sub(1);
    sorted[index]
}
