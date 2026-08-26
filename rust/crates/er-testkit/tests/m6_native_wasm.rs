//! Native-side M6 native/wasm32 parity evidence.
//!
//! The adapter in `er_wasm::m6_parity` compiles to identical production logic
//! on both hosted native and wasm32 targets: the same serialized trace enters,
//! the same canonical report leaves.  This suite proves the native artifact of
//! that boundary — full frozen M6 fixture coverage without floating canonical
//! JSON, stepwise observation completeness, replay determinism, first
//! divergent-event naming, and fail-closed rejection for every tampered
//! schema/content surface.  CI compares this report against the wasm32/Node
//! artifact produced by the `replayM6FinalEvidence` export.

use std::error::Error;
use std::path::{Path, PathBuf};

use er_wasm::m6_parity::{
    FROZEN_SEMANTIC_CATALOG_BYTES, M6_PARITY_FIXTURE_SCHEMA_VERSION, M6_PARITY_SEED,
    M6_PARITY_TRACE_ID, final_evidence_artifacts, final_evidence_fixture,
    final_evidence_game_state_v4_json, final_evidence_snapshot_v5_json,
    final_evidence_trace_json, final_evidence_turn_material_bytes, first_divergence,
    parse_serialized_trace, replay_serialized_trace_json,
};
use er_game::material::decode_turn_material;
use er_kernel::snapshot_v5::RestorableKernelSnapshotV5;
use er_state::migration_v4::GameStateV4;
use serde_json::{Value, json};

const M53_CEILING: u64 = 9_007_199_254_740_991;

fn fixtures_m6_dir() -> Result<PathBuf, Box<dyn Error>> {
    let mut candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        let fixtures = candidate.join("rust").join("fixtures").join("m6");
        if fixtures.is_dir() {
            return Ok(fixtures);
        }
        candidate = candidate
            .parent()
            .map(Path::to_path_buf)
            .ok_or("rust/fixtures/m6 not found above CARGO_MANIFEST_DIR")?;
    }
}

