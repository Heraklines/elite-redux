//! Native-side M6 native/wasm32 parity evidence.
//!
//! The adapter in `er_wasm::m6_parity` compiles to identical production logic
//! on both hosted native and wasm32 targets: the same serialized request
//! enters, the same canonical report leaves.  This suite proves the native
//! artifact of that boundary — full frozen M6 fixture coverage without
//! floating canonical JSON, stepwise observation completeness, replay
//! determinism, first divergent-event naming, and fail-closed rejection for
//! every tampered schema/content surface.  CI compares this report against
//! the wasm32/Node artifact produced by the `replayM6Request` export.
//!
//! This file is the only place fixture compilation lives: the frozen semantic
//! catalog is compiled through the production compiler pipeline into prepared
//! content, and the frozen M4 oracle segment is migrated through the
//! production `GameStateV2 -> GameStateV3 -> GameStateV4` chain.  The typed
//! `GameStateV3`/`GameStateV4` pair is handed to the production adapter as a
//! caller-supplied `M6ParityEvidence`, exactly like any production host.

use std::error::Error;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

use er_content::m6_catalog::SemanticCatalogV1;
use er_content::pack::m6_pack::{
    BattleContentPackV3, BehaviorClassificationEntryV2, BehaviorClassificationManifestV2,
    BespokeManifestV2, FieldContentV1,
};
use er_content::pack::m6_prepared::prepare_content;
use er_content_compiler::m6::{
    SemanticCatalogInput, ValidatedSemanticCatalog, map_routine_catalog,
};
use er_game::material::{decode_turn_material, turn_material_digest};
use er_kernel::snapshot_v5::RestorableKernelSnapshotV5;
use er_state::migration_v3::migrate_game_v2_to_v3;
use er_state::migration_v4::{GameStateV4, M5ToM6MigrationContext, migrate_m5_to_m6};
use er_testkit::m4_fixture::assemble_game_state;
use er_types::battle_ids::ContentPackHash;
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BattleContentPackHashV3, BehaviorClassificationKindV2, BehaviorUnitId, CatalogHash,
    M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION, M6_MECHANICS_PROGRAM_VERSION, OracleSha,
    RunContentPackHash, SafeU53,
};
use er_wasm::m6_parity::{
    M6_PARITY_FIXTURE_SCHEMA_VERSION, M6_PARITY_SEED, M6_PARITY_TRACE_ID, M6ParityEvidence,
    final_evidence_artifacts, final_evidence_fixture, final_evidence_game_state_v4_json,
    final_evidence_snapshot_v5_json, final_evidence_trace_json, final_evidence_turn_material_bytes,
    first_divergence, parse_serialized_trace, replay_serialized_trace_json,
};
use serde_json::{Value, json};

const M53_CEILING: u64 = 9_007_199_254_740_991;

fn fixtures_root() -> Result<PathBuf, Box<dyn Error>> {
    let mut candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        let fixtures = candidate.join("rust").join("fixtures");
        if fixtures.is_dir() {
            return Ok(fixtures);
        }
        candidate = candidate
            .parent()
            .map(Path::to_path_buf)
            .ok_or("rust/fixtures not found above CARGO_MANIFEST_DIR")?;
    }
}

fn read_fixture(rel: &[&str]) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut path = fixtures_root()?;
    for part in rel {
        path.push(part);
    }
    Ok(std::fs::read(path)?)
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("fixture safe integer")
}

#[allow(dead_code)]
fn hash_str(fill: char) -> String {
    format!("blake3-v1:{}", fill.to_string().repeat(64))
}

// ---------------------------------------------------------------------------
// Frozen-content compilation and typed evidence construction (test-only)
// ---------------------------------------------------------------------------

/// Identity fingerprints of one compiled frozen catalog.
struct CompiledIdentity {
    semantic_catalog_hash: CatalogHash,
    battle_content_hash: BattleContentPackHashV3,
}

struct BuiltEvidence {
    identity: CompiledIdentity,
    parity: M6ParityEvidence,
}

fn validated_catalog() -> Result<ValidatedSemanticCatalog, Box<dyn Error>> {
    let bytes = read_fixture(&["m6", "semantic-catalog-v1.json"])?;
    let catalog = SemanticCatalogV1::from_bytes(&bytes)?;
    let raw_hash = CatalogHash::parse(catalog.raw_catalog_hash.clone())?;
    Ok(ValidatedSemanticCatalog::new(SemanticCatalogInput::new(
        catalog, raw_hash,
    ))?)
}

