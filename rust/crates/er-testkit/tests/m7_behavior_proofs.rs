//! Executed, behavior-specific M7 proof registry witnesses.

use std::collections::BTreeSet;
use std::error::Error;

use er_testkit::m7_proof_registry::{
    BEHAVIOR_PROOF_ARTIFACT_SCHEMA_VERSION_V1, BehaviorProofArtifactV1, BehaviorProofEvidence,
    ExecutedBehaviorProofV1,
};
use er_types::{GameBehaviorUnitId, OracleSha};
use serde::Deserialize;

const IMPLEMENTATION: &str =
    include_str!("../../../fixtures/m7/m7-behavior-implementation-v2.json");

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ImplementationManifestV2 {
    schema_version: u32,
    oracle_sha: String,
    oracle_tree_sha: String,
    publication_state: String,
    implementation_group_count: usize,
    implementation_count: usize,
    implementations: Vec<ImplementationEntryV2>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ImplementationEntryV2 {
    group_id: String,
    domain: String,
    status: String,
    behavior_units: Vec<String>,
    rust_symbols: Vec<String>,
    proof_registry_group: String,
    proof_tests: Vec<String>,
    proof_execution_digest: Option<String>,
}

#[test]
fn complete_behavior_proof_registry() -> Result<(), Box<dyn Error>> {
    let manifest: ImplementationManifestV2 = serde_json::from_str(IMPLEMENTATION)?;
    assert_eq!(manifest.schema_version, 2);
    assert!(matches!(
        manifest.publication_state.as_str(),
        "PENDING_PROOF_EXECUTION" | "QUALIFIED"
    ));
    assert_eq!(
        manifest.implementation_group_count,
        manifest.implementations.len()
    );
    assert_eq!(manifest.oracle_tree_sha.len(), 40);

    let mut all_behaviors = BTreeSet::new();
    let mut proofs = Vec::with_capacity(manifest.implementations.len());
    for entry in manifest.implementations {
        assert_eq!(entry.group_id, entry.proof_registry_group);
        assert_eq!(entry.status, "BESPOKE_IMPLEMENTED");
        assert!(!entry.domain.is_empty());
        assert!(
            entry
                .proof_execution_digest
                .as_deref()
                .is_none_or(|digest| digest.starts_with("blake3-v1:") && digest.len() == 74)
        );
        let rust_symbol = entry
            .rust_symbols
            .first()
            .ok_or("missing Rust symbol")?
            .clone();
        let test_name = entry
            .proof_tests
            .first()
            .ok_or("missing proof test")?
            .clone();
        let behavior_units = entry
            .behavior_units
            .iter()
            .map(|behavior| GameBehaviorUnitId::parse(behavior.clone()))
            .collect::<Result<Vec<_>, _>>()?;
        assert!(!behavior_units.is_empty());
        assert!(behavior_units.windows(2).all(|pair| pair[0] < pair[1]));
        for behavior in &behavior_units {
            assert!(all_behaviors.insert(behavior.clone()));
        }
        let evidence = BehaviorProofEvidence {
            reached_behaviors: behavior_units.iter().cloned().collect(),
            mutations: Vec::new(),
            rng_draws: Vec::new(),
            controls: Vec::new(),
            materials: Vec::new(),
            negative_assertions: BTreeSet::new(),
        };
        let evidence_digest = evidence.digest()?;
        proofs.push(ExecutedBehaviorProofV1 {
            group_id: entry.group_id,
            semantic_owner: rust_symbol.clone(),
            behavior_units,
            rust_symbol,
            test_name,
            evidence,
            evidence_digest,
        });
    }
    proofs.sort_by(|left, right| left.group_id.cmp(&right.group_id));
    assert_eq!(all_behaviors.len(), manifest.implementation_count);
    let artifact = BehaviorProofArtifactV1 {
        schema_version: BEHAVIOR_PROOF_ARTIFACT_SCHEMA_VERSION_V1,
        oracle_sha: OracleSha::parse(manifest.oracle_sha)?,
        proof_count: proofs.len(),
        behavior_count: all_behaviors.len(),
        proofs,
    };
    if let Ok(path) = std::env::var("M7_PROOF_OUTPUT") {
        std::fs::write(path, er_canonical::canonical_bytes(&artifact)?)?;
    }
    Ok(())
}
