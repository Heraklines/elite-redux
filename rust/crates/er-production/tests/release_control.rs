use ed25519_dalek::{Signer, SigningKey};
use er_kernel_worker::{KernelGenerationIdentityV1, KernelGenerationV1, KernelSessionIdV1};
use er_production::*;
use er_types::SafeU53;

#[test]
fn release_and_assignment_require_valid_ed25519_signatures()
-> Result<(), Box<dyn std::error::Error>> {
    let signing = SigningKey::from_bytes(&[7_u8; 32]);
    let trusted = vec![trusted_key(&signing, vec![ReleaseChannelV1::Stable])?];
    let now = timestamp(2_000)?;
    let manifest = manifest("release-2", 2, ReleaseChannelV1::Stable, now)?;
    let signed = SignedProductionManifestV1 {
        envelope_version: 1,
        key_id: ReleaseSigningKeyId("test-key".to_owned()),
        signature: signing.sign(&manifest.signed_bytes()?).to_bytes().to_vec(),
        payload: manifest.clone(),
    };
    signed.verify(&trusted, now)?;
    let mut tampered = signed.clone();
    tampered.payload.release_id = ProductionReleaseId("release-tampered".to_owned());
    assert!(tampered.verify(&trusted, now).is_err());

    let assignment = RuntimeAssignmentV1 {
        schema_version: 1,
        assignment_id: RuntimeAssignmentId("assignment-1".to_owned()),
        release_id: manifest.release_id,
        authority: ProductionAuthorityRuntimeV1::RustProduction,
        cohort: RolloutCohortId("cohort-1".to_owned()),
        sticky_scope: RuntimeAssignmentScopeV1::BrowserSession {
            session_id: BrowserGameSessionId("session-1".to_owned()),
        },
        issued_at: timestamp(1_000)?,
        expires_at: timestamp(3_000)?,
        policy_version: 1,
    };
    let signed_assignment = SignedRuntimeAssignmentV1 {
        envelope_version: 1,
        key_id: ReleaseSigningKeyId("test-key".to_owned()),
        signature: signing
            .sign(&assignment.signed_bytes()?)
            .to_bytes()
            .to_vec(),
        payload: assignment,
    };
    signed_assignment.verify(&trusted, ReleaseChannelV1::Stable, now)?;
    Ok(())
}

#[test]
fn session_pins_and_registry_keep_active_previous_release() -> Result<(), Box<dyn std::error::Error>>
{
    let now = timestamp(2_000)?;
    let release_one = manifest("release-1", 1, ReleaseChannelV1::Rollback, now)?;
    let release_two = manifest("release-2", 2, ReleaseChannelV1::Stable, now)?;
    let pin = SessionRuntimePinV1 {
        schema_version: 1,
        session_id: BrowserGameSessionId("session-1".to_owned()),
        run_id: Some(ProductionRunId("run-1".to_owned())),
        release_id: release_one.release_id.clone(),
        kernel_generation: KernelGenerationIdentityV1 {
            schema_version: 1,
            session_id: KernelSessionIdV1("session-1".to_owned()),
            generation: KernelGenerationV1(1),
            artifact_sha256: "a".repeat(64),
            executable_sha256: "b".repeat(64),
            source_git_sha: "c".repeat(40),
            worker_abi_version: 1,
            minimum_snapshot_schema: 6,
            maximum_snapshot_schema: 6,
            content_identity: "content".to_owned(),
            build_target: "wasm32-unknown-unknown".to_owned(),
            build_profile: "release".to_owned(),
        },
        mechanical_identity: release_one.mechanical_identity.clone(),
        authority: ProductionAuthorityRuntimeV1::RustProduction,
        created_sequence: SafeU53::new(0)?,
        latest_sequence: SafeU53::new(10)?,
    };
    pin.validate()?;
    let mut registry = ProductionGenerationRegistryV1 {
        schema_version: 1,
        releases: vec![
            ProductionGenerationEntryV1 {
                release: release_one,
                status: ProductionGenerationStatusV1::Rollback,
                assigned_new_sessions: 1,
                active_sessions: 1,
                health: health(),
            },
            ProductionGenerationEntryV1 {
                release: release_two,
                status: ProductionGenerationStatusV1::Stable,
                assigned_new_sessions: 0,
                active_sessions: 0,
                health: health(),
            },
        ],
    };
    registry.validate()?;
    let release_two_id = ProductionReleaseId("release-2".to_owned());
    registry.assign_new_session(&release_two_id)?;
    assert_eq!(
        registry
            .entry(&release_two_id)
            .map(|entry| entry.active_sessions),
        Some(1)
    );
    assert!(
        !registry
            .eviction_candidates()
            .contains(&ProductionReleaseId("release-1".to_owned()))
    );
    Ok(())
}

