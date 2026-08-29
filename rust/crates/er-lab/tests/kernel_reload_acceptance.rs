use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use er_kernel::snapshot_v6::ExternalTraceInputV6;
use er_kernel_worker::{
    KernelGenerationIdentityV1, KernelGenerationV1, KernelSessionIdV1, KernelWorkerHealthV1,
};
use er_lab::kernel_reload::{
    AtomicPairReloadV1, GenerationConsumerV1, GenerationStepEvidenceV1, KernelGenerationEndpointV1,
    KernelReloadErrorV1, KernelSnapshotMigrationEdgeV1, ReloadDigestClassV1, ReloadPlanV1,
    ReloadPolicyV1, SnapshotMigrationRegistryV1, TransactionalKernelSupervisorV1,
};
use er_types::SafeU53;
use serde_json::json;

#[derive(Debug)]
struct MockGeneration {
    identity: KernelGenerationIdentityV1,
    state: u64,
    schema: u32,
    delta: u64,
    fail_restore: bool,
    sequence: u64,
    disposed: bool,
    live: Arc<AtomicUsize>,
    held_key: bool,
    presentation_fenced: bool,
}

impl MockGeneration {
    fn new(generation: u64, delta: u64, schema: u32, live: Arc<AtomicUsize>) -> Self {
        live.fetch_add(1, Ordering::SeqCst);
        Self {
            identity: identity(generation, schema),
            state: 0,
            schema,
            delta,
            fail_restore: false,
            sequence: 0,
            disposed: false,
            live,
            held_key: true,
            presentation_fenced: true,
        }
    }

    fn failing(generation: u64, live: Arc<AtomicUsize>) -> Self {
        let mut value = Self::new(generation, 1, 1, live);
        value.fail_restore = true;
        value
    }
}

impl Drop for MockGeneration {
    fn drop(&mut self) {
        if !self.disposed {
            self.live.fetch_sub(1, Ordering::SeqCst);
            self.disposed = true;
        }
    }
}

impl KernelGenerationEndpointV1 for MockGeneration {
    fn identity(&self) -> &KernelGenerationIdentityV1 {
        &self.identity
    }

    fn restore(
        &mut self,
        snapshot_bytes: &[u8],
        _content: &[u8],
    ) -> Result<String, KernelReloadErrorV1> {
        if self.fail_restore {
            return Err(KernelReloadErrorV1::Candidate(
                "candidate panic/exit".to_owned(),
            ));
        }
        let value: serde_json::Value = serde_json::from_slice(snapshot_bytes)
            .map_err(|error| KernelReloadErrorV1::Candidate(error.to_string()))?;
        let schema = value
            .get("schema_version")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0) as u32;
        if schema < self.identity.minimum_snapshot_schema
            || schema > self.identity.maximum_snapshot_schema
        {
            return Err(KernelReloadErrorV1::Candidate("schema rejected".to_owned()));
        }
        self.schema = schema;
        self.state = value
            .get("state")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        self.held_key = value
            .get("held_key")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        self.presentation_fenced = value
            .get("presentation_fenced")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        Ok(format!("state:{}", self.state))
    }

    fn apply(
        &mut self,
        input: &ExternalTraceInputV6,
    ) -> Result<GenerationStepEvidenceV1, KernelReloadErrorV1> {
        match input {
            ExternalTraceInputV6::AdvanceTime { milliseconds } => {
                self.state = self
                    .state
                    .saturating_add(milliseconds.get().saturating_mul(self.delta));
            }
            ExternalTraceInputV6::RawInput(_) => {
                self.held_key = !self.held_key;
            }
            _ => {}
        }
        self.sequence = self.sequence.saturating_add(1);
        let digest = format!("state:{}", self.state);
        Ok(GenerationStepEvidenceV1 {
            sequence: self.sequence,
            mechanical_digest: digest.clone(),
            kernel_digest: format!(
                "kernel:{digest}:{}:{}",
                self.held_key, self.presentation_fenced
            ),
            presentation_digest: format!("presentation:{}", self.presentation_fenced),
            effect_digest: format!("effect:{}", self.state),
            observation_digest: digest,
            invariant_failures: Vec::new(),
        })
    }

    fn snapshot(&mut self) -> Result<Vec<u8>, KernelReloadErrorV1> {
        serde_json::to_vec(&json!({
            "schema_version": self.schema,
            "state": self.state,
            "held_key": self.held_key,
            "presentation_fenced": self.presentation_fenced
        }))
        .map_err(|error| KernelReloadErrorV1::Candidate(error.to_string()))
    }

    fn health(&mut self) -> Result<KernelWorkerHealthV1, KernelReloadErrorV1> {
        Ok(KernelWorkerHealthV1 {
            initialized: true,
            disposed: self.disposed,
            accepted_sequence: self.sequence,
            applied_events: self.sequence as usize,
            owned_resources: usize::from(!self.disposed),
        })
    }

    fn dispose(&mut self) -> Result<(), KernelReloadErrorV1> {
        if !self.disposed {
            self.live.fetch_sub(1, Ordering::SeqCst);
            self.disposed = true;
        }
        Ok(())
    }
}

