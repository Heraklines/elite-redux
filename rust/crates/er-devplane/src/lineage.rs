//! Deterministic session root, branch, and fork lineage.

use er_canonical::canonical_bytes;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionRootIdV1(pub String);

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionBranchIdV1(pub String);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionForkV1 {
    pub parent_branch: SessionBranchIdV1,
    pub parent_sequence: u64,
    pub parent_snapshot_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionLineageV1 {
    pub root: SessionRootIdV1,
    pub branch: SessionBranchIdV1,
    pub parent: Option<SessionForkV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum LineageErrorV1 {
    #[error("lineage identity input is empty")]
    Empty,
    #[error("lineage identity encoding failed: {0}")]
    Canonical(String),
}

impl SessionLineageV1 {
    pub fn root(seed_identity: &str) -> Result<Self, LineageErrorV1> {
        if seed_identity.is_empty() {
            return Err(LineageErrorV1::Empty);
        }
        let root = SessionRootIdV1(hash_identity("root", &(seed_identity,))?);
        let branch = SessionBranchIdV1(hash_identity("branch", &(&root, 0_u64))?);
        Ok(Self {
            root,
            branch,
            parent: None,
        })
    }

    pub fn fork(
        &self,
        sequence: u64,
        snapshot_digest: String,
        ordinal: u64,
    ) -> Result<Self, LineageErrorV1> {
        if snapshot_digest.is_empty() {
            return Err(LineageErrorV1::Empty);
        }
        let branch = SessionBranchIdV1(hash_identity(
            "branch",
            &(
                &self.root,
                &self.branch,
                sequence,
                &snapshot_digest,
                ordinal,
            ),
        )?);
        Ok(Self {
            root: self.root.clone(),
            branch,
            parent: Some(SessionForkV1 {
                parent_branch: self.branch.clone(),
                parent_sequence: sequence,
                parent_snapshot_digest: snapshot_digest,
            }),
        })
    }
}

fn hash_identity<T: Serialize>(domain: &str, value: &T) -> Result<String, LineageErrorV1> {
    let bytes = canonical_bytes(&("elite-redux/m71/lineage/v1", domain, value))
        .map_err(|error| LineageErrorV1::Canonical(error.to_string()))?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}
