use super::*;
use serde_json::{Value, json};
type TestResult = Result<(), Box<dyn std::error::Error>>;

struct Historical;
impl AgentDispatcherV1 for Historical {
    fn dispatch(&mut self, _: &str, _: &Value) -> Result<Value, AgentDispatchErrorV1> {
        Ok(json!({"legacy": true}))
    }
}
#[derive(Default)]
struct Recording {
    attempts: Vec<(Option<String>, String)>,
    dispatched: usize,
}
impl AgentDispatcherV1 for Recording {
    fn dispatch(&mut self, _: &str, _: &Value) -> Result<Value, AgentDispatchErrorV1> {
        self.dispatched += 1;
        Ok(json!({"accepted": true}))
    }
    fn rejected_ingress(&mut self, request: Option<&AgentRequestV1>, reason: &str) {
        self.attempts
            .push((request.map(|request| request.id.clone()), reason.to_owned()));
    }
}
fn limits() -> AgentProtocolLimitsV1 {
    AgentProtocolLimitsV1 {
        maximum_line_bytes: 512,
        maximum_inline_result_bytes: 512,
        maximum_artifact_bytes: 512,
        maximum_artifacts: 1,
        maximum_completed_request_ids: 16,
    }
}
fn request(id: &str, method: &str) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(
        &json!({"protocol_version": 1, "id": id, "method": method, "params": {"session": "native"}}),
    )
}
#[test]
fn default_ingress_hook_preserves_legacy_responses_and_immutable_oversized_api() -> TestResult {
    let mut legacy = AgentJsonlServerV1::new(Historical, limits())?;
    let unchanged = legacy.process_oversized_line()?;
    assert_eq!(legacy.process_oversized_line_with_diagnostics()?, unchanged);
    let accepted: AgentResponseV1 =
        serde_json::from_slice(&legacy.process_line(&request("ok", "session.observe")?)?)?;
    assert_eq!(accepted.result, Some(json!({"legacy": true})));
    let duplicate: AgentResponseV1 =
        serde_json::from_slice(&legacy.process_line(&request("ok", "session.observe")?)?)?;
    assert_eq!(
        duplicate.error.ok_or("duplicate")?.code,
        AgentErrorCodeV1::DuplicateRequest
    );
    let malformed: AgentResponseV1 = serde_json::from_slice(&legacy.process_line(b"{")?)?;
    assert_eq!(
        malformed.error.ok_or("parse")?.code,
        AgentErrorCodeV1::ParseError
    );
    Ok(())
}
#[test]
fn rejected_ingress_hook_distinguishes_addressable_and_discarded_requests() -> TestResult {
    let mut server = AgentJsonlServerV1::new(Recording::default(), limits())?;
    server.process_line(&request("accepted", "session.observe")?)?;
    server.process_line(&request("accepted", "session.raw_input")?)?;
    server.process_line(&request("unknown", "session.unknown")?)?;
    server.process_line(&request("forbidden", "session.choose_move")?)?;
    let mut version: Value = serde_json::from_slice(&request("version", "session.raw_input")?)?;
    version["protocol_version"] = json!(99);
    server.process_line(&serde_json::to_vec(&version)?)?;
    server.process_line(b"{")?;
    server.process_line(&vec![b'x'; 513])?;
    server.process_oversized_line_with_diagnostics()?;
    let recorder = server.into_dispatcher();
    assert_eq!(recorder.dispatched, 1);
    assert_eq!(recorder.attempts.len(), 7);
    assert_eq!(
        recorder
            .attempts
            .iter()
            .map(|(id, _)| id.as_deref())
            .collect::<Vec<_>>(),
        vec![
            Some("accepted"),
            Some("unknown"),
            Some("forbidden"),
            Some("version"),
            None,
            None,
            None
        ]
    );
    assert!(recorder.attempts[0].1.contains("duplicate"));
    assert!(recorder.attempts[4].1.contains("malformed"));
    assert!(recorder.attempts[5].1.contains("oversized"));
    Ok(())
}
