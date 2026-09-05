//! Read-only ordinary damage queries share the actual current turn resolver.
//! Completed bootstrap selections and battle statistics below are controlled fixtures.

use er_battle::m7_resolver::{
    BattleV5Error, TurnAuthorityContextV1, query_simulated_move_damage_v5, resolve_turn_v5,
};
use er_rng::audit::RngReason;
use er_state::m7_state::{GameStateV5, RunStateV3};
use er_state::m9e_state_v6::GameStateV6;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleTargetSelection, CommandSet,
    ScriptedEnemyBattleCommandV1, scripted_enemy_command_operation_id,
};
use er_types::battle_ids::{AbilityId, BattleSide, FieldSlot, MoveId, MoveSlotIndex};
use er_types::battle_model::{
    AbilityLoadout, BattleStats, MoveAccuracy, MoveCategory, MovePower, MoveSlotState, PokemonType,
    PokemonTyping,
};

use std::error::Error;
use std::sync::{Arc, OnceLock};

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_new_run_v6::construct_natural_run_v6;
use er_game::m72_bootstrap::{
    BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapMachineV1, RunBootstrapStageV1,
};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::{PokemonId, WaveIndex};
use er_types::{GameContentIdentity, RunDifficultyV1, SafeU53, SeatId, StarterSelectionV1};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
}

fn profile() -> Result<ProfileStateV1, Box<dyn Error>> {
    Ok(ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: Default::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(safe(1))?,
        },
        dex: DexState::default(),
    })
}

fn build_fixture() -> TestResult<(Arc<PreparedGameContentV2>, GameStateV6)> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = PreparedGameContentV2::prepare(Arc::new(bundle))?;
    let owner = SeatId::new(safe(1));
    let starters = content
        .bundle()
        .bootstrap
        .starters
        .iter()
        .enumerate()
        .map(|(index, starter)| {
            Ok(StarterSelectionV1 {
                pokemon_id: PokemonId::new(safe(u64::try_from(index)? + 1)),
                species_id: starter.species_id.get(),
                form_index: starter.form_index,
                ability_index: starter.ability_index,
                cost: starter.cost,
                owner_seat: owner,
            })
        })
        .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
    let catalog = BootstrapCatalogV1 {
        modes: content
            .bundle()
            .bootstrap
            .modes
            .iter()
            .map(|mode| BootstrapModePolicyV1 {
                mode: mode.mode,
                challenge_selection: mode.challenge_selection,
                cooperative: mode.cooperative,
                supported: mode.supported,
            })
            .collect(),
        challenges: content
            .bundle()
            .bootstrap
            .choices
            .iter()
            .flat_map(|choice| {
                choice
                    .values
                    .iter()
                    .cloned()
                    .map(|value| (choice.id.clone(), value))
            })
            .collect(),
        starters: starters.clone(),
        save_slots: vec!["preview-slot".to_owned()],
        automatic_coop_save_slot: None,
        maximum_starter_cost: content.bundle().bootstrap.maximum_starter_cost,
        maximum_starters: content.bundle().bootstrap.maximum_starters,
        local_is_host: true,
        developer_mode: false,
    };
    let mut bootstrap =
        RunBootstrapMachineV1::new(profile()?, "m9e-natural-run".to_owned(), owner, catalog)?;
    bootstrap.stage = RunBootstrapStageV1::Complete;
    bootstrap.selections.mode = Some(content.bundle().bootstrap.modes[0].mode);
    bootstrap.selections.starters = vec![starters[0].clone()];
    bootstrap.selections.difficulty = Some(RunDifficultyV1::Youngster);
    bootstrap.selections.save_slot = Some("preview-slot".to_owned());
    bootstrap.validate()?;

    let state = construct_natural_run_v6(&bootstrap, &content, safe(1))?;
    state.validate_with(&content)?;
    Ok((Arc::new(content), state))
}
fn fixture() -> TestResult<(Arc<PreparedGameContentV2>, GameStateV6)> {
    static FIXTURE: OnceLock<Result<(Arc<PreparedGameContentV2>, GameStateV6), String>> =
        OnceLock::new();
    FIXTURE
        .get_or_init(|| build_fixture().map_err(|error| error.to_string()))
        .as_ref()
        .cloned()
        .map_err(|error| error.clone().into())
}

