use er_kernel::snapshot_v6::ExternalTraceInputV6;
use er_kernel_worker::{KernelGenerationIdentityV1, MAXIMUM_TAIL_EVENTS_V1};

use super::endpoint::KernelGenerationEndpointV1;
use super::migration::{SnapshotMigrationEvidenceV1, SnapshotMigrationRegistryV1};
use super::types::{
    GenerationConsumerV1, GenerationReloadTraceV1, GenerationSessionImageV1,
    GenerationStepEvidenceV1, KernelReloadErrorV1, ReloadDecisionV1, ReloadDigestClassV1,
    ReloadPlanV1, ReloadPolicyV1, ReloadTailEventV1,
};

#[derive(Clone, Debug)]
pub struct ReloadTicketV1 {
    active_identity: KernelGenerationIdentityV1,
    snapshot_bytes: Vec<u8>,
    snapshot_schema: u32,
    tail_index: usize,
}

pub struct PreparedGenerationReloadV1 {
    candidate: Box<dyn KernelGenerationEndpointV1>,
    decision: ReloadDecisionV1,
}

impl std::fmt::Debug for PreparedGenerationReloadV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PreparedGenerationReloadV1")
            .field("candidate", self.candidate.identity())
            .field("decision", &self.decision)
            .finish()
    }
}

pub struct TransactionalKernelSupervisorV1 {
    active: Box<dyn KernelGenerationEndpointV1>,
    rollback: Option<Box<dyn KernelGenerationEndpointV1>>,
    content_bundle_bytes: Vec<u8>,
    tail: Vec<ReloadTailEventV1>,
    transitions: Vec<ReloadDecisionV1>,
    acceptance_remaining: usize,
}

impl std::fmt::Debug for TransactionalKernelSupervisorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TransactionalKernelSupervisorV1")
            .field("active", self.active.identity())
            .field(
                "rollback",
                &self.rollback.as_ref().map(|endpoint| endpoint.identity()),
            )
            .field("tail_events", &self.tail.len())
            .field("transitions", &self.transitions.len())
            .field("acceptance_remaining", &self.acceptance_remaining)
            .finish()
    }
}

impl TransactionalKernelSupervisorV1 {
    pub fn new(
        active: Box<dyn KernelGenerationEndpointV1>,
        content_bundle_bytes: Vec<u8>,
    ) -> Result<Self, KernelReloadErrorV1> {
        active
            .identity()
            .validate()
            .map_err(|_| KernelReloadErrorV1::Identity("invalid active identity"))?;
        if content_bundle_bytes.is_empty() {
            return Err(KernelReloadErrorV1::Plan("empty content bundle"));
        }
        Ok(Self {
            active,
            rollback: None,
            content_bundle_bytes,
            tail: Vec::new(),
            transitions: Vec::new(),
            acceptance_remaining: 0,
        })
    }

    pub fn active_identity(&self) -> &KernelGenerationIdentityV1 {
        self.active.identity()
    }

    pub fn begin_reload(&mut self) -> Result<ReloadTicketV1, KernelReloadErrorV1> {
        let snapshot_bytes = self.active.snapshot()?;
        let snapshot_schema = snapshot_schema(&snapshot_bytes)?;
        Ok(ReloadTicketV1 {
            active_identity: self.active.identity().clone(),
            snapshot_bytes,
            snapshot_schema,
            tail_index: self.tail.len(),
        })
    }

    pub fn dispatch(
        &mut self,
        input: ExternalTraceInputV6,
    ) -> Result<GenerationStepEvidenceV1, KernelReloadErrorV1> {
        let evidence = self.active.apply(&input)?;
        if self.tail.len() >= MAXIMUM_TAIL_EVENTS_V1 {
            self.tail.remove(0);
        }
        self.tail.push(ReloadTailEventV1 {
            input,
            active: evidence.clone(),
        });
        if self.acceptance_remaining > 0 {
            self.acceptance_remaining -= 1;
            if self.acceptance_remaining == 0 {
                self.retire_rollback()?;
            }
        }
        Ok(evidence)
    }

