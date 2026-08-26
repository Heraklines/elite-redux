//! M6D solo-campaign system proof over prepared full content.
//!
//! The host below wires [`er_game::m6::solo_campaign::SoloCampaignHost`] onto
//! the production `GameKernel` battle boundary.  Every command, move, target,
//! switch, and replacement decision flows through raw physical key events;
//! presentations settle through the virtual settlement callback; battles
//! transition through full dispose/reopen cycles; replays must reproduce the
//! canonical trace bytes exactly.

use std::error::Error;
use std::sync::{Arc, LazyLock};

use er_content::m6_catalog::SemanticCatalogV1;
use er_content::pack::m6_pack::{
    BattleContentPackV3, BehaviorClassificationEntryV2, BehaviorClassificationManifestV2,
    BespokeManifestV2, FieldContentV1,
};
use er_content::pack::m6_prepared::prepare_content;
use er_content::pack::selected_content_pack;
use er_content_compiler::m6::{
    SemanticCatalogInput, ValidatedSemanticCatalog, map_routine_catalog,
};
use er_game::m6::solo_campaign::{
    self, SoloBattlePlan, SoloCampaignConfig, SoloCampaignHost, SoloCampaignRun, SoloCombatantPlan,
    SoloContentTable, SoloControlKind, SoloFirstDivergence, SoloObservation,
    first_trace_divergence, plan_solo_campaign, run_solo_campaign,
};
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
    KernelEffect, KernelInput,
};
use er_protocol::{AuthorityLogConfig, BackoffPolicy};
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::format::BattleFormat;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id,
};
use er_types::battle_control::BattleControl;
use er_types::battle_ids::{
    AbilityId, BattleId, BattlePresentationEventId, BattleSide, FieldSlot, GameModeId,
    MoveSlotIndex, PartyIndex, PokemonId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{BattleOutcome, MoveAccuracy, MoveCategory, MovePower, StatusKind};
use er_types::battle_ui::{BattleMenu, BattlePresentationEvent, PresentationSettlementOutcome};
use er_types::mechanics::MechanicsProgramId;
use er_types::{
    BehaviorClassificationKindV2, CatalogHash, ConnectionGeneration, FrameContext,
    LiveResourceSnapshot, M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION, MembershipRevision, OracleSha,
    RawInputEvent, RunId, SafeU53, SeatId, SessionId, TimeClass,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("campaign values are safe")
}

// ---------------------------------------------------------------------------
// Prepared full content
// ---------------------------------------------------------------------------

/// Compiles and prepares the complete frozen M6 semantic catalog exactly once.
///
/// Campaign battles only run after this gate succeeds; the resulting content
/// hash becomes part of the campaign identity recorded in every trace.
static PREPARED_FULL_CONTENT_IDENTITY: LazyLock<Result<String, String>> = LazyLock::new(|| {
    let catalog = SemanticCatalogV1::from_bytes(include_bytes!(
        "../../../fixtures/m6/semantic-catalog-v1.json"
    ))
    .map_err(|error| error.to_string())?;
    let raw_hash =
        CatalogHash::parse(catalog.raw_catalog_hash.clone()).map_err(|e| e.to_string())?;
    let validated = ValidatedSemanticCatalog::new(SemanticCatalogInput::new(catalog, raw_hash))
        .map_err(|error| error.to_string())?;
    let mapped = map_routine_catalog(validated.behavior_units()).map_err(|e| e.to_string())?;
    if mapped.mapped.is_empty() {
        return Err("prepared catalog compiled no routines".to_owned());
    }

    let mut programs = vec![None];
    let mut classifications = Vec::with_capacity(mapped.mapped.len());
    for (index, spec) in mapped.mapped.into_iter().enumerate() {
        let id = MechanicsProgramId::try_from_u64(
            u64::try_from(index).expect("program index fits u64") + 1,
        )
        .map_err(|error| error.to_string())?;
        classifications.push(BehaviorClassificationEntryV2 {
            behavior_unit: spec.behavior_unit.clone(),
            kind: BehaviorClassificationKindV2::Compiled,
            programs: vec![id],
            bespoke: None,
            unsupported_reason: None,
        });
        programs.push(Some(spec.build(id).map_err(|error| error.to_string())?));
    }
    let semantic_hash = validated.semantic_catalog_hash().clone();
    let mut pack = BattleContentPackV3 {
        schema_version: M6_BATTLE_CONTENT_PACK_SCHEMA_VERSION,
        oracle_sha: OracleSha::parse(validated.oracle_sha().to_owned())
            .map_err(|error| error.to_string())?,
        raw_catalog_hash: CatalogHash::parse(validated.raw_catalog_hash().to_owned())
            .map_err(|error| error.to_string())?,
        semantic_catalog_hash: semantic_hash.clone(),
        content_hash: er_types::BattleContentPackHashV3::parse(format!(
            "{}{}",
            er_types::BattleContentPackHashV3::PREFIX,
            "0".repeat(64)
        ))
        .map_err(|error| error.to_string())?,
        species: Vec::new(),
        forms: Vec::new(),
        moves: Vec::new(),
        abilities: Vec::new(),
        held_items: Vec::new(),
        field_content: FieldContentV1::default(),
        programs,
        classifications: BehaviorClassificationManifestV2(classifications),
        bespoke: BespokeManifestV2::default(),
        rng_sites: Vec::new(),
        type_chart: er_content::pack::selected_type_chart(),
    };
    pack.content_hash = pack
        .compute_content_hash()
        .map_err(|error| error.to_string())?;
    // Preparation is the production validation seam: an invalid pack fails
    // here before any campaign may run over it.
    let prepared = prepare_content(pack).map_err(|error| error.to_string())?;
    Ok(format!(
        "{}|{}",
        prepared.content_hash().as_str(),
        semantic_hash.as_str()
    ))
});

fn prepared_full_content() -> TestResult<&'static str> {
    PREPARED_FULL_CONTENT_IDENTITY
        .as_ref()
        .map(|identity| identity.as_str())
        .map_err(|message| message.to_string().into())
}

