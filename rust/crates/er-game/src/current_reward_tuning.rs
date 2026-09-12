//! Exact cached399d item-tuning application, preserving source row order and
//! requested-tier preference when collapsing duplicate entries. Logging-only maxWeight is not runtime state.
use super::current_reward_roll::RollError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Weight {
    Fixed(u32),
    SourcePredicate(&'static str),
}
#[derive(Clone, Debug)]
pub(crate) struct Row<T> {
    /// Unique pre-tuning source entry identity, not a current pool index.
    pub ordinal: u16,
    pub id: &'static str,
    pub weight: Weight,
    pub payload: T,
}
struct Tuning {
    id: &'static str,
    tier: Option<usize>,
    weight: Option<u32>,
}
// Generated from cached source JSON bytes1356 SHA946bef109b2939864d71309b6ac944fa2bd340df951b56169a2b768e3403eef0.
const TUNING: &[Tuning] = &[
    Tuning {
        id: "ABILITY_RANDOMIZER",
        tier: Some(2),
        weight: None,
    },
    Tuning {
        id: "AMULET_COIN",
        tier: None,
        weight: Some(2),
    },
    Tuning {
        id: "BERRY_POUCH",
        tier: Some(2),
        weight: None,
    },
    Tuning {
        id: "BIG_NUGGET",
        tier: Some(2),
        weight: None,
    },
    Tuning {
        id: "DNA_SPLICERS",
        tier: Some(2),
        weight: Some(2),
    },
    Tuning {
        id: "ER_ABILITY_SHIELD",
        tier: None,
        weight: Some(1),
    },
    Tuning {
        id: "ER_ADRENALINE_ORB",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_AIR_BALLOON",
        tier: None,
        weight: Some(1),
    },
    Tuning {
        id: "ER_BLUNDER_POLICY",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_CLEAR_AMULET",
        tier: None,
        weight: Some(1),
    },
    Tuning {
        id: "ER_COVERT_CLOAK",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_EJECT_BUTTON",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_EJECT_PACK",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_FLOAT_STONE",
        tier: None,
        weight: Some(1),
    },
    Tuning {
        id: "ER_HEAVY_DUTY_BOOTS",
        tier: None,
        weight: Some(1),
    },
    Tuning {
        id: "ER_IRON_BALL",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_MENTAL_HERB",
        tier: None,
        weight: Some(1),
    },
    Tuning {
        id: "ER_RED_CARD",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_ROOM_SERVICE",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_SAFETY_GOGGLES",
        tier: None,
        weight: Some(1),
    },
    Tuning {
        id: "ER_SHED_SHELL",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_SMOKE_BALL",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_STICKY_BARB",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_THROAT_SPRAY",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_UTILITY_UMBRELLA",
        tier: None,
        weight: Some(0),
    },
    Tuning {
        id: "ER_ZOOM_LENS",
        tier: None,
        weight: Some(1),
    },
    Tuning {
        id: "FORM_CHANGE_ITEM",
        tier: None,
        weight: Some(5),
    },
    Tuning {
        id: "MULTI_LENS",
        tier: Some(4),
        weight: None,
    },
    Tuning {
        id: "NUGGET",
        tier: Some(1),
        weight: Some(0),
    },
    Tuning {
        id: "RARE_EVOLUTION_ITEM",
        tier: None,
        weight: Some(5),
    },
];

pub(crate) fn apply<T>(pools: &mut [Vec<Row<T>>; 5]) -> Result<(), RollError> {
    let mut ordinals = std::collections::BTreeSet::new();
    for row in pools.iter().flatten() {
        if !ordinals.insert(row.ordinal) || row.id.is_empty() {
            return Err(RollError::Invalid);
        }
    }
    if ordinals.len() > 256 {
        return Err(RollError::Invalid);
    }
    for tuning in TUNING {
        let found = pools
            .iter()
            .enumerate()
            .flat_map(|(tier, entries)| {
                entries
                    .iter()
                    .filter(|row| row.id == tuning.id)
                    .map(move |row| (tier, row.ordinal))
            })
            .collect::<Vec<_>>();
        let Some(&(current_tier, selected)) = found
            .iter()
            .find(|(tier, _)| Some(*tier) == tuning.tier)
            .or_else(|| found.first())
        else {
            continue; // Exact source skips tuning for missing source pool entries.
        };
        for pool in pools.iter_mut() {
            pool.retain(|row| row.id != tuning.id || row.ordinal == selected);
        }
        let index = pools[current_tier]
            .iter()
            .position(|row| row.ordinal == selected)
            .ok_or(RollError::Invalid)?;
        if let Some(weight) = tuning.weight {
            pools[current_tier][index].weight = Weight::Fixed(weight);
        }
        if let Some(target) = tuning.tier
            && target != current_tier
        {
            let row = pools[current_tier].remove(index);
            pools[target].push(row);
        }
    }
    Ok(())
}