fn manifest(
    id: &str,
    epoch: u64,
    channel: ReleaseChannelV1,
    now: PlatformTimestamp,
) -> Result<ProductionReleaseManifestV2, Box<dyn std::error::Error>> {
    let sha = "1".repeat(64);
    let artifact = |name: &str| ArtifactIdentityV1 {
        url: format!("/__m9_releases/{id}/{sha}/{name}"),
        sha256: sha.clone(),
        bytes: 1,
        media_type: "application/octet-stream".to_owned(),
    };
    let manifest = ProductionReleaseManifestV2 {
        schema_version: 2,
        release_id: ProductionReleaseId(id.to_owned()),
        release_epoch: SafeU53::new(epoch)?,
        channel,
        issued_at: timestamp(1_000)?,
        expires_at: timestamp(3_000)?,
        integration_sha: "a".repeat(40),
        rust_base_sha: "b".repeat(40),
        browser_base_sha: "c".repeat(40),
        oracle_sha: "d".repeat(40),
        qualified_asset_sha: "e".repeat(40),
        mechanical_identity: MechanicalCompatibilityIdentityV1 {
            schema_version: 1,
            mechanics_sha256: "2".repeat(64),
            content_hash: "content".to_owned(),
            authority_protocol: "er-coop-47".to_owned(),
            active_model_identity: "model".to_owned(),
        },
        build_identity: BuildDiagnosticIdentityV1 {
            schema_version: 1,
            toolchain: "rust".to_owned(),
            target: "wasm32-unknown-unknown".to_owned(),
            profile: "release".to_owned(),
            lockfile_sha256: "3".repeat(64),
            build_config_sha256: "4".repeat(64),
            debug_surfaces_absent: true,
        },
        browser_kernel_abi: 1,
        worker_protocol: 1,
        authority_protocol: "er-coop-47".to_owned(),
        material_schemas: MaterialSchemaSetV1 {
            turn: 1,
            replacement: 1,
            recovery: 1,
            presentation: 1,
        },
        save_schema: 2,
        artifacts: ProductionArtifactSetV1 {
            bootstrap_js: artifact("bootstrap.js"),
            browser_js: artifact("browser.js"),
            worker_js: artifact("worker.js"),
            wasm_glue_js: artifact("glue.js"),
            wasm: artifact("kernel.wasm"),
            content: artifact("content.json"),
            asset_manifest: artifact("assets.json"),
            service_worker: artifact("service-worker.js"),
        },
        previous_rust_release: None,
        legacy_transition_release: None,
        platform_api_versions: PlatformApiVersionSetV1 {
            schema_version: 1,
            save_api: 2,
            telemetry_api: 1,
            signaling_api: 33,
            showdown_api: 1,
            achievement_api: 1,
        },
        qualification: ProductionQualificationEvidenceV1 {
            candidate_sha: "a".repeat(40),
            workflow_run_id: 1,
            workflow_name: "test".to_owned(),
            conclusion: "SUCCESS".to_owned(),
            artifact_set_sha256: "5".repeat(64),
        },
    };
    manifest.validate(now)?;
    Ok(manifest)
}

fn trusted_key(
    signing: &SigningKey,
    channels: Vec<ReleaseChannelV1>,
) -> Result<TrustedReleaseKeyV1, Box<dyn std::error::Error>> {
    Ok(TrustedReleaseKeyV1 {
        key_id: ReleaseSigningKeyId("test-key".to_owned()),
        public_key: signing.verifying_key().to_bytes(),
        channels,
        minimum_release_epoch: SafeU53::new(1)?,
        revoked: false,
    })
}

fn health() -> ReleaseHealthSnapshotV1 {
    ReleaseHealthSnapshotV1 {
        schema_version: 1,
        observed_sessions: 100,
        observed_minutes: 100,
        worker_initialization_failure_basis_points: 0,
        unrecoverable_kernel_fault_basis_points: 0,
        deterministic_migration_failures: 0,
        cloud_save_regression_basis_points: 0,
        coop_relative_regression_percent: 0,
        coop_absolute_regression_basis_points: 0,
        input_latency_regression_percent: 0,
        crash_free_regression_basis_points: 0,
        hard_stop: false,
        hard_stop_fingerprint: None,
    }
}

fn timestamp(value: u64) -> Result<PlatformTimestamp, Box<dyn std::error::Error>> {
    Ok(PlatformTimestamp(SafeU53::new(value)?))
}
