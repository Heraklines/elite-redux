//! M7.1 DP-B reproduction, minimization, and JSONL contracts.

use std::{collections::BTreeMap, error::Error};

use er_agent_protocol::*;
use er_dev_types::*;
use er_repro::*;
use er_types::{
    BattleContentPackHashV3, CatalogHash, GameContentBundleHash, GameContentIdentity, OracleSha,
};
use serde::{Deserialize, Serialize};

fn identity() -> Result<ExecutionIdentityV1, Box<dyn Error>> {
    Ok(ExecutionIdentityV1 {
        mechanical: MechanicalCompatibilityIdentityV1 {
            game_content: GameContentIdentity {
                oracle_sha: OracleSha::parse("399d5d368f0b5642ebf8f45bd8a5e73350fa4de7")?,
                content_hash: GameContentBundleHash::parse(format!(
                    "blake3-v1:{}",
                    "a".repeat(64)
                ))?,
                battle_content_hash: BattleContentPackHashV3::parse(format!(
                    "blake3-v3:{}",
                    "b".repeat(64)
                ))?,
                semantic_catalog_hash: CatalogHash::parse("c".repeat(64))?,
            },
            protocol_version: "er-coop-47".to_owned(),
            game_state_schema: 5,
            material_schema: 5,
            save_schema: 1,
            canonical_model_slots: Vec::new(),
        },
        build: BuildDiagnosticIdentityV1 {
            kernel_commit: KnownOrUnknownV1::Known(
                "1599f19c5d05ec8646819414f6ef7556f1f8bc89".to_owned(),
            ),
            cargo_lock_hash: KnownOrUnknownV1::Unknown,
            rust_toolchain: KnownOrUnknownV1::Known("1.97.1".to_owned()),
            target_triple: KnownOrUnknownV1::Unknown,
            build_profile: KnownOrUnknownV1::Known("test".to_owned()),
            feature_flags: Vec::new(),
        },
        adapters: AdapterStackIdentityV1 {
            platform: None,
            renderer: None,
            asset_pack: None,
            model_backends: Vec::new(),
        },
    }
    .normalize()?)
}

fn limits() -> CapsuleLimitsV1 {
    CapsuleLimitsV1 {
        maximum_manifest_bytes: 32_768,
        maximum_blob_count: 32,
        maximum_blob_bytes: 16_384,
        maximum_total_stored_bytes: 65_536,
        maximum_total_decompressed_bytes: 65_536,
    }
}

fn redaction() -> RedactionManifestV1 {
    RedactionManifestV1 {
        policy_version: 1,
        profile: "DEBUG".to_owned(),
        removed_paths: vec!["adapter.request_headers".to_owned()],
        aliased_fields: Vec::new(),
        omitted_blob_kinds: Vec::new(),
        retained_sensitive_fields: Vec::new(),
    }
}

#[test]
fn capsule_roundtrip_is_byte_deterministic_and_corruption_fails_closed()
-> Result<(), Box<dyn Error>> {
    let oracle = FailureOracleV1::DigestDivergence {
        path: Some("battle/player_party/0/hp".to_owned()),
        expected: "blake3-v1:expected".to_owned(),
    };
    let capsule = ReproCapsuleV1::new(
        CapsuleModeV1::SelfContained,
        identity()?,
        oracle.clone(),
        &vec![7; 512],
        br#"[{"sequence":1}]"#,
        vec![
            (CapsuleBlobKindV1::DiagnosticCheckpoint, vec![3; 128]),
            (CapsuleBlobKindV1::Content, vec![9; 256]),
        ],
        redaction(),
        limits(),
    )?;
    let first = capsule.encode(limits())?;
    let decoded = ReproCapsuleV1::decode(&first, limits())?;
    let second = decoded.encode(limits())?;
    assert_eq!(first, second);
    assert_eq!(decoded.manifest.failure_oracle, oracle);
    assert!(
        decoded
            .blobs
            .iter()
            .any(|blob| blob.compression == CapsuleCompressionV1::RleV1)
    );

    let mut corrupt = first;
    let final_index = corrupt.len() - 1;
    corrupt[final_index] ^= 0xff;
    assert!(ReproCapsuleV1::decode(&corrupt, limits()).is_err());
    Ok(())
}

