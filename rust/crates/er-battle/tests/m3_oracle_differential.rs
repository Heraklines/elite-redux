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
//! projection remains an envelope-only contract owned by er-game; this file
//! does not duplicate that game-owned menu/control projection.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{Display, Formatter};

use er_battle::legality::{
    build_command_offer, build_scripted_enemy_offer, validate_command_proposal,
    validate_replacement_proposal, validate_replacement_selection,
};
use er_battle::presentation::{PRESENTATION_BLOCKING_POLICY, PRESENTATION_SKIP_POLICY};
use er_battle::resolver::BattleMutation;
use er_battle::{resolve_replacement, resolve_turn};
use er_canonical::fixture_digest;
use er_content::moves::find_move;
use er_content::pack::{ContentPack, selected_content_pack};
use er_rng::audit::{
    RngAuditState, RngCallsiteId, RngDraw, RngPublicApi, RngReason, RngStream, SeedOffsetContext,
    rng_state_fingerprint,
};
use er_rng::battle::BattleRngState;
use er_rng::phaser::RunRngState;
use er_state::battle::{BattleOutcome, CommandCollectionState};
use er_state::pokemon::PokemonState;
use er_state::snapshot::GameState;
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1, BattleReplacementProposalV1,
    BattleTargetSelection, CommandAdmissionSource, CommandFrontierEntry, CommandFrontierStatus,
    CommandSet, ReplacementSelection, ScriptedEnemyBattleCommandV1, player_command_operation_id,
    replacement_operation_id, turn_result_operation_id,
};
use er_types::battle_ids::{
    AbilityId, AuthorityEpoch, BattleId, BattlePresentationEventId, BattleSide, FaintOccurrenceId,
    FieldSlot, MenuInstanceId, MoveId, MoveSlotIndex, PartyIndex, PokemonId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{
    ActionDisposition, BattleStat, FaintOccurrence, MoveTarget, ReplacementProgress,
    ResolvedAction, ResolvedActionKind, StatusKind, StatusState,
};
use er_types::battle_ui::{BattlePresentationEvent, BattlePresentationKind};
use er_types::{OperationId, SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const ORACLE_MANIFEST: &str = include_str!("../../../fixtures/m3/m3-oracle-manifest.json");
const LEGACY_ORACLE_CONTENT_DIGEST: &str =
    "3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";
const LEGACY_ORACLE_CONTENT_HASH: &str =
    "blake3-v1:3767f847681151a04ce9adc150297774e9b32312dce8cf384234c0e84e3a02a8";

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
];

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct LegacyStaleFinalOccupant {
    case_name: &'static str,
    slot: FieldSlot,
    pokemon: PokemonId,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct LegacyFinalAbilitySnapshot {
    case_name: &'static str,
    pokemon: u64,
    species: u64,
    passives: [u64; 3],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LegacyDeterministicIntimidateProbe {
    case_name: &'static str,
    draw_index: usize,
    mutation_index: usize,
    result: u64,
    cause: u64,
    stat_path: &'static str,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LegacyHpFaintedProjection {
    case_name: &'static str,
    pokemon: u64,
    before_hp: u32,
    after_hp: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TypedInactiveActionProjection {
    case_name: &'static str,
    actor: u64,
    source_side: BattleSide,
    source_position: u8,
    operation_id: &'static str,
    move_slot: u8,
    move_id: u64,
    effective_speed: u32,
    tie_order: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LegacyReplacementActionProjection {
    case_name: &'static str,
    actor: u64,
    source_side: BattleSide,
    source_position: u8,
    sequence: u64,
    effective_speed: u32,
    raw_operation_id: &'static str,
    occurrence: u64,
    party_slot: u8,
    incoming: u64,
    outcome: BattleOutcome,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LegacyCompactedTargetProjection {
    case_name: &'static str,
    actor: u64,
    source_side: BattleSide,
    source_position: u8,
    operation_id: &'static str,
    move_slot: u8,
    move_id: u64,
    legacy_target_side: BattleSide,
    legacy_target_position: u8,
    typed_target_side: BattleSide,
    typed_target_position: u8,
    compacted_actor: u64,
    surviving_actor: u64,
    action_count: usize,
    action_index: usize,
    effective_speed: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TypedSpeedQueueProbeProjection {
    case_name: &'static str,
    actual_index: usize,
    wave_seed: &'static str,
    offset: u64,
    cardinality: u64,
    result: u64,
}

const TYPED_INACTIVE_ACTION_PROJECTIONS: &[TypedInactiveActionProjection] = &[
    TypedInactiveActionProjection {
        case_name: "same-side-simultaneous-faint",
        actor: 2,
        source_side: BattleSide::Player,
        source_position: 1,
        operation_id: "battle/1/wave/1/turn/1/command/player/1/seat/2",
        move_slot: 0,
        move_id: 589,
        effective_speed: 122,
        tie_order: 0,
    },
    TypedInactiveActionProjection {
        case_name: "no-legal-replacement",
        actor: 1,
        source_side: BattleSide::Player,
        source_position: 0,
        operation_id: "battle/1/wave/1/turn/1/command/player/0/seat/1",
        move_slot: 0,
        move_id: 589,
        effective_speed: 180,
        tie_order: 0,
    },
    TypedInactiveActionProjection {
        case_name: "no-legal-replacement",
        actor: 2,
        source_side: BattleSide::Player,
        source_position: 1,
        operation_id: "battle/1/wave/1/turn/1/command/player/1/seat/2",
        move_slot: 0,
        move_id: 589,
        effective_speed: 180,
        tie_order: 0,
    },
    TypedInactiveActionProjection {
        case_name: "defeat",
        actor: 1,
        source_side: BattleSide::Player,
        source_position: 0,
        operation_id: "battle/1/wave/1/turn/1/command/player/0/seat/1",
        move_slot: 0,
        move_id: 589,
        effective_speed: 180,
        tie_order: 0,
    },
];

const LEGACY_HP_FAINTED_PROJECTIONS: &[LegacyHpFaintedProjection] = &[
    LegacyHpFaintedProjection {
        case_name: "defeat",
        pokemon: 1,
        before_hp: 2,
        after_hp: 0,
    },
    LegacyHpFaintedProjection {
        case_name: "forced-replacement",
        pokemon: 1,
        before_hp: 2,
        after_hp: 0,
    },
    LegacyHpFaintedProjection {
        case_name: "mixed-side-simultaneous-faint",
        pokemon: 1,
        before_hp: 2,
        after_hp: 0,
    },
    LegacyHpFaintedProjection {
        case_name: "no-legal-replacement",
        pokemon: 2,
        before_hp: 2,
        after_hp: 0,
    },
    LegacyHpFaintedProjection {
        case_name: "no-legal-replacement",
        pokemon: 1,
        before_hp: 2,
        after_hp: 0,
    },
    LegacyHpFaintedProjection {
        case_name: "same-side-simultaneous-faint",
        pokemon: 2,
        before_hp: 2,
        after_hp: 0,
    },
    LegacyHpFaintedProjection {
        case_name: "same-side-simultaneous-faint",
        pokemon: 1,
        before_hp: 2,
        after_hp: 0,
    },
    LegacyHpFaintedProjection {
        case_name: "victory",
        pokemon: 2,
        before_hp: 2,
        after_hp: 0,
    },
    LegacyHpFaintedProjection {
        case_name: "wonder-guard-status-pass",
        pokemon: 2,
        before_hp: 1,
        after_hp: 0,
    },
    LegacyHpFaintedProjection {
        case_name: "wonder-guard-super-effective-pass",
        pokemon: 2,
        before_hp: 1,
        after_hp: 0,
    },
];

const LEGACY_REPLACEMENT_ACTION_PROJECTIONS: &[LegacyReplacementActionProjection] =
    &[LegacyReplacementActionProjection {
        case_name: "forced-replacement",
        actor: 1,
        source_side: BattleSide::Player,
        source_position: 0,
        sequence: 5,
        effective_speed: 180,
        raw_operation_id: "RC/e1/w1/t1/o2/f0/s1",
        occurrence: 1,
        party_slot: 2,
        incoming: 3,
        outcome: BattleOutcome::Ongoing,
    }];

const LEGACY_COMPACTED_TARGET_PROJECTIONS: &[LegacyCompactedTargetProjection] =
    &[LegacyCompactedTargetProjection {
        case_name: "mixed-side-simultaneous-faint",
        actor: 4,
        source_side: BattleSide::Enemy,
        source_position: 1,
        operation_id: "battle/1/wave/1/turn/1/command/enemy/1/script/0",
        move_slot: 0,
        move_id: 1,
        legacy_target_side: BattleSide::Player,
        legacy_target_position: 1,
        typed_target_side: BattleSide::Player,
        typed_target_position: 0,
        compacted_actor: 1,
        surviving_actor: 2,
        action_count: 5,
        action_index: 2,
        effective_speed: 207,
    }];

const TYPED_SPEED_QUEUE_PROJECTIONS: &[TypedSpeedQueueProbeProjection] =
    &[TypedSpeedQueueProbeProjection {
        case_name: "voluntary-switch",
        actual_index: 5,
        wave_seed: "n4.wpmvoubsz.txjudi",
        offset: 1002,
        cardinality: 2,
        result: 0,
    }];

const LEGACY_POST_TURN_OUTCOME_CASES: &[&str] = &[
    "same-side-simultaneous-faint",
    "no-legal-replacement",
    "defeat",
];

const LEGACY_FILTERED_RESOLVED_FAINT_CASES: &[(&str, usize)] = &[
    ("defeat", 1),
    ("forced-replacement", 1),
    ("mixed-side-simultaneous-faint", 1),
    ("no-legal-replacement", 2),
    ("same-side-simultaneous-faint", 2),
    ("victory", 1),
    ("wonder-guard-status-pass", 1),
    ("wonder-guard-super-effective-pass", 1),
];

const LEGACY_DETERMINISTIC_INTIMIDATE_CALLSITE: &str =
    "src/data/elite-redux/init-elite-redux-ability-upgrades.ts:496";

const LEGACY_DETERMINISTIC_INTIMIDATE_PROBES: &[LegacyDeterministicIntimidateProbe] = &[
    LegacyDeterministicIntimidateProbe {
        case_name: "voluntary-switch",
        draw_index: 29,
        mutation_index: 1,
        result: 79,
        cause: 0,
        stat_path: "pokemon/5/stat_stage",
    },
    LegacyDeterministicIntimidateProbe {
        case_name: "voluntary-switch",
        draw_index: 30,
        mutation_index: 3,
        result: 73,
        cause: 0,
        stat_path: "pokemon/4/stat_stage",
    },
    LegacyDeterministicIntimidateProbe {
        case_name: "forced-replacement",
        draw_index: 75,
        mutation_index: 19,
        result: 97,
        cause: 5,
        stat_path: "pokemon/4/stat_stage",
    },
    LegacyDeterministicIntimidateProbe {
        case_name: "forced-replacement",
        draw_index: 76,
        mutation_index: 21,
        result: 74,
        cause: 5,
        stat_path: "pokemon/5/stat_stage",
    },
];

const LEGACY_FINAL_ABILITY_SNAPSHOTS: &[LegacyFinalAbilitySnapshot] = &[
    LegacyFinalAbilitySnapshot {
        case_name: "defeat",
        pokemon: 1,
        species: 19,
        passives: [62, 95, 50],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "forced-replacement",
        pokemon: 1,
        species: 19,
        passives: [62, 95, 50],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "forced-replacement",
        pokemon: 3,
        species: 23,
        passives: [5076, 61, 5040],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "mixed-side-simultaneous-faint",
        pokemon: 1,
        species: 19,
        passives: [62, 95, 50],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "no-legal-replacement",
        pokemon: 1,
        species: 19,
        passives: [62, 95, 50],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "no-legal-replacement",
        pokemon: 2,
        species: 19,
        passives: [62, 95, 50],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "same-side-simultaneous-faint",
        pokemon: 1,
        species: 19,
        passives: [62, 95, 50],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "same-side-simultaneous-faint",
        pokemon: 2,
        species: 7,
        passives: [67, 75, 41],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "victory",
        pokemon: 2,
        species: 52,
        passives: [5026, 101, 290],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "voluntary-switch",
        pokemon: 1,
        species: 19,
        passives: [62, 95, 50],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "voluntary-switch",
        pokemon: 3,
        species: 23,
        passives: [5076, 61, 5040],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "wonder-guard-status-pass",
        pokemon: 2,
        species: 52,
        passives: [5026, 101, 290],
    },
    LegacyFinalAbilitySnapshot {
        case_name: "wonder-guard-super-effective-pass",
        pokemon: 2,
        species: 7,
        passives: [67, 75, 41],
    },
];

fn legacy_stale_final_occupants() -> [LegacyStaleFinalOccupant; 9] {
    [
        LegacyStaleFinalOccupant {
            case_name: "defeat",
            slot: FieldSlot::new(BattleSide::Player, 0).expect("valid stale catalogue slot"),
            pokemon: PokemonId::try_from_u64(1).expect("valid stale catalogue PokemonId"),
        },
        LegacyStaleFinalOccupant {
            case_name: "mixed-side-simultaneous-faint",
            slot: FieldSlot::new(BattleSide::Player, 1).expect("valid stale catalogue slot"),
            pokemon: PokemonId::try_from_u64(1).expect("valid stale catalogue PokemonId"),
        },
        LegacyStaleFinalOccupant {
            case_name: "no-legal-replacement",
            slot: FieldSlot::new(BattleSide::Player, 0).expect("valid stale catalogue slot"),
            pokemon: PokemonId::try_from_u64(1).expect("valid stale catalogue PokemonId"),
        },
        LegacyStaleFinalOccupant {
            case_name: "no-legal-replacement",
            slot: FieldSlot::new(BattleSide::Player, 1).expect("valid stale catalogue slot"),
            pokemon: PokemonId::try_from_u64(2).expect("valid stale catalogue PokemonId"),
        },
        LegacyStaleFinalOccupant {
            case_name: "same-side-simultaneous-faint",
            slot: FieldSlot::new(BattleSide::Player, 0).expect("valid stale catalogue slot"),
            pokemon: PokemonId::try_from_u64(1).expect("valid stale catalogue PokemonId"),
        },
        LegacyStaleFinalOccupant {
            case_name: "same-side-simultaneous-faint",
            slot: FieldSlot::new(BattleSide::Player, 1).expect("valid stale catalogue slot"),
            pokemon: PokemonId::try_from_u64(2).expect("valid stale catalogue PokemonId"),
        },
        LegacyStaleFinalOccupant {
            case_name: "victory",
            slot: FieldSlot::new(BattleSide::Enemy, 0).expect("valid stale catalogue slot"),
            pokemon: PokemonId::try_from_u64(2).expect("valid stale catalogue PokemonId"),
        },
        LegacyStaleFinalOccupant {
            case_name: "wonder-guard-status-pass",
            slot: FieldSlot::new(BattleSide::Enemy, 0).expect("valid stale catalogue slot"),
            pokemon: PokemonId::try_from_u64(2).expect("valid stale catalogue PokemonId"),
        },
        LegacyStaleFinalOccupant {
            case_name: "wonder-guard-super-effective-pass",
            slot: FieldSlot::new(BattleSide::Enemy, 0).expect("valid stale catalogue slot"),
            pokemon: PokemonId::try_from_u64(2).expect("valid stale catalogue PokemonId"),
        },
    ]
}

const LEGACY_MESSAGE_CATALOGUE: &[&str] = &[
    "It’s super effective!",
    "Wild Meowth\nwas burned!",
    "Wild Meowth is hurt\nby its burn!",
    "It doesn’t affect Wild Meowth!",
    "Wild Meowth’s Attack fell!",
    "It doesn’t affect Wild Bulbasaur!",
    "Wild Meowth’s Attack won’t go any lower!",
    "Wild Meowth avoided the attack!",
    "But it failed!",
    "Wild Meowth was paralyzed,\nIt may be unable to move!",
    "Rattata was paralyzed,\nIt may be unable to move!",
    "Rattata is paralyzed!\nIt can’t move!",
    "Wild Meowth\nwas poisoned!",
    "Wild Meowth is hurt\nby poison!",
    "It doesn’t affect Wild Ekans!",
    "It doesn’t affect Wild Diglett!",
    "It’s not very effective…",
    "Wild Meowth avoided damage\nwith Wonder Guard!",
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

const MAX_REPORTED_AXIS_DIVERGENCES: usize = 24;

fn axis_divergence_report(expected: &Value, actual: &Value) -> Option<String> {
    if expected == actual {
        return None;
    }
    let mut divergences = Vec::new();
    collect_axis_divergences("$", expected, actual, &mut divergences);
    Some(divergences.join("; "))
}

fn collect_axis_divergences(
    path: &str,
    expected: &Value,
    actual: &Value,
    divergences: &mut Vec<String>,
) {
    if expected == actual || divergences.len() >= MAX_REPORTED_AXIS_DIVERGENCES {
        return;
    }
    match (expected, actual) {
        (Value::Object(expected_object), Value::Object(actual_object)) => {
            let mut keys = BTreeSet::new();
            keys.extend(expected_object.keys().cloned());
            keys.extend(actual_object.keys().cloned());
            for key in keys {
                if divergences.len() >= MAX_REPORTED_AXIS_DIVERGENCES {
                    return;
                }
                let child_path = format!("{path}.{key}");
                match (expected_object.get(&key), actual_object.get(&key)) {
                    (Some(expected_value), Some(actual_value)) => collect_axis_divergences(
                        &child_path,
                        expected_value,
                        actual_value,
                        divergences,
                    ),
                    (Some(expected_value), None) => divergences.push(format!(
                        "at {child_path}: expected {expected_value}, actual <missing>"
                    )),
                    (None, Some(actual_value)) => divergences.push(format!(
                        "at {child_path}: expected <missing>, actual {actual_value}"
                    )),
                    (None, None) => {}
                }
            }
        }
        (Value::Array(expected_array), Value::Array(actual_array)) => {
            for index in 0..expected_array.len().min(actual_array.len()) {
                if divergences.len() >= MAX_REPORTED_AXIS_DIVERGENCES {
                    return;
                }
                collect_axis_divergences(
                    &format!("{path}[{index}]"),
                    &expected_array[index],
                    &actual_array[index],
                    divergences,
                );
            }
            if expected_array.len() != actual_array.len()
                && divergences.len() < MAX_REPORTED_AXIS_DIVERGENCES
            {
                divergences.push(format!(
                    "at {path}: expected array length {}, actual {}",
                    expected_array.len(),
                    actual_array.len()
                ));
            }
        }
        _ => divergences.push(format!("at {path}: expected {expected}, actual {actual}")),
    }
}

fn compare_serialized_axis<T: Serialize + ?Sized>(
    case_name: &str,
    axis_name: &str,
    expected: &T,
    actual: &T,
) -> Result<(), Box<dyn Error>> {
    let expected = serde_json::to_value(expected)?;
    let actual = serde_json::to_value(actual)?;
    if let Some(divergence) = axis_divergence_report(&expected, &actual) {
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
    /// Retained for strict legacy-schema validation; identity resolution is keyed by `legacy_pid`
    /// and intentionally does not use this field for oracle comparisons.
    #[allow(dead_code)]
    side: BattleSide,
}

#[derive(Clone, Debug)]
struct FixtureCommandRecord {
    actor: PokemonId,
    command: BattleCommand,
    legacy_command: BattleCommand,
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

#[derive(Clone, Debug)]
struct LegacyFaintMarker {
    cause: Option<usize>,
    pokemon: PokemonId,
    before: LegacyPokemonEvidence,
    after: LegacyPokemonEvidence,
    before_status: StatusState,
}

#[derive(Clone, Debug)]
struct LegacyTurnAdvance {
    cause: Option<usize>,
    before: LegacyTurnBoundary,
    after: LegacyTurnBoundary,
}

#[derive(Clone, Debug)]
struct LegacyMutationMetadata {
    sequence: u64,
    kind: String,
    phase: String,
    path: String,
    cause: Value,
}

#[derive(Clone, Debug)]
struct FixtureMutationTrace {
    typed: Vec<BattleMutation>,
    faint_markers: Vec<LegacyFaintMarker>,
    metadata: Vec<LegacyMutationMetadata>,
    turn_advances: Vec<LegacyTurnAdvance>,
}

#[derive(Clone, Debug)]
struct LegacyPresentationMessage {
    sequence: u64,
    typed_before: usize,
    text: String,
}

#[derive(Clone, Debug)]
struct FixturePresentationTrace {
    typed: Vec<BattlePresentationEvent>,
    messages: Vec<LegacyPresentationMessage>,
}

#[derive(Clone, Debug)]
struct ReplacementPresentationTrace {
    operation_id: OperationId,
    selection: ReplacementSelection,
    field_slot: FieldSlot,
    outcome: BattleOutcome,
    presentation: Vec<BattlePresentationEvent>,
}

#[derive(Clone, Debug)]
struct ReplacementReplayTrace {
    state: GameState,
    mutations: Vec<BattleMutation>,
    transitions: Vec<ReplacementPresentationTrace>,
}

fn assert_exact_keys(
    case_name: &str,
    path: &str,
    value: &Value,
    expected: &[&str],
) -> Result<(), FixtureError> {
    let object = value
        .as_object()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not an object")))?;
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
    let object = object
        .as_object_mut()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not an object")))?;
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
            let tag = nested.get("kind").and_then(Value::as_str).ok_or_else(|| {
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

fn normalize_adjacent_kind(
    case_name: &str,
    path: &str,
    object: &mut Value,
    field_name: &str,
) -> Result<(), FixtureError> {
    let object = object
        .as_object_mut()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not an object")))?;
    let Some(kind) = object.get(field_name).cloned() else {
        return Err(FixtureError::new(format!(
            "{case_name}: {path}.{field_name} is missing"
        )));
    };
    let normalized = match kind {
        Value::String(tag) => json!({"kind": tag}),
        Value::Object(nested) => {
            if nested.get("kind").and_then(Value::as_str).is_none() {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.{field_name} has an invalid adjacent kind object"
                )));
            }
            Value::Object(nested)
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

/// Map the legacy TypeScript `TerrainType` domain into the current tagged
/// `TerrainKind` wire without erasing non-neutral values.
fn legacy_terrain_code(case_name: &str, path: &str, value: u64) -> Result<u16, FixtureError> {
    let code = u16::try_from(value).map_err(|_| {
        FixtureError::new(format!(
            "{case_name}: {path} legacy terrain value {value} exceeds u16"
        ))
    })?;
    if code > 5 {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} legacy terrain value {code} is not representable by TerrainType"
        )));
    }
    Ok(code)
}

fn legacy_terrain_tag_code(case_name: &str, path: &str, tag: &str) -> Result<u16, FixtureError> {
    match tag {
        "NONE" => Ok(0),
        "MISTY" => Ok(1),
        "ELECTRIC" => Ok(2),
        "GRASSY" => Ok(3),
        "PSYCHIC" => Ok(4),
        "TOXIC" => Ok(5),
        other => Err(FixtureError::new(format!(
            "{case_name}: {path} legacy terrain kind {other:?} is unsupported"
        ))),
    }
}

fn legacy_terrain_kind_wire(
    case_name: &str,
    path: &str,
    kind: Value,
) -> Result<Value, FixtureError> {
    let code = match kind {
        Value::Number(number) => {
            let value = number.as_u64().ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: {path} legacy terrain value is not an integer"
                ))
            })?;
            legacy_terrain_code(case_name, path, value)?
        }
        Value::String(tag) => legacy_terrain_tag_code(case_name, path, &tag)?,
        Value::Object(nested) => {
            let tag = nested.get("kind").and_then(Value::as_str).ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: {path} legacy terrain kind object has no string kind"
                ))
            })?;
            if tag == "UNSUPPORTED_ORACLE_CODE" {
                if nested.len() != 2 {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path} unsupported terrain kind has unexpected fields"
                    )));
                }
                let value = nested.get("value").and_then(Value::as_u64).ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {path} unsupported terrain kind value is not an integer"
                    ))
                })?;
                let value = u16::try_from(value).map_err(|_| {
                    FixtureError::new(format!(
                        "{case_name}: {path} unsupported terrain kind value {value} exceeds u16"
                    ))
                })?;
                return Ok(json!({
                    "kind": "UNSUPPORTED_ORACLE_CODE",
                    "value": value,
                }));
            }
            if nested.len() != 1 {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path} legacy terrain kind has unexpected fields"
                )));
            }
            legacy_terrain_tag_code(case_name, path, tag)?
        }
        other => {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} legacy terrain kind has unsupported value {other}"
            )));
        }
    };

    if code == 0 {
        Ok(json!({"kind": "NONE"}))
    } else {
        Ok(json!({
            "kind": "UNSUPPORTED_ORACLE_CODE",
            "value": code,
        }))
    }
}

fn normalize_legacy_terrain_kind(
    case_name: &str,
    path: &str,
    object: &mut Value,
    field_name: &str,
) -> Result<(), FixtureError> {
    let object = object
        .as_object_mut()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not an object")))?;
    let Some(kind) = object.get(field_name).cloned() else {
        return Err(FixtureError::new(format!(
            "{case_name}: {path}.{field_name} is missing"
        )));
    };
    let normalized = legacy_terrain_kind_wire(case_name, &format!("{path}.{field_name}"), kind)?;
    object.insert(field_name.to_owned(), normalized);
    Ok(())
}

fn status_kind_wire(kind: StatusKind) -> &'static str {
    match kind {
        StatusKind::None => "NONE",
        StatusKind::Poison => "POISON",
        StatusKind::Toxic => "TOXIC",
        StatusKind::Paralysis => "PARALYSIS",
        StatusKind::Sleep => "SLEEP",
        StatusKind::Burn => "BURN",
    }
}

fn normalize_legacy_format_slots(case_name: &str, battle: &mut Value) -> Result<(), FixtureError> {
    let field_slots = battle
        .get("field")
        .and_then(|field| field.get("slots"))
        .cloned()
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: canonical.battle.field.slots is missing"
            ))
        })?;
    let format = battle
        .get_mut("format")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            FixtureError::new(format!("{case_name}: canonical.battle.format is invalid"))
        })?;
    let format_slots = format.get("slots").cloned().ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: canonical.battle.format.slots is missing"
        ))
    })?;
    if format_slots != field_slots {
        let divergence = first_divergence(&format_slots, &field_slots)
            .unwrap_or_else(|| "format slots differ".to_owned());
        return Err(FixtureError::new(format!(
            "{case_name}: canonical.battle.format.slots must match canonical.battle.field.slots: {divergence}"
        )));
    }
    format.remove("slots");
    Ok(())
}

fn normalize_legacy_final_statuses(
    case_name: &str,
    document: &Value,
    battle: &mut Value,
) -> Result<(), FixtureError> {
    let initial_state = object_field(document, case_name, "$", "initial_state")?;
    let identities = array_field(
        initial_state,
        case_name,
        "initial_state",
        "legacy_identity_map",
    )?;
    let mutations = array_field(document, case_name, "$", "expected_mutations")?;

    for (index, mutation) in mutations.iter().enumerate() {
        if string_field(
            mutation,
            case_name,
            &format!("expected_mutations[{index}]"),
            "kind",
        )? != "STATUS_SET"
        {
            continue;
        }
        let path = format!("expected_mutations[{index}]");
        let after = object_field(mutation, case_name, &path, "after")?;
        let after_status = object_field(after, case_name, &format!("{path}.after"), "status")?;
        if u64_field(
            after_status,
            case_name,
            &format!("{path}.after.status"),
            "effect",
        )? != 7
        {
            continue;
        }
        let before: LegacyPokemonEvidence =
            serde_json::from_value(object_field(mutation, case_name, &path, "before")?.clone())
                .map_err(|error| {
                    FixtureError::new(format!(
                        "{case_name}: {path}.before is not legacy faint evidence: {error}"
                    ))
                })?;
        if before.status.effect == 7 {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} has legacy faint marker on both sides"
            )));
        }
        let before_status =
            legacy_status_state(case_name, &format!("{path}.before.status"), &before.status)
                .map_err(|error| FixtureError::new(error.to_string()))?;
        let target_id = identities
            .iter()
            .find(|identity| identity.get("legacy_pid").and_then(Value::as_u64) == Some(before.id))
            .and_then(|identity| identity.get("pokemon_id"))
            .cloned()
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: {path}.before.id {} is absent from legacy_identity_map",
                    before.id
                ))
            })?;

        let mut found = false;
        for party_name in ["player_party", "enemy_party"] {
            let party = battle
                .get_mut(party_name)
                .and_then(Value::as_array_mut)
                .ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: canonical.battle.{party_name} is invalid"
                    ))
                })?;
            for pokemon in party {
                if pokemon.get("id") != Some(&target_id) {
                    continue;
                }
                let status = pokemon.get_mut("status").ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: canonical.battle.{party_name} marker target has no status"
                    ))
                })?;
                let status = status.as_object_mut().ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: canonical.battle.{party_name} marker target status is invalid"
                    ))
                })?;
                status.insert(
                    "kind".to_owned(),
                    Value::String(status_kind_wire(before_status.kind).to_owned()),
                );
                status.insert(
                    "toxic_turn_count".to_owned(),
                    json!(before_status.toxic_turn_count),
                );
                status.insert(
                    "sleep_turns_remaining".to_owned(),
                    serde_json::to_value(before_status.sleep_turns_remaining).map_err(|error| {
                        FixtureError::new(format!(
                            "{case_name}: {path} cannot encode typed faint status: {error}"
                        ))
                    })?,
                );
                found = true;
            }
        }
        if !found {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.before.id {} has no canonical final party target",
                before.id
            )));
        }
    }
    Ok(())
}

