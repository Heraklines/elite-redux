//! Candidate-only execution of owned ordinary fresh Classic XP descendants.
//! The phase runtime persists each record, acknowledges its presentation and
//! recomputes this candidate during common material application.
use er_battle::current_target_execution::CurrentTargetExecution;
use er_progression::current_experience::{
    DefeatedExperienceSource, ExperienceForm, ExperiencePosition, OrdinaryExperienceBattle,
    add_normal_classic_experience, defeated_experience_value, normal_classic_level_cap,
};
use er_progression::current_party_experience::{
    UnboostedPartyExperienceInput, UnboostedPartyExperienceMember, plan_unboosted_party_experience,
};
use er_progression::current_stats::{calculate_current_unmodified_stats, current_hp_after_stat_calculation};
use er_progression::content_v2::EvolutionConditionV2;
use er_state::current_experience_owner::{CurrentExperienceCapPolicyV1, CurrentExperienceEncounterV1, CurrentExperienceExecutionOriginV1, CurrentPendingExperienceV1};
use er_state::current_experience_settlement::{
    CurrentExperiencePhaseV1, CurrentExperienceAwardV1, CurrentLevelUpV1, CurrentLevelUpEndV1,
    CurrentLevelUpChildrenV1,
    CurrentLearnMoveBatchV1, CurrentLearnMoveAssignmentV1,
};
use er_state::m7_state::{PokemonStateV5, RunStateV3};
use er_state::m9e_state_v6::GameStateV6;
use er_types::run_ids::Experience;
use er_types::m7_action::CurrentLearnMoveBatchActionV1;
use er_types::battle_ids::MoveId;
use er_types::battle_model::MoveSlotState;
use er_types::SafeU53;

use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;

fn failure() -> GameRuntimeV6Error { GameRuntimeV6Error::Action }

fn context<'a>(before: &'a GameStateV6, content: &PreparedGameContentV2, pending_id: SafeU53)
    -> Result<(&'a RunStateV3, &'a CurrentPendingExperienceV1), GameRuntimeV6Error>
{
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let owner = before.current_battle_participation.as_ref()
        .and_then(|value| value.experience.as_ref()).ok_or_else(failure)?;
    if owner.execution_origin != Some(CurrentExperienceExecutionOriginV1::FreshNormalClassic)
        || owner.source_progression.is_none()
        || owner.cap_policy != CurrentExperienceCapPolicyV1::NormalClassic
        || owner.encounter != CurrentExperienceEncounterV1::OrdinaryWild
        || owner.content_identity != before.content_identity || owner.run != run.run_id
        || owner.wave != run.wave || !content.supports_current_experience_mode(run.mode)
        || !run.modifiers.is_empty()
    { return Err(failure()); }
    crate::current_source_progression::current_source_progression(before, content)?;
    // Actual fresh construction owns non-Moody ordinary Classic. All24 admitted
    // registry abilities have an observed empty experience-meta attribute set.
    // The shared resolver rejects unknown IDs, suppression, fusion and held items.
    let targeting = CurrentTargetExecution::from_state(before).map_err(|_| failure())?;
    targeting.validate_run(run).map_err(|_| failure())?;
    for pokemon in &run.party {
        targeting.ability_sources(run, pokemon).map_err(|_| failure())?;
        if pokemon.form_index != 0 || !matches!(pokemon.species_id.get().get(), 1 | 4 | 7) {
            return Err(failure());
        }
    }
    let pending = owner.pending.iter().find(|value| value.id == pending_id).ok_or_else(failure)?;
    let metadata = content.progression.experience_for_compiled_form(
        pending.source.species, pending.source.compiled_form).map_err(|_| failure())?;
    if metadata.base_exp != pending.source.unadjusted_base_exp
        || metadata.source_sprite_key != pending.source.source_sprite_key
        || owner.enemy_sources.iter().filter(|source| **source == pending.source).count() != 1
    { return Err(failure()); }
    Ok((run, pending))
}

