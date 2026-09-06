//! Focused M6D proof: complete move behavior-unit parity sharding.
//!
//! Proves, against the frozen `rust/fixtures/m6` catalogs loaded through
//! `CARGO_MANIFEST_DIR` ancestor resolution:
//!
//! - exactly-once inventory over every MOVE source and behavior unit with
//!   zero unsupported or residual units;
//! - deterministic shard assignment that conserves the inventory exactly;
//! - positive, false-condition, and invalid witness execution of every
//!   compiled/bespoke/admission unit through prepared production dispatch,
//!   compared element-for-element against the direct reference;
//! - first-divergence diagnostics that fire on altered ordering, values, or
//!   results, so any regression in ordering, value, or result fails here.

use std::collections::BTreeMap;
use std::error::Error;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};

use er_battle::m6::system::move_parity::{
    BespokeClusterRoute, MoveDomainHashes, MoveParityDivergence, MoveParityError, MoveUnitClass,
    MoveUnitParityRecord, OracleWitness, PreparedMoveDomain, build_move_domain_inventory,
    prepare_move_domain,
};
use er_content::m6_catalog::{CatalogBehaviorUnit, CatalogResolution, SemanticCatalogV1};
use er_content_compiler::m6::{
    SemanticCatalogInput, ValidatedSemanticCatalog, map_routine_catalog,
};
use er_mechanics::program_v2::MechanicsProgramV2;
use er_mechanics::selector_operation_v2::{
    MechanicOperationV2, QueryModifierStageV2, QueryModifierV2,
};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BehaviorSourceId, BehaviorUnitId, BehaviorUnitKind, BespokeMechanicId, CatalogHash,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClusterManifest {
    schema_version: u32,
    oracle_sha: String,
    clusters: Vec<ClusterRow>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClusterRow {
    cluster: BespokeMechanicId,
    behavior_units: Vec<BehaviorUnitId>,
}

#[derive(Deserialize)]
struct WitnessPlanFile {
    oracle_sha: String,
    witnesses: Vec<OracleWitness>,
}

fn fixtures_dir() -> Result<PathBuf, Box<dyn Error>> {
    fn walk(dir: &Path) -> Option<PathBuf> {
        let candidate = dir.join("fixtures").join("m6");
        candidate
            .join("semantic-catalog-v1.json")
            .is_file()
            .then_some(candidate)
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for ancestor in manifest.ancestors() {
        if let Some(found) = walk(ancestor) {
            return Ok(found);
        }
    }
    Err("frozen rust/fixtures/m6 catalog not found above CARGO_MANIFEST_DIR".into())
}

fn load_json<T: serde::de::DeserializeOwned>(name: &str) -> Result<T, Box<dyn Error>> {
    let bytes = std::fs::read(fixtures_dir()?.join(name))?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn validated_catalog() -> Result<ValidatedSemanticCatalog, Box<dyn Error>> {
    let bytes = std::fs::read(fixtures_dir()?.join("semantic-catalog-v1.json"))?;
    let catalog = SemanticCatalogV1::from_bytes(&bytes)?;
    let raw_hash = CatalogHash::parse(catalog.raw_catalog_hash.clone())?;
    Ok(ValidatedSemanticCatalog::new(SemanticCatalogInput::new(
        catalog, raw_hash,
    ))?)
}

/// Compiles every Moves-family routine program. The offline compiler crate
/// performs the mapping because er-battle sits below it.
fn build_move_routine_programs(
    catalog: &ValidatedSemanticCatalog,
) -> Result<Vec<MechanicsProgramV2>, Box<dyn Error>> {
    let mapped = map_routine_catalog(catalog.behavior_units())?;
    let mut programs = Vec::new();
    for (index, spec) in mapped.mapped.into_iter().enumerate() {
        if !matches!(spec.behavior_unit.source, BehaviorSourceId::Move { .. }) {
            continue;
        }
        let id = MechanicsProgramId::try_from_u64(u64::try_from(index)? + 1)?;
        programs.push(spec.build(id)?);
    }
    Ok(programs)
}

fn bespoke_routes(
    catalog: &ValidatedSemanticCatalog,
) -> Result<Vec<BespokeClusterRoute>, Box<dyn Error>> {
    let manifest: ClusterManifest = load_json("bespoke-clusters-v1.json")?;
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.oracle_sha, catalog.oracle_sha());
    Ok(manifest
        .clusters
        .into_iter()
        .map(|row| BespokeClusterRoute {
            mechanic: row.cluster,
            behavior_units: row.behavior_units,
        })
        .collect())
}

fn move_witnesses(
    catalog: &ValidatedSemanticCatalog,
) -> Result<BTreeMap<BehaviorUnitId, OracleWitness>, Box<dyn Error>> {
    let plan: WitnessPlanFile = load_json("oracle-witness-plan-v1.json")?;
    assert_eq!(plan.oracle_sha, catalog.oracle_sha());
    let mut witnesses = BTreeMap::new();
    for witness in plan.witnesses {
        if !matches!(witness.behavior_unit.source, BehaviorSourceId::Move { .. }) {
            continue;
        }
        if witnesses
            .insert(witness.behavior_unit.clone(), witness)
            .is_some()
        {
            return Err("duplicate oracle witness row for a MOVE unit".into());
        }
    }
    Ok(witnesses)
}

fn hashes(catalog: &ValidatedSemanticCatalog) -> MoveDomainHashes {
    MoveDomainHashes {
        oracle_sha: catalog.oracle_sha().to_owned(),
        raw_catalog_hash: catalog.raw_catalog_hash().to_owned(),
        semantic_catalog_hash: catalog.semantic_catalog_hash().as_str().to_owned(),
    }
}

fn prepared_domain() -> Result<PreparedMoveDomain, Box<dyn Error>> {
    let catalog = validated_catalog()?;
    let routines = build_move_routine_programs(&catalog)?;
    let routes = bespoke_routes(&catalog)?;
    let inventory = build_move_domain_inventory(catalog.behavior_units(), &routines, &routes)?;
    Ok(prepare_move_domain(inventory, &routines, hashes(&catalog))?)
}

type ShardRun = (u32, String, BTreeMap<BehaviorUnitId, MoveUnitParityRecord>);

fn run_all_shards(
    domain: &PreparedMoveDomain,
    shard_count: u32,
    witnesses: &BTreeMap<BehaviorUnitId, OracleWitness>,
) -> Result<Vec<ShardRun>, Box<dyn Error>> {
    let shards = domain
        .inventory()
        .assign_shards(NonZeroU32::new(shard_count).expect("nonzero"))?;
    let mut runs = Vec::with_capacity(shards.len());
    for shard in &shards {
        let report = domain.run_shard(shard, witnesses)?;
        let records: BTreeMap<BehaviorUnitId, MoveUnitParityRecord> = report
            .unit_records
            .iter()
            .map(|record| (record.unit.clone(), record.clone()))
            .collect();
        runs.push((shard.index, report.digest, records));
    }
    Ok(runs)
}

const EXPECTED_SOURCES: usize = 1_110;
const EXPECTED_INTRINSIC_UNITS: usize = 1_112;
const EXPECTED_COMPILED_UNITS: usize = 36;
const EXPECTED_BESPOKE_UNITS: usize = 944;
const EXPECTED_TOTAL_UNITS: usize =
    EXPECTED_INTRINSIC_UNITS + EXPECTED_COMPILED_UNITS + EXPECTED_BESPOKE_UNITS;

#[test]
fn move_domain_inventory_is_exactly_once_and_residual_free() -> Result<(), Box<dyn Error>> {
    let catalog = validated_catalog()?;
    let routines = build_move_routine_programs(&catalog)?;
    let routes = bespoke_routes(&catalog)?;

    let inventory = build_move_domain_inventory(catalog.behavior_units(), &routines, &routes)?;
    let counts = inventory.counts();
    assert_eq!(counts.source_count, EXPECTED_SOURCES);
    assert_eq!(counts.intrinsic_unit_count, EXPECTED_INTRINSIC_UNITS);
    assert_eq!(counts.compiled_unit_count, EXPECTED_COMPILED_UNITS);
    assert_eq!(counts.bespoke_unit_count, EXPECTED_BESPOKE_UNITS);
    assert_eq!(counts.unsupported_unit_count, 0);
    let total: usize = inventory.all_units().count();
    assert_eq!(
        total, EXPECTED_TOTAL_UNITS,
        "inventory must conserve every MOVE behavior unit exactly once"
    );

    // Exactly-once identity conservation across the whole inventory.
    let mut seen = std::collections::BTreeSet::new();
    for (unit, _) in inventory.all_units() {
        assert!(seen.insert(unit.clone()), "duplicate identity {unit:?}");
    }

    // Every source owns at least one unit and one identity admission.
    for source in inventory.sources() {
        assert!(!source.units.is_empty());
        assert!(source.intrinsic_units().next().is_some());
    }

    // The duplicate-registered sources own both registration admissions.
    for duplicated in [6_000u64, 6_001] {
        let entry = inventory
            .source_by_numeric_id(duplicated)
            .expect("duplicated registration must exist");
        assert_eq!(entry.intrinsic_units().count(), 2);
    }

    // Raw-catalog cross-check: 1112 registrations collapse onto exactly the
    // inventoried identities, duplicating only ids 6000 and 6001.
    #[derive(serde::Deserialize)]
    struct RawCatalog {
        moves: Vec<RawMoveRow>,
    }
    #[derive(serde::Deserialize)]
    struct RawMoveRow {
        numeric_id: u64,
    }
    let raw: RawCatalog = load_json("raw-source-catalog-v2.json")?;
    assert_eq!(raw.moves.len(), 1_112);
    let mut raw_counts: BTreeMap<u64, usize> = BTreeMap::new();
    for row in &raw.moves {
        *raw_counts.entry(row.numeric_id).or_default() += 1;
    }
    let duplicated_ids: Vec<u64> = raw_counts
        .iter()
        .filter(|(_, count)| **count > 1)
        .map(|(id, _)| *id)
        .collect();
    assert_eq!(duplicated_ids, vec![6_000, 6_001]);
    for (id, count) in &raw_counts {
        assert_eq!(*count, 1 + usize::from(matches!(id, 6_000 | 6_001)));
        assert!(
            inventory.source_by_numeric_id(*id).is_some(),
            "raw move {id} missing from the semantic inventory"
        );
    }
    assert_eq!(raw_counts.len(), EXPECTED_SOURCES);

    // Determinism: an identical rebuild produces an identical inventory.
    let rebuilt = build_move_domain_inventory(catalog.behavior_units(), &routines, &routes)?;
    assert_eq!(inventory, rebuilt);
    Ok(())
}

#[test]
fn shard_assignment_is_deterministic_and_conserving() -> Result<(), Box<dyn Error>> {
    let domain = prepared_domain()?;
    let mut all_sources: Vec<_> = domain
        .inventory()
        .sources()
        .iter()
        .map(|entry| entry.source.clone())
        .collect();
    all_sources.sort();

    for count in [1u32, 7, 16, 97] {
        let nonzero = NonZeroU32::new(count).expect("nonzero");
        let first = domain.inventory().assign_shards(nonzero)?;
        let second = domain.inventory().assign_shards(nonzero)?;
        assert_eq!(first, second, "shard assignment must be deterministic");

        let mut assigned = std::collections::BTreeSet::new();
        for shard in &first {
            assert!(shard.index < count);
            for source in &shard.sources {
                assert!(
                    assigned.insert(source.clone()),
                    "source assigned twice in {count}-shard plan"
                );
            }
        }
        let mut union: Vec<_> = assigned.into_iter().collect();
        union.sort();
        assert_eq!(
            union, all_sources,
            "{count}-shard plan must conserve the full inventory"
        );
    }
    Ok(())
}

#[test]
fn full_witness_matrix_executes_through_prepared_dispatch() -> Result<(), Box<dyn Error>> {
    let domain = prepared_domain()?;
    let witnesses = move_witnesses(&validated_catalog()?)?;
    assert_eq!(
        witnesses.len(),
        EXPECTED_TOTAL_UNITS,
        "every MOVE unit needs an oracle witness row"
    );

    // Whole-domain closure sweep: prepared indexes vs direct reference with
    // every MOVE source active across all hooks and queries.
    let sweep = domain.verify_domain_dispatch_closure()?;
    assert!(
        sweep.query_evidence > 0,
        "closure sweep must observe compiled query evidence"
    );

    // Full sharded run: positive, false-condition, and invalid witnesses are
    // enforced inside run_shard for every unit.
    let sixteen = run_all_shards(&domain, 16, &witnesses)?;
    let total_records: usize = sixteen.iter().map(|(_, _, records)| records.len()).sum();
    assert_eq!(total_records, EXPECTED_TOTAL_UNITS);

    let mut intrinsic = 0usize;
    let mut compiled = 0usize;
    let mut bespoke = 0usize;
    for (_, _, records) in &sixteen {
        for record in records.values() {
            match record.class {
                MoveUnitClass::IntrinsicIdentity => intrinsic += 1,
                MoveUnitClass::CompiledRoutine => compiled += 1,
                MoveUnitClass::Bespoke(_) => bespoke += 1,
            }
        }
    }
    assert_eq!(intrinsic, EXPECTED_INTRINSIC_UNITS);
    assert_eq!(compiled, EXPECTED_COMPILED_UNITS);
    assert_eq!(bespoke, EXPECTED_BESPOKE_UNITS);

    // Determinism: rerunning the identical plan reproduces every digest.
    let replayed = run_all_shards(&domain, 16, &witnesses)?;
    fn digests_of(runs: &[ShardRun]) -> Vec<(u32, &String)> {
        let mut digests: Vec<(u32, &String)> = runs
            .iter()
            .map(|(index, digest, _)| (*index, digest))
            .collect();
        digests.sort();
        digests
    }
    assert_eq!(digests_of(&sixteen), digests_of(&replayed));

    // Shard independence: a different shard count yields identical per-unit
    // evidence once grouped by unit identity.
    let seven = run_all_shards(&domain, 7, &witnesses)?;
    fn flatten(runs: &[ShardRun]) -> BTreeMap<&BehaviorUnitId, &MoveUnitParityRecord> {
        runs.iter()
            .flat_map(|(_, _, records)| records.iter())
            .collect()
    }
    assert_eq!(flatten(&sixteen), flatten(&seven));

    // Compiled units carry real ordered query evidence whose staged modifier
    // matches its audited rule shape; admission/bespoke units stay inert.
    let catalog = validated_catalog()?;
    let routines = build_move_routine_programs(&catalog)?;
    let compiled_by_unit: BTreeMap<&BehaviorUnitId, &MechanicsProgramV2> = routines
        .iter()
        .map(|program| (&program.behavior_units[0], program))
        .collect();
    for (_, _, records) in &sixteen {
        for record in records.values() {
            assert_eq!(
                record.rng_draws, 0,
                "the frozen move surface admits no RNG draws"
            );
            match record.class {
                MoveUnitClass::IntrinsicIdentity | MoveUnitClass::Bespoke(_) => {
                    assert!(!record.mutation_staged);
                    assert!(record.query_witness.is_none());
                }
                MoveUnitClass::CompiledRoutine => {
                    let summary = record.query_witness.as_ref().expect("query evidence");
                    let program = compiled_by_unit[&record.unit];
                    assert_eq!(
                        summary.ordered_stages.len(),
                        program.bindings[0].operations.length as usize
                    );
                    assert_eq!(
                        summary.ordered_stages[0].stage,
                        staged_modifier_label(program)?,
                        "ordered evidence must preserve the compiled modifier stage"
                    );
                    assert!(!summary.ordered_stages[0].condition_matched.eq(&false));
                }
            }
        }
    }
    Ok(())
}

/// The closed modifier label a compiled move routine stages.
fn staged_modifier_label(program: &MechanicsProgramV2) -> Result<&'static str, Box<dyn Error>> {
    let binding = &program.bindings[0];
    let operation = &program.operations[usize::from(binding.operations.start)];
    let MechanicOperationV2::Query {
        stage, modifier, ..
    } = operation
    else {
        return Err("compiled move routines are query-only".into());
    };
    match (modifier, stage) {
        (QueryModifierV2::Add { .. }, QueryModifierStageV2::EarlyAdd) => Ok("EARLY_ADD"),
        (QueryModifierV2::Set { .. }, QueryModifierStageV2::FinalOverride) => Ok("FINAL_OVERRIDE"),
        _ => Err("unexpected closed modifier shape".into()),
    }
}

fn divergence_of(error: MoveParityError) -> Result<MoveParityDivergence, Box<dyn Error>> {
    match error {
        MoveParityError::Divergence(divergence) => Ok(*divergence),
        other => Err(format!("expected divergence, got {other:?}").into()),
    }
}

#[test]
fn diagnostics_fire_on_altered_value_ordering_and_result() -> Result<(), Box<dyn Error>> {
    let catalog = validated_catalog()?;
    let routines = build_move_routine_programs(&catalog)?;
    let routes = bespoke_routes(&catalog)?;
    let inventory = build_move_domain_inventory(catalog.behavior_units(), &routines, &routes)?;
    let domain = prepare_move_domain(inventory, &routines, hashes(&catalog))?;
    let witnesses = move_witnesses(&catalog)?;

    let first_program = domain.direct_programs().first().expect("compiled surface");
    let compiled_unit = first_program.behavior_units[0].clone();
    let expected_stage = staged_modifier_label(first_program)?;

    let shards = domain
        .inventory()
        .assign_shards(NonZeroU32::new(16).expect("nonzero"))?;
    let shard = shards
        .iter()
        .find(|shard| shard.sources.contains(&compiled_unit.source))
        .expect("unit's source lives in some shard");

    // Baseline: untouched reference passes.
    domain.run_shard_against(shard, &witnesses, domain.direct_programs())?;

    // Value tamper: altering the compiled constant changes the accumulator
    // result; the diagnostic names the exact unit and comparison surface.
    let mut tampered_value = domain.direct_programs().to_vec();
    tampered_value[0].values.0[0] = er_mechanics::condition_v2::ValueNodeV2::Constant { value: 41 };
    let divergence = divergence_of(
        domain
            .run_shard_against(shard, &witnesses, &tampered_value)
            .expect_err("value tamper must be detected"),
    )?;
    assert_eq!(divergence.unit.as_ref(), Some(&compiled_unit));
    assert_eq!(
        divergence.stage,
        if expected_stage == "EARLY_ADD" {
            "CRITICAL_RATE"
        } else {
            "DAMAGE"
        }
    );

    // Ordering tamper: swapping two compiled programs' positions changes the
    // direct traversal order while the prepared index stays frozen; the
    // whole-domain sweep must localize the first reordered element.
    let mut swapped = domain.direct_programs().to_vec();
    swapped.swap(0, 1);
    let divergence = divergence_of(
        domain
            .verify_domain_dispatch_closure_against(&swapped)
            .expect_err("ordering tamper must be detected"),
    )?;
    assert!(
        divergence.detail.contains("first differing"),
        "diagnostic must localize the first difference: {}",
        divergence.detail
    );

    // Result tamper: dropping a compiled program removes its direct-path
    let dropped: Vec<MechanicsProgramV2> =
        domain.direct_programs().iter().skip(1).cloned().collect();
    let divergence = divergence_of(
        domain
            .run_shard_against(shard, &witnesses, &dropped)
            .expect_err("result tamper must be detected"),
    )?;
    assert_eq!(divergence.unit.as_ref(), Some(&compiled_unit));
    Ok(())
}

#[test]
fn unsupported_and_residual_identities_fail_closed() -> Result<(), Box<dyn Error>> {
    let catalog = validated_catalog()?;
    let routines = build_move_routine_programs(&catalog)?;
    let routes = bespoke_routes(&catalog)?;
    let domain = prepared_domain()?;

    // A bespoke unit routed through the compiled surface fails closed.
    let bespoke_unit =
        first_bespoke_gap_unit(catalog.behavior_units()).expect("bespoke move units exist");
    let error = domain
        .require_compiled_unit(&bespoke_unit)
        .expect_err("bespoke unit must not compile");
    assert!(matches!(
        error,
        MoveParityError::NotACompiledMoveUnit { .. }
    ));

    // An unassigned bespoke gap fails closed during inventory construction.
    let reduced_routes: Vec<BespokeClusterRoute> = routes
        .iter()
        .map(|route| BespokeClusterRoute {
            mechanic: route.mechanic,
            behavior_units: route
                .behavior_units
                .iter()
                .filter(|unit| **unit != bespoke_unit)
                .cloned()
                .collect(),
        })
        .filter(|route| !route.behavior_units.is_empty())
        .collect();
    let error = build_move_domain_inventory(catalog.behavior_units(), &routines, &reduced_routes)
        .expect_err("unassigned bespoke gap must fail closed");
    assert!(matches!(
        error,
        MoveParityError::UnassignedBespokeGap { .. }
    ));

    // Dropping every routine program leaves operand units residual.
    let error = build_move_domain_inventory(catalog.behavior_units(), &[], &routes)
        .expect_err("residual operand unit must fail closed");
    assert!(matches!(error, MoveParityError::ResidualOperandUnit { .. }));

    // A duplicated route collides instead of silently widening membership.
    let duplicated_routes: Vec<BespokeClusterRoute> = routes
        .iter()
        .flat_map(|route| {
            [
                route.clone(),
                BespokeClusterRoute {
                    mechanic: route.mechanic,
                    behavior_units: route.behavior_units[..1].to_vec(),
                },
            ]
        })
        .collect();
    let error =
        build_move_domain_inventory(catalog.behavior_units(), &routines, &duplicated_routes)
            .expect_err("duplicate bespoke route must fail closed");
    assert!(matches!(
        error,
        MoveParityError::DuplicateBespokeRoute { .. }
    ));

    // A shard whose units lack witnesses cannot run.
    let empty_witnesses: BTreeMap<BehaviorUnitId, OracleWitness> = BTreeMap::new();
    let shard = domain
        .inventory()
        .assign_shards(NonZeroU32::new(1).expect("nonzero"))?
        .remove(0);
    let error = domain
        .run_shard(&shard, &empty_witnesses)
        .expect_err("missing witnesses must fail closed");
    assert!(matches!(error, MoveParityError::WitnessMissing { .. }));
    Ok(())
}

/// First MOVE-source BESPOKE_GAP attribute unit under the frozen walk.
fn first_bespoke_gap_unit(units: &[CatalogBehaviorUnit]) -> Option<BehaviorUnitId> {
    units
        .iter()
        .filter(|unit| matches!(unit.id.source, BehaviorSourceId::Move { .. }))
        .filter(|unit| unit.id.unit_kind == BehaviorUnitKind::MoveAttribute)
        .filter(|unit| unit.semantic.resolution == CatalogResolution::BespokeGap)
        .map(|unit| unit.id.clone())
        .next()
}
