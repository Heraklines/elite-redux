use std::error::Error;
use std::fs;
use std::path::PathBuf;

use er_rng::audit::{
    RngCallsiteId, RngDraw, RngPublicApi, RngReason, RngStream, rng_state_fingerprint,
};
use er_rng::battle::{BattleRngState, RngRuntime};
use er_rng::phaser::{F64Bits, PhaserRdg, PhaserRdgState, RngError, RunRngState, shift_char_codes};
use er_types::SafeU53;
use er_types::battle_ids::{TurnIndex, WaveIndex};
use serde_json::Value;

fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
    Ok(SafeU53::new(value)?)
}

fn turn(value: u64) -> Result<TurnIndex, Box<dyn Error>> {
    Ok(TurnIndex::new(safe(value)?)?)
}

fn runtime_with_battle() -> Result<RngRuntime, Box<dyn Error>> {
    let run = RunRngState {
        rdg: PhaserRdg::from_seed("run-seed").state(),
    };
    let battle = BattleRngState::new("BattleSeed012345", turn(1)?);
    Ok(RngRuntime::from_states(run, Some(battle))?)
}

#[test]
fn primitive_transition_and_integer_have_exact_golden_bits() -> Result<(), Box<dyn Error>> {
    let initial = PhaserRdgState::from_values(1, 0.25, 0.5, 0.75)?;
    let mut primitive = PhaserRdg::from_state(&initial)?;
    let result = primitive.rnd();

    assert_eq!(result.to_bits(), 0x3fe8_0000_0020_0000);
    assert_eq!(
        primitive.state(),
        PhaserRdgState {
            state_string: "!rnd,522909,0.5,0.75,0.7500000002328306".to_owned(),
            s0_bits: F64Bits::from_bits(0x3fe0_0000_0000_0000),
            s1_bits: F64Bits::from_bits(0x3fe8_0000_0000_0000),
            s2_bits: F64Bits::from_bits(0x3fe8_0000_0020_0000),
            carry: 522_909,
        }
    );

    let mut integer = PhaserRdg::from_state(&initial)?;
    assert_eq!(integer.integer().to_bits(), 3_221_225_473_f64.to_bits());
    assert_eq!(integer.state(), primitive.state());
    Ok(())
}

#[test]
fn frac_uses_the_corrected_0x200000_coercion_term() -> Result<(), Box<dyn Error>> {
    let initial = PhaserRdgState::from_values(0, 0.0, 0.25, 0.5)?;
    let mut generator = PhaserRdg::from_state(&initial)?;
    let fraction = generator.frac();

    assert_eq!(fraction.to_bits(), 0x3de8_0000_0000_0000);
    assert_eq!(generator.state().state_string, "!rnd,522909,0.5,0,0.75");

    let stale_0x200_term: f64 = 384.0 * 1.110_223_024_625_156_5e-16;
    assert_ne!(fraction.to_bits(), stale_0x200_term.to_bits());
    Ok(())
}

#[test]
fn integer_preserves_fractional_binary64_instead_of_coercing_to_uint() -> Result<(), Box<dyn Error>>
{
    let adversarial_s0 = f64::from_bits(0x3c90_0000_0000_0000);
    let initial = PhaserRdgState::from_values(0, adversarial_s0, 0.0, 0.0)?;
    let mut generator = PhaserRdg::from_state(&initial)?;
    let result = generator.integer();

    assert_eq!(result * 4_194_304.0, 2_091_639.0);
    assert_ne!(result.fract(), 0.0);
    assert_ne!(result.to_bits(), 0.0_f64.to_bits());

    let mut exact_u32 = PhaserRdg::from_state(&initial)?;
    let before = exact_u32.state();
    assert!(matches!(
        exact_u32.integer_u32_exact(),
        Err(RngError::IntegerNotExactU32 { .. })
    ));
    assert_eq!(exact_u32.state(), before);
    Ok(())
}