/// Called at the actual Victory frontier, before descendant XP phases change
/// any recipient's level. Full faint-start participant cardinality is retained.
pub(crate) fn plan_current_victory_experience(
    before: &GameStateV6, content: &PreparedGameContentV2, pending_id: SafeU53,
) -> Result<Vec<CurrentExperiencePhaseV1>, GameRuntimeV6Error> {
    let (run, pending) = context(before, content, pending_id)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    let wave = u16::try_from(run.wave.get().get()).map_err(|_| failure())?;
    let form = match pending.source.source_sprite_key.as_str() {
        "mega" => ExperienceForm::Mega, "mega-x" => ExperienceForm::MegaX,
        "mega-y" => ExperienceForm::MegaY, "primal" => ExperienceForm::Primal,
        "gigantamax" => ExperienceForm::Gigantamax, "eternamax" => ExperienceForm::Eternamax,
        _ => ExperienceForm::Other,
    };
    let value = defeated_experience_value(DefeatedExperienceSource {
        base_experience: pending.source.unadjusted_base_exp, level: pending.defeated_level,
        form, battle: OrdinaryExperienceBattle::Wild,
    }).map_err(|_| failure())?;
    let party = run.party.iter().map(|pokemon| Ok(UnboostedPartyExperienceMember {
        hp: pokemon.hp, level: pokemon.level,
        participated: pending.participants.iter().any(|row| row.pokemon == pokemon.id
            && Some(row.owner) == pokemon.owner_seat),
        pokerus: pokemon.pokerus.ok_or_else(failure)?,
        on_field: battle.field.slots.iter().any(|row| row.occupant == Some(pokemon.id)),
    })).collect::<Result<Vec<_>, GameRuntimeV6Error>>()?;
    let plan = plan_unboosted_party_experience(&UnboostedPartyExperienceInput {
        raw_exp_value: value, trainer: false, pokemon_defeated: true,
        level_cap: normal_classic_level_cap(wave).map_err(|_| failure())?,
        participant_count: u32::try_from(pending.participants.len()).map_err(|_| failure())?,
        exp_share_stacks: None, exp_balance_stacks: None, multiple_participant_stacks: None,
        multiplier_override: None, party,
    }).map_err(|_| failure())?;
    plan.phase_insertions.into_iter().map(|row| Ok(CurrentExperiencePhaseV1 {
        pending_id, pokemon: run.party.get(row.party_index).ok_or_else(failure)?.id,
        party_index: u8::try_from(row.party_index).map_err(|_| failure())?,
        on_field: row.on_field, phase_argument: represented_experience(row.experience)?,
    })).collect()
}

pub(crate) fn prepare_current_experience_phase(
    before: &GameStateV6, content: &PreparedGameContentV2, phase: &CurrentExperiencePhaseV1,
) -> Result<CurrentExperienceAwardV1, GameRuntimeV6Error> {
    let (run, pending) = context(before, content, phase.pending_id)?;
    let pokemon = phase_pokemon(run, phase)?;
    // applyPartyExp created the WHOLE immutable list at the Victory frontier.
    // Earlier descendants may already have changed levels/stats. Never re-plan
    // that list from this later state. Common material recomputes its creation;
    // this phase is authorized only by its exact retained cursor entry.
    let victory = pending.victory.as_ref().ok_or_else(failure)?;
    if victory.phases.get(usize::from(victory.next_phase)) != Some(phase) {
        return Err(failure());
    }
    Ok(CurrentExperienceAwardV1 {
        phase: phase.clone(), experience: phase.phase_argument,
        last_level: pokemon.level, last_experience: pokemon.experience,
    })
}

/// Runs only after the real XP gain prompt is acknowledged. Does not recalculate
/// stats early: that is the separately retained LevelUpPhase.start descendant.
pub(crate) fn apply_current_experience_award(
    before: &GameStateV6, content: &PreparedGameContentV2, award: &CurrentExperienceAwardV1,
) -> Result<(GameStateV6, Option<CurrentLevelUpV1>), GameRuntimeV6Error> {
    if prepare_current_experience_phase(before, content, &award.phase)? != *award {
        return Err(failure());
    }
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let pokemon = phase_pokemon(run, &award.phase)?;
    let definition = content.progression.species(pokemon.species_id, pokemon.form_index).ok_or_else(failure)?;
    let growth = content.progression.growth_rate(definition.growth_rate).ok_or_else(failure)?;
    let position = add_normal_classic_experience(growth, ExperiencePosition {
        level: pokemon.level, total: pokemon.experience,
    }, award.experience, u16::try_from(run.wave.get().get()).map_err(|_| failure())?)
        .map_err(|_| failure())?;
    let level_up = (position.level > pokemon.level).then(|| CurrentLevelUpV1 {
        award: award.clone(), previous_level: pokemon.level, new_level: position.level,
        previous_stats: pokemon.stats,
    });
    let mut candidate = before.clone();
    let target = candidate.active_run.as_mut().ok_or_else(failure)?.party
        .get_mut(usize::from(award.phase.party_index)).ok_or_else(failure)?;
    target.level = position.level;
    target.experience = position.total;
    Ok((candidate, level_up))
}

