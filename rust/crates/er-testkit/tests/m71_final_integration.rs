//! M7.1 DP-C impact, batch, render, model, reload, performance, and teardown contracts.

use std::{
    error::Error,
    time::{Duration, Instant},
};

use er_agent_protocol::*;
use er_batch::*;
use er_dev_types::*;
use er_devplane::*;
use er_impact::*;
use er_model::*;
use er_render_model::*;
use er_types::{
    BattleContentPackHashV3, CatalogHash, GameContentBundleHash, GameContentIdentity, OracleSha,
    SafeU53,
};

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

#[test]
fn impact_graph_selects_focused_proofs_and_escalates_unknown_changes() -> Result<(), Box<dyn Error>>
{
    let graph = generate_impact_graph_v1(
        &[ImpactRecordV1 {
            source_path: "rust/crates/er-run/src/reward.rs".to_owned(),
            source_symbol: Some("resolve_reward".to_owned()),
            catalog_identity: Some("reward/v1".to_owned()),
            behavior: "reward resolution".to_owned(),
            semantic_group: "run/reward".to_owned(),
            rust_symbol: "er_run::reward::resolve_reward".to_owned(),
            proof_tests: vec!["cargo test -p er-run reward".to_owned()],
            fixtures: vec!["rust/fixtures/m7/reward.json".to_owned()],
            capsules: vec!["capsule/reward".to_owned()],
            campaigns: vec!["campaign/reward".to_owned()],
            benchmarks: vec!["bench/reward".to_owned()],
        }],
        vec!["rust/crates/er-kernel/".to_owned()],
        vec!["cargo test --workspace --all-targets".to_owned()],
        64,
        128,
    )?;
    let focused = query_affected_tests_v1(
        &graph,
        &[SourceChangeV1 {
            path: "rust/crates/er-run/src/reward.rs".to_owned(),
            symbol: Some("resolve_reward".to_owned()),
        }],
        64,
    )?;
    assert!(!focused.global_escalation);
    assert_eq!(
        focused.report.focused_commands,
        vec!["cargo test -p er-run reward"]
    );
    assert_eq!(focused.report.affected_capsules, vec!["capsule/reward"]);

    let unknown = query_affected_tests_v1(
        &graph,
        &[SourceChangeV1 {
            path: "rust/crates/er-kernel/src/new.rs".to_owned(),
            symbol: None,
        }],
        64,
    )?;
    assert!(unknown.global_escalation);
    assert_eq!(
        unknown.report.mandatory_commands,
        graph.global_gate_commands
    );
    Ok(())
}

#[test]
fn batch_schedule_is_sorted_isolated_and_per_entry_failures_do_not_abort()
-> Result<(), Box<dyn Error>> {
    let mut batch = BatchEnvironmentV1::new(4)?;
    let operations = vec![
        BatchOperationV1::AdvanceTime {
            environment: BatchEnvironmentIdV1(2),
            milliseconds: SafeU53::new(2)?,
        },
        BatchOperationV1::AdvanceTime {
            environment: BatchEnvironmentIdV1(1),
            milliseconds: SafeU53::new(1)?,
        },
    ];
    let left = batch.execute_schedule(operations.clone());
    let right = batch.execute_schedule(operations);
    assert_eq!(left, right);
    assert_eq!(left[0].environment, BatchEnvironmentIdV1(1));
    assert_eq!(left[1].environment, BatchEnvironmentIdV1(2));
    assert!(left.iter().all(|result| result.result.is_err()));
    assert_eq!(batch.resource_snapshot().environment_count, 0);
    assert!(batch.close().is_empty());
    Ok(())
}

#[test]
fn semantic_scene_and_render_snapshot_validate_without_mechanical_state()
-> Result<(), Box<dyn Error>> {
    let cause = CausalId("material-1".to_owned());
    let scene = PresentationSceneBuilderV1 {
        maximum_actors: 4,
        maximum_ui_nodes: 4,
        maximum_pending_events: 4,
    }
    .build(
        "session-root",
        7,
        vec![PresentationActorV1 {
            actor_id: "pokemon-1".to_owned(),
            semantic_kind: "POKEMON".to_owned(),
            visible: true,
        }],
        vec![SemanticUiNodeV1 {
            node_id: "command-root".to_owned(),
            role: "MENU".to_owned(),
            label_key: None,
            children: Vec::new(),
        }],
        vec![PresentationCueV1 {
            cause,
            cue: "MOVE_USED".to_owned(),
            blocking: PresentationBlockingPolicyV1::BlocksHumanInput,
        }],
    )?;
    let render = SemanticRenderSnapshotV1 {
        scene_generation: 7,
        renderer_identity: "headless-test".to_owned(),
        nodes: vec![SemanticRenderNodeV1 {
            id: CausalId("render-1".to_owned()),
            semantic_source: "pokemon-1".to_owned(),
            parent: None,
            asset_identity: Some("sprite/pokemon-1".to_owned()),
            transform: RenderTransformV1 {
                x_milli: 0,
                y_milli: 0,
                scale_x_milli: 1000,
                scale_y_milli: 1000,
                rotation_milliradians: 0,
            },
            bounds: RenderBoundsV1 {
                width_milli: 1000,
                height_milli: 1000,
            },
            layer: 1,
            visible: true,
            animation_state: Some("IDLE".to_owned()),
        }],
    };
    let policy = RenderValidationPolicyV1 {
        maximum_nodes: 8,
        maximum_extent_milli: 10_000,
        maximum_absolute_translation_milli: 10_000,
        minimum_layer: -10,
        maximum_layer: 10,
        allowed_asset_identities: vec!["sprite/pokemon-1".to_owned()],
    };
    assert_eq!(
        validate_render_snapshot_v1(&scene, &render, &policy)?.visible_node_count,
        1
    );
    let mut invalid = render;
    invalid.nodes[0].semantic_source = "unknown".to_owned();
    assert!(validate_render_snapshot_v1(&scene, &invalid, &policy).is_err());
    Ok(())
}

