//! Deterministic natural-run construction from BootstrapContentPackV1.

use std::collections::BTreeMap;

use er_rng::audit::{RngCallsiteId, RngDraw, RngReason};
use er_rng::battle::RngRuntime;
use er_state::field::{FieldSlotState, FieldState};
use er_state::m7_state::{
    BATTLE_STATE_SCHEMA_VERSION_V5, BattleStateV5, FactionStateV1,
    INVENTORY_STATE_SCHEMA_VERSION_V1, InventoryStateV1, POKEMON_STATE_SCHEMA_VERSION_V5,
    PokemonStateV5, ProgressionQueueV2, QuestStateV1, RUN_STATE_SCHEMA_VERSION_V3, RunStateV3,
    WORLD_STATE_SCHEMA_VERSION_V1, WorldStateV1,
};
use er_state::m9e_state_v6::{
    GAME_STATE_SCHEMA_VERSION_V6, GameIdentityAllocatorStateV1, GameStateV6,
};
use er_state::mechanic_state_v2::MechanicStateStoreV2;
use er_state::pokemon_v2::{Iv, PermanentStatBonuses};
use er_types::battle_command::CommandCollectionState;
use er_types::battle_ids::{
    BattleFormat, BattleSide, FaintOccurrenceId, FieldSlot, TurnIndex, WaveIndex,
};
use er_types::battle_model::{
    AbilityLoadout, BattleOutcome, BattleStats, GlobalAbilitySuppressionState, MoveSlotState,
    PokemonTyping, StatStages, StatusKind, StatusState, TerrainKind, TerrainState, WeatherKind,
    WeatherState,
};
use er_types::run_ids::{BiomeId, Money, RouteNodeId};
use er_types::{
    FormId, GAME_CONTROL_PLAN_SCHEMA_VERSION_V2, GameControlKindV2, GameControlPlanV2, RunOutcome,
    SafeU53, SeatId,
};
use thiserror::Error;

use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m72_bootstrap::{RunBootstrapMachineV1, RunBootstrapStageV1};

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum NaturalRunV6Error {
    #[error("natural V6 bootstrap selection or content is invalid")]
    Invalid,
    #[error("natural V6 identity or arithmetic exhausted")]
    Exhausted,
    #[error("natural V6 state failed validation: {0}")]
    State(String),
}

