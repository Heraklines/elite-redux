//! Current battle targeting over live state and the shared, known account owner.
//!
//! The closed source catalog below is the actual initialized 399d registry for
//! the natural roster observed in run 34373633488. Registry observations
//! 34374866870 / 34376554214 and complete Studio source 34376121894 distinguish
//! supported capabilities from unknown ones. This is not full damage/phase parity.
use er_content::pack::m6_pack::MoveDefinitionV3;
use er_state::current_friendship_profile::CurrentFriendshipProfileV1;
use er_state::current_targeting::CurrentTargetingV1;
use er_state::m7_state::{PokemonStateV5, RunStateV3};
use er_state::m9e_state_v6::GameStateV6;
use er_types::BehaviorSourceId;
use er_types::battle_command::BattleTargetSelection;
use er_types::battle_ids::{BattleSide, FieldSlot, PokemonId};
use er_types::battle_model::{MoveFlag, MoveTarget, PokemonType, TerrainKind, WeatherKind};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("current target execution lacks supported source ownership or a legal target")]
pub struct CurrentTargetExecutionError;

/// Borrow the canonical profile; no copied account can silently diverge during a turn.
#[derive(Clone, Copy, Debug)]
pub struct CurrentTargetExecution<'a> {
    owner: &'a CurrentTargetingV1,
    profile: &'a CurrentFriendshipProfileV1,
    random_commands:
        Option<&'a er_state::current_random_target_commands::CurrentRandomTargetCommandsV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentTargetPlan {
    /// Source order, independently of canonical command serialization order.
    pub ordered: Vec<FieldSlot>,
    pub multiple: bool,
}

/// A random command has no selected target until authoritative admission.
#[derive(Clone, Debug)]
pub enum CurrentCommandTargetPlan {
    Deterministic(CurrentTargetPlan),
    RandomStruggle,
}
impl CurrentCommandTargetPlan {
    pub fn selections(&self) -> Result<Vec<BattleTargetSelection>, CurrentTargetExecutionError> {
        match self {
            Self::Deterministic(plan) => plan.selections(),
            Self::RandomStruggle => Ok(vec![BattleTargetSelection::Implicit]),
        }
    }
    pub fn requires_choice(&self) -> bool {
        matches!(self, Self::Deterministic(plan) if !plan.multiple && plan.ordered.len() > 1)
    }
    pub fn retain(
        &self,
        selection: &BattleTargetSelection,
    ) -> Result<(), CurrentTargetExecutionError> {
        match self {
            Self::Deterministic(plan) => plan.retain(selection).map(|_| ()),
            Self::RandomStruggle if *selection == BattleTargetSelection::Implicit => Ok(()),
            Self::RandomStruggle => Err(CurrentTargetExecutionError),
        }
    }
}

#[derive(Clone, Copy)]
struct SourceAbility {
    bypass_faint: bool,
    sound_spread: bool,
    poison_redirect: bool,
    sun_condition: bool,
}

impl<'a> CurrentTargetExecution<'a> {
    pub fn from_state(state: &'a GameStateV6) -> Result<Self, CurrentTargetExecutionError> {
        let value = Self {
            random_commands: state.current_random_target_commands.as_ref(),
            owner: state
                .current_targeting
                .as_ref()
                .ok_or(CurrentTargetExecutionError)?,
            profile: state
                .current_friendship_profile
                .as_ref()
                .ok_or(CurrentTargetExecutionError)?,
        };
        if value.profile.content_identity != state.content_identity
            || value.profile.owner_seat != value.owner.profile_owner
            || !er_state::current_targeting::matches_current_target_content(&state.content_identity)
        {
            return Err(CurrentTargetExecutionError);
        }
        value.validate_run(
            state
                .active_run
                .as_ref()
                .ok_or(CurrentTargetExecutionError)?,
        )?;
        Ok(value)
    }

