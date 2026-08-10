//! M3 oracle transition differentials.
//!
//! Every published case is admitted into the typed er-battle boundary and
//! replayed through the production turn/replacement resolvers.  The fixture
//! predates some of the typed DTO spellings, so the local adapters below
//! normalize only those closed legacy shapes.  Anything without a public
//! er-battle representation is reported as a precise differential instead of
//! being dropped from the comparison.
//!
//! The transition gate covers axes 1-7.  The published axis-8 control
//! projection remains an envelope-only contract owned by er-game.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{Display, Formatter};

use er_battle::legality::{build_command_offer, build_scripted_enemy_offer};
use er_battle::presentation::{PRESENTATION_BLOCKING_POLICY, PRESENTATION_SKIP_POLICY};
use er_battle::resolver::BattleMutation;
use er_battle::{resolve_replacement, resolve_turn};
use er_content::pack::{ContentPack, selected_content_pack};
use er_rng::audit::{RngCallsiteId, RngDraw, SeedOffsetContext};
use er_rng::battle::BattleRngState;
use er_rng::phaser::RunRngState;
use er_state::battle::CommandCollectionState;
use er_state::pokemon::PokemonState;
use er_state::snapshot::GameState;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1,
    BattleTargetSelection, CommandAdmissionSource, CommandFrontierEntry, CommandFrontierStatus,
    CommandSet, ReplacementSelection, ScriptedEnemyBattleCommandV1,
    replacement_operation_id, turn_result_operation_id,
};
use er_types::battle_ids::{
    AbilityId, AuthorityEpoch, BattleId, BattlePresentationEventId, BattleSide,
    FaintOccurrenceId, FieldSlot, MenuInstanceId, MoveId, MoveSlotIndex, PartyIndex, PokemonId,
    TurnIndex, WaveIndex,
};
use er_types::battle_model::{
    BattleStat, FaintOccurrence, ReplacementProgress, ResolvedAction, ResolvedActionKind,
    StatusKind, StatusState,
};
use er_types::battle_ui::{
    BattlePresentationEvent, BattlePresentationKind,
};
use er_types::{OperationId, SafeU53, SeatId};
use serde::{Deserialize, Serialize};
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

fn compare_serialized_axis<T: Serialize>(
    case_name: &str,
    axis_name: &str,
    expected: &T,
    actual: &T,
) -> Result<(), Box<dyn Error>> {
    let expected = serde_json::to_value(expected)?;
    let actual = serde_json::to_value(actual)?;
    if let Some(divergence) = first_divergence(&expected, &actual) {
        return Err(FixtureError::new(format!(
            "{case_name}: axis {axis_name} mismatch: {divergence}"
        ))
        .into());
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct FixtureRngBoundary {
    battle: BattleRngState,
    next_sequence: SafeU53,
    run: RunRngState,
    seed_offset: Option<SeedOffsetContext>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyIdentity {
    legacy_pid: u64,
    party_index: u64,
    pokemon_id: PokemonId,
    side: BattleSide,
}

#[derive(Clone, Debug)]
struct FixtureCommandRecord {
    actor: PokemonId,
    command: BattleCommand,
    field_slot: FieldSlot,
    operation_id: OperationId,
    owner_seat: Option<SeatId>,
    source: CommandAdmissionSource,
    switch_pokemon: Option<PokemonId>,
}

#[derive(Clone, Debug)]
struct FixtureReplacementProposal {
    raw_operation_id: OperationId,
    epoch: AuthorityEpoch,
    battle_id: BattleId,
    field_slot: FieldSlot,
    occurrence: FaintOccurrenceId,
    owner_seat: SeatId,
    resolved_turn: TurnIndex,
    selection: ReplacementSelection,
    turn_occurrence: u32,
    wave: WaveIndex,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct LegacyMoveEvidence {
    move_id: MoveId,
    pp_used: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct LegacyStatusEvidence {
    effect: u8,
    sleep_turns_remaining: Option<u16>,
    toxic_turn_count: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct LegacyPokemonEvidence {
    fainted: bool,
    hp: u32,
    id: u64,
    moves: Vec<LegacyMoveEvidence>,
    stages: [i8; 7],
    status: LegacyStatusEvidence,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyTurnBoundary {
    commands: Value,
    pre_commands: Value,
    turn: u64,
}

fn assert_exact_keys(
    case_name: &str,
    path: &str,
    value: &Value,
    expected: &[&str],
) -> Result<(), FixtureError> {
    let object = value.as_object().ok_or_else(|| {
        FixtureError::new(format!("{case_name}: {path} is not an object"))
    })?;
    let actual: BTreeSet<String> = object.keys().cloned().collect();
    let expected: BTreeSet<String> = expected.iter().map(|key| (*key).to_owned()).collect();
    if actual != expected {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} keys differ: expected {expected:?}, actual {actual:?}"
        )));
    }
    Ok(())
}

fn normalize_nested_kind(
    case_name: &str,
    path: &str,
    object: &mut Value,
    field_name: &str,
) -> Result<(), FixtureError> {
    let object = object.as_object_mut().ok_or_else(|| {
        FixtureError::new(format!("{case_name}: {path} is not an object"))
    })?;
    let Some(kind) = object.get(field_name).cloned() else {
        return Err(FixtureError::new(format!(
            "{case_name}: {path}.{field_name} is missing"
        )));
    };
    let normalized = match kind {
        Value::String(_) => kind,
        Value::Object(nested) => {
            if nested.len() != 1 || !nested.contains_key("kind") {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.{field_name} has an unsupported nested kind shape"
                )));
            }
            let tag = nested
                .get("kind")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {path}.{field_name}.kind is not a string"
                    ))
                })?;
            Value::String(tag.to_owned())
        }
        other => {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.{field_name} has unsupported value {other}"
            )));
        }
    };
    object.insert(field_name.to_owned(), normalized);
    Ok(())
}

fn normalize_legacy_state(case_name: &str, state: &mut Value) -> Result<(), FixtureError> {
    let canonical = state.get_mut("canonical").ok_or_else(|| {
        FixtureError::new(format!("{case_name}: canonical is missing"))
    })?;
    let battle = canonical
        .get_mut("battle")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| FixtureError::new(format!("{case_name}: canonical.battle is invalid")))?;

    for party_name in ["player_party", "enemy_party"] {
        let party = battle
            .get_mut(party_name)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: canonical.battle.{party_name} is invalid"
                ))
            })?;
        for (index, pokemon) in party.iter_mut().enumerate() {
            let status = pokemon.get_mut("status").ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: canonical.battle.{party_name}[{index}].status is missing"
                ))
            })?;
            normalize_nested_kind(
                case_name,
                &format!("canonical.battle.{party_name}[{index}].status"),
                status,
                "kind",
            )?;
        }
    }
    for condition_name in ["weather", "terrain"] {
        let condition = battle.get_mut(condition_name).ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: canonical.battle.{condition_name} is missing"
            ))
        })?;
        normalize_nested_kind(
            case_name,
            &format!("canonical.battle.{condition_name}"),
            condition,
            "kind",
        )?;
    }
    Ok(())
}

fn fixture_state(
    document: &Value,
    case_name: &str,
    field_name: &str,
) -> Result<GameState, Box<dyn Error>> {
    let mut value = object_field(document, case_name, "$", field_name)?.clone();
    normalize_legacy_state(case_name, &mut value)?;
    let canonical = value.get("canonical").cloned().ok_or_else(|| {
        FixtureError::new(format!("{case_name}: {field_name}.canonical is missing"))
    })?;
    Ok(serde_json::from_value(canonical)?)
}

fn fixture_rng_boundary(
    document: &Value,
    case_name: &str,
    field_name: &str,
) -> Result<FixtureRngBoundary, Box<dyn Error>> {
    Ok(serde_json::from_value(
        object_field(document, case_name, "$", field_name)?.clone(),
    )?)
}

fn state_rng_boundary(
    state: &GameState,
    next_sequence: SafeU53,
    seed_offset: Option<SeedOffsetContext>,
) -> Result<FixtureRngBoundary, Box<dyn Error>> {
    let battle = state
        .battle
        .as_ref()
        .ok_or_else(|| FixtureError::new("state has no active battle"))?;
    Ok(FixtureRngBoundary {
        battle: battle.battle_rng.clone(),
        next_sequence,
        run: state.run_rng.clone(),
        seed_offset,
    })
}

fn legacy_identities(
    document: &Value,
    case_name: &str,
) -> Result<BTreeMap<u64, PokemonId>, Box<dyn Error>> {
    let initial_state = object_field(document, case_name, "$", "initial_state")?;
    let values = array_field(
        initial_state,
        case_name,
        "initial_state",
        "legacy_identity_map",
    )?;
    let mut identities = BTreeMap::new();
    for (index, value) in values.iter().enumerate() {
        let identity: LegacyIdentity = serde_json::from_value(value.clone()).map_err(|error| {
            FixtureError::new(format!(
                "{case_name}: legacy_identity_map[{index}] is invalid: {error}"
            ))
        })?;
        if identity.party_index > u64::from(u8::MAX) {
            return Err(FixtureError::new(format!(
                "{case_name}: legacy_identity_map[{index}].party_index is out of range"
            ))
            .into());
        }
        if identities.insert(identity.legacy_pid, identity.pokemon_id).is_some() {
            return Err(FixtureError::new(format!(
                "{case_name}: duplicate legacy_pid {}",
                identity.legacy_pid
            ))
            .into());
        }
    }
    Ok(identities)
}

