//! M7.2 deterministic experiments, exploration, fingerprints, bisect, counterfactuals, corpus, and mutations.

use std::collections::BTreeMap;
use std::error::Error;
use std::time::{Duration, Instant};

use er_dev_types::{EvidenceProfile, ExternalTraceInputV7};
use er_impact::SourceChangeV1;
use er_lab::*;
use er_repro::FailureOracleV1;
use er_types::{GameControlKindV2, SafeU53};

fn scenario() -> ScenarioSpecificationV1 {
    ScenarioSpecificationV1::PreRun(Box::new(PreRunScenarioV1 {
        profile: er_state::m7_state::ProfileStateV1 {
            schema_version: er_state::m7_state::PROFILE_STATE_SCHEMA_VERSION_V1,
            unlocks: Vec::new(),
            achievements: Vec::new(),
            challenges: Vec::new(),
            flags: BTreeMap::new(),
            statistics: er_state::m7_state::ProfileStatistics {
                runs_started: SafeU53::ZERO,
                runs_won: SafeU53::ZERO,
                runs_lost: SafeU53::ZERO,
                battles_won: SafeU53::ZERO,
                pokemon_captured: SafeU53::ZERO,
                highest_wave: er_types::battle_ids::WaveIndex::new(
                    SafeU53::new(1).expect("safe wave"),
                )
                .expect("positive wave"),
            },
            dex: er_state::m7_state::DexState::default(),
        },
        seed: "autonomous-seed".to_owned(),
    }))
}

#[derive(Debug)]
struct PassingExperiment;

impl ExperimentCaseExecutorV1 for PassingExperiment {
    fn execute(
        &self,
        request: ExperimentExecutionRequestV1<'_>,
    ) -> Result<ExperimentCaseResultV1, String> {
        Ok(ExperimentCaseResultV1 {
            ordinal: request.case.ordinal,
            passed: true,
            failure_oracle: None,
            coverage: CoverageObservationV1 {
                reached: request.coverage.to_vec(),
            },
            deterministic_checksum: format!("case-{}", request.case.ordinal),
            executed_events: 1,
            capsule: None,
        })
    }
}

#[test]
fn experiment_matrix_is_canonical_and_deterministic() -> Result<(), Box<dyn Error>> {
    let target = CoverageTargetV1::ControlKind(GameControlKindV2::Title);
    let plan = ExperimentPlanV1 {
        scenario: ScenarioSourceV1::Specification(Box::new(scenario())),
        dimensions: vec![
            ExperimentDimensionV1 {
                kind: ExperimentDimensionKindV1::Seed,
                values: vec![
                    ExperimentValueV1::Identity("a".to_owned()),
                    ExperimentValueV1::Identity("b".to_owned()),
                ],
            },
            ExperimentDimensionV1 {
                kind: ExperimentDimensionKindV1::Weather,
                values: vec![ExperimentValueV1::Identity("clear".to_owned())],
            },
        ],
        driver: ExperimentDriverV1 {
            events: vec![ExternalTraceInputV7::AdvanceTime(SafeU53::ZERO)],
        },
        faults: None,
        assertions: vec![ExperimentAssertionV1::NoFailure],
        coverage: vec![target.clone()],
        evidence: EvidenceProfile::Causal,
        budget: ExperimentBudgetV1 {
            maximum_cases: 4,
            maximum_events_per_case: 4,
            maximum_total_events: 8,
        },
    };
    let first = run_experiment_v1(&plan, &PassingExperiment)?;
    let second = run_experiment_v1(&plan, &PassingExperiment)?;
    assert_eq!(first, second);
    assert_eq!(first.cases, 2);
    assert_eq!(first.passed, 2);
    assert_eq!(first.coverage.reached, vec![target]);
    Ok(())
}

#[derive(Debug)]
struct ExplorerBackend;

impl CoverageExplorerBackendV1 for ExplorerBackend {
    fn execute(
        &self,
        _: &ScenarioSpecificationV1,
        trace: &[ExternalTraceInputV7],
    ) -> Result<ExplorerExecutionV1, String> {
        let reached = trace.iter().any(
            |event| matches!(event, ExternalTraceInputV7::AdvanceTime(value) if value.get() == 1),
        );
        Ok(ExplorerExecutionV1 {
            coverage: CoverageObservationV1 {
                reached: reached
                    .then(|| CoverageTargetV1::BehaviorUnit("target".to_owned()))
                    .into_iter()
                    .collect(),
            },
            failure_oracle: None,
            capsule: reached.then(|| LabArtifactIdV1("blake3-v1:target".to_owned())),
        })
    }