    pub fn validate_run(&self, run: &RunStateV3) -> Result<(), CurrentTargetExecutionError> {
        if run.run_id != self.owner.run_id || run.mode != self.owner.mode {
            return Err(CurrentTargetExecutionError);
        }
        let battle = run.battle.as_ref().ok_or(CurrentTargetExecutionError)?;
        if !matches!(
            (battle.format.player_capacity, battle.format.enemy_capacity),
            (1, 1) | (2, 2)
        ) {
            return Err(CurrentTargetExecutionError);
        }
        // The current schema explicitly represents these fields. Nonempty weather,
        // field effects and suppression require their own source queries before
        // admission; they are not interpreted as neutral merely for being unhandled.
        if battle.weather.kind != WeatherKind::None
            || battle.terrain.kind != TerrainKind::None
            || !battle.arena_conditions.is_empty()
            || battle.global_ability_suppression.ignore_abilities
            || battle.global_ability_suppression.source.is_some()
            || !run.modifiers.is_empty()
        {
            return Err(CurrentTargetExecutionError);
        }
        for pokemon in run.party.iter().chain(&battle.enemy_party) {
            if pokemon.fusion.is_some()
                || !pokemon.held_items.is_empty()
                || pokemon.abilities.active_suppressed
                || pokemon
                    .abilities
                    .passive_suppressed
                    .iter()
                    .any(|value| *value)
            {
                return Err(CurrentTargetExecutionError);
            }
            source_ability(pokemon.abilities.active.get().get())?;
            for ability in pokemon.abilities.passives.iter().flatten() {
                source_ability(ability.get().get())?;
            }
            if pokemon.owner_seat.is_some() {
                self.passive_attr(pokemon)?;
            }
        }
        Ok(())
    }

    fn passive_attr(&self, pokemon: &PokemonStateV5) -> Result<u8, CurrentTargetExecutionError> {
        if pokemon.owner_seat != Some(self.profile.owner_seat) || pokemon.form_index != 0 {
            return Err(CurrentTargetExecutionError);
        }
        // These genuine observed starters are their own source unlock owners.
        // Evolved, fusion, Omniform and arbitrary compiled-row mappings are not
        // inferred from a convenient account entry or a numeric form index.
        if !matches!(pokemon.species_id.get().get(), 1 | 4 | 7) {
            return Err(CurrentTargetExecutionError);
        }
        self.profile
            .accounts
            .binary_search_by_key(&pokemon.species_id, |row| row.species)
            .ok()
            .map(|index| self.profile.accounts[index].passive_attr)
            .filter(|mask| *mask <= 63)
            .ok_or(CurrentTargetExecutionError)
    }

    /// Same eligible source list is used by target derivation and move query/hooks.
    /// Source order is active first then innate slots, with actual ability-ID dedup.
    pub fn ability_sources(
        &self,
        run: &RunStateV3,
        pokemon: &PokemonStateV5,
    ) -> Result<Vec<BehaviorSourceId>, CurrentTargetExecutionError> {
        Ok(self
            .ability_sources_with_slots(run, pokemon)?
            .into_iter()
            .map(|(source, _)| source)
            .collect())
    }

    /// Preserve the actual admitted innate slot before ability-ID deduplication.
    /// A disabled earlier duplicate must never acquire a later slot's provenance.
    pub fn ability_sources_with_slots(
        &self,
        run: &RunStateV3,
        pokemon: &PokemonStateV5,
    ) -> Result<Vec<(BehaviorSourceId, Option<u8>)>, CurrentTargetExecutionError> {
        self.validate_run(run)?;
        let mask = if pokemon.owner_seat.is_some() {
            self.passive_attr(pokemon)?
        } else {
            0
        };
        let enemy_limit = if pokemon.level >= 24 {
            3
        } else if pokemon.level >= 15 {
            2
        } else {
            1
        };
        let mut ids = Vec::with_capacity(4);
        let active = pokemon.abilities.active;
        if ability_applies(source_ability(active.get().get())?, pokemon) {
            ids.push((active, None));
        }
        for (slot, candidate) in pokemon.abilities.passives.iter().enumerate() {
            let Some(ability) = *candidate else {
                continue;
            };
            let admitted = if pokemon.owner_seat.is_some() {
                let pair = 3_u8 << (slot * 2);
                mask & pair == pair
            } else {
                slot < enemy_limit
            };
            if !admitted
                || ids.iter().any(|(seen, _)| *seen == ability)
                || !ability_applies(source_ability(ability.get().get())?, pokemon)
            {
                continue;
            }
            ids.push((
                ability,
                Some(u8::try_from(slot).map_err(|_| CurrentTargetExecutionError)?),
            ));
        }
        Ok(ids
            .into_iter()
            .map(|(ability, innate_slot)| {
                let source = if innate_slot.is_some() {
                    BehaviorSourceId::PassiveAbility {
                        numeric_id: ability.get(),
                    }
                } else {
                    BehaviorSourceId::ActiveAbility {
                        numeric_id: ability.get(),
                    }
                };
                (source, innate_slot)
            })
            .collect())
    }