fn identity(generation: u64, schema: u32) -> KernelGenerationIdentityV1 {
    KernelGenerationIdentityV1 {
        schema_version: 1,
        session_id: KernelSessionIdV1("session-a".to_owned()),
        generation: KernelGenerationV1(generation),
        artifact_sha256: format!("{generation:064x}"),
        executable_sha256: format!("{:064x}", generation + 10_000),
        source_git_sha: format!("{generation:040x}"),
        worker_abi_version: 1,
        minimum_snapshot_schema: schema,
        maximum_snapshot_schema: schema,
        content_identity: "content-a".to_owned(),
        build_target: "test-target".to_owned(),
        build_profile: "release".to_owned(),
    }
}

fn exact_plan() -> ReloadPlanV1 {
    ReloadPlanV1 {
        schema_version: 1,
        policy: ReloadPolicyV1::ExactPreservation,
        allowed_behavior_units: Vec::new(),
        allowed_digest_classes: Vec::new(),
        acceptance_events: 0,
    }
}

fn input(amount: u64) -> Result<ExternalTraceInputV6, Box<dyn std::error::Error>> {
    Ok(ExternalTraceInputV6::AdvanceTime {
        milliseconds: SafeU53::new(amount)?,
    })
}

fn additive_schema(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
    value["schema_version"] = json!(2);
    value["optional_extension"] = json!("default");
    serde_json::to_vec(&value).map_err(|error| error.to_string())
}

#[test]
fn exact_reload_preserves_state_held_input_and_presentation_fence()
-> Result<(), Box<dyn std::error::Error>> {
    let live = Arc::new(AtomicUsize::new(0));
    let active = Box::new(MockGeneration::new(1, 1, 1, live.clone()));
    let mut supervisor = TransactionalKernelSupervisorV1::new(active, vec![1])?;
    let ticket = supervisor.begin_reload()?;
    supervisor.dispatch(input(3)?)?;
    let candidate = Box::new(MockGeneration::new(2, 1, 1, live.clone()));
    let prepared = supervisor.prepare_reload(
        candidate,
        &ticket,
        &exact_plan(),
        &SnapshotMigrationRegistryV1::default(),
    )?;
    let decision = supervisor.commit_reload(prepared, 0)?;
    assert!(decision.accepted);
    assert_eq!(decision.compared_events, 1);
    assert_eq!(
        supervisor.active_identity().generation,
        KernelGenerationV1(2)
    );
    assert_eq!(supervisor.resource_count()?, 1);
    supervisor.dispose()?;
    assert_eq!(live.load(Ordering::SeqCst), 0);
    Ok(())
}

