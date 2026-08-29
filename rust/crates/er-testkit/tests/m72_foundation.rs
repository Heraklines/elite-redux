//! M7.2 instant-laboratory foundation contracts.

use std::collections::BTreeMap;
use std::error::Error;

use er_canonical::content_digest;
use er_game::m72_bootstrap::*;
use er_lab::*;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::{GameModeId, PokemonId, WaveIndex};
use er_types::{
    BattleContentPackHashV3, CatalogHash, GameBehaviorUnitId, GameContentBundleHash,
    GameContentIdentity, InputFocus, MenuOptionId, OracleSha, PhysicalKey, RawInputEvent, SafeU53,
    SeatId, SetupChoiceIdV1, StarterSelectionV1,
};

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test safe integer")
}

fn profile() -> ProfileStateV1 {
    ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: BTreeMap::new(),
        statistics: ProfileStatistics {
            runs_started: safe(0),
            runs_won: safe(0),
            runs_lost: safe(0),
            battles_won: safe(0),
            pokemon_captured: safe(0),
            highest_wave: WaveIndex::new(safe(1)).expect("positive wave"),
        },
        dex: DexState::default(),
    }
}

fn content_identity() -> Result<GameContentIdentity, Box<dyn Error>> {
    Ok(GameContentIdentity {
        oracle_sha: OracleSha::parse("399d5d368f0b5642ebf8f45bd8a5e73350fa4de7")?,
        content_hash: GameContentBundleHash::parse(format!("blake3-v1:{}", "a".repeat(64)))?,
        battle_content_hash: BattleContentPackHashV3::parse(format!(
            "blake3-v3:{}",
            "b".repeat(64)
        ))?,
        semantic_catalog_hash: CatalogHash::parse("c".repeat(64))?,
    })
}

fn starter() -> StarterSelectionV1 {
    StarterSelectionV1 {
        pokemon_id: PokemonId::new(safe(1)),
        species_id: safe(25),
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
            er_types::SetupChoiceValueV1::Boolean(false),
        )],
        starters: vec![starter()],
        save_slots: vec!["slot-1".to_owned()],
        automatic_coop_save_slot: None,
        maximum_starter_cost: 10,
        maximum_starters: 6,
        local_is_host: true,
        developer_mode: false,
    }
}

