//! Source-bound root selection for the ordinary Ace/Town/day wave-two wild.
//! Enemy construction, movesets, modifier draws and receipt settlement remain
//! separate owners; this selector never advances a game state by itself.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use er_rng::audit::{RngCallsiteId, RngDraw, RngReason};
use er_rng::battle::RngRuntime;
use er_types::battle_ids::{AbilityId, GameModeId, MoveId, SpeciesId};
use er_types::battle_model::{MoveAccuracy, MoveCategory, MovePower, PokemonType};
use er_types::run_ids::BiomeId;
use er_types::{RunDifficultyV1, SafeU53};
use er_world::content_v2::BiomeDefinitionV2;
use serde::Deserialize;
use thiserror::Error;

use crate::m9e_content_v2::PreparedGameContentV2;

const ORACLE: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
// Complete, source-observed effective Town day pool. The V2 compiler stores
// ALL and DAY in separate rows; source Arena concatenates them in this order.
const SOURCE_TIERS: [&[u64]; 5] = [
    &[
        16, 19, 21, 263, 265, 276, 399, 504, 506, 661, 831, 915, 10, 161, 165, 187, 191, 266, 396,
        519, 546, 664, 734, 819,
    ],
    &[
        273, 293, 543, 926, 29, 32, 69, 261, 270, 300, 415, 420, 572, 921,
    ],
    &[63, 173, 174, 283, 440, 821, 924],
    &[133, 172, 175, 280, 290, 447],
    &[132, 446, 570],
];

// Half-percent units from two identical pinned-source observations of all 163
// species in the Town evolution closure (run 35847184226, gender SHA256
// a27f86e31feccd821f35aecaf9eb496faf120127e3df3d2c7c0b14f6593928fb).
// The arrays follow SOURCE_TIERS, including root 266 before its 265 substitution.
const MALE_HALF_PERCENT_TIERS: [&[Option<u8>]; 5] = [
    &[Some(100); 24],
    &[
        Some(100),
        Some(100),
        Some(100),
        Some(100),
        Some(0),
        Some(200),
        Some(100),
        Some(100),
        Some(100),
        Some(50),
        Some(175),
        Some(100),
        Some(50),
        Some(100),
    ],
    &[
        Some(150),
        Some(50),
        Some(50),
        Some(100),
        Some(0),
        Some(100),
        None,
    ],
    &[
        Some(175),
        Some(100),
        Some(175),
        Some(100),
        Some(100),
        Some(175),
    ],
    &[None, Some(175), Some(175)],
];

// All effective level-two Town root forms have three active source slots
// (run 35850969668, source fixture SHA256
// c7564ac254fee378288b8cd8a10a1ca27dda01c6775045871feb3f6799a5f558).
// Root 266 is substituted with species 265 before enemy construction. The
// partner Eevee exception is applied by source_town_ability_id below.
const SOURCE_ACTIVE_ABILITIES_TIERS: [&[[u64; 3]]; 5] = [
    &[
        [99, 62, 145],
        [55, 96, 5102],
        [5205, 177, 97],
        [5109, 113, 5102],
        [19, 21, 38],
        [62, 5058, 5236],
        [86, 5181, 141],
        [50, 198, 5165],
        [72, 53, 50],
        [79, 177, 145],
        [157, 113, 171],
        [268, 173, 53],
        [107, 5269, 50],
        [50, 157, 95],
        [50, 155, 142],
        [102, 151, 5280],
        [142, 229, 179],
        [19, 21, 38],
        [22, 120, 145],
        [105, 109, 79],
        [158, 5280, 5020],
        [132, 68, 107],
        [5171, 55, 290],
        [5164, 119, 5102],
    ],
    &[
        [106, 5067, 128],
        [5033, 113, 125],
        [127, 5451, 3],
        [82, 165, 173],
        [5027, 55, 107],
        [5027, 55, 107],
        [5006, 94, 5171],
        [153, 22, 173],
        [33, 34, 20],
        [96, 132, 147],
        [155, 5020, 118],
        [257, 94, 107],
        [5026, 142, 92],
        [5185, 89, 5208],
    ],
    &[
        [5025, 36, 5065],
        [187, 109, 98],
        [5487, 172, 98],
        [33, 165, 44],
        [144, 32, 5280],
        [5067, 22, 5098],
        [132, 53, 96],
    ],
    &[
        [158, 91, 109],
        [5019, 9, 5074],
        [158, 55, 56],
        [140, 36, 32],
        [107, 5165, 87],
        [158, 95, 5038],
    ],
    &[[158, 98, 150], [118, 12, 82], [5285, 194, 290]],
];

// Pinned source form types (run 35851751221, fixture SHA256
// d66c5e26ecc920e50bdcc680479dfab9913103435f975ee5b4d0447d65373fcb).
// 255 is the source's absent secondary type. Every form selectable in this
// current wave-two context has an empty extra-type list.
const SOURCE_TYPE_TIERS: [&[[u8; 2]]; 5] = [
    &[
        [0, 2],
        [0, 255],
        [0, 2],
        [0, 255],
        [6, 255],
        [0, 2],
        [0, 255],
        [0, 255],
        [0, 255],
        [0, 2],
        [0, 255],
        [0, 255],
        [6, 255],
        [0, 255],
        [6, 2],
        [11, 2],
        [11, 255],
        [6, 255],
        [0, 2],
        [0, 2],
        [11, 17],
        [6, 255],
        [0, 255],
        [0, 255],
    ],
    &[
        [11, 255],
        [0, 255],
        [6, 3],
        [17, 255],
        [3, 255],
        [3, 255],
        [11, 3],
        [16, 255],
        [10, 11],
        [0, 255],
        [6, 2],
        [11, 255],
        [0, 255],
        [12, 255],
    ],
    &[
        [13, 255],
        [17, 255],
        [0, 17],
        [6, 10],
        [0, 255],
        [2, 255],
        [0, 255],
    ],
    &[[0, 255], [12, 255], [17, 255], [13, 17], [6, 4], [1, 255]],
    &[[0, 255], [0, 255], [16, 255]],
];

