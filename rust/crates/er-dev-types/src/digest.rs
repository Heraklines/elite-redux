//! Diagnostic digest hierarchy layered over the unchanged M7 mechanical digest.

use std::collections::BTreeSet;

use er_canonical::canonical_bytes;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const DIAGNOSTIC_DIGEST_DOMAIN_V1: &str = "elite-redux/m71/diagnostic-digest/v1";

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum StatePathSegmentV1 {
    Profile,
    Run,
    Party,
    Pokemon(String),
    Storage,
    StorageSlot(String),
    Inventory,
    Item(String),
    Modifier(String),
    World,
    Scenario,
    Progression,
    Battle,
    Field,
    FieldSlot(String),
    MechanicInstance(String),
    Rng,
    Protocol,
    Ui,
    Input,
    Scheduler,
    Presentation,
    Terminal,
    FieldName(String),
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StatePathV1(pub Vec<StatePathSegmentV1>);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagnosticDigestLevelV1 {
    Major,
    Leaf,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DigestNodeV1 {
    pub path: StatePathV1,
    pub digest: String,
    pub children: Vec<StatePathV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnosticDigestTreeV1 {
    pub mechanical_digest: String,
    pub diagnostic_root: String,
    pub level: DiagnosticDigestLevelV1,
    pub maximum_nodes: usize,
    pub nodes: Vec<DigestNodeV1>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatePathDiffV1 {
    pub path: StatePathV1,
    pub expected: Option<String>,
    pub actual: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnosticDiffV1 {
    pub first_mismatch: Option<StatePathV1>,
    pub mismatches: Vec<StatePathDiffV1>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum DiagnosticDigestErrorV1 {
    #[error("diagnostic digest has an invalid bound or empty identity")]
    Invalid,
    #[error("diagnostic digest tree contains duplicate or unknown paths")]
    Paths,
    #[error("diagnostic digest encoding failed: {0}")]
    Canonical(String),
}

pub fn diagnostic_digest_v1(
    path: &StatePathV1,
    local_canonical_bytes: &[u8],
    child_digests: &[(StatePathV1, String)],
) -> Result<String, DiagnosticDigestErrorV1> {
    if path.0.is_empty() || child_digests.iter().any(|(_, digest)| digest.is_empty()) {
        return Err(DiagnosticDigestErrorV1::Invalid);
    }
    let mut children = child_digests.to_vec();
    children.sort_by(|left, right| left.0.cmp(&right.0));
    if children.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        return Err(DiagnosticDigestErrorV1::Paths);
    }
    let bytes = canonical_bytes(&(
        DIAGNOSTIC_DIGEST_DOMAIN_V1,
        path,
        local_canonical_bytes,
        children,
    ))
    .map_err(|error| DiagnosticDigestErrorV1::Canonical(error.to_string()))?;
    Ok(format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()))
}

impl DiagnosticDigestTreeV1 {
    pub fn validate(&self) -> Result<(), DiagnosticDigestErrorV1> {
        if self.mechanical_digest.is_empty()
            || self.diagnostic_root.is_empty()
            || self.maximum_nodes == 0
            || self.nodes.is_empty()
            || self.nodes.len() > self.maximum_nodes
        {
            return Err(DiagnosticDigestErrorV1::Invalid);
        }
        let paths = self
            .nodes
            .iter()
            .map(|node| &node.path)
            .collect::<BTreeSet<_>>();
        if paths.len() != self.nodes.len()
            || self.nodes.iter().any(|node| {
                node.path.0.is_empty()
                    || node.digest.is_empty()
                    || node.children.iter().any(|child| !paths.contains(child))
            })
        {
            return Err(DiagnosticDigestErrorV1::Paths);
        }
        Ok(())
    }

    pub fn diff(&self, actual: &Self, maximum_mismatches: usize) -> DiagnosticDiffV1 {
        if maximum_mismatches == 0 {
            return DiagnosticDiffV1 {
                first_mismatch: None,
                mismatches: Vec::new(),
                truncated: self.diagnostic_root != actual.diagnostic_root,
            };
        }
        let expected = self.nodes.iter().map(|node| (&node.path, &node.digest));
        let actual_map = actual
            .nodes
            .iter()
            .map(|node| (&node.path, &node.digest))
            .collect::<std::collections::BTreeMap<_, _>>();
        let mut mismatches = Vec::new();
        for (path, digest) in expected {
            let other = actual_map.get(path).copied();
            if other != Some(digest) {
                mismatches.push(StatePathDiffV1 {
                    path: path.clone(),
                    expected: Some(digest.clone()),
                    actual: other.cloned(),
                });
            }
        }
        for node in &actual.nodes {
            if !self.nodes.iter().any(|expected| expected.path == node.path) {
                mismatches.push(StatePathDiffV1 {
                    path: node.path.clone(),
                    expected: None,
                    actual: Some(node.digest.clone()),
                });
            }
        }
        mismatches.sort_by(|left, right| {
            right
                .path
                .0
                .len()
                .cmp(&left.path.0.len())
                .then_with(|| left.path.cmp(&right.path))
        });
        let truncated = mismatches.len() > maximum_mismatches;
        mismatches.truncate(maximum_mismatches);
        DiagnosticDiffV1 {
            first_mismatch: mismatches.first().map(|entry| entry.path.clone()),
            mismatches,
            truncated,
        }
    }
}
