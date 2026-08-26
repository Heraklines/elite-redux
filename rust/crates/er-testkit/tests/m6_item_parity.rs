//! M6D system proof: held-item/modifier catalog parity over prepared
//! content, the bespoke item-lifecycle family, the V2 item executor, audited
//! RNG streams, and the prepared-versus-direct routine execution pair.
//!
//! Every identity in the frozen catalog's `HELD_ITEM` / `MODIFIER_BEHAVIOR`
//! family must classify exactly once with a closed outcome, and deterministic
//! lifecycle campaigns must produce byte-stable witnesses whose eligibility,
//! trigger, consume/restore/transfer/suppression transitions agree across
//! both production execution surfaces. Nothing here authors results: every
//! assertion reads typed evidence produced by the production paths.

use std::collections::BTreeSet;
use std::error::Error;

use er_battle::m6::bespoke::item_lifecycle::{
    ConsumeOutcome, ItemLifecycleError, ItemTriggerEligibility, TransferMode,
};
use er_battle::m6::routine_executor::{
    MechanicsContextV2, QueryValueV2, execute_hook_v2_direct_reference,
    execute_query_v2_direct_reference,
};
use er_battle::m6::system::item_parity::{
    self, ExecutorMirror, ItemCampaignAction, ItemCampaignConfig, ItemParityError,
    ItemStepEvidence, TurnSource,
};
use er_content::m6_catalog::{CatalogResolution, SemanticCatalogV1};
use er_content::pack::m6_pack::{
    BattleContentPackV3, BehaviorClassificationManifestV2, FieldContentV1,
};
use er_content::pack::m6_prepared::prepare_content;
use er_content_compiler::m6::{
    BespokeAssignment, CompilerOptions, IntrinsicRule, SemanticCatalogInput, SemanticCompileOutput,
    SemanticCompileRequest, ValidatedSemanticCatalog, compile_semantics,
};
use er_mechanics::v2::{MechanicHookV2, MechanicQueryV2};
use er_types::battle_ids::{PokemonId, WaveIndex};
use er_types::{
    BattleContentPackHashV3, BehaviorClassificationKindV2, BehaviorSourceId,
    BehaviorUnitId as UnitKeyAlias, BehaviorUnitKind, BespokeMechanicId, CatalogHash,
    M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION, OracleSha, SafeU53,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct BespokeClusterManifest {
    clusters: Vec<BespokeClusterEntry>,
}

#[derive(Deserialize)]
struct BespokeClusterEntry {
    cluster: BespokeMechanicId,
    behavior_units: Vec<UnitKeyAlias>,
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

fn cluster_manifest() -> Result<BespokeClusterManifest, Box<dyn Error>> {
    Ok(serde_json::from_slice(include_bytes!(
        "../../../fixtures/m6/bespoke-clusters-v1.json"
    ))?)
}

/// Runs the full production semantic compile exactly like the closed-system
/// proofs: every resolved intrinsic admitted, every bespoke gap routed.
fn compile_production() -> Result<(ValidatedSemanticCatalog, SemanticCompileOutput), Box<dyn Error>>
{
    let catalog = validated_catalog()?;
    let intrinsic_rules: Vec<_> = catalog
        .behavior_units()
        .iter()
        .filter(|unit| unit.semantic.resolution == CatalogResolution::ResolvedIntrinsic)
        .map(|unit| IntrinsicRule {
            behavior_unit: unit.id.clone(),
        })
        .collect();
    let manifest = cluster_manifest()?;
    let bespoke_assignments: Vec<_> = manifest
        .clusters
        .iter()
        .map(|cluster| BespokeAssignment {
            mechanic: cluster.cluster,
            behavior_units: cluster.behavior_units.clone(),
        })
        .collect();

    let output = compile_semantics(SemanticCompileRequest {
        catalog: &catalog,
        intrinsic_rules: &intrinsic_rules,
        bespoke_assignments: &bespoke_assignments,
        options: CompilerOptions::default(),
    })?;
    Ok((catalog, output))
}

/// Pack-ready classification manifest: production entries whose compiled
/// program references all resolve against the built IR programs. Pure
/// intrinsic-rule allocations carry no executable IR and cannot slot into a
/// validated pack, so those entries stay out; every bespoke and resolved
/// routine entry ships verbatim.
fn pack_classifications(output: &SemanticCompileOutput) -> BehaviorClassificationManifestV2 {
    let built: BTreeSet<er_types::mechanics::MechanicsProgramId> = output
        .routine_programs
        .iter()
        .map(|program| program.id)
        .collect();
    BehaviorClassificationManifestV2(
        output
            .classifications
            .0
            .iter()
            .filter(|entry| {
                entry.kind != BehaviorClassificationKindV2::Compiled
                    || entry.programs.iter().all(|id| built.contains(id))
            })
            .cloned()
            .collect(),
    )
}

fn holder(value: u64) -> PokemonId {
    PokemonId::try_from_u64(value).expect("holder id")
}

fn holders() -> Vec<PokemonId> {
    vec![holder(1), holder(2), holder(3), holder(4)]
}

fn config<'a>(seed: &'a str, roster: &'a [PokemonId]) -> ItemCampaignConfig<'a> {
    ItemCampaignConfig {
        wave_seed: seed,
        wave: WaveIndex::try_from_u64(41).expect("wave index"),
        holders: roster,
    }
}

#[test]
fn held_item_inventory_is_exactly_once_and_fully_closed() -> Result<(), Box<dyn Error>> {
    let (catalog, output) = compile_production()?;
    assert_eq!(output.report.unsupported_unit_count, 0);

    let inventory =
        item_parity::inventory_held_items(catalog.behavior_units(), &output.classifications)?;
    assert_eq!(inventory.catalog_units, 215);
    assert_eq!(inventory.entries.len(), 215);

    // Exactly-once: sorted, unique keys.
    let keys = inventory.registry_keys();
    let mut unique = keys.clone();
    unique.dedup();
    assert_eq!(keys.len(), unique.len());
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(keys, sorted);

    // Zero unsupported: this catalog generation routes every modifier unit
    // into the berry-lifecycle bespoke cluster with no compiled programs.
    for entry in &inventory.entries {
        assert_eq!(entry.unit_kind, BehaviorUnitKind::ModifierBehavior);
        assert_eq!(
            entry.kind,
            BehaviorClassificationKindV2::Bespoke,
            "unexpected non-bespoke outcome for {}",
            entry.registry_key
        );
        assert_eq!(entry.bespoke, Some(BespokeMechanicId::ItemBerryLifecycle));
        assert!(entry.programs.is_empty());
        assert!(entry.unsupported_reason.is_none());
        assert!(matches!(
            entry.unit_source,
            BehaviorSourceId::HeldItem { .. }
        ));
    }
    // Representative identities really are present exactly once each.
    for key in ["BERRY", "BERRY_POUCH", "SCOPE_LENS", "ER_LIFE_ORB"] {
        assert_eq!(
            keys.iter().filter(|candidate| **candidate == key).count(),
            1,
            "{key} must appear exactly once"
        );
    }

    // Determinism: rebuilding the inventory reproduces it exactly.
    let again =
        item_parity::inventory_held_items(catalog.behavior_units(), &output.classifications)?;
    assert_eq!(inventory, again);

    // Fail-closed controls over mutated manifests.
    let held_entries: Vec<usize> = output
        .classifications
        .0
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            matches!(
                entry.behavior_unit.source,
                BehaviorSourceId::HeldItem { .. }
            )
            .then_some(index)
        })
        .collect();
    assert_eq!(held_entries.len(), 215);

    let mut missing = output.classifications.clone();
    missing.0.remove(held_entries[0]);
    let error = item_parity::inventory_held_items(catalog.behavior_units(), &missing).unwrap_err();
    assert!(matches!(
        error,
        ItemParityError::UnclassifiedHeldItemUnit { .. }
    ));

    let mut unsupported = output.classifications.clone();
    unsupported.0[held_entries[1]].kind = BehaviorClassificationKindV2::Unsupported;
    unsupported.0[held_entries[1]].programs.clear();
    unsupported.0[held_entries[1]].bespoke = None;
    let error =
        item_parity::inventory_held_items(catalog.behavior_units(), &unsupported).unwrap_err();
    assert!(matches!(error, ItemParityError::UnsupportedIdentity { .. }));

    let mut phantom = output.classifications.clone();
    let mut cloned = phantom.0[held_entries[2]].clone();
    cloned.kind = BehaviorClassificationKindV2::Bespoke;
    cloned.bespoke = Some(BespokeMechanicId::ItemBerryLifecycle);
    cloned.programs.clear();
    cloned.unsupported_reason = None;
    cloned.behavior_unit.source = BehaviorSourceId::HeldItem {
        registry_key: "PHANTOM_NOT_IN_CATALOG".to_owned(),
    };
    phantom.0.push(cloned);
    let error = item_parity::inventory_held_items(catalog.behavior_units(), &phantom).unwrap_err();
    assert!(matches!(
        error,
        ItemParityError::UnknownHeldItemClassification { .. }
    ));

    Ok(())
}

