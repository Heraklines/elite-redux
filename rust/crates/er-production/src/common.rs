use er_types::SafeU53;
use serde::{Deserialize, Serialize};

use crate::ProductionContractErrorV1;

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);

        impl $name {
            pub fn validate(&self, label: &'static str) -> Result<(), ProductionContractErrorV1> {
                validate_identifier(&self.0, label)
            }
        }
    };
}

string_id!(ProductionReleaseId);
string_id!(ReleaseSigningKeyId);
string_id!(RuntimeAssignmentId);
string_id!(RolloutCohortId);
string_id!(BrowserGameSessionId);
string_id!(ProductionRunId);
string_id!(RolloutPolicyId);
string_id!(RolloutRingId);
string_id!(RollbackDirectiveId);
string_id!(SaveSlotId);
string_id!(BrowserInstanceId);
string_id!(SaveMigratorId);
string_id!(LegacySaveBackupReferenceV1);
string_id!(FailureFingerprintV1);

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PlatformTimestamp(pub SafeU53);

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SaveGeneration(pub SafeU53);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReleaseChannelV1 {
    Internal,
    Preview,
    Canary,
    Stable,
    Rollback,
    LegacyTransition,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanicalCompatibilityIdentityV1 {
    pub schema_version: u32,
    pub mechanics_sha256: String,
    pub content_hash: String,
    pub authority_protocol: String,
    pub active_model_identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuildDiagnosticIdentityV1 {
    pub schema_version: u32,
    pub toolchain: String,
    pub target: String,
    pub profile: String,
    pub lockfile_sha256: String,
    pub build_config_sha256: String,
    pub debug_surfaces_absent: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialSchemaSetV1 {
    pub turn: u32,
    pub replacement: u32,
    pub recovery: u32,
    pub presentation: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactIdentityV1 {
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    pub media_type: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionQualificationEvidenceV1 {
    pub candidate_sha: String,
    pub workflow_run_id: u64,
    pub workflow_name: String,
    pub conclusion: String,
    pub artifact_set_sha256: String,
}

impl MechanicalCompatibilityIdentityV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        if self.schema_version != 1
            || !valid_sha256(&self.mechanics_sha256)
            || self.content_hash.is_empty()
            || self.authority_protocol != "er-coop-47"
            || self.active_model_identity.is_empty()
        {
            return Err(ProductionContractErrorV1::Identifier("mechanical identity"));
        }
        Ok(())
    }
}

impl BuildDiagnosticIdentityV1 {
    pub fn validate_production(&self) -> Result<(), ProductionContractErrorV1> {
        if self.schema_version != 1
            || self.toolchain.is_empty()
            || self.target.is_empty()
            || self.profile != "release"
            || !valid_sha256(&self.lockfile_sha256)
            || !valid_sha256(&self.build_config_sha256)
            || !self.debug_surfaces_absent
        {
            return Err(ProductionContractErrorV1::Identifier(
                "production build identity",
            ));
        }
        Ok(())
    }
}

impl ArtifactIdentityV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        if self.bytes == 0
            || !valid_sha256(&self.sha256)
            || self.media_type.is_empty()
            || self.url.len() > 2_048
            || !self.url.starts_with("/")
            || self.url.contains("..")
            || self.url.contains('#')
        {
            return Err(ProductionContractErrorV1::Artifact);
        }
        Ok(())
    }
}

impl ProductionQualificationEvidenceV1 {
    pub fn validate(&self, integration_sha: &str) -> Result<(), ProductionContractErrorV1> {
        if self.candidate_sha != integration_sha
            || self.workflow_run_id == 0
            || self.workflow_name.is_empty()
            || self.conclusion != "SUCCESS"
            || !valid_sha256(&self.artifact_set_sha256)
        {
            return Err(ProductionContractErrorV1::Identifier(
                "qualification evidence",
            ));
        }
        Ok(())
    }
}

pub fn validate_identifier(
    value: &str,
    label: &'static str,
) -> Result<(), ProductionContractErrorV1> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(ProductionContractErrorV1::Identifier(label));
    }
    Ok(())
}

pub fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub fn valid_git_sha(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
