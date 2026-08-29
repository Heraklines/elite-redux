//! M7.2 incremental content, reload, platform, viewer, security, cache, and architecture qualification.

use std::collections::BTreeMap;
use std::error::Error;

use er_dev_types::ExternalTraceInputV7;
use er_lab::*;
use er_render_model::*;
use er_types::{InputFocus, PhysicalKey, RawInputEvent, SafeU53};

fn fragment(group: &str, source: &str, bytes: &[u8], dependencies: Vec<&str>) -> ContentFragmentV1 {
    ContentFragmentV1 {
        group: SemanticGroupIdV1(group.to_owned()),
        source_digest: source.to_owned(),
        compiled_digest: format!("blake3-v1:{}", blake3::hash(bytes).to_hex()),
        compiled_bytes: bytes.to_vec(),
        dependencies: dependencies
            .into_iter()
            .map(|value| SemanticGroupIdV1(value.to_owned()))
            .collect(),
    }
}

#[derive(Debug)]
struct CompilerBackend;

impl IncrementalContentBackendV1 for CompilerBackend {
    fn compile_group(
        &self,
        group: &SemanticGroupIdV1,
        source_digest: &str,
        dependencies: &[ContentFragmentV1],
    ) -> Result<ContentFragmentV1, String> {
        let bytes = format!(
            "{}:{}:{}",
            group.0,
            source_digest,
            dependencies
                .iter()
                .map(|dependency| dependency.compiled_digest.as_str())
                .collect::<Vec<_>>()
                .join(",")
        )
        .into_bytes();
        Ok(ContentFragmentV1 {
            group: group.clone(),
            source_digest: source_digest.to_owned(),
            compiled_digest: format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()),
            compiled_bytes: bytes,
            dependencies: dependencies
                .iter()
                .map(|dependency| dependency.group.clone())
                .collect(),
        })
    }

    fn assemble_and_validate(&self, fragments: &[ContentFragmentV1]) -> Result<String, String> {
        let bytes = er_canonical::canonical_bytes(&fragments).map_err(|error| error.to_string())?;
        Ok(format!("blake3-v1:{}", blake3::hash(&bytes).to_hex()))
    }
}

#[test]
fn incremental_compile_rebuilds_changed_group_and_dependents() -> Result<(), Box<dyn Error>> {
    let current = vec![
        fragment("base", "source-a", b"base-a", Vec::new()),
        fragment("dependent", "source-b", b"dependent-b", vec!["base"]),
    ];
    let (candidate, report) = compile_incremental_content_v1(
        &current,
        &IncrementalCompilePlanV1 {
            current_identity: "current".to_owned(),
            changed_source_digests: BTreeMap::from([(
                SemanticGroupIdV1("base".to_owned()),
                "source-a2".to_owned(),
            )]),
            maximum_groups: 8,
            maximum_fragment_bytes: 4096,
            maximum_total_bytes: 8192,
        },
        &CompilerBackend,
    )?;
    assert_eq!(report.rebuilt_groups.len(), 2);
    assert!(report.reused_groups.is_empty());
    let diff = diff_content_v1(
        "current".to_owned(),
        &current,
        report.candidate_identity.clone(),
        &candidate,
        8,
    )?;
    assert_eq!(
        diff.affected_groups,
        vec![
            SemanticGroupIdV1("base".to_owned()),
            SemanticGroupIdV1("dependent".to_owned())
        ]
    );
    Ok(())
}

#[derive(Debug)]
struct ReloadBackend;

impl ContentReloadBackendV1 for ReloadBackend {
    type Prepared = String;
    type Fork = Vec<u8>;

    fn prepare_candidate(
        &self,
        _: &[ContentFragmentV1],
    ) -> Result<(String, Self::Prepared), String> {
        Ok(("candidate".to_owned(), "prepared".to_owned()))
    }

    fn fork_current(&self) -> Result<Self::Fork, String> {
        Ok(vec![1])
    }

    fn migrate_fork(&self, mut fork: Self::Fork, _: &Self::Prepared) -> Result<Self::Fork, String> {
        fork.push(2);
        Ok(fork)
    }

    fn replay(
        &self,
        _: &mut Self::Fork,
        trace: &[ExternalTraceInputV7],
    ) -> Result<Vec<ReloadReplayEvidenceV1>, String> {
        Ok(trace
            .iter()
            .enumerate()
            .map(|(sequence, _)| ReloadReplayEvidenceV1 {
                sequence: sequence as u64,
                mechanical_digest: format!("m-{sequence}"),
                control_digest: format!("c-{sequence}"),
                invariant_failures: Vec::new(),
            })
            .collect())
    }
}

