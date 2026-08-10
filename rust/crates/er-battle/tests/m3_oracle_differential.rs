//! M3 oracle envelope checks and honest scalar differentials.
//!
//! The frozen exporter contains both canonical state and legacy presentation
//! identities.  This suite checks the complete published envelope, then
//! compares only pure er-battle seams whose inputs and expected values can be
//! reconstructed from canonical fields.  It intentionally does not claim
//! full mechanics parity from structure-only checks.

use std::collections::BTreeSet;
use std::error::Error;
use std::fmt::{Display, Formatter};

use er_battle::stat_stage::{apply_stage_delta, stage_for_stat, stage_mutation};
use er_battle::status::{
    StatusApplicationOutcome, StatusRejection, StatusResidualInput, StatusResidualOutcome,
    apply_status, resolve_residual,
};
use er_battle::type_effectiveness::{EffectivenessMultiplier, resolve_type_effectiveness};
use er_content::moves::lookup_move;
use er_content::pack::selected_type_chart;
use er_types::battle_ids::MoveId;
use er_types::battle_model::{
    MoveEffectDefinition, MoveFlag, PokemonTyping, StatStages, StatusKind, StatusState,
};
use serde_json::{Value, json};

const ORACLE_MANIFEST: &str = include_str!("../../../fixtures/m3/m3-oracle-manifest.json");

const FROZEN_CASES: &[(&str, &str)] = &[
    (
        "physical-hit",
        include_str!("../../../fixtures/m3/oracle/battle-cases/physical-hit.json"),
    ),
    (
        "critical-hit",
        include_str!("../../../fixtures/m3/oracle/battle-cases/critical-hit.json"),
    ),
    (
        "special-hit-priority",
        include_str!("../../../fixtures/m3/oracle/battle-cases/special-hit-priority.json"),
    ),
    (
        "always-hit",
        include_str!("../../../fixtures/m3/oracle/battle-cases/always-hit.json"),
    ),
    (
        "miss",
        include_str!("../../../fixtures/m3/oracle/battle-cases/miss.json"),
    ),
    (
        "poison-type-immunity",
        include_str!("../../../fixtures/m3/oracle/battle-cases/poison-type-immunity.json"),
    ),
    (
        "grass-powder-immunity",
        include_str!("../../../fixtures/m3/oracle/battle-cases/grass-powder-immunity.json"),
    ),
    (
        "existing-status-rejected",
        include_str!("../../../fixtures/m3/oracle/battle-cases/existing-status-rejected.json"),
    ),
    (
        "speed-tie",
        include_str!("../../../fixtures/m3/oracle/battle-cases/speed-tie.json"),
    ),
    (
        "pp-consumption",
        include_str!("../../../fixtures/m3/oracle/battle-cases/pp-consumption.json"),
    ),
    (
        "pp-unusable-rejected",
        include_str!("../../../fixtures/m3/oracle/battle-cases/pp-unusable-rejected.json"),
    ),
    (
        "poison-application",
        include_str!("../../../fixtures/m3/oracle/battle-cases/poison-application.json"),
    ),
    (
        "poison-residual",
        include_str!("../../../fixtures/m3/oracle/battle-cases/poison-residual.json"),
    ),
    (
        "paralysis-application",
        include_str!("../../../fixtures/m3/oracle/battle-cases/paralysis-application.json"),
    ),
    (
        "paralysis-full-stop",
        include_str!("../../../fixtures/m3/oracle/battle-cases/paralysis-full-stop.json"),
    ),
    (
        "paralysis-speed-order",
        include_str!("../../../fixtures/m3/oracle/battle-cases/paralysis-speed-order.json"),
    ),
    (
        "burn-application",
        include_str!("../../../fixtures/m3/oracle/battle-cases/burn-application.json"),
    ),
    (
        "burn-residual",
        include_str!("../../../fixtures/m3/oracle/battle-cases/burn-residual.json"),
    ),
    (
        "burn-physical-penalty",
        include_str!("../../../fixtures/m3/oracle/battle-cases/burn-physical-penalty.json"),
    ),
    (
        "spread-stage-down",
        include_str!("../../../fixtures/m3/oracle/battle-cases/spread-stage-down.json"),
    ),
    (
        "stage-floor-cap",
        include_str!("../../../fixtures/m3/oracle/battle-cases/stage-floor-cap.json"),
    ),
    (
        "none-ability-no-trigger",
        include_str!("../../../fixtures/m3/oracle/battle-cases/none-ability-no-trigger.json"),
    ),
    (
        "intimidate-switch-in",
        include_str!("../../../fixtures/m3/oracle/battle-cases/intimidate-switch-in.json"),
    ),
    (
        "intimidate-stage-floor",
        include_str!("../../../fixtures/m3/oracle/battle-cases/intimidate-stage-floor.json"),
    ),
    (
        "wonder-guard-block",
        include_str!("../../../fixtures/m3/oracle/battle-cases/wonder-guard-block.json"),
    ),
    (
        "wonder-guard-super-effective-pass",
        include_str!(
            "../../../fixtures/m3/oracle/battle-cases/wonder-guard-super-effective-pass.json"
        ),
    ),
    (
        "wonder-guard-status-pass",
        include_str!("../../../fixtures/m3/oracle/battle-cases/wonder-guard-status-pass.json"),
    ),
    (
        "type-weakness",
        include_str!("../../../fixtures/m3/oracle/battle-cases/type-weakness.json"),
    ),
    (
        "type-resistance",
        include_str!("../../../fixtures/m3/oracle/battle-cases/type-resistance.json"),
    ),
    (
        "type-native-immunity",
        include_str!("../../../fixtures/m3/oracle/battle-cases/type-native-immunity.json"),
    ),
    (
        "voluntary-switch",
        include_str!("../../../fixtures/m3/oracle/battle-cases/voluntary-switch.json"),
    ),
    (
        "doubles-single-target",
        include_str!("../../../fixtures/m3/oracle/battle-cases/doubles-single-target.json"),
    ),
    (
        "same-side-simultaneous-faint",
        include_str!("../../../fixtures/m3/oracle/battle-cases/same-side-simultaneous-faint.json"),
    ),
    (
        "mixed-side-simultaneous-faint",
        include_str!("../../../fixtures/m3/oracle/battle-cases/mixed-side-simultaneous-faint.json"),
    ),
    (
        "forced-replacement",
        include_str!("../../../fixtures/m3/oracle/battle-cases/forced-replacement.json"),
    ),
    (
        "no-legal-replacement",
        include_str!("../../../fixtures/m3/oracle/battle-cases/no-legal-replacement.json"),
    ),
    (
        "victory",
        include_str!("../../../fixtures/m3/oracle/battle-cases/victory.json"),
    ),
    (
        "defeat",
        include_str!("../../../fixtures/m3/oracle/battle-cases/defeat.json"),
    ),
];

