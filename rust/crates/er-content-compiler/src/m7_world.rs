//! Offline compiler for exact pinned M7 world behavior tables.

use std::collections::BTreeMap;

use er_types::SafeU53;
use er_types::battle_model::{TerrainKind, WeatherKind};
use er_types::run_ids::BiomeId;
use er_world::{
    BiomeBattleRuleV1, BiomeEncounterProfileV1, BiomeSkipFallbackV1, RivalWaveV1, WorldRatioV1,
};
use serde::Deserialize;
use thiserror::Error;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldOracleDocumentV1 {
    pub schema_version: u32,
    pub oracle_sha: String,
    pub biome_encounters: BTreeMap<String, BiomeEncounterInputV1>,
    pub forced_battle_rules: BTreeMap<String, ForcedBattleRuleInputV1>,
    pub rival_waves: RivalWaveTablesInputV1,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BiomeEncounterInputV1 {
    pub event_mult: Option<f64>,
    pub trainer_mult: Option<f64>,
    pub boss_pct: Option<u8>,
    pub boss_every_wave: Option<bool>,
    pub boss_bars: Option<[u8; 2]>,
    pub skip_chance: Option<u8>,
    pub skip_fallback: Option<SkipFallbackInputV1>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkipFallbackInputV1 {
    pub event: u32,
    pub boss: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ForcedBattleRuleInputV1 {
    pub weather: Option<u16>,
    pub terrain: Option<u16>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RivalWaveTablesInputV1 {
    pub normal: RivalPacingInputV1,
    pub sprint: RivalPacingInputV1,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RivalPacingInputV1 {
    pub canonical: Vec<[u32; 2]>,
    pub extra: BTreeMap<String, BTreeMap<String, u32>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompiledWorldBehaviorV1 {
    pub encounter_profiles: BTreeMap<BiomeId, BiomeEncounterProfileV1>,
    pub battle_rules: BTreeMap<BiomeId, BiomeBattleRuleV1>,
    pub rival_sequences: BTreeMap<String, BTreeMap<String, Vec<RivalWaveV1>>>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum WorldOracleCompileError {
    #[error("world oracle schema version must be 1")]
    Schema,
    #[error("world oracle SHA is invalid")]
    Oracle,
    #[error("world oracle biome identity is invalid")]
    Biome,
    #[error("world oracle ratio or percentage is invalid")]
    Number,
}

pub fn compile_world_behavior_v1(
    document: &WorldOracleDocumentV1,
) -> Result<CompiledWorldBehaviorV1, WorldOracleCompileError> {
    if document.schema_version != 1 {
        return Err(WorldOracleCompileError::Schema);
    }
    if document.oracle_sha.len() != 40
        || !document
            .oracle_sha
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(WorldOracleCompileError::Oracle);
    }
    let mut encounter_profiles = BTreeMap::new();
    for (biome, input) in &document.biome_encounters {
        let biome = parse_biome(biome)?;
        let profile = BiomeEncounterProfileV1 {
            event_rate: ratio(input.event_mult.unwrap_or(1.0))?,
            trainer_rate: ratio(input.trainer_mult.unwrap_or(1.0))?,
            boss_chance_pct: input.boss_pct.unwrap_or(0),
            boss_every_wave: input.boss_every_wave.unwrap_or(false),
            boss_bars: input.boss_bars.map(|bars| (bars[0], bars[1])),
            skip_chance_pct: input.skip_chance.unwrap_or(0),
            skip_fallback: input.skip_fallback.map(|fallback| BiomeSkipFallbackV1 {
                event_weight: fallback.event,
                boss_weight: fallback.boss,
            }),
        };
        if profile.boss_chance_pct > 100 || profile.skip_chance_pct > 100 {
            return Err(WorldOracleCompileError::Number);
        }
        encounter_profiles.insert(biome, profile);
    }
    let mut battle_rules = BTreeMap::new();
    for (biome, input) in &document.forced_battle_rules {
        battle_rules.insert(
            parse_biome(biome)?,
            BiomeBattleRuleV1 {
                forced_weather: input.weather.map(weather),
                forced_terrain: input.terrain.map(terrain),
            },
        );
    }
    let rival_sequences = BTreeMap::from([
        (
            "normal".to_owned(),
            compile_rival_pacing(&document.rival_waves.normal)?,
        ),
        (
            "sprint".to_owned(),
            compile_rival_pacing(&document.rival_waves.sprint)?,
        ),
    ]);
    Ok(CompiledWorldBehaviorV1 {
        encounter_profiles,
        battle_rules,
        rival_sequences,
    })
}

fn compile_rival_pacing(
    input: &RivalPacingInputV1,
) -> Result<BTreeMap<String, Vec<RivalWaveV1>>, WorldOracleCompileError> {
    let canonical: Vec<_> = input
        .canonical
        .iter()
        .map(|entry| RivalWaveV1 {
            wave: entry[0],
            trainer_type: entry[1],
            extra: false,
        })
        .collect();
    let mut output = BTreeMap::from([("default".to_owned(), canonical.clone())]);
    for (difficulty, extras) in &input.extra {
        let mut sequence = canonical.clone();
        for (wave, trainer_type) in extras {
            sequence.push(RivalWaveV1 {
                wave: wave.parse().map_err(|_| WorldOracleCompileError::Number)?,
                trainer_type: *trainer_type,
                extra: true,
            });
        }
        sequence.sort_unstable_by_key(|entry| (entry.wave, entry.trainer_type, entry.extra));
        output.insert(difficulty.clone(), sequence);
    }
    Ok(output)
}

fn parse_biome(value: &str) -> Result<BiomeId, WorldOracleCompileError> {
    let numeric = value
        .parse::<u64>()
        .map_err(|_| WorldOracleCompileError::Biome)?;
    SafeU53::new(numeric)
        .map(BiomeId::new)
        .map_err(|_| WorldOracleCompileError::Biome)
}

fn ratio(value: f64) -> Result<WorldRatioV1, WorldOracleCompileError> {
    if !value.is_finite() || value <= 0.0 {
        return Err(WorldOracleCompileError::Number);
    }
    let scaled = value * 1_000.0;
    let rounded = scaled.round();
    if (scaled - rounded).abs() > f64::EPSILON || rounded > f64::from(u32::MAX) {
        return Err(WorldOracleCompileError::Number);
    }
    let numerator = rounded as u32;
    let divisor = gcd(numerator, 1_000);
    Ok(WorldRatioV1 {
        numerator: numerator / divisor,
        denominator: 1_000 / divisor,
    })
}

fn gcd(mut left: u32, mut right: u32) -> u32 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left.max(1)
}

fn weather(code: u16) -> WeatherKind {
    if code == 0 {
        WeatherKind::None
    } else {
        WeatherKind::UnsupportedOracleCode(code)
    }
}

fn terrain(code: u16) -> TerrainKind {
    if code == 0 {
        TerrainKind::None
    } else {
        TerrainKind::UnsupportedOracleCode(code)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_world::runtime::{extra_rival_type_for_wave, rival_wave_ordinal, rival_wave_sequence};

    const FIXTURE: &str = include_str!("../../../fixtures/m7/m7-world-oracle-v1.json");

    #[test]
    fn pinned_world_tables_compile_without_floats_in_output() {
        let document: WorldOracleDocumentV1 = serde_json::from_str(FIXTURE).expect("world oracle");
        let compiled = compile_world_behavior_v1(&document).expect("compiled world");
        assert_eq!(compiled.encounter_profiles.len(), 31);
        assert!(!compiled.battle_rules.is_empty());
        for profile in compiled.encounter_profiles.values() {
            assert_ne!(profile.event_rate.denominator, 0);
            assert_ne!(profile.trainer_rate.denominator, 0);
        }
        let hell = &compiled.rival_sequences["normal"]["hell"];
        assert!(!rival_wave_sequence(hell).is_empty());
        let extra = extra_rival_type_for_wave(hell, 16).expect("wave 16 extra rival");
        assert!(rival_wave_ordinal(hell, 16, extra).is_some());
    }
}
