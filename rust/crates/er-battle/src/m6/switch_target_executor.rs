//! M6 battle-side executor for SwitchTarget-family routine programs.
//!
//! Pure planning layer between compiled [`MechanicsProgramV2`] programs and
//! the atomic battle transition. It evaluates the closed V2 selector
//! vocabulary over an explicit slot-topology snapshot and stages typed
//! switch-target operations; it never mutates live state and never assumes
//! fixed battler indices — every subject is a stable [`FieldSlot`] resolved
//! from the facts snapshot.
//!
//! Canonical target order: set-producing selectors emit slots sorted by
//! side (player before enemy) then position; combinator selectors preserve
//! their listed/computed order deterministically. Unrepresentable selectors
//! (stored targets, spread promotion, redirect replacement context,
//! mechanic-owner scoping) and unaudited random selections fail with typed
//! errors — never silent no-ops.

use std::collections::BTreeMap;

use thiserror::Error;

use er_mechanics::selector_operation_v2::{
    MechanicOperationV2, QueryModifierStageV2, QueryModifierV2, SelectorNodeIdV2, SelectorNodeV2,
    SelectorPredicateV2,
};
use er_mechanics::v2::MechanicQueryV2;
use er_mechanics::{HookBindingV2, MechanicsProgramV2};
use er_types::battle_ids::{BattleSide, FieldSlot, PokemonId};
use er_types::mechanics::MechanicScope;

/// Occupancy and topology facts for one field slot in canonical state.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SlotFacts {
    /// Stable occupant identity; `None` marks an unoccupied slot.
    pub occupant: Option<PokemonId>,
    pub active: bool,
    pub fainted: bool,
    pub healthy: bool,
    /// Party member currently off the field.
    pub on_bench: bool,
    /// Adjacency derived from the validated [`BattleFormat`](er_types::battle_ids::BattleFormat)
    /// topology edges relative to the acting slot.
    pub adjacent_to_actor: bool,
    /// Same side as the actor (including the actor itself).
    pub ally_of_actor: bool,
    /// Legality-query outcome snapshot: this bench member may enter battle.
    pub switch_legal: bool,
}

/// Explicit slot-topology snapshot consumed by selector evaluation.
///
/// Adjacency is precomputed per slot from the battle-format topology; no
/// singles/doubles/triples enum participates here.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SwitchTargetFacts {
    pub slots: BTreeMap<FieldSlot, SlotFacts>,
    pub actor: Option<FieldSlot>,
    pub command_target: Option<FieldSlot>,
    pub last_attacker: Option<FieldSlot>,
}

impl SwitchTargetFacts {
    fn single(&self, seed: Option<FieldSlot>) -> Vec<MechanicScope> {
        match seed {
            Some(slot) if self.slots.contains_key(&slot) => vec![MechanicScope::Field { slot }],
            _ => Vec::new(),
        }
    }

    fn side(&self, side: BattleSide) -> Vec<MechanicScope> {
        self.slots
            .iter()
            .filter(|(slot, _)| slot.side == side)
            .map(|(slot, _)| MechanicScope::Field { slot: *slot })
            .collect()
    }

    fn actor_side(&self) -> Option<BattleSide> {
        self.actor.map(|slot| slot.side)
    }
}

fn predicate_matches(
    facts: &SlotFacts,
    predicate: SelectorPredicateV2,
) -> Result<bool, SwitchTargetExecutorError> {
    Ok(match predicate {
        SelectorPredicateV2::Active => facts.active,
        SelectorPredicateV2::Fainted => facts.fainted,
        SelectorPredicateV2::Healthy => facts.healthy,
        SelectorPredicateV2::Ally => facts.ally_of_actor,
        SelectorPredicateV2::Enemy => !facts.ally_of_actor,
        SelectorPredicateV2::Adjacent => facts.adjacent_to_actor,
        SelectorPredicateV2::Bench => facts.on_bench,
        // Held-item and mechanic-instance predicates need inventory/instance
        // snapshots this executor does not consume; they fail closed instead
        // of silently matching everything.
        SelectorPredicateV2::HasHeldItem | SelectorPredicateV2::HasMechanicInstance => {
            return Err(SwitchTargetExecutorError::UnrepresentedSelector {
                label: "HELD_ITEM_OR_MECHANIC_INSTANCE_FILTER",
            });
        }
    })
}