/// Closed content index table derived from the selected production pack plus
/// the prepared full-content identity.
fn solo_content_table() -> TestResult<SoloContentTable> {
    let content = selected_content_pack()?;
    let offensive_moves: Vec<u32> = content
        .moves
        .iter()
        .enumerate()
        .filter(|(_, definition)| {
            let damaging = matches!(definition.power, MovePower::Value(power) if power >= 20);
            let offensive = !matches!(definition.category, MoveCategory::Status);
            let reliable = matches!(definition.accuracy, MoveAccuracy::AlwaysHits);
            damaging && offensive && reliable
        })
        .map(|(index, _)| u32::try_from(index).expect("move index fits u32"))
        .collect();
    Ok(SoloContentTable {
        content_identity: format!("{}|{}", content.hash, prepared_full_content()?),
        species_count: u32::try_from(content.species.len())?,
        offensive_moves,
    })
}

// ---------------------------------------------------------------------------
// Production kernel host
// ---------------------------------------------------------------------------

struct KernelHost {
    content: Arc<er_content::pack::ContentPack>,
    kernel: Option<GameKernel>,
}

impl KernelHost {
    fn new(content: er_content::pack::ContentPack) -> Self {
        Self {
            content: Arc::new(content),
            kernel: None,
        }
    }

    fn seat(&self) -> SeatId {
        SeatId::new(safe(1))
    }

    fn kernel(&self) -> TestResult<&GameKernel> {
        self.kernel
            .as_ref()
            .ok_or_else(|| "no battle kernel is open".into())
    }

    fn kernel_mut(&mut self) -> TestResult<&mut GameKernel> {
        self.kernel
            .as_mut()
            .ok_or_else(|| "no battle kernel is open".into())
    }

