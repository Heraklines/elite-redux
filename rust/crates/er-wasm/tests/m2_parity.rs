#[path = "../src/m2_parity.rs"]
mod m2_parity;

use m2_parity::{
    ParityReplayError, deserialize_seed_json, parse_fixture, replay_fixture, replay_fixture_json,
    serialize_seed_json,
};
use serde_json::{Value, json};

const RAW_INPUT_FIXTURE: &str =
    include_str!("../../../fixtures/v1/m2-parity/game-kernel-raw-input.json");
const PROTOCOL_FIXTURE: &str =
    include_str!("../../../fixtures/v1/m2-parity/replica-authority-v2-command.json");

#[test]
fn native_replay_checks_every_frozen_event_boundary() -> Result<(), Box<dyn std::error::Error>> {
    let report = replay_fixture_json(RAW_INPUT_FIXTURE)?;
    let report_value: Value = serde_json::from_str(&report)?;
    let fixture = parse_fixture(RAW_INPUT_FIXTURE)?;

    assert_eq!(report_value["seed"], json!("18446744073709551615"));
    assert_eq!(
        report_value["replayed_events"],
        json!(fixture.trace.events.len())
    );
    let observations = report_value["observations"]
        .as_array()
        .ok_or("replay report observations are not an array")?;
    assert_eq!(observations.len(), fixture.trace.events.len());
    for observation in observations {
        for field in [
            "effect_digest",
            "state_digest",
            "ui_digest",
            "live_resources",
            "live_resources_digest",
        ] {
            assert!(
                observation.get(field).is_some(),
                "missing per-event {field}"
            );
        }
    }
    Ok(())
}

#[test]
fn divergence_reports_first_sequence_seed_and_virtual_time()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture: Value = serde_json::from_str(RAW_INPUT_FIXTURE)?;
    fixture["events"][2]["expected_effect_digest"] = json!("intentionally-divergent");
    let mutated = serde_json::to_string(&fixture)?;

    let result = replay_fixture_json(&mutated);
    let error = result
        .err()
        .ok_or("mutated fixture unexpectedly replayed")?;
    match error {
        ParityReplayError::Divergence(divergence) => {
            assert_eq!(divergence.sequence.get(), 2);
            assert_eq!(divergence.seed, "18446744073709551615");
            assert_eq!(divergence.virtual_time_ms.get(), 250);
            assert_ne!(
                divergence.expected_effect_digest,
                divergence.actual_effect_digest
            );
            let evidence = m2_parity::divergence_value(&divergence);
            assert_eq!(evidence["seed"], json!("18446744073709551615"));
            assert_eq!(evidence["sequence"], json!(2));
            assert_eq!(evidence["virtual_time_ms"], json!(250));
            assert!(evidence.get("expected_live_resources_digest").is_some());
            assert!(evidence.get("actual_live_resources_digest").is_some());
        }
        other => return Err(format!("expected divergence, got {other:?}").into()),
    }
    Ok(())
}

#[test]
fn seed_boundary_is_lossless_and_numeric_json_is_rejected() {
    let valid = [
        ("0", 0_u64),
        ("9007199254740991", 9_007_199_254_740_991_u64),
        ("9007199254740992", 9_007_199_254_740_992_u64),
        ("18446744073709551615", u64::MAX),
    ];
    for (text, expected) in valid {
        assert_eq!(deserialize_seed_json(&format!("\"{text}\"")), Ok(expected));
        assert_eq!(serialize_seed_json(expected), format!("\"{text}\""));
    }

    for invalid in [
        "-1",
        "+1",
        "01",
        " 1",
        "1 ",
        "1e3",
        "",
        "18446744073709551616",
    ] {
        let encoded = format!("\"{invalid}\"");
        assert!(
            deserialize_seed_json(&encoded).is_err(),
            "accepted non-canonical seed {invalid:?}"
        );
    }
    for numeric_json in [
        "0",
        "9007199254740991",
        "9007199254740992",
        "18446744073709551615",
    ] {
        assert!(
            deserialize_seed_json(numeric_json).is_err(),
            "accepted numeric JSON seed {numeric_json}"
        );
    }
}

