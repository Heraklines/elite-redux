use std::collections::BTreeSet;
use std::error::Error;

use er_canonical::{canonicalize, canonicalize_value};
use er_content::pack::{SELECTED_SCHEMA_VERSION, selected_content_pack};
use er_rng::audit::{RngCallsiteId, RngReason};
use er_rng::battle::RngRuntime;
use er_state::battle::BATTLE_STATE_SCHEMA_VERSION;
use er_types::SafeU53;
use er_types::battle_command::{
    BATTLE_COMMAND_SCHEMA_VERSION, BATTLE_REPLACEMENT_PROPOSAL_SCHEMA_VERSION,
};
use er_types::battle_control::BATTLE_CONTROL_PLAN_SCHEMA_VERSION;
use er_wasm::m3_schema::{M3_SCHEMA_PARITY_VERSION, M3_SCHEMA_TYPES, round_trip_m3_schema_json};
use serde_json::Value;

const MANIFEST: &str = include_str!("../../../fixtures/m3/schema/manifest-v1.json");
const F64_BITS: &str = include_str!("../../../fixtures/m3/schema/f64-bits-v1.json");
const PHASER_RDG_STATE: &str = include_str!("../../../fixtures/m3/schema/phaser-rdg-state-v1.json");
const INVALID_PHASER_RDG_STATE: &str =
    include_str!("../../../fixtures/m3/schema/phaser-rdg-state-mismatch-v1.json");
const GAME_STATE: &str = include_str!("../../../fixtures/m3/schema/game-state-active-v1.json");
const BATTLE_COMMAND_OFFER: &str =
    include_str!("../../../fixtures/m3/schema/battle-command-offer-v1.json");
const BATTLE_COMMAND_PROPOSAL: &str =
    include_str!("../../../fixtures/m3/schema/battle-command-proposal-v1.json");
const BATTLE_REPLACEMENT_PROPOSAL: &str =
    include_str!("../../../fixtures/m3/schema/battle-replacement-proposal-v1.json");
const SCRIPTED_ENEMY_POLICY: &str =
    include_str!("../../../fixtures/m3/schema/scripted-enemy-policy-v1.json");
const BATTLE_CONTROL_PLAN: &str =
    include_str!("../../../fixtures/m3/schema/battle-control-plan-v1.json");
const BATTLE_UI_PROJECTION: &str =
    include_str!("../../../fixtures/m3/schema/battle-ui-projection-v1.json");
const BATTLE_PRESENTATION_EVENT: &str =
    include_str!("../../../fixtures/m3/schema/battle-presentation-event-v1.json");

const FIXED_VECTORS: &[(&str, &str, &str)] = &[
    (
        "BattleCommandOffer",
        "battle-command-offer-v1.json",
        BATTLE_COMMAND_OFFER,
    ),
    (
        "BattleCommandProposalV1",
        "battle-command-proposal-v1.json",
        BATTLE_COMMAND_PROPOSAL,
    ),
    (
        "BattleControlPlan",
        "battle-control-plan-v1.json",
        BATTLE_CONTROL_PLAN,
    ),
    (
        "BattlePresentationEvent",
        "battle-presentation-event-v1.json",
        BATTLE_PRESENTATION_EVENT,
    ),
    (
        "BattleReplacementProposalV1",
        "battle-replacement-proposal-v1.json",
        BATTLE_REPLACEMENT_PROPOSAL,
    ),
    (
        "BattleUiProjection",
        "battle-ui-projection-v1.json",
        BATTLE_UI_PROJECTION,
    ),
    ("F64Bits", "f64-bits-v1.json", F64_BITS),
    ("GameState", "game-state-active-v1.json", GAME_STATE),
    (
        "PhaserRdgState",
        "phaser-rdg-state-v1.json",
        PHASER_RDG_STATE,
    ),
    (
        "ScriptedEnemyPolicyV1",
        "scripted-enemy-policy-v1.json",
        SCRIPTED_ENEMY_POLICY,
    ),
];

fn fixture_text(input: &str) -> &str {
    input.trim_end_matches(['\r', '\n'])
}

fn assert_schema_value(
    schema: &'static str,
    value: &Value,
    covered: &mut BTreeSet<&'static str>,
) -> Result<(), Box<dyn Error>> {
    let input = serde_json::to_string(value)?;
    let expected = canonicalize_value(value)?;
    assert_eq!(
        round_trip_m3_schema_json(schema, &input)?,
        expected,
        "nested {schema} schema changed"
    );
    covered.insert(schema);
    Ok(())
}