    /// Maps one control variant onto the driver observation surface without
    /// ever exposing a semantic decision path.
    fn observe_screen(&self) -> TestResult<SoloObservation> {
        let projection = self
            .kernel()?
            .battle_ui_projection()
            .ok_or_else(|| "kernel exposed no battle UI projection")?;
        let control = &projection.seat_control.control;
        let (kind, menu, outcome) = match control {
            BattleControl::CommandRoot(value) => {
                (SoloControlKind::CommandRoot, Some(&value.menu), None)
            }
            BattleControl::MoveSelect(value) => {
                (SoloControlKind::MoveSelect, Some(&value.menu), None)
            }
            BattleControl::TargetSelect(value) => {
                (SoloControlKind::TargetSelect, Some(&value.menu), None)
            }
            BattleControl::PartySelect(value) => {
                (SoloControlKind::PartySelect, Some(&value.menu), None)
            }
            BattleControl::PartyOptionSelect(value) => {
                (SoloControlKind::PartyOptionSelect, Some(&value.menu), None)
            }
            BattleControl::ReplacementSelect(value) => {
                (SoloControlKind::ReplacementSelect, Some(&value.menu), None)
            }
            BattleControl::Waiting(_) => (SoloControlKind::Waiting, None, None),
            BattleControl::Complete(outcome) => (SoloControlKind::Complete, None, Some(*outcome)),
        };
        let options = menu.map(visible_option_ids).unwrap_or_default();
        let selected = menu
            .map(|menu| menu.selected_option_id.as_str().to_owned())
            .unwrap_or_default();
        Ok(SoloObservation {
            control: kind,
            options,
            selected,
            turn: projection.turn.get().get(),
            actionable: projection.actionable,
            outcome,
        })
    }

    fn assert_no_compatibility_effects(&self, effects: &[KernelEffect]) -> TestResult<()> {
        for effect in effects {
            if matches!(
                effect,
                KernelEffect::UiChanged { .. }
                    | KernelEffect::UiIntent { .. }
                    | KernelEffect::Present { .. }
                    | KernelEffect::ApplyAuthorityMaterial { .. }
                    | KernelEffect::ProjectAuthorityControl { .. }
            ) {
                return Err(
                    format!("battle mode emitted a compatibility effect: {effect:?}").into(),
                );
            }
        }
        Ok(())
    }

    fn presentation_events(effects: &[KernelEffect]) -> Vec<BattlePresentationEvent> {
        effects
            .iter()
            .filter_map(|effect| match effect {
                KernelEffect::PresentBattle { event, .. } => Some(event.clone()),
                _ => None,
            })
            .collect()
    }

    fn combatant(
        &self,
        plan: &SoloCombatantPlan,
        owner_seat: Option<SeatId>,
    ) -> TestResult<PokemonState> {
        let content = self.content.as_ref();
        let species = content
            .species
            .get(usize::try_from(plan.species_slot)?)
            .ok_or_else(|| "planned species slot is outside selected content")?;
        let move_definition = content
            .moves
            .get(usize::try_from(plan.move_slot)?)
            .ok_or_else(|| "planned move slot is outside selected content")?;
        let profile = plan.profile;
        PokemonState::new(
            PokemonId::new(safe(plan.pokemon_number)),
            owner_seat,
            species.id,
            0,
            profile.level,
            species.base_types,
            BattleStats {
                hp: profile.hp,
                attack: profile.attack,
                defense: profile.defense,
                special_attack: profile.special_attack,
                special_defense: profile.special_defense,
                speed: profile.speed,
            },
            profile.hp,
            profile.hp,
            StatusState {
                kind: StatusKind::None,
                toxic_turn_count: 0,
                sleep_turns_remaining: None,
            },
            StatStages {
                attack: 0,
                defense: 0,
                special_attack: 0,
                special_defense: 0,
                speed: 0,
                accuracy: 0,
                evasion: 0,
            },
            [
                Some(MoveSlotState {
                    move_id: move_definition.id,
                    pp_used: 0,
                    pp_ups: 0,
                    max_pp_override: Some(200),
                }),
                None,
                None,
                None,
            ],
            AbilityLoadout {
                active: AbilityId::ZERO,
                passives: [None, None, None],
                active_suppressed: false,
                passive_suppressed: [false, false, false],
            },
            false,
        )
        .map_err(|error| error.into())
    }