#[test]
fn thin_capsule_excludes_content_and_unsafe_redaction_is_rejected() -> Result<(), Box<dyn Error>> {
    let capsule = ReproCapsuleV1::new(
        CapsuleModeV1::Thin,
        identity()?,
        FailureOracleV1::TerminalReason("TEST".to_owned()),
        b"snapshot",
        b"[]",
        vec![(CapsuleBlobKindV1::Content, b"content".to_vec())],
        redaction(),
        limits(),
    )?;
    assert!(
        !capsule
            .blobs
            .iter()
            .any(|blob| blob.kind == CapsuleBlobKindV1::Content)
    );

    let unsafe_redaction = RedactionManifestV1 {
        policy_version: 1,
        profile: "DEBUG".to_owned(),
        removed_paths: Vec::new(),
        aliased_fields: Vec::new(),
        omitted_blob_kinds: Vec::new(),
        retained_sensitive_fields: vec!["account_token".to_owned()],
    };
    assert!(
        ReproCapsuleV1::new(
            CapsuleModeV1::Thin,
            identity()?,
            FailureOracleV1::TerminalReason("TEST".to_owned()),
            b"snapshot",
            b"[]",
            Vec::new(),
            unsafe_redaction,
            limits(),
        )
        .is_err()
    );
    Ok(())
}

#[derive(Debug)]
struct ByteReplayDriver {
    state: u8,
    diverge_on: Option<u8>,
    failure: Option<FailureOracleV1>,
}

#[derive(Debug, thiserror::Error)]
#[error("byte replay failed")]
struct ByteReplayError;

impl ReplayDriverV1<u8> for ByteReplayDriver {
    type Error = ByteReplayError;

    fn restore(&mut self, snapshot: &[u8]) -> Result<(), Self::Error> {
        self.state = snapshot.first().copied().ok_or(ByteReplayError)?;
        self.failure = None;
        Ok(())
    }

    fn apply_external(&mut self, input: &u8) -> Result<ReplayEvidenceV1, Self::Error> {
        self.state = self.state.wrapping_add(*input);
        let observed = if self.diverge_on == Some(*input) {
            self.state.wrapping_add(1)
        } else {
            self.state
        };
        if *input == 9 {
            self.failure = Some(FailureOracleV1::InvariantViolation("EXACT".to_owned()));
        }
        Ok(replay_evidence(
            u64::from(*input),
            observed,
            self.failure.clone(),
        ))
    }

    fn observed_failure(&self) -> Option<FailureOracleV1> {
        self.failure.clone()
    }
}

fn replay_evidence(sequence: u64, value: u8, failure: Option<FailureOracleV1>) -> ReplayEvidenceV1 {
    ReplayEvidenceV1 {
        sequence,
        mechanical_digest: format!("mechanical-{value}"),
        kernel_digest: format!("kernel-{value}"),
        diagnostic_root: format!("diagnostic-{value}"),
        named_digests: BTreeMap::from([("rng".to_owned(), format!("rng-{value}"))]),
        failure,
    }
}

#[test]
fn replay_reports_exact_failure_and_first_divergence() -> Result<(), Box<dyn Error>> {
    let failure = FailureOracleV1::InvariantViolation("EXACT".to_owned());
    let events = vec![
        RecordedReplayEventV1 {
            sequence: 1,
            input: 1_u8,
            expected: replay_evidence(1, 1, None),
        },
        RecordedReplayEventV1 {
            sequence: 9,
            input: 9_u8,
            expected: replay_evidence(9, 10, Some(failure.clone())),
        },
    ];
    let engine = ReproReplayEngineV1 { maximum_events: 8 };
    let mut exact = ByteReplayDriver {
        state: 0,
        diverge_on: None,
        failure: None,
    };
    let report = engine.replay(&[0], &events, failure.clone(), &mut exact)?;
    assert!(report.exact_failure_reproduced);
    assert!(report.first_divergence.is_none());

    let mut divergent = ByteReplayDriver {
        state: 0,
        diverge_on: Some(1),
        failure: None,
    };
    let report = engine.replay(&[0], &events, failure, &mut divergent)?;
    assert_eq!(report.first_divergence.map(|value| value.sequence), Some(1));
    assert!(!report.exact_failure_reproduced);
    Ok(())
}