fn legacy_pokemon_id(
    identities: &BTreeMap<u64, PokemonId>,
    case_name: &str,
    path: &str,
    legacy_pid: u64,
) -> Result<PokemonId, Box<dyn Error>> {
    identities.get(&legacy_pid).copied().ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: {path} references unmapped legacy_pid {legacy_pid}"
        ))
        .into()
    })
}

fn fixture_source(
    value: &Value,
    case_name: &str,
    path: &str,
) -> Result<CommandAdmissionSource, Box<dyn Error>> {
    let value = value.as_str().ok_or_else(|| {
        FixtureError::new(format!("{case_name}: {path} is not a source string"))
    })?;
    match value {
        "AUTHORITY_LOCAL_INTERNAL" => Ok(CommandAdmissionSource::AuthorityLocalInternal),
        "AUTHORITY_REMOTE_PROPOSAL" => Ok(CommandAdmissionSource::AuthorityRemoteProposal),
        "SCRIPTED_ENEMY" => Ok(CommandAdmissionSource::ScriptedEnemy),
        _ => Err(FixtureError::new(format!(
            "{case_name}: {path} has unsupported source {value}"
        ))
        .into()),
    }
}

fn source_label(source: CommandAdmissionSource) -> &'static str {
    match source {
        CommandAdmissionSource::AuthorityLocalInternal => "AUTHORITY_LOCAL_INTERNAL",
        CommandAdmissionSource::AuthorityRemoteProposal => "AUTHORITY_REMOTE_PROPOSAL",
        CommandAdmissionSource::ScriptedEnemy => "SCRIPTED_ENEMY",
    }
}

fn fixture_command(
    value: &Value,
    case_name: &str,
    path: &str,
) -> Result<(BattleCommand, Option<PokemonId>), Box<dyn Error>> {
    let command = object_field(value, case_name, path, "command")?;
    let command_path = format!("{path}.command");
    let kind = string_field(command, case_name, &command_path, "kind")?;
    let inner_actor = PokemonId::try_from_u64(u64_field(
        command,
        case_name,
        &command_path,
        "actor",
    )?)?;
    match kind.as_str() {
        "FIGHT" => {
            assert_exact_keys(
                case_name,
                &command_path,
                command,
                &["actor", "kind", "move_slot", "targets"],
            )?;
            let move_slot = MoveSlotIndex::try_from(u64_field(
                command,
                case_name,
                &command_path,
                "move_slot",
            )?)?;
            let targets: BattleTargetSelection = serde_json::from_value(
                required(command, case_name, &command_path, "targets")?.clone(),
            )?;
            Ok((BattleCommand::fight(inner_actor, move_slot, targets)?, None))
        }
        "SWITCH" => {
            assert_exact_keys(
                case_name,
                &command_path,
                command,
                &["actor", "kind", "party_slot", "pokemon"],
            )?;
            let party_slot = PartyIndex::try_from(u64_field(
                command,
                case_name,
                &command_path,
                "party_slot",
            )?)?;
            let pokemon = PokemonId::try_from_u64(u64_field(
                command,
                case_name,
                &command_path,
                "pokemon",
            )?)?;
            Ok((BattleCommand::switch(inner_actor, party_slot), Some(pokemon)))
        }
        _ => Err(FixtureError::new(format!(
            "{case_name}: {command_path} has unsupported kind {kind}"
        ))
        .into()),
    }
}

fn fixture_command_records(
    document: &Value,
    case_name: &str,
) -> Result<Vec<FixtureCommandRecord>, Box<dyn Error>> {
    let commands = object_field(document, case_name, "$", "commands")?;
    let committed = array_field(commands, case_name, "commands", "committed")?;
    let mut records = Vec::with_capacity(committed.len());
    for (index, value) in committed.iter().enumerate() {
        let path = format!("commands.committed[{index}]");
        assert_exact_keys(
            case_name,
            &path,
            value,
            &[
                "actor",
                "command",
                "field_slot",
                "operation_id",
                "owner_seat",
                "source",
            ],
        )?;
        let actor = PokemonId::try_from_u64(u64_field(value, case_name, &path, "actor")?)?;
        let field_slot: FieldSlot =
            serde_json::from_value(required(value, case_name, &path, "field_slot")?.clone())?;
        let operation_id = OperationId::new(string_field(
            value,
            case_name,
            &path,
            "operation_id",
        )?)?;
        let owner_seat = match required(value, case_name, &path, "owner_seat")? {
            Value::Null => None,
            value => Some(SeatId::try_from(u64_field(value, case_name, &path, "owner_seat")?)?),
        };
        let source = fixture_source(
            required(value, case_name, &path, "source")?,
            case_name,
            &format!("{path}.source"),
        )?;
        let (command, switch_pokemon) = fixture_command(value, case_name, &path)?;
        if command.actor() != actor {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.command.actor does not match actor"
            ))
            .into());
        }
        records.push(FixtureCommandRecord {
            actor,
            command,
            field_slot,
            operation_id,
            owner_seat,
            source,
            switch_pokemon,
        });
    }
    Ok(records)
}

fn script_cursor_from_operation(
    operation_id: &OperationId,
    case_name: &str,
) -> Result<SafeU53, Box<dyn Error>> {
    let mut parts = operation_id.as_str().split("/script/");
    let prefix = parts.next();
    let cursor = parts.next();
    if prefix.is_none() || cursor.is_none() || parts.next().is_some() {
        return Err(FixtureError::new(format!(
            "{case_name}: enemy operation {} has no exact /script/<cursor> suffix",
            operation_id.as_str()
        ))
        .into());
    }
    let cursor = cursor
        .ok_or_else(|| FixtureError::new("script cursor disappeared during parsing"))?
        .parse::<u64>()
        .map_err(|error| {
            FixtureError::new(format!(
                "{case_name}: enemy operation {} has invalid script cursor: {error}",
                operation_id.as_str()
            ))
        })?;
    Ok(SafeU53::new(cursor)?)
}

fn fixture_command_wire(
    record: &FixtureCommandRecord,
    case_name: &str,
) -> Result<Value, Box<dyn Error>> {
    let mut command = serde_json::to_value(&record.command)?;
    if let Some(pokemon) = record.switch_pokemon {
        let object = command.as_object_mut().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: switch command did not serialize as an object"
            ))
        })?;
        object.insert("pokemon".to_owned(), json!(pokemon));
    }
    Ok(json!({
        "actor": record.actor,
        "command": command,
        "field_slot": record.field_slot,
        "operation_id": record.operation_id,
        "owner_seat": record.owner_seat,
        "source": source_label(record.source),
    }))
}

fn admitted_command_wire(
    accepted: &AcceptedBattleCommand,
    record: &FixtureCommandRecord,
    case_name: &str,
) -> Result<Value, Box<dyn Error>> {
    let (actor, field_slot, operation_id, owner_seat, command) = match accepted {
        AcceptedBattleCommand::Human { proposal, .. } => (
            proposal.actor,
            proposal.field_slot,
            &proposal.operation_id,
            Some(proposal.owner_seat),
            &proposal.command,
        ),
        AcceptedBattleCommand::ScriptedEnemy { command, .. } => (
            command.actor,
            command.field_slot,
            &command.operation_id,
            None,
            &command.command,
        ),
    };
    let mut command = serde_json::to_value(command)?;
    if let Some(pokemon) = record.switch_pokemon {
        let object = command.as_object_mut().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: accepted switch command did not serialize as an object"
            ))
        })?;
        object.insert("pokemon".to_owned(), json!(pokemon));
    }
    Ok(json!({
        "actor": actor,
        "command": command,
        "field_slot": field_slot,
        "operation_id": operation_id,
        "owner_seat": owner_seat,
        "source": source_label(record.source),
    }))
}

fn admit_fixture_commands(
    initial: &GameState,
    records: &[FixtureCommandRecord],
    case_name: &str,
    content: &ContentPack,
) -> Result<(GameState, CommandSet), Box<dyn Error>> {
    let battle = initial
        .battle
        .as_ref()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: initial state has no battle")))?;
    let mut accepted = Vec::with_capacity(records.len());
    let mut frontier = Vec::with_capacity(records.len());

    for (index, record) in records.iter().enumerate() {
        let offer = match record.field_slot.side {
            BattleSide::Player => build_command_offer(initial, record.field_slot, content)?,
            BattleSide::Enemy => {
                build_scripted_enemy_offer(initial, record.field_slot, &record.command, content)?
            }
        };
        if let BattleCommand::Switch { party_slot, .. } = &record.command {
            let offered_pokemon = offer
                .switches
                .iter()
                .find(|switch| switch.party_slot == *party_slot)
                .map(|switch| switch.pokemon);
            if offered_pokemon != record.switch_pokemon {
                return Err(FixtureError::new(format!(
                    "{case_name}: command {index} legacy switch pokemon does not match the typed legal offer"
                ))
                .into());
            }
        } else if record.switch_pokemon.is_some() {
            return Err(FixtureError::new(format!(
                "{case_name}: non-switch command {index} carries a legacy switch pokemon"
            ))
            .into());
        }
        let accepted_command = match record.field_slot.side {
            BattleSide::Player => {
                let owner_seat = record.owner_seat.ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: player command {index} has no owner seat"
                    ))
                })?;
                if record.source == CommandAdmissionSource::ScriptedEnemy {
                    return Err(FixtureError::new(format!(
                        "{case_name}: player command {index} has SCRIPTED_ENEMY source"
                    ))
                    .into());
                }
                AcceptedBattleCommand::human(BattleCommandProposalV1::new(
                    record.operation_id.clone(),
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    owner_seat,
                    record.actor,
                    record.field_slot,
                    record.command.clone(),
                    MenuInstanceId::new(SafeU53::new(1)?),
                    format!("m3-oracle/{case_name}/command/{index}"),
                )?)
            }
            BattleSide::Enemy => {
                if record.owner_seat.is_some()
                    || record.source != CommandAdmissionSource::ScriptedEnemy
                {
                    return Err(FixtureError::new(format!(
                        "{case_name}: enemy command {index} has invalid owner/source metadata"
                    ))
                    .into());
                }
                AcceptedBattleCommand::scripted_enemy(ScriptedEnemyBattleCommandV1::new(
                    record.operation_id.clone(),
                    battle.battle_id,
                    battle.wave,
                    battle.turn,
                    script_cursor_from_operation(&record.operation_id, case_name)?,
                    record.actor,
                    record.field_slot,
                    record.command.clone(),
                )?)
            }
        };
        let owner_seat = record.owner_seat;
        let status = CommandFrontierStatus::Admitted {
            command: accepted_command.clone(),
            source: record.source,
        };
        frontier.push(CommandFrontierEntry::new(
            record.operation_id.clone(),
            owner_seat,
            record.actor,
            record.field_slot,
            offer,
            status,
        )?);
        accepted.push(accepted_command);
    }

    let command_set = CommandSet::new(accepted)?;
    let command_state = CommandCollectionState::new(
        frontier,
        battle.command_state.tombstones.clone(),
    )?;
    let mut state = initial.clone();
    state
        .battle
        .as_mut()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: initial battle disappeared")))?
        .command_state = command_state;
    Ok((state, command_set))
}

