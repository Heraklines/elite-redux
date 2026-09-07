use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{GameKernelRoleV7, GameKernelStepV7, GameKernelV7};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameActionV1, GameControlKindV2, SafeU53, SeatId};

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

fn content() -> Result<Arc<PreparedGameContentV2>, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
}

fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 {
        next_timer_id: Some(SafeU53::ZERO),
        timers: Vec::new(),
        pauses: Vec::new(),
        disposed: false,
    }
}

fn kernel(content: Arc<PreparedGameContentV2>) -> Result<GameKernelV7, Box<dyn Error>> {
    Ok(GameKernelV7::natural_start(
        profile()?,
        "m9e-natural-campaign-200-v1".to_owned(),
        SeatId::new(safe(1)),
        vec!["preview-slot".to_owned()],
        true,
        content,
        scheduler(),
        None,
    )?)
}

fn key_down(key: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code: key,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn press(kernel: &mut GameKernelV7, key: PhysicalKey) -> Result<GameKernelStepV7, Box<dyn Error>> {
    let step = kernel.raw_input(key_down(key.clone()))?;
    kernel.raw_input(RawInputEvent::KeyUp { code: key })?;
    Ok(step)
}

fn navigate_down_to(kernel: &mut GameKernelV7, option: &str) -> Result<(), Box<dyn Error>> {
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map(|menu| menu.options.len() + 1)
        .ok_or("current control has no menu")?;
    for _ in 0..bound {
        let selected = kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .map(|menu| menu.selected_option_id.as_str() == option)
            .unwrap_or(false);
        if selected {
            return Ok(());
        }
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    Err(format!("option {option} was not reachable by Down").into())
}

fn submit_strongest_move(
    kernel: &mut GameKernelV7,
    content: &PreparedGameContentV2,
) -> Result<GameKernelStepV7, Box<dyn Error>> {
    let menu = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .ok_or("move menu is absent")?;
    let state = kernel.state().ok_or("state is absent")?;
    let run = state.active_run.as_ref().ok_or("run is absent")?;
    let battle = run.battle.as_ref().ok_or("battle is absent")?;
    let source_slot = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Player && slot.occupant.is_some()
        })
        .ok_or("player field is absent")?
        .slot;
    let target_slot = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Enemy && slot.occupant.is_some()
        })
        .ok_or("enemy field is absent")?
        .slot;
    let target_option = menu
        .options
        .iter()
        .filter_map(|option| {
            let GameActionV1::Battle {
                action: er_types::BattleUiActionV1::SelectMove { move_slot, .. },
            } = option.action
            else {
                return None;
            };
            let damage = er_battle::m7_resolver::query_simulated_move_damage_v5(
                &content.battle,
                run,
                source_slot,
                move_slot,
                target_slot,
            )
            .ok()?;
            Some((damage, option.option_id.clone()))
        })
        .max_by_key(|(damage, _)| *damage)
        .map(|(_, option)| option)
        .ok_or("no move option is available")?;
    navigate_down_to(kernel, target_option.as_str())?;
    press(kernel, PhysicalKey::Space)
}

fn progression_checkpoint() -> Result<(GameKernelV7, Arc<PreparedGameContentV2>), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = kernel(content.clone())?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    let GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) = kernel.snapshot()?.lifecycle else {
        return Err("natural starter setup missing".into());
    };
    let mut remaining = bootstrap.catalog.maximum_starter_cost;
    let mut starters = Vec::new();
    let mut choices = bootstrap.catalog.starters.iter().collect::<Vec<_>>();
    choices.sort_by_key(|starter| (starter.cost, starter.pokemon_id));
    for starter in choices {
        if starter.cost <= remaining {
            remaining -= starter.cost;
            starters.push(starter.pokemon_id);
            if starters.len() == 6.min(bootstrap.catalog.maximum_starters) {
                break;
            }
        }
    }
    assert_eq!(starters.len(), 6, "natural six-starter policy unavailable");
    for starter in starters {
        navigate_down_to(&mut kernel, &format!("bootstrap/starter/{}", starter.get()))?;
        press(&mut kernel, PhysicalKey::Space)?;
    }
    navigate_down_to(&mut kernel, "bootstrap/starter/confirm")?;
    for _ in 0..4 {
        press(&mut kernel, PhysicalKey::Space)?;
    }
    for _ in 0..400 {
        for pending in kernel.snapshot()?.pending_presentations {
            kernel.settle_presentation(pending.event_id)?;
        }
        match kernel.current_control().map(|control| control.kind) {
            Some(GameControlKindV2::Progression) => return Ok((kernel, content)),
            Some(GameControlKindV2::BattleCommand | GameControlKindV2::BattleReplacement) => {
                press(&mut kernel, PhysicalKey::Space)?;
            }
            Some(GameControlKindV2::BattleMove) => {
                submit_strongest_move(&mut kernel, &content)?;
            }
            other => return Err(format!("natural progression setup reached {other:?}").into()),
        }
    }
    Err("natural first victory exceeded decision bound".into())
}