#[test]
fn state_strings_and_json_preserve_full_width_bits() -> Result<(), Box<dyn Error>> {
    let state = PhaserRdgState::from_values(1, f64::from_bits(0x3df0_0000_0000_0000), 0.0, 0.75)?;
    assert_eq!(state.state_string, "!rnd,1,2.3283064365386963e-10,0,0.75");
    assert_eq!(state.s0_bits.as_str(), "3df0000000000000");
    assert_eq!(state.s1_bits.as_str(), "0000000000000000");
    assert_eq!(state.s2_bits.as_str(), "3fe8000000000000");

    let json = serde_json::to_string(&state)?;
    assert_eq!(
        json,
        r#"{"state_string":"!rnd,1,2.3283064365386963e-10,0,0.75","s0_bits":"3df0000000000000","s1_bits":"0000000000000000","s2_bits":"3fe8000000000000","carry":1}"#
    );
    assert_eq!(serde_json::from_str::<PhaserRdgState>(&json)?, state);
    assert_eq!(
        PhaserRdgState::from_state_string(&state.state_string)?,
        state
    );

    let threshold = PhaserRdgState::from_values(0, 0.000_001, 0.000_000_1, 0.0)?;
    assert_eq!(threshold.state_string, "!rnd,0,0.000001,1e-7,0");
    Ok(())
}

#[test]
fn state_boundaries_reject_noncanonical_or_poisoned_forms() {
    for state in [
        "rnd,1,0,0,0",
        "!rnd,1,0,0",
        "!rnd,1,0,0,0,0",
        "!rnd,01,0,0,0",
        "!rnd,1,0.0,0,0",
        "!rnd,1,-0,0,0",
        "!rnd,1,NaN,0,0",
        "!rnd,1,Infinity,0,0",
        "!rnd,1,1,0,0",
        "!rnd,1,0,0,0junk",
    ] {
        assert!(
            PhaserRdgState::from_state_string(state).is_err(),
            "accepted {state}"
        );
    }

    for bits in ["0", "000000000000000G", "3FF0000000000000"] {
        let json = format!(r#""{bits}""#);
        assert!(serde_json::from_str::<F64Bits>(&json).is_err());
    }

    let mismatched = r#"{
        "state_string":"!rnd,1,0.5,0,0",
        "s0_bits":"0000000000000000",
        "s1_bits":"0000000000000000",
        "s2_bits":"0000000000000000",
        "carry":1
    }"#;
    assert!(serde_json::from_str::<PhaserRdgState>(mismatched).is_err());

    let nan_bits = r#"{
        "state_string":"!rnd,1,NaN,0,0",
        "s0_bits":"7ff8000000000000",
        "s1_bits":"0000000000000000",
        "s2_bits":"0000000000000000",
        "carry":1
    }"#;
    assert!(serde_json::from_str::<PhaserRdgState>(nan_bits).is_err());

    let unknown_field = r#"{
        "state_string":"!rnd,1,0,0,0",
        "s0_bits":"0000000000000000",
        "s1_bits":"0000000000000000",
        "s2_bits":"0000000000000000",
        "carry":1,
        "n":0
    }"#;
    assert!(serde_json::from_str::<PhaserRdgState>(unknown_field).is_err());
}

#[test]
fn sow_is_deterministic_and_uses_utf16_code_units() -> Result<(), Box<dyn Error>> {
    let first = PhaserRdg::from_seed("PokéRogue/🙂");
    let second = PhaserRdg::from_seed("PokéRogue/🙂");
    assert_eq!(first.state(), second.state());

    let shifted = shift_char_codes("🙂", 1)?;
    assert_eq!(shifted, "🩃");
    assert_ne!(shifted, "🙃");
    assert!(matches!(
        shift_char_codes("A", 0xd7bf),
        Err(RngError::UnpairedShiftedSurrogate)
    ));
    Ok(())
}