fn compare_admitted_commands(
    case_name: &str,
    records: &[FixtureCommandRecord],
    commands: &CommandSet,
) -> Result<(), Box<dyn Error>> {
    if records.len() != commands.entries.len() {
        return Err(FixtureError::new(format!(
            "{case_name}: axis ADMITTED_COMMANDS count differs: fixture {}, resolver {}",
            records.len(),
            commands.entries.len()
        ))
        .into());
    }
    let expected = records
        .iter()
        .map(|record| fixture_command_wire(record, case_name))
        .collect::<Result<Vec<_>, _>>()?;
    let actual = commands
        .entries
        .iter()
        .zip(records)
        .map(|(accepted, record)| admitted_command_wire(accepted, record, case_name))
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(divergence) = first_divergence(
        &Value::Array(expected),
        &Value::Array(actual),
    ) {
        return Err(FixtureError::new(format!(
            "{case_name}: axis ADMITTED_COMMANDS mismatch: {divergence}"
        ))
        .into());
    }
    Ok(())
}

fn operation_number(
    case_name: &str,
    path: &str,
    segment: &str,
    prefix: &str,
) -> Result<u64, Box<dyn Error>> {
    let value = segment.strip_prefix(prefix).ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: {path} operation segment {segment:?} does not start with {prefix:?}"
        ))
    })?;
    if value.is_empty() {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} operation segment {segment:?} has no number"
        ))
        .into());
    }
    value.parse::<u64>().map_err(|error| {
        FixtureError::new(format!(
            "{case_name}: {path} operation segment {segment:?} has invalid number: {error}"
        ))
        .into()
    })
}

fn assert_operation_number(
    case_name: &str,
    path: &str,
    segment: &str,
    prefix: &str,
    expected: u64,
) -> Result<(), Box<dyn Error>> {
    let actual = operation_number(case_name, path, segment, prefix)?;
    if actual != expected {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} operation segment {segment:?} has {actual}, expected {prefix}{expected}"
        ))
        .into());
    }
    Ok(())
}

fn fixture_replacement_proposals(
    document: &Value,
    case_name: &str,
) -> Result<Vec<FixtureReplacementProposal>, Box<dyn Error>> {
    let commands = object_field(document, case_name, "$", "commands")?;
    let proposals = array_field(
        commands,
        case_name,
        "commands",
        "replacement_proposals",
    )?;
    let mut result = Vec::with_capacity(proposals.len());

    for (index, value) in proposals.iter().enumerate() {
        let path = format!("commands.replacement_proposals[{index}]");
        assert_exact_keys(
            case_name,
            &path,
            value,
            &[
                "battle_id",
                "field_slot",
                "occurrence",
                "operation_id",
                "owner_seat",
                "resolved_turn",
                "schema_version",
                "selection",
                "turn_occurrence",
                "wave",
            ],
        )?;
        let schema_version = u64_field(value, case_name, &path, "schema_version")?;
        if schema_version != 1 {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.schema_version is {schema_version}, expected 1"
            ))
            .into());
        }
        let battle_id = BattleId::try_from_u64(u64_field(
            value,
            case_name,
            &path,
            "battle_id",
        )?)?;
        let field_slot: FieldSlot =
            serde_json::from_value(required(value, case_name, &path, "field_slot")?.clone())?;
        if field_slot.side != BattleSide::Player {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.field_slot must be a player slot"
            ))
            .into());
        }
        let occurrence = FaintOccurrenceId::try_from_u64(u64_field(
            value,
            case_name,
            &path,
            "occurrence",
        )?)?;
        let raw_operation_id = OperationId::new(string_field(
            value,
            case_name,
            &path,
            "operation_id",
        )?)?;
        let owner_seat = SeatId::try_from(u64_field(value, case_name, &path, "owner_seat")?)?;
        let resolved_turn = TurnIndex::try_from_u64(u64_field(
            value,
            case_name,
            &path,
            "resolved_turn",
        )?)?;
        let selection: ReplacementSelection = serde_json::from_value(
            required(value, case_name, &path, "selection")?.clone(),
        )?;
        let turn_occurrence = u32::try_from(u64_field(
            value,
            case_name,
            &path,
            "turn_occurrence",
        )?)?;
        let wave = WaveIndex::try_from_u64(u64_field(value, case_name, &path, "wave")?)?;

        let segments = raw_operation_id.as_str().split('/').collect::<Vec<_>>();
        let expected_len = match segments.as_slice() {
            ["RC", _, _, _, _, _, _] => 7,
            ["RC", _, _, _, _, _, _, _] => 8,
            _ => {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.operation_id has unsupported replacement shape {}",
                    raw_operation_id.as_str()
                ))
                .into());
            }
        };
        if segments.len() != expected_len {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.operation_id has {} segments, expected {expected_len}",
                segments.len()
            ))
            .into());
        }
        let epoch = AuthorityEpoch::try_from_u64(operation_number(
            case_name,
            &path,
            segments[1],
            "e",
        )?)?;
        let mut offset = 2;
        if expected_len == 8 {
            assert_operation_number(
                case_name,
                &path,
                segments[offset],
                "b",
                u64::from(battle_id),
            )?;
            offset += 1;
        }
        assert_operation_number(
            case_name,
            &path,
            segments[offset],
            "w",
            u64::from(wave),
        )?;
        assert_operation_number(
            case_name,
            &path,
            segments[offset + 1],
            "t",
            u64::from(resolved_turn),
        )?;
        assert_operation_number(
            case_name,
            &path,
            segments[offset + 2],
            "o",
            u64::from(turn_occurrence),
        )?;
        assert_operation_number(
            case_name,
            &path,
            segments[offset + 3],
            "f",
            u64::from(field_slot.position),
        )?;
        assert_operation_number(
            case_name,
            &path,
            segments[offset + 4],
            "s",
            u64::from(owner_seat),
        )?;
        result.push(FixtureReplacementProposal {
            raw_operation_id,
            epoch,
            battle_id,
            field_slot,
            occurrence,
            owner_seat,
            resolved_turn,
            selection,
            turn_occurrence,
            wave,
        });
    }
    Ok(result)
}

fn fixture_rng_draws(
    document: &Value,
    case_name: &str,
) -> Result<Vec<RngDraw>, Box<dyn Error>> {
    let values = array_field(document, case_name, "$", "expected_rng_draws")?;
    let mut draws = Vec::with_capacity(values.len());
    for (index, value) in values.iter().enumerate() {
        let path = format!("expected_rng_draws[{index}]");
        let object = value.as_object().ok_or_else(|| {
            FixtureError::new(format!("{case_name}: {path} is not an object"))
        })?;
        let allowed = [
            "after_fingerprint",
            "after_state",
            "before_fingerprint",
            "before_state",
            "callsite_id",
            "cardinality",
            "consumed",
            "minimum",
            "primitive_draw_count",
            "public_api",
            "reason",
            "result",
            "seed_offset_context",
            "sequence",
            "stream",
        ];
        let actual: BTreeSet<String> = object.keys().cloned().collect();
        let mut expected: BTreeSet<String> = allowed.iter().map(|key| (*key).to_owned()).collect();
        expected.remove("seed_offset_context");
        let mut with_context = expected.clone();
        with_context.insert("seed_offset_context".to_owned());
        if actual != expected && actual != with_context {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} keys differ from the typed RngDraw plus optional legacy seed_offset_context: expected {expected:?} or with context, actual {actual:?}"
            ))
            .into());
        }

        let mut normalized = value.clone();
        if let Some(context) = normalized
            .as_object()
            .and_then(|object| object.get("seed_offset_context"))
        {
            let context: SeedOffsetContext = serde_json::from_value(context.clone())?;
            let normalized_object = normalized.as_object().ok_or_else(|| {
                FixtureError::new(format!("{case_name}: {path} is not an object"))
            })?;
            let before_state = normalized_object
                .get("before_state")
                .ok_or_else(|| FixtureError::new(format!("{case_name}: {path}.before_state is missing")))?;
            let after_state = normalized_object
                .get("after_state")
                .ok_or_else(|| FixtureError::new(format!("{case_name}: {path}.after_state is missing")))?;
            let before_context = before_state
                .get("seed_offset")
                .ok_or_else(|| FixtureError::new(format!("{case_name}: {path}.before_state.seed_offset is missing")))?;
            let after_context = after_state
                .get("seed_offset")
                .ok_or_else(|| FixtureError::new(format!("{case_name}: {path}.after_state.seed_offset is missing")))?;
            let before_context: Option<SeedOffsetContext> = serde_json::from_value(before_context.clone())?;
            let after_context: Option<SeedOffsetContext> = serde_json::from_value(after_context.clone())?;
            if before_context.as_ref() != Some(&context) || after_context.as_ref() != Some(&context) {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.seed_offset_context does not equal both typed audit-state contexts"
                ))
                .into());
            }
            normalized
                .as_object_mut()
                .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not an object")))?
                .remove("seed_offset_context");
        }

        let callsite = string_field(&normalized, case_name, &path, "callsite_id")?;
        let callsite = if callsite.starts_with("src/") {
            format!("{}:{callsite}", RngCallsiteId::oracle_sha())
        } else {
            callsite
        };
        normalized
            .as_object_mut()
            .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not an object")))?
            .insert("callsite_id".to_owned(), Value::String(callsite));
        let draw: RngDraw = serde_json::from_value(normalized).map_err(|error| {
            FixtureError::new(format!("{case_name}: {path} is not a typed RngDraw: {error}"))
        })?;
        draws.push(draw);
    }
    Ok(draws)
}