fn ordinary_move(
    content: &PreparedGameContentV2,
    numeric_id: u64,
    category: MoveCategory,
    move_type: PokemonType,
    accuracy: MoveAccuracy,
    base_pp: u16,
) -> TestResult<MoveId> {
    // Pinned oracle move definitions: Cut=15, Confusion=93. Never rewrite the pack.
    let id = MoveId::new(safe(numeric_id));
    let definition = content.battle.move_definition(id)?;
    assert_eq!(definition.power, MovePower::Value(50));
    assert_eq!(definition.category, category);
    assert_eq!(definition.move_type, move_type);
    assert_eq!(definition.accuracy, accuracy);
    assert_eq!(definition.base_pp, base_pp);
    Ok(id)
}
fn controlled_state(
    content: &PreparedGameContentV2,
    mut state: GameStateV6,
) -> TestResult<GameStateV5> {
    let physical = ordinary_move(
        content,
        15,
        MoveCategory::Physical,
        PokemonType::Normal,
        MoveAccuracy::Percent(95),
        30,
    )?;
    let special = ordinary_move(
        content,
        93,
        MoveCategory::Special,
        PokemonType::Psychic,
        MoveAccuracy::Percent(100),
        25,
    )?;
    let splash = MoveId::new(safe(150));
    let splash_definition = content.battle.move_definition(splash)?;
    assert_eq!(splash_definition.category, MoveCategory::Status);
    assert_eq!(splash_definition.power, MovePower::None);
    let run = state.active_run.as_mut().ok_or("fixture run missing")?;
    let battle = run.battle.as_mut().ok_or("fixture battle missing")?;
    for pokemon in run.party.iter_mut().chain(battle.enemy_party.iter_mut()) {
        pokemon.level = 50;
        pokemon.hp = 400;
        pokemon.max_hp = 400;
        pokemon.fainted = false;
        pokemon.stats = BattleStats {
            hp: 400,
            attack: 100,
            defense: 50,
            special_attack: 100,
            special_defense: 200,
            speed: 100,
        };
        pokemon.abilities = AbilityLoadout {
            active: AbilityId::new(safe(1)),
            passives: [None; 3],
            active_suppressed: false,
            passive_suppressed: [false; 3],
        };
        pokemon.held_items.clear();
        pokemon.types = PokemonTyping {
            primary: PokemonType::Fire,
            secondary: None,
        };
        pokemon.moves = [
            Some(MoveSlotState {
                move_id: physical,
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            }),
            Some(MoveSlotState {
                move_id: special,
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            }),
            Some(MoveSlotState {
                move_id: splash,
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            }),
            None,
        ];
    }
    let current = GameStateV5 {
        schema_version: er_state::m7_state::GAME_STATE_SCHEMA_VERSION_V5,
        content_identity: GameContentIdentity {
            oracle_sha: state.content_identity.oracle_sha,
            content_hash: state.content_identity.bundle_hash,
            battle_content_hash: state.content_identity.battle_hash,
            semantic_catalog_hash: state.content_identity.semantic_catalog_hash,
        },
        profile: state.profile,
        active_run: state.active_run,
    };
    current.validate()?;
    Ok(current)
}

fn field(run: &RunStateV3, side: BattleSide) -> TestResult<FieldSlot> {
    run.battle
        .as_ref()
        .ok_or("battle missing")?
        .field
        .slots
        .iter()
        .find(|slot| slot.slot.side == side && slot.occupant.is_some())
        .map(|slot| slot.slot)
        .ok_or_else(|| "active field missing".into())
}

fn query(content: &PreparedGameContentV2, state: &GameStateV5, slot: u8) -> TestResult<u32> {
    let run = state.active_run.as_ref().ok_or("run missing")?;
    Ok(query_simulated_move_damage_v5(
        &content.battle,
        run,
        field(run, BattleSide::Enemy)?,
        MoveSlotIndex::new(slot)?,
        field(run, BattleSide::Player)?,
    )?)
}

#[test]
fn current_damage_query_distinguishes_equal_power_by_physical_and_special_bulk() -> TestResult {
    let (content, original) = fixture()?;
    let state = controlled_state(&content, original)?;
    let before = state.clone();
    // Pinned ordinary formula: ((2*50/5+2)*50*100/defense/50)+2.
    assert_eq!(query(&content, &state, 0)?, 46);
    assert_eq!(query(&content, &state, 1)?, 13);
    assert_eq!(state, before);
    let mut inverted = state.clone();
    let player = inverted
        .active_run
        .as_mut()
        .ok_or("run missing")?
        .party
        .first_mut()
        .ok_or("player missing")?;
    player.stats.defense = 200;
    player.stats.special_defense = 50;
    inverted.validate()?;
    assert_eq!(query(&content, &inverted, 1)?, 46);
    assert_eq!(query(&content, &inverted, 0)?, 13);
    assert_eq!(state, before);
    Ok(())
}

