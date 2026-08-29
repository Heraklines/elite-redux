use er_kernel_worker::KernelGenerationIdentityV1;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    BoundedPerformanceSummaryV1, FailureFingerprintV1, ProductionContractErrorV1,
    ProductionReleaseId, RolloutRingId, valid_sha256,
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

impl ProductionHealthEventV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        self.release_id.validate("health release")?;
        self.kernel_generation
            .validate()
            .map_err(|_| ProductionContractErrorV1::Telemetry("kernel generation"))?;
        if self.schema_version != 1 {
            return Err(ProductionContractErrorV1::Telemetry("schema"));
        }
        if let Some(fingerprint) = &self.failure_fingerprint {
            if !valid_sha256(&fingerprint.0) {
                return Err(ProductionContractErrorV1::Telemetry("failure fingerprint"));
            }
        }
        if let Some(performance) = &self.performance {
            if performance.samples == 0
                || performance.median_micros > performance.p95_micros
                || performance.p95_micros > performance.p99_micros
                || performance.p99_micros > performance.maximum_micros
            {
                return Err(ProductionContractErrorV1::Telemetry("performance summary"));
            }
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
    subsystem: &str,
    error_code: &str,
) -> Result<FailureFingerprintV1, ProductionContractErrorV1> {
    release.validate("fingerprint release")?;
    if subsystem.is_empty()
        || subsystem.len() > 64
        || error_code.is_empty()
        || error_code.len() > 64
        || !subsystem
            .bytes()
            .all(|value| value.is_ascii_uppercase() || value == b'_')
        || !error_code
            .bytes()
            .all(|value| value.is_ascii_uppercase() || value == b'_')
    {
        return Err(ProductionContractErrorV1::Telemetry("fingerprint input"));
    }
    let digest = Sha256::digest(format!("{}:{subsystem}:{error_code}", release.0).as_bytes());
    Ok(FailureFingerprintV1(format!("{digest:x}")))
}
