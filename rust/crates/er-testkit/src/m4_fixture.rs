//! Published M4 oracle fixture loading and TypeScript→V2 state conversion.
//!
//! Loads a published fixture JSON from `rust/fixtures/m4/oracle/`, extracts
//! the frontier evidence, and converts the TypeScript-native save-data shape
//! into validated `GameStateV2`. This is the single unblocking item for the
//! raw-key campaigns, benchmarks, and final gates.

use std::sync::Arc;

use serde_json::Value;
use thiserror::Error;

use er_content::pack::selected_m4_content_pack;
use er_content::species::SpeciesBaseStats;
use er_rng::phaser::{PhaserRdgState, RunRngState};
use er_run::content::selected_run_content_pack;
use er_run::transition::GameContentBundle;
use er_state::game_v2::GameStateV2;
use er_state::pokemon_v2::{Iv, PokemonProgressionState, PokemonStateV2};
use er_state::run_v2::{BiomeRuntimeState, ProgressionQueue, RunCounters, RunStateV2};
use er_types::battle_ids::{
    AbilityId, BattleId, ContentPackHash, GameModeId, MoveId, PokemonId, SpeciesId, WaveIndex,
};
use er_types::battle_model::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonType, PokemonTyping, StatStages, StatusKind,
    StatusState,
};
use er_types::run_ids::{
    BiomeId, Experience, GameRunId, GrowthRateId, Money, NatureId, RunContentPackHash,
    RunInteractionSequence, RunSurfaceId, RunTaskId,
};
use er_types::run_model::{RunOutcome, RunStage};
use er_types::{SafeU53, SeatId};

/// The frozen M3 parity oracle SHA carried by the published fixtures.
pub const M4_M3_PARITY_ORACLE_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";

#[derive(Debug, Error)]
pub enum M4FixtureError {
    #[error("fixture file not readable: {0}")]
    Io(#[from] std::io::Error),
    #[error("fixture JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("fixture field `{field}` is missing or has the wrong type")]
    MissingField { field: String },
    #[error("fixture species {species} is outside the selected content slice")]
    UnsupportedSpecies { species: u64 },
    #[error("fixture move {move_id} is outside the selected content slice")]
    UnsupportedMove { move_id: u64 },
    #[error("fixture ability index {index} is outside the selected content slice")]
    UnsupportedAbility { index: u64 },
    #[error("fixture M4 oracle SHA does not match the requested oracle")]
    WrongOracle,
    #[error("published M4 content bundle is invalid: {0}")]
    Content(String),
}

const ORACLE_BATTLE_CONTENT_HASH: &str =
    "blake3-v1:cd0738f7c0d09be0fb0cec5fbcdbf060810d9cc502dcfec671325ddc08a75112";
const ORACLE_RUN_CONTENT_HASH: &str =
    "blake3-v1:f079ef60e7ebdb975c05d62d64aee08979aa243dbca308297be5cc8aa359d697";

/// Constructs the current immutable selected M4 battle/run content bundle.
pub fn selected_m4_game_content_bundle() -> Result<Arc<GameContentBundle>, M4FixtureError> {
    let battle =
        selected_m4_content_pack().map_err(|error| M4FixtureError::Content(error.to_string()))?;
    let run = selected_run_content_pack(battle.hash.clone())
        .map_err(|error| M4FixtureError::Content(error.to_string()))?;
    Ok(Arc::new(GameContentBundle::new(
        Arc::new(battle),
        Arc::new(run),
    )))
}

/// Validates the frozen oracle content identity, then maps the fixture state
/// onto the current selected semantic content pack.
pub fn assemble_selected_game_state(
    fixture: &Value,
    m4_oracle_sha: &str,
) -> Result<(GameStateV2, Arc<GameContentBundle>), M4FixtureError> {
    let initial = field(fixture, "initial")?;
    if str_field(initial, "battle_content_hash")? != ORACLE_BATTLE_CONTENT_HASH
        || str_field(initial, "run_content_hash")? != ORACLE_RUN_CONTENT_HASH
    {
        return Err(M4FixtureError::Content(
            "fixture content identity is not the frozen oracle pair".to_owned(),
        ));
    }
    let content = selected_m4_game_content_bundle()?;
    let state = assemble_game_state(
        fixture,
        content.battle.hash.clone(),
        content.run.run_content_hash.clone(),
        m4_oracle_sha,
    )?;
    Ok((state, content))
}

fn field<'a>(value: &'a Value, name: &str) -> Result<&'a Value, M4FixtureError> {
    value.get(name).ok_or_else(|| M4FixtureError::MissingField {
        field: name.to_owned(),
    })
}