/// Evaluates a selector tree to its canonically ordered target scopes.
pub fn evaluate_selector(
    program: &MechanicsProgramV2,
    root: SelectorNodeIdV2,
    facts: &SwitchTargetFacts,
) -> Result<Vec<MechanicScope>, SwitchTargetExecutorError> {
    let mut cache = BTreeMap::new();
    evaluate_node(program, root, facts, &mut cache, &mut Vec::new())
}

fn evaluate_node(
    program: &MechanicsProgramV2,
    id: SelectorNodeIdV2,
    facts: &SwitchTargetFacts,
    cache: &mut BTreeMap<SelectorNodeIdV2, Vec<MechanicScope>>,
    visiting: &mut Vec<SelectorNodeIdV2>,
) -> Result<Vec<MechanicScope>, SwitchTargetExecutorError> {
    if let Some(scopes) = cache.get(&id) {
        return Ok(scopes.clone());
    }
    if visiting.contains(&id) {
        return Err(SwitchTargetExecutorError::SelectorCycle);
    }
    let node = program
        .selectors
        .0
        .get(id.index())
        .ok_or(SwitchTargetExecutorError::UnknownSelectorNode(id))?;

    visiting.push(id);
    let scopes = match node {
        SelectorNodeV2::Actor | SelectorNodeV2::Source => facts.single(facts.actor),
        SelectorNodeV2::CommandTarget | SelectorNodeV2::Target => {
            facts.single(facts.command_target)
        }
        SelectorNodeV2::LastAttacker => facts.single(facts.last_attacker),
        SelectorNodeV2::ActiveBattlers => facts
            .slots
            .iter()
            .filter(|(_, slot_facts)| slot_facts.active && slot_facts.occupant.is_some())
            .map(|(slot, _)| MechanicScope::Field { slot: *slot })
            .collect(),
        SelectorNodeV2::Bench => facts
            .slots
            .iter()
            .filter(|(_, slot_facts)| slot_facts.on_bench)
            .map(|(slot, _)| MechanicScope::Field { slot: *slot })
            .collect(),
        // Slot-visible party members off the field; the fainted flag selects
        // the half of the bench the schema asks for.
        SelectorNodeV2::PartyMembers { fainted } => facts
            .slots
            .iter()
            .filter(|(_, slot_facts)| slot_facts.on_bench && slot_facts.fainted == *fainted)
            .map(|(slot, _)| MechanicScope::Field { slot: *slot })
            .collect(),
        SelectorNodeV2::AllySide => match facts.actor_side() {
            Some(side) => facts.side(side),
            None => Vec::new(),
        },
        SelectorNodeV2::EnemySide => match facts.actor_side() {
            Some(side) => facts.side(side.opposite()),
            None => Vec::new(),
        },
        SelectorNodeV2::AdjacentAllies => facts
            .slots
            .iter()
            .filter(|(_, slot_facts)| slot_facts.adjacent_to_actor && slot_facts.ally_of_actor)
            .map(|(slot, _)| MechanicScope::Field { slot: *slot })
            .collect(),
        SelectorNodeV2::AdjacentEnemies => facts
            .slots
            .iter()
            .filter(|(_, slot_facts)| slot_facts.adjacent_to_actor && !slot_facts.ally_of_actor)
            .map(|(slot, _)| MechanicScope::Field { slot: *slot })
            .collect(),
        SelectorNodeV2::Filter { input, predicate } => {
            let input_scopes = evaluate_node(program, *input, facts, cache, visiting)?;
            filter_scopes(facts, &input_scopes, *predicate)?
        }
        SelectorNodeV2::Union { inputs } => {
            let mut scopes = Vec::new();
            for input in inputs {
                scopes.extend(evaluate_node(program, *input, facts, cache, visiting)?);
            }
            scopes
        }
        SelectorNodeV2::Intersect { left, right } => {
            let left_scopes = evaluate_node(program, *left, facts, cache, visiting)?;
            let right_scopes = evaluate_node(program, *right, facts, cache, visiting)?;
            left_scopes
                .into_iter()
                .filter(|scope| right_scopes.contains(scope))
                .collect()
        }
        SelectorNodeV2::Distinct { input } => {
            stable_distinct(evaluate_node(program, *input, facts, cache, visiting)?)
        }
        SelectorNodeV2::SortCanonical { input } => {
            let mut scopes = evaluate_node(program, *input, facts, cache, visiting)?;
            sort_canonical(&mut scopes);
            scopes
        }
        SelectorNodeV2::First { input } => evaluate_node(program, *input, facts, cache, visiting)?
            .into_iter()
            .take(1)
            .collect(),
        SelectorNodeV2::Last { input } => evaluate_node(program, *input, facts, cache, visiting)?
            .into_iter()
            .last()
            .into_iter()
            .collect(),
        SelectorNodeV2::Ordinal { input, ordinal } => {
            let index = usize::from(*ordinal);
            evaluate_node(program, *input, facts, cache, visiting)?
                .into_iter()
                .nth(index)
                .into_iter()
                .collect()
        }
        SelectorNodeV2::All { input } => evaluate_node(program, *input, facts, cache, visiting)?,
        // The remaining closed nodes need runtime context (stored target
        // sets, mechanic instances, scheduled-event participants, authored
        // promotion decisions, redirect-replacement registers) or an audited
        // random range that the frozen catalog does not provide yet.
        SelectorNodeV2::MechanicOwner
        | SelectorNodeV2::MechanicTarget
        | SelectorNodeV2::StoredTargets
        | SelectorNodeV2::ScheduledEventOwner
        | SelectorNodeV2::ScheduledEventTarget
        | SelectorNodeV2::PromoteTarget { .. }
        | SelectorNodeV2::RedirectReplacement { .. } => {
            return Err(SwitchTargetExecutorError::UnrepresentedSelector {
                label: "STORED_INSTANCE_OR_PROMOTION_CONTEXT",
            });
        }
        SelectorNodeV2::RandomOne { .. } => {
            return Err(SwitchTargetExecutorError::RandomSelectionUnaudited);
        }
    };
    visiting.pop();
    cache.insert(id, scopes.clone());
    Ok(scopes)
}

