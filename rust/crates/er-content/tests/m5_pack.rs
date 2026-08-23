use er_content::moves::MoveDefinition;
use er_content::pack::m5_pack::{
    BattleContentPackV2, BattlePackLoadError, ClassificationEntryV1, ClassificationKind,
    ClassificationManifestV1, HeldItemDefinitionV2,
};
use er_mechanics::{
    BindingKind, ExactRatio, HookBinding, MechanicOperation, MechanicsProgramV1, ProgramBudget,
    ProgramRange, QueryModifier, QueryValueKind, ValueNode, ValueNodeId,
};
use er_types::SafeU53;
use er_types::battle_ids::MoveId;
use er_types::battle_model::{
    CapabilityStatus, EffectChance, MoveAccuracy, MoveCategory, MovePower, MoveTarget, PokemonType,
};
use er_types::mechanics::{
    HookOrdinal, MechanicQuery, MechanicSourceId, MechanicSourceKind, MechanicsProgramId,
};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("fixture id")
}

fn program(id: u64) -> MechanicsProgramV1 {
    MechanicsProgramV1 {
        schema_version: er_types::mechanics::MECHANICS_PROGRAM_VERSION,
        id: MechanicsProgramId::new(safe(id)),
        source: MechanicSourceId::numeric(MechanicSourceKind::ActiveAbility, safe(22)),
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
        conditions: Default::default(),
        selectors: Default::default(),
        values: vec![ValueNode::Unsigned { value: 120 }],
        operations: vec![MechanicOperation::Query {
            modifier: QueryModifier::Multiply {
                ratio: ExactRatio::new(3, 2).expect("ratio"),
            },
        }],
        budget: ProgramBudget::ceiling(),
    }
}

fn fixture_move() -> MoveDefinition {
    MoveDefinition {
        id: MoveId::new(safe(1)),
        category: MoveCategory::Physical,
        move_type: PokemonType::Normal,
        power: MovePower::Value(40),
        accuracy: MoveAccuracy::Percent(100),
        base_pp: 35,
        effect_chance: EffectChance::None,
        priority: 0,
        target: MoveTarget::NearOther,
        flags: vec![er_types::battle_model::MoveFlag::Contact],
        effects: vec![er_types::battle_model::MoveEffectDefinition::Damage],
        capability: CapabilityStatus::Supported,
    }
}

fn pack() -> BattleContentPackV2 {
    let mut pack = BattleContentPackV2 {
        schema_version: 2,
        oracle_sha: "328824692f95b1aa1b38af85b54a6b72d9259eb4".to_owned(),
        source_catalog_digest: format!("sha256:{}", "0".repeat(64)),
        content_hash: String::new(),
        species: Vec::new(),
        moves: vec![Some(fixture_move())],
        abilities: Vec::new(),
        held_items: vec![HeldItemDefinitionV2 {
            registry_key: "POTION".to_owned(),
            capability: CapabilityStatus::Supported,
        }],
        programs: vec![Some(program(1))],
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
    pack
}

#[test]
fn valid_pack_round_trips_through_loader() {
    let fixture = pack();
    let bytes = serde_json::to_vec(&fixture).expect("serialize");
    let loaded =
        er_content::pack::m5_pack::load_battle_content_pack_v2(&bytes).expect("valid pack loads");
    assert_eq!(loaded.content_hash, fixture.content_hash);
}

#[test]
fn tampered_content_hash_is_rejected() {
    let mut fixture = pack();
    fixture.content_hash = format!("blake3-v1:{}", "f".repeat(64));
    let bytes = serde_json::to_vec(&fixture).expect("serialize");
    assert!(matches!(
        er_content::pack::m5_pack::load_battle_content_pack_v2(&bytes),
        Err(BattlePackLoadError::ContentHashMismatch { .. })
    ));
}

#[test]
fn program_slot_mismatch_is_rejected() {
    let mut fixture = pack();
    fixture.programs.insert(0, None);
    let bytes = serde_json::to_vec(&fixture).expect("serialize");
    assert!(matches!(
        er_content::pack::m5_pack::load_battle_content_pack_v2(&bytes),
        Err(BattlePackLoadError::ProgramIndex { index: 1, .. })
    ));
}