    fn open_battle_plan(&mut self, plan: &SoloBattlePlan) -> TestResult<()> {
        let content = Arc::clone(&self.content);
        let battle_index = u64::from(plan.battle_index) + 1;
        let battle_id = BattleId::new(safe(battle_index));
        let wave = WaveIndex::new(safe(plan.wave_number))?;
        let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)?;

        let enemy_pokemon = PokemonId::new(safe(plan.enemy.pokemon_number));
        let enemy_command = BattleCommand::fight(
            enemy_pokemon,
            MoveSlotIndex::ZERO,
            BattleTargetSelection::implicit(),
        )?;
        let script_count = usize::try_from(plan.scripted_turns)?;
        let mut scripts = Vec::with_capacity(script_count);
        for cursor in 0..plan.scripted_turns {
            let turn = TurnIndex::new(safe(u64::from(cursor) + 1))?;
            let operation = scripted_enemy_command_operation_id(
                battle_id,
                wave,
                turn,
                enemy_slot.clone(),
                safe(u64::from(cursor)),
            )?;
            scripts.push(ScriptedEnemyBattleCommandV1::new(
                operation,
                battle_id,
                wave,
                turn,
                safe(u64::from(cursor)),
                enemy_pokemon,
                enemy_slot.clone(),
                enemy_command.clone(),
            )?);
        }

        let run_state = GameState::new(
            content.hash.clone(),
            GameModeId::new(safe(1)),
            wave,
            battle_id,
            RunRngState {
                rdg: PhaserRdg::from_seed(plan.run_seed.as_str()).state(),
            },
            None,
        )?;

        let mut player_party = Vec::with_capacity(plan.player_party.len());
        for combatant in &plan.player_party {
            player_party.push(self.combatant(combatant, Some(self.seat()))?);
        }
        let enemy_party = vec![self.combatant(&plan.enemy, None)?];

        let config = BattleGameConfig {
            run_state,
            start: BattleStartV1 {
                schema_version: er_game::runtime::BATTLE_START_SCHEMA_VERSION,
                format: BattleFormat::single(),
                player_party,
                enemy_party,
                player_leads: vec![PartyIndex::ZERO],
                enemy_leads: vec![PartyIndex::ZERO],
            },
            local_seat: self.seat(),
            wave_seed: plan.wave_seed.clone(),
            scripted_enemy_policy: ScriptedEnemyPolicyV1::new(SafeU53::ZERO, scripts)?,
        };

        let session_tag = format!("m6d-solo-{battle_index}");
        let context = FrameContext {
            session_id: SessionId::new(format!("{session_tag}-session").as_str())?,
            run_id: RunId::new(format!("{session_tag}-run").as_str())?,
            session_epoch: safe(1),
            seat_map_id: format!("{session_tag}-seat-map"),
            membership_revision: MembershipRevision::new(safe(1)),
            sender_seat_id: self.seat(),
            authority_seat_id: self.seat(),
            connection_generation: ConnectionGeneration::ZERO,
        };
        let protocol = BattleProtocolConfig {
            role: BattleProtocolRoleConfig::Authority {
                log: AuthorityLogConfig {
                    local_context: context,
                    peer_bindings: Vec::new(),
                    owner_id: format!("{session_tag}-authority"),
                    retain_capacity: safe(64),
                    delivery_backoff: BackoffPolicy {
                        initial_ms: safe(250),
                        maximum_ms: safe(5_000),
                        factor_numerator: safe(2),
                        factor_denominator: safe(1),
                    },
                    delivery_time_class: TimeClass::Connected,
                    max_delivery_attempts: None,
                },
                proposal_capacity: safe(64),
            },
        };

        self.kernel = Some(GameKernel::new_battle(config, protocol, content)?);
        Ok(())
    }
}

