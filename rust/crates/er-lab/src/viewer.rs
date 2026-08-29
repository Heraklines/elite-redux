//! Deterministic terminal/HTML/SVG semantic reference rendering.

use er_render_model::{PresentationSceneV1, SemanticRenderSnapshotV1};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticReferenceV1 {
    pub terminal: String,
    pub html: String,
    pub svg: String,
    pub asset_identities: Vec<String>,
    pub deterministic_digest: String,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SemanticViewerErrorV1 {
    #[error("semantic scene/render graph or output bound is invalid")]
    Invalid,
}

pub fn build_semantic_reference_v1(
    scene: &PresentationSceneV1,
    render: Option<&SemanticRenderSnapshotV1>,
    maximum_nodes: usize,
    maximum_output_bytes: usize,
) -> Result<SemanticReferenceV1, SemanticViewerErrorV1> {
    if maximum_nodes == 0
        || maximum_output_bytes == 0
        || scene.actors.len() + scene.ui.len() + scene.pending_events.len() > maximum_nodes
        || scene.validate().is_err()
        || render.is_some_and(|snapshot| {
            snapshot.nodes.len() > maximum_nodes
                || snapshot.scene_generation != scene.generation
                || snapshot.validate().is_err()
        })
    {
        return Err(SemanticViewerErrorV1::Invalid);
    }
    let mut terminal = format!("scene generation={}\n", scene.generation);
    for actor in &scene.actors {
        terminal.push_str(&format!(
            "actor {} kind={} visible={}\n",
            actor.actor_id, actor.semantic_kind, actor.visible
        ));
    }
    for node in &scene.ui {
        terminal.push_str(&format!(
            "ui {} role={} children=[{}]\n",
            node.node_id,
            node.role,
            node.children.join(",")
        ));
    }
    for event in &scene.pending_events {
        terminal.push_str(&format!(
            "event {} cause={} cue={} blocking={:?}\n",
            event.id.0, event.cause.0, event.cue, event.blocking
        ));
    }
    let mut html = format!(
        "<!doctype html><meta charset=\"utf-8\"><main data-generation=\"{}\">",
        scene.generation
    );
    for actor in &scene.actors {
        html.push_str(&format!(
            "<section data-actor=\"{}\" data-kind=\"{}\" data-visible=\"{}\"></section>",
            escape(&actor.actor_id),
            escape(&actor.semantic_kind),
            actor.visible
        ));
    }
    for node in &scene.ui {
        html.push_str(&format!(
            "<nav data-node=\"{}\" data-role=\"{}\">{}</nav>",
            escape(&node.node_id),
            escape(&node.role),
            escape(node.label_key.as_deref().unwrap_or(""))
        ));
    }
    html.push_str("</main>");
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" data-generation=\"{}\">",
        scene.generation
    );
    let mut assets = Vec::new();
    if let Some(render) = render {
        for node in &render.nodes {
            svg.push_str(&format!(
                "<g id=\"{}\" data-source=\"{}\" transform=\"translate({} {})\"><rect width=\"{}\" height=\"{}\"/></g>",
                escape(&node.id.0),
                escape(&node.semantic_source),
                node.transform.x_milli,
                node.transform.y_milli,
                node.bounds.width_milli,
                node.bounds.height_milli
            ));
            if let Some(asset) = &node.asset_identity {
                assets.push(asset.clone());
            }
        }
    }
    svg.push_str("</svg>");
    assets.sort();
    assets.dedup();
    let size = terminal
        .len()
        .checked_add(html.len())
        .and_then(|size| size.checked_add(svg.len()))
        .ok_or(SemanticViewerErrorV1::Invalid)?;
    if size > maximum_output_bytes {
        return Err(SemanticViewerErrorV1::Invalid);
    }
    let bytes = er_canonical::canonical_bytes(&(&terminal, &html, &svg, &assets))
        .map_err(|_| SemanticViewerErrorV1::Invalid)?;
    Ok(SemanticReferenceV1 {
        terminal,
        html,
        svg,
        asset_identities: assets,
        deterministic_digest: format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()),
    })
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
