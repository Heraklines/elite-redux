use std::error::Error;

use er_canonical::content_digest;
use er_content::pack::m4_abilities::{SELECTED_M4_ABILITY_IDS, validate_selected_m4_abilities};
use er_content::pack::m4_moves::{
    SELECTED_M4_MOVE_IDS, body_slam_34, hyper_fang_158, quick_attack_98,
    selected_m4_move_definitions, sweet_scent_230, tail_whip_39, validate_selected_m4_moves,
};
use er_content::pack::m4_species::{SELECTED_M4_SPECIES_IDS, validate_selected_m4_species};
use er_content::pack::{
    CapabilityManifest, ContentPack, ContentPackError, M4_ORACLE_GAME_SHA, ORACLE_GAME_SHA,
    SELECTED_SCHEMA_VERSION, selected_capability_manifest, selected_content_pack,
    selected_m4_content_pack,
};
use er_types::battle_ids::{ContentPackHash, MoveId};
use er_types::battle_model::{
    AbilityEffectDefinition, BattleStat, CapabilityStatus, CapabilitySubject, EffectChance,
    MoveAccuracy, MoveCategory, MoveEffectDefinition, MoveFlag, MovePower, MoveTarget, PokemonType,
    StatusKind,
};
use er_types::ids::SafeU53;
use serde_json::Value;

fn move_id(value: u64) -> MoveId {
    match SafeU53::new(value) {
        Ok(value) => MoveId::new(value),
        Err(_) => MoveId::ZERO,
    }
}

fn error(message: &str) -> Box<dyn Error> {
    Box::new(std::io::Error::other(message.to_owned()))
}

fn serialized_m4() -> Result<Value, Box<dyn Error>> {
    Ok(serde_json::to_value(selected_m4_content_pack()?)?)
}

fn moves_array(value: &mut Value) -> Result<&mut Vec<Value>, Box<dyn Error>> {
    value
        .get_mut("moves")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| error("M4 content pack moves were not an array"))
}

fn body_slam_index(moves: &[Value]) -> Result<usize, Box<dyn Error>> {
    moves
        .iter()
        .position(|value| value.get("id") == Some(&Value::from(34_u64)))
        .ok_or_else(|| error("M4 content pack did not contain Body Slam"))
}

#[test]
fn m3_selection_bytes_and_hash_remain_unchanged() -> Result<(), Box<dyn Error>> {
    let first = selected_content_pack()?;
    let first_bytes = serde_json::to_vec(&first)?;
    let m4 = selected_m4_content_pack()?;
    let second = selected_content_pack()?;

    assert_eq!(first, second);
    assert_eq!(first_bytes, serde_json::to_vec(&second)?);
    assert_eq!(first.hash, first.recompute_hash()?);
    assert_eq!(first.moves.len(), SELECTED_M4_MOVE_IDS.len() - 5);
    assert_eq!(first.capability_manifest, selected_capability_manifest());
    assert_ne!(first.hash, m4.hash);
    Ok(())
}

#[test]
fn m4_contains_exact_body_slam_and_new_hash() -> Result<(), Box<dyn Error>> {
    let pack = selected_m4_content_pack()?;
    assert_eq!(pack.schema_version, SELECTED_SCHEMA_VERSION);
    assert_eq!(pack.oracle_game_sha, M4_ORACLE_GAME_SHA);
    assert_eq!(pack.moves, selected_m4_move_definitions());
    assert_eq!(pack.hash, pack.recompute_hash()?);
    assert!(pack.hash.as_str().starts_with(ContentPackHash::PREFIX));
    assert_ne!(pack.hash, selected_content_pack()?.hash);
    validate_selected_m4_moves(&pack.moves)?;
    validate_selected_m4_species(&pack.species)?;
    validate_selected_m4_abilities(&pack.abilities)?;
    assert_eq!(
        pack.abilities
            .iter()
            .map(|ability| ability.id.get().get())
            .collect::<Vec<_>>(),
        SELECTED_M4_ABILITY_IDS
    );
    assert_eq!(
        pack.species
            .iter()
            .map(|species| species.id.get().get())
            .collect::<Vec<_>>(),
        SELECTED_M4_SPECIES_IDS
    );

    let body = pack
        .moves
        .iter()
        .find(|definition| definition.id == move_id(34))
        .ok_or_else(|| error("Body Slam 34 was absent"))?;
    assert_eq!(body, &body_slam_34());
    assert_eq!(body.category, MoveCategory::Physical);
    assert_eq!(body.move_type, PokemonType::Normal);
    assert_eq!(body.power, MovePower::Value(85));
    assert_eq!(body.accuracy, MoveAccuracy::Percent(100));
    assert_eq!(body.base_pp, 15);
    assert_eq!(body.effect_chance, EffectChance::Percent(30));
    assert_eq!(body.priority, 0);
    assert_eq!(body.target, MoveTarget::NearOther);
    assert_eq!(body.flags, vec![MoveFlag::Contact]);
    assert_eq!(
        body.effects,
        vec![
            MoveEffectDefinition::Damage,
            MoveEffectDefinition::ApplyStatus(StatusKind::Paralysis),
        ]
    );
    assert_eq!(body.capability, CapabilityStatus::Supported);
    assert_eq!(
        pack.moves
            .iter()
            .find(|definition| definition.id == move_id(39)),
        Some(&tail_whip_39())
    );
    assert_eq!(
        pack.moves
            .iter()
            .find(|definition| definition.id == move_id(98)),
        Some(&quick_attack_98())
    );
    assert_eq!(
        pack.moves
            .iter()
            .find(|definition| definition.id == move_id(158)),
        Some(&hyper_fang_158())
    );
    assert_eq!(
        hyper_fang_158().effects,
        vec![MoveEffectDefinition::Damage, MoveEffectDefinition::Flinch]
    );
    assert_eq!(
        pack.moves
            .iter()
            .find(|definition| definition.id == move_id(230)),
        Some(&sweet_scent_230())
    );
    assert_eq!(
        sweet_scent_230().effects,
        vec![MoveEffectDefinition::ChangeStatStage {
            stat: BattleStat::Evasion,
            delta: -2,
        }]
    );
    assert_eq!(
        pack.abilities
            .iter()
            .find(|definition| definition.id.get().get() == 165)
            .map(|definition| definition.effect),
        Some(AbilityEffectDefinition::MentalEffectImmunity)
    );

    let capability = pack
        .capability_manifest
        .find(&CapabilitySubject::Move(move_id(34)))
        .ok_or_else(|| error("Body Slam capability was absent"))?;
    assert_eq!(
        capability.required_positive_cases,
        vec!["physical-hit", "paralysis-application"]
    );
    assert_eq!(
        capability.required_edge_cases,
        vec!["always-hit", "paralysis-full-stop", "paralysis-speed-order"]
    );

    let mut preimage = serde_json::to_value(&pack)?;
    let object = preimage
        .as_object_mut()
        .ok_or_else(|| error("M4 content pack did not serialize as an object"))?;
    let stored_hash = object
        .remove("hash")
        .ok_or_else(|| error("M4 content pack hash was absent"))?;
    assert_eq!(stored_hash, serde_json::to_value(&pack.hash)?);
    let raw_hash = pack
        .hash
        .as_str()
        .strip_prefix(ContentPackHash::PREFIX)
        .ok_or_else(|| error("M4 hash prefix was absent"))?;
    assert_eq!(content_digest(&preimage)?, raw_hash);
    Ok(())
}