#[test]
fn declared_change_activates_only_declared_digest_classes() -> Result<(), Box<dyn std::error::Error>>
{
    let live = Arc::new(AtomicUsize::new(0));
    let mut supervisor = TransactionalKernelSupervisorV1::new(
        Box::new(MockGeneration::new(1, 1, 1, live.clone())),
        vec![1],
    )?;
    let ticket = supervisor.begin_reload()?;
    supervisor.dispatch(input(2)?)?;
    let plan = ReloadPlanV1 {
        schema_version: 1,
        policy: ReloadPolicyV1::DeclaredSemanticChange,
        allowed_behavior_units: vec!["damage-formula".to_owned()],
        allowed_digest_classes: vec![
            ReloadDigestClassV1::Mechanical,
            ReloadDigestClassV1::Kernel,
            ReloadDigestClassV1::Effects,
            ReloadDigestClassV1::Observation,
        ],
        acceptance_events: 1,
    };
    let prepared = supervisor.prepare_reload(
        Box::new(MockGeneration::new(2, 2, 1, live.clone())),
        &ticket,
        &plan,
        &SnapshotMigrationRegistryV1::default(),
    )?;
    let decision = supervisor.commit_reload(prepared, 1)?;
    assert_eq!(decision.divergent_classes.len(), 4);
    supervisor.dispatch(input(1)?)?;
    assert_eq!(supervisor.resource_count()?, 1);
    supervisor.dispose()?;
    assert_eq!(live.load(Ordering::SeqCst), 0);
    Ok(())
}

#[test]
fn migration_is_deterministic_and_breaking_schema_without_edge_is_rejected()
-> Result<(), Box<dyn std::error::Error>> {
    let live = Arc::new(AtomicUsize::new(0));
    let mut supervisor = TransactionalKernelSupervisorV1::new(
        Box::new(MockGeneration::new(1, 1, 1, live.clone())),
        vec![1],
    )?;
    let ticket = supervisor.begin_reload()?;
    let candidate = Box::new(MockGeneration::new(2, 1, 2, live.clone()));
    assert!(
        supervisor
            .prepare_reload(
                candidate,
                &ticket,
                &exact_plan(),
                &SnapshotMigrationRegistryV1::default()
            )
            .is_err()
    );
    let mut registry = SnapshotMigrationRegistryV1::default();
    registry.register(KernelSnapshotMigrationEdgeV1 {
        migration_id: "schema-1-to-2".to_owned(),
        from_schema: 1,
        to_schema: 2,
        maximum_output_bytes: 1024,
        migrate: additive_schema,
    })?;
    let plan = ReloadPlanV1 {
        schema_version: 1,
        policy: ReloadPolicyV1::MigratedCompatible,
        allowed_behavior_units: Vec::new(),
        allowed_digest_classes: Vec::new(),
        acceptance_events: 0,
    };
    let prepared = supervisor.prepare_reload(
        Box::new(MockGeneration::new(3, 1, 2, live.clone())),
        &ticket,
        &plan,
        &registry,
    )?;
    let decision = supervisor.commit_reload(prepared, 0)?;
    assert_eq!(decision.migration_ids, vec!["schema-1-to-2"]);
    supervisor.dispose()?;
    assert_eq!(live.load(Ordering::SeqCst), 0);
    Ok(())
}

#[test]
fn candidate_failure_and_explicit_rollback_preserve_active_session()
-> Result<(), Box<dyn std::error::Error>> {
    let live = Arc::new(AtomicUsize::new(0));
    let mut supervisor = TransactionalKernelSupervisorV1::new(
        Box::new(MockGeneration::new(1, 1, 1, live.clone())),
        vec![1],
    )?;
    let ticket = supervisor.begin_reload()?;
    assert!(
        supervisor
            .prepare_reload(
                Box::new(MockGeneration::failing(2, live.clone())),
                &ticket,
                &exact_plan(),
                &SnapshotMigrationRegistryV1::default(),
            )
            .is_err()
    );
    assert_eq!(
        supervisor.active_identity().generation,
        KernelGenerationV1(1)
    );
    let mut plan = exact_plan();
    plan.acceptance_events = 2;
    let prepared = supervisor.prepare_reload(
        Box::new(MockGeneration::new(3, 1, 1, live.clone())),
        &ticket,
        &plan,
        &SnapshotMigrationRegistryV1::default(),
    )?;
    supervisor.commit_reload(prepared, 2)?;
    supervisor.rollback("acceptance fault")?;
    assert_eq!(
        supervisor.active_identity().generation,
        KernelGenerationV1(1)
    );
    supervisor.dispose()?;
    assert_eq!(live.load(Ordering::SeqCst), 0);
    Ok(())
}