fn fixture_action_order(
    document: &Value,
    case_name: &str,
) -> Result<Vec<ResolvedAction>, Box<dyn Error>> {
    let values = array_field(document, case_name, "$", "expected_action_order")?;
    let actions: Vec<ResolvedAction> = serde_json::from_value(Value::Array(values.clone()))?;
    for (index, action) in actions.iter().enumerate() {
        let expected = SafeU53::new(u64::try_from(index)?)?;
        if action.sequence != expected {
            return Err(FixtureError::new(format!(
                "{case_name}: expected_action_order[{index}].sequence is {}, expected {expected}",
                action.sequence
            ))
            .into());
        }
    }
    Ok(actions)
}

fn pokemon_state<'a>(state: &'a GameState, pokemon: PokemonId) -> Option<&'a PokemonState> {
    let battle = state.battle.as_ref()?;
    battle
        .player_party
        .iter()
        .chain(&battle.enemy_party)
        .find(|candidate| candidate.id == pokemon)
}

fn legacy_status_state(
    case_name: &str,
    path: &str,
    legacy: &LegacyStatusEvidence,
) -> Result<StatusState, Box<dyn Error>> {
    let kind = match legacy.effect {
        0 => StatusKind::None,
        1 => StatusKind::Poison,
        2 => StatusKind::Toxic,
        3 => StatusKind::Paralysis,
        4 => StatusKind::Sleep,
        6 => StatusKind::Burn,
        7 => {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.effect=7 is the legacy faint marker and has no typed StatusState representation; production seam: expose faint evidence separately from status"
            ))
            .into());
        }
        effect => {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.effect={effect} is not a supported legacy status spelling"
            ))
            .into());
        }
    };
    let sleep_turns_remaining = match (kind, legacy.sleep_turns_remaining) {
        (StatusKind::Sleep, value) => value,
        (_, None | Some(0)) => None,
        (_, Some(value)) => {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} carries sleep_turns_remaining={value} for non-sleep status"
            ))
            .into());
        }
    };
    let status = StatusState {
        kind,
        toxic_turn_count: legacy.toxic_turn_count,
        sleep_turns_remaining,
    };
    if kind == StatusKind::None
        && (status.toxic_turn_count != 0 || status.sleep_turns_remaining.is_some())
    {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} has NONE status with non-empty typed companion fields"
        ))
        .into());
    }
    Ok(status)
}

fn legacy_pokemon_transition(
    value: &Value,
    case_name: &str,
    path: &str,
    identities: &BTreeMap<u64, PokemonId>,
    ignored_field: &str,
) -> Result<(LegacyPokemonEvidence, LegacyPokemonEvidence, PokemonId), Box<dyn Error>> {
    let before: LegacyPokemonEvidence = serde_json::from_value(
        object_field(value, case_name, path, "before")?.clone(),
    )?;
    let after: LegacyPokemonEvidence = serde_json::from_value(
        object_field(value, case_name, path, "after")?.clone(),
    )?;
    let before_id = legacy_pokemon_id(identities, case_name, &format!("{path}.before"), before.id)?;
    let after_id = legacy_pokemon_id(identities, case_name, &format!("{path}.after"), after.id)?;
    if before_id != after_id {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} changes Pokémon identity from {before_id} to {after_id}"
        ))
        .into());
    }
    let before_status = legacy_status_state(case_name, &format!("{path}.before.status"), &before.status)?;
    let after_status = legacy_status_state(case_name, &format!("{path}.after.status"), &after.status)?;
    if ignored_field != "hp" && before.hp != after.hp {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} changes hp outside its declared {ignored_field} mutation"
        ))
        .into());
    }
    if ignored_field != "fainted" && before.fainted != after.fainted {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} changes fainted outside its declared {ignored_field} mutation"
        ))
        .into());
    }
    if ignored_field != "moves" && before.moves != after.moves {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} changes moves outside its declared {ignored_field} mutation"
        ))
        .into());
    }
    if ignored_field != "stages" && before.stages != after.stages {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} changes stat stages outside its declared {ignored_field} mutation"
        ))
        .into());
    }
    if ignored_field != "status" && before_status != after_status {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} changes status outside its declared {ignored_field} mutation"
        ))
        .into());
    }
    Ok((before, after, before_id))
}

fn legacy_stat(index: u64, case_name: &str, path: &str) -> Result<BattleStat, Box<dyn Error>> {
    match index {
        0 => Ok(BattleStat::Attack),
        1 => Ok(BattleStat::Defense),
        2 => Ok(BattleStat::SpecialAttack),
        3 => Ok(BattleStat::SpecialDefense),
        4 => Ok(BattleStat::Speed),
        5 => Ok(BattleStat::Accuracy),
        6 => Ok(BattleStat::Evasion),
        _ => Err(FixtureError::new(format!(
            "{case_name}: {path} legacy stat index {index} is outside 0..=6"
        ))
        .into()),
    }
}

fn stage_value(stages: &[i8; 7], stat: BattleStat) -> i8 {
    match stat {
        BattleStat::Attack => stages[0],
        BattleStat::Defense => stages[1],
        BattleStat::SpecialAttack => stages[2],
        BattleStat::SpecialDefense => stages[3],
        BattleStat::Speed => stages[4],
        BattleStat::Accuracy => stages[5],
        BattleStat::Evasion => stages[6],
    }
}

fn mutation_metadata(
    value: &Value,
    case_name: &str,
    path: &str,
    kind: &str,
    fields: &[&str],
) -> Result<(String, String), Box<dyn Error>> {
    assert_exact_keys(case_name, path, value, fields)?;
    let actual_kind = string_field(value, case_name, path, "kind")?;
    if actual_kind != kind {
        return Err(FixtureError::new(format!(
            "{case_name}: {path}.kind is {actual_kind}, expected {kind}"
        ))
        .into());
    }
    let phase = string_field(value, case_name, path, "phase")?;
    let mutation_path = string_field(value, case_name, path, "path")?;
    Ok((phase, mutation_path))
}

fn mutation_cause(
    value: &Value,
    case_name: &str,
    path: &str,
) -> Result<Option<usize>, Box<dyn Error>> {
    let cause = required(value, case_name, path, "cause")?;
    match cause {
        Value::Number(_) => Ok(Some(usize::try_from(u64_field(
            value, case_name, path, "cause",
        )?)?)),
        Value::String(value) if value == "TURN_RESOLUTION" => Ok(None),
        _ => Err(FixtureError::new(format!(
            "{case_name}: {path}.cause has unsupported legacy spelling {cause}"
        ))
        .into()),
    }
}