    /// Current counterpart of the source pending MovePhase queue update after
    /// FaintPhase removes a target. The accepted command stays unchanged; only
    /// its transaction-owned not-yet-executed target vector is redirected.
    pub fn retarget_pending_after_faint(
        &self,
        run: &RunStateV3,
        removed: PokemonId,
        actor: PokemonId,
        retained: &mut [FieldSlot],
    ) -> Result<(), CurrentTargetExecutionError> {
        self.validate_run(run)?;
        let battle = run.battle.as_ref().ok_or(CurrentTargetExecutionError)?;
        let removed_pokemon = find_pokemon(run, removed).ok_or(CurrentTargetExecutionError)?;
        if removed_pokemon.hp != 0 || !removed_pokemon.fainted {
            return Err(CurrentTargetExecutionError);
        }
        if battle.format.player_capacity != 2
            || battle.format.enemy_capacity != 2
            || retained.len() != 1
        {
            return Ok(());
        }
        let removed_slot = battle
            .field
            .slots
            .iter()
            .find(|row| row.occupant == Some(removed))
            .map(|row| row.slot)
            .ok_or(CurrentTargetExecutionError)?;
        let actor_slot = battle
            .field
            .slots
            .iter()
            .find(|row| row.occupant == Some(actor))
            .map(|row| row.slot)
            .ok_or(CurrentTargetExecutionError)?;
        if actor_slot.side == removed_slot.side || retained[0] != removed_slot {
            return Ok(());
        }
        let ally = battle.field.slots.iter().find(|row| {
            row.slot.side == removed_slot.side
                && row.slot != removed_slot
                && row.occupant.is_some_and(|id| {
                    find_pokemon(run, id).is_some_and(|pokemon| pokemon.hp > 0 && !pokemon.fainted)
                })
        });
        if let Some(ally) = ally {
            retained[0] = ally.slot;
        }
        Ok(())
    }

