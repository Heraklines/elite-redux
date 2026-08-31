//! Browser/Wasm host for the Elite Redux Rust kernel.

pub mod contracts;
pub mod host;
pub mod production_save;
pub mod renderer_settlement;

pub use contracts::*;
pub use host::*;
pub use production_save::*;
pub use renderer_settlement::*;

use wasm_bindgen::prelude::*;

#[cfg(feature = "legacy-save-migration")]
#[cfg_attr(feature = "legacy-save-migration", wasm_bindgen)]
pub fn migrate_production_save_v2(
    content_bytes: &[u8],
    legacy_bytes: &[u8],
    template_bytes: &[u8],
    metadata_bytes: &[u8],
) -> Result<Vec<u8>, JsValue> {
    migrate_production_save_v2_native(content_bytes, legacy_bytes, template_bytes, metadata_bytes)
        .map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn restore_production_save_v2(
    content_bytes: &[u8],
    envelope_bytes: &[u8],
    template_bytes: &[u8],
) -> Result<Vec<u8>, JsValue> {
    restore_production_save_v2_native(content_bytes, envelope_bytes, template_bytes)
        .map_err(|error| JsValue::from_str(&error))
}
