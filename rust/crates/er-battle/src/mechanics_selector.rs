use std::collections::{BTreeMap, BTreeSet};

use er_mechanics::{
    MechanicsProgramV1, MechanicsRngReason, SelectorNode, SelectorNodeId, SelectorOrder,
    SelectorPredicate,
};
use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::RngRuntime;
use er_types::SafeU53;
use er_types::battle_ids::BattleSide;
use er_types::mechanics::MechanicScope;
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum SelectorSeed {
    SelfPokemon,
    Actor,
    CommandTarget,
    CurrentTarget,
    Attacker,
    LastAttacker,
    SourceOwner,
    StoredTarget,
    Allies,
    Opponents,
    ActiveField,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SelectorSubjectFacts {
    pub side: Option<BattleSide>,
    pub active: bool,
    pub fainted: bool,
    pub grounded: bool,
    pub adjacent_to_actor: bool,
    pub ally_of_actor: bool,
    pub opponent_of_actor: bool,
    pub type_ids: BTreeSet<u8>,
    pub major_statuses: BTreeSet<SafeU53>,
    pub volatiles: BTreeSet<SafeU53>,
    pub abilities: BTreeSet<SafeU53>,
    pub held_items: BTreeSet<SafeU53>,
    pub battler_tags: BTreeSet<SafeU53>,
    pub hp_percent: u8,
    pub party_index: Option<u8>,
    pub field_position: Option<u8>,
    pub effective_speed: i64,
    pub hp: i64,
    pub creation_order: SafeU53,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SelectorFacts {
    pub seeds: BTreeMap<SelectorSeed, Vec<MechanicScope>>,
    pub subjects: BTreeMap<MechanicScope, SelectorSubjectFacts>,
}

pub fn evaluate_selector(
    program: &MechanicsProgramV1,
    root: SelectorNodeId,
    facts: &SelectorFacts,
) -> Result<Vec<MechanicScope>, SelectorEvaluationError> {
    let mut rng = None;
    evaluate_selector_inner(program, root, facts, &mut rng)
}

pub fn evaluate_selector_with_rng(
    program: &MechanicsProgramV1,
    root: SelectorNodeId,
    facts: &SelectorFacts,
    rng: &mut RngRuntime,
) -> Result<Vec<MechanicScope>, SelectorEvaluationError> {
    let mut rng = Some(rng);
    evaluate_selector_inner(program, root, facts, &mut rng)
}

fn evaluate_selector_inner(
    program: &MechanicsProgramV1,
    root: SelectorNodeId,
    facts: &SelectorFacts,
    rng: &mut Option<&mut RngRuntime>,
) -> Result<Vec<MechanicScope>, SelectorEvaluationError> {
    program
        .validate()
        .map_err(|_| SelectorEvaluationError::InvalidProgram)?;
    let mut cache = BTreeMap::new();
    evaluate(program, root, facts, &mut cache, rng)
}

fn evaluate(
    program: &MechanicsProgramV1,
    id: SelectorNodeId,
    facts: &SelectorFacts,
    cache: &mut BTreeMap<SelectorNodeId, Vec<MechanicScope>>,
    rng: &mut Option<&mut RngRuntime>,
) -> Result<Vec<MechanicScope>, SelectorEvaluationError> {
    if let Some(value) = cache.get(&id) {
        return Ok(value.clone());
    }
    let node = program
        .selectors
        .get(id)
        .ok_or(SelectorEvaluationError::MissingNode { id })?;
    let seed = |key| facts.seeds.get(&key).cloned().unwrap_or_default();
    let mut result = match node {
        SelectorNode::SelfPokemon => seed(SelectorSeed::SelfPokemon),
        SelectorNode::Actor => seed(SelectorSeed::Actor),
        SelectorNode::CommandTarget => seed(SelectorSeed::CommandTarget),
        SelectorNode::CurrentTarget => seed(SelectorSeed::CurrentTarget),
        SelectorNode::Attacker => seed(SelectorSeed::Attacker),
        SelectorNode::LastAttacker => seed(SelectorSeed::LastAttacker),
        SelectorNode::SourceOwner => seed(SelectorSeed::SourceOwner),
        SelectorNode::StoredTarget => seed(SelectorSeed::StoredTarget),
        SelectorNode::Allies => seed(SelectorSeed::Allies),
        SelectorNode::Opponents => seed(SelectorSeed::Opponents),
        SelectorNode::ActiveField => seed(SelectorSeed::ActiveField),
        SelectorNode::ExplicitScope { scope } => vec![*scope],
        SelectorNode::Side { side } => subjects(facts, |subject| subject.side == Some(*side)),
        SelectorNode::Party { side } => subjects(facts, |subject| {
            subject.side == Some(*side) && subject.party_index.is_some()
        }),
        SelectorNode::Bench { side } => subjects(facts, |subject| {
            subject.side == Some(*side) && subject.party_index.is_some() && !subject.active
        }),
        SelectorNode::Filter { input, predicate } => {
            let mut selected = evaluate(program, *input, facts, cache, rng)?;
            selected.retain(|scope| {
                facts
                    .subjects
                    .get(scope)
                    .is_some_and(|subject| predicate_matches(subject, *predicate))
            });
            selected
        }
        SelectorNode::Union { inputs } => {
            let mut selected = Vec::new();
            for child in inputs {
                selected.extend(evaluate(program, *child, facts, cache, rng)?);
            }
            selected
        }
        SelectorNode::Intersect { inputs } => {
            let Some(first) = inputs.first() else {
                return Err(SelectorEvaluationError::EmptySetOperation);
            };
            let mut selected = evaluate(program, *first, facts, cache, rng)?;
            for child in &inputs[1..] {
                let other = evaluate(program, *child, facts, cache, rng)?;
                selected.retain(|scope| other.contains(scope));
            }
            selected
        }
        SelectorNode::StableDistinct { input } | SelectorNode::All { input } => {
            evaluate(program, *input, facts, cache, rng)?
        }
        SelectorNode::StableSort { input, order } => {
            let mut selected = evaluate(program, *input, facts, cache, rng)?;
            selected.sort_by(|left, right| {
                let left_facts = facts.subjects.get(left);
                let right_facts = facts.subjects.get(right);
                selector_sort_key(left_facts, *order)
                    .cmp(&selector_sort_key(right_facts, *order))
                    .then_with(|| left.cmp(right))
            });
            selected
        }
        SelectorNode::First { input } => evaluate(program, *input, facts, cache, rng)?
            .into_iter()
            .take(1)
            .collect(),
        SelectorNode::RandomOne {
            input,
            reason,
            draw_for_singleton,
        } => {
            let selected = evaluate(program, *input, facts, cache, rng)?;
            if selected.is_empty() {
                Vec::new()
            } else if selected.len() == 1 && !draw_for_singleton {
                selected
            } else {
                let runtime = rng
                    .as_deref_mut()
                    .ok_or(SelectorEvaluationError::RandomRequiresRng)?;
                let reason = rng_reason(*reason);
                let index = runtime
                    .battle_pick_index(selected.len(), reason, RngCallsiteId::mechanics(reason))
                    .map_err(|error| SelectorEvaluationError::Rng(error.to_string()))?;
                vec![selected[index]]
            }
        }
    };
    stable_distinct(&mut result);
    cache.insert(id, result.clone());
    Ok(result)
}

fn subjects<F>(facts: &SelectorFacts, predicate: F) -> Vec<MechanicScope>
where
    F: Fn(&SelectorSubjectFacts) -> bool,
{
    facts
        .subjects
        .iter()
        .filter_map(|(scope, subject)| predicate(subject).then_some(*scope))
        .collect()
}

fn predicate_matches(subject: &SelectorSubjectFacts, predicate: SelectorPredicate) -> bool {
    match predicate {
        SelectorPredicate::Active => subject.active,
        SelectorPredicate::Fainted => subject.fainted,
        SelectorPredicate::Grounded => subject.grounded,
        SelectorPredicate::AdjacentToActor => subject.adjacent_to_actor,
        SelectorPredicate::AllyOfActor => subject.ally_of_actor,
        SelectorPredicate::OpponentOfActor => subject.opponent_of_actor,
        SelectorPredicate::HasType { type_id } => subject.type_ids.contains(&type_id),
        SelectorPredicate::HasMajorStatus { status_id } => {
            subject.major_statuses.contains(&status_id)
        }
        SelectorPredicate::HasVolatile { volatile_id } => subject.volatiles.contains(&volatile_id),
        SelectorPredicate::HasAbility { ability_id } => subject.abilities.contains(&ability_id),
        SelectorPredicate::HasHeldItem { registry_id } => subject.held_items.contains(&registry_id),
        SelectorPredicate::HasBattlerTag { tag_id } => subject.battler_tags.contains(&tag_id),
        SelectorPredicate::HpBelowPercent { percent } => subject.hp_percent < percent,
        SelectorPredicate::HpAbovePercent { percent } => subject.hp_percent > percent,
    }
}

fn selector_sort_key(subject: Option<&SelectorSubjectFacts>, order: SelectorOrder) -> (i64, i64) {
    let Some(subject) = subject else {
        return (i64::MAX, i64::MAX);
    };
    match order {
        SelectorOrder::FieldPosition => (i64::from(subject.field_position.unwrap_or(u8::MAX)), 0),
        SelectorOrder::PartyOrder => (i64::from(subject.party_index.unwrap_or(u8::MAX)), 0),
        SelectorOrder::SpeedDescending => (-subject.effective_speed, 0),
        SelectorOrder::SpeedAscending => (subject.effective_speed, 0),
        SelectorOrder::HpAscending => (subject.hp, 0),
        SelectorOrder::HpDescending => (-subject.hp, 0),
        SelectorOrder::CreationOrder => (
            i64::try_from(subject.creation_order.get()).unwrap_or(i64::MAX),
            0,
        ),
    }
}

fn stable_distinct(values: &mut Vec<MechanicScope>) {
    let mut seen = BTreeSet::new();
    values.retain(|scope| seen.insert(*scope));
}

const fn rng_reason(reason: MechanicsRngReason) -> RngReason {
    match reason {
        MechanicsRngReason::Accuracy => RngReason::Accuracy,
        MechanicsRngReason::CriticalHit => RngReason::CriticalHit,
        MechanicsRngReason::DamageVariance => RngReason::DamageVariance,
        MechanicsRngReason::SecondaryEffect => RngReason::SecondaryEffect,
        MechanicsRngReason::SpeedTie => RngReason::SpeedTie,
        MechanicsRngReason::MultiHitCount => RngReason::MultiHitCount,
        MechanicsRngReason::AbilityChance => RngReason::AbilityChance,
        MechanicsRngReason::ItemChance => RngReason::ItemChance,
        MechanicsRngReason::StatusDuration => RngReason::StatusDuration,
        MechanicsRngReason::VolatileDuration => RngReason::VolatileDuration,
        MechanicsRngReason::RandomTarget => RngReason::RandomTarget,
        MechanicsRngReason::RandomMove => RngReason::RandomMove,
        MechanicsRngReason::RandomItem => RngReason::RandomItem,
        MechanicsRngReason::RandomStat => RngReason::RandomStat,
        MechanicsRngReason::RandomSelector => RngReason::RandomSelector,
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SelectorEvaluationError {
    #[error("mechanics program failed validation")]
    InvalidProgram,
    #[error("selector node is missing: {id:?}")]
    MissingNode { id: SelectorNodeId },
    #[error("selector union/intersection is empty")]
    EmptySetOperation,
    #[error("random selector requires exact RNG")]
    RandomRequiresRng,
    #[error("exact RNG draw failed: {0}")]
    Rng(String),
}