#[test]
fn pair_switches_one_generation_and_thousand_swaps_leave_one_live_owner()
-> Result<(), Box<dyn std::error::Error>> {
    let live = Arc::new(AtomicUsize::new(0));
    let mut host = TransactionalKernelSupervisorV1::new(
        Box::new(MockGeneration::new(1, 1, 1, live.clone())),
        vec![1],
    )?;
    let mut guest = TransactionalKernelSupervisorV1::new(
        Box::new(MockGeneration::new(1, 1, 1, live.clone())),
        vec![1],
    )?;
    let pair = AtomicPairReloadV1::reload(
        &mut host,
        &mut guest,
        Box::new(MockGeneration::new(2, 1, 1, live.clone())),
        Box::new(MockGeneration::new(2, 1, 1, live.clone())),
        &exact_plan(),
        &SnapshotMigrationRegistryV1::default(),
    )?;
    assert_eq!(
        pair.host.candidate.generation,
        pair.guest.candidate.generation
    );
    host.dispose()?;
    guest.dispose()?;
    assert_eq!(live.load(Ordering::SeqCst), 0);

    let mut supervisor = TransactionalKernelSupervisorV1::new(
        Box::new(MockGeneration::new(1, 1, 1, live.clone())),
        vec![1],
    )?;
    for generation in 2..=1_001 {
        supervisor.reload_now(
            Box::new(MockGeneration::new(generation, 1, 1, live.clone())),
            &exact_plan(),
            &SnapshotMigrationRegistryV1::default(),
        )?;
    }
    assert_eq!(
        supervisor.active_identity().generation,
        KernelGenerationV1(1_001)
    );
    assert_eq!(supervisor.trace().transitions.len(), 1_000);
    assert_eq!(live.load(Ordering::SeqCst), 1);
    supervisor.dispose()?;
    assert_eq!(live.load(Ordering::SeqCst), 0);
    Ok(())
}

#[test]
fn generation_images_feed_agents_browser_foundry_repro_bisect_and_coop()
-> Result<(), Box<dyn std::error::Error>> {
    let live = Arc::new(AtomicUsize::new(0));
    let mut supervisor = TransactionalKernelSupervisorV1::new(
        Box::new(MockGeneration::new(1, 1, 1, live.clone())),
        vec![1],
    )?;
    let ticket = supervisor.begin_reload()?;
    supervisor.dispatch(input(1)?)?;
    let plan = ReloadPlanV1 {
        schema_version: 1,
        policy: ReloadPolicyV1::DeclaredSemanticChange,
        allowed_behavior_units: vec!["new-mechanics-primitive".to_owned()],
        allowed_digest_classes: vec![
            ReloadDigestClassV1::Mechanical,
            ReloadDigestClassV1::Kernel,
            ReloadDigestClassV1::Effects,
            ReloadDigestClassV1::Observation,
        ],
        acceptance_events: 0,
    };
    let prepared = supervisor.prepare_reload(
        Box::new(MockGeneration::new(2, 3, 1, live.clone())),
        &ticket,
        &plan,
        &SnapshotMigrationRegistryV1::default(),
    )?;
    supervisor.commit_reload(prepared, 0)?;
    for consumer in [
        GenerationConsumerV1::NativeAgent,
        GenerationConsumerV1::Browser,
        GenerationConsumerV1::ScenarioFoundry,
        GenerationConsumerV1::Reproduction,
        GenerationConsumerV1::GitBisect,
        GenerationConsumerV1::CoopSimulation,
    ] {
        let image = supervisor.export_session_image(consumer)?;
        assert_eq!(image.consumer, consumer);
        assert_eq!(image.generation.generation, KernelGenerationV1(2));
        assert_eq!(image.reload_trace.transitions.len(), 1);
        assert!(!image.snapshot_bytes.is_empty());
    }
    supervisor.dispose()?;
    assert_eq!(live.load(Ordering::SeqCst), 0);
    Ok(())
}
