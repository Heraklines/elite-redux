//! Current source target selection with explicitly resolved owner inputs.
//! Ability/variable-target callbacks, weather/type queries and seeded RNG remain
//! caller-owned. This module does not authorize commands or execute a move.
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TargetKind {
    User,
    Other,
    AllOthers,
    NearOther,
    AllNearOthers,
    NearEnemy,
    AllNearEnemies,
    RandomNearEnemy,
    AllEnemies,
    Attacker,
    NearAlly,
    Ally,
    UserOrNearAlly,
    UserAndAllies,
    All,
    UserSide,
    EnemySide,
    BothSides,
    Party,
    Curse,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetContext {
    /// Flat source indices: player slots 0..capacity, enemy slots 3..3+capacity.
    pub capacities: [u8; 2],
    /// Resolved isAllowedInBattle; opponent enumeration uses this before callbacks.
    pub allowed: [bool; 6],
    pub active: [bool; 6],
    pub user: u8,
    pub target: TargetKind,
    pub replacement: Option<TargetKind>,
    /// Ordered callback result per opponent, including inactive opponents.
    pub variable: Vec<Option<TargetKind>>,
    pub spread_flag: bool,
    pub multi_hit: bool,
    pub ghost: bool,
    pub fog: bool,
    pub fog_suppressed: bool,
    pub flying: bool,
    pub pulse: bool,
    pub arrangement: bool,
    /// Actual caller draw from all opponents, before live filtering.
    pub random_index: Option<usize>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetSet {
    pub targets: Vec<i8>,
    pub multiple: bool,
    pub variable_visits: Vec<u8>,
    pub random_bounds: Vec<usize>,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("unsupported or inconsistent resolved targeting context")]
pub struct TargetContextError;

pub fn resolve_move_targets(input: &TargetContext) -> Result<TargetSet, TargetContextError> {
    use TargetKind::*;
    if input
        .capacities
        .iter()
        .any(|capacity| !(1..=3).contains(capacity))
        || input.user >= 6
        || input.user % 3 >= input.capacities[usize::from(input.user / 3)]
        || (0..6).any(|index| {
            input.active[index] && index % 3 >= usize::from(input.capacities[index / 3])
        })
    {
        return Err(TargetContextError);
    }
    let side = input.user / 3;
    if (0..6).any(|index| input.active[index] && !input.allowed[index]) {
        return Err(TargetContextError);
    }
    let opponents = (0..input.capacities[usize::from(1 - side)])
        .map(|position| (1 - side) * 3 + position)
        .filter(|index| input.allowed[usize::from(*index)])
        .collect::<Vec<_>>();
    if input.variable.len() != opponents.len() {
        return Err(TargetContextError);
    }
    let allies = (0..input.capacities[usize::from(side)])
        .map(|position| side * 3 + position)
        .filter(|index| *index != input.user)
        .collect::<Vec<_>>();
    let mut kind = input.replacement.unwrap_or(input.target);
    for replacement in input.variable.iter().flatten() {
        kind = *replacement;
    }
    if matches!(kind, NearOther | NearEnemy) && input.spread_flag && !input.multi_hit {
        kind = AllNearEnemies;
    }
    let mut output = TargetSet {
        targets: Vec::new(),
        multiple: false,
        variable_visits: opponents.clone(),
        random_bounds: Vec::new(),
    };
    if kind != RandomNearEnemy && input.random_index.is_some() {
        return Err(TargetContextError);
    }
    if kind == Attacker {
        output.targets.push(-1);
        return Ok(output);
    }
    let mut selected = match kind {
        User | Party => vec![input.user],
        Curse if !input.ghost && !(input.fog && !input.fog_suppressed) => vec![input.user],
        Curse | NearOther | Other | AllNearOthers | AllOthers => {
            output.multiple = matches!(kind, AllNearOthers | AllOthers);
            opponents.iter().chain(&allies).copied().collect()
        }
        NearEnemy | AllNearEnemies | AllEnemies | EnemySide => {
            output.multiple = kind != NearEnemy;
            opponents.clone()
        }
        RandomNearEnemy => {
            let index = input.random_index.ok_or(TargetContextError)?;
            let target = opponents.get(index).ok_or(TargetContextError)?;
            output.random_bounds.push(opponents.len());
            vec![*target]
        }
        NearAlly | Ally => allies,
        UserOrNearAlly | UserAndAllies | UserSide => {
            output.multiple = kind != UserOrNearAlly;
            std::iter::once(input.user).chain(allies).collect()
        }
        All | BothSides => {
            output.multiple = true;
            std::iter::once(input.user)
                .chain(allies)
                .chain(opponents.iter().copied())
                .collect()
        }
        Attacker => return Err(TargetContextError),
    };
    if input.arrangement
        && matches!(
            kind,
            NearOther | AllNearOthers | NearEnemy | AllNearEnemies | NearAlly | UserOrNearAlly
        )
        && !input.flying
        && !input.pulse
    {
        let axis = |index: u8| {
            let side = usize::from(index / 3);
            let capacity = input.capacities[side];
            let only_active = (0..capacity)
                .filter(|position| input.active[side * 3 + usize::from(*position)])
                .collect::<Vec<_>>();
            let position = if only_active.len() == 1 && only_active[0] == index % 3 {
                (capacity - 1) / 2
            } else {
                index % 3
            };
            let coordinate = 2 * i16::from(position) - i16::from(capacity - 1);
            if side == 1 { -coordinate } else { coordinate }
        };
        let user_axis = axis(input.user);
        selected.retain(|index| *index == input.user || (user_axis - axis(*index)).abs() <= 2);
    }
    selected.retain(|index| input.active[usize::from(*index)]);
    if matches!(kind, NearOther | Other) && !selected.iter().any(|index| opponents.contains(index))
    {
        selected.retain(|index| opponents.contains(index));
    }
    output.targets = selected.into_iter().map(|index| index as i8).collect();
    Ok(output)
}