#[test]
fn content_reload_preflights_fork_and_keeps_live_session_pinned() -> Result<(), Box<dyn Error>> {
    let current = vec![fragment("base", "a", b"a", Vec::new())];
    let candidate = vec![fragment("base", "b", b"b", Vec::new())];
    let diff = diff_content_v1(
        "current".to_owned(),
        &current,
        "candidate".to_owned(),
        &candidate,
        4,
    )?;
    let trace = vec![ExternalTraceInputV7::RawInput(RawInputEvent::KeyDown {
        code: PhysicalKey::Space,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    })];
    let report = preflight_content_reload_v1(
        &ContentReloadPlanV1 {
            current_identity: "current".to_owned(),
            candidate_identity: "candidate".to_owned(),
            diff,
            recent_trace: trace,
            expected: vec![ReloadReplayEvidenceV1 {
                sequence: 0,
                mechanical_digest: "m-0".to_owned(),
                control_digest: "c-0".to_owned(),
                invariant_failures: Vec::new(),
            }],
            maximum_events: 8,
            migrate_active_session: true,
        },
        &candidate,
        &ReloadBackend,
    )?;
    assert!(report.compatible);
    assert!(report.approved_for_new_sessions);
    assert!(!report.active_session_migrated);
    Ok(())
}

#[derive(Debug)]
struct MigrationBackend;

impl SessionMigrationBackendV1 for MigrationBackend {
    fn migrate_step(
        &self,
        migration_id: &str,
        snapshot: &[u8],
        _: usize,
    ) -> Result<Vec<u8>, String> {
        let mut bytes = snapshot.to_vec();
        bytes.extend_from_slice(migration_id.as_bytes());
        Ok(bytes)
    }

    fn replay(&self, _: &[u8], trace: &[ExternalTraceInputV7]) -> Result<Vec<String>, String> {
        Ok(trace
            .iter()
            .enumerate()
            .map(|(index, _)| format!("digest-{index}"))
            .collect())
    }
}

#[test]
fn schema_migration_uses_explicit_path_and_exact_replay() -> Result<(), Box<dyn Error>> {
    let report = migrate_and_replay_v1(
        &SessionMigrationPlanV1 {
            from_schema: 1,
            to_schema: 3,
            snapshot_bytes: vec![1],
            trace: vec![ExternalTraceInputV7::AdvanceTime(SafeU53::ZERO)],
            expected_digests: vec!["digest-0".to_owned()],
            edges: vec![
                SnapshotMigrationEdgeV1 {
                    from_schema: 1,
                    to_schema: 2,
                    migration_id: "one-two".to_owned(),
                },
                SnapshotMigrationEdgeV1 {
                    from_schema: 2,
                    to_schema: 3,
                    migration_id: "two-three".to_owned(),
                },
            ],
            maximum_snapshot_bytes: 1024,
            maximum_trace_events: 8,
        },
        &MigrationBackend,
    )?;
    assert!(report.compatible);
    assert_eq!(report.migration_path, vec!["one-two", "two-three"]);
    Ok(())
}

#[test]
fn fixed_platform_corpus_detects_first_divergence() -> Result<(), Box<dyn Error>> {
    let case = CrossPlatformCaseV1 {
        id: "bootstrap".to_owned(),
        capsule_digest: "blake3-v1:capsule".to_owned(),
        required_platforms: vec![
            DeterminismPlatformV1::LinuxX64,
            DeterminismPlatformV1::WindowsX64,
        ],
    };
    let evidence = |events: Vec<&str>| PlatformEvidenceV1 {
        event_digests: events.into_iter().map(str::to_owned).collect(),
        final_mechanical_digest: "mechanical".to_owned(),
        save_digest: Some("save".to_owned()),
        resource_digest: "zero".to_owned(),
    };
    let green = BTreeMap::from([
        (DeterminismPlatformV1::LinuxX64, evidence(vec!["a", "b"])),
        (DeterminismPlatformV1::WindowsX64, evidence(vec!["a", "b"])),
    ]);
    assert!(compare_platform_evidence_v1(&case, &green)?.identical);
    let red = BTreeMap::from([
        (DeterminismPlatformV1::LinuxX64, evidence(vec!["a", "b"])),
        (DeterminismPlatformV1::WindowsX64, evidence(vec!["a", "c"])),
    ]);
    assert_eq!(
        compare_platform_evidence_v1(&case, &red)?.divergences[0].event,
        Some(1)
    );
    Ok(())
}