#[test]
fn protocol_fixture_pins_m2_boundaries_until_kernel_commit()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = parse_fixture(PROTOCOL_FIXTURE)?;
    assert_eq!(fixture.seed, u64::MAX);
    assert!(fixture.protocol_config.is_some());
    assert!(matches!(
        fixture.protocol_config.as_ref().map(|config| &config.role),
        Some(er_kernel::ProtocolRoleConfig::Replica { .. })
    ));
    assert_eq!(
        fixture.expected_evidence_status.as_deref(),
        Some("M2B-01 er-kernel protocol composition commit")
    );
    let Some(er_kernel::ControlMenuPlan::Command { proposals, .. }) = fixture
        .protocol_config
        .as_ref()
        .and_then(|config| config.menu_plans.first())
    else {
        return Err("protocol fixture is missing its command menu proposal".into());
    };
    assert_eq!(proposals.len(), 1);
    assert_eq!(
        proposals[0].fingerprint,
        r#"[0,"command",0,{"surface":"command","option":"move:first","operation":"operation/m2-parity"},null]"#
    );

    let kernel = er_kernel::GameKernel::new(er_kernel::KernelConfig {
        input_map: fixture.input_map.clone(),
        initial_ui: fixture.trace.initial_snapshot.ui.clone(),
        protocol: fixture.protocol_config.clone(),
    });
    assert!(kernel.protocol_config().is_some());

    let mut saw_raw_input = false;
    let mut saw_timer = false;
    let mut saw_authority_frame = false;
    let mut saw_material = false;
    let mut saw_control = false;
    let mut saw_presentation = false;
    let mut saw_transport = false;
    for event in &fixture.trace.events {
        match &event.input {
            er_types::KernelInput::RawInput { .. } => saw_raw_input = true,
            er_types::KernelInput::TimerFired { .. } => saw_timer = true,
            er_types::KernelInput::NetworkFrame { .. } => saw_authority_frame = true,
            er_types::KernelInput::MaterialApplied { .. } => saw_material = true,
            er_types::KernelInput::ControlProjected { .. } => saw_control = true,
            er_types::KernelInput::PresentationSettled { .. } => saw_presentation = true,
            er_types::KernelInput::TransportChanged { .. } => saw_transport = true,
            _ => {}
        }
        assert!(event.expected_effect_digest.starts_with("PENDING_M2B_01"));
        assert!(event.expected_state_digest.starts_with("PENDING_M2B_01"));
        assert!(event.expected_ui_digest.starts_with("PENDING_M2B_01"));
    }
    assert!(saw_raw_input);
    assert!(saw_timer);
    assert!(saw_authority_frame);
    assert!(saw_material);
    assert!(saw_control);
    assert!(saw_presentation);
    assert!(saw_transport);

    let raw: Value = serde_json::from_str(PROTOCOL_FIXTURE)?;
    assert_eq!(raw["protocol_environment"]["role"], json!("replica"));
    assert_eq!(raw["protocol_environment"]["local_seat"], json!(1));
    assert_eq!(raw["protocol_environment"]["authority_seat"], json!(0));
    assert_eq!(
        raw["protocol_environment"]["control_id"],
        json!("COMMAND_FRONTIER/e1/w1/t1/f0:s1:p42")
    );
    for event in raw["events"]
        .as_array()
        .ok_or("protocol fixture events are not an array")?
    {
        for field in [
            "timers",
            "presentations",
            "storage_requests",
            "delivery_leases",
            "proposal_leases",
            "recovery_transactions",
            "waits",
            "retained_revisions",
            "controls",
            "network_packets",
        ] {
            assert!(
                event["expected_live_resources"].get(field).is_some(),
                "protocol fixture missing per-event live resource field {field}"
            );
        }
    }

    match replay_fixture(&fixture) {
        Err(ParityReplayError::PendingEvidence { dependency }) => {
            assert_eq!(dependency, "M2B-01 er-kernel protocol composition commit");
        }
        other => return Err(format!("expected pending protocol evidence, got {other:?}").into()),
    }
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
#[ignore = "CALIBRATION ONLY: writes evidence and intentionally fails non-acceptance"]
fn protocol_fixture_hosted_calibration() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = parse_fixture(PROTOCOL_FIXTURE)?;
    assert_eq!(fixture.trace.events.len(), 10);
    assert_eq!(
        fixture.expected_evidence_status.as_deref(),
        Some("M2B-01 er-kernel protocol composition commit")
    );

    let artifact = m2_parity::calibrate_pending_fixture_json(PROTOCOL_FIXTURE)?;
    let artifact_value: Value = serde_json::from_str(&artifact)?;
    assert_eq!(
        artifact_value["status"],
        json!(m2_parity::CALIBRATION_ONLY_STATUS)
    );
    assert_eq!(artifact_value["accepted_parity"], json!(false));
    assert_eq!(artifact_value["seed"], json!("18446744073709551615"));
    assert_eq!(artifact_value["event_count"], json!(10));
    let observations = artifact_value["observations"]
        .as_array()
        .ok_or("calibration observations are not an array")?;
    assert_eq!(observations.len(), 10);
    for (sequence, observation) in observations.iter().enumerate() {
        assert_eq!(observation["seed"], json!("18446744073709551615"));
        assert_eq!(observation["sequence"], json!(sequence));
        assert_eq!(
            observation["virtual_time_ms"],
            json!(fixture.trace.events[sequence].virtual_time_ms)
        );
        for field in [
            "effects",
            "effect_digest",
            "state",
            "state_digest",
            "ui",
            "ui_digest",
            "live_resources",
            "live_resources_digest",
        ] {
            assert!(
                observation.get(field).is_some(),
                "calibration observation {sequence} is missing {field}"
            );
        }
    }

    let output_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join("rust-ci-summary");
    std::fs::create_dir_all(&output_dir)?;
    let output_path = output_dir.join("m2-parity-calibration.json");
    std::fs::write(&output_path, format!("{artifact}\n"))?;

    Err(format!(
        "{}: wrote 10 observations to {}; this hosted calibration intentionally fails and is not parity acceptance",
        m2_parity::CALIBRATION_ONLY_STATUS,
        output_path.display()
    )
    .into())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