    fn mutations(
        &self,
        trace: &[ExternalTraceInputV7],
        _: usize,
    ) -> Vec<Vec<ExternalTraceInputV7>> {
        let mut candidate = trace.to_vec();
        candidate.push(ExternalTraceInputV7::AdvanceTime(
            SafeU53::new(1).expect("time"),
        ));
        vec![candidate]
    }

    fn minimize_success(
        &self,
        _: &ScenarioSpecificationV1,
        trace: &[ExternalTraceInputV7],
        _: &CoverageTargetV1,
    ) -> Result<Vec<ExternalTraceInputV7>, String> {
        Ok(trace
            .iter()
            .filter(|event| matches!(event, ExternalTraceInputV7::AdvanceTime(value) if value.get() == 1))
            .cloned()
            .collect())
    }
}

#[test]
fn explorer_retains_novel_trace_and_minimizes_target() -> Result<(), Box<dyn Error>> {
    let target = CoverageTargetV1::BehaviorUnit("target".to_owned());
    let report = explore_coverage_v1(
        &scenario(),
        vec![vec![ExternalTraceInputV7::AdvanceTime(SafeU53::ZERO)]],
        target.clone(),
        ExplorerBudgetV1 {
            maximum_executions: 8,
            maximum_trace_events: 8,
            maximum_retained_traces: 8,
            maximum_mutations_per_trace: 4,
        },
        &ExplorerBackend,
    )?;
    assert!(report.reached);
    assert_eq!(report.coverage.reached, vec![target]);
    assert_eq!(report.minimal_trace.as_ref().map(Vec::len), Some(1));
    Ok(())
}

fn fingerprint() -> Result<FailureFingerprintV1, Box<dyn Error>> {
    Ok(FailureFingerprintV1 {
        class: FailureClassV1::Terminal,
        first_divergent_path: None,
        causal_source: None,
        terminal_reason: Some("softlock".to_owned()),
        normalized_panic: None,
        behaviors: Vec::new(),
        content: Vec::new(),
    }
    .normalize()?)
}

#[test]
fn equivalent_failures_cluster_to_smallest_and_fastest() -> Result<(), Box<dyn Error>> {
    let mut store = FailureClusterStoreV1::new(4, 4)?;
    let insert = |store: &mut FailureClusterStoreV1,
                  capsule: &str,
                  events: usize,
                  nanos: u64,
                  seed: &str|
     -> Result<String, FailureClusterErrorV1> {
        store.insert(FailureInstanceV1 {
            fingerprint: fingerprint().map_err(|_| FailureClusterErrorV1::Invalid)?,
            capsule: LabArtifactIdV1(capsule.to_owned()),
            event_count: events,
            execution_nanos: nanos,
            seed: seed.to_owned(),
            ordinal: 0,
        })
    };
    let key = insert(&mut store, "capsule-a", 10, 100, "seed-a")?;
    assert_eq!(insert(&mut store, "capsule-b", 4, 200, "seed-b")?, key);
    insert(&mut store, "capsule-c", 8, 50, "seed-a")?;
    let cluster = store.clusters().get(&key).ok_or("cluster")?;
    assert_eq!(cluster.count, 3);
    assert_eq!(cluster.smallest.0, "capsule-b");
    assert_eq!(cluster.fastest.0, "capsule-c");
    assert_eq!(cluster.seed_counts["seed-a"], 2);
    Ok(())
}

#[derive(Debug)]
struct BisectBackend {
    outcomes: BTreeMap<GitRevisionV1, BisectOutcomeV1>,
}

impl HermeticBisectBackendV1 for BisectBackend {
    fn evaluate(
        &self,
        revision: &GitRevisionV1,
        _: &ReproCapsuleIdV1,
        _: &str,
        _: &HermeticBuildIdentityV1,
    ) -> Result<BisectOutcomeV1, String> {
        self.outcomes
            .get(revision)
            .copied()
            .ok_or_else(|| "missing".to_owned())
    }
}

