use er_battle::mechanics::{ActiveMechanicSource, collect_mechanic_sources};
use er_battle::mechanics_condition::ConditionFacts;
use er_battle::mechanics_executor::plan_query;
use er_battle::mechanics_query::{QueryValue, execute_query};
use er_battle::mechanics_selector::SelectorFacts;
use er_content::pack::m5_pack::{
    BattleContentPackV2, ClassificationEntryV1, ClassificationKind, ClassificationManifestV1,
};
use er_mechanics::{
    BindingKind, ConditionArena, ConditionNode, ExactRatio, HookBinding, MechanicOperation,
    MechanicsProgramV1, MechanicsRngReason, MechanicsRngStream, ProgramBudget, ProgramRange,
    QueryModifier, QueryValueKind,
};
use er_rng::battle::{BattleRngState, RngRuntime};
use er_types::SafeU53;
use er_types::battle_ids::{PokemonId, TurnIndex};
use er_types::mechanics::{
    HookOrdinal, MechanicQuery, MechanicScope, MechanicSourceId, MechanicSourceKind,
    MechanicsProgramId, SourceOrdinal,
};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe fixture id")
}

fn program(chance: bool) -> MechanicsProgramV1 {
    MechanicsProgramV1 {
        schema_version: er_types::mechanics::MECHANICS_PROGRAM_VERSION,
        id: MechanicsProgramId::new(safe(1)),
        source: MechanicSourceId::numeric(MechanicSourceKind::ActiveAbility, safe(22)),
        bindings: vec![HookBinding {
            binding: BindingKind::Query {
                query: MechanicQuery::MovePower,
                value_kind: QueryValueKind::UnsignedInteger,
            },
            hook_ordinal: HookOrdinal::new(3),
            condition_root: chance.then_some(er_mechanics::ConditionNodeId::ZERO),
            selector_root: None,
            operations: ProgramRange {
                start: 0,
                length: 1,
            },
        }],
        conditions: ConditionArena(if chance {
            vec![ConditionNode::Chance {
                numerator: 1,
                denominator: 2,
                stream: MechanicsRngStream::Battle,
                reason: MechanicsRngReason::AbilityChance,
            }]
        } else {
            Vec::new()
        }),
        selectors: Default::default(),
        values: Vec::new(),
        operations: vec![MechanicOperation::Query {
            modifier: QueryModifier::Multiply {
                ratio: ExactRatio::new(3, 2).expect("ratio"),
            },
        }],
        budget: ProgramBudget::ceiling(),
    }
}

fn pack(chance: bool) -> BattleContentPackV2 {
    let mut pack = BattleContentPackV2 {
        schema_version: 2,
        oracle_sha: "328824692f95b1aa1b38af85b54a6b72d9259eb4".to_owned(),
        source_catalog_digest: format!("sha256:{}", "0".repeat(64)),
        content_hash: String::new(),
        species: Vec::new(),
        moves: Vec::new(),
        abilities: Vec::new(),
        held_items: Vec::new(),
        programs: vec![None, Some(program(chance))],
        classifications: ClassificationManifestV1(vec![ClassificationEntryV1 {
            subject: MechanicSourceId::numeric(MechanicSourceKind::ActiveAbility, safe(22)),
            kind: ClassificationKind::Compiled,
            programs: vec![MechanicsProgramId::new(safe(1))],
            bespoke_symbol: None,
            unsupported_reason: None,
        }]),
        bespoke: Vec::new(),
        type_chart: er_content::pack::selected_type_chart(),
    };
    pack.content_hash = pack.compute_content_hash().expect("hash");
    pack.validate().expect("valid pack");
    pack
}

fn sources(pack: &BattleContentPackV2) -> Vec<er_battle::mechanics::OrderedMechanicSource> {
    collect_mechanic_sources(
        pack,
        vec![ActiveMechanicSource {
            source: MechanicSourceId::numeric(MechanicSourceKind::ActiveAbility, safe(22)),
            scope: MechanicScope::Pokemon {
                pokemon: PokemonId::new(safe(100)),
            },
            side: None,
            field_position: None,
            source_ordinal: SourceOrdinal::ZERO,
        }],
    )
    .expect("sources")
}

#[test]
fn query_pipeline_applies_exact_ratio_in_stable_order() {
    let pack = pack(false);
    let plan = plan_query(&pack, &sources(&pack), MechanicQuery::MovePower).expect("plan");
    let mut rng = RngRuntime::from_run_seed("query");
    let transition = execute_query(
        &pack,
        &plan,
        QueryValue::Unsigned(100),
        &ConditionFacts::default(),
        &SelectorFacts::default(),
        &mut rng,
    )
    .expect("query");
    assert_eq!(transition.after, QueryValue::Unsigned(150));
    assert_eq!(transition.evidence.len(), 1);
    assert_eq!(transition.evidence[0].hook_ordinal, 3);
}

#[test]
fn chance_query_is_deterministic_and_audited() {
    let pack = pack(true);
    let plan = plan_query(&pack, &sources(&pack), MechanicQuery::MovePower).expect("plan");
    let turn = TurnIndex::new(safe(1)).expect("turn");
    let make_rng = || {
        let mut rng = RngRuntime::from_run_seed("chance");
        rng.install_battle_state(BattleRngState::new("battle", turn))
            .expect("battle rng");
        rng
    };
    let mut first_rng = make_rng();
    let mut second_rng = make_rng();
    let first = execute_query(
        &pack,
        &plan,
        QueryValue::Unsigned(100),
        &ConditionFacts::default(),
        &SelectorFacts::default(),
        &mut first_rng,
    )
    .expect("first");
    let second = execute_query(
        &pack,
        &plan,
        QueryValue::Unsigned(100),
        &ConditionFacts::default(),
        &SelectorFacts::default(),
        &mut second_rng,
    )
    .expect("second");
    assert_eq!(first, second);
    assert_eq!(first_rng.audit_entries(), second_rng.audit_entries());
    assert_eq!(first_rng.audit_entries().len(), 1);
}
