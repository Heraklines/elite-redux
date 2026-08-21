//! M4 mechanical-state digest over the complete `GameStateV2` graph.
//!
//! Domain: `pokerogue-redux/m4/mechanical/v2` per `rust/contracts/m4-api.md`.
//! The preimage is canonical JSON of exactly `{ "domain": <domain>, "state":
//! <complete-state> }`; state validation precedes hashing.

use std::fmt;

use er_canonical::content_digest;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::game_v2::GameStateV2;
use crate::validation_v2::StateValidationErrorV2;

pub const MECHANICAL_DIGEST_DOMAIN_V2: &str = "pokerogue-redux/m4/mechanical/v2";
pub const MECHANICAL_DIGEST_PREFIX: &str = "blake3-v1:";

/// Domain-separated BLAKE3 identity of one complete canonical `GameStateV2`.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct MechanicalStateDigestV2(String);

impl MechanicalStateDigestV2 {
    pub fn new(value: impl Into<String>) -> Result<Self, MechanicalDigestErrorV2> {
        let value = value.into();
        let Some(hex) = value.strip_prefix(MECHANICAL_DIGEST_PREFIX) else {
            return Err(MechanicalDigestErrorV2::InvalidPrefix);
        };
        if hex.len() != 64
            || !hex
                .bytes()
                .all(|digit| matches!(digit, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err(MechanicalDigestErrorV2::InvalidHex);
        }
        Ok(Self(value))
    }

    pub fn compute(state: &GameStateV2) -> Result<Self, MechanicalDigestErrorV2> {
        compute_mechanical_state_digest_v2(state)
    }

    pub fn verify(&self, state: &GameStateV2) -> Result<(), MechanicalDigestErrorV2> {
        let actual = Self::compute(state)?;
        if &actual == self {
            Ok(())
        } else {
            Err(MechanicalDigestErrorV2::Mismatch {
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

impl fmt::Display for MechanicalStateDigestV2 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl TryFrom<String> for MechanicalStateDigestV2 {
    type Error = MechanicalDigestErrorV2;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl<'de> Deserialize<'de> for MechanicalStateDigestV2 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Error)]
pub enum MechanicalDigestErrorV2 {
    #[error("mechanical digest must start with blake3-v1:")]
    InvalidPrefix,
    #[error("mechanical digest must contain exactly 64 lowercase hexadecimal digits")]
    InvalidHex,
    #[error("mechanical state is invalid: {0}")]
    Validation(#[from] StateValidationErrorV2),
    #[error("mechanical digest canonicalization failed: {0}")]
    Canonical(#[from] er_canonical::CanonicalError),
    #[error("mechanical digest mismatch: expected {expected}, actual {actual}")]
    Mismatch {
        expected: MechanicalStateDigestV2,
        actual: MechanicalStateDigestV2,
    },
}

#[derive(Serialize)]
struct MechanicalDigestPreimageV2<'a> {
    domain: &'static str,
    state: &'a GameStateV2,
}

/// Hash the exact complete GameStateV2 as canonical JSON of exactly
/// `{ "domain": <frozen-domain>, "state": <complete-state> }`. State
/// validation precedes hashing; the canonical preimage is encoded only once.
pub fn compute_mechanical_state_digest_v2(
    state: &GameStateV2,
) -> Result<MechanicalStateDigestV2, MechanicalDigestErrorV2> {
    state.validate()?;
    let raw = content_digest(&MechanicalDigestPreimageV2 {
        domain: MECHANICAL_DIGEST_DOMAIN_V2,
        state,
    })?;
    MechanicalStateDigestV2::new(format!("{MECHANICAL_DIGEST_PREFIX}{raw}"))
}