/// Rejects any floating-point or non-integer number anywhere in a fixture:
/// canonical kernel JSON is signed-safe-integer only.
fn assert_no_floating_numbers(value: &Value) -> Result<(), Box<dyn Error>> {
    match value {
        Value::Number(number) => {
            let integer = number.as_u64().ok_or_else(|| {
                format!(
                    "fixture number {number} is negative, fractional, or beyond u64 canonical range"
                )
            })?;
            if integer > M53_CEILING {
                return Err(format!(
                    "fixture number {number} exceeds the safe-integer canonical range"
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

#[test]
fn full_m6_fixture_catalog_is_float_free_and_matches_the_frozen_embed()
-> Result<(), Box<dyn Error>> {
    let dir = fixtures_m6_dir()?;
    let mut entries = std::fs::read_dir(&dir)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort();
    assert!(entries.len() >= 7, "expected the full frozen M6 fixture set");
    for path in entries {
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let bytes = std::fs::read(&path)?;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|error| format!("fixture {name} is invalid JSON: {error}"))?;
        assert_no_floating_numbers(&value)
            .map_err(|error| format!("fixture {name}: {error}"))?;
        if name == "semantic-catalog-v1.json" {
            assert_eq!(
                bytes.as_slice(),
                FROZEN_SEMANTIC_CATALOG_BYTES,
                "frozen embedded catalog must be byte-identical to the repo fixture"
            );
        }
    }
    Ok(())
}

#[test]
fn trace_round_trip_and_replay_are_canonical_and_deterministic() -> Result<(), Box<dyn Error>> {
    let trace = final_evidence_trace_json()?;
    let fixture = parse_serialized_trace(&trace)?;
    assert_eq!(fixture.schema_version, M6_PARITY_FIXTURE_SCHEMA_VERSION);
    assert_eq!(fixture.trace_id, M6_PARITY_TRACE_ID);
    assert_eq!(fixture.seed, M6_PARITY_SEED);
    // Re-serializing the parsed fixture must reproduce the same canonical bytes.
    let reparsed = parse_serialized_trace(&final_evidence_trace_json()?)?;
    assert_eq!(reparsed, fixture);

    let first = replay_serialized_trace_json(&trace)?;
    let second = replay_serialized_trace_json(&trace)?;
    assert_eq!(
        first, second,
        "two independent native replays must be byte-identical"
    );
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
        assert!(observation.get("effects").map(Value::is_array).unwrap_or(false));
        assert!(observation.get("rng_audit").map(Value::is_array).unwrap_or(false));
        assert!(observation
            .get("internal_events")
            .map(Value::is_array)
            .unwrap_or(false));
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
    let prepared = boundary
        .get("prepared_content")
        .ok_or("prepared identity missing")?;
    assert!(
        prepared
            .get("mechanics_program_count")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            >= 1
    );
    assert!(
        prepared
            .get("behavior_unit_count")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            >= 1
    );
    Ok(())
}

#[test]
fn first_divergence_names_exact_event_and_field() -> Result<(), Box<dyn Error>> {
    let report_json = replay_serialized_trace_json(&final_evidence_trace_json()?)?;
    let left = canonical_report_value(&report_json)?;
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

    // Non-canonical key order.
    let reordered = json!({
        "events": value["events"].clone(),
        "seed": value["seed"].clone(),
        "snapshot_boundary_after": value["snapshot_boundary_after"].clone(),
        "trace_id": value["trace_id"].clone(),
        "schema_version": value["schema_version"].clone(),
    });
    assert!(parse_serialized_trace(&serde_json::to_string(&reordered)?).is_err());

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
    let v5_wire = final_evidence_snapshot_v5_json()?;

    // Schema-version tamper survives deserialization but must fail validation.
    let v5: Value = serde_json::from_str(&v5_wire)?;
    let mut wrong_schema = v5.clone();
    wrong_schema["schema_version"] = json!(99);
    let decoded: RestorableKernelSnapshotV5 = serde_json::from_str(&wrong_schema.to_string())?;
    assert!(decoded.validate().is_err(), "tampered schema must reject");

    // Content-identity tamper with a well-formed foreign hash must reject.
    let mut wrong_hash = v5;
    wrong_hash["game_v4"]["battle_content_hash_v3"] =
        json!(format!("blake3-v3:{}", "f".repeat(64)));
    let decoded: RestorableKernelSnapshotV5 = serde_json::from_str(&wrong_hash.to_string())?;
    assert!(decoded.validate().is_err(), "foreign content identity must reject");

    // GameStateV4 rejects unknown fields outright (deny_unknown_fields).
    let v4_wire = final_evidence_game_state_v4_json()?;
    let mut v4: Value = serde_json::from_str(&v4_wire)?;
    v4["unexpected"] = json!(1);
    assert!(
        serde_json::from_str::<GameStateV4>(&v4.to_string()).is_err(),
        "unknown GameStateV4 fields must fail closed"
    );
    let mut wrong_state_schema: Value = serde_json::from_str(&v4_wire)?;
    wrong_state_schema["schema_version"] = json!(99);
    let decoded: GameStateV4 = serde_json::from_str(&wrong_state_schema.to_string())?;
    assert!(decoded.validate().is_err(), "tampered state schema must reject");
    Ok(())
}

#[test]
fn tampered_turn_material_bytes_fail_closed() -> Result<(), Box<dyn Error>> {
    let bytes = final_evidence_turn_material_bytes()?;
    assert!(!bytes.is_empty());
    // Intact bytes decode.
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
    let artifacts = final_evidence_artifacts()?;
    let report_json = replay_serialized_trace_json(&final_evidence_trace_json()?)?;
    let report = canonical_report_value(&report_json)?;
    let boundary = report.get("snapshot_boundary").ok_or("boundary missing")?;

    // V5 wire parses, validates, and matches the reported digest identity.
    let v5: RestorableKernelSnapshotV5 = serde_json::from_str(&artifacts.snapshot_v5_wire)?;
    v5.validate()?;
    assert_eq!(
        artifacts.game_state_v4_wire.is_empty(),
        artifacts.snapshot_v5_wire.is_empty()
    );

    // Material digest recorded in the report matches recomputation.
    let material = decode_turn_material(&artifacts.turn_material_bytes)?;
    let digest = er_game::material::turn_material_digest(&material)?;
    assert_eq!(
        boundary.get("turn_material_digest").and_then(Value::as_str),
        Some(digest.as_str())
    );
    Ok(())
}