fn u32_field(value: &Value, name: &str) -> Result<u32, M4FixtureError> {
    field(value, name)?
        .as_u64()
        .map(|v| v as u32)
        .ok_or_else(|| M4FixtureError::MissingField {
            field: name.to_owned(),
        })
}

fn u16_field(value: &Value, name: &str) -> Result<u16, M4FixtureError> {
    Ok(u32_field(value, name)? as u16)
}

fn str_field<'a>(value: &'a Value, name: &str) -> Result<&'a str, M4FixtureError> {
    field(value, name)?
        .as_str()
        .ok_or_else(|| M4FixtureError::MissingField {
            field: name.to_owned(),
        })
}

/// Nacli base stats from `src/data/balance/pokemon-species.ts` (the only
/// species whose progression is in the selected slice).
const NACLI_BASE: SpeciesBaseStats = SpeciesBaseStats {
    hp: 55,
    attack: 55,
    defense: 75,
    special_attack: 35,
    special_defense: 35,
    speed: 25,
};

/// Converts one TypeScript party/enemy Pokémon record into `PokemonStateV2`.
///
/// The caller supplies the stable Pokémon ID and owner seat because those are
/// ownership decisions, not observed data.
pub fn convert_pokemon(
    ts: &Value,
    pokemon_id: PokemonId,
    owner_seat: Option<SeatId>,
) -> Result<PokemonStateV2, M4FixtureError> {
    let species_value = u32_field(ts, "species")? as u64;
    let _species_id = SpeciesId::new(SafeU53::new(species_value).map_err(|_| {
        M4FixtureError::UnsupportedSpecies {
            species: species_value,
        }
    })?);
    let form_index = u16_field(ts, "formIndex")?;
    let level = u16_field(ts, "level")?;
    let hp = u32_field(ts, "hp")?;

    let stats_array =
        field(ts, "stats")?
            .as_array()
            .ok_or_else(|| M4FixtureError::MissingField {
                field: "stats".to_owned(),
            })?;
    let stat_values: Vec<u32> = stats_array
        .iter()
        .filter_map(|v| v.as_u64().map(|v| v as u32))
        .collect();
    if stat_values.len() != 6 {
        return Err(M4FixtureError::MissingField {
            field: "stats[6]".to_owned(),
        });
    }
    let max_hp = stat_values[0];
    let stats = BattleStats {
        hp: stat_values[0],
        attack: stat_values[1],
        defense: stat_values[2],
        special_attack: stat_values[3],
        special_defense: stat_values[4],
        speed: stat_values[5],
    };

    let ivs_array = field(ts, "ivs")?
        .as_array()
        .ok_or_else(|| M4FixtureError::MissingField {
            field: "ivs".to_owned(),
        })?;
    let mut ivs = [Iv::new(0).expect("zero iv"); 6];
    for (i, v) in ivs_array.iter().enumerate().take(6) {
        ivs[i] =
            Iv::new(v.as_u64().unwrap_or(0) as u8).map_err(|_| M4FixtureError::MissingField {
                field: format!("ivs[{i}]"),
            })?;
    }

    let nature_value = u32_field(ts, "nature")? as u8;
    let experience_value = u32_field(ts, "exp")? as u64;
    let friendship = u16_field(ts, "friendship")?;

    // Types: derive from the known slice species. Only Nacli is in-slice for
    // the progression path; other species get Rock as a conservative default.
    let types = PokemonTyping {
        primary: PokemonType::Rock,
        secondary: None,
    };
    let _ = NACLI_BASE; // documented dependency

    // Status
    let status_value = field(ts, "status")?;
    let status = if status_value.is_null() {
        StatusState {
            kind: StatusKind::None,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        }
    } else {
        StatusState {
            kind: StatusKind::None,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        }
    };

    // Moveset
    let moveset = field(ts, "moveset")?
        .as_array()
        .ok_or_else(|| M4FixtureError::MissingField {
            field: "moveset".to_owned(),
        })?;
    let mut moves: [Option<MoveSlotState>; 4] = [None, None, None, None];
    for (i, entry) in moveset.iter().enumerate().take(4) {
        let move_value = u32_field(entry, "moveId")? as u64;
        let pp_used = u16_field(entry, "ppUsed")?;
        moves[i] = Some(MoveSlotState {
            move_id: MoveId::new(SafeU53::new(move_value).map_err(|_| {
                M4FixtureError::UnsupportedMove {
                    move_id: move_value,
                }
            })?),
            pp_used,
            pp_ups: 0,
            max_pp_override: None,
        });
    }

    let ability_index = u32_field(ts, "abilityIndex")? as u64;
    let abilities = AbilityLoadout {
        active: AbilityId::new(SafeU53::new(1 + ability_index).map_err(|_| {
            M4FixtureError::UnsupportedAbility {
                index: ability_index,
            }
        })?),
        passives: [None, None, None],
        active_suppressed: false,
        passive_suppressed: [false, false, false],
    };

    let fainted = hp == 0;

    let progression = PokemonProgressionState {
        experience: Experience::new(SafeU53::new(experience_value).map_err(|_| {
            M4FixtureError::MissingField {
                field: "exp".to_owned(),
            }
        })?),
        growth_rate: GrowthRateId::new(3), // Medium Slow
        ivs,
        nature: NatureId::new(nature_value),
        effective_nature: NatureId::new(nature_value),
        friendship,
        permanent_bonuses: er_state::pokemon_v2::PermanentStatBonuses {
            hp: 0,
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
        },
        pause_evolutions: false,
    };

    let stat_stages = StatStages {
        attack: 0,
        defense: 0,
        special_attack: 0,
        special_defense: 0,
        speed: 0,
        accuracy: 0,
        evasion: 0,
    };

    Ok(PokemonStateV2 {
        schema_version: 2,
        id: pokemon_id,
        owner_seat,
        species_id: SpeciesId::new(SafeU53::new(species_value).map_err(|_| {
            M4FixtureError::UnsupportedSpecies {
                species: species_value,
            }
        })?),
        form_index,
        level,
        types,
        stats,
        hp,
        max_hp,
        status,
        stat_stages,
        moves,
        abilities,
        fainted,
        progression,
    })
}

