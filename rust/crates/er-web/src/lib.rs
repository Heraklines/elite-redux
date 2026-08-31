//! Browser/Wasm host for the Elite Redux Rust kernel.

pub mod contracts;
pub mod host;
pub mod production_save;

pub use contracts::*;
pub use host::*;
pub use production_save::*;

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

#[wasm_bindgen]
pub fn run_m9_production_slice(
    content_json: &str,
    starter_oracle_json: &str,
) -> Result<String, JsValue> {
    er_wasm::m9_parity::run_m9_vertical_slice_native(
        content_json.as_bytes(),
        starter_oracle_json.as_bytes(),
    )
    .map_err(|error| JsValue::from_str(&error))
}

#[derive(Debug)]
#[wasm_bindgen]
pub struct M9ProductionSliceSessionV1 {
    inner: er_wasm::m9_parity::M9VerticalSessionV1,
}

#[wasm_bindgen]
impl M9ProductionSliceSessionV1 {
    #[wasm_bindgen(constructor)]
    pub fn new(content_json: &str, starter_oracle_json: &str) -> Result<Self, JsValue> {
        let inner = er_wasm::m9_parity::M9VerticalSessionV1::new(
            content_json.as_bytes(),
            starter_oracle_json.as_bytes(),
        )
        .map_err(|error| JsValue::from_str(&error))?;
        Ok(Self { inner })
    }

    pub fn key_down(&mut self, code: &str, browser_repeat: bool) -> Result<bool, JsValue> {
        self.inner
            .key_down(code, browser_repeat)
            .map_err(|error| JsValue::from_str(&error))
    }

    pub fn key_up(&mut self, code: &str) -> Result<bool, JsValue> {
        self.inner
            .key_up(code)
            .map_err(|error| JsValue::from_str(&error))
    }

    pub fn control(&self) -> String {
        self.inner.control().to_owned()
    }

    pub fn result_json(&self) -> Result<String, JsValue> {
        self.inner
            .result_json()
            .map_err(|error| JsValue::from_str(&error))
    }
}
