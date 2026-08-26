//! M6D acceptance proof: complete active/passive ability parity.
//!
//! Drives the [`er_battle::m6::system::ability_parity`] adapters over the
//! frozen M6 fixtures: exact catalog identity closure with zero residual,
//! active-before-passive slot ordering across all four runtime slots,
//! overlapping suppression/unsuppressible semantics, false-condition
//! exclusion without mutation, immunity/bypass precedence, zero RNG admission
//! with fail-closed chance conditions, prepared-vs-direct query/trigger
//! dispatch parity over full ordered evidence, and oracle-witness agreement
//! with exact first-divergence reporting.

use std::error::Error;

use er_battle::m6::ability_executor::AbilityOwnerState;
use er_battle::m6::bespoke::suppression_immunity::{
    AbilityBypassInput, AbilitySuppressibility, DispatchContext, DispatchGate, DispatchUnitInput,
    ImmunityAllowReason, ImmunityClaim, ImmunityDecision, ImmunitySubject, SlotSuppressionRequest,
    SuppressionCleanupEvent, apply_slot_suppression, clear_suppressions, route_ability_dispatch,
};
use er_battle::m6::routine_executor::MechanicsContextV2;
use er_battle::m6::system::ability_parity::{
    AbilityClosureEvidence, AbilityExecutionLane, AbilityParityError, BespokeClusterInput,
    OracleWitnessInput, OverlapSuppressionOutcome, SlotExecutionStep, WitnessDivergence,
    ability_polarity, false_condition_exclusion_evidence, first_witness_divergence,
    immunity_bypass_matrix, overlap_suppression_evidence, prepared_dispatch_parity,
    resolve_ability_closure, rng_admission_evidence, slot_order_evidence,
    suppression_gate_evidence,
};
use er_content::m6_catalog::SemanticCatalogV1;
use er_content::pack::m6_pack::{
    BattleContentPackV3, BehaviorClassificationEntryV2, BehaviorClassificationManifestV2,
    BespokeManifestV2, FieldContentV1,
};
use er_content::pack::m6_prepared::{PreparedBattleContentV3, prepare_content};
use er_content_compiler::m6::{
    SemanticCatalogInput, ValidatedSemanticCatalog, map_routine_catalog,
};
use er_mechanics::condition_v2::{ConditionNodeId, ConditionNodeV2};
use er_mechanics::program_v2::MechanicsProgramV2;
use er_mechanics::v2::MechanicHookV2;
use er_state::bespoke_v2::suppression_immunity::{
    AbilitySlot, SuppressionImmunityStateV2, SuppressionOrigin,
};
use er_types::battle_ids::{AbilityId, MoveId, PokemonId};
use er_types::battle_model::StatusKind;
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    AbilitySourceKindV1, BattleContentPackHashV3, BehaviorClassificationKindV2, BehaviorSourceId,
    BehaviorUnitId, BehaviorUnitKind, BehaviorUnitOrdinal, BespokeMechanicId, CatalogHash,
    M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION, OracleSha, ProvenanceHash, SafeU53,
};
use serde::Deserialize;

/// Frozen provenance of a `CUSTOM_DISPATCH` `ImmunityGate`-lane unit in the
/// pinned semantic catalog (`BlockOneHitKOAbAttr`, active slot).
const IMMUNITY_GATE_HASH: &str = "8cc546d6fc0a778c7c9c868629bc99da5702d697d934cfc7fc7bada9cdd53db9";
/// Frozen provenance of a `PowerQuery`-lane unit used as a negative control.
const POWER_QUERY_HASH: &str = "56a22dc113e3c68b8cbed651256c161dc73639ffda7e262d4acd396edf2758c5";

#[derive(Deserialize)]
struct WitnessPlan {
    witnesses: Vec<AbilityWitness>,
}

#[derive(Deserialize)]
struct AbilityWitness {
    behavior_unit: BehaviorUnitId,
    expected_hook: String,
    expected_source: BehaviorSourceId,
    positive_assertions: Vec<WitnessAssertion>,
    negative_assertions: Vec<WitnessAssertion>,
}

