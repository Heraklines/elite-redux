//! M6D system proof: complete field/status/tag parity over the frozen M6
//! catalogs.
//!
//! Exercises every frozen `WEATHER_BEHAVIOR`, `TERRAIN_BEHAVIOR`,
//! `STATUS_BEHAVIOR`, `BATTLER_TAG_BEHAVIOR`, `ARENA_TAG_BEHAVIOR` and
//! `POSITIONAL_TAG_BEHAVIOR` behavior unit through the production parity
//! adapter (`er_battle::m6::system::field_parity`): admission, stacking,
//! refresh, lapse, expiry, ordering, cleanup and audited RNG, evaluated
//! against each unit's frozen witness assertions with deterministic lifecycle
//! ordering and exact first-divergence localization, including false
//! conditions that must not mutate state.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;

use er_battle::m6::system::field_parity::{
    evaluate_witness, field_inventory, first_divergence, probe_unsupported_identity,
    resolve_field_subject, run_arena_condition_lifecycle, run_cycle_lifecycle,
    run_major_status_lifecycle, run_tag_lifecycle, ArenaConditionScenario, CycleScenario,
    FieldCoverage, FieldDomain, FieldLifecycleReport, FieldLifecycleStep,
    FieldSubject, MajorStatusScenario, TagScenario, WitnessAssertion,
    FIELD_PARITY_SCHEMA_VERSION,
};
use er_content::m6_catalog::SemanticCatalogV1;
use er_rng::audit::RngCallsiteId;
use er_rng::battle::RngRuntime;
use er_state::battle_v2::{
    BattleParticipationState, BattleSettlementState, BattleStateV2, BATTLE_STATE_SCHEMA_VERSION_V2,
};
use er_state::bespoke_v2::suppression_immunity::{
    SuppressionImmunityStateV2, VolatileTagSubject,
};
use er_state::field::FieldState;
use er_types::battle_command::CommandCollectionState;
use er_types::battle_ids::{
    BattleFormat, BattleId, BattleSide, FaintOccurrenceId, PokemonId, TurnIndex, WaveIndex,
};
use er_types::SeatId;
use er_types::battle_model::{
    BattleOutcome, GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind,
    WeatherState,
};
use er_types::m6::{BehaviorUnitId, BehaviorUnitKind};
use er_types::run_ids::Money;
use er_types::SafeU53;
use serde::Deserialize;

const OWNER: u64 = 501;

// ---------------------------------------------------------------------------
// Frozen fixtures
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct WitnessPlan {
    witnesses: Vec<Witness>,
}

