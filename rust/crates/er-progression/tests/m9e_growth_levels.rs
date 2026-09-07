use std::error::Error;

use er_progression::GrowthRateDefinitionV1;
use er_progression::progression::current_growth_experience_for_level;
use er_types::SafeU53;
use er_types::run_ids::{Experience, GrowthRateId};
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OracleWitness {
    schema: u8,
    source_blob: String,
    node_version: String,
    cases: usize,
    encoding: String,
    curves: Vec<OracleCurve>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OracleCurve {
    rate: u8,
    table: Vec<u64>,
    sha256: String,
}

// This 10 KiB witness was generated remotely from the pinned TypeScript body.
// Its six hashes cover all 393,210 u64 results, not selected boundary examples.
// The focused producer regenerates and byte-compares it against actual Node/V8.
#[test]
fn current_growth_matches_pinned_javascript_for_every_u16_level() -> Result<(), Box<dyn Error>> {
    let witness: OracleWitness =
        serde_json::from_slice(include_bytes!("fixtures/m9e_growth_oracle.json"))?;
    assert_eq!(witness.schema, 1);
    assert_eq!(witness.source_blob, "7100a23e24cc7f5fa29742da8f95300b4fceb57a");
    assert_eq!(witness.node_version, "v22.23.2");
    assert_eq!(witness.cases, 6 * usize::from(u16::MAX));
    assert_eq!(witness.encoding, "u64-big-endian");
    assert_eq!(witness.curves.len(), 6);
    for (rate, curve) in witness.curves.iter().enumerate() {
        assert_eq!(usize::from(curve.rate), rate);
        assert_eq!(curve.table.len(), 100);
        let table = curve
            .table
            .iter()
            .map(|value| SafeU53::new(*value).map(Experience::new))
            .collect::<Result<Vec<_>, _>>()?;
        let growth = GrowthRateDefinitionV1 {
            id: GrowthRateId::new(curve.rate),
            experience_by_level: table.clone(),
        };
        let mut digest = Sha256::new();
        for level in 1..=u16::MAX {
            let value = current_growth_experience_for_level(&growth, level)?.get().get();
            digest.update(value.to_be_bytes());
        }
        assert_eq!(
            format!("{:x}", digest.finalize()),
            curve.sha256,
            "pinned oracle differs for growth={rate}"
        );
        assert_eq!(growth.experience_by_level, table);
    }
    Ok(())
}

#[test]
fn current_growth_rejects_zero_level_unknown_rate_and_incomplete_table() {
    let mut growth = GrowthRateDefinitionV1 {
        id: GrowthRateId::new(2),
        experience_by_level: vec![Experience::new(SafeU53::ZERO); 100],
    };
    assert!(current_growth_experience_for_level(&growth, 0).is_err());
    growth.id = GrowthRateId::new(6);
    assert!(current_growth_experience_for_level(&growth, 1).is_err());
    assert!(current_growth_experience_for_level(&growth, 101).is_err());
    growth.id = GrowthRateId::new(2);
    growth.experience_by_level.pop();
    assert!(current_growth_experience_for_level(&growth, 1).is_err());
    assert!(current_growth_experience_for_level(&growth, 101).is_err());
}