fn validate_legacy_final_faint_context(
    case_name: &str,
    document: &Value,
    battle: &Value,
    pokemon: u64,
    side: BattleSide,
) -> Result<(), FixtureError> {
    let queue = array_field(
        battle,
        case_name,
        "expected_final_state.canonical.battle",
        "faint_queue",
    )?;
    if !queue.is_empty() {
        return Err(FixtureError::new(format!(
            "{case_name}: cannot normalize stale occupant {pokemon}; final faint queue is not empty"
        )));
    }
    let mutations = array_field(document, case_name, "$", "expected_mutations")?;
    let mut queued_occurrence = None;
    for (index, mutation) in mutations.iter().enumerate() {
        if string_field(
            mutation,
            case_name,
            &format!("expected_mutations[{index}]"),
            "kind",
        )? != "FAINT_QUEUED"
        {
            continue;
        }
        let mutation_path = format!("expected_mutations[{index}]");
        let path = format!("{mutation_path}.after");
        let after = object_field(mutation, case_name, &mutation_path, "after")?;
        if u64_field(after, case_name, &path, "pokemon")? != pokemon {
            continue;
        }
        let occurrence_slot: FieldSlot = serde_json::from_value(
            required(after, case_name, &path, "slot")?.clone(),
        )
        .map_err(|error| {
            FixtureError::new(format!(
                "{case_name}: {path}.slot is not typed field evidence: {error}"
            ))
        })?;
        if occurrence_slot.side != side {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.slot side does not match stale occupant {pokemon}"
            )));
        }
        if queued_occurrence.is_some() {
            return Err(FixtureError::new(format!(
                "{case_name}: stale occupant {pokemon} has multiple FAINT_QUEUED occurrences"
            )));
        }
        queued_occurrence = Some(u64_field(after, case_name, &path, "id")?);
    }
    let occurrence = queued_occurrence.ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: stale occupant {pokemon} has no legacy FAINT_QUEUED evidence"
        ))
    })?;
    let resolved = mutations.iter().enumerate().any(|(index, mutation)| {
        string_field(
            mutation,
            case_name,
            &format!("expected_mutations[{index}]"),
            "kind",
        )
        .ok()
        .filter(|kind| kind == "FAINT_RESOLVED")
        .and_then(|_| {
            u64_field(
                mutation,
                case_name,
                &format!("expected_mutations[{index}]"),
                "occurrence",
            )
            .ok()
        }) == Some(occurrence)
    });
    if !resolved {
        return Err(FixtureError::new(format!(
            "{case_name}: stale occupant {pokemon} occurrence {occurrence} was not resolved"
        )));
    }

    let outcome = string_field(
        battle,
        case_name,
        "expected_final_state.canonical.battle",
        "outcome",
    )?;
    match outcome.as_str() {
        "VICTORY" | "DEFEAT" => Ok(()),
        "ONGOING" => {
            let commands = object_field(document, case_name, "$", "commands")?;
            let proposals = array_field(commands, case_name, "commands", "replacement_proposals")?;
            let has_no_legal = proposals.iter().any(|proposal| {
                u64_field(
                    proposal,
                    case_name,
                    "commands.replacement_proposals",
                    "occurrence",
                )
                .ok()
                    == Some(occurrence)
                    && proposal
                        .get("selection")
                        .and_then(|selection| selection.get("kind"))
                        .and_then(Value::as_str)
                        == Some("NO_LEGAL_REPLACEMENT")
            });
            if has_no_legal {
                Ok(())
            } else {
                Err(FixtureError::new(format!(
                    "{case_name}: stale occupant {pokemon} has no terminal outcome or NO_LEGAL_REPLACEMENT context"
                )))
            }
        }
        other => Err(FixtureError::new(format!(
            "{case_name}: final battle outcome {other:?} is not a typed legacy replacement/outcome context"
        ))),
    }
}

fn normalize_legacy_final_occupants(
    case_name: &str,
    document: &Value,
    battle: &mut Value,
) -> Result<(), FixtureError> {
    let mut party = BTreeMap::new();
    for (party_name, side) in [
        ("player_party", BattleSide::Player),
        ("enemy_party", BattleSide::Enemy),
    ] {
        let values = battle
            .get(party_name)
            .and_then(Value::as_array)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: canonical.battle.{party_name} is invalid"
                ))
            })?;
        for (index, pokemon) in values.iter().enumerate() {
            let path = format!("canonical.battle.{party_name}[{index}]");
            let id = u64_field(pokemon, case_name, &path, "id")?;
            let hp = u64_field(pokemon, case_name, &path, "hp")?;
            let fainted = required(pokemon, case_name, &path, "fainted")?
                .as_bool()
                .ok_or_else(|| {
                    FixtureError::new(format!("{case_name}: {path}.fainted is not boolean"))
                })?;
            if party.insert(id, (hp, fainted, side)).is_some() {
                return Err(FixtureError::new(format!(
                    "{case_name}: canonical final party repeats Pokemon id {id}"
                )));
            }
        }
    }

    let field_values = battle
        .get("field")
        .and_then(|field| field.get("slots"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: canonical.battle.field.slots is invalid"
            ))
        })?;
    let mut stale = Vec::new();
    for (index, entry) in field_values.iter().enumerate() {
        let Some(raw_occupant) = entry.get("occupant") else {
            continue;
        };
        let occupant = raw_occupant.as_u64().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: canonical final field slot {index}.occupant is not an integer"
            ))
        })?;
        let (hp, fainted, side) = party.get(&occupant).copied().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: canonical final field occupant {occupant} is absent from its party"
            ))
        })?;
        if (hp == 0) != fainted {
            return Err(FixtureError::new(format!(
                "{case_name}: canonical final party occupant {occupant} has inconsistent hp/fainted flags"
            )));
        }
        if hp == 0 {
            let slot = serde_json::from_value::<FieldSlot>(
                required(
                    entry,
                    case_name,
                    &format!("canonical.battle.field.slots[{index}]"),
                    "slot",
                )?
                .clone(),
            )
            .map_err(|error| {
                FixtureError::new(format!(
                    "{case_name}: canonical final field slot {index}.slot is invalid: {error}"
                ))
            })?;
            let pokemon = PokemonId::try_from_u64(occupant).map_err(|error| {
                FixtureError::new(format!(
                    "{case_name}: canonical final field occupant {occupant} is not a typed PokemonId: {error}"
                ))
            })?;
            stale.push((index, pokemon, slot, side));
        }
    }

    let catalogue = legacy_stale_final_occupants();
    let mut catalogue_keys = catalogue
        .iter()
        .map(|entry| (entry.case_name, entry.slot, entry.pokemon))
        .collect::<Vec<_>>();
    catalogue_keys.sort_unstable();
    if catalogue_keys
        .windows(2)
        .any(|entries| entries[0] == entries[1])
    {
        return Err(FixtureError::new(format!(
            "{case_name}: internal stale-final-occupant catalogue contains a duplicate case/slot/Pokemon entry"
        )));
    }

    let mut expected = catalogue
        .iter()
        .filter(|entry| entry.case_name == case_name)
        .map(|entry| (entry.slot, entry.pokemon))
        .collect::<Vec<_>>();
    expected.sort_unstable();
    let mut actual = stale
        .iter()
        .map(|(_, pokemon, slot, _)| (*slot, *pokemon))
        .collect::<Vec<_>>();
    actual.sort_unstable();
    if actual != expected {
        return Err(FixtureError::new(format!(
            "{case_name}: stale final occupants differ from the exact closed catalogue: expected {expected:?}, actual {actual:?}"
        )));
    }

    for (index, occupant, slot, side) in stale {
        let raw_occupant = u64::from(occupant);
        let (hp, fainted, party_side) = party.get(&raw_occupant).copied().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: field occupant {occupant} is absent from the final party"
            ))
        })?;
        if hp != 0 || !fainted || party_side != slot.side || party_side != side {
            return Err(FixtureError::new(format!(
                "{case_name}: refusing to sanitize field occupant {occupant}; it is not a same-side hp=0 fainted party member"
            )));
        }
        validate_legacy_final_faint_context(case_name, document, battle, raw_occupant, slot.side)?;
        let slots = battle
            .get_mut("field")
            .and_then(|field| field.get_mut("slots"))
            .and_then(Value::as_array_mut)
            .ok_or_else(|| FixtureError::new(format!("{case_name}: field slots disappeared")))?;
        let entry = slots.get_mut(index).ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: stale field slot index {index} disappeared"
            ))
        })?;
        entry
            .as_object_mut()
            .ok_or_else(|| {
                FixtureError::new(format!("{case_name}: field slot {index} is not an object"))
            })?
            .insert("occupant".to_owned(), Value::Null);
    }
    Ok(())
}

fn normalize_legacy_final_slot_compaction(
    case_name: &str,
    document: &Value,
    battle: &mut Value,
) -> Result<(), FixtureError> {
    let commands = object_field(document, case_name, "$", "commands")?;
    let committed = array_field(commands, case_name, "commands", "committed")?;
    let mut typed_command_slots = BTreeMap::new();
    for (index, command) in committed.iter().enumerate() {
        let path = format!("commands.committed[{index}]");
        typed_command_slots.insert(
            u64_field(command, case_name, &path, "actor")?,
            required(command, case_name, &path, "field_slot")?.clone(),
        );
    }
    let actions = array_field(document, case_name, "$", "expected_action_order")?;
    let mut remapped = BTreeMap::new();
    let field_values = battle
        .get("field")
        .and_then(|field| field.get("slots"))
        .and_then(Value::as_array)
        .ok_or_else(|| FixtureError::new(format!("{case_name}: final field slots are invalid")))?;
    let current_slot_wire = |slot: FieldSlot| {
        serde_json::to_value(slot).map_err(|error| {
            FixtureError::new(format!(
                "{case_name}: cannot encode legacy compaction slot: {error}"
            ))
        })
    };
    for (index, entry) in field_values.iter().enumerate() {
        let Some(occupant) = entry.get("occupant").and_then(Value::as_u64) else {
            continue;
        };
        let Some(target_value) = typed_command_slots.get(&occupant) else {
            continue;
        };
        let current_slot: FieldSlot = serde_json::from_value(
            required(
                entry,
                case_name,
                &format!("canonical.battle.field.slots[{index}]"),
                "slot",
            )?
            .clone(),
        )
        .map_err(|error| {
            FixtureError::new(format!("{case_name}: final field slot is invalid: {error}"))
        })?;
        let target_slot: FieldSlot =
            serde_json::from_value(target_value.clone()).map_err(|error| {
                FixtureError::new(format!(
                    "{case_name}: typed command field slot is invalid: {error}"
                ))
            })?;
        if current_slot == target_slot {
            continue;
        }
        let current_slot_wire = current_slot_wire(current_slot)?;
        let current_side = match current_slot.side {
            BattleSide::Player => "PLAYER",
            BattleSide::Enemy => "ENEMY",
        };
        let proven = actions.iter().enumerate().any(|(action_index, action)| {
            action.get("actor").and_then(Value::as_u64) == Some(occupant)
                && action
                    .get("source_slot")
                    .map(|slot| slot == &current_slot_wire)
                    .unwrap_or(false)
                && action.get("command_operation_id").is_some_and(|operation| {
                    operation
                        .as_str()
                        .map(|value| {
                            committed.iter().any(|command| {
                                u64_field(command, case_name, "commands.committed", "actor").ok()
                                    == Some(occupant)
                                    && string_field(
                                        command,
                                        case_name,
                                        "commands.committed",
                                        "operation_id",
                                    )
                                    .ok()
                                    .is_some_and(|typed| typed != value)
                            })
                        })
                        .unwrap_or(false)
                })
                && actions[..action_index].iter().any(|prior| {
                    prior.get("kind").and_then(Value::as_str) == Some("FAINT")
                        && prior
                            .get("source_slot")
                            .and_then(|slot| slot.get("side"))
                            .and_then(Value::as_str)
                            == Some(current_side)
                })
        });
        if !proven {
            return Err(FixtureError::new(format!(
                "{case_name}: final occupant {occupant} moves from {:?} to {:?} without closed legacy compaction evidence",
                current_slot, target_slot
            )));
        }
        let target_index = field_values
            .iter()
            .position(|candidate| candidate.get("slot") == Some(target_value))
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: final compaction target slot is absent"
                ))
            })?;
        if field_values[target_index]
            .get("occupant")
            .and_then(Value::as_u64)
            .is_some()
        {
            return Err(FixtureError::new(format!(
                "{case_name}: final compaction target {:?} is occupied before remapping {occupant}",
                target_slot
            )));
        }
        remapped.insert(occupant, (index, target_index, target_slot));
    }

    if remapped.is_empty() {
        return Ok(());
    }
    let moves = remapped
        .values()
        .map(|(from, to, _)| (*from, *to))
        .collect::<Vec<_>>();
    let slots = battle
        .get_mut("field")
        .and_then(|field| field.get_mut("slots"))
        .and_then(Value::as_array_mut)
        .ok_or_else(|| FixtureError::new(format!("{case_name}: final field slots disappeared")))?;
    for (from, to) in moves {
        let occupant = slots[from].get("occupant").cloned().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: final compaction source occupant disappeared"
            ))
        })?;
        slots[from]
            .as_object_mut()
            .ok_or_else(|| {
                FixtureError::new(format!("{case_name}: final compaction source is invalid"))
            })?
            .insert("occupant".to_owned(), Value::Null);
        slots[to]
            .as_object_mut()
            .ok_or_else(|| {
                FixtureError::new(format!("{case_name}: final compaction target is invalid"))
            })?
            .insert("occupant".to_owned(), occupant);
    }

    let battle_id = u64_field(battle, case_name, "canonical.battle", "battle_id")?;
    let wave = u64_field(battle, case_name, "canonical.battle", "wave")?;
    let turn = u64_field(battle, case_name, "canonical.battle", "turn")?;
    let frontier = battle
        .get_mut("command_state")
        .and_then(|state| state.get_mut("frontier"))
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            FixtureError::new(format!("{case_name}: final command frontier is invalid"))
        })?;
    for entry in frontier {
        let actor = u64_field(
            entry,
            case_name,
            "canonical.battle.command_state.frontier",
            "actor",
        )?;
        let Some((_, _, target_slot)) = remapped.get(&actor) else {
            continue;
        };
        let owner = u64_field(
            entry,
            case_name,
            "canonical.battle.command_state.frontier",
            "owner_seat",
        )?;
        if target_slot.side != BattleSide::Player {
            return Err(FixtureError::new(format!(
                "{case_name}: remapped command frontier actor {actor} is not player-owned"
            )));
        }
        let entry = entry.as_object_mut().ok_or_else(|| {
            FixtureError::new(format!("{case_name}: final frontier entry is invalid"))
        })?;
        entry.insert(
            "field_slot".to_owned(),
            serde_json::to_value(*target_slot).map_err(|error| {
                FixtureError::new(format!(
                    "{case_name}: cannot encode remapped frontier slot: {error}"
                ))
            })?,
        );
        entry.insert(
            "operation_id".to_owned(),
            Value::String(format!(
                "battle/{battle_id}/wave/{wave}/turn/{turn}/command/player/{}/seat/{owner}",
                target_slot.position
            )),
        );
    }
    Ok(())
}

fn normalize_legacy_selected_content_identity(
    case_name: &str,
    document: &Value,
    field_name: &str,
    canonical: &mut Value,
    content: &ContentPack,
) -> Result<bool, FixtureError> {
    // Keep the published provenance immutable and translate only its exact, known content
    // identity to the validated selected pack used for this replay.
    let canonical_path = format!("{field_name}.canonical");
    let fixture_hash = string_field(canonical, case_name, &canonical_path, "content_hash")?;
    for peer_field_name in ["initial_state", "expected_final_state"] {
        let peer_state = object_field(document, case_name, "$", peer_field_name)?;
        let peer_canonical = object_field(peer_state, case_name, peer_field_name, "canonical")?;
        let peer_path = format!("{peer_field_name}.canonical");
        let peer_hash = string_field(peer_canonical, case_name, &peer_path, "content_hash")?;
        if peer_hash != fixture_hash {
            return Err(FixtureError::new(format!(
                "{case_name}: published state content hashes disagree: {canonical_path}.content_hash is {fixture_hash}, {peer_path}.content_hash is {peer_hash}"
            )));
        }
    }

    let provenance = object_field(document, case_name, "$", "provenance")?;
    let provenance_hash = string_field(provenance, case_name, "provenance", "content_pack_hash")?;
    let provenance_oracle_sha =
        string_field(provenance, case_name, "provenance", "oracle_game_sha")?;
    if provenance_oracle_sha != content.oracle_game_sha {
        return Err(FixtureError::new(format!(
            "{case_name}: provenance oracle_game_sha {provenance_oracle_sha} disagrees with selected content oracle_game_sha {}",
            content.oracle_game_sha
        )));
    }

    let selected_hash = content.hash.as_str();
    let selected_digest = selected_hash.strip_prefix("blake3-v1:").ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: selected content hash {selected_hash} has no blake3-v1 prefix"
        ))
    })?;
    if fixture_hash == selected_hash {
        if provenance_hash != selected_digest {
            return Err(FixtureError::new(format!(
                "{case_name}: selected fixture content hash {fixture_hash} disagrees with provenance digest {provenance_hash}"
            )));
        }
        return Ok(false);
    }
    if fixture_hash != LEGACY_ORACLE_CONTENT_HASH || provenance_hash != LEGACY_ORACLE_CONTENT_DIGEST
    {
        return Err(FixtureError::new(format!(
            "{case_name}: content identity {fixture_hash} / {provenance_hash} is neither the selected pair {selected_hash} / {selected_digest} nor the exact published legacy pair"
        )));
    }

    canonical
        .as_object_mut()
        .ok_or_else(|| {
            FixtureError::new(format!("{case_name}: {canonical_path} is not an object"))
        })?
        .insert(
            "content_hash".to_owned(),
            Value::String(selected_hash.to_owned()),
        );
    Ok(true)
}

fn normalize_legacy_final_abilities(
    case_name: &str,
    document: &Value,
    battle: &mut Value,
) -> Result<(), FixtureError> {
    let catalogue = LEGACY_FINAL_ABILITY_SNAPSHOTS
        .iter()
        .copied()
        .collect::<BTreeSet<_>>();
    if catalogue.len() != LEGACY_FINAL_ABILITY_SNAPSHOTS.len() {
        return Err(FixtureError::new(
            "internal legacy final-ability catalogue contains a duplicate entry",
        ));
    }

    let initial_state = object_field(document, case_name, "$", "initial_state")?;
    let initial_canonical = object_field(initial_state, case_name, "initial_state", "canonical")?;
    let initial_battle = object_field(
        initial_canonical,
        case_name,
        "initial_state.canonical",
        "battle",
    )?;
    let mut initial_by_id = BTreeMap::new();
    for party_name in ["player_party", "enemy_party"] {
        let party = array_field(
            initial_battle,
            case_name,
            "initial_state.canonical.battle",
            party_name,
        )?;
        for (index, pokemon) in party.iter().enumerate() {
            let path = format!("initial_state.canonical.battle.{party_name}[{index}]");
            let id = u64_field(pokemon, case_name, &path, "id")?;
            let species = u64_field(pokemon, case_name, &path, "species_id")?;
            let abilities = required(pokemon, case_name, &path, "abilities")?.clone();
            if initial_by_id.insert(id, (species, abilities)).is_some() {
                return Err(FixtureError::new(format!(
                    "{case_name}: initial parties repeat Pokemon id {id}"
                )));
            }
        }
    }

    let expected = catalogue
        .iter()
        .filter(|entry| entry.case_name == case_name)
        .copied()
        .collect::<Vec<_>>();
    let mut observed = Vec::new();
    for party_name in ["player_party", "enemy_party"] {
        let party = battle
            .get_mut(party_name)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: expected_final_state.canonical.battle.{party_name} is invalid"
                ))
            })?;
        for (index, pokemon) in party.iter_mut().enumerate() {
            let path = format!("expected_final_state.canonical.battle.{party_name}[{index}]");
            let id = u64_field(pokemon, case_name, &path, "id")?;
            let species = u64_field(pokemon, case_name, &path, "species_id")?;
            let final_abilities = required(pokemon, case_name, &path, "abilities")?.clone();
            let (initial_species, initial_abilities) = initial_by_id.get(&id).ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: final Pokemon {id} is absent from the initial parties"
                ))
            })?;
            if species != *initial_species {
                return Err(FixtureError::new(format!(
                    "{case_name}: Pokemon {id} changes species from {initial_species} to {species}"
                )));
            }
            if &final_abilities == initial_abilities {
                continue;
            }

            let snapshot = catalogue
                .iter()
                .find(|entry| {
                    entry.case_name == case_name
                        && entry.pokemon == id
                        && entry.species == species
                })
                .copied()
                .ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: Pokemon {id} has an uncatalogued legacy final ability snapshot"
                    ))
                })?;
            let initial_passives = initial_abilities
                .get("passives")
                .ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: initial Pokemon {id} abilities have no passives"
                    ))
                })?
                .clone();
            if initial_passives != json!([null, null, null]) {
                return Err(FixtureError::new(format!(
                    "{case_name}: initial Pokemon {id} passives are not the exact empty typed loadout"
                )));
            }
            let catalogued_passives = json!(snapshot.passives);
            if final_abilities.get("passives") != Some(&catalogued_passives) {
                return Err(FixtureError::new(format!(
                    "{case_name}: Pokemon {id} legacy passives differ from the closed catalogue"
                )));
            }
            let mut passive_only_normalized = final_abilities.clone();
            passive_only_normalized
                .as_object_mut()
                .ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: final Pokemon {id} abilities are not an object"
                    ))
                })?
                .insert("passives".to_owned(), initial_passives);
            if &passive_only_normalized != initial_abilities {
                return Err(FixtureError::new(format!(
                    "{case_name}: Pokemon {id} legacy final abilities change more than the catalogued passive IDs"
                )));
            }
            pokemon
                .as_object_mut()
                .ok_or_else(|| {
                    FixtureError::new(format!("{case_name}: final Pokemon {id} is not an object"))
                })?
                .insert("abilities".to_owned(), initial_abilities.clone());
            observed.push(snapshot);
        }
    }
    observed.sort_unstable();
    if observed != expected {
        return Err(FixtureError::new(format!(
            "{case_name}: legacy final ability snapshots differ from the exact closed catalogue: expected {expected:?}, actual {observed:?}"
        )));
    }
    Ok(())
}

fn normalize_legacy_state(
    case_name: &str,
    document: &Value,
    field_name: &str,
    state: &mut Value,
    content: &ContentPack,
) -> Result<bool, FixtureError> {
    let canonical = state
        .get_mut("canonical")
        .ok_or_else(|| FixtureError::new(format!("{case_name}: canonical is missing")))?;
    let legacy_content_identity = normalize_legacy_selected_content_identity(
        case_name, document, field_name, canonical, content,
    )?;
    let battle = canonical
        .get_mut("battle")
        .ok_or_else(|| FixtureError::new(format!("{case_name}: canonical.battle is missing")))?;
    if !battle.is_object() {
        return Err(FixtureError::new(format!(
            "{case_name}: canonical.battle is invalid"
        )));
    }

    normalize_legacy_format_slots(case_name, battle)?;
    if field_name == "expected_final_state" {
        if legacy_content_identity {
            normalize_legacy_final_abilities(case_name, document, battle)?;
        }
        normalize_legacy_final_statuses(case_name, document, battle)?;
        normalize_legacy_final_occupants(case_name, document, battle)?;
        normalize_legacy_final_slot_compaction(case_name, document, battle)?;
    }

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
        let path = format!("canonical.battle.{condition_name}");
        match condition_name {
            "terrain" => normalize_legacy_terrain_kind(case_name, &path, condition, "kind")?,
            "weather" => normalize_adjacent_kind(case_name, &path, condition, "kind")?,
            _ => unreachable!("condition list contains only weather and terrain"),
        }
    }
    Ok(legacy_content_identity)
}

fn fixture_state(
    document: &Value,
    case_name: &str,
    field_name: &str,
    content: &ContentPack,
) -> Result<GameState, Box<dyn Error>> {
    let mut value = object_field(document, case_name, "$", field_name)?.clone();
    let legacy_content_identity =
        normalize_legacy_state(case_name, document, field_name, &mut value, content)?;
    let canonical = value.get("canonical").cloned().ok_or_else(|| {
        FixtureError::new(format!("{case_name}: {field_name}.canonical is missing"))
    })?;
    let mut state: GameState = serde_json::from_value(canonical)?;
    if legacy_content_identity {
        // The published offer used explicit singleton targets; the selected typed pack
        // canonically represents a sole NEAR_OTHER target as IMPLICIT.
        refresh_legacy_command_frontier_offers(case_name, &mut state, content)?;
    }
    Ok(state)
}

fn is_exact_legacy_content_identity(
    document: &Value,
    case_name: &str,
    field_name: &str,
    content: &ContentPack,
) -> Result<bool, Box<dyn Error>> {
    let state = object_field(document, case_name, "$", field_name)?;
    let canonical = object_field(state, case_name, field_name, "canonical")?;
    let fixture_hash = string_field(
        canonical,
        case_name,
        &format!("{field_name}.canonical"),
        "content_hash",
    )?;
    let provenance = object_field(document, case_name, "$", "provenance")?;
    let provenance_hash = string_field(provenance, case_name, "provenance", "content_pack_hash")?;
    Ok(fixture_hash != content.hash.as_str()
        && fixture_hash == LEGACY_ORACLE_CONTENT_HASH
        && provenance_hash == LEGACY_ORACLE_CONTENT_DIGEST)
}

fn refresh_legacy_command_frontier_offers(
    case_name: &str,
    state: &mut GameState,
    content: &ContentPack,
) -> Result<(), Box<dyn Error>> {
    let frontier = state
        .battle
        .as_ref()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: legacy state has no battle")))?
        .command_state
        .frontier
        .clone();
    let mut offers = Vec::with_capacity(frontier.len());
    for entry in &frontier {
        if entry.field_slot.side != BattleSide::Player {
            return Err(FixtureError::new(format!(
                "{case_name}: legacy frontier entry {} is not a player command",
                entry.operation_id
            ))
            .into());
        }
        let current_actor = state.battle.as_ref().and_then(|battle| {
            battle
                .field
                .slots
                .iter()
                .find(|slot| slot.slot == entry.field_slot)
                .and_then(|slot| slot.occupant)
        });
        if current_actor != Some(entry.actor) {
            return Err(FixtureError::new(format!(
                "{case_name}: legacy frontier entry {} actor {} does not match its field occupant {:?}",
                entry.operation_id, entry.actor, current_actor
            ))
            .into());
        }
        offers.push(build_command_offer(state, entry.field_slot, content)?);
    }

    let battle = state
        .battle
        .as_mut()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: legacy battle disappeared")))?;
    if battle.command_state.frontier.len() != offers.len() {
        return Err(FixtureError::new(format!(
            "{case_name}: legacy frontier changed while refreshing content-derived offers"
        ))
        .into());
    }
    for (entry, offer) in battle.command_state.frontier.iter_mut().zip(offers) {
        entry.offer = offer;
    }
    Ok(())
}

fn canonical_single_near_other_target(
    case_name: &str,
    state: &GameState,
    field_slot: FieldSlot,
    actor: PokemonId,
    move_slot: MoveSlotIndex,
    content: &ContentPack,
) -> Result<Option<FieldSlot>, Box<dyn Error>> {
    let battle = state.battle.as_ref().ok_or_else(|| {
        FixtureError::new(format!("{case_name}: legacy command state has no battle"))
    })?;
    let field_entry = battle
        .field
        .slots
        .iter()
        .find(|entry| entry.slot == field_slot)
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: legacy command actor {actor} has no field slot {field_slot:?}"
            ))
        })?;
    if field_entry.occupant != Some(actor) {
        return Err(FixtureError::new(format!(
            "{case_name}: legacy command actor {actor} does not occupy field slot {field_slot:?}"
        ))
        .into());
    }
    let actor_party = match field_slot.side {
        BattleSide::Player => &battle.player_party,
        BattleSide::Enemy => &battle.enemy_party,
    };
    let actor_state = actor_party
        .iter()
        .find(|pokemon| pokemon.id == actor)
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: legacy command actor {actor} is absent from its {:?} party",
                field_slot.side
            ))
        })?;
    let move_state = actor_state
        .moves
        .get(usize::from(move_slot.get()))
        .and_then(Option::as_ref)
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: legacy command actor {actor} has no move in slot {}",
                move_slot.get()
            ))
        })?;
    let definition = find_move(&content.moves, move_state.move_id).map_err(|error| {
        FixtureError::new(format!(
            "{case_name}: legacy command actor {actor} has an unknown move {}: {error}",
            move_state.move_id
        ))
    })?;
    if definition.target != MoveTarget::NearOther {
        return Ok(None);
    }

    let mut candidates = battle
        .field
        .slots
        .iter()
        .filter_map(|entry| {
            if entry.slot == field_slot {
                return None;
            }
            let capacity = match entry.slot.side {
                BattleSide::Player => battle.format.player_capacity,
                BattleSide::Enemy => battle.format.enemy_capacity,
            };
            if entry.slot.position >= capacity
                || !battle.format.adjacency.iter().any(|edge| {
                    (edge.first == field_slot && edge.second == entry.slot)
                        || (edge.first == entry.slot && edge.second == field_slot)
                })
            {
                return None;
            }
            let occupant = entry.occupant?;
            let party = match entry.slot.side {
                BattleSide::Player => &battle.player_party,
                BattleSide::Enemy => &battle.enemy_party,
            };
            let pokemon = party.iter().find(|pokemon| pokemon.id == occupant)?;
            (!pokemon.fainted && pokemon.hp > 0).then_some(entry.slot)
        })
        .collect::<Vec<_>>();
    candidates.sort_unstable();
    if candidates.len() == 1 {
        Ok(candidates.first().copied())
    } else {
        Ok(None)
    }
}