pub(crate) fn apply_current_level_up(
    before: &GameStateV6, content: &PreparedGameContentV2, level_up: &CurrentLevelUpV1,
) -> Result<(GameStateV6, CurrentLevelUpEndV1), GameRuntimeV6Error> {
    let (run, _) = context(before, content, level_up.award.phase.pending_id)?;
    let pokemon = phase_pokemon(run, &level_up.award.phase)?;
    if pokemon.level != level_up.new_level || level_up.previous_level >= level_up.new_level
        || level_up.previous_level != level_up.award.last_level
        || pokemon.stats != level_up.previous_stats
        || pokemon.max_hp != pokemon.stats.hp
    { return Err(failure()); }
    let bonuses = &pokemon.permanent_bonuses;
    if [bonuses.hp, bonuses.attack, bonuses.defense, bonuses.special_attack,
        bonuses.special_defense, bonuses.speed].iter().any(|value| *value != 0)
    { return Err(failure()); }
    let species = content.battle.species(pokemon.species_id).map_err(|_| failure())?;
    let form_id = er_types::FormId::parse(format!("{}:{}", pokemon.species_id.get().get(), pokemon.form_index))
        .map_err(|_| failure())?;
    let form = content.battle.form(&form_id).map_err(|_| failure())?;
    if form.species != pokemon.species_id { return Err(failure()); }
    let base = form.stat_override.unwrap_or(species.base_stats);
    let nature = content.progression.pack().natures.iter().find(|row| row.id == pokemon.effective_nature)
        .ok_or_else(failure)?;
    let stats = calculate_current_unmodified_stats(pokemon, base, nature).map_err(|_| failure())?;
    let hp = current_hp_after_stat_calculation(pokemon.hp, pokemon.max_hp, stats.hp).map_err(|_| failure())?;
    let mut candidate = before.clone();
    let target = candidate.active_run.as_mut().ok_or_else(failure)?.party
        .get_mut(usize::from(level_up.award.phase.party_index)).ok_or_else(failure)?;
    target.stats = stats;
    target.max_hp = stats.hp;
    target.hp = hp;
    // The runtime must have performed highest-level/LevelAchv work BEFORE this
    // call. The ensuing learn/evolution phase is explicitly still pending.
    Ok((candidate, CurrentLevelUpEndV1 { level_up: level_up.clone() }))
}

fn phase_pokemon<'a>(run: &'a RunStateV3, phase: &CurrentExperiencePhaseV1)
    -> Result<&'a PokemonStateV5, GameRuntimeV6Error>
{
    let pokemon = run.party.get(usize::from(phase.party_index)).ok_or_else(failure)?;
    if pokemon.id != phase.pokemon { return Err(failure()); }
    Ok(pokemon)
}

/// Actual end-of-level-up child creation. Source PhaseTree retains insertion
/// order: LearnMoveBatch before Evolution. Neither child is executed here.
pub(crate) fn plan_current_level_up_children(
    before: &GameStateV6, content: &PreparedGameContentV2, parent: &CurrentLevelUpEndV1,
) -> Result<CurrentLevelUpChildrenV1, GameRuntimeV6Error> {
    let level_up = &parent.level_up;
    let (run, _) = context(before, content, level_up.award.phase.pending_id)?;
    let pokemon = phase_pokemon(run, &level_up.award.phase)?;
    if pokemon.level != level_up.new_level || level_up.previous_level >= level_up.new_level {
        return Err(failure());
    }
    let definition = content.progression.species(pokemon.species_id, pokemon.form_index).ok_or_else(failure)?;
    let mut learn_move_candidates = Vec::new();
    if level_up.previous_level < 100 {
        let mut moves = definition.level_moves.iter().filter(|row| row.level > 0
            && i32::from(row.level) > i32::from(level_up.previous_level)
            && i32::from(row.level) <= i32::from(pokemon.level)).collect::<Vec<_>>();
        // Stable sort by level only, then deduplicate AFTER filtering; source
        // deliberately allows the same move at multiple learnset levels.
        moves.sort_by_key(|row| row.level);
        for row in moves {
            if !learn_move_candidates.contains(&row.move_id) { learn_move_candidates.push(row.move_id); }
        }
    }
    let mut evolution_candidates = Vec::new();
    if !pokemon.pause_evolutions {
        for id in &definition.evolutions {
            let evolution = content.progression.evolution(*id).ok_or_else(failure)?;
            if evolution.source_species != pokemon.species_id {
                return Err(failure());
            }
            if evolution.consume_item.is_some()
                || evolution.source_form.is_some_and(|form| form != pokemon.form_index)
            { continue; }
            if ordinary_evolution_condition(&evolution.condition, pokemon)? {
                evolution_candidates.push(*id);
            }
        }
    }
    Ok(CurrentLevelUpChildrenV1 { parent: parent.clone(), learn_move_candidates, evolution_candidates })
}

