//! Initial wild enemy Faint: real prelude, animation callback, queued text.
//! The dispatcher owns actual presentation allocation/acknowledgement and any
//! reached achievement requests; these functions never release the turn.
use er_state::current_faint_execution::{CurrentFaintAddressV1, CurrentFaintPhaseV1, CurrentEnemyFaintHistoryV1};
use er_state::current_turn_execution::CurrentTurnStageV1;
use er_state::current_experience_owner::CurrentFriendshipPhaseV1;
use er_state::m9e_state_v6::GameStateV6;
use er_state::mechanic_state_v2::MechanicStateStoreV2;
use er_types::{SafeU53, PresentationEventId};
use er_types::battle_ids::BattleSide;
use er_types::battle_command::BattleCommand;
use er_types::battle_model::{StatStages, StatusState, StatusKind};
use crate::current_source_progression::current_source_progression;
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;

fn failure() -> GameRuntimeV6Error { GameRuntimeV6Error::Action }

fn faint_score(base_exp: SafeU53, level: u16, cap: u16, iv_sum: u32) -> Result<SafeU53, GameRuntimeV6Error> {
    if cap == 0 || level == 0 || iv_sum > 186 { return Err(failure()); }
    let score = ((base_exp.get() as f64) * (f64::from(level) / f64::from(cap))
        * ((f64::from(iv_sum) / 93.0) * 0.2 + 0.8)).ceil();
    if !score.is_finite() || !(0.0..=9_007_199_254_740_991.0).contains(&score) { return Err(failure()); }
    SafeU53::new(score as u64).map_err(|_| failure())
}

#[derive(Debug)]
pub(crate) struct CurrentFaintPrelude {
    /// Not independently publishable: the dispatcher binds Animation with its
    /// actual allocated event in this same canonical transaction.
    pub(crate) state: GameStateV6,
    pub(crate) address: CurrentFaintAddressV1,
    pub(crate) achievements: Vec<String>,
}