#[test]
fn consuming_and_nonconsuming_raw_range_paths_are_distinct() -> Result<(), Box<dyn Error>> {
    let mut generator = PhaserRdg::from_seed("range-semantics");
    let initial = generator.state();
    assert_eq!(generator.rand_seed_int(safe(0)?, safe(85)?)?, safe(85)?);
    assert_eq!(generator.state(), initial);
    assert_eq!(generator.rand_seed_int(safe(1)?, safe(85)?)?, safe(85)?);
    assert_eq!(generator.state(), initial);

    assert_eq!(generator.integer_in_range(safe(85)?, safe(85)?)?, safe(85)?);
    assert_ne!(generator.state(), initial);
    Ok(())
}

#[test]
fn real_range_overflow_discards_its_staged_draws() -> Result<(), Box<dyn Error>> {
    let near_one_source = f64::from_bits(0x3ea0_0acb_c3f0_f500);
    let state = PhaserRdgState::from_values(0, near_one_source, near_one_source, 0.0)?;
    let mut generator = PhaserRdg::from_state(&state)?;
    let before = generator.state();

    assert!(matches!(
        generator.real_in_range(0.0, f64::MAX),
        Err(RngError::RangeOverflow)
    ));
    assert_eq!(generator.state(), before);
    Ok(())
}

#[test]
fn integer_range_rejects_width_above_safe_u53_before_drawing() -> Result<(), Box<dyn Error>> {
    let mut rejected = PhaserRdg::from_seed("range-width-overflow");
    let rejected_before = rejected.state();
    assert!(matches!(
        rejected.integer_in_range(SafeU53::ZERO, SafeU53::MAX),
        Err(RngError::RangeOverflow)
    ));
    assert_eq!(rejected.state(), rejected_before);

    let maximum_accepted = safe(SafeU53::MAX.get() - 1)?;
    let mut accepted = PhaserRdg::from_seed("range-width-boundary");
    let accepted_before = accepted.state();
    let result = accepted.integer_in_range(SafeU53::ZERO, maximum_accepted)?;
    assert!(result <= maximum_accepted);
    assert_ne!(accepted.state(), accepted_before);
    Ok(())
}

#[test]
fn pick_and_shuffle_apply_the_selected_slice_draw_rules() -> Result<(), Box<dyn Error>> {
    let mut generator = PhaserRdg::from_seed("pick-shuffle");
    let initial = generator.state();
    assert!(matches!(generator.pick_index(0), Err(RngError::EmptyPick)));
    assert_eq!(generator.state(), initial);
    assert_eq!(generator.pick(&["only"])?, &"only");
    assert_eq!(generator.state(), initial);

    let mut left = PhaserRdg::from_seed("shuffle");
    let mut right = PhaserRdg::from_seed("shuffle");
    let mut left_values = vec![0, 1, 2, 3, 4];
    let mut right_values = left_values.clone();
    left.shuffle(&mut left_values)?;
    right.shuffle(&mut right_values)?;
    assert_eq!(left_values, right_values);
    assert_eq!(left.state(), right.state());
    Ok(())
}

#[test]
fn battle_draw_advances_only_the_cached_substream() -> Result<(), Box<dyn Error>> {
    let mut runtime = runtime_with_battle()?;
    let run_before = runtime.run_state();
    let result = runtime.battle_rand_seed_int(
        safe(16)?,
        safe(85)?,
        RngReason::DamageVariance,
        RngCallsiteId::damage_variance(),
    )?;

    assert!((85..=100).contains(&result.get()));
    assert_eq!(runtime.run_state(), run_before);
    assert!(
        runtime
            .battle_state()
            .and_then(|battle| battle.saved_substream.as_ref())
            .is_some()
    );
    assert_eq!(runtime.audit_entries().len(), 1);

    let draw = &runtime.audit_entries()[0];
    assert_eq!(draw.sequence, SafeU53::ZERO);
    assert_eq!(draw.stream, RngStream::Battle);
    assert_eq!(draw.reason, RngReason::DamageVariance);
    assert_eq!(draw.public_api, RngPublicApi::RandSeedInt);
    assert_eq!(draw.minimum, safe(85)?);
    assert_eq!(draw.cardinality, safe(16)?);
    assert!(draw.consumed);
    assert_eq!(draw.primitive_draw_count, 2);
    assert_eq!(draw.before_state.run, draw.after_state.run);
    assert_ne!(draw.before_state.battle, draw.after_state.battle);
    draw.validate()?;
    Ok(())
}