fn fixture_mutations(
    document: &Value,
    case_name: &str,
    identities: &BTreeMap<u64, PokemonId>,
    initial: &GameState,
    actions: &[ResolvedAction],
    records: &[FixtureCommandRecord],
) -> Result<Vec<BattleMutation>, Box<dyn Error>> {
    let values = array_field(document, case_name, "$", "expected_mutations")?;
    let mut mutations = Vec::with_capacity(values.len());

    for (index, value) in values.iter().enumerate() {
        let path = format!("expected_mutations[{index}]");
        let kind = string_field(value, case_name, &path, "kind")?;
        let cause = mutation_cause(value, case_name, &path)?;
        let sequence = u64_field(value, case_name, &path, "sequence")?;
        let expected_sequence = u64::try_from(index)?;
        if sequence != expected_sequence {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.sequence is {sequence}, expected {expected_sequence}"
            ))
            .into());
        }

        let mutation = match kind.as_str() {
            "PP_CONSUMPTION" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "PP_CONSUMPTION",
                    &["after", "before", "cause", "kind", "path", "phase", "sequence"],
                )?;
                let mutation_path = string_field(value, case_name, &path, "path")?;
                let segments = mutation_path.split('/').collect::<Vec<_>>();
                if segments.len() != 3 || segments[0] != "move" || segments[2] != "pp_used" {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path {mutation_path:?} is not move/<id>/pp_used"
                    ))
                    .into());
                }
                let path_move_id = MoveId::try_from_u64(segments[1].parse::<u64>()?)?;
                let before: LegacyMoveEvidence = serde_json::from_value(
                    object_field(value, case_name, &path, "before")?.clone(),
                )?;
                let after: LegacyMoveEvidence = serde_json::from_value(
                    object_field(value, case_name, &path, "after")?.clone(),
                )?;
                if before.move_id != path_move_id
                    || after.move_id != path_move_id
                    || before.move_id != after.move_id
                {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path} move path and legacy PP evidence disagree"
                    ))
                    .into());
                }
                let cause = cause.ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {path}.cause must identify the move action"
                    ))
                })?;
                let action_sequence = SafeU53::new(u64::try_from(cause)?)?;
                let action = actions.iter().find(|action| action.sequence == action_sequence).ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {path}.cause {cause} does not identify an action-order entry"
                    ))
                })?;
                let operation_id = action.command_operation_id.as_ref().ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {path}.cause {cause} action has no command operation"
                    ))
                })?;
                let record = records.iter().find(|record| &record.operation_id == operation_id).ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {path}.cause operation {} is absent from admitted fixture commands",
                        operation_id.as_str()
                    ))
                })?;
                let (actor, move_slot) = match &record.command {
                    BattleCommand::Fight {
                        actor,
                        move_slot,
                        ..
                    } => (*actor, *move_slot),
                    BattleCommand::Switch { .. } => {
                        return Err(FixtureError::new(format!(
                            "{case_name}: {path}.cause points to a switch, not a move"
                        ))
                        .into());
                    }
                };
                if action.actor != actor || action.kind != ResolvedActionKind::Move {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.cause action actor/kind does not match its admitted move"
                    ))
                    .into());
                }
                let pokemon = pokemon_state(initial, actor).ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {path} actor {actor} is absent from initial state"
                    ))
                })?;
                let state_move = pokemon
                    .moves
                    .get(usize::from(move_slot.get()))
                    .and_then(Option::as_ref)
                    .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: {path} actor {actor} move slot {} is empty in initial state",
                            move_slot.get()
                        ))
                    })?;
                if state_move.move_id != path_move_id {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path} move {path_move_id} does not match initial slot {} move {}",
                        move_slot.get(),
                        state_move.move_id
                    ))
                    .into());
                }
                BattleMutation::PpChanged {
                    pokemon: actor,
                    move_slot,
                    before: before.pp_used,
                    after: after.pp_used,
                }
            }
            "HP_DAMAGE" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "HP_DAMAGE",
                    &["after", "before", "cause", "kind", "path", "phase", "sequence"],
                )?;
                let mutation_path = string_field(value, case_name, &path, "path")?;
                let segments = mutation_path.split('/').collect::<Vec<_>>();
                if segments.len() != 3 || segments[0] != "pokemon" || segments[2] != "hp_damage" {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path {mutation_path:?} is not pokemon/<legacy_pid>/hp_damage"
                    ))
                    .into());
                }
                let legacy_pid = segments[1].parse::<u64>()?;
                let (before, after, pokemon) =
                    legacy_pokemon_transition(value, case_name, &path, identities, "hp")?;
                if before.id != legacy_pid || after.id != legacy_pid {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path legacy_pid does not match its snapshots"
                    ))
                    .into());
                }
                let _ = cause;
                BattleMutation::HpChanged {
                    pokemon,
                    before: before.hp,
                    after: after.hp,
                }
            }
            "STATUS_SET" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "STATUS_SET",
                    &["after", "before", "cause", "kind", "path", "phase", "sequence"],
                )?;
                let mutation_path = string_field(value, case_name, &path, "path")?;
                let segments = mutation_path.split('/').collect::<Vec<_>>();
                if segments.len() != 3 || segments[0] != "pokemon" || segments[2] != "status_set" {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path {mutation_path:?} is not pokemon/<legacy_pid>/status_set"
                    ))
                    .into());
                }
                let legacy_pid = segments[1].parse::<u64>()?;
                let (before, after, pokemon) =
                    legacy_pokemon_transition(value, case_name, &path, identities, "status")?;
                if before.id != legacy_pid || after.id != legacy_pid {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path legacy_pid does not match its snapshots"
                    ))
                    .into());
                }
                BattleMutation::StatusChanged {
                    pokemon,
                    before: legacy_status_state(
                        case_name,
                        &format!("{path}.before.status"),
                        &before.status,
                    )?,
                    after: legacy_status_state(
                        case_name,
                        &format!("{path}.after.status"),
                        &after.status,
                    )?,
                }
            }
            "STAT_STAGE" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "STAT_STAGE",
                    &["after", "before", "cause", "kind", "path", "phase", "sequence"],
                )?;
                let mutation_path = string_field(value, case_name, &path, "path")?;
                let segments = mutation_path.split('/').collect::<Vec<_>>();
                if segments.len() != 3 || segments[0] != "pokemon" || segments[2] != "stat_stage" {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path {mutation_path:?} is not pokemon/<legacy_pid>/stat_stage"
                    ))
                    .into());
                }
                let legacy_pid = segments[1].parse::<u64>()?;
                let (before, after, pokemon) =
                    legacy_pokemon_transition(value, case_name, &path, identities, "stages")?;
                if before.id != legacy_pid || after.id != legacy_pid {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path legacy_pid does not match its snapshots"
                    ))
                    .into());
                }
                let mut changed = None;
                for index in 0..before.stages.len() {
                    if before.stages[index] != after.stages[index] {
                        if changed.is_some() {
                            return Err(FixtureError::new(format!(
                                "{case_name}: {path} changes more than one stat stage"
                            ))
                            .into());
                        }
                        changed = Some(index as u64);
                    }
                }
                let stat_index = changed.ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {path} does not change any stat stage"
                    ))
                })?;
                let stat = legacy_stat(stat_index, case_name, &path)?;
                BattleMutation::StatStageChanged {
                    pokemon,
                    stat,
                    before: stage_value(&before.stages, stat),
                    after: stage_value(&after.stages, stat),
                }
            }
            "BATTLE_RNG_CHANGED" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "BATTLE_RNG_CHANGED",
                    &["after", "before", "cause", "kind", "path", "phase", "sequence"],
                )?;
                let before: BattleRngState = serde_json::from_value(
                    object_field(value, case_name, &path, "before")?.clone(),
                )?;
                let after: BattleRngState = serde_json::from_value(
                    object_field(value, case_name, &path, "after")?.clone(),
                )?;
                BattleMutation::BattleRngChanged { before, after }
            }
            "FAINT_QUEUED" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "FAINT_QUEUED",
                    &["after", "before", "cause", "kind", "path", "phase", "sequence"],
                )?;
                if !required(value, case_name, &path, "before")?.is_null() {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.before must be null for FAINT_QUEUED"
                    ))
                    .into());
                }
                let occurrence: FaintOccurrence = serde_json::from_value(
                    object_field(value, case_name, &path, "after")?.clone(),
                )?;
                BattleMutation::FaintQueued { occurrence }
            }
            "FAINT_PROGRESS_CHANGED" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "FAINT_PROGRESS_CHANGED",
                    &[
                        "after",
                        "before",
                        "cause",
                        "kind",
                        "occurrence",
                        "path",
                        "phase",
                        "sequence",
                    ],
                )?;
                let occurrence = FaintOccurrenceId::try_from_u64(u64_field(
                    value,
                    case_name,
                    &path,
                    "occurrence",
                )?)?;
                let before: ReplacementProgress = serde_json::from_value(
                    required(value, case_name, &path, "before")?.clone(),
                )?;
                let after: ReplacementProgress = serde_json::from_value(
                    required(value, case_name, &path, "after")?.clone(),
                )?;
                BattleMutation::FaintProgressChanged {
                    occurrence,
                    before,
                    after,
                }
            }
            "FAINT_RESOLVED" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "FAINT_RESOLVED",
                    &[
                        "cause",
                        "kind",
                        "occurrence",
                        "path",
                        "phase",
                        "sequence",
                    ],
                )?;
                let occurrence = FaintOccurrenceId::try_from_u64(u64_field(
                    value,
                    case_name,
                    &path,
                    "occurrence",
                )?)?;
                BattleMutation::FaintResolved { occurrence }
            }
            "FIELD_CHANGED" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "FIELD_CHANGED",
                    &[
                        "after",
                        "before",
                        "cause",
                        "kind",
                        "path",
                        "phase",
                        "sequence",
                        "slot",
                    ],
                )?;
                let slot: FieldSlot = serde_json::from_value(
                    required(value, case_name, &path, "slot")?.clone(),
                )?;
                let mutation_path = string_field(value, case_name, &path, "path")?;
                let segments = mutation_path.split('/').collect::<Vec<_>>();
                if segments.len() != 6
                    || segments[0] != "battle"
                    || segments[1] != "field"
                    || segments[2] != "slots"
                    || segments[5] != "occupant"
                {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path {mutation_path:?} is not battle/field/slots/<side>/<position>/occupant"
                    ))
                    .into());
                }
                let path_side = match segments[3] {
                    "player" => BattleSide::Player,
                    "enemy" => BattleSide::Enemy,
                    side => {
                        return Err(FixtureError::new(format!(
                            "{case_name}: {path}.path has unsupported field side {side:?}"
                        ))
                        .into());
                    }
                };
                let path_position = segments[4].parse::<u8>()?;
                if slot != FieldSlot::new(path_side, path_position)? {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.slot does not match its path"
                    ))
                    .into());
                }
                let before: Option<PokemonId> = serde_json::from_value(
                    required(value, case_name, &path, "before")?.clone(),
                )?;
                let after: Option<PokemonId> = serde_json::from_value(
                    required(value, case_name, &path, "after")?.clone(),
                )?;
                BattleMutation::FieldChanged { slot, before, after }
            }
            "TURN_ADVANCE" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "TURN_ADVANCE",
                    &["after", "before", "cause", "kind", "path", "phase", "sequence"],
                )?;
                let before: LegacyTurnBoundary = serde_json::from_value(
                    object_field(value, case_name, &path, "before")?.clone(),
                )?;
                let after: LegacyTurnBoundary = serde_json::from_value(
                    object_field(value, case_name, &path, "after")?.clone(),
                )?;
                if !before.commands.is_null()
                    || !before.pre_commands.is_null()
                    || !after.commands.is_null()
                    || !after.pre_commands.is_null()
                {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path} carries legacy commands/pre_commands that public BattleMutation::TurnAdvanced cannot represent; production seam: expose typed command-frontier transition evidence"
                    ))
                    .into());
                }
                BattleMutation::TurnAdvanced {
                    before: TurnIndex::try_from_u64(before.turn)?,
                    after: TurnIndex::try_from_u64(after.turn)?,
                }
            }
            _ => {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path} kind {kind} is not one of the typed legacy mutation adapters"
                ))
                .into());
            }
        };
        mutations.push(mutation);
    }
    Ok(mutations)
}

