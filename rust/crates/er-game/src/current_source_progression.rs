//! Live admission for the actual retained fresh source configuration.
use er_battle::current_target_execution::CurrentTargetExecution;
use er_state::current_experience_owner::{CurrentExperienceCapPolicyV1, CurrentExperienceEncounterV1};
use er_state::current_source_progression::CurrentSourceProgressionV1;
use er_types::battle_ids::BattleFormat;
use er_state::m9e_state_v6::GameStateV6;

use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;

/// This authorizes the represented ordinary configuration, not unrepresented
/// boss/trainer flags, reward inventories or source damage ability semantics.
/// Callers must additionally own any such source facts used by their operation.
pub(crate) fn current_source_progression<'a>(
    state: &'a GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<&'a CurrentSourceProgressionV1, GameRuntimeV6Error> {
    let failure = || GameRuntimeV6Error::Action;
    let run = state.active_run.as_ref().ok_or_else(failure)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    let profile = state.current_friendship_profile.as_ref().ok_or_else(failure)?;
    let experience = state.current_battle_participation.as_ref()
        .and_then(|owner| owner.experience.as_ref()).ok_or_else(failure)?;
    let source = experience.source_progression.as_ref().ok_or_else(failure)?;
    if !source.valid(run) || source.profile_owner != profile.owner_seat
        || profile.content_identity != state.content_identity
        || state.content_identity != *content.identity()
        || experience.content_identity != state.content_identity
        || experience.cap_policy != CurrentExperienceCapPolicyV1::NormalClassic
        || experience.encounter != CurrentExperienceEncounterV1::OrdinaryWild
        || source.initial_battle != battle.battle_id || source.initial_wave != run.wave
        || battle.format != BattleFormat::single() || battle.enemy_party.len() != 1
        || !run.flags.is_empty() || run.scenario.is_some() || !run.modifiers.is_empty()
    { return Err(failure()); }
    let enemy = &battle.enemy_party[0];
    if enemy.id != source.initial_enemy.pokemon || enemy.species_id != source.initial_enemy.species
        || enemy.form_index != source.initial_enemy.form_index
    { return Err(failure()); }
    let targeting = CurrentTargetExecution::from_state(state).map_err(|_| failure())?;
    targeting.validate_run(run).map_err(|_| failure())?;
    for pokemon in run.party.iter().chain(&battle.enemy_party) {
        targeting.ability_sources(run, pokemon).map_err(|_| failure())?;
        if pokemon.max_hp != pokemon.stats.hp {
            return Err(failure());
        }
    }
    for (row, pokemon) in source.party.iter().zip(&run.party) {
        let index = usize::try_from(row.selection.pokemon_id.get().get()).ok()
            .and_then(|index| index.checked_sub(1)).ok_or_else(failure)?;
        let entry = content.bundle().bootstrap.starters.get(index).ok_or_else(failure)?;
        if entry.species_id.get() != row.selection.species_id
            || entry.form_index != row.selection.form_index
            || entry.ability_index != row.selection.ability_index || entry.cost != row.selection.cost
            || pokemon.species_id.get() != row.selection.species_id
            || pokemon.form_index != row.selection.form_index || row.ability_index != 0
        { return Err(failure()); }
    }
    Ok(source)
}