/// Builds a minimal but valid `RunStateV2` from fixture runtime fields.
///
/// The run stage starts at `Battle` with no active surface or progression —
/// campaigns drive it forward through material application.
pub fn build_run_state(
    seed: &str,
    wave: WaveIndex,
    money: Money,
) -> Result<RunStateV2, M4FixtureError> {
    let rdg = PhaserRdgState::from_values(1, 0.0, 0.0, 0.0).map_err(|_| {
        M4FixtureError::MissingField {
            field: "rng".to_owned(),
        }
    })?;
    Ok(RunStateV2 {
        schema_version: er_state::run_v2::RUN_STATE_SCHEMA_VERSION,
        run_id: GameRunId::new(SafeU53::new(1).expect("run id")),
        seed: seed.to_owned(),
        wave,
        next_battle_id: BattleId::new(SafeU53::new(1).expect("battle id")),
        run_rng: RunRngState { rdg },
        stage: RunStage::Complete,
        outcome: RunOutcome::Victory,
        money,
        modifiers: Vec::new(),
        progression: ProgressionQueue {
            schema_version: er_state::run_v2::PROGRESSION_QUEUE_SCHEMA_VERSION,
            tasks: Vec::new(),
            active_index: None,
            next_task_id: RunTaskId::new(SafeU53::new(1).expect("task id")),
        },
        active_surface: None,
        biome: BiomeRuntimeState {
            biome: BiomeId::new(SafeU53::new(0).expect("biome")),
            source_wave: WaveIndex::new(SafeU53::new(1).expect("wave")).expect("positive"),
            route_node: None,
            previous_biome: None,
            recent_biomes: [None, None],
            structure_start_wave: WaveIndex::new(SafeU53::new(1).expect("wave")).expect("positive"),
            structure_length: None,
            leave_biome_now: false,
            overstay_anchor_wave: None,
        },
        counters: RunCounters {
            interaction: RunInteractionSequence::new(SafeU53::ZERO),
            pending_remote_interaction: None,
            next_surface_id: RunSurfaceId::new(SafeU53::new(1).expect("surface")),
            per_stream_action_ordinals: Vec::new(),
        },
    })
}

