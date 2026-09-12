//! Content-aware validation of an active ordinary Victory's retained progress.
//! Arithmetic starts from the captured Faint preimage, never from a guessed
//! inverse of the current level, HP or stat values.
use crate::current_experience_settlement::plan_current_victory_experience;
use crate::current_source_progression::current_source_progression;
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;
use er_progression::current_experience::{ExperiencePosition, add_normal_classic_experience};
use er_progression::current_stats::{
    calculate_current_unmodified_stats, current_hp_after_stat_calculation,
};
use er_state::current_experience_settlement::{CurrentExperienceAwardV1, CurrentLevelUpV1};
use er_state::current_victory_execution::CurrentVictoryDescendantV1 as D;
use er_state::m9e_state_v6::GameStateV6;

fn failure() -> GameRuntimeV6Error {
    GameRuntimeV6Error::Action
}

struct AwardProgress<'a> {
    award: &'a CurrentExperienceAwardV1,
    xp_applied: bool,
    stats_applied: bool,
    level_up: Option<&'a CurrentLevelUpV1>,
    check_optional_level_up: bool,
}

fn current_progress(descendant: &D) -> Option<AwardProgress<'_>> {
    let (award, xp_applied, stats_applied, level_up) = match descendant {
        D::Ready | D::Complete => return None,
        D::AwardPresentation { award, .. } => (award, false, false, None),
        D::PartyAwardPresentation {
            award, level_up, ..
        } => (award, true, false, level_up.as_ref()),
        D::LevelUpStart { level_up } => (&level_up.award, true, false, Some(level_up)),
        D::LevelUpPresentation { end, .. } => {
            (&end.level_up.award, true, true, Some(&end.level_up))
        }
        D::LevelUpChildren { children } | D::Evolution { children } => (
            &children.parent.level_up.award,
            true,
            true,
            Some(&children.parent.level_up),
        ),
        D::LearnMoveBatch { batch } => (
            &batch.children.parent.level_up.award,
            true,
            true,
            Some(&batch.children.parent.level_up),
        ),
        D::HidePartyBar { award } | D::HidePartyBarPresentation { award, .. } => {
            (award, true, true, None)
        }
    };
    Some(AwardProgress {
        award,
        xp_applied,
        stats_applied,
        level_up,
        check_optional_level_up: matches!(descendant, D::PartyAwardPresentation { .. }),
    })
}

pub(crate) fn validate_current_experience_progress(state: &GameStateV6, content: &PreparedGameContentV2) -> Result<(), GameRuntimeV6Error> {
    if let Some(projected) = crate::current_initial_victory_tail::settled_projection(state)? {
        validate_current_experience_progress_at_frontier(&projected, content)
    } else {
        validate_current_experience_progress_at_frontier(state, content)
    }
}

