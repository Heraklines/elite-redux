//! Complete typed M7 scenario compiler and deterministic runtime.
use std::collections::{BTreeMap, BTreeSet, VecDeque};

use er_types::battle_ids::{BattleId, PokemonId};
use er_types::{SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const SCENARIO_SEMANTIC_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ScenarioConditionV1 {
    Always,
    Flag { key: String, value: bool },
    CounterAtLeast { key: String, value: i64 },
    TargetExists,
    PartySizeAtLeast { size: usize },
    MoneyAtLeast { amount: u64 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ScenarioEffectV1 {
    SetFlag { key: String, value: bool },
    AddCounter { key: String, amount: i64 },
    SetTarget { pokemon: Option<PokemonId> },
    AddMoney { amount: u64 },
    RemoveMoney { amount: u64 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioChoiceV1 {
    pub option_id: String,
    pub label_key: String,
    pub condition: ScenarioConditionV1,
    pub effects: Vec<ScenarioEffectV1>,
    pub next_node: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ScenarioSemanticNodeV1 {
    Message {
        message_key: String,
        next_node: String,
    },
    Choice {
        prompt_key: String,
        choices: Vec<ScenarioChoiceV1>,
    },
    Conditional {
        condition: ScenarioConditionV1,
        then_node: String,
        else_node: String,
    },
    Battle {
        battle_key: String,
        win_node: String,
        lose_node: String,
    },
    Complete {
        outcome_key: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioSemanticProgramV1 {
    pub schema_version: u32,
    pub scenario_key: String,
    pub entry_node: String,
    pub nodes: BTreeMap<String, ScenarioSemanticNodeV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ScenarioSurfaceErrorV1 {
    #[error("scenario semantic graph is malformed or not closed")]
    Compile,
    #[error("scenario transition is invalid")]
    Transition,
    #[error("scenario arithmetic overflowed")]
    Overflow,
    #[error("scenario co-op operation conflicts")]
    CoopConflict,
}

pub fn compile_scenario_semantics_v1(
    scenario_key: String,
    entry_node: String,
    nodes: BTreeMap<String, ScenarioSemanticNodeV1>,
) -> Result<ScenarioSemanticProgramV1, ScenarioSurfaceErrorV1> {
    if scenario_key.is_empty()
        || entry_node.is_empty()
        || nodes.is_empty()
        || !nodes.contains_key(&entry_node)
    {
        return Err(ScenarioSurfaceErrorV1::Compile);
    }
    for (id, node) in &nodes {
        if id.is_empty()
            || outgoing_nodes_v1(node)
                .iter()
                .any(|next| !nodes.contains_key(*next))
        {
            return Err(ScenarioSurfaceErrorV1::Compile);
        }
        if let ScenarioSemanticNodeV1::Choice { choices, .. } = node {
            let ids = choices
                .iter()
                .map(|choice| &choice.option_id)
                .collect::<BTreeSet<_>>();
            if choices.is_empty()
                || ids.len() != choices.len()
                || choices
                    .iter()
                    .any(|choice| choice.option_id.is_empty() || choice.label_key.is_empty())
            {
                return Err(ScenarioSurfaceErrorV1::Compile);
            }
        }
    }
    let mut queue = VecDeque::from([entry_node.as_str()]);
    let mut reached = BTreeSet::new();
    while let Some(node) = queue.pop_front() {
        if !reached.insert(node) {
            continue;
        }
        queue.extend(outgoing_nodes_v1(
            nodes.get(node).ok_or(ScenarioSurfaceErrorV1::Compile)?,
        ));
    }
    if reached.len() != nodes.len() {
        return Err(ScenarioSurfaceErrorV1::Compile);
    }
    Ok(ScenarioSemanticProgramV1 {
        schema_version: SCENARIO_SEMANTIC_SCHEMA_VERSION_V1,
        scenario_key,
        entry_node,
        nodes,
    })
}

fn outgoing_nodes_v1(node: &ScenarioSemanticNodeV1) -> Vec<&str> {
    match node {
        ScenarioSemanticNodeV1::Message { next_node, .. } => vec![next_node],
        ScenarioSemanticNodeV1::Choice { choices, .. } => choices
            .iter()
            .map(|choice| choice.next_node.as_str())
            .collect(),
        ScenarioSemanticNodeV1::Conditional {
            then_node,
            else_node,
            ..
        } => {
            vec![then_node, else_node]
        }
        ScenarioSemanticNodeV1::Battle {
            win_node,
            lose_node,
            ..
        } => vec![win_node, lose_node],
        ScenarioSemanticNodeV1::Complete { .. } => Vec::new(),
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioConditionContextV1 {
    pub flags: BTreeMap<String, bool>,
    pub counters: BTreeMap<String, i64>,
    pub target: Option<PokemonId>,
    pub party_size: usize,
    pub money: u64,
}

pub fn evaluate_scenario_condition_v1(
    condition: &ScenarioConditionV1,
    context: &ScenarioConditionContextV1,
) -> bool {
    match condition {
        ScenarioConditionV1::Always => true,
        ScenarioConditionV1::Flag { key, value } => context.flags.get(key) == Some(value),
        ScenarioConditionV1::CounterAtLeast { key, value } => context
            .counters
            .get(key)
            .is_some_and(|actual| actual >= value),
        ScenarioConditionV1::TargetExists => context.target.is_some(),
        ScenarioConditionV1::PartySizeAtLeast { size } => context.party_size >= *size,
        ScenarioConditionV1::MoneyAtLeast { amount } => context.money >= *amount,
    }
}

pub fn available_scenario_choices_v1(
    node: &ScenarioSemanticNodeV1,
    context: &ScenarioConditionContextV1,
) -> Vec<ScenarioChoiceV1> {
    let ScenarioSemanticNodeV1::Choice { choices, .. } = node else {
        return Vec::new();
    };
    choices
        .iter()
        .filter(|choice| evaluate_scenario_condition_v1(&choice.condition, context))
        .cloned()
        .collect()
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioRuntimeV1 {
    pub scenario_key: String,
    pub node: String,
    pub context: ScenarioConditionContextV1,
    pub nested_battle: Option<BattleId>,
    pub revision: SafeU53,
    pub complete_outcome: Option<String>,
}

impl ScenarioRuntimeV1 {
    pub fn new(program: &ScenarioSemanticProgramV1) -> Self {
        Self {
            scenario_key: program.scenario_key.clone(),
            node: program.entry_node.clone(),
            context: ScenarioConditionContextV1::default(),
            nested_battle: None,
            revision: SafeU53::ZERO,
            complete_outcome: None,
        }
    }

    pub fn advance(
        &mut self,
        program: &ScenarioSemanticProgramV1,
        choice: Option<&str>,
    ) -> Result<(), ScenarioSurfaceErrorV1> {
        if self.complete_outcome.is_some() || self.scenario_key != program.scenario_key {
            return Err(ScenarioSurfaceErrorV1::Transition);
        }
        let node = program
            .nodes
            .get(&self.node)
            .ok_or(ScenarioSurfaceErrorV1::Transition)?;
        let next = match node {
            ScenarioSemanticNodeV1::Message { next_node, .. } => next_node.clone(),
            ScenarioSemanticNodeV1::Choice { .. } => {
                let option = available_scenario_choices_v1(node, &self.context)
                    .into_iter()
                    .find(|option| Some(option.option_id.as_str()) == choice)
                    .ok_or(ScenarioSurfaceErrorV1::Transition)?;
                for effect in &option.effects {
                    apply_scenario_effect_v1(&mut self.context, effect)?;
                }
                option.next_node
            }
            ScenarioSemanticNodeV1::Conditional {
                condition,
                then_node,
                else_node,
            } => {
                if evaluate_scenario_condition_v1(condition, &self.context) {
                    then_node.clone()
                } else {
                    else_node.clone()
                }
            }
            ScenarioSemanticNodeV1::Battle { .. } => {
                return Err(ScenarioSurfaceErrorV1::Transition);
            }
            ScenarioSemanticNodeV1::Complete { outcome_key } => {
                self.complete_outcome = Some(outcome_key.clone());
                self.bump_revision()?;
                return Ok(());
            }
        };
        self.node = next;
        self.bump_revision()
    }

    pub fn start_nested_battle(
        &mut self,
        program: &ScenarioSemanticProgramV1,
        battle: BattleId,
    ) -> Result<String, ScenarioSurfaceErrorV1> {
        let Some(ScenarioSemanticNodeV1::Battle { battle_key, .. }) = program.nodes.get(&self.node)
        else {
            return Err(ScenarioSurfaceErrorV1::Transition);
        };
        if self.nested_battle.replace(battle).is_some() {
            return Err(ScenarioSurfaceErrorV1::Transition);
        }
        self.bump_revision()?;
        Ok(battle_key.clone())
    }

    pub fn settle_nested_battle(
        &mut self,
        program: &ScenarioSemanticProgramV1,
        won: bool,
    ) -> Result<(), ScenarioSurfaceErrorV1> {
        if self.nested_battle.take().is_none() {
            return Err(ScenarioSurfaceErrorV1::Transition);
        }
        let Some(ScenarioSemanticNodeV1::Battle {
            win_node,
            lose_node,
            ..
        }) = program.nodes.get(&self.node)
        else {
            return Err(ScenarioSurfaceErrorV1::Transition);
        };
        self.node = if won {
            win_node.clone()
        } else {
            lose_node.clone()
        };
        self.bump_revision()
    }

    fn bump_revision(&mut self) -> Result<(), ScenarioSurfaceErrorV1> {
        self.revision = SafeU53::new(
            self.revision
                .get()
                .checked_add(1)
                .ok_or(ScenarioSurfaceErrorV1::Overflow)?,
        )
        .map_err(|_| ScenarioSurfaceErrorV1::Overflow)?;
        Ok(())
    }
}

fn apply_scenario_effect_v1(
    context: &mut ScenarioConditionContextV1,
    effect: &ScenarioEffectV1,
) -> Result<(), ScenarioSurfaceErrorV1> {
    match effect {
        ScenarioEffectV1::SetFlag { key, value } => {
            if key.is_empty() {
                return Err(ScenarioSurfaceErrorV1::Transition);
            }
            context.flags.insert(key.clone(), *value);
        }
        ScenarioEffectV1::AddCounter { key, amount } => {
            let current = context.counters.get(key).copied().unwrap_or(0);
            context.counters.insert(
                key.clone(),
                current
                    .checked_add(*amount)
                    .ok_or(ScenarioSurfaceErrorV1::Overflow)?,
            );
        }
        ScenarioEffectV1::SetTarget { pokemon } => context.target = *pokemon,
        ScenarioEffectV1::AddMoney { amount } => {
            context.money = context
                .money
                .checked_add(*amount)
                .ok_or(ScenarioSurfaceErrorV1::Overflow)?;
        }
        ScenarioEffectV1::RemoveMoney { amount } => {
            context.money = context
                .money
                .checked_sub(*amount)
                .ok_or(ScenarioSurfaceErrorV1::Transition)?;
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioSaveV1 {
    pub runtime: ScenarioRuntimeV1,
}

impl ScenarioSaveV1 {
    pub fn restore(
        self,
        program: &ScenarioSemanticProgramV1,
    ) -> Result<ScenarioRuntimeV1, ScenarioSurfaceErrorV1> {
        if self.runtime.scenario_key != program.scenario_key
            || !program.nodes.contains_key(&self.runtime.node)
        {
            return Err(ScenarioSurfaceErrorV1::Transition);
        }
        Ok(self.runtime)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioCoopChoiceV1 {
    pub operation_id: String,
    pub owner: SeatId,
    pub choice: String,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ScenarioCoopLedgerV1 {
    choices: BTreeMap<String, ScenarioCoopChoiceV1>,
}

impl ScenarioCoopLedgerV1 {
    pub fn expected_owner(counter: u64, host: SeatId, guest: SeatId) -> SeatId {
        if counter % 2 == 0 { host } else { guest }
    }

    pub fn admit(&mut self, choice: ScenarioCoopChoiceV1) -> Result<bool, ScenarioSurfaceErrorV1> {
        if choice.operation_id.is_empty()
            || choice.choice.is_empty()
            || choice.fingerprint.is_empty()
        {
            return Err(ScenarioSurfaceErrorV1::CoopConflict);
        }
        if let Some(existing) = self.choices.get(&choice.operation_id) {
            return if existing == &choice {
                Ok(false)
            } else {
                Err(ScenarioSurfaceErrorV1::CoopConflict)
            };
        }
        self.choices.insert(choice.operation_id.clone(), choice);
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use er_types::SafeU53;

    use super::*;

    fn program() -> ScenarioSemanticProgramV1 {
        compile_scenario_semantics_v1(
            "test".to_owned(),
            "message".to_owned(),
            BTreeMap::from([
                (
                    "message".to_owned(),
                    ScenarioSemanticNodeV1::Message {
                        message_key: "hello".to_owned(),
                        next_node: "choice".to_owned(),
                    },
                ),
                (
                    "choice".to_owned(),
                    ScenarioSemanticNodeV1::Choice {
                        prompt_key: "pick".to_owned(),
                        choices: vec![ScenarioChoiceV1 {
                            option_id: "yes".to_owned(),
                            label_key: "yes".to_owned(),
                            condition: ScenarioConditionV1::Always,
                            effects: vec![ScenarioEffectV1::SetFlag {
                                key: "picked".to_owned(),
                                value: true,
                            }],
                            next_node: "battle".to_owned(),
                        }],
                    },
                ),
                (
                    "battle".to_owned(),
                    ScenarioSemanticNodeV1::Battle {
                        battle_key: "duel".to_owned(),
                        win_node: "complete".to_owned(),
                        lose_node: "complete".to_owned(),
                    },
                ),
                (
                    "complete".to_owned(),
                    ScenarioSemanticNodeV1::Complete {
                        outcome_key: "done".to_owned(),
                    },
                ),
            ]),
        )
        .expect("program")
    }

    #[test]
    fn semantic_compiler_messages_choices_and_conditions_are_closed() {
        let program = program();
        assert_eq!(program.nodes.len(), 4);
        let choices = available_scenario_choices_v1(
            program.nodes.get("choice").expect("choice"),
            &ScenarioConditionContextV1::default(),
        );
        assert_eq!(choices.len(), 1);
        let bad = compile_scenario_semantics_v1(
            "bad".to_owned(),
            "entry".to_owned(),
            BTreeMap::from([(
                "entry".to_owned(),
                ScenarioSemanticNodeV1::Message {
                    message_key: "x".to_owned(),
                    next_node: "missing".to_owned(),
                },
            )]),
        );
        assert_eq!(bad, Err(ScenarioSurfaceErrorV1::Compile));
    }

    #[test]
    fn program_transitions_and_nested_battles_are_atomic() {
        let program = program();
        let mut runtime = ScenarioRuntimeV1::new(&program);
        runtime.advance(&program, None).expect("message");
        runtime.advance(&program, Some("yes")).expect("choice");
        assert_eq!(runtime.context.flags.get("picked"), Some(&true));
        runtime
            .start_nested_battle(&program, BattleId::new(SafeU53::new(1).expect("battle")))
            .expect("battle");
        runtime
            .settle_nested_battle(&program, true)
            .expect("settle");
        runtime.advance(&program, None).expect("complete");
        assert_eq!(runtime.complete_outcome.as_deref(), Some("done"));
    }

    #[test]
    fn scenario_save_restore_rejects_wrong_program() {
        let program = program();
        let runtime = ScenarioRuntimeV1::new(&program);
        assert_eq!(
            ScenarioSaveV1 {
                runtime: runtime.clone()
            }
            .restore(&program),
            Ok(runtime)
        );
        let mut wrong = program.clone();
        wrong.scenario_key = "other".to_owned();
        assert_eq!(
            ScenarioSaveV1 {
                runtime: ScenarioRuntimeV1::new(&program)
            }
            .restore(&wrong),
            Err(ScenarioSurfaceErrorV1::Transition)
        );
    }

    #[test]
    fn scenario_coop_ownership_is_alternating_and_idempotent() {
        let host = SeatId::new(SafeU53::new(1).expect("host"));
        let guest = SeatId::new(SafeU53::new(2).expect("guest"));
        assert_eq!(ScenarioCoopLedgerV1::expected_owner(0, host, guest), host);
        assert_eq!(ScenarioCoopLedgerV1::expected_owner(1, host, guest), guest);
        let mut ledger = ScenarioCoopLedgerV1::default();
        let choice = ScenarioCoopChoiceV1 {
            operation_id: "me/1".to_owned(),
            owner: host,
            choice: "yes".to_owned(),
            fingerprint: "hash".to_owned(),
        };
        assert_eq!(ledger.admit(choice.clone()), Ok(true));
        assert_eq!(ledger.admit(choice), Ok(false));
    }
}