fn filter_scopes(
    facts: &SwitchTargetFacts,
    scopes: &[MechanicScope],
    predicate: SelectorPredicateV2,
) -> Result<Vec<MechanicScope>, SwitchTargetExecutorError> {
    let mut filtered = Vec::new();
    for scope in scopes {
        let MechanicScope::Field { slot } = scope else {
            continue;
        };
        let Some(slot_facts) = facts.slots.get(slot) else {
            continue;
        };
        if predicate_matches(slot_facts, predicate)? {
            filtered.push(*scope);
        }
    }
    Ok(filtered)
}

fn scope_slot(scope: &MechanicScope) -> Option<FieldSlot> {
    match scope {
        MechanicScope::Field { slot } => Some(*slot),
        _ => None,
    }
}

/// Stable distinct preserving first-occurrence order.
fn stable_distinct(scopes: Vec<MechanicScope>) -> Vec<MechanicScope> {
    let mut seen = BTreeMap::new();
    let mut distinct = Vec::with_capacity(scopes.len());
    for scope in scopes {
        if seen.insert(scope_slot(&scope), ()).is_none() {
            distinct.push(scope);
        }
    }
    distinct
}

/// Canonical order: player slots before enemy slots, position ascending.
fn sort_canonical(scopes: &mut [MechanicScope]) {
    scopes.sort_by_key(scope_slot);
}

/// Staged, typed switch/target mutation ready for the atomic transition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StagedSwitchTargetOperation {
    PivotRequest {
        owner: MechanicScope,
    },
    SwitchRequest {
        subject: MechanicScope,
    },
    ForcedSwitchRequest {
        subject: MechanicScope,
    },
    TrapApply {
        subjects: Vec<MechanicScope>,
    },
    RedirectTarget {
        replacement: MechanicScope,
    },
    LegalityQuery {
        query: MechanicQueryV2,
        stage: QueryModifierStageV2,
        modifier: QueryModifierV2,
    },
}

/// Plans one hook binding's operations against the topology snapshot.
pub fn plan_binding(
    program: &MechanicsProgramV2,
    binding_index: usize,
    facts: &SwitchTargetFacts,
) -> Result<Vec<StagedSwitchTargetOperation>, SwitchTargetExecutorError> {
    let binding =
        program
            .bindings
            .get(binding_index)
            .ok_or(SwitchTargetExecutorError::MissingBinding {
                index: binding_index,
            })?;
    let start = usize::from(binding.operations.start);
    let end = binding
        .operations
        .end()
        .ok_or(SwitchTargetExecutorError::OperationRangeOverflow)?;
    let range = program
        .operations
        .get(start..end)
        .ok_or(SwitchTargetExecutorError::OperationRangeOutOfBounds)?;

    let mut staged = Vec::with_capacity(range.len());
    for operation in range {
        staged.push(stage_operation(program, binding, operation, facts)?);
    }
    Ok(staged)
}

