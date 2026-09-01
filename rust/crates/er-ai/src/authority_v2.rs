//! Authority-only deterministic AI orchestration with typed RNG evidence.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_types::AiPolicyId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::content_v2::{AiSelectionPolicyV2, PreparedAiPolicyContentV2};
use crate::full_surface::{
    AiActionV1, AiActorViewV1, AiScoreContextV1, highest_joint_score_policy_v1,
    highest_score_policy_v1, joint_actions_v1, legal_actions_v1,
};

pub const AUTHORITY_AI_SNAPSHOT_SCHEMA_VERSION_V2: u32 = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiRngReasonV2 {
    RandomLegalAction,
    ScoreTie,
    JointScoreTie,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiRngEvidenceV2 {
    pub sequence: u64,
    pub reason: AiRngReasonV2,
    pub upper_exclusive: u64,
    pub result: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityAiSnapshotV2 {
    pub schema_version: u32,
    pub decision_sequence: u64,
    pub rng_audit: Vec<AiRngEvidenceV2>,
}

#[derive(Clone, Debug)]
pub struct AuthorityAiV2 {
    content: Arc<PreparedAiPolicyContentV2>,
    snapshot: AuthorityAiSnapshotV2,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AiDecisionV2 {
    pub decision_sequence: u64,
    pub policy: AiPolicyId,
    pub actions: Vec<AiActionV1>,
    pub rng_evidence: Vec<AiRngEvidenceV2>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AuthorityAiErrorV2 {
    #[error("AI decisions are authority-only")]
    NotAuthority,
    #[error("AI policy, actors, legal actions, or score contexts are invalid")]
    Invalid,
    #[error("AI decision sequence overflowed")]
    Exhausted,
}

impl AuthorityAiV2 {
    pub fn new(content: PreparedAiPolicyContentV2) -> Self {
        Self {
            content: Arc::new(content),
            snapshot: AuthorityAiSnapshotV2 {
                schema_version: AUTHORITY_AI_SNAPSHOT_SCHEMA_VERSION_V2,
                decision_sequence: 0,
                rng_audit: Vec::new(),
            },
        }
    }

    pub fn from_snapshot(
        content: PreparedAiPolicyContentV2,
        snapshot: AuthorityAiSnapshotV2,
    ) -> Result<Self, AuthorityAiErrorV2> {
        validate_snapshot(&snapshot)?;
        Ok(Self {
            content: Arc::new(content),
            snapshot,
        })
    }

    pub fn snapshot(&self) -> AuthorityAiSnapshotV2 {
        self.snapshot.clone()
    }

    pub fn choose_single(
        &mut self,
        authority: bool,
        policy: AiPolicyId,
        actor: &AiActorViewV1,
        contexts: &BTreeMap<AiActionV1, AiScoreContextV1>,
        rng_draw: Option<u64>,
    ) -> Result<AiDecisionV2, AuthorityAiErrorV2> {
        if !authority {
            return Err(AuthorityAiErrorV2::NotAuthority);
        }
        let definition = self
            .content
            .policy(policy)
            .ok_or(AuthorityAiErrorV2::Invalid)?;
        let legal = legal_actions_v1(actor);
        if legal.is_empty() || legal.iter().any(|action| !contexts.contains_key(action)) {
            return Err(AuthorityAiErrorV2::Invalid);
        }
        let audit_start = self.snapshot.rng_audit.len();
        let action = match definition.selection {
            AiSelectionPolicyV2::FirstLegal => legal.first().cloned(),
            AiSelectionPolicyV2::RandomLegal => {
                let draw = rng_draw.ok_or(AuthorityAiErrorV2::Invalid)?;
                let upper = u64::try_from(legal.len()).map_err(|_| AuthorityAiErrorV2::Invalid)?;
                let index = draw % upper;
                self.record_rng(AiRngReasonV2::RandomLegalAction, upper, index)?;
                legal
                    .get(usize::try_from(index).map_err(|_| AuthorityAiErrorV2::Invalid)?)
                    .cloned()
            }
            AiSelectionPolicyV2::HighestScore | AiSelectionPolicyV2::HighestJointScore => {
                highest_score_policy_v1(&legal, contexts)
            }
        }
        .ok_or(AuthorityAiErrorV2::Invalid)?;
        self.finish(policy, vec![action], audit_start)
    }

    pub fn choose_joint(
        &mut self,
        authority: bool,
        policy: AiPolicyId,
        actors: &[AiActorViewV1],
        contexts: &BTreeMap<AiActionV1, AiScoreContextV1>,
    ) -> Result<AiDecisionV2, AuthorityAiErrorV2> {
        if !authority {
            return Err(AuthorityAiErrorV2::NotAuthority);
        }
        let definition = self
            .content
            .policy(policy)
            .ok_or(AuthorityAiErrorV2::Invalid)?;
        if definition.selection != AiSelectionPolicyV2::HighestJointScore
            || actors.is_empty()
            || actors.len() > usize::from(definition.maximum_joint_width)
        {
            return Err(AuthorityAiErrorV2::Invalid);
        }
        let per_actor = actors.iter().map(legal_actions_v1).collect::<Vec<_>>();
        if per_actor.iter().any(Vec::is_empty)
            || per_actor
                .iter()
                .flatten()
                .any(|action| !contexts.contains_key(action))
        {
            return Err(AuthorityAiErrorV2::Invalid);
        }
        let combinations = joint_actions_v1(&per_actor, actors.len());
        let actions = highest_joint_score_policy_v1(&combinations, contexts)
            .ok_or(AuthorityAiErrorV2::Invalid)?;
        self.finish(policy, actions, self.snapshot.rng_audit.len())
    }

    fn finish(
        &mut self,
        policy: AiPolicyId,
        actions: Vec<AiActionV1>,
        audit_start: usize,
    ) -> Result<AiDecisionV2, AuthorityAiErrorV2> {
        let decision_sequence = self.snapshot.decision_sequence;
        self.snapshot.decision_sequence = self
            .snapshot
            .decision_sequence
            .checked_add(1)
            .ok_or(AuthorityAiErrorV2::Exhausted)?;
        Ok(AiDecisionV2 {
            decision_sequence,
            policy,
            actions,
            rng_evidence: self.snapshot.rng_audit[audit_start..].to_vec(),
        })
    }

    fn record_rng(
        &mut self,
        reason: AiRngReasonV2,
        upper_exclusive: u64,
        result: u64,
    ) -> Result<(), AuthorityAiErrorV2> {
        if upper_exclusive == 0 || result >= upper_exclusive {
            return Err(AuthorityAiErrorV2::Invalid);
        }
        let sequence = u64::try_from(self.snapshot.rng_audit.len())
            .map_err(|_| AuthorityAiErrorV2::Exhausted)?;
        self.snapshot.rng_audit.push(AiRngEvidenceV2 {
            sequence,
            reason,
            upper_exclusive,
            result,
        });
        Ok(())
    }
}

fn validate_snapshot(snapshot: &AuthorityAiSnapshotV2) -> Result<(), AuthorityAiErrorV2> {
    if snapshot.schema_version != AUTHORITY_AI_SNAPSHOT_SCHEMA_VERSION_V2
        || snapshot.rng_audit.iter().enumerate().any(|(index, draw)| {
            draw.sequence != index as u64
                || draw.upper_exclusive == 0
                || draw.result >= draw.upper_exclusive
        })
    {
        return Err(AuthorityAiErrorV2::Invalid);
    }
    Ok(())
}
