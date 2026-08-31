use std::collections::BTreeMap;
use std::error::Error;
use std::sync::Arc;

use er_battle::m7_resolver::TurnAuthorityContextV1;
use er_game::m7_content::{GameContentBundleV1, PreparedGameContentV1};
use er_game::m7_runtime::GameRuntimeV5;
use er_game::m9_new_run::{
    build_m9_bootstrap_machine, construct_m9_new_run_state, prepare_m9_new_run_material,
    scripted_enemy_policy_for_m9, settle_m9_victory_and_start_next_encounter,
};
use er_game::m72_bootstrap::{
    BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapMachineV1, RunBootstrapStageV1,
};
use er_game::m72_new_run_material::apply_serialized_new_run_material_v1;
use er_kernel::m9_vertical::{M9VerticalControlV1, M9VerticalSliceKernelV1};
use er_state::m7_state::{
    DexState, GAME_STATE_SCHEMA_VERSION_V5, GameStateV5, PROFILE_STATE_SCHEMA_VERSION_V1,
    ProfileStateV1, ProfileStatistics,
};
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1, BattleTargetSelection,
    CommandSet, player_command_operation_id, turn_result_operation_id,
};
use er_types::battle_ids::{BattleSide, FieldSlot, MenuInstanceId, MoveSlotIndex};
use er_types::battle_ids::{GameModeId, PokemonId, WaveIndex};
use er_types::battle_model::BattleOutcome;
use er_types::{
    InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId, SetupChoiceIdV1, SetupChoiceValueV1,
    StarterSelectionV1,
};

const SEAM: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/bootstrap-seam.json"
));
const STARTER_ORACLE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/starter-oracle-v1.json"
));
const CONTENT: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/content-pack.json"
));

type Result<T = ()> = std::result::Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is a safe integer")
}

fn profile() -> ProfileStateV1 {
    ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: BTreeMap::new(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(safe(1)).expect("wave is positive"),
        },
        dex: DexState::default(),
    }
}

fn starter() -> StarterSelectionV1 {
    StarterSelectionV1 {
        pokemon_id: PokemonId::new(safe(1)),
        species_id: safe(1),
        form_index: 0,
        ability_index: 0,
        cost: 3,
        owner_seat: SeatId::new(safe(1)),
    }
}

fn catalog() -> BootstrapCatalogV1 {
    BootstrapCatalogV1 {
        modes: vec![BootstrapModePolicyV1 {
            mode: GameModeId::new(safe(1)),
            challenge_selection: false,
            cooperative: false,
            supported: true,
        }],
        challenges: vec![(
            SetupChoiceIdV1("challenge/none".to_owned()),
            SetupChoiceValueV1::Boolean(false),
        )],
        starters: vec![starter()],
        save_slots: vec!["rust-slot-0".to_owned()],
        automatic_coop_save_slot: None,
        maximum_starter_cost: 10,
        maximum_starters: 6,
        local_is_host: true,
        developer_mode: false,
    }
}

fn press(
    machine: &mut RunBootstrapMachineV1,
    events: &mut Vec<RawInputEvent>,
    key: PhysicalKey,
) -> Result {
    let down = RawInputEvent::KeyDown {
        code: key.clone(),
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    };
    let up = RawInputEvent::KeyUp { code: key };
    machine.raw_input(down.clone())?;
    machine.raw_input(up.clone())?;
    events.extend([down, up]);
    Ok(())
}