pub fn construct_natural_run_v6(
    bootstrap: &RunBootstrapMachineV1,
    content: &PreparedGameContentV2,
    authority_revision: SafeU53,
) -> Result<GameStateV6, NaturalRunV6Error> {
    if bootstrap.stage != RunBootstrapStageV1::Complete || authority_revision == SafeU53::ZERO {
        return Err(NaturalRunV6Error::Invalid);
    }
    let difficulty = bootstrap
        .selections
        .difficulty
        .ok_or(NaturalRunV6Error::Invalid)?;
    if !difficulty.production() && !bootstrap.catalog.developer_mode {
        return Err(NaturalRunV6Error::Invalid);
    }
    let mode_id = bootstrap
        .selections
        .mode
        .ok_or(NaturalRunV6Error::Invalid)?;
    let mode = content
        .world
        .mode(mode_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let owner = bootstrap
        .selections
        .starters
        .first()
        .map(|starter| starter.owner_seat)
        .or(bootstrap.control.owner_seat)
        .ok_or(NaturalRunV6Error::Invalid)?;
    if bootstrap.selections.starters.is_empty() {
        return Err(NaturalRunV6Error::Invalid);
    }
    let mut identities =
        GameIdentityAllocatorStateV1::derive(None).map_err(|_| NaturalRunV6Error::Exhausted)?;
    let run_id = identities
        .allocate_run_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let mut rng = RngRuntime::from_run_seed(&bootstrap.seed);
    let mut party = Vec::with_capacity(bootstrap.selections.starters.len());
    for starter in &bootstrap.selections.starters {
        let pokemon_id = identities
            .allocate_pokemon_id()
            .map_err(|_| NaturalRunV6Error::Exhausted)?;
        party.push(pokemon(
            content,
            &mut rng,
            pokemon_id,
            Some(starter.owner_seat),
            er_types::battle_ids::SpeciesId::new(starter.species_id),
            starter.form_index,
            mode.starting_level,
        )?);
    }
    if bootstrap.current_starter_pokerus.is_some() {
        let observed = bootstrap
            .current_starter_pokerus_selections()
            .map_err(|_| NaturalRunV6Error::Invalid)?
            .ok_or(NaturalRunV6Error::Invalid)?;
        if observed.len() != party.len() {
            return Err(NaturalRunV6Error::Invalid);
        }
        for (pokemon, selected) in party.iter_mut().zip(&observed) {
            if pokemon.owner_seat != Some(selected.selection.owner_seat)
                || pokemon.species_id.get() != selected.selection.species_id
                || pokemon.form_index != selected.selection.form_index
            {
                return Err(NaturalRunV6Error::Invalid);
            }
            pokemon.pokerus = Some(selected.pokerus);
        }
    }
    let biome = content
        .world
        .biome(mode.starting_biome)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let current_initial = if let Some(shared) = &bootstrap.current_friendship_profile {
        if mode.key != "CLASSIC"
            || mode.cooperative
            || mode.challenge_selection
            || !mode.supported
            || !bootstrap.selections.choices.is_empty()
            || shared.owner_seat != owner
            || shared.content_identity != *content.identity()
            || biome.key != "TOWN"
            || biome.trainer_chance_denominator != 0
            || difficulty == er_types::RunDifficultyV1::Mystery
        {
            return Err(NaturalRunV6Error::Invalid);
        }
        // Initialized ordinary Classic getLevelForWave curve settings.
        // Construction owns an isolated scope; it consumes neither encounter
        // generation RNG nor the retained run RNG while drawing seed and level.
        let mut constructed = crate::current_initial_battle::construct_current_initial_battle(
            &bootstrap.seed,
            2.0,
            25.0,
        )
        .map_err(|_| NaturalRunV6Error::Invalid)?;
        if difficulty == er_types::RunDifficultyV1::Hell {
            // applyErHellEnemyLevelScaling overrides only after constructor draws.
            constructed.enemy_level = party
                .iter()
                .map(|p| p.level)
                .max()
                .ok_or(NaturalRunV6Error::Invalid)?
                .saturating_sub(3)
                .max(1);
        }
        Some(constructed)
    } else {
        None
    };
    let enemy_species = select_encounter_species(biome, &mut rng)?;
    let enemy_id = identities
        .allocate_pokemon_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let enemy = pokemon(
        content,
        &mut rng,
        enemy_id,
        None,
        enemy_species,
        0,
        current_initial
            .as_ref()
            .map_or(mode.starting_level, |value| value.enemy_level),
    )?;
    let battle_id = identities
        .allocate_battle_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let wave = WaveIndex::new(safe(1)?).map_err(|_| NaturalRunV6Error::Invalid)?;
    let battle_seed = current_initial.as_ref().map_or_else(
        || format!("{}:battle:1", bootstrap.seed),
        |value| value.wave_seed.clone(),
    );
    let battle_rng = rng
        .initialize_battle(&battle_seed, wave)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    if current_initial
        .as_ref()
        .is_some_and(|value| value.battle_seed != battle_rng.battle_seed)
    {
        return Err(NaturalRunV6Error::Invalid);
    }
    let format = BattleFormat::single();
    let player_slot =
        FieldSlot::new(BattleSide::Player, 0).map_err(|_| NaturalRunV6Error::Invalid)?;
    let enemy_slot =
        FieldSlot::new(BattleSide::Enemy, 0).map_err(|_| NaturalRunV6Error::Invalid)?;
    let field = FieldState::new_for_format(
        &format,
        vec![
            FieldSlotState::new(player_slot, Some(party[0].id)),
            FieldSlotState::new(enemy_slot, Some(enemy.id)),
        ],
    )
    .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let control = GameControlPlanV2 {
        schema_version: GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision: authority_revision,
        kind: GameControlKindV2::Waiting,
        owner_seat: None,
        action_context: None,
        menu: None,
        actionable: false,
    };
    let route = RouteNodeId::new(SafeU53::ZERO);
    let run = RunStateV3 {
        schema_version: RUN_STATE_SCHEMA_VERSION_V3,
        run_id,
        seed: bootstrap.seed.clone(),
        mode: mode_id,
        wave,
        run_rng: rng.run_state(),
        party,
        storage: Vec::new(),
        inventory: InventoryStateV1 {
            schema_version: INVENTORY_STATE_SCHEMA_VERSION_V1,
            entries: Vec::new(),
        },
        modifiers: Vec::new(),
        money: Money::new(mode.starting_money),
        world: WorldStateV1 {
            schema_version: WORLD_STATE_SCHEMA_VERSION_V1,
            biome: BiomeId::new(mode.starting_biome.get()),
            route,
            visited_routes: vec![route],
            encounter_sequence: SafeU53::ZERO,
            mode_counters: BTreeMap::new(),
            previous_biome: None,
            recent_biomes: Vec::new(),
            pending_nodes: Vec::new(),
            pending_nodes_ready: false,
            event_revealed_biomes: Vec::new(),
            biome_length: Some(1),
            biome_start_wave: wave,
            leave_biome_now: false,
            overstay_anchor_wave: None,
            map_nodes: Vec::new(),
            travel_target: None,
            authoritative_travel: None,
            treasure_fragments: 0,
            carried_weather: None,
            biome_history: vec![BiomeId::new(mode.starting_biome.get())],
            fairy_luck_bonus: 0,
            fairy_luck_expiry_wave: None,
        },
        scenario: None,
        quests: QuestStateV1::default(),
        factions: FactionStateV1::default(),
        progression_queue: ProgressionQueueV2 {
            next_sequence: safe(1)?,
            tasks: Vec::new(),
            active_index: None,
        },
        battle: Some(BattleStateV5 {
            schema_version: BATTLE_STATE_SCHEMA_VERSION_V5,
            battle_id,
            wave,
            wave_seed: battle_seed,
            turn: TurnIndex::new(safe(1)?).map_err(|_| NaturalRunV6Error::Invalid)?,
            format,
            authority_seat: owner,
            enemy_party: vec![enemy],
            field,
            weather: WeatherState {
                kind: WeatherKind::None,
                remaining_turns: 0,
            },
            terrain: TerrainState {
                kind: TerrainKind::None,
                remaining_turns: 0,
            },
            arena_conditions: Vec::new(),
            global_ability_suppression: GlobalAbilitySuppressionState {
                ignore_abilities: false,
                source: None,
            },
            battle_rng,
            command_state: CommandCollectionState {
                frontier: Vec::new(),
                tombstones: Vec::new(),
            },
            mechanics: MechanicStateStoreV2::default(),
            faint_queue: Vec::new(),
            next_faint_occurrence: FaintOccurrenceId::new(safe(1)?),
            outcome: BattleOutcome::Ongoing,
        }),
        control,
        flags: BTreeMap::new(),
        outcome: RunOutcome::InProgress,
    };
    let mut profile = bootstrap.profile.clone();
    profile.statistics.runs_started = increment(profile.statistics.runs_started)?;
    let current_targeting = if let Some(shared) = &bootstrap.current_friendship_profile {
        // Fresh source GameMode construction owns the empty challenge set. This
        // path also owns empty per-Pokemon overrides and atomic field membership;
        // loaded states without the retained admission cannot acquire those facts.
        if mode.key != "CLASSIC"
            || mode.cooperative
            || mode.challenge_selection
            || !mode.supported
            || !bootstrap.selections.choices.is_empty()
            || shared.owner_seat != owner
            || shared.content_identity != *content.identity()
        {
            return Err(NaturalRunV6Error::Invalid);
        }
        Some(er_state::current_targeting::CurrentTargetingV1 {
            run_id,
            mode: mode_id,
            profile_owner: owner,
            origin: er_state::current_targeting::CurrentTargetingOriginV1::FreshNormalClassic,
        })
    } else {
        None
    };
    let mut state = GameStateV6 {
        current_targeting,
        current_turn_execution: None,
        current_defender_dispatch: None,
        current_achievement_tracker: None,
        current_presentation: bootstrap
            .current_friendship_profile
            .as_ref()
            .and_then(|profile| profile.rewards.as_ref())
            .map(|_| {
                er_state::current_presentation::CurrentPresentationOwnerV1::fresh(
                    authority_revision,
                )
            }),
        current_battle_participation: None,
        current_friendship_profile: bootstrap.current_friendship_profile.clone(),
        current_run_difficulty: Some(er_state::m9e_state_v6::CurrentRunDifficultyV1 {
            run_id,
            difficulty,
        }),
        schema_version: GAME_STATE_SCHEMA_VERSION_V6,
        content_identity: content.identity().clone(),
        identities,
        profile,
        active_run: Some(run),
    };
    if state.current_presentation.is_some() && state.current_targeting.is_some() {
        state.current_achievement_tracker =
            Some(er_state::current_achievement_tracker::CurrentAchievementTrackerV1::fresh(run_id));
        state.current_battle_participation = Some(
            er_state::current_battle_participation::CurrentBattleParticipationV1::fresh(
                state
                    .active_run
                    .as_ref()
                    .ok_or(NaturalRunV6Error::Invalid)?,
                safe(1)?,
            )
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?,
        );
        install_pending_experience(
            &mut state,
            content,
            er_state::current_experience_owner::CurrentExperienceCapPolicyV1::NormalClassic,
        )?;
        install_source_progression(&mut state, bootstrap, content)?;
        initialize_source_stats(&mut state, content)?;
    }
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    Ok(state)
}

fn install_source_progression(
    state: &mut GameStateV6,
    bootstrap: &RunBootstrapMachineV1,
    content: &PreparedGameContentV2,
) -> Result<(), NaturalRunV6Error> {
    use er_state::current_source_progression::{
        CurrentSourceConfigurationV1, CurrentSourceInitialEnemyV1, CurrentSourcePokemonV1,
        CurrentSourceProgressionV1,
    };
    let profile = state
        .current_friendship_profile
        .as_ref()
        .ok_or(NaturalRunV6Error::Invalid)?;
    let run = state
        .active_run
        .as_ref()
        .ok_or(NaturalRunV6Error::Invalid)?;
    let battle = run.battle.as_ref().ok_or(NaturalRunV6Error::Invalid)?;
    validate_cooperative_choices_v7(content, profile.owner_seat, &bootstrap.selections.starters)?;
    if run.party.len() != bootstrap.selections.starters.len()
        || run.wave.get().get() != 1
        || battle.format != BattleFormat::single()
        || battle.enemy_party.len() != 1
    {
        return Err(NaturalRunV6Error::Invalid);
    }
    let party = run
        .party
        .iter()
        .zip(&bootstrap.selections.starters)
        .map(|(pokemon, selection)| {
            // Prepared bootstrap emits index0 and prepared battle selects the
            // source active_ability_ids[0]. Other indexes need an actual resolver.
            if selection.ability_index != 0
                || pokemon.species_id.get() != selection.species_id
                || pokemon.form_index != selection.form_index
                || pokemon.owner_seat != Some(selection.owner_seat)
            {
                return Err(NaturalRunV6Error::Invalid);
            }
            Ok(CurrentSourcePokemonV1 {
                pokemon: pokemon.id,
                selection: selection.clone(),
                ability_index: selection.ability_index,
            })
        })
        .collect::<Result<Vec<_>, NaturalRunV6Error>>()?;
    let source = CurrentSourceProgressionV1 {
        run_id: run.run_id,
        profile_owner: profile.owner_seat,
        configuration: CurrentSourceConfigurationV1::FreshOrdinaryClassic399d,
        initial_battle: battle.battle_id,
        initial_wave: run.wave,
        initial_faint: er_state::current_faint_execution::CurrentInitialEnemyFaintV1::fresh(),
        party,
        initial_enemy: CurrentSourceInitialEnemyV1 {
            pokemon: battle.enemy_party[0].id,
            species: battle.enemy_party[0].species_id,
            form_index: battle.enemy_party[0].form_index,
            level: battle.enemy_party[0].level,
        },
    };
    if !source.valid(run) {
        return Err(NaturalRunV6Error::Invalid);
    }
    state
        .current_battle_participation
        .as_mut()
        .and_then(|owner| owner.experience.as_mut())
        .ok_or(NaturalRunV6Error::Invalid)?
        .source_progression = Some(source);
    Ok(())
}

fn initialize_source_stats(
    state: &mut GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<(), NaturalRunV6Error> {
    crate::current_source_progression::current_source_progression(state, content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let run = state
        .active_run
        .as_mut()
        .ok_or(NaturalRunV6Error::Invalid)?;
    let battle = run.battle.as_mut().ok_or(NaturalRunV6Error::Invalid)?;
    for pokemon in run.party.iter_mut().chain(&mut battle.enemy_party) {
        let bonuses = &pokemon.permanent_bonuses;
        if pokemon.form_index != 0
            || pokemon.species_id.get().get() == 292
            || pokemon.hp != pokemon.max_hp
            || pokemon.fainted
            || [
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
            return Err(NaturalRunV6Error::Invalid);
        }
        let species = content
            .battle
            .species(pokemon.species_id)
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
        let form = content
            .battle
            .form(
                &FormId::parse(format!(
                    "{}:{}",
                    pokemon.species_id.get().get(),
                    pokemon.form_index
                ))
                .map_err(|_| NaturalRunV6Error::Invalid)?,
            )
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
        if form.species != pokemon.species_id {
            return Err(NaturalRunV6Error::Invalid);
        }
        let base = form.stat_override.unwrap_or(species.base_stats);
        let nature = content
            .progression
            .pack()
            .natures
            .iter()
            .find(|row| row.id == pokemon.effective_nature)
            .ok_or(NaturalRunV6Error::Invalid)?;
        let stats = er_progression::current_stats::calculate_current_unmodified_stats(
            pokemon, base, nature,
        )
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
        // This is the actual fresh constructor, before any damage or public
        // action. Preserve all original selection/RNG draws; only source stat
        // rounding changes. Historical construction retains its old helper.
        pokemon.stats = stats;
        pokemon.max_hp = stats.hp;
        pokemon.hp = stats.hp;
    }
    Ok(())
}

/// Focused observation-only constructor. Default construction and production ingress stay unchanged.
pub fn construct_natural_run_v6_with_participation(
    bootstrap: &RunBootstrapMachineV1,
    content: &PreparedGameContentV2,
    authority_revision: SafeU53,
) -> Result<GameStateV6, NaturalRunV6Error> {
    let mut state = construct_natural_run_v6(bootstrap, content, authority_revision)?;
    if state.current_battle_participation.is_some() {
        return Ok(state);
    }
    let run = state
        .active_run
        .as_ref()
        .ok_or(NaturalRunV6Error::Invalid)?;
    state.current_battle_participation = Some(
        er_state::current_battle_participation::CurrentBattleParticipationV1::fresh(run, safe(1)?)
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?,
    );
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    Ok(state)
}
/// First natural wild encounter only. Records unresolved source context, never neutral admission.
/// Default construction stays unchanged; ambiguous compiled species rows fail closed.
pub fn construct_natural_run_v6_with_pending_experience(
    bootstrap: &RunBootstrapMachineV1,
    content: &PreparedGameContentV2,
    authority_revision: SafeU53,
    cap_policy: er_state::current_experience_owner::CurrentExperienceCapPolicyV1,
) -> Result<GameStateV6, NaturalRunV6Error> {
    let mut state =
        construct_natural_run_v6_with_participation(bootstrap, content, authority_revision)?;
    if let Some(owner) = state
        .current_battle_participation
        .as_ref()
        .and_then(|value| value.experience.as_ref())
    {
        if owner.cap_policy != cap_policy {
            return Err(NaturalRunV6Error::Invalid);
        }
        return Ok(state);
    }
    install_pending_experience(&mut state, content, cap_policy)?;
    Ok(state)
}

fn install_pending_experience(
    state: &mut GameStateV6,
    content: &PreparedGameContentV2,
    cap_policy: er_state::current_experience_owner::CurrentExperienceCapPolicyV1,
) -> Result<(), NaturalRunV6Error> {
    use er_progression::content_v2::ExperienceSourceFormV2;
    use er_state::current_experience_owner::{
        CurrentExperienceEncounterV1, CurrentExperienceOwnerV1, CurrentExperienceSourceV1,
    };
    use er_state::m9e_state_v6::GameStateV6ContentContext;
    let run = state
        .active_run
        .as_ref()
        .ok_or(NaturalRunV6Error::Invalid)?;
    if !content.supports_current_experience_mode(run.mode) {
        return Err(NaturalRunV6Error::Invalid);
    }
    let observation = state
        .current_battle_participation
        .as_ref()
        .ok_or(NaturalRunV6Error::Invalid)?;
    let battle = run.battle.as_ref().ok_or(NaturalRunV6Error::Invalid)?;
    let mut sources = Vec::with_capacity(battle.enemy_party.len());
    for pokemon in &battle.enemy_party {
        let metadata = content
            .progression
            .experience_for_compiled_form(pokemon.species_id, pokemon.form_index)
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
        sources.push(CurrentExperienceSourceV1 {
            pokemon: pokemon.id,
            species: pokemon.species_id,
            compiled_form: pokemon.form_index,
            source_form: match metadata.source_form {
                ExperienceSourceFormV2::Species => None,
                ExperienceSourceFormV2::Form(index) => Some(index),
            },
            unadjusted_base_exp: metadata.base_exp,
            source_sprite_key: metadata.source_sprite_key.clone(),
        });
    }
    sources.sort_by_key(|source| source.pokemon);
    let mut experience = CurrentExperienceOwnerV1::fresh(
        observation,
        run,
        state.content_identity.clone(),
        cap_policy,
        CurrentExperienceEncounterV1::OrdinaryWild,
        sources,
    )
    .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    if state
        .current_friendship_profile
        .as_ref()
        .and_then(|profile| profile.rewards.as_ref())
        .is_some()
        && state.current_targeting.is_some()
    {
        experience.execution_origin = Some(
            er_state::current_experience_owner::CurrentExperienceExecutionOriginV1::FreshNormalClassic,
        );
    }
    state
        .current_battle_participation
        .as_mut()
        .ok_or(NaturalRunV6Error::Invalid)?
        .experience = Some(experience);
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    Ok(())
}

/// Explicit resolved starter input, bound to the complete selected entry and its order.
/// Eligibility in the source starter profile remains the caller's responsibility.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentStarterPokerusV1 {
    pub selection: er_types::StarterSelectionV1,
    pub pokerus: bool,
}

/// Construct the existing pending-XP run with known starter Pokérus values.
/// Historical construction retains unknown values; this does not settle XP.
pub fn construct_natural_run_v6_with_starter_pokerus(
    bootstrap: &RunBootstrapMachineV1,
    content: &PreparedGameContentV2,
    authority_revision: SafeU53,
    cap_policy: er_state::current_experience_owner::CurrentExperienceCapPolicyV1,
    starters: &[CurrentStarterPokerusV1],
) -> Result<GameStateV6, NaturalRunV6Error> {
    if starters.len() != bootstrap.selections.starters.len()
        || starters
            .iter()
            .zip(&bootstrap.selections.starters)
            .any(|(resolved, selected)| resolved.selection != *selected)
    {
        return Err(NaturalRunV6Error::Invalid);
    }
    let mut state = construct_natural_run_v6_with_pending_experience(
        bootstrap,
        content,
        authority_revision,
        cap_policy,
    )?;
    let run = state
        .active_run
        .as_mut()
        .ok_or(NaturalRunV6Error::Invalid)?;
    if run.party.len() != starters.len() {
        return Err(NaturalRunV6Error::Invalid);
    }
    for (pokemon, starter) in run.party.iter_mut().zip(starters) {
        if pokemon.owner_seat != Some(starter.selection.owner_seat)
            || pokemon.species_id.get() != starter.selection.species_id
            || pokemon.form_index != starter.selection.form_index
        {
            return Err(NaturalRunV6Error::Invalid);
        }
        if pokemon
            .pokerus
            .is_some_and(|observed| observed != starter.pokerus)
        {
            return Err(NaturalRunV6Error::Invalid);
        }
        pokemon.pokerus = Some(starter.pokerus);
    }
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    Ok(state)
}

/// Historical fixture expansion. Current owned setup supplies both seats' choices.
pub fn expand_cooperative_topology_v6(
    state: &mut GameStateV6,
    content: &PreparedGameContentV2,
    partner_seat: SeatId,
) -> Result<(), NaturalRunV6Error> {
    let species = state
        .active_run
        .as_ref()
        .and_then(|run| run.party.first())
        .map(|pokemon| pokemon.species_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let starter = content
        .bundle()
        .bootstrap
        .starters
        .iter()
        .find(|starter| starter.species_id != species)
        .ok_or(NaturalRunV6Error::Invalid)?;
    expand_selected_cooperative_topology_v7(
        state,
        content,
        partner_seat,
        &[(starter.species_id, starter.form_index)],
    )
}

/// Form the partner party from confirmed choices; no fallback selects a species.
/// The caller must additionally validate causal peer identity and confirmation.
/// This operation stages identities, RNG and all party/field changes atomically.
pub fn expand_cooperative_choices_v7(
    state: &mut GameStateV6,
    content: &PreparedGameContentV2,
    partner_seat: SeatId,
    starters: &[er_types::StarterSelectionV1],
) -> Result<(), NaturalRunV6Error> {
    validate_cooperative_choices_v7(content, partner_seat, starters)?;
    let choices = starters
        .iter()
        .map(|starter| {
            (
                er_types::battle_ids::SpeciesId::new(starter.species_id),
                starter.form_index,
            )
        })
        .collect::<Vec<_>>();
    let mut candidate = state.clone();
    expand_selected_cooperative_topology_v7(&mut candidate, content, partner_seat, &choices)?;
    *state = candidate;
    Ok(())
}

fn expand_selected_cooperative_topology_v7(
    state: &mut GameStateV6,
    content: &PreparedGameContentV2,
    partner_seat: SeatId,
    starters: &[(er_types::battle_ids::SpeciesId, u16)],
) -> Result<(), NaturalRunV6Error> {
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let (mode_id, biome_id, enemy_species, run_rng) = {
        let run = state
            .active_run
            .as_ref()
            .ok_or(NaturalRunV6Error::Invalid)?;
        let mode = content
            .world
            .mode(run.mode)
            .ok_or(NaturalRunV6Error::Invalid)?;
        if !mode.cooperative
            || run
                .party
                .iter()
                .any(|pokemon| pokemon.owner_seat == Some(partner_seat))
        {
            return Err(NaturalRunV6Error::Invalid);
        }
        let battle = run.battle.as_ref().ok_or(NaturalRunV6Error::Invalid)?;
        if battle.format != BattleFormat::single() || battle.enemy_party.len() != 1 {
            return Err(NaturalRunV6Error::Invalid);
        }
        (
            run.mode,
            run.world.biome,
            battle.enemy_party[0].species_id,
            run.run_rng.clone(),
        )
    };
    let mode = content
        .world
        .mode(mode_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let biome = content
        .world
        .biome(biome_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let partner_enemy_species = biome
        .pokemon_pools
        .iter()
        .flat_map(|pool| pool.species.iter().copied())
        .find(|species| *species != enemy_species)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let mut rng = RngRuntime::from_states(run_rng, None)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let mut partners = Vec::with_capacity(starters.len());
    for &(species, form) in starters {
        let id = state
            .identities
            .allocate_pokemon_id()
            .map_err(|_| NaturalRunV6Error::Exhausted)?;
        partners.push(pokemon(
            content,
            &mut rng,
            id,
            Some(partner_seat),
            species,
            form,
            mode.starting_level,
        )?);
    }
    let partner_id = partners
        .first()
        .map(|pokemon| pokemon.id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let partner_enemy_id = state
        .identities
        .allocate_pokemon_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let partner_enemy = pokemon(
        content,
        &mut rng,
        partner_enemy_id,
        None,
        partner_enemy_species,
        0,
        mode.starting_level,
    )?;
    let run = state
        .active_run
        .as_mut()
        .ok_or(NaturalRunV6Error::Invalid)?;
    run.run_rng = rng.run_state();
    let battle = run.battle.as_mut().ok_or(NaturalRunV6Error::Invalid)?;
    let player_id = run
        .party
        .first()
        .map(|pokemon| pokemon.id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let enemy_id = battle
        .enemy_party
        .first()
        .map(|pokemon| pokemon.id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    run.party.extend(partners);
    battle.enemy_party.push(partner_enemy);
    battle.format = BattleFormat::forced_coop_doubles();
    battle.field = FieldState::new_for_format(
        &battle.format,
        vec![
            FieldSlotState::new(
                FieldSlot::new(BattleSide::Player, 0).map_err(|_| NaturalRunV6Error::Invalid)?,
                Some(player_id),
            ),
            FieldSlotState::new(
                FieldSlot::new(BattleSide::Player, 1).map_err(|_| NaturalRunV6Error::Invalid)?,
                Some(partner_id),
            ),
            FieldSlotState::new(
                FieldSlot::new(BattleSide::Enemy, 0).map_err(|_| NaturalRunV6Error::Invalid)?,
                Some(enemy_id),
            ),
            FieldSlotState::new(
                FieldSlot::new(BattleSide::Enemy, 1).map_err(|_| NaturalRunV6Error::Invalid)?,
                Some(partner_enemy_id),
            ),
        ],
    )
    .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))
}

pub fn advance_to_next_encounter_v6(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<(GameStateV6, Vec<RngDraw>), NaturalRunV6Error> {
    state
        .validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    // Rebase/settlement is deliberately not implemented. Never drop source context or pending work.
    if state
        .current_battle_participation
        .as_ref()
        .is_some_and(|owner| owner.experience.is_some())
    {
        return Err(NaturalRunV6Error::Invalid);
    }
    let mut next = state.clone();
    // Default between-wave rest follows the global ten-wave checkpoint cadence.
    // Heal the persistent party before selecting the next player field occupant.
    if let Some(run) = next.active_run.as_mut()
        && run.wave.get().get() % 10 == 0
    {
        for pokemon in &mut run.party {
            pokemon.hp = pokemon.max_hp;
            pokemon.fainted = false;
            pokemon.status = StatusState {
                kind: StatusKind::None,
                toxic_turn_count: 0,
                sleep_turns_remaining: None,
            };
            for slot in pokemon.moves.iter_mut().flatten() {
                slot.pp_used = 0;
            }
        }
    }
    let (previous, next_wave_value, biome_id, mode_id, run_rng, run_seed, player_id) = {
        let run = next.active_run.as_ref().ok_or(NaturalRunV6Error::Invalid)?;
        let previous = run.battle.clone().ok_or(NaturalRunV6Error::Invalid)?;
        if previous.outcome != BattleOutcome::Victory
            || previous.enemy_party.iter().any(|pokemon| !pokemon.fainted)
        {
            return Err(NaturalRunV6Error::Invalid);
        }
        let next_wave_value = run
            .wave
            .get()
            .get()
            .checked_add(1)
            .ok_or(NaturalRunV6Error::Exhausted)?;
        let player_id = run
            .party
            .iter()
            .find(|pokemon| !pokemon.fainted)
            .map(|pokemon| pokemon.id)
            .ok_or(NaturalRunV6Error::Invalid)?;
        (
            previous,
            next_wave_value,
            run.world.biome,
            run.mode,
            run.run_rng.clone(),
            run.seed.clone(),
            player_id,
        )
    };
    let next_wave = WaveIndex::new(safe(next_wave_value)?)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let biome = content
        .world
        .biome(biome_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let mut rng = RngRuntime::from_states(run_rng, None)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let enemy_species = select_encounter_species(biome, &mut rng)?;
    let mode = content
        .world
        .mode(mode_id)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let level_gain = u16::try_from((next_wave_value.saturating_sub(1)) / 2)
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let level = mode
        .starting_level
        .checked_add(level_gain)
        .ok_or(NaturalRunV6Error::Exhausted)?;
    let enemy_id = next
        .identities
        .allocate_pokemon_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let enemy = pokemon(content, &mut rng, enemy_id, None, enemy_species, 0, level)?;
    let format = if mode.cooperative {
        BattleFormat::forced_coop_doubles()
    } else {
        BattleFormat::single()
    };
    let player_ids = if mode.cooperative {
        let run = next.active_run.as_ref().ok_or(NaturalRunV6Error::Invalid)?;
        let mut owners = BTreeMap::new();
        for pokemon in &run.party {
            let seat = pokemon.owner_seat.ok_or(NaturalRunV6Error::Invalid)?;
            let living = owners.entry(seat).or_insert(None);
            if living.is_none() && !pokemon.fainted {
                *living = Some(pokemon.id);
            }
        }
        if owners.len() != 2 {
            return Err(NaturalRunV6Error::Invalid);
        }
        let authority = owners
            .remove(&previous.authority_seat)
            .ok_or(NaturalRunV6Error::Invalid)?;
        let partner = owners
            .into_values()
            .next()
            .ok_or(NaturalRunV6Error::Invalid)?;
        vec![authority, partner]
    } else {
        vec![Some(player_id)]
    };
    let mut enemy_party = vec![enemy];
    for _ in 1..format.enemy_capacity {
        let species = select_encounter_species(biome, &mut rng)?;
        let id = next
            .identities
            .allocate_pokemon_id()
            .map_err(|_| NaturalRunV6Error::Exhausted)?;
        enemy_party.push(pokemon(content, &mut rng, id, None, species, 0, level)?);
    }
    let battle_id = next
        .identities
        .allocate_battle_id()
        .map_err(|_| NaturalRunV6Error::Exhausted)?;
    let mut slots = Vec::new();
    for (position, occupant) in player_ids.into_iter().enumerate() {
        let position = u8::try_from(position).map_err(|_| NaturalRunV6Error::Invalid)?;
        slots.push(FieldSlotState::new(
            FieldSlot::new(BattleSide::Player, position).map_err(|_| NaturalRunV6Error::Invalid)?,
            occupant,
        ));
    }
    for (position, enemy) in enemy_party.iter().enumerate() {
        let position = u8::try_from(position).map_err(|_| NaturalRunV6Error::Invalid)?;
        slots.push(FieldSlotState::new(
            FieldSlot::new(BattleSide::Enemy, position).map_err(|_| NaturalRunV6Error::Invalid)?,
            Some(enemy.id),
        ));
    }
    let field = FieldState::new_for_format(&format, slots)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let battle_seed = format!("{run_seed}:battle:{next_wave_value}");
    let battle_rng = rng
        .initialize_battle(&battle_seed, next_wave)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let audit = rng.audit_entries().to_vec();
    let run = next.active_run.as_mut().ok_or(NaturalRunV6Error::Invalid)?;
    run.run_rng = rng.run_state();
    run.wave = next_wave;
    run.world.encounter_sequence = safe(
        run.world
            .encounter_sequence
            .get()
            .checked_add(1)
            .ok_or(NaturalRunV6Error::Exhausted)?,
    )?;
    run.battle = Some(BattleStateV5 {
        schema_version: BATTLE_STATE_SCHEMA_VERSION_V5,
        battle_id,
        wave: next_wave,
        wave_seed: battle_seed,
        turn: battle_rng.turn,
        format,
        authority_seat: previous.authority_seat,
        enemy_party,
        field,
        weather: WeatherState {
            kind: WeatherKind::None,
            remaining_turns: 0,
        },
        terrain: TerrainState {
            kind: TerrainKind::None,
            remaining_turns: 0,
        },
        arena_conditions: Vec::new(),
        global_ability_suppression: GlobalAbilitySuppressionState {
            ignore_abilities: false,
            source: None,
        },
        battle_rng,
        command_state: CommandCollectionState {
            frontier: Vec::new(),
            tombstones: Vec::new(),
        },
        mechanics: MechanicStateStoreV2::default(),
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::new(safe(1)?),
        outcome: BattleOutcome::Ongoing,
    });
    if let Some(prior) = &state.current_battle_participation {
        next.current_battle_participation = Some(
            er_state::current_battle_participation::CurrentBattleParticipationV1::fresh(
                next.active_run.as_ref().ok_or(NaturalRunV6Error::Invalid)?,
                prior.next_occurrence,
            )
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?,
        );
    }
    if next.profile.statistics.highest_wave < next_wave {
        next.profile.statistics.highest_wave = next_wave;
    }
    next.validate_with(content)
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    Ok((next, audit))
}

fn select_encounter_species(
    biome: &er_world::content_v2::BiomeDefinitionV2,
    rng: &mut RngRuntime,
) -> Result<er_types::battle_ids::SpeciesId, NaturalRunV6Error> {
    let tier_roll = rng
        .run_rand_seed_int(
            safe(512)?,
            SafeU53::ZERO,
            RngReason::RandomSelector,
            RngCallsiteId::mechanics(RngReason::RandomSelector),
        )
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?
        .get();
    let mut tier = if tier_roll >= 156 {
        0_i16
    } else if tier_roll >= 32 {
        1
    } else if tier_roll >= 6 {
        2
    } else if tier_roll >= 1 {
        3
    } else {
        4
    };
    let candidates = loop {
        let mut candidates = biome
            .pokemon_pools
            .iter()
            .filter(|pool| pool.tier == tier && pool.time_of_day == -1)
            .flat_map(|pool| pool.species.iter().copied())
            .collect::<Vec<_>>();
        if candidates.is_empty() {
            candidates.extend(
                biome
                    .pokemon_pools
                    .iter()
                    .filter(|pool| pool.tier == tier)
                    .flat_map(|pool| pool.species.iter().copied()),
            );
        }
        candidates.sort_unstable();
        candidates.dedup();
        if !candidates.is_empty() || tier == 0 {
            break candidates;
        }
        tier -= 1;
    };
    if candidates.is_empty() {
        return Err(NaturalRunV6Error::Invalid);
    }
    let selected = rng
        .run_pick_index(
            candidates.len(),
            RngReason::RandomSelector,
            RngCallsiteId::mechanics(RngReason::RandomSelector),
        )
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    Ok(candidates[selected])
}

fn pokemon(
    content: &PreparedGameContentV2,
    rng: &mut RngRuntime,
    id: er_types::battle_ids::PokemonId,
    owner_seat: Option<SeatId>,
    species_id: er_types::battle_ids::SpeciesId,
    form_index: u16,
    level: u16,
) -> Result<PokemonStateV5, NaturalRunV6Error> {
    let species = content
        .battle
        .species(species_id)
        .map_err(|_| NaturalRunV6Error::Invalid)?;
    let form_id = FormId::parse(format!("{}:{form_index}", species_id.get().get()))
        .map_err(|_| NaturalRunV6Error::Invalid)?;
    let form = content
        .battle
        .form(&form_id)
        .map_err(|_| NaturalRunV6Error::Invalid)?;
    let base = form.stat_override.unwrap_or(species.base_stats);
    let typing = form.typing_override.unwrap_or(species.typing);
    let abilities = form
        .ability_override
        .as_ref()
        .unwrap_or(&species.ability_slots);
    let progression = content
        .progression
        .species(species_id, form_index)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let growth = content
        .progression
        .growth_rate(progression.growth_rate)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let experience =
        er_progression::progression::current_growth_experience_for_level(growth, level)
            .map_err(|_| NaturalRunV6Error::Invalid)?;
    let mut ivs = [Iv::new(0).map_err(|_| NaturalRunV6Error::Invalid)?; 6];
    for iv in &mut ivs {
        let draw = rng
            .run_integer_in_range(
                SafeU53::ZERO,
                safe(31)?,
                RngReason::RandomStat,
                RngCallsiteId::mechanics(RngReason::RandomStat),
            )
            .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
        *iv = Iv::new(u8::try_from(draw.get()).map_err(|_| NaturalRunV6Error::Invalid)?)
            .map_err(|_| NaturalRunV6Error::Invalid)?;
    }
    let nature_index = rng
        .run_pick_index(
            content.progression.pack().natures.len(),
            RngReason::RandomSelector,
            RngCallsiteId::mechanics(RngReason::RandomSelector),
        )
        .map_err(|error| NaturalRunV6Error::State(error.to_string()))?;
    let nature = content
        .progression
        .pack()
        .natures
        .get(nature_index)
        .ok_or(NaturalRunV6Error::Invalid)?;
    let stats = stats(base, level, &ivs, nature)?;
    let moves = progression
        .level_moves
        .iter()
        .filter(|entry| entry.level > 0 && entry.level <= level as i16)
        .map(|entry| entry.move_id)
        .fold(Vec::new(), |mut moves, move_id| {
            if !moves.contains(&move_id) {
                moves.push(move_id);
            }
            moves
        });
    let selected = moves.into_iter().rev().take(4).collect::<Vec<_>>();
    if selected.is_empty() {
        return Err(NaturalRunV6Error::Invalid);
    }
    let mut move_slots = [None; 4];
    for (index, move_id) in selected.into_iter().rev().enumerate() {
        move_slots[index] = Some(MoveSlotState {
            move_id,
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        });
    }
    Ok(PokemonStateV5 {
        schema_version: POKEMON_STATE_SCHEMA_VERSION_V5,
        id,
        owner_seat,
        species_id,
        form_index,
        level,
        experience,
        types: PokemonTyping {
            primary: typing.primary,
            secondary: typing.secondary,
        },
        stats,
        hp: stats.hp,
        max_hp: stats.hp,
        status: StatusState {
            kind: StatusKind::None,
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
        moves: move_slots,
        abilities: AbilityLoadout {
            active: abilities.active,
            passives: abilities.passives,
            active_suppressed: false,
            passive_suppressed: [false; 3],
        },
        ivs,
        gender: None,
        pokerus: None,
        nature: nature.id,
        effective_nature: nature.id,
        friendship: progression.base_friendship,
        permanent_bonuses: PermanentStatBonuses {
            hp: 0,
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
        },
        pause_evolutions: false,
        held_items: Vec::new(),
        mechanics: MechanicStateStoreV2::default(),
        fusion: None,
        evolution: er_state::m7_state::EvolutionStateV1 {
            last_completed: None,
            cancelled: Vec::new(),
        },
        tera_type: None,
        shiny: false,
        variant: 0,
        capture: None,
        fainted: false,
    })
}

fn stats(
    base: er_content::species::SpeciesBaseStats,
    level: u16,
    ivs: &[Iv; 6],
    nature: &er_progression::NatureDefinitionV1,
) -> Result<BattleStats, NaturalRunV6Error> {
    let regular = |base: u32, iv: Iv, stat: er_types::battle_model::BattleStat| {
        let raw = (base
            .checked_mul(2)?
            .checked_add(u32::from(iv.get()))?
            .checked_mul(u32::from(level))?
            / 100)
            .checked_add(5)?;
        if nature.increased_stat == Some(stat) && nature.decreased_stat != Some(stat) {
            raw.checked_mul(110).map(|value| value / 100)
        } else if nature.decreased_stat == Some(stat) && nature.increased_stat != Some(stat) {
            raw.checked_mul(90).map(|value| value / 100)
        } else {
            Some(raw)
        }
    };
    let hp = base
        .hp
        .checked_mul(2)
        .and_then(|value| value.checked_add(u32::from(ivs[0].get())))
        .and_then(|value| value.checked_mul(u32::from(level)))
        .map(|value| value / 100)
        .and_then(|value| value.checked_add(u32::from(level)))
        .and_then(|value| value.checked_add(10))
        .ok_or(NaturalRunV6Error::Exhausted)?;
    use er_types::battle_model::BattleStat;
    Ok(BattleStats {
        hp,
        attack: regular(base.attack, ivs[1], BattleStat::Attack)
            .ok_or(NaturalRunV6Error::Exhausted)?,
        defense: regular(base.defense, ivs[2], BattleStat::Defense)
            .ok_or(NaturalRunV6Error::Exhausted)?,
        special_attack: regular(base.special_attack, ivs[3], BattleStat::SpecialAttack)
            .ok_or(NaturalRunV6Error::Exhausted)?,
        special_defense: regular(base.special_defense, ivs[4], BattleStat::SpecialDefense)
            .ok_or(NaturalRunV6Error::Exhausted)?,
        speed: regular(base.speed, ivs[5], BattleStat::Speed)
            .ok_or(NaturalRunV6Error::Exhausted)?,
    })
}

fn safe(value: u64) -> Result<SafeU53, NaturalRunV6Error> {
    SafeU53::new(value).map_err(|_| NaturalRunV6Error::Exhausted)
}

fn increment(value: SafeU53) -> Result<SafeU53, NaturalRunV6Error> {
    let next = value
        .get()
        .checked_add(1)
        .ok_or(NaturalRunV6Error::Exhausted)?;
    safe(next)
}

/// Check explicit starter records against the prepared source catalog before retention.
pub fn validate_cooperative_choices_v7(
    content: &PreparedGameContentV2,
    partner_seat: SeatId,
    starters: &[er_types::StarterSelectionV1],
) -> Result<(), NaturalRunV6Error> {
    if starters.is_empty()
        || starters.len() > content.bundle().bootstrap.maximum_starters
        || starters
            .iter()
            .any(|starter| starter.owner_seat != partner_seat)
        || starters.iter().enumerate().any(|(index, starter)| {
            starters[..index]
                .iter()
                .any(|other| other.pokemon_id == starter.pokemon_id)
        })
    {
        return Err(NaturalRunV6Error::Invalid);
    }
    let mut cost = 0_u16;
    for starter in starters {
        let index = usize::try_from(starter.pokemon_id.get().get())
            .ok()
            .and_then(|index| index.checked_sub(1))
            .ok_or(NaturalRunV6Error::Invalid)?;
        let entry = content
            .bundle()
            .bootstrap
            .starters
            .get(index)
            .ok_or(NaturalRunV6Error::Invalid)?;
        if entry.species_id.get() != starter.species_id
            || entry.form_index != starter.form_index
            || entry.ability_index != starter.ability_index
            || entry.cost != starter.cost
        {
            return Err(NaturalRunV6Error::Invalid);
        }
        cost = cost
            .checked_add(starter.cost)
            .ok_or(NaturalRunV6Error::Invalid)?;
    }
    if cost > content.bundle().bootstrap.maximum_starter_cost {
        return Err(NaturalRunV6Error::Invalid);
    }
    Ok(())
}
