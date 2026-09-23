//! Source-bound root selection for the ordinary Ace/Town/day wave-two wild.
//! Enemy construction, movesets, modifier draws and receipt settlement remain
//! separate owners; this selector never advances a game state by itself.

use er_rng::audit::{RngCallsiteId, RngDraw, RngReason};
use er_rng::battle::RngRuntime;
use er_types::battle_ids::{GameModeId, SpeciesId};
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
        Some(100), Some(100), Some(100), Some(100), Some(0), Some(200), Some(100), Some(100),
        Some(100), Some(50), Some(175), Some(100), Some(50), Some(100),
    ],
    &[
        Some(150), Some(50), Some(50), Some(100), Some(0), Some(100), None,
    ],
    &[
        Some(175), Some(100), Some(175), Some(100), Some(100), Some(175),
    ],
    &[None, Some(175), Some(175)],
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
    pub pokemon_id: u32,
    pub gender: CurrentTownGenderV1,
    pub form_index: u16,
    pub nature_index: u8,
    /// Includes the two root draws followed by the exact pre-moves draws.
    pub audit: Vec<RngDraw>,
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

/// The ordinary source constructor through nature selection, stopping before
/// moveset, shiny/variant, stats, modifiers and encounter settlement. All RNG
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
            callsite,
        )
        .map_err(|_| CurrentTownWildErrorV1::RandomDraw)?
        .get() as u8;
    let audit = staged.audit_entries()[first_audit..].to_vec();
    *rng = staged;
    Ok(CurrentTownWildConstructorPrefixV1 {
        root,
        ability_index,
        pokemon_id,
        gender,
        form_index,
        nature_index,
        audit,
    })
}
