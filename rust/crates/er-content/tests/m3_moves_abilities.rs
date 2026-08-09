use er_content::abilities::{
    AbilityDefinition, AbilityDefinitionError, AbilityLookupError, selected_ability_definitions,
    validate_selected_abilities,
};
use er_content::moves::{
    MoveDefinition, MoveDefinitionError, MoveLookupError, find_move, lookup_move,
    selected_move_definitions, validate_selected_moves,
};
use er_types::battle_ids::{AbilityId, MoveId};
use er_types::battle_model::{
    AbilityEffectDefinition, BattleStat, CapabilityStatus, EffectChance, MoveAccuracy,
    MoveEffectDefinition, MoveFlag, MovePower, PokemonType, StatusKind, UnsupportedReasonCode,
};
use er_types::ids::SafeU53;

fn move_id(value: u64) -> MoveId {
    MoveId::new(SafeU53::new(value).unwrap_or(SafeU53::ZERO))
}

fn ability_id(value: u64) -> AbilityId {
    AbilityId::new(SafeU53::new(value).unwrap_or(SafeU53::ZERO))
}

#[test]
fn selected_moves_match_the_manifest_and_are_canonically_ordered() {
    let definitions = selected_move_definitions();
    assert!(validate_selected_moves(&definitions).is_ok());
    let ids: Vec<u64> = definitions
        .iter()
        .map(|definition| u64::from(definition.id))
        .collect();
    assert_eq!(ids, vec![1, 52, 77, 78, 351, 589]);

    assert_eq!(
        definitions[0].category,
        er_types::battle_model::MoveCategory::Physical
    );
    assert_eq!(definitions[0].move_type, PokemonType::Normal);
    assert_eq!(definitions[0].power, MovePower::Value(40));
    assert_eq!(definitions[0].accuracy, MoveAccuracy::Percent(100));
    assert_eq!(definitions[0].base_pp, 35);
    assert_eq!(definitions[0].flags, vec![MoveFlag::Contact]);
    assert_eq!(definitions[0].effects, vec![MoveEffectDefinition::Damage]);

    assert_eq!(definitions[1].move_type, PokemonType::Fire);
    assert_eq!(definitions[1].power, MovePower::Value(20));
    assert_eq!(definitions[1].effect_chance, EffectChance::Percent(100));
    assert_eq!(
        definitions[1].effects,
        vec![
            MoveEffectDefinition::Damage,
            MoveEffectDefinition::ApplyStatus(StatusKind::Burn),
        ]
    );

    assert_eq!(definitions[2].accuracy, MoveAccuracy::Percent(75));
    assert_eq!(
        definitions[2].flags,
        vec![MoveFlag::Powder, MoveFlag::Reflectable]
    );
    assert_eq!(
        definitions[2].effects,
        vec![MoveEffectDefinition::ApplyStatus(StatusKind::Poison)]
    );

    assert_eq!(definitions[3].move_type, PokemonType::Grass);
    assert_eq!(
        definitions[3].effects,
        vec![MoveEffectDefinition::ApplyStatus(StatusKind::Paralysis)]
    );

    assert_eq!(definitions[4].accuracy, MoveAccuracy::AlwaysHits);
    assert_eq!(definitions[4].priority, 2);
    assert!(definitions[4].flags.is_empty());

    assert_eq!(
        definitions[5].target,
        er_types::battle_model::MoveTarget::AllNearEnemies
    );
    assert_eq!(definitions[5].accuracy, MoveAccuracy::AlwaysHits);
    assert_eq!(
        definitions[5].flags,
        vec![MoveFlag::IgnoreSubstitute, MoveFlag::Reflectable]
    );
    assert_eq!(
        definitions[5].effects,
        vec![MoveEffectDefinition::ChangeStatStage {
            stat: BattleStat::Attack,
            delta: -1,
        }]
    );
}

#[test]
fn selected_abilities_match_the_manifest_and_are_canonically_ordered() {
    let definitions = selected_ability_definitions();
    assert!(validate_selected_abilities(&definitions).is_ok());
    let ids: Vec<u64> = definitions
        .iter()
        .map(|definition| u64::from(definition.id))
        .collect();
    assert_eq!(ids, vec![0, 22, 25]);
    assert_eq!(definitions[0].effect, AbilityEffectDefinition::None);
    assert_eq!(
        definitions[1].effect,
        AbilityEffectDefinition::PostSummonAdjacentOpponentAttackMinusOne
    );
    assert_eq!(
        definitions[2].effect,
        AbilityEffectDefinition::NonSuperEffectiveAttackImmunity
    );
}

#[test]
fn lookups_are_deterministic_and_reject_outside_content() {
    let definitions = selected_move_definitions();
    let found = find_move(&definitions, move_id(351));
    assert_eq!(
        found.ok().map(|definition| u64::from(definition.id)),
        Some(351)
    );
    assert!(matches!(
        lookup_move(move_id(408)),
        Err(MoveLookupError::UnsupportedId { id }) if id == move_id(408)
    ));

    let ability_definitions = selected_ability_definitions();
    let found = er_content::abilities::find_ability(&ability_definitions, ability_id(25));
    assert_eq!(
        found.ok().map(|definition| u64::from(definition.id)),
        Some(25)
    );
    assert!(matches!(
        er_content::abilities::lookup_ability(ability_id(18)),
        Err(AbilityLookupError::UnsupportedId { id }) if id == ability_id(18)
    ));
}

