//! Deterministic causal identities and bounded evidence graphs.

use std::collections::BTreeSet;

use er_canonical::canonical_bytes;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const CAUSAL_ID_DOMAIN_V1: &str = "elite-redux/m71/causal-id/v1";

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CausalId(pub String);

macro_rules! causal_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub CausalId);
    };
}

causal_id!(ExternalEventId);
causal_id!(InternalEventId);
causal_id!(TransitionId);
causal_id!(QueryEvidenceId);
causal_id!(RngDrawId);
causal_id!(MutationId);
causal_id!(MaterialId);
causal_id!(PresentationEvidenceId);
causal_id!(ControlInstallationId);
causal_id!(TimerCreationId);
causal_id!(NetworkFrameId);
causal_id!(StorageRequestId);
causal_id!(ModelRequestId);
causal_id!(RenderNodeId);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CausalAddressV1 {
    pub session_root: String,
    pub external_sequence: u64,
    pub operation_or_material: String,
    pub evidence_kind: CausalNodeKindV1,
    pub ordinal_path: Vec<u32>,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CausalNodeKindV1 {
    ExternalEvent,
    InternalEvent,
    Query,
    RngDraw,
    Mutation,
    Material,
    ControlInstallation,
    Presentation,
    Timer,
    NetworkFrame,
    Storage,
    ModelRequest,
    ModelResponse,
    Terminal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CausalEdgeKindV1 {
    Caused,
    Derived,
    Scheduled,
    Applied,
    Presented,
    Installed,
    Transmitted,
    Settled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum CausalSourceV1 {
    Mechanics {
        behavior_unit: String,
        program: String,
        hook: String,
        operation_ordinal: u16,
    },
    RunProgram {
        behavior: String,
        program: String,
        operation_ordinal: u16,
    },
    CoreRule {
        rule: String,
    },
    AuthorityMaterial {
        operation: String,
        revision: u64,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CausalNodeV1 {
    pub id: CausalId,
    pub node_kind: CausalNodeKindV1,
    pub source: Option<CausalSourceV1>,
    pub summary: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CausalEdgeV1 {
    pub from: CausalId,
    pub to: CausalId,
    pub edge_kind: CausalEdgeKindV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CausalGraphV1 {
    pub maximum_nodes: usize,
    pub maximum_edges: usize,
    pub nodes: Vec<CausalNodeV1>,
    pub edges: Vec<CausalEdgeV1>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CausalGraphErrorV1 {
    #[error("causal identity address is empty or malformed")]
    Address,
    #[error("causal graph has invalid bounds")]
    Bounds,
    #[error("causal graph contains duplicate identities")]
    Duplicate,
    #[error("causal graph contains a dangling edge")]
    Dangling,
    #[error("causal identity canonical encoding failed: {0}")]
    Canonical(String),
}

impl CausalId {
    pub fn derive(address: &CausalAddressV1) -> Result<Self, CausalGraphErrorV1> {
        if address.session_root.is_empty()
            || address.operation_or_material.is_empty()
            || address.ordinal_path.is_empty()
        {
            return Err(CausalGraphErrorV1::Address);
        }
        let bytes = canonical_bytes(&(CAUSAL_ID_DOMAIN_V1, address))
            .map_err(|error| CausalGraphErrorV1::Canonical(error.to_string()))?;
        Ok(Self(blake3::hash(&bytes).to_hex().to_string()))
    }
}

impl CausalGraphV1 {
    pub fn validate(&self) -> Result<(), CausalGraphErrorV1> {
        if self.maximum_nodes == 0
            || self.maximum_edges == 0
            || self.nodes.len() > self.maximum_nodes
            || self.edges.len() > self.maximum_edges
        {
            return Err(CausalGraphErrorV1::Bounds);
        }
        let ids = self
            .nodes
            .iter()
            .map(|node| &node.id)
            .collect::<BTreeSet<_>>();
        if ids.len() != self.nodes.len() || self.nodes.iter().any(|node| node.summary.is_empty()) {
            return Err(CausalGraphErrorV1::Duplicate);
        }
        if self
            .edges
            .iter()
            .any(|edge| !ids.contains(&edge.from) || !ids.contains(&edge.to))
        {
            return Err(CausalGraphErrorV1::Dangling);
        }
        Ok(())
    }
}
