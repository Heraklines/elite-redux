//! Canonical JSON and digest primitives shared by native and Wasm kernels.

use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const FIXTURE_DIGEST_KIND: &str = "sha256-stable-json-v1";
pub const CONTENT_DIGEST_KIND: &str = "blake3-v1";

#[derive(Debug, Error)]
pub enum CanonicalError {
    #[error("JSON serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("canonical JSON does not permit floats, negative integers, NaN, or infinity")]
    UnsupportedNumber,
    #[error("integer {value} exceeds JavaScript's maximum safe integer")]
    UnsafeInteger { value: u64 },
    #[error("digest mismatch: expected {expected}, actual {actual}")]
    DigestMismatch { expected: String, actual: String },
}

pub fn canonicalize<T: Serialize>(value: &T) -> Result<String, CanonicalError> {
    let value = serde_json::to_value(value)?;
    canonicalize_value(&value)
}

pub fn canonicalize_value(value: &Value) -> Result<String, CanonicalError> {
    let value = canonical_value(value)?;
    Ok(serde_json::to_string(&value)?)
}

pub fn canonical_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, CanonicalError> {
    Ok(canonicalize(value)?.into_bytes())
}

pub fn fixture_digest<T: Serialize>(value: &T) -> Result<String, CanonicalError> {
    let bytes = canonical_bytes(value)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

pub fn content_digest<T: Serialize>(value: &T) -> Result<String, CanonicalError> {
    let bytes = canonical_bytes(value)?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}

pub fn verify_fixture_digest<T: Serialize>(value: &T, expected: &str) -> Result<(), CanonicalError> {
    let actual = fixture_digest(value)?;
    if actual == expected {
        Ok(())
    } else {
        Err(CanonicalError::DigestMismatch {
            expected: expected.to_owned(),
            actual,
        })
    }
}

fn canonical_value(value: &Value) -> Result<Value, CanonicalError> {
    match value {
        Value::Null | Value::Bool(_) | Value::String(_) => Ok(value.clone()),
        Value::Number(number) => {
            let Some(integer) = number.as_u64() else {
                return Err(CanonicalError::UnsupportedNumber);
            };
            if integer > 9_007_199_254_740_991 {
                return Err(CanonicalError::UnsafeInteger { value: integer });
            }
            Ok(value.clone())
        }
        Value::Array(values) => values
            .iter()
            .map(canonical_value)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
            let mut canonical = Map::new();
            for key in keys {
                if let Some(item) = object.get(key) {
                    canonical.insert(key.clone(), canonical_value(item)?);
                }
            }
            Ok(Value::Object(canonical))
        }
    }
}
