//! Source-ordered action hooks for the retained ordinary initial Town encounter.
use std::collections::{BTreeMap, BTreeSet};

use er_battle::m7_resolver::BattlePresentationCueV5;
use er_state::current_achievement_tracker::{
    CurrentAchievementBattleV1, CurrentAchievementKillerV1, CurrentAchievementKoStintV1,
    CurrentAchievementNoSellV1, CurrentAchievementSpreadMoveV1, CurrentAchievementTrackerV1,
};
use er_state::current_battle_source_events::{
    CurrentBattleSourceEventV1, CurrentHitCheckV1, CurrentMoveUseModeV1, CurrentResolvedHitCheckV1,
};
use er_state::current_turn_execution::CurrentTurnStageV1;
use er_state::m7_state::{PokemonStateV5, RunStateV3};
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_ids::{BattleSide, FieldSlot, MoveId, PokemonId, TurnIndex, WaveIndex};
use er_types::battle_model::{MoveCategory, MovePower};

use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;

fn failure() -> GameRuntimeV6Error {
    GameRuntimeV6Error::Action
}

/// Complete unique species set from pinned399d townBiome.pokemonPool. The
/// initialized source observer additionally checks every row's legendary flags
/// and actual first-wave boss predicate; neither wave1 nor a sampled enemy alone
/// authorizes this branch. Later encounter/form/configuration owners are distinct.
const INITIAL_TOWN_SPECIES: [u64; 67] = [
    10, 13, 16, 19, 21, 23, 29, 32, 43, 46, 48, 52, 63, 69, 132, 133, 161, 163, 165, 167, 172, 173,
    174, 175, 187, 191, 261, 263, 265, 266, 268, 270, 273, 276, 280, 283, 285, 290, 293, 300, 396,
    399, 401, 415, 420, 440, 446, 447, 504, 506, 509, 519, 543, 546, 570, 572, 661, 664, 734, 819,
    821, 824, 831, 915, 921, 924, 926,
];

