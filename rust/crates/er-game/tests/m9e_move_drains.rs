//! Source-generated static drain fractions execute through the actual turn resolver.
//! Completed bootstrap selections and battle statistics below are controlled fixtures.

use er_battle::m7_resolver::{
    BattleTransitionV5, TurnAuthorityContextV1, query_simulated_move_damage_v5, resolve_turn_v5,
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
    AbilityLoadout, BattleStats, MoveAccuracy, MoveCategory, MoveFlag, MovePower, MoveSlotState,
    MoveTarget, PokemonType, PokemonTyping,
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

// Exact pre-drain baseline exported and independently audited at 22e7ad4c6.
const DRAIN_BASELINE: &str = r#"{"admitted_classifications":[{"behavior_unit":{"ordinal":0,"provenance_hash":"328f89dfb7c2608d6d3ee5b15332abaee1054d3b8a140f3535c1913763ba5dae","source":{"kind":"MOVE","numeric_id":71},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":0,"provenance_hash":"74e57c63cce3b52e06c1b4e0b6198c92843fc6e172485189fd94466203cfe0aa","source":{"kind":"MOVE","numeric_id":72},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":0,"provenance_hash":"d897d1b1179bd5d396e2a4da408a8aa4d41e9f514ffbb73f942c37c28c4daa0f","source":{"kind":"MOVE","numeric_id":141},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":0,"provenance_hash":"6475dec43b01468439283d0371bed98157ba66e22796233779ccad9ca2be5afa","source":{"kind":"MOVE","numeric_id":202},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":0,"provenance_hash":"d81fb09a1a26c62c5429170fc19b0c415f55753639249b96313d5e5a3e88e32f","source":{"kind":"MOVE","numeric_id":409},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":0,"provenance_hash":"8ca49da916bcac2c0d786147bd3f8c1a9753775b3c8b21438280243d29ac557f","source":{"kind":"MOVE","numeric_id":532},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":0,"provenance_hash":"07b44367a0c7044eb47ab4bdc55dfd489afbe82710fe0a8bdd80e5e21c04d363","source":{"kind":"MOVE","numeric_id":570},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":0,"provenance_hash":"76ceaae68a8c5692d86097625b85bebb04b15c993b8deefd1b89266d34356194","source":{"kind":"MOVE","numeric_id":577},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":0,"provenance_hash":"6bc4800d1c7d0f6686c9550bf7e7bb086bda97e3d7d288d72523cd71d79e70b6","source":{"kind":"MOVE","numeric_id":613},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":0,"provenance_hash":"f01c54d8c035d2187bbc7ee0f672094ade184134fdb055dfd148ac264b47b386","source":{"kind":"MOVE","numeric_id":733},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":0,"provenance_hash":"dc5da60400a26c57f2152ec3cb38da93319383f48b1dc692c46577d1edcd886e","source":{"kind":"MOVE","numeric_id":891},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null},{"behavior_unit":{"ordinal":3,"provenance_hash":"2285c336a3c2a1509ffa48d1d992a60537ede6a292a462754aa99eb731b2ea2a","source":{"kind":"MOVE","numeric_id":902},"unit_kind":"MOVE_ATTRIBUTE"},"bespoke":"CUSTOM_DISPATCH","kind":"BESPOKE","programs":[],"unsupported_reason":null}],"battle_content_hash":"blake3-v3:b53078e1088c3c3f645fa1d209fb6bb72ef17bd9411d6bddc2c08c447d794201","classification_count":9411,"classifications_digest":"f31c8c228f131f6a46145687709f1e2f7bd49289727ce807ef01e72b4fee7732","deferred_programs":{"138":[146],"668":[696]},"program_count":3679,"programs_digest":"586747b5c70e0e2ed586f9d8882c32980b489b828dcf08d09d065b32b4e4457f","schema_version":1}"#;

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
    let bundle_bytes = std::env::var("M9E_DRAIN_BUNDLE")
        .ok()
        .map(std::fs::read)
        .transpose()?;
    let mut bundle: GameContentBundleV2 =
        serde_json::from_slice(bundle_bytes.as_deref().unwrap_or(BUNDLE))?;
    // The focused remote producer supplies its freshly compiled, source-bound
    // battle pack. The published bundle remains the default integration input.
    if let Ok(path) = std::env::var("M9E_DRAIN_BATTLE_PACK") {
        bundle.battle = serde_json::from_slice(&std::fs::read(path)?)?;
        let run = Arc::make_mut(&mut bundle.run);
        run.battle_content_hash = bundle.battle.content_hash.clone();
        run.content_hash = run.recompute_hash()?;
        bundle.content_hash = bundle.recompute_hash()?;
    }
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
    flags: &[MoveFlag],
) -> TestResult<MoveId> {
    // Published effective definitions: Force Palm=395, Confusion=93. Never rewrite the pack.
    let id = MoveId::new(safe(numeric_id));
    let definition = content.battle.move_definition(id)?;
    assert_eq!(definition.power, MovePower::Value(50));
    assert_eq!(definition.category, category);
    assert_eq!(definition.move_type, move_type);
    assert_eq!(definition.accuracy, accuracy);
    assert_eq!(definition.base_pp, base_pp);
    assert_eq!(definition.flags.as_slice(), flags);
    assert_eq!(definition.target, MoveTarget::NearOther);
    assert_eq!(definition.priority, 0);
    Ok(id)
}
fn controlled_state(
    content: &PreparedGameContentV2,
    mut state: GameStateV6,
) -> TestResult<GameStateV5> {
    let physical = ordinary_move(
        content,
        395,
        MoveCategory::Physical,
        PokemonType::Fighting,
        MoveAccuracy::Percent(100),
        20,
        &[MoveFlag::Contact],
    )?;
    let special = ordinary_move(
        content,
        93,
        MoveCategory::Special,
        PokemonType::Psychic,
        MoveAccuracy::Percent(100),
        20,
        &[],
    )?;
    let status_move = MoveId::new(safe(106));
    let status_definition = content.battle.move_definition(status_move)?;
    assert_eq!(status_definition.category, MoveCategory::Status);
    assert_eq!(status_definition.power, MovePower::None);
    assert_eq!(status_definition.move_type, PokemonType::Normal);
    assert_eq!(status_definition.accuracy, MoveAccuracy::AlwaysHits);
    assert_eq!(status_definition.base_pp, 20);
    assert_eq!(status_definition.target, MoveTarget::User);
    assert_eq!(status_definition.priority, 0);
    assert_eq!(status_definition.flags, vec![MoveFlag::IgnoreProtect]);
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
                move_id: status_move,
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

fn drain_state(
    move_id: u64,
    target_hp: u32,
    actor_hp: u32,
) -> TestResult<(Arc<PreparedGameContentV2>, GameStateV5)> {
    let (content, original) = fixture()?;
    let mut state = controlled_state(&content, original)?;
    let run = state.active_run.as_mut().ok_or("run")?;
    run.party[0].hp = target_hp;
    run.party[0].types = PokemonTyping {
        primary: PokemonType::Normal,
        secondary: None,
    };
    let actor = &mut run.battle.as_mut().ok_or("battle")?.enemy_party[0];
    actor.hp = actor_hp;
    actor.moves[0].as_mut().ok_or("move")?.move_id = MoveId::new(safe(move_id));
    state.validate()?;
    Ok((content, state))
}

fn turn(content: &PreparedGameContentV2, state: &GameStateV5) -> TestResult<BattleTransitionV5> {
    let run = state.active_run.as_ref().ok_or("run")?;
    let battle = run.battle.as_ref().ok_or("battle")?;
    let source = field(run, BattleSide::Enemy)?;
    let target = field(run, BattleSide::Player)?;
    let actor = battle
        .field
        .slots
        .iter()
        .find(|slot| slot.slot == source)
        .and_then(|slot| slot.occupant)
        .ok_or("actor")?;
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
            MoveSlotIndex::new(0)?,
            BattleTargetSelection::selected(vec![target])?,
        )?,
    )?;
    let commands = CommandSet::new(vec![AcceptedBattleCommand::scripted_enemy(command)])?;
    Ok(resolve_turn_v5(
        state,
        &commands,
        &content.battle,
        &TurnAuthorityContextV1 {
            authority_seat: battle.authority_seat,
            revision: safe(1),
        },
    )?)
}

