use er_content::pack::m5_pack::BattleContentPackV2;
use er_mechanics::{ExactRatio, MechanicOperation, QueryModifier, QueryValueKind, ValueNode};
use er_rng::battle::RngRuntime;
use er_types::mechanics::MechanicsProgramId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::mechanics_condition::{
    ConditionEvaluationError, ConditionFacts, evaluate_condition_with_rng, evaluate_value,
};
use crate::mechanics_executor::QueryExecutionPlan;
use crate::mechanics_selector::{
    SelectorEvaluationError, SelectorFacts, evaluate_selector_with_rng,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QueryValue {
    Boolean(bool),
    Signed(i64),
    Unsigned(u64),
    Ratio(ExactRatio),
    TypeId(u8),
    CategoryId(u8),
    TargetId(u8),
}

impl QueryValue {
    pub const fn kind(&self) -> QueryValueKind {
        match self {
            Self::Boolean(_) => QueryValueKind::Boolean,
            Self::Signed(_) => QueryValueKind::SignedInteger,
            Self::Unsigned(_) => QueryValueKind::UnsignedInteger,
            Self::Ratio(_) => QueryValueKind::Ratio,
            Self::TypeId(_) => QueryValueKind::TypeId,
            Self::CategoryId(_) => QueryValueKind::CategoryId,
            Self::TargetId(_) => QueryValueKind::TargetId,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueryEvidence {
    pub program_id: MechanicsProgramId,
    pub source_index: usize,
    pub hook_ordinal: u16,
    pub operation_ordinal: u16,
    pub condition_matched: bool,
    pub selector_count: usize,
    pub before: QueryValue,
    pub modifier: QueryModifier,
    pub after: QueryValue,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueryTransition {
    pub before: QueryValue,
    pub after: QueryValue,
    pub evidence: Vec<QueryEvidence>,
}

pub fn execute_query(
    pack: &BattleContentPackV2,
    plan: &QueryExecutionPlan,
    initial: QueryValue,
    condition_facts: &ConditionFacts,
    selector_facts: &SelectorFacts,
    rng: &mut RngRuntime,
) -> Result<QueryTransition, QueryExecutionError> {
    let before = initial.clone();
    let mut current = initial;
    let mut evidence = Vec::new();
    for planned in &plan.operations {
        let program = program(pack, planned.program_id)?;
        let expected = planned
            .query_value_kind
            .ok_or(QueryExecutionError::MutationInQueryPlan)?;
        if current.kind() != expected {
            return Err(QueryExecutionError::ValueKindMismatch {
                expected,
                actual: current.kind(),
            });
        }
        let mut local_facts = condition_facts.clone();
        let source = plan
            .sources
            .get(planned.source_index)
            .ok_or(QueryExecutionError::MissingSource)?;
        local_facts.source = Some(source.source.clone());
        local_facts.scope = Some(source.scope);
        local_facts.query_input = query_input(&current)?;
        let condition_matched = match planned.condition_root {
            Some(root) => evaluate_condition_with_rng(program, root, &local_facts, rng)?,
            None => true,
        };
        let selector_count = match planned.selector_root {
            Some(root) if condition_matched => {
                evaluate_selector_with_rng(program, root, selector_facts, rng)?.len()
            }
            _ => 0,
        };
        let apply = condition_matched && (planned.selector_root.is_none() || selector_count > 0);
        let previous = current.clone();
        let modifier = match &planned.operation {
            MechanicOperation::Query { modifier } => modifier.clone(),
            _ => return Err(QueryExecutionError::MutationInQueryPlan),
        };
        if apply {
            current = apply_modifier(program, current, &modifier, &local_facts)?;
        }
        evidence.push(QueryEvidence {
            program_id: planned.program_id,
            source_index: planned.source_index,
            hook_ordinal: planned.hook_ordinal.get(),
            operation_ordinal: planned.operation_ordinal,
            condition_matched,
            selector_count,
            before: previous,
            modifier,
            after: current.clone(),
        });
    }
    Ok(QueryTransition {
        before,
        after: current,
        evidence,
    })
}

fn program(
    pack: &BattleContentPackV2,
    program_id: MechanicsProgramId,
) -> Result<&er_mechanics::MechanicsProgramV1, QueryExecutionError> {
    let index = usize::try_from(program_id.get().get())
        .map_err(|_| QueryExecutionError::MissingProgram { program_id })?;
    pack.programs
        .get(index)
        .and_then(Option::as_ref)
        .ok_or(QueryExecutionError::MissingProgram { program_id })
}

fn query_input(value: &QueryValue) -> Result<i64, QueryExecutionError> {
    match value {
        QueryValue::Boolean(value) => Ok(i64::from(*value)),
        QueryValue::Signed(value) => Ok(*value),
        QueryValue::Unsigned(value) => {
            i64::try_from(*value).map_err(|_| QueryExecutionError::Overflow)
        }
        QueryValue::Ratio(value) => {
            i64::try_from(value.numerator).map_err(|_| QueryExecutionError::Overflow)
        }
        QueryValue::TypeId(value) | QueryValue::CategoryId(value) | QueryValue::TargetId(value) => {
            Ok(i64::from(*value))
        }
    }
}

fn apply_modifier(
    program: &er_mechanics::MechanicsProgramV1,
    current: QueryValue,
    modifier: &QueryModifier,
    facts: &ConditionFacts,
) -> Result<QueryValue, QueryExecutionError> {
    match modifier {
        QueryModifier::Set { value } => value_from_node(program, *value, current.kind(), facts),
        QueryModifier::Add { value } => {
            let delta = evaluate_value(program, *value, facts)?;
            match current {
                QueryValue::Signed(value) => value
                    .checked_add(delta)
                    .map(QueryValue::Signed)
                    .ok_or(QueryExecutionError::Overflow),
                QueryValue::Unsigned(value) => {
                    let delta = u64::try_from(delta).map_err(|_| QueryExecutionError::Overflow)?;
                    value
                        .checked_add(delta)
                        .map(QueryValue::Unsigned)
                        .ok_or(QueryExecutionError::Overflow)
                }
                _ => Err(QueryExecutionError::ModifierKindMismatch),
            }
        }
        QueryModifier::Multiply { ratio } => multiply(current, *ratio),
        QueryModifier::Minimum { value } | QueryModifier::Maximum { value } => {
            let bound = evaluate_value(program, *value, facts)?;
            let minimum = matches!(modifier, QueryModifier::Minimum { .. });
            match current {
                QueryValue::Signed(value) => Ok(QueryValue::Signed(if minimum {
                    value.min(bound)
                } else {
                    value.max(bound)
                })),
                QueryValue::Unsigned(value) => {
                    let bound = u64::try_from(bound).map_err(|_| QueryExecutionError::Overflow)?;
                    Ok(QueryValue::Unsigned(if minimum {
                        value.min(bound)
                    } else {
                        value.max(bound)
                    }))
                }
                _ => Err(QueryExecutionError::ModifierKindMismatch),
            }
        }
        QueryModifier::Cancel => match current {
            QueryValue::Boolean(_) => Ok(QueryValue::Boolean(true)),
            _ => Err(QueryExecutionError::ModifierKindMismatch),
        },
        QueryModifier::ReplaceType { type_id } => Ok(QueryValue::TypeId(*type_id)),
        QueryModifier::ReplaceCategory { category_id } => Ok(QueryValue::CategoryId(*category_id)),
        QueryModifier::ReplaceTarget { target_id } => Ok(QueryValue::TargetId(*target_id)),
    }
}

fn value_from_node(
    program: &er_mechanics::MechanicsProgramV1,
    id: er_mechanics::ValueNodeId,
    kind: QueryValueKind,
    facts: &ConditionFacts,
) -> Result<QueryValue, QueryExecutionError> {
    if kind == QueryValueKind::Ratio {
        return match program.values.get(id.index()) {
            Some(ValueNode::Ratio { value }) => Ok(QueryValue::Ratio(*value)),
            _ => Err(QueryExecutionError::ModifierKindMismatch),
        };
    }
    let value = evaluate_value(program, id, facts)?;
    match kind {
        QueryValueKind::Boolean => Ok(QueryValue::Boolean(value != 0)),
        QueryValueKind::SignedInteger => Ok(QueryValue::Signed(value)),
        QueryValueKind::UnsignedInteger => Ok(QueryValue::Unsigned(
            u64::try_from(value).map_err(|_| QueryExecutionError::Overflow)?,
        )),
        QueryValueKind::TypeId => Ok(QueryValue::TypeId(
            u8::try_from(value).map_err(|_| QueryExecutionError::Overflow)?,
        )),
        QueryValueKind::CategoryId => Ok(QueryValue::CategoryId(
            u8::try_from(value).map_err(|_| QueryExecutionError::Overflow)?,
        )),
        QueryValueKind::TargetId => Ok(QueryValue::TargetId(
            u8::try_from(value).map_err(|_| QueryExecutionError::Overflow)?,
        )),
        QueryValueKind::Ratio => Err(QueryExecutionError::ModifierKindMismatch),
    }
}

fn multiply(value: QueryValue, ratio: ExactRatio) -> Result<QueryValue, QueryExecutionError> {
    match value {
        QueryValue::Signed(value) => {
            let product = i128::from(value)
                .checked_mul(i128::from(ratio.numerator))
                .ok_or(QueryExecutionError::Overflow)?;
            Ok(QueryValue::Signed(
                i64::try_from(product.div_euclid(i128::from(ratio.denominator)))
                    .map_err(|_| QueryExecutionError::Overflow)?,
            ))
        }
        QueryValue::Unsigned(value) if ratio.numerator >= 0 => {
            let product = u128::from(value)
                .checked_mul(
                    u128::try_from(ratio.numerator).map_err(|_| QueryExecutionError::Overflow)?,
                )
                .ok_or(QueryExecutionError::Overflow)?;
            Ok(QueryValue::Unsigned(
                u64::try_from(product / u128::from(ratio.denominator))
                    .map_err(|_| QueryExecutionError::Overflow)?,
            ))
        }
        QueryValue::Ratio(value) => {
            let numerator = value
                .numerator
                .checked_mul(ratio.numerator)
                .ok_or(QueryExecutionError::Overflow)?;
            let denominator = value
                .denominator
                .checked_mul(ratio.denominator)
                .ok_or(QueryExecutionError::Overflow)?;
            Ok(QueryValue::Ratio(
                ExactRatio::new(numerator, denominator)
                    .map_err(|_| QueryExecutionError::Overflow)?,
            ))
        }
        _ => Err(QueryExecutionError::ModifierKindMismatch),
    }
}

#[derive(Debug, Error)]
pub enum QueryExecutionError {
    #[error("mechanics plan references missing program {program_id}")]
    MissingProgram { program_id: MechanicsProgramId },
    #[error("mechanics plan references missing source")]
    MissingSource,
    #[error("query plan contains a mutation operation")]
    MutationInQueryPlan,
    #[error("query value kind mismatch: expected {expected:?}, got {actual:?}")]
    ValueKindMismatch {
        expected: QueryValueKind,
        actual: QueryValueKind,
    },
    #[error("query modifier does not support the accumulator kind")]
    ModifierKindMismatch,
    #[error("query arithmetic overflowed")]
    Overflow,
    #[error(transparent)]
    Condition(#[from] ConditionEvaluationError),
    #[error(transparent)]
    Selector(#[from] SelectorEvaluationError),
}