#[test]
fn bisect_returns_exact_first_bad_and_never_calls_incompatible_good() -> Result<(), Box<dyn Error>>
{
    let revisions = (0_u8..5)
        .map(|value| GitRevisionV1(format!("{value:040x}")))
        .collect::<Vec<_>>();
    let outcomes = revisions
        .iter()
        .enumerate()
        .map(|(index, revision)| {
            (
                revision.clone(),
                if index < 3 {
                    BisectOutcomeV1::Good
                } else {
                    BisectOutcomeV1::Bad
                },
            )
        })
        .collect();
    let report = bisect_reproduction_v1(
        &BisectPlanV1 {
            capsule: ReproCapsuleIdV1("capsule".to_owned()),
            exact_failure_oracle: "oracle".to_owned(),
            ordered_revisions: revisions.clone(),
            build: HermeticBuildIdentityV1 {
                toolchain: "1.97.1".to_owned(),
                cargo_lock_digest: "lock".to_owned(),
                target: "x86_64-unknown-linux-gnu".to_owned(),
                profile: "release".to_owned(),
                feature_digest: "features".to_owned(),
                environment_digest: "environment".to_owned(),
            },
            maximum_builds: 8,
        },
        &BisectBackend { outcomes },
    )?;
    assert!(report.complete);
    assert_eq!(report.exact_first_bad, Some(revisions[3].clone()));
    assert_eq!(report.last_good, Some(revisions[2].clone()));
    Ok(())
}

#[derive(Debug)]
struct CounterfactualBackend;

impl CounterfactualBackendV1 for CounterfactualBackend {
    fn evaluate(
        &self,
        _: &ReproCapsuleIdV1,
        _: &CounterfactualObjectiveV1,
        candidate: &CounterfactualCandidateV1,
    ) -> Result<CounterfactualEvaluationV1, String> {
        Ok(CounterfactualEvaluationV1 {
            objective_satisfied: candidate.changes.len() == 1,
            valid: true,
            distance: candidate.changes.len() as u64,
            result_digest: "digest".to_owned(),
        })
    }
}

#[test]
fn counterfactual_returns_minimal_declared_change() -> Result<(), Box<dyn Error>> {
    let one = CounterfactualCandidateV1 {
        changes: vec![CounterfactualChangeV1::InsertExternalEvent {
            index: 0,
            event: ExternalTraceInputV7::AdvanceTime(SafeU53::new(1)?),
        }],
    };
    let two = CounterfactualCandidateV1 {
        changes: vec![
            CounterfactualChangeV1::InsertExternalEvent {
                index: 0,
                event: ExternalTraceInputV7::AdvanceTime(SafeU53::new(1)?),
            },
            CounterfactualChangeV1::InsertExternalEvent {
                index: 1,
                event: ExternalTraceInputV7::AdvanceTime(SafeU53::new(2)?),
            },
        ],
    };
    let report = search_counterfactual_v1(
        CounterfactualQueryV1 {
            baseline: ReproCapsuleIdV1("baseline".to_owned()),
            objective: CounterfactualObjectiveV1::AvoidFailure("softlock".to_owned()),
            dimensions: vec![CounterfactualDimensionV1::Time],
            candidates: vec![two, one.clone()],
            budget: CounterfactualBudgetV1 {
                maximum_candidates: 8,
                maximum_changes: 4,
            },
        },
        &CounterfactualBackend,
    )?;
    assert_eq!(report.solution, Some(one));
    Ok(())
}

#[derive(Debug)]
struct CorpusBackend;

impl RegressionReplayBackendV1 for CorpusBackend {
    fn replay_fixed(
        &self,
        _: &ReproCapsuleIdV1,
        _: &FailureOracleV1,
        expected: &str,
    ) -> Result<RegressionReplayResultV1, String> {
        Ok(RegressionReplayResultV1 {
            id: String::new(),
            passed: true,
            observed: expected.to_owned(),
        })
    }
}

#[test]
fn regression_corpus_requires_capsule_or_active_waiver() -> Result<(), Box<dyn Error>> {
    let corpus = RegressionCapsuleCorpusV1 {
        schema_version: 1,
        maximum_entries: 4,
        entries: vec![RegressionCapsuleEntryV1 {
            id: "bug-1".to_owned(),
            capsule: Some(ReproCapsuleIdV1("capsule".to_owned())),
            exact_failure_oracle: Some(FailureOracleV1::TerminalReason("softlock".to_owned())),
            issue_reference: "issue/1".to_owned(),
            fixed_commit: "a".repeat(40),
            expected_fixed_outcome: "control-open".to_owned(),
            impact_entry: "impact/bug-1".to_owned(),
            waiver: None,
        }],
    };
    let report = corpus.replay(1, &CorpusBackend)?;
    assert_eq!(report.passed, 1);
    assert_eq!(report.failed, 0);
    Ok(())
}

