//! Remote-only actual current constructor probe. It does not execute a battle or
//! claim source ability/target neutrality. Output is a bounded roster observation.
use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::GameKernelV7;
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{SafeU53, SeatId};
use serde_json::json;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("bounded diagnostic identity")
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

fn press(kernel: &mut GameKernelV7, code: PhysicalKey) -> Result<(), Box<dyn Error>> {
    kernel.raw_input(RawInputEvent::KeyDown {
        code: code.clone(),
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    })?;
    kernel.raw_input(RawInputEvent::KeyUp { code })?;
    Ok(())
}

fn navigate(kernel: &mut GameKernelV7, option: &str) -> Result<(), Box<dyn Error>> {
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1)
        .ok_or("actual menu missing")?;
    for _ in 0..bound {
        if kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == option)
        {
            return Ok(());
        }
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    Err("actual raw menu target unreachable".into())
}

fn main() -> Result<(), Box<dyn Error>> {
    let output = std::env::args().nth(1).ok_or("one fresh output path required")?;
    if std::path::Path::new(&output).exists() {
        return Err("output already exists".into());
    }
    let raw = include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
    let bundle: GameContentBundleV2 = serde_json::from_slice(raw)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| {
            mode.supported
                && !mode.cooperative
                && !mode.challenge_selection
                && content.world.mode(mode.mode).is_some_and(|mode| mode.key == "CLASSIC")
        })
        .ok_or("explicit current Classic bootstrap mode missing")?;
    let mode_option = format!("bootstrap/mode/{}", mode.mode.get());
    let starters = content.bundle().bootstrap.starters.iter().take(3).collect::<Vec<_>>();
    let mut rows = Vec::new();
    for (index, starter) in starters.iter().enumerate() {
        let seed = format!("m9e-target-execution-source-{index}");
        let mut kernel = GameKernelV7::natural_start(
            profile()?,
            seed.clone(),
            SeatId::new(safe(1)),
            vec!["target-source-slot".to_owned()],
            true,
            content.clone(),
            KernelSchedulerSnapshotV2 {
                next_timer_id: Some(SafeU53::ZERO),
                timers: Vec::new(),
                pauses: Vec::new(),
                disposed: false,
            },
            None,
        )?;
        press(&mut kernel, PhysicalKey::Space)?;
        navigate(&mut kernel, &mode_option)?;
        press(&mut kernel, PhysicalKey::Space)?;
        let GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) = kernel.snapshot()?.lifecycle else {
            return Err("actual starter selection owner missing".into());
        };
        let selected = bootstrap.catalog.starters.iter().find(|selected| {
            selected.species_id == starter.species_id.get() && selected.form_index == starter.form_index
        }).ok_or("source starter missing from actual bootstrap catalog")?;
        navigate(&mut kernel, &format!("bootstrap/starter/{}", selected.pokemon_id.get()))?;
        press(&mut kernel, PhysicalKey::Space)?;
        navigate(&mut kernel, "bootstrap/starter/confirm")?;
        for _ in 0..4 {
            press(&mut kernel, PhysicalKey::Space)?;
        }
        let state = kernel.state().ok_or("natural active state missing")?;
        let run = state.active_run.as_ref().ok_or("natural run missing")?;
        let battle = run.battle.as_ref().ok_or("natural battle missing")?;
        let mut roster = Vec::new();
        for pokemon in run.party.iter().chain(&battle.enemy_party) {
            let mut moves = Vec::new();
            for (slot, move_state) in pokemon.moves.iter().enumerate() {
                if let Some(move_state) = move_state {
                    let definition = content.battle.move_definition(move_state.move_id)?;
                    moves.push(json!({"slot": slot, "state": move_state, "definition": definition}));
                }
            }
            roster.push(json!({
                "id": pokemon.id, "owner_seat": pokemon.owner_seat,
                "species_id": pokemon.species_id, "form_index": pokemon.form_index,
                "abilities": pokemon.abilities, "types": pokemon.types,
                "hp": pokemon.hp, "max_hp": pokemon.max_hp, "moves": moves
            }));
        }
        rows.push(json!({
            "seed": seed, "starter": starter, "mode": run.mode,
            "run_id": run.run_id, "battle_id": battle.battle_id,
            "format": battle.format, "field": battle.field, "roster": roster,
            "snapshot_sha256": er_canonical::content_digest(&kernel.snapshot()?)?
        }));
    }
    let bytes = serde_json::to_vec(&json!({
        "schema_version": 1, "source_sha": std::env::var("GITHUB_SHA")?,
        "scope": "actual fresh V7 raw construction only; no target/ability admission proof or battle execution",
        "content_identity": content.identity(), "rows": rows
    }))?;
    if bytes.len() > 32 * 1024 || rows.len() != 3 {
        return Err("exact three bounded actual rosters required".into());
    }
    std::fs::write(output, bytes)?;
    Ok(())
}
