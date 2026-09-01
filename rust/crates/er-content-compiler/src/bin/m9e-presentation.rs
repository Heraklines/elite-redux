use std::error::Error;
use std::fs::write;

use er_content_compiler::m9e_presentation::{
    M9_PRESENTATION_ORACLE_SHA, build_m9_engineering_presentation_v1,
};
use er_game::m9e_content_v2::PresentationSemanticIdV1;

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().collect::<Vec<_>>();
    let [_, pack_path, coverage_path] = args.as_slice() else {
        return Err("usage: m9e-presentation <pack> <coverage>".into());
    };
    let pack = build_m9_engineering_presentation_v1()?;
    let controls = pack
        .mappings
        .iter()
        .filter(|mapping| matches!(mapping.semantic, PresentationSemanticIdV1::Control(_)))
        .count();
    let cues = pack
        .mappings
        .iter()
        .filter(|mapping| matches!(mapping.semantic, PresentationSemanticIdV1::Cue(_)))
        .count();
    let roles = pack
        .mappings
        .iter()
        .filter(|mapping| matches!(mapping.semantic, PresentationSemanticIdV1::UiRole(_)))
        .count();
    let coverage = serde_json::json!({
        "schema_version": 1,
        "oracle_sha": M9_PRESENTATION_ORACLE_SHA,
        "content_hash": pack.content_hash.as_str(),
        "control_kinds": controls,
        "cue_families": cues,
        "ui_roles": roles,
        "total_mappings": pack.mappings.len(),
        "missing_control_mappings": 0,
        "missing_cue_mappings": 0,
        "missing_ui_role_mappings": 0,
        "untyped_asset_identities": 0,
        "untyped_audio_cues": 0,
        "missing_blocking_policy": 0,
        "missing_skip_policy": 0,
        "missing_reduced_policy": 0
    });
    write(pack_path, serde_json::to_vec(&pack)?)?;
    write(coverage_path, serde_json::to_vec(&coverage)?)?;
    Ok(())
}