// Source run 35853912715, SHA256
// 63cd454d9e74ae2d77e59327b02a391e8c196edc60bc030cc26037589c6dfd78.
// These are the raw form registry move rows at levels <= 2; constructor move
// weighting and random selection are separate operations.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceTownLevelTwoFormsV1 {
    schema: u8,
    source: String,
    rows: Vec<SourceTownSpeciesLevelTwoRows>,
}

static SOURCE_LEVEL_TWO_FORMS: OnceLock<Result<SourceTownLevelTwoFormsV1, ()>> = OnceLock::new();

type SourceTownSpeciesLevelTwoRows = (u64, Vec<Vec<(i16, u64)>>);
type SourceTownMoveMetaRow = (u64, u8, u8, i16, i16, bool, bool);
type SourceTownMovegenRow = (u64, f64, u8);
type SourceTownAbilityProfile = (Vec<u64>, Vec<u64>);
type SourceTownSpeciesAbilityRows = (u64, Vec<SourceTownAbilityProfile>);
type SourceTownSignatureRow = (u64, Option<Vec<u64>>);

// Source run 35854351965, SHA256
// 86b764e17e26ec5db4bd201cc7f95950975aa134960eae2a0570a8b5a7201a80.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceTownLevelTwoMetaV1 {
    schema: u8,
    source: String,
    rows: Vec<SourceTownMoveMetaRow>,
}

static SOURCE_LEVEL_TWO_META: OnceLock<Result<SourceTownLevelTwoMetaV1, ()>> = OnceLock::new();

// Source run 35857027335, SHA256
// 5369a09a00d1e10bd67025ce6c8ff8079dd5fe05cec45a5e40c0617950cd6575.
// Each row is [move ID, effective power without ability effects, movegen flags].
// Flags are SacrificialOnHit, DefAtk, PhotonGeyserCategory,
// ShellSideArmCategory, TeraMoveCategory, VariableMoveType, FixedDamage,
// and charging, in that bit order.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceTownLevelTwoMovegenV1 {
    schema: u8,
    source: String,
    rows: Vec<SourceTownMovegenRow>,
}

static SOURCE_LEVEL_TWO_MOVEGEN: OnceLock<Result<SourceTownLevelTwoMovegenV1, ()>> =
    OnceLock::new();

// Source run 35858565756, SHA256
// 69c24f1b15c8888fd2ae7ec9c1565562135d8f9dc0eefb56774f1a919ca1e013.
// The modifier set uses source AbilityAttr.is, including inherited movegen
// attributes, over the complete 395-ability Town evolution closure.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceTownLevelTwoAbilitiesV1 {
    schema: u8,
    source: String,
    rows: Vec<SourceTownSpeciesAbilityRows>,
    movegen_modifiers: Vec<u64>,
}

static SOURCE_LEVEL_TWO_ABILITIES: OnceLock<Result<SourceTownLevelTwoAbilitiesV1, ()>> =
    OnceLock::new();

// Source run 35865632493, SHA256
// a7d37de2698ddfa3b4e3b4c67d0c66cbf876784185eaf12ef0407f577f6042a9.
// The independent source verifier proved no signature is available in the
// level-two move pool of any effective Town root/form.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceTownLevelTwoSignaturesV1 {
    schema: u8,
    source: String,
    rows: Vec<SourceTownSignatureRow>,
}

static SOURCE_LEVEL_TWO_SIGNATURES: OnceLock<Result<SourceTownLevelTwoSignaturesV1, ()>> =
    OnceLock::new();

fn source_level_two_forms() -> Result<&'static SourceTownLevelTwoFormsV1, CurrentTownWildErrorV1> {
    SOURCE_LEVEL_TWO_FORMS
        .get_or_init(|| {
            let parsed: SourceTownLevelTwoFormsV1 =
                serde_json::from_str(include_str!("current_town_level_two_forms.json"))
                    .map_err(|_| ())?;
            let mut expected = Vec::new();
            for root in SOURCE_TIERS.iter().flat_map(|tier| tier.iter()) {
                let effective = if *root == 266 { 265 } else { *root };
                if !expected.contains(&effective) {
                    expected.push(effective);
                }
            }
            if parsed.schema != 1
                || parsed.source != ORACLE
                || expected.len() != 53
                || parsed.rows.iter().map(|row| row.0).collect::<Vec<_>>() != expected
                || parsed.rows.iter().map(|row| row.1.len()).sum::<usize>() != 90
                || parsed.rows.iter().any(|(_, forms)| {
                    forms.is_empty()
                        || forms.len() > 20
                        || forms.iter().any(|rows| {
                            rows.len() > 512
                                || rows.iter().any(|(level, move_id)| {
                                    !(-2..=2).contains(level) || *move_id == 0 || *move_id > 100_000
                                })
                        })
                })
            {
                return Err(());
            }
            Ok(parsed)
        })
        .as_ref()
        .map_err(|_| CurrentTownWildErrorV1::SourceContent)
}

