use std::error::Error;

use er_content::m6_catalog::{CatalogResolution, SemanticCatalogV1};
use er_content_compiler::m6::{
    BespokeAssignment, CompilerOptions, IntrinsicRule, SemanticCatalogInput, SemanticCompileError,
    SemanticCompileRequest, ValidatedSemanticCatalog, compile_semantics,
};
use er_types::{BehaviorUnitId, BespokeMechanicId, CatalogHash};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BespokeClusterManifest {
    schema_version: u32,
    oracle_sha: String,
    clusters: Vec<BespokeCluster>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BespokeCluster {
    cluster: BespokeMechanicId,
    behavior_units: Vec<BehaviorUnitId>,
}

fn validated_catalog() -> Result<ValidatedSemanticCatalog, Box<dyn Error>> {
    let catalog = SemanticCatalogV1::from_bytes(include_bytes!(
        "../../../fixtures/m6/semantic-catalog-v1.json"
    ))?;
    let raw_hash = CatalogHash::parse(catalog.raw_catalog_hash.clone())?;
    Ok(ValidatedSemanticCatalog::new(SemanticCatalogInput::new(
        catalog, raw_hash,
    ))?)
}

fn inputs(
    catalog: &ValidatedSemanticCatalog,
) -> Result<(Vec<IntrinsicRule>, Vec<BespokeAssignment>), Box<dyn Error>> {
    let intrinsic = catalog
        .behavior_units()
        .iter()
        .filter(|unit| unit.semantic.resolution == CatalogResolution::ResolvedIntrinsic)
        .map(|unit| IntrinsicRule {
            behavior_unit: unit.id.clone(),
        })
        .collect();
    let manifest: BespokeClusterManifest = serde_json::from_slice(include_bytes!(
        "../../../fixtures/m6/bespoke-clusters-v1.json"
    ))?;
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.oracle_sha, catalog.oracle_sha());
    let assignments = manifest
        .clusters
        .into_iter()
        .map(|cluster| BespokeAssignment {
            mechanic: cluster.cluster,
            behavior_units: cluster.behavior_units,
        })
        .collect();
    Ok((intrinsic, assignments))
}

#[test]
fn full_frozen_semantic_catalog_compiles_deterministically() -> Result<(), Box<dyn Error>> {
    let catalog = validated_catalog()?;
    let (intrinsic_rules, bespoke_assignments) = inputs(&catalog)?;
    let request = SemanticCompileRequest {
        catalog: &catalog,
        intrinsic_rules: &intrinsic_rules,
        bespoke_assignments: &bespoke_assignments,
        options: CompilerOptions::default(),
    };
    let first = compile_semantics(request)?;
    let second = compile_semantics(request)?;
    assert_eq!(first, second);
    assert_eq!(serde_json::to_vec(&first)?, serde_json::to_vec(&second)?);
    assert_eq!(first.report.source_count, 7_374);
    assert_eq!(first.report.behavior_unit_count, 9_388);
    assert_eq!(first.report.resolved_intrinsic_count, 3_634);
    assert_eq!(first.report.resolved_operand_count, 0);
    assert_eq!(first.report.bespoke_gap_count, 5_754);
    assert_eq!(first.report.compiled_unit_count, 3_634);
    assert_eq!(first.report.bespoke_unit_count, 5_754);
    assert_eq!(first.report.unsupported_unit_count, 0);
    assert_eq!(first.report.rng_site_count, 273);
    assert_eq!(first.report.rng_site_unresolved_count, 273);
    assert_eq!(first.classifications.0.len(), 9_388);
    assert!(
        first
            .classifications
            .0
            .windows(2)
            .all(|window| window[0].behavior_unit < window[1].behavior_unit)
    );
    Ok(())
}

#[test]
fn missing_bespoke_assignment_fails_at_first_unit() -> Result<(), Box<dyn Error>> {
    let catalog = validated_catalog()?;
    let intrinsic_rules = Vec::new();
    let bespoke_assignments = Vec::new();
    let error = compile_semantics(SemanticCompileRequest {
        catalog: &catalog,
        intrinsic_rules: &intrinsic_rules,
        bespoke_assignments: &bespoke_assignments,
        options: CompilerOptions::default(),
    })
    .expect_err("unassigned bespoke gap must fail");
    let SemanticCompileError::UnassignedBespokeGap { context } = error else {
        panic!("expected first unassigned bespoke gap");
    };
    assert!(context.provenance_path.contains("src/"));
    Ok(())
}