fn replay_fixture_replacements(
    mut state: GameState,
    proposals: &[FixtureReplacementProposal],
    case_name: &str,
    content: &ContentPack,
) -> Result<(GameState, Vec<BattleMutation>, Vec<BattlePresentationEvent>), Box<dyn Error>> {
    let mut mutations = Vec::new();
    let mut presentation = Vec::new();
    for (index, proposal) in proposals.iter().enumerate() {
        let path = format!("commands.replacement_proposals[{index}]");
        let battle = state
            .battle
            .as_ref()
            .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} state has no battle")))?;
        if proposal.battle_id != battle.battle_id
            || proposal.wave != battle.wave
            || proposal.resolved_turn != battle.turn
        {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} coordinates do not match current battle boundary"
            ))
            .into());
        }
        let operation_id = replacement_operation_id(
            proposal.epoch,
            proposal.battle_id,
            proposal.wave,
            proposal.resolved_turn,
            proposal.turn_occurrence,
            proposal.field_slot,
            proposal.owner_seat,
        )?;
        if proposal.raw_operation_id.as_str() != operation_id.as_str() {
            let raw_segments = proposal.raw_operation_id.as_str().split('/').collect::<Vec<_>>();
            let canonical_segments = operation_id.as_str().split('/').collect::<Vec<_>>();
            let legacy = [
                raw_segments.first().copied(),
                raw_segments.get(1).copied(),
                raw_segments.get(2).copied(),
                raw_segments.get(3).copied(),
                raw_segments.get(4).copied(),
                raw_segments.get(5).copied(),
            ];
            let canonical_without_battle = [
                canonical_segments.first().copied(),
                canonical_segments.get(1).copied(),
                canonical_segments.get(3).copied(),
                canonical_segments.get(4).copied(),
                canonical_segments.get(5).copied(),
                canonical_segments.get(6).copied(),
            ];
            if legacy != canonical_without_battle {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.operation_id {} is neither the canonical typed identity {} nor its accepted legacy spelling",
                    proposal.raw_operation_id.as_str(),
                    operation_id.as_str()
                ))
                .into());
            }
        }
        let transition = resolve_replacement(
            &state,
            proposal.occurrence,
            &proposal.selection,
            &operation_id,
            content,
        )?;
        if transition.before_state != state {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} replacement resolver did not preserve the supplied before state"
            ))
            .into());
        }
        if transition.occurrence.id != proposal.occurrence
            || transition.selection != proposal.selection
        {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} replacement resolver changed the admitted occurrence or selection"
            ))
            .into());
        }
        mutations.extend(transition.mutations);
        presentation.extend(transition.presentation);
        state = transition.after_state;
    }
    Ok((state, mutations, presentation))
}

fn legacy_field_slot_from_bi(
    case_name: &str,
    path: &str,
    value: &Value,
) -> Result<FieldSlot, Box<dyn Error>> {
    let bi = u64_field(value, case_name, path, "bi")?;
    legacy_field_slot(case_name, path, bi)
}

fn legacy_field_slot(
    case_name: &str,
    path: &str,
    bi: u64,
) -> Result<FieldSlot, Box<dyn Error>> {
    let (side, position) = match bi {
        0 => (BattleSide::Player, 0),
        1 => (BattleSide::Player, 1),
        2 => (BattleSide::Enemy, 0),
        3 => (BattleSide::Enemy, 1),
        _ => {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.bi={bi} is outside the typed four-slot battle topology"
            ))
            .into());
        }
    };
    Ok(FieldSlot::new(side, position)?)
}

fn legacy_actor(
    value: &Value,
    case_name: &str,
    path: &str,
    identities: &BTreeMap<u64, PokemonId>,
) -> Result<(PokemonId, BattleSide), Box<dyn Error>> {
    assert_exact_keys(case_name, path, value, &["pokemonId", "side"])?;
    let legacy_pid = u64_field(value, case_name, path, "pokemonId")?;
    let pokemon = legacy_pokemon_id(identities, case_name, path, legacy_pid)?;
    let side = match string_field(value, case_name, path, "side")?.as_str() {
        "player" => BattleSide::Player,
        "enemy" => BattleSide::Enemy,
        side => {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.side has unsupported legacy spelling {side:?}"
            ))
            .into());
        }
    };
    Ok((pokemon, side))
}

fn validate_legacy_actor_slot(
    case_name: &str,
    path: &str,
    actor: (PokemonId, BattleSide),
    slot: FieldSlot,
) -> Result<PokemonId, Box<dyn Error>> {
    if actor.1 != slot.side {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} actor side {:?} disagrees with bi slot {:?}",
            actor.1, slot
        ))
        .into());
    }
    Ok(actor.0)
}

fn take_hp_mutation(
    case_name: &str,
    path: &str,
    mutations: &[BattleMutation],
    used: &mut [bool],
    pokemon: PokemonId,
    after: u32,
) -> Result<(u32, u32), Box<dyn Error>> {
    for (index, mutation) in mutations.iter().enumerate() {
        if used[index]
            || !matches!(
                mutation,
                BattleMutation::HpChanged {
                    pokemon: candidate,
                    after: candidate_after,
                    ..
                } if *candidate == pokemon && *candidate_after == after
            )
        {
            continue;
        }
        used[index] = true;
        if let BattleMutation::HpChanged { before, after, .. } = mutation {
            return Ok((*before, *after));
        }
    }
    Err(FixtureError::new(format!(
        "{case_name}: {path} has no unused typed HpChanged mutation for {pokemon} -> {after}"
    ))
    .into())
}

fn take_status_mutation(
    case_name: &str,
    path: &str,
    mutations: &[BattleMutation],
    used: &mut [bool],
    pokemon: PokemonId,
    after: StatusState,
) -> Result<(StatusState, StatusState), Box<dyn Error>> {
    for (index, mutation) in mutations.iter().enumerate() {
        if used[index]
            || !matches!(
                mutation,
                BattleMutation::StatusChanged {
                    pokemon: candidate,
                    after: candidate_after,
                    ..
                } if *candidate == pokemon && *candidate_after == after
            )
        {
            continue;
        }
        used[index] = true;
        if let BattleMutation::StatusChanged { before, after, .. } = mutation {
            return Ok((*before, *after));
        }
    }
    Err(FixtureError::new(format!(
        "{case_name}: {path} has no unused typed StatusChanged mutation for {pokemon} -> {after:?}"
    ))
    .into())
}

fn take_stage_mutation(
    case_name: &str,
    path: &str,
    mutations: &[BattleMutation],
    used: &mut [bool],
    pokemon: PokemonId,
    stat: BattleStat,
    after: i8,
) -> Result<(i8, i8), Box<dyn Error>> {
    for (index, mutation) in mutations.iter().enumerate() {
        if used[index]
            || !matches!(
                mutation,
                BattleMutation::StatStageChanged {
                    pokemon: candidate,
                    stat: candidate_stat,
                    after: candidate_after,
                    ..
                } if *candidate == pokemon && *candidate_stat == stat && *candidate_after == after
            )
        {
            continue;
        }
        used[index] = true;
        if let BattleMutation::StatStageChanged { before, after, .. } = mutation {
            return Ok((*before, *after));
        }
    }
    Err(FixtureError::new(format!(
        "{case_name}: {path} has no unused typed StatStageChanged mutation for {pokemon} {stat:?} -> {after}"
    ))
    .into())
}

fn take_faint_occurrence(
    case_name: &str,
    path: &str,
    mutations: &[BattleMutation],
    used: &mut [bool],
    pokemon: PokemonId,
) -> Result<FaintOccurrenceId, Box<dyn Error>> {
    for (index, mutation) in mutations.iter().enumerate() {
        if used[index] {
            continue;
        }
        if let BattleMutation::FaintQueued { occurrence } = mutation {
            if occurrence.pokemon == pokemon {
                used[index] = true;
                return Ok(occurrence.id);
            }
        }
    }
    Err(FixtureError::new(format!(
        "{case_name}: {path} has no unused typed FaintQueued mutation for {pokemon}"
    ))
    .into())
}

fn take_field_mutation(
    case_name: &str,
    path: &str,
    mutations: &[BattleMutation],
    used: &mut [bool],
    slot: FieldSlot,
    incoming: Option<PokemonId>,
) -> Result<(Option<PokemonId>, PokemonId), Box<dyn Error>> {
    for (index, mutation) in mutations.iter().enumerate() {
        if used[index]
            || !matches!(
                mutation,
                BattleMutation::FieldChanged {
                    slot: candidate_slot,
                    after: Some(candidate_after),
                    ..
                } if *candidate_slot == slot && Some(*candidate_after) == incoming
            )
        {
            continue;
        }
        used[index] = true;
        if let BattleMutation::FieldChanged {
            before,
            after: Some(after),
            ..
        } = mutation
        {
            return Ok((*before, *after));
        }
    }
    Err(FixtureError::new(format!(
        "{case_name}: {path} has no unused typed FieldChanged mutation for {slot:?} -> {incoming:?}"
    ))
    .into())
}

