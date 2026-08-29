use std::collections::BTreeSet;
use std::error::Error;

use er_battle::legality::validate_state_content;
use er_canonical::{canonical_bytes, canonicalize};
use er_content::pack::selected_content_pack;
use er_kernel::InputRouter;
use er_protocol::{KernelScheduler, ProposalFingerprintInput, ProposalJson, proposal_fingerprint};
use er_rng::phaser::{F64Bits, PhaserRdg, RunRngState};
use er_state::digest::MechanicalStateDigest;
use er_state::format::{
    canonical_slots, human_seats, owner_seat_for, validate_m3_supported, validate_slot,
};
use er_state::snapshot::{GameState, decode_canonical_game_state};
use er_testkit::m3_fixture::{
    M3_ORACLE_CASE_IDS, M3_REQUIRED_ORACLE_AXES, M3_SUPPORTING_ARTIFACT_IDS, M3CoverageMap,
    M3FixtureError, M3FixtureKind, M3OraclePublicationState, M3OracleReadiness,
    load_m3_fixture_catalog, sha256_hex,
};
use er_types::battle_command::{BattleCommandError, BattleTargetSelection};
use er_types::battle_ids::{
    BattleFormat, BattleId, BattleSide, FieldSlot, GameModeId, PokemonId, WaveIndex,
};
use er_types::{
    ButtonEvent, GameButton, InputFocus, InputMap, JS_MAX_SAFE_INTEGER, KeyBinding, PhysicalKey,
    RawInputEvent, SafeU53, SeatId,
};
use serde_json::{Value, json};

type TestResult = Result<(), Box<dyn Error>>;

#[derive(Clone, Copy, Debug)]
struct DeterministicCorpus(u64);

impl DeterministicCorpus {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0
    }
}

#[test]
fn catalog_state_is_valid_and_never_claims_unbound_evidence() -> TestResult {
    let catalog = load_m3_fixture_catalog()?;

    assert_eq!(
        catalog.coverage_map.oracle_cases.len(),
        M3_ORACLE_CASE_IDS.len()
    );
    assert_eq!(
        catalog.oracle_manifest.required_axes.len(),
        M3_REQUIRED_ORACLE_AXES.len()
    );
    assert_eq!(
        catalog.oracle_manifest.supporting_artifact_contracts.len(),
        M3_SUPPORTING_ARTIFACT_IDS.len()
    );
    match catalog.oracle_manifest.publication_state {
        M3OraclePublicationState::ContractCatalogFrozen => {
            assert_eq!(
                catalog.readiness()?,
                M3OracleReadiness::CatalogOnly {
                    pending_cases: 38,
                    pending_supporting_artifacts: 2,
                }
            );
            assert!(!catalog.is_evidence_published());
            assert!(matches!(
                catalog.load_published_case::<Value>("physical-hit"),
                Err(M3FixtureError::Unpublished {
                    kind: M3FixtureKind::BattleCase,
                    ..
                })
            ));
            assert!(matches!(
                catalog.load_published_supporting_artifact::<Value>("rng-vectors-v1"),
                Err(M3FixtureError::Unpublished {
                    kind: M3FixtureKind::SupportingArtifact,
                    ..
                })
            ));
        }
        M3OraclePublicationState::OracleEvidencePublished => {
            assert_eq!(
                catalog.readiness()?,
                M3OracleReadiness::Published {
                    cases: 38,
                    supporting_artifacts: 2,
                }
            );
            assert!(catalog.is_evidence_published());
            let _: Value = catalog.load_published_case("physical-hit")?;
            let _: Value = catalog.load_published_supporting_artifact("rng-vectors-v1")?;
        }
    }

    assert!(matches!(
        catalog.load_published_case::<Value>("not-a-catalog-case"),
        Err(M3FixtureError::UnknownFixture {
            kind: M3FixtureKind::BattleCase,
            ..
        })
    ));

    let mut wrong_axes = catalog.clone();
    wrong_axes.oracle_manifest.required_axes.swap(0, 1);
    assert!(matches!(
        wrong_axes.validate(),
        Err(M3FixtureError::Contract {
            field: "required_axes",
            ..
        })
    ));

    let mut partial_publication = catalog.clone();
    match partial_publication.oracle_manifest.publication_state {
        M3OraclePublicationState::ContractCatalogFrozen => {
            partial_publication.oracle_manifest.publication_state =
                M3OraclePublicationState::OracleEvidencePublished;
        }
        M3OraclePublicationState::OracleEvidencePublished => {
            partial_publication.oracle_manifest.published_fixtures.pop();
        }
    }
    assert!(matches!(
        partial_publication.validate(),
        Err(M3FixtureError::Contract { .. })
    ));

    let mut coverage_json = serde_json::to_value(&catalog.coverage_map)?;
    if let Value::Object(object) = &mut coverage_json {
        object.insert("future_field".to_owned(), Value::Bool(true));
    }
    assert!(serde_json::from_value::<M3CoverageMap>(coverage_json).is_err());
    Ok(())
}

