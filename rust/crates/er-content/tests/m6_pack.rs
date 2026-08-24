use er_content::pack::m6_pack::{
    BattleContentPackV3, BehaviorClassificationEntryV2, BehaviorClassificationManifestV2,
    BespokeManifestV2, FieldContentV1, M6PackLoadError, load_battle_content_pack_v3,
};
use er_mechanics::condition_v2::{ConditionArenaV2, ValueArenaV2};
use er_mechanics::m6::ProgramBudgetV2;
use er_mechanics::selector_operation_v2::{MechanicOperationV2, SelectorArenaV2};
use er_mechanics::{HookBindingV2, MechanicHookV2, MechanicsProgramV2, ProgramRange};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BattleContentPackHashV3, BehaviorClassificationKindV2, BehaviorSourceId, BehaviorUnitId,
    BehaviorUnitKind, BehaviorUnitOrdinal, CatalogHash, M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
    M6_MECHANICS_PROGRAM_VERSION, OracleSha, ProvenanceHash, SafeU53,
};

fn unit() -> BehaviorUnitId {
    BehaviorUnitId {
        source: BehaviorSourceId::Move {
            numeric_id: SafeU53::new(1).expect("fixture must be valid"),
        },
        unit_kind: BehaviorUnitKind::IntrinsicMoveRule,
        ordinal: BehaviorUnitOrdinal::ZERO,
        provenance_hash: ProvenanceHash::parse("0".repeat(64)).expect("fixture must be valid"),
    }
}

fn program() -> MechanicsProgramV2 {
    let unit = unit();
    MechanicsProgramV2 {
        schema_version: M6_MECHANICS_PROGRAM_VERSION,
        id: MechanicsProgramId::try_from_u64(1).expect("fixture must be valid"),
        source: unit.source.clone(),
        behavior_units: vec![unit.clone()],
        bindings: vec![HookBindingV2 {
            hook: MechanicHookV2::BeforeMove,
            authored_priority: 0,
            binding_ordinal: 0,
            behavior_unit: unit,
            condition_root: None,
            selector_root: None,
            operations: ProgramRange {
                start: 0,
                length: 1,
            },
        }],
        conditions: ConditionArenaV2::default(),
        selectors: SelectorArenaV2::default(),
        values: ValueArenaV2::default(),
        operations: vec![MechanicOperationV2::StatusApply],
        scheduled_events: Vec::new(),
        rng_sites: Vec::new(),
        budget: ProgramBudgetV2 {
            hook_bindings: 1,
            condition_nodes: 0,
            selector_nodes: 0,
            value_nodes: 0,
            operations: 1,
            scheduled_events: 0,
            rng_draws: 0,
            spawned_instances: 0,
            presentation_cues: 0,
            selected_targets: 0,
        },
    }
}

fn pack() -> BattleContentPackV3 {
    let mut pack = BattleContentPackV3 {
        schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: OracleSha::parse("3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7")
            .expect("fixture must be valid"),
        raw_catalog_hash: CatalogHash::parse("1".repeat(64)).expect("fixture must be valid"),
        semantic_catalog_hash: CatalogHash::parse("2".repeat(64)).expect("fixture must be valid"),
        content_hash: BattleContentPackHashV3::parse(format!(
            "{}{}",
            BattleContentPackHashV3::PREFIX,
            "0".repeat(64)
        ))
        .expect("fixture must be valid"),
        species: Vec::new(),
        forms: Vec::new(),
        moves: Vec::new(),
        abilities: Vec::new(),
        held_items: Vec::new(),
        field_content: FieldContentV1::default(),
        programs: vec![None, Some(program())],
        classifications: BehaviorClassificationManifestV2(vec![BehaviorClassificationEntryV2 {
            behavior_unit: unit(),
            kind: BehaviorClassificationKindV2::Compiled,
            programs: vec![MechanicsProgramId::try_from_u64(1).expect("valid fixture program ID")],
            bespoke: None,
            unsupported_reason: None,
        }]),
        bespoke: BespokeManifestV2::default(),
        rng_sites: Vec::new(),
        type_chart: er_content::pack::selected_type_chart(),
    };
    pack.content_hash = pack.compute_content_hash().expect("fixture must be valid");
    pack
}

#[test]
fn valid_v3_pack_round_trips_through_loader() {
    let fixture = pack();
    let bytes = serde_json::to_vec(&fixture).expect("fixture must be valid");
    let loaded = load_battle_content_pack_v3(&bytes).expect("fixture must be valid");
    assert_eq!(loaded.content_hash, fixture.content_hash);
}

#[test]
fn unknown_pack_field_fails_closed() {
    let mut value = serde_json::to_value(pack()).expect("fixture must be valid");
    value
        .as_object_mut()
        .expect("fixture must be valid")
        .insert("callback".to_owned(), serde_json::json!("runTs"));
    let bytes = serde_json::to_vec(&value).expect("fixture must be valid");
    assert!(matches!(
        load_battle_content_pack_v3(&bytes),
        Err(M6PackLoadError::Json(_))
    ));
}

#[test]
fn unclassified_program_behavior_unit_fails_closed() {
    let mut fixture = pack();
    fixture.classifications.0.clear();
    fixture.content_hash = fixture
        .compute_content_hash()
        .expect("fixture must be valid");
    assert!(matches!(
        fixture.validate(),
        Err(M6PackLoadError::UnclassifiedProgramBehaviorUnit { .. })
    ));
}

#[test]
fn tampered_content_hash_is_rejected() {
    let mut fixture = pack();
    fixture.content_hash = BattleContentPackHashV3::parse(format!(
        "{}{}",
        BattleContentPackHashV3::PREFIX,
        "f".repeat(64)
    ))
    .expect("fixture must be valid");
    assert!(matches!(
        fixture.validate(),
        Err(M6PackLoadError::ContentHashMismatch { .. })
    ));
}
