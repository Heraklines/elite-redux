//! Prepared Mechanics IR V2 execution and the temporary direct parity reference.
//!
//! Production calls the prepared entry points. The direct entry points exist
//! only to prove that prepared hook/query indexes preserve the executable
//! program stream exactly; both paths share the closed evaluator below.

use er_content::pack::m6_prepared::{ContentError, PreparedBattleContentV3};
use er_mechanics::condition_v2::{
    ComparisonOperatorV2, ConditionNodeId, ConditionNodeV2, ConditionPredicateV2, ExactRatioV2,
    ValueNodeId, ValueNodeV2,
};
use er_mechanics::program_v2::{HookBindingV2, MechanicsProgramV2};
use er_mechanics::selector_operation_v2::{
    MechanicOperationV2, QueryModifierStageV2, QueryModifierV2,
};
use er_mechanics::v2::{MechanicHookV2, MechanicQueryV2};
use er_types::mechanics::MechanicsProgramId;
use er_types::{BehaviorSourceId, BehaviorUnitId};
use thiserror::Error;

/// Closed runtime facts used by the audited routine slice.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MechanicsContextV2<'a> {
    /// Sorted active sources participating in this invocation.
    pub active_sources: &'a [BehaviorSourceId],
    /// Sorted ability sources whose bindings must observe suppression.
    pub suppressed_sources: &'a [BehaviorSourceId],
    pub instance_counter: i64,
    pub hp_current: i64,
    pub hp_max: i64,
    pub turn_index: i64,
    pub wave_index: i64,
    pub level: i64,
}

impl MechanicsContextV2<'_> {
    fn source_is_active(&self, source: &BehaviorSourceId) -> bool {
        self.active_sources.binary_search(source).is_ok()
    }

    fn source_is_suppressed(&self, source: &BehaviorSourceId) -> bool {
        self.suppressed_sources.binary_search(source).is_ok()
    }
}

/// Typed query accumulator payload. Eligibility decisions are tracked
/// separately so `Allow`/`Deny` never destroy numeric query state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum QueryValueV2 {
    Boolean(bool),
    Signed(i64),
    Unsigned(u64),
    Ratio(ExactRatioV2),
    TypeId(u8),
    CategoryId(u8),
    TargetId(u8),
}

/// One observed query operation in deterministic execution order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueryEvidenceV2 {
    pub program: MechanicsProgramId,
    pub behavior_unit: BehaviorUnitId,
    pub binding_ordinal: u16,
    pub operation_ordinal: u16,
    pub stage: QueryModifierStageV2,
    pub modifier: QueryModifierV2,
    pub condition_matched: bool,
    pub before: QueryValueV2,
    pub after: QueryValueV2,
    pub allowed_before: Option<bool>,
    pub allowed_after: Option<bool>,
    pub cancelled_before: bool,
    pub cancelled_after: bool,
}

/// Complete output from one query fold.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueryTransitionV2 {
    pub query: MechanicQueryV2,
    pub before: QueryValueV2,
    pub after: QueryValueV2,
    pub allowed: Option<bool>,
    pub cancelled: bool,
    pub evidence: Vec<QueryEvidenceV2>,
}

/// One trigger operation staged for the atomic battle transition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MechanicsOperationEvidenceV2 {
    pub program: MechanicsProgramId,
    pub behavior_unit: BehaviorUnitId,
    pub binding_ordinal: u16,
    pub operation_ordinal: u16,
    pub condition_matched: bool,
    pub operation: MechanicOperationV2,
}

/// Ordered trigger output. Applying these mutations remains the owning atomic
/// battle transition's responsibility.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MechanicsTransitionV2 {
    pub hook: MechanicHookV2,
    pub operations: Vec<MechanicsOperationEvidenceV2>,
}

#[derive(Clone, Copy)]
struct BindingRef<'a> {
    program: &'a MechanicsProgramV2,
    binding: &'a HookBindingV2,
}

/// Executes one query through the production prepared-content indexes.
pub fn execute_query_v2(
    content: &PreparedBattleContentV3,
    context: &MechanicsContextV2<'_>,
    query: MechanicQueryV2,
    initial: QueryValueV2,
) -> Result<QueryTransitionV2, MechanicsErrorV2> {
    let mut bindings = Vec::with_capacity(content.query_sources(query).len());
    for reference in content.query_sources(query) {
        let (program, binding) = content.resolve_binding(*reference)?;
        bindings.push(BindingRef { program, binding });
    }
    fold_query(bindings, context, query, initial)
}