/// Compiles the frozen catalog through the production pipeline into prepared
/// content plus its checked identity fingerprints.
fn compile_frozen_identity() -> Result<
    (
        CompiledIdentity,
        Vec<BehaviorUnitId>,
        usize,
        BattleContentPackV3,
    ),
    Box<dyn Error>,
> {
    let catalog = validated_catalog()?;
    let mapped = map_routine_catalog(catalog.behavior_units())?;
    let behavior_units = mapped
        .mapped
        .iter()
        .map(|spec| spec.behavior_unit.clone())
        .collect::<Vec<_>>();
    let program_count = mapped.mapped.len();
    let mut programs = vec![None];
    let mut classifications = Vec::with_capacity(mapped.mapped.len());
    for (index, spec) in mapped.mapped.into_iter().enumerate() {
        let id = MechanicsProgramId::try_from_u64(index as u64 + 1)?;
        classifications.push(BehaviorClassificationEntryV2 {
            behavior_unit: spec.behavior_unit.clone(),
            kind: BehaviorClassificationKindV2::Compiled,
            programs: vec![id],
            bespoke: None,
            unsupported_reason: None,
        });
        programs.push(Some(spec.build(id)?));
    }
    let mut pack = BattleContentPackV3 {
        schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: OracleSha::parse(catalog.oracle_sha().to_owned())?,
        raw_catalog_hash: CatalogHash::parse(catalog.raw_catalog_hash().to_owned())?,
        semantic_catalog_hash: catalog.semantic_catalog_hash().clone(),
        content_hash: BattleContentPackHashV3::parse(format!(
            "{}{}",
            BattleContentPackHashV3::PREFIX,
            "0".repeat(64)
        ))?,
        species: Vec::new(),
        forms: Vec::new(),
        moves: Vec::new(),
        abilities: Vec::new(),
        held_items: Vec::new(),
        field_content: FieldContentV1::default(),
        programs,
        classifications: BehaviorClassificationManifestV2(classifications),
        bespoke: BespokeManifestV2::default(),
        rng_sites: Vec::new(),
        type_chart: er_content::pack::selected_type_chart(),
    };
    pack.content_hash = pack.compute_content_hash()?;
    let semantic_catalog_hash = pack.semantic_catalog_hash.clone();
    let content_hash = pack.compute_content_hash()?;
    prepare_content(pack.clone())?;
    Ok((
        CompiledIdentity {
            semantic_catalog_hash,
            battle_content_hash: content_hash,
        },
        behavior_units,
        program_count,
        pack,
    ))
}

/// Builds the typed `M6ParityEvidence` through the production migration chain:
/// the frozen M4 oracle segment becomes `GameStateV2`, then migrates V3 and V4
/// against the compiled frozen-catalog identity.
fn build_evidence() -> Result<BuiltEvidence, Box<dyn Error>> {
    let (identity, behavior_units, program_count, pack) = compile_frozen_identity()?;
    let source_hash = hash_str('c');
    let segment: Value = serde_json::from_slice(
        read_fixture(&[
            "m4",
            "oracle",
            "run-segments",
            "classic-composed-wave-9-through-11-v1.json",
        ])?
        .as_slice(),
    )?;
    let v2 = assemble_game_state(
        &segment,
        ContentPackHash::new(hash_str('a'))?,
        RunContentPackHash::new(hash_str('b'))?,
        er_state::migration::M4_ORACLE_SHA,
    )?;
    let (game_v3, _) = migrate_game_v2_to_v3(&v2, source_hash.clone())?;

    let mut target_programs = Vec::with_capacity(program_count);
    for index in 1..=program_count as u64 {
        target_programs.push(MechanicsProgramId::try_from_u64(index)?);
    }
    let mut target_behavior_units = behavior_units;
    target_behavior_units.sort();
    target_behavior_units.dedup();
    let context = M5ToM6MigrationContext {
        source_content_hash_v2: source_hash,
        target_content_hash_v3: identity.battle_content_hash.clone(),
        semantic_catalog_hash: identity.semantic_catalog_hash.clone(),
        bindings: Vec::new(),
        target_programs,
        target_behavior_units,
        held_item_registry_keys: Vec::new(),
    };
    let (game_v4, migration) = migrate_m5_to_m6(&game_v3, &context)?;
    game_v4.validate_against(&context)?;
    assert!(
        !migration.active_battle,
        "evidence frontier must be quiescent"
    );
    Ok(BuiltEvidence {
        identity,
        parity: M6ParityEvidence {
            game_v3,
            game_v4,
            prepared: Arc::new(prepare_content(pack)?),
        },
    })
}