fn address(state: &GameStateV6, content: &PreparedGameContentV2, pending_id: SafeU53) -> Result<CurrentFaintAddressV1, GameRuntimeV6Error> {
    let source = current_source_progression(state, content)?;
    let run = state.active_run.as_ref().ok_or_else(failure)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    let turn = state.current_turn_execution.as_ref().ok_or_else(failure)?;
    let CurrentTurnStageV1::AwaitingInterlude { faints } = &turn.stage else { return Err(failure()); };
    if faints.len() != 1 || turn.finalization_done || turn.next_action == 0 { return Err(failure()); }
    let faint = &faints[0];
    let enemy = battle.enemy_party.first().ok_or_else(failure)?;
    if faint.pokemon != source.initial_enemy.pokemon || enemy.id != faint.pokemon
        || faint.slot.side != BattleSide::Enemy || faint.slot.position != 0
        || enemy.hp != 0 || !enemy.fainted || enemy.form_index != 0 || enemy.level != source.initial_enemy.level
        || !TOWN_NONBOSS_SPECIES.contains(&enemy.species_id.get().get())
    { return Err(failure()); }
    // All source Faint/KO/victory ability families for the admitted24 IDs and
    // post-victory move families for27 IDs are observed empty. The source live
    // helper validates those IDs, modifiers, suppression and selected slots.
    // Unrepresented volatile/form/tera interactions remain unsupported here.
    for pokemon in run.party.iter().chain(&battle.enemy_party) {
        if pokemon.mechanics != MechanicStateStoreV2::default() || pokemon.tera_type.is_some() {
            return Err(failure());
        }
    }
    let observation = state.current_battle_participation.as_ref().ok_or_else(failure)?;
    let owner = observation.experience.as_ref().ok_or_else(failure)?;
    if owner.pending.len() != 1 { return Err(failure()); }
    let pending = owner.pending.iter().find(|p| p.id == pending_id).ok_or_else(failure)?;
    let observed = observation.faints.iter().find(|f| f.occurrence == pending.observation).ok_or_else(failure)?;
    if observed.pokemon != faint.pokemon || observed.slot != faint.slot
        || observed.current_faint != Some(faint.id) || observed.current_action != Some(turn.next_action)
        || observed.before_hp == 0 || pending.source.pokemon != faint.pokemon
        || observed.resolved_turn != turn.turn || pending.participants != observed.participants
    { return Err(failure()); }
    let selected = turn.actions.get(usize::from(turn.next_action - 1)).ok_or_else(failure)?;
    let BattleCommand::Fight { actor, move_slot, .. } = &selected.command else { return Err(failure()); };
    if !run.party.iter().any(|p| p.id == *actor && p.hp > 0) { return Err(failure()); }
    if selected.source_slot.side != BattleSide::Player
        || !battle.field.slots.iter().any(|s| s.slot == selected.source_slot && s.occupant == Some(*actor))
        || !selected.current_targets.as_ref().is_some_and(|targets| targets.contains(&faint.slot))
    { return Err(failure()); }
    // The real MoveDamage boundary retains this BEFORE PP consumption can make
    // a last-PP move unavailable or turn a subsequent query into Struggle.
    let resolved = faint.source_move.as_ref().ok_or_else(failure)?;
    if resolved.pokemon != *actor { return Err(failure()); }
    let move_id = resolved.move_id;
    let live_actor = run.party.iter().find(|pokemon| pokemon.id == *actor).ok_or_else(failure)?;
    match &resolved.struggle_pp_before {
        None => {
            if !live_actor.moves[usize::from(move_slot.get())].as_ref().is_some_and(|slot| slot.move_id == move_id) {
                return Err(failure());
            }
            content.battle.move_definition(move_id).map_err(|_| failure())?;
        }
        Some(slots) => {
            if &live_actor.moves != slots || move_id.get().get() != 165 { return Err(failure()); }
            let mut pre_action = live_actor.clone();
            pre_action.moves = *slots;
            let (definition, fallback) = er_battle::m7_resolver::effective_move_definition_v5(&content.battle, &pre_action, *move_slot).map_err(|_| failure())?;
            if !fallback || definition.id != move_id { return Err(failure()); }
        }
    }
    if !matches!(move_id.get().get(), 10 | 33 | 39 | 40 | 43 | 45 | 57 | 78 | 79 | 98 | 103 | 105 | 108 | 110 | 165 | 230 | 310 | 336 | 448 | 501 | 580) {
        return Err(failure());
    }
    let tracker = state.current_achievement_tracker.as_ref().ok_or_else(failure)?;
    let tracker_battle = tracker.battle.as_ref().ok_or_else(failure)?;
    let killer = tracker_battle.enemy_ko_killers.get(&faint.pokemon).ok_or_else(failure)?;
    if tracker.run_id != run.run_id || tracker_battle.wave_index != run.wave
        || killer.user_id != *actor || killer.field_index != selected.source_slot.position
    { return Err(failure()); }
    for slot in battle.field.slots.iter().filter(|s| s.slot.side == BattleSide::Player) {
        if let Some(id) = slot.occupant {
            let pokemon = run.party.iter().find(|p| p.id == id).ok_or_else(failure)?;
            let seat = pokemon.owner_seat.ok_or_else(failure)?;
            if !pending.participants.iter().any(|p| p.pokemon == id && p.owner == seat)
                || !observation.participants.iter().any(|p| p.pokemon == id && p.owner == seat)
            { return Err(failure()); }
        }
    }
    let metadata = content.progression.experience_for_compiled_form(enemy.species_id, enemy.form_index).map_err(|_| failure())?;
    if metadata.base_exp != pending.source.unadjusted_base_exp || pending.defeated_level != enemy.level { return Err(failure()); }
    let cap = er_progression::current_experience::normal_classic_level_cap(u16::try_from(run.wave.get().get()).map_err(|_| failure())?).map_err(|_| failure())?;
    let iv_sum: u32 = enemy.ivs.iter().map(|iv| u32::from(iv.get())).sum();
    let score_increase = faint_score(metadata.base_exp, enemy.level, cap, iv_sum)?;
    Ok(CurrentFaintAddressV1 { pending_id, observation: pending.observation, faint_id: faint.id,
        pokemon: enemy.id, slot: faint.slot, turn: turn.turn, source: *actor, move_id,
        score_increase })
}

