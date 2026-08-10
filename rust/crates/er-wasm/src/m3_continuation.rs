//! wasm32/Node export for the shared M3 pair-continuation evidence runner.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub use er_sim::m3_continuation::*;

#[cfg_attr(
    target_arch = "wasm32",
    wasm_bindgen(js_name = replayM3ContinuationSuite)
)]
pub fn replay_continuation_suite_json(serialized_suite: &str) -> Result<String, JsError> {
    er_sim::m3_continuation::replay_suite_json(serialized_suite)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JsError(String);

#[cfg(not(target_arch = "wasm32"))]
impl JsError {
    fn new(message: &str) -> Self {
        Self(message.to_owned())
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl std::fmt::Display for JsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl std::error::Error for JsError {}
