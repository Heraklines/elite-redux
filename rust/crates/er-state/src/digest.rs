//! M3A-08 owns the canonical mechanical-state digest.

use std::fmt;

use er_canonical::content_digest;
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::snapshot::{GameState, SnapshotError};

pub const MECHANICAL_DIGEST_DOMAIN: &str = "pokerogue-redux/m3/mechanical/v1";
pub const MECHANICAL_DIGEST_PREFIX: &str = "blake3-v1:";

/// Domain-separated BLAKE3 identity of one complete canonical `GameState`.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct MechanicalStateDigest(String);

impl MechanicalStateDigest {
    pub fn new(value: impl Into<String>) -> Result<Self, MechanicalDigestError> {
        let value = value.into();
        let Some(hex) = value.strip_prefix(MECHANICAL_DIGEST_PREFIX) else {
            return Err(MechanicalDigestError::InvalidPrefix);
        };
        if hex.len() != 64
            || !hex
                .bytes()
                .all(|digit| matches!(digit, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err(MechanicalDigestError::InvalidHex);
        }
        Ok(Self(value))
    }

    pub fn compute(state: &GameState) -> Result<Self, MechanicalDigestError> {
        compute_mechanical_state_digest(state)
    }

    pub fn verify(&self, state: &GameState) -> Result<(), MechanicalDigestError> {
        let actual = Self::compute(state)?;
        if &actual == self {
            Ok(())
        } else {
            Err(MechanicalDigestError::Mismatch {
                expected: self.clone(),
                actual,
            })
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for MechanicalStateDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl TryFrom<String> for MechanicalStateDigest {
    type Error = MechanicalDigestError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl<'de> Deserialize<'de> for MechanicalStateDigest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Error)]
pub enum MechanicalDigestError {
    #[error("mechanical digest must start with blake3-v1:")]
    InvalidPrefix,
    #[error("mechanical digest must contain exactly 64 lowercase hexadecimal digits")]
    InvalidHex,
    #[error("mechanical snapshot failed: {0}")]
    Snapshot(#[from] SnapshotError),
    #[error("mechanical digest canonicalization failed: {0}")]
    Canonical(#[from] er_canonical::CanonicalError),
    #[error("mechanical digest mismatch: expected {expected}, actual {actual}")]
    Mismatch {
        expected: MechanicalStateDigest,
        actual: MechanicalStateDigest,
    },
}

#[derive(Serialize)]
struct MechanicalDigestPreimage<'a> {
    domain: &'static str,
    state: &'a GameState,
}

/// Hash the exact complete GameState as canonical JSON of exactly
/// `{ "domain": <frozen-domain>, "state": <complete-state> }`. State
/// validation precedes hashing; the canonical preimage is encoded only once.
pub fn compute_mechanical_state_digest(
    state: &GameState,
) -> Result<MechanicalStateDigest, MechanicalDigestError> {
    state.validate().map_err(SnapshotError::from)?;
    let raw = content_digest(&MechanicalDigestPreimage {
        domain: MECHANICAL_DIGEST_DOMAIN,
        state,
    })?;
    MechanicalStateDigest::new(format!("{MECHANICAL_DIGEST_PREFIX}{raw}"))
}
