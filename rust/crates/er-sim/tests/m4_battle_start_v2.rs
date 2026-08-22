use er_game::battle_adapter_v2::{merge_battle_v1_into_v2, project_battle_v2_to_v1};
use std::error::Error;
use std::sync::Arc;

use er_game::battle_start_v2::{BattleStartV2Error, start_battle_v2};
use er_run::content::EncounterPlanSource;
use er_run::encounter_plan::{ENCOUNTER_PLAN_SCHEMA_VERSION, EncounterPlan};
use er_run::transition::GameContentBundle;
use er_testkit::m4_fixture::assemble_selected_game_state;
use er_types::SafeU53;
use er_types::SeatId;
use er_types::battle_command::ScriptedEnemyPolicyV1;
use er_types::battle_ids::{AbilityId, BattleFormat, BattleSide, FieldSlot, PokemonId, SpeciesId};
use er_types::battle_model::{PokemonType, PokemonTyping};
use er_types::run_ids::EncounterId;
use er_types::run_model::{RunOutcome, RunStage};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m4/oracle/progression/nacli-medium-slow-level-17-v1.json"
);
const ENCOUNTER_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m4/oracle/encounters/plains-wave-11-captured-v1.json"
);
const ORACLE: &str = "45c89493e7edec9c4da247a98cd7858b1f015c09";

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe u53")
}

fn state_and_plan() -> Result<
    (
        er_state::game_v2::GameStateV2,
        EncounterPlan,
        Arc<GameContentBundle>,
    ),
    Box<dyn Error>,
> {
    let fixture: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(FIXTURE)?)?;
    let (mut state, content) = assemble_selected_game_state(&fixture, ORACLE)?;
    state.player_party[0].species_id = SpeciesId::new(safe(7));
    state.player_party[0].types = PokemonTyping {
        primary: PokemonType::Water,
        secondary: None,
    };
    state.player_party[0].moves[1..].fill(None);
    state.player_party[0].abilities.active = AbilityId::new(SafeU53::ZERO);
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
    Ok((state, plan, content))
}

#[test]
fn captured_encounter_plan_starts_complete_v2_battle_atomically() -> Result<(), Box<dyn Error>> {
    let (state, plan, content) = state_and_plan()?;
    let before = state.clone();
    let authority = SeatId::new(safe(1));
    let after = start_battle_v2(&state, &plan, authority, content.as_ref())?;

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
    let projected = project_battle_v2_to_v1(&after)?;
    assert_eq!(merge_battle_v1_into_v2(&after, &projected)?, after);
    let mut resolved = projected;
    let resolved_enemy = resolved
        .battle
        .as_mut()
        .and_then(|battle| battle.enemy_party.first_mut())
        .ok_or("projected enemy missing")?;
    resolved_enemy.hp -= 1;
    let merged = merge_battle_v1_into_v2(&after, &resolved)?;
    assert_eq!(
        merged.player_party[0].progression,
        after.player_party[0].progression
    );
    assert_eq!(
        merged
            .battle
            .as_ref()
            .ok_or("merged battle missing")?
            .enemy_party[0]
            .hp,
        after
            .battle
            .as_ref()
            .ok_or("source battle missing")?
            .enemy_party[0]
            .hp
            - 1
    );
    after.validate()?;
    Ok(())
}

#[test]
fn encounter_content_frontier_mismatch_fails_without_state_change() -> Result<(), Box<dyn Error>> {
    let (state, mut plan, content) = state_and_plan()?;
    plan.content_hash = None;
    assert!(matches!(
        start_battle_v2(&state, &plan, SeatId::new(safe(1)), content.as_ref()),
        Err(BattleStartV2Error::FrontierMismatch)
    ));
    assert!(state.battle.is_none());
    assert_eq!(state.run.stage, RunStage::Complete);
    Ok(())
}

#[test]
fn unsupported_encounter_species_fails_closed() -> Result<(), Box<dyn Error>> {
    let (state, mut plan, content) = state_and_plan()?;
    plan.enemy_party[0].species_id = SpeciesId::new(safe(916));
    assert!(matches!(
        start_battle_v2(&state, &plan, SeatId::new(safe(1)), content.as_ref()),
        Err(BattleStartV2Error::UnsupportedContent)
    ));
    assert!(state.battle.is_none());
    Ok(())
}

#[test]
fn published_lechonk_encounter_is_admitted_by_expanded_slice() -> Result<(), Box<dyn Error>> {
    let progression: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(FIXTURE)?)?;
    let encounter: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(ENCOUNTER_FIXTURE)?)?;
    let (mut state, content) = assemble_selected_game_state(&progression, ORACLE)?;
    state.run.wave = er_types::battle_ids::WaveIndex::new(safe(11))?;
    state.run.biome.biome = er_types::run_ids::BiomeId::new(safe(1));
    state.run.biome.source_wave = state.run.wave;
    let enemy_value = encounter["final"]["canonical"]["save_data"]["enemyParty"]
        .as_array()
        .and_then(|party| party.first())
        .ok_or("captured enemy missing")?;
    let enemy_id = PokemonId::new(safe(enemy_value["id"].as_u64().ok_or("captured enemy ID")?));
    let enemy = er_testkit::m4_fixture::convert_pokemon(enemy_value, enemy_id, None)?;
    assert_eq!(enemy.species_id.get().get(), 915);
    assert_eq!(enemy.abilities.active.get().get(), 165);
    let plan = EncounterPlan {
        schema_version: ENCOUNTER_PLAN_SCHEMA_VERSION,
        encounter_id: EncounterId::new(safe(1)),
        run_id: state.run.run_id,
        wave: state.run.wave,
        biome: state.run.biome.biome,
        format: BattleFormat::single(),
        enemy_party: vec![enemy],
        enemy_leads: vec![enemy_id],
        player_leads: vec![state.player_party[0].id],
        scripted_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, Vec::new())?,
        battle_seed: encounter["final"]["canonical"]["runtime"]["battle_seed"]
            .as_str()
            .ok_or("captured battle seed")?
            .to_owned(),
        generation_audit: Vec::new(),
        source: EncounterPlanSource::OracleCaptureRequired,
        content_hash: Some(state.run_content_hash.clone()),
    };
    let after = start_battle_v2(&state, &plan, SeatId::new(safe(1)), content.as_ref())?;
    assert_eq!(
        after
            .battle
            .as_ref()
            .ok_or("captured battle missing")?
            .enemy_party[0]
            .species_id
            .get()
            .get(),
        915
    );
    Ok(())
}
