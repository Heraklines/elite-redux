//! Semantic presentation and adapter-owned render diagnostics for M7.1.

use serde::{Deserialize, Serialize};

pub const PRESENTATION_SCENE_VERSION_V1: u32 = 1;
pub const RENDER_TRACE_VERSION_V1: u32 = 1;
pub const PLATFORM_TRACE_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationSceneV1 {
    pub generation: u64,
    pub actor_ids: Vec<String>,
    pub ui_node_ids: Vec<String>,
    pub pending_event_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticRenderSnapshotV1 {
    pub scene_generation: u64,
    pub renderer_identity: String,
    pub node_ids: Vec<String>,
}