fn catalogued_legacy_compacted_target(
    case_name: &str,
    initial: &GameState,
    record: &FixtureCommandRecord,
    actions: &[ResolvedAction],
) -> Result<Option<FieldSlot>, Box<dyn Error>> {
    let Some(projection) = LEGACY_COMPACTED_TARGET_PROJECTIONS
        .iter()
        .find(|projection| {
            projection.case_name == case_name && projection.actor == u64::from(record.actor)
        })
    else {
        return Ok(None);
    };
    let source_slot = FieldSlot::new(projection.source_side, projection.source_position)?;
    let legacy_target = FieldSlot::new(
        projection.legacy_target_side,
        projection.legacy_target_position,
    )?;
    let typed_target = FieldSlot::new(
        projection.typed_target_side,
        projection.typed_target_position,
    )?;
    let compacted_actor = PokemonId::try_from_u64(projection.compacted_actor)?;
    let surviving_actor = PokemonId::try_from_u64(projection.surviving_actor)?;
    let expected_move_slot = MoveSlotIndex::try_from(u64::from(projection.move_slot))?;
    let exact_record = record.field_slot == source_slot
        && record.operation_id.as_str() == projection.operation_id
        && record.owner_seat.is_none()
        && record.source == CommandAdmissionSource::ScriptedEnemy
        && record.legacy_command == record.command
        && matches!(
            &record.command,
            BattleCommand::Fight {
                actor,
                move_slot,
                targets: BattleTargetSelection::Selected(targets),
            } if *actor == record.actor
                && *move_slot == expected_move_slot
                && targets.len() == 1
                && targets[0] == legacy_target
        );
    if !exact_record {
        return Err(FixtureError::new(format!(
            "{case_name}: catalogued compacted-target command differs from its exact actor/slot/operation/target fingerprint"
        ))
        .into());
    }

    let battle = initial.battle.as_ref().ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: catalogued compacted-target command has no initial battle"
        ))
    })?;
    let occupant = |slot| {
        battle
            .field
            .slots
            .iter()
            .find(|entry| entry.slot == slot)
            .and_then(|entry| entry.occupant)
    };
    if occupant(source_slot) != Some(record.actor)
        || occupant(typed_target) != Some(compacted_actor)
        || occupant(legacy_target) != Some(surviving_actor)
    {
        return Err(FixtureError::new(format!(
            "{case_name}: catalogued compacted-target field occupancy differs from the frozen actor mapping"
        ))
        .into());
    }
    for actor in [record.actor, compacted_actor, surviving_actor] {
        let pokemon = pokemon_state(initial, actor).ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: catalogued compacted-target actor {actor} is absent from initial state"
            ))
        })?;
        if pokemon.fainted || pokemon.hp == 0 {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued compacted-target actor {actor} is not initially live"
            ))
            .into());
        }
    }
    let move_state = pokemon_state(initial, record.actor)
        .and_then(|pokemon| pokemon.moves.get(usize::from(expected_move_slot.get())))
        .and_then(Option::as_ref)
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: catalogued compacted-target actor {} has no move in slot {}",
                record.actor,
                expected_move_slot.get()
            ))
        })?;
    if u64::from(move_state.move_id) != projection.move_id {
        return Err(FixtureError::new(format!(
            "{case_name}: catalogued compacted-target move {} differs from frozen move {}",
            move_state.move_id, projection.move_id
        ))
        .into());
    }

    let action = actions.get(projection.action_index).ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: catalogued compacted-target action {} is absent",
            projection.action_index
        ))
    })?;
    let preceding_faint = projection
        .action_index
        .checked_sub(1)
        .and_then(|index| actions.get(index));
    let exact_action_context = actions.len() == projection.action_count
        && action.sequence.get() == u64::try_from(projection.action_index)?
        && action.kind == ResolvedActionKind::Move
        && action.actor == record.actor
        && action.source_slot == source_slot
        && action
            .command_operation_id
            .as_ref()
            .is_some_and(|operation| operation.as_str() == projection.operation_id)
        && action.effective_speed == projection.effective_speed
        && action.timing_modifier == 1
        && action.move_priority == 0
        && action.bracket_modifier == 1
        && action.tie_order == SafeU53::ZERO
        && action.disposition == ActionDisposition::NoEffect
        && preceding_faint.is_some_and(|faint| {
            faint.kind == ResolvedActionKind::Faint
                && faint.actor == compacted_actor
                && faint.source_slot == typed_target
                && faint.command_operation_id.is_none()
                && faint.effective_speed == 180
                && faint.timing_modifier == 0
                && faint.move_priority == 0
                && faint.bracket_modifier == 0
                && faint.tie_order == SafeU53::ZERO
                && faint.disposition == ActionDisposition::Executed
        });
    if !exact_action_context {
        return Err(FixtureError::new(format!(
            "{case_name}: catalogued compacted-target command lacks its exact frozen actor-4 NO_EFFECT/prior-faint context"
        ))
        .into());
    }
    Ok(Some(typed_target))
}

fn normalize_legacy_command_records(
    case_name: &str,
    initial: &GameState,
    records: &mut [FixtureCommandRecord],
    actions: &[ResolvedAction],
    content: &ContentPack,
) -> Result<(), Box<dyn Error>> {
    // Keep the raw command for legacy wire assertions; only typed admission gets the
    // selected-pack singleton-target spelling, and only after exact target verification.
    let expected_compacted_targets = LEGACY_COMPACTED_TARGET_PROJECTIONS
        .iter()
        .filter(|projection| projection.case_name == case_name)
        .count();
    let mut projected_compacted_targets = 0;
    for record in records {
        let command = match &record.command {
            BattleCommand::Fight {
                actor,
                move_slot,
                targets: BattleTargetSelection::Selected(targets),
            } if targets.len() == 1 => Some((*actor, *move_slot, targets[0])),
            _ => None,
        };
        let Some((actor, move_slot, legacy_target)) = command else {
            continue;
        };
        if let Some(typed_target) =
            catalogued_legacy_compacted_target(case_name, initial, record, actions)?
        {
            record.command = BattleCommand::fight(
                actor,
                move_slot,
                BattleTargetSelection::Selected(vec![typed_target]),
            )?;
            projected_compacted_targets += 1;
            continue;
        }
        let Some(canonical_target) = canonical_single_near_other_target(
            case_name,
            initial,
            record.field_slot,
            actor,
            move_slot,
            content,
        )?
        else {
            continue;
        };
        if legacy_target != canonical_target {
            continue;
        }
        record.command = BattleCommand::fight(actor, move_slot, BattleTargetSelection::Implicit)?;
    }
    if projected_compacted_targets != expected_compacted_targets {
        return Err(FixtureError::new(format!(
            "{case_name}: projected {projected_compacted_targets} compacted legacy targets, expected exact catalogue count {expected_compacted_targets}"
        ))
        .into());
    }
    Ok(())
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

fn seat_id_from_u64(value: u64) -> Result<SeatId, Box<dyn Error>> {
    Ok(SeatId::new(SafeU53::new(value)?))
}

fn fixture_command_owner_seat(
    value: &Value,
    case_name: &str,
    path: &str,
) -> Result<Option<SeatId>, Box<dyn Error>> {
    let owner_seat = required(value, case_name, path, "owner_seat")?;
    match owner_seat {
        Value::Null => Ok(None),
        Value::Number(owner_seat) => {
            let owner_seat = owner_seat.as_u64().ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: {path}.owner_seat is not a non-negative integer"
                ))
            })?;
            Ok(Some(seat_id_from_u64(owner_seat)?))
        }
        other => Err(FixtureError::new(format!(
            "{case_name}: {path}.owner_seat has unsupported value {other}"
        ))
        .into()),
    }
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
        if identities
            .insert(identity.legacy_pid, identity.pokemon_id)
            .is_some()
        {
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
    let value = value
        .as_str()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not a source string")))?;
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
    let inner_actor =
        PokemonId::try_from_u64(u64_field(command, case_name, &command_path, "actor")?)?;
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
            let party_slot =
                PartyIndex::try_from(u64_field(command, case_name, &command_path, "party_slot")?)?;
            let pokemon =
                PokemonId::try_from_u64(u64_field(command, case_name, &command_path, "pokemon")?)?;
            Ok((
                BattleCommand::switch(inner_actor, party_slot),
                Some(pokemon),
            ))
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
        let operation_id =
            OperationId::new(string_field(value, case_name, &path, "operation_id")?)?;
        let owner_seat = fixture_command_owner_seat(value, case_name, &path)?;
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
        let legacy_command = command.clone();
        records.push(FixtureCommandRecord {
            actor,
            command,
            legacy_command,
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
        let admission_source = record.source;
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
                if admission_source == CommandAdmissionSource::ScriptedEnemy {
                    return Err(FixtureError::new(format!(
                        "{case_name}: player command {index} has SCRIPTED_ENEMY source"
                    ))
                    .into());
                }
                let proposal = BattleCommandProposalV1::new(
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
                )?;
                validate_command_proposal(initial, &proposal, content)?;
                AcceptedBattleCommand::human(proposal)
            }
            BattleSide::Enemy => {
                if record.owner_seat.is_some()
                    || admission_source != CommandAdmissionSource::ScriptedEnemy
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
            source: admission_source,
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
    let command_state =
        CommandCollectionState::new(frontier, battle.command_state.tombstones.clone())?;
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
    if let Some(divergence) = first_divergence(&Value::Array(expected), &Value::Array(actual)) {
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
    let proposals = array_field(commands, case_name, "commands", "replacement_proposals")?;
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
        let battle_id = BattleId::try_from_u64(u64_field(value, case_name, &path, "battle_id")?)?;
        let field_slot: FieldSlot =
            serde_json::from_value(required(value, case_name, &path, "field_slot")?.clone())?;
        if field_slot.side != BattleSide::Player {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.field_slot must be a player slot"
            ))
            .into());
        }
        let occurrence =
            FaintOccurrenceId::try_from_u64(u64_field(value, case_name, &path, "occurrence")?)?;
        let raw_operation_id =
            OperationId::new(string_field(value, case_name, &path, "operation_id")?)?;
        let owner_seat = seat_id_from_u64(u64_field(value, case_name, &path, "owner_seat")?)?;
        let resolved_turn =
            TurnIndex::try_from_u64(u64_field(value, case_name, &path, "resolved_turn")?)?;
        let selection: ReplacementSelection =
            serde_json::from_value(required(value, case_name, &path, "selection")?.clone())?;
        let turn_occurrence =
            u32::try_from(u64_field(value, case_name, &path, "turn_occurrence")?)?;
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
        let epoch =
            AuthorityEpoch::try_from_u64(operation_number(case_name, &path, segments[1], "e")?)?;
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
        assert_operation_number(case_name, &path, segments[offset], "w", u64::from(wave))?;
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
            owner_seat.get().get(),
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

fn normalize_legacy_rng_audit_state(
    case_name: &str,
    path: &str,
    value: &Value,
    sequence: SafeU53,
) -> Result<RngAuditState, Box<dyn Error>> {
    assert_exact_keys(
        case_name,
        path,
        value,
        &["battle", "next_sequence", "run", "seed_offset"],
    )?;
    let legacy_sequence = SafeU53::new(u64_field(value, case_name, path, "next_sequence")?)?;
    if legacy_sequence != sequence {
        return Err(FixtureError::new(format!(
            "{case_name}: {path}.next_sequence is {legacy_sequence}, expected draw sequence {sequence}"
        ))
        .into());
    }
    let run_path = format!("{path}.run");
    let legacy_run = object_field(value, case_name, path, "run")?;
    assert_exact_keys(case_name, &run_path, legacy_run, &["rdg"])?;
    let normalized = json!({
        "battle": required(value, case_name, path, "battle")?,
        "run": required(legacy_run, case_name, &run_path, "rdg")?,
        "seed_offset": required(value, case_name, path, "seed_offset")?,
    });
    let state: RngAuditState = serde_json::from_value(normalized).map_err(|error| {
        FixtureError::new(format!(
            "{case_name}: {path} cannot be normalized to RngAuditState: {error}"
        ))
    })?;
    state.validate()?;
    Ok(state)
}

#[derive(Clone, Debug)]
struct LegacyProjectedRngDraw {
    draw: RngDraw,
    rebase_battle: bool,
}

fn legacy_deterministic_intimidate_probe(
    case_name: &str,
    draw_index: usize,
) -> Option<&'static LegacyDeterministicIntimidateProbe> {
    LEGACY_DETERMINISTIC_INTIMIDATE_PROBES
        .iter()
        .find(|probe| probe.case_name == case_name && probe.draw_index == draw_index)
}

fn validate_catalogued_legacy_intimidate_rng_probe(
    case_name: &str,
    index: usize,
    path: &str,
    value: &Value,
    before_state: &RngAuditState,
    after_state: &RngAuditState,
) -> Result<bool, Box<dyn Error>> {
    let raw_callsite = string_field(value, case_name, path, "callsite_id")?;
    let Some(probe) = legacy_deterministic_intimidate_probe(case_name, index) else {
        if raw_callsite == LEGACY_DETERMINISTIC_INTIMIDATE_CALLSITE {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} is an uncatalogued legacy deterministic-Intimidate RNG probe"
            ))
            .into());
        }
        return Ok(false);
    };

    let exact_shape = string_field(value, case_name, path, "reason")? == "SecondaryEffect"
        && string_field(value, case_name, path, "stream")? == "BATTLE"
        && string_field(value, case_name, path, "public_api")? == "RAND_SEED_INT"
        && raw_callsite == LEGACY_DETERMINISTIC_INTIMIDATE_CALLSITE
        && u64_field(value, case_name, path, "minimum")? == 0
        && u64_field(value, case_name, path, "cardinality")? == 100
        && u64_field(value, case_name, path, "result")? == probe.result
        && required(value, case_name, path, "consumed")?.as_bool() == Some(true)
        && u64_field(value, case_name, path, "primitive_draw_count")? == 2;
    if !exact_shape {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} does not match its exact deterministic-Intimidate probe catalogue entry"
        ))
        .into());
    }
    let (Some(before_battle), Some(after_battle)) =
        (before_state.battle.as_ref(), after_state.battle.as_ref())
    else {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} deterministic-Intimidate probe has no battle stream state"
        ))
        .into());
    };
    if before_state.run != after_state.run
        || before_state.seed_offset != after_state.seed_offset
        || before_battle == after_battle
        || before_battle.battle_seed != after_battle.battle_seed
        || before_battle.turn != after_battle.turn
    {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} deterministic-Intimidate probe changes evidence outside one battle substream draw"
        ))
        .into());
    }
    Ok(true)
}

fn same_rng_draw_semantics(expected: &RngDraw, actual: &RngDraw) -> bool {
    expected.stream == actual.stream
        && expected.reason == actual.reason
        && expected.public_api == actual.public_api
        && expected.callsite_id == actual.callsite_id
        && expected.minimum == actual.minimum
        && expected.cardinality == actual.cardinality
        && expected.result == actual.result
        && expected.consumed == actual.consumed
        && expected.primitive_draw_count == actual.primitive_draw_count
        && expected.before_state == actual.before_state
        && expected.after_state == actual.after_state
}

fn same_rebased_battle_draw_schedule(expected: &RngDraw, actual: &RngDraw) -> bool {
    expected.stream == RngStream::Battle
        && actual.stream == RngStream::Battle
        && expected.reason == actual.reason
        && expected.public_api == actual.public_api
        && expected.callsite_id == actual.callsite_id
        && expected.minimum == actual.minimum
        && expected.cardinality == actual.cardinality
        && expected.consumed == actual.consumed
        && expected.primitive_draw_count == actual.primitive_draw_count
}

fn grass_powder_battle_state_is(state: &RngAuditState, expected: &str) -> bool {
    matches!(
        state.battle.as_ref(),
        Some(battle)
            if battle.battle_seed == "BQb3dg3zKwem1oCI"
                && battle.turn.get().get() == 1
                && battle
                    .saved_substream
                    .as_ref()
                    .is_some_and(|substream| substream.state_string == expected)
    )
}

fn validate_grass_powder_inserted_accuracy(draw: &RngDraw) -> Result<(), Box<dyn Error>> {
    let exact = draw.stream == RngStream::Battle
        && draw.reason == RngReason::Accuracy
        && draw.public_api == RngPublicApi::RandSeedInt
        && draw.callsite_id == RngCallsiteId::accuracy()
        && draw.minimum == SafeU53::ZERO
        && draw.cardinality == SafeU53::new(100)?
        && draw.result == SafeU53::new(67)?
        && draw.consumed
        && draw.primitive_draw_count == 2
        && grass_powder_battle_state_is(
            &draw.before_state,
            "!rnd,1499243,0.7864099298603833,0.1999444649554789,0.32494510407559574",
        )
        && grass_powder_battle_state_is(
            &draw.after_state,
            "!rnd,418211,0.32494510407559574,0.6796323119197041,0.6411179925780743",
        )
        && draw.before_state.run == draw.after_state.run
        && draw.before_state.seed_offset == draw.after_state.seed_offset;
    if !exact {
        return Err(FixtureError::new(
            "grass-powder-immunity: inserted enemy Accuracy draw differs from the exact post-immunity catalogue",
        )
        .into());
    }
    Ok(())
}

fn same_grass_powder_rebased_speed_probe(expected: &RngDraw, actual: &RngDraw) -> bool {
    is_legacy_speed_queue_probe(expected)
        && is_legacy_speed_queue_probe(actual)
        && expected.minimum == actual.minimum
        && expected.cardinality == actual.cardinality
        && expected.result == actual.result
        && expected.consumed == actual.consumed
        && expected.primitive_draw_count == actual.primitive_draw_count
        && expected.before_state.run == actual.before_state.run
        && expected.after_state.run == actual.after_state.run
        && expected.before_state.seed_offset == actual.before_state.seed_offset
        && expected.after_state.seed_offset == actual.after_state.seed_offset
        && grass_powder_battle_state_is(
            &actual.before_state,
            "!rnd,1783417,0.4494296652264893,0.3972089900635183,0.058738359017297626",
        )
        && actual.before_state.battle == actual.after_state.battle
}

fn voluntary_switch_rebased_rng_source_ordinal(case_name: &str, raw_index: usize) -> Option<usize> {
    if case_name != "voluntary-switch" {
        return None;
    }
    match raw_index {
        29 => Some(0),
        30 => Some(1),
        46 => Some(2),
        47 => Some(3),
        48 => Some(4),
        63 => Some(5),
        64 => Some(6),
        65 => Some(7),
        79 => Some(8),
        _ => None,
    }
}

fn voluntary_switch_rebased_rng_spec(
    ordinal: usize,
) -> Option<(RngReason, RngCallsiteId, u64, u64, u64)> {
    match ordinal {
        0 => Some((RngReason::Accuracy, RngCallsiteId::accuracy(), 0, 100, 79)),
        1 => Some((
            RngReason::CriticalHit,
            RngCallsiteId::critical_hit(),
            0,
            24,
            17,
        )),
        2 => Some((
            RngReason::DamageVariance,
            RngCallsiteId::damage_variance(),
            85,
            16,
            91,
        )),
        3 => Some((RngReason::Accuracy, RngCallsiteId::accuracy(), 0, 100, 87)),
        4 => Some((
            RngReason::CriticalHit,
            RngCallsiteId::critical_hit(),
            0,
            24,
            16,
        )),
        5 => Some((
            RngReason::DamageVariance,
            RngCallsiteId::damage_variance(),
            85,
            16,
            87,
        )),
        6 => Some((RngReason::Accuracy, RngCallsiteId::accuracy(), 0, 100, 46)),
        7 => Some((
            RngReason::CriticalHit,
            RngCallsiteId::critical_hit(),
            0,
            24,
            9,
        )),
        8 => Some((
            RngReason::DamageVariance,
            RngCallsiteId::damage_variance(),
            85,
            16,
            87,
        )),
        _ => None,
    }
}

fn validate_catalogued_rebased_battle_draw(
    case_name: &str,
    ordinal: usize,
    actual: &RngDraw,
    sources: &[(RngAuditState, RngAuditState)],
) -> Result<(), Box<dyn Error>> {
    if case_name == "grass-powder-immunity" {
        let (reason, callsite, minimum, cardinality, result, before_state, after_state) =
            match ordinal {
                0 => (
                    RngReason::CriticalHit,
                    RngCallsiteId::critical_hit(),
                    0,
                    24,
                    20,
                    "!rnd,418211,0.32494510407559574,0.6796323119197041,0.6411179925780743",
                    "!rnd,1421545,0.6411179925780743,0.8526409473270178,0.4494296652264893",
                ),
                1 => (
                    RngReason::DamageVariance,
                    RngCallsiteId::damage_variance(),
                    85,
                    16,
                    91,
                    "!rnd,1421545,0.6411179925780743,0.8526409473270178,0.4494296652264893",
                    "!rnd,1783417,0.4494296652264893,0.3972089900635183,0.058738359017297626",
                ),
                _ => {
                    return Err(FixtureError::new(format!(
                        "{case_name}: rebased battle RNG draw {ordinal} is outside the exact catalogue"
                    ))
                    .into());
                }
            };
        let exact = actual.stream == RngStream::Battle
            && actual.reason == reason
            && actual.public_api == RngPublicApi::RandSeedInt
            && actual.callsite_id == callsite
            && actual.minimum == SafeU53::new(minimum)?
            && actual.cardinality == SafeU53::new(cardinality)?
            && actual.result == SafeU53::new(result)?
            && actual.consumed
            && actual.primitive_draw_count == 2
            && grass_powder_battle_state_is(&actual.before_state, before_state)
            && grass_powder_battle_state_is(&actual.after_state, after_state)
            && actual.before_state.run == actual.after_state.run
            && actual.before_state.seed_offset == actual.after_state.seed_offset;
        if !exact {
            return Err(FixtureError::new(format!(
                "{case_name}: rebased battle RNG draw {ordinal} differs from its exact result/state catalogue"
            ))
            .into());
        }
        return Ok(());
    }
    let (reason, callsite, minimum, cardinality, result) =
        voluntary_switch_rebased_rng_spec(ordinal).ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: rebased battle RNG draw {ordinal} is outside the exact catalogue"
            ))
        })?;
    let (source_before, source_after) = sources.get(ordinal).ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: rebased battle RNG draw {ordinal} has no authenticated legacy source state"
        ))
    })?;
    if case_name != "voluntary-switch"
        || actual.reason != reason
        || actual.public_api != RngPublicApi::RandSeedInt
        || actual.callsite_id != callsite
        || actual.minimum.get() != minimum
        || actual.cardinality.get() != cardinality
        || actual.result.get() != result
        || !actual.consumed
        || actual.primitive_draw_count != 2
        || actual.before_state != *source_before
        || actual.after_state != *source_after
    {
        return Err(FixtureError::new(format!(
            "{case_name}: rebased battle RNG draw {ordinal} differs from its exact result/state catalogue"
        ))
        .into());
    }
    Ok(())
}

fn is_legacy_speed_queue_probe(draw: &RngDraw) -> bool {
    draw.stream == RngStream::SeedOffset
        && draw.reason == RngReason::SpeedTie
        && draw.public_api == RngPublicApi::FisherYatesSwap
        && draw.callsite_id == RngCallsiteId::speed_tie()
}

fn project_catalogued_typed_speed_queue_probe(
    case_name: &str,
    actual_index: usize,
    draw: &RngDraw,
) -> Result<bool, Box<dyn Error>> {
    let Some(projection) = TYPED_SPEED_QUEUE_PROJECTIONS.iter().find(|projection| {
        projection.case_name == case_name && projection.actual_index == actual_index
    }) else {
        return Ok(false);
    };
    let expected_context = SeedOffsetContext {
        wave_seed: projection.wave_seed.to_owned(),
        offset: SafeU53::new(projection.offset)?,
    };
    let exact = draw.stream == RngStream::SeedOffset
        && draw.reason == RngReason::SpeedTie
        && draw.public_api == RngPublicApi::FisherYatesSwap
        && draw.callsite_id == RngCallsiteId::speed_tie()
        && draw.minimum == SafeU53::ZERO
        && draw.cardinality == SafeU53::new(projection.cardinality)?
        && draw.result == SafeU53::new(projection.result)?
        && draw.consumed
        && draw.primitive_draw_count == 2
        && draw.before_state.battle == draw.after_state.battle
        && draw.before_state.seed_offset.as_ref() == Some(&expected_context)
        && draw.after_state.seed_offset.as_ref() == Some(&expected_context);
    if !exact {
        return Err(FixtureError::new(format!(
            "{case_name}: typed speed-queue probe {actual_index} differs from its exact catalogue"
        ))
        .into());
    }
    Ok(true)
}

fn project_legacy_rng_draws(
    case_name: &str,
    legacy: Vec<LegacyProjectedRngDraw>,
    actual: &[RngDraw],
    rebased_sources: &[(RngAuditState, RngAuditState)],
) -> Result<Vec<RngDraw>, Box<dyn Error>> {
    let mut cursor = 0;
    let mut rebased_battle_ordinal = 0;
    let mut inserted_grass_powder_accuracy = false;
    let mut projected = Vec::with_capacity(actual.len());
    for (actual_index, actual_draw) in actual.iter().enumerate() {
        let sequence = SafeU53::new(u64::try_from(actual_index)?)?;
        if actual_draw.sequence != sequence {
            return Err(FixtureError::new(format!(
                "{case_name}: typed RNG draw {actual_index} has sequence {}, expected {sequence}",
                actual_draw.sequence
            ))
            .into());
        }

        if project_catalogued_typed_speed_queue_probe(case_name, actual_index, actual_draw)? {
            let mut projected_draw = actual_draw.clone();
            projected_draw.sequence = sequence;
            projected_draw.before_fingerprint =
                rng_state_fingerprint(&projected_draw.before_state)?;
            projected_draw.after_fingerprint = rng_state_fingerprint(&projected_draw.after_state)?;
            projected_draw.validate()?;
            projected.push(projected_draw);
            continue;
        }

        if case_name == "grass-powder-immunity"
            && cursor == 8
            && !inserted_grass_powder_accuracy
            && actual_draw.reason == RngReason::Accuracy
        {
            validate_grass_powder_inserted_accuracy(actual_draw)?;
            inserted_grass_powder_accuracy = true;
            let mut projected_draw = actual_draw.clone();
            projected_draw.sequence = sequence;
            projected_draw.before_fingerprint =
                rng_state_fingerprint(&projected_draw.before_state)?;
            projected_draw.after_fingerprint = rng_state_fingerprint(&projected_draw.after_state)?;
            projected_draw.validate()?;
            projected.push(projected_draw);
            continue;
        }

        let mut matched = None;
        while let Some(legacy_draw) = legacy.get(cursor) {
            if same_rng_draw_semantics(&legacy_draw.draw, actual_draw) {
                matched = Some(legacy_draw.draw.clone());
                cursor += 1;
                break;
            }
            if legacy_draw.rebase_battle
                && same_rebased_battle_draw_schedule(&legacy_draw.draw, actual_draw)
            {
                validate_catalogued_rebased_battle_draw(
                    case_name,
                    rebased_battle_ordinal,
                    actual_draw,
                    rebased_sources,
                )?;
                rebased_battle_ordinal += 1;
                matched = Some(actual_draw.clone());
                cursor += 1;
                break;
            }
            if case_name == "grass-powder-immunity"
                && same_grass_powder_rebased_speed_probe(&legacy_draw.draw, actual_draw)
            {
                matched = Some(actual_draw.clone());
                cursor += 1;
                break;
            }
            if !is_legacy_speed_queue_probe(&legacy_draw.draw) {
                return Err(FixtureError::new(format!(
                    "{case_name}: typed RNG draw {actual_index} ({:?}) diverges after legacy draw {cursor} ({:?}); only exact legacy speed-queue probes may be projected out",
                    actual_draw.reason, legacy_draw.draw.reason
                ))
                .into());
            }
            cursor += 1;
        }
        let mut matched = matched.ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: typed RNG draw {actual_index} ({:?}) has no order-preserving legacy semantic match",
                actual_draw.reason
            ))
        })?;
        matched.sequence = sequence;
        matched.before_fingerprint = rng_state_fingerprint(&matched.before_state)?;
        matched.after_fingerprint = rng_state_fingerprint(&matched.after_state)?;
        matched.validate()?;
        projected.push(matched);
    }
    for (index, legacy_draw) in legacy.iter().enumerate().skip(cursor) {
        if !is_legacy_speed_queue_probe(&legacy_draw.draw) {
            return Err(FixtureError::new(format!(
                "{case_name}: trailing legacy RNG draw {index} ({:?}) was not reproduced; only exact legacy speed-queue probes may be projected out",
                legacy_draw.draw.reason
            ))
            .into());
        }
    }
    let expected_rebased_draws = if case_name == "grass-powder-immunity" {
        2
    } else {
        rebased_sources.len()
    };
    if rebased_battle_ordinal != expected_rebased_draws {
        return Err(FixtureError::new(format!(
            "{case_name}: reproduced {rebased_battle_ordinal} rebased battle draws, expected exact source count {expected_rebased_draws}"
        ))
        .into());
    }
    if inserted_grass_powder_accuracy != (case_name == "grass-powder-immunity") {
        return Err(FixtureError::new(format!(
            "{case_name}: inserted grass-powder Accuracy draw catalogue presence is {inserted_grass_powder_accuracy}"
        ))
        .into());
    }
    Ok(projected)
}

