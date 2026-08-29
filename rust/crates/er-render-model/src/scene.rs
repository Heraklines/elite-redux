//! Deterministic construction of kernel-owned semantic presentation scenes.

use std::collections::BTreeSet;

use er_dev_types::{CausalAddressV1, CausalId, CausalNodeKindV1};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    PresentationActorV1, PresentationBlockingPolicyV1, PresentationEventEnvelopeV1,
    PresentationSceneV1, SemanticUiNodeV1,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationCueV1 {
    pub cause: CausalId,
    pub cue: String,
    pub blocking: PresentationBlockingPolicyV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PresentationSceneBuilderV1 {
    pub maximum_actors: usize,
    pub maximum_ui_nodes: usize,
    pub maximum_pending_events: usize,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PresentationSceneBuildErrorV1 {
    #[error("presentation scene bound is zero or exceeded")]
    Bounds,
    #[error("presentation scene contains an empty or duplicate identity")]
    Identity,
    #[error("presentation UI references an unknown child")]
    Ui,
    #[error("presentation event identity failed: {0}")]
    Causal(String),
}

impl PresentationSceneBuilderV1 {
    pub fn build(
        self,
        session_root: &str,
        generation: u64,
        mut actors: Vec<PresentationActorV1>,
        mut ui: Vec<SemanticUiNodeV1>,
        cues: Vec<PresentationCueV1>,
    ) -> Result<PresentationSceneV1, PresentationSceneBuildErrorV1> {
        if session_root.is_empty()
            || self.maximum_actors == 0
            || self.maximum_ui_nodes == 0
            || self.maximum_pending_events == 0
            || actors.len() > self.maximum_actors
            || ui.len() > self.maximum_ui_nodes
            || cues.len() > self.maximum_pending_events
        {
            return Err(PresentationSceneBuildErrorV1::Bounds);
        }
        actors.sort_by(|left, right| left.actor_id.cmp(&right.actor_id));
        ui.sort_by(|left, right| left.node_id.cmp(&right.node_id));
        if actors
            .iter()
            .any(|actor| actor.actor_id.is_empty() || actor.semantic_kind.is_empty())
            || actors
                .windows(2)
                .any(|pair| pair[0].actor_id == pair[1].actor_id)
            || ui
                .iter()
                .any(|node| node.node_id.is_empty() || node.role.is_empty())
            || ui.windows(2).any(|pair| pair[0].node_id == pair[1].node_id)
        {
            return Err(PresentationSceneBuildErrorV1::Identity);
        }
        let ui_ids = ui
            .iter()
            .map(|node| node.node_id.as_str())
            .collect::<BTreeSet<_>>();
        if ui.iter().any(|node| {
            node.children
                .iter()
                .any(|child| !ui_ids.contains(child.as_str()))
                || node.children.windows(2).any(|pair| pair[0] >= pair[1])
        }) {
            return Err(PresentationSceneBuildErrorV1::Ui);
        }
        let mut pending_events = Vec::with_capacity(cues.len());
        for (ordinal, cue) in cues.into_iter().enumerate() {
            if cue.cue.is_empty() || cue.cause.0.is_empty() {
                return Err(PresentationSceneBuildErrorV1::Identity);
            }
            let id = CausalId::derive(&CausalAddressV1 {
                session_root: session_root.to_owned(),
                external_sequence: generation,
                evidence_kind: CausalNodeKindV1::Presentation,
                operation_or_material: cue.cause.0.clone(),
                ordinal_path: vec![
                    u32::try_from(ordinal).map_err(|_| PresentationSceneBuildErrorV1::Bounds)?,
                ],
            })
            .map_err(|error| PresentationSceneBuildErrorV1::Causal(error.to_string()))?;
            pending_events.push(PresentationEventEnvelopeV1 {
                id,
                cause: cue.cause,
                cue: cue.cue,
                blocking: cue.blocking,
            });
        }
        let scene = PresentationSceneV1 {
            generation,
            actors,
            ui,
            pending_events,
        };
        scene
            .validate()
            .map_err(|_| PresentationSceneBuildErrorV1::Identity)?;
        Ok(scene)
    }
}
