//! M6 performance qualification integration tests.
//!
//! Debug-profile runs assert determinism only: independent executions of the
//! same workload must reproduce identical ordered checksums and identical
//! execution counters. Timing is never asserted here; release ceilings are
//! compared through typed [`m6_benchmark::QualificationReport`] values and
//! enforced exclusively when the hosted workflow sets
//! [`m6_benchmark::HOSTED_ENFORCEMENT_ENV`].
//!
//! The benchmark workloads are shared with `er-sim`, which does not depend on
//! this crate, so the module is compiled in place from its owned source file.

#[path = "../../er-sim/src/m6_benchmark.rs"]
mod m6_benchmark;

use std::error::Error;

use m6_benchmark::{
    BenchmarkProfile, HOSTED_ENFORCEMENT_ENV, M6_BENCHMARK_MANIFEST_VERSION,
    RELEASE_QUALIFICATION_CEILINGS_V1, SOLO_CAMPAIGN_SCENARIOS, WorkloadMeasurement,
    assert_measurements_deterministic, hosted_enforcement_requested,
    qualification_report, render_measurements_json, render_qualification_json,
    run_all_workloads, run_bespoke_dispatch, run_content_preparation, run_coop_campaign,
    run_routine_dispatch, run_snapshot_restoration, run_solo_campaign, run_turn_execution,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn is_lower_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Runs one workload twice from fresh setup and requires both runs to agree
/// on checksum and counters while leaving timing unobserved.
fn deterministic_pair(
    workload_id: &'static str,
    run: impl Fn(BenchmarkProfile) -> Result<WorkloadMeasurement, m6_benchmark::BenchmarkError>,
) -> TestResult<WorkloadMeasurement> {
    let profile = BenchmarkProfile::current();
    let first = run(profile)?;
    let second = run(profile)?;
    assert_measurements_deterministic(&first, &second)?;
    if first.workload_id != workload_id {
        return Err(format!(
            "workload identity drifted: expected {workload_id}, got {}",
            first.workload_id
        )
        .into());
    }
    Ok(first)
}

fn require_manifest_shape(measurement: &WorkloadMeasurement) {
    assert_eq!(measurement.manifest_version, M6_BENCHMARK_MANIFEST_VERSION);
    assert!(is_lower_hex(&measurement.checksum));
    assert!(
        !measurement.counters.is_empty(),
        "{} recorded no execution counters",
        measurement.workload_id
    );
}

#[test]
fn content_preparation_reproduces_checksums_and_counts() -> TestResult {
    let measurement =
        deterministic_pair("m6.content_preparation", run_content_preparation)?;
    require_manifest_shape(&measurement);
    assert_eq!(
        measurement.counters.get("content_units"),
        Some(&u64::from(measurement.iterations))
    );
    assert!(
        measurement.counters.get("routine_programs").copied().unwrap_or(0) > 0,
        "content preparation produced no routine programs"
    );
    Ok(())
}

#[test]
fn routine_dispatch_keeps_prepared_and_direct_identical() -> TestResult {
    let measurement = deterministic_pair("m6.routine_dispatch", run_routine_dispatch)?;
    require_manifest_shape(&measurement);
    let calls = measurement.counters.get("executor_calls").copied().unwrap_or(0);
    let sweeps = u64::from(measurement.iterations);
    assert_eq!(calls, sweeps * 41, "executor call accounting did not close");
    Ok(())
}

#[test]
fn bespoke_dispatch_routes_every_cluster_deterministically() -> TestResult {
    let measurement = deterministic_pair("m6.bespoke_dispatch", run_bespoke_dispatch)?;
    require_manifest_shape(&measurement);
    assert!(
        measurement.counters.get("bespoke_clusters").copied().unwrap_or(0) > 0,
        "no bespoke clusters were routed"
    );
    assert!(
        measurement.counters.get("behavior_units").copied().unwrap_or(0)
            >= measurement.counters.get("bespoke_clusters").copied().unwrap_or(0),
        "behavior-unit counter did not close against cluster count"
    );
    Ok(())
}

#[test]
fn turn_execution_drives_real_presentations_and_rng() -> TestResult {
    let measurement = deterministic_pair("m6.turn_execution", run_turn_execution)?;
    require_manifest_shape(&measurement);
    assert!(
        measurement.counters.get("move_actions").copied().unwrap_or(0) > 0,
        "turn workload resolved no move actions"
    );
    assert!(
        measurement.counters.get("presentations").copied().unwrap_or(0) > 0,
        "turn workload observed no presentation events"
    );
    assert_eq!(
        measurement.counters.get("rng_draws"),
        measurement.counters.get("rng_draws"),
        "RNG draw counter must be reported"
    );
    Ok(())
}

#[test]
fn solo_campaign_covers_the_scenario_set() -> TestResult {
    let measurement = deterministic_pair("m6.solo_campaign", run_solo_campaign)?;
    require_manifest_shape(&measurement);
    assert_eq!(
        usize::try_from(measurement.iterations).map_err(|e| e.to_string())?,
        measurement
            .counters
            .get("battles")
            .copied()
            .unwrap_or(0) as usize,
        "battle counter did not close against iteration count"
    );
    assert!(
        measurement.iterations as usize <= SOLO_CAMPAIGN_SCENARIOS.len(),
        "campaign exceeded its declared scenario set"
    );
    Ok(())
}

#[test]
fn coop_campaign_agrees_both_endpoints_deterministically() -> TestResult {
    let measurement = deterministic_pair("m6.coop_campaign", run_coop_campaign)?;
    require_manifest_shape(&measurement);
    assert!(
        measurement.counters.get("authority_entries").copied().unwrap_or(0) > 0,
        "co-op campaign recorded no authority commit entries"
    );
    assert!(
        measurement.counters.get("peak_queued_packets").copied().unwrap_or(0) > 0,
        "co-op pump never queued transport packets"
    );
    Ok(())
}

#[test]
fn snapshot_restoration_round_trips_bytes_and_continues() -> TestResult {
    let measurement = deterministic_pair("m6.snapshot_restoration", run_snapshot_restoration)?;
    require_manifest_shape(&measurement);
    assert_eq!(
        measurement.counters.get("continuation_matches"),
        Some(&u64::from(measurement.iterations)),
        "every restore must continue identically to its source kernel"
    );
    assert!(
        measurement.counters.get("peak_snapshot_bytes").copied().unwrap_or(0) > 0,
        "snapshot restoration recorded no serialized footprint"
    );
    Ok(())
}

#[test]
fn release_ceiling_table_is_closed_over_workloads() {
    let mut ids: Vec<&'static str> = RELEASE_QUALIFICATION_CEILINGS_V1
        .iter()
        .map(|ceiling| ceiling.workload_id)
        .collect();
    let workload_ids = [
        "m6.content_preparation",
        "m6.routine_dispatch",
        "m6.bespoke_dispatch",
        "m6.turn_execution",
        "m6.solo_campaign",
        "m6.coop_campaign",
        "m6.snapshot_restoration",
    ];
    ids.extend(workload_ids.iter().copied());
    // Every id must appear exactly twice: once as a ceiling, once as a
    // declared workload. Duplicates inside either table would fail this.
    for id in workload_ids {
        assert_eq!(
            ids.iter().filter(|candidate| **candidate == id).count(),
            2,
            "ceiling table and workload set disagree for {id}"
        );
    }
}

#[test]
fn qualification_report_is_machine_readable_and_fails_uncovered() -> TestResult {
    let measurements = run_all_workloads(BenchmarkProfile::current())?;
    let report = qualification_report(BenchmarkProfile::current(), &measurements)?;
    assert_eq!(
        report.comparisons.len(),
        RELEASE_QUALIFICATION_CEILINGS_V1.len()
    );
    let rendered = render_qualification_json(&report)?;
    assert!(rendered.contains("\"passed\""));
    assert!(rendered.contains("\"ratio_micro\""));
    let rendered_measurements = render_measurements_json(&measurements)?;
    assert!(rendered_measurements.contains("\"checksum\""));

    // A report missing any covered workload must fail closed.
    let partial = qualification_report(BenchmarkProfile::current(), &measurements[..1])?;
    assert!(!partial.passed);

    // Timing is asserted only when the hosted workflow demands enforcement.
    if hosted_enforcement_requested() {
        assert!(
            report.passed,
            "release qualification exceeded ceilings: {rendered}"
        );
    } else if std::env::var(HOSTED_ENFORCEMENT_ENV).is_err() {
        // Recording mode: the verdict is computed and published but never
        // gates the debug suite.
        let _ = report.passed;
    }
    Ok(())
}