#[test]
fn move_validation_rejects_bad_ranges_effects_flags_and_capability() {
    let mut definition = selected_move_definitions()[0].clone();
    definition.base_pp = 0;
    assert!(matches!(
        definition.validate(),
        Err(MoveDefinitionError::InvalidBasePp { .. })
    ));

    let mut definition = selected_move_definitions()[0].clone();
    definition.accuracy = MoveAccuracy::Percent(0);
    assert!(matches!(
        definition.validate(),
        Err(MoveDefinitionError::InvalidAccuracy { .. })
    ));

    let mut definition = selected_move_definitions()[1].clone();
    definition.effect_chance = EffectChance::Percent(101);
    assert!(matches!(
        definition.validate(),
        Err(MoveDefinitionError::InvalidEffectChance { .. })
    ));

    let mut definition = selected_move_definitions()[2].clone();
    definition.effects = vec![MoveEffectDefinition::ApplyStatus(StatusKind::Toxic)];
    assert!(matches!(
        definition.validate(),
        Err(MoveDefinitionError::UnsupportedStatus {
            status: StatusKind::Toxic,
            ..
        })
    ));

    let mut definition = selected_move_definitions()[0].clone();
    definition.flags = vec![MoveFlag::Contact, MoveFlag::Contact];
    assert!(matches!(
        definition.validate(),
        Err(MoveDefinitionError::DuplicateFlag { .. })
    ));

    let mut definition = selected_move_definitions()[0].clone();
    definition.id = move_id(408);
    assert!(matches!(
        definition.validate(),
        Err(MoveDefinitionError::UnsupportedId { .. })
    ));

    let mut definition = selected_move_definitions()[0].clone();
    definition.capability = CapabilityStatus::Unsupported {
        reason_code: UnsupportedReasonCode::CallbackOrScriptRequired,
    };
    assert!(matches!(
        definition.validate(),
        Err(MoveDefinitionError::UnsupportedCapability { .. })
    ));

    let mut definition = selected_move_definitions()[2].clone();
    definition.power = MovePower::Value(1);
    assert!(matches!(
        definition.validate(),
        Err(MoveDefinitionError::StatusMoveHasPower { .. })
    ));

    let mut definition = selected_move_definitions()[0].clone();
    definition.power = MovePower::None;
    assert!(matches!(
        definition.validate(),
        Err(MoveDefinitionError::DamagingMoveHasNoPower { .. })
    ));

    let mut definition = selected_move_definitions()[0].clone();
    definition.power = MovePower::Value(0);
    assert!(matches!(
        definition.validate(),
        Err(MoveDefinitionError::InvalidPower { .. })
    ));
}

#[test]
fn ability_validation_rejects_unknown_ids_and_unsupported_capability() {
    let mut definition = selected_ability_definitions()[0].clone();
    definition.id = ability_id(18);
    assert!(matches!(
        definition.validate(),
        Err(AbilityDefinitionError::UnsupportedId { .. })
    ));

    let mut definition = selected_ability_definitions()[1].clone();
    definition.capability = CapabilityStatus::Unsupported {
        reason_code: UnsupportedReasonCode::DynamicSuppressionUnsupported,
    };
    assert!(matches!(
        definition.validate(),
        Err(AbilityDefinitionError::UnsupportedCapability { .. })
    ));
}

#[test]
fn move_serialization_round_trips_and_rejects_unknown_fields() {
    let definition = selected_move_definitions()[0].clone();
    let encoded = serde_json::to_string(&definition);
    assert!(encoded.is_ok());
    if let Ok(encoded) = encoded {
        let decoded = serde_json::from_str::<MoveDefinition>(&encoded);
        assert_eq!(decoded.ok(), Some(definition));
    }

    let with_unknown_field = r#"{
        "id": 1,
        "category": "PHYSICAL",
        "move_type": "NORMAL",
        "power": {"kind": "VALUE", "value": 40},
        "accuracy": {"kind": "PERCENT", "value": 100},
        "base_pp": 35,
        "effect_chance": {"kind": "NONE"},
        "priority": 0,
        "target": "NEAR_OTHER",
        "flags": ["CONTACT"],
        "effects": [{"kind": "DAMAGE"}],
        "capability": {"kind": "SUPPORTED"},
        "extra": true
    }"#;
    assert!(serde_json::from_str::<MoveDefinition>(with_unknown_field).is_err());
}

#[test]
fn ability_serialization_round_trips_and_rejects_unknown_fields() {
    let definition = selected_ability_definitions()[2].clone();
    let encoded = serde_json::to_string(&definition);
    assert!(encoded.is_ok());
    if let Ok(encoded) = encoded {
        let decoded = serde_json::from_str::<AbilityDefinition>(&encoded);
        assert_eq!(decoded.ok(), Some(definition));
    }

    let with_unknown_field = r#"{
        "id": 25,
        "effect": {"kind": "NON_SUPER_EFFECTIVE_ATTACK_IMMUNITY"},
        "capability": {"kind": "SUPPORTED"},
        "extra": true
    }"#;
    assert!(serde_json::from_str::<AbilityDefinition>(with_unknown_field).is_err());
}
