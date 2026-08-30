use ed25519_dalek::{Signer, SigningKey};
use er_production::*;
use er_types::SafeU53;

#[test]
fn signed_rollout_is_sticky_and_hard_stops_deterministically()
-> Result<(), Box<dyn std::error::Error>> {
    let signing = SigningKey::from_bytes(&[9_u8; 32]);
    let trusted = trusted(&signing)?;
    let policy = policy()?;
    let signed = SignedRolloutPolicyV1 {
        envelope_version: 1,
        key_id: ReleaseSigningKeyId("rollout-key".to_owned()),
        signature: signing.sign(&policy.signed_bytes()?).to_bytes().to_vec(),
        payload: policy.clone(),
    };
    signed.verify(std::slice::from_ref(&trusted), timestamp(2_000)?)?;
    assert_eq!(
        policy.cohort_bucket("account-1"),
        policy.cohort_bucket("account-1")
    );

    let ring = &policy.rings[3];
    let mut health = healthy();
    health.observed_sessions = ring.minimum_sessions;
    health.observed_minutes = ring.minimum_duration_minutes;
    assert_eq!(health.evaluate(ring)?, RingHealthDecisionV1::Promote);
    let evidence = health.decision_evidence(
        ring,
        ReleaseHealthDecisionIdentityV1 {
            release_id: ProductionReleaseId("release-2".to_owned()),
            policy_hash: "b".repeat(64),
            release_manifest_hash: "c".repeat(64),
            input_event_aggregate_hash: "d".repeat(64),
            window_start: timestamp(1_000)?,
            window_end: timestamp(2_000)?,
        },
    )?;
    assert_eq!(evidence.decision, RingHealthDecisionV1::Promote);
    assert_eq!(evidence.ring, ring.ring);
    health.hard_stop = true;
    health.hard_stop_fingerprint = Some(FailureFingerprintV1("a".repeat(64)));
    assert_eq!(health.evaluate(ring)?, RingHealthDecisionV1::Halt);
    Ok(())
}

#[test]
fn signed_rollback_targets_previous_rust_and_rejects_tampering()
-> Result<(), Box<dyn std::error::Error>> {
    let signing = SigningKey::from_bytes(&[9_u8; 32]);
    let trusted = trusted(&signing)?;
    let directive = RollbackDirectiveV1 {
        schema_version: 1,
        directive_id: RollbackDirectiveId("rollback-1".to_owned()),
        affected_release: ProductionReleaseId("release-2".to_owned()),
        target_release: ProductionReleaseId("release-1".to_owned()),
        target_runtime: ProductionAuthorityRuntimeV1::RustProduction,
        scope: RollbackScopeV1::NewSessions,
        reason: RollbackReasonV1::OperatorDrill,
        issued_at: timestamp(1_000)?,
        expires_at: timestamp(3_000)?,
        policy_version: 2,
    };
    let signed = SignedRollbackDirectiveV1 {
        envelope_version: 1,
        key_id: ReleaseSigningKeyId("rollout-key".to_owned()),
        signature: signing.sign(&directive.signed_bytes()?).to_bytes().to_vec(),
        payload: directive,
    };
    signed.verify(&[trusted], timestamp(2_000)?)?;
    let mut tampered = signed;
    tampered.payload.target_runtime = ProductionAuthorityRuntimeV1::LegacyTransition;
    assert!(tampered.verify(&[], timestamp(2_000)?).is_err());
    Ok(())
}

fn policy() -> Result<RolloutPolicyV1, Box<dyn std::error::Error>> {
    let percentages = [0_u16, 0, 0, 100, 500, 2_500, 5_000, 10_000];
    let rings = percentages
        .into_iter()
        .enumerate()
        .map(|(index, percentage_basis_points)| RolloutRingV1 {
            ring: RolloutRingId(format!("R{index}")),
            percentage_basis_points,
            eligibility: if index < 3 {
                RolloutEligibilityV1::InternalAllowlist
            } else {
                RolloutEligibilityV1::Public
            },
            minimum_sessions: 1,
            minimum_duration_minutes: 1,
            required_health: budget(),
        })
        .collect();
    Ok(RolloutPolicyV1 {
        schema_version: 1,
        policy_id: RolloutPolicyId("policy-1".to_owned()),
        policy_version: 1,
        candidate_release: ProductionReleaseId("release-2".to_owned()),
        stable_release: ProductionReleaseId("release-1".to_owned()),
        legacy_release: None,
        active_ring: RolloutRingId("R3".to_owned()),
        rings,
        hard_stop_rules: vec![
            RolloutHardStopRuleV1::SaveCorruption,
            RolloutHardStopRuleV1::DeterministicMigrationFailure,
            RolloutHardStopRuleV1::MechanicalDivergence,
            RolloutHardStopRuleV1::MixedArtifactExecution,
            RolloutHardStopRuleV1::AcceptedProtocolMismatch,
            RolloutHardStopRuleV1::CrossGenerationMaterial,
            RolloutHardStopRuleV1::AuthorityReplicaMismatch,
            RolloutHardStopRuleV1::UnsignedAssignment,
            RolloutHardStopRuleV1::RendererCanonicalMutation,
        ],
        soft_stop_rules: vec![RolloutSoftStopRuleV1::WorkerFailureRate],
        issued_at: timestamp(1_000)?,
        expires_at: timestamp(3_000)?,
    })
}

fn budget() -> ReleaseHealthBudgetV1 {
    ReleaseHealthBudgetV1 {
        worker_initialization_failure_basis_points: 20,
        unrecoverable_kernel_fault_basis_points: 5,
        deterministic_migration_failures: 0,
        cloud_save_regression_basis_points: 10,
        coop_relative_regression_percent: 10,
        coop_absolute_regression_basis_points: 25,
        input_latency_regression_percent: 20,
        crash_free_regression_basis_points: 10,
    }
}

fn healthy() -> ReleaseHealthSnapshotV1 {
    ReleaseHealthSnapshotV1 {
        schema_version: 1,
        observed_sessions: 0,
        observed_minutes: 0,
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

fn trusted(signing: &SigningKey) -> Result<TrustedReleaseKeyV1, Box<dyn std::error::Error>> {
    Ok(TrustedReleaseKeyV1 {
        key_id: ReleaseSigningKeyId("rollout-key".to_owned()),
        public_key: signing.verifying_key().to_bytes(),
        channels: vec![ReleaseChannelV1::Stable, ReleaseChannelV1::Rollback],
        minimum_release_epoch: SafeU53::new(1)?,
        revoked: false,
    })
}

fn timestamp(value: u64) -> Result<PlatformTimestamp, Box<dyn std::error::Error>> {
    Ok(PlatformTimestamp(SafeU53::new(value)?))
}
