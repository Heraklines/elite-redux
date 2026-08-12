#[path = "../src/battle_replica.rs"]
mod battle_replica;

use battle_replica::{
    M3_CONTENT_HASH_MISMATCH, M3_INVALID_AUTHORITY_MATERIAL, M3_MALFORMED_BATTLE_MATERIAL,
    ProtocolViolation, ReplicaApplyError, map_material_apply_error,
};
use er_game::material::{
    BattleMaterialApplyContext, BattleMaterialApplyError, BattleTurnMaterialV1, ContentPack,
    apply_turn_material, decode_replacement_material, decode_turn_material,
};
use serde_json::{Value, json};

const MATERIAL_SOURCE: &str = include_str!("../../er-game/src/material.rs");
const REPLICA_SOURCE: &str = include_str!("../src/battle_replica.rs");
const CONTENT_FIXTURE: &str = include_str!("../../../fixtures/m3/oracle/content-pack-v1.json");
const VICTORY_CASE_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/victory.json");
const CONTROL_FIXTURE: &str =
    include_str!("../../../fixtures/m3/schema/battle-control-plan-v1.json");

fn adapt_legacy_condition_kind(condition: &mut Value) -> Result<(), &'static str> {
    let kind = condition
        .as_object_mut()
        .and_then(|condition| condition.get_mut("kind"))
        .ok_or("condition kind is missing or invalid")?;
    if let Value::String(tag) = kind {
        let tag = tag.clone();
        *kind = json!({"kind": tag});
    }

    let adjacent = kind
        .as_object()
        .ok_or("condition kind is not an adjacent object")?;
    match adjacent.get("kind").and_then(Value::as_str) {
        Some("NONE") if adjacent.len() == 1 => Ok(()),
        Some("UNSUPPORTED_ORACLE_CODE") if adjacent.len() == 2 => {
            let value = adjacent
                .get("value")
                .and_then(Value::as_u64)
                .ok_or("unsupported condition code is not an unsigned integer")?;
            if value > u64::from(u16::MAX) {
                return Err("unsupported condition code exceeds u16");
            }
            Ok(())
        }
        _ => Err("condition kind has unknown, extra, or malformed fields"),
    }
}

fn adapt_legacy_game_state(state: &mut Value) -> Result<(), &'static str> {
    let battle = state
        .get_mut("battle")
        .and_then(Value::as_object_mut)
        .ok_or("battle is missing or invalid")?;

    let format_slots = battle
        .get("format")
        .and_then(Value::as_object)
        .and_then(|format| format.get("slots"))
        .and_then(Value::as_array)
        .ok_or("format.slots is missing or is not an array")?;
    let field_slots = battle
        .get("field")
        .and_then(Value::as_object)
        .and_then(|field| field.get("slots"))
        .and_then(Value::as_array)
        .ok_or("field.slots is missing or is not an array")?;
    if format_slots != field_slots {
        return Err("format.slots does not exactly match field.slots");
    }
    battle
        .get_mut("format")
        .and_then(Value::as_object_mut)
        .and_then(|format| format.remove("slots"))
        .ok_or("format.slots could not be removed")?;

    for party_name in ["player_party", "enemy_party"] {
        let party = battle
            .get_mut(party_name)
            .and_then(Value::as_array_mut)
            .ok_or("party is missing or is not an array")?;
        for pokemon in party {
            let kind = pokemon
                .get_mut("status")
                .and_then(Value::as_object_mut)
                .and_then(|status| status.get_mut("kind"))
                .ok_or("status kind is missing or invalid")?;
            match kind {
                Value::String(_) => {}
                Value::Object(nested) => {
                    if nested.len() != 1 {
                        return Err("nested status kind has extra or missing fields");
                    }
                    let tag = nested
                        .get("kind")
                        .and_then(Value::as_str)
                        .ok_or("nested status kind is not a string")?
                        .to_owned();
                    *kind = Value::String(tag);
                }
                _ => return Err("status kind is neither a string nor an exact kind wrapper"),
            }
        }
    }

    for condition_name in ["weather", "terrain"] {
        let condition = battle
            .get_mut(condition_name)
            .ok_or("condition is missing")?;
        adapt_legacy_condition_kind(condition)?;
    }
    Ok(())
}

