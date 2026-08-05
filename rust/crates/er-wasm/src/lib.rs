//! Wasm JSON boundary for native/schema/trace parity tests.

use er_canonical::{canonicalize, canonicalize_value, fixture_digest};
use er_types::KernelTrace;
use serde_json::Value;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn canonicalize_json(input: &str) -> Result<String, JsValue> {
    let value = parse_json(input)?;
    canonicalize_value(&value).map_err(js_error)
}

#[wasm_bindgen]
pub fn compatible_digest_json(input: &str) -> Result<String, JsValue> {
    let value = parse_json(input)?;
    fixture_digest(&value).map_err(js_error)
}

#[wasm_bindgen]
pub fn round_trip_kernel_trace(input: &str) -> Result<String, JsValue> {
    let trace: KernelTrace = serde_json::from_str(input).map_err(js_error)?;
    let canonical = canonicalize(&trace).map_err(js_error)?;
    let round_tripped: KernelTrace = serde_json::from_str(&canonical).map_err(js_error)?;
    if round_tripped != trace {
        return Err(js_error("KernelTrace changed during canonical round-trip"));
    }
    Ok(canonical)
}

fn parse_json(input: &str) -> Result<Value, JsValue> {
    serde_json::from_str(input).map_err(js_error)
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[cfg(all(test, target_arch = "wasm32"))]
pub mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    const FULL_KERNEL_TRACE: &str = r#"{
        "header": {
            "trace_version": 1,
            "schema_version": 1,
            "oracle_game_sha": "3b534099919efae827019d4a3f3c4ab0ecd6d67b",
            "protocol_version": "er-coop-47",
            "content_hash": "content-hash",
            "rust_toolchain": "1.97.1"
        },
        "initial_snapshot": {
            "ui": {
                "generation": 4,
                "owner_seat": 1,
                "actionable": true,
                "stack": [
                    {
                        "kind": "COMMAND",
                        "menu": {
                            "operation_id": "operation-1",
                            "control_id": "control-1",
                            "cursor": 0,
                            "options": [
                                {
                                    "id": "move",
                                    "label_key": "menu.move",
                                    "enabled": true,
                                    "visible": true
                                }
                            ],
                            "cancel": {"kind": "CLOSE"}
                        }
                    }
                ]
            },
            "state": {
                "counter": 0,
                "nested": {"z": false, "a": "trace"},
                "nullable": null
            }
        },
        "events": [
            {
                "sequence": 0,
                "virtual_time_ms": 0,
                "input": {
                    "kind": "RAW_INPUT",
                    "seat": 1,
                    "event": {
                        "kind": "KEY_DOWN",
                        "data": {
                            "code": {"kind": "KEY_A"},
                            "printable": true,
                            "browser_repeat": false,
                            "focus": "GAME"
                        }
                    }
                },
                "expected_effect_digest": "effect-0",
                "expected_state_digest": "state-0",
                "expected_ui_digest": "ui-0",
                "expected_live_resources": {
                    "timers": [0],
                    "presentations": [2],
                    "storage_requests": [3]
                }
            },
            {
                "sequence": 1,
                "virtual_time_ms": 250,
                "input": {
                    "kind": "NETWORK_FRAME",
                    "endpoint": 1,
                    "frame": {
                        "v": 2,
                        "t": "authorityEntry",
                        "ctx": {
                            "sessionId": "session-1",
                            "runId": "run-1",
                            "sessionEpoch": 1,
                            "seatMapId": "seat-map-1",
                            "membershipRevision": 1,
                            "senderSeatId": 1,
                            "authoritySeatId": 1,
                            "connectionGeneration": 1
                        },
                        "body": {"z": 1, "a": null}
                    }
                },
                "expected_effect_digest": "effect-1",
                "expected_state_digest": "state-1",
                "expected_ui_digest": "ui-1",
                "expected_live_resources": {
                    "timers": [0],
                    "presentations": [2],
                    "storage_requests": [3]
                }
            },
            {
                "sequence": 2,
                "virtual_time_ms": 500,
                "input": {
                    "kind": "TIMER_FIRED",
                    "endpoint": 1,
                    "timer_id": 0
                },
                "expected_effect_digest": "effect-2",
                "expected_state_digest": "state-2",
                "expected_ui_digest": "ui-2",
                "expected_live_resources": {
                    "timers": [],
                    "presentations": [2],
                    "storage_requests": [3]
                }
            },
            {
                "sequence": 3,
                "virtual_time_ms": 750,
                "input": {
                    "kind": "PRESENTATION_SETTLED",
                    "endpoint": 1,
                    "event_id": 2,
                    "outcome": {"kind": "FAILED", "reason": "animation"}
                },
                "expected_effect_digest": "effect-3",
                "expected_state_digest": "state-3",
                "expected_ui_digest": "ui-3",
                "expected_live_resources": {
                    "timers": [],
                    "presentations": [],
                    "storage_requests": [3]
                }
            },
            {
                "sequence": 4,
                "virtual_time_ms": 1000,
                "input": {
                    "kind": "TRANSPORT_CHANGED",
                    "endpoint": 1,
                    "state": "CONNECTED",
                    "generation": 1
                },
                "expected_effect_digest": "effect-4",
                "expected_state_digest": "state-4",
                "expected_ui_digest": "ui-4",
                "expected_live_resources": {
                    "timers": [],
                    "presentations": [],
                    "storage_requests": [3]
                }
            },
            {
                "sequence": 5,
                "virtual_time_ms": 1250,
                "input": {
                    "kind": "STORAGE_RESULT",
                    "endpoint": 1,
                    "request_id": 3,
                    "result": {"kind": "LOADED", "value": null}
                },
                "expected_effect_digest": "effect-5",
                "expected_state_digest": "state-5",
                "expected_ui_digest": "ui-5",
                "expected_live_resources": {
                    "timers": [],
                    "presentations": [],
                    "storage_requests": []
                }
            },
            {
                "sequence": 6,
                "virtual_time_ms": 1500,
                "input": {"kind": "SUSPEND", "endpoint": 1},
                "expected_effect_digest": "effect-6",
                "expected_state_digest": "state-6",
                "expected_ui_digest": "ui-6",
                "expected_live_resources": {
                    "timers": [],
                    "presentations": [],
                    "storage_requests": []
                }
            },
            {
                "sequence": 7,
                "virtual_time_ms": 1750,
                "input": {"kind": "RESUME", "endpoint": 1},
                "expected_effect_digest": "effect-7",
                "expected_state_digest": "state-7",
                "expected_ui_digest": "ui-7",
                "expected_live_resources": {
                    "timers": [],
                    "presentations": [],
                    "storage_requests": []
                }
            }
        ]
    }"#;

    #[wasm_bindgen_test]
    fn canonical_json_matches_native_schema_canonicalization() {
        let result = canonicalize_json(
            r#"{"z":1,"a":{"d":"é","c":null},"items":[{"b":2,"a":1}]}"#,
        );
        assert!(result.is_ok(), "canonical JSON boundary rejected valid input");
        let Some(canonical) = result.ok() else {
            return;
        };
        assert_eq!(
            canonical,
            r#"{"a":{"c":null,"d":"é"},"items":[{"a":1,"b":2}],"z":1}"#
        );
    }

    #[wasm_bindgen_test]
    fn compatible_digest_matches_sha256_fixture_definition() {
        let result = compatible_digest_json(r#"{"z":1,"a":2}"#);
        assert!(result.is_ok(), "compatible digest boundary rejected valid input");
        let Some(digest) = result.ok() else {
            return;
        };
        assert_eq!(
            digest,
            "c2985c5ba6f7d2a55e768f92490ca09388e95bc4cccb9fdf11b15f4d42f93e73"
        );
    }

    #[wasm_bindgen_test]
    fn canonical_boundaries_reject_invalid_numeric_input() {
        for input in [
            r#"{"value":9007199254740992}"#,
            r#"{"value":-1}"#,
            r#"{"value":1.5}"#,
        ] {
            assert!(
                canonicalize_json(input).is_err(),
                "canonicalization accepted invalid numeric input: {input}"
            );
            assert!(
                compatible_digest_json(input).is_err(),
                "digest accepted invalid numeric input: {input}"
            );
        }
    }

    #[wasm_bindgen_test]
    fn kernel_trace_round_trip_preserves_full_typed_trace() {
        let original_result = serde_json::from_str::<KernelTrace>(FULL_KERNEL_TRACE);
        assert!(original_result.is_ok(), "full KernelTrace fixture did not parse");
        let Some(original) = original_result.ok() else {
            return;
        };

        let result = round_trip_kernel_trace(FULL_KERNEL_TRACE);
        assert!(result.is_ok(), "KernelTrace boundary rejected valid input");
        let Some(canonical) = result.ok() else {
            return;
        };

        let round_tripped_result = serde_json::from_str::<KernelTrace>(&canonical);
        assert!(
            round_tripped_result.is_ok(),
            "canonical KernelTrace output did not parse"
        );
        let Some(round_tripped) = round_tripped_result.ok() else {
            return;
        };
        assert_eq!(round_tripped, original);

        let native_result = canonicalize(&original);
        assert!(
            native_result.is_ok(),
            "native canonicalizer rejected full KernelTrace"
        );
        let Some(native) = native_result.ok() else {
            return;
        };
        assert_eq!(canonical, native);
    }
}
