use std::error::Error;

use er_game::battle_start_v2::{BattleStartV2Error, start_battle_v2};
use er_run::content::EncounterPlanSource;
use er_run::encounter_plan::{ENCOUNTER_PLAN_SCHEMA_VERSION, EncounterPlan};
use er_testkit::m4_fixture::assemble_selected_game_state;
use er_types::SafeU53;
use er_types::SeatId;
use er_types::battle_command::ScriptedEnemyPolicyV1;
use er_types::battle_ids::{BattleFormat, BattleSide, FieldSlot, PokemonId};
use er_types::run_ids::EncounterId;
use er_types::run_model::{RunOutcome, RunStage};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m4/oracle/progression/nacli-medium-slow-level-17-v1.json"
);
const ORACLE: &str = "45c89493e7edec9c4da247a98cd7858b1f015c09";

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe u53")
}

fn state_and_plan() -> Result<(er_state::game_v2::GameStateV2, EncounterPlan), Box<dyn Error>> {
    let fixture: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(FIXTURE)?)?;
    let (state, _) = assemble_selected_game_state(&fixture, ORACLE)?;
    let player = state.player_party[0].id;
    let mut enemy = state.player_party[0].clone();
    enemy.id = PokemonId::new(safe(9_001));
    enemy.owner_seat = None;
    let plan = EncounterPlan {
        schema_version: ENCOUNTER_PLAN_SCHEMA_VERSION,
        encounter_id: EncounterId::new(safe(1)),
        run_id: state.run.run_id,
        wave: state.run.wave,
        biome: state.run.biome.biome,
        format: BattleFormat::single(),
        enemy_party: vec![enemy],
        enemy_leads: vec![PokemonId::new(safe(9_001))],
        player_leads: vec![player],
        scripted_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, Vec::new())?,
        battle_seed: "m4-battle-start-vector".to_owned(),
        generation_audit: Vec::new(),
        source: EncounterPlanSource::OracleCaptureRequired,
        content_hash: Some(state.run_content_hash.clone()),
    };
    Ok((state, plan))
}

#[test]
fn captured_encounter_plan_starts_complete_v2_battle_atomically() -> Result<(), Box<dyn Error>> {
    let (state, plan) = state_and_plan()?;
    let before = state.clone();
    let authority = SeatId::new(safe(1));
    let after = start_battle_v2(&state, &plan, authority)?;

    assert_eq!(state, before, "battle start must not mutate its input");
    assert_eq!(after.run.stage, RunStage::Battle);
    assert_eq!(after.run.outcome, RunOutcome::InProgress);
    assert!(after.run.active_surface.is_none());
    assert_eq!(after.run.next_battle_id.get().get(), 2);
    let battle = after.battle.as_ref().ok_or("battle missing")?;
    assert_eq!(battle.battle_id.get().get(), 1);
    assert_eq!(battle.wave, plan.wave);
    assert_eq!(battle.authority_seat, authority);
    assert_eq!(battle.enemy_party, plan.enemy_party);
    assert_eq!(
        battle
            .field
            .occupant(&battle.format, FieldSlot::new(BattleSide::Player, 0)?,)?,
        Some(plan.player_leads[0])
    );
    assert_eq!(
        battle
            .field
            .occupant(&battle.format, FieldSlot::new(BattleSide::Enemy, 0)?,)?,
        Some(plan.enemy_leads[0])
    );
    after.validate()?;
    Ok(())
}

#[test]
fn encounter_content_frontier_mismatch_fails_without_state_change() -> Result<(), Box<dyn Error>> {
    let (state, mut plan) = state_and_plan()?;
    plan.content_hash = None;
    assert!(matches!(
        start_battle_v2(&state, &plan, SeatId::new(safe(1))),
        Err(BattleStartV2Error::FrontierMismatch)
    ));
    assert!(state.battle.is_none());
    assert_eq!(state.run.stage, RunStage::Complete);
    Ok(())
}