#[test]
fn current_damage_queries_preserve_full_turn_and_rng_audit_after_reordering() -> TestResult {
    let (content, original) = fixture()?;
    let state = controlled_state(&content, original)?;
    let run = state.active_run.as_ref().ok_or("run missing")?;
    let battle = run.battle.as_ref().ok_or("battle missing")?;
    let source = field(run, BattleSide::Enemy)?;
    let target = field(run, BattleSide::Player)?;
    let actor = battle
        .field
        .slots
        .iter()
        .find(|slot| slot.slot == source)
        .and_then(|slot| slot.occupant)
        .ok_or("enemy occupant missing")?;
    let command = ScriptedEnemyBattleCommandV1::new(
        scripted_enemy_command_operation_id(
            battle.battle_id,
            battle.wave,
            battle.turn,
            source,
            SafeU53::ZERO,
        )?,
        battle.battle_id,
        battle.wave,
        battle.turn,
        SafeU53::ZERO,
        actor,
        source,
        BattleCommand::fight(
            actor,
            MoveSlotIndex::new(1)?,
            BattleTargetSelection::selected(vec![target])?,
        ),
    )?;
    let commands = CommandSet::new(vec![AcceptedBattleCommand::scripted_enemy(command)])?;
    let authority = TurnAuthorityContextV1 {
        authority_seat: battle.authority_seat,
        revision: safe(1),
    };
    let baseline = resolve_turn_v5(&state, &commands, &content.battle, &authority)?;
    let before_bytes = serde_json::to_vec(&state)?;
    for (slot, expected) in [(0, 46), (1, 13), (1, 13), (0, 46)] {
        assert_eq!(query(&content, &state, slot)?, expected);
        assert_eq!(serde_json::to_vec(&state)?, before_bytes);
    }
    let after_queries = resolve_turn_v5(&state, &commands, &content.battle, &authority)?;
    assert_eq!(after_queries.rng_audit, baseline.rng_audit);
    assert_eq!(after_queries, baseline);
    assert_eq!(serde_json::to_vec(&state)?, before_bytes);
    let damage_draws = baseline
        .rng_audit
        .iter()
        .filter(|draw| draw.reason == RngReason::DamageVariance)
        .collect::<Vec<_>>();
    assert_eq!(damage_draws.len(), 1);
    assert!(damage_draws[0].consumed);
    let damage_reasons = baseline
        .rng_audit
        .iter()
        .filter(|draw| {
            matches!(
                draw.reason,
                RngReason::Accuracy | RngReason::CriticalHit | RngReason::DamageVariance
            )
        })
        .map(|draw| draw.reason)
        .collect::<Vec<_>>();
    assert_eq!(
        damage_reasons,
        vec![
            RngReason::Accuracy,
            RngReason::CriticalHit,
            RngReason::DamageVariance
        ]
    );
    for draw in &baseline.rng_audit {
        draw.validate()?;
    }
    let after_run = baseline
        .after_state
        .active_run
        .as_ref()
        .ok_or("after run missing")?;
    assert!(after_run.party[0].hp < run.party[0].hp);
    assert_eq!(after_run.run_rng, run.run_rng);
    assert_eq!(
        after_run
            .battle
            .as_ref()
            .ok_or("after battle missing")?
            .enemy_party[0]
            .moves[1]
            .ok_or("after enemy move missing")?
            .pp_used,
        1
    );
    Ok(())
}

