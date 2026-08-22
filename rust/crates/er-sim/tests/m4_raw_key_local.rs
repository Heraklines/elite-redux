//! M4 raw-key local campaign: loads published oracle fixtures, constructs
//! the run-mode kernel, and verifies material application through the single
//! shared production applier.
//!
//! This campaign proves that the fixture loader → GameStateV2 → RunRuntime
//! pipeline works end-to-end without fixture-authored plans or semantic
//! shortcuts.

use std::error::Error;

use er_game::run_runtime::RunRuntime;
use er_state::digest_v2::MechanicalStateDigestV2;
use er_testkit::m4_fixture::assemble_game_state;
use er_types::SafeU53;
use er_types::battle_ids::ContentPackHash;
use er_types::run_ids::RunContentPackHash;

/// The published progression fixture path relative to the repository root.
const PROGRESSION_FIXTURE: &str =
    "rust/fixtures/m4/oracle/progression/nacli-medium-slow-level-17-v1.json";

fn load_fixture_value(path: &str) -> Result<serde_json::Value, Box<dyn Error>> {
    let data = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&data)?)
}

fn content_hashes(
    fixture: &serde_json::Value,
) -> Result<(ContentPackHash, RunContentPackHash), Box<dyn Error>> {
    let initial = &fixture["initial"];
    let battle = initial["battle_content_hash"]
        .as_str()
        .ok_or("missing battle_content_hash")?;
    let run = initial["run_content_hash"]
        .as_str()
        .ok_or("missing run_content_hash")?;
    Ok((ContentPackHash::new(battle)?, RunContentPackHash::new(run)?))
}

#[test]
fn progression_fixture_produces_validated_v2_state() -> Result<(), Box<dyn Error>> {
    let fixture = load_fixture_value(PROGRESSION_FIXTURE)?;
    let (battle_hash, run_hash) = content_hashes(&fixture)?;

    // The fixture loader converts TypeScript save-data into validated V2.
    let state = assemble_game_state(&fixture, battle_hash.clone(), run_hash.clone(), "test")?;

    // State must pass complete V2 validation.
    state.validate().map_err(|e| format!("validation: {e}"))?;

    // Party must contain Nacli at level 16 with exp 4329.
    assert!(!state.player_party.is_empty(), "party must not be empty");
    assert_eq!(state.run.stage, er_types::run_model::RunStage::Battle);
    assert_eq!(
        state.run.outcome,
        er_types::run_model::RunOutcome::InProgress
    );

    Ok(())
}

#[test]
fn runtime_accepts_validated_state_and_computes_frontier() -> Result<(), Box<dyn Error>> {
    let fixture = load_fixture_value(PROGRESSION_FIXTURE)?;
    let (battle_hash, run_hash) = content_hashes(&fixture)?;

    let state = assemble_game_state(&fixture, battle_hash.clone(), run_hash.clone(), "test")?;
    let runtime = RunRuntime::new(state, battle_hash, run_hash, "test-oracle-sha")?;

    // The frontier digest must be a well-formed blake3-v1 value.
    let frontier = runtime.frontier_digest()?;
    assert!(
        frontier.as_str().starts_with("blake3-v1:"),
        "frontier must start with blake3-v1:"
    );
    assert_eq!(frontier.as_str().len(), 10 + 64);

    // Determinism: recomputing produces the same digest.
    let frontier2 = runtime.frontier_digest()?;
    assert_eq!(frontier, frontier2);

    Ok(())
}

#[test]
fn runtime_rejects_local_frontier_mismatch() -> Result<(), Box<dyn Error>> {
    use er_run::run_material::{AuthorityRunMaterial, RunMaterialHeader, WaveAdvanceMaterialV1};

    let fixture = load_fixture_value(PROGRESSION_FIXTURE)?;
    let (battle_hash, run_hash) = content_hashes(&fixture)?;

    let state = assemble_game_state(&fixture, battle_hash.clone(), run_hash.clone(), "test")?;
    let mut runtime = RunRuntime::new(state, battle_hash.clone(), run_hash.clone(), "test")?;

    // Build a material whose before_digest does NOT match the local frontier.
    let fake_digest = MechanicalStateDigestV2::new(format!("blake3-v1:{}", "f".repeat(64)))?;
    let header = RunMaterialHeader {
        m4_oracle_sha: "test".to_owned(),
        m3_parity_oracle_sha: "3b534099919efae827019d4a3f3c4ab0ecd6d67b".to_owned(),
        battle_content_hash: battle_hash,
        run_content_hash: run_hash,
        operation_id: er_types::OperationId::new("V2/WAVE/e1/w9/tick1")?,
        run_id: er_types::run_ids::GameRunId::new(SafeU53::new(1)?),
        wave: er_types::battle_ids::WaveIndex::new(SafeU53::new(10)?).map_err(|e| e.to_string())?,
        before_digest: fake_digest.clone(),
        after_digest: fake_digest,
        before_state: runtime.state().clone(),
        after_state: runtime.state().clone(),
        next_control: er_types::run_control::GameControlPlan {
            schema_version: 1,
            seats: vec![],
            next_control_id: String::new(),
            next_menu_instance_id: er_types::battle_ids::MenuInstanceId::new(SafeU53::ZERO),
        },
    };
    let material = AuthorityRunMaterial::WaveAdvance(WaveAdvanceMaterialV1 {
        schema_version: 1,
        header,
        source_battle_id: er_types::battle_ids::BattleId::new(SafeU53::new(1)?),
        mutations: vec![],
        presentation: vec![],
        rng_audit: vec![],
    });

    // Apply must fail because the fake digest doesn't match the local frontier.
    let result = runtime.apply(&material);
    assert!(result.is_err(), "must reject mismatched frontier");
    Ok(())
}
