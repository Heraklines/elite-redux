use std::error::Error;

use er_kernel::KernelInput;

#[cfg(target_arch = "wasm32")]
use er_wasm::m3_parity;
use er_wasm::m3_parity::{
    M3_PARITY_FIXTURE_SCHEMA_VERSION, M3_PARITY_TRACE_ID, M3ParityError, final_evidence_fixture,
    final_evidence_report_json, final_evidence_trace_json, parse_serialized_trace,
    replay_eventwise, replay_serialized_trace_json,
};

type TestResult = Result<(), Box<dyn Error>>;

const M3_COVERAGE_MAP: &str = include_str!("../../../fixtures/m3/m3-coverage-map.json");

fn assert_eventwise_contract() -> TestResult {
    let fixture = final_evidence_fixture();
    assert!(
        fixture
            .events
            .iter()
            .all(|event| matches!(&event.input, KernelInput::RawInput { .. })),
        "M3 parity fixture must cross the raw physical-input boundary for every event"
    );
    assert_eq!(fixture.snapshot_boundary_after.get(), 3);
    let serialized_trace = final_evidence_trace_json()?;
    let parsed = parse_serialized_trace(&serialized_trace)?;
    assert_eq!(parsed, fixture);
    let report = replay_eventwise(&fixture)?;

    assert_eq!(report.schema_version, M3_PARITY_FIXTURE_SCHEMA_VERSION);
    assert_eq!(report.trace_id, M3_PARITY_TRACE_ID);
    assert_eq!(report.seed, fixture.seed);
    assert_eq!(
        report.coverage.raw_event_count.get(),
        fixture.events.len() as u64
    );
    assert!(report.coverage.presentation_settlement_count.get() > 0);
    assert!(report.coverage.continuation_input_count.get() > 0);
    assert_eq!(report.snapshot_boundary.after_raw_event.get(), 3);
    assert_eq!(report.snapshot_boundary.snapshot_schema_version, 2);
    assert!(report.snapshot_boundary.pending_presentation_count.get() > 0);
    assert_eq!(
        report.snapshot_boundary.snapshot_digest,
        report.snapshot_boundary.restored_snapshot_digest
    );
    assert!(
        report
            .observations
            .iter()
            .any(|observation| observation.input_kind == "BATTLE_PRESENTATION_OUTCOME")
    );
    assert!(
        report
            .observations
            .iter()
            .any(|observation| observation.battle_turn.get().get() > 1)
    );
    let last_event_time = fixture
        .events
        .last()
        .ok_or("M3 parity fixture has no final event")?
        .virtual_time_ms;
    for (index, observation) in report.observations.iter().enumerate() {
        assert_eq!(observation.sequence.get(), (index + 1) as u64);
        assert!(observation.virtual_time_ms <= last_event_time);
        assert!(!observation.effect_digest.is_empty());
        assert!(!observation.state_digest.is_empty());
        assert!(!observation.snapshot_digest.is_empty());
        assert!(!observation.ui_projection_digest.is_empty());
        assert!(!observation.rng_audit_digest.is_empty());
        assert!(!observation.internal_events_digest.is_empty());
        assert!(!observation.live_resources_digest.is_empty());
    }
    let rng_audit = report
        .observations
        .iter()
        .flat_map(|observation| &observation.rng_audit)
        .collect::<Vec<_>>();
    assert!(
        !rng_audit.is_empty(),
        "M3 parity trace emitted no RNG audit"
    );
    for draw in &rng_audit {
        draw.validate()?;
    }
    assert!(rng_audit.windows(2).all(|pair| {
        pair[0]
            .sequence
            .get()
            .checked_add(1)
            .is_some_and(|expected| pair[1].sequence.get() == expected)
    }));
    assert!(
        report
            .observations
            .windows(2)
            .all(|pair| pair[1].sequence > pair[0].sequence),
        "M3 parity observations must be one-based and strictly eventwise"
    );
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn native_m3_replays_the_serialized_production_trace() -> TestResult {
    assert_eventwise_contract()
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn m3_parity_rejects_noncanonical_seed_without_running_a_kernel() {
    let mut fixture = final_evidence_fixture();
    fixture.seed = "001".to_owned();
    assert!(matches!(
        replay_eventwise(&fixture),
        Err(M3ParityError::InvalidFixture(_))
    ));
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn m3_eventwise_trace_is_registered_by_the_snapshot_coverage_contract() {
    for required in [
        "NATIVE_WASM_TEARDOWN_PERFORMANCE",
        "EVENTWISE_NATIVE_WASM_PARITY",
        "ZERO_LIVE_RESOURCES",
        "MEASURED_BASELINE_AND_REGRESSION_GATE",
        "rust/crates/er-wasm/tests/m3_parity.rs",
        "rust/crates/er-sim/tests/m3_resource_teardown.rs",
        "rust/crates/er-sim/benches/m3_benchmark.rs",
    ] {
        assert!(
            M3_COVERAGE_MAP.contains(required),
            "M3 coverage map lost final-evidence contract marker {required}"
        );
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn native_m3_eventwise_report_is_canonical_and_reproducible() -> TestResult {
    let trace = final_evidence_trace_json()?;
    let first = replay_serialized_trace_json(&trace)?;
    let second = final_evidence_report_json()?;
    assert_eq!(first, second);
    let value: serde_json::Value = serde_json::from_str(&first)?;
    assert_eq!(er_canonical::canonicalize_value(&value)?, first);
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn native_m3_serialized_trace_emits_hosted_report_artifact() -> TestResult {
    let trace = final_evidence_trace_json()?;
    let report = replay_serialized_trace_json(&trace)?;
    if let Some(directory) = std::env::var_os("M3_PARITY_ARTIFACT_DIR") {
        let directory = std::path::PathBuf::from(directory);
        std::fs::create_dir_all(&directory)?;
        std::fs::write(directory.join("trace.json"), trace.as_bytes())?;
        std::fs::write(directory.join("native-report.json"), report.as_bytes())?;
    }
    Ok(())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_node_replays_the_serialized_m3_production_trace() -> TestResult {
    assert_eventwise_contract()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_export_emits_the_shared_canonical_eventwise_report() -> Result<(), wasm_bindgen::JsValue>
{
    let trace = final_evidence_trace_json()
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
    let direct = replay_serialized_trace_json(&trace)
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
    let exported = m3_parity::final_evidence_report_json_wasm(&trace)?;
    assert_eq!(exported, direct);
    Ok(())
}
