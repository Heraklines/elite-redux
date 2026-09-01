use std::error::Error;

use er_content_compiler::m9e_presentation::build_m9_engineering_presentation_v1;
use er_game::m9e_content_v2::PresentationSemanticIdV1;

const PACK: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/engineering/presentation-content-pack-v1.json"
));

#[test]
fn every_closed_presentation_semantic_has_one_typed_mapping() -> Result<(), Box<dyn Error>> {
    let first = build_m9_engineering_presentation_v1()?;
    let second = build_m9_engineering_presentation_v1()?;
    assert_eq!(first, second);
    assert_eq!(serde_json::to_vec(&first)?, PACK);
    assert_eq!(first.mappings.len(), 55);
    assert_eq!(
        first
            .mappings
            .iter()
            .filter(|mapping| matches!(mapping.semantic, PresentationSemanticIdV1::Control(_)))
            .count(),
        24
    );
    assert_eq!(
        first
            .mappings
            .iter()
            .filter(|mapping| matches!(mapping.semantic, PresentationSemanticIdV1::Cue(_)))
            .count(),
        20
    );
    assert_eq!(
        first
            .mappings
            .iter()
            .filter(|mapping| matches!(mapping.semantic, PresentationSemanticIdV1::UiRole(_)))
            .count(),
        11
    );
    Ok(())
}