fn source_level_two_meta() -> Result<&'static SourceTownLevelTwoMetaV1, CurrentTownWildErrorV1> {
    SOURCE_LEVEL_TWO_META
        .get_or_init(|| {
            let parsed: SourceTownLevelTwoMetaV1 =
                serde_json::from_str(include_str!("current_town_level_two_meta.json"))
                    .map_err(|_| ())?;
            let forms = source_level_two_forms().map_err(|_| ())?;
            let mut expected = Vec::new();
            for (_, variants) in &forms.rows {
                for rows in variants {
                    for (_, id) in rows {
                        if !expected.contains(id) {
                            expected.push(*id);
                        }
                    }
                }
            }
            if parsed.schema != 1
                || parsed.source != ORACLE
                || expected.len() != 131
                || parsed.rows.iter().map(|row| row.0).collect::<Vec<_>>() != expected
                || parsed.rows.iter().any(|row| {
                    row.1 > 2
                        || row.2 > 18
                        || !(-1..=250).contains(&row.3)
                        || !(-1..=100).contains(&row.4)
                        || row.5
                })
            {
                return Err(());
            }
            Ok(parsed)
        })
        .as_ref()
        .map_err(|_| CurrentTownWildErrorV1::SourceContent)
}

fn source_level_two_movegen() -> Result<&'static SourceTownLevelTwoMovegenV1, CurrentTownWildErrorV1>
{
    SOURCE_LEVEL_TWO_MOVEGEN
        .get_or_init(|| {
            let parsed: SourceTownLevelTwoMovegenV1 =
                serde_json::from_str(include_str!("current_town_level_two_movegen.json"))
                    .map_err(|_| ())?;
            let meta = source_level_two_meta().map_err(|_| ())?;
            if parsed.schema != 1
                || parsed.source != ORACLE
                || parsed.rows.len() != 131
                || parsed.rows.iter().map(|row| row.0).collect::<Vec<_>>()
                    != meta.rows.iter().map(|row| row.0).collect::<Vec<_>>()
                || parsed
                    .rows
                    .iter()
                    .any(|row| !row.1.is_finite() || !(0.0..=10_000.0).contains(&row.1))
                || parsed
                    .rows
                    .iter()
                    .zip(&meta.rows)
                    .any(|(row, move_meta)| row.2 & 32 != 0 && !move_meta.6)
            {
                return Err(());
            }
            Ok(parsed)
        })
        .as_ref()
        .map_err(|_| CurrentTownWildErrorV1::SourceContent)
}

fn source_level_two_abilities()
-> Result<&'static SourceTownLevelTwoAbilitiesV1, CurrentTownWildErrorV1> {
    SOURCE_LEVEL_TWO_ABILITIES
        .get_or_init(|| {
            let parsed: SourceTownLevelTwoAbilitiesV1 =
                serde_json::from_str(include_str!("current_town_level_two_abilities.json"))
                    .map_err(|_| ())?;
            let forms = source_level_two_forms().map_err(|_| ())?;
            if parsed.schema != 1
                || parsed.source != ORACLE
                || parsed.rows.len() != 53
                || parsed.movegen_modifiers.len() != 98
                || parsed.movegen_modifiers.contains(&0)
                || parsed
                    .movegen_modifiers
                    .iter()
                    .collect::<BTreeSet<_>>()
                    .len()
                    != 98
                || parsed.rows.iter().zip(&forms.rows).any(|(row, source)| {
                    row.0 != source.0
                        || row.1.len() != source.1.len()
                        || row.1.iter().any(|(active, passive)| {
                            active.len() != 3
                                || passive.len() > 3
                                || active.iter().chain(passive).any(|id| *id == 0)
                        })
                })
            {
                return Err(());
            }
            Ok(parsed)
        })
        .as_ref()
        .map_err(|_| CurrentTownWildErrorV1::SourceContent)
}

fn source_level_two_signatures(
) -> Result<&'static SourceTownLevelTwoSignaturesV1, CurrentTownWildErrorV1> {
    SOURCE_LEVEL_TWO_SIGNATURES
        .get_or_init(|| {
            let parsed: SourceTownLevelTwoSignaturesV1 =
                serde_json::from_str(include_str!("current_town_level_two_signatures.json"))
                    .map_err(|_| ())?;
            let forms = source_level_two_forms().map_err(|_| ())?;
            if parsed.schema != 1
                || parsed.source != ORACLE
                || parsed.rows.len() != 53
                || parsed.rows.iter().zip(&forms.rows).any(|(row, source)| {
                    row.0 != source.0
                        || row.1.as_ref().is_some_and(|ids| {
                            ids.is_empty()
                                || ids.len() > 32
                                || source.1.iter().any(|form| {
                                    form.iter().any(|(level, id)| {
                                        *level >= 0 && ids.contains(id)
                                    })
                                })
                        })
                })
                || parsed.rows.iter().filter(|row| row.1.is_some()).count() != 1
                || parsed
                    .rows
                    .iter()
                    .find(|row| row.0 == 133)
                    .and_then(|row| row.1.as_deref())
                    != Some(&[733, 734, 735, 737, 736, 739, 738, 740][..])
            {
                return Err(());
            }
            Ok(parsed)
        })
        .as_ref()
        .map_err(|_| CurrentTownWildErrorV1::SourceContent)
}

