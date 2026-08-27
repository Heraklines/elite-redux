//! Executed, behavior-specific M7 proof registry witnesses.

use std::collections::BTreeSet;
use std::error::Error;

use er_testkit::m7_proof_registry::{
    BehaviorProofEvidence, BehaviorProofRecord, ProofError, ProofNegativeAssertionV1,
    execute_proof_registry,
};
use er_types::{GameBehaviorUnitId, OracleSha};

const ORACLE: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const LEGEND_GROUP: &str = "m7g-210c5bb4baa9fd71dc2bb029855ca56a32964ce0da07fbb9b5b01ca10680d028";
const LEGEND_BEHAVIOR: &str = "5cdb5dc879de2193f501bd96e6ff5b2913a7453fa5b6ee496cd229031bb8ed9a";

fn legend_symbol_anchor() {
    let _: fn(u32) -> u32 = er_world::runtime::legend_min_wave;
}

fn legend_witness() -> Result<BehaviorProofEvidence, ProofError> {
    if er_world::runtime::legend_min_wave(580) != 65
        || er_world::runtime::legend_min_wave(600) != 70
        || er_world::runtime::legend_min_wave(660) != 85
        || er_world::runtime::legend_min_wave(680) != 90
        || er_world::runtime::legend_min_wave(9_999) != 90
    {
        return Err(ProofError::Evidence);
    }
    Ok(BehaviorProofEvidence {
        reached_behaviors: BTreeSet::from([GameBehaviorUnitId::parse(LEGEND_BEHAVIOR)
            .map_err(|_| ProofError::BehaviorIdentity(LEGEND_BEHAVIOR.to_owned()))?]),
        mutations: Vec::new(),
        rng_draws: Vec::new(),
        controls: Vec::new(),
        materials: Vec::new(),
        negative_assertions: BTreeSet::from([
            ProofNegativeAssertionV1::NoCanonicalMutation,
            ProofNegativeAssertionV1::NoRngDraw,
            ProofNegativeAssertionV1::NoControlTransition,
            ProofNegativeAssertionV1::NoOptionGeneration,
            ProofNegativeAssertionV1::NoMaterial,
            ProofNegativeAssertionV1::NoSaveField,
            ProofNegativeAssertionV1::NoPlatformEffect,
        ]),
    })
}

#[test]
fn legend_min_wave_behavior_proof() -> Result<(), Box<dyn Error>> {
    let records = [BehaviorProofRecord {
        group_id: LEGEND_GROUP,
        semantic_owner: "er_world::runtime::legend_min_wave",
        behavior_units: &[LEGEND_BEHAVIOR],
        rust_symbol: "er_world::runtime::legend_min_wave",
        test_name: "legend_min_wave_behavior_proof",
        symbol_anchor: legend_symbol_anchor,
        witness: legend_witness,
    }];
    let artifact = execute_proof_registry(OracleSha::parse(ORACLE)?, &records)?;
    assert_eq!(artifact.proof_count, 1);
    assert_eq!(artifact.behavior_count, 1);
    if let Ok(path) = std::env::var("M7_PROOF_OUTPUT") {
        let bytes = er_canonical::canonical_bytes(&artifact)?;
        std::fs::write(path, bytes)?;
    }
    Ok(())
}