/// Fold actual resolver observations before the outer runtime installs the
/// returned tracker and dispatches ordered keys. It never grants a reward itself.
pub(crate) fn fold_current_achievement_action(
    before: &GameStateV6,
    after: &GameStateV6,
    content: &PreparedGameContentV2,
    events: &[CurrentBattleSourceEventV1],
    cues: &[BattlePresentationCueV5],
) -> Result<(CurrentAchievementTrackerV1, Vec<String>), GameRuntimeV6Error> {
    for state in [before, after] {
        let source = crate::current_source_progression::current_source_progression(state, content)?;
        let run = state.active_run.as_ref().ok_or_else(failure)?;
        if run.world.biome.get().get() != 0
            || source.initial_enemy.form_index != 0
            || !INITIAL_TOWN_SPECIES.contains(&source.initial_enemy.species.get().get())
        {
            return Err(failure());
        }
        // The shared helper binds all content hashes to the qualified targeting
        // cohort and this exact retained initial enemy; check the actual compiled
        // Town membership too, rather than accepting a free-standing species ID.
        let biome = content.world.biome(run.world.biome).ok_or_else(failure)?;
        let ids: BTreeSet<_> = biome
            .pokemon_pools
            .iter()
            .flat_map(|pool| &pool.species)
            .map(|id| id.get().get())
            .collect();
        if biome.key != "biome/0"
            || biome.trainer_chance_denominator != 0
            || ids != INITIAL_TOWN_SPECIES.into_iter().collect()
        {
            return Err(failure());
        }
    }
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let targeting = er_battle::current_target_execution::CurrentTargetExecution::from_state(before)
        .map_err(|_| failure())?;
    if before.current_turn_execution.as_ref().is_some_and(|turn| {
        usize::from(turn.next_action) == turn.actions.len()
    }) {
        // The current finalizer only advances/clears the turn. FreshComplete
        // cannot silently omit actual residual or PostTurn callbacks.
        let battle = run.battle.as_ref().ok_or_else(failure)?;
        for pokemon in run.party.iter().chain(&battle.enemy_party) {
            if pokemon.status.kind != er_types::battle_model::StatusKind::None
                || pokemon.mechanics != er_state::mechanic_state_v2::MechanicStateStoreV2::default()
                || battle.mechanics != er_state::mechanic_state_v2::MechanicStateStoreV2::default()
                || targeting.ability_sources(run, pokemon).map_err(|_| failure())?.iter().any(|source| {
                    matches!(source, er_types::BehaviorSourceId::ActiveAbility { numeric_id }
                        | er_types::BehaviorSourceId::PassiveAbility { numeric_id } if numeric_id.get() == 5082)
                }) {
                return Err(GameRuntimeV6Error::Domain(
                    "current TurnFinish requires owned residual or PostTurn execution".to_owned(),
                ));
            }
        }
    }
    for event in events {
        if let CurrentBattleSourceEventV1::MoveResolution { user, move_id, .. } = event {
            let actor = member(run, *user)?;
            let definition = content
                .battle
                .move_definition(*move_id)
                .map_err(|_| failure())?;
            if matches!(definition.category, MoveCategory::Status)
                || matches!(definition.power, MovePower::None)
                // Pinned ER Growl is a damaging move with StatStageChangeAttr.
                // Category alone cannot prove its queued stat child executed.
                || move_id.get().get() == 45
            {
                // The current resolver records status hit checks but does not
                // execute the owned source effect/callback. A complete history
                // cannot certify this as a successful no-op move.
                return Err(GameRuntimeV6Error::Domain(
                    "current move requires owned source status or stat effect execution".to_owned(),
                ));
            }
            if move_id.get().get() == 165 {
                let turn = before.current_turn_execution.as_ref().ok_or_else(failure)?;
                let selected = turn.actions.get(usize::from(turn.next_action)).ok_or_else(failure)?;
                let er_types::battle_command::BattleCommand::Fight { actor: selected_actor, move_slot, .. } = &selected.command else { return Err(failure()); };
                let (effective, fallback) = er_battle::m7_resolver::effective_move_definition_v5(&content.battle, actor, *move_slot).map_err(|_| failure())?;
                let owner = before.current_random_target_commands.as_ref().ok_or_else(failure)?;
                owner.validate(run, Some(turn)).map_err(|_| failure())?;
                let proof = owner.entries.iter().find(|entry| entry.command == selected.accepted).ok_or_else(failure)?;
                if !fallback || effective.id != *move_id || *selected_actor != actor.id
                    || selected.current_targets.as_deref() != Some(&[proof.selected]) {
                    return Err(failure());
                }
                // Actual initialized registry plus complete attribute ancestry:
                // no admitted recoil multiplier, PostDamage or BoobyTrap callback.
                // Command ownership supplies the real earlier draw; this call only
                // rechecks the admitted neutral context and never spends RNG.
                targeting.random_command_candidates(run, actor.id, definition).map_err(|_| failure())?;
            } else {
                targeting.plan(run, actor.id, definition).map_err(|_| failure())?;
            }
        }
    }
    fold_source_admitted_action(before, after, content, events, cues)
}