const REQUIRED_AXES: &[(&str, &[&str])] = &[
    ("INITIAL_STATE_AND_RNG", &["initial_state", "initial_rng"]),
    ("ADMITTED_COMMANDS", &["commands"]),
    ("CONSUMING_RNG_DRAWS", &["expected_rng_draws", "final_rng"]),
    ("DYNAMIC_ACTION_ORDER", &["expected_action_order"]),
    ("CAUSAL_MUTATIONS", &["expected_mutations"]),
    ("PRESENTATION_PLAN", &["expected_presentation"]),
    (
        "FINAL_STATE_AND_RNG",
        &["expected_final_state", "final_rng"],
    ),
    ("NEXT_LOGICAL_CONTROL", &["expected_next_control"]),
];

const REPRESENTATIVE_CASES: &[&str] = &[
    "poison-type-immunity",
    "grass-powder-immunity",
    "existing-status-rejected",
    "poison-application",
    "paralysis-application",
    "burn-application",
    "burn-residual",
    "stage-floor-cap",
    "type-weakness",
    "type-resistance",
    "type-native-immunity",
];

const REPRESENTATIVE_DIMENSIONS: &[&str] = &[
    "TYPE_EFFECTIVENESS_SCALAR",
    "STATUS_ADMISSION_SCALAR",
    "STATUS_RESIDUAL_SCALAR",
    "STAGE_MUTATION_SCALAR",
];

#[derive(Clone, Copy, Debug)]
struct QuarantineEntry {
    name: &'static str,
    reason: &'static str,
}