fn assert_manifest() -> Result<(), Box<dyn Error>> {
    let manifest: Value = serde_json::from_str(MANIFEST)?;
    assert_eq!(
        manifest["schema_fixture_version"].as_u64(),
        Some(u64::from(M3_SCHEMA_PARITY_VERSION))
    );
    assert_eq!(
        manifest["oracle_game_sha"].as_str(),
        Some("3b534099919efae827019d4a3f3c4ab0ecd6d67b")
    );
    let versions = &manifest["contract_versions"];
    assert_eq!(
        versions["battle_control_plan_version"].as_u64(),
        Some(u64::from(BATTLE_CONTROL_PLAN_SCHEMA_VERSION))
    );
    assert_eq!(
        versions["battle_state_schema_version"].as_u64(),
        Some(u64::from(BATTLE_STATE_SCHEMA_VERSION))
    );
    assert_eq!(
        versions["command_proposal_version"].as_u64(),
        Some(u64::from(BATTLE_COMMAND_SCHEMA_VERSION))
    );
    assert_eq!(
        versions["content_pack_schema_version"].as_u64(),
        Some(u64::from(SELECTED_SCHEMA_VERSION))
    );
    assert_eq!(
        versions["replacement_proposal_version"].as_u64(),
        Some(u64::from(BATTLE_REPLACEMENT_PROPOSAL_SCHEMA_VERSION))
    );
    assert_eq!(versions["rng_algorithm_version"].as_u64(), Some(1));
    assert_eq!(canonicalize_value(&manifest)?, fixture_text(MANIFEST));

    let vectors = manifest["vectors"]
        .as_array()
        .ok_or("schema manifest vectors must be an array")?;
    assert_eq!(vectors.len(), FIXED_VECTORS.len());
    for ((schema, file, _), metadata) in FIXED_VECTORS.iter().zip(vectors) {
        assert_eq!(metadata["schema"].as_str(), Some(*schema));
        assert_eq!(metadata["file"].as_str(), Some(*file));
    }
    assert_eq!(
        manifest["invalid_vectors"][0]["schema"].as_str(),
        Some("PhaserRdgState")
    );
    assert_eq!(
        manifest["invalid_vectors"][0]["file"].as_str(),
        Some("phaser-rdg-state-mismatch-v1.json")
    );
    Ok(())
}