#[test]
fn raw_keys_complete_the_natural_solo_bootstrap_constructor() -> Result {
    let seam: serde_json::Value = serde_json::from_str(SEAM)?;
    assert_eq!(
        seam["release_sha"],
        "244a2c0161ebe7a7f6f686e62a99773db075cca2"
    );
    assert_eq!(seam["fixture_authored_battle_or_progression_claim"], false);

    let mut machine = RunBootstrapMachineV1::new(
        profile(),
        "m9-natural-solo-seed".to_owned(),
        SeatId::new(safe(1)),
        catalog(),
    )?;
    let mut raw_events = Vec::new();
    let mut stages = vec![machine.stage];

    for key in [
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::ArrowDown,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
    ] {
        press(&mut machine, &mut raw_events, key)?;
        if stages.last() != Some(&machine.stage) {
            stages.push(machine.stage);
        }
    }

    assert_eq!(
        stages,
        vec![
            RunBootstrapStageV1::Title,
            RunBootstrapStageV1::ModeSelect,
            RunBootstrapStageV1::StarterSelect,
            RunBootstrapStageV1::Confirmation,
            RunBootstrapStageV1::DifficultySelect,
            RunBootstrapStageV1::SaveSelect,
            RunBootstrapStageV1::Complete,
        ]
    );
    assert_eq!(raw_events.len(), 16);
    assert_eq!(machine.selections.starters, vec![starter()]);
    assert_eq!(machine.selections.save_slot.as_deref(), Some("rust-slot-0"));
    assert!(!machine.control.actionable);
    machine.validate()?;
    Ok(())
}

#[test]
fn raw_bootstrap_constructs_and_applies_exact_new_run_material() -> Result {
    let bundle: GameContentBundleV1 = serde_json::from_slice(CONTENT)?;
    let content = Arc::new(PreparedGameContentV1::prepare(Arc::new(bundle))?);
    let mut machine = build_m9_bootstrap_machine(
        profile(),
        SeatId::new(safe(1)),
        vec!["rust-slot-0".to_owned()],
        true,
        STARTER_ORACLE,
    )?;
    let mut raw_events = Vec::new();
    for key in [
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::ArrowDown,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
    ] {
        press(&mut machine, &mut raw_events, key)?;
    }
    assert_eq!(machine.stage, RunBootstrapStageV1::Complete);

    let (state, control) = construct_m9_new_run_state(&machine, &content, STARTER_ORACLE)?;
    let run = state.active_run.as_ref().ok_or("constructed run missing")?;
    let battle = run.battle.as_ref().ok_or("constructed battle missing")?;
    assert_eq!(run.party[0].species_id.get().get(), 1);
    assert_eq!(run.party[0].level, 5);
    assert_eq!(
        run.party[0].moves[0]
            .as_ref()
            .ok_or("starter move missing")?
            .move_id
            .get()
            .get(),
        22
    );
    assert_eq!(battle.enemy_party[0].species_id.get().get(), 16);
    assert_eq!(battle.enemy_party[0].moves.iter().flatten().count(), 4);
    assert_eq!(control.kind, er_types::GameControlKindV2::BattleCommand);
    assert_eq!(run.control, control);

    let oracle: serde_json::Value = serde_json::from_slice(STARTER_ORACLE)?;
    assert_eq!(
        run.run_rng.rdg.state_string,
        oracle["rng"]["after_state"]
            .as_str()
            .ok_or("oracle RNG state missing")?
    );
    let material = prepare_m9_new_run_material(&machine, &content, STARTER_ORACLE)?;
    assert_eq!(
        material.rng_audit.len(),
        oracle["rng"]["draws"]
            .as_array()
            .ok_or("oracle RNG draws missing")?
            .len()
    );
    assert_eq!(
        material
            .rng_audit
            .first()
            .ok_or("material RNG audit missing")?
            .before_state
            .run
            .state_string,
        oracle["rng"]["draws"][0]["before_state"]
            .as_str()
            .ok_or("oracle first RNG state missing")?
    );
    assert_eq!(
        material
            .rng_audit
            .last()
            .ok_or("material RNG audit missing")?
            .after_state
            .run
            .state_string,
        oracle["rng"]["draws"]
            .as_array()
            .and_then(|draws| draws.last())
            .and_then(|draw| draw["after_state"].as_str())
            .ok_or("oracle last recorded RNG state missing")?
    );
    let bytes = material.encode()?;
    let mut live = GameStateV5 {
        schema_version: GAME_STATE_SCHEMA_VERSION_V5,
        content_identity: content.identity().clone(),
        profile: machine.profile.clone(),
        active_run: None,
    };
    let mut applied = BTreeMap::new();
    assert!(apply_serialized_new_run_material_v1(
        &mut live,
        &content,
        &bytes,
        &mut applied,
    )?);
    assert_eq!(live, state);
    assert!(!apply_serialized_new_run_material_v1(
        &mut live,
        &content,
        &bytes,
        &mut applied,
    )?);
    Ok(())
}