/// Shared per-process evidence; every replay consumes identical typed state.
static EVIDENCE: LazyLock<BuiltEvidence> =
    LazyLock::new(|| build_evidence().expect("typed M6 evidence must build"));

fn parity_evidence() -> &'static M6ParityEvidence {
    &EVIDENCE.parity
}

// ---------------------------------------------------------------------------
// Fixture scanning helpers
// ---------------------------------------------------------------------------

/// Rejects any floating-point or non-integer number anywhere in a fixture:
/// canonical kernel JSON is signed-safe-integer only.
fn assert_no_floating_numbers(value: &Value) -> Result<(), Box<dyn Error>> {
    match value {
        Value::Number(number) => {
            let integer = number.as_i64().ok_or_else(|| {
                format!("fixture number {number} is fractional or beyond signed canonical range")
            })?;
            if integer.unsigned_abs() > M53_CEILING {
                return Err(format!(
                    "fixture number {number} exceeds the signed safe-integer canonical range"
                )
                .into());
            }
            Ok(())
        }
        Value::Array(items) => {
            for item in items {
                assert_no_floating_numbers(item)?;
            }
            Ok(())
        }
        Value::Object(entries) => {
            for entry in entries.values() {
                assert_no_floating_numbers(entry)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn canonical_report_value(report_json: &str) -> Result<Value, Box<dyn Error>> {
    let value: Value = serde_json::from_str(report_json)?;
    assert_no_floating_numbers(&value)?;
    Ok(value)
}

fn report_value_for_evidence() -> Result<Value, Box<dyn Error>> {
    let report_json =
        replay_serialized_trace_json(&final_evidence_trace_json()?, parity_evidence())?;
    canonical_report_value(&report_json)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn full_m6_fixture_catalog_is_float_free_and_compiles_deterministically()
-> Result<(), Box<dyn Error>> {
    let dir = fixtures_root()?.join("m6");
    let mut entries = std::fs::read_dir(&dir)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort();
    assert!(
        entries.len() >= 7,
        "expected the full frozen M6 fixture set"
    );
    for path in entries {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let bytes = std::fs::read(&path)?;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|error| format!("fixture {name} is invalid JSON: {error}"))?;
        assert_no_floating_numbers(&value).map_err(|error| format!("fixture {name}: {error}"))?;
    }
    // Compiling the frozen catalog twice must produce identical identity.
    let second = compile_frozen_identity()?;
    assert_eq!(
        second.0.battle_content_hash,
        EVIDENCE.identity.battle_content_hash
    );
    assert_eq!(
        second.0.semantic_catalog_hash,
        EVIDENCE.identity.semantic_catalog_hash
    );
    assert_eq!(second.2, 46, "frozen catalog maps exactly 46 routine units");
    Ok(())
}

#[test]
fn trace_round_trip_and_replay_are_canonical_and_deterministic() -> Result<(), Box<dyn Error>> {
    let trace = final_evidence_trace_json()?;
    let fixture = parse_serialized_trace(&trace)?;
    assert_eq!(fixture.schema_version, M6_PARITY_FIXTURE_SCHEMA_VERSION);
    assert_eq!(fixture.trace_id, M6_PARITY_TRACE_ID);
    assert_eq!(fixture.seed, M6_PARITY_SEED);
    let reparsed = parse_serialized_trace(&final_evidence_trace_json()?)?;
    assert_eq!(reparsed, fixture);

    let first = replay_serialized_trace_json(&trace, parity_evidence())?;
    let second = replay_serialized_trace_json(&trace, parity_evidence())?;
    assert_eq!(first, second, "independent replays must be byte-identical");
    let report = canonical_report_value(&first)?;
    assert_eq!(
        report.get("trace_id").and_then(Value::as_str),
        Some(M6_PARITY_TRACE_ID)
    );

    // Every observation carries the complete comparison surface.
    let observations = report
        .get("observations")
        .and_then(Value::as_array)
        .ok_or("report observations missing")?;
    assert!(!observations.is_empty());
    for (index, observation) in observations.iter().enumerate() {
        let sequence = observation
            .get("sequence")
            .and_then(Value::as_u64)
            .ok_or("observation sequence missing")?;
        assert_eq!(sequence, index as u64 + 1, "sequences are dense from 1");
        for digest_field in [
            "effect_digest",
            "state_digest",
            "snapshot_digest",
            "ui_projection_digest",
            "mechanical_digest",
            "kernel_determinism_digest",
            "presentation_plan_digest",
            "control_digest",
            "rng_audit_digest",
            "internal_events_digest",
            "live_resources_digest",
        ] {
            let digest = observation
                .get(digest_field)
                .and_then(Value::as_str)
                .ok_or_else(|| format!("{digest_field} missing at event {index}"))?;
            assert!(
                digest.starts_with("blake3-v1:") && digest.len() == "blake3-v1:".len() + 64,
                "{digest_field} at event {index} is not a checked blake3 digest"
            );
        }
        // Ordered evidence, never only final digests.
        assert!(
            observation
                .get("effects")
                .map(Value::is_array)
                .unwrap_or(false)
        );
        assert!(
            observation
                .get("rng_audit")
                .map(Value::is_array)
                .unwrap_or(false)
        );
        assert!(
            observation
                .get("internal_events")
                .map(Value::is_array)
                .unwrap_or(false)
        );
    }

    // Boundary evidence: destroy/restore equality plus prepared identity.
    let boundary = report.get("snapshot_boundary").ok_or("boundary missing")?;
    let snapshot_digest = boundary
        .get("snapshot_digest")
        .and_then(Value::as_str)
        .ok_or("snapshot digest missing")?;
    let restored_digest = boundary
        .get("restored_snapshot_digest")
        .and_then(Value::as_str)
        .ok_or("restored snapshot digest missing")?;
    assert_eq!(snapshot_digest, restored_digest);
    assert!(
        boundary
            .get("pending_presentation_count")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            > 0,
        "boundary must retain a presentation continuation"
    );
    let coverage = report.get("coverage").ok_or("coverage missing")?;
    assert_eq!(
        coverage.get("raw_event_count").and_then(Value::as_u64),
        Some(final_evidence_fixture().events.len() as u64)
    );
    assert!(
        coverage
            .get("presentation_settlement_count")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            >= 1
    );
    // Prepared identity must equal the compiled frozen-catalog identity.
    let prepared = boundary
        .get("prepared_content")
        .ok_or("prepared identity missing")?;
    assert_eq!(
        prepared.get("battle_content_hash").and_then(Value::as_str),
        Some(EVIDENCE.identity.battle_content_hash.as_str())
    );
    assert_eq!(
        prepared
            .get("semantic_catalog_hash")
            .and_then(Value::as_str),
        Some(EVIDENCE.identity.semantic_catalog_hash.as_str())
    );
    assert_eq!(
        prepared
            .get("mechanics_program_version")
            .and_then(Value::as_u64),
        Some(M6_MECHANICS_PROGRAM_VERSION as u64)
    );
    Ok(())
}

#[test]
fn first_divergence_names_exact_event_and_field() -> Result<(), Box<dyn Error>> {
    let left = report_value_for_evidence()?;
    assert!(first_divergence(&left, &left).is_none());

    let mut right = left.clone();
    let original = left["observations"][2]["state_digest"]
        .as_str()
        .ok_or("state_digest missing")?
        .to_string();
    let mut bytes = original.into_bytes();
    bytes[10] = if bytes[10] == b'a' { b'b' } else { b'a' };
    right["observations"][2]["state_digest"] = Value::String(String::from_utf8(bytes)?);

    let divergence =
        first_divergence(&left, &right).ok_or("planted divergence was not detected")?;
    assert!(
        divergence.path.starts_with("/observations/2/state_digest"),
        "unexpected divergence path {}",
        divergence.path
    );
    let expected_sequence = left["observations"][2]["sequence"].as_u64();
    assert_eq!(divergence.sequence, expected_sequence);
    Ok(())
}

#[test]
fn tampered_traces_fail_closed() -> Result<(), Box<dyn Error>> {
    let trace = final_evidence_trace_json()?;
    let value: Value = serde_json::from_str(&trace)?;

    // Leading whitespace is valid JSON but not the exact canonical artifact.
    let noncanonical = format!(" {trace}");
    assert!(parse_serialized_trace(&noncanonical).is_err());

    // Wrong schema version.
    let mut wrong_schema = value.clone();
    wrong_schema["schema_version"] = json!(M6_PARITY_FIXTURE_SCHEMA_VERSION + 1);
    assert!(parse_serialized_trace(&wrong_schema.to_string()).is_err());

    // Wrong trace identity.
    let mut wrong_identity = value.clone();
    wrong_identity["trace_id"] = json!("m6-local-battle-native-wasm-v1-tampered");
    assert!(parse_serialized_trace(&wrong_identity.to_string()).is_err());

    // Virtual-time regression.
    let mut regressed = value.clone();
    regressed["events"][3]["virtual_time_ms"] = json!(0);
    assert!(parse_serialized_trace(&regressed.to_string()).is_err());

    // Unknown field injection.
    let mut unknown = value;
    unknown["unexpected"] = json!(true);
    assert!(parse_serialized_trace(&unknown.to_string()).is_err());
    Ok(())
}

#[test]
fn tampered_snapshot_v5_and_game_state_v4_fail_closed() -> Result<(), Box<dyn Error>> {
    let v5_wire = final_evidence_snapshot_v5_json(parity_evidence())?;

    // Schema-version tamper survives deserialization but must fail validation.
    let v5: Value = serde_json::from_str(&v5_wire)?;
    let mut wrong_schema = v5.clone();
    wrong_schema["schema_version"] = json!(99);
    let decoded: RestorableKernelSnapshotV5 = serde_json::from_str(&wrong_schema.to_string())?;
    assert!(decoded.validate().is_err(), "tampered schema must reject");

    // Content-identity tamper with a well-formed foreign hash must reject.
    let mut wrong_hash = v5;
    wrong_hash["runtime"]["state"]["battle_content_hash_v3"] =
        json!(format!("blake3-v3:{}", "f".repeat(64)));
    let decoded: RestorableKernelSnapshotV5 = serde_json::from_str(&wrong_hash.to_string())?;
    assert!(
        decoded.validate().is_err(),
        "foreign content identity must reject"
    );

    // GameStateV4 rejects unknown fields outright (deny_unknown_fields).
    let v4_wire = final_evidence_game_state_v4_json(parity_evidence())?;
    let mut v4: Value = serde_json::from_str(&v4_wire)?;
    v4["unexpected"] = json!(1);
    assert!(
        serde_json::from_str::<GameStateV4>(&v4.to_string()).is_err(),
        "unknown GameStateV4 fields must fail closed"
    );
    let mut wrong_state_schema: Value = serde_json::from_str(&v4_wire)?;
    wrong_state_schema["schema_version"] = json!(99);
    let decoded: GameStateV4 = serde_json::from_str(&wrong_state_schema.to_string())?;
    assert!(
        decoded.validate().is_err(),
        "tampered state schema must reject"
    );
    Ok(())
}

#[test]
fn tampered_turn_material_bytes_fail_closed() -> Result<(), Box<dyn Error>> {
    let bytes = final_evidence_turn_material_bytes(parity_evidence())?;
    assert!(!bytes.is_empty());
    decode_turn_material(&bytes).expect("canonical material decodes");
    for flip_at in [0usize, bytes.len() / 2, bytes.len() - 1] {
        let mut tampered = bytes.clone();
        tampered[flip_at] ^= 0x01;
        assert!(
            decode_turn_material(&tampered).is_err(),
            "flipped byte at {flip_at} must fail exact canonical decoding"
        );
    }
    Ok(())
}

#[test]
fn artifacts_agree_with_the_published_report() -> Result<(), Box<dyn Error>> {
    let artifacts = final_evidence_artifacts(parity_evidence())?;
    let report = report_value_for_evidence()?;
    let boundary = report.get("snapshot_boundary").ok_or("boundary missing")?;

    // V5 wire parses, validates, and carries the reported identity.
    let v5: RestorableKernelSnapshotV5 = serde_json::from_str(&artifacts.snapshot_v5_wire)?;
    v5.validate()?;
    assert_eq!(
        artifacts.game_state_v4_wire.is_empty(),
        artifacts.snapshot_v5_wire.is_empty()
    );

    // Material digest recorded in the report matches recomputation.
    let material = decode_turn_material(&artifacts.turn_material_bytes)?;
    let digest = turn_material_digest(&material)?;
    assert_eq!(
        boundary.get("turn_material_digest").and_then(Value::as_str),
        Some(digest.as_str())
    );
    Ok(())
}

#[test]
fn safe_helper_remains_total() {
    assert_eq!(safe(1).into_inner(), 1);
}