#[derive(Deserialize)]
struct WitnessAssertion {
    kind: String,
}

#[derive(Deserialize)]
struct ClusterManifest {
    clusters: Vec<ClusterEntry>,
}

#[derive(Deserialize)]
struct ClusterEntry {
    cluster: BespokeMechanicId,
    behavior_units: Vec<BehaviorUnitId>,
}

fn s53(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("in-range numeric id")
}

fn validated_catalog() -> Result<ValidatedSemanticCatalog, Box<dyn Error>> {
    let catalog = SemanticCatalogV1::from_bytes(include_bytes!(
        "../../../fixtures/m6/semantic-catalog-v1.json"
    ))?;
    let raw_hash = CatalogHash::parse(catalog.raw_catalog_hash.clone())?;
    Ok(ValidatedSemanticCatalog::new(SemanticCatalogInput::new(
        catalog, raw_hash,
    ))?)
}

fn witness_plan() -> Result<WitnessPlan, Box<dyn Error>> {
    Ok(serde_json::from_slice(include_bytes!(
        "../../../fixtures/m6/oracle-witness-plan-v1.json"
    ))?)
}

fn cluster_manifest() -> Result<ClusterManifest, Box<dyn Error>> {
    Ok(serde_json::from_slice(include_bytes!(
        "../../../fixtures/m6/bespoke-clusters-v1.json"
    ))?)
}

fn cluster_inputs(manifest: &ClusterManifest) -> Vec<BespokeClusterInput<'_>> {
    manifest
        .clusters
        .iter()
        .map(|entry| BespokeClusterInput {
            mechanic: entry.cluster,
            behavior_units: &entry.behavior_units,
        })
        .collect()
}

/// Builds the ten mapped ability routine programs (five mirrored pairs) with
/// sequential program ids `1..=10`, plus the prepared content pack that indexes
/// exactly those programs.
fn build_programs_and_content() -> Result<
    (
        ValidatedSemanticCatalog,
        ClusterManifest,
        Vec<MechanicsProgramV2>,
        PreparedBattleContentV3,
    ),
    Box<dyn Error>,
> {
    let catalog = validated_catalog()?;
    let mapped = map_routine_catalog(catalog.behavior_units())?;
    let mut pack_programs: Vec<Option<MechanicsProgramV2>> = vec![None];
    let mut direct = Vec::new();
    let mut classifications = Vec::new();
    let mut next_id = 1u64;
    for spec in mapped.mapped {
        if ability_polarity(&spec.behavior_unit.source).is_none() {
            continue;
        }
        let id = MechanicsProgramId::try_from_u64(next_id)?;
        next_id += 1;
        classifications.push(BehaviorClassificationEntryV2 {
            behavior_unit: spec.behavior_unit.clone(),
            kind: BehaviorClassificationKindV2::Compiled,
            programs: vec![id],
            bespoke: None,
            unsupported_reason: None,
        });
        let program = spec.build(id)?;
        pack_programs.push(Some(program.clone()));
        direct.push(program);
    }
    assert_eq!(direct.len(), 10, "mirrored ability routine programs");

    let mut pack = BattleContentPackV3 {
        schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: OracleSha::parse(catalog.oracle_sha().to_owned())?,
        raw_catalog_hash: CatalogHash::parse(catalog.raw_catalog_hash().to_owned())?,
        semantic_catalog_hash: catalog.semantic_catalog_hash().clone(),
        content_hash: BattleContentPackHashV3::parse(format!(
            "{}{}",
            BattleContentPackHashV3::PREFIX,
            "0".repeat(64)
        ))?,
        species: Vec::new(),
        forms: Vec::new(),
        moves: Vec::new(),
        abilities: Vec::new(),
        held_items: Vec::new(),
        field_content: FieldContentV1::default(),
        programs: pack_programs,
        classifications: BehaviorClassificationManifestV2(classifications),
        bespoke: BespokeManifestV2::default(),
        rng_sites: Vec::new(),
        type_chart: er_content::pack::selected_type_chart(),
    };
    pack.content_hash = pack.compute_content_hash()?;
    Ok((catalog, cluster_manifest()?, direct, prepare_content(pack)?))
}