#[derive(Clone, Copy, Debug)]
pub struct CurrentTownDayWaveTwoContextV1<'a> {
    pub mode: GameModeId,
    pub biome: BiomeId,
    pub difficulty: RunDifficultyV1,
    pub wave: u16,
    pub level: u16,
    pub luck: u16,
    pub forced_tier: Option<u8>,
    pub encounter_boss_segments: u8,
    pub regional_boost: bool,
    pub time_override: Option<i16>,
    /// Arena.lastTimeOfDay, retained with its effective pokemonPool.
    pub effective_pool_time: i16,
    pub override_species: Option<SpeciesId>,
    pub golden_bug_net: bool,
    pub excluded_species: &'a [SpeciesId],
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CurrentTownWildErrorV1 {
    #[error("unsupported current Town wild context")]
    UnsupportedContext,
    #[error("compiled Town pool or source species graph differs")]
    SourceContent,
    #[error("source random draw failed")]
    RandomDraw,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentTownWildRootV1 {
    pub tier: u8,
    pub tier_roll: u64,
    pub root_index: usize,
    pub source_root: SpeciesId,
    pub effective_species: SpeciesId,
    pub audit: Vec<RngDraw>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurrentTownGenderV1 {
    Male,
    Female,
    Genderless,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentTownWildConstructorPrefixV1 {
    pub root: CurrentTownWildRootV1,
    pub ability_index: u8,
    pub ability_id: AbilityId,
    pub pokemon_id: u32,
    pub ivs: [u8; 6],
    pub gender: CurrentTownGenderV1,
    pub form_index: u16,
    pub nature_index: u8,
    pub tera_type: PokemonType,
    /// Includes the two root draws followed by the exact pre-moves draws.
    pub audit: Vec<RngDraw>,
}

/// Pinned `src/utils/common.ts:getIvsFromId`: six five-bit chunks of the
/// generated 32-bit Pokemon ID, ordered HP through speed.
pub fn source_town_ivs_from_id(id: u32) -> [u8; 6] {
    [
        ((id & 0x3e00_0000) >> 25) as u8,
        ((id & 0x01f0_0000) >> 20) as u8,
        ((id & 0x000f_8000) >> 15) as u8,
        ((id & 0x0000_7c00) >> 10) as u8,
        ((id & 0x0000_03e0) >> 5) as u8,
        (id & 0x0000_001f) as u8,
    ]
}

pub fn source_town_male_half_percent(
    root: SpeciesId,
) -> Result<Option<u8>, CurrentTownWildErrorV1> {
    for (tier, roots) in SOURCE_TIERS.iter().enumerate() {
        if let Some(index) = roots.iter().position(|id| *id == root.get().get()) {
            return MALE_HALF_PERCENT_TIERS[tier]
                .get(index)
                .copied()
                .ok_or(CurrentTownWildErrorV1::SourceContent);
        }
    }
    Err(CurrentTownWildErrorV1::SourceContent)
}

fn source_town_form_supported(id: u64, form_index: u16) -> bool {
    match id {
        664 => form_index < 20,
        133 | 172 => form_index < 2,
        _ => form_index == 0,
    }
}

fn source_town_root_position(root: SpeciesId) -> Result<(usize, usize), CurrentTownWildErrorV1> {
    let id = root.get().get();
    SOURCE_TIERS
        .iter()
        .enumerate()
        .find_map(|(tier, roots)| {
            roots
                .iter()
                .position(|item| *item == id)
                .map(|index| (tier, index))
        })
        .ok_or(CurrentTownWildErrorV1::SourceContent)
}

pub fn source_town_ability_id(
    root: SpeciesId,
    form_index: u16,
    ability_index: u8,
) -> Result<AbilityId, CurrentTownWildErrorV1> {
    let id = root.get().get();
    if !source_town_form_supported(id, form_index) || ability_index > 2 {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    let source = source_town_root_position(root)?;
    let slots = if id == 133 && form_index == 1 {
        [158, 109, 86]
    } else {
        SOURCE_ACTIVE_ABILITIES_TIERS[source.0][source.1]
    };
    Ok(AbilityId::new(
        SafeU53::new(slots[usize::from(ability_index)])
            .map_err(|_| CurrentTownWildErrorV1::SourceContent)?,
    ))
}

fn source_town_type(id: u8) -> Result<PokemonType, CurrentTownWildErrorV1> {
    match id {
        0 => Ok(PokemonType::Normal),
        1 => Ok(PokemonType::Fighting),
        2 => Ok(PokemonType::Flying),
        3 => Ok(PokemonType::Poison),
        4 => Ok(PokemonType::Ground),
        5 => Ok(PokemonType::Rock),
        6 => Ok(PokemonType::Bug),
        7 => Ok(PokemonType::Ghost),
        8 => Ok(PokemonType::Steel),
        9 => Ok(PokemonType::Fire),
        10 => Ok(PokemonType::Water),
        11 => Ok(PokemonType::Grass),
        12 => Ok(PokemonType::Electric),
        13 => Ok(PokemonType::Psychic),
        14 => Ok(PokemonType::Ice),
        15 => Ok(PokemonType::Dragon),
        16 => Ok(PokemonType::Dark),
        17 => Ok(PokemonType::Fairy),
        18 => Ok(PokemonType::Stellar),
        _ => Err(CurrentTownWildErrorV1::SourceContent),
    }
}

pub fn source_town_form_types(
    root: SpeciesId,
    form_index: u16,
) -> Result<Vec<PokemonType>, CurrentTownWildErrorV1> {
    if !source_town_form_supported(root.get().get(), form_index) {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    let source = source_town_root_position(root)?;
    let [primary, secondary] = SOURCE_TYPE_TIERS[source.0][source.1];
    let mut types = vec![source_town_type(primary)?];
    if secondary != 255 {
        let second = source_town_type(secondary)?;
        if second != types[0] {
            types.push(second);
        }
    }
    Ok(types)
}

/// Exact source base stats for the selected Town form. The V2 canonical
/// species covers all eligible forms except partner Eevee, whose source form
/// has a distinct base-stat row.
pub fn source_town_form_base_stats(
    content: &PreparedGameContentV2,
    root: SpeciesId,
    form_index: u16,
) -> Result<[u32; 6], CurrentTownWildErrorV1> {
    if content.identity().oracle_sha.as_str() != ORACLE
        || !source_town_form_supported(root.get().get(), form_index)
    {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    let effective = source_town_level_two_species(root)?;
    let source = content
        .battle
        .species(effective)
        .map_err(|_| CurrentTownWildErrorV1::SourceContent)?
        .base_stats;
    if root.get().get() == 133 && form_index == 1 {
        return Ok([65, 75, 70, 65, 85, 75]);
    }
    Ok([
        source.hp,
        source.attack,
        source.defense,
        source.special_attack,
        source.special_defense,
        source.speed,
    ])
}

/// Exact unweighted registry rows for one level-two effective Town form.
/// Negative rows remain present here so the caller can apply the source
/// evolution/relearner filter in the same order as Pokemon.getLevelMoves.
pub fn source_town_level_two_form_rows(
    root: SpeciesId,
    form_index: u16,
) -> Result<Vec<(i16, MoveId)>, CurrentTownWildErrorV1> {
    if !source_town_form_supported(root.get().get(), form_index) {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    let effective = source_town_level_two_species(root)?.get().get();
    let forms = source_level_two_forms()?
        .rows
        .iter()
        .find(|row| row.0 == effective)
        .ok_or(CurrentTownWildErrorV1::SourceContent)?;
    forms
        .1
        .get(usize::from(form_index))
        .ok_or(CurrentTownWildErrorV1::SourceContent)?
        .iter()
        .map(|(level, id)| {
            Ok((
                *level,
                MoveId::new(SafeU53::new(*id).map_err(|_| CurrentTownWildErrorV1::SourceContent)?),
            ))
        })
        .collect()
}

fn source_town_move_meta(
    content: &PreparedGameContentV2,
    id: MoveId,
) -> Result<&'static SourceTownMoveMetaRow, CurrentTownWildErrorV1> {
    if content.identity().oracle_sha.as_str() != ORACLE {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    let source = source_level_two_meta()?
        .rows
        .iter()
        .find(|row| row.0 == id.get().get())
        .ok_or(CurrentTownWildErrorV1::SourceContent)?;
    let category = match source.1 {
        0 => MoveCategory::Physical,
        1 => MoveCategory::Special,
        2 => MoveCategory::Status,
        _ => return Err(CurrentTownWildErrorV1::SourceContent),
    };
    let power = if source.3 < 0 {
        MovePower::None
    } else {
        MovePower::Value(
            u16::try_from(source.3).map_err(|_| CurrentTownWildErrorV1::SourceContent)?,
        )
    };
    let accuracy = if source.4 < 0 {
        MoveAccuracy::AlwaysHits
    } else {
        MoveAccuracy::Percent(
            u8::try_from(source.4).map_err(|_| CurrentTownWildErrorV1::SourceContent)?,
        )
    };
    let compiled = content
        .battle
        .move_definition(id)
        .map_err(|_| CurrentTownWildErrorV1::SourceContent)?;
    if compiled.category != category
        || compiled.move_type != source_town_type(source.2)?
        || compiled.power != power
        || compiled.accuracy != accuracy
    {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    Ok(source)
}

/// Source getLevelMoves and getAndWeightLevelMoves up to their initial
/// level-based weights. This stops before move filters, ability-modified
/// effective power, STAB selection, and the weighted RNG draws.
pub fn source_town_initial_level_move_pool(
    content: &PreparedGameContentV2,
    root: SpeciesId,
    form_index: u16,
) -> Result<Vec<(MoveId, u32)>, CurrentTownWildErrorV1> {
    let mut levels = source_town_level_two_form_rows(root, form_index)?;
    levels.retain(|(level, _)| *level >= 0);
    levels.sort_by_key(|(level, _)| *level);
    let mut seen = BTreeSet::new();
    let mut pool = Vec::new();
    for (level, id) in levels {
        if !seen.insert(id) {
            continue;
        }
        let source = source_town_move_meta(content, id)?;
        if source.5 {
            continue;
        }
        let weight = if level == 0 {
            70
        } else if level == 1 && source.3 >= 70 {
            60
        } else {
            u32::try_from(level + 20).map_err(|_| CurrentTownWildErrorV1::SourceContent)?
        };
        pool.push((id, weight));
    }
    Ok(pool)
}

#[derive(Clone, Debug, PartialEq)]
pub struct CurrentTownNeutralLevelMoveWeightV1 {
    pub id: MoveId,
    pub initial_weight: u32,
    pub adjusted_weight: f64,
    pub weighted_weight: u64,
}

/// Source wild `filterMovePool`, `adjustDamageMoveWeights`, and the 1.6-power
/// transform when no active or passive ability changes move power/accuracy.
/// Ability effects and move selection must be proved before using this in a
/// connected constructor; this pure stage owns no RNG.
pub fn source_town_neutral_weighted_level_move_pool(
    content: &PreparedGameContentV2,
    root: SpeciesId,
    form_index: u16,
    ability_index: u8,
    stats: [u32; 6],
) -> Result<Vec<CurrentTownNeutralLevelMoveWeightV1>, CurrentTownWildErrorV1> {
    if stats.iter().any(|stat| *stat == 0 || *stat > 10_000) {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    let abilities = source_level_two_abilities()?;
    let effective = source_town_level_two_species(root)?.get().get();
    let profile = abilities
        .rows
        .iter()
        .find(|row| row.0 == effective)
        .and_then(|row| row.1.get(usize::from(form_index)))
        .ok_or(CurrentTownWildErrorV1::SourceContent)?;
    let active = profile
        .0
        .get(usize::from(ability_index))
        .ok_or(CurrentTownWildErrorV1::SourceContent)?;
    if *active
        != source_town_ability_id(root, form_index, ability_index)?
            .get()
            .get()
    {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    if abilities.movegen_modifiers.contains(active)
        || profile
            .1
            .iter()
            .any(|id| abilities.movegen_modifiers.contains(id))
    {
        return Err(CurrentTownWildErrorV1::UnsupportedContext);
    }
    let initial = source_town_initial_level_move_pool(content, root, form_index)?;
    let effects = source_level_two_movegen()?;
    let mut rows = Vec::with_capacity(initial.len());
    let mut max_power = 40.0_f64;
    for (id, weight) in initial {
        let meta = *source_town_move_meta(content, id)?;
        let effect = *effects
            .rows
            .iter()
            .find(|row| row.0 == id.get().get())
            .ok_or(CurrentTownWildErrorV1::SourceContent)?;
        if weight == 0 || meta.5 || effect.2 & 1 != 0 {
            continue;
        }
        if meta.1 != 2 {
            max_power = max_power.max(effect.1);
        }
        rows.push((id, weight, meta.1, effect.1, effect.2));
    }
    max_power = max_power.min(120.0);
    let attack = f64::from(stats[1]);
    let special_attack = f64::from(stats[3]);
    let higher = attack.max(special_attack);
    let lower = attack.min(special_attack);
    let worse_category = if attack > special_attack { 1 } else { 0 };
    let adjustment_ratio = ((lower / higher).powi(3) * 2.0).min(1.0);
    rows.into_iter()
        .map(|(id, initial_weight, category, power, flags)| {
            let mut weight = f64::from(initial_weight);
            if category != 2 {
                weight *= (power / max_power).clamp(0.25, 1.0);
                if flags & 2 != 0 {
                    let defense_ratio = f64::from(stats[2]) / higher;
                    weight *= (defense_ratio.powi(3) * 1.3).min(1.1);
                } else if category == worse_category && flags & (4 | 8 | 16) == 0 {
                    weight *= adjustment_ratio;
                }
            }
            let weighted = (weight.powf(1.6) * 100.0).ceil();
            if !weighted.is_finite() || !(0.0..=1_000_000_000.0).contains(&weighted) {
                return Err(CurrentTownWildErrorV1::SourceContent);
            }
            Ok(CurrentTownNeutralLevelMoveWeightV1 {
                id,
                initial_weight,
                adjusted_weight: weight,
                weighted_weight: weighted as u64,
            })
        })
        .collect()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentTownUnfilteredMovesetV1 {
    pub moves: Vec<MoveId>,
    pub audit: Vec<RngDraw>,
}

fn source_town_weighted_move_index(
    rng: &mut RngRuntime,
    candidates: &[(usize, u64)],
) -> Result<usize, CurrentTownWildErrorV1> {
    let total = candidates.iter().try_fold(0_u64, |sum, (_, weight)| {
        sum.checked_add(*weight)
            .ok_or(CurrentTownWildErrorV1::RandomDraw)
    })?;
    if total == 0 {
        return Err(CurrentTownWildErrorV1::RandomDraw);
    }
    let mut roll = rng
        .run_rand_seed_int(
            SafeU53::new(total).map_err(|_| CurrentTownWildErrorV1::RandomDraw)?,
            SafeU53::ZERO,
            RngReason::RandomSelector,
            RngCallsiteId::mechanics(RngReason::RandomSelector),
        )
        .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?
        .get();
    // Source uses `while (rand > weight)`, so equality stays in this slot.
    for (index, weight) in candidates {
        if roll <= *weight {
            return Ok(*index);
        }
        roll -= *weight;
    }
    Err(CurrentTownWildErrorV1::RandomDraw)
}

/// Source signature check, forced STAB and the first weighted fill pass for
/// an ability-neutral wild. The source's filterUselessMoves pass and any
/// subsequent replacement draws remain a separate stage.
pub fn source_town_neutral_unfiltered_moveset(
    content: &PreparedGameContentV2,
    root: SpeciesId,
    form_index: u16,
    ability_index: u8,
    stats: [u32; 6],
    rng: &mut RngRuntime,
) -> Result<CurrentTownUnfilteredMovesetV1, CurrentTownWildErrorV1> {
    source_level_two_signatures()?;
    let mut pool = source_town_neutral_weighted_level_move_pool(
        content,
        root,
        form_index,
        ability_index,
        stats,
    )?;
    let types = source_town_form_types(root, form_index)?;
    let mut staged = rng.clone();
    let first_audit = staged.audit_entries().len();
    let mut moves = Vec::with_capacity(4);
    let stab = pool
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let meta = source_town_move_meta(content, row.id)?;
            Ok((index, row.weighted_weight, meta.1 != 2 && !meta.6
                && types.contains(&source_town_type(meta.2)?)))
        })
        .collect::<Result<Vec<_>, CurrentTownWildErrorV1>>()?
        .into_iter()
        .filter_map(|(index, weight, included)| included.then_some((index, weight)))
        .collect::<Vec<_>>();
    if !stab.is_empty() {
        let index = source_town_weighted_move_index(&mut staged, &stab)?;
        moves.push(pool.remove(index).id);
    }
    while moves.len() < 4 && !pool.is_empty() {
        let candidates = pool
            .iter()
            .enumerate()
            .map(|(index, row)| (index, row.weighted_weight))
            .collect::<Vec<_>>();
        let index = source_town_weighted_move_index(&mut staged, &candidates)?;
        moves.push(pool.remove(index).id);
    }
    let audit = staged.audit_entries()[first_audit..].to_vec();
    *rng = staged;
    Ok(CurrentTownUnfilteredMovesetV1 { moves, audit })
}

/// Source level-two stat formula before held, nature-weight, challenge or
/// other modifiers. This is a reference calculation, not settled enemy stats.
pub fn source_town_unmodified_level_two_stats(
    base: [u32; 6],
    ivs: [u8; 6],
    nature_index: u8,
) -> Result<[u32; 6], CurrentTownWildErrorV1> {
    if nature_index >= 25 || base.iter().any(|stat| *stat > 10_000) {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    let up: [&[u8]; 6] = [
        &[],
        &[1, 2, 3, 4],
        &[5, 7, 8, 9],
        &[15, 16, 17, 19],
        &[20, 21, 22, 23],
        &[10, 11, 13, 14],
    ];
    let down: [&[u8]; 6] = [
        &[],
        &[5, 10, 15, 20],
        &[1, 11, 16, 21],
        &[3, 8, 13, 23],
        &[4, 9, 14, 19],
        &[2, 7, 17, 22],
    ];
    let mut stats = [0_u32; 6];
    for index in 0..6 {
        let raw = ((2 * u64::from(base[index]) + u64::from(ivs[index])) * 2) / 100;
        let value = if index == 0 {
            raw + 12
        } else {
            let unmodified = raw + 5;
            if up[index].contains(&nature_index) {
                (unmodified * 11).div_ceil(10)
            } else if down[index].contains(&nature_index) {
                (unmodified * 9) / 10
            } else {
                unmodified
            }
        };
        stats[index] =
            u32::try_from(value.max(1)).map_err(|_| CurrentTownWildErrorV1::SourceContent)?;
    }
    Ok(stats)
}

pub fn source_town_level_two_species(root: SpeciesId) -> Result<SpeciesId, CurrentTownWildErrorV1> {
    // Complete level-two graph observation: root 266 is forced to prevo 265;
    // none of the 54 roots has an eligible upward evolution at this level.
    if !SOURCE_TIERS
        .iter()
        .any(|tier| tier.contains(&root.get().get()))
    {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    if root.get().get() == 266 {
        Ok(SpeciesId::new(
            SafeU53::new(265).map_err(|_| CurrentTownWildErrorV1::SourceContent)?,
        ))
    } else {
        Ok(root)
    }
}

/// Checks the entire source-observed 54-root day pool, including its ordering.
pub fn source_town_day_pools(
    biome: &BiomeDefinitionV2,
) -> Result<[Vec<SpeciesId>; 5], CurrentTownWildErrorV1> {
    if biome.id.get().get() != 0 || biome.key != "biome/0" || biome.pokemon_pools.len() != 13 {
        return Err(CurrentTownWildErrorV1::SourceContent);
    }
    let pools: [Vec<SpeciesId>; 5] = std::array::from_fn(|tier| {
        biome
            .pokemon_pools
            .iter()
            .filter(|row| row.tier == tier as i16 && matches!(row.time_of_day, -1 | 1))
            .flat_map(|row| row.species.iter().copied())
            .collect()
    });
    for (tier, pool) in pools.iter().enumerate() {
        if pool
            .iter()
            .map(|id| id.get().get())
            .collect::<Vec<_>>()
            .as_slice()
            != SOURCE_TIERS[tier]
        {
            return Err(CurrentTownWildErrorV1::SourceContent);
        }
    }
    Ok(pools)
}

fn validated_pools(
    content: &PreparedGameContentV2,
    context: CurrentTownDayWaveTwoContextV1<'_>,
) -> Result<[Vec<SpeciesId>; 5], CurrentTownWildErrorV1> {
    if content.identity().oracle_sha.as_str() != ORACLE
        || context.difficulty != RunDifficultyV1::Ace
        || context.wave != 2
        || context.level != 2
        || context.luck != 0
        || context.forced_tier.is_some()
        || context.encounter_boss_segments != 0
        || context.regional_boost
        || context.time_override.is_some()
        || context.effective_pool_time != 1
        || context.override_species.is_some()
        || context.golden_bug_net
        || !context.excluded_species.is_empty()
        || context.biome.get().get() != 0
        || !content.world.mode(context.mode).is_some_and(|mode| {
            mode.key == "CLASSIC"
                && mode.supported
                && !mode.cooperative
                && !mode.challenge_selection
        })
    {
        return Err(CurrentTownWildErrorV1::UnsupportedContext);
    }
    // Arena.randomSpecies reads the already effective pokemonPool. Its cached
    // time can differ from a fresh calculation after BattleScene.setSeed.
    let biome = content
        .world
        .biome(context.biome)
        .ok_or(CurrentTownWildErrorV1::SourceContent)?;
    let pools = source_town_day_pools(biome)?;
    for pool in &pools {
        for root in pool {
            let species = source_town_level_two_species(*root)?;
            if content.battle.species(species).is_err() {
                return Err(CurrentTownWildErrorV1::SourceContent);
            }
        }
    }
    Ok(pools)
}

/// Source Arena.randomSpecies root and level-two substitution only. The caller
/// must derive the context from the retained current run and own subsequent
/// enemy generation, reward settlement and material replay separately.
pub fn select_current_town_day_wave_two_root(
    content: &PreparedGameContentV2,
    context: CurrentTownDayWaveTwoContextV1<'_>,
    rng: &mut RngRuntime,
) -> Result<CurrentTownWildRootV1, CurrentTownWildErrorV1> {
    let pools = validated_pools(content, context)?;
    let mut staged = rng.clone();
    let first_audit = staged.audit_entries().len();
    let tier_roll = staged
        .run_rand_seed_int(
            SafeU53::new(512).map_err(|_| CurrentTownWildErrorV1::RandomDraw)?,
            SafeU53::ZERO,
            RngReason::RandomSelector,
            RngCallsiteId::mechanics(RngReason::RandomSelector),
        )
        .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?
        .get();
    let tier = if tier_roll >= 156 {
        0
    } else if tier_roll >= 32 {
        1
    } else if tier_roll >= 6 {
        2
    } else if tier_roll >= 1 {
        3
    } else {
        4
    };
    let root_index = staged
        .run_pick_index(
            pools[tier].len(),
            RngReason::RandomSelector,
            RngCallsiteId::mechanics(RngReason::RandomSelector),
        )
        .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?;
    let source_root = pools[tier][root_index];
    let effective_species = source_town_level_two_species(source_root)?;
    let audit = staged.audit_entries()[first_audit..].to_vec();
    if audit.len() != 2 {
        return Err(CurrentTownWildErrorV1::RandomDraw);
    }
    *rng = staged;
    Ok(CurrentTownWildRootV1 {
        tier: tier as u8,
        tier_roll,
        root_index,
        source_root,
        effective_species,
        audit,
    })
}

/// The ordinary source constructor through tera-type selection, stopping before
/// moveset, enemy shiny re-roll, stats, modifiers and encounter settlement. All RNG
/// changes commit together; a rejected context leaves the caller unchanged.
pub fn select_current_town_day_wave_two_constructor_prefix(
    content: &PreparedGameContentV2,
    context: CurrentTownDayWaveTwoContextV1<'_>,
    rng: &mut RngRuntime,
) -> Result<CurrentTownWildConstructorPrefixV1, CurrentTownWildErrorV1> {
    let mut staged = rng.clone();
    let first_audit = staged.audit_entries().len();
    let root = select_current_town_day_wave_two_root(content, context, &mut staged)?;
    let reason = RngReason::RandomSelector;
    let callsite = RngCallsiteId::mechanics(reason);
    // Every level-two effective Town root has distinct regular slots and a
    // present hidden slot in the complete source graph (run 35795971040).
    let regular = staged
        .run_rand_seed_int(
            SafeU53::new(2).map_err(|_| CurrentTownWildErrorV1::RandomDraw)?,
            SafeU53::ZERO,
            reason,
            callsite.clone(),
        )
        .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?
        .get() as u8;
    let hidden = staged
        .run_rand_seed_int(
            SafeU53::new(256).map_err(|_| CurrentTownWildErrorV1::RandomDraw)?,
            SafeU53::ZERO,
            reason,
            callsite.clone(),
        )
        .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?
        .get();
    let ability_index = if hidden == 0 { 2 } else { regular };
    let pokemon_id = staged
        .run_rand_seed_int(
            SafeU53::new(1_u64 << 32).map_err(|_| CurrentTownWildErrorV1::RandomDraw)?,
            SafeU53::ZERO,
            reason,
            callsite.clone(),
        )
        .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?
        .get() as u32;
    let gender = match source_town_male_half_percent(root.source_root)? {
        None => CurrentTownGenderV1::Genderless,
        Some(male_half_percent) => {
            let roll = staged
                .run_rand_seed_float(reason, callsite.clone())
                .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?;
            if roll * 100.0 < f64::from(male_half_percent) / 2.0 {
                CurrentTownGenderV1::Male
            } else {
                CurrentTownGenderV1::Female
            }
        }
    };
    // On Ace/Town/wave two, only these three effective roots enter the
    // source's random-form branches. The observed 20 Scatterbug forms are all
    // obtainable (run 35848256061, form flags SHA256 e03db62cf3982e03fbb5a25045e15407abd12010aefcbca8fa8cf5585881f446).
    let form_index = match root.effective_species.get().get() {
        664 => staged
            .run_rand_seed_int(
                SafeU53::new(20).map_err(|_| CurrentTownWildErrorV1::RandomDraw)?,
                SafeU53::ZERO,
                reason,
                callsite.clone(),
            )
            .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?
            .get() as u16,
        172 => u16::from(
            staged
                .run_rand_seed_int(
                    SafeU53::new(8).map_err(|_| CurrentTownWildErrorV1::RandomDraw)?,
                    SafeU53::ZERO,
                    reason,
                    callsite.clone(),
                )
                .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?
                .get()
                == 0,
        ),
        133 => staged
            .run_rand_seed_int(
                SafeU53::new(2).map_err(|_| CurrentTownWildErrorV1::RandomDraw)?,
                SafeU53::ZERO,
                reason,
                callsite.clone(),
            )
            .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?
            .get() as u16,
        _ => 0,
    };
    let nature_index = staged
        .run_rand_seed_int(
            SafeU53::new(25).map_err(|_| CurrentTownWildErrorV1::RandomDraw)?,
            SafeU53::ZERO,
            reason,
            callsite.clone(),
        )
        .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?
        .get() as u8;
    // Source randSeedItem is draw-free for a single type; otherwise it calls
    // Phaser.RND.pick once after nature and before enemy moveset generation.
    let types = source_town_form_types(root.source_root, form_index)?;
    let tera_type = if types.len() == 1 {
        types[0]
    } else {
        let index = staged
            .run_pick_index(types.len(), reason, callsite.clone())
            .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?;
        types[index]
    };
    let ability_id = source_town_ability_id(root.source_root, form_index, ability_index)?;
    content
        .battle
        .ability_definition(ability_id)
        .map_err(|_| CurrentTownWildErrorV1::SourceContent)?;
    let audit = staged.audit_entries()[first_audit..].to_vec();
    *rng = staged;
    Ok(CurrentTownWildConstructorPrefixV1 {
        root,
        ability_index,
        ability_id,
        pokemon_id,
        ivs: source_town_ivs_from_id(pokemon_id),
        gender,
        form_index,
        nature_index,
        tera_type,
        audit,
    })
}