/// Temporary scan-based reference used only by the G23 parity proof.
#[doc(hidden)]
pub fn execute_query_v2_direct_reference(
    programs: &[MechanicsProgramV2],
    context: &MechanicsContextV2<'_>,
    query: MechanicQueryV2,
    initial: QueryValueV2,
) -> Result<QueryTransitionV2, MechanicsErrorV2> {
    let mut bindings = Vec::new();
    for program in programs {
        for binding in &program.bindings {
            if binding.hook.query().ok() == Some(query) {
                bindings.push(BindingRef { program, binding });
            }
        }
    }
    fold_query(bindings, context, query, initial)
}

/// Executes one trigger hook through the production prepared-content indexes.
pub fn execute_hook_v2(
    content: &PreparedBattleContentV3,
    context: &MechanicsContextV2<'_>,
    hook: MechanicHookV2,
) -> Result<MechanicsTransitionV2, MechanicsErrorV2> {
    if hook.is_query() {
        return Err(MechanicsErrorV2::QueryHookPassedToTriggerExecutor);
    }
    let mut bindings = Vec::with_capacity(content.hook_sources(hook).len());
    for reference in content.hook_sources(hook) {
        let (program, binding) = content.resolve_binding(*reference)?;
        bindings.push(BindingRef { program, binding });
    }
    stage_hook(bindings, context, hook)
}

/// Temporary scan-based trigger reference used only by the G23 parity proof.
#[doc(hidden)]
pub fn execute_hook_v2_direct_reference(
    programs: &[MechanicsProgramV2],
    context: &MechanicsContextV2<'_>,
    hook: MechanicHookV2,
) -> Result<MechanicsTransitionV2, MechanicsErrorV2> {
    if hook.is_query() {
        return Err(MechanicsErrorV2::QueryHookPassedToTriggerExecutor);
    }
    let mut bindings = Vec::new();
    for program in programs {
        for binding in &program.bindings {
            if binding.hook == hook {
                bindings.push(BindingRef { program, binding });
            }
        }
    }
    stage_hook(bindings, context, hook)
}

fn fold_query(
    bindings: Vec<BindingRef<'_>>,
    context: &MechanicsContextV2<'_>,
    query: MechanicQueryV2,
    initial: QueryValueV2,
) -> Result<QueryTransitionV2, MechanicsErrorV2> {
    let before = initial.clone();
    let mut current = initial;
    let mut allowed = None;
    let mut cancelled = false;
    let mut evidence = Vec::new();

    for source in bindings {
        if !context.source_is_active(&source.program.source) {
            continue;
        }
        let condition_matched =
            evaluate_condition(source.program, source.binding.condition_root, context)?;
        if source.binding.selector_root.is_some() {
            return Err(MechanicsErrorV2::UnsupportedSelector);
        }
        let range = operation_range(source.program, source.binding)?;
        for (offset, operation) in range.iter().enumerate() {
            let MechanicOperationV2::Query {
                query: operation_query,
                stage,
                modifier,
            } = operation
            else {
                return Err(MechanicsErrorV2::MutationInQueryBinding);
            };
            if *operation_query != query {
                return Err(MechanicsErrorV2::QueryMismatch);
            }
            let previous = current.clone();
            let allowed_before = allowed;
            let cancelled_before = cancelled;
            if condition_matched {
                apply_modifier(
                    source.program,
                    context,
                    modifier,
                    &mut current,
                    &mut allowed,
                    &mut cancelled,
                )?;
            }
            evidence.push(QueryEvidenceV2 {
                program: source.program.id,
                behavior_unit: source.binding.behavior_unit.clone(),
                binding_ordinal: source.binding.binding_ordinal,
                operation_ordinal: operation_ordinal(source.binding, offset)?,
                stage: *stage,
                modifier: modifier.clone(),
                condition_matched,
                before: previous,
                after: current.clone(),
                allowed_before,
                allowed_after: allowed,
                cancelled_before,
                cancelled_after: cancelled,
            });
        }
    }

    Ok(QueryTransitionV2 {
        query,
        before,
        after: current,
        allowed,
        cancelled,
        evidence,
    })
}