#[test]
fn current_damage_query_honors_pp_up_and_override_bounds_without_mutation() -> TestResult {
    let (content, original) = fixture()?;
    let mut state = controlled_state(&content, original)?;
    let untouched = state.clone();
    let run = state.active_run.as_ref().ok_or("run missing")?;
    let source = field(run, BattleSide::Enemy)?;
    let target = field(run, BattleSide::Player)?;
    assert_eq!(
        query_simulated_move_damage_v5(
            &content.battle,
            run,
            source,
            MoveSlotIndex::new(3)?,
            target
        ),
        Err(BattleV5Error::MoveSlot),
    );
    assert_eq!(
        query_simulated_move_damage_v5(
            &content.battle,
            run,
            source,
            MoveSlotIndex::new(0)?,
            FieldSlot {
                side: BattleSide::Player,
                position: 1
            }
        ),
        Err(BattleV5Error::Target),
    );
    assert_eq!(state, untouched);
    let move_id = state
        .active_run
        .as_ref()
        .ok_or("run missing")?
        .battle
        .as_ref()
        .ok_or("battle missing")?
        .enemy_party[0]
        .moves[0]
        .ok_or("move missing")?
        .move_id;
    let base_pp = content.battle.move_definition(move_id)?.base_pp;
    {
        let slot = state
            .active_run
            .as_mut()
            .ok_or("run missing")?
            .battle
            .as_mut()
            .ok_or("battle missing")?
            .enemy_party[0]
            .moves[0]
            .as_mut()
            .ok_or("move missing")?;
        slot.pp_ups = 1;
        slot.pp_used = base_pp;
    }
    assert_eq!(
        query(&content, &state, 0)?,
        46,
        "PP Ups allow a query beyond base PP"
    );
    {
        let slot = state
            .active_run
            .as_mut()
            .ok_or("run missing")?
            .battle
            .as_mut()
            .ok_or("battle missing")?
            .enemy_party[0]
            .moves[0]
            .as_mut()
            .ok_or("move missing")?;
        slot.max_pp_override = Some(base_pp);
    }
    state.validate()?;
    let before = state.clone();
    let run = state.active_run.as_ref().ok_or("run missing")?;
    assert_eq!(
        query_simulated_move_damage_v5(
            &content.battle,
            run,
            field(run, BattleSide::Enemy)?,
            MoveSlotIndex::new(0)?,
            field(run, BattleSide::Player)?
        ),
        Err(BattleV5Error::MoveSlot)
    );
    assert_eq!(state, before);
    Ok(())
}
#[test]
fn current_damage_query_zero_and_inactive_inputs_leave_state_unchanged() -> TestResult {
    let (content, original) = fixture()?;
    let state = controlled_state(&content, original)?;
    let run = state.active_run.as_ref().ok_or("run missing")?;
    let source = field(run, BattleSide::Enemy)?;
    let target = field(run, BattleSide::Player)?;
    let before = state.clone();
    assert_eq!(
        query_simulated_move_damage_v5(
            &content.battle,
            run,
            source,
            MoveSlotIndex::new(2)?,
            source,
        )?,
        0,
        "published Splash is a no-power status move"
    );
    assert_eq!(state, before);

    let mut inactive = state.clone();
    let inactive_run = inactive.active_run.as_mut().ok_or("run missing")?;
    let inactive_battle = inactive_run.battle.as_mut().ok_or("battle missing")?;
    inactive_battle
        .field
        .slots
        .iter_mut()
        .find(|slot| slot.slot == source)
        .ok_or("source field missing")?
        .occupant = None;
    inactive.validate()?;
    let inactive_before = inactive.clone();
    assert_eq!(
        query_simulated_move_damage_v5(
            &content.battle,
            inactive.active_run.as_ref().ok_or("run missing")?,
            source,
            MoveSlotIndex::new(0)?,
            target,
        ),
        Err(BattleV5Error::Target)
    );
    assert_eq!(inactive, inactive_before);

    let mut fainted_actor = state.clone();
    let actor = fainted_actor
        .active_run
        .as_mut()
        .ok_or("run missing")?
        .battle
        .as_mut()
        .ok_or("battle missing")?
        .enemy_party
        .first_mut()
        .ok_or("enemy missing")?;
    actor.hp = 0;
    actor.fainted = true;
    let actor_id = actor.id;
    fainted_actor.validate()?;
    let fainted_actor_before = fainted_actor.clone();
    assert_eq!(
        query_simulated_move_damage_v5(
            &content.battle,
            fainted_actor.active_run.as_ref().ok_or("run missing")?,
            source,
            MoveSlotIndex::new(0)?,
            target,
        ),
        Err(BattleV5Error::InactiveActor(actor_id))
    );
    assert_eq!(fainted_actor, fainted_actor_before);

    let mut fainted_target = state.clone();
    let player = fainted_target
        .active_run
        .as_mut()
        .ok_or("run missing")?
        .party
        .first_mut()
        .ok_or("player missing")?;
    player.hp = 0;
    player.fainted = true;
    fainted_target.validate()?;
    let fainted_target_before = fainted_target.clone();
    assert_eq!(
        query_simulated_move_damage_v5(
            &content.battle,
            fainted_target.active_run.as_ref().ok_or("run missing")?,
            source,
            MoveSlotIndex::new(0)?,
            target,
        ),
        Err(BattleV5Error::Target)
    );
    assert_eq!(fainted_target, fainted_target_before);
    Ok(())
}