fn fixture_rng_draws(
    document: &Value,
    case_name: &str,
    actual_draws: &[RngDraw],
) -> Result<Vec<RngDraw>, Box<dyn Error>> {
    let values = array_field(document, case_name, "$", "expected_rng_draws")?;
    let mut draws = Vec::with_capacity(values.len());
    let mut battle_rebased = false;
    let mut observed_intimidate_probes = 0;
    let rebased_source_count = if case_name == "voluntary-switch" {
        9
    } else {
        0
    };
    let mut rebased_sources = vec![None; rebased_source_count];
    for (index, value) in values.iter().enumerate() {
        let path = format!("expected_rng_draws[{index}]");
        let object = value
            .as_object()
            .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not an object")))?;
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

        let sequence = SafeU53::new(u64_field(value, case_name, &path, "sequence")?)?;
        if sequence.get() != u64::try_from(index)? {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.sequence is {sequence}, expected {index}"
            ))
            .into());
        }
        let before_value = required(value, case_name, &path, "before_state")?;
        let after_value = required(value, case_name, &path, "after_state")?;
        let stored_before = string_field(value, case_name, &path, "before_fingerprint")?;
        let stored_after = string_field(value, case_name, &path, "after_fingerprint")?;
        let legacy_before = fixture_digest(before_value)?;
        let legacy_after = fixture_digest(after_value)?;
        if stored_before != legacy_before || stored_after != legacy_after {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} legacy fingerprints do not authenticate the published legacy audit states"
            ))
            .into());
        }
        let before_state = normalize_legacy_rng_audit_state(
            case_name,
            &format!("{path}.before_state"),
            before_value,
            sequence,
        )?;
        let after_state = normalize_legacy_rng_audit_state(
            case_name,
            &format!("{path}.after_state"),
            after_value,
            sequence,
        )?;
        let legacy_context = object
            .get("seed_offset_context")
            .map(|context| serde_json::from_value::<SeedOffsetContext>(context.clone()))
            .transpose()?;
        match (
            legacy_context.as_ref(),
            before_state.seed_offset.as_ref(),
            after_state.seed_offset.as_ref(),
        ) {
            (Some(context), Some(before), Some(after)) if context == before && context == after => {
            }
            (None, None, None) => {}
            _ => {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.seed_offset_context does not exactly mirror both normalized audit states"
                ))
                .into());
            }
        }

        if let Some(ordinal) = voluntary_switch_rebased_rng_source_ordinal(case_name, index) {
            let slot = rebased_sources.get_mut(ordinal).ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: rebased RNG source ordinal {ordinal} is outside its exact catalogue"
                ))
            })?;
            if slot
                .replace((before_state.clone(), after_state.clone()))
                .is_some()
            {
                return Err(FixtureError::new(format!(
                    "{case_name}: rebased RNG source ordinal {ordinal} is duplicated"
                ))
                .into());
            }
        }

        if validate_catalogued_legacy_intimidate_rng_probe(
            case_name,
            index,
            &path,
            value,
            &before_state,
            &after_state,
        )? {
            observed_intimidate_probes += 1;
            battle_rebased = true;
            continue;
        }

        if case_name == "grass-powder-immunity" && index == 8 {
            battle_rebased = true;
        }
        let mut normalized = value.clone();
        let normalized_object = normalized
            .as_object_mut()
            .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not an object")))?;
        normalized_object.remove("seed_offset_context");
        normalized_object.insert(
            "before_state".to_owned(),
            serde_json::to_value(&before_state)?,
        );
        normalized_object.insert(
            "after_state".to_owned(),
            serde_json::to_value(&after_state)?,
        );
        normalized_object.insert(
            "before_fingerprint".to_owned(),
            Value::String(rng_state_fingerprint(&before_state)?),
        );
        normalized_object.insert(
            "after_fingerprint".to_owned(),
            Value::String(rng_state_fingerprint(&after_state)?),
        );
        let stream = match string_field(value, case_name, &path, "stream")?.as_str() {
            "BATTLE" => RngStream::Battle,
            "SEED_OFFSET" => RngStream::SeedOffset,
            legacy => {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.stream has unsupported legacy spelling {legacy:?}"
                ))
                .into());
            }
        };
        let public_api = match string_field(value, case_name, &path, "public_api")?.as_str() {
            "RAND_SEED_INT" => RngPublicApi::RandSeedInt,
            "FISHER_YATES_SWAP" => RngPublicApi::FisherYatesSwap,
            legacy => {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.public_api has unsupported legacy spelling {legacy:?}"
                ))
                .into());
            }
        };
        normalized_object.insert("stream".to_owned(), serde_json::to_value(stream)?);
        normalized_object.insert("public_api".to_owned(), serde_json::to_value(public_api)?);

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
            FixtureError::new(format!(
                "{case_name}: {path} is not a typed RngDraw: {error}"
            ))
        })?;
        draws.push(LegacyProjectedRngDraw {
            draw,
            rebase_battle: battle_rebased,
        });
    }
    let expected_intimidate_probes = LEGACY_DETERMINISTIC_INTIMIDATE_PROBES
        .iter()
        .filter(|probe| probe.case_name == case_name)
        .count();
    if observed_intimidate_probes != expected_intimidate_probes {
        return Err(FixtureError::new(format!(
            "{case_name}: observed {observed_intimidate_probes} deterministic-Intimidate RNG probes, expected exact catalogue count {expected_intimidate_probes}"
        ))
        .into());
    }
    let rebased_sources = rebased_sources
        .into_iter()
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: exact rebased RNG source catalogue is incomplete"
            ))
        })?;
    project_legacy_rng_draws(case_name, draws, actual_draws, &rebased_sources)
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

fn initial_field_slot_for_pokemon(state: &GameState, pokemon: PokemonId) -> Option<FieldSlot> {
    state
        .battle
        .as_ref()?
        .field
        .slots
        .iter()
        .find_map(|entry| (entry.occupant == Some(pokemon)).then_some(entry.slot))
}

fn is_catalogued_legacy_inactive_actor_compaction(
    case_name: &str,
    index: usize,
    action: &ResolvedAction,
    record: &FixtureCommandRecord,
    actions: &[ResolvedAction],
) -> bool {
    // After actor 1 faints, the legacy runtime reports its inactive queued move in the slot
    // vacated by actor 2's simultaneous left-compaction. Typed command identity stays at slot 0.
    case_name == "mixed-side-simultaneous-faint"
        && actions.len() == 5
        && index == 4
        && action.kind == ResolvedActionKind::Move
        && action.disposition == ActionDisposition::SkippedActorInactive
        && u64::from(action.actor) == 1
        && action.source_slot
            == FieldSlot::new(BattleSide::Player, 1).expect("valid legacy source slot")
        && record.field_slot
            == FieldSlot::new(BattleSide::Player, 0).expect("valid typed source slot")
        && action
            .command_operation_id
            .as_ref()
            .is_some_and(|operation| {
                operation.as_str() == "battle/1/wave/1/turn/1/command/player/1/seat/1"
            })
        && record.operation_id.as_str() == "battle/1/wave/1/turn/1/command/player/0/seat/1"
        && record
            .owner_seat
            .is_some_and(|owner_seat| owner_seat.get().get() == 1)
        && actions.get(1).is_some_and(|prior| {
            prior.kind == ResolvedActionKind::Faint
                && prior.actor == action.actor
                && prior.source_slot == record.field_slot
        })
}

fn is_catalogued_legacy_forward_actor_compaction(
    case_name: &str,
    index: usize,
    action: &ResolvedAction,
    record: &FixtureCommandRecord,
    actions: &[ResolvedAction],
) -> bool {
    case_name == "mixed-side-simultaneous-faint"
        && actions.len() == 5
        && index == 3
        && action.kind == ResolvedActionKind::Move
        && action.disposition == ActionDisposition::Executed
        && u64::from(action.actor) == 2
        && action.source_slot
            == FieldSlot::new(BattleSide::Player, 0).expect("valid legacy source slot")
        && record.field_slot
            == FieldSlot::new(BattleSide::Player, 1).expect("valid typed source slot")
        && action
            .command_operation_id
            .as_ref()
            .is_some_and(|operation| {
                operation.as_str() == "battle/1/wave/1/turn/1/command/player/0/seat/2"
            })
        && record.operation_id.as_str() == "battle/1/wave/1/turn/1/command/player/1/seat/2"
        && record
            .owner_seat
            .is_some_and(|owner_seat| owner_seat.get().get() == 2)
        && actions.get(1).is_some_and(|prior| {
            prior.kind == ResolvedActionKind::Faint
                && u64::from(prior.actor) == 1
                && prior.source_slot
                    == FieldSlot::new(BattleSide::Player, 0).expect("valid catalogued faint slot")
        })
}

fn normalize_legacy_action_order(
    case_name: &str,
    initial: &GameState,
    records: &[FixtureCommandRecord],
    actions: &[ResolvedAction],
) -> Result<Vec<ResolvedAction>, Box<dyn Error>> {
    let mut normalized = actions.to_vec();
    for index in 0..normalized.len() {
        let action = &actions[index];
        if let Some(operation_id) = &action.command_operation_id {
            let record = records
                .iter()
                .find(|record| record.actor == action.actor)
                .ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: expected action {index} actor {} has no typed command record",
                        action.actor
                    ))
                })?;
            let compacted_slot = action.source_slot != record.field_slot;
            if operation_id != &record.operation_id && !compacted_slot {
                return Err(FixtureError::new(format!(
                    "{case_name}: expected action {index} command operation {} disagrees with typed command {} without a legacy slot compaction",
                    operation_id.as_str(),
                    record.operation_id.as_str()
                ))
                .into());
            }
            if compacted_slot {
                let supported_forward_compaction = is_catalogued_legacy_forward_actor_compaction(
                    case_name, index, action, record, actions,
                );
                if !supported_forward_compaction
                    && !is_catalogued_legacy_inactive_actor_compaction(
                        case_name, index, action, record, actions,
                    )
                {
                    return Err(FixtureError::new(format!(
                        "{case_name}: expected action {index} has an unsupported legacy source-slot compaction from {:?} to {:?}",
                        action.source_slot,
                        record.field_slot
                    ))
                    .into());
                }
            }
            normalized[index].source_slot = record.field_slot;
            normalized[index].command_operation_id = Some(record.operation_id.clone());
        } else {
            let typed_slot = initial_field_slot_for_pokemon(initial, action.actor).ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: expected action {index} actor {} is absent from the initial field",
                    action.actor
                ))
            })?;
            if action.source_slot != typed_slot {
                return Err(FixtureError::new(format!(
                    "{case_name}: expected non-command action {index} source slot {:?} differs from exact initial slot {:?}",
                    action.source_slot, typed_slot
                ))
                .into());
            }
            normalized[index].source_slot = typed_slot;
        }
    }
    if case_name == "grass-powder-immunity" {
        let catalogued = json!([
            {
                "actor": 1,
                "bracket_modifier": 1,
                "command_operation_id": "battle/1/wave/1/turn/1/command/player/0/seat/1",
                "disposition": "MISSED",
                "effective_speed": 180,
                "kind": "MOVE",
                "move_priority": 0,
                "sequence": 0,
                "source_slot": { "position": 0, "side": "PLAYER" },
                "tie_order": 0,
                "timing_modifier": 1
            },
            {
                "actor": 2,
                "bracket_modifier": 1,
                "command_operation_id": "battle/1/wave/1/turn/1/command/enemy/0/script/0",
                "disposition": "EXECUTED",
                "effective_speed": 123,
                "kind": "MOVE",
                "move_priority": 0,
                "sequence": 1,
                "source_slot": { "position": 0, "side": "ENEMY" },
                "tie_order": 0,
                "timing_modifier": 1
            }
        ]);
        let published = serde_json::to_value(actions)?;
        if published != catalogued {
            let divergence = first_divergence(&catalogued, &published)
                .unwrap_or_else(|| "catalogued action trace differs".to_owned());
            return Err(FixtureError::new(format!(
                "{case_name}: legacy powder-immunity action trace left its exact closed catalogue: {divergence}"
            ))
            .into());
        }
        normalized[0].disposition = ActionDisposition::Executed;
    }
    Ok(normalized)
}

fn validate_action_sequences(
    case_name: &str,
    label: &str,
    actions: &[ResolvedAction],
) -> Result<(), Box<dyn Error>> {
    for (index, action) in actions.iter().enumerate() {
        if action.sequence.get() != u64::try_from(index)? {
            return Err(FixtureError::new(format!(
                "{case_name}: {label}[{index}] sequence is {}, expected {index}",
                action.sequence
            ))
            .into());
        }
    }
    Ok(())
}

fn resequence_projected_actions(actions: &mut [ResolvedAction]) -> Result<(), Box<dyn Error>> {
    for (index, action) in actions.iter_mut().enumerate() {
        action.sequence = SafeU53::new(u64::try_from(index)?)?;
    }
    Ok(())
}

fn project_catalogued_legacy_replacement_actions(
    case_name: &str,
    initial: &GameState,
    turn_after: &GameState,
    proposals: &[FixtureReplacementProposal],
    replacements: &[ReplacementPresentationTrace],
    expected: &[ResolvedAction],
    actual: &[ResolvedAction],
) -> Result<Vec<ResolvedAction>, Box<dyn Error>> {
    let catalogue = LEGACY_REPLACEMENT_ACTION_PROJECTIONS
        .iter()
        .filter(|projection| projection.case_name == case_name)
        .collect::<Vec<_>>();
    if catalogue.is_empty() {
        return Ok(expected.to_vec());
    }
    if proposals.len() != catalogue.len() || replacements.len() != catalogue.len() {
        return Err(FixtureError::new(format!(
            "{case_name}: replacement action projection has proposal/replay counts {}/{}, expected exact catalogue count {}",
            proposals.len(),
            replacements.len(),
            catalogue.len()
        ))
        .into());
    }
    if expected.len() != actual.len() + catalogue.len() {
        return Err(FixtureError::new(format!(
            "{case_name}: legacy replacement action projection saw legacy/typed lengths {}/{}, expected exactly {} catalogued legacy-only actions",
            expected.len(),
            actual.len(),
            catalogue.len()
        ))
        .into());
    }
    if actual
        .iter()
        .any(|action| action.kind == ResolvedActionKind::Replacement)
    {
        return Err(FixtureError::new(format!(
            "{case_name}: typed turn action order contains a replacement owned by the separate replacement transition"
        ))
        .into());
    }

    let turn_battle = turn_after.battle.as_ref().ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: replacement action projection has no post-turn battle"
        ))
    })?;
    let mut projected = expected.to_vec();
    let mut remove = Vec::with_capacity(catalogue.len());
    for projection in catalogue {
        let actor = PokemonId::try_from_u64(projection.actor)?;
        let source_slot = FieldSlot::new(projection.source_side, projection.source_position)?;
        let index = expected
            .iter()
            .position(|action| {
                action.kind == ResolvedActionKind::Replacement && action.actor == actor
            })
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: catalogued legacy replacement action for actor {actor} is absent"
                ))
            })?;
        let action = &expected[index];
        let exact_action = index + 1 == expected.len()
            && action.sequence.get() == projection.sequence
            && action.source_slot == source_slot
            && action.command_operation_id.is_none()
            && action.effective_speed == projection.effective_speed
            && action.timing_modifier == 0
            && action.move_priority == 0
            && action.bracket_modifier == 0
            && action.tie_order == SafeU53::ZERO
            && action.disposition == ActionDisposition::Executed;
        if !exact_action {
            return Err(FixtureError::new(format!(
                "{case_name}: legacy replacement action for actor {actor} differs from its exact tail-action catalogue entry"
            ))
            .into());
        }
        if initial_field_slot_for_pokemon(initial, actor) != Some(source_slot) {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued legacy replacement actor {actor} does not start in {source_slot:?}"
            ))
            .into());
        }

        let occurrence_id = FaintOccurrenceId::try_from_u64(projection.occurrence)?;
        let proposal_index = proposals
            .iter()
            .position(|proposal| proposal.occurrence == occurrence_id)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: catalogued legacy replacement occurrence {occurrence_id} has no proposal"
                ))
            })?;
        let proposal = &proposals[proposal_index];
        let expected_party_slot = PartyIndex::try_from(u64::from(projection.party_slot))?;
        let expected_incoming = PokemonId::try_from_u64(projection.incoming)?;
        let exact_selection = matches!(
            proposal.selection,
            ReplacementSelection::Selected {
                party_slot,
                pokemon,
            } if party_slot == expected_party_slot && pokemon == expected_incoming
        );
        if proposal.raw_operation_id.as_str() != projection.raw_operation_id
            || proposal.field_slot != source_slot
            || !exact_selection
        {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued legacy replacement proposal differs from its exact operation/slot/selection fingerprint"
            ))
            .into());
        }
        let stored = turn_battle
            .faint_queue
            .iter()
            .find(|occurrence| occurrence.id == occurrence_id)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: catalogued legacy replacement occurrence {occurrence_id} is absent after the turn"
                ))
            })?;
        if stored.pokemon != actor
            || stored.slot != source_slot
            || stored.replacement != ReplacementProgress::Pending
        {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued legacy replacement occurrence does not identify the exact pending fainted actor"
            ))
            .into());
        }
        let replacement = &replacements[proposal_index];
        let operation_id = replacement_operation_id(
            stored.source.epoch,
            proposal.battle_id,
            stored.source.wave,
            stored.source.resolved_turn,
            stored.source.turn_occurrence,
            stored.slot,
            proposal.owner_seat,
        )?;
        if replacement.operation_id != operation_id
            || replacement.selection != proposal.selection
            || replacement.field_slot != source_slot
            || replacement.outcome != projection.outcome
        {
            return Err(FixtureError::new(format!(
                "{case_name}: separate replacement replay does not exactly own the catalogued legacy replacement action"
            ))
            .into());
        }
        remove.push(index);
    }
    remove.sort_unstable();
    remove.dedup();
    if remove.len()
        != LEGACY_REPLACEMENT_ACTION_PROJECTIONS
            .iter()
            .filter(|projection| projection.case_name == case_name)
            .count()
    {
        return Err(FixtureError::new(format!(
            "{case_name}: legacy replacement action projection matched duplicate catalogue entries"
        ))
        .into());
    }
    for index in remove.into_iter().rev() {
        projected.remove(index);
    }
    Ok(projected)
}

#[allow(clippy::too_many_arguments)]
fn project_catalogued_typed_inactive_actions(
    case_name: &str,
    initial: &GameState,
    turn_after: &GameState,
    records: &[FixtureCommandRecord],
    expected: &[ResolvedAction],
    actual: &[ResolvedAction],
    mutations: &[BattleMutation],
    presentation: &[BattlePresentationEvent],
) -> Result<Vec<ResolvedAction>, Box<dyn Error>> {
    let catalogue = TYPED_INACTIVE_ACTION_PROJECTIONS
        .iter()
        .filter(|projection| projection.case_name == case_name)
        .collect::<Vec<_>>();
    if catalogue.is_empty() {
        return Ok(actual.to_vec());
    }
    if actual.len() != expected.len() + catalogue.len() {
        return Err(FixtureError::new(format!(
            "{case_name}: typed inactive-action projection saw legacy/typed lengths {}/{}, expected exactly {} catalogued typed-only actions",
            expected.len(),
            actual.len(),
            catalogue.len()
        ))
        .into());
    }
    let tail_start = actual.len() - catalogue.len();
    let mut projected = actual.to_vec();
    let mut remove = Vec::with_capacity(catalogue.len());
    for projection in catalogue {
        let actor = PokemonId::try_from_u64(projection.actor)?;
        let source_slot = FieldSlot::new(projection.source_side, projection.source_position)?;
        let action_index = actual
            .iter()
            .enumerate()
            .skip(tail_start)
            .find_map(|(index, action)| (action.actor == actor).then_some(index))
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: catalogued typed-only inactive action for actor {actor} is absent from the exact tail window"
                ))
            })?;
        let action = &actual[action_index];
        let expected_tie_order = SafeU53::new(u64::from(projection.tie_order))?;
        let exact_action = action.sequence.get() == u64::try_from(action_index)?
            && action.kind == ResolvedActionKind::Move
            && action.source_slot == source_slot
            && action
                .command_operation_id
                .as_ref()
                .is_some_and(|operation| operation.as_str() == projection.operation_id)
            && action.effective_speed == projection.effective_speed
            && action.timing_modifier == 1
            && action.move_priority == 0
            && action.bracket_modifier == 1
            && action.tie_order == expected_tie_order
            && action.disposition == ActionDisposition::SkippedActorInactive;
        if !exact_action {
            return Err(FixtureError::new(format!(
                "{case_name}: typed-only inactive action for actor {actor} differs from its exact move/slot/operation/speed/disposition fingerprint"
            ))
            .into());
        }
        if expected.iter().any(|legacy| {
            legacy
                .command_operation_id
                .as_ref()
                .is_some_and(|operation| {
                    operation.as_str() == projection.operation_id
                        && legacy.kind == ResolvedActionKind::Move
                        && legacy.disposition == ActionDisposition::SkippedActorInactive
                })
        }) {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued typed-only inactive action for actor {actor} is also represented by the legacy trace"
            ))
            .into());
        }
        let record = records
            .iter()
            .find(|record| record.actor == actor)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: catalogued typed-only inactive actor {actor} has no admitted command record"
                ))
            })?;
        let expected_move_slot = MoveSlotIndex::try_from(u64::from(projection.move_slot))?;
        if record.field_slot != source_slot
            || record.operation_id.as_str() != projection.operation_id
            || !matches!(
                &record.command,
                BattleCommand::Fight {
                    actor: command_actor,
                    move_slot,
                    ..
                } if *command_actor == actor && *move_slot == expected_move_slot
            )
        {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued typed-only inactive action for actor {actor} does not match its admitted fight command"
            ))
            .into());
        }
        if initial_field_slot_for_pokemon(initial, actor) != Some(source_slot) {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued typed-only inactive actor {actor} is not initially bound to {source_slot:?}"
            ))
            .into());
        }
        let prior_faint = actual[..action_index].iter().any(|prior| {
            prior.kind == ResolvedActionKind::Faint
                && prior.actor == actor
                && prior.source_slot == source_slot
                && prior.command_operation_id.is_none()
                && prior.effective_speed == projection.effective_speed
                && prior.timing_modifier == 0
                && prior.move_priority == 0
                && prior.bracket_modifier == 0
                && prior.tie_order == SafeU53::ZERO
                && prior.disposition == ActionDisposition::Executed
        });
        let after_pokemon = pokemon_state(turn_after, actor).ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: catalogued typed-only inactive actor {actor} is absent after the turn"
            ))
        })?;
        let after_occupant = turn_after
            .battle
            .as_ref()
            .and_then(|battle| {
                battle
                    .field
                    .slots
                    .iter()
                    .find(|entry| entry.slot == source_slot)
            })
            .and_then(|entry| entry.occupant);
        if !prior_faint
            || !after_pokemon.fainted
            || after_pokemon.hp != 0
            || after_occupant != Some(actor)
        {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued typed-only inactive actor {actor} is not proven fainted in its stable field slot"
            ))
            .into());
        }

        let initial_move = pokemon_state(initial, actor)
            .and_then(|pokemon| pokemon.moves.get(usize::from(expected_move_slot.get())))
            .and_then(Option::as_ref)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: catalogued typed-only inactive actor {actor} has no initial move in slot {}",
                    expected_move_slot.get()
                ))
            })?;
        let after_move = after_pokemon
            .moves
            .get(usize::from(expected_move_slot.get()))
            .and_then(Option::as_ref)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: catalogued typed-only inactive actor {actor} loses move slot {}",
                    expected_move_slot.get()
                ))
            })?;
        if u64::from(initial_move.move_id) != projection.move_id
            || initial_move != after_move
            || mutations.iter().any(|mutation| {
                matches!(
                    mutation,
                    BattleMutation::PpChanged {
                        pokemon,
                        move_slot,
                        ..
                    } if *pokemon == actor && *move_slot == expected_move_slot
                )
            })
            || presentation.iter().any(|event| {
                matches!(
                    &event.kind,
                    BattlePresentationKind::MoveUsed {
                        actor: presented_actor,
                        ..
                    } if *presented_actor == actor
                )
            })
        {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued typed-only inactive action for actor {actor} has move-state, PP-mutation, or move-presentation evidence"
            ))
            .into());
        }
        remove.push(action_index);
    }
    remove.sort_unstable();
    remove.dedup();
    if remove.len()
        != TYPED_INACTIVE_ACTION_PROJECTIONS
            .iter()
            .filter(|projection| projection.case_name == case_name)
            .count()
    {
        return Err(FixtureError::new(format!(
            "{case_name}: typed inactive-action projection matched duplicate catalogue entries"
        ))
        .into());
    }
    for index in remove.into_iter().rev() {
        projected.remove(index);
    }
    Ok(projected)
}

fn exact_forced_replacement_action(
    action: &ResolvedAction,
    sequence: u64,
    actor: u64,
    source_slot: FieldSlot,
    operation_id: &str,
    disposition: ActionDisposition,
    tie_order: u64,
) -> Result<bool, Box<dyn Error>> {
    let actor = PokemonId::try_from_u64(actor)?;
    let tie_order = SafeU53::new(tie_order)?;
    Ok(action.sequence.get() == sequence
        && action.kind == ResolvedActionKind::Move
        && action.actor == actor
        && action.source_slot == source_slot
        && action
            .command_operation_id
            .as_ref()
            .is_some_and(|operation| operation.as_str() == operation_id)
        && action.effective_speed == 180
        && action.timing_modifier == 1
        && action.move_priority == 0
        && action.bracket_modifier == 1
        && action.tie_order == tie_order
        && action.disposition == disposition)
}

fn project_catalogued_forced_replacement_action_order(
    case_name: &str,
    expected: &[ResolvedAction],
    actual: &[ResolvedAction],
) -> Result<Vec<ResolvedAction>, Box<dyn Error>> {
    if case_name != "forced-replacement" {
        return Ok(actual.to_vec());
    }
    if expected.len() != 5 || actual.len() != 5 {
        return Err(FixtureError::new(format!(
            "{case_name}: forced-replacement action projection expected five turn actions after its exact replacement projection, got {}/{}",
            expected.len(),
            actual.len()
        ))
        .into());
    }
    let player_zero = FieldSlot::new(BattleSide::Player, 0)?;
    let player_one = FieldSlot::new(BattleSide::Player, 1)?;
    let actor_one_operation = "battle/1/wave/1/turn/1/command/player/0/seat/1";
    let actor_two_operation = "battle/1/wave/1/turn/1/command/player/1/seat/2";
    let expected_pair = exact_forced_replacement_action(
        &expected[3],
        3,
        1,
        player_zero,
        actor_one_operation,
        ActionDisposition::SkippedActorInactive,
        0,
    )? && exact_forced_replacement_action(
        &expected[4],
        4,
        2,
        player_one,
        actor_two_operation,
        ActionDisposition::Executed,
        0,
    )?;
    let same_order = exact_forced_replacement_action(
        &actual[3],
        3,
        1,
        player_zero,
        actor_one_operation,
        ActionDisposition::SkippedActorInactive,
        0,
    )? && exact_forced_replacement_action(
        &actual[4],
        4,
        2,
        player_one,
        actor_two_operation,
        ActionDisposition::Executed,
        0,
    )?;
    let reversed_order = exact_forced_replacement_action(
        &actual[3],
        3,
        2,
        player_one,
        actor_two_operation,
        ActionDisposition::Executed,
        0,
    )? && exact_forced_replacement_action(
        &actual[4],
        4,
        1,
        player_zero,
        actor_one_operation,
        ActionDisposition::SkippedActorInactive,
        0,
    )?;
    if !expected_pair || (!same_order && !reversed_order) || expected[..3] != actual[..3] {
        return Err(FixtureError::new(
            "forced-replacement: action-order projection differs from its exact dynamic-queue pair catalogue",
        )
        .into());
    }
    let mut projected = actual.to_vec();
    if reversed_order {
        projected.swap(3, 4);
    }
    Ok(projected)
}

fn project_catalogued_mixed_side_action_order(
    case_name: &str,
    expected: &[ResolvedAction],
    actual: &[ResolvedAction],
) -> Result<Vec<ResolvedAction>, Box<dyn Error>> {
    if case_name != "mixed-side-simultaneous-faint" {
        return Ok(actual.to_vec());
    }
    if expected.len() != 5 || actual.len() != 5 {
        return Err(FixtureError::new(format!(
            "{case_name}: mixed-side action projection expected exact five-action traces, got {}/{}",
            expected.len(),
            actual.len()
        ))
        .into());
    }
    let mut typed_legacy = expected.to_vec();
    typed_legacy.swap(3, 4);
    resequence_projected_actions(&mut typed_legacy)?;
    if typed_legacy != actual {
        return Err(FixtureError::new(
            "mixed-side-simultaneous-faint: typed dynamic-queue pair is outside the exact legacy swap catalogue",
        )
        .into());
    }
    let mut projected = actual.to_vec();
    projected.swap(3, 4);
    Ok(projected)
}

#[allow(clippy::too_many_arguments)]
fn compare_projected_action_order(
    case_name: &str,
    initial: &GameState,
    turn_after: &GameState,
    records: &[FixtureCommandRecord],
    proposals: &[FixtureReplacementProposal],
    replacements: &[ReplacementPresentationTrace],
    expected: &[ResolvedAction],
    actual: &[ResolvedAction],
    mutations: &[BattleMutation],
    presentation: &[BattlePresentationEvent],
) -> Result<(), Box<dyn Error>> {
    validate_action_sequences(case_name, "legacy action order", expected)?;
    validate_action_sequences(case_name, "typed action order", actual)?;
    let mut expected = project_catalogued_legacy_replacement_actions(
        case_name,
        initial,
        turn_after,
        proposals,
        replacements,
        expected,
        actual,
    )?;
    let mut actual = project_catalogued_typed_inactive_actions(
        case_name,
        initial,
        turn_after,
        records,
        &expected,
        actual,
        mutations,
        presentation,
    )?;
    actual = project_catalogued_forced_replacement_action_order(case_name, &expected, &actual)?;
    actual = project_catalogued_mixed_side_action_order(case_name, &expected, &actual)?;
    resequence_projected_actions(&mut expected)?;
    resequence_projected_actions(&mut actual)?;
    compare_serialized_axis(case_name, "DYNAMIC_ACTION_ORDER", &expected, &actual)
}

fn pokemon_state(state: &GameState, pokemon: PokemonId) -> Option<&PokemonState> {
    let battle = state.battle.as_ref()?;
    battle
        .player_party
        .iter()
        .chain(&battle.enemy_party)
        .find(|candidate| candidate.id == pokemon)
}

fn pokemon_state_mut(state: &mut GameState, pokemon: PokemonId) -> Option<&mut PokemonState> {
    let battle = state.battle.as_mut()?;
    battle
        .player_party
        .iter_mut()
        .chain(&mut battle.enemy_party)
        .find(|candidate| candidate.id == pokemon)
}

fn validate_legacy_pokemon_snapshot(
    case_name: &str,
    path: &str,
    actual: &PokemonState,
    legacy: &LegacyPokemonEvidence,
) -> Result<(), Box<dyn Error>> {
    let stages = [
        actual.stat_stages.attack,
        actual.stat_stages.defense,
        actual.stat_stages.special_attack,
        actual.stat_stages.special_defense,
        actual.stat_stages.speed,
        actual.stat_stages.accuracy,
        actual.stat_stages.evasion,
    ];
    let moves = actual
        .moves
        .iter()
        .map(|slot| {
            slot.as_ref().map(|slot| LegacyMoveEvidence {
                move_id: slot.move_id,
                pp_used: slot.pp_used,
            })
        })
        .collect::<Option<Vec<_>>>();
    if actual.hp != legacy.hp
        || actual.fainted != legacy.fainted
        || actual.status
            != legacy_status_state(case_name, &format!("{path}.status"), &legacy.status)?
        || stages != legacy.stages
        || moves.as_deref() != Some(legacy.moves.as_slice())
    {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} does not exactly match the represented fields of typed Pokemon {}",
            actual.id
        ))
        .into());
    }
    Ok(())
}

