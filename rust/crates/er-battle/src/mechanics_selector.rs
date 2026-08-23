use std::collections::BTreeMap;

use er_mechanics::{MechanicsProgramV1, SelectorNode, SelectorNodeId};
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
pub struct SelectorFacts {
    pub seeds: BTreeMap<SelectorSeed, Vec<MechanicScope>>,
}

pub fn evaluate_selector(
    program: &MechanicsProgramV1,
    root: SelectorNodeId,
    facts: &SelectorFacts,
) -> Result<Vec<MechanicScope>, SelectorEvaluationError> {
    program
        .validate()
        .map_err(|_| SelectorEvaluationError::InvalidProgram)?;
    let mut cache = BTreeMap::new();
    evaluate(program, root, facts, &mut cache)
}

fn evaluate(
    program: &MechanicsProgramV1,
    id: SelectorNodeId,
    facts: &SelectorFacts,
    cache: &mut BTreeMap<SelectorNodeId, Vec<MechanicScope>>,
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
        SelectorNode::Union { inputs } => {
            let mut out = Vec::new();
            for child in inputs {
                out.extend(evaluate(program, *child, facts, cache)?);
            }
            out
        }
        SelectorNode::Intersect { inputs } => {
            let Some(first) = inputs.first() else {
                return Err(SelectorEvaluationError::UnsupportedNode);
            };
            let mut out = evaluate(program, *first, facts, cache)?;
            for child in &inputs[1..] {
                let other = evaluate(program, *child, facts, cache)?;
                out.retain(|scope| other.contains(scope));
            }
            out
        }
        SelectorNode::StableDistinct { input } => evaluate(program, *input, facts, cache)?,
        SelectorNode::First { input } => evaluate(program, *input, facts, cache)?
            .into_iter()
            .take(1)
            .collect(),
        SelectorNode::All { input } => evaluate(program, *input, facts, cache)?,
        SelectorNode::Filter { .. }
        | SelectorNode::StableSort { .. }
        | SelectorNode::RandomOne { .. }
        | SelectorNode::Side { .. }
        | SelectorNode::Party { .. }
        | SelectorNode::Bench { .. } => return Err(SelectorEvaluationError::UnsupportedNode),
    };
    result.sort();
    result.dedup();
    cache.insert(id, result.clone());
    Ok(result)
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SelectorEvaluationError {
    #[error("mechanics program failed validation")]
    InvalidProgram,
    #[error("selector node is missing: {id:?}")]
    MissingNode { id: SelectorNodeId },
    #[error("selector node requires battle facts or exact RNG not present in this evaluator")]
    UnsupportedNode,
}
