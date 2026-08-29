#[path = "../src/m2_parity.rs"]
mod m2_parity;

use m2_parity::{
    ParityReplayError, deserialize_seed_json, parse_fixture, replay_fixture_json,
    serialize_seed_json,
};
use serde_json::{Value, json};

const RAW_INPUT_FIXTURE: &str =
    include_str!("../../../fixtures/v1/m2-parity/game-kernel-raw-input.json");
const PROTOCOL_FIXTURE: &str =
    include_str!("../../../fixtures/v1/m2-parity/replica-authority-v2-command.json");

fn assert_report_matches_fixture(
    report_value: &Value,
    fixture: &m2_parity::ParityFixture,
    event_count: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    assert_eq!(fixture.trace.events.len(), event_count);
    assert_eq!(report_value["seed"], json!(fixture.seed.to_string()));
    assert_eq!(report_value["replayed_events"], json!(event_count));
    let observations = report_value["observations"]
        .as_array()
        .ok_or("replay report observations are not an array")?;
    assert_eq!(observations.len(), event_count);

    for (sequence, (event, observation)) in
        fixture.trace.events.iter().zip(observations).enumerate()
    {
        assert_eq!(event.sequence.get(), sequence as u64);
        assert_eq!(
            observation["effect_digest"],
            json!(&event.expected_effect_digest),
            "effect digest diverged at sequence {sequence}"
        );
        assert_eq!(
            observation["state_digest"],
            json!(&event.expected_state_digest),
            "state digest diverged at sequence {sequence}"
        );
        assert_eq!(
            observation["ui_digest"],
            json!(&event.expected_ui_digest),
            "UI digest diverged at sequence {sequence}"
        );
        assert_eq!(
            observation["live_resources"],
            serde_json::to_value(&event.expected_live_resources)?,
            "live resources diverged at sequence {sequence}"
        );
        let live_resources_digest = observation["live_resources_digest"]
            .as_str()
            .ok_or_else(|| format!("missing live-resource digest at sequence {sequence}"))?;
        assert!(
            !live_resources_digest.is_empty(),
            "empty live-resource digest at sequence {sequence}"
        );
    }
    Ok(())
}

#[test]
fn native_raw_input_replay_accepts_all_frozen_event_boundaries()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = parse_fixture(RAW_INPUT_FIXTURE)?;
    assert_eq!(fixture.seed, u64::MAX);
    assert_eq!(fixture.trace.events.len(), 23);
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

    let report = replay_fixture_json(RAW_INPUT_FIXTURE)?;
    let report_value: Value = serde_json::from_str(&report)?;
    assert_report_matches_fixture(&report_value, &fixture, 23)?;
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
            let divergence = divergence.as_ref();
            assert_eq!(divergence.sequence.get(), 2);
            assert_eq!(divergence.seed, "18446744073709551615");
            assert_eq!(divergence.virtual_time_ms.get(), 250);
            assert_ne!(
                divergence.expected_effect_digest,
                divergence.actual_effect_digest
            );
            let evidence = m2_parity::divergence_value(divergence);
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
fn protocol_fixture_accepts_frozen_m2_boundaries() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = parse_fixture(PROTOCOL_FIXTURE)?;
    assert_eq!(fixture.seed, u64::MAX);
    assert_eq!(fixture.trace.events.len(), 10);
    assert!(fixture.protocol_config.is_some());
    assert!(matches!(
        fixture.protocol_config.as_ref().map(|config| &config.role),
        Some(er_kernel::ProtocolRoleConfig::Replica { .. })
    ));
    assert!(fixture.expected_evidence_status.is_none());
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
    let raw_events = raw["events"]
        .as_array()
        .ok_or("protocol fixture events are not an array")?;
    assert_eq!(raw_events.len(), 10);
    for (sequence, (raw_event, parsed_event)) in
        raw_events.iter().zip(&fixture.trace.events).enumerate()
    {
        assert_eq!(raw_event["sequence"], json!(sequence));
        assert_eq!(
            raw_event["expected_live_resources"],
            serde_json::to_value(&parsed_event.expected_live_resources)?,
            "protocol live-resource shape changed at sequence {sequence}"
        );
    }

    let report = replay_fixture_json(PROTOCOL_FIXTURE)?;
    let report_value: Value = serde_json::from_str(&report)?;
    assert_report_matches_fixture(&report_value, &fixture, 10)?;
    Ok(())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_node_raw_input_fixture_accepts_all_frozen_events()
-> Result<(), Box<dyn std::error::Error>> {
    let fixture = parse_fixture(RAW_INPUT_FIXTURE)?;
    assert_eq!(fixture.seed, u64::MAX);
    assert_eq!(fixture.trace.events.len(), 23);
    assert!(fixture.protocol_config.is_none());
    assert!(fixture.expected_evidence_status.is_none());

    let report = replay_fixture_json(RAW_INPUT_FIXTURE)?;
    let report_value: Value = serde_json::from_str(&report)?;
    assert_report_matches_fixture(&report_value, &fixture, 23)?;
    Ok(())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_node_protocol_fixture_accepts_frozen_replay() -> Result<(), Box<dyn std::error::Error>> {
    let fixture = parse_fixture(PROTOCOL_FIXTURE)?;
    assert_eq!(fixture.seed, u64::MAX);
    assert_eq!(fixture.trace.events.len(), 10);
    assert!(fixture.protocol_config.is_some());
    assert!(fixture.expected_evidence_status.is_none());

    let report = replay_fixture_json(PROTOCOL_FIXTURE)?;
    let report_value: Value = serde_json::from_str(&report)?;
    assert_report_matches_fixture(&report_value, &fixture, 10)?;
    Ok(())
}