#[test]
fn typed_material_codecs_are_closed_and_canonical_only() {
    let unknown = serde_json::to_vec(&json!({"unknown": 1})).expect("JSON value serializes");
    assert!(decode_turn_material(&unknown).is_err());
    assert!(decode_replacement_material(&unknown).is_err());
    assert!(decode_turn_material(br#"{}"#).is_err());
    assert!(decode_replacement_material(br#"{}"#).is_err());

    assert!(MATERIAL_SOURCE.contains("serde(deny_unknown_fields)"));
    assert!(MATERIAL_SOURCE.contains("canonical_bytes(&decoded)? != bytes"));
}

#[test]
fn material_self_digest_failure_precedes_local_state_and_other_tampering() {
    let content_value: serde_json::Value =
        serde_json::from_str(CONTENT_FIXTURE).expect("content fixture is JSON");
    let content: ContentPack = serde_json::from_value(
        content_value
            .get("content_pack")
            .expect("content fixture has content_pack")
            .clone(),
    )
    .expect("content fixture is a typed content pack");
    let case_value: serde_json::Value =
        serde_json::from_str(VICTORY_CASE_FIXTURE).expect("victory fixture is JSON");
    let mut state_value = case_value
        .get("initial_state")
        .and_then(|value| value.get("canonical"))
        .expect("victory fixture has an initial canonical state")
        .clone();
    adapt_legacy_game_state(&mut state_value).expect("legacy initial state adapts strictly");
    let state = serde_json::from_value(state_value.clone()).expect("initial state is typed");
    let next_control =
        serde_json::from_str::<er_types::battle_control::BattleControlPlan>(CONTROL_FIXTURE)
            .expect("control fixture is typed");
    let wrong_digest = format!("blake3-v1:{}", "0".repeat(64));
    let rng_before: er_rng::battle::BattleRngState =
        serde_json::from_value(state_value["battle"]["battle_rng"].clone())
            .expect("battle RNG is typed");
    let material = BattleTurnMaterialV1 {
        schema_version: 1,
        oracle_game_sha: content.oracle_game_sha.clone(),
        content_hash: content.hash.clone(),
        operation_id: serde_json::from_value(json!("battle/1/wave/1/turn/1/result"))
            .expect("operation ID is typed"),
        battle_id: serde_json::from_value(state_value["battle"]["battle_id"].clone())
            .expect("battle ID is typed"),
        wave: serde_json::from_value(state_value["battle"]["wave"].clone()).expect("wave is typed"),
        resolved_turn: serde_json::from_value(state_value["battle"]["turn"].clone())
            .expect("turn is typed"),
        before_digest: serde_json::from_value(json!(wrong_digest.clone()))
            .expect("digest is typed"),
        after_digest: serde_json::from_value(json!(wrong_digest)).expect("digest is typed"),
        commands: serde_json::from_value(json!({"entries": []}))
            .expect("empty command set is typed"),
        action_order: Vec::new(),
        mutations: Vec::new(),
        presentation: Vec::new(),
        presentation_digest: serde_json::from_value(json!(format!("blake3-v1:{}", "0".repeat(64))))
            .expect("presentation digest is typed"),
        rng_before: rng_before.clone(),
        rng_after: rng_before,
        rng_audit: Vec::new(),
        before_state: state.clone(),
        after_state: state.clone(),
        outcome: serde_json::from_value(json!("ONGOING")).expect("outcome is typed"),
        next_decision: serde_json::from_value(json!("COMMAND_FRONTIER"))
            .expect("next decision is typed"),
        menu_allocators_before: next_control.menu_allocators.clone(),
        next_control,
    };
    let context = BattleMaterialApplyContext {
        current_state: state,
        local_seat: material.next_control.seats[0].seat,
        menu_allocators: material.menu_allocators_before.clone(),
    };
    assert_eq!(
        apply_turn_material(&context, &material, &content),
        Err(BattleMaterialApplyError::InvalidMaterialBeforeDigest)
    );
}

#[test]
fn replica_maps_every_common_error_to_the_frozen_class() {
    let cases = [
        (
            BattleMaterialApplyError::MalformedIdentity,
            ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial),
        ),
        (
            BattleMaterialApplyError::SchemaVersionMismatch,
            ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial),
        ),
        (
            BattleMaterialApplyError::OracleIdentityMismatch,
            ReplicaApplyError::ProtocolViolation(ProtocolViolation::MalformedBattleMaterial),
        ),
        (
            BattleMaterialApplyError::ContentHashMismatch,
            ReplicaApplyError::ProtocolViolation(ProtocolViolation::ContentHashMismatch),
        ),
        (
            BattleMaterialApplyError::InvalidMaterialBeforeDigest,
            ReplicaApplyError::InvalidAfterState,
        ),
        (
            BattleMaterialApplyError::LocalBeforeStateMismatch,
            ReplicaApplyError::BeforeDigestMismatch,
        ),
        (
            BattleMaterialApplyError::InvalidEvidence,
            ReplicaApplyError::InvalidAfterState,
        ),
        (
            BattleMaterialApplyError::InvalidAfterState,
            ReplicaApplyError::InvalidAfterState,
        ),
        (
            BattleMaterialApplyError::InvalidControlProjection,
            ReplicaApplyError::InvalidAfterState,
        ),
        (
            BattleMaterialApplyError::MenuAllocatorMismatch,
            ReplicaApplyError::InvalidAfterState,
        ),
        (
            BattleMaterialApplyError::Invariant,
            ReplicaApplyError::Invariant,
        ),
    ];
    for (source, expected) in cases {
        assert_eq!(map_material_apply_error(source), expected);
    }
    assert_eq!(
        M3_CONTENT_HASH_MISMATCH,
        ProtocolViolation::ContentHashMismatch.terminal_reason()
    );
    assert_eq!(
        M3_MALFORMED_BATTLE_MATERIAL,
        ProtocolViolation::MalformedBattleMaterial.terminal_reason()
    );
    assert_eq!(
        M3_INVALID_AUTHORITY_MATERIAL,
        ReplicaApplyError::InvalidAfterState
            .terminal_reason()
            .expect("invalid material terminalizes")
    );
    assert!(ReplicaApplyError::BeforeDigestMismatch.is_recoverable());
    assert!(
        ReplicaApplyError::BeforeDigestMismatch
            .terminal_reason()
            .is_none()
    );
}

#[test]
fn authority_and_replica_are_role_neutral_and_replica_never_resolves() {
    assert!(MATERIAL_SOURCE.contains("pub fn apply_turn_material"));
    assert!(MATERIAL_SOURCE.contains("pub fn apply_replacement_material"));
    assert!(MATERIAL_SOURCE.contains("validate_turn_evidence"));
    assert!(MATERIAL_SOURCE.contains("validate_replacement_evidence"));
    assert!(REPLICA_SOURCE.contains("apply_turn_material(current"));
    assert!(REPLICA_SOURCE.contains("apply_replacement_material(current"));
    assert!(!REPLICA_SOURCE.contains("resolve_turn"));
    assert!(!REPLICA_SOURCE.contains("resolve_replacement"));
}

#[test]
fn turn_partial_frontier_and_replacement_full_equality_guards_are_present() {
    let frontier = MATERIAL_SOURCE
        .find("fn reconcile_turn_frontier")
        .expect("TURN reconciliation exists");
    let next_frontier = MATERIAL_SOURCE
        .find("fn validate_fresh_command_frontier")
        .expect("TURN after-state frontier validation exists");
    let retained = MATERIAL_SOURCE
        .find("fn retained_command")
        .expect("retained command subset guard exists");
    let admitted = MATERIAL_SOURCE
        .find("fn admitted_command")
        .expect("admitted command subset guard exists");
    let replacement = MATERIAL_SOURCE
        .find("if current.current_state != material.before_state")
        .expect("REPLACEMENT requires full before-state equality");
    assert!(frontier < retained && frontier < admitted);
    assert!(replacement < frontier && frontier < next_frontier);
    assert!(MATERIAL_SOURCE.contains("same_frontier_window"));
    assert!(
        MATERIAL_SOURCE.contains("current_command != remote_command")
            || MATERIAL_SOURCE.contains("local_command != remote_command")
    );
    for required in [
        "CommandFrontierStatus::Pending",
        "CommandAdmissionSource::ScriptedEnemy",
        "build_scripted_enemy_offer",
        "validate_next_state_command_collection",
        "project_battle_control_plan",
    ] {
        assert!(
            MATERIAL_SOURCE.contains(required),
            "missing frontier guard {required}"
        );
    }
    assert!(!MATERIAL_SOURCE.contains("fn validate_command_root_menu"));
    assert!(!MATERIAL_SOURCE.contains("fn validate_replacement_menu"));
}

#[test]
fn digest_evidence_presentation_and_state_tampering_are_fail_closed() {
    for required in [
        "verify_material_before_digest",
        "validate_after_state_and_digest",
        "validate_battle_mutation_evidence",
        "compute_presentation_plan_digest",
        "event.event_id.sequence",
        "validate_turn_rng",
        "validate_replacement_rng",
    ] {
        assert!(
            MATERIAL_SOURCE.contains(required),
            "missing guard {required}"
        );
    }
    assert!(
        MATERIAL_SOURCE.contains("BattlePresentationKind::BattleWon")
            && MATERIAL_SOURCE.contains("BattlePresentationKind::BattleLost")
    );
}

#[test]
fn allocator_internal_validation_precedes_endpoint_recovery_classification() {
    let internal = MATERIAL_SOURCE
        .find("validate_allocator_projection(")
        .expect("internal allocator projection exists");
    let endpoint = MATERIAL_SOURCE
        .find("validate_endpoint_allocators(")
        .expect("endpoint allocator comparison exists");
    assert!(internal < endpoint);
    assert!(MATERIAL_SOURCE.contains("MenuAllocatorMismatch"));
    assert!(MATERIAL_SOURCE.contains("LocalBeforeStateMismatch"));
    assert!(MATERIAL_SOURCE.contains("after_id < before_id"));
    assert!(MATERIAL_SOURCE.contains("*id < before_id || *id >= after_id"));
}

#[test]
fn no_legal_replacement_is_validated_as_explicit_material_evidence() {
    assert!(MATERIAL_SOURCE.contains("pub selection: ReplacementSelection"));
    assert!(MATERIAL_SOURCE.contains("validate_replacement_selection("));
    assert!(MATERIAL_SOURCE.contains("build_replacement_offer"));
    assert!(MATERIAL_SOURCE.contains("replacement_offer.is_empty()"));
    assert!(MATERIAL_SOURCE.contains("WaitingReason::ReplacementOwner"));
    assert!(MATERIAL_SOURCE.contains("material.occurrence.id"));
    assert!(MATERIAL_SOURCE.contains("validate_replacement_identity"));
}

#[test]
fn adapter_rejects_non_material_authority_entry_kinds_without_fallback() {
    assert!(!REPLICA_SOURCE.contains("pub fn apply_authority_material_payload"));
    for kind in [
        "AuthorityEntryKind::InteractionCommit",
        "AuthorityEntryKind::ControlCommit",
        "AuthorityEntryKind::WaveAdvance",
        "AuthorityEntryKind::TerminalCommit",
    ] {
        assert!(
            REPLICA_SOURCE.contains(kind),
            "missing closed kind branch {kind}"
        );
    }
    assert!(REPLICA_SOURCE.contains("MalformedBattleMaterial"));
    assert!(!REPLICA_SOURCE.contains("fallback"));
}