    pub fn prepare_reload(
        &mut self,
        mut candidate: Box<dyn KernelGenerationEndpointV1>,
        ticket: &ReloadTicketV1,
        plan: &ReloadPlanV1,
        registry: &SnapshotMigrationRegistryV1,
    ) -> Result<PreparedGenerationReloadV1, KernelReloadErrorV1> {
        plan.validate()?;
        validate_candidate(self.active.identity(), candidate.identity(), ticket)?;
        if matches!(plan.policy, ReloadPolicyV1::IncompatibleReject) {
            let _ = candidate.dispose();
            return Err(KernelReloadErrorV1::Comparison(
                "policy forbids activation".to_owned(),
            ));
        }
        let target_schema = if ticket.snapshot_schema < candidate.identity().minimum_snapshot_schema
        {
            candidate.identity().minimum_snapshot_schema
        } else {
            ticket.snapshot_schema
        };
        if target_schema > candidate.identity().maximum_snapshot_schema {
            let _ = candidate.dispose();
            return Err(KernelReloadErrorV1::Identity("snapshot schema range"));
        }
        let (snapshot, migration) = registry.migrate(
            &ticket.snapshot_bytes,
            ticket.snapshot_schema,
            target_schema,
        )?;
        candidate.restore(&snapshot, &self.content_bundle_bytes)?;
        let replay = self
            .tail
            .get(ticket.tail_index..)
            .ok_or_else(|| {
                KernelReloadErrorV1::UnsafeBoundary(
                    "tail rotated before candidate acceptance".to_owned(),
                )
            })?
            .to_vec();
        let mut divergent = Vec::new();
        for event in &replay {
            let actual = candidate.apply(&event.input)?;
            append_divergence(&event.active, &actual, &mut divergent);
            if !actual.invariant_failures.is_empty() {
                let _ = candidate.dispose();
                return Err(KernelReloadErrorV1::Comparison(
                    "candidate invariant failure".to_owned(),
                ));
            }
        }
        divergent.sort_by_key(|class| *class as u8);
        divergent.dedup();
        policy_accepts(plan, &divergent)?;
        if matches!(plan.policy, ReloadPolicyV1::ExactPreservation) {
            let active_snapshot = self.active_snapshot_for_compare()?;
            let candidate_snapshot = candidate.snapshot()?;
            if active_snapshot != candidate_snapshot {
                let _ = candidate.dispose();
                return Err(KernelReloadErrorV1::Comparison(
                    "final canonical snapshot differs".to_owned(),
                ));
            }
        }
        let decision = ReloadDecisionV1 {
            accepted: true,
            policy: plan.policy,
            previous: self.active.identity().clone(),
            candidate: candidate.identity().clone(),
            migration_ids: migration
                .iter()
                .map(|edge| edge.migration_id.clone())
                .collect(),
            compared_events: replay.len(),
            divergent_classes: divergent,
            reason: "candidate restored, replayed, validated, and accepted".to_owned(),
        };
        Ok(PreparedGenerationReloadV1 {
            candidate,
            decision,
        })
    }

    pub fn commit_reload(
        &mut self,
        prepared: PreparedGenerationReloadV1,
        acceptance_events: usize,
    ) -> Result<ReloadDecisionV1, KernelReloadErrorV1> {
        self.retire_rollback()?;
        let predecessor = std::mem::replace(&mut self.active, prepared.candidate);
        self.rollback = Some(predecessor);
        self.acceptance_remaining = acceptance_events;
        let decision = prepared.decision;
        self.transitions.push(decision.clone());
        if acceptance_events == 0 {
            self.retire_rollback()?;
        }
        Ok(decision)
    }

    pub fn reload_now(
        &mut self,
        candidate: Box<dyn KernelGenerationEndpointV1>,
        plan: &ReloadPlanV1,
        registry: &SnapshotMigrationRegistryV1,
    ) -> Result<ReloadDecisionV1, KernelReloadErrorV1> {
        let ticket = self.begin_reload()?;
        let prepared = self.prepare_reload(candidate, &ticket, plan, registry)?;
        self.commit_reload(prepared, plan.acceptance_events)
    }

    pub fn rollback(&mut self, reason: &str) -> Result<(), KernelReloadErrorV1> {
        let Some(predecessor) = self.rollback.take() else {
            return Err(KernelReloadErrorV1::Candidate(
                "rollback window is closed".to_owned(),
            ));
        };
        let mut failed = std::mem::replace(&mut self.active, predecessor);
        failed.dispose()?;
        self.acceptance_remaining = 0;
        if let Some(last) = self.transitions.last_mut() {
            last.accepted = false;
            last.reason = format!("rolled back: {reason}");
        }
        Ok(())
    }

