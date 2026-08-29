//! Deterministic boundary trace schema.

use serde::{Deserialize, Deserializer, Serialize};

use crate::{KernelInput, KernelSnapshot, LiveResourceSnapshot, SafeU53};

pub const KERNEL_TRACE_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct KernelTraceHeader {
    pub trace_version: u32,
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub protocol_version: String,
    pub content_hash: String,
    pub rust_toolchain: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KernelTrace {
    pub header: KernelTraceHeader,
    pub initial_snapshot: KernelSnapshot,
    pub events: Vec<KernelTraceEvent>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KernelTraceEvent {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub input: KernelInput,
    pub expected_effect_digest: String,
    pub expected_state_digest: String,
    pub expected_ui_digest: String,
    pub expected_live_resources: LiveResourceSnapshot,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TraceDivergence {
    pub sequence: SafeU53,
    pub expected_effect_digest: String,
    pub actual_effect_digest: String,
    pub expected_state_digest: String,
    pub actual_state_digest: String,
    pub expected_ui_digest: String,
    pub actual_ui_digest: String,
    pub expected_live_resources: LiveResourceSnapshot,
    pub actual_live_resources: LiveResourceSnapshot,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TraceReplayReport {
    pub replayed_events: SafeU53,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub first_divergent_sequence: Option<SafeU53>,
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[cfg(test)]
mod tests {
    use super::{
        KERNEL_TRACE_VERSION, KernelTrace, KernelTraceEvent, TraceDivergence, TraceReplayReport,
    };
    use crate::{KernelInput, LiveResourceSnapshot, SafeU53, SeatId};
    use serde_json::Value;

    const TRACE_FIXTURE: &str = r#"
{
  "header": {
    "trace_version": 1,
    "schema_version": 1,
    "oracle_game_sha": "3b534099919efae827019d4a3f3c4ab0ecd6d67b",
    "protocol_version": "er-coop-48",
    "content_hash": "blake3-v1:fixture-content",
    "rust_toolchain": "1.97.1"
  },
  "initial_snapshot": {
    "ui": {
      "generation": 0,
      "owner_seat": null,
      "actionable": false,
      "stack": [
        {"kind": "NONE"}
      ]
    },
    "state": {
      "null_state": null,
      "nested": {"answer": 42},
      "ordered": [true, "text"]
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
            "code": {"kind": "ARROW_UP"},
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
        "timers": [7],
        "presentations": [8],
        "storage_requests": [9]
      }
    },
    {
      "sequence": 1,
      "virtual_time_ms": 250,
      "input": {
        "kind": "NETWORK_FRAME",
        "endpoint": 2,
        "frame": {
          "v": 2,
          "t": "authorityEntry",
          "ctx": {
            "sessionId": "session-1",
            "runId": "run-1",
            "sessionEpoch": 1,
            "seatMapId": "map-1",
            "membershipRevision": 2,
            "senderSeatId": 1,
            "authoritySeatId": 1,
            "connectionGeneration": 3
          },
          "body": {"payload": null}
        }
      },
      "expected_effect_digest": "effect-1",
      "expected_state_digest": "state-1",
      "expected_ui_digest": "ui-1",
      "expected_live_resources": {
        "timers": [],
        "presentations": [],
        "storage_requests": []
      }
    },
    {
      "sequence": 2,
      "virtual_time_ms": 500,
      "input": {
        "kind": "TIMER_FIRED",
        "endpoint": 1,
        "timer_id": 10
      },
      "expected_effect_digest": "effect-2",
      "expected_state_digest": "state-2",
      "expected_ui_digest": "ui-2",
      "expected_live_resources": {
        "timers": [],
        "presentations": [],
        "storage_requests": []
      }
    },
    {
      "sequence": 3,
      "virtual_time_ms": 750,
      "input": {
        "kind": "PRESENTATION_SETTLED",
        "endpoint": 1,
        "event_id": 11,
        "outcome": {"kind": "FAILED", "reason": "fixture"}
      },
      "expected_effect_digest": "effect-3",
      "expected_state_digest": "state-3",
      "expected_ui_digest": "ui-3",
      "expected_live_resources": {
        "timers": [],
        "presentations": [],
        "storage_requests": []
      }
    },
    {
      "sequence": 4,
      "virtual_time_ms": 1000,
      "input": {
        "kind": "TRANSPORT_CHANGED",
        "endpoint": 1,
        "state": "CONNECTED",
        "generation": 3
      },
      "expected_effect_digest": "effect-4",
      "expected_state_digest": "state-4",
      "expected_ui_digest": "ui-4",
      "expected_live_resources": {
        "timers": [],
        "presentations": [],
        "storage_requests": []
      }
    },
    {
      "sequence": 5,
      "virtual_time_ms": 1250,
      "input": {
        "kind": "STORAGE_RESULT",
        "endpoint": 1,
        "request_id": 12,
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
      "input": {
        "kind": "SUSPEND",
        "endpoint": 1
      },
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
      "input": {
        "kind": "RESUME",
        "endpoint": 1
      },
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
}
"#;

    const DIVERGENCE_FIXTURE: &str = r#"
{
  "sequence": 4,
  "expected_effect_digest": "effect-expected",
  "actual_effect_digest": "effect-actual",
  "expected_state_digest": "state-expected",
  "actual_state_digest": "state-actual",
  "expected_ui_digest": "ui-expected",
  "actual_ui_digest": "ui-actual",
  "expected_live_resources": {
    "timers": [1],
    "presentations": [2],
    "storage_requests": [3]
  },
  "actual_live_resources": {
    "timers": [4],
    "presentations": [5],
    "storage_requests": [6]
  }
}
    "#;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    #[test]
    fn trace_fixture_round_trips_every_kernel_input_boundary() -> TestResult {
        let trace: KernelTrace = serde_json::from_str(TRACE_FIXTURE)?;

        assert_eq!(trace.header.trace_version, KERNEL_TRACE_VERSION);
        assert_eq!(trace.header.schema_version, 1);
        assert_eq!(
            trace.header.oracle_game_sha,
            "3b534099919efae827019d4a3f3c4ab0ecd6d67b"
        );
        assert_eq!(trace.header.protocol_version, "er-coop-48");
        assert_eq!(trace.header.content_hash, "blake3-v1:fixture-content");
        assert_eq!(trace.header.rust_toolchain, "1.97.1");
        assert_eq!(trace.initial_snapshot.ui, crate::UiState::default());
        assert_eq!(
            trace.initial_snapshot.state.get("null_state"),
            Some(&Value::Null)
        );
        assert_eq!(trace.events.len(), 8);

        let sequences = trace
            .events
            .iter()
            .map(|event| event.sequence.get())
            .collect::<Vec<_>>();
        assert_eq!(sequences, vec![0, 1, 2, 3, 4, 5, 6, 7]);

        let virtual_times = trace
            .events
            .iter()
            .map(|event| event.virtual_time_ms.get())
            .collect::<Vec<_>>();
        assert_eq!(
            virtual_times,
            vec![0, 250, 500, 750, 1000, 1250, 1500, 1750]
        );

        assert!(matches!(
            &trace.events[0].input,
            KernelInput::RawInput { .. }
        ));
        assert!(matches!(
            &trace.events[1].input,
            KernelInput::NetworkFrame { .. }
        ));
        assert!(matches!(
            &trace.events[2].input,
            KernelInput::TimerFired { .. }
        ));
        assert!(matches!(
            &trace.events[3].input,
            KernelInput::PresentationSettled { .. }
        ));
        assert!(matches!(
            &trace.events[4].input,
            KernelInput::TransportChanged { .. }
        ));
        assert!(matches!(
            &trace.events[5].input,
            KernelInput::StorageResult { .. }
        ));
        assert!(matches!(
            &trace.events[6].input,
            KernelInput::Suspend { .. }
        ));
        assert!(matches!(&trace.events[7].input, KernelInput::Resume { .. }));

        assert_eq!(trace.events[0].expected_effect_digest, "effect-0");
        assert_eq!(trace.events[0].expected_state_digest, "state-0");
        assert_eq!(trace.events[0].expected_ui_digest, "ui-0");
        assert_eq!(
            trace.events[0].expected_live_resources,
            LiveResourceSnapshot {
                timers: [crate::TimerId::new(SafeU53::new(7)?)]
                    .into_iter()
                    .collect(),
                presentations: [crate::PresentationEventId::new(SafeU53::new(8)?)]
                    .into_iter()
                    .collect(),
                storage_requests: [SafeU53::new(9)?].into_iter().collect(),
                ..LiveResourceSnapshot::default()
            }
        );

        let encoded = serde_json::to_string(&trace)?;
        let fixture_value: Value = serde_json::from_str(TRACE_FIXTURE)?;
        let encoded_value: Value = serde_json::from_str(&encoded)?;
        assert_eq!(encoded_value, fixture_value);

        let decoded: KernelTrace = serde_json::from_str(&encoded)?;
        assert_eq!(decoded, trace);
        Ok(())
    }

    #[test]
    fn trace_event_preserves_u53_sequence_and_virtual_time_boundaries() -> TestResult {
        let event = KernelTraceEvent {
            sequence: SafeU53::MAX,
            virtual_time_ms: SafeU53::MAX,
            input: KernelInput::Suspend {
                endpoint: SeatId::new(SafeU53::ZERO),
            },
            expected_effect_digest: "effect".to_owned(),
            expected_state_digest: "state".to_owned(),
            expected_ui_digest: "ui".to_owned(),
            expected_live_resources: LiveResourceSnapshot::default(),
        };

        let encoded = serde_json::to_string(&event)?;
        let decoded: KernelTraceEvent = serde_json::from_str(&encoded)?;
        assert_eq!(decoded, event);
        assert!(encoded.contains("9007199254740991"));

        let invalid_sequence = encoded.replace(
            "\"sequence\":9007199254740991",
            "\"sequence\":9007199254740992",
        );
        assert!(serde_json::from_str::<KernelTraceEvent>(&invalid_sequence).is_err());

        let invalid_virtual_time = encoded.replace(
            "\"virtual_time_ms\":9007199254740991",
            "\"virtual_time_ms\":9007199254740992",
        );
        assert!(serde_json::from_str::<KernelTraceEvent>(&invalid_virtual_time).is_err());
        Ok(())
    }

    #[test]
    fn divergence_and_replay_report_round_trip_with_first_sequence() -> TestResult {
        let divergence: TraceDivergence = serde_json::from_str(DIVERGENCE_FIXTURE)?;
        assert_eq!(divergence.sequence.get(), 4);
        assert_eq!(divergence.expected_effect_digest, "effect-expected");
        assert_eq!(divergence.actual_effect_digest, "effect-actual");
        assert_eq!(divergence.expected_state_digest, "state-expected");
        assert_eq!(divergence.actual_state_digest, "state-actual");
        assert_eq!(divergence.expected_ui_digest, "ui-expected");
        assert_eq!(divergence.actual_ui_digest, "ui-actual");

        let encoded = serde_json::to_string(&divergence)?;
        let fixture_value: Value = serde_json::from_str(DIVERGENCE_FIXTURE)?;
        let encoded_value: Value = serde_json::from_str(&encoded)?;
        assert_eq!(encoded_value, fixture_value);
        let decoded: TraceDivergence = serde_json::from_str(&encoded)?;
        assert_eq!(decoded, divergence);

        let report = TraceReplayReport {
            replayed_events: SafeU53::new(5)?,
            first_divergent_sequence: Some(SafeU53::new(4)?),
        };
        let report_json = serde_json::to_string(&report)?;
        assert_eq!(
            report_json,
            r#"{"replayed_events":5,"first_divergent_sequence":4}"#
        );
        let decoded_report: TraceReplayReport = serde_json::from_str(&report_json)?;
        assert_eq!(decoded_report, report);

        let clean_report = TraceReplayReport {
            replayed_events: SafeU53::new(8)?,
            first_divergent_sequence: None,
        };
        let clean_report_json = serde_json::to_string(&clean_report)?;
        assert_eq!(
            clean_report_json,
            r#"{"replayed_events":8,"first_divergent_sequence":null}"#
        );
        assert!(serde_json::from_str::<TraceReplayReport>(r#"{"replayed_events":8}"#).is_err());
        Ok(())
    }
}