#[test]
fn battle_cache_resumes_then_increment_turn_resows() -> Result<(), Box<dyn Error>> {
    let mut runtime = runtime_with_battle()?;
    let _ = runtime.battle_rand_seed_int(
        safe(100)?,
        SafeU53::ZERO,
        RngReason::Accuracy,
        RngCallsiteId::accuracy(),
    )?;
    let first_saved = runtime
        .battle_state()
        .and_then(|battle| battle.saved_substream.clone());
    let _ = runtime.battle_rand_seed_int(
        safe(24)?,
        SafeU53::ZERO,
        RngReason::CriticalHit,
        RngCallsiteId::critical_hit(),
    )?;
    assert_eq!(
        runtime.audit_entries()[1]
            .before_state
            .battle
            .as_ref()
            .and_then(|battle| battle.saved_substream.clone()),
        first_saved
    );

    runtime.increment_turn()?;
    let turn_two = runtime
        .battle_state()
        .ok_or("battle missing after turn increment")?
        .clone();
    assert_eq!(turn_two.turn, turn(2)?);
    assert!(turn_two.saved_substream.is_none());

    let run = runtime.run_state();
    let mut fresh = RngRuntime::from_states(run, Some(turn_two))?;
    let resumed = runtime.battle_rand_seed_int(
        safe(4)?,
        SafeU53::ZERO,
        RngReason::ParalysisActivation,
        RngCallsiteId::paralysis_activation(),
    )?;
    let expected = fresh.battle_rand_seed_int(
        safe(4)?,
        SafeU53::ZERO,
        RngReason::ParalysisActivation,
        RngCallsiteId::paralysis_activation(),
    )?;
    assert_eq!(resumed, expected);
    assert_eq!(runtime.battle_state(), fresh.battle_state());
    Ok(())
}

#[test]
fn wrapper_fast_paths_audit_without_swapping_or_drawing() -> Result<(), Box<dyn Error>> {
    let mut runtime = runtime_with_battle()?;
    let before = runtime.clone();

    for cardinality in [0, 1] {
        let result = runtime.pokemon_rand_battle_seed_int(
            safe(cardinality)?,
            safe(7)?,
            RngReason::Accuracy,
            RngCallsiteId::accuracy(),
        )?;
        assert_eq!(result, safe(7)?);
    }

    assert_eq!(runtime.run_state(), before.run_state());
    assert_eq!(runtime.battle_state(), before.battle_state());
    assert_eq!(runtime.audit_entries().len(), 2);
    for (index, draw) in runtime.audit_entries().iter().enumerate() {
        assert_eq!(draw.sequence, safe(u64::try_from(index)?)?);
        assert!(!draw.consumed);
        assert_eq!(draw.primitive_draw_count, 0);
        assert_eq!(draw.before_state, draw.after_state);
        assert_eq!(draw.before_fingerprint, draw.after_fingerprint);
    }

    let _ = runtime.battle_integer_in_range(
        safe(7)?,
        safe(7)?,
        RngReason::Accuracy,
        RngCallsiteId::accuracy(),
    )?;
    let direct = &runtime.audit_entries()[2];
    assert!(direct.consumed);
    assert_eq!(direct.primitive_draw_count, 2);
    assert_eq!(direct.public_api, RngPublicApi::IntegerInRange);

    let before_singleton_shuffle = runtime.clone();
    let mut singleton = ["only"];
    runtime.speed_order_shuffle(&mut singleton, "wave", turn(1)?)?;
    assert_eq!(runtime, before_singleton_shuffle);
    assert_eq!(singleton, ["only"]);
    Ok(())
}