fn fixture_presentation(
    document: &Value,
    case_name: &str,
    identities: &BTreeMap<u64, PokemonId>,
    initial: &GameState,
    mutations: &[BattleMutation],
) -> Result<Vec<BattlePresentationEvent>, Box<dyn Error>> {
    let values = array_field(document, case_name, "$", "expected_presentation")?;
    let mut used_mutations = vec![false; mutations.len()];
    let mut presentation = Vec::with_capacity(values.len());

    for (index, value) in values.iter().enumerate() {
        let path = format!("expected_presentation[{index}]");
        assert_exact_keys(case_name, &path, value, &["authority_recorded", "event", "event_id"])?;
        if required(value, case_name, &path, "authority_recorded")?.as_bool() != Some(true) {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.authority_recorded must be true"
            ))
            .into());
        }
        let event_id_value = object_field(value, case_name, &path, "event_id")?;
        assert_exact_keys(case_name, &format!("{path}.event_id"), event_id_value, &["operation_id", "sequence"])?;
        let operation_id = OperationId::new(string_field(
            event_id_value,
            case_name,
            &format!("{path}.event_id"),
            "operation_id",
        )?)?;
        let sequence = SafeU53::new(u64_field(
            event_id_value,
            case_name,
            &format!("{path}.event_id"),
            "sequence",
        )?)?;
        if sequence != SafeU53::new(u64::try_from(index)?)? {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.event_id.sequence is {sequence}, expected {index}"
            ))
            .into());
        }

        let event = object_field(value, case_name, &path, "event")?;
        let event_path = format!("{path}.event");
        let event_kind = string_field(event, case_name, &event_path, "k")?;
        let kind = match event_kind.as_str() {
            "moveUsed" => {
                assert_exact_keys(
                    case_name,
                    &event_path,
                    event,
                    &["actor", "bi", "k", "moveId", "targetActors", "targets"],
                )?;
                let actor_value = object_field(event, case_name, &event_path, "actor")?;
                let actor = legacy_actor(
                    actor_value,
                    case_name,
                    &format!("{event_path}.actor"),
                    identities,
                )?;
                let slot = legacy_field_slot_from_bi(case_name, &event_path, event)?;
                let actor_id = validate_legacy_actor_slot(case_name, &event_path, actor, slot)?;
                let target_values = array_field(event, case_name, &event_path, "targetActors")?;
                let target_slots = array_field(event, case_name, &event_path, "targets")?;
                if target_values.len() != target_slots.len() {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {event_path}.targetActors and targets have different lengths"
                    ))
                    .into());
                }
                let mut targets = Vec::with_capacity(target_slots.len());
                for target_index in 0..target_slots.len() {
                    let target_path = format!("{event_path}.targetActors[{target_index}]");
                    let target_actor = legacy_actor(
                        &target_values[target_index],
                        case_name,
                        &target_path,
                        identities,
                    )?;
                    let target_bi = u64_field(
                        &target_slots[target_index],
                        case_name,
                        &format!("{event_path}.targets[{target_index}]"),
                        "value",
                    )
                    .or_else(|_| {
                        target_slots[target_index]
                            .as_u64()
                            .ok_or_else(|| {
                                FixtureError::new(format!(
                                    "{case_name}: {event_path}.targets[{target_index}] is not an integer"
                                ))
                            })
                    })?;
                    let target_slot = legacy_field_slot(
                        case_name,
                        &format!("{event_path}.targets[{target_index}]"),
                        target_bi,
                    )?;
                    if target_actor.1 != target_slot.side {
                        return Err(FixtureError::new(format!(
                            "{case_name}: {target_path}.side disagrees with target bi {target_bi}"
                        ))
                        .into());
                    }
                    targets.push(target_slot);
                }
                BattlePresentationKind::MoveUsed {
                    actor: actor_id,
                    move_id: MoveId::try_from_u64(u64_field(
                        event,
                        case_name,
                        &event_path,
                        "moveId",
                    )?)?,
                    targets,
                }
            }
            "hp" => {
                assert_exact_keys(
                    case_name,
                    &event_path,
                    event,
                    &["actor", "bi", "critical", "hp", "k", "maxHp", "result", "sp"],
                )?;
                let actor_value = object_field(event, case_name, &event_path, "actor")?;
                let actor = legacy_actor(
                    actor_value,
                    case_name,
                    &format!("{event_path}.actor"),
                    identities,
                )?;
                let slot = legacy_field_slot_from_bi(case_name, &event_path, event)?;
                let actor_id = validate_legacy_actor_slot(case_name, &event_path, actor, slot)?;
                let hp = u32::try_from(u64_field(event, case_name, &event_path, "hp")?)?;
                let max_hp = u32::try_from(u64_field(event, case_name, &event_path, "maxHp")?)?;
                let critical = required(event, case_name, &event_path, "critical")?
                    .as_bool()
                    .ok_or_else(|| FixtureError::new(format!("{case_name}: {event_path}.critical is not boolean")))?;
                let result = u64_field(event, case_name, &event_path, "result")?;
                let sp = u64_field(event, case_name, &event_path, "sp")?;
                let pokemon = pokemon_state(initial, actor_id).ok_or_else(|| {
                    FixtureError::new(format!("{case_name}: {event_path} actor {actor_id} is absent from initial state"))
                })?;
                if pokemon.max_hp != max_hp {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {event_path}.maxHp {max_hp} does not match typed max_hp {}",
                        pokemon.max_hp
                    ))
                    .into());
                }
                let (before, after) = take_hp_mutation(
                    case_name,
                    &event_path,
                    mutations,
                    &mut used_mutations,
                    actor_id,
                    hp,
                )?;
                let _legacy_display_annotations = (critical, result, sp);
                BattlePresentationKind::HpChanged {
                    pokemon: actor_id,
                    before,
                    after,
                }
            }
            "status" => {
                assert_exact_keys(
                    case_name,
                    &event_path,
                    event,
                    &["actor", "bi", "k", "status"],
                )?;
                let actor_value = object_field(event, case_name, &event_path, "actor")?;
                let actor = legacy_actor(
                    actor_value,
                    case_name,
                    &format!("{event_path}.actor"),
                    identities,
                )?;
                let slot = legacy_field_slot_from_bi(case_name, &event_path, event)?;
                let actor_id = validate_legacy_actor_slot(case_name, &event_path, actor, slot)?;
                let effect = u8::try_from(u64_field(event, case_name, &event_path, "status")?)?;
                let after_status = legacy_status_state(
                    case_name,
                    &format!("{event_path}.status"),
                    &LegacyStatusEvidence {
                        effect,
                        sleep_turns_remaining: None,
                        toxic_turn_count: 0,
                    },
                )?;
                let (before, after) = take_status_mutation(
                    case_name,
                    &event_path,
                    mutations,
                    &mut used_mutations,
                    actor_id,
                    after_status,
                )?;
                BattlePresentationKind::StatusApplied {
                    pokemon: actor_id,
                    before,
                    after,
                }
            }
            "statStage" => {
                assert_exact_keys(
                    case_name,
                    &event_path,
                    event,
                    &["actor", "bi", "k", "stat", "value"],
                )?;
                let actor_value = object_field(event, case_name, &event_path, "actor")?;
                let actor = legacy_actor(
                    actor_value,
                    case_name,
                    &format!("{event_path}.actor"),
                    identities,
                )?;
                let slot = legacy_field_slot_from_bi(case_name, &event_path, event)?;
                let actor_id = validate_legacy_actor_slot(case_name, &event_path, actor, slot)?;
                let stat_value = u64_field(event, case_name, &event_path, "stat")?;
                if stat_value == 0 {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {event_path}.stat is one-based in the legacy event and cannot be zero"
                    ))
                    .into());
                }
                let stat = legacy_stat(stat_value - 1, case_name, &event_path)?;
                let value: i8 = serde_json::from_value(required(
                    event,
                    case_name,
                    &event_path,
                    "value",
                )?.clone())?;
                let (before, after) = take_stage_mutation(
                    case_name,
                    &event_path,
                    mutations,
                    &mut used_mutations,
                    actor_id,
                    stat,
                    value,
                )?;
                BattlePresentationKind::StatStageChanged {
                    pokemon: actor_id,
                    stat,
                    before,
                    after,
                }
            }
            "faint" => {
                assert_exact_keys(
                    case_name,
                    &event_path,
                    event,
                    &["actor", "bi", "k", "narrate", "sp"],
                )?;
                let actor_value = object_field(event, case_name, &event_path, "actor")?;
                let actor = legacy_actor(
                    actor_value,
                    case_name,
                    &format!("{event_path}.actor"),
                    identities,
                )?;
                let slot = legacy_field_slot_from_bi(case_name, &event_path, event)?;
                let actor_id = validate_legacy_actor_slot(case_name, &event_path, actor, slot)?;
                let narrate = required(event, case_name, &event_path, "narrate")?
                    .as_bool()
                    .ok_or_else(|| FixtureError::new(format!("{case_name}: {event_path}.narrate is not boolean")))?;
                let sp = u64_field(event, case_name, &event_path, "sp")?;
                let occurrence = take_faint_occurrence(
                    case_name,
                    &event_path,
                    mutations,
                    &mut used_mutations,
                    actor_id,
                )?;
                let _legacy_display_annotations = (narrate, sp);
                BattlePresentationKind::Fainted {
                    pokemon: actor_id,
                    occurrence,
                }
            }
            "showAbility" => {
                assert_exact_keys(
                    case_name,
                    &event_path,
                    event,
                    &[
                        "abilityId",
                        "actor",
                        "bi",
                        "k",
                        "partySlot",
                        "passive",
                        "passiveSlot",
                        "pokemonId",
                    ],
                )?;
                let actor_value = object_field(event, case_name, &event_path, "actor")?;
                let actor = legacy_actor(
                    actor_value,
                    case_name,
                    &format!("{event_path}.actor"),
                    identities,
                )?;
                let slot = legacy_field_slot_from_bi(case_name, &event_path, event)?;
                let actor_id = validate_legacy_actor_slot(case_name, &event_path, actor, slot)?;
                let event_pokemon = legacy_pokemon_id(
                    identities,
                    case_name,
                    &format!("{event_path}.pokemonId"),
                    u64_field(event, case_name, &event_path, "pokemonId")?,
                )?;
                if event_pokemon != actor_id {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {event_path}.pokemonId does not match actor"
                    ))
                    .into());
                }
                let party_slot = PartyIndex::try_from(u64_field(
                    event,
                    case_name,
                    &event_path,
                    "partySlot",
                )?)?;
                let passive = required(event, case_name, &event_path, "passive")?
                    .as_bool()
                    .ok_or_else(|| FixtureError::new(format!("{case_name}: {event_path}.passive is not boolean")))?;
                let passive_slot = u64_field(event, case_name, &event_path, "passiveSlot")?;
                let _legacy_ability_annotations = (party_slot, passive, passive_slot);
                BattlePresentationKind::AbilityActivated {
                    pokemon: actor_id,
                    ability_id: AbilityId::try_from_u64(u64_field(
                        event,
                        case_name,
                        &event_path,
                        "abilityId",
                    )?)?,
                }
            }
            "switch" => {
                assert_exact_keys(
                    case_name,
                    &event_path,
                    event,
                    &[
                        "actor",
                        "bi",
                        "doReturn",
                        "k",
                        "partySlot",
                        "pokemonId",
                        "speciesId",
                        "switchType",
                    ],
                )?;
                let actor_value = object_field(event, case_name, &event_path, "actor")?;
                let actor = legacy_actor(
                    actor_value,
                    case_name,
                    &format!("{event_path}.actor"),
                    identities,
                )?;
                let slot = legacy_field_slot_from_bi(case_name, &event_path, event)?;
                let actor_id = validate_legacy_actor_slot(case_name, &event_path, actor, slot)?;
                let event_pokemon = legacy_pokemon_id(
                    identities,
                    case_name,
                    &format!("{event_path}.pokemonId"),
                    u64_field(event, case_name, &event_path, "pokemonId")?,
                )?;
                let do_return = required(event, case_name, &event_path, "doReturn")?
                    .as_bool()
                    .ok_or_else(|| FixtureError::new(format!("{case_name}: {event_path}.doReturn is not boolean")))?;
                let party_slot = PartyIndex::try_from(u64_field(
                    event,
                    case_name,
                    &event_path,
                    "partySlot",
                )?)?;
                let species_id = u64_field(event, case_name, &event_path, "speciesId")?;
                let switch_type = u64_field(event, case_name, &event_path, "switchType")?;
                let (outgoing, incoming) = take_field_mutation(
                    case_name,
                    &event_path,
                    mutations,
                    &mut used_mutations,
                    slot,
                    Some(event_pokemon),
                )?;
                if incoming != actor_id {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {event_path} legacy actor does not match typed incoming occupant"
                    ))
                    .into());
                }
                let _legacy_switch_annotations = (do_return, party_slot, species_id, switch_type);
                BattlePresentationKind::Switched {
                    slot,
                    outgoing,
                    incoming,
                }
            }
            "message" => {
                assert_exact_keys(case_name, &event_path, event, &["k", "text"])?;
                let text = string_field(event, case_name, &event_path, "text")?;
                return Err(FixtureError::new(format!(
                    "{case_name}: {event_path} legacy message {text:?} has no public BattlePresentationKind representation; production seam: expose typed message presentation evidence"
                ))
                .into());
            }
            _ => {
                return Err(FixtureError::new(format!(
                    "{case_name}: {event_path}.k={event_kind:?} is not a supported legacy presentation event"
                ))
                .into());
            }
        };
        presentation.push(BattlePresentationEvent::new(
            BattlePresentationEventId::new(operation_id, sequence),
            PRESENTATION_BLOCKING_POLICY,
            PRESENTATION_SKIP_POLICY,
            kind,
        ));
    }
    Ok(presentation)
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