#[derive(Deserialize)]
struct Witness {
    behavior_unit: BehaviorUnitId,
    positive_assertions: Vec<Assertion>,
    negative_assertions: Vec<Assertion>,
    rng_contract: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct Assertion {
    kind: String,
}

/// The raw behavior-unit manifest cross-checks the semantic catalog's field
/// inventory; only the closed kind vocabulary is needed here.
#[derive(Deserialize)]
struct UnitManifest {
    behavior_units: Vec<ManifestUnit>,
}

#[derive(Deserialize)]
struct ManifestUnit {
    unit_kind: BehaviorUnitKind,
}

fn catalog() -> Result<SemanticCatalogV1, Box<dyn Error>> {
    let catalog = SemanticCatalogV1::from_bytes(include_bytes!(
        "../../../fixtures/m6/semantic-catalog-v1.json"
    ))?;
    Ok(catalog)
}

fn manifest() -> Result<UnitManifest, Box<dyn Error>> {
    let manifest: UnitManifest = serde_json::from_slice(include_bytes!(
        "../../../fixtures/m6/behavior-unit-manifest-v1.json"
    ))?;
    Ok(manifest)
}

fn witness_plan() -> Result<BTreeMap<BehaviorUnitId, Witness>, Box<dyn Error>> {
    let plan: WitnessPlan = serde_json::from_slice(include_bytes!(
        "../../../fixtures/m6/oracle-witness-plan-v1.json"
    ))?;
    Ok(plan
        .witnesses
        .into_iter()
        .map(|witness| (witness.behavior_unit.clone(), witness))
        .collect())
}

// ---------------------------------------------------------------------------
// Deterministic fixtures for lifecycle scenarios
// ---------------------------------------------------------------------------

const FIELD_DOMAINS: [(BehaviorUnitKind, FieldDomain, usize); 6] = [
    (BehaviorUnitKind::StatusBehavior, FieldDomain::MajorStatus, 8),
    (BehaviorUnitKind::BattlerTagBehavior, FieldDomain::VolatileTag, 123),
    (BehaviorUnitKind::WeatherBehavior, FieldDomain::Weather, 13),
    (BehaviorUnitKind::TerrainBehavior, FieldDomain::Terrain, 6),
    (BehaviorUnitKind::ArenaTagBehavior, FieldDomain::ArenaCondition, 42),
    (
        BehaviorUnitKind::PositionalTagBehavior,
        FieldDomain::PositionalTag,
        3,
    ),
];

const FAIL_CLOSED_SUBJECT_KEYS: [&str; 5] = [
    "MAJOR_STATUS:NONE",
    "MAJOR_STATUS:TOXIC",
    "MAJOR_STATUS:SLEEP",
    "MAJOR_STATUS:ORACLE_CODE_5",
    "MAJOR_STATUS:ORACLE_CODE_7",
];

fn owner() -> Result<PokemonId, Box<dyn Error>> {
    Ok(PokemonId::new(SafeU53::new(OWNER)?))
}

fn fresh_suppression() -> SuppressionImmunityStateV2 {
    SuppressionImmunityStateV2::new()
}

/// Minimal valid battle scaffold for staged field transitions; enemy party,
/// participation and settlement stay empty because field staging never
/// touches them.
fn fresh_battle() -> Result<BattleStateV2, Box<dyn Error>> {
    let format = BattleFormat::single();
    let battle_id = BattleId::new(SafeU53::new(1)?);
    let turn = TurnIndex::new(SafeU53::new(1)?)?;
    Ok(BattleStateV2 {
        schema_version: BATTLE_STATE_SCHEMA_VERSION_V2,
        battle_id,
        wave: WaveIndex::new(SafeU53::new(1)?)?,
        wave_seed: "m6d-field-parity".to_owned(),
        turn,
        format,
        authority_seat: SeatId::new(SafeU53::new(1)?),
        enemy_party: Vec::new(),
        field: FieldState::empty_for_format(&BattleFormat::single())?,
        weather: WeatherState {
            kind: WeatherKind::None,
            remaining_turns: 0,
        },
        terrain: TerrainState {
            kind: TerrainKind::None,
            remaining_turns: 0,
        },
        arena_conditions: Vec::new(),
        global_ability_suppression: GlobalAbilitySuppressionState {
            ignore_abilities: false,
            source: None,
        },
        battle_rng: er_state::battle_v2::BattleRngState::new("m6d-field-parity", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        participation: BattleParticipationState {
            player_participants: Vec::new(),
            defeated_enemies: Vec::new(),
        },
        settlement: BattleSettlementState {
            source_battle_id: battle_id,
            settled: false,
            scattered_money: Money::new(SafeU53::new(0)?),
            wave_reward_evidence: Vec::new(),
        },
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::new(SafeU53::new(1)?),
        outcome: BattleOutcome::Ongoing,
    })
}

/// Deterministic per-unit tag scenario parameters derived from the frozen
/// catalog position; identical inputs always reproduce identical transcripts.
fn tag_scenario(index: usize) -> Result<TagScenario, Box<dyn Error>> {
    Ok(TagScenario {
        owner: owner()?,
        layers_initial: 1 + (index % 3) as u8,
        layers_stack: 1 + ((index / 3) % 2) as u8,
        window_turns: 2 + (index % 4) as u16,
    })
}

fn cycle_scenario(index: usize, oracle_code: u16) -> CycleScenario {
    CycleScenario {
        oracle_code,
        turns: 3 + (index % 3) as u16,
    }
}

fn arena_scenario(index: usize, condition_id: String) -> Result<ArenaConditionScenario, Box<dyn Error>> {
    let scope = match index % 3 {
        0 => er_types::battle_model::ArenaConditionScope::Both,
        1 => er_types::battle_model::ArenaConditionScope::Side(BattleSide::Player),
        _ => er_types::battle_model::ArenaConditionScope::Side(BattleSide::Enemy),
    };
    Ok(ArenaConditionScenario {
        condition_id,
        scope,
        layers_initial: 1 + (index % 2) as u8,
        layers_stack: 2,
        turns: 3 + (index % 3) as u16,
    })
}

fn seeded_runtime(seed: &str) -> Result<RngRuntime, Box<dyn Error>> {
    let mut runtime = RngRuntime::from_run_seed(seed);
    runtime.initialize_battle(
        "m6d-field-parity-wave",
        WaveIndex::new(SafeU53::new(7)?)?,
    )?;
    Ok(runtime)
}

fn major_status_scenario() -> Result<MajorStatusScenario, Box<dyn Error>> {
    use er_types::battle_model::PokemonTyping;
    Ok(MajorStatusScenario {
        target: owner()?,
        typing: PokemonTyping {
            primary: er_types::battle_model::PokemonType::Normal,
            secondary: None,
        },
        chance: None,
        exercise_rng_gate: false,
        max_hp: 100,
        hp: 80,
    })
}

/// Runs the full lifecycle campaign for one proven inventory entry through
/// its domain's production driver.
fn run_campaign(index: usize, subject: &FieldSubject) -> Result<FieldLifecycleReport, Box<dyn Error>> {
    let report = match subject {
        FieldSubject::MajorStatus(inner) => {
            let kind = inner.kernel_status().ok_or("unsupported status reached driver")?;
            let mut runtime =
                seeded_runtime(&format!("m6d-field-status-{index}"))?;
            run_major_status_lifecycle(
                &mut runtime,
                &fresh_suppression(),
                kind,
                &major_status_scenario()?,
            )?
        }
        FieldSubject::VolatileTag { registry_key } => run_tag_lifecycle(
            &fresh_suppression(),
            VolatileTagSubject::BattlerTag {
                registry_key: registry_key.clone(),
            },
            &tag_scenario(index)?,
        )?,
        FieldSubject::PositionalTag { registry_key } => run_tag_lifecycle(
            &fresh_suppression(),
            VolatileTagSubject::PositionalTag {
                side: if index % 2 == 0 {
                    BattleSide::Player
                } else {
                    BattleSide::Enemy
                },
                registry_key: registry_key.clone(),
            },
            &tag_scenario(index)?,
        )?,
        FieldSubject::Weather { oracle_code } => run_cycle_lifecycle(
            FieldDomain::Weather,
            &fresh_battle()?,
            &cycle_scenario(index, *oracle_code),
        )?,
        FieldSubject::Terrain { oracle_code } => run_cycle_lifecycle(
            FieldDomain::Terrain,
            &fresh_battle()?,
            &cycle_scenario(index, *oracle_code),
        )?,
        FieldSubject::ArenaCondition { registry_key } => run_arena_condition_lifecycle(
            &fresh_battle()?,
            &arena_scenario(index, registry_key.clone())?,
        )?,
    };
    assert_eq!(
        report.schema_version, FIELD_PARITY_SCHEMA_VERSION,
        "report schema version drift"
    );
    Ok(report)
}

// ---------------------------------------------------------------------------
// Acceptance: exactly-once inventory, zero residual
// ---------------------------------------------------------------------------

#[test]
fn field_inventory_is_exactly_once_with_zero_residual() -> Result<(), Box<dyn Error>> {
    let catalog = catalog()?;
    let raw_manifest = manifest()?;
    let plan = witness_plan()?;

    // Cross-check the frozen manifest against the semantic catalog per kind.
    for (kind, _, expected) in FIELD_DOMAINS {
        let manifest_count = raw_manifest
            .behavior_units
            .iter()
            .filter(|unit| std::mem::discriminant(&unit.unit_kind) == std::mem::discriminant(&kind))
            .count();
        let catalog_count = catalog
            .behavior_units
            .iter()
            .filter(|unit| {
                std::mem::discriminant(&unit.id.unit_kind) == std::mem::discriminant(&kind)
            })
            .count();
        assert_eq!(manifest_count, expected, "manifest count drift for {kind:?}");
        assert_eq!(catalog_count, expected, "catalog count drift for {kind:?}");
    }

    let inventory = field_inventory(&catalog.behavior_units)?;
    let total: usize = FIELD_DOMAINS.iter().map(|(_, _, count)| *count).sum();
    assert_eq!(inventory.len(), total, "inventory size drifted");

    // Exactly-once identity coverage.
    let mut seen = BTreeSet::new();
    for entry in &inventory {
        assert!(seen.insert(entry.unit.clone()), "duplicate inventory unit");
        let witness = plan.get(&entry.unit).ok_or("field unit without witness")?;
        assert_eq!(
            witness.behavior_unit, entry.unit,
            "witness identity mismatch"
        );
        assert_eq!(witness.rng_contract.len(), 0, "unexpected field RNG contract");
    }
    assert_eq!(seen.len(), total);

    // Per-domain counts match the frozen closure exactly.
    for (_, domain, expected) in FIELD_DOMAINS {
        let count = inventory
            .iter()
            .filter(|entry| entry.domain == domain)
            .count();
        assert_eq!(count, expected, "domain count drift for {domain:?}");
    }

    // Zero residual: every unit carries either a proven or an explicit
    // fail-closed verdict; fail-closed identities are exactly the known
    // unsupported major-status slice.
    let fail_closed: Vec<&str> = inventory
        .iter()
        .filter_map(|entry| match &entry.coverage {
            FieldCoverage::Proven => None,
            FieldCoverage::FailClosed { .. } => Some(entry.subject_key.as_str()),
        })
        .collect();
    let mut fail_closed_sorted = fail_closed.clone();
    fail_closed_sorted.sort_unstable();
    let mut expected_fail_closed = FAIL_CLOSED_SUBJECT_KEYS.to_vec();
    expected_fail_closed.sort_unstable();
    assert_eq!(fail_closed_sorted, expected_fail_closed);
    let proven = inventory
        .iter()
        .filter(|entry| matches!(entry.coverage, FieldCoverage::Proven))
        .count();
    assert_eq!(
        proven + fail_closed.len(),
        total,
        "residual units outside both verdicts"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Acceptance: full lifecycle parity against frozen witnesses
// ---------------------------------------------------------------------------

#[test]
fn field_lifecycles_satisfy_every_frozen_witness() -> Result<(), Box<dyn Error>> {
    let catalog = catalog()?;
    let plan = witness_plan()?;
    let inventory = field_inventory(&catalog.behavior_units)?;

    let mut reports = BTreeMap::new();
    for (index, entry) in inventory.iter().enumerate() {
        let resolved = resolve_field_subject(&entry.unit.source)?;
        let report = match &entry.coverage {
            FieldCoverage::Proven => run_campaign(index, &resolved)?,
            FieldCoverage::FailClosed { reason } => {
                probe_unsupported_identity(&resolved, reason.clone())
            }
        };

        let witness = plan.get(&entry.unit).ok_or("unit without witness")?;
        let positive = witness
            .positive_assertions
            .iter()
            .map(|assertion| WitnessAssertion::parse(&assertion.kind))
            .collect::<Result<Vec<_>, _>>()?;
        let negative = witness
            .negative_assertions
            .iter()
            .map(|assertion| WitnessAssertion::parse(&assertion.kind))
            .collect::<Result<Vec<_>, _>>()?;

        match &entry.coverage {
            FieldCoverage::Proven => {
                assert!(
                    !report.steps.is_empty(),
                    "empty transcript for {}",
                    entry.subject_key
                );
                evaluate_witness(&report, &positive, &negative)?;
                // Empty frozen RNG contracts require zero audited draws.
                assert_eq!(
                    report.audited_draws, 0,
                    "unit {} drew RNG despite an empty contract",
                    entry.subject_key
                );
            }
            FieldCoverage::FailClosed { reason } => {
                assert_eq!(report.steps.len(), 1, "fail-closed probe grew steps");
                match &report.steps[0] {
                    FieldLifecycleStep::UnsupportedIdentityRejected { reason: recorded, .. } => {
                        assert_eq!(recorded.as_str(), reason.as_str(), "fail-closed reason drift");
                    }
                    other => panic!("expected fail-closed rejection, got {other:?}"),
                }
            }
        }
        reports.insert(entry.unit.clone(), report);
    }

    // Exactly-once transcript coverage: one report per inventory unit.
    assert_eq!(reports.len(), inventory.len());
    Ok(())
}

// ---------------------------------------------------------------------------
// Acceptance: deterministic ordering and audited RNG
// ---------------------------------------------------------------------------

#[test]
fn field_campaigns_are_deterministic_and_rng_is_audited() -> Result<(), Box<dyn Error>> {
    let catalog = catalog()?;
    let inventory = field_inventory(&catalog.behavior_units)?;

    // First pass: full replay of every proven campaign.
    let mut first_pass = Vec::new();
    for (index, entry) in inventory.iter().enumerate() {
        if matches!(entry.coverage, FieldCoverage::Proven) {
            let resolved = resolve_field_subject(&entry.unit.source)?;
            first_pass.push(run_campaign(index, &resolved)?);
        }
    }

    // Second pass over identical inputs must reproduce identical ordered
    // transcripts byte-for-byte.
    let mut second_pass = Vec::new();
    for (index, entry) in inventory.iter().enumerate() {
        if matches!(entry.coverage, FieldCoverage::Proven) {
            let resolved = resolve_field_subject(&entry.unit.source)?;
            second_pass.push(run_campaign(index, &resolved)?);
        }
    }
    assert_eq!(first_pass, second_pass, "lifecycle ordering diverged on replay");
    assert!(!first_pass.is_empty());

    // Audited RNG: chance-gated and paralysis-gated campaigns produce
    // strictly increasing audited draws with the frozen callsite identities,
    // and identical seeds reproduce identical fingerprints.
    use er_battle::status::{apply_status_with_chance, StatusApplicationInput, StatusBypass};
    use er_types::battle_model::{PokemonType, PokemonTyping, StatusKind, StatusState};

    let typing = PokemonTyping {
        primary: PokemonType::Normal,
        secondary: None,
    };
    let clean = || StatusState {
        kind: StatusKind::None,
        toxic_turn_count: 0,
        sleep_turns_remaining: None,
    };
    let input = || StatusApplicationInput {
        requested: StatusKind::Poison,
        current: clean(),
        target_types: typing,
        powder: false,
        bypass: StatusBypass::None,
    };

    let mut rng_first = seeded_runtime("m6d-field-rng-order")?;
    let outcome_first = apply_status_with_chance(&mut rng_first, input(), Some(50))?;
    let paralysis_report = {
        let mut scenario = major_status_scenario()?;
        scenario.exercise_rng_gate = true;
        run_major_status_lifecycle(
            &mut rng_first,
            &fresh_suppression(),
            StatusKind::Paralysis,
            &scenario,
        )?
    };
    match outcome_first {
        er_battle::status::StatusApplicationOutcome::Applied { .. } => {}
        er_battle::status::StatusApplicationOutcome::ChanceFailed { draw } => {
            assert!(draw.get() >= 50, "gate draw {draw} below the 50% threshold");
        }
        other => panic!("chance campaign produced {other:?}"),
    }
    assert!(paralysis_report
        .steps
        .iter()
        .any(|step| matches!(step, FieldLifecycleStep::ParalysisActivationGate { .. })));

    let audit_first: Vec<_> = rng_first
        .audit_entries()
        .iter()
        .map(|draw| {
            (
                draw.sequence.get(),
                draw.callsite_id.as_str().to_owned(),
                draw.before_fingerprint.clone(),
                draw.after_fingerprint.clone(),
                draw.result.get(),
            )
        })
        .collect();
    assert!(audit_first.len() >= 2, "audited draws missing");
    // Battle construction seeds audited battle-seed-character draws first;
    // the campaign itself contributes exactly the final two draws.
    let campaign_draws = &audit_first[audit_first.len() - 2..];
    assert_eq!(
        campaign_draws[0].1,
        RngCallsiteId::secondary_status().as_str(),
        "callsite drift"
    );
    assert_eq!(
        campaign_draws[1].1,
        RngCallsiteId::paralysis_activation().as_str(),
        "callsite drift"
    );
    for window in audit_first.windows(2) {
        assert!(window[0].0 < window[1].0, "audit sequence not increasing");
    }

    let mut rng_second = seeded_runtime("m6d-field-rng-order")?;
    let _ = apply_status_with_chance(&mut rng_second, input(), Some(50))?;
    let scenario_again = {
        let mut scenario = major_status_scenario()?;
        scenario.exercise_rng_gate = true;
        scenario
    };
    let _ = run_major_status_lifecycle(
        &mut rng_second,
        &fresh_suppression(),
        StatusKind::Paralysis,
        &scenario_again,
    )?;
    let audit_second: Vec<_> = rng_second
        .audit_entries()
        .iter()
        .map(|draw| {
            (
                draw.sequence.get(),
                draw.callsite_id.as_str().to_owned(),
                draw.before_fingerprint.clone(),
                draw.after_fingerprint.clone(),
                draw.result.get(),
            )
        })
        .collect();
    assert_eq!(audit_first, audit_second, "RNG audit trail diverged on replay");

    // A zero chance always fails the strict gate, commits the consumed draw,
    // and leaves the target clean.
    let mut rng_zero = seeded_runtime("m6d-field-rng-zero")?;
    let before_zero = rng_zero.audit_entries().len();
    let failed = apply_status_with_chance(
        &mut rng_zero,
        StatusApplicationInput {
            requested: StatusKind::Burn,
            current: clean(),
            target_types: typing,
            powder: false,
            bypass: StatusBypass::None,
        },
        Some(0),
    )?;
    match failed {
        er_battle::status::StatusApplicationOutcome::ChanceFailed { .. } => {}
        other => panic!("zero chance produced {other:?}"),
    }
    assert_eq!(
        rng_zero.audit_entries().len(),
        before_zero + 1,
        "failed chance draw not committed"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Acceptance: exact first-divergence localization including false conditions
// ---------------------------------------------------------------------------

#[test]
fn first_divergence_localizes_exact_step_including_false_conditions() -> Result<(), Box<dyn Error>>
{
    let baseline_subject = VolatileTagSubject::BattlerTag {
        registry_key: "M6D_FIELD_PROBE".to_owned(),
    };
    let baseline = run_tag_lifecycle(
        &fresh_suppression(),
        baseline_subject.clone(),
        &tag_scenario(1)?,
    )?;

    // Identical inputs: no divergence anywhere.
    let replay = run_tag_lifecycle(&fresh_suppression(), baseline_subject.clone(), &tag_scenario(1)?)?;
    assert_eq!(first_divergence(&baseline.steps, &replay.steps), None);

    // A different initial layer count first shows up in the fresh-admission
    // step (index 1, right after the immunity-denial false condition).
    let thicker = TagScenario {
        layers_initial: tag_scenario(1)?.layers_initial + 1,
        ..tag_scenario(1)?
    };
    let thicker_report = run_tag_lifecycle(&fresh_suppression(), baseline_subject.clone(), &thicker)?;
    let divergence = first_divergence(&baseline.steps, &thicker_report.steps)
        .ok_or("layer divergence not detected")?;
    assert_eq!(divergence.index, 1);

    // A different window shifts only the lapse/expiry tail.
    let longer = TagScenario {
        window_turns: tag_scenario(1)?.window_turns + 1,
        ..tag_scenario(1)?
    };
    let longer_report = run_tag_lifecycle(&fresh_suppression(), baseline_subject.clone(), &longer)?;
    let tail_divergence = first_divergence(&baseline.steps, &longer_report.steps)
        .ok_or("window divergence not detected")?;
    assert!(tail_divergence.index > divergence.index);

    // Truncating the transcript localizes the missing step exactly.
    let truncated = &baseline.steps[..baseline.steps.len() - 1];
    assert_eq!(
        first_divergence(truncated, &baseline.steps),
        Some(er_battle::m6::system::field_parity::FieldDivergence {
            index: truncated.len()
        })
    );

    // False-condition flips are localized: replacing a verified no-mutation
    // rejection with a different false-condition outcome diverges exactly
    // there.
    let mut flipped_false_condition = baseline.steps.clone();
    flipped_false_condition[0] = FieldLifecycleStep::UnsupportedIdentityRejected {
        subject: baseline.subject_key.clone(),
        reason: "probe".to_owned(),
    };
    assert_eq!(
        first_divergence(&baseline.steps, &flipped_false_condition),
        Some(er_battle::m6::system::field_parity::FieldDivergence { index: 0 })
    );

    // Weather versus terrain transcripts of identical shape diverge at their
    // very first step (the domain name inside the shared zero-turn false
    // condition).
    let weather = run_cycle_lifecycle(
        FieldDomain::Weather,
        &fresh_battle()?,
        &CycleScenario {
            oracle_code: 1,
            turns: 3,
        },
    )?;
    let terrain = run_cycle_lifecycle(
        FieldDomain::Terrain,
        &fresh_battle()?,
        &CycleScenario {
            oracle_code: 1,
            turns: 3,
        },
    )?;
    assert_eq!(
        first_divergence(&weather.steps, &terrain.steps),
        Some(er_battle::m6::system::field_parity::FieldDivergence { index: 0 })
    );
    Ok(())
}