/// The source-context wrapper must admit both snapshots before entering here.
/// In particular, a retained initial wave alone cannot prove a non-boss enemy.
/// This private driver cannot be used as a source-context bypass by a caller.
fn fold_source_admitted_action(
    before: &GameStateV6,
    after: &GameStateV6,
    content: &PreparedGameContentV2,
    events: &[CurrentBattleSourceEventV1],
    cues: &[BattlePresentationCueV5],
) -> Result<(CurrentAchievementTrackerV1, Vec<String>), GameRuntimeV6Error> {
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let next_run = after.active_run.as_ref().ok_or_else(failure)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    let tracker = before
        .current_achievement_tracker
        .as_ref()
        .ok_or_else(failure)?;
    if !tracker.valid(run)
        || after.current_achievement_tracker.as_ref() != Some(tracker)
        || before.content_identity != after.content_identity
        || before.content_identity != *content.identity()
        || run.party.len() != next_run.party.len()
        || run
            .party
            .iter()
            .zip(&next_run.party)
            .any(|(old, new)| old.id != new.id || old.stat_stages != new.stat_stages)
    {
        return Err(failure());
    }
    // A source player stat-stage hook is not yet emitted by this event sink.
    // Reject a changed stage rather than silently lose its +6 stint bookkeeping.
    let mut fold = ActionFold {
        tracker: tracker.clone(),
        keys: Vec::new(),
        wave: run.wave,
        turn: battle.turn,
    };
    match (
        &before.current_turn_execution,
        &after.current_turn_execution,
    ) {
        (None, Some(next)) => {
            next.validate(next_run).map_err(|_| failure())?;
            if next.next_action != 0
                || next.finalization_done
                || next.stage != CurrentTurnStageV1::ReadyForMove
                || next.turn != battle.turn
                || !events.is_empty()
                || !cues.is_empty()
            {
                return Err(failure());
            }
            // Actual TurnStart occurs before any action, and initializes even
            // an empty live player field. Existing per-Pokemon stints survive.
            fold.state();
            for row in &battle.field.slots {
                if row.slot.side != BattleSide::Player {
                    continue;
                }
                if let Some(id) = row.occupant {
                    let pokemon = at_slot(run, row.slot, id)?;
                    if !pokemon.fainted && pokemon.hp > 0 {
                        fold.turn_start_player(id, pokemon.hp, pokemon.max_hp)?;
                    }
                }
            }
        }
        (Some(previous), Some(next)) => {
            previous.validate(run).map_err(|_| failure())?;
            next.validate(next_run).map_err(|_| failure())?;
            if previous.finalization_done
                || previous.stage != CurrentTurnStageV1::ReadyForMove
                || previous.accepted_commands != next.accepted_commands
                || previous.run != next.run
                || previous.battle != next.battle
                || previous.wave != next.wave
                || previous.turn != next.turn
                || previous.authority != next.authority
                || previous.authority_revision != next.authority_revision
            {
                return Err(failure());
            }
            if next.finalization_done {
                if usize::from(previous.next_action) != previous.actions.len()
                    || previous.next_action != next.next_action
                    || !events.is_empty()
                {
                    return Err(failure());
                }
            } else {
                if previous.next_action.checked_add(1) != Some(next.next_action) {
                    return Err(failure());
                }
                let selected = previous
                    .actions
                    .get(usize::from(previous.next_action))
                    .ok_or_else(failure)?;
                let selected_move = match &selected.command {
                    er_types::battle_command::BattleCommand::Fight {
                        actor, move_slot, ..
                    } => Some(
                        er_battle::m7_resolver::effective_move_definition_v5(
                            &content.battle,
                            member(run, *actor)?,
                            *move_slot,
                        )
                        .map_err(|_| failure())?
                        .0
                        .id,
                    ),
                    er_types::battle_command::BattleCommand::Switch { .. } => None,
                };
                if events.iter().any(|event| match event {
                    CurrentBattleSourceEventV1::MoveResolution {
                        user,
                        source_slot,
                        move_id,
                        ..
                    }
                    | CurrentBattleSourceEventV1::StruggleRecoilDamage {
                        user,
                        source_slot,
                        move_id,
                        ..
                    }
                    | CurrentBattleSourceEventV1::MoveDamage {
                        user,
                        source_slot,
                        move_id,
                        ..
                    } => {
                        *user != selected.command.actor()
                            || *source_slot != selected.source_slot
                            || Some(*move_id) != selected_move
                    }
                }) {
                    return Err(failure());
                }
            }
            if fold
                .tracker
                .battle
                .as_ref()
                .is_none_or(|state| state.wave_index != run.wave)
            {
                return Err(failure());
            }
        }
        (Some(previous), None) => {
            previous.validate(run).map_err(|_| failure())?;
            if previous.finalization_done
                || previous.stage != CurrentTurnStageV1::ReadyForMove
                || usize::from(previous.next_action) != previous.actions.len()
                || !events.is_empty()
            {
                return Err(failure());
            }
            // Residual HP changes still fail the action preimage check below;
            // they require an actual DamageAndUpdate source event extension.
        }
        (None, None) => return Err(failure()),
    }
    fold.action(run, next_run, content, events, cues)?;
    if !fold.tracker.valid(next_run) {
        return Err(failure());
    }
    Ok((fold.tracker, fold.keys))
}