/// Full positive/negative lifecycle campaign covering grant, eligibility,
/// consume (plain, charged, preserved, suppressed, duplicate), restore,
/// transfer, steal-rejection, knock off, swap, suppression windows, expiry
/// sweeps, and draw-backed turns.
fn lifecycle_actions() -> Vec<ItemCampaignAction> {
    use ItemCampaignAction as A;
    vec![
        // Seeded grants across holders: plain stack berry, charged
        // stack-equal booster, transferable charm, nontransferable nugget.
        A::Grant {
            owner: holder(1),
            registry_key: "BERRY".to_owned(),
            stacks: 3,
            charges: None,
            source_ordinal: 10,
            transferable: false,
        },
        A::Grant {
            owner: holder(2),
            registry_key: "DIRE_HIT".to_owned(),
            stacks: 2,
            charges: Some(2),
            source_ordinal: 11,
            transferable: true,
        },
        A::Grant {
            owner: holder(3),
            registry_key: "AMULET_COIN".to_owned(),
            stacks: 1,
            charges: None,
            source_ordinal: 12,
            transferable: true,
        },
        A::Grant {
            owner: holder(4),
            registry_key: "BIG_NUGGET".to_owned(),
            stacks: 1,
            charges: None,
            source_ordinal: 13,
            transferable: false,
        },
        // Draw-backed eligibility probe.
        A::Eligibility {
            owner: holder(1),
            registry_key: "BERRY".to_owned(),
            current_turn: TurnSource::Draw {
                minimum: 1,
                maximum: 50,
            },
        },
        // Plain consumption survives (stacks 3 -> 2), mirrored on the executor.
        A::Consume {
            owner: holder(1),
            registry_key: "BERRY".to_owned(),
            preserve: false,
            current_turn: TurnSource::Draw {
                minimum: 1,
                maximum: 50,
            },
        },
        // Preserved trigger: no lifecycle mutation, no ledger entry.
        A::Consume {
            owner: holder(1),
            registry_key: "BERRY".to_owned(),
            preserve: true,
            current_turn: TurnSource::Fixed(7),
        },
        // Charged consumption decrements the shared counter.
        A::Consume {
            owner: holder(2),
            registry_key: "DIRE_HIT".to_owned(),
            preserve: false,
            current_turn: TurnSource::Fixed(7),
        },
        // Transferable hand-off then an involuntary-take rejection on a
        // nontransferable instance.
        A::Transfer {
            from: holder(3),
            to: holder(1),
            registry_key: "AMULET_COIN".to_owned(),
            mode: TransferMode::Transfer,
        },
        A::Transfer {
            from: holder(4),
            to: holder(1),
            registry_key: "BIG_NUGGET".to_owned(),
            mode: TransferMode::Steal,
        },
        // Swap the charm back for the dire hit.
        A::Swap {
            left: holder(1),
            left_registry_key: "AMULET_COIN".to_owned(),
            right: holder(2),
            right_registry_key: "DIRE_HIT".to_owned(),
        },
        // Suppression window gates consumption through its expiry turn.
        A::Suppress {
            holder: holder(1),
            registry_key: "BERRY".to_owned(),
            expiry_turn: TurnSource::Fixed(20),
        },
        A::Consume {
            owner: holder(1),
            registry_key: "BERRY".to_owned(),
            preserve: false,
            current_turn: TurnSource::Fixed(20),
        },
        // Lapse sweep strictly after expiry, then the deferred consumptions
        // burn the remaining stacks; the last one logs a restorable entry.
        A::Expire {
            current_turn: TurnSource::Fixed(21),
        },
        A::Consume {
            owner: holder(1),
            registry_key: "BERRY".to_owned(),
            preserve: false,
            current_turn: TurnSource::Fixed(21),
        },
        A::Consume {
            owner: holder(1),
            registry_key: "BERRY".to_owned(),
            preserve: false,
            current_turn: TurnSource::Fixed(21),
        },
        // Duplicate trigger against the fully consumed berry: one-shot
        // idempotence, not an absence failure.
        A::Consume {
            owner: holder(1),
            registry_key: "BERRY".to_owned(),
            preserve: false,
            current_turn: TurnSource::Fixed(22),
        },
        // Harvest restores the newest restorable entry; the next restore
        // finds nothing.
        A::Restore { owner: holder(1) },
        A::Restore { owner: holder(1) },
        // Knock Off destroys forever with a non-restorable ledger entry.
        A::KnockOff {
            target: holder(4),
            registry_key: "BIG_NUGGET".to_owned(),
        },
        // Knocking off an absent item fails closed.
        A::KnockOff {
            target: holder(4),
            registry_key: "BIG_NUGGET".to_owned(),
        },
    ]
}