// These cases are intentionally not presented as pure-API parity.  Their
// frozen records require legacy actor IDs, scheduler state, presentation
// handlers, or multi-actor transition material that this crate cannot
// reconstruct without guessing.
const QUARANTINED_CASES: &[QuarantineEntry] = &[
    QuarantineEntry {
        name: "physical-hit",
        reason: "full damage and mutation identity includes legacy actor IDs",
    },
    QuarantineEntry {
        name: "critical-hit",
        reason: "critical and variance draw ordering needs the exported runtime trace",
    },
    QuarantineEntry {
        name: "special-hit-priority",
        reason: "priority action and damage presentation are not one pure scalar seam",
    },
    QuarantineEntry {
        name: "always-hit",
        reason: "accuracy omission and complete RNG parity require the legacy trace",
    },
    QuarantineEntry {
        name: "miss",
        reason: "miss presentation and skipped-effect identity use legacy actor paths",
    },
    QuarantineEntry {
        name: "speed-tie",
        reason: "seed-offset shuffle identity is not reconstructible from canonical IDs alone",
    },
    QuarantineEntry {
        name: "pp-consumption",
        reason: "complete PP transition includes exporter-specific operation paths",
    },
    QuarantineEntry {
        name: "pp-unusable-rejected",
        reason: "menu rejection and no-draw control state belong outside er-battle",
    },
    QuarantineEntry {
        name: "poison-residual",
        reason: "the frozen case does not expose a canonical residual status input",
    },
    QuarantineEntry {
        name: "paralysis-full-stop",
        reason: "activation draw, PP order, and scheduler cancellation are coupled",
    },
    QuarantineEntry {
        name: "paralysis-speed-order",
        reason: "live speed reordering requires the complete action scheduler trace",
    },
    QuarantineEntry {
        name: "burn-physical-penalty",
        reason: "the exported case combines damage order with status and legacy IDs",
    },
    QuarantineEntry {
        name: "spread-stage-down",
        reason: "multi-target mutation identity cannot be mapped without legacy actor guessing",
    },
    QuarantineEntry {
        name: "none-ability-no-trigger",
        reason: "complete ability event absence is a turn-level claim, not a scalar lookup",
    },
    QuarantineEntry {
        name: "intimidate-switch-in",
        reason: "switch-in trigger order and adjacent actor identity are not scalar inputs",
    },
    QuarantineEntry {
        name: "intimidate-stage-floor",
        reason: "ability trigger plus stage-floor transition needs cross-actor mapping",
    },
    QuarantineEntry {
        name: "wonder-guard-block",
        reason: "ability gating before accuracy is not represented by one pure comparison",
    },
    QuarantineEntry {
        name: "wonder-guard-super-effective-pass",
        reason: "ability pass-through and damage trace require unsupported surrounding context",
    },
    QuarantineEntry {
        name: "wonder-guard-status-pass",
        reason: "status-category ability pass-through has no complete typed turn input here",
    },
    QuarantineEntry {
        name: "voluntary-switch",
        reason: "switch command legality and presentation use control-layer material",
    },
    QuarantineEntry {
        name: "doubles-single-target",
        reason: "target filtering and legacy actor IDs span the topology scheduler",
    },
    QuarantineEntry {
        name: "same-side-simultaneous-faint",
        reason: "ordered faint queue identity cannot be inferred from legacy paths honestly",
    },
    QuarantineEntry {
        name: "mixed-side-simultaneous-faint",
        reason: "mixed-side outcome and phase order require the full transition material",
    },
    QuarantineEntry {
        name: "forced-replacement",
        reason: "replacement operation grammar and actor identity belong to control seams",
    },
    QuarantineEntry {
        name: "no-legal-replacement",
        reason: "empty-slot preservation and chain advancement are not pure scalar outputs",
    },
    QuarantineEntry {
        name: "victory",
        reason: "terminal control and message presentation are outside er-battle pure seams",
    },
    QuarantineEntry {
        name: "defeat",
        reason: "terminal control and message presentation are outside er-battle pure seams",
    },
];

// Whole-axis parity remains quarantined even for the representative cases.
// In particular, PRESENTATION_PLAN and NEXT_LOGICAL_CONTROL are never tested
// through presentation/control wiring here; the scalar tests below do not
// imply full parity.
const QUARANTINED_DIMENSIONS: &[QuarantineEntry] = &[
    QuarantineEntry {
        name: "INITIAL_STATE_AND_RNG",
        reason: "canonical state is accompanied by legacy identity data and runtime-specific RNG",
    },
    QuarantineEntry {
        name: "ADMITTED_COMMANDS",
        reason: "scripted enemy and control sources cannot be reconstructed by er-battle alone",
    },
    QuarantineEntry {
        name: "CONSUMING_RNG_DRAWS",
        reason: "legacy callsites and all stream transitions are not a pure scalar API contract",
    },
    QuarantineEntry {
        name: "DYNAMIC_ACTION_ORDER",
        reason: "scheduler order contains actor identity and cross-action context",
    },
    QuarantineEntry {
        name: "CAUSAL_MUTATIONS",
        reason: "mutation paths, causes, phases, and legacy IDs exceed pure seam inputs",
    },
    QuarantineEntry {
        name: "PRESENTATION_PLAN",
        reason: "presentation events use legacy actor/slot values and UI text handlers",
    },
    QuarantineEntry {
        name: "FINAL_STATE_AND_RNG",
        reason: "whole-turn final-state parity is broader than the reconstructed scalar checks",
    },
    QuarantineEntry {
        name: "NEXT_LOGICAL_CONTROL",
        reason: "phase handlers and UI modes are owned outside er-battle",
    },
];

const TYPE_CASE_EXPECTATIONS: &[(&str, EffectivenessMultiplier)] = &[
    ("type-weakness", EffectivenessMultiplier::Two),
    ("type-resistance", EffectivenessMultiplier::Half),
    ("type-native-immunity", EffectivenessMultiplier::Zero),
];

const STATUS_CASE_EXPECTATIONS: &[(&str, &str)] = &[
    ("poison-type-immunity", "REJECTED_TYPE_IMMUNITY"),
    ("grass-powder-immunity", "REJECTED_POWDER_IMMUNITY"),
    ("existing-status-rejected", "REJECTED_EXISTING_MAJOR_STATUS"),
    ("poison-application", "APPLIED"),
    ("paralysis-application", "APPLIED"),
    ("burn-application", "APPLIED"),
];

#[derive(Debug)]
struct FixtureError {
    message: String,
}