#[test]
fn dependency_free_sha256_matches_standard_boundary_vectors() {
    assert_eq!(
        sha256_hex(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
}

#[test]
fn safe_ids_exact_bits_and_rng_restore_hold_for_a_deterministic_corpus() -> TestResult {
    for value in [0, 1, JS_MAX_SAFE_INTEGER - 1, JS_MAX_SAFE_INTEGER] {
        let safe = SafeU53::new(value)?;
        let encoded = serde_json::to_string(&safe)?;
        assert_eq!(serde_json::from_str::<SafeU53>(&encoded)?, safe);
    }
    assert!(SafeU53::new(JS_MAX_SAFE_INTEGER + 1).is_err());

    let mut corpus = DeterministicCorpus(0x6d33_6131_325f_7631);
    for index in 0..256_u64 {
        let raw = corpus.next();
        let safe = SafeU53::new(raw & JS_MAX_SAFE_INTEGER)?;
        let pokemon = PokemonId::new(safe);
        assert_eq!(
            serde_json::from_str::<PokemonId>(&serde_json::to_string(&pokemon)?)?,
            pokemon
        );

        let exact_bits = F64Bits::from_bits(corpus.next());
        let encoded_bits = serde_json::to_string(&exact_bits)?;
        let decoded_bits: F64Bits = serde_json::from_str(&encoded_bits)?;
        assert_eq!(decoded_bits.bits(), exact_bits.bits());
        assert_eq!(decoded_bits.as_str().len(), 16);

        let canonical_value = json!({
            "exact_bits": exact_bits.as_str(),
            "safe": safe,
        });
        let canonical = canonicalize(&canonical_value)?;
        let reparsed: Value = serde_json::from_str(&canonical)?;
        assert_eq!(canonicalize(&reparsed)?, canonical);

        let seed = format!("m3-foundation-{index}-{raw:016x}");
        let mut left = PhaserRdg::from_seed(&seed);
        let mut right = PhaserRdg::from_seed(&seed);
        assert_eq!(left.state(), right.state());

        let minimum_value = corpus.next() % 100_000;
        let maximum_value = minimum_value + corpus.next() % 1_000;
        let minimum = SafeU53::new(minimum_value)?;
        let maximum = SafeU53::new(maximum_value)?;
        let left_draw = left.integer_in_range(minimum, maximum)?;
        let right_draw = right.integer_in_range(minimum, maximum)?;
        assert_eq!(left_draw, right_draw);
        assert!((minimum..=maximum).contains(&left_draw));
        assert_eq!(left.state(), right.state());

        let saved = left.state();
        saved.validate()?;
        let mut restored = PhaserRdg::from_state(&saved)?;
        assert_eq!(left.rnd().to_bits(), restored.rnd().to_bits());
        assert_eq!(left.state(), restored.state());
    }
    Ok(())
}

#[test]
fn supported_topologies_close_slots_owners_and_command_target_order() -> TestResult {
    for format in [BattleFormat::single(), BattleFormat::coop_double()] {
        validate_m3_supported(&format)?;
        let slots = canonical_slots(&format)?;
        assert_eq!(
            slots.len(),
            usize::from(format.player_capacity + format.enemy_capacity)
        );
        assert_eq!(
            slots.iter().copied().collect::<BTreeSet<_>>().len(),
            slots.len()
        );

        for slot in &slots {
            validate_slot(&format, *slot)?;
            let owner = owner_seat_for(&format, *slot)?;
            match slot.side {
                BattleSide::Player => {
                    let expected = u64::from(slot.position) + 1;
                    assert_eq!(owner.map(|seat| seat.get().get()), Some(expected));
                }
                BattleSide::Enemy => assert_eq!(owner, None),
            }
        }
        assert_eq!(
            human_seats(&format)?.len(),
            usize::from(format.player_capacity)
        );

        let mut reversed_edges = format.adjacency.clone();
        reversed_edges.reverse();
        let rebuilt = BattleFormat::new(
            format.player_capacity,
            format.enemy_capacity,
            reversed_edges,
        )?;
        assert_eq!(rebuilt, format);
        assert_eq!(
            serde_json::from_str::<BattleFormat>(&serde_json::to_string(&format)?)?,
            format
        );

        let selection = BattleTargetSelection::selected(slots.clone())?;
        assert_eq!(selection.selected_targets(), Some(slots.as_slice()));
        let mut reversed_slots = slots;
        reversed_slots.reverse();
        assert!(matches!(
            BattleTargetSelection::selected(reversed_slots),
            Err(BattleCommandError::UnsortedTargetSelection)
        ));

        for position in 0..=2 {
            let player = FieldSlot::new(BattleSide::Player, position)?;
            assert_eq!(
                validate_slot(&format, player).is_ok(),
                position < format.player_capacity
            );
            let enemy = FieldSlot::new(BattleSide::Enemy, position)?;
            assert_eq!(
                validate_slot(&format, enemy).is_ok(),
                position < format.enemy_capacity
            );
        }
    }

    let representable_triple = BattleFormat::new(3, 3, Vec::new())?;
    assert!(validate_m3_supported(&representable_triple).is_err());
    Ok(())
}

#[test]
fn content_state_and_battle_validation_are_reproducible_across_seeds() -> TestResult {
    let content = selected_content_pack()?;
    content.validate()?;
    assert_eq!(content.recompute_hash()?, content.hash);
    assert_eq!(selected_content_pack()?.hash, content.hash);

    let mut corpus = DeterministicCorpus(0x7265_6475_785f_6d33);
    for index in 1..=64_u64 {
        let seed = format!("m3-state-{index}-{:016x}", corpus.next());
        let run_rng = RunRngState {
            rdg: PhaserRdg::from_seed(&seed).state(),
        };
        let wave = WaveIndex::try_from_u64(index)?;
        let state = GameState::new(
            content.hash.clone(),
            GameModeId::new(SafeU53::new(index % 4)?),
            wave,
            BattleId::try_from_u64(index + 1)?,
            run_rng,
            None,
        )?;

        validate_state_content(&state, &content)?;
        let encoded = state.canonical_bytes()?;
        assert_eq!(encoded, canonical_bytes(&state)?);
        assert_eq!(decode_canonical_game_state(&encoded)?, state);
        assert_eq!(
            MechanicalStateDigest::compute(&state)?,
            MechanicalStateDigest::compute(&state)?
        );
    }
    Ok(())
}

#[test]
fn kernel_input_and_protocol_fingerprints_are_deterministic_without_fuzz_crates() -> TestResult {
    let repeat = SafeU53::new(17)?;
    let map = InputMap {
        keyboard: vec![
            KeyBinding {
                key: PhysicalKey::ArrowUp,
                button: GameButton::Up,
            },
            KeyBinding {
                key: PhysicalKey::Enter,
                button: GameButton::Submit,
            },
            KeyBinding {
                key: PhysicalKey::Escape,
                button: GameButton::Cancel,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: repeat,
        repeat_interval_ms: repeat,
    };
    let mut left_router = InputRouter::new(map.clone());
    let mut right_router = InputRouter::new(map);
    let mut left_scheduler = KernelScheduler::new();
    let mut right_scheduler = KernelScheduler::new();
    let seat = SeatId::new(SafeU53::new(1)?);

    let events = [
        RawInputEvent::KeyDown {
            code: PhysicalKey::ArrowUp,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp {
            code: PhysicalKey::ArrowUp,
        },
        RawInputEvent::KeyDown {
            code: PhysicalKey::Enter,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp {
            code: PhysicalKey::Enter,
        },
        RawInputEvent::WindowBlurred,
        RawInputEvent::WindowFocused,
    ];
    let mut observed = Vec::new();
    for event in events {
        let left = left_router.handle(seat, event.clone(), &mut left_scheduler)?;
        let right = right_router.handle(seat, event, &mut right_scheduler)?;
        assert_eq!(left, right);
        observed.extend(left.events);
    }
    assert_eq!(
        observed,
        vec![
            ButtonEvent::Pressed(GameButton::Up),
            ButtonEvent::Released(GameButton::Up),
            ButtonEvent::Pressed(GameButton::Submit),
            ButtonEvent::Released(GameButton::Submit),
        ]
    );
    assert_eq!(left_scheduler.pending_timer_count(), SafeU53::ZERO);
    assert_eq!(right_scheduler.pending_timer_count(), SafeU53::ZERO);

    let mut corpus = DeterministicCorpus(0x7072_6f74_6f63_6f6c);
    for index in 0..128_u64 {
        let value = corpus.next() & ((1_u64 << 40) - 1);
        let outcome = ProposalJson::new(format!("{{\"index\":{index},\"value\":{value}}}"))?;
        let input = ProposalFingerprintInput::Bargain {
            sequence: SafeU53::new(value)?,
            outcome,
        };
        let first = proposal_fingerprint(&input)?;
        let second = proposal_fingerprint(&input)?;
        assert_eq!(first, second);
        assert!(first.starts_with('[') && first.ends_with(']'));
    }
    Ok(())
}