fn ordinary_evolution_condition(condition: &EvolutionConditionV2, pokemon: &PokemonStateV5)
    -> Result<bool, GameRuntimeV6Error>
{
    match condition {
        EvolutionConditionV2::Always => Ok(true),
        EvolutionConditionV2::MinimumLevel(level) => Ok(pokemon.level >= *level),
        EvolutionConditionV2::MinimumFriendship(value) => Ok(pokemon.friendship >= *value),
        EvolutionConditionV2::KnownMove(move_id) => Ok(pokemon.moves.iter().flatten().any(|slot| slot.move_id == *move_id)),
        EvolutionConditionV2::All(conditions) => {
            for condition in conditions {
                if !ordinary_evolution_condition(condition, pokemon)? { return Ok(false); }
            }
            Ok(true)
        }
        // No source RNG, time, inventory or conditional form query is invented.
        _ => Err(failure()),
    }
}

pub(crate) fn begin_current_learn_move_batch(
    before: &GameStateV6, content: &PreparedGameContentV2, children: &CurrentLevelUpChildrenV1,
) -> Result<CurrentLearnMoveBatchV1, GameRuntimeV6Error> {
    if plan_current_level_up_children(before, content, &children.parent)? != *children {
        return Err(failure());
    }
    let phase = &children.parent.level_up.award.phase;
    let (run, _) = context(before, content, phase.pending_id)?;
    let pokemon = phase_pokemon(run, phase)?;
    let mut offered = Vec::new();
    for move_id in &children.learn_move_candidates {
        if move_id.get() != SafeU53::ZERO && !offered.contains(move_id)
            && !pokemon.moves.iter().flatten().any(|slot| slot.move_id == *move_id)
        { offered.push(*move_id); }
    }
    Ok(CurrentLearnMoveBatchV1 {
        children: children.clone(), complete: offered.is_empty(), offered,
        original_moves: pokemon.moves, assignments: Vec::new(), pending_move: None, list_cursor: 0, cancel_confirmation: false,
    })
}