fn closure(
    catalog: &ValidatedSemanticCatalog,
    programs: &[MechanicsProgramV2],
    manifest: &ClusterManifest,
) -> Result<AbilityClosureEvidence, AbilityParityError> {
    let clusters = cluster_inputs(manifest);
    resolve_ability_closure(catalog.behavior_units(), programs, &clusters)
}

fn owner(
    source: BehaviorSourceId,
    slot: AbilitySourceKindV1,
    side_rank: u8,
    field_position: u8,
    suppressed: bool,
) -> AbilityOwnerState {
    AbilityOwnerState {
        source,
        slot,
        suppressed,
        side_rank,
        field_position,
    }
}

fn pid(value: u64) -> PokemonId {
    PokemonId::new(s53(value))
}

/// The four runtime slots of one battler plus an enemy-side mirror of the
/// active slot, bound to real mapped program identities:
/// active 4 (`CriticalQuery`), passives 75/105/239.
fn four_slot_owners() -> Vec<AbilityOwnerState> {
    vec![
        owner(
            BehaviorSourceId::ActiveAbility { numeric_id: s53(4) },
            AbilitySourceKindV1::Active,
            0,
            0,
            false,
        ),
        owner(
            BehaviorSourceId::PassiveAbility {
                numeric_id: s53(75),
            },
            AbilitySourceKindV1::PassiveSlot0,
            0,
            0,
            false,
        ),
        owner(
            BehaviorSourceId::PassiveAbility {
                numeric_id: s53(105),
            },
            AbilitySourceKindV1::PassiveSlot1,
            0,
            0,
            false,
        ),
        owner(
            BehaviorSourceId::PassiveAbility {
                numeric_id: s53(239),
            },
            AbilitySourceKindV1::PassiveSlot2,
            0,
            0,
            false,
        ),
        owner(
            BehaviorSourceId::ActiveAbility { numeric_id: s53(4) },
            AbilitySourceKindV1::Active,
            1,
            0,
            false,
        ),
    ]
}

#[test]
fn closure_is_exact_complete_and_residual_free() -> Result<(), Box<dyn Error>> {
    let (catalog, manifest, programs, _prepared) = build_programs_and_content()?;
    let evidence = closure(&catalog, &programs, &manifest)?;

    assert_eq!(evidence.schema_version, 1);
    // Frozen composition: every ACTIVE_ABILITY/PASSIVE_ABILITY catalog unit
    // numbers 1777 per mirrored family; lanes split into 10 routine programs,
    // 2522 intrinsic definitions, 360 custom-dispatch units, and 662 units
    // owned by other closed bespoke families. Nothing remains unclassified.
    assert_eq!(evidence.active_units, 1777);
    assert_eq!(evidence.passive_units, 1777);
    assert_eq!(evidence.total_units(), 3554);
    assert_eq!(evidence.routine_program_units, 10);
    assert_eq!(evidence.intrinsic_units, 2522);
    assert_eq!(evidence.custom_dispatch_units, 360);
    assert_eq!(evidence.family_bespoke_units, 662);

    let lanes = evidence.lanes();
    assert_eq!(lanes.len(), evidence.total_units());
    let mut seen = std::collections::BTreeSet::new();
    for (unit, _lane) in lanes {
        assert!(seen.insert(unit), "lane identity must be unique");
    }
    let lane_sum = evidence.routine_program_units
        + evidence.intrinsic_units
        + evidence.custom_dispatch_units
        + evidence.family_bespoke_units;
    assert_eq!(lane_sum, evidence.total_units(), "zero residual");

    // Every routine-program lane points at one of the ten built programs, and
    // identity lookups hit resolved units only.
    for (_unit, lane) in lanes {
        if let AbilityExecutionLane::RoutineProgram { program_id } = lane {
            let value = program_id.get().get();
            assert!((1..=10).contains(&value));
        }
    }
    let routine_unit = lanes
        .iter()
        .find_map(|(unit, lane)| match lane {
            AbilityExecutionLane::RoutineProgram { .. } => Some(unit),
            _ => None,
        })
        .expect("ten routine lanes exist");
    assert!(evidence.lane_of(routine_unit).is_some());
    Ok(())
}

