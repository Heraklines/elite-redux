//! Native/Wasm-identical M7 content, state, and material boundary.

use std::sync::Arc;

use er_canonical::canonicalize;
use er_game::m7_content::{GameContentBundleV1, PreparedGameContentV1};
use er_game::m7_material::MaterialApplyResultV5;
use er_game::m7_runtime::GameRuntimeV5;
use er_kernel::snapshot_v6::{KernelTraceV6, RestorableKernelSnapshotV6};
use er_state::m7_state::GameStateV5;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialBoundaryRequestV1 {
    pub bundle: GameContentBundleV1,
    pub before: GameStateV5,
    pub material_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialBoundaryResponseV1 {
    pub result: MaterialBoundaryResultV1,
    pub after: GameStateV5,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MaterialBoundaryResultV1 {
    Applied,
    Duplicate,
}

pub fn apply_material_boundary_native(
    request: MaterialBoundaryRequestV1,
) -> Result<MaterialBoundaryResponseV1, String> {
    let content = Arc::new(
        PreparedGameContentV1::prepare(Arc::new(request.bundle))
            .map_err(|error| error.to_string())?,
    );
    let mut runtime =
        GameRuntimeV5::new(request.before, content).map_err(|error| error.to_string())?;
    let result = runtime
        .apply_material_bytes(&request.material_bytes)
        .map_err(|error| error.to_string())?;
    Ok(MaterialBoundaryResponseV1 {
        result: match result {
            MaterialApplyResultV5::Applied => MaterialBoundaryResultV1::Applied,
            MaterialApplyResultV5::Duplicate => MaterialBoundaryResultV1::Duplicate,
        },
        after: runtime.state().clone(),
    })
}

#[wasm_bindgen]
pub fn apply_m7_material_json(input: &str) -> Result<String, JsValue> {
    let request: MaterialBoundaryRequestV1 = serde_json::from_str(input).map_err(js_error)?;
    let response = apply_material_boundary_native(request).map_err(js_error)?;
    canonicalize(&response).map_err(js_error)
}

#[wasm_bindgen]
pub fn round_trip_m7_snapshot_json(input: &str) -> Result<String, JsValue> {
    let snapshot: RestorableKernelSnapshotV6 = serde_json::from_str(input).map_err(js_error)?;
    snapshot.validate().map_err(js_error)?;
    canonicalize(&snapshot).map_err(js_error)
}

#[wasm_bindgen]
pub fn round_trip_m7_trace_json(input: &str) -> Result<String, JsValue> {
    let trace: KernelTraceV6 = serde_json::from_str(input).map_err(js_error)?;
    trace.validate().map_err(js_error)?;
    canonicalize(&trace).map_err(js_error)
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
