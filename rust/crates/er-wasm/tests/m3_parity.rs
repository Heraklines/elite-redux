use std::error::Error;

use er_kernel::KernelInput;

use er_wasm::m3_parity;
use er_wasm::m3_parity::{
    M3_PARITY_FIXTURE_SCHEMA_VERSION, M3_PARITY_TRACE_ID, M3ParityError,
    final_evidence_fixture, final_evidence_report_json, replay_eventwise,
};

type TestResult = Result<(), Box<dyn Error>>;

const M3_COVERAGE_MAP: &str =
    include_str!("../../../fixtures/m3/m3-coverage-map.json");

fn assert_eventwise_contract() -> TestResult {
    let fixture = final_evidence_fixture();
    assert!(
        fixture
            .events
            .iter()
            .all(|event| matches!(&event.input, KernelInput::RawInput { .. })),
        "M3 parity fixture must cross the raw physical-input boundary for every event"
    );
    let report = replay_eventwise(&fixture)?;

    assert_eq!(report.schema_version, M3_PARITY_FIXTURE_SCHEMA_VERSION);
    assert_eq!(report.trace_id, M3_PARITY_TRACE_ID);
    assert_eq!(report.seed, fixture.seed);
    assert_eq!(report.observations.len(), fixture.events.len());
    for (index, observation) in report.observations.iter().enumerate() {
        assert_eq!(observation.sequence.get(), (index + 1) as u64);
        assert_eq!(
            observation.virtual_time_ms,
            fixture.events[index].virtual_time_ms
        );
        assert!(!observation.effect_digest.is_empty());
        assert!(!observation.state_digest.is_empty());
        assert!(!observation.snapshot_digest.is_empty());
        assert!(!observation.ui_projection_digest.is_empty());
        assert!(!observation.live_resources_digest.is_empty());
    }
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
fn native_eventwise_m3_battle_trace_matches_an_independent_kernel() -> TestResult {
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
    let first = final_evidence_report_json()?;
    let second = final_evidence_report_json()?;
    assert_eq!(first, second);
    let value: serde_json::Value = serde_json::from_str(&first)?;
    assert_eq!(er_canonical::canonicalize_value(&value)?, first);
    Ok(())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_node_eventwise_m3_battle_trace_matches_the_native_trace_definition() -> TestResult {
    assert_eventwise_contract()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_export_emits_the_shared_canonical_eventwise_report(
) -> Result<(), wasm_bindgen::JsValue> {
    let direct = final_evidence_report_json()
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
    let exported = m3_parity::final_evidence_report_json_wasm()?;
    assert_eq!(exported, direct);
    Ok(())
}