fn validate_current_experience_progress_at_frontier(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<(), GameRuntimeV6Error> {
    let Some(owner) = state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
    else {
        return Ok(());
    };
    if owner.source_progression.is_none() {
        return Ok(());
    }
    current_source_progression(state, content)?;
    // The admitted configuration is the actual initial single wild encounter.
    // Multiple simultaneous reward preimages need a separate ordered contract.
    if owner.pending.len() > 1 {
        return Err(failure());
    }
    let Some(pending) = owner.pending.first() else {
        return Ok(());
    };
    let run = state.active_run.as_ref().ok_or_else(failure)?;
    if pending.recipients.len() != run.party.len() {
        return Err(failure());
    }
    let mut preimage = state.clone();
    let pre_run = preimage.active_run.as_mut().ok_or_else(failure)?;
    for (pokemon, recipient) in pre_run.party.iter_mut().zip(&pending.recipients) {
        if pokemon.id != recipient.pokemon
            || pokemon.owner_seat != Some(recipient.owner)
            || pokemon.pokerus != recipient.pokerus
        {
            return Err(failure());
        }
        let captured = recipient.stats.as_ref().ok_or_else(failure)?;
        if captured.max_hp != captured.stats.hp || recipient.hp > captured.max_hp {
            return Err(failure());
        }
        pokemon.level = recipient.level;
        pokemon.experience = recipient.experience;
        pokemon.hp = recipient.hp;
        pokemon.fainted = recipient.hp == 0;
        pokemon.stats = captured.stats;
        pokemon.max_hp = captured.max_hp;
    }
    let mut progress = Vec::new();
    if let Some(victory) = &pending.victory {
        if !victory.valid(pending.id)
            || plan_current_victory_experience(&preimage, content, pending.id)? != victory.phases
        {
            return Err(failure());
        }
        progress.extend(victory.completed.iter().map(|award| AwardProgress {
            award,
            xp_applied: true,
            stats_applied: true,
            level_up: None,
            check_optional_level_up: false,
        }));
        progress.extend(current_progress(&victory.descendant));
    }
    let wave = u16::try_from(run.wave.get().get()).map_err(|_| failure())?;
    for (index, (pokemon, recipient)) in run.party.iter().zip(&pending.recipients).enumerate() {
        let captured = recipient.stats.as_ref().ok_or_else(failure)?;
        let mut expected_level = recipient.level;
        let mut expected_xp = recipient.experience;
        let mut expected_stats = captured.stats;
        let mut expected_hp = recipient.hp;
        let awards = progress
            .iter()
            .filter(|p| usize::from(p.award.phase.party_index) == index)
            .collect::<Vec<_>>();
        if awards.len() > 1 {
            return Err(failure());
        }
        if let Some(progress) = awards.first() {
            let award = progress.award;
            if award.phase.pokemon != pokemon.id
                || award.phase.pending_id != pending.id
                || award.last_level != recipient.level
                || award.last_experience != recipient.experience
                || award.experience != award.phase.phase_argument
            {
                return Err(failure());
            }
            let definition = content
                .progression
                .species(pokemon.species_id, pokemon.form_index)
                .ok_or_else(failure)?;
            let growth = content
                .progression
                .growth_rate(definition.growth_rate)
                .ok_or_else(failure)?;
            let position = add_normal_classic_experience(
                growth,
                ExperiencePosition {
                    level: recipient.level,
                    total: recipient.experience,
                },
                award.experience,
                wave,
            )
            .map_err(|_| failure())?;
            if let Some(level_up) = progress.level_up
                && (level_up.award != *award
                    || level_up.previous_level != recipient.level
                    || level_up.new_level != position.level
                    || position.level <= recipient.level
                    || level_up.previous_stats != captured.stats)
            {
                return Err(failure());
            }
            if progress.check_optional_level_up
                && (progress.level_up.is_some() != (position.level > recipient.level))
            {
                return Err(failure());
            }
            if progress.xp_applied {
                expected_level = position.level;
                expected_xp = position.total;
            }
            if progress.stats_applied && position.level > recipient.level {
                let bonuses = &pokemon.permanent_bonuses;
                if [
                    bonuses.hp,
                    bonuses.attack,
                    bonuses.defense,
                    bonuses.special_attack,
                    bonuses.special_defense,
                    bonuses.speed,
                ]
                .iter()
                .any(|value| *value != 0)
                {
                    return Err(failure());
                }
                let mut leveled = pokemon.clone();
                leveled.level = position.level;
                let species = content
                    .battle
                    .species(pokemon.species_id)
                    .map_err(|_| failure())?;
                let form_id = er_types::FormId::parse(format!(
                    "{}:{}",
                    pokemon.species_id.get().get(),
                    pokemon.form_index
                ))
                .map_err(|_| failure())?;
                let form = content.battle.form(&form_id).map_err(|_| failure())?;
                if form.species != pokemon.species_id {
                    return Err(failure());
                }
                let nature = content
                    .progression
                    .pack()
                    .natures
                    .iter()
                    .find(|n| n.id == pokemon.effective_nature)
                    .ok_or_else(failure)?;
                expected_stats = calculate_current_unmodified_stats(
                    &leveled,
                    form.stat_override.unwrap_or(species.base_stats),
                    nature,
                )
                .map_err(|_| failure())?;
                expected_hp = current_hp_after_stat_calculation(
                    recipient.hp,
                    captured.max_hp,
                    expected_stats.hp,
                )
                .map_err(|_| failure())?;
            }
        }
        if pokemon.level != expected_level
            || pokemon.experience != expected_xp
            || pokemon.stats != expected_stats
            || pokemon.max_hp != expected_stats.hp
            || pokemon.hp != expected_hp
            || pokemon.fainted != (expected_hp == 0)
        {
            return Err(failure());
        }
    }
    Ok(())
}
