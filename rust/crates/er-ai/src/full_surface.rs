//! Complete deterministic M7 AI and custom-mode decision surface.
use std::collections::{BTreeMap, BTreeSet};

use er_types::battle_ids::{AbilityId, MoveId, PokemonId, SpeciesId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiActionKindV1 {
    Move,
    Switch,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiActionV1 {
    pub actor: PokemonId,
    pub kind: AiActionKindV1,
    pub move_id: Option<MoveId>,
    pub move_slot: Option<u8>,
    pub target: Option<u8>,
    pub switch_target: Option<PokemonId>,
    pub priority: i8,
    pub power: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AiActorViewV1 {
    pub pokemon: PokemonId,
    pub hp: u32,
    pub max_hp: u32,
    pub moves: Vec<(MoveId, u8, u16, i8, Vec<u8>)>,
    pub legal_switches: Vec<PokemonId>,
}

pub fn legal_actions_v1(actor: &AiActorViewV1) -> Vec<AiActionV1> {
    let mut actions = actor
        .moves
        .iter()
        .flat_map(|(move_id, slot, power, priority, targets)| {
            targets.iter().map(|target| AiActionV1 {
                actor: actor.pokemon,
                kind: AiActionKindV1::Move,
                move_id: Some(*move_id),
                move_slot: Some(*slot),
                target: Some(*target),
                switch_target: None,
                priority: *priority,
                power: *power,
            })
        })
        .chain(actor.legal_switches.iter().map(|target| AiActionV1 {
            actor: actor.pokemon,
            kind: AiActionKindV1::Switch,
            move_id: None,
            move_slot: None,
            target: None,
            switch_target: Some(*target),
            priority: 6,
            power: 0,
        }))
        .collect::<Vec<_>>();
    actions.sort();
    actions
}

pub fn first_legal_policy_v1(actions: &[AiActionV1]) -> Option<AiActionV1> {
    actions.first().cloned()
}

pub fn random_legal_policy_v1(actions: &[AiActionV1], draw: u64) -> Option<AiActionV1> {
    (!actions.is_empty()).then(|| actions[draw as usize % actions.len()].clone())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AiScoreContextV1 {
    pub effectiveness_percent: u16,
    pub accuracy_percent: u16,
    pub target_hp: u32,
    pub target_max_hp: u32,
    pub ally_damage_penalty: i32,
}

pub fn score_action_v1(action: &AiActionV1, context: AiScoreContextV1) -> i64 {
    if action.kind == AiActionKindV1::Switch {
        return 100 + i64::from(action.priority);
    }
    let expected = i64::from(action.power)
        * i64::from(context.effectiveness_percent)
        * i64::from(context.accuracy_percent)
        / 10_000;
    let knockout_bonus = if expected >= i64::from(context.target_hp) {
        1_000
    } else {
        0
    };
    let health_pressure = if context.target_max_hp == 0 {
        0
    } else {
        i64::from(context.target_max_hp - context.target_hp) * 100
            / i64::from(context.target_max_hp)
    };
    expected + knockout_bonus + health_pressure - i64::from(context.ally_damage_penalty)
}

pub fn highest_score_policy_v1(
    actions: &[AiActionV1],
    contexts: &BTreeMap<AiActionV1, AiScoreContextV1>,
) -> Option<AiActionV1> {
    actions
        .iter()
        .max_by(|left, right| {
            let left_score = contexts
                .get(*left)
                .map_or(i64::MIN, |context| score_action_v1(left, *context));
            let right_score = contexts
                .get(*right)
                .map_or(i64::MIN, |context| score_action_v1(right, *context));
            left_score.cmp(&right_score).then_with(|| right.cmp(left))
        })
        .cloned()
}

pub fn joint_actions_v1(per_actor: &[Vec<AiActionV1>], field_width: usize) -> Vec<Vec<AiActionV1>> {
    if per_actor.len() != field_width || !(1..=3).contains(&field_width) {
        return Vec::new();
    }
    let mut combinations = vec![Vec::new()];
    for actions in per_actor {
        let mut next = Vec::new();
        for prefix in &combinations {
            for action in actions {
                let duplicate_switch = action.switch_target.is_some()
                    && prefix.iter().any(|existing: &AiActionV1| {
                        existing.switch_target == action.switch_target
                    });
                if !duplicate_switch {
                    let mut combination = prefix.clone();
                    combination.push(action.clone());
                    next.push(combination);
                }
            }
        }
        combinations = next;
    }
    combinations.sort();
    combinations
}

pub fn highest_joint_score_policy_v1(
    combinations: &[Vec<AiActionV1>],
    contexts: &BTreeMap<AiActionV1, AiScoreContextV1>,
) -> Option<Vec<AiActionV1>> {
    combinations
        .iter()
        .max_by(|left, right| {
            let score = |actions: &[AiActionV1]| {
                actions
                    .iter()
                    .map(|action| {
                        contexts
                            .get(action)
                            .map_or(i64::MIN / 4, |ctx| score_action_v1(action, *ctx))
                    })
                    .sum::<i64>()
            };
            score(left).cmp(&score(right)).then_with(|| right.cmp(left))
        })
        .cloned()
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainerBuildV1 {
    pub key: String,
    pub party: Vec<SpeciesId>,
    pub ai_policy: String,
    pub field_width: u8,
}

pub fn build_trainer_v1(
    key: String,
    party: Vec<SpeciesId>,
    ai_policy: String,
    field_width: u8,
) -> Result<TrainerBuildV1, AiSurfaceErrorV1> {
    if key.is_empty()
        || ai_policy.is_empty()
        || party.is_empty()
        || party.len() > 6
        || field_width == 0
        || field_width > 3
        || party.len() < usize::from(field_width)
    {
        return Err(AiSurfaceErrorV1::Configuration);
    }
    Ok(TrainerBuildV1 {
        key,
        party,
        ai_policy,
        field_width,
    })
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BossBuildV1 {
    pub trainer: TrainerBuildV1,
    pub segments: u8,
    pub phase_thresholds: Vec<u8>,
    pub ability: Option<AbilityId>,
}

pub fn build_boss_v1(
    trainer: TrainerBuildV1,
    segments: u8,
    ability: Option<AbilityId>,
) -> Result<BossBuildV1, AiSurfaceErrorV1> {
    if segments == 0 || segments > 10 {
        return Err(AiSurfaceErrorV1::Configuration);
    }
    let phase_thresholds = (1..segments)
        .rev()
        .map(|segment| (u16::from(segment) * 100 / u16::from(segments)) as u8)
        .collect();
    Ok(BossBuildV1 {
        trainer,
        segments,
        phase_thresholds,
        ability,
    })
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameModeV1 {
    Classic,
    Endless,
    Challenge,
    Daily,
    Fun,
    Moody,
    Showdown,
    Coop,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameModeConfigV1 {
    pub mode: GameModeV1,
    pub starting_level: u16,
    pub terminal_wave: Option<u32>,
    pub allows_capture: bool,
    pub allows_rewards: bool,
    pub field_width: u8,
}

pub fn game_mode_config_v1(mode: GameModeV1) -> GameModeConfigV1 {
    match mode {
        GameModeV1::Classic => GameModeConfigV1 {
            mode,
            starting_level: 5,
            terminal_wave: Some(200),
            allows_capture: true,
            allows_rewards: true,
            field_width: 1,
        },
        GameModeV1::Endless => GameModeConfigV1 {
            mode,
            starting_level: 5,
            terminal_wave: None,
            allows_capture: true,
            allows_rewards: true,
            field_width: 1,
        },
        GameModeV1::Challenge => GameModeConfigV1 {
            mode,
            starting_level: 5,
            terminal_wave: Some(200),
            allows_capture: true,
            allows_rewards: true,
            field_width: 1,
        },
        GameModeV1::Daily => GameModeConfigV1 {
            mode,
            starting_level: 20,
            terminal_wave: Some(50),
            allows_capture: true,
            allows_rewards: true,
            field_width: 1,
        },
        GameModeV1::Fun => GameModeConfigV1 {
            mode,
            starting_level: 100,
            terminal_wave: Some(200),
            allows_capture: false,
            allows_rewards: true,
            field_width: 1,
        },
        GameModeV1::Moody => GameModeConfigV1 {
            mode,
            starting_level: 5,
            terminal_wave: Some(200),
            allows_capture: true,
            allows_rewards: true,
            field_width: 1,
        },
        GameModeV1::Showdown => GameModeConfigV1 {
            mode,
            starting_level: 50,
            terminal_wave: Some(1),
            allows_capture: false,
            allows_rewards: false,
            field_width: 1,
        },
        GameModeV1::Coop => GameModeConfigV1 {
            mode,
            starting_level: 5,
            terminal_wave: Some(200),
            allows_capture: true,
            allows_rewards: true,
            field_width: 2,
        },
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiRngDrawV1 {
    pub sequence: u64,
    pub reason: String,
    pub upper_exclusive: u64,
    pub result: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiRngAuditV1 {
    pub draws: Vec<AiRngDrawV1>,
}

impl AiRngAuditV1 {
    pub fn record(
        &mut self,
        reason: String,
        upper_exclusive: u64,
        result: u64,
    ) -> Result<u64, AiSurfaceErrorV1> {
        if reason.is_empty() || upper_exclusive == 0 || result >= upper_exclusive {
            return Err(AiSurfaceErrorV1::Rng);
        }
        let sequence = self.draws.len() as u64;
        self.draws.push(AiRngDrawV1 {
            sequence,
            reason,
            upper_exclusive,
            result,
        });
        Ok(result)
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AiRecoverySnapshotV1 {
    pub turn: u64,
    pub pending_actions: BTreeMap<PokemonId, AiActionV1>,
    pub committed_operations: BTreeSet<String>,
    pub rng_audit: AiRngAuditV1,
}

impl AiRecoverySnapshotV1 {
    pub fn admit_action(
        &mut self,
        operation_id: String,
        action: AiActionV1,
    ) -> Result<bool, AiSurfaceErrorV1> {
        if operation_id.is_empty() {
            return Err(AiSurfaceErrorV1::Recovery);
        }
        if self.committed_operations.contains(&operation_id) {
            return Ok(false);
        }
        self.pending_actions.insert(action.actor, action);
        self.committed_operations.insert(operation_id);
        Ok(true)
    }

    pub fn restore(self) -> Result<Self, AiSurfaceErrorV1> {
        if self
            .rng_audit
            .draws
            .iter()
            .enumerate()
            .any(|(index, draw)| {
                draw.sequence != index as u64 || draw.result >= draw.upper_exclusive
            })
        {
            return Err(AiSurfaceErrorV1::Recovery);
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AiSurfaceErrorV1 {
    #[error("AI configuration is invalid")]
    Configuration,
    #[error("AI RNG audit is invalid")]
    Rng,
    #[error("AI recovery snapshot is invalid")]
    Recovery,
}

#[cfg(test)]
mod tests {
    use er_types::SafeU53;

    use super::*;

    fn pokemon(value: u64) -> PokemonId {
        PokemonId::new(SafeU53::new(value).expect("pokemon"))
    }

    fn move_id(value: u64) -> MoveId {
        MoveId::new(SafeU53::new(value).expect("move"))
    }

    fn action(actor: u64, power: u16, target: u8) -> AiActionV1 {
        AiActionV1 {
            actor: pokemon(actor),
            kind: AiActionKindV1::Move,
            move_id: Some(move_id(1)),
            move_slot: Some(0),
            target: Some(target),
            switch_target: None,
            priority: 0,
            power,
        }
    }

    #[test]
    fn legal_basic_and_scoring_policies_are_deterministic() {
        let actor = AiActorViewV1 {
            pokemon: pokemon(1),
            hp: 10,
            max_hp: 10,
            moves: vec![(move_id(1), 0, 40, 0, vec![0, 1])],
            legal_switches: Vec::new(),
        };
        let actions = legal_actions_v1(&actor);
        assert_eq!(actions.len(), 2);
        assert_eq!(first_legal_policy_v1(&actions), Some(actions[0].clone()));
        assert_eq!(
            random_legal_policy_v1(&actions, 3),
            Some(actions[1].clone())
        );
        let contexts = actions
            .iter()
            .cloned()
            .map(|action| {
                let target_hp = if action.target == Some(1) { 10 } else { 100 };
                (
                    action,
                    AiScoreContextV1 {
                        effectiveness_percent: 100,
                        accuracy_percent: 100,
                        target_hp,
                        target_max_hp: 100,
                        ally_damage_penalty: 0,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            highest_score_policy_v1(&actions, &contexts).and_then(|action| action.target),
            Some(1)
        );
    }

    #[test]
    fn doubles_and_triples_joint_actions_reject_duplicate_switches() {
        let switch = |actor, target| AiActionV1 {
            actor: pokemon(actor),
            kind: AiActionKindV1::Switch,
            move_id: None,
            move_slot: None,
            target: None,
            switch_target: Some(pokemon(target)),
            priority: 6,
            power: 0,
        };
        let combinations = joint_actions_v1(
            &[
                vec![switch(1, 4), switch(1, 5)],
                vec![switch(2, 4), switch(2, 6)],
                vec![action(3, 20, 0)],
            ],
            3,
        );
        assert_eq!(combinations.len(), 3);
        assert!(combinations.iter().all(|combo| {
            let switches = combo
                .iter()
                .filter_map(|action| action.switch_target)
                .collect::<BTreeSet<_>>();
            switches.len()
                == combo
                    .iter()
                    .filter(|action| action.switch_target.is_some())
                    .count()
        }));
    }

    #[test]
    fn trainer_boss_and_modes_validate_topology() {
        let trainer = build_trainer_v1(
            "rival".to_owned(),
            vec![
                SpeciesId::new(SafeU53::new(1).expect("species")),
                SpeciesId::new(SafeU53::new(2).expect("species")),
            ],
            "highest-score".to_owned(),
            2,
        )
        .expect("trainer");
        let boss = build_boss_v1(trainer, 4, None).expect("boss");
        assert_eq!(boss.phase_thresholds, vec![75, 50, 25]);
        assert_eq!(game_mode_config_v1(GameModeV1::Coop).field_width, 2);
        assert!(!game_mode_config_v1(GameModeV1::Showdown).allows_rewards);
    }

    #[test]
    fn ai_rng_and_recovery_are_audited_and_idempotent() {
        let mut recovery = AiRecoverySnapshotV1::default();
        recovery
            .rng_audit
            .record("policy-tie".to_owned(), 2, 1)
            .expect("draw");
        assert!(
            recovery
                .admit_action("turn/1".to_owned(), action(1, 40, 0))
                .expect("admit")
        );
        assert!(
            !recovery
                .admit_action("turn/1".to_owned(), action(1, 40, 0))
                .expect("duplicate")
        );
        assert!(recovery.restore().is_ok());
    }
}