#[test]
fn exact_new_run_resolves_real_turns_to_victory() -> Result {
    let bundle: GameContentBundleV1 = serde_json::from_slice(CONTENT)?;
    let content = Arc::new(PreparedGameContentV1::prepare(Arc::new(bundle))?);
    let mut machine = build_m9_bootstrap_machine(
        profile(),
        SeatId::new(safe(1)),
        vec!["rust-slot-0".to_owned()],
        true,
        STARTER_ORACLE,
    )?;
    let mut raw_events = Vec::new();
    for key in [
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::ArrowDown,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
    ] {
        press(&mut machine, &mut raw_events, key)?;
    }
    let (state, _) = construct_m9_new_run_state(&machine, &content, STARTER_ORACLE)?;
    let policy = scripted_enemy_policy_for_m9(&state)?;
    let mut runtime = GameRuntimeV5::new(state, content)?;
    let initial_player_pp = runtime
        .state()
        .active_run
        .as_ref()
        .and_then(|run| run.party[0].moves[0].as_ref())
        .ok_or("initial player move missing")?
        .pp_used;
    let initial_enemy_hp = runtime
        .state()
        .active_run
        .as_ref()
        .and_then(|run| run.battle.as_ref())
        .and_then(|battle| battle.enemy_party.first())
        .ok_or("initial enemy missing")?
        .hp;
    let mut rng_draws = 0_usize;
    let mut turns = 0_usize;

    for cursor in 0_usize..policy.commands.len() {
        let run = runtime
            .state()
            .active_run
            .as_ref()
            .ok_or("active run missing")?;
        let battle = run.battle.as_ref().ok_or("active battle missing")?;
        let player = run.party.first().ok_or("player missing")?;
        let player_slot = FieldSlot::new(BattleSide::Player, 0)?;
        let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)?;
        let operation_id = player_command_operation_id(
            battle.battle_id,
            battle.wave,
            battle.turn,
            player_slot,
            battle.authority_seat,
        )?;
        let command = BattleCommand::fight(
            player.id,
            MoveSlotIndex::new(0)?,
            BattleTargetSelection::selected(vec![enemy_slot])?,
        )?;
        let proposal = BattleCommandProposalV1::new(
            operation_id,
            battle.battle_id,
            battle.wave,
            battle.turn,
            battle.authority_seat,
            player.id,
            player_slot,
            command,
            MenuInstanceId::new(safe(u64::try_from(cursor + 1)?)),
            format!("m9/battle/command/{}", cursor + 1),
        )?;
        let commands = CommandSet::new(vec![
            AcceptedBattleCommand::human(proposal),
            AcceptedBattleCommand::scripted_enemy(policy.commands[cursor].clone()),
        ])?;
        let result_operation =
            turn_result_operation_id(battle.battle_id, battle.wave, battle.turn)?;
        let prepared = runtime.resolve_and_apply_authoritative_turn(
            result_operation,
            &commands,
            &TurnAuthorityContextV1 {
                authority_seat: battle.authority_seat,
                revision: safe(u64::try_from(cursor + 1)?),
            },
        )?;
        assert_eq!(runtime.state(), &prepared.candidate);
        rng_draws += prepared.material.rng_audit.len();
        turns += 1;
        if prepared.material.outcome == BattleOutcome::Victory {
            break;
        }
        assert_eq!(prepared.material.outcome, BattleOutcome::Ongoing);
    }

    let run = runtime
        .state()
        .active_run
        .as_ref()
        .ok_or("final run missing")?;
    let battle = run.battle.as_ref().ok_or("final battle missing")?;
    assert_eq!(battle.outcome, BattleOutcome::Victory);
    assert_eq!(battle.enemy_party[0].hp, 0);
    assert!(battle.enemy_party[0].fainted);
    assert!(battle.enemy_party[0].hp < initial_enemy_hp);
    assert!(
        run.party[0].moves[0]
            .as_ref()
            .ok_or("final player move missing")?
            .pp_used
            > initial_player_pp
    );
    assert!(turns > 0);
    assert!(rng_draws > 0);
    let victory_state = runtime.state().clone();
    let next_state = settle_m9_victory_and_start_next_encounter(&victory_state, runtime.content())?;
    let next_run = next_state.active_run.as_ref().ok_or("next run missing")?;
    let next_battle = next_run.battle.as_ref().ok_or("next battle missing")?;
    assert_eq!(next_run.wave.get().get(), 2);
    assert_eq!(next_battle.battle_id.get().get(), 2);
    assert_eq!(next_battle.outcome, BattleOutcome::Ongoing);
    assert_eq!(
        next_run
            .inventory
            .entries
            .iter()
            .find(|entry| entry.item.get().get() == 400)
            .ok_or("Pokeball reward missing")?
            .count,
        1
    );
    let continued = GameRuntimeV5::new(next_state, runtime.content().clone())?;
    let snapshot = continued.snapshot();
    let restored = GameRuntimeV5::from_snapshot(snapshot.clone(), runtime.content().clone())?;
    assert_eq!(restored.snapshot(), snapshot);
    Ok(())
}