fn replay_transition_case(case_name: &str) -> Result<(), Box<dyn Error>> {
    let document = parse_case(case_name)?;
    let content = selected_content_pack()?;
    let initial = fixture_state(&document, case_name, "initial_state")?;
    let expected_final = fixture_state(&document, case_name, "expected_final_state")?;
    let initial_rng = fixture_rng_boundary(&document, case_name, "initial_rng")?;
    let expected_final_rng = fixture_rng_boundary(&document, case_name, "final_rng")?;
    if initial_rng.seed_offset.is_some() || expected_final_rng.seed_offset.is_some() {
        return Err(FixtureError::new(format!(
            "{case_name}: GameState has no public seed-offset boundary; production seam: expose seed-offset state on GameState before asserting initial/final RNG"
        ))
        .into());
    }
    let actual_initial_rng = state_rng_boundary(&initial, initial_rng.next_sequence, None)?;
    compare_serialized_axis(
        case_name,
        "INITIAL_STATE_AND_RNG",
        &initial_rng,
        &actual_initial_rng,
    )?;
    compare_serialized_axis(
        case_name,
        "INITIAL_STATE_CANONICAL",
        &initial,
        &fixture_state(&document, case_name, "initial_state")?,
    )?;

    let identities = legacy_identities(&document, case_name)?;
    let records = fixture_command_records(&document, case_name)?;
    let replacement_proposals = fixture_replacement_proposals(&document, case_name)?;
    let expected_actions = fixture_action_order(&document, case_name)?;
    let (resolver_input, commands) = admit_fixture_commands(&initial, &records, case_name, &content)?;
    let authority_epoch = replacement_proposals
        .first()
        .map(|proposal| proposal.epoch)
        .unwrap_or(AuthorityEpoch::try_from_u64(1)?);
    let battle = resolver_input
        .battle
        .as_ref()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: resolver input has no battle")))?;
    let material_operation_id = turn_result_operation_id(battle.battle_id, battle.wave, battle.turn)?;
    let transition = resolve_turn(
        &resolver_input,
        &commands,
        authority_epoch,
        &material_operation_id,
        &content,
    )?;
    compare_serialized_axis(
        case_name,
        "INITIAL_STATE_AND_RNG.RESOLVER_INPUT",
        &resolver_input,
        &transition.before_state,
    )?;
    compare_admitted_commands(case_name, &records, &transition.accepted_commands)?;
    compare_serialized_axis(
        case_name,
        "ADMITTED_COMMANDS.TYPED_SET",
        &commands,
        &transition.accepted_commands,
    )?;

    let (final_state, replacement_mutations, replacement_presentation) =
        replay_fixture_replacements(transition.after_state.clone(), &replacement_proposals, case_name, &content)?;
    compare_serialized_axis(
        case_name,
        "DYNAMIC_ACTION_ORDER",
        &expected_actions,
        &transition.action_order,
    )?;

    let expected_rng_draws = fixture_rng_draws(&document, case_name)?;
    compare_serialized_axis(
        case_name,
        "CONSUMING_RNG_DRAWS",
        &expected_rng_draws,
        &transition.rng_audit,
    )?;
    let expected_mutations = fixture_mutations(
        &document,
        case_name,
        &identities,
        &initial,
        &expected_actions,
        &records,
    )?;
    let mut actual_mutations = transition.mutations.clone();
    actual_mutations.extend(replacement_mutations);
    compare_serialized_axis(
        case_name,
        "CAUSAL_MUTATIONS",
        &expected_mutations,
        &actual_mutations,
    )?;

    let expected_presentation = fixture_presentation(
        &document,
        case_name,
        &identities,
        &initial,
        &expected_mutations,
    )?;
    let mut actual_presentation = transition.presentation.clone();
    actual_presentation.extend(replacement_presentation);
    compare_serialized_axis(
        case_name,
        "PRESENTATION_PLAN",
        &expected_presentation,
        &actual_presentation,
    )?;
    compare_serialized_axis(
        case_name,
        "FINAL_STATE_AND_RNG.STATE",
        &expected_final,
        &final_state,
    )?;
    let final_sequence = initial_rng
        .next_sequence
        .get()
        .checked_add(u64::try_from(expected_rng_draws.len())?)
        .ok_or_else(|| FixtureError::new(format!("{case_name}: final RNG sequence overflows u53")))?;
    let actual_final_rng = state_rng_boundary(
        &final_state,
        SafeU53::new(final_sequence)?,
        None,
    )?;
    compare_serialized_axis(
        case_name,
        "FINAL_STATE_AND_RNG.RNG",
        &expected_final_rng,
        &actual_final_rng,
    )?;
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
fn every_published_gap_free_case_replays_all_er_battle_transition_axes() -> Result<(), Box<dyn Error>> {
    let mut failures = Vec::new();
    for &(case_name, _) in FROZEN_CASES {
        if let Err(error) = replay_transition_case(case_name) {
            failures.push(format!("{case_name}: {error}"));
        }
    }
    if !failures.is_empty() {
        return Err(FixtureError::new(format!(
            "published transition differentials failed:\n{}",
            failures.join("\n")
        ))
        .into());
    }
    Ok(())
}
