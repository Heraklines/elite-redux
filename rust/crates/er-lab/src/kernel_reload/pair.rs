use super::endpoint::KernelGenerationEndpointV1;
use super::migration::SnapshotMigrationRegistryV1;
use super::supervisor::TransactionalKernelSupervisorV1;
use super::types::{KernelReloadErrorV1, ReloadDecisionV1, ReloadPlanV1};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PairReloadDecisionV1 {
    pub host: ReloadDecisionV1,
    pub guest: ReloadDecisionV1,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AtomicPairReloadV1;

impl AtomicPairReloadV1 {
    pub fn reload(
        host: &mut TransactionalKernelSupervisorV1,
        guest: &mut TransactionalKernelSupervisorV1,
        host_candidate: Box<dyn KernelGenerationEndpointV1>,
        guest_candidate: Box<dyn KernelGenerationEndpointV1>,
        plan: &ReloadPlanV1,
        registry: &SnapshotMigrationRegistryV1,
    ) -> Result<PairReloadDecisionV1, KernelReloadErrorV1> {
        if host_candidate.identity().generation != guest_candidate.identity().generation
            || host_candidate.identity().artifact_sha256
                != guest_candidate.identity().artifact_sha256
            || host_candidate.identity().source_git_sha != guest_candidate.identity().source_git_sha
        {
            return Err(KernelReloadErrorV1::Pair(
                "candidate endpoints do not share one immutable generation".to_owned(),
            ));
        }
        let host_ticket = host.begin_reload()?;
        let guest_ticket = guest.begin_reload()?;
        let host_prepared = host.prepare_reload(host_candidate, &host_ticket, plan, registry)?;
        let guest_prepared =
            match guest.prepare_reload(guest_candidate, &guest_ticket, plan, registry) {
                Ok(prepared) => prepared,
                Err(error) => return Err(KernelReloadErrorV1::Pair(error.to_string())),
            };
        let host_decision = host.commit_reload(host_prepared, plan.acceptance_events)?;
        let guest_decision = match guest.commit_reload(guest_prepared, plan.acceptance_events) {
            Ok(decision) => decision,
            Err(error) => {
                let _ = host.rollback("guest route switch failed");
                return Err(KernelReloadErrorV1::Pair(error.to_string()));
            }
        };
        Ok(PairReloadDecisionV1 {
            host: host_decision,
            guest: guest_decision,
        })
    }
}