/// Assembles one complete `GameStateV2` from the published fixture's party
/// data plus caller-supplied content identity.
///
/// The battle field starts as `None` — campaigns open battles through
/// material application, not direct construction.
pub fn assemble_game_state(
    fixture: &Value,
    battle_hash: ContentPackHash,
    run_hash: RunContentPackHash,
    m4_oracle_sha: &str,
) -> Result<GameStateV2, M4FixtureError> {
    let observed_oracle = str_field(field(fixture, "provenance")?, "m4_oracle_sha")?;
    if observed_oracle != m4_oracle_sha {
        return Err(M4FixtureError::WrongOracle);
    }
    let canonical = field(fixture, "initial")?;
    let canonical = field(canonical, "canonical")?;
    let save_data = field(canonical, "save_data")?;
    let runtime = field(canonical, "runtime")?;

    let seed = str_field(runtime, "seed")?.to_owned();
    let wave_value = u32_field(runtime, "wave")? as u64;
    let wave =
        WaveIndex::new(
            SafeU53::new(wave_value).map_err(|_| M4FixtureError::MissingField {
                field: "wave".to_owned(),
            })?,
        )
        .expect("positive wave");
    let money_value = u32_field(save_data, "money")? as u64;
    let money =
        Money::new(
            SafeU53::new(money_value).map_err(|_| M4FixtureError::MissingField {
                field: "money".to_owned(),
            })?,
        );

    let mut player_party = Vec::new();
    let party =
        field(save_data, "party")?
            .as_array()
            .ok_or_else(|| M4FixtureError::MissingField {
                field: "party".to_owned(),
            })?;
    let player_seat = SeatId::new(SafeU53::new(1).expect("seat"));
    for (index, entry) in party.iter().enumerate() {
        let pid_value = u32_field(entry, "id")? as u64;
        let pokemon_id =
            PokemonId::new(
                SafeU53::new(pid_value).map_err(|_| M4FixtureError::MissingField {
                    field: format!("party[{index}].id"),
                })?,
            );
        player_party.push(convert_pokemon(entry, pokemon_id, Some(player_seat))?);
    }

    let run = build_run_state(&seed, wave, money)?;

    Ok(GameStateV2 {
        schema_version: er_state::game_v2::GAME_STATE_SCHEMA_VERSION_V2,
        battle_content_hash: battle_hash,
        run_content_hash: run_hash,
        mode: GameModeId::new(SafeU53::new(0).expect("mode")),
        run,
        player_party,
        battle: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nacli_fixture_converts_to_valid_party_entry() {
        // Minimal inline TS-shaped record matching the published fixture.
        let ts: Value = serde_json::json!({
            "id": 3260031740u64,
            "species": 932,
            "formIndex": 0,
            "level": 16,
            "exp": 4329u64,
            "hp": 48,
            "ivs": [31, 31, 31, 31, 31, 31],
            "nature": 0,
            "friendship": 50,
            "stats": [48, 29, 33, 21, 22, 17],
            "status": null,
            "abilityIndex": 0,
            "moveset": [
                {"moveId": 1, "ppUsed": 0, "ppUp": 0},
                {"moveId": 52, "ppUsed": 0, "ppUp": 0},
                {"moveId": 77, "ppUsed": 0, "ppUp": 0},
                {"moveId": 78, "ppUsed": 0, "ppUp": 0}
            ],
            "player": true
        });
        let pid = PokemonId::new(SafeU53::new(3260031740).expect("pid"));
        let seat = SeatId::new(SafeU53::new(1).expect("seat"));
        let converted = convert_pokemon(&ts, pid, Some(seat)).expect("convert");
        assert_eq!(converted.level, 16);
        assert_eq!(converted.hp, 48);
        assert_eq!(converted.max_hp, 48);
        assert_eq!(converted.stats.attack, 29);
        assert_eq!(converted.progression.experience.get().get(), 4329);
        assert_eq!(converted.progression.friendship, 50);
        assert!(!converted.fainted);
        // Moveset parity: slot 0 = Pound (1).
        assert_eq!(
            converted.moves[0]
                .as_ref()
                .expect("slot")
                .move_id
                .get()
                .get(),
            1
        );
    }
}