fn visible_option_ids(menu: &BattleMenu) -> Vec<String> {
    menu.options
        .iter()
        .filter(|option| option.visibility.is_visible())
        .map(|option| option.option_id.as_str().to_owned())
        .collect()
}

impl SoloCampaignHost for KernelHost {
    type Error = String;

    fn open_battle(
        &mut self,
        plan: &SoloBattlePlan,
    ) -> Result<(SoloObservation, Vec<BattlePresentationEvent>), Self::Error> {
        self.open_battle_plan(plan)
            .map_err(|error| error.to_string())?;
        let observation = self.observe_screen().map_err(|error| error.to_string())?;
        Ok((observation, Vec::new()))
    }

    fn deliver_raw_input(
        &mut self,
        event: RawInputEvent,
    ) -> Result<Vec<BattlePresentationEvent>, Self::Error> {
        let seat = self.seat();
        let effects = self
            .kernel_mut()
            .map_err(|error| error.to_string())?
            .step(KernelInput::RawInput { seat, event })
            .map_err(|error| error.to_string())?;
        self.assert_no_compatibility_effects(&effects)
            .map_err(|error| error.to_string())?;
        Ok(Self::presentation_events(&effects))
    }

    fn settle_presentation(
        &mut self,
        event_id: &BattlePresentationEventId,
    ) -> Result<Vec<BattlePresentationEvent>, Self::Error> {
        let seat = self.seat();
        let event_id = event_id.clone();
        let effects = self
            .kernel_mut()
            .map_err(|error| error.to_string())?
            .step(KernelInput::BattlePresentationOutcome {
                endpoint: seat,
                event_id,
                outcome: PresentationSettlementOutcome::Settled,
            })
            .map_err(|error| error.to_string())?;
        self.assert_no_compatibility_effects(&effects)
            .map_err(|error| error.to_string())?;
        Ok(Self::presentation_events(&effects))
    }

    fn observe(&self) -> Result<SoloObservation, Self::Error> {
        self.observe_screen().map_err(|error| error.to_string())
    }

    fn frontier_digest(&self) -> Result<String, Self::Error> {
        let kernel = self.kernel().map_err(|error| error.to_string())?;
        er_canonical::content_digest(&kernel.snapshot().state).map_err(|error| error.to_string())
    }

    fn live_resources(&self) -> Result<LiveResourceSnapshot, Self::Error> {
        Ok(self
            .kernel()
            .map_err(|error| error.to_string())?
            .live_resources())
    }