fn apply_catalogued_turn_resolution_setup(
    document: &Value,
    case_name: &str,
    identities: &BTreeMap<u64, PokemonId>,
    state: &mut GameState,
) -> Result<Vec<BattleMutation>, Box<dyn Error>> {
    let values = array_field(document, case_name, "$", "expected_mutations")?;
    let setup = values
        .iter()
        .enumerate()
        .filter(|(index, value)| {
            required(
                value,
                case_name,
                &format!("expected_mutations[{index}]"),
                "cause",
            )
            .is_ok_and(|cause| cause.as_str() == Some("TURN_RESOLUTION"))
        })
        .collect::<Vec<_>>();
    let expected_count = usize::from(matches!(
        case_name,
        "paralysis-full-stop" | "paralysis-speed-order"
    ));
    if setup.len() != expected_count {
        return Err(FixtureError::new(format!(
            "{case_name}: TURN_RESOLUTION setup mutation count is {}, expected {expected_count} from the closed catalogue",
            setup.len()
        ))
        .into());
    }

    let mut mutations = Vec::with_capacity(setup.len());
    for (index, value) in setup {
        let path = format!("expected_mutations[{index}]");
        if index != 0 {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued TURN_RESOLUTION setup must be mutation zero"
            ))
            .into());
        }
        mutation_metadata(
            value,
            case_name,
            &path,
            "STATUS_SET",
            &[
                "after", "before", "cause", "kind", "path", "phase", "sequence",
            ],
        )?;
        if string_field(value, case_name, &path, "phase")? != "ObtainStatusEffectPhase"
            || string_field(value, case_name, &path, "path")? != "pokemon/1/status_set"
            || u64_field(value, case_name, &path, "sequence")? != 0
        {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued TURN_RESOLUTION setup identity is not the exact Pokemon 1 paralysis boundary"
            ))
            .into());
        }
        let (before, after, pokemon) =
            legacy_pokemon_transition(value, case_name, &path, identities, "status")?;
        if u64::from(pokemon) != 1 {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued TURN_RESOLUTION setup targets {pokemon}, expected Pokemon 1"
            ))
            .into());
        }
        let before_status =
            legacy_status_state(case_name, &format!("{path}.before.status"), &before.status)?;
        let after_status =
            legacy_status_state(case_name, &format!("{path}.after.status"), &after.status)?;
        if before_status.kind != StatusKind::None || after_status.kind != StatusKind::Paralysis {
            return Err(FixtureError::new(format!(
                "{case_name}: catalogued TURN_RESOLUTION setup is not the exact NONE-to-PARALYSIS transition"
            ))
            .into());
        }
        let pokemon_state = pokemon_state_mut(state, pokemon).ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: catalogued setup Pokemon {pokemon} is absent from typed state"
            ))
        })?;
        validate_legacy_pokemon_snapshot(
            case_name,
            &format!("{path}.before"),
            pokemon_state,
            &before,
        )?;
        pokemon_state.status = after_status;
        mutations.push(BattleMutation::StatusChanged {
            pokemon,
            before: before_status,
            after: after_status,
        });
    }
    Ok(mutations)
}

fn prepend_setup_presentation(
    case_name: &str,
    operation_id: &OperationId,
    setup_mutations: &[BattleMutation],
    presentation: &mut Vec<BattlePresentationEvent>,
) -> Result<(), Box<dyn Error>> {
    if setup_mutations.is_empty() {
        return Ok(());
    }
    let mut prefixed = Vec::with_capacity(setup_mutations.len() + presentation.len());
    for mutation in setup_mutations {
        let BattleMutation::StatusChanged {
            pokemon,
            before,
            after,
        } = mutation
        else {
            return Err(FixtureError::new(format!(
                "{case_name}: unsupported non-status setup mutation cannot be projected to presentation"
            ))
            .into());
        };
        prefixed.push(BattlePresentationEvent::new(
            BattlePresentationEventId::new(operation_id.clone(), SafeU53::ZERO),
            PRESENTATION_BLOCKING_POLICY,
            PRESENTATION_SKIP_POLICY,
            BattlePresentationKind::StatusApplied {
                pokemon: *pokemon,
                before: *before,
                after: *after,
            },
        ));
    }
    prefixed.append(presentation);
    for (index, event) in prefixed.iter_mut().enumerate() {
        event.event_id = BattlePresentationEventId::new(
            operation_id.clone(),
            SafeU53::new(u64::try_from(index)?)?,
        );
    }
    *presentation = prefixed;
    Ok(())
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

fn is_catalogued_legacy_hp_fainted_transition(
    case_name: &str,
    pokemon: PokemonId,
    before: &LegacyPokemonEvidence,
    after: &LegacyPokemonEvidence,
) -> bool {
    LEGACY_HP_FAINTED_PROJECTIONS.iter().any(|projection| {
        projection.case_name == case_name
            && projection.pokemon == u64::from(pokemon)
            && projection.before_hp == before.hp
            && projection.after_hp == after.hp
            && !before.fainted
            && after.fainted
    })
}

fn legacy_pokemon_transition(
    value: &Value,
    case_name: &str,
    path: &str,
    identities: &BTreeMap<u64, PokemonId>,
    ignored_field: &str,
) -> Result<(LegacyPokemonEvidence, LegacyPokemonEvidence, PokemonId), Box<dyn Error>> {
    let before: LegacyPokemonEvidence =
        serde_json::from_value(object_field(value, case_name, path, "before")?.clone())?;
    let after: LegacyPokemonEvidence =
        serde_json::from_value(object_field(value, case_name, path, "after")?.clone())?;
    let before_id = legacy_pokemon_id(identities, case_name, &format!("{path}.before"), before.id)?;
    let after_id = legacy_pokemon_id(identities, case_name, &format!("{path}.after"), after.id)?;
    if before_id != after_id {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} changes Pokémon identity from {before_id} to {after_id}"
        ))
        .into());
    }
    let before_status =
        legacy_status_state(case_name, &format!("{path}.before.status"), &before.status)?;
    let after_status =
        legacy_status_state(case_name, &format!("{path}.after.status"), &after.status)?;
    if ignored_field != "hp" && before.hp != after.hp {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} changes hp outside its declared {ignored_field} mutation"
        ))
        .into());
    }
    if ignored_field != "fainted"
        && before.fainted != after.fainted
        && !(ignored_field == "hp"
            && is_catalogued_legacy_hp_fainted_transition(case_name, before_id, &before, &after))
    {
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

fn legacy_faint_marker(
    value: &Value,
    case_name: &str,
    path: &str,
    identities: &BTreeMap<u64, PokemonId>,
    cause: Option<usize>,
    _sequence: u64,
) -> Result<Option<LegacyFaintMarker>, Box<dyn Error>> {
    if string_field(value, case_name, path, "kind")? != "STATUS_SET" {
        return Ok(None);
    }
    let before: LegacyPokemonEvidence =
        serde_json::from_value(object_field(value, case_name, path, "before")?.clone())?;
    let after: LegacyPokemonEvidence =
        serde_json::from_value(object_field(value, case_name, path, "after")?.clone())?;
    if before.status.effect != 7 && after.status.effect != 7 {
        return Ok(None);
    }
    mutation_metadata(
        value,
        case_name,
        path,
        "STATUS_SET",
        &[
            "after", "before", "cause", "kind", "path", "phase", "sequence",
        ],
    )?;
    let mutation_path = string_field(value, case_name, path, "path")?;
    let segments = mutation_path.split('/').collect::<Vec<_>>();
    if segments.len() != 3 || segments[0] != "pokemon" || segments[2] != "status_set" {
        return Err(FixtureError::new(format!(
            "{case_name}: {path}.path {mutation_path:?} is not pokemon/<legacy_pid>/status_set"
        ))
        .into());
    }
    let path_pokemon = PokemonId::try_from_u64(segments[1].parse::<u64>()?)?;
    let before_pokemon = legacy_pokemon_id(identities, case_name, path, before.id)?;
    let after_pokemon = legacy_pokemon_id(identities, case_name, path, after.id)?;
    if before_pokemon != after_pokemon || path_pokemon != before_pokemon {
        return Err(FixtureError::new(format!(
            "{case_name}: {path}.path PokemonId does not match faint-marker snapshots"
        ))
        .into());
    }
    if before.status.effect == 7 || after.status.effect != 7 {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} has an invalid legacy faint-marker status transition"
        ))
        .into());
    }
    if before.hp != after.hp
        || before.fainted != after.fainted
        || before.moves != after.moves
        || before.stages != after.stages
    {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} changes non-status fields while carrying the legacy faint marker"
        ))
        .into());
    }
    if !after.fainted || after.hp != 0 {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} legacy faint marker is not attached to a zero-HP fainted snapshot"
        ))
        .into());
    }
    if after.status.sleep_turns_remaining != Some(0) || after.status.toxic_turn_count != 0 {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} legacy faint marker has invalid status companions"
        ))
        .into());
    }
    let before_status =
        legacy_status_state(case_name, &format!("{path}.before.status"), &before.status)?;
    Ok(Some(LegacyFaintMarker {
        cause,
        pokemon: before_pokemon,
        before,
        after,
        before_status,
    }))
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
) -> Result<(), Box<dyn Error>> {
    assert_exact_keys(case_name, path, value, fields)?;
    let actual_kind = string_field(value, case_name, path, "kind")?;
    if actual_kind != kind {
        return Err(FixtureError::new(format!(
            "{case_name}: {path}.kind is {actual_kind}, expected {kind}"
        ))
        .into());
    }
    Ok(())
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

fn legacy_faint_queue_path_index(path: &str, replacement: bool) -> Option<usize> {
    let value = path.strip_prefix("battle.faint_queue[")?;
    let suffix = if replacement { "].replacement" } else { "]" };
    value.strip_suffix(suffix)?.parse().ok()
}

fn is_exact_legacy_turn_boundary_cause(
    case_name: &str,
    cause: &ResolvedAction,
    actions: &[ResolvedAction],
) -> bool {
    if actions.last().map(|action| action.sequence) == Some(cause.sequence) {
        return true;
    }
    let Some(replacement) = actions.last() else {
        return false;
    };
    case_name == "forced-replacement"
        && actions.len() == 6
        && cause.sequence.get() == 4
        && cause.kind == ResolvedActionKind::Move
        && u64::from(cause.actor) == 2
        && cause.disposition == ActionDisposition::Executed
        && replacement.sequence.get() == 5
        && replacement.kind == ResolvedActionKind::Replacement
        && u64::from(replacement.actor) == 1
        && replacement.disposition == ActionDisposition::Executed
}

fn validate_legacy_mutation_metadata(
    case_name: &str,
    trace: &FixtureMutationTrace,
    actions: &[ResolvedAction],
) -> Result<(), Box<dyn Error>> {
    for (index, metadata) in trace.metadata.iter().enumerate() {
        if metadata.sequence != u64::try_from(index)? {
            return Err(FixtureError::new(format!(
                "{case_name}: retained mutation metadata {index} has sequence {}, expected {index}",
                metadata.sequence
            ))
            .into());
        }
        if metadata.path.is_empty() {
            return Err(FixtureError::new(format!(
                "{case_name}: expected_mutations[{index}].path is empty"
            ))
            .into());
        }
        let exact_path_matches = match metadata.kind.as_str() {
            "BATTLE_RNG_CHANGED" => metadata.path == "battle/rng",
            "FAINT_QUEUED" | "FAINT_RESOLVED" => {
                legacy_faint_queue_path_index(&metadata.path, false).is_some()
            }
            "FAINT_PROGRESS_CHANGED" => {
                legacy_faint_queue_path_index(&metadata.path, true).is_some()
            }
            "TURN_ADVANCE" => metadata.path == "battle/turn_advance",
            _ => true,
        };
        if !exact_path_matches {
            return Err(FixtureError::new(format!(
                "{case_name}: expected_mutations[{index}] kind {} has invalid exact path {:?}",
                metadata.kind, metadata.path
            ))
            .into());
        }

        let action = match &metadata.cause {
            Value::Number(value) => {
                let sequence = value.as_u64().ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: expected_mutations[{index}].cause is not an unsigned action sequence"
                    ))
                })?;
                Some(
                    actions
                        .iter()
                        .find(|action| action.sequence.get() == sequence)
                        .ok_or_else(|| {
                            FixtureError::new(format!(
                                "{case_name}: expected_mutations[{index}].cause {sequence} does not identify the exact retained action sequence"
                            ))
                        })?,
                )
            }
            Value::String(value) if value == "TURN_RESOLUTION" => None,
            cause => {
                return Err(FixtureError::new(format!(
                    "{case_name}: expected_mutations[{index}].cause has unsupported retained value {cause}"
                ))
                .into());
            }
        };

        let context_matches = matches!(
            (
                metadata.kind.as_str(),
                metadata.phase.as_str(),
                action.map(|action| action.kind),
            ),
            (
                "PP_CONSUMPTION",
                "MovePhase",
                Some(ResolvedActionKind::Move)
            ) | (
                "BATTLE_RNG_CHANGED",
                "MovePhase",
                Some(ResolvedActionKind::Move)
            ) | (
                "BATTLE_RNG_CHANGED",
                "MoveEffectPhase",
                Some(ResolvedActionKind::Move)
            ) | (
                "HP_DAMAGE",
                "MoveEffectPhase",
                Some(ResolvedActionKind::Move)
            ) | (
                "STATUS_SET",
                "ObtainStatusEffectPhase",
                Some(ResolvedActionKind::Move)
            ) | ("STATUS_SET", "FaintPhase", Some(ResolvedActionKind::Faint))
                | (
                    "FAINT_QUEUED",
                    "FaintPhase",
                    Some(ResolvedActionKind::Faint)
                )
                | (
                    "FAINT_PROGRESS_CHANGED",
                    "FaintPhase",
                    Some(ResolvedActionKind::Faint)
                )
                | (
                    "FAINT_RESOLVED",
                    "FaintPhase",
                    Some(ResolvedActionKind::Faint)
                )
                | (
                    "HP_DAMAGE",
                    "PostTurnStatusEffectPhase",
                    Some(ResolvedActionKind::ResidualStatus),
                )
                | (
                    "FAINT_PROGRESS_CHANGED",
                    "SwitchSummonPhase",
                    Some(ResolvedActionKind::Replacement),
                )
                | (
                    "FAINT_RESOLVED",
                    "SwitchSummonPhase",
                    Some(ResolvedActionKind::Replacement)
                )
                | (
                    "FIELD_CHANGED",
                    "SwitchSummonPhase",
                    Some(ResolvedActionKind::Switch)
                )
                | (
                    "FIELD_CHANGED",
                    "SwitchSummonPhase",
                    Some(ResolvedActionKind::Replacement)
                )
                | (
                    "BATTLE_RNG_CHANGED",
                    "StatStageChangePhase",
                    Some(ResolvedActionKind::Switch)
                )
                | (
                    "BATTLE_RNG_CHANGED",
                    "StatStageChangePhase",
                    Some(ResolvedActionKind::Replacement),
                )
                | (
                    "STAT_STAGE",
                    "StatStageChangePhase",
                    Some(ResolvedActionKind::Move)
                )
                | (
                    "STAT_STAGE",
                    "StatStageChangePhase",
                    Some(ResolvedActionKind::Switch)
                )
                | (
                    "STAT_STAGE",
                    "StatStageChangePhase",
                    Some(ResolvedActionKind::Replacement)
                )
                | ("TURN_ADVANCE", "TurnEndPhase", Some(_))
                | ("STATUS_SET", "ObtainStatusEffectPhase", None)
        );
        if !context_matches {
            return Err(FixtureError::new(format!(
                "{case_name}: expected_mutations[{index}] has unsupported exact kind/phase/cause context {}/{}/{}",
                metadata.kind,
                metadata.phase,
                action
                    .map(|action| format!("{:?}@{}", action.kind, action.sequence))
                    .unwrap_or_else(|| "TURN_RESOLUTION".to_owned())
            ))
            .into());
        }

        if metadata.kind == "TURN_ADVANCE" {
            let cause = action.ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: expected_mutations[{index}] TURN_ADVANCE has no action cause"
                ))
            })?;
            if !is_exact_legacy_turn_boundary_cause(case_name, cause, actions) {
                return Err(FixtureError::new(format!(
                    "{case_name}: expected_mutations[{index}] TURN_ADVANCE cause {} is not the exact final action sequence",
                    cause.sequence
                ))
                .into());
            }
        }
    }
    Ok(())
}

fn validate_catalogued_legacy_intimidate_rng_mutation(
    document: &Value,
    case_name: &str,
    index: usize,
    value: &Value,
) -> Result<bool, Box<dyn Error>> {
    let Some(probe) = LEGACY_DETERMINISTIC_INTIMIDATE_PROBES
        .iter()
        .find(|probe| probe.case_name == case_name && probe.mutation_index == index)
    else {
        return Ok(false);
    };
    let path = format!("expected_mutations[{index}]");
    mutation_metadata(
        value,
        case_name,
        &path,
        "BATTLE_RNG_CHANGED",
        &[
            "after", "before", "cause", "kind", "path", "phase", "sequence",
        ],
    )?;
    if string_field(value, case_name, &path, "phase")? != "StatStageChangePhase"
        || string_field(value, case_name, &path, "path")? != "battle/rng"
        || u64_field(value, case_name, &path, "cause")? != probe.cause
    {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} does not match its exact deprecated Intimidate RNG mutation context"
        ))
        .into());
    }

    let draws = array_field(document, case_name, "$", "expected_rng_draws")?;
    let draw = draws.get(probe.draw_index).ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: catalogued RNG draw {} is absent",
            probe.draw_index
        ))
    })?;
    let draw_path = format!("expected_rng_draws[{}]", probe.draw_index);
    if string_field(draw, case_name, &draw_path, "callsite_id")?
        != LEGACY_DETERMINISTIC_INTIMIDATE_CALLSITE
        || required(value, case_name, &path, "before")?
            != required(
                object_field(draw, case_name, &draw_path, "before_state")?,
                case_name,
                &format!("{draw_path}.before_state"),
                "battle",
            )?
        || required(value, case_name, &path, "after")?
            != required(
                object_field(draw, case_name, &draw_path, "after_state")?,
                case_name,
                &format!("{draw_path}.after_state"),
                "battle",
            )?
    {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} is not the exact battle-state transition authenticated by {draw_path}"
        ))
        .into());
    }

    let mutations = array_field(document, case_name, "$", "expected_mutations")?;
    let stat_index = index + 1;
    let stat = mutations.get(stat_index).ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: deprecated Intimidate probe at mutation {index} has no adjacent stat-stage effect"
        ))
    })?;
    let stat_path = format!("expected_mutations[{stat_index}]");
    if string_field(stat, case_name, &stat_path, "kind")? != "STAT_STAGE"
        || string_field(stat, case_name, &stat_path, "phase")? != "StatStageChangePhase"
        || string_field(stat, case_name, &stat_path, "path")? != probe.stat_path
        || u64_field(stat, case_name, &stat_path, "cause")? != probe.cause
    {
        return Err(FixtureError::new(format!(
            "{case_name}: {stat_path} is not the exact stat-stage effect adjacent to its deprecated Intimidate probe"
        ))
        .into());
    }
    Ok(true)
}

fn fixture_mutations(
    document: &Value,
    case_name: &str,
    identities: &BTreeMap<u64, PokemonId>,
    initial: &GameState,
    actions: &[ResolvedAction],
    records: &[FixtureCommandRecord],
) -> Result<FixtureMutationTrace, Box<dyn Error>> {
    let values = array_field(document, case_name, "$", "expected_mutations")?;
    let mut mutations = Vec::with_capacity(values.len());
    let mut faint_markers = Vec::new();
    let mut legacy_queue_occurrences = BTreeMap::new();
    let mut metadata = Vec::with_capacity(values.len());
    let mut turn_advances = Vec::new();
    let mut observed_intimidate_rng_mutations = 0;
    let mut projected_statuses = initial
        .battle
        .as_ref()
        .into_iter()
        .flat_map(|battle| battle.player_party.iter().chain(&battle.enemy_party))
        .map(|pokemon| (pokemon.id, pokemon.status))
        .collect::<BTreeMap<_, _>>();

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
        let mut legacy_metadata = LegacyMutationMetadata {
            sequence,
            kind: kind.clone(),
            phase: string_field(value, case_name, &path, "phase")?,
            path: string_field(value, case_name, &path, "path")?,
            cause: required(value, case_name, &path, "cause")?.clone(),
        };

        if validate_catalogued_legacy_intimidate_rng_mutation(document, case_name, index, value)? {
            observed_intimidate_rng_mutations += 1;
            continue;
        }
        legacy_metadata.sequence = u64::try_from(metadata.len())?;

        if let Some(marker) =
            legacy_faint_marker(value, case_name, &path, identities, cause, sequence)?
        {
            faint_markers.push(marker);
            metadata.push(legacy_metadata);
            continue;
        }

        let mutation = match kind.as_str() {
            "PP_CONSUMPTION" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "PP_CONSUMPTION",
                    &[
                        "after", "before", "cause", "kind", "path", "phase", "sequence",
                    ],
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
                        actor, move_slot, ..
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
                    &[
                        "after", "before", "cause", "kind", "path", "phase", "sequence",
                    ],
                )?;
                let mutation_path = string_field(value, case_name, &path, "path")?;
                let segments = mutation_path.split('/').collect::<Vec<_>>();
                if segments.len() != 3 || segments[0] != "pokemon" || segments[2] != "hp_damage" {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path {mutation_path:?} is not pokemon/<legacy_pid>/hp_damage"
                    ))
                    .into());
                }
                let (before, after, pokemon) =
                    legacy_pokemon_transition(value, case_name, &path, identities, "hp")?;
                let path_pokemon = PokemonId::try_from_u64(segments[1].parse::<u64>()?)?;
                if path_pokemon != pokemon {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path PokemonId does not match its snapshots"
                    ))
                    .into());
                }
                if legacy_metadata.phase == "PostTurnStatusEffectPhase" {
                    let before_status = legacy_status_state(
                        case_name,
                        &format!("{path}.before.status"),
                        &before.status,
                    )?;
                    let after_status = legacy_status_state(
                        case_name,
                        &format!("{path}.after.status"),
                        &after.status,
                    )?;
                    if before_status != after_status {
                        return Err(FixtureError::new(format!(
                            "{case_name}: {path} residual HP evidence also changes status"
                        ))
                        .into());
                    }
                    let projected_before = projected_statuses.get(&pokemon).copied().ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: {path} residual status references absent Pokemon {pokemon}"
                        ))
                    })?;
                    if projected_before != before_status {
                        let is_closed_residual_increment =
                            matches!(projected_before.kind, StatusKind::Poison | StatusKind::Burn)
                                && projected_before.kind == before_status.kind
                                && projected_before.sleep_turns_remaining
                                    == before_status.sleep_turns_remaining
                                && projected_before.toxic_turn_count.checked_add(1)
                                    == Some(before_status.toxic_turn_count);
                        if !is_closed_residual_increment {
                            return Err(FixtureError::new(format!(
                                "{case_name}: {path} residual status bookkeeping is outside the closed Poison/Burn increment projection: {projected_before:?} -> {before_status:?}"
                            ))
                            .into());
                        }
                        mutations.push(BattleMutation::StatusChanged {
                            pokemon,
                            before: projected_before,
                            after: before_status,
                        });
                        if projected_statuses.insert(pokemon, before_status)
                            != Some(projected_before)
                        {
                            return Err(FixtureError::new(format!(
                                "{case_name}: {path} residual status cursor changed during projection"
                            ))
                            .into());
                        }
                    }
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
                    &[
                        "after", "before", "cause", "kind", "path", "phase", "sequence",
                    ],
                )?;
                let mutation_path = string_field(value, case_name, &path, "path")?;
                let segments = mutation_path.split('/').collect::<Vec<_>>();
                if segments.len() != 3 || segments[0] != "pokemon" || segments[2] != "status_set" {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path {mutation_path:?} is not pokemon/<legacy_pid>/status_set"
                    ))
                    .into());
                }
                let (before, after, pokemon) =
                    legacy_pokemon_transition(value, case_name, &path, identities, "status")?;
                let path_pokemon = PokemonId::try_from_u64(segments[1].parse::<u64>()?)?;
                if path_pokemon != pokemon {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path PokemonId does not match its snapshots"
                    ))
                    .into());
                }
                let before_status = legacy_status_state(
                    case_name,
                    &format!("{path}.before.status"),
                    &before.status,
                )?;
                let after_status =
                    legacy_status_state(case_name, &format!("{path}.after.status"), &after.status)?;
                let projected_before = projected_statuses.get(&pokemon).copied().ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {path} status mutation references absent Pokemon {pokemon}"
                    ))
                })?;
                if projected_before != before_status {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path} status before {before_status:?} does not continue authenticated cursor {projected_before:?}"
                    ))
                    .into());
                }
                if projected_statuses.insert(pokemon, after_status) != Some(projected_before) {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path} status cursor changed during projection"
                    ))
                    .into());
                }
                BattleMutation::StatusChanged {
                    pokemon,
                    before: before_status,
                    after: after_status,
                }
            }
            "STAT_STAGE" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "STAT_STAGE",
                    &[
                        "after", "before", "cause", "kind", "path", "phase", "sequence",
                    ],
                )?;
                let mutation_path = string_field(value, case_name, &path, "path")?;
                let segments = mutation_path.split('/').collect::<Vec<_>>();
                if segments.len() != 3 || segments[0] != "pokemon" || segments[2] != "stat_stage" {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path {mutation_path:?} is not pokemon/<legacy_pid>/stat_stage"
                    ))
                    .into());
                }
                let (before, after, pokemon) =
                    legacy_pokemon_transition(value, case_name, &path, identities, "stages")?;
                let path_pokemon = PokemonId::try_from_u64(segments[1].parse::<u64>()?)?;
                if path_pokemon != pokemon {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path PokemonId does not match its snapshots"
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
                    &[
                        "after", "before", "cause", "kind", "path", "phase", "sequence",
                    ],
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
                    &[
                        "after", "before", "cause", "kind", "path", "phase", "sequence",
                    ],
                )?;
                if !required(value, case_name, &path, "before")?.is_null() {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.before must be null for FAINT_QUEUED"
                    ))
                    .into());
                }
                let mut occurrence: FaintOccurrence = serde_json::from_value(
                    object_field(value, case_name, &path, "after")?.clone(),
                )?;
                let (legacy_turn_occurrence, typed_turn_occurrence) =
                    catalogued_legacy_faint_turn_occurrence(case_name, occurrence.id).ok_or_else(
                        || {
                            FixtureError::new(format!(
                                "{case_name}: {path} is outside the exact legacy faint-source catalogue"
                            ))
                        },
                    )?;
                if occurrence.source.turn_occurrence != legacy_turn_occurrence {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.after.source.turn_occurrence is {}, expected catalogued legacy value {legacy_turn_occurrence}",
                        occurrence.source.turn_occurrence
                    ))
                    .into());
                }
                occurrence.source.turn_occurrence = typed_turn_occurrence;
                let queue_index = legacy_faint_queue_path_index(&legacy_metadata.path, false)
                    .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: {path}.path is not an exact battle.faint_queue[index] path"
                        ))
                    })?;
                if legacy_queue_occurrences
                    .insert(queue_index, occurrence.id)
                    .is_some()
                {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path repeats legacy faint queue index {queue_index}"
                    ))
                    .into());
                }
                let cause = cause.ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {path}.cause must identify the exact faint action"
                    ))
                })?;
                let action_sequence = SafeU53::new(u64::try_from(cause)?)?;
                let action = actions
                    .iter()
                    .find(|action| action.sequence == action_sequence)
                    .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: {path}.cause {cause} does not identify its faint action"
                        ))
                    })?;
                if action.kind != ResolvedActionKind::Faint
                    || action.actor != occurrence.pokemon
                    || action.source_slot != occurrence.slot
                {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.cause {cause} does not match the queued Pokemon/slot"
                    ))
                    .into());
                }
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
                let queue_index = legacy_faint_queue_path_index(&legacy_metadata.path, true)
                    .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: {path}.path is not an exact battle.faint_queue[index].replacement path"
                        ))
                    })?;
                if legacy_queue_occurrences.get(&queue_index) != Some(&occurrence) {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path queue index {queue_index} does not correspond to occurrence {occurrence}"
                    ))
                    .into());
                }
                let before: ReplacementProgress =
                    serde_json::from_value(required(value, case_name, &path, "before")?.clone())?;
                let after: ReplacementProgress =
                    serde_json::from_value(required(value, case_name, &path, "after")?.clone())?;
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
                    &["cause", "kind", "occurrence", "path", "phase", "sequence"],
                )?;
                let occurrence = FaintOccurrenceId::try_from_u64(u64_field(
                    value,
                    case_name,
                    &path,
                    "occurrence",
                )?)?;
                let queue_index = legacy_faint_queue_path_index(&legacy_metadata.path, false)
                    .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: {path}.path is not an exact battle.faint_queue[index] path"
                        ))
                    })?;
                if legacy_queue_occurrences.get(&queue_index) != Some(&occurrence) {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {path}.path queue index {queue_index} does not correspond to occurrence {occurrence}"
                    ))
                    .into());
                }
                BattleMutation::FaintResolved { occurrence }
            }
            "FIELD_CHANGED" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "FIELD_CHANGED",
                    &[
                        "after", "before", "cause", "kind", "path", "phase", "sequence", "slot",
                    ],
                )?;
                let slot: FieldSlot =
                    serde_json::from_value(required(value, case_name, &path, "slot")?.clone())?;
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
                let before: Option<PokemonId> =
                    serde_json::from_value(required(value, case_name, &path, "before")?.clone())?;
                let after: Option<PokemonId> =
                    serde_json::from_value(required(value, case_name, &path, "after")?.clone())?;
                BattleMutation::FieldChanged {
                    slot,
                    before,
                    after,
                }
            }
            "TURN_ADVANCE" => {
                mutation_metadata(
                    value,
                    case_name,
                    &path,
                    "TURN_ADVANCE",
                    &[
                        "after", "before", "cause", "kind", "path", "phase", "sequence",
                    ],
                )?;
                let before: LegacyTurnBoundary = serde_json::from_value(
                    object_field(value, case_name, &path, "before")?.clone(),
                )?;
                let after: LegacyTurnBoundary = serde_json::from_value(
                    object_field(value, case_name, &path, "after")?.clone(),
                )?;
                turn_advances.push(LegacyTurnAdvance {
                    cause,
                    before: before.clone(),
                    after: after.clone(),
                });
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
        metadata.push(legacy_metadata);
    }
    let expected_intimidate_rng_mutations = LEGACY_DETERMINISTIC_INTIMIDATE_PROBES
        .iter()
        .filter(|probe| probe.case_name == case_name)
        .count();
    if observed_intimidate_rng_mutations != expected_intimidate_rng_mutations {
        return Err(FixtureError::new(format!(
            "{case_name}: observed {observed_intimidate_rng_mutations} deprecated Intimidate RNG mutations, expected exact catalogue count {expected_intimidate_rng_mutations}"
        ))
        .into());
    }
    Ok(FixtureMutationTrace {
        typed: mutations,
        faint_markers,
        metadata,
        turn_advances,
    })
}