#[test]
fn four_slot_ordering_is_active_before_passive_and_permutation_invariant()
-> Result<(), Box<dyn Error>> {
    let (_catalog, _manifest, programs, _prepared) = build_programs_and_content()?;
    let owners = four_slot_owners();

    // Active slot first (player, then enemy side inside the same rank), then
    // passive slots in frozen order — both active mirrors and passive slots
    // 0..2 bind CriticalQuery through their mapped programs.
    let steps = slot_order_evidence(&programs, &owners, MechanicHookV2::CriticalQuery)?;
    let sequence: Vec<(usize, u32, u8)> = steps
        .iter()
        .map(|step| (step.owner_index, step.source_rank, step.side_rank))
        .collect();
    assert_eq!(
        sequence,
        vec![(0, 0, 0), (4, 0, 1), (1, 1, 0), (2, 2, 0)],
        "active-before-passive with side tie-break inside a rank"
    );

    // MoveTargetQuery reaches only the PassiveSlot2 owner: rank 3 participates
    // within its own hook invocation.
    let target_steps = slot_order_evidence(&programs, &owners, MechanicHookV2::MoveTargetQuery)?;
    assert_eq!(target_steps.len(), 1);
    assert_eq!(target_steps[0].owner_index, 3);
    assert_eq!(target_steps[0].source_rank, 3);

    // Ordering is total: reversing the input owners must not change the
    // execution sequence.
    let mut reversed = owners.clone();
    reversed.reverse();
    let flipped = slot_order_evidence(&programs, &reversed, MechanicHookV2::CriticalQuery)?;
    let projected = |steps: &[SlotExecutionStep]| {
        steps
            .iter()
            .map(|step| (step.slot, step.side_rank, step.program_id))
            .collect::<Vec<_>>()
    };
    assert_eq!(projected(&steps), projected(&flipped));

    // Slot ranks are monotone across the whole visited sequence.
    let ranks: Vec<u32> = steps.iter().map(|step| step.source_rank).collect();
    let mut sorted = ranks.clone();
    sorted.sort_unstable();
    assert_eq!(ranks, sorted);
    Ok(())
}