#[test]
fn physical_keys_drive_battle_reward_and_next_encounter() -> Result {
    let bundle: GameContentBundleV1 = serde_json::from_slice(CONTENT)?;
    let content = Arc::new(PreparedGameContentV1::prepare(Arc::new(bundle))?);
    let bootstrap = build_m9_bootstrap_machine(
        profile(),
        SeatId::new(safe(1)),
        vec!["rust-slot-0".to_owned()],
        true,
        STARTER_ORACLE,
    )?;
    let mut kernel = M9VerticalSliceKernelV1::new(bootstrap, content, STARTER_ORACLE.to_vec())?;
    let press = |kernel: &mut M9VerticalSliceKernelV1, key: PhysicalKey| -> Result {
        kernel.raw_input(RawInputEvent::KeyDown {
            code: key.clone(),
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        })?;
        kernel.raw_input(RawInputEvent::KeyUp { code: key })?;
        Ok(())
    };
    for key in [
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::ArrowDown,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
        PhysicalKey::Space,
    ] {
        press(&mut kernel, key)?;
    }
    assert_eq!(kernel.control(), M9VerticalControlV1::CommandRoot);
    let initial_pp = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .and_then(|run| run.party[0].moves[0].as_ref())
        .ok_or("initial move missing")?
        .pp_used;
    for _ in 0..64 {
        press(&mut kernel, PhysicalKey::Space)?;
        assert_eq!(kernel.control(), M9VerticalControlV1::MoveSelect);
        press(&mut kernel, PhysicalKey::Space)?;
        if kernel.control() == M9VerticalControlV1::Reward {
            break;
        }
        assert_eq!(kernel.control(), M9VerticalControlV1::CommandRoot);
    }
    assert_eq!(kernel.control(), M9VerticalControlV1::Reward);
    let victory_state = kernel.state().ok_or("victory state missing")?;
    let victory_run = victory_state
        .active_run
        .as_ref()
        .ok_or("victory run missing")?;
    assert_eq!(
        victory_run
            .battle
            .as_ref()
            .ok_or("victory battle missing")?
            .outcome,
        BattleOutcome::Victory
    );
    assert!(
        victory_run.party[0].moves[0]
            .as_ref()
            .ok_or("victory move missing")?
            .pp_used
            > initial_pp
    );
    press(&mut kernel, PhysicalKey::Space)?;
    assert_eq!(kernel.completed_battles(), 1);
    assert_eq!(kernel.control(), M9VerticalControlV1::CommandRoot);
    let continued = kernel.state().ok_or("continued state missing")?;
    let continued_run = continued
        .active_run
        .as_ref()
        .ok_or("continued run missing")?;
    assert_eq!(continued_run.wave.get().get(), 2);
    assert_eq!(
        continued_run
            .battle
            .as_ref()
            .ok_or("continued battle missing")?
            .battle_id
            .get()
            .get(),
        2
    );
    assert_eq!(
        continued_run
            .inventory
            .entries
            .iter()
            .find(|entry| entry.item.get().get() == 400)
            .ok_or("reward missing")?
            .count,
        1
    );
    assert!(kernel.snapshot().is_some());
    Ok(())
}
