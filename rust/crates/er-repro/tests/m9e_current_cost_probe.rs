//! Proposed native-only er-repro/tests/m9e_current_cost_probe.rs.
//! Measurement evidence only: no timing thresholds, allocator claims or product changes.
//! Input setup, verification and output destruction are outside measured intervals.

#![cfg(not(target_arch = "wasm32"))]

use std::error::Error;
use std::hint::black_box;
use std::io::Write;
use std::sync::Arc;
use std::time::Instant;

use er_canonical::{canonical_bytes, content_digest};
use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::KernelPresentationOutcomeV2;
use er_repro::current::{
    CurrentCaptureStatusV1, CurrentReproLimitsV1, CurrentReproOutcomeV1, CurrentReproRecorderV1,
    MAXIMUM_CURRENT_REPRO_BYTES_V1, MAXIMUM_CURRENT_REPRO_EVENTS_V1, replay_current_capsule_v1,
};
use er_types::{GameControlKindV2, InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId};
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;
const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");
const WARMUPS: usize = 1;
const SAMPLES: usize = 3;

fn key(code: PhysicalKey, down: bool) -> CurrentExternalEvent {
    CurrentExternalEvent::RawInput {
        input: if down {
            RawInputEvent::KeyDown {
                code,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            }
        } else {
            RawInputEvent::KeyUp { code }
        },
    }
}

fn press(session: &mut CurrentGameSession, code: PhysicalKey) -> TestResult {
    session.apply(key(code.clone(), true))?;
    session.apply(key(code, false))?;
    Ok(())
}

fn selected(session: &CurrentGameSession) -> TestResult<String> {
    Ok(session
        .observe()?
        .control
        .ok_or("missing control")?
        .menu
        .ok_or("missing menu")?
        .selected_option_id
        .as_str()
        .to_owned())
}

// Each phase gets identical fresh input outside the clock. Keeping input and output
// alive through verification excludes their teardown from the measured operation.
fn measure<I, O>(
    phase: &str,
    mut setup: impl FnMut() -> TestResult<I>,
    mut operation: impl FnMut(&mut I) -> TestResult<O>,
    mut verify: impl FnMut(&I, &O) -> TestResult,
) -> TestResult<Value> {
    let mut samples = Vec::with_capacity(SAMPLES);
    for index in 0..WARMUPS + SAMPLES {
        let mut input = setup()?;
        let started = Instant::now();
        // Barriers belong inside the interval; their small overhead is measured.
        // Operations that capture data also obscure those inputs at their use site.
        let output = black_box(operation(black_box(&mut input))?);
        let elapsed = started.elapsed();
        verify(&input, &output)?;
        if index >= WARMUPS {
            samples.push(u64::try_from(elapsed.as_nanos())?);
        }
    }
    samples.sort_unstable();
    Ok(json!({
        "phase": phase,
        "min_ns": samples[0],
        "median_ns": samples[SAMPLES / 2]
    }))
}

struct Checkpoint {
    name: &'static str,
    session: CurrentGameSession,
    event: CurrentExternalEvent,
}

fn checkpoint(
    name: &'static str,
    session: &CurrentGameSession,
    expected_kind: GameControlKindV2,
    code: PhysicalKey,
) -> TestResult<Checkpoint> {
    assert_eq!(
        session.observe()?.control.ok_or("control")?.kind,
        expected_kind
    );
    Ok(Checkpoint {
        name,
        session: session.fork()?,
        event: key(code, true),
    })
}

fn checkpoints(content: Arc<PreparedGameContentV2>) -> TestResult<Vec<Checkpoint>> {
    let mut session = CurrentGameSession::natural_start(
        serde_json::from_value(json!({
            "schema_version": 1, "unlocks": [], "achievements": [], "challenges": [], "flags": [],
            "dex": {"entries": []}, "statistics": {
                "runs_started": 0, "runs_won": 0, "runs_lost": 0, "battles_won": 0,
                "pokemon_captured": 0, "highest_wave": 1
            }
        }))?,
        "m9e-current-cost-probe".to_owned(),
        SeatId::new(SafeU53::new(1)?),
        vec!["preview-slot".to_owned()],
        true,
        content,
        None,
    )?;
    let mut result = vec![checkpoint(
        "title",
        &session,
        GameControlKindV2::Title,
        PhysicalKey::Space,
    )?];
    press(&mut session, PhysicalKey::Space)?;
    result.push(checkpoint(
        "mode",
        &session,
        GameControlKindV2::ModeSelect,
        PhysicalKey::Space,
    )?);
    press(&mut session, PhysicalKey::Space)?;
    result.push(checkpoint(
        "starter",
        &session,
        GameControlKindV2::StarterSelect,
        PhysicalKey::Space,
    )?);
    press(&mut session, PhysicalKey::Space)?;
    let bound = session
        .observe()?
        .control
        .ok_or("starter")?
        .menu
        .ok_or("menu")?
        .options
        .len()
        + 1;
    for _ in 0..bound {
        if selected(&session)? == "bootstrap/starter/confirm" {
            break;
        }
        press(&mut session, PhysicalKey::ArrowDown)?;
    }
    assert_eq!(selected(&session)?, "bootstrap/starter/confirm");
    for _ in 0..4 {
        press(&mut session, PhysicalKey::Space)?;
    }
    for pending in session.snapshot()?.pending_presentations {
        session.apply(CurrentExternalEvent::PresentationOutcome {
            event_id: pending.event_id,
            outcome: KernelPresentationOutcomeV2::Settled,
        })?;
    }
    assert_eq!(selected(&session)?, "battle/command/fight");
    result.push(checkpoint(
        "active",
        &session,
        GameControlKindV2::BattleCommand,
        PhysicalKey::ArrowDown,
    )?);
    Ok(result)
}

