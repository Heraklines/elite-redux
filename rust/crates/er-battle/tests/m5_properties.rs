use er_battle::mechanics_condition::{ConditionFacts, evaluate_condition};
use er_battle::mechanics_selector::{SelectorFacts, SelectorSeed, evaluate_selector};
use er_mechanics::{
    BindingKind, ComparisonOperator, ConditionArena, ConditionNode, HookBinding, MechanicOperation,
    MechanicsProgramV1, PresentationCueKind, ProgramBudget, ProgramRange, SelectorArena,
    SelectorNode, ValueNode, ValueNodeId,
};
use er_types::SafeU53;
use er_types::battle_ids::PokemonId;
use er_types::mechanics::{
    HookOrdinal, MechanicHook, MechanicScope, MechanicSourceId, MechanicSourceKind,
    MechanicsProgramId,
};
use proptest::prelude::*;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe fixture id")
}

fn condition_program(left: i64, right: i64) -> MechanicsProgramV1 {
    MechanicsProgramV1 {
        schema_version: er_types::mechanics::MECHANICS_PROGRAM_VERSION,
        id: MechanicsProgramId::new(safe(1)),
        source: MechanicSourceId::numeric(MechanicSourceKind::ActiveAbility, safe(22)),
        bindings: vec![HookBinding {
            binding: BindingKind::Trigger {
                hook: MechanicHook::AfterHit,
            },
            hook_ordinal: HookOrdinal::ZERO,
            condition_root: Some(er_mechanics::ConditionNodeId::ZERO),
            selector_root: Some(er_mechanics::SelectorNodeId::ZERO),
            operations: ProgramRange {
                start: 0,
                length: 1,
            },
        }],
        conditions: ConditionArena(vec![ConditionNode::Compare {
            left: ValueNodeId::ZERO,
            operator: ComparisonOperator::Less,
            right: ValueNodeId::new(1),
        }]),
        selectors: SelectorArena(vec![SelectorNode::Actor]),
        values: vec![
            ValueNode::Signed { value: left },
            ValueNode::Signed { value: right },
        ],
        operations: vec![MechanicOperation::Presentation {
            cue: PresentationCueKind::Message,
            subjects: er_mechanics::SelectorNodeId::ZERO,
            detail_id: None,
        }],
        budget: ProgramBudget::ceiling(),
    }
}

fn union_program() -> MechanicsProgramV1 {
    let mut program = condition_program(0, 1);
    program.conditions = ConditionArena::default();
    program.bindings[0].condition_root = None;
    program.selectors = SelectorArena(vec![
        SelectorNode::Actor,
        SelectorNode::Actor,
        SelectorNode::Union {
            inputs: vec![
                er_mechanics::SelectorNodeId::ZERO,
                er_mechanics::SelectorNodeId::new(1),
            ],
        },
    ]);
    program.bindings[0].selector_root = Some(er_mechanics::SelectorNodeId::new(2));
    program.operations[0] = MechanicOperation::Presentation {
        cue: PresentationCueKind::Message,
        subjects: er_mechanics::SelectorNodeId::new(2),
        detail_id: None,
    };
    program.values.clear();
    program
}

proptest! {
    #[test]
    fn comparisons_match_rust_ordering(left in -1_000_000_i64..1_000_000, right in -1_000_000_i64..1_000_000) {
        let program = condition_program(left, right);
        prop_assert_eq!(evaluate_condition(&program, er_mechanics::ConditionNodeId::ZERO, &ConditionFacts::default()), Ok(left < right));
    }
}

#[test]
fn union_is_stable_and_duplicate_free() {
    let program = union_program();
    let scope = MechanicScope::Pokemon {
        pokemon: PokemonId::new(safe(100)),
    };
    let mut facts = SelectorFacts::default();
    facts.seeds.insert(SelectorSeed::Actor, vec![scope]);
    assert_eq!(
        evaluate_selector(&program, er_mechanics::SelectorNodeId::new(2), &facts),
        Ok(vec![scope])
    );
}
