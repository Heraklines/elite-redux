//! Compiled, source-bound M7 behavior proof registry.

use std::collections::BTreeSet;

use er_canonical::content_digest;
use er_types::{GameBehaviorUnitId, GameControlKindV2, OracleSha, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const BEHAVIOR_PROOF_ARTIFACT_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProofNegativeAssertionV1 {
    NoCanonicalMutation,
    NoRngDraw,
    NoControlTransition,
    NoOptionGeneration,
    NoLegalityDecision,
    NoMaterial,
    NoSaveField,
    NoPlatformEffect,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorMutationEvidenceV1 {
    pub ordinal: u32,
    pub kind: String,
    pub before_digest: String,
    pub after_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorRngEvidenceV1 {
    pub sequence: SafeU53,
    pub reason: String,
    pub range: Option<SafeU53>,
    pub result: SafeU53,
    pub before_fingerprint: String,
    pub after_fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorMaterialEvidenceV1 {
    pub kind: String,
    pub digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorProofEvidence {
    pub reached_behaviors: BTreeSet<GameBehaviorUnitId>,
    pub mutations: Vec<BehaviorMutationEvidenceV1>,
    pub rng_draws: Vec<BehaviorRngEvidenceV1>,
    pub controls: Vec<GameControlKindV2>,
    pub materials: Vec<BehaviorMaterialEvidenceV1>,
    pub negative_assertions: BTreeSet<ProofNegativeAssertionV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutedBehaviorProofV1 {
    pub group_id: String,
    pub semantic_owner: String,
    pub behavior_units: Vec<GameBehaviorUnitId>,
    pub rust_symbol: String,
    pub test_name: String,
    pub evidence: BehaviorProofEvidence,
    pub evidence_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BehaviorProofArtifactV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub proof_count: usize,
    pub behavior_count: usize,
    pub proofs: Vec<ExecutedBehaviorProofV1>,
}

pub type BehaviorWitness = fn() -> Result<BehaviorProofEvidence, ProofError>;
pub type BehaviorSymbolAnchor = fn();

#[derive(Clone, Debug)]
pub struct BehaviorProofRecord {
    pub group_id: &'static str,
    pub semantic_owner: &'static str,
    pub behavior_units: &'static [&'static str],
    pub rust_symbol: &'static str,
    pub test_name: &'static str,
    pub symbol_anchor: BehaviorSymbolAnchor,
    pub witness: BehaviorWitness,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProofError {
    #[error("proof registry contains an empty identity or symbol")]
    EmptyIdentity,
    #[error("proof registry contains an invalid behavior identity: {0}")]
    BehaviorIdentity(String),
    #[error("proof registry contains a duplicate group or behavior identity")]
    DuplicateIdentity,
    #[error("proof witness reached a different behavior set than its registry record")]
    ReachabilityMismatch,
    #[error("proof evidence contains an empty or malformed digest field")]
    Evidence,
    #[error("proof evidence digest failed: {0}")]
    Digest(String),
}

impl BehaviorProofEvidence {
    pub fn validate(&self) -> Result<(), ProofError> {
        if self.mutations.iter().any(|entry| {
            entry.kind.is_empty()
                || !valid_digest(&entry.before_digest)
                || !valid_digest(&entry.after_digest)
        }) || self.rng_draws.iter().any(|entry| {
            entry.reason.is_empty()
                || entry.before_fingerprint.is_empty()
                || entry.after_fingerprint.is_empty()
        }) || self
            .materials
            .iter()
            .any(|entry| entry.kind.is_empty() || !valid_digest(&entry.digest))
        {
            return Err(ProofError::Evidence);
        }
        Ok(())
    }

    pub fn digest(&self) -> Result<String, ProofError> {
        self.validate()?;
        content_digest(self)
            .map(|digest| format!("blake3-v1:{digest}"))
            .map_err(|error| ProofError::Digest(error.to_string()))
    }
}

impl BehaviorProofRecord {
    pub fn execute(&self) -> Result<ExecutedBehaviorProofV1, ProofError> {
        if self.group_id.is_empty()
            || self.semantic_owner.is_empty()
            || self.behavior_units.is_empty()
            || self.rust_symbol.is_empty()
            || self.test_name.is_empty()
        {
            return Err(ProofError::EmptyIdentity);
        }
        (self.symbol_anchor)();
        let behavior_units = self
            .behavior_units
            .iter()
            .map(|value| {
                GameBehaviorUnitId::parse(*value)
                    .map_err(|_| ProofError::BehaviorIdentity((*value).to_owned()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        if behavior_units.windows(2).any(|pair| pair[0] >= pair[1]) {
            return Err(ProofError::DuplicateIdentity);
        }
        let evidence = (self.witness)()?;
        let expected: BTreeSet<_> = behavior_units.iter().cloned().collect();
        if evidence.reached_behaviors != expected {
            return Err(ProofError::ReachabilityMismatch);
        }
        let evidence_digest = evidence.digest()?;
        Ok(ExecutedBehaviorProofV1 {
            group_id: self.group_id.to_owned(),
            semantic_owner: self.semantic_owner.to_owned(),
            behavior_units,
            rust_symbol: self.rust_symbol.to_owned(),
            test_name: self.test_name.to_owned(),
            evidence,
            evidence_digest,
        })
    }
}

pub fn execute_proof_registry(
    oracle_sha: OracleSha,
    records: &[BehaviorProofRecord],
) -> Result<BehaviorProofArtifactV1, ProofError> {
    let mut groups = BTreeSet::new();
    let mut behaviors = BTreeSet::new();
    let mut proofs = Vec::with_capacity(records.len());
    for record in records {
        if !groups.insert(record.group_id) {
            return Err(ProofError::DuplicateIdentity);
        }
        let proof = record.execute()?;
        if proof
            .behavior_units
            .iter()
            .any(|behavior| !behaviors.insert(behavior.clone()))
        {
            return Err(ProofError::DuplicateIdentity);
        }
        proofs.push(proof);
    }
    proofs.sort_unstable_by(|left, right| left.group_id.cmp(&right.group_id));
    Ok(BehaviorProofArtifactV1 {
        schema_version: BEHAVIOR_PROOF_ARTIFACT_SCHEMA_VERSION_V1,
        oracle_sha,
        proof_count: proofs.len(),
        behavior_count: behaviors.len(),
        proofs,
    })
}

fn valid_digest(value: &str) -> bool {
    value.strip_prefix("blake3-v1:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence() -> Result<BehaviorProofEvidence, ProofError> {
        Ok(BehaviorProofEvidence {
            reached_behaviors: BTreeSet::from([GameBehaviorUnitId::parse("a".repeat(64))
                .map_err(|_| ProofError::BehaviorIdentity("fixture".to_owned()))?]),
            mutations: Vec::new(),
            rng_draws: Vec::new(),
            controls: Vec::new(),
            materials: Vec::new(),
            negative_assertions: BTreeSet::from([
                ProofNegativeAssertionV1::NoCanonicalMutation,
                ProofNegativeAssertionV1::NoRngDraw,
            ]),
        })
    }

    fn symbol_anchor() {}

    #[test]
    fn registry_requires_exact_reached_behavior_set() {
        let record = BehaviorProofRecord {
            group_id: "fixture.group",
            semantic_owner: "er_testkit::fixture",
            behavior_units: &["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
            rust_symbol: "er_testkit::fixture",
            test_name: "fixture_witness",
            symbol_anchor,
            witness: evidence,
        };
        let proof = record.execute().expect("exact proof");
        assert_eq!(proof.behavior_units.len(), 1);
        assert!(proof.evidence_digest.starts_with("blake3-v1:"));
    }
}
