//! Semantic presentation and adapter-owned render diagnostics for M7.1.

pub mod scene;
pub mod validate;

pub use scene::*;
pub use validate::*;

use std::collections::BTreeSet;

use er_dev_types::{CausalAddressV1, CausalId, CausalNodeKindV1};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const PRESENTATION_SCENE_VERSION_V1: u32 = 1;
pub const RENDER_TRACE_VERSION_V1: u32 = 1;
pub const PLATFORM_TRACE_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationBlockingPolicyV1 {
    NonBlocking,
    BlocksHumanInput,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationActorV1 {
    pub actor_id: String,
    pub semantic_kind: String,
    pub visible: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticUiNodeV1 {
    pub node_id: String,
    pub role: String,
    pub label_key: Option<String>,
    pub children: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationEventEnvelopeV1 {
    pub id: CausalId,
    pub cause: CausalId,
    pub cue: String,
    pub blocking: PresentationBlockingPolicyV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationSceneV1 {
    pub generation: u64,
    pub actors: Vec<PresentationActorV1>,
    pub ui: Vec<SemanticUiNodeV1>,
    pub pending_events: Vec<PresentationEventEnvelopeV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderTransformV1 {
    pub x_milli: i64,
    pub y_milli: i64,
    pub scale_x_milli: i64,
    pub scale_y_milli: i64,
    pub rotation_milliradians: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderBoundsV1 {
    pub width_milli: u64,
    pub height_milli: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticRenderNodeV1 {
    pub id: CausalId,
    pub semantic_source: String,
    pub parent: Option<CausalId>,
    pub asset_identity: Option<String>,
    pub transform: RenderTransformV1,
    pub bounds: RenderBoundsV1,
    pub layer: i32,
    pub visible: bool,
    pub animation_state: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticRenderSnapshotV1 {
    pub scene_generation: u64,
    pub renderer_identity: String,
    pub nodes: Vec<SemanticRenderNodeV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlatformTraceEventV1 {
    pub sequence: u64,
    pub event_kind: String,
    pub payload: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlatformTraceV1 {
    pub platform_identity: String,
    pub events: Vec<PlatformTraceEventV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderTraceV1 {
    pub renderer_identity: String,
    pub snapshots: Vec<SemanticRenderSnapshotV1>,
    pub asset_events: Vec<Vec<u8>>,
    pub animation_events: Vec<Vec<u8>>,
    pub frame_metrics: Vec<Vec<u8>>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RenderModelErrorV1 {
    #[error("semantic render identity or source is empty")]
    Identity,
    #[error("semantic render graph contains duplicate or unknown nodes")]
    Graph,
    #[error("platform/render trace sequence is not strictly increasing")]
    Sequence,
    #[error("render causal identity failed: {0}")]
    Causal(String),
}

pub fn derive_render_node_id_v1(
    session_root: &str,
    external_sequence: u64,
    semantic_source: &str,
    ordinal_path: Vec<u32>,
) -> Result<CausalId, RenderModelErrorV1> {
    CausalId::derive(&CausalAddressV1 {
        session_root: session_root.to_owned(),
        external_sequence,
        operation_or_material: semantic_source.to_owned(),
        evidence_kind: CausalNodeKindV1::Presentation,
        ordinal_path,
    })
    .map_err(|error| RenderModelErrorV1::Causal(error.to_string()))
}

impl PresentationSceneV1 {
    pub fn validate(&self) -> Result<(), RenderModelErrorV1> {
        let actors = self
            .actors
            .iter()
            .map(|actor| &actor.actor_id)
            .collect::<BTreeSet<_>>();
        let ui = self
            .ui
            .iter()
            .map(|node| &node.node_id)
            .collect::<BTreeSet<_>>();
        if actors.len() != self.actors.len()
            || ui.len() != self.ui.len()
            || self
                .actors
                .iter()
                .any(|actor| actor.actor_id.is_empty() || actor.semantic_kind.is_empty())
            || self.ui.iter().any(|node| {
                node.node_id.is_empty()
                    || node.role.is_empty()
                    || node.children.iter().any(|child| !ui.contains(child))
            })
            || self.pending_events.iter().any(|event| event.cue.is_empty())
        {
            return Err(RenderModelErrorV1::Identity);
        }
        Ok(())
    }
}

impl SemanticRenderSnapshotV1 {
    pub fn validate(&self) -> Result<(), RenderModelErrorV1> {
        if self.renderer_identity.is_empty() {
            return Err(RenderModelErrorV1::Identity);
        }
        let ids = self
            .nodes
            .iter()
            .map(|node| &node.id)
            .collect::<BTreeSet<_>>();
        if ids.len() != self.nodes.len()
            || self.nodes.iter().any(|node| {
                node.semantic_source.is_empty()
                    || node
                        .parent
                        .as_ref()
                        .is_some_and(|parent| !ids.contains(parent))
            })
        {
            return Err(RenderModelErrorV1::Graph);
        }
        Ok(())
    }
}