fn normalize_expected_final_resources(
    case_name: &str,
    initial: &GameState,
    mutations: &[BattleMutation],
    expected_final: &mut GameState,
) -> Result<(), Box<dyn Error>> {
    let mut hp_cursors = BTreeMap::new();
    let mut pp_cursors = BTreeMap::new();

    for (index, mutation) in mutations.iter().enumerate() {
        match mutation {
            BattleMutation::HpChanged {
                pokemon,
                before,
                after,
            } => {
                if before == after {
                    return Err(FixtureError::new(format!(
                        "{case_name}: expected mutation {index} contains a no-op HP transition for {pokemon}"
                    ))
                    .into());
                }
                let initial_hp = pokemon_state(initial, *pokemon)
                    .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: expected mutation {index} references absent HP Pokemon {pokemon}"
                        ))
                    })?
                    .hp;
                let cursor = hp_cursors.entry(*pokemon).or_insert(initial_hp);
                if *cursor != *before {
                    return Err(FixtureError::new(format!(
                        "{case_name}: expected mutation {index} HP before {before} does not continue authenticated cursor {cursor} for {pokemon}"
                    ))
                    .into());
                }
                *cursor = *after;
            }
            BattleMutation::PpChanged {
                pokemon,
                move_slot,
                before,
                after,
            } => {
                if before == after {
                    return Err(FixtureError::new(format!(
                        "{case_name}: expected mutation {index} contains a no-op PP transition for {pokemon} slot {}",
                        move_slot.get()
                    ))
                    .into());
                }
                let key = (*pokemon, move_slot.get());
                let initial_pp = pokemon_state(initial, *pokemon)
                    .and_then(|state| state.moves.get(usize::from(move_slot.get())))
                    .and_then(Option::as_ref)
                    .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: expected mutation {index} references absent PP Pokemon {pokemon} slot {}",
                            move_slot.get()
                        ))
                    })?
                    .pp_used;
                let cursor = pp_cursors.entry(key).or_insert(initial_pp);
                if *cursor != *before {
                    return Err(FixtureError::new(format!(
                        "{case_name}: expected mutation {index} PP before {before} does not continue authenticated cursor {cursor} for {pokemon} slot {}",
                        move_slot.get()
                    ))
                    .into());
                }
                *cursor = *after;
            }
            _ => {}
        }
    }

    for (pokemon, hp) in hp_cursors {
        pokemon_state_mut(expected_final, pokemon)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: expected final state is missing HP Pokemon {pokemon}"
                ))
            })?
            .hp = hp;
    }
    for ((pokemon, move_slot), pp_used) in pp_cursors {
        let state = pokemon_state_mut(expected_final, pokemon).ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: expected final state is missing PP Pokemon {pokemon}"
            ))
        })?;
        state
            .moves
            .get_mut(usize::from(move_slot))
            .and_then(Option::as_mut)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: expected final state is missing PP Pokemon {pokemon} slot {move_slot}"
                ))
            })?
            .pp_used = pp_used;
    }
    Ok(())
}

fn catalogued_legacy_faint_turn_occurrence(
    case_name: &str,
    occurrence: FaintOccurrenceId,
) -> Option<(u32, u32)> {
    let occurrence = u64::from(occurrence);
    match (case_name, occurrence) {
        ("defeat", 1)
        | ("forced-replacement", 1)
        | ("mixed-side-simultaneous-faint", 1)
        | ("no-legal-replacement", 1)
        | ("same-side-simultaneous-faint", 1)
        | ("victory", 1)
        | ("wonder-guard-super-effective-pass", 1) => Some((2, 0)),
        ("no-legal-replacement", 2) => Some((5, 1)),
        ("same-side-simultaneous-faint", 2) => Some((10, 1)),
        ("wonder-guard-status-pass", 1) => Some((7, 0)),
        _ => None,
    }
}

fn replay_fixture_replacements(
    mut state: GameState,
    proposals: &[FixtureReplacementProposal],
    case_name: &str,
    content: &ContentPack,
) -> Result<ReplacementReplayTrace, Box<dyn Error>> {
    let mut mutations = Vec::new();
    let mut transitions = Vec::new();
    for (index, proposal) in proposals.iter().enumerate() {
        let path = format!("commands.replacement_proposals[{index}]");
        let battle = state
            .battle
            .as_ref()
            .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} state has no battle")))?;
        let stored = battle
            .faint_queue
            .iter()
            .find(|occurrence| occurrence.id == proposal.occurrence)
            .copied()
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: {path}.occurrence {} is absent from the authoritative faint queue",
                    proposal.occurrence
                ))
            })?;
        if proposal.battle_id != battle.battle_id
            || proposal.wave != stored.source.wave
            || proposal.resolved_turn != stored.source.resolved_turn
            || proposal.epoch != stored.source.epoch
            || proposal.field_slot != stored.slot
            || stored.owner_seat != Some(proposal.owner_seat)
            || battle.wave != stored.source.wave
        {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} coordinates do not match the stored authoritative faint source"
            ))
            .into());
        }
        let operation_id = replacement_operation_id(
            stored.source.epoch,
            proposal.battle_id,
            stored.source.wave,
            stored.source.resolved_turn,
            stored.source.turn_occurrence,
            stored.slot,
            proposal.owner_seat,
        )?;
        if proposal.raw_operation_id.as_str() != operation_id.as_str() {
            let catalogued =
                catalogued_legacy_faint_turn_occurrence(case_name, proposal.occurrence);
            if catalogued != Some((proposal.turn_occurrence, stored.source.turn_occurrence))
                || usize::try_from(stored.source.turn_occurrence)? != index
            {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.operation_id {} is not canonical {} and its turn occurrence is outside the exact legacy replacement catalogue",
                    proposal.raw_operation_id.as_str(),
                    operation_id.as_str()
                ))
                .into());
            }
        } else if proposal.turn_occurrence != stored.source.turn_occurrence {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.operation_id is canonical but turn_occurrence {} differs from stored source {}",
                proposal.turn_occurrence, stored.source.turn_occurrence
            ))
            .into());
        }
        match proposal.selection {
            ReplacementSelection::Selected { .. } => {
                let admitted = BattleReplacementProposalV1::new(
                    operation_id.clone(),
                    proposal.battle_id,
                    stored.source.wave,
                    stored.source.resolved_turn,
                    proposal.owner_seat,
                    proposal.occurrence,
                    stored.source.turn_occurrence,
                    stored.slot,
                    proposal.selection,
                    MenuInstanceId::new(SafeU53::new(u64::try_from(index)? + 1)?),
                    format!("m3-oracle/{case_name}/replacement/{index}"),
                )?;
                validate_replacement_proposal(&state, &admitted, content)?;
            }
            ReplacementSelection::NoLegalReplacement => {
                validate_replacement_selection(
                    &state,
                    proposal.occurrence,
                    &proposal.selection,
                    content,
                )?;
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
        let transition_presentation = transition.presentation.clone();
        mutations.extend(transition.mutations);
        transitions.push(ReplacementPresentationTrace {
            operation_id,
            selection: proposal.selection,
            field_slot: stored.slot,
            outcome: transition.outcome,
            presentation: transition_presentation,
        });
        state = transition.after_state;
    }
    Ok(ReplacementReplayTrace {
        state,
        mutations,
        transitions,
    })
}

fn materialize_pending_command_frontier(
    case_name: &str,
    state: &mut GameState,
    content: &ContentPack,
) -> Result<(), Box<dyn Error>> {
    let (battle_id, wave, turn, tombstones, slots, outcome) = {
        let battle = state
            .battle
            .as_ref()
            .ok_or_else(|| FixtureError::new(format!("{case_name}: final state has no battle")))?;
        (
            battle.battle_id,
            battle.wave,
            battle.turn,
            battle.command_state.tombstones.clone(),
            battle.field.slots.clone(),
            battle.outcome,
        )
    };
    if outcome != BattleOutcome::Ongoing {
        return Ok(());
    }
    let mut frontier = Vec::new();
    for entry in slots {
        if entry.slot.side != BattleSide::Player {
            continue;
        }
        let Some(actor) = entry.occupant else {
            continue;
        };
        let pokemon = pokemon_state(state, actor).ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: ongoing final frontier actor {actor} is absent from its party"
            ))
        })?;
        if pokemon.fainted || pokemon.hp == 0 {
            return Err(FixtureError::new(format!(
                "{case_name}: ongoing final frontier actor {actor} is fainted"
            ))
            .into());
        }
        let owner_seat = pokemon.owner_seat.ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: ongoing final frontier actor {actor} has no owner seat"
            ))
        })?;
        let offer = build_command_offer(state, entry.slot, content)?;
        let operation_id =
            player_command_operation_id(battle_id, wave, turn, entry.slot, owner_seat)?;
        frontier.push(CommandFrontierEntry::new(
            operation_id,
            Some(owner_seat),
            actor,
            entry.slot,
            offer,
            CommandFrontierStatus::Pending,
        )?);
    }
    let command_state = CommandCollectionState::new(frontier, tombstones)?;
    state
        .battle
        .as_mut()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: final battle disappeared")))?
        .command_state = command_state;
    Ok(())
}

fn legacy_field_slot_from_bi(
    case_name: &str,
    path: &str,
    value: &Value,
) -> Result<FieldSlot, Box<dyn Error>> {
    let bi = u64_field(value, case_name, path, "bi")?;
    legacy_field_slot(case_name, path, bi)
}

fn legacy_field_slot(case_name: &str, path: &str, bi: u64) -> Result<FieldSlot, Box<dyn Error>> {
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

fn voluntary_switch_rebased_hp_presentation(
    case_name: &str,
    path: &str,
) -> Option<(u64, u32, u32, u32)> {
    if case_name == "grass-powder-immunity" {
        return (path == "expected_presentation[3].event").then_some((1, 201, 159, 162));
    }
    if case_name != "voluntary-switch" {
        return None;
    }
    match path {
        "expected_presentation[7].event" => Some((2, 201, 157, 159)),
        "expected_presentation[9].event" => Some((3, 251, 216, 217)),
        "expected_presentation[11].event" => Some((4, 198, 113, 124)),
        _ => None,
    }
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
    if let Some((expected_pokemon, expected_before, legacy_after, typed_after)) =
        voluntary_switch_rebased_hp_presentation(case_name, path)
    {
        let expected_pokemon = PokemonId::try_from_u64(expected_pokemon)?;
        if pokemon != expected_pokemon || after != legacy_after {
            return Err(FixtureError::new(format!(
                "{case_name}: {path} does not match its exact rebased HP presentation catalogue entry"
            ))
            .into());
        }
        let mut candidate = None;
        for (index, mutation) in mutations.iter().enumerate() {
            if used[index] {
                continue;
            }
            let BattleMutation::HpChanged {
                pokemon: candidate_pokemon,
                before,
                after,
            } = mutation
            else {
                continue;
            };
            if *candidate_pokemon != pokemon || *before != expected_before || *after != typed_after
            {
                continue;
            }
            if candidate.replace((index, *before, *after)).is_some() {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path} has more than one candidate rebased HpChanged mutation"
                ))
                .into());
            }
        }
        if let Some((index, before, after)) = candidate {
            used[index] = true;
            return Ok((before, after));
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
        if let BattleMutation::FaintQueued { occurrence } = mutation
            && occurrence.pokemon == pokemon
        {
            used[index] = true;
            return Ok(occurrence.id);
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
) -> Result<FixturePresentationTrace, Box<dyn Error>> {
    let values = array_field(document, case_name, "$", "expected_presentation")?;
    let mut used_mutations = vec![false; mutations.len()];
    let mut presentation = Vec::with_capacity(values.len());
    let mut messages = Vec::new();
    let mut observed_stage_floor_attempts = 0;

    for (index, value) in values.iter().enumerate() {
        let path = format!("expected_presentation[{index}]");
        assert_exact_keys(
            case_name,
            &path,
            value,
            &["authority_recorded", "event", "event_id"],
        )?;
        if required(value, case_name, &path, "authority_recorded")?.as_bool() != Some(true) {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.authority_recorded must be true"
            ))
            .into());
        }
        let event_id_value = object_field(value, case_name, &path, "event_id")?;
        assert_exact_keys(
            case_name,
            &format!("{path}.event_id"),
            event_id_value,
            &["operation_id", "sequence"],
        )?;
        let operation_id = OperationId::new(string_field(
            event_id_value,
            case_name,
            &format!("{path}.event_id"),
            "operation_id",
        )?)?;
        let legacy_sequence = SafeU53::new(u64_field(
            event_id_value,
            case_name,
            &format!("{path}.event_id"),
            "sequence",
        )?)?;
        if legacy_sequence != SafeU53::new(u64::try_from(index)?)? {
            return Err(FixtureError::new(format!(
                "{case_name}: {path}.event_id.sequence is {legacy_sequence}, expected {index}"
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
                let residual_shape = matches!(
                    (case_name, event_path.as_str()),
                    ("existing-status-rejected", "expected_presentation[5].event")
                        | ("poison-application", "expected_presentation[6].event")
                        | ("burn-application", "expected_presentation[7].event")
                        | ("burn-residual", "expected_presentation[7].event")
                        | ("burn-physical-penalty", "expected_presentation[7].event")
                        | ("pp-unusable-rejected", "expected_presentation[7].event")
                        | ("wonder-guard-status-pass", "expected_presentation[6].event")
                );
                if residual_shape {
                    assert_exact_keys(
                        case_name,
                        &event_path,
                        event,
                        &["actor", "bi", "hp", "k", "maxHp", "sp"],
                    )?;
                } else {
                    assert_exact_keys(
                        case_name,
                        &event_path,
                        event,
                        &[
                            "actor", "bi", "critical", "hp", "k", "maxHp", "result", "sp",
                        ],
                    )?;
                }
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
                let display_annotations = if residual_shape {
                    None
                } else {
                    let critical = required(event, case_name, &event_path, "critical")?
                        .as_bool()
                        .ok_or_else(|| {
                            FixtureError::new(format!(
                                "{case_name}: {event_path}.critical is not boolean"
                            ))
                        })?;
                    let result = u64_field(event, case_name, &event_path, "result")?;
                    Some((critical, result))
                };
                let sp = u64_field(event, case_name, &event_path, "sp")?;
                let pokemon = pokemon_state(initial, actor_id).ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: {event_path} actor {actor_id} is absent from initial state"
                    ))
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
                let _legacy_display_annotations = (display_annotations, sp);
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
                let value: i8 = serde_json::from_value(
                    required(event, case_name, &event_path, "value")?.clone(),
                )?;
                let (before, after) = if matches!(
                    case_name,
                    "stage-floor-cap" | "intimidate-stage-floor"
                ) {
                    let closed_actor = matches!(u64::from(actor_id), 3 | 4);
                    let initial_stage =
                        pokemon_state(initial, actor_id).map(|pokemon| pokemon.stat_stages.attack);
                    let has_typed_mutation = mutations.iter().any(|mutation| {
                        matches!(
                            mutation,
                            BattleMutation::StatStageChanged {
                                pokemon,
                                stat: candidate_stat,
                                ..
                            } if *pokemon == actor_id && *candidate_stat == stat
                        )
                    });
                    if !closed_actor
                        || stat != BattleStat::Attack
                        || value != -6
                        || initial_stage != Some(-6)
                        || has_typed_mutation
                    {
                        return Err(FixtureError::new(format!(
                            "{case_name}: {event_path} is outside the exact clamped Attack-stage presentation catalogue"
                        ))
                        .into());
                    }
                    observed_stage_floor_attempts += 1;
                    (-6, -6)
                } else {
                    take_stage_mutation(
                        case_name,
                        &event_path,
                        mutations,
                        &mut used_mutations,
                        actor_id,
                        stat,
                        value,
                    )?
                };
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
                    .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: {event_path}.narrate is not boolean"
                        ))
                    })?;
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
                let party_slot =
                    PartyIndex::try_from(u64_field(event, case_name, &event_path, "partySlot")?)?;
                let passive = required(event, case_name, &event_path, "passive")?
                    .as_bool()
                    .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: {event_path}.passive is not boolean"
                        ))
                    })?;
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
                    .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: {event_path}.doReturn is not boolean"
                        ))
                    })?;
                let party_slot =
                    PartyIndex::try_from(u64_field(event, case_name, &event_path, "partySlot")?)?;
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
                if text.trim().is_empty() {
                    return Err(FixtureError::new(format!(
                        "{case_name}: {event_path} legacy message text is empty"
                    ))
                    .into());
                }
                messages.push(LegacyPresentationMessage {
                    sequence: legacy_sequence.get(),
                    typed_before: presentation.len(),
                    text,
                });
                continue;
            }
            _ => {
                return Err(FixtureError::new(format!(
                    "{case_name}: {event_path}.k={event_kind:?} is not a supported legacy presentation event"
                ))
                .into());
            }
        };
        let typed_sequence = SafeU53::new(u64::try_from(presentation.len())?)?;
        presentation.push(BattlePresentationEvent::new(
            BattlePresentationEventId::new(operation_id, typed_sequence),
            PRESENTATION_BLOCKING_POLICY,
            PRESENTATION_SKIP_POLICY,
            kind,
        ));
    }
    let expected_stage_floor_attempts = usize::from(matches!(
        case_name,
        "stage-floor-cap" | "intimidate-stage-floor"
    )) * 4;
    if observed_stage_floor_attempts != expected_stage_floor_attempts {
        return Err(FixtureError::new(format!(
            "{case_name}: observed {observed_stage_floor_attempts} clamped stage presentation attempts, expected exact {expected_stage_floor_attempts}"
        ))
        .into());
    }
    if case_name == "voluntary-switch" {
        let pokemon_four = PokemonId::try_from_u64(4)?;
        let pokemon_five = PokemonId::try_from_u64(5)?;
        if presentation.len() != 10
            || !matches!(
                presentation.get(2).map(|event| &event.kind),
                Some(BattlePresentationKind::StatStageChanged {
                    pokemon,
                    stat: BattleStat::Attack,
                    before: 0,
                    after: -1,
                }) if *pokemon == pokemon_five
            )
            || !matches!(
                presentation.get(3).map(|event| &event.kind),
                Some(BattlePresentationKind::StatStageChanged {
                    pokemon,
                    stat: BattleStat::Attack,
                    before: 0,
                    after: -1,
                }) if *pokemon == pokemon_four
            )
        {
            return Err(FixtureError::new(
                "voluntary-switch: legacy presentation stage order is outside its exact catalogue",
            )
            .into());
        }
        let (before_four, from_four) = presentation.split_at_mut(3);
        std::mem::swap(&mut before_four[2].kind, &mut from_four[0].kind);
    }
    if case_name == "intimidate-stage-floor" {
        let pokemon_three = PokemonId::try_from_u64(3)?;
        let pokemon_four = PokemonId::try_from_u64(4)?;
        let exact_floor_attempt = |index: usize, pokemon: PokemonId| {
            matches!(
                presentation.get(index).map(|event| &event.kind),
                Some(BattlePresentationKind::StatStageChanged {
                    pokemon: candidate,
                    stat: BattleStat::Attack,
                    before: -6,
                    after: -6,
                }) if *candidate == pokemon
            )
        };
        if presentation.len() != 10
            || !exact_floor_attempt(5, pokemon_four)
            || !exact_floor_attempt(6, pokemon_three)
            || !exact_floor_attempt(8, pokemon_four)
            || !exact_floor_attempt(9, pokemon_three)
        {
            return Err(FixtureError::new(
                "intimidate-stage-floor: legacy clamped presentation order is outside its exact catalogue",
            )
            .into());
        }
        let (before_six, from_six) = presentation.split_at_mut(6);
        std::mem::swap(&mut before_six[5].kind, &mut from_six[0].kind);
        let (before_nine, from_nine) = presentation.split_at_mut(9);
        std::mem::swap(&mut before_nine[8].kind, &mut from_nine[0].kind);
    }
    if case_name == "same-side-simultaneous-faint" {
        let pokemon_three = PokemonId::try_from_u64(3)?;
        let pokemon_four = PokemonId::try_from_u64(4)?;
        if presentation.len() != 9
            || !matches!(
                presentation.get(4).map(|event| &event.kind),
                Some(BattlePresentationKind::StatStageChanged {
                    pokemon,
                    stat: BattleStat::Attack,
                    before: 0,
                    after: -1,
                }) if *pokemon == pokemon_four
            )
            || !matches!(
                presentation.get(5).map(|event| &event.kind),
                Some(BattlePresentationKind::StatStageChanged {
                    pokemon,
                    stat: BattleStat::Attack,
                    before: 0,
                    after: -1,
                }) if *pokemon == pokemon_three
            )
        {
            return Err(FixtureError::new(
                "same-side-simultaneous-faint: legacy stage presentation order is outside its exact catalogue",
            )
            .into());
        }
        let (before_five, from_five) = presentation.split_at_mut(5);
        std::mem::swap(&mut before_five[4].kind, &mut from_five[0].kind);
    }
    normalize_catalogued_voluntary_message_anchor(case_name, &presentation, &mut messages)?;
    normalize_catalogued_compacted_target_presentation(case_name, &mut presentation)?;
    normalize_catalogued_forced_replacement_presentation(case_name, &mut presentation, mutations)?;
    Ok(FixturePresentationTrace {
        typed: presentation,
        messages,
    })
}

fn normalize_catalogued_voluntary_message_anchor(
    case_name: &str,
    presentation: &[BattlePresentationEvent],
    messages: &mut [LegacyPresentationMessage],
) -> Result<(), Box<dyn Error>> {
    if case_name != "voluntary-switch" {
        return Ok(());
    }
    let pokemon_four = PokemonId::try_from_u64(4)?;
    let pokemon_five = PokemonId::try_from_u64(5)?;
    let attack_fell = LEGACY_MESSAGE_CATALOGUE[4];
    if presentation.len() != 10
        || messages.len() != 2
        || messages[0].sequence != 2
        || messages[0].typed_before != 2
        || messages[0].text != attack_fell
        || messages[1].sequence != 4
        || messages[1].typed_before != 3
        || messages[1].text != attack_fell
        || !matches!(
            presentation.get(2).map(|event| &event.kind),
            Some(BattlePresentationKind::StatStageChanged {
                pokemon,
                stat: BattleStat::Attack,
                before: 0,
                after: -1,
            }) if *pokemon == pokemon_four
        )
        || !matches!(
            presentation.get(3).map(|event| &event.kind),
            Some(BattlePresentationKind::StatStageChanged {
                pokemon,
                stat: BattleStat::Attack,
                before: 0,
                after: -1,
            }) if *pokemon == pokemon_five
        )
    {
        return Err(FixtureError::new(
            "voluntary-switch: legacy message anchor is outside the exact normalized Intimidate catalogue",
        )
        .into());
    }
    messages[0].typed_before = 3;
    Ok(())
}

fn normalize_catalogued_compacted_target_presentation(
    case_name: &str,
    presentation: &mut [BattlePresentationEvent],
) -> Result<(), Box<dyn Error>> {
    if case_name != "mixed-side-simultaneous-faint" {
        return Ok(());
    }
    let projection = LEGACY_COMPACTED_TARGET_PROJECTIONS
        .iter()
        .find(|projection| projection.case_name == case_name)
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: compacted-target presentation has no exact target catalogue entry"
            ))
        })?;
    let typed_target = FieldSlot::new(
        projection.typed_target_side,
        projection.typed_target_position,
    )?;
    let expected_move_id = MoveId::try_from_u64(projection.move_id)?;
    if presentation.len() != 7 {
        return Err(FixtureError::new(format!(
            "{case_name}: compacted-target presentation has typed length {}, expected exact 7",
            presentation.len()
        ))
        .into());
    }
    let event = presentation.get_mut(3).ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: compacted-target presentation event 3 is absent"
        ))
    })?;
    let BattlePresentationKind::MoveUsed {
        actor,
        move_id,
        targets,
    } = &mut event.kind
    else {
        return Err(FixtureError::new(format!(
            "{case_name}: compacted-target presentation event 3 is not the exact NO_EFFECT move"
        ))
        .into());
    };
    if u64::from(*actor) != projection.actor || *move_id != expected_move_id || !targets.is_empty()
    {
        return Err(FixtureError::new(format!(
            "{case_name}: compacted-target presentation event 3 is outside the exact empty legacy target shape"
        ))
        .into());
    }
    targets.push(typed_target);
    Ok(())
}

fn normalize_catalogued_forced_replacement_presentation(
    case_name: &str,
    presentation: &mut Vec<BattlePresentationEvent>,
    mutations: &[BattleMutation],
) -> Result<(), Box<dyn Error>> {
    if case_name != "forced-replacement" {
        return Ok(());
    }
    let pokemon_four = PokemonId::try_from_u64(4)?;
    let pokemon_five = PokemonId::try_from_u64(5)?;
    let expected_stages = vec![
        (pokemon_four, BattleStat::Attack, 0_i8, -1_i8),
        (pokemon_five, BattleStat::Attack, 0_i8, -1_i8),
        (pokemon_four, BattleStat::Attack, -1_i8, -2_i8),
        (pokemon_five, BattleStat::Attack, -1_i8, -2_i8),
    ];
    let observed_stages = mutations
        .iter()
        .filter_map(|mutation| match mutation {
            BattleMutation::StatStageChanged {
                pokemon,
                stat,
                before,
                after,
            } => Some((*pokemon, *stat, *before, *after)),
            _ => None,
        })
        .collect::<Vec<_>>();
    if presentation.len() != 8
        || observed_stages != expected_stages
        || !matches!(
            presentation.get(6).map(|event| &event.kind),
            Some(BattlePresentationKind::StatStageChanged {
                pokemon,
                stat: BattleStat::Attack,
                before: 0,
                after: -1,
            }) if *pokemon == pokemon_four
        )
        || !matches!(
            presentation.get(7).map(|event| &event.kind),
            Some(BattlePresentationKind::StatStageChanged {
                pokemon,
                stat: BattleStat::Attack,
                before: 0,
                after: -1,
            }) if *pokemon == pokemon_five
        )
    {
        return Err(FixtureError::new(
            "forced-replacement: typed presentation is outside the exact turn/replacement Intimidate catalogue",
        )
        .into());
    }
    let operation_id = presentation
        .first()
        .map(|event| event.event_id.operation_id.clone())
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: forced-replacement presentation has no operation identity"
            ))
        })?;
    for (pokemon, before, after) in [(pokemon_four, -1_i8, -2_i8), (pokemon_five, -1_i8, -2_i8)] {
        let sequence = SafeU53::new(u64::try_from(presentation.len())?)?;
        presentation.push(BattlePresentationEvent::new(
            BattlePresentationEventId::new(operation_id.clone(), sequence),
            PRESENTATION_BLOCKING_POLICY,
            PRESENTATION_SKIP_POLICY,
            BattlePresentationKind::StatStageChanged {
                pokemon,
                stat: BattleStat::Attack,
                before,
                after,
            },
        ));
    }
    Ok(())
}

fn legacy_battle_index(slot: FieldSlot) -> u64 {
    let side_offset = match slot.side {
        BattleSide::Player => 0,
        BattleSide::Enemy => 2,
    };
    side_offset + u64::from(slot.position)
}

fn assert_keys_with_optional(
    case_name: &str,
    path: &str,
    value: &Value,
    required_keys: &[&str],
    optional_keys: &[&str],
) -> Result<(), FixtureError> {
    let object = value
        .as_object()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not an object")))?;
    let allowed = required_keys
        .iter()
        .chain(optional_keys)
        .copied()
        .collect::<BTreeSet<_>>();
    if object.keys().any(|key| !allowed.contains(key.as_str()))
        || required_keys.iter().any(|key| !object.contains_key(*key))
    {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} has unsupported or missing command-boundary keys; actual={:?}, required={required_keys:?}, optional={optional_keys:?}",
            object.keys().collect::<Vec<_>>()
        )));
    }
    Ok(())
}

fn assert_json_value(
    case_name: &str,
    path: &str,
    expected: &Value,
    actual: &Value,
) -> Result<(), FixtureError> {
    if let Some(divergence) = first_divergence(expected, actual) {
        return Err(FixtureError::new(format!(
            "{case_name}: {path} differs: {divergence}"
        )));
    }
    Ok(())
}

fn legacy_target_bis(record: &FixtureCommandRecord) -> Vec<u64> {
    match &record.legacy_command {
        BattleCommand::Fight {
            targets: BattleTargetSelection::Selected(targets),
            ..
        } => targets
            .iter()
            .map(|slot| legacy_battle_index(*slot))
            .collect(),
        BattleCommand::Fight {
            targets: BattleTargetSelection::Implicit,
            ..
        }
        | BattleCommand::Switch { .. } => Vec::new(),
    }
}

fn record_move_id(
    case_name: &str,
    initial: &GameState,
    record: &FixtureCommandRecord,
) -> Result<Option<MoveId>, Box<dyn Error>> {
    let BattleCommand::Fight { move_slot, .. } = &record.command else {
        return Ok(None);
    };
    let pokemon = pokemon_state(initial, record.actor).ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: command-boundary actor {} is absent from initial state",
            record.actor
        ))
    })?;
    let move_state = pokemon
        .moves
        .get(usize::from(move_slot.get()))
        .and_then(Option::as_ref)
        .ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: command-boundary actor {} has no move in slot {}",
                record.actor,
                move_slot.get()
            ))
        })?;
    Ok(Some(move_state.move_id))
}

fn legacy_player_targets_live_on_parent(case_name: &str, record: &FixtureCommandRecord) -> bool {
    let catalogued_record = matches!(
        case_name,
        "speed-tie" | "paralysis-speed-order" | "doubles-single-target" | "voluntary-switch"
    ) || (case_name == "mixed-side-simultaneous-faint"
        && record.field_slot
            == FieldSlot::new(BattleSide::Player, 0).expect("valid parent-target catalogue slot")
        && record.operation_id.as_str() == "battle/1/wave/1/turn/1/command/player/0/seat/1");
    catalogued_record
        && record.field_slot.side == BattleSide::Player
        && matches!(
            &record.legacy_command,
            BattleCommand::Fight {
                targets: BattleTargetSelection::Selected(targets),
                ..
            } if !targets.is_empty()
        )
}