pub(crate) fn prepare_current_enemy_faint(before: &GameStateV6, content: &PreparedGameContentV2, pending_id: SafeU53) -> Result<CurrentFaintPrelude, GameRuntimeV6Error> {
    let address = address(before, content, pending_id)?;
    let source = current_source_progression(before, content)?;
    if !source.initial_faint.valid(source.initial_enemy.pokemon) || source.initial_faint.phase.is_some() { return Err(failure()); }
    let pending = before.current_battle_participation.as_ref().and_then(|p| p.experience.as_ref())
        .and_then(|o| o.pending.first()).ok_or_else(failure)?;
    if pending.victory.is_some() || pending.friendship.as_ref() != Some(&CurrentFriendshipPhaseV1::default()) { return Err(failure()); }
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    if !run.battle.as_ref().ok_or_else(failure)?.field.slots.iter().any(|s| s.slot == address.slot && s.occupant == Some(address.pokemon)) { return Err(failure()); }
    let mut candidate = before.clone();
    let enemy = candidate.active_run.as_mut().and_then(|run| run.battle.as_mut()).and_then(|battle| battle.enemy_party.first_mut()).ok_or_else(failure)?;
    enemy.stat_stages = StatStages { attack: 0, defense: 0, special_attack: 0, special_defense: 0, speed: 0, accuracy: 0, evasion: 0 };
    // Tera and volatile state were explicitly admitted neutral above. Summon
    // resets therefore have no hidden form, copied ability or tag descendants.
    let tracker = candidate.current_achievement_tracker.as_mut().and_then(|t| t.battle.as_mut()).ok_or_else(failure)?;
    if tracker.enemy_ko_turns.contains_key(&address.pokemon) { return Err(failure()); }
    if tracker.faint_ledger_turn != Some(address.turn) {
        tracker.faint_ledger_turn = Some(address.turn);
        tracker.player_field_faints.clear();
        tracker.enemy_field_faints.clear();
    }
    tracker.enemy_field_faints.insert(address.pokemon);
    tracker.enemy_ko_turns.insert(address.pokemon, address.turn);
    if tracker.longest_turn_number != Some(address.turn) {
        tracker.longest_turn_number = Some(address.turn);
        tracker.longest_turn_effects = Some(Default::default());
    }
    let effects = tracker.longest_turn_effects.get_or_insert_with(Default::default);
    effects.insert(format!("faint:{}", address.pokemon.get()));
    let mut achievements = Vec::new();
    if effects.len() >= 10 { achievements.push("THE_LONGEST_TURN".to_owned()); }
    if tracker.no_sell_token.as_ref().is_some_and(|token| token.attacker_id == address.pokemon) {
        tracker.no_sell_token = None;
        achievements.push("NO_SELL".to_owned());
    }
    let source = candidate.current_battle_participation.as_mut().and_then(|p| p.experience.as_mut())
        .and_then(|o| o.source_progression.as_mut()).ok_or_else(failure)?;
    source.initial_faint.enemy_faints = 1;
    source.initial_faint.history.push(CurrentEnemyFaintHistoryV1 { pokemon: address.pokemon, turn: address.turn });
    Ok(CurrentFaintPrelude { state: candidate, address, achievements })
}

/// Invoked only after the actual faintCry/tween presentation callback. The
/// queued MessagePhase has not executed yet; it is the next retained child.
pub(crate) fn complete_current_faint_animation(before: &GameStateV6, content: &PreparedGameContentV2, pending_id: SafeU53, event_id: PresentationEventId) -> Result<GameStateV6, GameRuntimeV6Error> {
    let expected = address(before, content, pending_id)?;
    let source = current_source_progression(before, content)?;
    if !matches!(&source.initial_faint.phase, Some(CurrentFaintPhaseV1::Animation { address, event_id: retained }) if address == &expected && *retained == event_id) { return Err(failure()); }
    let mut candidate = before.clone();
    let battle = candidate.active_run.as_mut().and_then(|run| run.battle.as_mut()).ok_or_else(failure)?;
    let slot = battle.field.slots.iter_mut().find(|s| s.slot == expected.slot).ok_or_else(failure)?;
    if slot.occupant != Some(expected.pokemon) { return Err(failure()); }
    let enemy = battle.enemy_party.first_mut().ok_or_else(failure)?;
    enemy.status = StatusState { kind: StatusKind::None, toxic_turn_count: 0, sleep_turns_remaining: None };
    enemy.fainted = true;
    slot.occupant = None;
    // No held items exist in the admitted context, so Wasteland/drop/loot loops
    // are actually empty. Normal Classic has no Endless grave/raid replacement.
    let source = candidate.current_battle_participation.as_mut().and_then(|p| p.experience.as_mut())
        .and_then(|o| o.source_progression.as_mut()).ok_or_else(failure)?;
    source.initial_faint.battle_score = expected.score_increase;
    source.initial_faint.phase = Some(CurrentFaintPhaseV1::MessageReady { address: expected });
    Ok(candidate)
}

pub(crate) fn complete_current_faint_message(before: &GameStateV6, content: &PreparedGameContentV2, pending_id: SafeU53, event_id: PresentationEventId) -> Result<GameStateV6, GameRuntimeV6Error> {
    let expected = address(before, content, pending_id)?;
    let source = current_source_progression(before, content)?;
    if !matches!(&source.initial_faint.phase, Some(CurrentFaintPhaseV1::Message { address, event_id: retained }) if address == &expected && *retained == event_id) { return Err(failure()); }
    let battle = before.active_run.as_ref().and_then(|run| run.battle.as_ref()).ok_or_else(failure)?;
    if battle.field.slots.iter().any(|slot| slot.occupant == Some(expected.pokemon)) { return Err(failure()); }
    let mut candidate = before.clone();
    let source = candidate.current_battle_participation.as_mut().and_then(|p| p.experience.as_mut())
        .and_then(|o| o.source_progression.as_mut()).ok_or_else(failure)?;
    source.initial_faint.phase = Some(CurrentFaintPhaseV1::ReadyForVictory { address: expected });
    Ok(candidate)
}