#[test]
fn lifecycle_campaign_witnesses_are_deterministic_and_complete() -> Result<(), Box<dyn Error>> {
    let roster = holders();
    let actions = lifecycle_actions();

    let first = item_parity::run_item_campaign(&config("m6d-items-wave", &roster), &actions)?;
    let second = item_parity::run_item_campaign(&config("m6d-items-wave", &roster), &actions)?;
    assert!(
        item_parity::first_campaign_divergence(&first, &second).is_none(),
        "same seed must reproduce every witness exactly"
    );

    let other = item_parity::run_item_campaign(&config("m6d-other-wave", &roster), &actions)?;
    assert!(
        item_parity::first_campaign_divergence(&first, &other).is_some(),
        "different seeds must be audible in the evidence"
    );

    // Audited RNG: every recorded draw validates and sequences are monotonic.
    let mut previous: Option<SafeU53> = None;
    for draw in &first.audit_entries {
        draw.validate()?;
        assert!(previous.map_or(true, |prior| draw.sequence > prior));
        previous = Some(draw.sequence);
    }

    let steps = &first.steps;
    assert_eq!(steps.len(), actions.len());

    // Positive witnesses, in order.
    assert!(steps[0].outcome.is_ok());
    match steps[5].outcome.as_ref().unwrap() {
        ItemStepEvidence::Consume(evidence) => {
            assert_eq!(evidence.stacks_before, 3);
            assert_eq!(evidence.stacks_after, Some(2));
            assert!(matches!(
                evidence.outcome,
                ConsumeOutcome::Consumed {
                    ledger_ordinal: None,
                    ..
                }
            ));
        }
        other => panic!("step 5 should be a surviving consume, got {other:?}"),
    }
    match steps[6].outcome.as_ref().unwrap() {
        ItemStepEvidence::Consume(evidence) => {
            assert_eq!(evidence.outcome, ConsumeOutcome::Preserved);
            assert_eq!(evidence.stacks_after, Some(2));
        }
        other => panic!("step 6 should be a preserved trigger, got {other:?}"),
    }
    // Preservation must not have moved either root.
    assert_eq!(
        steps[6].lifecycle_fingerprint_after,
        steps[5].lifecycle_fingerprint_after
    );
    match steps[12].outcome.as_ref().unwrap() {
        ItemStepEvidence::Consume(evidence) => {
            assert!(matches!(
                evidence.outcome,
                ConsumeOutcome::Suppressed { expiry_turn: 20 }
            ));
        }
        other => panic!("step 12 should be a suppressed trigger, got {other:?}"),
    }
    match steps[16].outcome.as_ref().unwrap() {
        ItemStepEvidence::Consume(evidence) => {
            assert_eq!(evidence.outcome, ConsumeOutcome::AlreadyConsumed);
        }
        other => panic!("step 16 should be an idempotent duplicate, got {other:?}"),
    }
    let restored = match steps[17].outcome.as_ref().unwrap() {
        ItemStepEvidence::Restore(evidence) => evidence.clone(),
        other => panic!("step 17 should restore, got {other:?}"),
    };
    assert_eq!(restored.registry_key, "BERRY");
    assert!(steps[18].outcome.is_err());

    // Negative witnesses carry typed errors and provably change nothing.
    let steal_error = steps[9].outcome.as_ref().unwrap_err();
    assert!(matches!(
        steal_error,
        ItemLifecycleError::NotTransferable { .. }
    ));
    let knock_error = steps[20].outcome.as_ref().unwrap_err();
    assert!(matches!(knock_error, ItemLifecycleError::ItemAbsent { .. }));
    for rejected_step in [9usize, 18, 20] {
        assert_eq!(
            steps[rejected_step].lifecycle_fingerprint_after,
            steps[rejected_step - 1].lifecycle_fingerprint_after,
            "rejected step {rejected_step} must leave the lifecycle root untouched"
        );
    }

    // Eligibility probes agree on both gates before any trigger runs.
    match steps[4].outcome.as_ref().unwrap() {
        ItemStepEvidence::Eligibility(ItemTriggerEligibility::Eligible) => {}
        other => panic!("step 4 should be eligible, got {other:?}"),
    }

    // Ordered source stack tracks the live inventory and stays canonical.
    let stack = &steps[15].source_stack_after;
    let mut canonical = stack.clone();
    canonical.sort();
    canonical.dedup();
    assert_eq!(stack, &canonical);

    // Final roots validate canonically and every shape in this campaign
    // mirrors onto the executor surface.
    first.final_state.validate()?;
    for step in steps {
        assert_ne!(
            step.mirror,
            ExecutorMirror::UnmirroredShape {
                registry_key: String::new()
            },
            "placeholder comparison guard"
        );
    }
    assert!(
        !steps
            .iter()
            .any(|step| matches!(step.mirror, ExecutorMirror::UnmirroredShape { .. }))
    );

    Ok(())
}