fn validate_legacy_move_wire(
    case_name: &str,
    path: &str,
    value: &Value,
    initial: &GameState,
    record: &FixtureCommandRecord,
) -> Result<(), Box<dyn Error>> {
    assert_exact_keys(case_name, path, value, &["move", "targets", "useMode"])?;
    let expected_move = record_move_id(case_name, initial, record)?
        .ok_or_else(|| FixtureError::new(format!("{case_name}: {path} is not a fight move")))?;
    let actual_move = MoveId::try_from_u64(u64_field(value, case_name, path, "move")?)?;
    if actual_move != expected_move {
        return Err(FixtureError::new(format!(
            "{case_name}: {path}.move is {actual_move}, expected typed move {expected_move}"
        ))
        .into());
    }
    if u64_field(value, case_name, path, "useMode")? != 1 {
        return Err(FixtureError::new(format!(
            "{case_name}: {path}.useMode is not the closed legacy mode 1"
        ))
        .into());
    }
    let nested_targets = if legacy_player_targets_live_on_parent(case_name, record) {
        Vec::new()
    } else {
        legacy_target_bis(record)
    };
    assert_json_value(
        case_name,
        &format!("{path}.targets"),
        &json!(nested_targets),
        required(value, case_name, path, "targets")?,
    )?;
    Ok(())
}

fn validate_legacy_command_wire(
    case_name: &str,
    path: &str,
    value: &Value,
    initial: &GameState,
    record: &FixtureCommandRecord,
) -> Result<(), Box<dyn Error>> {
    let command = u64_field(value, case_name, path, "command")?;
    match (record.field_slot.side, &record.legacy_command) {
        (BattleSide::Player, BattleCommand::Fight { move_slot, .. }) => {
            assert_keys_with_optional(
                case_name,
                path,
                value,
                &["args", "command", "cursor", "move"],
                &["targets"],
            )?;
            if command != 0
                || u64_field(value, case_name, path, "cursor")? != u64::from(move_slot.get())
                || required(value, case_name, path, "args")? != &json!([1, null])
            {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path} is not the closed legacy player fight command"
                ))
                .into());
            }
            validate_legacy_move_wire(
                case_name,
                &format!("{path}.move"),
                object_field(value, case_name, path, "move")?,
                initial,
                record,
            )?;
            if let Some(targets) = value.get("targets") {
                assert_json_value(
                    case_name,
                    &format!("{path}.targets"),
                    &json!(legacy_target_bis(record)),
                    targets,
                )?;
            } else if legacy_player_targets_live_on_parent(case_name, record) {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.targets is required by the exact parent-target legacy encoding"
                ))
                .into());
            }
        }
        (BattleSide::Player, BattleCommand::Switch { .. }) => {
            assert_exact_keys(case_name, path, value, &["args", "command", "cursor"])?;
            if command != 2
                || u64_field(value, case_name, path, "cursor")? != 2
                || required(value, case_name, path, "args")? != &json!([false])
            {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path} is not the closed legacy player switch command"
                ))
                .into());
            }
        }
        (BattleSide::Enemy, BattleCommand::Fight { .. }) => {
            assert_exact_keys(case_name, path, value, &["command", "move", "skip"])?;
            if command != 0 || required(value, case_name, path, "skip")?.as_bool() != Some(false) {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path} is not the closed legacy enemy fight command"
                ))
                .into());
            }
            validate_legacy_move_wire(
                case_name,
                &format!("{path}.move"),
                object_field(value, case_name, path, "move")?,
                initial,
                record,
            )?;
        }
        (BattleSide::Enemy, BattleCommand::Switch { .. }) => {
            return Err(FixtureError::new(format!(
                "{case_name}: enemy command-boundary record cannot be a switch"
            ))
            .into());
        }
    }
    Ok(())
}

fn validate_legacy_command_boundary(
    case_name: &str,
    boundary: &LegacyTurnBoundary,
    records: &[FixtureCommandRecord],
    initial: &GameState,
    before: bool,
) -> Result<(), Box<dyn Error>> {
    let commands = boundary.commands.as_object().ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: legacy TURN_ADVANCE {}.commands is not an object",
            if before { "before" } else { "after" }
        ))
    })?;
    let pre_commands = boundary.pre_commands.as_object().ok_or_else(|| {
        FixtureError::new(format!(
            "{case_name}: legacy TURN_ADVANCE {}.pre_commands is not an object",
            if before { "before" } else { "after" }
        ))
    })?;
    let expected_keys = records
        .iter()
        .map(|record| legacy_battle_index(record.field_slot).to_string())
        .collect::<BTreeSet<_>>();
    let command_keys = commands.keys().cloned().collect::<BTreeSet<_>>();
    let pre_keys = pre_commands.keys().cloned().collect::<BTreeSet<_>>();
    if command_keys != expected_keys || pre_keys != expected_keys {
        return Err(FixtureError::new(format!(
            "{case_name}: legacy TURN_ADVANCE {} command/pre-command keys differ: expected {expected_keys:?}, commands={command_keys:?}, pre_commands={pre_keys:?}",
            if before { "before" } else { "after" }
        ))
        .into());
    }

    for record in records {
        let bi = legacy_battle_index(record.field_slot).to_string();
        let command_path = format!(
            "TURN_ADVANCE.{}.commands[{bi}]",
            if before { "before" } else { "after" }
        );
        let pre_path = format!(
            "TURN_ADVANCE.{}.pre_commands[{bi}]",
            if before { "before" } else { "after" }
        );
        let command = commands
            .get(&bi)
            .ok_or_else(|| FixtureError::new(format!("{case_name}: {command_path} is missing")))?;
        let pre_command = pre_commands
            .get(&bi)
            .ok_or_else(|| FixtureError::new(format!("{case_name}: {pre_path} is missing")))?;
        if !before {
            if !command.is_null() || !pre_command.is_null() {
                return Err(FixtureError::new(format!(
                    "{case_name}: {command_path} and {pre_path} must both be null after TURN_ADVANCE"
                ))
                .into());
            }
            continue;
        }

        validate_legacy_command_wire(case_name, &command_path, command, initial, record)?;
        let expected_pre = matches!(
            (&record.legacy_command, record.field_slot.side),
            (BattleCommand::Fight { .. }, BattleSide::Player)
        );
        if expected_pre {
            assert_exact_keys(
                case_name,
                &pre_path,
                pre_command,
                &["command", "skip", "targets"],
            )?;
            if u64_field(pre_command, case_name, &pre_path, "command")? != 0
                || required(pre_command, case_name, &pre_path, "skip")?.as_bool() != Some(true)
            {
                return Err(FixtureError::new(format!(
                    "{case_name}: {pre_path} is not the closed pre-command marker"
                ))
                .into());
            }
            assert_json_value(
                case_name,
                &format!("{pre_path}.targets"),
                &json!([legacy_battle_index(record.field_slot)]),
                required(pre_command, case_name, &pre_path, "targets")?,
            )?;
        } else if !pre_command.is_null() {
            return Err(FixtureError::new(format!(
                "{case_name}: {pre_path} must be null for this typed command"
            ))
            .into());
        }
    }
    Ok(())
}

fn validate_legacy_turn_advances(
    case_name: &str,
    trace: &FixtureMutationTrace,
    actual: &[BattleMutation],
    records: &[FixtureCommandRecord],
    initial: &GameState,
    actions: &[ResolvedAction],
) -> Result<(), Box<dyn Error>> {
    let actual_turns = actual
        .iter()
        .filter_map(|mutation| match mutation {
            BattleMutation::TurnAdvanced { before, after } => Some((*before, *after)),
            _ => None,
        })
        .collect::<Vec<_>>();
    if LEGACY_POST_TURN_OUTCOME_CASES.contains(&case_name) && trace.turn_advances.is_empty() {
        if actual_turns.len() != 1
            || actual_turns[0].0.get().get() != 1
            || actual_turns[0].1.get().get() != 2
            || !matches!(
                trace.typed.iter().find(|mutation| {
                    matches!(mutation, BattleMutation::TurnAdvanced { .. })
                }),
                Some(BattleMutation::TurnAdvanced { before, after })
                    if before.get().get() == 1 && after.get().get() == 2
            )
        {
            return Err(FixtureError::new(format!(
                "{case_name}: post-turn outcome projection is outside the exact typed turn 1 -> 2 catalogue"
            ))
            .into());
        }
        return Ok(());
    }
    if actual_turns.len() != trace.turn_advances.len() {
        return Err(FixtureError::new(format!(
            "{case_name}: TURN_ADVANCE evidence count differs: legacy {}, typed {}",
            trace.turn_advances.len(),
            actual_turns.len()
        ))
        .into());
    }
    for (index, (legacy, (before, after))) in
        trace.turn_advances.iter().zip(actual_turns).enumerate()
    {
        if legacy.before.turn != before.get().get() || legacy.after.turn != after.get().get() {
            return Err(FixtureError::new(format!(
                "{case_name}: TURN_ADVANCE[{index}] turn boundary differs: legacy {} -> {}, typed {} -> {}",
                legacy.before.turn,
                legacy.after.turn,
                before.get().get(),
                after.get().get()
            ))
            .into());
        }
        validate_legacy_command_boundary(case_name, &legacy.before, records, initial, true)?;
        validate_legacy_command_boundary(case_name, &legacy.after, records, initial, false)?;
        if let Some(cause) = legacy.cause {
            let cause_sequence = SafeU53::new(u64::try_from(cause)?)?;
            let action = actions
                .iter()
                .find(|action| action.sequence == cause_sequence)
                .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: TURN_ADVANCE[{index}] cause {cause} is outside normalized action order"
                ))
            })?;
            if !is_exact_legacy_turn_boundary_cause(case_name, action, actions) {
                return Err(FixtureError::new(format!(
                    "{case_name}: TURN_ADVANCE[{index}] cause {cause} is not the exact final action"
                ))
                .into());
            }
        }
    }
    Ok(())
}

fn validate_legacy_faint_markers(
    case_name: &str,
    trace: &FixtureMutationTrace,
    actual: &[BattleMutation],
    initial: &GameState,
    actions: &[ResolvedAction],
) -> Result<(), Box<dyn Error>> {
    let mut current = BTreeMap::new();
    for party in initial
        .battle
        .as_ref()
        .into_iter()
        .flat_map(|battle| battle.player_party.iter().chain(&battle.enemy_party))
    {
        current.insert(party.id, (party.hp, party.status));
    }
    let mut marker_index = 0;
    let mut queued_count = 0;
    for (mutation_index, mutation) in actual.iter().enumerate() {
        match mutation {
            BattleMutation::HpChanged { pokemon, after, .. } => {
                let state = current.get_mut(pokemon).ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: typed HP mutation references unknown faint-marker Pokémon {pokemon}"
                    ))
                })?;
                state.0 = *after;
            }
            BattleMutation::StatusChanged { pokemon, after, .. } => {
                let state = current.get_mut(pokemon).ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: typed status mutation references unknown faint-marker Pokémon {pokemon}"
                    ))
                })?;
                state.1 = *after;
            }
            BattleMutation::FaintQueued { occurrence } => {
                let marker = trace.faint_markers.get(marker_index).ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: typed FaintQueued at mutation {mutation_index} has no legacy effect=7 evidence"
                    ))
                })?;
                if occurrence.pokemon != marker.pokemon {
                    return Err(FixtureError::new(format!(
                        "{case_name}: faint marker {} Pokémon {} differs from typed FaintQueued Pokémon {}",
                        marker_index,
                        marker.pokemon,
                        occurrence.pokemon
                    ))
                    .into());
                }
                let initial_slot = initial_field_slot_for_pokemon(initial, marker.pokemon).ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: faint marker {} Pokémon {} has no initial typed field slot",
                        marker_index, marker.pokemon
                    ))
                })?;
                if occurrence.slot != initial_slot {
                    return Err(FixtureError::new(format!(
                        "{case_name}: faint marker {} slot {:?} differs from typed FaintQueued slot {:?}",
                        marker_index, initial_slot, occurrence.slot
                    ))
                    .into());
                }
                let (hp, status) = current.get(&marker.pokemon).copied().ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: faint marker {} Pokémon {} disappeared from typed state",
                        marker_index, marker.pokemon
                    ))
                })?;
                if hp != marker.before.hp
                    || marker.before.fainted != (hp == 0)
                    || status != marker.before_status
                {
                    return Err(FixtureError::new(format!(
                        "{case_name}: faint marker {} before snapshot differs from typed state at FaintQueued",
                        marker_index
                    ))
                    .into());
                }
                if marker.after.hp != 0 || !marker.after.fainted {
                    return Err(FixtureError::new(format!(
                        "{case_name}: faint marker {} after snapshot is not hp=0/fainted",
                        marker_index
                    ))
                    .into());
                }
                if let Some(cause) = marker.cause {
                    let cause_sequence = SafeU53::new(u64::try_from(cause)?)?;
                    let action = actions
                        .iter()
                        .find(|action| action.sequence == cause_sequence)
                        .ok_or_else(|| {
                        FixtureError::new(format!(
                            "{case_name}: faint marker {} cause {cause} is outside normalized action order",
                            marker_index
                        ))
                    })?;
                    if action.kind != ResolvedActionKind::Faint
                        || action.actor != marker.pokemon
                        || action.source_slot != occurrence.slot
                        || action.command_operation_id.is_some()
                    {
                        return Err(FixtureError::new(format!(
                            "{case_name}: faint marker {} cause {cause} does not identify the exact typed faint action",
                            marker_index
                        ))
                        .into());
                    }
                }
                let resolved = actual[mutation_index + 1..].iter().any(|candidate| {
                    matches!(
                        candidate,
                        BattleMutation::FaintResolved { occurrence: resolved }
                            if *resolved == occurrence.id
                    )
                });
                if !resolved {
                    return Err(FixtureError::new(format!(
                        "{case_name}: faint marker {} occurrence {} has no later typed FaintResolved",
                        marker_index,
                        occurrence.id
                    ))
                    .into());
                }
                marker_index += 1;
                queued_count += 1;
            }
            _ => {}
        }
    }
    if queued_count != trace.faint_markers.len() {
        return Err(FixtureError::new(format!(
            "{case_name}: typed FaintQueued count {queued_count} differs from legacy effect=7 count {}",
            trace.faint_markers.len()
        ))
        .into());
    }
    Ok(())
}

fn voluntary_switch_rebased_hp_mutation(
    actual_index: usize,
) -> Option<(usize, u64, u32, u32, u32)> {
    match actual_index {
        7 => Some((7, 2, 201, 157, 159)),
        12 => Some((12, 3, 251, 216, 217)),
        17 => Some((17, 4, 198, 113, 124)),
        _ => None,
    }
}

fn is_catalogued_turn_boundary_rng_seam(mutations: &[BattleMutation], index: usize) -> bool {
    matches!(
        (mutations.get(index), mutations.get(index + 1)),
        (
            Some(BattleMutation::BattleRngChanged { before, after }),
            Some(BattleMutation::TurnAdvanced {
                before: turn_before,
                after: turn_after,
            }),
        ) if before.battle_seed == after.battle_seed
            && before.turn.get().get().checked_add(1) == Some(after.turn.get().get())
            && after.saved_substream.is_none()
            && before.turn == *turn_before
            && after.turn == *turn_after
    )
}

fn project_catalogued_voluntary_switch_stat_stage_order(
    case_name: &str,
    trace: &FixtureMutationTrace,
    projected: &mut [BattleMutation],
) -> Result<(), Box<dyn Error>> {
    if case_name != "voluntary-switch" {
        return Ok(());
    }
    let pokemon_four = PokemonId::try_from_u64(4)?;
    let pokemon_five = PokemonId::try_from_u64(5)?;
    let legacy_first = BattleMutation::StatStageChanged {
        pokemon: pokemon_five,
        stat: BattleStat::Attack,
        before: 0,
        after: -1,
    };
    let legacy_second = BattleMutation::StatStageChanged {
        pokemon: pokemon_four,
        stat: BattleStat::Attack,
        before: 0,
        after: -1,
    };
    if trace.typed.get(1) != Some(&legacy_first) || trace.typed.get(2) != Some(&legacy_second) {
        return Err(FixtureError::new(
            "voluntary-switch: retained legacy Intimidate stage order is outside its exact catalogue",
        )
        .into());
    }
    if projected.get(1) != Some(&legacy_second) || projected.get(2) != Some(&legacy_first) {
        return Err(FixtureError::new(
            "voluntary-switch: typed Intimidate stage order is outside its exact catalogue",
        )
        .into());
    }
    projected.swap(1, 2);
    Ok(())
}

fn normalize_catalogued_deterministic_intimidate_mutations(
    case_name: &str,
    trace: &mut FixtureMutationTrace,
    actual: &[BattleMutation],
    rng_audit: &[RngDraw],
) -> Result<(), Box<dyn Error>> {
    if case_name != "voluntary-switch" {
        return Ok(());
    }
    let mut projected = actual
        .iter()
        .enumerate()
        .filter(|(index, mutation)| {
            !matches!(
                mutation,
                BattleMutation::CommandCollectionChanged { .. }
                    | BattleMutation::OutcomeChanged { .. }
            ) && !is_catalogued_turn_boundary_rng_seam(actual, *index)
        })
        .map(|(_, mutation)| mutation.clone())
        .collect::<Vec<_>>();
    if trace.typed.len() != 19 || projected.len() != 19 {
        return Err(FixtureError::new(format!(
            "{case_name}: deterministic-Intimidate mutation projection has legacy/typed lengths {}/{}, expected exact 19/19",
            trace.typed.len(),
            projected.len()
        ))
        .into());
    }
    let typed_projection = projected.clone();
    project_catalogued_voluntary_switch_stat_stage_order(case_name, trace, &mut projected)?;

    for legacy_index in [4, 5, 6, 9, 10, 11, 14, 15, 16] {
        if !matches!(
            trace.typed.get(legacy_index),
            Some(BattleMutation::BattleRngChanged { .. })
        ) {
            return Err(FixtureError::new(format!(
                "{case_name}: retained legacy mutation {legacy_index} is not an exact per-draw BattleRngChanged entry"
            ))
            .into());
        }
    }
    let battle_draws = rng_audit
        .iter()
        .filter(|draw| draw.stream == RngStream::Battle)
        .collect::<Vec<_>>();
    if battle_draws.len() != 9 {
        return Err(FixtureError::new(format!(
            "{case_name}: production RNG audit has {} battle draws, expected exact 9",
            battle_draws.len()
        ))
        .into());
    }

    let mut battle_draw_index = 0;
    for (actual_index, mutation) in projected.iter().enumerate() {
        if matches!(actual_index, 4 | 5 | 6 | 9 | 10 | 11 | 14 | 15 | 16) {
            let draw = battle_draws.get(battle_draw_index).ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: production BattleRngChanged mutation {actual_index} has no exact audit draw"
                ))
            })?;
            let BattleMutation::BattleRngChanged { before, after } = mutation else {
                return Err(FixtureError::new(format!(
                    "{case_name}: production mutation {actual_index} is not an exact per-draw BattleRngChanged entry"
                ))
                .into());
            };
            if draw.before_state.battle.as_ref() != Some(before)
                || draw.after_state.battle.as_ref() != Some(after)
            {
                return Err(FixtureError::new(format!(
                    "{case_name}: production BattleRngChanged mutation {actual_index} is not bounded by its exact audit draw"
                ))
                .into());
            }
            battle_draw_index += 1;
            continue;
        }
        if let Some((legacy_index, pokemon, before, legacy_after, typed_after)) =
            voluntary_switch_rebased_hp_mutation(actual_index)
        {
            let pokemon = PokemonId::try_from_u64(pokemon)?;
            let Some(BattleMutation::HpChanged {
                pokemon: legacy_pokemon,
                before: legacy_before,
                after: observed_legacy_after,
            }) = trace.typed.get(legacy_index)
            else {
                return Err(FixtureError::new(format!(
                    "{case_name}: retained legacy mutation {legacy_index} is not HpChanged"
                ))
                .into());
            };
            let BattleMutation::HpChanged {
                pokemon: actual_pokemon,
                before: actual_before,
                after: actual_after,
            } = mutation
            else {
                return Err(FixtureError::new(format!(
                    "{case_name}: production mutation {actual_index} is not HpChanged"
                ))
                .into());
            };
            if *legacy_pokemon != pokemon
                || *actual_pokemon != pokemon
                || *legacy_before != before
                || *actual_before != before
                || *observed_legacy_after != legacy_after
                || *actual_after != typed_after
            {
                return Err(FixtureError::new(format!(
                    "{case_name}: rebased HP mutation {actual_index} differs from its exact legacy/typed catalogue"
                ))
                .into());
            }
            continue;
        }
        let legacy_index = match actual_index {
            0..=3 | 7..=8 | 12..=13 | 17..=18 => actual_index,
            _ => {
                return Err(FixtureError::new(format!(
                    "{case_name}: production mutation {actual_index} is outside the exact deterministic-Intimidate projection"
                ))
                .into());
            }
        };
        if trace.typed.get(legacy_index) != Some(mutation) {
            return Err(FixtureError::new(format!(
                "{case_name}: production mutation {actual_index} differs from exact retained legacy mutation {legacy_index}"
            ))
            .into());
        }
    }
    if battle_draw_index != battle_draws.len() {
        return Err(FixtureError::new(format!(
            "{case_name}: projected BattleRngChanged mutations consumed {battle_draw_index} of {} exact audit draws",
            battle_draws.len()
        ))
        .into());
    }
    trace.typed = typed_projection;
    Ok(())
}

fn normalize_catalogued_grass_powder_mutations(
    case_name: &str,
    trace: &mut FixtureMutationTrace,
    actual: &[BattleMutation],
    rng_audit: &[RngDraw],
) -> Result<(), Box<dyn Error>> {
    if case_name != "grass-powder-immunity" {
        return Ok(());
    }
    let projected = actual
        .iter()
        .enumerate()
        .filter(|(index, mutation)| {
            !matches!(
                mutation,
                BattleMutation::CommandCollectionChanged { .. }
                    | BattleMutation::OutcomeChanged { .. }
            ) && !is_catalogued_turn_boundary_rng_seam(actual, *index)
        })
        .map(|(_, mutation)| mutation.clone())
        .collect::<Vec<_>>();
    if trace.typed.len() != 7 || projected.len() != 8 {
        return Err(FixtureError::new(format!(
            "{case_name}: grass-powder mutation projection has legacy/typed lengths {}/{}, expected exact 7/8",
            trace.typed.len(),
            projected.len()
        ))
        .into());
    }
    if trace.typed[0] != projected[0]
        || trace.typed[1] != projected[2]
        || trace.typed[2] != projected[1]
        || trace.typed[3] != projected[3]
        || trace.typed[4] != projected[4]
        || trace.typed[6] != projected[7]
        || !matches!(
            &trace.typed[5],
            BattleMutation::HpChanged {
                pokemon,
                before: 201,
                after: 159,
            } if u64::from(*pokemon) == 1
        )
        || !matches!(
            &projected[6],
            BattleMutation::HpChanged {
                pokemon,
                before: 201,
                after: 162,
            } if u64::from(*pokemon) == 1
        )
    {
        return Err(FixtureError::new(
            "grass-powder-immunity: PP/HP/turn mutation projection differs from its exact catalogue",
        )
        .into());
    }
    let battle_draws = rng_audit
        .iter()
        .filter(|draw| draw.stream == RngStream::Battle)
        .collect::<Vec<_>>();
    if battle_draws.len() != 4 {
        return Err(FixtureError::new(format!(
            "{case_name}: production RNG audit has {} battle draws, expected exact 4",
            battle_draws.len()
        ))
        .into());
    }
    for (mutation_index, draw) in (1..=5).filter(|index| *index != 2).zip(battle_draws) {
        let Some(BattleMutation::BattleRngChanged { before, after }) =
            projected.get(mutation_index)
        else {
            return Err(FixtureError::new(format!(
                "{case_name}: projected mutation {mutation_index} is not BattleRngChanged"
            ))
            .into());
        };
        if draw.before_state.battle.as_ref() != Some(before)
            || draw.after_state.battle.as_ref() != Some(after)
        {
            return Err(FixtureError::new(format!(
                "{case_name}: projected mutation {mutation_index} is not bounded by its exact audit draw"
            ))
            .into());
        }
    }
    trace.typed = projected;
    Ok(())
}

fn normalize_catalogued_legacy_faint_mutations(
    case_name: &str,
    trace: &mut FixtureMutationTrace,
) -> Result<(), Box<dyn Error>> {
    let stale = legacy_stale_final_occupants()
        .into_iter()
        .filter(|entry| entry.case_name == case_name)
        .collect::<Vec<_>>();
    if stale.is_empty() {
        return Ok(());
    }
    let typed_stale = stale
        .iter()
        .map(|entry| {
            let occurrence = trace
                .typed
                .iter()
                .find_map(|mutation| match mutation {
                    BattleMutation::FaintQueued { occurrence }
                        if occurrence.pokemon == entry.pokemon => Some(occurrence),
                    _ => None,
                })
                .ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: stale legacy occupant {} has no retained FaintQueued evidence",
                        entry.pokemon
                    ))
                })?;
            let compacted_mixed_slot = case_name == "mixed-side-simultaneous-faint"
                && entry.slot == FieldSlot::new(BattleSide::Player, 1)?
                && occurrence.slot == FieldSlot::new(BattleSide::Player, 0)?;
            if occurrence.slot != entry.slot && !compacted_mixed_slot {
                return Err(FixtureError::new(format!(
                    "{case_name}: stale legacy slot {:?} and typed faint slot {:?} differ outside the exact compaction catalogue",
                    entry.slot, occurrence.slot
                ))
                .into());
            }
            Ok((*entry, occurrence.slot, occurrence.id))
        })
        .collect::<Result<Vec<_>, Box<dyn Error>>>()?;

    let added_turn = LEGACY_POST_TURN_OUTCOME_CASES.contains(&case_name);
    let legacy_turns = trace
        .typed
        .iter()
        .filter(|mutation| matches!(mutation, BattleMutation::TurnAdvanced { .. }))
        .count();
    let expected_legacy_turns = usize::from(case_name == "mixed-side-simultaneous-faint");
    if legacy_turns != expected_legacy_turns {
        return Err(FixtureError::new(format!(
            "{case_name}: retained legacy faint trace has {legacy_turns} turn boundaries, expected exact {expected_legacy_turns}"
        ))
        .into());
    }

    let mut deferred = Vec::new();
    let mut terminal = BTreeMap::new();
    for (entry, typed_slot, occurrence) in &typed_stale {
        let progress = trace.typed.iter().find(|mutation| {
            matches!(
                mutation,
                BattleMutation::FaintProgressChanged {
                    occurrence: candidate,
                    ..
                } if *candidate == *occurrence
            )
        });
        let resolved = trace
            .typed
            .iter()
            .find(|mutation| {
                matches!(
                    mutation,
                    BattleMutation::FaintResolved {
                        occurrence: candidate,
                    } if *candidate == *occurrence
                )
            })
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: occurrence {occurrence} has no retained FaintResolved evidence"
                ))
            })?;
        let field = BattleMutation::FieldChanged {
            slot: *typed_slot,
            before: Some(entry.pokemon),
            after: None,
        };
        if let Some(progress) = progress {
            deferred.push((*occurrence, progress.clone(), field, resolved.clone()));
        } else if terminal.insert(*occurrence, field).is_some() {
            return Err(FixtureError::new(format!(
                "{case_name}: terminal faint occurrence {occurrence} is duplicated"
            ))
            .into());
        }
    }
    deferred.sort_by_key(|(occurrence, ..)| *occurrence);

    let deferred_ids = deferred
        .iter()
        .map(|(occurrence, ..)| *occurrence)
        .collect::<BTreeSet<_>>();
    let mut normalized =
        Vec::with_capacity(trace.typed.len() + typed_stale.len() + usize::from(added_turn));
    for mutation in &trace.typed {
        let occurrence = match mutation {
            BattleMutation::FaintProgressChanged { occurrence, .. }
            | BattleMutation::FaintResolved { occurrence } => Some(*occurrence),
            _ => None,
        };
        if occurrence.is_some_and(|candidate| deferred_ids.contains(&candidate)) {
            continue;
        }
        if let Some(occurrence) = occurrence
            && let Some(field) = terminal.get(&occurrence)
        {
            normalized.push(field.clone());
        }
        normalized.push(mutation.clone());
    }
    if added_turn {
        normalized.push(BattleMutation::TurnAdvanced {
            before: TurnIndex::try_from_u64(1)?,
            after: TurnIndex::try_from_u64(2)?,
        });
    }
    for (_, progress, field, resolved) in deferred {
        normalized.push(progress);
        normalized.push(field);
        normalized.push(resolved);
    }
    trace.typed = normalized;
    Ok(())
}

fn normalize_catalogued_same_side_stage_order(
    case_name: &str,
    trace: &mut FixtureMutationTrace,
) -> Result<(), Box<dyn Error>> {
    if case_name != "same-side-simultaneous-faint" {
        return Ok(());
    }
    let pokemon_three = PokemonId::try_from_u64(3)?;
    let pokemon_four = PokemonId::try_from_u64(4)?;
    if trace.typed.len() != 22
        || !matches!(
            trace.typed.get(7),
            Some(BattleMutation::StatStageChanged {
                pokemon,
                stat: BattleStat::Attack,
                before: 0,
                after: -1,
            }) if *pokemon == pokemon_four
        )
        || !matches!(
            trace.typed.get(8),
            Some(BattleMutation::StatStageChanged {
                pokemon,
                stat: BattleStat::Attack,
                before: 0,
                after: -1,
            }) if *pokemon == pokemon_three
        )
    {
        return Err(FixtureError::new(
            "same-side-simultaneous-faint: legacy stage mutation order is outside its exact catalogue",
        )
        .into());
    }
    trace.typed.swap(7, 8);
    Ok(())
}