#[test]
fn pick_is_one_logical_audit_and_empty_pick_is_atomic() -> Result<(), Box<dyn Error>> {
    let mut runtime = runtime_with_battle()?;
    let before = runtime.clone();
    assert!(matches!(
        runtime.battle_pick_index(0, RngReason::Accuracy, RngCallsiteId::accuracy(),),
        Err(RngError::EmptyPick)
    ));
    assert_eq!(runtime, before);

    assert_eq!(
        runtime.battle_pick(&["only"], RngReason::Accuracy, RngCallsiteId::accuracy(),)?,
        &"only"
    );
    assert_eq!(runtime.audit_entries().len(), 1);
    let draw = &runtime.audit_entries()[0];
    assert_eq!(draw.public_api, RngPublicApi::Pick);
    assert_eq!(draw.result, SafeU53::ZERO);
    assert!(!draw.consumed);

    let values = [10, 20, 30];
    let selected = runtime.battle_pick(&values, RngReason::Accuracy, RngCallsiteId::accuracy())?;
    assert!(values.contains(selected));
    assert_eq!(runtime.audit_entries().len(), 2);
    assert_eq!(runtime.audit_entries()[1].public_api, RngPublicApi::Pick);
    assert!(runtime.audit_entries()[1].consumed);
    Ok(())
}

#[test]
fn nested_scene_and_pokemon_wrappers_emit_one_logical_entry() -> Result<(), Box<dyn Error>> {
    let mut runtime = runtime_with_battle()?;
    let _ = runtime.pokemon_rand_battle_seed_int(
        safe(100)?,
        SafeU53::ZERO,
        RngReason::Accuracy,
        RngCallsiteId::accuracy(),
    )?;
    assert_eq!(runtime.audit_entries().len(), 1);
    assert_eq!(runtime.next_audit_sequence(), Some(safe(1)?));
    Ok(())
}

#[test]
fn one_sequence_is_monotonic_across_offset_and_battle_streams() -> Result<(), Box<dyn Error>> {
    let mut runtime = RngRuntime::from_run_seed("sequence-run");
    let _ = runtime.initialize_battle("sequence-wave", WaveIndex::new(safe(1)?)?)?;
    let _ = runtime.battle_rand_seed_int(
        safe(100)?,
        SafeU53::ZERO,
        RngReason::Accuracy,
        RngCallsiteId::accuracy(),
    )?;
    let mut values = [0, 1];
    runtime.speed_order_shuffle(&mut values, "sequence-wave", turn(1)?)?;

    assert_eq!(runtime.audit_entries().len(), 18);
    for (index, draw) in runtime.audit_entries().iter().enumerate() {
        assert_eq!(draw.sequence, safe(u64::try_from(index)?)?);
    }
    assert_eq!(runtime.audit_entries()[16].stream, RngStream::Battle);
    assert_eq!(runtime.audit_entries()[17].stream, RngStream::SeedOffset);
    assert_eq!(runtime.next_audit_sequence(), Some(safe(18)?));
    Ok(())
}