#[test]
fn model_replay_uses_recorded_output_and_ignores_backend_latency() -> Result<(), Box<dyn Error>> {
    let request = ModelRequestEnvelopeV1 {
        request_id: ModelRequestIdV1("request-1".to_owned()),
        model_slot: ModelSlotIdV1("battle-policy".to_owned()),
        model_hash: ModelHashV1("model-hash".to_owned()),
        authority_only: true,
        request: ModelRequestV1::BattlePolicy(BattlePolicyObservationV1 {
            observation_bytes: vec![1],
            legal_action_ids: vec!["action-1".to_owned()],
        }),
    };
    let response = ModelResponseEnvelopeV1 {
        request_id: request.request_id.clone(),
        model_hash: request.model_hash.clone(),
        backend: InferenceBackendIdV1("backend-a".to_owned()),
        output: ModelOutputV1::LegalAction("action-1".to_owned()),
        latency_micros: 999,
    };
    let mut replay = RecordedModelReplayV1::new(4)?;
    assert!(replay.record(request.clone(), response.clone())?);
    assert!(!replay.record(request.clone(), response.clone())?);
    let applied = replay.replay(&request.request_id, &request.model_hash)?;
    assert_eq!(applied.output, response.output);
    assert!(
        replay
            .replay(&request.request_id, &ModelHashV1("different".to_owned()))
            .is_err()
    );
    Ok(())
}

#[derive(Clone, Debug)]
struct ReloadDriver {
    divergent: bool,
}

#[derive(Clone, Debug, thiserror::Error)]
#[error("reload driver error")]
struct ReloadDriverError;

impl ReloadPreflightDriverV1<u8, u8, u8> for ReloadDriver {
    type Prepared = u8;
    type Error = ReloadDriverError;

    fn prepare_candidate(&self, content: &u8) -> Result<Self::Prepared, Self::Error> {
        Ok(*content)
    }

    fn migrate_snapshot(&self, snapshot: &u8, _: &Self::Prepared) -> Result<u8, Self::Error> {
        Ok(*snapshot)
    }

    fn replay_candidate(
        &self,
        _: u8,
        trace: &[u8],
        _: &Self::Prepared,
    ) -> Result<ReloadBaselineV1, Self::Error> {
        Ok(ReloadBaselineV1 {
            events: trace
                .iter()
                .map(|sequence| ReloadEventEvidenceV1 {
                    sequence: u64::from(*sequence),
                    mechanical_digest: if self.divergent && *sequence == 2 {
                        "different".to_owned()
                    } else {
                        format!("mechanical-{sequence}")
                    },
                    control_digest: format!("control-{sequence}"),
                })
                .collect(),
            final_control_digest: "control-final".to_owned(),
            invariant_failures: Vec::new(),
        })
    }
}

fn abi() -> KernelAbiIdentityV1 {
    KernelAbiIdentityV1 {
        game_state_schema: 5,
        kernel_input_schema: 7,
        kernel_effect_schema: 7,
        snapshot_schema: 7,
        trace_schema: 7,
    }
}