    fn close_battle(&mut self) -> Result<(), Self::Error> {
        self.kernel_mut()
            .map_err(|error| error.to_string())?
            .dispose("m6d-solo-campaign-close");
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn planning_is_deterministic_and_fails_closed() -> TestResult {
    let table = solo_content_table()?;
    let config = SoloCampaignConfig::new("plan-determinism", 3)?;

    let first = plan_solo_campaign(&config, &table)?;
    let second = plan_solo_campaign(&config, &table)?;
    assert_eq!(
        first, second,
        "identical seeds must produce identical plans"
    );
    assert_eq!(first.battles.len(), 3);
    assert_eq!(first.digest()?, second.digest()?);
    assert!(
        first
            .digest()?
            .starts_with(er_canonical::CONTENT_DIGEST_KIND)
    );

    // Plans differ across seeds but stay structurally valid.
    let other = plan_solo_campaign(&SoloCampaignConfig::new("plan-determinism-2", 3)?, &table)?;
    assert_ne!(first, other);

    let rejected = [
        ("", 3_u32),
        ("x", 0),
        ("x", solo_campaign::SOLO_CAMPAIGN_MAX_BATTLES + 1),
    ];
    for (seed, battles) in rejected {
        assert!(
            SoloCampaignConfig::new(seed, battles).is_err(),
            "configuration ({seed:?}, {battles}) must be rejected"
        );
    }
    let empty_offensive = SoloContentTable {
        content_identity: "identity".to_owned(),
        species_count: 4,
        offensive_moves: Vec::new(),
    };
    assert!(
        plan_solo_campaign(&config, &empty_offensive).is_err(),
        "a content table without offensive moves must fail closed"
    );
    Ok(())
}

#[test]
fn seeded_solo_campaigns_reach_terminal_outcomes_over_prepared_full_content() -> TestResult {
    let table = solo_content_table()?;
    let host_content = selected_content_pack()?;

    let mut outcomes_across_campaigns = Vec::new();
    for seed in ["m6d-solo-alpha", "m6d-solo-bravo", "m6d-solo-charlie"] {
        let config = SoloCampaignConfig::new(seed, 4)?;
        let mut host = KernelHost::new(host_content.clone());
        let run = run_solo_campaign(&mut host, &config, &table)
            .map_err(|error| -> Box<dyn Error> { error.to_string().into() })?;

        assert_eq!(run.report.battles.len(), usize::try_from(config.battles)?);
        assert_eq!(
            run.report.plan_digest,
            plan_solo_campaign(&config, &table)?.digest()?
        );
        assert!(
            run.report
                .content_identity
                .contains(prepared_full_content()?),
            "campaign identity must bind the prepared full-content hash"
        );
        for record in &run.report.battles {
            assert!(
                matches!(
                    record.outcome,
                    BattleOutcome::Victory | BattleOutcome::Defeat
                ),
                "battle {} ended non-terminal: {:?}",
                record.index,
                record.outcome
            );
            assert!(
                record.inputs > 0,
                "battle {} took no physical input",
                record.index
            );
            assert!(
                record.settlements > 0,
                "battle {} settled nothing",
                record.index
            );
            assert!(
                record
                    .final_frontier_digest
                    .starts_with(er_canonical::CONTENT_DIGEST_KIND),
                "battle {} has no canonical frontier digest",
                record.index
            );
            outcomes_across_campaigns.push(record.outcome);
        }
    }

    // Randomized campaigns exercise both terminal directions.
    assert!(
        outcomes_across_campaigns.contains(&BattleOutcome::Victory),
        "no seeded battle reached victory: {outcomes_across_campaigns:?}"
    );
    assert!(
        outcomes_across_campaigns.contains(&BattleOutcome::Defeat),
        "no seeded battle reached defeat: {outcomes_across_campaigns:?}"
    );
    Ok(())
}

#[test]
fn identical_seed_and_trace_replays_byte_identically() -> TestResult {
    let table = solo_content_table()?;
    let config = SoloCampaignConfig::new("m6d-solo-replay", 3)?;

    let mut first_host = KernelHost::new(selected_content_pack()?);
    let first = run_solo_campaign(&mut first_host, &config, &table)
        .map_err(|error| -> Box<dyn Error> { error.to_string().into() })?;

    let mut second_host = KernelHost::new(selected_content_pack()?);
    let second = run_solo_campaign(&mut second_host, &config, &table)
        .map_err(|error| -> Box<dyn Error> { error.to_string().into() })?;

    assert!(
        first_trace_divergence(&first, &second).is_none(),
        "replay diverged from the original campaign trace"
    );
    assert_eq!(
        first.trace_bytes, second.trace_bytes,
        "seeded replay must reproduce the canonical trace bytes"
    );
    assert_eq!(first.report, second.report);

    // First-divergence evidence: a single mutated entry is located exactly.
    let mut tampered_trace = first.trace.clone();
    match &mut tampered_trace[1] {
        solo_campaign::SoloTraceEntry::BattleOpened {
            frontier_digest, ..
        } => {
            frontier_digest.insert_str(0, "f");
        }
        other => panic!("expected BattleOpened trace header, found {other:?}"),
    }
    let tampered_run = SoloCampaignRun {
        report: first.report.clone(),
        trace: tampered_trace,
        trace_bytes: Vec::new(),
    };
    let SoloFirstDivergence {
        entry_index,
        expected,
        actual,
    } = first_trace_divergence(&tampered_run, &first).expect("mutation must be located");
    assert_eq!(entry_index, 1);
    assert_ne!(expected, actual);
    Ok(())
}