#[test]
fn source_compiler_admits_twelve_unconditional_drains_and_preserves_other_units() -> TestResult {
    use er_types::BehaviorSourceId;
    let (content, _) = fixture()?;
    let baseline: serde_json::Value = serde_json::from_str(DRAIN_BASELINE)?;
    let after = &content.bundle().battle;
    assert_eq!(baseline["schema_version"], 1);
    assert_eq!(baseline["program_count"], 3679);
    assert_eq!(baseline["classification_count"], 9411);
    assert_eq!(after.classifications.0.len(), 9411);
    assert_eq!(
        er_canonical::content_digest(&after.programs[..3679].to_vec())?,
        baseline["programs_digest"]
            .as_str()
            .ok_or("baseline program digest")?
    );
    let expected = [
        (71, 1, 2),
        (72, 1, 2),
        (141, 1, 2),
        (202, 1, 2),
        (409, 1, 2),
        (532, 1, 2),
        (570, 1, 2),
        (577, 3, 4),
        (613, 3, 4),
        (733, 1, 1),
        (891, 1, 2),
        (902, 1, 2),
    ];
    assert_eq!(after.programs.len(), 3679 + expected.len());
    let old_classes = baseline["admitted_classifications"]
        .as_array()
        .ok_or("baseline classifications")?;
    assert_eq!(old_classes.len(), expected.len());
    let mut restored = serde_json::to_value(&after.classifications.0)?;
    let rows = restored.as_array_mut().ok_or("classification array")?;
    let mut admitted = Vec::new();
    for old in old_classes {
        assert_eq!(old["kind"], "BESPOKE");
        let matches = rows
            .iter_mut()
            .filter(|row| row["behavior_unit"] == old["behavior_unit"])
            .collect::<Vec<_>>();
        assert_eq!(matches.len(), 1);
        let row = matches
            .into_iter()
            .next()
            .ok_or("compiled classification")?;
        assert_eq!(row["kind"], "COMPILED");
        assert_eq!(row["behavior_unit"]["source"]["kind"], "MOVE");
        let id = row["behavior_unit"]["source"]["numeric_id"]
            .as_u64()
            .ok_or("move source")?;
        assert!(
            expected
                .iter()
                .any(|(expected_id, _, _)| *expected_id == id)
        );
        admitted.push(id);
        *row = old.clone();
    }
    admitted.sort_unstable();
    assert_eq!(admitted, expected.map(|(id, _, _)| id));
    assert_eq!(
        er_canonical::content_digest(&restored)?,
        baseline["classifications_digest"]
            .as_str()
            .ok_or("baseline classification digest")?
    );
    for (numeric_id, numerator, denominator) in expected {
        let definition = content
            .battle
            .move_definition(MoveId::new(safe(numeric_id)))?;
        let mut drains = Vec::new();
        for id in &definition.mechanic_programs {
            let program = content.battle.program(*id)?;
            for operation in &program.operations {
                let value = serde_json::to_value(operation)?;
                if value["kind"] == "DRAIN_FRACTION" {
                    assert_eq!(
                        program.source,
                        BehaviorSourceId::Move {
                            numeric_id: safe(numeric_id)
                        }
                    );
                    drains.push((
                        value["numerator"].as_u64().ok_or("numerator")?,
                        value["denominator"].as_u64().ok_or("denominator")?,
                    ));
                }
            }
        }
        assert_eq!(drains, vec![(numerator, denominator)]);
    }
    // Dream Eater has a source callback condition; Strength Sap uses a stat
    // operand and a callback. Neither is an unconditional damage drain.
    for index in [138, 668] {
        let deferred = content.battle.move_definition(MoveId::new(safe(index)))?;
        assert_eq!(
            serde_json::to_value(&deferred.mechanic_programs)?,
            baseline["deferred_programs"][index.to_string()]
        );
    }
    if let Ok(directory) = std::env::var("M9E_DRAIN_EXPORT") {
        let directory = std::path::Path::new(&directory);
        std::fs::create_dir(directory)?;
        let bundle = content.bundle();
        let mut manifest: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../fixtures/m9/engineering/game-content-bundle-v2-manifest.json"
        ))?;
        manifest["content_hash"] = serde_json::to_value(&bundle.content_hash)?;
        manifest["components"]["battle"] = serde_json::to_value(&bundle.battle.content_hash)?;
        manifest["components"]["run"] = serde_json::to_value(&bundle.run.content_hash)?;
        for (name, bytes) in [
            (
                "battle-content-pack-v3.json",
                serde_json::to_vec(&bundle.battle)?,
            ),
            ("run-content-pack-v3.json", serde_json::to_vec(&bundle.run)?),
            ("game-content-bundle-v2.json", serde_json::to_vec(bundle)?),
            (
                "game-content-bundle-v2-manifest.json",
                serde_json::to_vec(&manifest)?,
            ),
        ] {
            std::fs::write(directory.join(name), bytes)?;
        }
        std::fs::write(
            directory.join("drain-baseline-metadata.json"),
            serde_json::to_vec(&baseline)?,
        )?;
    }
    Ok(())
}

