use std::collections::BTreeSet;

use ed25519_dalek::{Signature, VerifyingKey};
use er_canonical::canonical_bytes;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};

use crate::{
    ArtifactIdentityV1, BuildDiagnosticIdentityV1, MaterialSchemaSetV1,
    MechanicalCompatibilityIdentityV1, PlatformApiVersionSetV1, PlatformTimestamp,
    ProductionContractErrorV1, ProductionQualificationEvidenceV1, ProductionReleaseId,
    ReleaseChannelV1, ReleaseSigningKeyId, valid_git_sha,
};

pub const PRODUCTION_RELEASE_MANIFEST_VERSION_V2: u32 = 2;
pub const SIGNED_MANIFEST_ENVELOPE_VERSION_V1: u32 = 1;
const RELEASE_DOMAIN_V1: &[u8] = b"er-m9:release-manifest-v1\0";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionArtifactSetV1 {
    pub bootstrap_js: ArtifactIdentityV1,
    pub browser_js: ArtifactIdentityV1,
    pub worker_js: ArtifactIdentityV1,
    pub wasm_glue_js: ArtifactIdentityV1,
    pub wasm: ArtifactIdentityV1,
    pub content: ArtifactIdentityV1,
    pub asset_manifest: ArtifactIdentityV1,
    pub service_worker: ArtifactIdentityV1,
    pub session_template: ArtifactIdentityV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionReleaseManifestV2 {
    pub schema_version: u32,
    pub release_id: ProductionReleaseId,
    pub release_epoch: SafeU53,
    pub channel: ReleaseChannelV1,
    pub issued_at: PlatformTimestamp,
    pub expires_at: PlatformTimestamp,
    pub integration_sha: String,
    pub rust_base_sha: String,
    pub browser_base_sha: String,
    pub oracle_sha: String,
    pub qualified_asset_sha: String,
    pub mechanical_identity: MechanicalCompatibilityIdentityV1,
    pub build_identity: BuildDiagnosticIdentityV1,
    pub browser_kernel_abi: u32,
    pub worker_protocol: u32,
    pub authority_protocol: String,
    pub material_schemas: MaterialSchemaSetV1,
    pub save_schema: u32,
    pub artifacts: ProductionArtifactSetV1,
    pub previous_rust_release: Option<ProductionReleaseId>,
    pub legacy_transition_release: Option<ProductionReleaseId>,
    pub platform_api_versions: PlatformApiVersionSetV1,
    pub qualification: ProductionQualificationEvidenceV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedProductionManifestV1 {
    pub envelope_version: u32,
    pub key_id: ReleaseSigningKeyId,
    pub payload: ProductionReleaseManifestV2,
    pub signature: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrustedReleaseKeyV1 {
    pub key_id: ReleaseSigningKeyId,
    pub public_key: [u8; 32],
    pub channels: Vec<ReleaseChannelV1>,
    pub minimum_release_epoch: SafeU53,
    pub revoked: bool,
}

impl ProductionArtifactSetV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        let artifacts = [
            &self.bootstrap_js,
            &self.browser_js,
            &self.worker_js,
            &self.wasm_glue_js,
            &self.wasm,
            &self.content,
            &self.asset_manifest,
            &self.service_worker,
            &self.session_template,
        ];
        let mut urls = BTreeSet::new();
        for artifact in artifacts {
            artifact.validate()?;
            if !urls.insert(&artifact.url) {
                return Err(ProductionContractErrorV1::Artifact);
            }
        }
        Ok(())
    }
}

impl ProductionReleaseManifestV2 {
    pub fn validate(&self, now: PlatformTimestamp) -> Result<(), ProductionContractErrorV1> {
        self.release_id.validate("release ID")?;
        if self.schema_version != PRODUCTION_RELEASE_MANIFEST_VERSION_V2
            || self.release_epoch.get() == 0
            || self.issued_at.0 > now.0
            || now.0 >= self.expires_at.0
            || self.issued_at.0 >= self.expires_at.0
            || !valid_git_sha(&self.integration_sha)
            || !valid_git_sha(&self.rust_base_sha)
            || !valid_git_sha(&self.browser_base_sha)
            || !valid_git_sha(&self.oracle_sha)
            || !valid_git_sha(&self.qualified_asset_sha)
            || self.browser_kernel_abi != 1
            || self.worker_protocol != 1
            || self.authority_protocol != "er-coop-47"
            || self.save_schema == 0
        {
            return Err(ProductionContractErrorV1::Schema);
        }
        self.mechanical_identity.validate()?;
        self.build_identity.validate_production()?;
        self.artifacts.validate()?;
        self.platform_api_versions.validate()?;
        self.qualification.validate(&self.integration_sha)?;
        if let Some(previous) = &self.previous_rust_release {
            previous.validate("previous Rust release")?;
            if previous == &self.release_id {
                return Err(ProductionContractErrorV1::Artifact);
            }
        }
        if let Some(legacy) = &self.legacy_transition_release {
            legacy.validate("legacy transition release")?;
            if legacy == &self.release_id {
                return Err(ProductionContractErrorV1::Artifact);
            }
        }
        Ok(())
    }

    pub fn signed_bytes(&self) -> Result<Vec<u8>, ProductionContractErrorV1> {
        let payload = canonical_bytes(self)
            .map_err(|error| ProductionContractErrorV1::Canonical(error.to_string()))?;
        let mut bytes = Vec::with_capacity(RELEASE_DOMAIN_V1.len() + payload.len());
        bytes.extend_from_slice(RELEASE_DOMAIN_V1);
        bytes.extend_from_slice(&payload);
        Ok(bytes)
    }
}

impl SignedProductionManifestV1 {
    pub fn verify(
        &self,
        trusted_keys: &[TrustedReleaseKeyV1],
        now: PlatformTimestamp,
    ) -> Result<(), ProductionContractErrorV1> {
        if self.envelope_version != SIGNED_MANIFEST_ENVELOPE_VERSION_V1
            || self.signature.len() != 64
        {
            return Err(ProductionContractErrorV1::Signature(
                "envelope shape".to_owned(),
            ));
        }
        self.payload.validate(now)?;
        let key = trusted_keys
            .iter()
            .find(|candidate| candidate.key_id == self.key_id)
            .ok_or_else(|| ProductionContractErrorV1::Signature("unknown key".to_owned()))?;
        if key.revoked
            || !key.channels.contains(&self.payload.channel)
            || self.payload.release_epoch < key.minimum_release_epoch
        {
            return Err(ProductionContractErrorV1::Signature(
                "key policy".to_owned(),
            ));
        }
        let verifying_key = VerifyingKey::from_bytes(&key.public_key)
            .map_err(|error| ProductionContractErrorV1::Signature(error.to_string()))?;
        let signature_bytes: [u8; 64] = self
            .signature
            .as_slice()
            .try_into()
            .map_err(|_| ProductionContractErrorV1::Signature("signature length".to_owned()))?;
        let signature = Signature::from_bytes(&signature_bytes);
        verifying_key
            .verify_strict(&self.payload.signed_bytes()?, &signature)
            .map_err(|error| ProductionContractErrorV1::Signature(error.to_string()))
    }
}
