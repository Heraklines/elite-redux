use serde::{Deserialize, Serialize};

use crate::{
    ProductionContractErrorV1, ProductionReleaseId, ProductionReleaseManifestV2,
    ReleaseHealthSnapshotV1,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductionGenerationStatusV1 {
    Built,
    Qualified,
    Internal,
    Canary,
    Stable,
    Draining,
    Rollback,
    Revoked,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionGenerationEntryV1 {
    pub release: ProductionReleaseManifestV2,
    pub status: ProductionGenerationStatusV1,
    pub assigned_new_sessions: u64,
    pub active_sessions: u64,
    pub health: ReleaseHealthSnapshotV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductionGenerationRegistryV1 {
    pub schema_version: u32,
    pub releases: Vec<ProductionGenerationEntryV1>,
}

impl ProductionGenerationRegistryV1 {
    pub fn validate(&self) -> Result<(), ProductionContractErrorV1> {
        if self.schema_version != 1 || self.releases.len() > 64 {
            return Err(ProductionContractErrorV1::Generation(
                "schema or release bound",
            ));
        }
        for (index, entry) in self.releases.iter().enumerate() {
            entry.release.release_id.validate("generation release")?;
            entry.health.validate()?;
            if self.releases[..index]
                .iter()
                .any(|previous| previous.release.release_id == entry.release.release_id)
            {
                return Err(ProductionContractErrorV1::Generation("duplicate release"));
            }
        }
        if self
            .releases
            .iter()
            .filter(|entry| matches!(entry.status, ProductionGenerationStatusV1::Stable))
            .count()
            > 1
        {
            return Err(ProductionContractErrorV1::Generation(
                "multiple stable releases",
            ));
        }
        Ok(())
    }

    pub fn entry(&self, release: &ProductionReleaseId) -> Option<&ProductionGenerationEntryV1> {
        self.releases
            .iter()
            .find(|entry| &entry.release.release_id == release)
    }

    pub fn assign_new_session(
        &mut self,
        release: &ProductionReleaseId,
    ) -> Result<(), ProductionContractErrorV1> {
        let entry = self
            .releases
            .iter_mut()
            .find(|entry| &entry.release.release_id == release)
            .ok_or(ProductionContractErrorV1::Generation(
                "unknown assigned release",
            ))?;
        if !matches!(
            entry.status,
            ProductionGenerationStatusV1::Internal
                | ProductionGenerationStatusV1::Canary
                | ProductionGenerationStatusV1::Stable
                | ProductionGenerationStatusV1::Rollback
        ) || entry.health.hard_stop
        {
            return Err(ProductionContractErrorV1::Generation(
                "release not assignable",
            ));
        }
        entry.assigned_new_sessions = entry
            .assigned_new_sessions
            .checked_add(1)
            .ok_or(ProductionContractErrorV1::Generation("assignment overflow"))?;
        entry.active_sessions =
            entry
                .active_sessions
                .checked_add(1)
                .ok_or(ProductionContractErrorV1::Generation(
                    "active session overflow",
                ))?;
        Ok(())
    }

    pub fn release_pin(
        &mut self,
        release: &ProductionReleaseId,
    ) -> Result<(), ProductionContractErrorV1> {
        let entry = self
            .releases
            .iter_mut()
            .find(|entry| &entry.release.release_id == release)
            .ok_or(ProductionContractErrorV1::Generation(
                "unknown pinned release",
            ))?;
        if entry.active_sessions == 0 {
            return Err(ProductionContractErrorV1::Generation("pin underflow"));
        }
        entry.active_sessions -= 1;
        Ok(())
    }

    pub fn eviction_candidates(&self) -> Vec<ProductionReleaseId> {
        let mut candidates = self
            .releases
            .iter()
            .filter(|entry| {
                entry.active_sessions == 0
                    && matches!(
                        entry.status,
                        ProductionGenerationStatusV1::Built
                            | ProductionGenerationStatusV1::Qualified
                            | ProductionGenerationStatusV1::Draining
                            | ProductionGenerationStatusV1::Revoked
                    )
            })
            .map(|entry| {
                (
                    entry.release.release_epoch,
                    entry.release.release_id.clone(),
                )
            })
            .collect::<Vec<_>>();
        candidates.sort_by_key(|(epoch, _)| *epoch);
        candidates.into_iter().map(|(_, release)| release).collect()
    }
}
