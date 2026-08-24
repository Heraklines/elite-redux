use std::fs;

use er_content::m6_catalog::{
    CatalogLoadError, CatalogResolution, SEMANTIC_CATALOG_SCHEMA_VERSION, SemanticCatalogV1,
};

fn frozen_catalog_bytes() -> Vec<u8> {
    fs::read("../../fixtures/m6/semantic-catalog-v1.json").expect("frozen semantic catalog exists")
}

#[test]
fn frozen_semantic_catalog_loads_and_validates() {
    let catalog = SemanticCatalogV1::from_bytes(&frozen_catalog_bytes()).expect("catalog loads");
    assert_eq!(catalog.schema_version, SEMANTIC_CATALOG_SCHEMA_VERSION);
    assert_eq!(catalog.oracle_sha.len(), 40);
    assert_eq!(catalog.sources.len(), 7_374);
    assert_eq!(catalog.behavior_units.len(), 9_388);
    // RNG-site behavior units are included in the unit list.
    assert_eq!(catalog.rng_sites.len(), 273);
    assert_eq!(
        u64::try_from(catalog.behavior_units.len()).unwrap(),
        catalog.declared_behavior_unit_total()
    );
    assert!(catalog.behavior_units.iter().all(|unit| matches!(
        unit.semantic.resolution,
        CatalogResolution::ResolvedIntrinsic | CatalogResolution::BespokeGap
    )));
}

#[test]
fn unknown_fields_fail_closed() {
    let mut bytes = frozen_catalog_bytes();
    assert!(bytes.ends_with(b"}\n"));
    bytes.pop();
    bytes.extend_from_slice(b",\"future_field\":1}\n");
    assert!(matches!(
        SemanticCatalogV1::from_bytes(&bytes),
        Err(CatalogLoadError::Json(_))
    ));
}

#[test]
fn wrong_schema_version_fails_closed() {
    let mut value: serde_json::Value =
        serde_json::from_slice(&frozen_catalog_bytes()).expect("fixture is valid JSON");
    value["schema_version"] = serde_json::json!(99);
    let error = SemanticCatalogV1::from_bytes(&serde_json::to_vec(&value).unwrap())
        .expect_err("schema version mismatch must fail");
    assert_eq!(
        error,
        CatalogLoadError::SemanticSchemaVersion {
            expected: SEMANTIC_CATALOG_SCHEMA_VERSION,
            actual: 99,
        }
    );
}
