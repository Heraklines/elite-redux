use er_kernel::snapshot_v6::ExternalTraceInputV6;
use er_kernel_worker::KernelGenerationIdentityV1;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReloadPolicyV1 {
    ExactPreservation,
    DeclaredSemanticChange,
    MigratedCompatible,
    IncompatibleReject,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReloadPlanV1 {
    pub schema_version: u32,
    pub policy: ReloadPolicyV1,
    pub allowed_behavior_units: Vec<String>,
    pub allowed_digest_classes: Vec<ReloadDigestClassV1>,
    pub acceptance_events: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReloadDigestClassV1 {
    Mechanical,
    Kernel,
    Presentation,
    Effects,
    Observation,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerationStepEvidenceV1 {
    pub sequence: u64,
    pub mechanical_digest: String,
    pub kernel_digest: String,
    pub presentation_digest: String,
    pub effect_digest: String,
    pub observation_digest: String,
    pub invariant_failures: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReloadTailEventV1 {
    pub input: ExternalTraceInputV6,
    pub active: GenerationStepEvidenceV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReloadDecisionV1 {
    pub accepted: bool,
    pub policy: ReloadPolicyV1,
    pub previous: KernelGenerationIdentityV1,
    pub candidate: KernelGenerationIdentityV1,
    pub migration_ids: Vec<String>,
    pub compared_events: usize,
    pub divergent_classes: Vec<ReloadDigestClassV1>,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerationReloadTraceV1 {
    pub schema_version: u32,
    pub transitions: Vec<ReloadDecisionV1>,
    pub events: Vec<ReloadTailEventV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GenerationConsumerV1 {
    NativeAgent,
    Browser,
    ScenarioFoundry,
    Reproduction,
    GitBisect,
    CoopSimulation,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerationSessionImageV1 {
    pub schema_version: u32,
    pub consumer: GenerationConsumerV1,
    pub generation: KernelGenerationIdentityV1,
    pub snapshot_bytes: Vec<u8>,
    pub reload_trace: GenerationReloadTraceV1,
}

#[derive(Debug, Error)]
pub enum KernelReloadErrorV1 {
    #[error("reload plan is invalid: {0}")]
    Plan(&'static str),
    #[error("candidate generation identity is incompatible: {0}")]
    Identity(&'static str),
    #[error("active session is not at a safe reload boundary: {0}")]
    UnsafeBoundary(String),
    #[error("snapshot migration failed: {0}")]
    Migration(String),
    #[error("candidate generation failed: {0}")]
    Candidate(String),
    #[error("reload comparison rejected candidate: {0}")]
    Comparison(String),
    #[error("reload artifact failed verification: {0}")]
    Artifact(String),
    #[error("kernel worker process failed: {0}")]
    Process(String),
    #[error("reload pair transaction failed: {0}")]
    Pair(String),
}

impl ReloadPlanV1 {
    pub fn validate(&self) -> Result<(), KernelReloadErrorV1> {
        if self.schema_version != 1 || self.acceptance_events > 4_096 {
            return Err(KernelReloadErrorV1::Plan("schema or acceptance bound"));
        }
        if matches!(self.policy, ReloadPolicyV1::DeclaredSemanticChange)
            && self.allowed_behavior_units.is_empty()
        {
            return Err(KernelReloadErrorV1::Plan(
                "declared change has no behavior units",
            ));
        }
        if matches!(self.policy, ReloadPolicyV1::ExactPreservation)
            && (!self.allowed_behavior_units.is_empty() || !self.allowed_digest_classes.is_empty())
        {
            return Err(KernelReloadErrorV1::Plan(
                "exact policy declares divergence",
            ));
        }
        Ok(())
    }
}
