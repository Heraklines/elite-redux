use std::error::Error;

use er_mechanics::MechanicStatePayload;
use er_state::mechanic_state::MechanicInstanceStateV1;
use er_state::migration::M4_ORACLE_SHA;
use er_state::migration_v3::{GameStateV3, migrate_game_v2_to_v3};
use er_state::migration_v4::{
    InstanceMigrationBindingV1, M5ToM6MigrationContext, migrate_m5_to_m6,
};
use er_testkit::m4_fixture::assemble_game_state;
use er_types::battle_ids::ContentPackHash;
use er_types::mechanics::{
    MechanicAddress, MechanicInstanceId, MechanicScope, MechanicSourceId, MechanicSourceKind,
    MechanicsProgramId, SourceOrdinal,
};
use er_types::run_ids::RunContentPackHash;
use er_types::{
    BattleContentPackHashV3, BehaviorSourceId, BehaviorUnitId, BehaviorUnitKind,
    BehaviorUnitOrdinal, CatalogHash, ProvenanceHash, SafeU53,
};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("valid fixture safe integer")
}

fn hash_v1(fill: char) -> String {
    format!("blake3-v1:{}", fill.to_string().repeat(64))
}

fn migrated_state() -> Result<GameStateV3, Box<dyn Error>> {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../fixtures/m4/oracle/run-segments/classic-composed-wave-9-through-11-v1.json"
    ))?;
    let v2 = assemble_game_state(
        &fixture,
        ContentPackHash::new(hash_v1('a'))?,
        RunContentPackHash::new(hash_v1('b'))?,
        M4_ORACLE_SHA,
    )?;
    Ok(migrate_game_v2_to_v3(&v2, hash_v1('c'))?.0)
}

fn target_hash() -> BattleContentPackHashV3 {
    BattleContentPackHashV3::parse(format!(
        "{}{}",
        BattleContentPackHashV3::PREFIX,
        "d".repeat(64)
    ))
    .expect("valid fixture target hash")
}

fn semantic_hash() -> CatalogHash {
    CatalogHash::parse("e".repeat(64)).expect("valid fixture semantic hash")
}

fn empty_context() -> M5ToM6MigrationContext {
    M5ToM6MigrationContext {
        source_content_hash_v2: hash_v1('c'),
        target_content_hash_v3: target_hash(),
        semantic_catalog_hash: semantic_hash(),
        bindings: Vec::new(),
        target_programs: Vec::new(),
        target_behavior_units: Vec::new(),
        held_item_registry_keys: Vec::new(),
    }
}

fn unit() -> BehaviorUnitId {
    BehaviorUnitId {
        source: BehaviorSourceId::Move {
            numeric_id: safe(1),
        },
        unit_kind: BehaviorUnitKind::IntrinsicMoveRule,
        ordinal: BehaviorUnitOrdinal::ZERO,
        provenance_hash: ProvenanceHash::parse("0".repeat(64)).expect("valid fixture provenance"),
    }
}

#[test]
fn empty_m5_state_migrates_without_rng_or_state_loss() -> Result<(), Box<dyn Error>> {
    let v3 = migrated_state()?;
    let context = empty_context();
    let (v4, evidence) = migrate_m5_to_m6(&v3, &context)?;
    assert_eq!(v4.base, v3.base);
    assert_eq!(v4.battle_content_hash_v3, context.target_content_hash_v3);
    assert_eq!(v4.semantic_catalog_hash, context.semantic_catalog_hash);
    assert_eq!(evidence.rng_draws, 0);
    assert_eq!(evidence.migrated_instances, 0);
    assert_eq!(v4.pokemon_extensions.len(), v3.pokemon_extensions.len());
    v4.validate_against(&context)?;
    Ok(())
}

#[test]
fn populated_instance_requires_exact_program_behavior_binding() -> Result<(), Box<dyn Error>> {
    let mut v3 = migrated_state()?;
    let extension = v3
        .pokemon_extensions
        .first_mut()
        .ok_or("fixture has no Pokémon extension")?;
    let pokemon = extension.pokemon_id;
    let source = MechanicSourceId::numeric(MechanicSourceKind::Move, safe(1));
    extension.mechanics.next_instance_id = MechanicInstanceId::new(safe(2));
    extension.mechanics.next_creation_ordinal = safe(2);
    extension.mechanics.instances.push(MechanicInstanceStateV1 {
        address: MechanicAddress {
            scope: MechanicScope::Pokemon { pokemon },
            source: source.clone(),
            source_ordinal: SourceOrdinal::ZERO,
            instance_id: MechanicInstanceId::new(safe(1)),
        },
        program_id: MechanicsProgramId::try_from_u64(1)?,
        owner: MechanicScope::Pokemon { pokemon },
        stored_target: None,
        creation_ordinal: safe(1),
        remaining_turns: Some(2),
        counters: Vec::new(),
        payload: MechanicStatePayload::Empty,
    });
    v3.validate()?;

    let behavior_unit = unit();
    let mut context = empty_context();
    context.bindings.push(InstanceMigrationBindingV1 {
        source,
        old_program_id: MechanicsProgramId::try_from_u64(1)?,
        new_program_id: MechanicsProgramId::try_from_u64(2)?,
        behavior_unit: behavior_unit.clone(),
    });
    context
        .target_programs
        .push(MechanicsProgramId::try_from_u64(2)?);
    context.target_behavior_units.push(behavior_unit.clone());

    let (v4, evidence) = migrate_m5_to_m6(&v3, &context)?;
    assert_eq!(evidence.migrated_instances, 1);
    let migrated = &v4.pokemon_extensions[0].mechanics.instances[0];
    assert_eq!(
        migrated.address,
        v3.pokemon_extensions[0].mechanics.instances[0].address
    );
    assert_eq!(migrated.creation_ordinal, safe(1));
    assert_eq!(migrated.program_id, MechanicsProgramId::try_from_u64(2)?);
    assert_eq!(migrated.source_behavior_unit, behavior_unit);
    Ok(())
}

#[test]
fn missing_live_instance_binding_fails_closed() -> Result<(), Box<dyn Error>> {
    let mut v3 = migrated_state()?;
    let extension = v3
        .pokemon_extensions
        .first_mut()
        .ok_or("fixture has no Pokémon extension")?;
    let pokemon = extension.pokemon_id;
    extension.mechanics.next_instance_id = MechanicInstanceId::new(safe(2));
    extension.mechanics.next_creation_ordinal = safe(2);
    extension.mechanics.instances.push(MechanicInstanceStateV1 {
        address: MechanicAddress {
            scope: MechanicScope::Pokemon { pokemon },
            source: MechanicSourceId::numeric(MechanicSourceKind::Move, safe(1)),
            source_ordinal: SourceOrdinal::ZERO,
            instance_id: MechanicInstanceId::new(safe(1)),
        },
        program_id: MechanicsProgramId::try_from_u64(1)?,
        owner: MechanicScope::Pokemon { pokemon },
        stored_target: None,
        creation_ordinal: safe(1),
        remaining_turns: None,
        counters: Vec::new(),
        payload: MechanicStatePayload::Empty,
    });
    v3.validate()?;
    let error = migrate_m5_to_m6(&v3, &empty_context())
        .expect_err("missing instance binding must abort migration");
    assert!(error.to_string().contains("migration cannot lose"));
    Ok(())
}