#[derive(Debug)]
struct MutationBackend;

impl MutationBackendV1 for MutationBackend {
    type Applied = String;

    fn apply(&self, case: &MutationCaseV1) -> Result<Self::Applied, String> {
        Ok(case.id.clone())
    }

    fn execute_linked(
        &self,
        applied: &Self::Applied,
        _: &[ProofTargetV1],
        _: &[ReproCapsuleIdV1],
    ) -> Result<MutationResultV1, String> {
        Ok(MutationResultV1 {
            id: applied.clone(),
            killed: true,
            evidence: vec!["proof-failed-as-expected".to_owned()],
        })
    }

    fn cleanup(&self, _: Self::Applied) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn linked_evidence_kills_closed_mutation_operator() -> Result<(), Box<dyn Error>> {
    let report = run_mutations_v1(
        &MutationPlanV1 {
            cases: vec![MutationCaseV1 {
                id: "mutation-1".to_owned(),
                operator: MutationOperatorV1::RemoveFence {
                    symbol: "recovery_fence".to_owned(),
                },
                proof_targets: vec![ProofTargetV1 {
                    package: "er-protocol".to_owned(),
                    test_target: "m2_recovery".to_owned(),
                    test_name: None,
                }],
                capsules: Vec::new(),
            }],
            maximum_cases: 4,
        },
        &MutationBackend,
    )?;
    assert_eq!(report.killed, 1);
    assert_eq!(report.survived, 0);
    Ok(())
}
#[test]
fn laboratory_artifacts_join_conservative_impact_selection() -> Result<(), Box<dyn Error>> {
    let graph = generate_lab_impact_graph_v1(
        &[LabImpactEntryV1 {
            source_path: "rust/crates/er-game/src/m72_bootstrap.rs".to_owned(),
            source_symbol: Some("RunBootstrapMachineV1".to_owned()),
            catalog_identity: Some("bootstrap/v1".to_owned()),
            behavior: "natural startup".to_owned(),
            semantic_group: "bootstrap".to_owned(),
            rust_symbol: "er_game::m72_bootstrap::RunBootstrapMachineV1".to_owned(),
            proof_targets: vec!["m72_foundation".to_owned()],
            presets: vec!["bootstrap/classic".to_owned()],
            capsules: vec!["regression/bootstrap".to_owned()],
            experiments: vec!["experiment/bootstrap".to_owned()],
            benchmarks: vec!["benchmark/bootstrap".to_owned()],
        }],
        vec!["rust/crates/er-kernel/".to_owned()],
        vec!["cargo test --workspace --all-targets".to_owned()],
        64,
        128,
    )?;
    let report = query_lab_impact_v1(
        &graph,
        &[SourceChangeV1 {
            path: "rust/crates/er-game/src/m72_bootstrap.rs".to_owned(),
            symbol: Some("RunBootstrapMachineV1".to_owned()),
        }],
        64,
    )?;
    assert!(!report.global_escalation);
    assert_eq!(report.report.focused_commands, vec!["m72_foundation"]);
    assert_eq!(
        report.report.affected_capsules,
        vec!["regression/bootstrap"]
    );
    Ok(())
}

#[test]
fn ten_thousand_case_matrix_expands_within_agent_ceiling() -> Result<(), Box<dyn Error>> {
    let values = |prefix: &str| {
        (0..100)
            .map(|value| ExperimentValueV1::Identity(format!("{prefix}-{value:03}")))
            .collect::<Vec<_>>()
    };
    let dimensions = vec![
        ExperimentDimensionV1 {
            kind: ExperimentDimensionKindV1::Seed,
            values: values("seed"),
        },
        ExperimentDimensionV1 {
            kind: ExperimentDimensionKindV1::Species,
            values: values("species"),
        },
    ];
    let started = Instant::now();
    let cases = expand_experiment_matrix_v1(&dimensions, 10_000)?;
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(cases.len(), 10_000);
    assert_eq!(cases.first().map(|case| case.ordinal), Some(0));
    assert_eq!(cases.last().map(|case| case.ordinal), Some(9_999));
    assert!(expand_experiment_matrix_v1(&dimensions, 9_999).is_err());
    Ok(())
}