#[ignore = "CALIBRATION ONLY: writes raw-input evidence and intentionally fails non-acceptance"]
fn raw_input_fixture_hosted_calibration() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = parse_fixture(RAW_INPUT_FIXTURE)?;
    assert_eq!(
        fixture.trace.events.len(),
        m2_parity::RAW_INPUT_CALIBRATION_EVENT_COUNT
    );
    assert_eq!(fixture.seed, u64::MAX);
    assert!(fixture.protocol_config.is_none());
    assert!(fixture.expected_evidence_status.is_none());
    assert_eq!(fixture.trace.header.trace_version, 1);
    assert_eq!(fixture.trace.header.schema_version, 1);
    assert_eq!(
        fixture.trace.header.oracle_game_sha,
        "3b534099919efae827019d4a3f3c4ab0ecd6d67b"
    );
    assert_eq!(fixture.trace.header.protocol_version, "er-coop-47");
    assert_eq!(
        fixture.trace.header.content_hash,
        "blake3-v1:m2-parity-game-kernel-raw-input"
    );
    assert_eq!(fixture.trace.header.rust_toolchain, "1.97.1");
    for (sequence, event) in fixture.trace.events.iter().enumerate() {
        assert_eq!(event.sequence.get(), sequence as u64);
        assert_eq!(
            event.expected_effect_digest,
            m2_parity::RAW_INPUT_CALIBRATION_PENDING_DIGEST
        );
        assert_eq!(
            event.expected_state_digest,
            m2_parity::RAW_INPUT_CALIBRATION_PENDING_DIGEST
        );
        assert_eq!(
            event.expected_ui_digest,
            m2_parity::RAW_INPUT_CALIBRATION_PENDING_DIGEST
        );
    }

    let artifact = m2_parity::calibrate_raw_input_fixture_json(RAW_INPUT_FIXTURE)?;
    let artifact_value: Value = serde_json::from_str(&artifact)?;
    assert_eq!(
        artifact_value["status"],
        json!(m2_parity::CALIBRATION_ONLY_STATUS)
    );
    assert_eq!(artifact_value["accepted_parity"], json!(false));
    assert_eq!(
        artifact_value["fixture_id"],
        json!("game-kernel-raw-input-v1")
    );
    assert_eq!(
        artifact_value["fixture_path"],
        json!("rust/fixtures/v1/m2-parity/game-kernel-raw-input.json")
    );
    assert!(artifact_value["protocol_config"].is_null());
    assert_eq!(artifact_value["seed"], json!("18446744073709551615"));
    assert_eq!(artifact_value["event_count"], json!(23));

    for field in [
        "state",
        "state_digest",
        "ui",
        "ui_digest",
        "live_resources",
        "live_resources_digest",
    ] {
        assert!(
            artifact_value["initial"].get(field).is_some(),
            "calibration initial observation is missing {field}"
        );
    }
    let observations = artifact_value["observations"]
        .as_array()
        .ok_or("raw-input calibration observations are not an array")?;
    assert_eq!(observations.len(), 23);
    for (sequence, observation) in observations.iter().enumerate() {
        assert_eq!(observation["seed"], json!("18446744073709551615"));
        assert_eq!(observation["sequence"], json!(sequence));
        assert_eq!(
            observation["virtual_time_ms"],
            json!(fixture.trace.events[sequence].virtual_time_ms)
        );
        for field in [
            "effects",
            "effect_digest",
            "state",
            "state_digest",
            "ui",
            "ui_digest",
            "live_resources",
            "live_resources_digest",
        ] {
            assert!(
                observation.get(field).is_some(),
                "raw-input calibration observation {sequence} is missing {field}"
            );
        }
    }

    let output_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join("rust-ci-summary");
    std::fs::create_dir_all(&output_dir)?;
    let output_path = output_dir.join("m2-raw-input-calibration.json");
    std::fs::write(&output_path, format!("{artifact}\n"))?;

    Err(format!(
        "{}: wrote 23 observations to {}; this hosted calibration intentionally fails and is not parity acceptance",
        m2_parity::CALIBRATION_ONLY_STATUS,
        output_path.display()
    )
    .into())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_node_replay_uses_the_same_frozen_fixture() -> Result<(), Box<dyn std::error::Error>> {
    let report = replay_fixture_json(RAW_INPUT_FIXTURE)?;
    let report_value: Value = serde_json::from_str(&report)?;
    let fixture = parse_fixture(RAW_INPUT_FIXTURE)?;
    assert_eq!(report_value["seed"], json!("18446744073709551615"));
    assert_eq!(
        report_value["replayed_events"],
        json!(fixture.trace.events.len())
    );
    assert_eq!(
        report_value["observations"]
            .as_array()
            .map(|events| events.len()),
        Some(fixture.trace.events.len())
    );
    Ok(())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_node_protocol_fixture_uses_the_same_pending_boundary_shape()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = parse_fixture(PROTOCOL_FIXTURE)?;
    assert_eq!(fixture.seed, u64::MAX);
    assert_eq!(fixture.trace.events.len(), 10);
    assert!(fixture.protocol_config.is_some());
    assert_eq!(
        fixture.expected_evidence_status.as_deref(),
        Some("M2B-01 er-kernel protocol composition commit")
    );
    Ok(())
}
