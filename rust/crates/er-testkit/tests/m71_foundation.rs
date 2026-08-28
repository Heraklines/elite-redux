//! M7.1 DP-A developer-plane foundation contracts.

use std::collections::BTreeSet;
use std::error::Error;

use er_dev_types::*;
use er_devplane::{
    CheckpointEntryV1, CheckpointStoreV1, SessionLineageV1, TelemetryEventKindV1, TelemetryEventV1,
    TelemetryRingV1,
};
use er_model::*;
use er_render_model::*;
use er_types::{
    BattleContentPackHashV3, CatalogHash, GameContentBundleHash, GameContentIdentity, OracleSha,
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
fn mechanical_compatibility_excludes_build_and_adapters() -> Result<(), Box<dyn Error>> {
    let left = identity()?;
    let mut right = left.clone();
    right.build.build_profile = KnownOrUnknownV1::Known("release".to_owned());
    right.adapters.renderer = Some("diagnostic-renderer".to_owned());
    assert!(left.mechanically_compatible(&right));
    right.mechanical.save_schema = 2;
    assert!(!left.mechanically_compatible(&right));
    Ok(())
}

#[test]
fn causal_ids_ignore_evidence_profile_and_graph_rejects_dangling_edges()
-> Result<(), Box<dyn Error>> {
    let address = CausalAddressV1 {
        session_root: "root".to_owned(),
        external_sequence: 7,
        operation_or_material: "operation/1".to_owned(),
        evidence_kind: CausalNodeKindV1::Mutation,
        ordinal_path: vec![2, 3],
    };
    let causal = CausalId::derive(&address)?;
    for _profile in [
        EvidenceProfile::None,
        EvidenceProfile::Causal,
        EvidenceProfile::Full,
    ] {
        assert_eq!(CausalId::derive(&address)?, causal);
    }
    let graph = CausalGraphV1 {
        maximum_nodes: 2,
        maximum_edges: 1,
        nodes: vec![CausalNodeV1 {
            id: causal.clone(),
            node_kind: CausalNodeKindV1::Mutation,
            source: Some(CausalSourceV1::CoreRule {
                rule: "rule".to_owned(),
            }),
            summary: "mutation".to_owned(),
        }],
        edges: vec![CausalEdgeV1 {
            from: causal,
            to: CausalId("d".repeat(64)),
            edge_kind: CausalEdgeKindV1::Caused,
        }],
        truncated: false,
    };
    assert_eq!(graph.validate(), Err(CausalGraphErrorV1::Dangling));
    Ok(())
}

#[test]
fn diagnostic_diff_localizes_deepest_retained_path() {
    let root = StatePathV1(vec![StatePathSegmentV1::Run]);
    let hp = StatePathV1(vec![
        StatePathSegmentV1::Run,
        StatePathSegmentV1::Party,
        StatePathSegmentV1::Pokemon("1".to_owned()),
        StatePathSegmentV1::FieldName("hp".to_owned()),
    ]);
    let expected = DiagnosticDigestTreeV1 {
        mechanical_digest: "m".to_owned(),
        diagnostic_root: "a".to_owned(),
        level: DiagnosticDigestLevelV1::Leaf,
        maximum_nodes: 2,
        nodes: vec![
            DigestNodeV1 {
                path: root.clone(),
                digest: "r".to_owned(),
                children: vec![hp.clone()],
            },
            DigestNodeV1 {
                path: hp.clone(),
                digest: "10".to_owned(),
                children: Vec::new(),
            },
        ],
        truncated: false,
    };
    let mut actual = expected.clone();
    actual.diagnostic_root = "b".to_owned();
    actual.nodes[1].digest = "9".to_owned();
    let diff = expected.diff(&actual, 4);
    assert_eq!(diff.first_mismatch, Some(hp));
}

#[test]
fn observation_permissions_are_monotonic_and_hidden_state_gated() {
    assert!(
        authorize_observation_v1(
            ObservationProfile::Agent,
            ObservationProfile::Forensic,
            false
        )
        .is_ok()
    );
    assert_eq!(
        authorize_observation_v1(
            ObservationProfile::Debug,
            ObservationProfile::Forensic,
            false
        ),
        Err(ObservationErrorV1::HiddenStateDenied)
    );
    assert_eq!(
        authorize_observation_v1(
            ObservationProfile::Forensic,
            ObservationProfile::Agent,
            true
        ),
        Err(ObservationErrorV1::ProfileDenied)
    );
}

#[test]
fn snapshot_v7_projection_preserves_wrapped_v6_bytes() -> Result<(), Box<dyn Error>> {
    let v6 = vec![1_u8, 2, 3];
    let wrapped = RestorableKernelSnapshotV7::from_v6(
        v6.clone(),
        identity()?,
        DeveloperSnapshotStateV1 {
            external_sequence: er_types::SafeU53::ZERO,
            virtual_time_ms: er_types::SafeU53::ZERO,
            session_root: "root".to_owned(),
            session_branch: "branch".to_owned(),
            checkpoint_identity: "checkpoint".to_owned(),
            evidence_profile: EvidenceProfile::None,
            causal_frontier_digest: None,
        },
    )?;
    assert_eq!(wrapped.into_v6(), v6);
    Ok(())
}

#[test]
fn checkpoint_telemetry_and_lineage_are_bounded() -> Result<(), Box<dyn Error>> {
    let lineage = SessionLineageV1::root("seed")?;
    let fork = lineage.fork(4, "digest".to_owned(), 0)?;
    assert_eq!(fork.root, lineage.root);
    let mut checkpoints = CheckpointStoreV1::new(6, 2)?;
    checkpoints.insert(CheckpointEntryV1 {
        checkpoint_id: "start".to_owned(),
        sequence: 0,
        virtual_time_ms: 0,
        snapshot_digest: "a".to_owned(),
        snapshot_bytes: vec![1, 2, 3],
        pinned: true,
    })?;
    checkpoints.insert(CheckpointEntryV1 {
        checkpoint_id: "next".to_owned(),
        sequence: 1,
        virtual_time_ms: 1,
        snapshot_digest: "b".to_owned(),
        snapshot_bytes: vec![4, 5, 6],
        pinned: false,
    })?;
    let mut telemetry = TelemetryRingV1::new(4, 2)?;
    telemetry.push(TelemetryEventV1 {
        sequence: 1,
        event_kind: TelemetryEventKindV1::Checkpoint,
        payload: vec![1, 2],
        redacted: true,
        pinned: false,
    })?;
    telemetry.push(TelemetryEventV1 {
        sequence: 2,
        event_kind: TelemetryEventKindV1::Terminal,
        payload: vec![3, 4, 5],
        redacted: true,
        pinned: false,
    })?;
    assert_eq!(telemetry.events().len(), 1);
    Ok(())
}

#[test]
fn model_boundary_is_authority_only_and_legal_action_checked() -> Result<(), Box<dyn Error>> {
    let request = ModelRequestEnvelopeV1 {
        request_id: ModelRequestIdV1("request".to_owned()),
        model_slot: ModelSlotIdV1("battle".to_owned()),
        model_hash: ModelHashV1("hash".to_owned()),
        authority_only: true,
        request: ModelRequestV1::BattlePolicy(BattlePolicyObservationV1 {
            observation_bytes: vec![1],
            legal_action_ids: vec!["move/1".to_owned()],
        }),
    };
    assert_eq!(
        request.validate(false),
        Err(ModelBoundaryErrorV1::ReplicaRequest)
    );
    request.validate(true)?;
    let illegal = ModelResponseEnvelopeV1 {
        request_id: request.request_id.clone(),
        model_hash: request.model_hash.clone(),
        backend: InferenceBackendIdV1("recorded".to_owned()),
        output: ModelOutputV1::LegalAction("move/2".to_owned()),
        latency_micros: 5,
    };
    assert_eq!(
        request.validate_response(&illegal),
        Err(ModelBoundaryErrorV1::IllegalOutput)
    );
    Ok(())
}

#[test]
fn render_scene_is_semantic_and_unknown_parent_rejected() -> Result<(), Box<dyn Error>> {
    let source = derive_render_node_id_v1("root", 1, "material/1", vec![0])?;
    let missing = CausalId("e".repeat(64));
    let snapshot = SemanticRenderSnapshotV1 {
        scene_generation: 1,
        renderer_identity: "diagnostic".to_owned(),
        nodes: vec![SemanticRenderNodeV1 {
            id: source,
            semantic_source: "actor/1".to_owned(),
            parent: Some(missing),
            asset_identity: None,
            transform: RenderTransformV1 {
                x_milli: 0,
                y_milli: 0,
                scale_x_milli: 1_000,
                scale_y_milli: 1_000,
                rotation_milliradians: 0,
            },
            bounds: RenderBoundsV1 {
                width_milli: 1,
                height_milli: 1,
            },
            layer: 0,
            visible: true,
            animation_state: None,
        }],
    };
    assert_eq!(snapshot.validate(), Err(RenderModelErrorV1::Graph));
    Ok(())
}

#[test]
fn core_crates_do_not_depend_on_developer_plane_and_semantic_methods_are_absent() {
    let developer_names = [
        "er-dev-types",
        "er-devplane",
        "er-repro",
        "er-agent-protocol",
        "er-model",
        "er-render-model",
        "er-impact",
        "er-batch",
    ];
    let core_manifests = [
        include_str!("../../er-state/Cargo.toml"),
        include_str!("../../er-battle/Cargo.toml"),
        include_str!("../../er-run/Cargo.toml"),
        include_str!("../../er-game/Cargo.toml"),
        include_str!("../../er-kernel/Cargo.toml"),
        include_str!("../../er-protocol/Cargo.toml"),
        include_str!("../../er-mechanics/Cargo.toml"),
    ];
    for manifest in core_manifests {
        for name in developer_names {
            assert!(!manifest.contains(name));
        }
    }
    let public_sources = [
        include_str!("../../er-devplane/src/lib.rs"),
        include_str!("../../er-agent-protocol/src/lib.rs"),
    ]
    .join("\n");
    for forbidden in [
        "choose_move",
        "select_reward",
        "force_capture",
        "resolve_turn",
    ] {
        assert!(!public_sources.contains(forbidden));
    }
    assert_eq!(BTreeSet::from(developer_names).len(), developer_names.len());
}