impl FixtureError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for FixtureError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for FixtureError {}

fn parse_document(source_name: &str, source: &str) -> Result<Value, FixtureError> {
    serde_json::from_str(source)
        .map_err(|error| FixtureError::new(format!("{source_name}: invalid JSON: {error}")))
}

fn required<'a>(
    value: &'a Value,
    case_name: &str,
    path: &str,
    field_name: &str,
) -> Result<&'a Value, FixtureError> {
    value.get(field_name).ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: missing required field {path}.{field_name}"
        ))
    })
}

fn object_field<'a>(
    value: &'a Value,
    case_name: &str,
    path: &str,
    field_name: &str,
) -> Result<&'a Value, FixtureError> {
    let field = required(value, case_name, path, field_name)?;
    if field.is_object() {
        Ok(field)
    } else {
        Err(FixtureError::new(format!(
            "{case_name}: {path}.{field_name} is not an object"
        )))
    }
}

fn array_field<'a>(
    value: &'a Value,
    case_name: &str,
    path: &str,
    field_name: &str,
) -> Result<&'a Vec<Value>, FixtureError> {
    required(value, case_name, path, field_name)?
        .as_array()
        .ok_or_else(|| {
            FixtureError::new(format!("{case_name}: {path}.{field_name} is not an array"))
        })
}

fn string_field(
    value: &Value,
    case_name: &str,
    path: &str,
    field_name: &str,
) -> Result<String, FixtureError> {
    required(value, case_name, path, field_name)?
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| {
            FixtureError::new(format!("{case_name}: {path}.{field_name} is not a string"))
        })
}

fn u64_field(
    value: &Value,
    case_name: &str,
    path: &str,
    field_name: &str,
) -> Result<u64, FixtureError> {
    required(value, case_name, path, field_name)?
        .as_u64()
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: {path}.{field_name} is not a non-negative integer"
            ))
        })
}

fn case_source(case_name: &str) -> Result<&'static str, FixtureError> {
    FROZEN_CASES
        .iter()
        .find(|(name, _)| *name == case_name)
        .map(|(_, source)| *source)
        .ok_or_else(|| FixtureError::new(format!("unknown frozen case {case_name}")))
}

fn parse_case(case_name: &str) -> Result<Value, FixtureError> {
    parse_document(case_name, case_source(case_name)?)
}

