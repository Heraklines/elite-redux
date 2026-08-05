//! Wasm JSON boundary for native/schema/trace parity tests.

use er_canonical::{canonicalize_value, fixture_digest};
use er_types::KernelTrace;
use serde_json::Value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn canonicalize_json(input: &str) -> Result<String, JsValue> {
    let value: Value = serde_json::from_str(input).map_err(js_error)?;
    canonicalize_value(&value).map_err(js_error)
}

#[wasm_bindgen]
pub fn compatible_digest_json(input: &str) -> Result<String, JsValue> {
    let value: Value = serde_json::from_str(input).map_err(js_error)?;
    fixture_digest(&value).map_err(js_error)
}

#[wasm_bindgen]
pub fn round_trip_kernel_trace(input: &str) -> Result<String, JsValue> {
    let trace: KernelTrace = serde_json::from_str(input).map_err(js_error)?;
    er_canonical::canonicalize(&trace).map_err(js_error)
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
