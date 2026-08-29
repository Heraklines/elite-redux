//! Typed architecture-simplification manifest and audit evidence.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentOwnerV1 {
    pub concern: String,
    pub symbol: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchitectureManifestV1 {
    pub schema_version: u32,
    pub m71_base_sha: String,
    pub current_owners: Vec<CurrentOwnerV1>,
    pub forbidden_current_runtime_terms: Vec<String>,
    pub forbidden_core_dependencies: Vec<String>,
    pub historical_policy: String,
    pub new_crate_budget: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchitectureAuditV1 {
    pub current_owner_count: usize,
    pub legacy_runtime_imports: Vec<String>,
    pub forbidden_dependencies: Vec<String>,
    pub unexpected_new_crates: Vec<String>,
    pub passed: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ArchitectureAuditErrorV1 {
    #[error("architecture manifest identity, order, owner, or policy is invalid")]
    Invalid,
}

impl ArchitectureManifestV1 {
    pub fn validate(&self) -> Result<(), ArchitectureAuditErrorV1> {
        if self.schema_version != 1
            || self.m71_base_sha.len() != 40
            || self.current_owners.is_empty()
            || self
                .current_owners
                .windows(2)
                .any(|pair| pair[0].concern >= pair[1].concern)
            || self
                .current_owners
                .iter()
                .any(|owner| owner.concern.is_empty() || owner.symbol.is_empty())
            || self
                .forbidden_current_runtime_terms
                .iter()
                .any(String::is_empty)
            || self.forbidden_core_dependencies != ["er-lab"]
            || self.historical_policy != "migration-only"
            || self.new_crate_budget != ["er-lab"]
        {
            return Err(ArchitectureAuditErrorV1::Invalid);
        }
        Ok(())
    }

    pub fn audit(
        &self,
        mut legacy_runtime_imports: Vec<String>,
        mut forbidden_dependencies: Vec<String>,
        mut unexpected_new_crates: Vec<String>,
    ) -> Result<ArchitectureAuditV1, ArchitectureAuditErrorV1> {
        self.validate()?;
        legacy_runtime_imports.sort();
        legacy_runtime_imports.dedup();
        forbidden_dependencies.sort();
        forbidden_dependencies.dedup();
        unexpected_new_crates.sort();
        unexpected_new_crates.dedup();
        let passed = legacy_runtime_imports.is_empty()
            && forbidden_dependencies.is_empty()
            && unexpected_new_crates.is_empty();
        Ok(ArchitectureAuditV1 {
            current_owner_count: self.current_owners.len(),
            legacy_runtime_imports,
            forbidden_dependencies,
            unexpected_new_crates,
            passed,
        })
    }
}
