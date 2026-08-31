use std::collections::BTreeMap;
use std::error::Error;

use er_game::m72_bootstrap::{
    BootstrapCatalogV1, BootstrapModePolicyV1, RunBootstrapMachineV1, RunBootstrapStageV1,
};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::{GameModeId, PokemonId, WaveIndex};
use er_types::{
    InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId, SetupChoiceIdV1, SetupChoiceValueV1,
    StarterSelectionV1,
};

const SEAM: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/m9/solo-entry/bootstrap-seam.json"
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
