use super::m4_abilities::selected_m4_ability_definitions;
use super::m4_moves::selected_m4_move_definitions;
use super::m4_species::selected_m4_species_definitions;
use super::{
    CapabilityManifest, ContentPack, ContentPackError, M4_ORACLE_GAME_SHA, SELECTED_SCHEMA_VERSION,
    canonical_m4_capability_entries, selected_type_chart,
};

/// Returns the exact schema-1 M4 battle ContentPack.
pub fn selected_m4_content_pack() -> Result<ContentPack, ContentPackError> {
    ContentPack::new_m4(
        selected_m4_species_definitions(),
        selected_m4_move_definitions(),
        selected_m4_ability_definitions(),
        selected_type_chart(),
        selected_m4_capability_manifest(),
    )
}

/// Returns the exact M4 capability manifest, including Body Slam 34 coverage.
pub fn selected_m4_capability_manifest() -> CapabilityManifest {
    CapabilityManifest {
        schema_version: SELECTED_SCHEMA_VERSION,
        oracle_game_sha: M4_ORACLE_GAME_SHA.to_owned(),
        entries: canonical_m4_capability_entries(),
    }
}