fn expected_case_set(values: &[&'static str]) -> BTreeSet<&'static str> {
    values.iter().copied().collect()
}

fn first_divergence(expected: &Value, actual: &Value) -> Option<String> {
    first_divergence_at("$", expected, actual)
}

fn first_divergence_at(path: &str, expected: &Value, actual: &Value) -> Option<String> {
    if expected == actual {
        return None;
    }

    match (expected, actual) {
        (Value::Object(expected_object), Value::Object(actual_object)) => {
            let mut keys = BTreeSet::new();
            keys.extend(expected_object.keys().cloned());
            keys.extend(actual_object.keys().cloned());
            for key in keys {
                let child_path = format!("{path}.{key}");
                match (expected_object.get(&key), actual_object.get(&key)) {
                    (Some(expected_value), Some(actual_value)) => {
                        if let Some(divergence) =
                            first_divergence_at(&child_path, expected_value, actual_value)
                        {
                            return Some(divergence);
                        }
                    }
                    (Some(expected_value), None) => {
                        return Some(format!(
                            "at {child_path}: expected {}, actual <missing>",
                            expected_value
                        ));
                    }
                    (None, Some(actual_value)) => {
                        return Some(format!(
                            "at {child_path}: expected <missing>, actual {actual_value}"
                        ));
                    }
                    (None, None) => {}
                }
            }
            None
        }
        (Value::Array(expected_array), Value::Array(actual_array)) => {
            let shared_len = expected_array.len().min(actual_array.len());
            for index in 0..shared_len {
                let child_path = format!("{path}[{index}]");
                if let Some(divergence) =
                    first_divergence_at(&child_path, &expected_array[index], &actual_array[index])
                {
                    return Some(divergence);
                }
            }
            if expected_array.len() != actual_array.len() {
                return Some(format!(
                    "at {path}: expected array length {}, actual {}",
                    expected_array.len(),
                    actual_array.len()
                ));
            }
            None
        }
        _ => Some(format!("at {path}: expected {expected}, actual {actual}")),
    }
}

fn assert_no_divergence(context: &str, expected: &Value, actual: &Value) {
    let diagnostic = first_divergence(expected, actual);
    assert!(diagnostic.is_none(), "{context}: {diagnostic:?}");
}

fn assert_sequence(
    case_name: &str,
    axis_name: &str,
    values: &[Value],
    nested_event_id: bool,
) -> Result<(), FixtureError> {
    for (index, value) in values.iter().enumerate() {
        let sequence = if nested_event_id {
            let event_id = object_field(value, case_name, axis_name, "event_id")?;
            u64_field(event_id, case_name, "event_id", "sequence")?
        } else {
            u64_field(value, case_name, axis_name, "sequence")?
        };
        let expected = u64::try_from(index).map_err(|error| {
            FixtureError::new(format!(
                "{case_name}: {axis_name} index conversion failed: {error}"
            ))
        })?;
        if sequence != expected {
            return Err(FixtureError::new(format!(
                "{case_name}: {axis_name} sequence is {sequence} at index {index}, expected {expected}"
            )));
        }
    }
    Ok(())
}

fn assert_axis_shape(case_name: &str, document: &Value) -> Result<(), FixtureError> {
    for &(axis_name, fields) in REQUIRED_AXES {
        for &field_name in fields {
            let field = required(document, case_name, "$", field_name)?;
            if field.is_null() {
                return Err(FixtureError::new(format!(
                    "{case_name}: axis {axis_name} field {field_name} is null"
                )));
            }
            let object_expected = matches!(
                field_name,
                "initial_state"
                    | "initial_rng"
                    | "commands"
                    | "final_rng"
                    | "expected_final_state"
                    | "expected_next_control"
            );
            let shape_is_valid = if object_expected {
                field.is_object()
            } else {
                field.is_array()
            };
            if !shape_is_valid {
                return Err(FixtureError::new(format!(
                    "{case_name}: axis {axis_name} field {field_name} has the wrong JSON shape"
                )));
            }
        }
    }
    Ok(())
}

fn assert_causal_sequences(case_name: &str, document: &Value) -> Result<(), FixtureError> {
    let mutations = array_field(document, case_name, "$", "expected_mutations")?;
    assert_sequence(case_name, "expected_mutations", mutations, false)?;

    let rng_draws = array_field(document, case_name, "$", "expected_rng_draws")?;
    assert_sequence(case_name, "expected_rng_draws", rng_draws, false)?;

    let action_order = array_field(document, case_name, "$", "expected_action_order")?;
    assert_sequence(case_name, "expected_action_order", action_order, false)?;

    let presentation = array_field(document, case_name, "$", "expected_presentation")?;
    assert_sequence(case_name, "expected_presentation", presentation, true)?;

    let commands = object_field(document, case_name, "$", "commands")?;
    if let Some(intent_values) = commands.get("semantic_intent") {
        let intent_values = intent_values.as_array().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: commands.semantic_intent is not an array"
            ))
        })?;
        assert_sequence(case_name, "semantic_intent", intent_values, false)?;
    }

    let initial_rng = object_field(document, case_name, "$", "initial_rng")?;
    let initial_sequence = u64_field(initial_rng, case_name, "initial_rng", "next_sequence")?;
    if initial_sequence != 0 {
        return Err(FixtureError::new(format!(
            "{case_name}: initial RNG next_sequence is {initial_sequence}, expected zero"
        )));
    }
    let final_rng = object_field(document, case_name, "$", "final_rng")?;
    let final_sequence = u64_field(final_rng, case_name, "final_rng", "next_sequence")?;
    let expected_draw_count = u64::try_from(rng_draws.len()).map_err(|error| {
        FixtureError::new(format!(
            "{case_name}: RNG draw count conversion failed: {error}"
        ))
    })?;
    if final_sequence != expected_draw_count {
        return Err(FixtureError::new(format!(
            "{case_name}: final RNG next_sequence is {final_sequence}, expected {expected_draw_count}"
        )));
    }
    Ok(())
}

fn canonical_party_member<'a>(
    document: &'a Value,
    case_name: &str,
    final_state: bool,
) -> Result<&'a Value, FixtureError> {
    let state_name = if final_state {
        "expected_final_state"
    } else {
        "initial_state"
    };
    let state = object_field(document, case_name, "$", state_name)?;
    let canonical = object_field(state, case_name, state_name, "canonical")?;
    let battle = object_field(canonical, case_name, "canonical", "battle")?;
    let party = array_field(battle, case_name, "canonical.battle", "enemy_party")?;
    party
        .first()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: canonical enemy_party is empty")))
}

fn semantic_move_id(document: &Value, case_name: &str) -> Result<MoveId, Box<dyn Error>> {
    let commands = document
        .get("commands")
        .and_then(Value::as_object)
        .ok_or_else(|| FixtureError::new(format!("{case_name}: commands is not an object")))?;
    let intents = commands
        .get("semantic_intent")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            FixtureError::new(format!("{case_name}: semantic_intent is not an array"))
        })?;
    let first_intent = intents
        .first()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: semantic_intent is empty")))?;
    let action = first_intent
        .get("action")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            FixtureError::new(format!("{case_name}: semantic action is not an object"))
        })?;
    let value = action
        .get("move_id")
        .and_then(Value::as_u64)
        .ok_or_else(|| FixtureError::new(format!("{case_name}: semantic move_id is invalid")))?;
    Ok(MoveId::try_from_u64(value)?)
}