    /// Apply the source redirect pass to the retained command targets, then remove
    /// inactive occupants. This never reruns command-stage target selection.
    pub fn execution_targets(
        &self,
        run: &RunStateV3,
        actor: PokemonId,
        definition: &MoveDefinitionV3,
        retained: &[FieldSlot],
    ) -> Result<Vec<FieldSlot>, CurrentTargetExecutionError> {
        self.validate_run(run)?;
        let battle = run.battle.as_ref().ok_or(CurrentTargetExecutionError)?;
        let user_slot = battle
            .field
            .slots
            .iter()
            .find(|row| row.occupant == Some(actor))
            .map(|row| row.slot)
            .ok_or(CurrentTargetExecutionError)?;
        let mut result = retained.to_vec();
        // All admitted source attributes were observed on the initialized registry:
        // none changes move type or adds triggered move types, Free Aim, attention,
        // redirect bypass or block. Nonempty field effects are rejected by admission.
        if result.len() == 1
            && matches!(definition.target, MoveTarget::NearOther | MoveTarget::Other)
            && definition.move_type == PokemonType::Poison
        {
            let mut active = [false; 6];
            for row in &battle.field.slots {
                active[flat(row.slot)?] = row
                    .occupant
                    .and_then(|id| find_pokemon(run, id))
                    .is_some_and(|pokemon| pokemon.hp > 0 && !pokemon.fainted);
            }
            let user_index = flat(user_slot)?;
            let opponent_count = active
                .iter()
                .enumerate()
                .filter(|(index, value)| **value && *index / 3 != user_index / 3)
                .count();
            // Ask the already qualified source arrangement core for reachability.
            let adjacent = crate::current_move_targets::resolve_move_targets(
                &crate::current_move_targets::TargetContext {
                    capacities: [battle.format.player_capacity, battle.format.enemy_capacity],
                    allowed: active,
                    active,
                    user: u8::try_from(user_index).map_err(|_| CurrentTargetExecutionError)?,
                    target: MoveTarget::AllNearOthers,
                    replacement: None,
                    variable: vec![None; opponent_count],
                    spread_flag: false,
                    multi_hit: false,
                    ghost: false,
                    fog: false,
                    fog_suppressed: false,
                    flying: definition.move_type == PokemonType::Flying,
                    pulse: definition.flags.contains(&MoveFlag::Pulse),
                    arrangement: true,
                    random_index: None,
                },
            )
            .map_err(|_| CurrentTargetExecutionError)?;
            let mut redirect = None;
            for row in &battle.field.slots {
                let Some(id) = row.occupant else {
                    continue;
                };
                if id == actor
                    || !adjacent.targets.contains(
                        &i8::try_from(flat(row.slot)?).map_err(|_| CurrentTargetExecutionError)?,
                    )
                {
                    continue;
                }
                let holder = find_pokemon(run, id).ok_or(CurrentTargetExecutionError)?;
                let applies = self.ability_sources(run, holder)?.iter().any(|source| {
                    ability_numeric_id(source)
                        .and_then(|id| source_ability(id).ok())
                        .is_some_and(|ability| ability.poison_redirect)
                });
                if applies {
                    // Multiple eligible holders require the source live priority queue
                    // (including tie RNG). Do not invent field-order redirection.
                    if redirect.replace(row.slot).is_some() {
                        return Err(CurrentTargetExecutionError);
                    }
                }
            }
            if let Some(slot) = redirect {
                result[0] = slot;
            }
        }
        result.retain(|slot| {
            battle
                .field
                .slots
                .iter()
                .find(|row| row.slot == *slot)
                .and_then(|row| row.occupant)
                .and_then(|id| find_pokemon(run, id))
                .is_some_and(|pokemon| pokemon.hp > 0 && !pokemon.fainted)
        });
        Ok(result)
    }
    pub fn command_plan(
        &self,
        run: &RunStateV3,
        actor: PokemonId,
        definition: &MoveDefinitionV3,
        struggle: bool,
    ) -> Result<CurrentCommandTargetPlan, CurrentTargetExecutionError> {
        if definition.id.get().get() == 165 {
            if !struggle {
                return Err(CurrentTargetExecutionError);
            }
            self.random_command_candidates(run, actor, definition)?;
            Ok(CurrentCommandTargetPlan::RandomStruggle)
        } else {
            Ok(CurrentCommandTargetPlan::Deterministic(
                self.plan(run, actor, definition)?,
            ))
        }
    }