#[test]
fn semantic_reference_viewer_is_deterministic_and_escaped() -> Result<(), Box<dyn Error>> {
    let scene = PresentationSceneV1 {
        generation: 1,
        actors: vec![PresentationActorV1 {
            actor_id: "pokemon<&".to_owned(),
            semantic_kind: "POKEMON".to_owned(),
            visible: true,
        }],
        ui: Vec::new(),
        pending_events: Vec::new(),
    };
    let render = SemanticRenderSnapshotV1 {
        scene_generation: 1,
        renderer_identity: "test".to_owned(),
        nodes: vec![SemanticRenderNodeV1 {
            id: er_dev_types::CausalId("render-1".to_owned()),
            semantic_source: "pokemon<&".to_owned(),
            parent: None,
            asset_identity: Some("sprite/pokemon".to_owned()),
            transform: RenderTransformV1 {
                x_milli: 0,
                y_milli: 0,
                scale_x_milli: 1000,
                scale_y_milli: 1000,
                rotation_milliradians: 0,
            },
            bounds: RenderBoundsV1 {
                width_milli: 100,
                height_milli: 100,
            },
            layer: 0,
            visible: true,
            animation_state: None,
        }],
    };
    let first = build_semantic_reference_v1(&scene, Some(&render), 8, 16_384)?;
    let second = build_semantic_reference_v1(&scene, Some(&render), 8, 16_384)?;
    assert_eq!(first, second);
    assert!(first.html.contains("pokemon&lt;&amp;"));
    assert_eq!(first.asset_identities, vec!["sprite/pokemon"]);
    Ok(())
}

fn cache_key(unknown: bool) -> CompleteCacheKeyV1 {
    let known = |value: &str| CacheIdentityPartV1::Known(value.to_owned());
    CompleteCacheKeyV1 {
        source_revision: known(&"a".repeat(40)),
        cargo_lock: known("lock"),
        toolchain: known("1.97.1"),
        target: known("x86_64-unknown-linux-gnu"),
        profile: known("release"),
        features: known("features"),
        environment: known("environment"),
        content_identity: known("content"),
        scenario_digest: known("scenario"),
        operation: if unknown {
            CacheIdentityPartV1::Unknown
        } else {
            known("build")
        },
    }
}

#[test]
fn security_cache_and_architecture_fail_closed() -> Result<(), Box<dyn Error>> {
    assert!(validate_registry_path_v1("scenarios/battle/example.json").is_ok());
    assert!(validate_registry_path_v1("../escape").is_err());
    let limits = UntrustedInputLimitsV1 {
        maximum_bytes: 8,
        maximum_items: 2,
        maximum_depth: 4,
        maximum_events: 4,
        maximum_decompressed_bytes: 16,
    };
    assert_eq!(limits.reserve(2, 1, 3, 1)?, (5, 2));
    assert!(limits.reserve(7, 2, 2, 1).is_err());

    let mut cache = HermeticCacheV1::new(2, 16)?;
    assert!(!cache.insert(&cache_key(true), vec![1], false)?);
    assert!(cache.insert(&cache_key(false), vec![1, 2], false)?);
    assert_eq!(cache.get(&cache_key(false))?, Some(&[1, 2][..]));
    cache.clear();
    assert_eq!(cache.get(&cache_key(false))?, None);

    let manifest: ArchitectureManifestV1 = serde_json::from_str(include_str!(
        "../../../fixtures/m72/architecture-manifest.json"
    ))?;
    let audit = manifest.audit(Vec::new(), Vec::new(), Vec::new())?;
    assert!(audit.passed);
    Ok(())
}

#[test]
fn every_hard_performance_ceiling_requires_measurement() -> Result<(), Box<dyn Error>> {
    let ceilings = m72_performance_ceilings_v1();
    let measurements = ceilings
        .iter()
        .map(|ceiling| LabPerformanceMeasurementV1 {
            operation: ceiling.operation,
            runner_class: "github-ubuntu-x64".to_owned(),
            elapsed_micros: Some(ceiling.maximum_micros - 1),
            deterministic_work: 1,
            deterministic_checksum: "checksum".to_owned(),
            peak_rss_bytes: Some(1),
            allocations: Some(1),
        })
        .collect::<Vec<_>>();
    assert!(
        evaluate_performance_v1(&ceilings, &measurements)?
            .iter()
            .all(|result| result.passed)
    );
    assert!(evaluate_performance_v1(&ceilings, &measurements[..measurements.len() - 1]).is_err());
    Ok(())
}
