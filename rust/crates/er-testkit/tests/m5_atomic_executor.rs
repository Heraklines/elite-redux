use std::error::Error;

use er_battle::mechanics::{ActiveMechanicSource, collect_mechanic_sources};
use er_battle::mechanics_condition::ConditionFacts;
use er_battle::mechanics_executor::plan_hook;
use er_battle::mechanics_mutation::execute_hook;
use er_battle::mechanics_selector::{SelectorFacts, SelectorSeed};
use er_content::pack::m5_pack::{
    BattleContentPackV2, ClassificationEntryV1, ClassificationKind, ClassificationManifestV1,
};
use er_mechanics::{
    BindingKind, HookBinding, HpOperationKind, ItemOperationKind, MechanicInstanceTemplate,
    MechanicOperation, MechanicStatePayload, MechanicsProgramV1, PresentationCueKind,
    ProgramBudget, ProgramRange, SelectorArena, SelectorNode, StageOperationKind,
    StatusOperationKind, ValueNode,
};
use er_rng::battle::RngRuntime;
use er_state::mechanic_state::HeldItemStateV1;
use er_state::migration::M4_ORACLE_SHA;
use er_state::migration_v3::migrate_game_v2_to_v3;
use er_testkit::m4_fixture::assemble_game_state;
use er_types::SafeU53;
use er_types::battle_ids::ContentPackHash;
use er_types::mechanics::{
    HookOrdinal, MechanicHook, MechanicScope, MechanicSourceId, MechanicSourceKind,
    MechanicsProgramId, SourceOrdinal,
};
use er_types::run_ids::RunContentPackHash;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe fixture id")
}

fn hash(fill: char) -> String {
    format!("blake3-v1:{}", fill.to_string().repeat(64))
}

fn pack() -> BattleContentPackV2 {
    let source = MechanicSourceId::numeric(MechanicSourceKind::ActiveAbility, safe(22));
    let program = MechanicsProgramV1 {
        schema_version: er_types::mechanics::MECHANICS_PROGRAM_VERSION,
        id: MechanicsProgramId::new(safe(1)),
        source: source.clone(),
        bindings: vec![HookBinding {
            binding: BindingKind::Trigger {
                hook: MechanicHook::AfterHit,
            },
            hook_ordinal: HookOrdinal::ZERO,
            condition_root: None,
            selector_root: None,
            operations: ProgramRange {
                start: 0,
                length: 6,
            },
        }],
        conditions: Default::default(),
        selectors: SelectorArena(vec![SelectorNode::SelfPokemon]),
        values: vec![
            ValueNode::Unsigned { value: 10 },
            ValueNode::Signed { value: 1 },
        ],
        operations: vec![
            MechanicOperation::Hp {
                operation: HpOperationKind::Damage,
                targets: er_mechanics::SelectorNodeId::ZERO,
                amount: er_mechanics::ValueNodeId::ZERO,
            },
            MechanicOperation::Status {
                operation: StatusOperationKind::Apply,
                targets: er_mechanics::SelectorNodeId::ZERO,
                status_id: safe(6),
                duration: None,
            },
            MechanicOperation::StatStage {
                operation: StageOperationKind::Add,
                targets: er_mechanics::SelectorNodeId::ZERO,
                stat_id: 0,
                stages: er_mechanics::ValueNodeId::new(1),
            },
            MechanicOperation::CreateInstance {
                owners: er_mechanics::SelectorNodeId::ZERO,
                template: MechanicInstanceTemplate {
                    program_id: MechanicsProgramId::new(safe(1)),
                    remaining_turns: Some(2),
                    counters: Vec::new(),
                    payload: MechanicStatePayload::Counter { value: safe(1) },
                },
            },
            MechanicOperation::Item {
                operation: ItemOperationKind::Consume,
                targets: er_mechanics::SelectorNodeId::ZERO,
                item_id: safe(99),
            },
            MechanicOperation::Presentation {
                cue: PresentationCueKind::Ability,
                subjects: er_mechanics::SelectorNodeId::ZERO,
                detail_id: Some(safe(22)),
            },
        ],
        budget: ProgramBudget::ceiling(),
    };
    let mut pack = BattleContentPackV2 {
        schema_version: 2,
        oracle_sha: "328824692f95b1aa1b38af85b54a6b72d9259eb4".to_owned(),
        source_catalog_digest: format!("sha256:{}", "0".repeat(64)),
        content_hash: String::new(),
        species: Vec::new(),
        moves: Vec::new(),
        abilities: Vec::new(),
        held_items: Vec::new(),
        programs: vec![None, Some(program)],
        classifications: ClassificationManifestV1(vec![ClassificationEntryV1 {
            subject: source,
            kind: ClassificationKind::Compiled,
            programs: vec![MechanicsProgramId::new(safe(1))],
            bespoke_symbol: None,
            unsupported_reason: None,
        }]),
        bespoke: Vec::new(),
        type_chart: er_content::pack::selected_type_chart(),
    };
    pack.content_hash = pack.compute_content_hash().expect("content hash");
    pack.validate().expect("pack");
    pack
}