#[test]
fn speed_offset_shuffle_restores_run_and_context_with_per_swap_audits() -> Result<(), Box<dyn Error>>
{
    let mut first = runtime_with_battle()?;
    let mut second = runtime_with_battle()?;
    let run_before = first.run_state();
    let battle_before = first.battle_state().cloned();
    let mut first_values = vec!["a", "b", "c", "d"];
    let mut second_values = first_values.clone();

    first.speed_order_shuffle(&mut first_values, "wave-seed", turn(1)?)?;
    second.speed_order_shuffle(&mut second_values, "wave-seed", turn(1)?)?;

    assert_eq!(first_values, second_values);
    assert_eq!(first.run_state(), run_before);
    assert_eq!(first.battle_state().cloned(), battle_before);
    assert!(first.seed_offset_context().is_none());
    assert!(first.seed_override().is_none());
    assert_eq!(first.audit_entries(), second.audit_entries());
    assert_eq!(first.audit_entries().len(), 3);

    for (index, draw) in first.audit_entries().iter().enumerate() {
        assert_eq!(draw.sequence, safe(u64::try_from(index)?)?);
        assert_eq!(draw.stream, RngStream::SeedOffset);
        assert_eq!(draw.reason, RngReason::SpeedTie);
        assert_eq!(draw.public_api, RngPublicApi::FisherYatesSwap);
        assert_eq!(draw.primitive_draw_count, 2);
        let context = draw
            .before_state
            .seed_offset
            .as_ref()
            .ok_or("missing before offset context")?;
        assert_eq!(context.wave_seed, "wave-seed");
        assert_eq!(context.offset, safe(1_004)?);
        assert_eq!(draw.before_state.seed_offset, draw.after_state.seed_offset);
    }
    Ok(())
}

#[test]
fn battle_construction_uses_wave_offset_and_sixteen_closed_character_draws()
-> Result<(), Box<dyn Error>> {
    let mut first = RngRuntime::from_run_seed("ambient-run");
    let mut second = RngRuntime::from_run_seed("ambient-run");
    let run_before = first.run_state();
    let battle = first.initialize_battle("wave-one", WaveIndex::new(safe(1)?)?)?;
    let duplicate = second.initialize_battle("wave-one", WaveIndex::new(safe(1)?)?)?;

    assert_eq!(battle, duplicate);
    assert_eq!(battle.turn, turn(1)?);
    assert_eq!(battle.battle_seed.len(), 16);
    assert!(
        battle
            .battle_seed
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric())
    );
    assert!(battle.saved_substream.is_none());
    assert_eq!(first.run_state(), run_before);
    assert_eq!(first.battle_state(), Some(&battle));
    assert_eq!(first.audit_entries().len(), 16);
    assert_eq!(first.audit_entries(), second.audit_entries());

    for (index, draw) in first.audit_entries().iter().enumerate() {
        assert_eq!(draw.sequence, safe(u64::try_from(index)?)?);
        assert_eq!(draw.stream, RngStream::SeedOffset);
        assert_eq!(draw.reason, RngReason::BattleSeedCharacter);
        assert_eq!(draw.public_api, RngPublicApi::RandSeedInt);
        assert_eq!(draw.cardinality, safe(62)?);
        assert!(draw.consumed);
        assert_eq!(draw.primitive_draw_count, 2);
        assert!(draw.before_state.battle.is_none());
        assert!(draw.after_state.battle.is_none());
        assert_eq!(
            draw.before_state
                .seed_offset
                .as_ref()
                .ok_or("missing construction offset")?
                .offset,
            safe(8)?
        );
    }
    Ok(())
}

#[test]
fn callsite_and_shift_failures_leave_runtime_and_audit_unchanged() -> Result<(), Box<dyn Error>> {
    let mut runtime = runtime_with_battle()?;
    let before = runtime.clone();
    assert!(matches!(
        runtime.battle_rand_seed_int(
            safe(24)?,
            SafeU53::ZERO,
            RngReason::CriticalHit,
            RngCallsiteId::accuracy(),
        ),
        Err(RngError::CallsiteReasonMismatch { .. })
    ));
    assert_eq!(runtime, before);

    let run = RunRngState {
        rdg: PhaserRdg::from_seed("run").state(),
    };
    let surrogate_battle = BattleRngState::new("ퟀ", turn(1)?);
    let mut malformed = RngRuntime::from_states(run, Some(surrogate_battle))?;
    let malformed_before = malformed.clone();
    assert!(matches!(
        malformed.battle_rand_seed_int(
            safe(100)?,
            SafeU53::ZERO,
            RngReason::Accuracy,
            RngCallsiteId::accuracy(),
        ),
        Err(RngError::UnpairedShiftedSurrogate)
    ));
    assert_eq!(malformed, malformed_before);
    Ok(())
}