    /// Resolve the current command's random target once, before speed ordering.
    /// The public read-only plan still rejects unresolved random selection.
    pub(crate) fn retain_command_targets(
        &self,
        run: &RunStateV3,
        actor: PokemonId,
        definition: &MoveDefinitionV3,
        selection: &BattleTargetSelection,
        accepted: &er_types::battle_command::AcceptedBattleCommand,
        rng: &mut er_rng::battle::RngRuntime,
    ) -> Result<Vec<FieldSlot>, CurrentTargetExecutionError> {
        if definition.id.get().get() != 165 {
            return self.plan(run, actor, definition)?.retain(selection);
        }
        if *selection != BattleTargetSelection::Implicit {
            return Err(CurrentTargetExecutionError);
        }
        if let Some(owner) = self.random_commands {
            let battle = run.battle.as_ref().ok_or(CurrentTargetExecutionError)?;
            if owner.run != run.run_id
                || owner.battle != battle.battle_id
                || owner.wave != battle.wave
                || owner.turn != battle.turn
            {
                return Err(CurrentTargetExecutionError);
            }
            if let Some(entry) = owner
                .entries
                .iter()
                .find(|entry| entry.command.operation_id() == accepted.operation_id())
            {
                if &entry.command != accepted {
                    return Err(CurrentTargetExecutionError);
                }
                return Ok(vec![entry.selected]);
            }
        }
        // The source calls Pokemon.randBattleSeedInt even with one opponent;
        // Battle.randSeedInt returns zero without advancing that one-value draw.

        let candidates = self.random_command_candidates(run, actor, definition)?;
        let index = rng
            .battle_rand_seed_int(
                er_types::SafeU53::new(
                    u64::try_from(candidates.len()).map_err(|_| CurrentTargetExecutionError)?,
                )
                .map_err(|_| CurrentTargetExecutionError)?,
                er_types::SafeU53::ZERO,
                er_rng::audit::RngReason::RandomTarget,
                er_rng::audit::RngCallsiteId::current_move_target(),
            )
            .map_err(|_| CurrentTargetExecutionError)?;
        self.plan_with_random_index(
            run,
            actor,
            definition,
            Some(usize::try_from(index.get()).map_err(|_| CurrentTargetExecutionError)?),
        )?
        .retain(selection)
    }

    pub(crate) fn validate_resolved_random_hit(
        &self,
        run: &RunStateV3,
        actor: PokemonId,
        defender: PokemonId,
        definition: &MoveDefinitionV3,
    ) -> Result<(), CurrentTargetExecutionError> {
        let candidates = self.random_command_candidates(run, actor, definition)?;
        let battle = run.battle.as_ref().ok_or(CurrentTargetExecutionError)?;
        if !battle
            .field
            .slots
            .iter()
            .any(|row| row.occupant == Some(defender) && candidates.contains(&row.slot))
        {
            return Err(CurrentTargetExecutionError);
        }
        Ok(())
    }

    pub fn random_command_candidates(
        &self,
        run: &RunStateV3,
        actor: PokemonId,
        definition: &MoveDefinitionV3,
    ) -> Result<Vec<FieldSlot>, CurrentTargetExecutionError> {
        self.validate_run(run)?;
        if definition.id.get().get() != 165 || definition.target != MoveTarget::RandomNearEnemy {
            return Err(CurrentTargetExecutionError);
        }
        let user = find_pokemon(run, actor).ok_or(CurrentTargetExecutionError)?;
        // Qualified399d initialized registry export SHA256
        // 9b58691e1c5b3796e2b1bfe511483a445b7ab158e72e895fd15c86e5f9bc4576:
        // these exact24 attrs lists contain no RecoilDamageMultiplierAbAttr.
        // Pokemon.getAllActiveAbilityAttrs directly flattens eligible ability.attrs;
        // future targeting catalog additions do not inherit recoil neutrality.
        if self.ability_sources(run, user)?.iter().any(|source| {
            !matches!(
                ability_numeric_id(source),
                Some(
                    0 | 18
                        | 41
                        | 43
                        | 47
                        | 49
                        | 51
                        | 62
                        | 65
                        | 66
                        | 67
                        | 75
                        | 82
                        | 94
                        | 113
                        | 172
                        | 192
                        | 257
                        | 268
                        | 5006
                        | 5033
                        | 5082
                        | 5097
                        | 5115
                )
            )
        }) {
            return Err(CurrentTargetExecutionError);
        }
        let battle = run.battle.as_ref().ok_or(CurrentTargetExecutionError)?;
        let user = battle
            .field
            .slots
            .iter()
            .find(|row| row.occupant == Some(actor))
            .ok_or(CurrentTargetExecutionError)?;
        let candidates = battle
            .field
            .slots
            .iter()
            .filter(|row| {
                row.slot.side != user.slot.side
                    && row
                        .occupant
                        .and_then(|id| find_pokemon(run, id))
                        .is_some_and(|pokemon| pokemon.hp > 0 && !pokemon.fainted)
            })
            .map(|row| row.slot)
            .collect::<Vec<_>>();
        if candidates.is_empty() {
            return Err(CurrentTargetExecutionError);
        }
        Ok(candidates)
    }

