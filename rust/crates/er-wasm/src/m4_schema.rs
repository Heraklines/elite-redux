//! M4 Wasm schema surface: canonical JSON round-trip for the V2 game state,
//! V3 trace roots, and run materials. Native and Wasm share these exact
//! production types; parity is asserted by `tests/m4_parity.rs`.

use er_state::game_v2::GameStateV2;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WasmSchemaError {
    #[error("canonical JSON serialization failed: {0}")]
    Serialize(#[from] serde_json::Error),
    #[error("decoded payload does not match its canonical re-encoding")]
    NonCanonical,
}

/// Serializes one validated V2 game state to canonical JSON bytes.
///
/// Canonical JSON sorts object keys, preserves array order, normalizes finite
/// numbers, and emits one trailing newline — the exact wire shape consumed by
/// the browser adapter.
pub fn encode_game_state(state: &GameStateV2) -> Result<Vec<u8>, WasmSchemaError> {
    state.validate().map_err(serde_json::Error::custom)?;
    let mut output = String::new();
    er_canonical::serialize_canonical(state, &mut output)?;
    output.push('\n');
    Ok(output.into_bytes())
}

/// Deserializes a V2 game state and rejects non-canonical input by requiring
/// the decoded value to re-encode to identical bytes.
pub fn decode_game_state(bytes: &[u8]) -> Result<GameStateV2, WasmSchemaError> {
    let state: GameStateV2 = serde_json::from_slice(bytes)?;
    let reencoded = encode_game_state(&state)?;
    if reencoded.as_slice() != bytes {
        return Err(WasmSchemaError::NonCanonical);
    }
    Ok(state)
}

/// The typed envelope the browser adapter receives per run-material commit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunMaterialEnvelope {
    /// Canonical material bytes (base64 is applied at the JS boundary).
    pub material_hex: String,
    /// The mechanical after-digest as a decimal-safe hex string.
    pub after_digest: String,
}