#[test]
fn prepared_and_direct_paths_agree_under_item_source_stacks() -> Result<(), Box<dyn Error>> {
    let (catalog, output) = compile_production()?;
    let inventory =
        item_parity::inventory_held_items(catalog.behavior_units(), &output.classifications)?;
    assert_eq!(inventory.catalog_units, 215);

    // Assemble one validated pack from the production compile: programs slot
    // by their allocated ids, classifications and the bespoke manifest ship
    // verbatim, and battle-visible content slices stay empty because this
    // catalog generation admits no compiled item programs.
    let max_program_slot = output
        .routine_programs
        .iter()
        .map(|program| usize::try_from(program.id.get().get()).expect("program slot"))
        .max()
        .unwrap_or(0);
    let mut slots = vec![None; max_program_slot + 1];
    for program in &output.routine_programs {
        let slot = usize::try_from(program.id.get().get())?;
        assert!(slots[slot].is_none(), "program slot {slot} double-booked");
        slots[slot] = Some(program.clone());
    }
    let pack = BattleContentPackV3 {
        schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: OracleSha::parse(output.report.oracle_sha.clone())?,
        raw_catalog_hash: CatalogHash::parse(output.report.raw_catalog_hash.clone())?,
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
        programs: slots,
        classifications: pack_classifications(&output),
        bespoke: output.bespoke.clone(),
        rng_sites: Vec::new(),
        type_chart: er_content::pack::selected_type_chart(),
    };
    let mut pack = pack;
    pack.content_hash = pack.compute_content_hash()?;
    let prepared = prepare_content(pack)?;

    // Derive item source stacks from a real campaign's final witnesses.
    let roster = holders();
    let run =
        item_parity::run_item_campaign(&config("prepared-parity", &roster), &lifecycle_actions())?;
    let item_sources = run.steps.last().unwrap().source_stack_after.clone();
    assert!(!item_sources.is_empty());

    // Program sources give the folds real content so the comparison cannot
    // pass vacuously.
    let program_sources: Vec<BehaviorSourceId> = {
        let mut sources: Vec<_> = output
            .routine_programs
            .iter()
            .map(|program| program.source.clone())
            .collect();
        sources.sort();
        sources.dedup();
        sources.into_iter().take(24).collect()
    };

    let mut active: Vec<BehaviorSourceId> = item_sources
        .iter()
        .chain(program_sources.iter())
        .cloned()
        .collect();
    active.sort();
    active.dedup();

    // Which axes actually have bindings among the compiled programs?
    let bound_queries: BTreeSet<MechanicQueryV2> = output
        .routine_programs
        .iter()
        .flat_map(|program| program.bindings.iter())
        .filter_map(|binding| binding.hook.query().ok())
        .collect();
    let bound_hooks: BTreeSet<MechanicHookV2> = output
        .routine_programs
        .iter()
        .flat_map(|program| program.bindings.iter())
        .filter(|binding| !binding.hook.is_query())
        .map(|binding| binding.hook)
        .collect();
    // This catalog generation maps query-only routines, so the trigger axis
    // may legitimately be empty; the query axis must not be.
    assert!(!bound_queries.is_empty());

    let candidate_queries: [(MechanicQueryV2, QueryValueV2); 4] = [
        (MechanicQueryV2::Damage, QueryValueV2::Signed(240)),
        (MechanicQueryV2::CriticalRate, QueryValueV2::Signed(0)),
        (MechanicQueryV2::Accuracy, QueryValueV2::Signed(100)),
        (
            MechanicQueryV2::ItemEligibility,
            QueryValueV2::Boolean(true),
        ),
    ];
    let mut queries: Vec<_> = candidate_queries
        .iter()
        .filter(|(query, _)| bound_queries.contains(query))
        .cloned()
        .collect();
    for query in &bound_queries {
        if !candidate_queries
            .iter()
            .any(|(candidate, _)| candidate == query)
        {
            queries.push((*query, QueryValueV2::Signed(7)));
        }
    }
    let hooks: Vec<MechanicHookV2> = bound_hooks.into_iter().collect();

    let unsuppressed_context = MechanicsContextV2 {
        active_sources: &active,
        suppressed_sources: &[],
        instance_counter: 11,
        hp_current: 137,
        hp_max: 251,
        turn_index: 21,
        wave_index: 41,
        level: 58,
    };
    // A reduced stack drops one compiled source from participation entirely;
    // suppression windows in this IR act through AbilitySuppressed
    // predicates, so removal is the axis that must move the folds here.
    let reduced_stack: Vec<BehaviorSourceId> = active
        .iter()
        .filter(|source| **source != program_sources[0])
        .cloned()
        .collect();
    assert_ne!(reduced_stack.len(), active.len());
    let reduced_context = MechanicsContextV2 {
        active_sources: &reduced_stack,
        suppressed_sources: &[],
        instance_counter: 11,
        hp_current: 137,
        hp_max: 251,
        turn_index: 21,
        wave_index: 41,
        level: 58,
    };

    // Sanity: the fold is non-vacuous on the direct path for at least one
    // axis under the unsuppressed context.
    let mut non_empty_axes = 0_usize;
    for (query, initial) in &queries {
        let transition = execute_query_v2_direct_reference(
            &output.routine_programs,
            &unsuppressed_context,
            *query,
            initial.clone(),
        )?;
        non_empty_axes += usize::from(!transition.evidence.is_empty());
    }
    for hook in &hooks {
        let transition = execute_hook_v2_direct_reference(
            &output.routine_programs,
            &unsuppressed_context,
            *hook,
        )?;
        non_empty_axes += usize::from(!transition.operations.is_empty());
    }
    assert!(
        non_empty_axes > 0,
        "comparison would be vacuous: no bindings matched"
    );

    for context in [&unsuppressed_context, &reduced_context] {
        let reports = item_parity::compare_prepared_and_direct(
            &output.routine_programs,
            &prepared,
            context,
            &queries,
            &hooks,
        )?;
        assert!(
            reports.is_empty(),
            "prepared and direct paths diverged: {reports:?}"
        );
    }

    // Dropping the source must actually change some observable fold between
    // the two contexts on the direct path, proving the axis participates.
    let mut changed = false;
    for (query, initial) in &queries {
        let full = execute_query_v2_direct_reference(
            &output.routine_programs,
            &unsuppressed_context,
            *query,
            initial.clone(),
        )?;
        let reduced = execute_query_v2_direct_reference(
            &output.routine_programs,
            &reduced_context,
            *query,
            initial.clone(),
        )?;
        changed |= full != reduced;
    }
    assert!(
        changed,
        "removing a program source from the stack must change some fold"
    );

    // The ordered stack must genuinely contain the item-derived sources on
    // top of the compiled-program sources.
    let mut without_items = program_sources.clone();
    without_items.sort();
    assert_ne!(active, without_items);

    Ok(())
}