fn type_differential(
    case_name: &str,
    expected_multiplier: EffectivenessMultiplier,
) -> Result<(), Box<dyn Error>> {
    let document = parse_case(case_name)?;
    let move_id = semantic_move_id(&document, case_name)?;
    let move_definition = lookup_move(move_id)?;
    let target = canonical_party_member(&document, case_name, false)?;
    let types_value = target
        .get("types")
        .cloned()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: target types are missing")))?;
    let target_types: PokemonTyping = serde_json::from_value(types_value)?;
    let actual = resolve_type_effectiveness(
        &selected_type_chart(),
        move_definition.move_type,
        &target_types,
    )?;
    let expected = json!({ "multiplier": expected_multiplier });
    let actual = json!({ "multiplier": actual.multiplier });
    assert_no_divergence(case_name, &expected, &actual);
    Ok(())
}

fn status_kind_from_move(move_id: MoveId) -> Result<StatusKind, FixtureError> {
    let move_definition = lookup_move(move_id)
        .map_err(|error| FixtureError::new(format!("move lookup failed: {error}")))?;
    move_definition
        .effects
        .iter()
        .find_map(|effect| match effect {
            MoveEffectDefinition::ApplyStatus(status) => Some(*status),
            MoveEffectDefinition::Damage | MoveEffectDefinition::ChangeStatStage { .. } => None,
        })
        .ok_or_else(|| FixtureError::new(format!("move {move_id:?} has no status effect")))
}

fn status_outcome_label(outcome: &StatusApplicationOutcome) -> &'static str {
    match outcome {
        StatusApplicationOutcome::Applied { .. } => "APPLIED",
        StatusApplicationOutcome::Rejected { reason } => match reason {
            StatusRejection::ExistingMajorStatus { .. } => "REJECTED_EXISTING_MAJOR_STATUS",
            StatusRejection::TypeImmunity { .. } => "REJECTED_TYPE_IMMUNITY",
            StatusRejection::PowderImmunity { .. } => "REJECTED_POWDER_IMMUNITY",
        },
        StatusApplicationOutcome::ChanceFailed { .. } => "CHANCE_FAILED",
    }
}

fn status_state_from_oracle(
    mut value: Value,
    case_name: &str,
    state_name: &str,
) -> Result<StatusState, Box<dyn Error>> {
    let kind = value
        .get("kind")
        .and_then(|value| value.get("kind"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: {state_name} status kind is not the frozen nested tag"
            ))
        })?
        .to_owned();
    value
        .as_object_mut()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: {state_name} status is invalid")))?
        .insert("kind".to_owned(), Value::String(kind));
    Ok(serde_json::from_value(value)?)
}

fn status_differential(case_name: &str, expected_label: &str) -> Result<(), Box<dyn Error>> {
    let document = parse_case(case_name)?;
    let move_id = semantic_move_id(&document, case_name)?;
    let move_definition = lookup_move(move_id)?;
    let requested = status_kind_from_move(move_id)?;
    let initial_target = canonical_party_member(&document, case_name, false)?;
    let final_target = canonical_party_member(&document, case_name, true)?;
    let initial_status = status_state_from_oracle(
        initial_target.get("status").cloned().ok_or_else(|| {
            FixtureError::new(format!("{case_name}: initial status is missing"))
        })?,
        case_name,
        "initial",
    )?;
    let final_status = status_state_from_oracle(
        final_target
            .get("status")
            .cloned()
            .ok_or_else(|| FixtureError::new(format!("{case_name}: final status is missing")))?,
        case_name,
        "final",
    )?;
    let target_types: PokemonTyping = serde_json::from_value(
        initial_target
            .get("types")
            .cloned()
            .ok_or_else(|| FixtureError::new(format!("{case_name}: target types are missing")))?,
    )?;
    let input = er_battle::status::StatusApplicationInput {
        requested,
        current: initial_status,
        target_types,
        powder: move_definition.flags.contains(&MoveFlag::Powder),
        bypass: er_battle::status::StatusBypass::None,
    };
    let outcome = apply_status(input)?;
    let actual_label = status_outcome_label(&outcome);
    let actual_status_kind = match &outcome {
        StatusApplicationOutcome::Applied { mutation } => mutation.after.kind,
        StatusApplicationOutcome::Rejected { .. }
        | StatusApplicationOutcome::ChanceFailed { .. } => initial_status.kind,
    };
    let expected = json!({
        "outcome": expected_label,
        "status_kind": final_status.kind,
    });
    let actual = json!({
        "outcome": actual_label,
        "status_kind": actual_status_kind,
    });
    assert_no_divergence(case_name, &expected, &actual);
    Ok(())
}