    pub fn plan(
        &self,
        run: &RunStateV3,
        actor: PokemonId,
        definition: &MoveDefinitionV3,
    ) -> Result<CurrentTargetPlan, CurrentTargetExecutionError> {
        self.plan_with_random_index(run, actor, definition, None)
    }

    fn plan_with_random_index(
        &self,
        run: &RunStateV3,
        actor: PokemonId,
        definition: &MoveDefinitionV3,
        random_index: Option<usize>,
    ) -> Result<CurrentTargetPlan, CurrentTargetExecutionError> {
        self.validate_run(run)?;
        let battle = run.battle.as_ref().ok_or(CurrentTargetExecutionError)?;
        let field = battle
            .field
            .slots
            .iter()
            .find(|row| row.occupant == Some(actor))
            .ok_or(CurrentTargetExecutionError)?;
        let user = find_pokemon(run, actor).ok_or(CurrentTargetExecutionError)?;
        if user.hp == 0 || user.fainted {
            return Err(CurrentTargetExecutionError);
        }
        let (source_target, multi_hit) = source_move(definition.id.get().get())?;
        if source_target != definition.target {
            return Err(CurrentTargetExecutionError);
        }
        // RANDOM_NEAR_ENEMY needs retained command-stage RNG ownership. ATTACKER
        // and CURSE need additional source phase/type/weather owners. None is faked.
        if matches!(source_target, MoveTarget::Attacker | MoveTarget::Curse)
            || (source_target == MoveTarget::RandomNearEnemy && random_index.is_none())
            || (source_target != MoveTarget::RandomNearEnemy && random_index.is_some())
        {
            return Err(CurrentTargetExecutionError);
        }
        let mut allowed = [false; 6];
        for row in &battle.field.slots {
            let index = flat(row.slot)?;
            if let Some(id) = row.occupant {
                let target = find_pokemon(run, id).ok_or(CurrentTargetExecutionError)?;
                allowed[index] = target.hp > 0 && !target.fainted;
            }
        }
        let user_index = flat(field.slot)?;
        let opponent_count = allowed
            .iter()
            .enumerate()
            .filter(|(index, allowed)| **allowed && *index / 3 != user_index / 3)
            .count();
        let source_ids = self.ability_sources(run, user)?;
        let spread = source_ids.iter().any(|source| {
            ability_numeric_id(source)
                .and_then(|id| source_ability(id).ok())
                .is_some_and(|ability| ability.sound_spread)
        }) && definition.flags.contains(&MoveFlag::SoundBased);
        let result = crate::current_move_targets::resolve_move_targets(
            &crate::current_move_targets::TargetContext {
                capacities: [battle.format.player_capacity, battle.format.enemy_capacity],
                allowed,
                // Admission is the current atomic field boundary, not a transient TS
                // switch animation. The executor updates field membership atomically.
                active: allowed,
                user: u8::try_from(user_index).map_err(|_| CurrentTargetExecutionError)?,
                target: source_target,
                replacement: None,
                variable: vec![None; opponent_count],
                spread_flag: spread,
                multi_hit,
                ghost: false,
                fog: false,
                fog_suppressed: false,
                flying: definition.move_type == PokemonType::Flying,
                pulse: definition.flags.contains(&MoveFlag::Pulse),
                arrangement: true,
                random_index,
            },
        )
        .map_err(|_| CurrentTargetExecutionError)?;
        let ordered = result
            .targets
            .into_iter()
            .map(unflat)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(CurrentTargetPlan {
            ordered,
            multiple: result.multiple,
        })
    }
}

impl CurrentTargetPlan {
    pub fn selections(&self) -> Result<Vec<BattleTargetSelection>, CurrentTargetExecutionError> {
        if self.ordered.is_empty() {
            return Ok(Vec::new());
        }
        if self.multiple || self.ordered.len() == 1 {
            Ok(vec![BattleTargetSelection::implicit()])
        } else {
            self.ordered
                .iter()
                .map(|slot| {
                    BattleTargetSelection::selected(vec![*slot])
                        .map_err(|_| CurrentTargetExecutionError)
                })
                .collect()
        }
    }