#[test]
fn unmirrored_shapes_fail_closed_across_the_whole_campaign() -> Result<(), Box<dyn Error>> {
    let roster = holders();
    let actions = vec![
        ItemCampaignAction::Grant {
            owner: holder(1),
            registry_key: "ATTACK_TYPE_BOOSTER".to_owned(),
            stacks: 2,
            charges: Some(5),
            source_ordinal: 30,
            transferable: false,
        },
        ItemCampaignAction::Grant {
            owner: holder(1),
            registry_key: "BERRY".to_owned(),
            stacks: 1,
            charges: None,
            source_ordinal: 31,
            transferable: false,
        },
        // Consuming the divergent-shape booster records the typed gap instead
        // of approximating; the mirrorable berry still mirrors with real
        // executor evidence.
        ItemCampaignAction::Consume {
            owner: holder(1),
            registry_key: "ATTACK_TYPE_BOOSTER".to_owned(),
            preserve: false,
            current_turn: TurnSource::Fixed(1),
        },
        ItemCampaignAction::Consume {
            owner: holder(1),
            registry_key: "BERRY".to_owned(),
            preserve: false,
            current_turn: TurnSource::Fixed(1),
        },
    ];
    let run = item_parity::run_item_campaign(&config("unmirrored", &roster), &actions)?;
    assert_eq!(
        run.steps[0].mirror,
        ExecutorMirror::UnmirroredShape {
            registry_key: "ATTACK_TYPE_BOOSTER".to_owned(),
        }
    );
    assert!(matches!(
        run.steps[2].mirror,
        ExecutorMirror::UnmirroredShape { .. }
    ));
    let ExecutorMirror::Applied { evidence, .. } = &run.steps[3].mirror else {
        panic!("berry consume must mirror");
    };
    // Spending the last stack maps to burn-then-remove: two evidence rows,
    // ending with the entry gone.
    assert_eq!(evidence.len(), 2);
    assert_eq!(evidence[0].charges_before, 1);
    assert_eq!(evidence[0].charges_after, Some(0));
    assert_eq!(evidence[1].operation_ordinal, 1);
    assert_eq!(evidence[1].charges_after, None);

    // The charged booster decremented both counters on the lifecycle root:
    // charges 5 -> 4 while stacks 2 -> 1.
    match run.steps[2].outcome.as_ref().unwrap() {
        ItemStepEvidence::Consume(evidence) => {
            assert_eq!(evidence.stacks_before, 2);
            assert_eq!(evidence.stacks_after, Some(1));
        }
        other => panic!("expected booster consume evidence, got {other:?}"),
    }
    run.final_state.validate()?;
    Ok(())
}