fn stage_differential() -> Result<(), Box<dyn Error>> {
    let case_name = "stage-floor-cap";
    let document = parse_case(case_name)?;
    let move_id = semantic_move_id(&document, case_name)?;
    let move_definition = lookup_move(move_id)?;
    let (stat, delta) = move_definition
        .effects
        .iter()
        .find_map(|effect| match effect {
            MoveEffectDefinition::ChangeStatStage { stat, delta } => Some((*stat, *delta)),
            MoveEffectDefinition::Damage | MoveEffectDefinition::ApplyStatus(_) => None,
        })
        .ok_or_else(|| FixtureError::new("stage-floor-cap: no stage effect"))?;
    let initial_target = canonical_party_member(&document, case_name, false)?;
    let final_target = canonical_party_member(&document, case_name, true)?;
    let initial_stages: StatStages = serde_json::from_value(
        initial_target
            .get("stat_stages")
            .cloned()
            .ok_or_else(|| FixtureError::new("stage-floor-cap: initial stages are missing"))?,
    )?;
    let final_stages: StatStages = serde_json::from_value(
        final_target
            .get("stat_stages")
            .cloned()
            .ok_or_else(|| FixtureError::new("stage-floor-cap: final stages are missing"))?,
    )?;
    let mutation = stage_mutation(stat, stage_for_stat(&initial_stages, stat), delta);
    let mut applied_stages = initial_stages;
    let applied = apply_stage_delta(&mut applied_stages, stat, delta);
    let expected = json!({
        "before": stage_for_stat(&initial_stages, stat),
        "after": stage_for_stat(&final_stages, stat),
        "changed": stage_for_stat(&initial_stages, stat) != stage_for_stat(&final_stages, stat),
    });
    let actual = json!({
        "before": mutation.before,
        "after": mutation.after,
        "changed": mutation.changed,
    });
    assert_no_divergence(case_name, &expected, &actual);
    assert_eq!(applied, mutation);
    assert_eq!(
        stage_for_stat(&applied_stages, stat),
        stage_for_stat(&final_stages, stat)
    );
    Ok(())
}

fn residual_differential() -> Result<(), Box<dyn Error>> {
    let case_name = "burn-residual";
    let document = parse_case(case_name)?;
    let final_target = canonical_party_member(&document, case_name, true)?;
    let final_status = status_state_from_oracle(
        final_target
            .get("status")
            .cloned()
            .ok_or_else(|| FixtureError::new("burn-residual: final status is missing"))?,
        case_name,
        "final",
    )?;
    let max_hp = final_target
        .get("max_hp")
        .and_then(Value::as_u64)
        .ok_or_else(|| FixtureError::new("burn-residual: final max_hp is invalid"))?;
    let post_turn_mutation = document
        .get("expected_mutations")
        .and_then(Value::as_array)
        .and_then(|mutations| {
            mutations.iter().find(|mutation| {
                mutation.get("phase").and_then(Value::as_str) == Some("PostTurnStatusEffectPhase")
                    && mutation.get("kind").and_then(Value::as_str) == Some("HP_DAMAGE")
            })
        })
        .ok_or_else(|| FixtureError::new("burn-residual: post-turn HP mutation is missing"))?;
    let before_hp = post_turn_mutation
        .get("before")
        .and_then(|value| value.get("hp"))
        .and_then(Value::as_u64)
        .ok_or_else(|| FixtureError::new("burn-residual: residual before HP is invalid"))?;
    let expected_after_hp = post_turn_mutation
        .get("after")
        .and_then(|value| value.get("hp"))
        .and_then(Value::as_u64)
        .ok_or_else(|| FixtureError::new("burn-residual: residual after HP is invalid"))?;
    let status_before = StatusState {
        kind: StatusKind::Burn,
        toxic_turn_count: final_status
            .toxic_turn_count
            .checked_sub(1)
            .ok_or_else(|| {
                FixtureError::new("burn-residual: final turn count did not increment")
            })?,
        sleep_turns_remaining: None,
    };
    let outcome = resolve_residual(StatusResidualInput {
        status: status_before,
        hp: u32::try_from(before_hp)?,
        max_hp: u32::try_from(max_hp)?,
    })?;
    let mutation = match outcome {
        StatusResidualOutcome::Applied { mutation } => mutation,
        StatusResidualOutcome::NotApplicable { status } => {
            return Err(FixtureError::new(format!(
                "burn-residual: unexpected non-residual status {status:?}"
            ))
            .into());
        }
        StatusResidualOutcome::TargetFainted { hp, .. } => {
            return Err(FixtureError::new(format!(
                "burn-residual: unexpected fainted target at HP {hp}"
            ))
            .into());
        }
    };
    let expected = json!({
        "hp_after": expected_after_hp,
        "damage": before_hp - expected_after_hp,
        "toxic_turn_count": final_status.toxic_turn_count,
    });
    let actual = json!({
        "hp_after": mutation.hp_after,
        "damage": mutation.damage,
        "toxic_turn_count": mutation.status_after.toxic_turn_count,
    });
    assert_no_divergence(case_name, &expected, &actual);
    Ok(())
}