pub(crate) fn validate_current_initial_faint(state: &GameStateV6, content: &PreparedGameContentV2) -> Result<(), GameRuntimeV6Error> {
    let Some(source) = state.current_battle_participation.as_ref().and_then(|p| p.experience.as_ref())
        .and_then(|o| o.source_progression.as_ref()) else { return Ok(()); };
    if !source.initial_faint.valid(source.initial_enemy.pokemon) { return Err(failure()); }
    if !matches!(source.initial_faint.phase, Some(CurrentFaintPhaseV1::ReadyForVictory { .. })) {
        let owner = state.current_battle_participation.as_ref().and_then(|p| p.experience.as_ref()).ok_or_else(failure)?;
        if owner.pending.iter().any(|pending| pending.victory.is_some()
            || pending.friendship.as_ref() != Some(&CurrentFriendshipPhaseV1::default())) { return Err(failure()); }
    }
    let Some(phase) = &source.initial_faint.phase else { return Ok(()); };
    let expected = address(state, content, phase.address().pending_id)?;
    if phase.address() != &expected { return Err(failure()); }
    let battle = state.active_run.as_ref().and_then(|run| run.battle.as_ref()).ok_or_else(failure)?;
    let slot = battle.field.slots.iter().find(|slot| slot.slot == expected.slot).ok_or_else(failure)?;
    let is_animation = matches!(phase, CurrentFaintPhaseV1::Animation { .. });
    if slot.occupant != if is_animation { Some(expected.pokemon) } else { None } { return Err(failure()); }
    let enemy = battle.enemy_party.first().ok_or_else(failure)?;
    let neutral = StatStages { attack: 0, defense: 0, special_attack: 0, special_defense: 0, speed: 0, accuracy: 0, evasion: 0 };
    if enemy.stat_stages != neutral || (!is_animation && enemy.status != (StatusState { kind: StatusKind::None, toxic_turn_count: 0, sleep_turns_remaining: None })) { return Err(failure()); }
    let tracker = state.current_achievement_tracker.as_ref().and_then(|t| t.battle.as_ref()).ok_or_else(failure)?;
    if tracker.faint_ledger_turn != Some(expected.turn) || !tracker.enemy_field_faints.contains(&expected.pokemon)
        || tracker.enemy_ko_turns.get(&expected.pokemon) != Some(&expected.turn)
        || tracker.longest_turn_number != Some(expected.turn)
        || !tracker.longest_turn_effects.as_ref().is_some_and(|effects| effects.contains(&format!("faint:{}", expected.pokemon.get())))
    { return Err(failure()); }
    Ok(())
}

// Actual complete initialized Town pool:45 rows/67 species, audited83330acd.
// All67 predicates are nonlegendary/nonboss at initial wave1/level5/defaults.
const TOWN_NONBOSS_SPECIES: &[u64] = &[10,13,16,19,21,23,29,32,43,46,48,52,63,69,132,133,161,163,165,167,172,173,174,175,187,191,261,263,265,266,268,270,273,276,280,283,285,290,293,300,396,399,401,415,420,440,446,447,504,506,509,519,543,546,570,572,661,664,734,819,821,824,831,915,921,924,926];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faint_score_matches_five_actual_source_method_observations() {
        // Actual source399d addFaintedEnemyScore, two fresh processes:
        // c7eb39db6309519a91c6ec7739ea56300d815790 / run34421333412.
        // Source-only score projection SHA256:
        // d7c31a98f94b9cf51b96ea37427e546813aa4157753d5b072c82c074da1f608a.
        // These expected increments are observed method outputs, not a second formula.
        let base_exp = SafeU53::new(50).expect("observed base XP");
        for (level, ivs, expected) in [
            (2, [6_u32, 16, 8, 6, 15, 1], 10),
            (1, [0; 6], 4),
            (5, [31; 6], 31),
            (13, [0, 1, 2, 3, 4, 5], 55),
            (2, [15; 6], 10),
        ] {
            assert_eq!(faint_score(base_exp, level, 10, ivs.iter().sum()).expect("observed score").get(), expected);
        }
        assert!(faint_score(base_exp, 2, 0, 0).is_err());
        assert!(faint_score(base_exp, 2, 10, 187).is_err());
    }
}
