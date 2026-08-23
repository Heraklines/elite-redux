use er_mechanics::{
    ArithmeticOperator, BindingKind, ConditionArena, ConditionNode, HookBinding, MechanicOperation,
    MechanicsProgramV1, ProgramBudget, ProgramRange, ProgramValidationError, QueryModifier,
    QueryValueKind, SelectorArena, ValueNode, ValueNodeId,
};
use er_types::SafeU53;
use er_types::mechanics::{
    HookOrdinal, MECHANICS_PROGRAM_VERSION, MechanicHook, MechanicQuery, MechanicSourceId,
    MechanicSourceKind, MechanicsProgramId,
};

const ONE: SafeU53 = match SafeU53::new(1) {
    Ok(value) => value,
    Err(_) => SafeU53::ZERO,
};

fn budget(values: u16, operations: u16) -> ProgramBudget {
    ProgramBudget {
        hook_bindings: 1,
        condition_nodes: 0,
        selector_nodes: 0,
        value_nodes: values,
        operations,
        condition_depth: 0,
        selector_depth: 0,
        rng_draws: 0,
        spawned_instances: 0,
        presentation_cues: 0,
    }
}

fn query_program(values: Vec<ValueNode>) -> MechanicsProgramV1 {
    MechanicsProgramV1 {
        schema_version: MECHANICS_PROGRAM_VERSION,
        id: MechanicsProgramId::new(ONE),
        source: MechanicSourceId::numeric(MechanicSourceKind::ActiveAbility, ONE),
        bindings: vec![HookBinding {
            binding: BindingKind::Query {
                query: MechanicQuery::MovePower,
                value_kind: QueryValueKind::UnsignedInteger,
            },
            hook_ordinal: HookOrdinal::ZERO,
            condition_root: None,
            selector_root: None,
            operations: ProgramRange {
                start: 0,
                length: 1,
            },
        }],
        conditions: ConditionArena::default(),
        selectors: SelectorArena::default(),
        values,
        operations: vec![MechanicOperation::Query {
            modifier: QueryModifier::Set {
                value: ValueNodeId::ZERO,
            },
        }],
        budget: budget(1, 1),
    }
}

#[test]
fn validates_closed_query_program() {
    let program = query_program(vec![ValueNode::Unsigned { value: 120 }]);
    assert_eq!(program.validate(), Ok(()));
}

#[test]
fn rejects_value_cycles_before_execution() {
    let mut program = query_program(vec![
        ValueNode::Arithmetic {
            operator: ArithmeticOperator::Add,
            left: ValueNodeId::new(1),
            right: ValueNodeId::new(1),
        },
        ValueNode::Arithmetic {
            operator: ArithmeticOperator::Add,
            left: ValueNodeId::ZERO,
            right: ValueNodeId::ZERO,
        },
    ]);
    program.budget.value_nodes = 2;
    assert!(matches!(
        program.validate(),
        Err(ProgramValidationError::NodeCycle { kind: "value" })
    ));
}

#[test]
fn rejects_query_operation_on_trigger_binding() {
    let mut program = query_program(vec![ValueNode::Unsigned { value: 1 }]);
    program.bindings[0].binding = BindingKind::Trigger {
        hook: MechanicHook::BeforeMove,
    };
    assert!(matches!(
        program.validate(),
        Err(ProgramValidationError::QueryOperationOnTrigger { binding: 0 })
    ));
}

#[test]
fn rejects_ambiguous_source_identity() {
    let mut program = query_program(vec![ValueNode::Unsigned { value: 1 }]);
    program.source.registry_key = Some("OVERLAP".to_owned());
    assert_eq!(
        program.validate(),
        Err(ProgramValidationError::InvalidSource)
    );
}

#[test]
fn rejects_dynamic_callback_condition_nodes() {
    let dynamic = r#"{"kind":"CALLBACK","function":"(state) => true","arguments":[]}"#;
    assert!(serde_json::from_str::<ConditionNode>(dynamic).is_err());
}

#[test]
fn rejects_unknown_operations_in_program_json() {
    let dynamic = r#"{"kind":"EXECUTE_SCRIPT","script":"damage *= 2"}"#;
    assert!(serde_json::from_str::<MechanicOperation>(dynamic).is_err());
}
