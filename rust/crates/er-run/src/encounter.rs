//! Encounter-plan assembly for the selected M4 slice.
//!
//! Contract: `rust/contracts/m4-biome-encounter.md`. The parity fixture uses
//! an exact captured wave-11 vector; this module assembles and validates the
//! typed plan from caller-supplied captured data. Ordinary callback-driven
//! pools, ability generation, and AI are unsupported and never synthesized.

use er_types::battle_ids::{BattleId, WaveIndex};
use er_types::run_ids::{EncounterId, GameRunId};

use crate::content::{EncounterGenerationMode, EncounterPlanDefinition, EncounterPlanSource};
use crate::encounter_plan::{CapturedPlanEvidence, EncounterPlan};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EncounterBuildError {
    GenerationModeUnsupported,
    SourceMismatch,
    PlanInvalid,
}

/// Assembles one validated encounter plan from captured evidence.
///
/// The captured party vectors, leads, scripted policy, battle seed, and RNG
/// audit are supplied by the testkit loader from the published oracle JSON;
/// nothing is reconstructed from content.
pub fn prepare_encounter_plan(
    definition: &EncounterPlanDefinition,
    encounter_id: EncounterId,
    run_id: GameRunId,
    wave: WaveIndex,
    captured: CapturedPlanEvidence,
) -> Result<EncounterPlan, EncounterBuildError> {
    if definition.generation_mode != EncounterGenerationMode::StaticCapturedVector {
        return Err(EncounterBuildError::GenerationModeUnsupported);
    }
    if definition.source != EncounterPlanSource::OracleCaptureRequired {
        return Err(EncounterBuildError::SourceMismatch);
    }
    let plan = EncounterPlan {
        schema_version: crate::encounter_plan::ENCOUNTER_PLAN_SCHEMA_VERSION,
        encounter_id,
        run_id,
        wave,
        biome: definition.biome_id,
        format: captured.format,
        enemy_party: captured.enemy_party,
        enemy_leads: captured.enemy_leads,
        player_leads: captured.player_leads,
        scripted_policy: captured.scripted_policy,
        battle_seed: captured.battle_seed,
        generation_audit: captured.generation_audit,
        source: definition.source,
        content_hash: captured.run_content_hash,
    };
    match plan.validate() {
        Ok(()) => Ok(plan),
        Err(_) => Err(EncounterBuildError::PlanInvalid),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_content::species::SpeciesBaseStats;
    use er_state::pokemon_v2::StatStages;
    use er_state::pokemon_v2::{Iv, PokemonProgressionState, PokemonStateV2};
    use er_types::SafeU53;
    use er_types::battle_command::ScriptedEnemyPolicyV1;
    use er_types::battle_ids::{
        AbilityId, BattleFormat, MoveId, MoveSlotIndex, PokemonId, SpeciesId,
    };
    use er_types::battle_model::{AbilityLoadout, BattleStats, MoveSlotState, StatusState};

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("safe u53")
    }

    fn wave(value: u64) -> WaveIndex {
        WaveIndex::new(safe(value)).expect("wave")
    }

    fn species(value: u64) -> SpeciesId {
        SpeciesId::new(safe(value))
    }

    fn pokemon_id(value: u64) -> PokemonId {
        PokemonId::new(safe(value))
    }

    fn move_slot(value: u64) -> Option<MoveSlotState> {
        Some(MoveSlotState {
            move_id: MoveId::new(safe(value)),
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        })
    }

    fn definition() -> EncounterPlanDefinition {
        EncounterPlanDefinition {
            id: er_types::run_ids::EncounterId::new(safe(1)),
            biome_id: er_types::run_ids::BiomeId::new(safe(1)),
            source: EncounterPlanSource::OracleCaptureRequired,
            generation_mode: EncounterGenerationMode::StaticCapturedVector,
            enemy_policy: crate::content::EnemyPolicy::ScriptedEnemyPolicyV1,
            captured_vector_key: "plains-wave-11-captured-v1".to_owned(),
        }
    }

    fn captured_enemy() -> PokemonStateV2 {
        PokemonStateV2 {
            schema_version: 2,
            id: pokemon_id(9001),
            owner_seat: None,
            species_id: species(16),
            form_index: 0,
            level: 11,
            types: er_types::battle_model::PokemonTyping {
                primary: er_types::battle_model::PokemonType::Normal,
                secondary: None,
            },
            stats: BattleStats {
                hp: 30,
                attack: 20,
                defense: 20,
                special_attack: 20,
                special_defense: 20,
                speed: 20,
            },
            hp: 30,
            max_hp: 30,
            status: StatusState {
                kind: er_types::battle_model::StatusKind::None,
                toxic_turn_count: 0,
                sleep_turns_remaining: None,
            },
            stat_stages: StatStages {
                attack: 0,
                defense: 0,
                special_attack: 0,
                special_defense: 0,
                speed: 0,
                accuracy: 0,
                evasion: 0,
            },
            moves: [move_slot(33), None, None, None],
            abilities: AbilityLoadout {
                active: AbilityId::new(safe(1)),
                passives: [None, None, None],
                active_suppressed: false,
                passive_suppressed: [false, false, false],
            },
            fainted: false,
            progression: PokemonProgressionState {
                experience: er_types::run_ids::Experience::new(SafeU53::ZERO),
                growth_rate: er_types::run_ids::GrowthRateId::new(3),
                ivs: [Iv::new(31).expect("iv"); 6],
                nature: er_types::run_ids::NatureId::new(0),
                effective_nature: er_types::run_ids::NatureId::new(0),
                friendship: 50,
                permanent_bonuses: er_state::pokemon_v2::PermanentStatBonuses {
                    hp: 0,
                    attack: 0,
                    defense: 0,
                    special_attack: 0,
                    special_defense: 0,
                    speed: 0,
                },
                pause_evolutions: false,
            },
        }
    }

    fn captured_evidence(enemy_party: Vec<PokemonStateV2>) -> CapturedPlanEvidence {
        let enemy_leads = enemy_party.iter().map(|entry| entry.id).collect();
        CapturedPlanEvidence {
            format: BattleFormat {
                player_capacity: 1,
                enemy_capacity: 1,
                adjacency: vec![],
            },
            enemy_party,
            enemy_leads,
            player_leads: vec![pokemon_id(1)],
            scripted_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, Vec::new()).expect("policy"),
            battle_seed: "captured-seed".to_owned(),
            generation_audit: Vec::new(),
            run_content_hash: Some(
                er_types::run_ids::RunContentPackHash::new(
                    "blake3-v1:0000000000000000000000000000000000000000000000000000000000000000",
                )
                .expect("hash"),
            ),
        }
    }

    #[test]
    fn captured_vector_assembles_a_valid_plan() {
        let plan = prepare_encounter_plan(
            &definition(),
            er_types::run_ids::EncounterId::new(safe(1)),
            GameRunId::new(safe(1)),
            wave(11),
            captured_evidence(vec![captured_enemy()]),
        )
        .expect("plan");
        assert_eq!(plan.wave.get(), 11);
        assert_eq!(plan.enemy_party[0].species_id.get().get(), 16);
        assert_eq!(plan.enemy_leads, vec![pokemon_id(9001)]);
    }

    #[test]
    fn stale_lead_references_are_rejected() {
        let mut evidence = captured_evidence(vec![captured_enemy()]);
        evidence.enemy_leads = vec![pokemon_id(9999)];
        assert_eq!(
            prepare_encounter_plan(
                &definition(),
                er_types::run_ids::EncounterId::new(safe(1)),
                GameRunId::new(safe(1)),
                wave(11),
                evidence,
            ),
            Err(EncounterBuildError::PlanInvalid)
        );
        // Keep the constructor surface exercised for the frozen slot type.
        let _ = MoveSlotIndex::ZERO;
    }
}