#[test]
fn oracle_manifest_and_compile_time_case_inventory_are_exact() -> Result<(), Box<dyn Error>> {
    assert_eq!(FROZEN_CASES.len(), 38);
    let manifest = parse_document("m3-oracle-manifest", ORACLE_MANIFEST)?;
    let contracts = manifest
        .get("case_contracts")
        .and_then(Value::as_array)
        .ok_or_else(|| FixtureError::new("manifest case_contracts is not an array"))?;
    let published = manifest
        .get("published_fixtures")
        .and_then(Value::as_array)
        .ok_or_else(|| FixtureError::new("manifest published_fixtures is not an array"))?;
    assert_eq!(contracts.len(), FROZEN_CASES.len());
    assert_eq!(published.len(), FROZEN_CASES.len());

    let frozen_names: BTreeSet<&str> = FROZEN_CASES.iter().map(|(name, _)| *name).collect();
    let contract_names: BTreeSet<String> = contracts
        .iter()
        .map(|contract| {
            contract
                .get("scenario_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| FixtureError::new("manifest contract has invalid scenario_id"))
        })
        .collect::<Result<_, _>>()?;
    let contract_name_refs: BTreeSet<&str> = contract_names.iter().map(String::as_str).collect();
    assert_eq!(frozen_names, contract_name_refs);
    for fixture in published {
        assert_eq!(fixture.get("gap_free").and_then(Value::as_bool), Some(true));
        let axes = fixture
            .get("required_axes")
            .and_then(Value::as_array)
            .ok_or_else(|| FixtureError::new("published fixture required_axes is not an array"))?;
        assert_eq!(axes.len(), REQUIRED_AXES.len());
        for (index, &(expected_axis, _)) in REQUIRED_AXES.iter().enumerate() {
            assert_eq!(axes[index].as_str(), Some(expected_axis));
        }
    }
    Ok(())
}

#[test]
fn every_frozen_case_has_exact_identity_empty_gaps_and_eight_axis_envelope()
-> Result<(), Box<dyn Error>> {
    for &(expected_name, source) in FROZEN_CASES {
        let document = parse_document(expected_name, source)?;
        let actual_name = string_field(&document, expected_name, "$", "scenario_id")?;
        assert_eq!(actual_name, expected_name);
        assert_eq!(
            u64_field(&document, expected_name, "$", "schema_version")?,
            1
        );
        let gaps = array_field(&document, expected_name, "$", "gaps")?;
        assert!(
            gaps.is_empty(),
            "{expected_name}: frozen gaps are not empty"
        );
        assert_axis_shape(expected_name, &document)?;
        assert_causal_sequences(expected_name, &document)?;
    }
    Ok(())
}

#[test]
fn quarantine_is_named_documented_and_disjoint_from_scalar_comparisons() {
    let representative_cases = expected_case_set(REPRESENTATIVE_CASES);
    let quarantined_cases: BTreeSet<&str> =
        QUARANTINED_CASES.iter().map(|entry| entry.name).collect();
    assert!(representative_cases.is_disjoint(&quarantined_cases));
    assert_eq!(
        representative_cases
            .union(&quarantined_cases)
            .copied()
            .collect::<BTreeSet<_>>(),
        FROZEN_CASES.iter().map(|(name, _)| *name).collect()
    );

    let mut names = BTreeSet::new();
    for entry in QUARANTINED_CASES {
        assert!(
            !entry.reason.trim().is_empty(),
            "{} is undocumented",
            entry.name
        );
        assert!(
            names.insert(entry.name),
            "duplicate quarantined case {}",
            entry.name
        );
    }
    let representative_dimensions = expected_case_set(REPRESENTATIVE_DIMENSIONS);
    let quarantined_dimensions: BTreeSet<&str> = QUARANTINED_DIMENSIONS
        .iter()
        .map(|entry| entry.name)
        .collect();
    assert!(representative_dimensions.is_disjoint(&quarantined_dimensions));
    assert_eq!(quarantined_dimensions.len(), REQUIRED_AXES.len());
    for entry in QUARANTINED_DIMENSIONS {
        assert!(
            !entry.reason.trim().is_empty(),
            "{} is undocumented",
            entry.name
        );
        assert!(
            names.insert(entry.name),
            "duplicate quarantined name {}",
            entry.name
        );
    }
}

#[test]
fn first_divergence_diagnostic_is_deterministic() {
    let expected = json!({
        "b": 9,
        "a": [{"z": 1, "a": 2}],
    });
    let actual = json!({
        "b": 9,
        "a": [{"z": 1, "a": 3}],
    });
    let first = first_divergence(&expected, &actual);
    assert_eq!(first, first_divergence(&expected, &actual));
    assert_eq!(first.as_deref(), Some("at $.a[0].a: expected 2, actual 3"));
}

#[test]
fn representative_gap_free_cases_match_current_pure_er_battle_apis() -> Result<(), Box<dyn Error>> {
    for &(case_name, expected_multiplier) in TYPE_CASE_EXPECTATIONS {
        type_differential(case_name, expected_multiplier)?;
    }
    for &(case_name, expected_label) in STATUS_CASE_EXPECTATIONS {
        status_differential(case_name, expected_label)?;
    }
    stage_differential()?;
    residual_differential()?;
    Ok(())
}