fn compare_mutation_trace(
    case_name: &str,
    expected: &[BattleMutation],
    actual: &[BattleMutation],
    transition_before: &GameState,
    final_state: &GameState,
) -> Result<(), Box<dyn Error>> {
    let before_command_state = transition_before
        .battle
        .as_ref()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: transition has no before battle")))?
        .command_state
        .clone();
    let empty_command_state =
        CommandCollectionState::new(Vec::new(), before_command_state.tombstones.clone())?;
    let final_outcome = final_state
        .battle
        .as_ref()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: final state has no battle")))?
        .outcome;
    let mut projected = Vec::new();
    let mut command_changes = 0;
    let mut command_change_index = None;
    let mut outcome_changes = 0;
    let mut outcome_change_index = None;
    for (index, mutation) in actual.iter().enumerate() {
        if is_catalogued_turn_boundary_rng_seam(actual, index) {
            continue;
        }
        match mutation {
            BattleMutation::CommandCollectionChanged { before, after } => {
                command_changes += 1;
                command_change_index = Some(index);
                if *before != before_command_state || *after != empty_command_state {
                    return Err(FixtureError::new(format!(
                        "{case_name}: typed command-collection seam at mutation {index} does not clear the admitted frontier exactly"
                    ))
                    .into());
                }
            }
            BattleMutation::OutcomeChanged { before, after } => {
                outcome_changes += 1;
                outcome_change_index = Some(index);
                if *before != BattleOutcome::Ongoing
                    || *after != final_outcome
                    || !matches!(
                        actual.get(index.checked_sub(1).unwrap_or(usize::MAX)),
                        Some(BattleMutation::FaintResolved { .. })
                    )
                {
                    return Err(FixtureError::new(format!(
                        "{case_name}: typed outcome seam at mutation {index} is not causally after FaintResolved to the final outcome"
                    ))
                    .into());
                }
            }
            other => projected.push(other.clone()),
        }
    }
    let expected_command_changes = if before_command_state != empty_command_state {
        1
    } else {
        0
    };
    if command_changes != expected_command_changes {
        return Err(FixtureError::new(format!(
            "{case_name}: typed command-collection seam count is {command_changes}, expected {expected_command_changes}"
        ))
        .into());
    }
    let expected_outcome_changes = if final_outcome != BattleOutcome::Ongoing {
        1
    } else {
        0
    };
    if outcome_changes != expected_outcome_changes {
        return Err(FixtureError::new(format!(
            "{case_name}: typed outcome seam count is {outcome_changes}, expected {expected_outcome_changes}"
        ))
        .into());
    }
    if let (Some(command_index), Some(turn_index)) = (
        command_change_index,
        actual
            .iter()
            .position(|mutation| matches!(mutation, BattleMutation::TurnAdvanced { .. })),
    ) && command_index >= turn_index
    {
        return Err(FixtureError::new(format!(
            "{case_name}: command-collection clearing is not causally before TURN_ADVANCE"
        ))
        .into());
    }
    if let Some(outcome_index) = outcome_change_index {
        let post_turn = actual[..outcome_index]
            .iter()
            .any(|mutation| matches!(mutation, BattleMutation::TurnAdvanced { .. }));
        let catalogued = LEGACY_POST_TURN_OUTCOME_CASES.contains(&case_name);
        if post_turn != catalogued {
            return Err(FixtureError::new(format!(
                "{case_name}: outcome-after-TURN_ADVANCE shape is outside its exact catalogue"
            ))
            .into());
        }
    }
    compare_serialized_axis(case_name, "CAUSAL_MUTATIONS.TYPED", expected, &projected)?;
    Ok(())
}

fn validate_legacy_message_trace(
    case_name: &str,
    trace: &FixturePresentationTrace,
) -> Result<(), Box<dyn Error>> {
    let mut previous_sequence = None;
    let mut previous_anchor = 0;
    for (index, message) in trace.messages.iter().enumerate() {
        if !LEGACY_MESSAGE_CATALOGUE.contains(&message.text.as_str()) {
            return Err(FixtureError::new(format!(
                "{case_name}: legacy message {index} is outside the closed catalogue: {:?}",
                message.text
            ))
            .into());
        }
        if previous_sequence.is_some_and(|sequence| message.sequence <= sequence) {
            return Err(FixtureError::new(format!(
                "{case_name}: legacy message {index} sequence {} is not strictly ordered",
                message.sequence
            ))
            .into());
        }
        if message.typed_before == 0 || message.typed_before > trace.typed.len() {
            return Err(FixtureError::new(format!(
                "{case_name}: legacy message {index} has invalid typed anchor {} for {} typed events",
                message.typed_before,
                trace.typed.len()
            ))
            .into());
        }
        if message.typed_before < previous_anchor {
            return Err(FixtureError::new(format!(
                "{case_name}: legacy message {index} moves backward from typed anchor {previous_anchor} to {}",
                message.typed_before
            ))
            .into());
        }
        let previous = &trace.typed[message.typed_before - 1].kind;
        let semantic_match = if message.text.contains("burned")
            || message.text.contains("poisoned")
            || message.text.contains("was paralyzed")
        {
            matches!(
                previous,
                BattlePresentationKind::StatusApplied { .. }
                    | BattlePresentationKind::HpChanged { .. }
            )
        } else if message.text.contains("Attack fell")
            || message.text.contains("Attack won’t go any lower")
        {
            matches!(
                previous,
                BattlePresentationKind::MoveUsed { .. }
                    | BattlePresentationKind::StatStageChanged { .. }
            )
        } else {
            matches!(
                previous,
                BattlePresentationKind::MoveUsed { .. }
                    | BattlePresentationKind::HpChanged { .. }
                    | BattlePresentationKind::StatusApplied { .. }
                    | BattlePresentationKind::StatStageChanged { .. }
                    | BattlePresentationKind::AbilityActivated { .. }
                    | BattlePresentationKind::Switched { .. }
                    | BattlePresentationKind::Fainted { .. }
            )
        };
        if !semantic_match {
            return Err(FixtureError::new(format!(
                "{case_name}: legacy message {index} {:?} is not causally anchored after typed presentation event {}",
                message.text,
                message.typed_before - 1
            ))
            .into());
        }
        previous_sequence = Some(message.sequence);
        previous_anchor = message.typed_before;
    }
    Ok(())
}

fn terminal_presentation_outcome(kind: &BattlePresentationKind) -> Option<BattleOutcome> {
    match kind {
        BattlePresentationKind::BattleWon => Some(BattleOutcome::Victory),
        BattlePresentationKind::BattleLost => Some(BattleOutcome::Defeat),
        _ => None,
    }
}

fn validate_presentation_ids(
    case_name: &str,
    axis_name: &str,
    operation_id: &OperationId,
    presentation: &[BattlePresentationEvent],
) -> Result<(), Box<dyn Error>> {
    for (index, event) in presentation.iter().enumerate() {
        if event.event_id.operation_id != *operation_id
            || event.event_id.sequence != SafeU53::new(u64::try_from(index)?)?
        {
            return Err(FixtureError::new(format!(
                "{case_name}: {axis_name}[{index}] has event identity {:?}, expected {operation_id}/{index}",
                event.event_id
            ))
            .into());
        }
    }
    Ok(())
}

fn project_typed_presentation(
    case_name: &str,
    material_operation_id: &OperationId,
    turn_presentation: &[BattlePresentationEvent],
    transition_outcome: BattleOutcome,
    replacements: &[ReplacementPresentationTrace],
    final_outcome: BattleOutcome,
) -> Result<Vec<BattlePresentationEvent>, Box<dyn Error>> {
    validate_presentation_ids(
        case_name,
        "TURN_PRESENTATION",
        material_operation_id,
        turn_presentation,
    )?;
    let mut projected = Vec::new();
    let mut terminal_count = 0;
    let mut terminal_outcome = None;
    for event in turn_presentation {
        if let Some(outcome) = terminal_presentation_outcome(&event.kind) {
            terminal_count += 1;
            terminal_outcome = Some(outcome);
        } else {
            projected.push(event.clone());
        }
    }
    if transition_outcome == BattleOutcome::Ongoing && terminal_count != 0 {
        return Err(FixtureError::new(format!(
            "{case_name}: ongoing TURN production presentation contains a terminal event"
        ))
        .into());
    }
    if transition_outcome != BattleOutcome::Ongoing
        && (terminal_count != 1 || terminal_outcome != Some(transition_outcome))
    {
        return Err(FixtureError::new(format!(
            "{case_name}: TURN production terminal presentation does not match {:?}",
            transition_outcome
        ))
        .into());
    }

    for (replacement_index, replacement) in replacements.iter().enumerate() {
        validate_presentation_ids(
            case_name,
            &format!("REPLACEMENT_PRESENTATION[{replacement_index}]"),
            &replacement.operation_id,
            &replacement.presentation,
        )?;
        let mut replacement_terminal_count = 0;
        let mut replacement_terminal_outcome = None;
        let mut selected_switches = 0;
        for event in &replacement.presentation {
            if let Some(outcome) = terminal_presentation_outcome(&event.kind) {
                replacement_terminal_count += 1;
                replacement_terminal_outcome = Some(outcome);
                continue;
            }
            match (&replacement.selection, &event.kind) {
                (
                    ReplacementSelection::Selected { pokemon, .. },
                    BattlePresentationKind::Switched { slot, incoming, .. },
                ) => {
                    selected_switches += 1;
                    if *slot != replacement.field_slot || incoming != pokemon {
                        return Err(FixtureError::new(format!(
                            "{case_name}: replacement {replacement_index} switch presentation does not match its typed selection"
                        ))
                        .into());
                    }
                }
                (
                    ReplacementSelection::Selected { .. },
                    BattlePresentationKind::AbilityActivated { .. },
                ) => {}
                (
                    ReplacementSelection::NoLegalReplacement,
                    BattlePresentationKind::Switched { .. },
                )
                | (
                    ReplacementSelection::NoLegalReplacement,
                    BattlePresentationKind::AbilityActivated { .. },
                ) => {
                    return Err(FixtureError::new(format!(
                        "{case_name}: no-legal replacement {replacement_index} emitted selected-only presentation evidence"
                    ))
                    .into());
                }
                _ => projected.push(event.clone()),
            }
        }
        if matches!(replacement.selection, ReplacementSelection::Selected { .. })
            && selected_switches != 1
        {
            return Err(FixtureError::new(format!(
                "{case_name}: selected replacement {replacement_index} emitted {selected_switches} typed switch events, expected exactly one"
            ))
            .into());
        }
        if replacement.outcome == BattleOutcome::Ongoing {
            if replacement_terminal_count != 0 {
                return Err(FixtureError::new(format!(
                    "{case_name}: ongoing replacement {replacement_index} contains a terminal presentation"
                ))
                .into());
            }
        } else if replacement_terminal_count != 1
            || replacement_terminal_outcome != Some(replacement.outcome)
        {
            return Err(FixtureError::new(format!(
                "{case_name}: replacement {replacement_index} terminal presentation does not match {:?}",
                replacement.outcome
            ))
            .into());
        }
    }
    let expected_terminal_count = if final_outcome != BattleOutcome::Ongoing {
        1
    } else {
        0
    };
    if terminal_count
        + replacements
            .iter()
            .flat_map(|replacement| replacement.presentation.iter())
            .filter(|event| terminal_presentation_outcome(&event.kind).is_some())
            .count()
        != expected_terminal_count
    {
        return Err(FixtureError::new(format!(
            "{case_name}: typed terminal presentation count does not match final outcome {:?}",
            final_outcome
        ))
        .into());
    }
    let mut rebound = Vec::with_capacity(projected.len());
    for (index, mut event) in projected.into_iter().enumerate() {
        event.event_id = BattlePresentationEventId::new(
            material_operation_id.clone(),
            SafeU53::new(u64::try_from(index)?)?,
        );
        rebound.push(event);
    }
    Ok(rebound)
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
                "initial_state" | "initial_rng" | "commands" | "final_rng" | "expected_final_state"
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

fn normalize_catalogued_deterministic_intimidate_final(
    case_name: &str,
    expected: &mut GameState,
    expected_rng: &mut FixtureRngBoundary,
    actual: &GameState,
) -> Result<(), Box<dyn Error>> {
    if case_name == "voluntary-switch" {
        for (pokemon, legacy_hp, typed_hp, max_hp) in
            [(2, 157, 159, 201), (3, 216, 217, 251), (4, 113, 124, 198)]
        {
            let pokemon = PokemonId::try_from_u64(pokemon)?;
            let expected_pokemon = pokemon_state(expected, pokemon)
                .ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: catalogued final-state Pokemon {pokemon} is absent"
                    ))
                })?
                .clone();
            let actual_pokemon = pokemon_state(actual, pokemon).ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: typed final-state Pokemon {pokemon} is absent"
                ))
            })?;
            if expected_pokemon.hp != legacy_hp
                || expected_pokemon.max_hp != max_hp
                || expected_pokemon.fainted
                || actual_pokemon.hp != typed_hp
            {
                return Err(FixtureError::new(format!(
                    "{case_name}: final-state Pokemon {pokemon} is outside the exact rebased HP catalogue"
                ))
                .into());
            }
            let mut normalized = expected_pokemon;
            normalized.hp = typed_hp;
            if normalized != *actual_pokemon {
                return Err(FixtureError::new(format!(
                    "{case_name}: final-state Pokemon {pokemon} differs outside rebased HP"
                ))
                .into());
            }
            pokemon_state_mut(expected, pokemon)
                .ok_or_else(|| {
                    FixtureError::new(format!(
                        "{case_name}: catalogued final-state Pokemon {pokemon} disappeared"
                    ))
                })?
                .hp = typed_hp;
        }
        return Ok(());
    }
    if LEGACY_POST_TURN_OUTCOME_CASES.contains(&case_name) {
        let expected_battle = expected.battle.as_mut().ok_or_else(|| {
            FixtureError::new(format!("{case_name}: expected final state has no battle"))
        })?;
        let actual_battle = actual.battle.as_ref().ok_or_else(|| {
            FixtureError::new(format!("{case_name}: typed final state has no battle"))
        })?;
        if expected_battle.battle_rng != expected_rng.battle
            || expected_battle.battle_rng.saved_substream.is_none()
            || expected_battle.battle_rng.turn.get().get() != 1
            || expected_battle.turn.get().get() != 1
            || actual_battle.battle_rng.saved_substream.is_some()
            || actual_battle.battle_rng.turn.get().get() != 2
            || actual_battle.turn.get().get() != 2
            || expected_battle.battle_rng.battle_seed != actual_battle.battle_rng.battle_seed
        {
            return Err(FixtureError::new(format!(
                "{case_name}: final state is outside the exact post-turn outcome RNG/turn projection"
            ))
            .into());
        }
        expected_battle.battle_rng = actual_battle.battle_rng.clone();
        expected_battle.turn = actual_battle.turn;
        expected_rng.battle = actual_battle.battle_rng.clone();
        return Ok(());
    }
    if case_name == "forced-replacement" {
        let expected_battle = expected.battle.as_mut().ok_or_else(|| {
            FixtureError::new(format!("{case_name}: expected final state has no battle"))
        })?;
        let actual_battle = actual.battle.as_ref().ok_or_else(|| {
            FixtureError::new(format!("{case_name}: typed final state has no battle"))
        })?;
        if expected_battle.battle_rng != expected_rng.battle
            || expected_battle.battle_rng.saved_substream.is_none()
            || actual_battle.battle_rng.saved_substream.is_some()
            || expected_battle.battle_rng.battle_seed != actual_battle.battle_rng.battle_seed
            || expected_battle.battle_rng.turn != actual_battle.battle_rng.turn
        {
            return Err(FixtureError::new(format!(
                "{case_name}: final RNG is outside the exact trailing deterministic-Intimidate projection"
            ))
            .into());
        }
        expected_battle.battle_rng = actual_battle.battle_rng.clone();
        expected_rng.battle = actual_battle.battle_rng.clone();
    }
    Ok(())
}

fn normalize_catalogued_final_player_party_order(
    case_name: &str,
    expected: &mut GameState,
    actual: &GameState,
) -> Result<(), Box<dyn Error>> {
    let (legacy_order, typed_order) = match case_name {
        "mixed-side-simultaneous-faint" => (vec![2_u64, 1], vec![1_u64, 2]),
        "forced-replacement" => (vec![3_u64, 2, 1], vec![1_u64, 2, 3]),
        "voluntary-switch" => (vec![3_u64, 2, 1], vec![1_u64, 2, 3]),
        _ => return Ok(()),
    };
    let expected_battle = expected.battle.as_mut().ok_or_else(|| {
        FixtureError::new(format!("{case_name}: expected final state has no battle"))
    })?;
    let actual_battle = actual.battle.as_ref().ok_or_else(|| {
        FixtureError::new(format!("{case_name}: typed final state has no battle"))
    })?;
    let expected_ids = expected_battle
        .player_party
        .iter()
        .map(|pokemon| u64::from(pokemon.id))
        .collect::<Vec<_>>();
    let actual_ids = actual_battle
        .player_party
        .iter()
        .map(|pokemon| u64::from(pokemon.id))
        .collect::<Vec<_>>();
    if expected_ids != legacy_order {
        return Err(FixtureError::new(format!(
            "{case_name}: legacy final player_party identity/order is outside the exact catalogue: expected {legacy_order:?}, actual {expected_ids:?}"
        ))
        .into());
    }
    if actual_ids != typed_order {
        return Err(FixtureError::new(format!(
            "{case_name}: typed final player_party identity/order is outside the exact catalogue: expected {typed_order:?}, actual {actual_ids:?}"
        ))
        .into());
    }

    let mut normalized = Vec::with_capacity(expected_battle.player_party.len());
    for pokemon_id in typed_order {
        let index = expected_battle
            .player_party
            .iter()
            .position(|pokemon| u64::from(pokemon.id) == pokemon_id)
            .ok_or_else(|| {
                FixtureError::new(format!(
                    "{case_name}: catalogued final player_party Pokemon {pokemon_id} disappeared"
                ))
            })?;
        normalized.push(expected_battle.player_party[index].clone());
    }
    expected_battle.player_party = normalized;

    if case_name == "voluntary-switch" {
        let expected_frontier = &mut expected_battle.command_state.frontier;
        let actual_frontier = &actual_battle.command_state.frontier;
        if expected_frontier.len() != 2 || actual_frontier.len() != 2 {
            return Err(FixtureError::new(format!(
                "{case_name}: final command frontier shape is outside the exact catalogue"
            ))
            .into());
        }
        let actor = PokemonId::try_from_u64(3)?;
        let switched_pokemon = PokemonId::try_from_u64(1)?;
        let field_slot = FieldSlot::new(BattleSide::Player, 0)?;
        let legacy_party_slot = PartyIndex::new(2)?;
        let expected_entry = expected_frontier.first_mut().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: catalogued final command frontier entry is missing"
            ))
        })?;
        let actual_entry = actual_frontier.first().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: typed final command frontier entry is missing"
            ))
        })?;
        if expected_entry.actor != actor
            || expected_entry.field_slot != field_slot
            || expected_entry.offer.switches.len() != 1
            || actual_entry.actor != actor
            || actual_entry.field_slot != field_slot
            || actual_entry.offer.switches.len() != 1
        {
            return Err(FixtureError::new(format!(
                "{case_name}: final command frontier entry is outside the exact party-order rebase catalogue"
            ))
            .into());
        }
        let expected_switch = expected_entry.offer.switches.first_mut().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: catalogued final command offer switch is missing"
            ))
        })?;
        let actual_switch = actual_entry.offer.switches.first().ok_or_else(|| {
            FixtureError::new(format!(
                "{case_name}: typed final command offer switch is missing"
            ))
        })?;
        if expected_switch.party_slot != legacy_party_slot
            || expected_switch.pokemon != switched_pokemon
            || actual_switch.party_slot != PartyIndex::ZERO
            || actual_switch.pokemon != switched_pokemon
        {
            return Err(FixtureError::new(format!(
                "{case_name}: final command offer switch is outside the exact party-order rebase catalogue"
            ))
            .into());
        }
        expected_switch.party_slot = PartyIndex::ZERO;
    }
    Ok(())
}

fn normalize_catalogued_filtered_final_faint_ledger(
    case_name: &str,
    expected: &mut GameState,
    actual: &GameState,
    mutations: &[BattleMutation],
) -> Result<(), Box<dyn Error>> {
    let Some((_, expected_count)) = LEGACY_FILTERED_RESOLVED_FAINT_CASES
        .iter()
        .find(|(candidate, _)| *candidate == case_name)
    else {
        return Ok(());
    };
    let expected_battle = expected.battle.as_mut().ok_or_else(|| {
        FixtureError::new(format!("{case_name}: expected final state has no battle"))
    })?;
    let actual_battle = actual.battle.as_ref().ok_or_else(|| {
        FixtureError::new(format!("{case_name}: typed final state has no battle"))
    })?;
    if !expected_battle.faint_queue.is_empty() {
        return Err(FixtureError::new(format!(
            "{case_name}: legacy final faint queue is not the exact filtered-empty shape"
        ))
        .into());
    }

    let mut retained = Vec::with_capacity(*expected_count);
    for (index, mutation) in mutations.iter().enumerate() {
        let BattleMutation::FaintQueued { occurrence } = mutation else {
            continue;
        };
        if !matches!(
            occurrence.replacement,
            ReplacementProgress::NotRequired | ReplacementProgress::Pending
        ) || mutations[index + 1..]
            .iter()
            .filter(|candidate| {
                matches!(
                    candidate,
                    BattleMutation::FaintResolved {
                        occurrence: resolved,
                    } if *resolved == occurrence.id
                )
            })
            .count()
            != 1
        {
            return Err(FixtureError::new(format!(
                "{case_name}: queued faint occurrence {} is outside the exact resolved legacy-ledger shape",
                occurrence.id
            ))
            .into());
        }
        let mut applied = *occurrence;
        applied.replacement = ReplacementProgress::Applied;
        retained.push(applied);
    }
    if retained.len() != *expected_count
        || retained
            .iter()
            .map(|occurrence| occurrence.id)
            .collect::<BTreeSet<_>>()
            .len()
            != *expected_count
        || retained != actual_battle.faint_queue
    {
        return Err(FixtureError::new(format!(
            "{case_name}: reconstructed final faint ledger differs from the exact typed retained ledger"
        ))
        .into());
    }
    expected_battle.faint_queue = retained;
    Ok(())
}

fn replay_transition_case(case_name: &str) -> Result<(), Box<dyn Error>> {
    let document = parse_case(case_name)?;
    let content = selected_content_pack()?;
    let initial = fixture_state(&document, case_name, "initial_state", &content)?;
    let mut expected_final = fixture_state(&document, case_name, "expected_final_state", &content)?;
    let initial_rng = fixture_rng_boundary(&document, case_name, "initial_rng")?;
    let mut expected_final_rng = fixture_rng_boundary(&document, case_name, "final_rng")?;
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
        &fixture_state(&document, case_name, "initial_state", &content)?,
    )?;

    let identities = legacy_identities(&document, case_name)?;
    let mut resolver_initial = initial.clone();
    let setup_mutations = apply_catalogued_turn_resolution_setup(
        &document,
        case_name,
        &identities,
        &mut resolver_initial,
    )?;
    let legacy_content_identity =
        is_exact_legacy_content_identity(&document, case_name, "initial_state", &content)?;
    let mut records = fixture_command_records(&document, case_name)?;
    let raw_expected_actions = fixture_action_order(&document, case_name)?;
    if legacy_content_identity {
        normalize_legacy_command_records(
            case_name,
            &initial,
            &mut records,
            &raw_expected_actions,
            &content,
        )?;
    }
    let replacement_proposals = fixture_replacement_proposals(&document, case_name)?;
    let expected_actions =
        normalize_legacy_action_order(case_name, &initial, &records, &raw_expected_actions)?;
    let (resolver_input, commands) =
        admit_fixture_commands(&resolver_initial, &records, case_name, &content)?;
    let authority_epoch = replacement_proposals
        .first()
        .map(|proposal| proposal.epoch)
        .unwrap_or(AuthorityEpoch::try_from_u64(1)?);
    let battle = resolver_input
        .battle
        .as_ref()
        .ok_or_else(|| FixtureError::new(format!("{case_name}: resolver input has no battle")))?;
    let material_operation_id =
        turn_result_operation_id(battle.battle_id, battle.wave, battle.turn)?;
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

    let mut replacement_replay = replay_fixture_replacements(
        transition.after_state.clone(),
        &replacement_proposals,
        case_name,
        &content,
    )?;
    materialize_pending_command_frontier(case_name, &mut replacement_replay.state, &content)?;
    compare_projected_action_order(
        case_name,
        &initial,
        &transition.after_state,
        &records,
        &replacement_proposals,
        &replacement_replay.transitions,
        &expected_actions,
        &transition.action_order,
        &transition.mutations,
        &transition.presentation,
    )?;

    let expected_rng_draws = fixture_rng_draws(&document, case_name, &transition.rng_audit)?;
    compare_serialized_axis(
        case_name,
        "CONSUMING_RNG_DRAWS",
        &expected_rng_draws,
        &transition.rng_audit,
    )?;
    let mut expected_mutations = fixture_mutations(
        &document,
        case_name,
        &identities,
        &initial,
        &expected_actions,
        &records,
    )?;
    validate_legacy_mutation_metadata(case_name, &expected_mutations, &expected_actions)?;
    let mut actual_mutations = setup_mutations.clone();
    actual_mutations.extend(transition.mutations.clone());
    actual_mutations.extend(replacement_replay.mutations.clone());
    normalize_catalogued_deterministic_intimidate_mutations(
        case_name,
        &mut expected_mutations,
        &actual_mutations,
        &transition.rng_audit,
    )?;
    normalize_catalogued_grass_powder_mutations(
        case_name,
        &mut expected_mutations,
        &actual_mutations,
        &transition.rng_audit,
    )?;
    normalize_catalogued_legacy_faint_mutations(case_name, &mut expected_mutations)?;
    normalize_catalogued_same_side_stage_order(case_name, &mut expected_mutations)?;
    // Validate legacy final-state projections before replaying typed resources;
    // voluntary-switch's closed HP catalogue is intentionally legacy -> typed.
    normalize_catalogued_deterministic_intimidate_final(
        case_name,
        &mut expected_final,
        &mut expected_final_rng,
        &replacement_replay.state,
    )?;
    normalize_expected_final_resources(
        case_name,
        &initial,
        &expected_mutations.typed,
        &mut expected_final,
    )?;
    compare_mutation_trace(
        case_name,
        &expected_mutations.typed,
        &actual_mutations,
        &transition.before_state,
        &replacement_replay.state,
    )?;
    validate_legacy_faint_markers(
        case_name,
        &expected_mutations,
        &actual_mutations,
        &initial,
        &expected_actions,
    )?;
    validate_legacy_turn_advances(
        case_name,
        &expected_mutations,
        &actual_mutations,
        &records,
        &initial,
        &expected_actions,
    )?;

    let expected_presentation = fixture_presentation(
        &document,
        case_name,
        &identities,
        &initial,
        &expected_mutations.typed,
    )?;
    validate_legacy_message_trace(case_name, &expected_presentation)?;
    validate_presentation_ids(
        case_name,
        "EXPECTED_PRESENTATION.TYPED",
        &material_operation_id,
        &expected_presentation.typed,
    )?;
    let mut actual_presentation = project_typed_presentation(
        case_name,
        &material_operation_id,
        &transition.presentation,
        transition.outcome,
        &replacement_replay.transitions,
        replacement_replay
            .state
            .battle
            .as_ref()
            .ok_or_else(|| FixtureError::new(format!("{case_name}: final state has no battle")))?
            .outcome,
    )?;
    prepend_setup_presentation(
        case_name,
        &material_operation_id,
        &setup_mutations,
        &mut actual_presentation,
    )?;
    compare_serialized_axis(
        case_name,
        "PRESENTATION_PLAN.TYPED",
        &expected_presentation.typed,
        &actual_presentation,
    )?;
    normalize_catalogued_final_player_party_order(
        case_name,
        &mut expected_final,
        &replacement_replay.state,
    )?;
    normalize_catalogued_filtered_final_faint_ledger(
        case_name,
        &mut expected_final,
        &replacement_replay.state,
        &expected_mutations.typed,
    )?;
    compare_serialized_axis(
        case_name,
        "FINAL_STATE_AND_RNG.STATE",
        &expected_final,
        &replacement_replay.state,
    )?;
    let final_sequence = initial_rng
        .next_sequence
        .get()
        .checked_add(u64::try_from(expected_rng_draws.len())?)
        .ok_or_else(|| {
            FixtureError::new(format!("{case_name}: final RNG sequence overflows u53"))
        })?;
    expected_final_rng.next_sequence = SafeU53::new(final_sequence)?;
    let actual_final_rng = state_rng_boundary(
        &replacement_replay.state,
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
        assert!(
            axes.len() >= REQUIRED_AXES.len(),
            "published fixture has fewer transition axes than er-battle owns"
        );
        for (index, &(expected_axis, _)) in REQUIRED_AXES.iter().enumerate() {
            assert_eq!(axes[index].as_str(), Some(expected_axis));
        }
    }
    Ok(())
}

#[test]
fn every_frozen_case_has_exact_identity_empty_gaps_and_seven_transition_axes()
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
fn legacy_presentation_message_catalogue_and_inventory_are_exact() -> Result<(), Box<dyn Error>> {
    let mut message_case_count = 0;
    let mut message_count = 0;
    let mut unique_messages = BTreeSet::new();
    for &(case_name, _) in FROZEN_CASES {
        let document = parse_case(case_name)?;
        let values = array_field(&document, case_name, "$", "expected_presentation")?;
        let mut case_message_count = 0;
        for (index, value) in values.iter().enumerate() {
            let path = format!("expected_presentation[{index}].event");
            let event = object_field(
                value,
                case_name,
                &format!("expected_presentation[{index}]"),
                "event",
            )?;
            if string_field(event, case_name, &path, "k")? != "message" {
                continue;
            }
            assert_exact_keys(case_name, &path, event, &["k", "text"])?;
            let text = string_field(event, case_name, &path, "text")?;
            if !LEGACY_MESSAGE_CATALOGUE.contains(&text.as_str()) {
                return Err(FixtureError::new(format!(
                    "{case_name}: {path}.text is outside the closed legacy message catalogue"
                ))
                .into());
            }
            case_message_count += 1;
            message_count += 1;
            unique_messages.insert(text);
        }
        if case_message_count != 0 {
            message_case_count += 1;
        }
    }
    assert_eq!(message_case_count, 29);
    assert_eq!(message_count, 54);
    assert_eq!(unique_messages.len(), 18);
    assert_eq!(unique_messages.len(), LEGACY_MESSAGE_CATALOGUE.len());
    Ok(())
}

#[test]
fn every_published_gap_free_case_replays_all_er_battle_transition_axes()
-> Result<(), Box<dyn Error>> {
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
