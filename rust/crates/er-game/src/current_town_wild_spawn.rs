//! Source-bound root selection for the ordinary Ace/Town/day wave-two wild.
//! Enemy construction, movesets, modifier draws and receipt settlement remain
//! separate owners; this selector never advances a game state by itself.

use er_rng::audit::{RngCallsiteId, RngDraw, RngReason};
use er_rng::battle::RngRuntime;
use er_types::battle_ids::{AbilityId, GameModeId, SpeciesId};
use er_types::battle_model::PokemonType;
use er_types::run_ids::BiomeId;
use er_types::{RunDifficultyV1, SafeU53};
use er_world::content_v2::BiomeDefinitionV2;
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
