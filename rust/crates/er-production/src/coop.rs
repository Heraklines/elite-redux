use serde::{Deserialize, Serialize};

use crate::{
    MaterialSchemaSetV1, MechanicalCompatibilityIdentityV1, ProductionAuthorityRuntimeV1,
    ProductionContractErrorV1, ProductionReleaseId, RUST_PREVIEW_SAVE_NAMESPACE_V1,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionCoopCompatibilityV1 {
    pub schema_version: u32,
    pub save_namespace: String,
    pub release_id: ProductionReleaseId,
    pub compatible_releases: Vec<ProductionReleaseId>,
    pub authority_runtime: ProductionAuthorityRuntimeV1,
    pub authority_protocol: String,
    pub mechanical_identity: MechanicalCompatibilityIdentityV1,
    pub content_hash: String,
    pub material_schemas: MaterialSchemaSetV1,
    pub browser_kernel_abi: u32,
    pub save_schema: u32,
    pub active_model_identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartyReleaseAssignmentV1 {
    pub schema_version: u32,
    pub party_id: String,
    pub release_id: ProductionReleaseId,
    pub participants: Vec<String>,
    pub compatibility_digest: String,
}

impl ProductionCoopCompatibilityV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        self.release_id.validate("co-op release")?;
        self.mechanical_identity.validate()?;
        if self.schema_version != 1
            || self.save_namespace != RUST_PREVIEW_SAVE_NAMESPACE_V1
            || !matches!(
                self.authority_runtime,
                ProductionAuthorityRuntimeV1::RustProduction
                    | ProductionAuthorityRuntimeV1::RustCanary
                    | ProductionAuthorityRuntimeV1::RustShadowSample
            )
            || self.authority_protocol != "er-coop-47"
            || self.content_hash.is_empty()
            || self.browser_kernel_abi != 1
            || self.save_schema == 0
            || self.active_model_identity.is_empty()
            || self.compatible_releases.len() > 16
        {
            return Err(ProductionContractErrorV1::Coop("compatibility shape"));
        }
        for (index, release) in self.compatible_releases.iter().enumerate() {
            release.validate("compatible release")?;
            if self.compatible_releases[..index].contains(release) {
                return Err(ProductionContractErrorV1::Coop(
                    "duplicate compatible release",
                ));
            }
        }
        Ok(())
    }

    pub fn exactly_matches(&self, peer: &Self) -> bool {
        self.save_namespace == peer.save_namespace
            && self.authority_runtime == peer.authority_runtime
            && self.authority_protocol == peer.authority_protocol
            && self.mechanical_identity == peer.mechanical_identity
            && self.content_hash == peer.content_hash
            && self.material_schemas == peer.material_schemas
            && self.browser_kernel_abi == peer.browser_kernel_abi
            && self.save_schema == peer.save_schema
            && self.active_model_identity == peer.active_model_identity
    }
}

pub fn choose_common_release_v1(
    host: &ProductionCoopCompatibilityV1,
    guest: &ProductionCoopCompatibilityV1,
) -> Result<ProductionReleaseId, ProductionContractErrorV1> {
    host.validate()?;
    guest.validate()?;
    if !host.exactly_matches(guest) {
        return Err(ProductionContractErrorV1::Coop(
            "mechanical or protocol mismatch",
        ));
    }
    if host.release_id == guest.release_id {
        return Ok(host.release_id.clone());
    }
    let host_accepts_guest = host.compatible_releases.contains(&guest.release_id);
    let guest_accepts_host = guest.compatible_releases.contains(&host.release_id);
    if host_accepts_guest && guest_accepts_host {
        return Ok(host.release_id.clone());
    }
    host.compatible_releases
        .iter()
        .find(|release| guest.compatible_releases.contains(release))
        .cloned()
        .ok_or(ProductionContractErrorV1::Coop("no common signed release"))
}