fn stage_hook(
    bindings: Vec<BindingRef<'_>>,
    context: &MechanicsContextV2<'_>,
    hook: MechanicHookV2,
) -> Result<MechanicsTransitionV2, MechanicsErrorV2> {
    let mut operations = Vec::new();
    for source in bindings {
        if !context.source_is_active(&source.program.source) {
            continue;
        }
        let condition_matched =
            evaluate_condition(source.program, source.binding.condition_root, context)?;
        if source.binding.selector_root.is_some() {
            return Err(MechanicsErrorV2::UnsupportedSelector);
        }
        for (offset, operation) in operation_range(source.program, source.binding)?
            .iter()
            .enumerate()
        {
            if matches!(operation, MechanicOperationV2::Query { .. }) {
                return Err(MechanicsErrorV2::QueryInTriggerBinding);
            }
            operations.push(MechanicsOperationEvidenceV2 {
                program: source.program.id,
                behavior_unit: source.binding.behavior_unit.clone(),
                binding_ordinal: source.binding.binding_ordinal,
                operation_ordinal: operation_ordinal(source.binding, offset)?,
                condition_matched,
                operation: operation.clone(),
            });
        }
    }
    Ok(MechanicsTransitionV2 { hook, operations })
}

fn operation_range<'a>(
    program: &'a MechanicsProgramV2,
    binding: &HookBindingV2,
) -> Result<&'a [MechanicOperationV2], MechanicsErrorV2> {
    let start = usize::from(binding.operations.start);
    let end = binding
        .operations
        .end()
        .ok_or(MechanicsErrorV2::OperationRange)?;
    program
        .operations
        .get(start..end)
        .ok_or(MechanicsErrorV2::OperationRange)
}

fn operation_ordinal(binding: &HookBindingV2, offset: usize) -> Result<u16, MechanicsErrorV2> {
    binding
        .operations
        .start
        .checked_add(u16::try_from(offset).map_err(|_| MechanicsErrorV2::Overflow)?)
        .ok_or(MechanicsErrorV2::Overflow)
}

fn evaluate_condition(
    program: &MechanicsProgramV2,
    root: Option<ConditionNodeId>,
    context: &MechanicsContextV2<'_>,
) -> Result<bool, MechanicsErrorV2> {
    let Some(root) = root else {
        return Ok(true);
    };
    evaluate_condition_node(program, root, context, 0)
}

fn evaluate_condition_node(
    program: &MechanicsProgramV2,
    node: ConditionNodeId,
    context: &MechanicsContextV2<'_>,
    depth: usize,
) -> Result<bool, MechanicsErrorV2> {
    if depth > 32 {
        return Err(MechanicsErrorV2::ConditionDepth);
    }
    let node = program
        .conditions
        .0
        .get(node.index())
        .ok_or(MechanicsErrorV2::ConditionRoot)?;
    Ok(match node {
        ConditionNodeV2::Always => true,
        ConditionNodeV2::Never => false,
        ConditionNodeV2::Not { child } => {
            !evaluate_condition_node(program, *child, context, depth + 1)?
        }
        ConditionNodeV2::All { children } => {
            for child in children {
                if !evaluate_condition_node(program, *child, context, depth + 1)? {
                    return Ok(false);
                }
            }
            true
        }
        ConditionNodeV2::Any { children } => {
            for child in children {
                if evaluate_condition_node(program, *child, context, depth + 1)? {
                    return Ok(true);
                }
            }
            false
        }
        ConditionNodeV2::Compare {
            left,
            operator,
            right,
        } => compare_values(
            value_as_i64(program, *left, context)?,
            *operator,
            value_as_i64(program, *right, context)?,
        ),
        ConditionNodeV2::Predicate {
            predicate: ConditionPredicateV2::AbilitySuppressed { suppressed },
        } => context.source_is_suppressed(&program.source) == *suppressed,
        ConditionNodeV2::Predicate { .. } => {
            return Err(MechanicsErrorV2::UnsupportedConditionPredicate);
        }
        ConditionNodeV2::Chance { .. } => return Err(MechanicsErrorV2::RngRequired),
    })
}

fn compare_values(left: i64, operator: ComparisonOperatorV2, right: i64) -> bool {
    match operator {
        ComparisonOperatorV2::LessThan => left < right,
        ComparisonOperatorV2::LessOrEqual => left <= right,
        ComparisonOperatorV2::Equal => left == right,
        ComparisonOperatorV2::NotEqual => left != right,
        ComparisonOperatorV2::GreaterOrEqual => left >= right,
        ComparisonOperatorV2::GreaterThan => left > right,
    }
}