#[test]
fn hook_commit_is_atomic_and_creates_one_restorable_instance() -> Result<(), Box<dyn Error>> {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../fixtures/m4/oracle/run-segments/classic-composed-wave-9-through-11-v1.json"
    ))?;
    let v2 = assemble_game_state(
        &fixture,
        ContentPackHash::new(hash('a'))?,
        RunContentPackHash::new(hash('b'))?,
        M4_ORACLE_SHA,
    )?;
    let (mut state, _) = migrate_game_v2_to_v3(&v2, hash('c'))?;
    let pokemon = state
        .base
        .player_party
        .first()
        .ok_or("fixture party is empty")?
        .id;
    state.pokemon_extensions[0]
        .held_items
        .push(HeldItemStateV1 {
            item_id: safe(99),
            registry_key: "TEST_ORB".to_owned(),
            source_ordinal: SourceOrdinal::ZERO,
            consumed: false,
            charges: 1,
        });
    let before_hp = state.base.player_party[0].hp;
    let pack = pack();
    let ordered = collect_mechanic_sources(
        &pack,
        vec![ActiveMechanicSource {
            source: MechanicSourceId::numeric(MechanicSourceKind::ActiveAbility, safe(22)),
            scope: MechanicScope::Pokemon { pokemon },
            side: None,
            field_position: None,
            source_ordinal: SourceOrdinal::ZERO,
        }],
    )?;
    let plan = plan_hook(&pack, &ordered, MechanicHook::AfterHit)?;
    let mut selector_facts = SelectorFacts::default();
    selector_facts.seeds.insert(
        SelectorSeed::SelfPokemon,
        vec![MechanicScope::Pokemon { pokemon }],
    );
    let transition = execute_hook(
        &pack,
        &plan,
        &state,
        &ConditionFacts::default(),
        &selector_facts,
        &RngRuntime::from_run_seed("atomic"),
    )?;
    assert!(state.pokemon_extensions[0].mechanics.instances.is_empty());
    assert_eq!(
        transition.after_state.pokemon_extensions[0]
            .mechanics
            .instances
            .len(),
        1
    );
    assert_eq!(transition.mutations.len(), 5);
    assert_eq!(transition.presentation.len(), 1);
    assert_eq!(
        transition.after_state.base.player_party[0].hp,
        before_hp - 10
    );
    assert_eq!(
        transition.after_state.base.player_party[0].status.kind,
        er_types::battle_model::StatusKind::Burn
    );
    assert_eq!(
        transition.after_state.base.player_party[0]
            .stat_stages
            .attack,
        1
    );
    assert!(transition.after_state.pokemon_extensions[0].held_items[0].consumed);
    assert_eq!(
        transition.after_state.pokemon_extensions[0].held_items[0].charges,
        0
    );
    transition.after_state.validate()?;
    Ok(())
}
