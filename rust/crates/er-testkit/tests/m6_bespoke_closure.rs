use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_battle::m6::bespoke::{BespokeHandlerId, handlers_for};
use er_content::m6_catalog::{CatalogResolution, SemanticCatalogV1};
use er_content_compiler::m6::{
    BespokeAssignment, CompilerOptions, IntrinsicRule, SemanticCatalogInput,
    SemanticCompileRequest, ValidatedSemanticCatalog, compile_semantics,
};
use er_types::{BehaviorClassificationKindV2, BehaviorUnitId, BespokeMechanicId, CatalogHash};
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

fn manifest() -> Result<BespokeClusterManifest, Box<dyn Error>> {
    Ok(serde_json::from_slice(include_bytes!(
        "../../../fixtures/m6/bespoke-clusters-v1.json"
    ))?)
}

#[test]
fn g24_has_zero_pending_unsupported_or_unmapped_units() -> Result<(), Box<dyn Error>> {
    let catalog = validated_catalog()?;
    let manifest = manifest()?;
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.oracle_sha, catalog.oracle_sha());
    assert_eq!(manifest.clusters.len(), 13);

    let intrinsic_rules: Vec<_> = catalog
        .behavior_units()
        .iter()
        .filter(|unit| unit.semantic.resolution == CatalogResolution::ResolvedIntrinsic)
        .map(|unit| IntrinsicRule {
            behavior_unit: unit.id.clone(),
        })
        .collect();
    let bespoke_assignments: Vec<_> = manifest
        .clusters
        .iter()
        .map(|cluster| BespokeAssignment {
            mechanic: cluster.cluster,
            behavior_units: cluster.behavior_units.clone(),
        })
        .collect();

    let output = compile_semantics(SemanticCompileRequest {
        catalog: &catalog,
        intrinsic_rules: &intrinsic_rules,
        bespoke_assignments: &bespoke_assignments,
        options: CompilerOptions::default(),
    })?;

    assert_eq!(output.report.behavior_unit_count, 9_388);
    assert_eq!(output.report.compiled_unit_count, 3_680);
    assert_eq!(output.report.bespoke_unit_count, 5_708);
    assert_eq!(output.report.unsupported_unit_count, 0);
    assert_eq!(output.report.rng_site_count, 273);
    assert_eq!(output.report.rng_site_unresolved_count, 0);
    assert_eq!(output.classifications.0.len(), 9_388);
    assert!(
        output
            .classifications
            .0
            .iter()
            .all(|entry| entry.kind != BehaviorClassificationKindV2::Unsupported)
    );

    let classification_by_unit: BTreeMap<_, _> = output
        .classifications
        .0
        .iter()
        .map(|entry| (&entry.behavior_unit, entry))
        .collect();
    assert_eq!(classification_by_unit.len(), 9_388);
    for site in catalog.rng_sites() {
        let classification = classification_by_unit
            .get(&site.owner)
            .ok_or("RNG owner has no behavior classification")?;
        assert_ne!(
            classification.kind,
            BehaviorClassificationKindV2::Unsupported
        );
    }

    let mut bespoke_units = BTreeSet::new();
    let mut mechanics = BTreeSet::new();
    let mut handlers = BTreeSet::new();
    for cluster in &manifest.clusters {
        assert!(mechanics.insert(cluster.cluster));
        let owners = handlers_for(cluster.cluster);
        assert!(
            !owners.is_empty(),
            "missing handler for {:?}",
            cluster.cluster
        );
        handlers.extend(owners.iter().copied());
        for unit in &cluster.behavior_units {
            assert!(bespoke_units.insert(unit));
            let classification = classification_by_unit
                .get(unit)
                .ok_or("bespoke unit has no behavior classification")?;
            assert_eq!(classification.kind, BehaviorClassificationKindV2::Bespoke);
            assert_eq!(classification.bespoke, Some(cluster.cluster));
            assert!(classification.programs.is_empty());
            assert!(classification.unsupported_reason.is_none());
        }
    }
    assert_eq!(mechanics.len(), 13);
    assert_eq!(bespoke_units.len(), 5_708);
    assert_eq!(handlers.len(), 12);
    assert_eq!(handlers_for(BespokeMechanicId::CustomDispatch).len(), 4);
    assert!(handlers.contains(&BespokeHandlerId::Boss));
    assert!(handlers.contains(&BespokeHandlerId::MoveCopy));
    assert!(handlers.contains(&BespokeHandlerId::Forms));
    assert!(handlers.contains(&BespokeHandlerId::SuppressionImmunity));

    Ok(())
}