#[test]
fn overlapping_suppression_stacks_with_total_precedence_and_restores() -> Result<(), Box<dyn Error>>
{
    let subject = pid(1);
    let slot = AbilitySlot::Passive0;
    let ability = AbilityId::try_from_u64(77)?;

    let request = |origin: SuppressionOrigin,
                   suppressibility|
     -> Result<SlotSuppressionRequest, Box<dyn Error>> {
        Ok(SlotSuppressionRequest {
            owner: subject,
            slot,
            origin,
            remaining_turns: None,
            suppressibility,
            current_ability: ability,
        })
    };

    let requests = vec![
        request(
            SuppressionOrigin::MoveApplied {
                source_move: MoveId::try_from_u64(33)?,
            },
            AbilitySuppressibility::Suppressible,
        )?,
        request(
            SuppressionOrigin::FieldAbility {
                source_pokemon: pid(7),
            },
            AbilitySuppressibility::Suppressible,
        )?,
        request(
            SuppressionOrigin::GlobalIgnore,
            AbilitySuppressibility::Suppressible,
        )?,
        request(
            SuppressionOrigin::GlobalIgnore,
            AbilitySuppressibility::Suppressible,
        )?,
        request(
            SuppressionOrigin::GlobalIgnore,
            AbilitySuppressibility::Unsuppressible,
        )?,
    ];
    let outcomes = overlap_suppression_evidence(&requests)?;
    assert_eq!(
        outcomes,
        vec![
            OverlapSuppressionOutcome::Applied {
                governing_origin_after: SuppressionOrigin::MoveApplied {
                    source_move: MoveId::try_from_u64(33)?
                },
                stacked_entries_after: 1,
            },
            // A field suppressor outranks the move-applied overlay.
            OverlapSuppressionOutcome::Applied {
                governing_origin_after: SuppressionOrigin::FieldAbility {
                    source_pokemon: pid(7)
                },
                stacked_entries_after: 2,
            },
            // The global switch outranks both.
            OverlapSuppressionOutcome::Applied {
                governing_origin_after: SuppressionOrigin::GlobalIgnore,
                stacked_entries_after: 3,
            },
            // An identical origin refreshes in place instead of stacking.
            OverlapSuppressionOutcome::Applied {
                governing_origin_after: SuppressionOrigin::GlobalIgnore,
                stacked_entries_after: 3,
            },
            // The closed unsuppressible kind rejects every overlay.
            OverlapSuppressionOutcome::RejectedUnsuppressible {
                owner: subject,
                slot,
                ability,
            },
        ]
    );

    // Restoration: once the last governing overlay clears, the underlying
    // ability acts again.
    let mut state = SuppressionImmunityStateV2::new();
    for outcome_request in &requests[..3] {
        state = apply_slot_suppression(&state, outcome_request)
            .expect("suppressible request applies")
            .state;
    }
    let cleared_global = clear_suppressions(&state, SuppressionCleanupEvent::GlobalCleared)?;
    assert!(cleared_global.evidence.restored_slots.is_empty());
    let cleared_field = clear_suppressions(
        &cleared_global.state,
        SuppressionCleanupEvent::FieldSourceLeft(pid(7)),
    )?;
    assert!(cleared_field.evidence.restored_slots.is_empty());
    let cleared = clear_suppressions(
        &cleared_field.state,
        SuppressionCleanupEvent::OwnerLeftField(subject),
    )?;
    assert!(cleared.evidence.restored_slots.contains(&(subject, slot)));
    assert!(cleared.state.governing_origin(subject, slot).is_none());
    Ok(())
}

#[test]
fn suppression_gates_execution_but_reports_instead_of_dropping() -> Result<(), Box<dyn Error>> {
    let (_catalog, _manifest, programs, _prepared) = build_programs_and_content()?;
    let mut owners = four_slot_owners();
    // Owner 1 (PassiveSlot0) is genuinely suppressed; owner 4 (enemy active)
    // carries an unsuppressible kind, so its live overlay leaves it acting.
    owners[1].suppressed = true;

    let pokemon: Vec<PokemonId> = (1..=5).map(pid).collect();
    let gate_request = |owner_id: PokemonId,
                        slot: AbilitySlot|
     -> Result<SlotSuppressionRequest, Box<dyn Error>> {
        Ok(SlotSuppressionRequest {
            owner: owner_id,
            slot,
            origin: SuppressionOrigin::MoveApplied {
                source_move: MoveId::try_from_u64(33)?,
            },
            remaining_turns: None,
            suppressibility: AbilitySuppressibility::Suppressible,
            current_ability: AbilityId::try_from_u64(5)?,
        })
    };
    let mut state = SuppressionImmunityStateV2::new();
    state =
        apply_slot_suppression(&state, &gate_request(pokemon[1], AbilitySlot::Passive0)?)?.state;
    state = apply_slot_suppression(&state, &gate_request(pokemon[4], AbilitySlot::Active)?)?.state;

    let unsuppressible = [(pokemon[4], AbilitySlot::Active)];
    let evidence = suppression_gate_evidence(
        &programs,
        &owners,
        &state,
        &pokemon,
        &unsuppressible,
        MechanicHookV2::CriticalQuery,
    )?;

    // The suppressed passive slot is excluded from execution but reported with
    // its governing origin; the unsuppressible enemy active keeps executing.
    assert_eq!(evidence.excluded_owner_indices, vec![1]);
    let executed_owners: Vec<usize> = evidence
        .executed
        .iter()
        .map(|step| step.owner_index)
        .collect();
    assert_eq!(executed_owners, vec![0, 4, 2]);
    let governing_move = SuppressionOrigin::MoveApplied {
        source_move: MoveId::try_from_u64(33)?,
    };
    for index in 0..owners.len() {
        let expected = if index == 1 || index == 4 {
            Some(governing_move.clone())
        } else {
            None
        };
        assert_eq!(evidence.governing_origins[index], expected);
    }

    // Dispatcher cross-check: the same routed identity appears exactly once
    // (zero silent residuals), retained when unsuppressible and gated with a
    // governing origin otherwise.
    let identity = BehaviorUnitId {
        source: BehaviorSourceId::ActiveAbility { numeric_id: s53(4) },
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        ordinal: BehaviorUnitOrdinal::new(4000),
        provenance_hash: ProvenanceHash::parse(IMMUNITY_GATE_HASH.to_owned())?,
    };
    let units = [DispatchUnitInput {
        owner: pokemon[4],
        slot: AbilitySlot::Active,
        identity: &identity,
    }];
    let retained = route_ability_dispatch(
        &units,
        &DispatchContext {
            suppression: &state,
            unsuppressible_slots: &unsuppressible,
        },
    )?;
    assert_eq!(retained.routed.len(), 1);
    assert!(matches!(
        retained.routed[0].gate,
        DispatchGate::RetainedUnsuppressible { .. }
    ));

    let gated = route_ability_dispatch(
        &units,
        &DispatchContext {
            suppression: &state,
            unsuppressible_slots: &[],
        },
    )?;
    assert_eq!(gated.routed.len(), 1);
    assert!(matches!(
        gated.routed[0].gate,
        DispatchGate::GatedBySuppression { .. }
    ));
    Ok(())
}