#[test]
fn checkpoint_seek_and_branch_comparison_are_deterministic() -> Result<(), Box<dyn Error>> {
    let index = CheckpointIndexV1 {
        maximum_entries: 8,
        entries: vec![
            CheckpointIndexEntryV1 {
                sequence: 0,
                snapshot_digest: "start".to_owned(),
            },
            CheckpointIndexEntryV1 {
                sequence: 10,
                snapshot_digest: "ten".to_owned(),
            },
        ],
    };
    let seek = index.nearest_not_after(12)?;
    assert_eq!(seek.checkpoint_sequence, 10);
    let left = vec![replay_evidence(1, 1, None), replay_evidence(2, 2, None)];
    assert!(compare_branches(&left, &left, 8)?.identical);
    let right = vec![replay_evidence(1, 1, None), replay_evidence(2, 3, None)];
    let difference = compare_branches(&left, &right, 8)?;
    assert_eq!(difference.shared_prefix_events, 1);
    assert_eq!(difference.first_divergent_sequence, Some(2));
    Ok(())
}

#[test]
fn session_diff_localizes_first_divergent_state_subtree() -> Result<(), Box<dyn Error>> {
    let root = StatePathV1(vec![StatePathSegmentV1::Battle]);
    let hp = StatePathV1(vec![
        StatePathSegmentV1::Battle,
        StatePathSegmentV1::Pokemon("player-1".to_owned()),
        StatePathSegmentV1::FieldName("hp".to_owned()),
    ]);
    let tree = |hp_digest: &str| DiagnosticDigestTreeV1 {
        mechanical_digest: hp_digest.to_owned(),
        diagnostic_root: format!("root-{hp_digest}"),
        level: DiagnosticDigestLevelV1::Leaf,
        maximum_nodes: 4,
        nodes: vec![
            DigestNodeV1 {
                path: root.clone(),
                digest: format!("root-{hp_digest}"),
                children: vec![hp.clone()],
            },
            DigestNodeV1 {
                path: hp.clone(),
                digest: hp_digest.to_owned(),
                children: Vec::new(),
            },
        ],
        truncated: false,
    };
    let left = vec![replay_evidence(1, 1, None)];
    let right = vec![replay_evidence(1, 2, None)];
    let difference = diff_sessions(
        &left,
        &right,
        Some(&tree("hp-left")),
        Some(&tree("hp-right")),
        8,
        8,
    )?;
    assert_eq!(difference.first_divergent_sequence, Some(1));
    assert_eq!(difference.first_divergent_path, Some(hp));
    assert!(!difference.mechanically_identical);
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
enum TestEvent {
    Required,
    Noise,
    Smaller,
}

impl MinimizableEventV1 for TestEvent {
    fn is_independent_fault_or_outcome(&self) -> bool {
        *self == Self::Noise
    }

    fn simplified_candidates(&self) -> Vec<(MinimizationStageV1, Self)> {
        if *self == Self::Required {
            vec![(MinimizationStageV1::RawInput, Self::Smaller)]
        } else {
            Vec::new()
        }
    }
}

#[test]
fn minimizer_preserves_exact_oracle_and_removes_noise() -> Result<(), Box<dyn Error>> {
    let oracle = FailureOracleV1::ResourceLeak("timer".to_owned());
    let result = minimize_reproduction(
        vec![TestEvent::Noise, TestEvent::Required, TestEvent::Noise],
        (),
        oracle.clone(),
        &[],
        MinimizationBudgetV1 {
            maximum_attempts: 64,
            maximum_events: 16,
            maximum_state_candidates: 4,
        },
        |_, events| {
            let valid = events.contains(&TestEvent::Required);
            Ok(CandidateEvaluationV1 {
                valid,
                observed_failure: valid.then(|| oracle.clone()),
                state_digest: Some(format!("events-{}", events.len())),
            })
        },
        None,
        None,
    )?;
    assert_eq!(result.events, vec![TestEvent::Required]);
    assert!(result.report.exact_failure_confirmed);
    assert!(
        result
            .report
            .attempts
            .iter()
            .all(|attempt| !attempt.accepted || attempt.reproduced_exact_oracle)
    );
    Ok(())
}

#[test]
fn explain_returns_bounded_provenance_and_rejects_dangling_graph() -> Result<(), Box<dyn Error>> {
    let root = CausalId("root".to_owned());
    let result = CausalId("result".to_owned());
    let graph = CausalGraphV1 {
        maximum_nodes: 4,
        maximum_edges: 4,
        nodes: vec![
            CausalNodeV1 {
                id: root.clone(),
                node_kind: CausalNodeKindV1::ExternalEvent,
                source: None,
                summary: "raw key".to_owned(),
            },
            CausalNodeV1 {
                id: result.clone(),
                node_kind: CausalNodeKindV1::InternalEvent,
                source: None,
                summary: "transition".to_owned(),
            },
        ],
        edges: vec![CausalEdgeV1 {
            from: root.clone(),
            to: result.clone(),
            edge_kind: CausalEdgeKindV1::Caused,
        }],
        truncated: false,
    };
    let report = explain_causal_graph(
        &graph,
        &ExplainQueryV1 {
            target: result,
            direction: ExplainDirectionV1::Causes,
            maximum_nodes: 4,
            maximum_edges: 4,
        },
    )?;
    assert_eq!(report.nodes.len(), 2);
    assert_eq!(report.edges.len(), 1);
    Ok(())
}

#[derive(Debug, Default)]
struct RecordingDispatcher {
    methods: Vec<String>,
}

impl AgentDispatcherV1 for RecordingDispatcher {
    fn dispatch(
        &mut self,
        method: &str,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, AgentDispatchErrorV1> {
        self.methods.push(method.to_owned());
        Ok(serde_json::json!({ "method": method, "params": params }))
    }
}

fn protocol_limits() -> AgentProtocolLimitsV1 {
    AgentProtocolLimitsV1 {
        maximum_line_bytes: 4096,
        maximum_inline_result_bytes: 4096,
        maximum_artifact_bytes: 8192,
        maximum_artifacts: 8,
        maximum_completed_request_ids: 32,
    }
}

fn response(bytes: &[u8]) -> Result<AgentResponseV1, Box<dyn Error>> {
    Ok(serde_json::from_slice(bytes)?)
}

#[test]
fn jsonl_accepts_raw_input_and_survives_malformed_unknown_and_forbidden_requests()
-> Result<(), Box<dyn Error>> {
    let mut server = AgentJsonlServerV1::new(RecordingDispatcher::default(), protocol_limits())?;
    let raw = serde_json::json!({
        "protocol_version": 1,
        "id": "raw-1",
        "method": "session.raw_input",
        "params": { "input": { "kind": "WINDOW_FOCUSED" } }
    });
    let selected = response(&server.process_line(&serde_json::to_vec(&raw)?)?)?;
    assert!(selected.error.is_none());

    let malformed = response(&server.process_line(br#"{"id":"bad""#)?)?;
    assert_eq!(
        malformed.error.map(|error| error.code),
        Some(AgentErrorCodeV1::ParseError)
    );
    let unknown = serde_json::json!({
        "protocol_version": 1,
        "id": "unknown-1",
        "method": "session.teleport",
        "params": {}
    });
    let unknown = response(&server.process_line(&serde_json::to_vec(&unknown)?)?)?;
    assert_eq!(
        unknown.error.map(|error| error.code),
        Some(AgentErrorCodeV1::MethodNotFound)
    );
    let forbidden = serde_json::json!({
        "protocol_version": 1,
        "id": "forbidden-1",
        "method": "resolve_turn",
        "params": {}
    });
    let forbidden = response(&server.process_line(&serde_json::to_vec(&forbidden)?)?)?;
    assert_eq!(
        forbidden.error.map(|error| error.code),
        Some(AgentErrorCodeV1::MethodForbidden)
    );

    let hello = serde_json::json!({
        "protocol_version": 1,
        "id": "hello-1",
        "method": "protocol.hello",
        "params": {}
    });
    assert!(
        response(&server.process_line(&serde_json::to_vec(&hello)?)?)?
            .error
            .is_none()
    );
    Ok(())
}

#[test]
fn regression_corpus_is_sorted_bounded_and_rejects_duplicates() -> Result<(), Box<dyn Error>> {
    let mut corpus = RegressionCorpusV1::new(2, 1024)?;
    let entry = |digest: &str| RegressionCorpusEntryV1 {
        capsule_digest: digest.to_owned(),
        capsule_size: 12,
        failure_oracle: FailureOracleV1::TerminalReason("X".to_owned()),
        labels: vec!["regression".to_owned()],
    };
    corpus.insert(entry("b"))?;
    corpus.insert(entry("a"))?;
    assert_eq!(corpus.entries[0].capsule_digest, "a");
    assert!(corpus.insert(entry("a")).is_err());
    corpus.validate()?;
    Ok(())
}