/// Created only by the actual source-context admission wrapper above.
/// This is not an alternate public method accepting arbitrary source booleans.
struct ActionFold {
    tracker: CurrentAchievementTrackerV1,
    keys: Vec<String>,
    wave: WaveIndex,
    turn: TurnIndex,
}

impl ActionFold {
    fn action(
        &mut self,
        before: &RunStateV3,
        after: &RunStateV3,
        content: &PreparedGameContentV2,
        events: &[CurrentBattleSourceEventV1],
        cues: &[BattlePresentationCueV5],
    ) -> Result<(), GameRuntimeV6Error> {
        let battle = before.battle.as_ref().ok_or_else(failure)?;
        let next_battle = after.battle.as_ref().ok_or_else(failure)?;
        if before.run_id != after.run_id
            || before.wave != after.wave
            || battle.battle_id != next_battle.battle_id
            || events.len() > 7
            || battle.enemy_party.len() != next_battle.enemy_party.len()
        {
            return Err(failure());
        }
        let mut hp: BTreeMap<_, _> = before
            .party
            .iter()
            .chain(&battle.enemy_party)
            .map(|pokemon| (pokemon.id, pokemon.hp))
            .collect();
        let mut damage_cues = Vec::new();
        let mut resolution = None;
        let mut damaged = BTreeSet::new();
        let mut recoil_seen = false;
        for event in events {
            match event {
                CurrentBattleSourceEventV1::MoveResolution {
                    user,
                    source_slot,
                    move_id,
                    use_mode,
                    first_hit,
                    targets,
                } => {
                    if resolution.is_some()
                        || !*first_hit
                        || *use_mode != CurrentMoveUseModeV1::Direct
                        || targets.is_empty()
                        || targets.len() > 6
                        || !damage_cues.is_empty()
                    {
                        return Err(failure());
                    }
                    let actor = at_slot(before, *source_slot, *user)?;
                    if actor.fainted
                        || actor.hp == 0
                        || actor.hp > actor.max_hp
                        || (move_id.get().get() != 165 && !actor
                            .moves
                            .iter()
                            .flatten()
                            .any(|slot| slot.move_id == *move_id))
                    {
                        return Err(failure());
                    }
                    let definition = content
                        .battle
                        .move_definition(*move_id)
                        .map_err(|_| failure())?;
                    let mut slots = BTreeSet::new();
                    for row in targets {
                        let target = at_slot(before, row.slot, row.target)?;
                        if target.fainted || target.hp == 0 || target.hp > target.max_hp {
                            return Err(failure());
                        }
                        if !slots.insert(row.slot)
                            || !matches!(
                                row.result,
                                CurrentHitCheckV1::Hit
                                    | CurrentHitCheckV1::Miss
                                    | CurrentHitCheckV1::NoEffect
                                    | CurrentHitCheckV1::NoEffectNoMessage
                            )
                        {
                            return Err(failure());
                        }
                    }
                    self.move_resolution(
                        *user,
                        source_slot.side == BattleSide::Player,
                        *move_id,
                        definition.category,
                        battle.format.player_capacity == 2,
                        targets,
                    )?;
                    resolution = Some((*user, *source_slot, *move_id, targets));
                }
                CurrentBattleSourceEventV1::MoveDamage {
                    user,
                    source_slot,
                    target,
                    target_slot,
                    move_id,
                    use_mode,
                    damage,
                    target_hp_before,
                    target_hp_after,
                    target_max_hp,
                    super_effective,
                    hit_count,
                    hits_left,
                    ..
                } => {
                    let (resolved_user, resolved_slot, resolved_move, targets) =
                        resolution.ok_or_else(failure)?;
                    let holder = at_slot(before, *target_slot, *target)?;
                    if recoil_seen || (resolved_user, resolved_slot, resolved_move)
                        != (*user, *source_slot, *move_id)
                        || *use_mode != CurrentMoveUseModeV1::Direct
                        || (*hit_count, *hits_left) != (1, 1)
                        || !damaged.insert(*target)
                        || *damage == 0
                        || hp.get(target) != Some(target_hp_before)
                        || holder.max_hp != *target_max_hp
                        || target_hp_before.checked_sub(*damage) != Some(*target_hp_after)
                        || !targets.iter().any(|row| {
                            row.target == *target
                                && row.slot == *target_slot
                                && row.result == CurrentHitCheckV1::Hit
                        })
                    {
                        return Err(failure());
                    }
                    hp.insert(*target, *target_hp_after);
                    damage_cues.push((*target, *target_hp_before, *target_hp_after));
                    // Source recordDamageSource fires before every following
                    // MoveDamage tracker update and achievement dispatch.
                    self.damage_source(*target, *user);
                    if source_slot.side == BattleSide::Enemy
                        && target_slot.side == BattleSide::Player
                        && *super_effective
                    {
                        self.enemy_super_effective_survival(
                            *user,
                            *target,
                            *target_hp_before,
                            *target_hp_after,
                        );
                    }
                    if source_slot.side == BattleSide::Player
                        && target_slot.side == BattleSide::Enemy
                    {
                        let definition = content
                            .battle
                            .move_definition(*move_id)
                            .map_err(|_| failure())?;
                        if definition.category != MoveCategory::Status {
                            self.state().player_dealt_direct_damage = true;
                        }
                        if *target_hp_after == 0 {
                            self.player_direct_ko(*user, *source_slot, *target, *move_id)?;
                        }
                    }
                }
                CurrentBattleSourceEventV1::StruggleRecoilDamage {
                    user, source_slot, move_id, requested_damage, damage,
                    hp_before, hp_after, max_hp,
                } => {
                    let (resolved_user, resolved_slot, resolved_move, targets) =
                        resolution.ok_or_else(failure)?;
                    let holder = at_slot(before, *source_slot, *user)?;
                    let expected_request = (holder.max_hp / 4).max(u32::from(!damaged.is_empty()));
                    if recoil_seen || (resolved_user, resolved_slot, resolved_move) != (*user, *source_slot, *move_id)
                        || move_id.get().get() != 165
                        || !targets.iter().any(|target| target.result == CurrentHitCheckV1::Hit)
                        || hp.get(user) != Some(hp_before)
                        || *hp_before == 0 || holder.max_hp != *max_hp
                        || *requested_damage != expected_request
                        || *damage != expected_request.min(*hp_before)
                        || hp_before.checked_sub(*damage) != Some(*hp_after) {
                        return Err(failure());
                    }
                    recoil_seen = true;
                    hp.insert(*user, *hp_after);
                    damage_cues.push((*user, *hp_before, *hp_after));
                    if *damage > 0 {
                        // RecoilAttr supplies no source Pokemon to damageAndUpdate.
                        // This hook is neither a direct KO nor a longest-turn effect.
                        self.record_damage_source(*user, "field:indirect".to_owned());
                    }
                }
            }
        }
        let mut damage_cursor = 0;
        let mut move_cues = 0;
        let mut recoil_messages = 0;
        let mut switched = false;
        let mut healing_started = false;
        for cue in cues {
            match cue {
                BattlePresentationCueV5::MoveUsed { pokemon, move_id } => {
                    let (user, _, resolved_move, _) = resolution.ok_or_else(failure)?;
                    if user != *pokemon || resolved_move != *move_id {
                        return Err(failure());
                    }
                    move_cues += 1;
                }
                BattlePresentationCueV5::HpChanged {
                    pokemon,
                    before,
                    after,
                } => {
                    // Unobserved recoil/residual/drain hooks need their own
                    // source event. Never invent a damage source from this cue.
                    if healing_started
                        || damage_cues.get(damage_cursor) != Some(&(*pokemon, *before, *after))
                    {
                        return Err(failure());
                    }
                    damage_cursor += 1;
                }
                BattlePresentationCueV5::RecoilMessage { pokemon } => {
                    let (user, _, move_id, _) = resolution.ok_or_else(failure)?;
                    if !recoil_seen || *pokemon != user || move_id.get().get() != 165
                        || damage_cursor != damage_cues.len() || recoil_messages != 0 {
                        return Err(failure());
                    }
                    recoil_messages += 1;
                }
                BattlePresentationCueV5::AbilityHeal {
                    pokemon,
                    before: old,
                    after: new,
                    ..
                } => {
                    healing_started = true;
                    let holder = member(before, *pokemon)?;
                    if recoil_messages != usize::from(recoil_seen)
            || damage_cursor != damage_cues.len()
                        || hp.get(pokemon) != Some(old)
                        || new <= old
                        || *new > holder.max_hp
                    {
                        return Err(failure());
                    }
                    hp.insert(*pokemon, *new);
                    if before.party.iter().any(|row| row.id == *pokemon) {
                        self.player_heal(*pokemon);
                    }
                }
                BattlePresentationCueV5::Switched { slot, pokemon } => {
                    if !events.is_empty() || switched {
                        return Err(failure());
                    }
                    let holder = at_slot(after, *slot, *pokemon)?;
                    if hp.get(pokemon) != Some(&holder.hp) {
                        return Err(failure());
                    }
                    switched = true;
                    if slot.side == BattleSide::Player {
                        self.player_switch_in(*pokemon, holder.hp, holder.max_hp)?;
                    }
                }
                _ => {}
            }
        }
        if recoil_messages != usize::from(recoil_seen)
            || damage_cursor != damage_cues.len()
            || move_cues != usize::from(resolution.is_some())
            || after
                .party
                .iter()
                .chain(&next_battle.enemy_party)
                .any(|row| hp.get(&row.id) != Some(&row.hp))
        {
            return Err(failure());
        }
        Ok(())
    }

