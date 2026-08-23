use std::collections::{BTreeMap, BTreeSet};

use er_mechanics::{
    ArithmeticOperator, ComparisonOperator, ConditionNode, ConditionNodeId, MechanicsProgramV1,
    PresenceKind, Relation, ValueField, ValueNode, ValueNodeId,
};
use er_types::SafeU53;
use er_types::mechanics::{MechanicScope, MechanicSourceId};
use thiserror::Error;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ConditionFacts {
    pub query_input: i64,
    pub values: BTreeMap<ValueField, i64>,
    pub relations: BTreeSet<Relation>,
    pub presence: BTreeSet<(PresenceKind, Option<SafeU53>)>,
    pub source: Option<MechanicSourceId>,
    pub scope: Option<MechanicScope>,
}

pub fn evaluate_condition(
    program: &MechanicsProgramV1,
    root: ConditionNodeId,
    facts: &ConditionFacts,
) -> Result<bool, ConditionEvaluationError> {
    program
        .validate()
        .map_err(|_| ConditionEvaluationError::InvalidProgram)?;
    let mut condition_cache = BTreeMap::new();
    let mut value_cache = BTreeMap::new();
    condition_value(program, root, facts, &mut condition_cache, &mut value_cache)
}

fn condition_value(
    program: &MechanicsProgramV1,
    id: ConditionNodeId,
    facts: &ConditionFacts,
    conditions: &mut BTreeMap<ConditionNodeId, bool>,
    values: &mut BTreeMap<ValueNodeId, i64>,
) -> Result<bool, ConditionEvaluationError> {
    if let Some(value) = conditions.get(&id) {
        return Ok(*value);
    }
    let node = program
        .conditions
        .get(id)
        .ok_or(ConditionEvaluationError::MissingCondition { id })?;
    let result = match node {
        ConditionNode::Always => true,
        ConditionNode::Never => false,
        ConditionNode::Not { child } => {
            !condition_value(program, *child, facts, conditions, values)?
        }
        ConditionNode::All { children } => {
            let mut matched = true;
            for child in children {
                matched &= condition_value(program, *child, facts, conditions, values)?;
            }
            matched
        }
        ConditionNode::Any { children } => {
            let mut matched = false;
            for child in children {
                matched |= condition_value(program, *child, facts, conditions, values)?;
            }
            matched
        }
        ConditionNode::Compare {
            left,
            operator,
            right,
        } => {
            let left = value(program, *left, facts, values)?;
            let right = value(program, *right, facts, values)?;
            match operator {
                ComparisonOperator::Equal => left == right,
                ComparisonOperator::NotEqual => left != right,
                ComparisonOperator::Less => left < right,
                ComparisonOperator::LessOrEqual => left <= right,
                ComparisonOperator::Greater => left > right,
                ComparisonOperator::GreaterOrEqual => left >= right,
            }
        }
        ConditionNode::Relation { relation } => facts.relations.contains(relation),
        ConditionNode::Presence { presence, id } => facts.presence.contains(&(*presence, *id)),
        ConditionNode::SourceIs { source } => facts.source.as_ref() == Some(source),
        ConditionNode::ScopeIs { scope } => facts.scope == Some(*scope),
        ConditionNode::Chance { .. } => return Err(ConditionEvaluationError::ChanceRequiresRng),
    };
    conditions.insert(id, result);
    Ok(result)
}

fn value(
    program: &MechanicsProgramV1,
    id: ValueNodeId,
    facts: &ConditionFacts,
    cache: &mut BTreeMap<ValueNodeId, i64>,
) -> Result<i64, ConditionEvaluationError> {
    if let Some(value) = cache.get(&id) {
        return Ok(*value);
    }
    let node = program
        .values
        .get(id.index())
        .ok_or(ConditionEvaluationError::MissingValue { id })?;
    let result = match node {
        ValueNode::Signed { value } => *value,
        ValueNode::Unsigned { value } => {
            i64::try_from(*value).map_err(|_| ConditionEvaluationError::Overflow)?
        }
        ValueNode::Ratio { .. } => return Err(ConditionEvaluationError::RatioNeedsOperand),
        ValueNode::QueryInput => facts.query_input,
        ValueNode::Field { field } => *facts
            .values
            .get(field)
            .ok_or(ConditionEvaluationError::MissingField { field: *field })?,
        ValueNode::Arithmetic {
            operator,
            left,
            right,
        } => {
            let left = value(program, *left, facts, cache)?;
            let right = value(program, *right, facts, cache)?;
            match operator {
                ArithmeticOperator::Add => left.checked_add(right),
                ArithmeticOperator::Subtract => left.checked_sub(right),
                ArithmeticOperator::Multiply => left.checked_mul(right),
                ArithmeticOperator::DivideFloor => (right != 0).then(|| left.div_euclid(right)),
                ArithmeticOperator::Minimum => Some(left.min(right)),
                ArithmeticOperator::Maximum => Some(left.max(right)),
            }
            .ok_or(ConditionEvaluationError::Overflow)?
        }
        ValueNode::MultiplyRatio {
            value: input,
            ratio,
        } => {
            let input = i128::from(value(program, *input, facts, cache)?);
            let product = input
                .checked_mul(i128::from(ratio.numerator))
                .ok_or(ConditionEvaluationError::Overflow)?;
            i64::try_from(product.div_euclid(i128::from(ratio.denominator)))
                .map_err(|_| ConditionEvaluationError::Overflow)?
        }
        ValueNode::Clamp {
            value: input,
            minimum,
            maximum,
        } => {
            let input = value(program, *input, facts, cache)?;
            let minimum = value(program, *minimum, facts, cache)?;
            let maximum = value(program, *maximum, facts, cache)?;
            if minimum > maximum {
                return Err(ConditionEvaluationError::InvalidClamp);
            }
            input.clamp(minimum, maximum)
        }
        ValueNode::JavaScriptFloor { value: input }
        | ValueNode::JavaScriptCeil { value: input }
        | ValueNode::JavaScriptRound { value: input } => value(program, *input, facts, cache)?,
    };
    cache.insert(id, result);
    Ok(result)
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum ConditionEvaluationError {
    #[error("mechanics program failed validation")]
    InvalidProgram,
    #[error("condition node {id:?} is missing")]
    MissingCondition { id: ConditionNodeId },
    #[error("value node {id:?} is missing")]
    MissingValue { id: ValueNodeId },
    #[error("value field {field:?} is missing")]
    MissingField { field: ValueField },
    #[error("condition arithmetic overflowed or divided by zero")]
    Overflow,
    #[error("ratio value requires an operand")]
    RatioNeedsOperand,
    #[error("clamp minimum exceeds maximum")]
    InvalidClamp,
    #[error("chance condition requires the exact RNG executor")]
    ChanceRequiresRng,
}
