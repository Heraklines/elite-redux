//! Strict adapter-owned render snapshot validation against a semantic scene.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{PresentationSceneV1, SemanticRenderSnapshotV1};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderValidationPolicyV1 {
    pub maximum_nodes: usize,
    pub maximum_extent_milli: u64,
    pub maximum_absolute_translation_milli: i64,
    pub minimum_layer: i32,
    pub maximum_layer: i32,
    pub allowed_asset_identities: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderValidationReportV1 {
    pub scene_generation: u64,
    pub renderer_identity: String,
    pub node_count: usize,
    pub visible_node_count: usize,
    pub referenced_asset_count: usize,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RenderValidationErrorV1 {
    #[error("render validation policy is invalid")]
    Policy,
    #[error("semantic scene or render graph is invalid: {0}")]
    Graph(String),
    #[error("render node references an unknown semantic source")]
    SemanticSource,
    #[error("render graph contains a parent cycle")]
    Cycle,
    #[error("render geometry, layer, or asset exceeds policy")]
    Bounds,
}

pub fn validate_render_snapshot_v1(
    scene: &PresentationSceneV1,
    snapshot: &SemanticRenderSnapshotV1,
    policy: &RenderValidationPolicyV1,
) -> Result<RenderValidationReportV1, RenderValidationErrorV1> {
    if policy.maximum_nodes == 0
        || policy.maximum_extent_milli == 0
        || policy.maximum_absolute_translation_milli < 0
        || policy.minimum_layer > policy.maximum_layer
        || policy
            .allowed_asset_identities
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
    {
        return Err(RenderValidationErrorV1::Policy);
    }
    scene
        .validate()
        .map_err(|error| RenderValidationErrorV1::Graph(error.to_string()))?;
    snapshot
        .validate()
        .map_err(|error| RenderValidationErrorV1::Graph(error.to_string()))?;
    if snapshot.scene_generation != scene.generation || snapshot.nodes.len() > policy.maximum_nodes
    {
        return Err(RenderValidationErrorV1::Bounds);
    }
    let semantic_sources = scene
        .actors
        .iter()
        .map(|actor| actor.actor_id.clone())
        .chain(scene.ui.iter().map(|node| node.node_id.clone()))
        .chain(scene.pending_events.iter().map(|event| event.id.0.clone()))
        .collect::<BTreeSet<_>>();
    if snapshot
        .nodes
        .iter()
        .any(|node| !semantic_sources.contains(&node.semantic_source))
    {
        return Err(RenderValidationErrorV1::SemanticSource);
    }
    let allowed_assets = policy
        .allowed_asset_identities
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if snapshot.nodes.iter().any(|node| {
        node.bounds.width_milli > policy.maximum_extent_milli
            || node.bounds.height_milli > policy.maximum_extent_milli
            || node.transform.x_milli.unsigned_abs()
                > policy.maximum_absolute_translation_milli as u64
            || node.transform.y_milli.unsigned_abs()
                > policy.maximum_absolute_translation_milli as u64
            || node.layer < policy.minimum_layer
            || node.layer > policy.maximum_layer
            || node
                .asset_identity
                .as_ref()
                .is_some_and(|asset| !allowed_assets.contains(asset.as_str()))
    }) {
        return Err(RenderValidationErrorV1::Bounds);
    }
    let parents = snapshot
        .nodes
        .iter()
        .map(|node| (node.id.clone(), node.parent.clone()))
        .collect::<BTreeMap<_, _>>();
    for node in &snapshot.nodes {
        let mut current = node.parent.as_ref();
        let mut seen = BTreeSet::new();
        while let Some(parent) = current {
            if !seen.insert(parent) || parent == &node.id {
                return Err(RenderValidationErrorV1::Cycle);
            }
            current = parents.get(parent).and_then(Option::as_ref);
        }
    }
    Ok(RenderValidationReportV1 {
        scene_generation: scene.generation,
        renderer_identity: snapshot.renderer_identity.clone(),
        node_count: snapshot.nodes.len(),
        visible_node_count: snapshot.nodes.iter().filter(|node| node.visible).count(),
        referenced_asset_count: snapshot
            .nodes
            .iter()
            .filter(|node| node.asset_identity.is_some())
            .count(),
    })
}
