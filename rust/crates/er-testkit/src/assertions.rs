//! Exact fixture and digest assertions expressed as fallible helpers.

use er_canonical::{CanonicalError, fixture_digest};
use serde_json::Value;
use thiserror::Error;

use crate::{FixtureError, load_fixture_envelope};

pub fn assert_fixture_digest(name: &str) -> Result<(), AssertionError> {
    let envelope = load_fixture_envelope::<Value>(name)?;
    let actual = fixture_digest(&envelope.payload)?;
    if actual == envelope.canonical_digest {
        Ok(())
    } else {
        Err(AssertionError::Digest {
            name: name.to_owned(),
            expected: envelope.canonical_digest,
            actual,
        })
    }
}

pub fn assert_fixture_round_trip(name: &str) -> Result<String, AssertionError> {
    let envelope = load_fixture_envelope::<Value>(name)?;
    payload_round_trip(name, &envelope.payload)
}

fn payload_round_trip(name: &str, payload: &Value) -> Result<String, AssertionError> {
    let serialized = serde_json::to_string(payload)?;
    let reparsed: Value = serde_json::from_str(&serialized)?;
    if reparsed != *payload {
        Err(AssertionError::RoundTrip {
            name: name.to_owned(),
        })
    } else {
        Ok(serialized)
    }
}

#[derive(Debug, Error)]
pub enum AssertionError {
    #[error(transparent)]
    Fixture(#[from] FixtureError),
    #[error(transparent)]
    Canonical(#[from] CanonicalError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("fixture {name} digest mismatch: expected {expected}, actual {actual}")]
    Digest {
        name: String,
        expected: String,
        actual: String,
    },
    #[error("fixture {name} changed value during JSON round-trip")]
    RoundTrip { name: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_NAMES: &[&str] = &[
        "authority-entry-kinds.json",
        "buttons.json",
        "checkpoints.json",
        "input-maps.json",
        "manifest.json",
        "next-controls.json",
        "protocol.json",
        "receipts.json",
        "replay-traces.json",
        "schema.json",
    ];

    #[test]
    fn every_inventory_fixture_has_an_exact_compatible_digest() {
        for name in FIXTURE_NAMES {
            assert!(assert_fixture_digest(name).is_ok());
        }
    }

    #[test]
    fn every_inventory_fixture_round_trips_to_lossless_json() {
        for name in FIXTURE_NAMES {
            let result = assert_fixture_round_trip(name);
            assert!(result.is_ok());
        }
    }

    #[test]
    fn round_trip_accepts_fractional_and_negative_json_numbers() {
        let payload: Value = serde_json::json!({
            "fraction": 0.4,
            "negative": -1,
        });
        assert!(payload_round_trip("inline", &payload).is_ok());
    }
}
