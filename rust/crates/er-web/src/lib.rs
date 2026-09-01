//! Browser/Wasm host for the Elite Redux Rust kernel.

#[cfg(feature = "legacy-browser-host")]
pub mod contracts;
pub mod contracts_v2;
#[cfg(feature = "legacy-browser-host")]
pub mod host;
pub mod host_v2;
#[cfg(feature = "legacy-save-migration")]
pub mod production_save;
#[cfg(feature = "legacy-browser-host")]
pub mod renderer_settlement;

#[cfg(feature = "legacy-browser-host")]
pub use contracts::*;
pub use contracts_v2::*;
#[cfg(feature = "legacy-browser-host")]
pub use host::*;
pub use host_v2::*;
#[cfg(feature = "legacy-save-migration")]
pub use production_save::*;
#[cfg(feature = "legacy-browser-host")]
pub use renderer_settlement::*;

#[cfg(feature = "legacy-save-migration")]
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

#[cfg(feature = "legacy-save-migration")]
#[wasm_bindgen]
pub fn restore_production_save_v2(
    content_bytes: &[u8],
    envelope_bytes: &[u8],
    template_bytes: &[u8],
) -> Result<Vec<u8>, JsValue> {
    restore_production_save_v2_native(content_bytes, envelope_bytes, template_bytes)
        .map_err(|error| JsValue::from_str(&error))
}