#[test]
fn false_conditions_exclude_bindings_without_mutations() -> Result<(), Box<dyn Error>> {
    let (_catalog, _manifest, programs, _prepared) = build_programs_and_content()?;
    let arena_len = |program: &MechanicsProgramV2| program.conditions.0.len();

    let conditioned: Vec<MechanicsProgramV2> = programs
        .iter()
        .map(|program| {
            let mut clone = program.clone();
            let root = u16::try_from(clone.conditions.0.len())?;
            clone.conditions.0.push(ConditionNodeV2::Never);
            clone.budget.condition_nodes = u16::try_from(clone.conditions.0.len())?;
            for binding in clone.bindings.iter_mut() {
                binding.condition_root = Some(ConditionNodeId(root));
            }
            clone.validate()?;
            Ok(clone)
        })
        .collect::<Result<Vec<_>, Box<dyn Error>>>()?;
    let untouched: Vec<MechanicsProgramV2> = programs.to_vec();

    let owners = four_slot_owners();
    let before_lengths: Vec<usize> = programs.iter().map(arena_len).collect();

    let evidence = false_condition_exclusion_evidence(
        &programs,
        &conditioned,
        &owners,
        MechanicHookV2::CriticalQuery,
    )?;
    assert_eq!(evidence.baseline_admitted_steps, 4);
    assert_eq!(evidence.conditioned_admitted_steps, 0);

    // Negative control: an admitting twin still stages work and must be
    // reported as a leak rather than silently accepted.
    let leak = false_condition_exclusion_evidence(
        &programs,
        &untouched,
        &owners,
        MechanicHookV2::CriticalQuery,
    );
    assert!(matches!(leak, Err(AbilityParityError::FalseConditionLeak)));

    // Purity: repeated evaluation is deterministic and mutates nothing.
    let first = slot_order_evidence(&programs, &owners, MechanicHookV2::CriticalQuery)?;
    let second = slot_order_evidence(&programs, &owners, MechanicHookV2::CriticalQuery)?;
    assert_eq!(first, second);
    let after_lengths: Vec<usize> = programs.iter().map(arena_len).collect();
    assert_eq!(before_lengths, after_lengths);
    Ok(())
}