fn apply_modifier(
    program: &MechanicsProgramV2,
    context: &MechanicsContextV2<'_>,
    modifier: &QueryModifierV2,
    current: &mut QueryValueV2,
    allowed: &mut Option<bool>,
    cancelled: &mut bool,
) -> Result<(), MechanicsErrorV2> {
    match modifier {
        QueryModifierV2::Set { value } => {
            *current = value_for_kind(program, *value, context, current)?;
        }
        QueryModifierV2::Add { value } => {
            let operand = value_as_i64(program, *value, context)?;
            add(current, operand)?;
        }
        QueryModifierV2::Subtract { value } => {
            let operand = value_as_i64(program, *value, context)?;
            add(
                current,
                operand.checked_neg().ok_or(MechanicsErrorV2::Overflow)?,
            )?;
        }
        QueryModifierV2::Multiply { ratio } => multiply(current, *ratio, false)?,
        QueryModifierV2::Divide { ratio } => multiply(current, *ratio, true)?,
        QueryModifierV2::Minimum { value } => {
            bound(current, value_as_i64(program, *value, context)?, true)?;
        }
        QueryModifierV2::Maximum { value } => {
            bound(current, value_as_i64(program, *value, context)?, false)?;
        }
        QueryModifierV2::Clamp { minimum, maximum } => {
            let minimum = value_as_i64(program, *minimum, context)?;
            let maximum = value_as_i64(program, *maximum, context)?;
            if minimum > maximum {
                return Err(MechanicsErrorV2::InvalidClamp);
            }
            bound(current, minimum, false)?;
            bound(current, maximum, true)?;
        }
        QueryModifierV2::Cancel => *cancelled = true,
        QueryModifierV2::Allow => *allowed = Some(true),
        QueryModifierV2::Deny => *allowed = Some(false),
    }
    Ok(())
}

fn value_for_kind(
    program: &MechanicsProgramV2,
    id: ValueNodeId,
    context: &MechanicsContextV2<'_>,
    current: &QueryValueV2,
) -> Result<QueryValueV2, MechanicsErrorV2> {
    let node = program
        .values
        .0
        .get(id.index())
        .ok_or(MechanicsErrorV2::ValueRoot)?;
    if let ValueNodeV2::ExactRatio { ratio } = node {
        return if matches!(current, QueryValueV2::Ratio(_)) {
            Ok(QueryValueV2::Ratio(*ratio))
        } else {
            Err(MechanicsErrorV2::ModifierKindMismatch)
        };
    }
    let value = value_as_i64(program, id, context)?;
    Ok(match current {
        QueryValueV2::Boolean(_) => QueryValueV2::Boolean(value != 0),
        QueryValueV2::Signed(_) => QueryValueV2::Signed(value),
        QueryValueV2::Unsigned(_) => {
            QueryValueV2::Unsigned(u64::try_from(value).map_err(|_| MechanicsErrorV2::Overflow)?)
        }
        QueryValueV2::TypeId(_) => {
            QueryValueV2::TypeId(u8::try_from(value).map_err(|_| MechanicsErrorV2::Overflow)?)
        }
        QueryValueV2::CategoryId(_) => {
            QueryValueV2::CategoryId(u8::try_from(value).map_err(|_| MechanicsErrorV2::Overflow)?)
        }
        QueryValueV2::TargetId(_) => {
            QueryValueV2::TargetId(u8::try_from(value).map_err(|_| MechanicsErrorV2::Overflow)?)
        }
        QueryValueV2::Ratio(_) => return Err(MechanicsErrorV2::ModifierKindMismatch),
    })
}

fn value_as_i64(
    program: &MechanicsProgramV2,
    id: ValueNodeId,
    context: &MechanicsContextV2<'_>,
) -> Result<i64, MechanicsErrorV2> {
    match program
        .values
        .0
        .get(id.index())
        .ok_or(MechanicsErrorV2::ValueRoot)?
    {
        ValueNodeV2::Constant { value } => Ok(*value),
        ValueNodeV2::InstanceCounter => Ok(context.instance_counter),
        ValueNodeV2::BehaviorOrdinal { ordinal } => Ok(i64::from(*ordinal)),
        ValueNodeV2::HpCurrent => Ok(context.hp_current),
        ValueNodeV2::HpMax => Ok(context.hp_max),
        ValueNodeV2::TurnIndex => Ok(context.turn_index),
        ValueNodeV2::WaveIndex => Ok(context.wave_index),
        ValueNodeV2::Level => Ok(context.level),
        ValueNodeV2::ExactRatio { .. } => Err(MechanicsErrorV2::ModifierKindMismatch),
        ValueNodeV2::JsNumber { .. } => Err(MechanicsErrorV2::UnsupportedJsNumberValue),
    }
}