/// Apply one actual raw panel decision, not a terminal list reconstructed later.
/// The returned learned move is an obligatory tracker operation in this SAME
/// material; Undo restores moves only and does not erase those tracker stamps.
pub(crate) fn apply_current_learn_move_batch(
    before: &GameStateV6, content: &PreparedGameContentV2, batch: &CurrentLearnMoveBatchV1,
    action: &CurrentLearnMoveBatchActionV1,
) -> Result<(GameStateV6, CurrentLearnMoveBatchV1, Option<MoveId>), GameRuntimeV6Error> {
    let phase = &batch.children.parent.level_up.award.phase;
    let (run, _) = context(before, content, phase.pending_id)?;
    let pokemon = phase_pokemon(run, phase)?;
    if batch.complete || batch.offered.is_empty() || batch.assignments.len() >= batch.offered.len() { return Err(failure()); }
    let mut expected_offered = Vec::new();
    for id in &batch.children.learn_move_candidates {
        if id.get() != SafeU53::ZERO && !expected_offered.contains(id)
            && !batch.original_moves.iter().flatten().any(|slot| slot.move_id == *id) {
            expected_offered.push(*id);
        }
    }
    if batch.offered != expected_offered || batch.original_moves.windows(2)
        .any(|pair| pair[0].is_none() && pair[1].is_some()) { return Err(failure()); }
    let mut expected_moves = batch.original_moves;
    let mut seen = Vec::new();
    for assignment in &batch.assignments {
        if !batch.offered.contains(&assignment.move_id) || seen.contains(&assignment.move_id) {
            return Err(failure());
        }
        seen.push(assignment.move_id);
        *expected_moves.get_mut(usize::from(assignment.slot.get())).ok_or_else(failure)? =
            Some(new_learned_move(assignment.move_id));
    }
    if batch.pending_move.is_some_and(|id| !batch.offered.contains(&id) || seen.contains(&id)) {
        return Err(failure());
    }
    if pokemon.moves != expected_moves { return Err(failure()); }
    let mut result = batch.clone();
    let mut candidate = before.clone();
    let target = candidate.active_run.as_mut().ok_or_else(failure)?.party
        .get_mut(usize::from(phase.party_index)).ok_or_else(failure)?;
    if batch.cancel_confirmation != matches!(action, CurrentLearnMoveBatchActionV1::ConfirmCancel { .. }) {
        return Err(failure());
    }
    if batch.pending_move.is_some() != matches!(action,
        CurrentLearnMoveBatchActionV1::Assign { .. } | CurrentLearnMoveBatchActionV1::CancelSlot)
    { return Err(failure()); }
    let learned = match action {
        CurrentLearnMoveBatchActionV1::SelectMove { move_id } => {
            if !batch.offered.contains(move_id) || seen.contains(move_id) { return Err(failure()); }
            content.battle.move_definition(*move_id).map_err(|_| failure())?;
            result.list_cursor = u16::try_from(batch.offered.iter().filter(|id| !seen.contains(id))
                .position(|id| id == move_id).ok_or_else(failure)?).map_err(|_| failure())?;
            if let Some(index) = target.moves.iter().position(Option::is_none) {
                let slot = er_types::battle_ids::MoveSlotIndex::new(u8::try_from(index).map_err(|_| failure())?)
                    .map_err(|_| failure())?;
                target.moves[index] = Some(new_learned_move(*move_id));
                result.assignments.push(CurrentLearnMoveAssignmentV1 { move_id: *move_id, slot });
                result.complete = result.assignments.len() == result.offered.len();
                clamp_batch_cursor(&mut result)?;
                Some(*move_id)
            } else {
                result.pending_move = Some(*move_id);
                None
            }
        }
        CurrentLearnMoveBatchActionV1::Assign { move_id, slot } => {
            if batch.pending_move != Some(*move_id) || !batch.offered.contains(move_id)
                || seen.contains(move_id) || target.moves.iter().any(Option::is_none) {
                return Err(failure());
            }
            content.battle.move_definition(*move_id).map_err(|_| failure())?;
            *target.moves.get_mut(usize::from(slot.get())).ok_or_else(failure)? = Some(new_learned_move(*move_id));
            result.assignments.push(CurrentLearnMoveAssignmentV1 { move_id: *move_id, slot: *slot });
            result.pending_move = None;
            result.complete = result.assignments.len() == result.offered.len();
            clamp_batch_cursor(&mut result)?;
            Some(*move_id)
        }
        CurrentLearnMoveBatchActionV1::CancelSlot => {
            result.pending_move = None;
            None
        }
        CurrentLearnMoveBatchActionV1::Undo => {
            if batch.assignments.is_empty() { return Err(failure()); }
            result.list_cursor = u16::try_from(batch.offered.len() - batch.assignments.len()).map_err(|_| failure())?;
            target.moves = batch.original_moves;
            result.assignments.clear();
            None
        }
        CurrentLearnMoveBatchActionV1::Done => {
            result.list_cursor = u16::try_from(batch.offered.len() - batch.assignments.len()
                + usize::from(!batch.assignments.is_empty())).map_err(|_| failure())?;
            if result.assignments.is_empty() { result.cancel_confirmation = true; }
            else { result.complete = true; }
            None
        }
        CurrentLearnMoveBatchActionV1::ConfirmCancel { confirmed } => {
            if !batch.assignments.is_empty() { return Err(failure()); }
            result.cancel_confirmation = false;
            result.complete = *confirmed;
            None
        }
    };
    Ok((candidate, result, learned))
}

fn new_learned_move(move_id: MoveId) -> MoveSlotState {
    MoveSlotState { move_id, pp_used: 0, pp_ups: 0, max_pp_override: None }
}

fn clamp_batch_cursor(batch: &mut CurrentLearnMoveBatchV1) -> Result<(), GameRuntimeV6Error> {
    let remaining = u16::try_from(batch.offered.len().checked_sub(batch.assignments.len())
        .ok_or_else(failure)?).map_err(|_| failure())?;
    batch.list_cursor = batch.list_cursor.min(remaining);
    Ok(())
}

fn represented_experience(value: f64) -> Result<Experience, GameRuntimeV6Error> {
    if !value.is_finite() || value.fract() != 0.0 || !(0.0..=9_007_199_254_740_991.0).contains(&value) {
        return Err(failure());
    }
    SafeU53::new(value as u64).map(Experience::new).map_err(|_| failure())
}