fn assert_valid_schema_vectors() -> Result<(), Box<dyn Error>> {
    assert_manifest()?;

    let mut covered = BTreeSet::new();
    for (schema, _, input) in FIXED_VECTORS {
        assert_eq!(
            round_trip_m3_schema_json(schema, input)?,
            fixture_text(input),
            "fixed {schema} bytes changed"
        );
        covered.insert(*schema);
    }

    let game: Value = serde_json::from_str(GAME_STATE)?;
    assert_schema_value("BattleState", &game["battle"], &mut covered)?;
    assert_schema_value(
        "BattleRngState",
        &game["battle"]["battle_rng"],
        &mut covered,
    )?;
    assert_schema_value(
        "CommandCollectionState",
        &game["battle"]["command_state"],
        &mut covered,
    )?;
    assert_schema_value(
        "PokemonState",
        &game["battle"]["player_party"][0],
        &mut covered,
    )?;
    assert_schema_value("RunRngState", &game["run_rng"], &mut covered)?;

    let command: Value = serde_json::from_str(BATTLE_COMMAND_PROPOSAL)?;
    assert_schema_value("BattleCommand", &command["command"], &mut covered)?;

    let control_plan: Value = serde_json::from_str(BATTLE_CONTROL_PLAN)?;
    let control = &control_plan["seats"][0]["control"];
    assert_schema_value("BattleControl", control, &mut covered)?;
    assert_schema_value("BattleMenu", &control["value"]["menu"], &mut covered)?;

    let presentation: Value = serde_json::from_str(BATTLE_PRESENTATION_EVENT)?;
    assert_schema_value(
        "BattlePresentationKind",
        &presentation["kind"],
        &mut covered,
    )?;

    let policy: Value = serde_json::from_str(SCRIPTED_ENEMY_POLICY)?;
    assert_schema_value(
        "ScriptedEnemyBattleCommandV1",
        &policy["commands"][0],
        &mut covered,
    )?;

    let tail_proof = serde_json::json!({
        "phase": "manifest",
        "requestId": "authority-v2:m3-schema:seat1:boundary-proof:1",
        "fromRevision": 1,
        "candidateRevision": 3,
        "candidateOperationId": "terminal-3",
        "headRevision": 3,
        "sourceRevisions": [1, 2]
    });
    assert_schema_value("TailProofBody", &tail_proof, &mut covered)?;

    let pack = selected_content_pack()?;
    let pack_json = canonicalize(&pack)?;
    assert_eq!(
        round_trip_m3_schema_json("ContentPack", &pack_json)?,
        pack_json
    );
    covered.insert("ContentPack");

    let mut runtime = RngRuntime::from_run_seed("m3-schema-parity");
    runtime.run_rand_seed_int(
        SafeU53::new(1)?,
        SafeU53::new(7)?,
        RngReason::BattleSeedCharacter,
        RngCallsiteId::battle_seed_character(),
    )?;
    let draw = runtime
        .audit_entries()
        .first()
        .ok_or("schema RNG draw was not recorded")?;
    let draw_json = canonicalize(draw)?;
    assert_eq!(round_trip_m3_schema_json("RngDraw", &draw_json)?, draw_json);
    assert!(draw_json.contains(r#""s0_bits":"#));
    assert!(!draw_json.contains(r#""s0":"#));
    covered.insert("RngDraw");

    let draw_value: Value = serde_json::from_str(&draw_json)?;
    assert_schema_value("RngAuditState", &draw_value["before_state"], &mut covered)?;

    let expected = M3_SCHEMA_TYPES.iter().copied().collect::<BTreeSet<_>>();
    assert_eq!(covered, expected, "schema registry has an untested DTO");
    for pair in M3_SCHEMA_TYPES.windows(2) {
        assert!(pair[0] < pair[1], "schema inventory is not canonical");
    }
    Ok(())
}

fn assert_invalid_schema_vectors() -> Result<(), Box<dyn Error>> {
    assert!(
        round_trip_m3_schema_json("PhaserRdgState", INVALID_PHASER_RDG_STATE).is_err(),
        "accepted exact bits that disagree with the Phaser state string"
    );

    for invalid in [
        r#""3DF0000000000000""#,
        r#""3df000000000000""#,
        r#""3df00000000000000""#,
        r#""3df000000000000g""#,
        "4503599627370496",
    ] {
        assert!(
            round_trip_m3_schema_json("F64Bits", invalid).is_err(),
            "accepted invalid F64Bits {invalid}"
        );
    }

    let mut command: Value = serde_json::from_str(BATTLE_COMMAND_PROPOSAL)?;
    command
        .as_object_mut()
        .ok_or("command proposal must be an object")?
        .insert("extra".to_owned(), Value::Bool(true));
    assert!(
        round_trip_m3_schema_json("BattleCommandProposalV1", &command.to_string()).is_err(),
        "accepted an unknown command proposal field"
    );

    let unsafe_state = GAME_STATE.replace(r#""mode":1"#, r#""mode":9007199254740992"#);
    assert!(
        round_trip_m3_schema_json("GameState", &unsafe_state).is_err(),
        "accepted an unsafe JSON numeric identifier"
    );
    assert!(round_trip_m3_schema_json("UnknownM3Dto", "{}").is_err());
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn native_m3_dtos_match_frozen_canonical_schema_vectors() -> Result<(), Box<dyn Error>> {
    assert_valid_schema_vectors()
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn native_m3_schema_boundary_fails_closed() -> Result<(), Box<dyn Error>> {
    assert_invalid_schema_vectors()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_node_m3_dtos_match_frozen_canonical_schema_vectors() -> Result<(), Box<dyn Error>> {
    assert_valid_schema_vectors()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_node_m3_schema_boundary_fails_closed() -> Result<(), Box<dyn Error>> {
    assert_invalid_schema_vectors()
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen_test::wasm_bindgen_test]
fn wasm32_export_uses_the_shared_typed_registry() -> Result<(), wasm_bindgen::JsValue> {
    let direct = round_trip_m3_schema_json("PhaserRdgState", PHASER_RDG_STATE)
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
    let exported =
        er_wasm::m3_schema::round_trip_m3_schema_json_wasm("PhaserRdgState", PHASER_RDG_STATE)?;
    assert_eq!(exported, direct);
    Ok(())
}