#[test]
fn reload_preflight_is_fail_atomic_and_reports_first_divergence() -> Result<(), Box<dyn Error>> {
    let identity = identity()?;
    let baseline = ReloadBaselineV1 {
        events: vec![
            ReloadEventEvidenceV1 {
                sequence: 1,
                mechanical_digest: "mechanical-1".to_owned(),
                control_digest: "control-1".to_owned(),
            },
            ReloadEventEvidenceV1 {
                sequence: 2,
                mechanical_digest: "mechanical-2".to_owned(),
                control_digest: "control-2".to_owned(),
            },
        ],
        final_control_digest: "control-final".to_owned(),
        invariant_failures: Vec::new(),
    };
    let current_snapshot = 9_u8;
    let green = preflight_reload_v1(
        &abi(),
        &abi(),
        &identity,
        &identity,
        &[],
        &current_snapshot,
        &[1, 2],
        &baseline,
        &1,
        8,
        &ReloadDriver { divergent: false },
    )?;
    assert!(green.compatible);
    let red = preflight_reload_v1(
        &abi(),
        &abi(),
        &identity,
        &identity,
        &[],
        &current_snapshot,
        &[1, 2],
        &baseline,
        &1,
        8,
        &ReloadDriver { divergent: true },
    )?;
    assert!(!red.compatible);
    assert_eq!(red.first_divergent_sequence, Some(2));
    assert_eq!(current_snapshot, 9);
    Ok(())
}

#[test]
fn abi_performance_telemetry_and_teardown_are_bounded() -> Result<(), Box<dyn Error>> {
    let identity = identity()?;
    let report = compare_kernel_abi_v1(&abi(), &abi(), &identity, &identity, &[]);
    assert!(report.compatible);

    let mut performance = PerformanceLedgerV1::new(4, 8)?;
    performance.record(PerformanceSampleV1 {
        attribution: PerformanceAttributionV1 {
            subsystem: "battle".to_owned(),
            behavior_unit: Some("damage".to_owned()),
            content_id: None,
            operation_id: Some("turn-1".to_owned()),
            transition_id: None,
            environment_id: Some(1),
        },
        deterministic: DeterministicCostEvidenceV1 {
            internal_events: 1,
            rng_draws: 2,
            ..DeterministicCostEvidenceV1::default()
        },
        wall_clock: WallClockPerformanceEvidenceV1 {
            total_nanos: 10,
            allocations: 1,
            bytes_allocated: 16,
        },
    })?;
    let checksum = performance.snapshot()?.deterministic_checksum;
    assert!(checksum.starts_with("blake3-v1:"));

    let mut telemetry = TelemetryRingV1::new(1024, 8)?;
    telemetry.push(TelemetryEventV1 {
        sequence: 1,
        event_kind: TelemetryEventKindV1::ExternalEvent,
        payload: vec![1, 2, 3],
        redacted: true,
        pinned: false,
    })?;
    telemetry.push(TelemetryEventV1 {
        sequence: 2,
        event_kind: TelemetryEventKindV1::ModelRequest,
        payload: vec![9],
        redacted: false,
        pinned: false,
    })?;
    let projection = telemetry_to_capsule_blob_v1(
        &telemetry,
        &TelemetryCapsulePolicyV1 {
            maximum_events: 8,
            maximum_bytes: 1024,
            allowed_kinds: vec![
                TelemetryEventKindV1::ExternalEvent,
                TelemetryEventKindV1::ModelRequest,
            ],
            require_redacted_payloads: true,
        },
    )?;
    assert_eq!(projection.included_sequences, vec![1]);
    assert_eq!(projection.omitted_sequences, vec![2]);

    performance.clear();
    telemetry.clear();
    assert_eq!(performance.snapshot()?.retained_samples, 0);
    assert_eq!(telemetry.retained_bytes(), 0);
    Ok(())
}

#[derive(Debug, Default)]
struct ThroughputDispatcher;

impl AgentDispatcherV1 for ThroughputDispatcher {
    fn dispatch(
        &mut self,
        method: &str,
        _: &serde_json::Value,
    ) -> Result<serde_json::Value, AgentDispatchErrorV1> {
        Ok(serde_json::json!({ "method": method }))
    }
}

#[test]
fn jsonl_throughput_and_protocol_teardown_meet_g34_ceiling() -> Result<(), Box<dyn Error>> {
    let mut server = AgentJsonlServerV1::new(
        ThroughputDispatcher,
        AgentProtocolLimitsV1 {
            maximum_line_bytes: 4096,
            maximum_inline_result_bytes: 4096,
            maximum_artifact_bytes: 8192,
            maximum_artifacts: 8,
            maximum_completed_request_ids: 32,
        },
    )?;
    let started = Instant::now();
    for ordinal in 0..10_000_u64 {
        let request = serde_json::json!({
            "protocol_version": 1,
            "id": format!("request-{ordinal}"),
            "method": "protocol.hello",
            "params": {}
        });
        let line = serde_json::to_vec(&request)?;
        let response = server.process_line(&line)?;
        let decoded: AgentResponseV1 = serde_json::from_slice(&response)?;
        assert!(decoded.error.is_none());
    }
    assert!(started.elapsed() < Duration::from_secs(2));
    let before_close = server.resource_snapshot();
    assert_eq!(before_close.completed_request_ids, 32);
    server.close();
    assert_eq!(
        server.resource_snapshot(),
        AgentProtocolResourceSnapshotV1 {
            completed_request_ids: 0,
            retained_artifacts: 0,
            retained_artifact_bytes: 0,
        }
    );
    Ok(())
}