#[test]
fn natural_victory_experience_recalculates_stats_preserves_damage_and_restores()
-> Result<(), Box<dyn Error>> {
    let (mut kernel, content) = progression_checkpoint()?;
    let snapshot = kernel.snapshot()?;
    let before = kernel.state().ok_or("current state absent")?.clone();
    let old_run = before.active_run.as_ref().ok_or("run absent")?;
    let task = old_run.progression_queue.tasks.first().ok_or("earned experience task absent")?;
    assert!(matches!(task.kind, er_state::m7_state::ProgressionTaskKindV2::GrantExperience(_)));
    let old_pokemon = old_run.party.iter().find(|pokemon| pokemon.id == task.pokemon).ok_or("recipient absent")?;
    assert!(!old_pokemon.fainted);
    let mut restored = GameKernelV7::from_snapshot(
        snapshot,
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content.clone(),
    )?;
    assert_eq!(
        press(&mut kernel, PhysicalKey::Space)?,
        press(&mut restored, PhysicalKey::Space)?
    );
    let after = kernel.state().ok_or("state after experience absent")?;
    let new_run = after.active_run.as_ref().ok_or("run after experience absent")?;
    let pokemon = new_run.party.iter().find(|pokemon| pokemon.id == task.pokemon).ok_or("recipient lost")?;
    assert!(pokemon.level > old_pokemon.level, "natural task did not increase level");
    assert_ne!(pokemon.stats, old_pokemon.stats, "level gain left persistent battle stats stale");
    let species = content.battle.species(pokemon.species_id)?;
    let form = content.battle.form(&er_types::FormId::parse(format!("{}:{}", pokemon.species_id.get().get(), pokemon.form_index))?)?;
    let base = form.stat_override.unwrap_or(species.base_stats);
    let expected_hp = (2 * base.hp + u32::from(pokemon.ivs[0].get()) + pokemon.permanent_bonuses.hp)
        * u32::from(pokemon.level)
        / 100
        + u32::from(pokemon.level)
        + 10;
    assert_eq!(pokemon.stats.hp, expected_hp);
    assert_eq!(pokemon.max_hp, expected_hp);
    assert_eq!(pokemon.hp, old_pokemon.hp + expected_hp - old_pokemon.max_hp);
    assert_eq!(pokemon.max_hp - pokemon.hp, old_pokemon.max_hp - old_pokemon.hp);
    for (old, new) in [
        (old_pokemon.stats.attack, pokemon.stats.attack),
        (old_pokemon.stats.defense, pokemon.stats.defense),
        (old_pokemon.stats.special_attack, pokemon.stats.special_attack),
        (old_pokemon.stats.special_defense, pokemon.stats.special_defense),
        (old_pokemon.stats.speed, pokemon.stats.speed),
    ] {
        assert!(new >= old, "level gain reduced a persistent stat");
    }
    assert_eq!(pokemon.moves, old_pokemon.moves);
    assert_eq!(new_run.run_rng, old_run.run_rng);
    assert_eq!(
        new_run.battle.as_ref().ok_or("battle absent")?.battle_rng,
        old_run.battle.as_ref().ok_or("old battle absent")?.battle_rng
    );
    for unchanged in old_run.party.iter().filter(|pokemon| pokemon.id != task.pokemon) {
        assert_eq!(new_run.party.iter().find(|pokemon| pokemon.id == unchanged.id), Some(unchanged));
    }
    assert_eq!(kernel.snapshot()?, restored.snapshot()?);
    kernel.snapshot()?.validate(&content)?;
    Ok(())
}