#[test]
fn actual_drain_uses_capped_hp_loss_and_source_fraction() -> TestResult {
    for (move_id, expected_healing) in [(71, 1), (577, 2), (733, 3)] {
        let (content, state) = drain_state(move_id, 3, 100)?;
        let before = state.clone();
        let result = turn(&content, &state)?;
        let run = result.after_state.active_run.as_ref().ok_or("run")?;
        assert_eq!(run.party[0].hp, 0);
        assert_eq!(
            run.battle.as_ref().ok_or("battle")?.enemy_party[0].hp,
            100 + expected_healing
        );
        assert_eq!(state, before);
    }
    Ok(())
}

#[test]
fn actual_drain_minimum_one_and_maximum_hp_are_preserved() -> TestResult {
    let (content, mut state) = drain_state(71, 400, 100)?;
    state.active_run.as_mut().ok_or("run")?.party[0]
        .stats
        .special_defense = 100000;
    state.validate()?;
    let result = turn(&content, &state)?;
    let run = result.after_state.active_run.as_ref().ok_or("run")?;
    assert_eq!(run.party[0].hp, 399);
    assert_eq!(run.battle.as_ref().ok_or("battle")?.enemy_party[0].hp, 101);
    let (content, state) = drain_state(733, 3, 399)?;
    let result = turn(&content, &state)?;
    assert_eq!(
        result
            .after_state
            .active_run
            .as_ref()
            .ok_or("run")?
            .battle
            .as_ref()
            .ok_or("battle")?
            .enemy_party[0]
            .hp,
        400
    );
    Ok(())
}

