use er_kernel_worker::{KernelGenerationIdentityV1, KernelGenerationV1, KernelSessionIdV1};
use er_production::*;

#[test]
fn health_events_are_bounded_and_hard_stops_require_fingerprints()
-> Result<(), Box<dyn std::error::Error>> {
    let release = ProductionReleaseId("release-2".to_owned());
    let fingerprint =
        normalized_failure_fingerprint_v1(&release, 7, "SAVE", "READ_FAILURE", "CAS_CONFLICT")?;
    let event = ProductionHealthEventV1 {
        schema_version: 1,
        release_id: release,
        kernel_generation: generation(),
        browser_class: BrowserClassV1::Chromium,
        platform_class: PlatformClassV1::Desktop,
        event: ProductionHealthEventKindV1::KernelFault,
        failure_fingerprint: Some(fingerprint),
        performance: None,
        hard_stop_rule: Some(RolloutHardStopRuleV1::SaveCorruption),
    };
    event.validate()?;

    let mut missing_fingerprint = event;
    missing_fingerprint.failure_fingerprint = None;
    assert!(missing_fingerprint.validate().is_err());
    Ok(())
}

#[test]
fn failure_and_performance_aggregation_is_deterministic() -> Result<(), Box<dyn std::error::Error>>
{
    let release = ProductionReleaseId("release-2".to_owned());
    let first =
        normalized_failure_fingerprint_v1(&release, 7, "SAVE", "READ_FAILURE", "CAS_CONFLICT")?;
    let second =
        normalized_failure_fingerprint_v1(&release, 8, "SAVE", "READ_FAILURE", "CAS_CONFLICT")?;
    assert_ne!(first, second);

    let summary = aggregate_performance_summary_v1(&[
        PerformanceObservationV1 {
            elapsed_micros: 100,
            memory_bytes: 10,
        },
        PerformanceObservationV1 {
            elapsed_micros: 500,
            memory_bytes: 30,
        },
        PerformanceObservationV1 {
            elapsed_micros: 300,
            memory_bytes: 20,
        },
        PerformanceObservationV1 {
            elapsed_micros: 200,
            memory_bytes: 15,
        },
    ])?;
    assert_eq!(summary.samples, 4);
    assert_eq!(summary.median_micros, 200);
    assert_eq!(summary.p95_micros, 500);
    assert_eq!(summary.p99_micros, 500);
    assert_eq!(summary.maximum_micros, 500);
    assert_eq!(summary.memory_bytes, 30);

    let events = [
        event(second.clone()),
        event(first.clone()),
        event(first.clone()),
    ];
    let aggregate = aggregate_failure_fingerprints_v1(&events)?;
    assert_eq!(aggregate.len(), 2);
    let first_count = aggregate
        .iter()
        .find(|value| value.fingerprint == first)
        .map(|value| value.count);
    let second_count = aggregate
        .iter()
        .find(|value| value.fingerprint == second)
        .map(|value| value.count);
    assert_eq!(first_count, Some(2));
    assert_eq!(second_count, Some(1));
    Ok(())
}

fn event(fingerprint: FailureFingerprintV1) -> ProductionHealthEventV1 {
    ProductionHealthEventV1 {
        schema_version: 1,
        release_id: ProductionReleaseId("release-2".to_owned()),
        kernel_generation: generation(),
        browser_class: BrowserClassV1::Chromium,
        platform_class: PlatformClassV1::Desktop,
        event: ProductionHealthEventKindV1::KernelFault,
        failure_fingerprint: Some(fingerprint),
        performance: None,
        hard_stop_rule: None,
    }
}

fn generation() -> KernelGenerationIdentityV1 {
    KernelGenerationIdentityV1 {
        schema_version: 1,
        session_id: KernelSessionIdV1("session-1".to_owned()),
        generation: KernelGenerationV1(7),
        artifact_sha256: "a".repeat(64),
        executable_sha256: "b".repeat(64),
        source_git_sha: "c".repeat(40),
        worker_abi_version: 1,
        minimum_snapshot_schema: 6,
        maximum_snapshot_schema: 6,
        content_identity: "content-1".to_owned(),
        build_target: "wasm32-unknown-unknown".to_owned(),
        build_profile: "release".to_owned(),
    }
}