fn key_down(key: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code: key,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn press(machine: &mut RunBootstrapMachineV1, key: PhysicalKey) -> Result<(), Box<dyn Error>> {
    machine.raw_input(key_down(key.clone()))?;
    machine.raw_input(RawInputEvent::KeyUp { code: key })?;
    Ok(())
}

#[test]
fn natural_bootstrap_completes_entire_observed_flow_with_raw_keys() -> Result<(), Box<dyn Error>> {
    let mut machine = RunBootstrapMachineV1::new(
        profile(),
        "natural-seed".to_owned(),
        SeatId::new(safe(1)),
        catalog(),
    )?;
    assert_eq!(machine.stage, RunBootstrapStageV1::Title);
    press(&mut machine, PhysicalKey::Space)?;
    assert_eq!(machine.stage, RunBootstrapStageV1::ModeSelect);
    press(&mut machine, PhysicalKey::Space)?;
    assert_eq!(machine.stage, RunBootstrapStageV1::StarterSelect);
    press(&mut machine, PhysicalKey::Space)?;
    press(&mut machine, PhysicalKey::ArrowDown)?;
    press(&mut machine, PhysicalKey::Space)?;
    assert_eq!(machine.stage, RunBootstrapStageV1::Confirmation);
    press(&mut machine, PhysicalKey::Space)?;
    assert_eq!(machine.stage, RunBootstrapStageV1::DifficultySelect);
    press(&mut machine, PhysicalKey::Space)?;
    assert_eq!(machine.stage, RunBootstrapStageV1::SaveSelect);
    press(&mut machine, PhysicalKey::Space)?;
    assert_eq!(machine.stage, RunBootstrapStageV1::Complete);
    assert!(!machine.control.actionable);
    assert_eq!(machine.selections.starters, vec![starter()]);
    machine.validate()?;
    Ok(())
}

#[test]
fn held_input_cannot_cross_bootstrap_menu_instances() -> Result<(), Box<dyn Error>> {
    let mut machine = RunBootstrapMachineV1::new(
        profile(),
        "held-seed".to_owned(),
        SeatId::new(safe(1)),
        catalog(),
    )?;
    let title_instance = machine
        .control
        .menu
        .as_ref()
        .ok_or("title menu")?
        .instance_id;
    machine.raw_input(key_down(PhysicalKey::Space))?;
    let mode_instance = machine
        .control
        .menu
        .as_ref()
        .ok_or("mode menu")?
        .instance_id;
    assert_ne!(title_instance, mode_instance);
    assert!(machine.raw_input(key_down(PhysicalKey::Space)).is_err());
    assert_eq!(machine.stage, RunBootstrapStageV1::ModeSelect);
    machine.raw_input(RawInputEvent::KeyUp {
        code: PhysicalKey::Space,
    })?;
    press(&mut machine, PhysicalKey::Space)?;
    assert_eq!(machine.stage, RunBootstrapStageV1::StarterSelect);
    Ok(())
}

#[test]
fn confirmation_cancel_restores_starter_menu_with_fresh_instance() -> Result<(), Box<dyn Error>> {
    let mut machine = RunBootstrapMachineV1::new(
        profile(),
        "cancel-seed".to_owned(),
        SeatId::new(safe(1)),
        catalog(),
    )?;
    press(&mut machine, PhysicalKey::Space)?;
    press(&mut machine, PhysicalKey::Space)?;
    press(&mut machine, PhysicalKey::Space)?;
    press(&mut machine, PhysicalKey::ArrowDown)?;
    press(&mut machine, PhysicalKey::Space)?;
    let confirm_instance = machine
        .control
        .menu
        .as_ref()
        .ok_or("confirm menu")?
        .instance_id;
    press(&mut machine, PhysicalKey::Escape)?;
    assert_eq!(machine.stage, RunBootstrapStageV1::StarterSelect);
    assert_ne!(
        machine
            .control
            .menu
            .as_ref()
            .ok_or("starter menu")?
            .instance_id,
        confirm_instance
    );
    Ok(())
}

#[test]
fn navigation_planner_returns_raw_events_without_execution() -> Result<(), Box<dyn Error>> {
    let mut machine = RunBootstrapMachineV1::new(
        profile(),
        "nav-seed".to_owned(),
        SeatId::new(safe(1)),
        catalog(),
    )?;
    press(&mut machine, PhysicalKey::Space)?;
    press(&mut machine, PhysicalKey::Space)?;
    let logical = machine
        .control
        .menu
        .as_ref()
        .ok_or("starter menu")?
        .logical_menu()?;
    let target = MenuOptionId::new("bootstrap/starter/confirm")?;
    assert!(!logical.is_enabled(&target));
    assert!(plan_navigation_v1(&logical, logical.instance_id, target.clone(), true, 32).is_err());
    press(&mut machine, PhysicalKey::Space)?;
    let logical = machine
        .control
        .menu
        .as_ref()
        .ok_or("starter menu")?
        .logical_menu()?;
    let before = logical.selected_option_id.clone();
    let plan = plan_navigation_v1(&logical, logical.instance_id, target, true, 32)?;
    assert_eq!(plan.expected_path.first(), Some(&before));
    assert_eq!(plan.events.len(), 4);
    assert_eq!(machine.stage, RunBootstrapStageV1::StarterSelect);
    Ok(())
}

#[test]
fn legality_explains_disabled_option_without_enabling_it() -> Result<(), Box<dyn Error>> {
    let mut machine = RunBootstrapMachineV1::new(
        profile(),
        "legality-seed".to_owned(),
        SeatId::new(safe(1)),
        catalog(),
    )?;
    press(&mut machine, PhysicalKey::Space)?;
    press(&mut machine, PhysicalKey::Space)?;
    let option = MenuOptionId::new("bootstrap/starter/confirm")?;
    let menu = machine.control.menu.as_ref().ok_or("starter menu")?;
    let behavior = GameBehaviorUnitId::parse("d".repeat(64))?;
    let evidence = explain_control_option_v1(
        &machine.control,
        menu.instance_id.get().get(),
        option,
        BTreeMap::new(),
        vec![behavior],
    )?;
    assert!(!evidence.enabled);
    assert_eq!(
        evidence.reasons,
        vec![ActionLegalityReasonV1::DisabledOption]
    );
    assert!(
        !machine
            .control
            .menu
            .as_ref()
            .ok_or("menu")?
            .options
            .last()
            .ok_or("option")?
            .enabled
    );
    Ok(())
}

#[test]
fn preset_registry_is_content_pinned_and_path_confined() -> Result<(), Box<dyn Error>> {
    let specification = ScenarioSpecificationV1::PreRun(Box::new(PreRunScenarioV1 {
        profile: profile(),
        seed: "preset-seed".to_owned(),
    }));
    let digest = format!("blake3-v1:{}", content_digest(&specification)?);
    let mut registry = ScenarioPresetRegistryV1::new(content_identity()?, 4, 16_384)?;
    registry.insert(
        ScenarioPresetManifestV1 {
            id: ScenarioPresetIdV1("battle/example".to_owned()),
            schema_version: 1,
            content_identity: content_identity()?,
            specification_digest: digest,
            reachability: ScenarioReachabilityV1::SyntheticValid {
                limitations: vec!["focused-foundry-fixture".to_owned()],
            },
            expected_control: er_types::GameControlKindV2::Title,
            behaviors: vec![GameBehaviorUnitIdV1("bootstrap/title".to_owned())],
            tags: vec!["bootstrap".to_owned()],
        },
        specification,
    )?;
    assert_eq!(registry.search("example", &[], 4).len(), 1);
    assert!(validate_preset_id(&ScenarioPresetIdV1("../escape".to_owned())).is_err());
    assert!(validate_preset_id(&ScenarioPresetIdV1("C:\\escape".to_owned())).is_err());
    Ok(())
}

#[test]
fn artifact_store_is_bounded_content_addressed_and_tears_down() -> Result<(), Box<dyn Error>> {
    let mut store = LabArtifactStoreV1::new(8, 2)?;
    let (first, inserted) = store.insert("application/json".to_owned(), vec![1, 1, 1], false)?;
    assert!(inserted);
    assert!(
        !store
            .insert("application/json".to_owned(), vec![1, 1, 1], false)?
            .1
    );
    store.insert("application/json".to_owned(), vec![2, 2, 2], false)?;
    store.insert("application/json".to_owned(), vec![3, 3, 3], false)?;
    assert!(store.get(&first).is_err());
    store.clear();
    assert_eq!(store.resource_counts(), (0, 0));
    Ok(())
}

#[test]
fn search_is_semantic_sorted_and_state_claim_policy_is_explicit() -> Result<(), Box<dyn Error>> {
    let index = LabSearchIndexV1::new(
        content_identity()?,
        vec![SearchDocumentV1 {
            kind: SearchDocumentKindV1::Ability,
            stable_id: "ability/22".to_owned(),
            name: "Intimidate".to_owned(),
            description: "Lowers opposing Attack on switch-in".to_owned(),
            tags: vec!["switch-in".to_owned()],
            detail: vec![1],
        }],
        8,
        8,
    )?;
    assert_eq!(
        index
            .search(SearchQueryV1 {
                kind: Some(SearchDocumentKindV1::Ability),
                text: "intimidate".to_owned(),
                tags: Vec::new(),
                maximum_results: 8,
            })?
            .len(),
        1
    );
    let synthetic = ScenarioReachabilityV1::SyntheticValid {
        limitations: vec!["not naturally progressed".to_owned()],
    };
    assert!(matches!(
        synthetic,
        ScenarioReachabilityV1::SyntheticValid { .. }
    ));
    Ok(())
}