    pub fn retain(
        &self,
        selection: &BattleTargetSelection,
    ) -> Result<Vec<FieldSlot>, CurrentTargetExecutionError> {
        match selection {
            BattleTargetSelection::Implicit if self.multiple || self.ordered.len() == 1 => {
                Ok(self.ordered.clone())
            }
            BattleTargetSelection::Selected(selected)
                if !self.multiple
                    && self.ordered.len() > 1
                    && selected.len() == 1
                    && self.ordered.contains(&selected[0]) =>
            {
                Ok(selected.clone())
            }
            _ => Err(CurrentTargetExecutionError),
        }
    }
}

fn ability_applies(ability: SourceAbility, pokemon: &PokemonStateV5) -> bool {
    // Actual Solar Power retains a sunny/harsh-sun condition. Admitted weather is
    // explicitly None, so the condition is false, not an absent-condition default.
    !ability.sun_condition && (pokemon.hp > 0 || ability.bypass_faint)
}

fn source_ability(id: u64) -> Result<SourceAbility, CurrentTargetExecutionError> {
    if !matches!(
        id,
        0 | 18
            | 41
            | 43
            | 47
            | 49
            | 51
            | 62
            | 65
            | 66
            | 67
            | 75
            | 82
            | 94
            | 113
            | 172
            | 192
            | 257
            | 268
            | 5006
            | 5033
            | 5082
            | 5097
            | 5115
    ) {
        return Err(CurrentTargetExecutionError);
    }
    // Studio5006 is exactly chloroplast-sun-moves, not arbitrary runtime rules;
    //62/94 retain only their same-ID source markers. No admitted move has a
    //weather/type/VariableTarget callback driven by those markers.
    Ok(SourceAbility {
        bypass_faint: matches!(id, 49 | 268),
        sound_spread: id == 5115,
        poison_redirect: id == 5082,
        sun_condition: id == 94,
    })
}

fn source_move(id: u64) -> Result<(MoveTarget, bool), CurrentTargetExecutionError> {
    use MoveTarget::*;
    let target = match id {
        10 | 33 | 40 | 61 | 64 | 78 | 79 | 98 | 103 | 310 | 331 | 448 | 458 | 497 | 541 => {
            NearOther
        }
        39 | 43 | 45 | 230 => AllNearEnemies,
        57 => AllNearOthers,
        105 | 110 | 336 => User,
        108 | 501 => UserSide,
        580 => BothSides,
        165 => RandomNearEnemy,
        _ => return Err(CurrentTargetExecutionError),
    };
    Ok((target, matches!(id, 61 | 64 | 331 | 458 | 497 | 541)))
}

fn ability_numeric_id(source: &BehaviorSourceId) -> Option<u64> {
    match source {
        BehaviorSourceId::ActiveAbility { numeric_id }
        | BehaviorSourceId::PassiveAbility { numeric_id } => Some(numeric_id.get()),
        _ => None,
    }
}

pub fn find_pokemon(run: &RunStateV3, id: PokemonId) -> Option<&PokemonStateV5> {
    run.party
        .iter()
        .chain(run.battle.iter().flat_map(|battle| &battle.enemy_party))
        .find(|pokemon| pokemon.id == id)
}

fn flat(slot: FieldSlot) -> Result<usize, CurrentTargetExecutionError> {
    if slot.position >= 3 {
        return Err(CurrentTargetExecutionError);
    }
    Ok(usize::from(slot.position)
        + if slot.side == BattleSide::Player {
            0
        } else {
            3
        })
}

fn unflat(index: i8) -> Result<FieldSlot, CurrentTargetExecutionError> {
    if !(0..6).contains(&index) {
        return Err(CurrentTargetExecutionError);
    }
    Ok(FieldSlot {
        side: if index < 3 {
            BattleSide::Player
        } else {
            BattleSide::Enemy
        },
        position: u8::try_from(index % 3).map_err(|_| CurrentTargetExecutionError)?,
    })
}