#[test]
fn range_turn_and_offset_rejections_are_atomic() -> Result<(), Box<dyn Error>> {
    let mut generator = PhaserRdg::from_seed("atomic-range");
    let generator_before = generator.state();
    assert!(matches!(
        generator.integer_in_range(safe(2)?, safe(1)?),
        Err(RngError::InvalidRange { .. })
    ));
    assert!(matches!(
        generator.rand_seed_int(SafeU53::MAX, safe(2)?),
        Err(RngError::RangeOverflow)
    ));
    assert_eq!(generator.state(), generator_before);

    let mut wrong_stream = runtime_with_battle()?;
    let wrong_stream_before = wrong_stream.clone();
    assert!(matches!(
        wrong_stream.run_rand_seed_int(
            safe(100)?,
            SafeU53::ZERO,
            RngReason::Accuracy,
            RngCallsiteId::accuracy(),
        ),
        Err(RngError::ReasonStreamMismatch { .. })
    ));
    assert_eq!(wrong_stream, wrong_stream_before);

    let mut missing_battle = RngRuntime::from_run_seed("missing-battle");
    let missing_before = missing_battle.clone();
    assert!(matches!(
        missing_battle.battle_rand_seed_int(
            safe(1)?,
            SafeU53::ZERO,
            RngReason::Accuracy,
            RngCallsiteId::accuracy(),
        ),
        Err(RngError::MissingBattleState)
    ));
    assert_eq!(missing_battle, missing_before);

    let mut final_turn = BattleRngState::new("battle", turn(SafeU53::MAX.get())?);
    let final_turn_before = final_turn.clone();
    assert!(matches!(
        final_turn.increment_turn(),
        Err(RngError::TurnOverflow)
    ));
    assert_eq!(final_turn, final_turn_before);

    let mut construction = RngRuntime::from_run_seed("construction");
    let construction_before = construction.clone();
    let negative_shift_wave = WaveIndex::new(safe(1_u64 << 28)?)?;
    assert!(matches!(
        construction.initialize_battle("wave", negative_shift_wave),
        Err(RngError::UnsafeSeedOffset)
    ));
    assert_eq!(construction, construction_before);

    let mut offset_runtime = runtime_with_battle()?;
    let offset_before = offset_runtime.clone();
    let mut values = [0, 1];
    assert!(matches!(
        offset_runtime.speed_order_shuffle(&mut values, "wave", turn(SafeU53::MAX.get())?,),
        Err(RngError::UnsafeSeedOffset)
    ));
    assert_eq!(offset_runtime, offset_before);
    assert_eq!(values, [0, 1]);
    Ok(())
}

#[test]
fn exhausted_sequence_rolls_back_an_entire_multi_draw_shuffle() -> Result<(), Box<dyn Error>> {
    let baseline = runtime_with_battle()?;
    let run = baseline.run_state();
    let battle = baseline.battle_state().cloned();
    let mut runtime =
        RngRuntime::from_states_at_sequence(run, battle, safe(SafeU53::MAX.get() - 1)?)?;
    let before = runtime.clone();
    let mut values = vec![0, 1, 2, 3];
    let values_before = values.clone();

    assert!(matches!(
        runtime.speed_order_shuffle(&mut values, "wave", turn(1)?),
        Err(RngError::AuditSequenceExhausted)
    ));
    assert_eq!(runtime, before);
    assert_eq!(values, values_before);
    Ok(())
}