    fn state(&mut self) -> &mut CurrentAchievementBattleV1 {
        if self
            .tracker
            .battle
            .as_ref()
            .is_none_or(|state| state.wave_index != self.wave)
        {
            self.tracker.battle = Some(CurrentAchievementBattleV1::fresh(self.wave, self.turn));
        }
        // get_or_insert_with preserves the exact source lazy initialization.
        self.tracker
            .battle
            .get_or_insert_with(|| CurrentAchievementBattleV1::fresh(self.wave, self.turn))
    }

    fn key(&mut self, key: &str) {
        self.keys.push(key.to_owned());
    }

    fn note_turn_effect(&mut self, key: String) {
        let turn = self.turn;
        let state = self.state();
        if state.longest_turn_number != Some(turn) {
            state.longest_turn_number = Some(turn);
            state.longest_turn_effects = Some(BTreeSet::new());
        }
        let effects = state.longest_turn_effects.get_or_insert_with(BTreeSet::new);
        effects.insert(key);
        if effects.len() >= 10 {
            self.key("THE_LONGEST_TURN");
        }
    }

    /// Called at actual TurnStart, before any move. Existing stints survive a
    /// new turn; only a real later SwitchIn replaces an individual stint.
    fn turn_start_player(
        &mut self,
        pokemon: PokemonId,
        hp: u32,
        max_hp: u32,
    ) -> Result<(), GameRuntimeV6Error> {
        if hp == 0 || hp > max_hp {
            return Err(failure());
        }
        self.state()
            .ko_stints
            .entry(pokemon)
            .or_insert(CurrentAchievementKoStintV1 {
                kos: 0,
                had_plus_six: false,
                entered_low_hp: u64::from(hp) * 4 <= u64::from(max_hp),
                healed: false,
            });
        Ok(())
    }

