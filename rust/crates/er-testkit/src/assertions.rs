//! Exact fixture and digest assertions expressed as fallible helpers.

use er_canonical::{canonicalize_value, fixture_digest, CanonicalError};
use serde_json::Value;
use thiserror::Error;

use crate::{load_fixture_envelope, FixtureError};

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
    let canonical = canonicalize_value(&envelope.payload)?;
    let reparsed: Value = serde_json::from_str(&canonical)?;
    if reparsed == envelope.payload {
        Ok(canonical)
    } else {
        Err(AssertionError::RoundTrip {
            name: name.to_owned(),
        })
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
