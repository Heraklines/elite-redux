use ed25519_dalek::{Signature, VerifyingKey};
use er_canonical::canonical_bytes;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    FailureFingerprintV1, PlatformTimestamp, ProductionAuthorityRuntimeV1,
    ProductionContractErrorV1, ProductionReleaseId, ReleaseChannelV1, ReleaseSigningKeyId,
    RollbackDirectiveId, RolloutPolicyId, RolloutRingId, TrustedReleaseKeyV1,
};

const POLICY_DOMAIN_V1: &[u8] = b"er-m9:rollout-policy-v1\0";
const ROLLBACK_DOMAIN_V1: &[u8] = b"er-m9:rollback-directive-v1\0";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseHealthBudgetV1 {
    pub worker_initialization_failure_basis_points: u16,
    pub unrecoverable_kernel_fault_basis_points: u16,
    pub deterministic_migration_failures: u64,
    pub cloud_save_regression_basis_points: u16,
    pub coop_relative_regression_percent: u16,
    pub coop_absolute_regression_basis_points: u16,
    pub input_latency_regression_percent: u16,
    pub crash_free_regression_basis_points: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedPerformanceSummaryV1 {
    pub samples: u64,
    pub median_micros: u64,
    pub p95_micros: u64,
    pub p99_micros: u64,
    pub maximum_micros: u64,
    pub memory_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseHealthSnapshotV1 {
    pub schema_version: u32,
    pub observed_sessions: u64,
    pub observed_minutes: u64,
    pub worker_initialization_failure_basis_points: u16,
    pub unrecoverable_kernel_fault_basis_points: u16,
    pub deterministic_migration_failures: u64,
    pub cloud_save_regression_basis_points: u16,
    pub coop_relative_regression_percent: u16,
    pub coop_absolute_regression_basis_points: u16,
    pub input_latency_regression_percent: u16,
    pub crash_free_regression_basis_points: u16,
    pub hard_stop: bool,
    pub hard_stop_fingerprint: Option<FailureFingerprintV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RolloutEligibilityV1 {
    CiLocal,
    InternalAllowlist,
    PreviewAllowlist,
    Public,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RolloutRingV1 {
    pub ring: RolloutRingId,
    pub percentage_basis_points: u16,
    pub eligibility: RolloutEligibilityV1,
    pub minimum_sessions: u64,
    pub minimum_duration_minutes: u64,
    pub required_health: ReleaseHealthBudgetV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RolloutHardStopRuleV1 {
    SaveCorruption,
    DeterministicMigrationFailure,
    MechanicalDivergence,
    MixedArtifactExecution,
    AcceptedProtocolMismatch,
    CrossGenerationMaterial,
    AuthorityReplicaMismatch,
    UnsignedAssignment,
    RendererCanonicalMutation,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RolloutSoftStopRuleV1 {
    WorkerFailureRate,
    KernelFaultRate,
    CloudSaveRegression,
    CoopRegression,
    InputLatencyRegression,
    CrashFreeRegression,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RolloutPolicyV1 {
    pub schema_version: u32,
    pub policy_id: RolloutPolicyId,
    pub policy_version: u32,
    pub candidate_release: ProductionReleaseId,
    pub stable_release: ProductionReleaseId,
    pub legacy_release: Option<ProductionReleaseId>,
    pub rings: Vec<RolloutRingV1>,
    pub hard_stop_rules: Vec<RolloutHardStopRuleV1>,
    pub soft_stop_rules: Vec<RolloutSoftStopRuleV1>,
    pub issued_at: PlatformTimestamp,
    pub expires_at: PlatformTimestamp,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedRolloutPolicyV1 {
    pub envelope_version: u32,
    pub key_id: ReleaseSigningKeyId,
    pub payload: RolloutPolicyV1,
    pub signature: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RollbackScopeV1 {
    NewSessions,
    UnstartedAssignedSessions,
    AllSafeBoundarySessions,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RollbackReasonV1 {
    HardStop,
    RateRegression,
    OperatorDrill,
    ReleaseRevoked,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RollbackDirectiveV1 {
    pub schema_version: u32,
    pub directive_id: RollbackDirectiveId,
    pub affected_release: ProductionReleaseId,
    pub target_release: ProductionReleaseId,
    pub target_runtime: ProductionAuthorityRuntimeV1,
    pub scope: RollbackScopeV1,
    pub reason: RollbackReasonV1,
    pub issued_at: PlatformTimestamp,
    pub expires_at: PlatformTimestamp,
    pub policy_version: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedRollbackDirectiveV1 {
    pub envelope_version: u32,
    pub key_id: ReleaseSigningKeyId,
    pub payload: RollbackDirectiveV1,
    pub signature: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RingHealthDecisionV1 {
    Promote,
    Pause,
    Halt,
}

impl ReleaseHealthSnapshotV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        if self.schema_version != 1
            || self.worker_initialization_failure_basis_points > 10_000
            || self.unrecoverable_kernel_fault_basis_points > 10_000
            || self.cloud_save_regression_basis_points > 10_000
            || self.coop_relative_regression_percent > 100
            || self.coop_absolute_regression_basis_points > 10_000
            || self.input_latency_regression_percent > 100
            || self.crash_free_regression_basis_points > 10_000
            || self.hard_stop != self.hard_stop_fingerprint.is_some()
        {
            return Err(ProductionContractErrorV1::Rollout("health snapshot"));
        }
        Ok(())
    }

    pub fn evaluate(
        &self,
        ring: &RolloutRingV1,
    ) -> Result<RingHealthDecisionV1, ProductionContractErrorV1> {
        self.validate()?;
        if self.hard_stop || self.deterministic_migration_failures > 0 {
            return Ok(RingHealthDecisionV1::Halt);
        }
        if self.observed_sessions < ring.minimum_sessions
            || self.observed_minutes < ring.minimum_duration_minutes
        {
            return Ok(RingHealthDecisionV1::Pause);
        }
        let budget = &ring.required_health;
        if self.worker_initialization_failure_basis_points
            > budget.worker_initialization_failure_basis_points
            || self.unrecoverable_kernel_fault_basis_points
                > budget.unrecoverable_kernel_fault_basis_points
            || self.cloud_save_regression_basis_points > budget.cloud_save_regression_basis_points
            || self.coop_relative_regression_percent > budget.coop_relative_regression_percent
            || self.coop_absolute_regression_basis_points
                > budget.coop_absolute_regression_basis_points
            || self.input_latency_regression_percent > budget.input_latency_regression_percent
            || self.crash_free_regression_basis_points > budget.crash_free_regression_basis_points
        {
            return Ok(RingHealthDecisionV1::Pause);
        }
        Ok(RingHealthDecisionV1::Promote)
    }
}

impl RolloutPolicyV1 {
    pub fn validate(&self, now: PlatformTimestamp) -> Result<(), ProductionContractErrorV1> {
        self.policy_id.validate("rollout policy")?;
        self.candidate_release.validate("candidate release")?;
        self.stable_release.validate("stable release")?;
        if self.schema_version != 1
            || self.policy_version == 0
            || self.rings.len() != 8
            || self.hard_stop_rules.len() != 9
            || self.issued_at.0 > now.0
            || now.0 >= self.expires_at.0
            || self.issued_at.0 >= self.expires_at.0
        {
            return Err(ProductionContractErrorV1::Rollout("policy shape"));
        }
        let expected = [0_u16, 0, 0, 100, 500, 2_500, 5_000, 10_000];
        if self
            .rings
            .iter()
            .zip(expected)
            .any(|(ring, percentage)| ring.percentage_basis_points != percentage)
        {
            return Err(ProductionContractErrorV1::Rollout("ring percentages"));
        }
        Ok(())
    }

    pub fn cohort_bucket(&self, sticky_identity: &str) -> u16 {
        let digest = Sha256::digest(format!("{}:{sticky_identity}", self.policy_id.0).as_bytes());
        u16::from_be_bytes([digest[0], digest[1]]) % 10_000
    }

    fn signed_bytes(&self) -> Result<Vec<u8>, ProductionContractErrorV1> {
        domain_bytes(POLICY_DOMAIN_V1, self)
    }
}

impl SignedRolloutPolicyV1 {
    pub fn verify(
        &self,
        keys: &[TrustedReleaseKeyV1],
        now: PlatformTimestamp,
    ) -> Result<(), ProductionContractErrorV1> {
        self.payload.validate(now)?;
        verify_signature(
            self.envelope_version,
            &self.key_id,
            &self.signature,
            keys,
            ReleaseChannelV1::Stable,
            &self.payload.signed_bytes()?,
        )
    }
}

impl RollbackDirectiveV1 {
    fn signed_bytes(&self) -> Result<Vec<u8>, ProductionContractErrorV1> {
        domain_bytes(ROLLBACK_DOMAIN_V1, self)
    }
}

impl SignedRollbackDirectiveV1 {
    pub fn verify(
        &self,
        keys: &[TrustedReleaseKeyV1],
        now: PlatformTimestamp,
    ) -> Result<(), ProductionContractErrorV1> {
        self.payload.directive_id.validate("rollback directive")?;
        self.payload.affected_release.validate("affected release")?;
        self.payload.target_release.validate("target release")?;
        if self.payload.schema_version != 1
            || self.payload.policy_version == 0
            || self.payload.issued_at.0 > now.0
            || now.0 >= self.payload.expires_at.0
            || self.payload.affected_release == self.payload.target_release
        {
            return Err(ProductionContractErrorV1::Rollout("rollback directive"));
        }
        verify_signature(
            self.envelope_version,
            &self.key_id,
            &self.signature,
            keys,
            ReleaseChannelV1::Rollback,
            &self.payload.signed_bytes()?,
        )
    }
}

fn domain_bytes<T: Serialize>(
    domain: &[u8],
    value: &T,
) -> Result<Vec<u8>, ProductionContractErrorV1> {
    let payload = canonical_bytes(value)
        .map_err(|error| ProductionContractErrorV1::Canonical(error.to_string()))?;
    let mut bytes = Vec::with_capacity(domain.len() + payload.len());
    bytes.extend_from_slice(domain);
    bytes.extend_from_slice(&payload);
    Ok(bytes)
}

fn verify_signature(
    envelope_version: u32,
    key_id: &ReleaseSigningKeyId,
    signature: &[u8],
    keys: &[TrustedReleaseKeyV1],
    channel: ReleaseChannelV1,
    bytes: &[u8],
) -> Result<(), ProductionContractErrorV1> {
    if envelope_version != 1 || signature.len() != 64 {
        return Err(ProductionContractErrorV1::Signature(
            "signed policy envelope".to_owned(),
        ));
    }
    let key = keys
        .iter()
        .find(|candidate| &candidate.key_id == key_id)
        .ok_or_else(|| ProductionContractErrorV1::Signature("unknown policy key".to_owned()))?;
    if key.revoked || !key.channels.contains(&channel) {
        return Err(ProductionContractErrorV1::Signature(
            "policy key rejected".to_owned(),
        ));
    }
    let public = VerifyingKey::from_bytes(&key.public_key)
        .map_err(|error| ProductionContractErrorV1::Signature(error.to_string()))?;
    let signature_bytes: [u8; 64] = signature
        .try_into()
        .map_err(|_| ProductionContractErrorV1::Signature("policy signature length".to_owned()))?;
    public
        .verify_strict(bytes, &Signature::from_bytes(&signature_bytes))
        .map_err(|error| ProductionContractErrorV1::Signature(error.to_string()))
}

pub fn safe_timestamp(value: u64) -> Result<PlatformTimestamp, ProductionContractErrorV1> {
    SafeU53::new(value)
        .map(PlatformTimestamp)
        .map_err(|_| ProductionContractErrorV1::Time)
}
