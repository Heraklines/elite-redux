//! Deterministic renderer-side scene storage and offscreen command generation.
//!
//! This crate consumes semantic presentation data only. It has no mechanics,
//! protocol, input, wall-clock, filesystem, browser, or GPU authority.

use std::collections::{BTreeMap, BTreeSet};

use er_render_model::PresentationSceneV1;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const RENDER_SCENE_SCHEMA_V2: u32 = 2;
pub const ASSET_MANIFEST_SCHEMA_V1: u32 = 1;
pub const MAXIMUM_SCENE_OPERATIONS: usize = 4_096;

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RenderNodeIdV2(String);

impl RenderNodeIdV2 {
    pub fn new(value: impl Into<String>) -> Result<Self, RendererErrorV2> {
        let value = value.into();
        if value.is_empty()
            || value.len() > 160
            || !value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.' | b'/')
            })
        {
            return Err(RendererErrorV2::InvalidNodeId);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderRectV2 {
    pub x_milli: i64,
    pub y_milli: i64,
    pub width_milli: u64,
    pub height_milli: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderColorV2 {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
    pub alpha: u8,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssetRefV1 {
    pub logical_key: String,
    pub sha256: String,
}

impl AssetRefV1 {
    fn validate(&self) -> Result<(), RendererErrorV2> {
        if self.logical_key.is_empty()
            || self.logical_key.len() > 160
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(RendererErrorV2::InvalidAsset);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RenderPrimitiveV2 {
    Sprite {
        asset: AssetRefV1,
        source_frame: Option<String>,
    },
    Panel {
        color: RenderColorV2,
        border_milli: u32,
    },
    Text {
        text_key: String,
        color: RenderColorV2,
        font_asset: AssetRefV1,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderNodeV2 {
    pub id: RenderNodeIdV2,
    pub parent: Option<RenderNodeIdV2>,
    pub z_index: i32,
    pub visible: bool,
    pub bounds: RenderRectV2,
    pub primitive: RenderPrimitiveV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderSceneV2 {
    pub schema_version: u32,
    pub generation: u64,
    pub nodes: BTreeMap<RenderNodeIdV2, RenderNodeV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RenderSceneDeltaOperationV2 {
    Upsert { node: RenderNodeV2 },
    Remove { node_id: RenderNodeIdV2 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderSceneDeltaV2 {
    pub schema_version: u32,
    pub from_generation: u64,
    pub to_generation: u64,
    pub operations: Vec<RenderSceneDeltaOperationV2>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SemanticSceneStoreV2 {
    scene: RenderSceneV2,
}

impl SemanticSceneStoreV2 {
    pub fn new(scene: RenderSceneV2) -> Result<Self, RendererErrorV2> {
        validate_scene(&scene)?;
        Ok(Self { scene })
    }

    pub fn scene(&self) -> &RenderSceneV2 {
        &self.scene
    }

    pub fn apply(&mut self, delta: &RenderSceneDeltaV2) -> Result<(), RendererErrorV2> {
        if delta.schema_version != RENDER_SCENE_SCHEMA_V2
            || delta.from_generation != self.scene.generation
            || delta.to_generation
                != delta
                    .from_generation
                    .checked_add(1)
                    .ok_or(RendererErrorV2::Generation)?
            || delta.operations.len() > MAXIMUM_SCENE_OPERATIONS
        {
            return Err(RendererErrorV2::Generation);
        }
        let mut candidate = self.scene.clone();
        candidate.generation = delta.to_generation;
        for operation in &delta.operations {
            match operation {
                RenderSceneDeltaOperationV2::Upsert { node } => {
                    candidate.nodes.insert(node.id.clone(), node.clone());
                }
                RenderSceneDeltaOperationV2::Remove { node_id } => {
                    if candidate.nodes.remove(node_id).is_none() {
                        return Err(RendererErrorV2::UnknownNode);
                    }
                }
            }
        }
        validate_scene(&candidate)?;
        self.scene = candidate;
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OffscreenDrawCommandV1 {
    Sprite {
        node_id: RenderNodeIdV2,
        bounds: RenderRectV2,
        asset: AssetRefV1,
        source_frame: Option<String>,
    },
    Panel {
        node_id: RenderNodeIdV2,
        bounds: RenderRectV2,
        color: RenderColorV2,
        border_milli: u32,
    },
    Text {
        node_id: RenderNodeIdV2,
        bounds: RenderRectV2,
        text_key: String,
        color: RenderColorV2,
        font_asset: AssetRefV1,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OffscreenFrameV1 {
    pub scene_generation: u64,
    pub commands: Vec<OffscreenDrawCommandV1>,
    pub command_digest_sha256: String,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct OffscreenRendererV1;

impl OffscreenRendererV1 {
    pub fn render(self, scene: &RenderSceneV2) -> Result<OffscreenFrameV1, RendererErrorV2> {
        validate_scene(scene)?;
        let mut nodes = scene
            .nodes
            .values()
            .filter(|node| node.visible)
            .collect::<Vec<_>>();
        nodes.sort_by(|left, right| {
            left.z_index
                .cmp(&right.z_index)
                .then_with(|| left.id.cmp(&right.id))
        });
        let commands = nodes
            .into_iter()
            .map(|node| match &node.primitive {
                RenderPrimitiveV2::Sprite {
                    asset,
                    source_frame,
                } => OffscreenDrawCommandV1::Sprite {
                    node_id: node.id.clone(),
                    bounds: node.bounds,
                    asset: asset.clone(),
                    source_frame: source_frame.clone(),
                },
                RenderPrimitiveV2::Panel {
                    color,
                    border_milli,
                } => OffscreenDrawCommandV1::Panel {
                    node_id: node.id.clone(),
                    bounds: node.bounds,
                    color: *color,
                    border_milli: *border_milli,
                },
                RenderPrimitiveV2::Text {
                    text_key,
                    color,
                    font_asset,
                } => OffscreenDrawCommandV1::Text {
                    node_id: node.id.clone(),
                    bounds: node.bounds,
                    text_key: text_key.clone(),
                    color: *color,
                    font_asset: font_asset.clone(),
                },
            })
            .collect::<Vec<_>>();
        let encoded = serde_json::to_vec(&commands).map_err(|_| RendererErrorV2::Encoding)?;
        let digest = Sha256::digest(encoded);
        Ok(OffscreenFrameV1 {
            scene_generation: scene.generation,
            commands,
            command_digest_sha256: hex(&digest),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RenderSceneGenerationV1(u64);

impl RenderSceneGenerationV1 {
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RendererGenerationIdentityV1(String);

impl RendererGenerationIdentityV1 {
    pub fn new(value: impl Into<String>) -> Result<Self, RendererErrorV2> {
        let value = value.into();
        if value.is_empty()
            || value.len() > 128
            || !value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.')
            })
        {
            return Err(RendererErrorV2::Generation);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationEventIdV1 {
    pub operation_id: String,
    pub sequence: u64,
}

impl PresentationEventIdV1 {
    pub fn new(operation_id: impl Into<String>, sequence: u64) -> Result<Self, RendererErrorV2> {
        let operation_id = operation_id.into();
        if operation_id.is_empty()
            || operation_id.len() > 256
            || !operation_id.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.' | b'/')
            })
        {
            return Err(RendererErrorV2::PresentationFence);
        }
        Ok(Self {
            operation_id,
            sequence,
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationOutcomeV2 {
    Settled,
    IntentionallySkipped,
    Failed { reason: String },
}

impl PresentationOutcomeV2 {
    fn validate(&self) -> Result<(), RendererErrorV2> {
        if matches!(self, Self::Failed { reason } if reason.is_empty() || reason.len() > 512) {
            return Err(RendererErrorV2::InvalidSettlement);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RendererPresentationSettlementV1 {
    pub event_id: PresentationEventIdV1,
    pub scene_generation: RenderSceneGenerationV1,
    pub renderer_generation: RendererGenerationIdentityV1,
    pub outcome: PresentationOutcomeV2,
}

impl RendererPresentationSettlementV1 {
    pub fn validate(&self) -> Result<(), RendererErrorV2> {
        self.outcome.validate()?;
        PresentationEventIdV1::new(self.event_id.operation_id.clone(), self.event_id.sequence)?;
        RendererGenerationIdentityV1::new(self.renderer_generation.as_str())?;
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PresentationGenerationFenceV1 {
    scene_generation: RenderSceneGenerationV1,
    renderer_generation: RendererGenerationIdentityV1,
    pending: BTreeSet<PresentationEventIdV1>,
}

impl PresentationGenerationFenceV1 {
    pub fn new(
        scene_generation: RenderSceneGenerationV1,
        renderer_generation: RendererGenerationIdentityV1,
    ) -> Self {
        Self {
            scene_generation,
            renderer_generation,
            pending: BTreeSet::new(),
        }
    }

    pub fn begin(
        &mut self,
        scene_generation: RenderSceneGenerationV1,
        event_id: PresentationEventIdV1,
    ) -> Result<(), RendererErrorV2> {
        if scene_generation != self.scene_generation || !self.pending.insert(event_id) {
            return Err(RendererErrorV2::PresentationFence);
        }
        Ok(())
    }

    pub fn settle(
        &mut self,
        scene_generation: RenderSceneGenerationV1,
        renderer_generation: &RendererGenerationIdentityV1,
        event_id: PresentationEventIdV1,
        outcome: PresentationOutcomeV2,
    ) -> Result<RendererPresentationSettlementV1, RendererErrorV2> {
        outcome.validate()?;
        if scene_generation != self.scene_generation
            || renderer_generation != &self.renderer_generation
            || !self.pending.remove(&event_id)
        {
            return Err(RendererErrorV2::PresentationFence);
        }
        let settlement = RendererPresentationSettlementV1 {
            event_id,
            scene_generation,
            renderer_generation: renderer_generation.clone(),
            outcome,
        };
        settlement.validate()?;
        Ok(settlement)
    }

    pub fn advance(
        &mut self,
        next_generation: RenderSceneGenerationV1,
    ) -> Result<(), RendererErrorV2> {
        if !self.pending.is_empty()
            || next_generation.get()
                != self
                    .scene_generation
                    .get()
                    .checked_add(1)
                    .ok_or(RendererErrorV2::Generation)?
        {
            return Err(RendererErrorV2::PresentationFence);
        }
        self.scene_generation = next_generation;
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RendererErrorV2 {
    #[error("render node identity is invalid")]
    InvalidNodeId,
    #[error("render asset identity is invalid")]
    InvalidAsset,
    #[error("render scene generation is invalid")]
    Generation,
    #[error("render scene references an unknown node")]
    UnknownNode,
    #[error("render scene hierarchy contains a cycle")]
    HierarchyCycle,
    #[error("render command encoding failed")]
    Encoding,
    #[error("presentation generation fence rejected the operation")]
    PresentationFence,
    #[error("presentation settlement outcome is invalid")]
    InvalidSettlement,
}

pub fn scene_generation_from_presentation_v1(scene: &PresentationSceneV1) -> u64 {
    scene.generation
}

fn validate_scene(scene: &RenderSceneV2) -> Result<(), RendererErrorV2> {
    if scene.schema_version != RENDER_SCENE_SCHEMA_V2 {
        return Err(RendererErrorV2::Generation);
    }
    for (id, node) in &scene.nodes {
        if id != &node.id || node.bounds.width_milli == 0 || node.bounds.height_milli == 0 {
            return Err(RendererErrorV2::InvalidNodeId);
        }
        match &node.primitive {
            RenderPrimitiveV2::Sprite { asset, .. } => asset.validate()?,
            RenderPrimitiveV2::Text {
                font_asset,
                text_key,
                ..
            } => {
                font_asset.validate()?;
                if text_key.is_empty() || text_key.len() > 256 {
                    return Err(RendererErrorV2::InvalidAsset);
                }
            }
            RenderPrimitiveV2::Panel { .. } => {}
        }
        if let Some(parent) = &node.parent
            && (parent == id || !scene.nodes.contains_key(parent))
        {
            return Err(RendererErrorV2::UnknownNode);
        }
        let mut visited = BTreeSet::new();
        let mut cursor = node.parent.as_ref();
        while let Some(parent) = cursor {
            if !visited.insert(parent) {
                return Err(RendererErrorV2::HierarchyCycle);
            }
            cursor = scene
                .nodes
                .get(parent)
                .and_then(|ancestor| ancestor.parent.as_ref());
        }
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from(DIGITS[usize::from(byte >> 4)]));
        output.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(key: &str, digit: char) -> AssetRefV1 {
        AssetRefV1 {
            logical_key: key.to_owned(),
            sha256: std::iter::repeat_n(digit, 64).collect(),
        }
    }

    fn node(id: &str, z_index: i32, primitive: RenderPrimitiveV2) -> RenderNodeV2 {
        RenderNodeV2 {
            id: RenderNodeIdV2::new(id).expect("test node id is valid"),
            parent: None,
            z_index,
            visible: true,
            bounds: RenderRectV2 {
                x_milli: 0,
                y_milli: 0,
                width_milli: 1_000,
                height_milli: 1_000,
            },
            primitive,
        }
    }

    fn scene() -> RenderSceneV2 {
        let background = node(
            "panel:root",
            0,
            RenderPrimitiveV2::Panel {
                color: RenderColorV2 {
                    red: 1,
                    green: 2,
                    blue: 3,
                    alpha: 255,
                },
                border_milli: 0,
            },
        );
        RenderSceneV2 {
            schema_version: RENDER_SCENE_SCHEMA_V2,
            generation: 1,
            nodes: BTreeMap::from([(background.id.clone(), background)]),
        }
    }

    #[test]
    fn delta_application_is_atomic() {
        let mut store = SemanticSceneStoreV2::new(scene()).expect("scene is valid");
        let before = store.scene().clone();
        let missing_parent = RenderNodeIdV2::new("missing").expect("id is valid");
        let mut child = node(
            "sprite:actor",
            1,
            RenderPrimitiveV2::Sprite {
                asset: asset("actor:pikachu", 'a'),
                source_frame: None,
            },
        );
        child.parent = Some(missing_parent);
        let result = store.apply(&RenderSceneDeltaV2 {
            schema_version: RENDER_SCENE_SCHEMA_V2,
            from_generation: 1,
            to_generation: 2,
            operations: vec![RenderSceneDeltaOperationV2::Upsert { node: child }],
        });
        assert_eq!(result, Err(RendererErrorV2::UnknownNode));
        assert_eq!(store.scene(), &before);
    }

    #[test]
    fn offscreen_commands_are_stable_and_z_ordered() {
        let mut scene = scene();
        let text = node(
            "text:message",
            5,
            RenderPrimitiveV2::Text {
                text_key: "battle.move.used".to_owned(),
                color: RenderColorV2 {
                    red: 255,
                    green: 255,
                    blue: 255,
                    alpha: 255,
                },
                font_asset: asset("font:main", 'b'),
            },
        );
        scene.nodes.insert(text.id.clone(), text);
        let first = OffscreenRendererV1.render(&scene).expect("render succeeds");
        let second = OffscreenRendererV1.render(&scene).expect("render succeeds");
        assert_eq!(first, second);
        assert_eq!(first.commands.len(), 2);
        assert!(matches!(
            first.commands[0],
            OffscreenDrawCommandV1::Panel { .. }
        ));
        assert!(matches!(
            first.commands[1],
            OffscreenDrawCommandV1::Text { .. }
        ));
    }

    #[test]
    fn presentation_fence_rejects_stale_settlement() {
        let scene = RenderSceneGenerationV1::new(7);
        let renderer =
            RendererGenerationIdentityV1::new("renderer:1").expect("renderer identity is valid");
        let event =
            PresentationEventIdV1::new("battle/1/wave/1/turn/1/result", 1).expect("event is valid");
        let mut fence = PresentationGenerationFenceV1::new(scene, renderer.clone());
        fence.begin(scene, event.clone()).expect("begin succeeds");
        assert_eq!(
            fence.settle(
                RenderSceneGenerationV1::new(6),
                &renderer,
                event.clone(),
                PresentationOutcomeV2::Settled,
            ),
            Err(RendererErrorV2::PresentationFence)
        );
        fence
            .settle(scene, &renderer, event, PresentationOutcomeV2::Settled)
            .expect("settlement succeeds");
        fence
            .advance(RenderSceneGenerationV1::new(8))
            .expect("advance succeeds");
    }
    #[test]
    fn generation_fence_emits_renderer_owned_settlement() {
        let scene = RenderSceneGenerationV1::new(9);
        let renderer =
            RendererGenerationIdentityV1::new("renderer:primary").expect("identity is valid");
        let event = PresentationEventIdV1::new("battle/1/wave/1/turn/1/result", 3)
            .expect("event identity is valid");
        let mut fence = PresentationGenerationFenceV1::new(scene, renderer.clone());
        fence
            .begin(scene, event.clone())
            .expect("presentation event begins");

        let settlement = fence
            .settle(
                scene,
                &renderer,
                event.clone(),
                PresentationOutcomeV2::Settled,
            )
            .expect("current generation settles");
        assert_eq!(
            settlement,
            RendererPresentationSettlementV1 {
                event_id: event,
                scene_generation: scene,
                renderer_generation: renderer,
                outcome: PresentationOutcomeV2::Settled,
            }
        );
    }
}