    pub fn resource_count(&mut self) -> Result<usize, KernelReloadErrorV1> {
        let active = self.active.health()?.owned_resources;
        let rollback = self
            .rollback
            .as_mut()
            .map(|endpoint| endpoint.health())
            .transpose()?
            .map_or(0, |health| health.owned_resources);
        Ok(active + rollback)
    }

    pub fn trace(&self) -> GenerationReloadTraceV1 {
        GenerationReloadTraceV1 {
            schema_version: 1,
            transitions: self.transitions.clone(),
            events: self.tail.clone(),
        }
    }

    pub fn export_session_image(
        &mut self,
        consumer: GenerationConsumerV1,
    ) -> Result<GenerationSessionImageV1, KernelReloadErrorV1> {
        Ok(GenerationSessionImageV1 {
            schema_version: 1,
            consumer,
            generation: self.active.identity().clone(),
            snapshot_bytes: self.active.snapshot()?,
            reload_trace: self.trace(),
        })
    }

    pub fn dispose(&mut self) -> Result<(), KernelReloadErrorV1> {
        self.retire_rollback()?;
        self.active.dispose()
    }

    fn active_snapshot_for_compare(&mut self) -> Result<Vec<u8>, KernelReloadErrorV1> {
        self.active.snapshot()
    }

    fn retire_rollback(&mut self) -> Result<(), KernelReloadErrorV1> {
        if let Some(mut endpoint) = self.rollback.take() {
            endpoint.dispose()?;
        }
        Ok(())
    }
}

pub fn migration_ids(evidence: &[SnapshotMigrationEvidenceV1]) -> Vec<String> {
    evidence
        .iter()
        .map(|edge| edge.migration_id.clone())
        .collect()
}

fn validate_candidate(
    active: &KernelGenerationIdentityV1,
    candidate: &KernelGenerationIdentityV1,
    ticket: &ReloadTicketV1,
) -> Result<(), KernelReloadErrorV1> {
    candidate
        .validate()
        .map_err(|_| KernelReloadErrorV1::Identity("invalid candidate identity"))?;
    if ticket.active_identity != *active
        || candidate.session_id != active.session_id
        || candidate.generation.0 <= active.generation.0
        || candidate.worker_abi_version != active.worker_abi_version
        || candidate.content_identity != active.content_identity
    {
        return Err(KernelReloadErrorV1::Identity(
            "generation/session/ABI/content fence",
        ));
    }
    Ok(())
}

fn append_divergence(
    expected: &GenerationStepEvidenceV1,
    actual: &GenerationStepEvidenceV1,
    output: &mut Vec<ReloadDigestClassV1>,
) {
    for (class, differs) in [
        (
            ReloadDigestClassV1::Mechanical,
            expected.mechanical_digest != actual.mechanical_digest,
        ),
        (
            ReloadDigestClassV1::Kernel,
            expected.kernel_digest != actual.kernel_digest,
        ),
        (
            ReloadDigestClassV1::Presentation,
            expected.presentation_digest != actual.presentation_digest,
        ),
        (
            ReloadDigestClassV1::Effects,
            expected.effect_digest != actual.effect_digest,
        ),
        (
            ReloadDigestClassV1::Observation,
            expected.observation_digest != actual.observation_digest,
        ),
    ] {
        if differs {
            output.push(class);
        }
    }
}

fn policy_accepts(
    plan: &ReloadPlanV1,
    divergent: &[ReloadDigestClassV1],
) -> Result<(), KernelReloadErrorV1> {
    match plan.policy {
        ReloadPolicyV1::ExactPreservation if !divergent.is_empty() => Err(
            KernelReloadErrorV1::Comparison("exact replay diverged".to_owned()),
        ),
        ReloadPolicyV1::DeclaredSemanticChange | ReloadPolicyV1::MigratedCompatible
            if divergent
                .iter()
                .any(|class| !plan.allowed_digest_classes.contains(class)) =>
        {
            Err(KernelReloadErrorV1::Comparison(
                "undeclared digest divergence".to_owned(),
            ))
        }
        ReloadPolicyV1::IncompatibleReject => Err(KernelReloadErrorV1::Comparison(
            "incompatible policy".to_owned(),
        )),
        _ => Ok(()),
    }
}

fn snapshot_schema(bytes: &[u8]) -> Result<u32, KernelReloadErrorV1> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| KernelReloadErrorV1::UnsafeBoundary(error.to_string()))?;
    value
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| KernelReloadErrorV1::UnsafeBoundary("snapshot schema missing".to_owned()))
}