#[test]
fn m4_constructor_and_deserializer_reject_cross_oracle_inputs() -> Result<(), Box<dyn Error>> {
    let pack = selected_m4_content_pack()?;
    let m3_constructor = ContentPack::new(
        SELECTED_SCHEMA_VERSION,
        M4_ORACLE_GAME_SHA.to_owned(),
        pack.species.clone(),
        pack.moves.clone(),
        pack.abilities.clone(),
        pack.type_chart.clone(),
        pack.capability_manifest.clone(),
    );
    assert!(matches!(
        m3_constructor,
        Err(ContentPackError::OracleGameShaMismatch { .. })
    ));

    let mut unknown_oracle = serialized_m4()?;
    unknown_oracle["oracle_game_sha"] = Value::from("unknown-oracle");
    assert!(serde_json::from_value::<ContentPack>(unknown_oracle).is_err());

    let mut mismatched_manifest = serialized_m4()?;
    mismatched_manifest["capability_manifest"]["oracle_game_sha"] = Value::from(ORACLE_GAME_SHA);
    assert!(serde_json::from_value::<ContentPack>(mismatched_manifest).is_err());

    let mut missing_body = serialized_m4()?;
    let missing_moves = moves_array(&mut missing_body)?;
    let index = body_slam_index(missing_moves)?;
    missing_moves.remove(index);
    assert!(serde_json::from_value::<ContentPack>(missing_body).is_err());

    let mut duplicate_body = serialized_m4()?;
    let duplicate_moves = moves_array(&mut duplicate_body)?;
    let index = body_slam_index(duplicate_moves)?;
    let body = duplicate_moves[index].clone();
    duplicate_moves.insert(index, body);
    assert!(serde_json::from_value::<ContentPack>(duplicate_body).is_err());

    let mut unsorted_body = serialized_m4()?;
    let unsorted_moves = moves_array(&mut unsorted_body)?;
    let index = body_slam_index(unsorted_moves)?;
    unsorted_moves.swap(index - 1, index);
    assert!(serde_json::from_value::<ContentPack>(unsorted_body).is_err());

    let mut hash_drift = serialized_m4()?;
    hash_drift["hash"] = Value::from(format!("{}{}", ContentPackHash::PREFIX, "0".repeat(64)));
    assert!(serde_json::from_value::<ContentPack>(hash_drift).is_err());
    let mut external_tag_state = serialized_m4()?;
    let tag_moves = moves_array(&mut external_tag_state)?;
    let tag_index = body_slam_index(tag_moves)?;
    let tag_effects = tag_moves[tag_index]
        .get_mut("effects")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| error("Body Slam effects were not an array"))?;
    tag_effects.push(serde_json::json!({
        "kind": "HITS_TAG_FOR_DOUBLE_DAMAGE",
        "value": "MINIMIZED",
    }));
    assert!(serde_json::from_value::<ContentPack>(external_tag_state).is_err());
    Ok(())
}

#[test]
fn m4_capability_manifest_stays_exact_and_m3_constructor_stays_strict() -> Result<(), Box<dyn Error>>
{
    let m4 = selected_m4_content_pack()?;
    m4.capability_manifest.validate()?;
    assert_eq!(m4.capability_manifest.oracle_game_sha, M4_ORACLE_GAME_SHA);
    assert!(
        CapabilityManifest::new(
            SELECTED_SCHEMA_VERSION,
            M4_ORACLE_GAME_SHA.to_owned(),
            m4.capability_manifest.entries.clone(),
        )
        .is_err()
    );
    Ok(())
}
