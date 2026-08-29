use er_sim::PairEndpoint;
use er_sim::snapshot::{
    PairDeterminismDigest, RestorableKernelEffectV2, TraceDivergenceV2, TraceFailureEvidenceV2,
    TraceFailureOwnerV2, numbered_pair_effects,
};
use er_types::{SafeU53, TerminalState};

#[test]
fn failure_evidence_validation_is_owner_scoped_and_line_safe() {
    let evidence = TraceFailureEvidenceV2 {
        owner: TraceFailureOwnerV2::Endpoint,
        code: "INPUT_REJECTED".to_owned(),
        path: "kernel.input".to_owned(),
        expected: Some("accepted".to_owned()),
        actual: Some("rejected".to_owned()),
    };
    assert!(
        evidence
            .validate(Some(TraceFailureOwnerV2::Endpoint))
            .is_ok()
    );
    assert!(evidence.validate(Some(TraceFailureOwnerV2::Guest)).is_err());

    let mut unsafe_evidence = evidence;
    unsafe_evidence.path.push('\n');
    assert!(unsafe_evidence.validate(None).is_err());
}

#[test]
fn pair_effects_are_numbered_in_emission_order() {
    let terminal = || RestorableKernelEffectV2::EnterSharedTerminal {
        terminal: TerminalState {
            terminal_id: "terminal-1".to_owned(),
            reason: "test".to_owned(),
        },
    };
    let effects = numbered_pair_effects(vec![
        (PairEndpoint::Guest, terminal()),
        (PairEndpoint::Host, terminal()),
    ])
    .expect("numbering should not fail");

    assert_eq!(effects[0].sequence, SafeU53::ZERO);
    assert_eq!(effects[0].origin, PairEndpoint::Guest);
    assert_eq!(effects[1].sequence, SafeU53::new(1).expect("one is safe"));
    assert_eq!(effects[1].origin, PairEndpoint::Host);
}

#[test]
fn divergence_can_be_projected_to_frozen_failure_evidence() {
    let divergence = TraceDivergenceV2 {
        sequence: SafeU53::new(3).expect("three is safe"),
        virtual_time_ms: SafeU53::new(9).expect("nine is safe"),
        owner: TraceFailureOwnerV2::Environment,
        code: "TRACE_DIVERGENCE".to_owned(),
        path: "environment_after.clock.now_ms".to_owned(),
        expected: Some("10".to_owned()),
        actual: Some("9".to_owned()),
    };
    assert_eq!(
        divergence.failure(),
        TraceFailureEvidenceV2 {
            owner: TraceFailureOwnerV2::Environment,
            code: "TRACE_DIVERGENCE".to_owned(),
            path: "environment_after.clock.now_ms".to_owned(),
            expected: Some("10".to_owned()),
            actual: Some("9".to_owned()),
        }
    );
}

#[test]
fn pair_digest_constructor_keeps_the_checked_wire_format() {
    let value = format!("blake3-v1:{}", "a".repeat(64));
    let digest = PairDeterminismDigest::new(value.clone()).expect("checked digest should parse");
    assert_eq!(digest.as_str(), value);
    assert!(PairDeterminismDigest::new("blake3-v1:ABC".to_owned()).is_err());
}

#[test]
fn trace_api_surface_and_contract_stay_wired() {
    let source = include_str!("../src/snapshot.rs");
    let contract = include_str!("../../../contracts/m3-snapshot-trace.md");
    let compact_source: String = source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();

    for marker in [
        "pub struct EndpointKernelTraceRecorder",
        "pub struct PairKernelTraceRecorder",
        "pub fn validate(&self)",
        "pub fn first_divergence(&self, actual: &Self)",
        "pub trait PairTraceReplayDriver",
        "type PairState;",
        "fn restore(&self, snapshot: RestorablePairSnapshotV2,",
        "fn step(&mut self, state: &mut Self::PairState, operation: &PairOperationV2, virtual_time_ms: SafeU53,",
        "pub fn replay_with<D>(",
        "D: PairTraceReplayDriver",
        "Result<PairTraceObservationV2, SnapshotError>",
        "pub fn compute_components(",
        "pub host_live_resources: LiveResourceSnapshot",
        "pub environment_after: PairEnvironmentResourceSnapshotV2",
    ] {
        let compact_marker: String = marker
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect();
        assert!(
            compact_source.contains(&compact_marker),
            "missing source marker: {marker}"
        );
    }
    for marker in [
        "pub fn replay_simulated_pair(",
        "self.replay_with(",
        "SimulatedPairTraceReplayDriver",
        "crate::SimulatedPair::from_snapshot",
        "state.apply_trace_operation_v2",
    ] {
        let compact_marker: String = marker
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect();
        assert!(
            compact_source.contains(&compact_marker),
            "missing replay delegation marker: {marker}"
        );
    }
    for marker in [
        "Endpoint `sequence`",
        "pair `trace_sequence`",
        "PairDeterminismDigest",
        "pair failures require `Host`, `Guest`, or `Environment`",
        "A pair effect's origin must agree",
    ] {
        assert!(
            contract.contains(marker),
            "missing contract marker: {marker}"
        );
    }
}