#[test]
fn immunity_gate_yields_to_suppression_then_bypass_precedence() -> Result<(), Box<dyn Error>> {
    let claim = ImmunityClaim {
        owner: pid(1),
        slot: AbilitySlot::Active,
        provenance_hash: IMMUNITY_GATE_HASH,
    };
    let rows = immunity_bypass_matrix(
        &claim,
        ImmunitySubject::Status(StatusKind::Burn),
        AbilityId::try_from_u64(77)?,
    )?;

    // Native denial while clean; bypass outranks native immunity; the
    // claiming slot's own suppression outranks bypass in both combinations.
    assert_eq!(rows[0].decision, ImmunityDecision::Denied);
    assert!(!rows[0].claiming_slot_suppressed);
    assert_eq!(
        rows[1].decision,
        ImmunityDecision::Allowed {
            reason: ImmunityAllowReason::BypassPrecedence
        }
    );
    assert_eq!(
        rows[2].decision,
        ImmunityDecision::Allowed {
            reason: ImmunityAllowReason::ClaimingSlotSuppressed
        }
    );
    assert_eq!(rows[2].bypass, AbilityBypassInput::None);
    assert_eq!(
        rows[3].decision,
        ImmunityDecision::Allowed {
            reason: ImmunityAllowReason::ClaimingSlotSuppressed
        }
    );

    // Fail closed: non-immunity lanes can never answer an immunity claim.
    let impostor = ImmunityClaim {
        owner: pid(1),
        slot: AbilitySlot::Active,
        provenance_hash: POWER_QUERY_HASH,
    };
    let rejected = immunity_bypass_matrix(
        &impostor,
        ImmunitySubject::Status(StatusKind::Burn),
        AbilityId::try_from_u64(77)?,
    );
    assert!(matches!(
        rejected,
        Err(AbilityParityError::NotAnImmunityClaim(_))
    ));
    Ok(())
}

#[test]
fn rng_admission_is_zero_with_fail_closed_chance_probes() -> Result<(), Box<dyn Error>> {
    let (catalog, _manifest, programs, _prepared) = build_programs_and_content()?;
    let site_owners: Vec<BehaviorUnitId> = catalog
        .rng_sites()
        .iter()
        .map(|site| site.owner.clone())
        .collect();
    let evidence = rng_admission_evidence(&site_owners, &programs)?;
    assert_eq!(evidence.audited_site_owners, 273);
    assert_eq!(evidence.audited_routine_programs, 10);
    assert_eq!(evidence.ability_owned_sites, 0);
    assert_eq!(evidence.routine_rng_bindings, 0);
    assert_eq!(evidence.chance_probes_rejected, 1);
    assert!(evidence.unconditional_probe_admitted);

    // Fail closed: an ability-owned RNG site is a contract violation.
    let offender = BehaviorUnitId {
        source: BehaviorSourceId::ActiveAbility {
            numeric_id: s53(999_999),
        },
        unit_kind: BehaviorUnitKind::AbilityAttribute,
        ordinal: BehaviorUnitOrdinal::new(5000),
        provenance_hash: ProvenanceHash::parse("aa".repeat(32))?,
    };
    let mut violating = site_owners.clone();
    violating.push(offender);
    let rejected = rng_admission_evidence(&violating, &programs);
    assert!(matches!(
        rejected,
        Err(AbilityParityError::AbilityOwnedRngSite(_))
    ));
    Ok(())
}