fn add(current: &mut QueryValueV2, operand: i64) -> Result<(), MechanicsErrorV2> {
    *current = match current {
        QueryValueV2::Signed(value) => QueryValueV2::Signed(
            value
                .checked_add(operand)
                .ok_or(MechanicsErrorV2::Overflow)?,
        ),
        QueryValueV2::Unsigned(value) => {
            let result = i128::from(*value)
                .checked_add(i128::from(operand))
                .ok_or(MechanicsErrorV2::Overflow)?;
            QueryValueV2::Unsigned(u64::try_from(result).map_err(|_| MechanicsErrorV2::Overflow)?)
        }
        _ => return Err(MechanicsErrorV2::ModifierKindMismatch),
    };
    Ok(())
}

fn multiply(
    current: &mut QueryValueV2,
    ratio: ExactRatioV2,
    divide: bool,
) -> Result<(), MechanicsErrorV2> {
    let (numerator, denominator) = if divide {
        if ratio.numerator == 0 {
            return Err(MechanicsErrorV2::DivisionByZero);
        }
        (i128::from(ratio.denominator), i128::from(ratio.numerator))
    } else {
        (i128::from(ratio.numerator), i128::from(ratio.denominator))
    };
    *current = match current {
        QueryValueV2::Signed(value) => QueryValueV2::Signed(
            i64::try_from(
                i128::from(*value)
                    .checked_mul(numerator)
                    .ok_or(MechanicsErrorV2::Overflow)?
                    .div_euclid(denominator),
            )
            .map_err(|_| MechanicsErrorV2::Overflow)?,
        ),
        QueryValueV2::Unsigned(value) if numerator >= 0 && denominator > 0 => {
            QueryValueV2::Unsigned(
                u64::try_from(
                    u128::from(*value)
                        .checked_mul(
                            u128::try_from(numerator).map_err(|_| MechanicsErrorV2::Overflow)?,
                        )
                        .ok_or(MechanicsErrorV2::Overflow)?
                        / u128::try_from(denominator).map_err(|_| MechanicsErrorV2::Overflow)?,
                )
                .map_err(|_| MechanicsErrorV2::Overflow)?,
            )
        }
        _ => return Err(MechanicsErrorV2::ModifierKindMismatch),
    };
    Ok(())
}

fn bound(current: &mut QueryValueV2, operand: i64, minimum: bool) -> Result<(), MechanicsErrorV2> {
    *current = match current {
        QueryValueV2::Signed(value) => QueryValueV2::Signed(if minimum {
            (*value).min(operand)
        } else {
            (*value).max(operand)
        }),
        QueryValueV2::Unsigned(value) => {
            let operand = u64::try_from(operand).map_err(|_| MechanicsErrorV2::Overflow)?;
            QueryValueV2::Unsigned(if minimum {
                (*value).min(operand)
            } else {
                (*value).max(operand)
            })
        }
        _ => return Err(MechanicsErrorV2::ModifierKindMismatch),
    };
    Ok(())
}

/// Closed failures for prepared/direct V2 execution.
#[derive(Debug, Error)]
pub enum MechanicsErrorV2 {
    #[error("prepared content lookup failed: {0}")]
    Content(#[from] ContentError),
    #[error("query hook passed to trigger executor")]
    QueryHookPassedToTriggerExecutor,
    #[error("query binding contains a mutation")]
    MutationInQueryBinding,
    #[error("trigger binding contains a query operation")]
    QueryInTriggerBinding,
    #[error("query operation does not match the requested query")]
    QueryMismatch,
    #[error("binding operation range is invalid")]
    OperationRange,
    #[error("condition root is invalid")]
    ConditionRoot,
    #[error("condition recursion exceeds the frozen ceiling")]
    ConditionDepth,
    #[error("condition predicate is not executable in the routine slice")]
    UnsupportedConditionPredicate,
    #[error("chance condition requires an audited RNG runtime")]
    RngRequired,
    #[error("selector evaluation is not available for this routine binding")]
    UnsupportedSelector,
    #[error("value root is invalid")]
    ValueRoot,
    #[error("JS-number value node lacks an audited routine evaluator")]
    UnsupportedJsNumberValue,
    #[error("query modifier does not match the accumulator kind")]
    ModifierKindMismatch,
    #[error("query clamp minimum exceeds maximum")]
    InvalidClamp,
    #[error("division by zero")]
    DivisionByZero,
    #[error("mechanics arithmetic overflow")]
    Overflow,
}