#[test]
fn immune_drain_neither_heals_nor_consumes_damage_variance() -> TestResult {
    let (content, mut state) = drain_state(409, 3, 100)?;
    state.active_run.as_mut().ok_or("run")?.party[0].types = PokemonTyping {
        primary: PokemonType::Ghost,
        secondary: None,
    };
    let baseline = turn(&content, &state)?;
    let bytes = serde_json::to_vec(&state)?;
    for _ in 0..3 {
        assert_eq!(query(&content, &state, 0)?, 0);
    }
    assert_eq!(serde_json::to_vec(&state)?, bytes);
    assert_eq!(turn(&content, &state)?, baseline);
    let run = baseline.after_state.active_run.as_ref().ok_or("run")?;
    assert_eq!(run.party[0].hp, 3);
    assert_eq!(run.battle.as_ref().ok_or("battle")?.enemy_party[0].hp, 100);
    assert!(
        !baseline
            .rng_audit
            .iter()
            .any(|draw| draw.reason == RngReason::DamageVariance)
    );
    Ok(())
}

#[test]
fn full_health_drain_does_not_emit_spurious_actor_hp_changes() -> TestResult {
    use er_battle::resolver::BattleMutation;
    let (content, state) = drain_state(71, 3, 400)?;
    let actor = state
        .active_run
        .as_ref()
        .ok_or("run")?
        .battle
        .as_ref()
        .ok_or("battle")?
        .enemy_party[0]
        .id;
    let result = turn(&content, &state)?;
    assert!(!result.mutations.iter().any(|mutation| matches!(mutation, BattleMutation::HpChanged { pokemon, .. } if *pokemon == actor)));
    Ok(())
}