#[test]
fn oracle_witnesses_agree_and_first_divergence_is_exact() -> Result<(), Box<dyn Error>> {
    let (catalog, manifest, programs, _prepared) = build_programs_and_content()?;
    let evidence = closure(&catalog, &programs, &manifest)?;

    let plan = witness_plan()?;
    let ability_witnesses: Vec<&AbilityWitness> = plan
        .witnesses
        .iter()
        .filter(|witness| ability_polarity(&witness.expected_source).is_some())
        .collect();
    assert_eq!(ability_witnesses.len(), 3554);

    let inputs: Vec<OracleWitnessInput<'_>> = ability_witnesses
        .iter()
        .map(|witness| OracleWitnessInput {
            unit: &witness.behavior_unit,
            expected_source: &witness.expected_source,
            expected_hook: witness.expected_hook.as_str(),
            asserts_source_reached: witness
                .positive_assertions
                .iter()
                .any(|assertion| assertion.kind == "SOURCE_REACHED"),
        })
        .collect();
    assert!(inputs.iter().all(|input| input.asserts_source_reached));
    assert!(ability_witnesses.iter().all(|witness| {
        witness
            .negative_assertions
            .iter()
            .any(|assertion| assertion.kind == "FALSE_CONDITION_DOES_NOT_MUTATE")
    }));
    assert_eq!(
        first_witness_divergence(&inputs, &evidence),
        None,
        "every oracle witness agrees with the resolved closure"
    );

    // Synthetic divergence: corrupting exactly one witness's mirrored source
    // identity must be reported at exactly that index and nothing earlier.
    let corrupt_index = 1777;
    let mut corrupted_sources: Vec<BehaviorSourceId> = ability_witnesses
        .iter()
        .map(|witness| witness.expected_source.clone())
        .collect();
    corrupted_sources[corrupt_index] = BehaviorSourceId::ActiveAbility {
        numeric_id: s53(999_999),
    };
    let diverging: Vec<OracleWitnessInput<'_>> = ability_witnesses
        .iter()
        .enumerate()
        .map(|(index, witness)| OracleWitnessInput {
            unit: &witness.behavior_unit,
            expected_source: &corrupted_sources[index],
            expected_hook: witness.expected_hook.as_str(),
            asserts_source_reached: true,
        })
        .collect();
    let divergence =
        first_witness_divergence(&diverging, &evidence).expect("corrupted witness must diverge");
    assert_eq!(
        divergence,
        WitnessDivergence::SourceIdentityMismatch {
            index: corrupt_index,
            expected: BehaviorSourceId::ActiveAbility {
                numeric_id: s53(999_999)
            },
            actual: ability_witnesses[corrupt_index]
                .behavior_unit
                .source
                .clone(),
        }
    );
    Ok(())
}

#[test]
fn prepared_query_and_trigger_dispatch_matches_direct_reference() -> Result<(), Box<dyn Error>> {
    let (_catalog, _manifest, programs, prepared) = build_programs_and_content()?;

    let mut sources: Vec<BehaviorSourceId> = programs
        .iter()
        .map(|program| program.source.clone())
        .collect();
    sources.sort();
    sources.dedup();
    let active_only: Vec<BehaviorSourceId> = sources
        .iter()
        .filter(|source| matches!(source, BehaviorSourceId::ActiveAbility { .. }))
        .cloned()
        .collect();
    let passive_only: Vec<BehaviorSourceId> = sources
        .iter()
        .filter(|source| matches!(source, BehaviorSourceId::PassiveAbility { .. }))
        .cloned()
        .collect();

    let context_all = MechanicsContextV2 {
        active_sources: &sources,
        suppressed_sources: &[],
        instance_counter: 3,
        hp_current: 47,
        hp_max: 101,
        turn_index: 9,
        wave_index: 12,
        level: 31,
    };
    let context_actives_suppressed = MechanicsContextV2 {
        active_sources: &sources,
        suppressed_sources: &active_only,
        instance_counter: 3,
        hp_current: 47,
        hp_max: 101,
        turn_index: 9,
        wave_index: 12,
        level: 31,
    };
    let context_passive_only = MechanicsContextV2 {
        active_sources: &passive_only,
        suppressed_sources: &active_only,
        instance_counter: 3,
        hp_current: 47,
        hp_max: 101,
        turn_index: 9,
        wave_index: 12,
        level: 31,
    };
    let contexts = [
        context_all,
        context_actives_suppressed,
        context_passive_only,
    ];

    let report = prepared_dispatch_parity(&programs, &prepared, &contexts)?;
    assert_eq!(report.contexts, 3);
    assert_eq!(report.compared_queries, 17 * 3);
    assert_eq!(report.compared_hooks, 24 * 3);
    assert!(
        report.staged_operations > 0,
        "ordered evidence was compared"
    );
    Ok(())
}