    fn player_heal(&mut self, pokemon: PokemonId) {
        if let Some(stint) = self.state().ko_stints.get_mut(&pokemon) {
            stint.healed = true;
        }
        self.note_turn_effect(format!("heal:{}", pokemon.get().get()));
    }

    fn player_switch_in(
        &mut self,
        pokemon: PokemonId,
        hp: u32,
        max_hp: u32,
    ) -> Result<(), GameRuntimeV6Error> {
        if hp == 0 || hp > max_hp {
            return Err(failure());
        }
        let state = self.state();
        state.switched_in_player_ids.insert(pokemon);
        state.ko_stints.insert(
            pokemon,
            CurrentAchievementKoStintV1 {
                kos: 0,
                had_plus_six: false,
                entered_low_hp: u64::from(hp) * 4 <= u64::from(max_hp),
                healed: false,
            },
        );
        self.note_turn_effect(format!("switch:{}", pokemon.get().get()));
        Ok(())
    }

    fn move_resolution(
        &mut self,
        user: PokemonId,
        player: bool,
        move_id: MoveId,
        category: MoveCategory,
        double: bool,
        checks: &[CurrentResolvedHitCheckV1],
    ) -> Result<(), GameRuntimeV6Error> {
        // The caller admits only the actual first/direct hit from the bounded
        // current emitter; other hit modes require their source execution.
        let turn = self.turn;
        let state = self.state();
        if state.flash_turn != Some(turn) {
            state.flash_turn = Some(turn);
            state.player_acted_this_turn = Some(false);
        }
        if player {
            state.player_acted_this_turn = Some(true);
            state.player_ever_acted = true;
        } else {
            if state.player_acted_this_turn != Some(true) {
                state.flash_failed = true;
            }
            if state
                .no_sell_token
                .as_ref()
                .is_some_and(|token| token.attacker_id == user)
            {
                state.no_sell_token = None;
            }
        }
        self.note_turn_effect(format!("move:{}:{}", user.get().get(), move_id.get().get()));
        if player {
            // Source-context admission separately proves no trainer/ghost,
            // TrickRoom/Quash or unknown pulse branch is being defaulted away.
            if move_id.get().get() == 57 && double {
                self.state().last_spread_move = Some(CurrentAchievementSpreadMoveV1 {
                    move_id,
                    user_id: user,
                    turn,
                });
            }
            return Ok(());
        }
        if category == MoveCategory::Status {
            return Ok(());
        }
        let player_checks: Vec<_> = checks
            .iter()
            .filter(|row| row.slot.side == er_types::battle_ids::BattleSide::Player)
            .collect();
        if player_checks.is_empty() {
            return Ok(());
        }
        // Source tests exact MISS. Neither immunity result is an evasion streak.
        if player_checks
            .iter()
            .all(|row| row.result == CurrentHitCheckV1::Miss)
        {
            let state = self.state();
            state.weave_streak = state.weave_streak.checked_add(1).ok_or_else(failure)?;
            if state.weave_streak >= 3 {
                self.key("WEAVE_NATION_CERTIFIED");
            }
        } else {
            self.state().weave_streak = 0;
        }
        // PROTECTED/FlinchAttr is outside the admitted actual emitter, and is
        // rejected by the wrapper rather than omitted after accepting it.
        Ok(())
    }