#[test]
fn audit_fingerprints_recompute_and_tampering_is_rejected() -> Result<(), Box<dyn Error>> {
    let mut runtime = runtime_with_battle()?;
    let _ = runtime.battle_rand_seed_int(
        safe(100)?,
        SafeU53::ZERO,
        RngReason::Accuracy,
        RngCallsiteId::accuracy(),
    )?;
    let draw = &runtime.audit_entries()[0];
    assert_eq!(
        draw.before_fingerprint,
        rng_state_fingerprint(&draw.before_state)?
    );
    assert_eq!(
        draw.after_fingerprint,
        rng_state_fingerprint(&draw.after_state)?
    );
    assert_eq!(draw.before_fingerprint.len(), 64);
    assert_eq!(draw.after_fingerprint.len(), 64);

    let mut encoded = serde_json::to_value(draw)?;
    let object = encoded
        .as_object_mut()
        .ok_or("serialized audit was not an object")?;
    object.insert(
        "after_fingerprint".to_owned(),
        Value::String("0".repeat(64)),
    );
    assert!(serde_json::from_value::<RngDraw>(encoded).is_err());
    Ok(())
}

#[test]
fn callsite_identity_is_closed_and_pinned() -> Result<(), Box<dyn Error>> {
    assert_eq!(
        RngCallsiteId::oracle_sha(),
        "3b534099919efae827019d4a3f3c4ab0ecd6d67b"
    );
    assert!(matches!(
        RngCallsiteId::new("src/field/pokemon.ts:5880"),
        Err(RngError::UnknownCallsite { .. })
    ));
    assert!(serde_json::from_str::<RngCallsiteId>(r#""arbitrary""#).is_err());
    assert_eq!(
        serde_json::to_string(&RngCallsiteId::critical_hit())?,
        r#""3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/field/pokemon.ts:5880""#
    );
    Ok(())
}

#[test]
fn eventual_rng_vectors_are_ingested_only_after_manifest_publication() -> Result<(), Box<dyn Error>>
{
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let manifest_path = repository.join("rust/fixtures/m3/m3-oracle-manifest.json");
    let manifest: Value = serde_json::from_str(&fs::read_to_string(manifest_path)?)?;
    let contracts = manifest
        .get("supporting_artifact_contracts")
        .and_then(Value::as_array)
        .ok_or("missing supporting artifact contracts")?;
    let rng_contract = contracts
        .iter()
        .find(|entry| entry.get("artifact_id").and_then(Value::as_str) == Some("rng-vectors-v1"))
        .ok_or("missing rng-vectors-v1 contract")?;
    assert_eq!(
        rng_contract.get("fixture_path").and_then(Value::as_str),
        Some("rust/fixtures/m3/oracle/rng-vectors-v1.json")
    );

    let publication_state = manifest
        .get("publication_state")
        .and_then(Value::as_str)
        .ok_or("missing publication state")?;
    let published = manifest
        .get("published_supporting_artifacts")
        .and_then(Value::as_array)
        .ok_or("missing published supporting artifacts")?;
    if publication_state == "CONTRACT_CATALOG_FROZEN" {
        assert!(published.is_empty());
        return Ok(());
    }

    assert_eq!(publication_state, "ORACLE_EVIDENCE_PUBLISHED");
    assert!(published.iter().any(|entry| {
        entry.get("artifact_id").and_then(Value::as_str) == Some("rng-vectors-v1")
    }));
    let artifact_path = repository.join("rust/fixtures/m3/oracle/rng-vectors-v1.json");
    let artifact: Value = serde_json::from_str(&fs::read_to_string(artifact_path)?)?;
    assert_eq!(
        artifact.get("artifact_id").and_then(Value::as_str),
        Some("rng-vectors-v1")
    );
    assert_eq!(
        artifact.get("schema_version").and_then(Value::as_u64),
        Some(1)
    );
    assert!(
        !artifact
            .get("vectors")
            .and_then(Value::as_array)
            .ok_or("published RNG artifact has no vectors")?
            .is_empty()
    );
    Ok(())
}