fn probe_checkpoint(checkpoint: &Checkpoint) -> TestResult<Value> {
    let session = &checkpoint.session;
    let snapshot = session.snapshot()?;
    let observation = session.observe()?;
    let encoded = canonical_bytes(&snapshot)?;
    let digest = content_digest(&snapshot)?;
    assert_eq!(blake3::hash(&encoded).to_hex().to_string(), digest);
    let mut reference = session.fork()?;
    let expected_step = reference.apply(checkpoint.event.clone())?;
    let expected_snapshot = reference.snapshot()?;
    let expected_observation = reference.observe()?;
    assert!(
        !expected_step.effects.is_empty(),
        "{} event must be effectful",
        checkpoint.name
    );
    assert_ne!(
        snapshot, expected_snapshot,
        "{} event must change state",
        checkpoint.name
    );
    let capture_limits = CurrentReproLimitsV1 {
        maximum_events: MAXIMUM_CURRENT_REPRO_EVENTS_V1,
        maximum_bytes: MAXIMUM_CURRENT_REPRO_BYTES_V1,
    };
    let mut recorder_capsule_bytes = 0;

    let phases = vec![
        measure(
            "fork",
            || Ok(()),
            |_| Ok(black_box(session).fork()?),
            |_, result| {
                assert!(Arc::ptr_eq(result.content(), session.content()));
                assert_eq!(result.snapshot()?, snapshot);
                assert_eq!(result.observe()?, observation);
                Ok(())
            },
        )?,
        measure(
            "snapshot",
            || Ok(session.fork()?),
            |input| Ok(input.snapshot()?),
            |_, result| {
                assert_eq!(*result, snapshot);
                Ok(())
            },
        )?,
        measure(
            "validate",
            || Ok(session.fork()?),
            |input| {
                input.validate()?;
                Ok(())
            },
            |input, _| {
                assert_eq!(input.snapshot()?, snapshot);
                assert_eq!(input.observe()?, observation);
                Ok(())
            },
        )?,
        measure(
            "observe",
            || Ok(session.fork()?),
            |input| Ok(input.observe()?),
            |_, result| {
                assert_eq!(*result, observation);
                Ok(())
            },
        )?,
        measure(
            "canonical_encode_snapshot",
            || Ok(()),
            |_| Ok(canonical_bytes(black_box(&snapshot))?),
            |_, result| {
                assert_eq!(*result, encoded);
                Ok(())
            },
        )?,
        measure(
            "canonical_digest_snapshot",
            || Ok(()),
            |_| Ok(content_digest(black_box(&snapshot))?),
            |_, result| {
                assert_eq!(*result, digest);
                Ok(())
            },
        )?,
        measure(
            "blake3_preencoded_snapshot",
            || Ok(()),
            |_| Ok(blake3::hash(black_box(&encoded))),
            |_, result| {
                assert_eq!(result.to_hex().to_string(), digest);
                Ok(())
            },
        )?,
        measure(
            "apply_effectful_raw_input",
            || Ok((session.fork()?, Some(checkpoint.event.clone()))),
            |input| {
                let event = input.1.take().ok_or("event consumed twice")?;
                Ok(input.0.apply(event)?)
            },
            |input, result| {
                assert_eq!(*result, expected_step);
                assert_eq!(input.0.snapshot()?, expected_snapshot);
                assert_eq!(input.0.observe()?, expected_observation);
                assert!(Arc::ptr_eq(input.0.content(), session.content()));
                Ok(())
            },
        )?,
        // The real event/result and before/after evidence above are untimed. Each
        // sample appends once to a fresh recorder, independently of session.apply.
        measure(
            "recorder_append",
            || {
                let (seat, role) = session.session_context()?;
                let recorder = CurrentReproRecorderV1::new(
                    snapshot.clone(),
                    seat,
                    role,
                    Arc::clone(session.content()),
                    capture_limits,
                )?;
                assert!(matches!(
                    recorder.status(),
                    CurrentCaptureStatusV1::Available { .. }
                ));
                Ok((recorder, Some(checkpoint.event.clone())))
            },
            |input| {
                let event = input.1.take().ok_or("event consumed twice")?;
                Ok(input.0.record(
                    black_box(&snapshot),
                    event,
                    Ok(black_box(&expected_step)),
                    black_box(&expected_snapshot),
                    black_box(&expected_observation),
                ))
            },
            |input, status| {
                assert_eq!(
                    *status,
                    CurrentCaptureStatusV1::Available {
                        base_position: 0,
                        final_position: 1,
                    }
                );
                let capsule = input.0.export()?;
                let bytes = serde_json::to_vec(&capsule)?;
                assert!(bytes.len() <= capture_limits.maximum_bytes);
                recorder_capsule_bytes = bytes.len();
                assert_eq!(*capsule.checkpoint, snapshot);
                assert_eq!(capsule.attempts.len(), 1);
                assert_eq!(capsule.attempts[0].event, checkpoint.event);
                match &capsule.attempts[0].outcome {
                    CurrentReproOutcomeV1::Applied {
                        step, observation, ..
                    } => {
                        assert_eq!(step.as_ref(), &expected_step);
                        assert_eq!(observation.as_ref(), &expected_observation);
                    }
                    other => return Err(format!("accepted event recorded as {other:?}").into()),
                }
                let replayed = replay_current_capsule_v1(
                    &capsule,
                    Arc::clone(session.content()),
                    capture_limits,
                )?;
                assert_eq!(replayed.snapshot()?, expected_snapshot);
                assert_eq!(replayed.observe()?, expected_observation);
                Ok(())
            },
        )?,
    ];
    assert_eq!(session.snapshot()?, snapshot);
    Ok(json!({
        "checkpoint": checkpoint.name,
        "snapshot_digest": digest,
        "snapshot_canonical_bytes": encoded.len(),
        "observation_json_bytes": serde_json::to_vec(&observation)?.len(),
        "menu_options": observation.control.as_ref().and_then(|value| value.menu.as_ref()).map_or(0, |menu| menu.options.len()),
        "event": checkpoint.event,
        "event_effects": expected_step.effects.len(),
        "recorder_capsule_bytes": recorder_capsule_bytes,
        "recorder_maximum_bytes": capture_limits.maximum_bytes,
        "recorder_maximum_events": capture_limits.maximum_events,
        "phases": phases
    }))
}