fn stage_operation(
    program: &MechanicsProgramV2,
    binding: &HookBindingV2,
    operation: &MechanicOperationV2,
    facts: &SwitchTargetFacts,
) -> Result<StagedSwitchTargetOperation, SwitchTargetExecutorError> {
    let resolve_single =
        |facts: &SwitchTargetFacts| -> Result<MechanicScope, SwitchTargetExecutorError> {
            let root = binding
                .selector_root
                .ok_or(SwitchTargetExecutorError::MissingSelectorRoot)?;
            let scopes = evaluate_selector(program, root, facts)?;
            if scopes.len() != 1 {
                return Err(SwitchTargetExecutorError::SelectionNotSingle);
            }
            Ok(scopes[0])
        };

    match operation {
        MechanicOperationV2::PivotRequest => Ok(StagedSwitchTargetOperation::PivotRequest {
            owner: resolve_single(facts)?,
        }),
        MechanicOperationV2::SwitchRequest => Ok(StagedSwitchTargetOperation::SwitchRequest {
            subject: resolve_single(facts)?,
        }),
        MechanicOperationV2::ForcedSwitchRequest => {
            Ok(StagedSwitchTargetOperation::ForcedSwitchRequest {
                subject: resolve_single(facts)?,
            })
        }
        MechanicOperationV2::TrapApply => {
            let root = binding
                .selector_root
                .ok_or(SwitchTargetExecutorError::MissingSelectorRoot)?;
            let subjects = evaluate_selector(program, root, facts)?;
            if subjects.is_empty() {
                return Err(SwitchTargetExecutorError::SelectionEmpty);
            }
            Ok(StagedSwitchTargetOperation::TrapApply { subjects })
        }
        MechanicOperationV2::RedirectTarget => Ok(StagedSwitchTargetOperation::RedirectTarget {
            replacement: resolve_single(facts)?,
        }),
        MechanicOperationV2::Query {
            query,
            stage,
            modifier,
        } => match query {
            MechanicQueryV2::MoveTargetShape | MechanicQueryV2::SwitchEligibility => {
                Ok(StagedSwitchTargetOperation::LegalityQuery {
                    query: *query,
                    stage: *stage,
                    modifier: modifier.clone(),
                })
            }
            other => Err(SwitchTargetExecutorError::UnsupportedQuery(*other)),
        },
        _ => Err(SwitchTargetExecutorError::UnsupportedOperation),
    }
}

/// Bench replacements that passed the legality query, in canonical order.
pub fn legal_switch_replacements(facts: &SwitchTargetFacts) -> Vec<MechanicScope> {
    facts
        .slots
        .iter()
        .filter(|(_, slot_facts)| {
            slot_facts.on_bench && slot_facts.switch_legal && !slot_facts.fainted
        })
        .map(|(slot, _)| MechanicScope::Field { slot: *slot })
        .collect()
}

/// Revalidates one candidate replacement immediately before admission.
pub fn switch_replacement_is_legal(facts: &SwitchTargetFacts, slot: FieldSlot) -> bool {
    facts.slots.get(&slot).is_some_and(|slot_facts| {
        slot_facts.on_bench
            && slot_facts.switch_legal
            && !slot_facts.fainted
            && slot_facts.occupant.is_some()
    })
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SwitchTargetExecutorError {
    #[error("binding {index} is out of range")]
    MissingBinding { index: usize },
    #[error("binding operation range overflows")]
    OperationRangeOverflow,
    #[error("binding operation range is out of bounds")]
    OperationRangeOutOfBounds,
    #[error("selector node {0:?} is out of bounds")]
    UnknownSelectorNode(SelectorNodeIdV2),
    #[error("selector arena contains a cycle")]
    SelectorCycle,
    #[error("selector {label} needs stored instance context this executor does not carry")]
    UnrepresentedSelector { label: &'static str },
    #[error("random selection stays bespoke until its RNG range is audited")]
    RandomSelectionUnaudited,
    #[error("operation requires a selector root")]
    MissingSelectorRoot,
    #[error("selection must resolve to exactly one subject")]
    SelectionNotSingle,
    #[error("selection must resolve to at least one subject")]
    SelectionEmpty,
    #[error("operation is outside the switch-target closed vocabulary")]
    UnsupportedOperation,
    #[error("query {0:?} is outside the switch-target closed vocabulary")]
    UnsupportedQuery(MechanicQueryV2),
}
