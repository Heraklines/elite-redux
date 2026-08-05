//! Exact fixture and digest assertions expressed as fallible helpers.

use er_canonical::{CanonicalError, canonicalize_value, fixture_digest};
use serde_json::Value;
use thiserror::Error;

use crate::{FixtureError, load_fixture_envelope};

pub fn assert_fixture_digest(name: &str) -> Result<(), AssertionError> {
    let envelope = load_fixture_envelope::<Value>(name)?;
    let (_, payload) = canonical_payload_round_trip(name, &envelope.payload)?;
    let actual = fixture_digest(&payload)?;
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
    let (canonical, _) = canonical_payload_round_trip(name, &envelope.payload)?;
    Ok(canonical)
}

fn canonical_payload_round_trip(
    name: &str,
    payload: &Value,
) -> Result<(String, Value), AssertionError> {
    let canonical = canonicalize_value(payload)?;
    let reparsed: Value = serde_json::from_str(&canonical)?;
    let reparsed_canonical = canonicalize_value(&reparsed)?;
    if reparsed != *payload || reparsed_canonical != canonical {
        Err(AssertionError::RoundTrip {
            name: name.to_owned(),
        })
    } else {
        Ok((canonical, reparsed))
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
    #[error("fixture {name} changed value during canonical round-trip")]
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
    fn every_inventory_fixture_round_trips_to_canonical_json() {
        for name in FIXTURE_NAMES {
            let result = assert_fixture_round_trip(name);
            assert!(result.is_ok());
        }
    }
}