#[test]
fn current_native_phase_costs_preserve_semantics() -> TestResult {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let bundle = Arc::new(bundle);
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::clone(&bundle))?);
    let checkpoints = checkpoints(Arc::clone(&content))?;
    let decode = measure(
        "content_decode",
        || Ok(()),
        |_| {
            Ok(serde_json::from_slice::<GameContentBundleV2>(black_box(
                BUNDLE,
            ))?)
        },
        |_, result| {
            assert_eq!(result, bundle.as_ref());
            Ok(())
        },
    )?;
    let prepare = measure(
        "content_prepare_and_arc",
        || Ok(Arc::clone(&bundle)),
        |input| Ok(Arc::new(PreparedGameContentV2::prepare(Arc::clone(input))?)),
        |_, result| {
            assert_eq!(result.identity(), content.identity());
            assert_eq!(result.bundle().as_ref(), bundle.as_ref());
            for checkpoint in &checkpoints {
                let (seat, role) = checkpoint.session.session_context()?;
                let mut restored = CurrentGameSession::from_snapshot(
                    checkpoint.session.snapshot()?,
                    seat,
                    role,
                    Arc::clone(result),
                )?;
                let mut reference = checkpoint.session.fork()?;
                assert_eq!(
                    restored.apply(checkpoint.event.clone())?,
                    reference.apply(checkpoint.event.clone())?
                );
                assert_eq!(restored.snapshot()?, reference.snapshot()?);
                assert_eq!(restored.observe()?, reference.observe()?);
            }
            Ok(())
        },
    )?;
    let mut measured = Vec::new();
    for checkpoint in &checkpoints {
        measured.push(probe_checkpoint(checkpoint)?);
    }
    let evidence = json!({
        "schema_version": 1,
        "probe": "current_native_phase_costs_preserve_semantics",
        "warmups_per_phase": WARMUPS,
        "samples_per_phase": SAMPLES,
        "debug_assertions": cfg!(debug_assertions),
        "architecture": std::env::consts::ARCH,
        "os": std::env::consts::OS,
        "bundle_bytes": BUNDLE.len(),
        "content_identity": content.identity(),
        "content_phases": [decode, prepare],
        "checkpoints": measured,
        "limitations": "Wall time includes optimizer barriers, scheduling, internal validation/allocation and internal destruction. Setup, verification and final input/output teardown excluded. Warm-process fixed-order samples; no allocator or live-memory claims. API costs overlap and are not additive components. Digest includes canonical encoding; preencoded BLAKE3 isolates hashing. Recorder append excludes event apply and recorder construction; measures one accepted event on an empty tail, not rotation or accumulated history. Not transport or whole-run latency."
    });
    let output = format!(
        "M9E_CURRENT_COST_PROBE {}\n",
        serde_json::to_string(&evidence)?
    );
    assert!(output.len() < 8 * 1024, "bounded cost evidence");
    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();
    stdout.write_all(output.as_bytes())?;
    stdout.flush()?;
    Ok(())
}