    fn damage_source(&mut self, target: PokemonId, user: PokemonId) {
        self.record_damage_source(target, format!("move:{}", user.get().get()));
    }

    fn record_damage_source(&mut self, target: PokemonId, source: String) {
        let turn = self.turn;
        let state = self.state();
        if state.damage_source_turn != turn {
            state.damage_source_turn = turn;
            state.damage_sources_by_target.clear();
        }
        let sources = state.damage_sources_by_target.entry(target).or_default();
        sources.insert(source);
        if sources.len() >= 4 {
            self.key("CHAIN_REACTION");
        }
    }

    /// Ordered player→enemy direct KO tail after the caller has checked the
    /// actual damage hook's pre/post HP, source slot and narrow source context.
    fn player_direct_ko(
        &mut self,
        user: PokemonId,
        source_slot: FieldSlot,
        target: PokemonId,
        move_id: MoveId,
    ) -> Result<(), GameRuntimeV6Error> {
        let turn = self.turn;
        let key = format!(
            "{}:{}:{}",
            user.get().get(),
            move_id.get().get(),
            turn.get().get()
        );
        let state = self.state();
        if state.spread_ko_key.as_ref() != Some(&key) {
            state.spread_ko_key = Some(key);
            state.spread_ko_count = Some(0);
        }
        state.spread_ko_count = Some(
            state
                .spread_ko_count
                .ok_or_else(failure)?
                .checked_add(1)
                .ok_or_else(failure)?,
        );
        // Triple is not admitted by the current source targeting owner.
        state.last_enemy_killer_id = Some(user);
        let mut setup = false;
        let mut zero_to_hero = false;
        if let Some(stint) = state.ko_stints.get_mut(&user) {
            stint.kos = stint.kos.checked_add(1).ok_or_else(failure)?;
            setup = stint.kos >= 3 && stint.had_plus_six;
            zero_to_hero = stint.kos >= 3 && stint.entered_low_hp && !stint.healed;
        }
        if setup {
            self.key("SETUP_PAYOFF");
        }
        if zero_to_hero {
            self.key("ZERO_TO_HERO");
        }
        self.tracker.persistent.parallel_play_ko_ids.insert(user);
        if self.state().charge_low_hp_user_ids.contains(&user) {
            self.key("CHARGE_IT_TO_THE_GAME");
        }
        if self
            .tracker
            .persistent
            .learned_move_stamps
            .get(&move_id)
            .is_some_and(|wave| wave.get().get().checked_add(1) == Some(self.wave.get().get()))
        {
            self.key("TECHNICAL_DIFFICULTIES");
        }
        self.state().enemy_ko_killers.insert(
            target,
            CurrentAchievementKillerV1 {
                user_id: user,
                field_index: source_slot.position,
            },
        );
        Ok(())
    }

    fn enemy_super_effective_survival(
        &mut self,
        user: PokemonId,
        target: PokemonId,
        before: u32,
        after: u32,
    ) {
        if before > 1 && after == 1 {
            self.state().no_sell_token = Some(CurrentAchievementNoSellV1 {
                attacker_id: user,
                survivor_id: target,
            });
        }
    }
}

fn member(run: &RunStateV3, id: PokemonId) -> Result<&PokemonStateV5, GameRuntimeV6Error> {
    er_battle::current_target_execution::find_pokemon(run, id).ok_or_else(failure)
}

fn at_slot(
    run: &RunStateV3,
    slot: FieldSlot,
    id: PokemonId,
) -> Result<&PokemonStateV5, GameRuntimeV6Error> {
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    if !battle
        .field
        .slots
        .iter()
        .any(|row| row.slot == slot && row.occupant == Some(id))
        || (slot.side == BattleSide::Player) != run.party.iter().any(|row| row.id == id)
    {
        return Err(failure());
    }
    member(run, id)
}
