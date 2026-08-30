use ed25519_dalek::{Signature, VerifyingKey};
use er_canonical::canonical_bytes;
use er_kernel_worker::KernelGenerationIdentityV1;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};

use crate::{
    BrowserGameSessionId, MechanicalCompatibilityIdentityV1, PlatformTimestamp,
    ProductionContractErrorV1, ProductionReleaseId, ProductionRunId, ReleaseChannelV1,
    ReleaseSigningKeyId, RolloutCohortId, RuntimeAssignmentId, TrustedReleaseKeyV1,
    validate_identifier,
};

const ASSIGNMENT_DOMAIN_V1: &[u8] = b"er-m9:runtime-assignment-v1\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductionAuthorityRuntimeV1 {
    RustProduction,
    RustCanary,
    RustShadowSample,
    LegacyTransition,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum RuntimeAssignmentScopeV1 {
    BrowserSession { session_id: BrowserGameSessionId },
    GameRun { run_id: ProductionRunId },
    Account { pseudonymous_account_id: String },
    CoopParty { party_id: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeAssignmentV1 {
    pub schema_version: u32,
    pub assignment_id: RuntimeAssignmentId,
    pub release_id: ProductionReleaseId,
    pub authority: ProductionAuthorityRuntimeV1,
    pub cohort: RolloutCohortId,
    pub sticky_scope: RuntimeAssignmentScopeV1,
    pub issued_at: PlatformTimestamp,
    pub expires_at: PlatformTimestamp,
    pub policy_version: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedRuntimeAssignmentV1 {
    pub envelope_version: u32,
    pub key_id: ReleaseSigningKeyId,
    pub payload: RuntimeAssignmentV1,
    pub signature: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionRuntimePinV1 {
    pub schema_version: u32,
    pub session_id: BrowserGameSessionId,
    pub run_id: Option<ProductionRunId>,
    pub release_id: ProductionReleaseId,
    pub kernel_generation: KernelGenerationIdentityV1,
    pub mechanical_identity: MechanicalCompatibilityIdentityV1,
    pub authority: ProductionAuthorityRuntimeV1,
    pub created_sequence: SafeU53,
    pub latest_sequence: SafeU53,
}

impl RuntimeAssignmentScopeV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        match self {
            Self::BrowserSession { session_id } => session_id.validate("browser session"),
            Self::GameRun { run_id } => run_id.validate("run ID"),
            Self::Account {
                pseudonymous_account_id,
            } => validate_identifier(pseudonymous_account_id, "pseudonymous account"),
            Self::CoopParty { party_id } => validate_identifier(party_id, "co-op party"),
        }
    }
}

impl RuntimeAssignmentV1 {
    pub fn validate(&self, now: PlatformTimestamp) -> Result<(), ProductionContractErrorV1> {
        self.assignment_id.validate("assignment ID")?;
        self.release_id.validate("release ID")?;
        self.cohort.validate("rollout cohort")?;
        self.sticky_scope.validate()?;
        if self.schema_version != 1
            || self.policy_version == 0
            || self.issued_at.0 > now.0
            || now.0 >= self.expires_at.0
            || self.issued_at.0 >= self.expires_at.0
        {
            return Err(ProductionContractErrorV1::Assignment("schema or time"));
        }
        Ok(())
    }

    pub fn signed_bytes(&self) -> Result<Vec<u8>, ProductionContractErrorV1> {
        let payload = canonical_bytes(self)
            .map_err(|error| ProductionContractErrorV1::Canonical(error.to_string()))?;
        let mut bytes = Vec::with_capacity(ASSIGNMENT_DOMAIN_V1.len() + payload.len());
        bytes.extend_from_slice(ASSIGNMENT_DOMAIN_V1);
        bytes.extend_from_slice(&payload);
        Ok(bytes)
    }
}

impl SignedRuntimeAssignmentV1 {
    pub fn verify(
        &self,
        keys: &[TrustedReleaseKeyV1],
        channel: ReleaseChannelV1,
        now: PlatformTimestamp,
    ) -> Result<(), ProductionContractErrorV1> {
        if self.envelope_version != 1 || self.signature.len() != 64 {
            return Err(ProductionContractErrorV1::Signature(
                "assignment envelope".to_owned(),
            ));
        }
        self.payload.validate(now)?;
        let key = keys
            .iter()
            .find(|candidate| candidate.key_id == self.key_id)
            .ok_or_else(|| {
                ProductionContractErrorV1::Signature("unknown assignment key".to_owned())
            })?;
        if key.revoked || !key.channels.contains(&channel) {
            return Err(ProductionContractErrorV1::Signature(
                "assignment key policy".to_owned(),
            ));
        }
        let public = VerifyingKey::from_bytes(&key.public_key)
            .map_err(|error| ProductionContractErrorV1::Signature(error.to_string()))?;
        let signature_bytes: [u8; 64] =
            self.signature.as_slice().try_into().map_err(|_| {
                ProductionContractErrorV1::Signature("assignment length".to_owned())
            })?;
        public
            .verify_strict(
                &self.payload.signed_bytes()?,
                &Signature::from_bytes(&signature_bytes),
            )
            .map_err(|error| ProductionContractErrorV1::Signature(error.to_string()))
    }
}

impl SessionRuntimePinV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        self.session_id.validate("browser session")?;
        self.release_id.validate("release ID")?;
        if let Some(run) = &self.run_id {
            run.validate("run ID")?;
        }
        self.kernel_generation
            .validate()
            .map_err(|_| ProductionContractErrorV1::Pin("kernel generation"))?;
        self.mechanical_identity.validate()?;
        if self.schema_version != 1
            || self.latest_sequence < self.created_sequence
            || matches!(
                self.authority,
                ProductionAuthorityRuntimeV1::LegacyTransition
            ) && self.kernel_generation.content_identity.is_empty()
        {
            return Err(ProductionContractErrorV1::Pin(
                "schema, sequence, or authority",
            ));
        }
        Ok(())
    }
}
