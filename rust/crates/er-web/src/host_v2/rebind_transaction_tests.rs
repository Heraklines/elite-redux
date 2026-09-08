//! Native host composition over real NaturalCoop requests and raw bootstrap input.
//! No Worker/browser execution is claimed by this native module. The protocol
//! contexts and navigation follow the qualified 242b session witness; gameplay,
//! handshake frames, material and receipts are produced by the actual host.
use super::*;
use std::error::Error;
use std::sync::OnceLock;

use crate::contracts_v2::BrowserSessionContextV2;
use er_env::current::CurrentSessionRebindOutputV1;
use er_game::m72_bootstrap::RunBootstrapStageV1;
use er_kernel::game_kernel_v7::current_coop_rebind_v7::CurrentCoopRebindPhaseV1;
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_protocol::proposal::ProposalLeaseConfig;
use er_protocol::recovery::RecoveryTransactionConfig;
use er_protocol::replica::AuthorityReplicaConfig;
use er_repro::current::{CurrentReproOutcomeV1, replay_current_capsule_v1};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::{
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey, RawInputEvent,
    RunId, SeatId, SessionId, TimeClass,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("bounded native witness integer")
}

fn generation(value: u64) -> ConnectionGeneration {
    ConnectionGeneration::new(safe(value))
}

fn content() -> TestResult<Arc<PreparedGameContentV2>> {
    static CONTENT: OnceLock<Result<Arc<PreparedGameContentV2>, String>> = OnceLock::new();
    CONTENT
        .get_or_init(|| {
            let bundle: GameContentBundleV2 = serde_json::from_slice(include_bytes!(
                "../../../../fixtures/m9/engineering/game-content-bundle-v2.json"
            ))
            .map_err(|error| error.to_string())?;
            PreparedGameContentV2::prepare(Arc::new(bundle))
                .map(Arc::new)
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .cloned()
        .map_err(|error| error.clone().into())
}

fn frame(
    sender: SeatId,
    authority: SeatId,
    generation: ConnectionGeneration,
) -> Result<FrameContext, Box<dyn Error>> {
    Ok(FrameContext {
        session_id: SessionId::new("m9e-coop-session")?,
        run_id: RunId::new("m9e-coop-run")?,
        session_epoch: safe(1),
        seat_map_id: "m9e-coop-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: sender,
        authority_seat_id: authority,
        connection_generation: generation,
    })
}

fn authority_protocol(
    host: SeatId,
    guest: SeatId,
    generation: ConnectionGeneration,
) -> Result<BattleProtocolConfig, Box<dyn Error>> {
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: frame(host, host, generation)?,
                peer_bindings: vec![PeerBinding {
                    seat_id: guest,
                    connection_generation: generation,
                }],
                owner_id: "m9e-coop-authority".to_owned(),
                retain_capacity: safe(32),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(1),
                    maximum_ms: safe(64),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(8)),
            },
            proposal_capacity: safe(64),
        },
    })
}

fn replica_protocol(
    host: SeatId,
    guest: SeatId,
    generation: ConnectionGeneration,
) -> Result<BattleProtocolConfig, Box<dyn Error>> {
    let context = frame(guest, host, generation)?;
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Replica {
            replica: AuthorityReplicaConfig {
                receipt_context: context.clone(),
                authority_seat_id: host,
                authority_connection_generation: generation,
            },
            proposal_leases: ProposalLeaseConfig {
                owner_prefix: "m9e-coop-proposal".to_owned(),
                retry_initial_ms: safe(1),
                retry_maximum_ms: safe(64),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: context,
                request_timeout_ms: safe(300_000),
                control_timeout_ms: safe(30_000),
                pacing_ms: safe(16),
                timer_owner_id: "m9e-coop-recovery".to_owned(),
            },
        },
    })
}

fn profile() -> TestResult<ProfileStateV1> {
    Ok(ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: Default::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(safe(1))?,
        },
        dex: DexState::default(),
    })
}

#[derive(Clone, Debug)]
struct Peer {
    host: BrowserKernelHostV2,
}

impl Peer {
    fn natural(authority: bool) -> TestResult<Self> {
        let host = SeatId::new(safe(1));
        let guest = SeatId::new(safe(2));
        let seat = if authority { host } else { guest };
        let config = if authority {
            authority_protocol(host, guest, generation(1))?
        } else {
            replica_protocol(host, guest, generation(1))?
        };
        let mut peer = Self {
            host: BrowserKernelHostV2::from_content(content()?),
        };
        let response = peer.send(BrowserRequestV2::Initialize {
            initialization: Box::new(BrowserSessionInitializationV2::NaturalCoop {
                context: BrowserSessionContextV2 {
                    local_seat: seat,
                    role: if authority {
                        GameKernelRoleV7::Authority
                    } else {
                        GameKernelRoleV7::Replica
                    },
                    scheduler: KernelSchedulerSnapshotV2 {
                        next_timer_id: Some(SafeU53::ZERO),
                        timers: Vec::new(),
                        pauses: Vec::new(),
                        disposed: false,
                    },
                    protocol: Some(initial_battle_protocol_snapshot_v2(&config, seat)?),
                },
                profile: profile()?,
                seed: "owned-startup".to_owned(),
                save_slots: vec!["owned-save".to_owned()],
                local_is_host: authority,
            }),
        })?;
        assert_eq!(response, BrowserResponseV2::Ready);
        assert!(
            peer.host
                .session()?
                .snapshot()?
                .current_coop_setup
                .is_some()
        );
        Ok(peer)
    }

    fn envelope(&self, request: BrowserRequestV2) -> TestResult<Vec<u8>> {
        Ok(canonical_bytes(&BrowserRequestEnvelopeV2 {
            version: BROWSER_WORKER_PROTOCOL_VERSION_V2,
            request_id: increment(self.host.next_sequence)?,
            sequence: self.host.next_sequence,
            request,
        })?)
    }

    fn send(&mut self, request: BrowserRequestV2) -> TestResult<BrowserResponseV2> {
        let sequence = self.host.next_sequence;
        let request_id = increment(sequence)?;
        let request = self.envelope(request)?;
        let bytes = self.host.process_bytes(&request)?;
        let response: BrowserResponseEnvelopeV2 = serde_json::from_slice(&bytes)?;
        assert_eq!(canonical_bytes(&response)?, bytes);
        assert_eq!(response.version, BROWSER_WORKER_PROTOCOL_VERSION_V2);
        assert_eq!(response.request_id, request_id);
        assert_eq!(response.accepted_sequence, sequence);
        Ok(response.response)
    }

    fn rebind(
        &mut self,
        control: CurrentCoopRebindEventV1,
    ) -> TestResult<CurrentSessionRebindOutputV1> {
        let mut reference = self.host.session()?.fork()?;
        let expected = reference.apply_rebind(control.clone())?;
        let BrowserResponseV2::Rebind {
            output,
            observation,
        } = self.send(BrowserRequestV2::CoopRebind { control })?
        else {
            return Err("dedicated typed REBIND response required".into());
        };
        assert_eq!(output, expected);
        assert_eq!(*observation, reference.observe()?);
        assert_eq!(self.host.session()?.snapshot()?, reference.snapshot()?);
        Ok(output)
    }

    fn frames(&mut self, request: BrowserRequestV2) -> TestResult<Vec<Vec<u8>>> {
        let BrowserResponseV2::Effects { batch } = self.send(request)? else {
            return Err("ordinary typed effects required".into());
        };
        let mut frames = Vec::new();
        for effect in batch.effects {
            if let BrowserEffectV2::SendNetworkFrame { generation, bytes } = effect {
                assert_eq!(generation, self.host.generation);
                frames.push(bytes);
            }
        }
        Ok(frames)
    }

    fn press(&mut self, key: PhysicalKey) -> TestResult<Vec<Vec<u8>>> {
        let mut frames = self.frames(BrowserRequestV2::RawInput {
            event: RawInputEvent::KeyDown {
                code: key.clone(),
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
        })?;
        frames.extend(self.frames(BrowserRequestV2::RawInput {
            event: RawInputEvent::KeyUp { code: key },
        })?);
        Ok(frames)
    }

    fn navigate(&mut self, id: &str) -> TestResult {
        let bound = self
            .host
            .session()?
            .observe()?
            .control
            .as_ref()
            .and_then(|control| control.menu.as_ref())
            .ok_or("natural menu required")?
            .options
            .len()
            + 1;
        for _ in 0..bound {
            if self
                .host
                .session()?
                .observe()?
                .control
                .as_ref()
                .and_then(|control| control.menu.as_ref())
                .is_some_and(|menu| menu.selected_option_id.as_str() == id)
            {
                return Ok(());
            }
            assert!(self.press(PhysicalKey::ArrowDown)?.is_empty());
        }
        Err(format!("actual raw menu cannot reach {id}").into())
    }

    fn choose(&mut self, authority: bool) -> TestResult<Vec<Vec<u8>>> {
        let prepared = content()?;
        let mode = prepared
            .bundle()
            .bootstrap
            .modes
            .iter()
            .find(|mode| mode.cooperative && mode.supported)
            .ok_or("supported cooperative mode required")?;
        let mut frames = self.press(PhysicalKey::Space)?;
        self.navigate(&format!("bootstrap/mode/{}", mode.mode.get()))?;
        frames.extend(self.press(PhysicalKey::Space)?);
        if mode.challenge_selection && authority {
            self.navigate("bootstrap/challenge/done")?;
            frames.extend(self.press(PhysicalKey::Space)?);
        }
        let GameKernelLifecycleSnapshotV7::Bootstrap(before) =
            self.host.session()?.snapshot()?.lifecycle
        else {
            return Err("actual starter stage required".into());
        };
        assert_eq!(before.stage, RunBootstrapStageV1::StarterSelect);
        let starter = before
            .catalog
            .starters
            .iter()
            .find(|starter| starter.cost <= before.catalog.maximum_starter_cost)
            .ok_or("affordable actual starter required")?;
        self.navigate(&format!("bootstrap/starter/{}", starter.pokemon_id.get()))?;
        frames.extend(self.press(PhysicalKey::Space)?);
        self.navigate("bootstrap/starter/confirm")?;
        frames.extend(self.press(PhysicalKey::Space)?);
        frames.extend(self.press(PhysicalKey::Space)?);
        if authority {
            for _ in 0..4 {
                if self.host.session()?.kernel_ref()?.state().is_some()
                    || matches!(self.host.session()?.snapshot()?.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(ref bootstrap) if bootstrap.stage == RunBootstrapStageV1::Complete)
                {
                    break;
                }
                frames.extend(self.press(PhysicalKey::Space)?);
            }
        }
        Ok(frames)
    }

    fn export(&mut self) -> TestResult<CurrentReproCapsuleV1> {
        let BrowserResponseV2::Effects { batch } = self.send(BrowserRequestV2::ExportRepro)? else {
            return Err("typed capsule effects required".into());
        };
        let [BrowserEffectV2::CurrentReproReady { capsule_bytes }] = batch.effects.as_slice()
        else {
            return Err("exact current capsule effect required".into());
        };
        let capsule: CurrentReproCapsuleV1 = serde_json::from_slice(capsule_bytes)?;
        assert_eq!(canonical_bytes(&capsule)?, *capsule_bytes);
        let replayed =
            replay_current_capsule_v1(&capsule, content()?, CurrentReproLimitsV1::default())?;
        assert_eq!(replayed.snapshot()?, self.host.session()?.snapshot()?);
        assert_eq!(replayed.observe()?, self.host.session()?.observe()?);
        assert_eq!(
            capsule
                .browser_transport
                .as_ref()
                .ok_or("browser transport capture")?
                .final_generation,
            self.host.generation
        );
        Ok(capsule)
    }

    fn capture_from_actual_battle(&mut self) -> TestResult {
        let snapshot = self.host.session()?.snapshot()?;
        assert!(self.host.session()?.kernel_ref()?.state().is_some());
        let observation = self.host.session()?.observe()?;
        let (local_seat, role) = self.host.session()?.session_context()?;
        let mut restored = Self {
            host: BrowserKernelHostV2::from_content(content()?),
        };
        assert_eq!(
            restored.send(BrowserRequestV2::Initialize {
                initialization: Box::new(BrowserSessionInitializationV2::Snapshot {
                    context: BrowserSessionContextV2 {
                        local_seat,
                        role,
                        scheduler: snapshot.scheduler.clone(),
                        protocol: snapshot.protocol.clone(),
                    },
                    snapshot: snapshot.clone(),
                }),
            })?,
            BrowserResponseV2::Ready
        );
        assert_eq!(restored.host.session()?.snapshot()?, snapshot);
        assert_eq!(restored.host.session()?.observe()?, observation);
        let capsule = restored.export()?;
        assert_eq!(capsule.checkpoint.as_ref(), &snapshot);
        assert_eq!(capsule.base_position, 0);
        assert_eq!(capsule.final_position, 0);
        assert!(capsule.attempts.is_empty());
        *self = restored;
        Ok(())
    }

    fn import(&mut self) -> TestResult {
        let capsule = self.export()?;
        let before = self.host.session()?.snapshot()?;
        let before_observation = self.host.session()?.observe()?;
        let generation = self.host.generation;
        let mut restored = Self {
            host: BrowserKernelHostV2::from_content(content()?),
        };
        assert_eq!(
            restored.send(BrowserRequestV2::Initialize {
                initialization: Box::new(BrowserSessionInitializationV2::CurrentReproCapsule {
                    capsule_bytes: canonical_bytes(&capsule)?,
                }),
            })?,
            BrowserResponseV2::Ready
        );
        assert_eq!(restored.host.session()?.snapshot()?, before);
        assert_eq!(restored.host.session()?.observe()?, before_observation);
        assert_eq!(restored.host.generation, generation);
        assert_eq!(restored.export()?, capsule);
        *self = restored;
        Ok(())
    }

    fn settle(&mut self) -> TestResult<usize> {
        let mut count = 0;
        for _ in 0..16 {
            let pending = self.host.session()?.snapshot()?.pending_presentations;
            if pending.is_empty() {
                return Ok(count);
            }
            for presentation in pending {
                assert!(
                    self.frames(BrowserRequestV2::PresentationSettled {
                        event_id: presentation.event_id,
                        outcome: BrowserPresentationOutcomeV2::Settled,
                    })?
                    .is_empty()
                );
                count += 1;
            }
        }
        Err("actual callback drainage exceeded sixteen batches".into())
    }

    fn next_frame(&mut self) -> TestResult<Vec<u8>> {
        for _ in 0..8 {
            self.settle()?;
            let frames = self.press(PhysicalKey::Space)?;
            if !frames.is_empty() {
                return one_frame(&frames);
            }
        }
        Err("eight actual raw presses did not publish gameplay".into())
    }
}

fn one_frame(frames: &[Vec<u8>]) -> TestResult<Vec<u8>> {
    let [frame] = frames else {
        return Err("one actual frame required".into());
    };
    Ok(frame.clone())
}

fn pair() -> TestResult<(Peer, Peer)> {
    // Build the genuine two-host raw-input journey once. Each transaction test
    // gets an independent complete clone, including capture and response owners.
    // The immutable fixture is never advanced by a rebind or negative test.
    static STARTED: OnceLock<Result<(Peer, Peer), String>> = OnceLock::new();
    let pair = STARTED.get_or_init(|| build_pair().map_err(|error| error.to_string()));
    match pair {
        Ok((host, guest)) => {
            let copies = (host.clone(), guest.clone());
            assert_eq!(evidence(&copies.0.host)?, evidence(&host.host)?);
            assert_eq!(evidence(&copies.1.host)?, evidence(&guest.host)?);
            Ok(copies)
        }
        Err(error) => Err(error.clone().into()),
    }
}

fn build_pair() -> TestResult<(Peer, Peer)> {
    let mut host = Peer::natural(true)?;
    let mut guest = Peer::natural(false)?;
    let choice = std::thread::scope(|scope| -> TestResult<Vec<u8>> {
        let guest_start = scope.spawn(|| guest.choose(false).map_err(|error| error.to_string()));
        let host_start = host.choose(true);
        let guest_start = guest_start
            .join()
            .map_err(|_| "guest startup thread panicked")?;
        assert!(host_start?.is_empty());
        one_frame(&guest_start?)
    })?;
    let started = one_frame(&host.frames(BrowserRequestV2::NetworkFrame {
        generation: safe(1),
        bytes: choice,
    })?)?;
    assert!(
        guest
            .frames(BrowserRequestV2::NetworkFrame {
                generation: safe(1),
                bytes: started
            })?
            .is_empty()
    );
    assert!(host.host.session()?.kernel_ref()?.state().is_some());
    assert_eq!(
        host.host.session()?.kernel_ref()?.state(),
        guest.host.session()?.kernel_ref()?.state()
    );
    host.export()?;
    guest.export()?;
    // Startup above is real adapter execution with its own verified replay.
    // The rebind witness starts a new public snapshot-based capture at exactly
    // that reached battle, before disconnect or any rebind control. This keeps
    // the obsolete starter-menu tail out of the bounded rebind capsule.
    host.capture_from_actual_battle()?;
    guest.capture_from_actual_battle()?;
    Ok((host, guest))
}

fn begin(host: &mut Peer, guest: &mut Peer) -> TestResult<Vec<u8>> {
    for peer in [&mut *host, &mut *guest] {
        assert!(
            peer.frames(BrowserRequestV2::TransportChanged {
                generation: safe(1),
                connected: false
            })?
            .is_empty()
        );
        assert!(
            peer.rebind(CurrentCoopRebindEventV1::Begin)?
                .frames
                .is_empty()
        );
        assert_eq!(peer.host.generation, safe(1));
        assert!(
            peer.frames(BrowserRequestV2::TransportChanged {
                generation: safe(2),
                connected: true
            })?
            .is_empty()
        );
        assert_eq!(peer.host.generation, safe(2));
    }
    let output = host.rebind(CurrentCoopRebindEventV1::Retry)?;
    assert_eq!(output.generation, generation(2));
    one_frame(&output.frames)
}

fn handshake(host: &mut Peer, guest: &mut Peer, mut frame: Vec<u8>) -> TestResult {
    for index in 0usize..8 {
        let peer = if index.is_multiple_of(2) {
            &mut *guest
        } else {
            &mut *host
        };
        let output = peer.rebind(CurrentCoopRebindEventV1::Receive {
            generation: generation(2),
            bytes: frame,
        })?;
        assert_eq!(output.generation, generation(2));
        if index < 7 {
            frame = one_frame(&output.frames)?;
        } else {
            assert!(output.frames.is_empty());
            frame = Vec::new();
        }
        // Every handshake phase is a real typed capsule export/replay/import.
        peer.import()?;
    }
    for peer in [host, guest] {
        let snapshot = peer.host.session()?.snapshot()?;
        let owner = snapshot
            .current_coop_setup
            .as_ref()
            .and_then(|setup| setup.rebind.as_deref())
            .ok_or("rebind owner required")?;
        assert_eq!(owner.phase, CurrentCoopRebindPhaseV1::Open);
        assert_eq!(owner.transcript.len(), 8);
        assert_eq!(peer.host.generation, safe(2));
    }
    Ok(())
}

fn evidence(host: &BrowserKernelHostV2) -> TestResult<Vec<u8>> {
    let retained = host
        .retained
        .iter()
        .map(|(id, entry)| {
            (
                id,
                entry.accepted_sequence,
                &entry.fingerprint,
                &entry.response,
            )
        })
        .collect::<Vec<_>>();
    Ok(canonical_bytes(&(
        host.session()?.snapshot()?,
        host.next_sequence,
        host.generation,
        retained,
        host.retained_response_bytes,
        host.disposed,
    ))?)
}

#[test]
fn browser_rebind_natural_controls_and_generation_two_gameplay_replay() -> TestResult {
    let (mut host, mut guest) = pair()?;
    let offer = begin(&mut host, &mut guest)?;
    handshake(&mut host, &mut guest, offer)?;
    deliver_generation_two_material(&mut host, &mut guest)?;
    let reply = produce_generation_two_reply(&mut host, &mut guest)?;
    receive_generation_two_reply(&mut host, &mut guest, reply)?;
    for (index, peer) in [&mut host, &mut guest].into_iter().enumerate() {
        let capsule = peer.export()?;
        let controls = capsule
            .attempts
            .iter()
            .filter(|attempt| matches!(attempt.event, CurrentExternalEvent::CoopRebind { .. }))
            .collect::<Vec<_>>();
        assert_eq!(controls.len(), if index == 0 { 6 } else { 5 });
        assert_eq!(
            controls
                .iter()
                .filter(|attempt| matches!(
                    attempt.event,
                    CurrentExternalEvent::CoopRebind {
                        control: CurrentCoopRebindEventV1::Receive { .. }
                    }
                ))
                .count(),
            4
        );
        for attempt in controls {
            assert_eq!(attempt.origin.as_deref(), Some("browser.coop.REBIND"));
            let transport = attempt
                .browser_transport
                .ok_or("rebind transport evidence required")?;
            assert_eq!(transport.before_generation, transport.after_generation);
            assert!(matches!(
                attempt.outcome,
                CurrentReproOutcomeV1::RebindApplied { .. }
            ));
        }
        peer.import()?;
    }
    Ok(())
}

// Keep snapshot-heavy phases in separate frames on the default test stack.
#[inline(never)]
fn deliver_generation_two_material(host: &mut Peer, guest: &mut Peer) -> TestResult {
    host.settle()?;
    guest.settle()?;
    let material = host.next_frame()?;
    er_game::m9e_material_v6::GameMaterialV6::decode(&material)?;
    assert!(
        guest
            .frames(BrowserRequestV2::NetworkFrame {
                generation: safe(2),
                bytes: material
            })?
            .is_empty()
    );
    host.settle()?;
    guest.settle()?;
    Ok(())
}

#[inline(never)]
fn produce_generation_two_reply(host: &mut Peer, guest: &mut Peer) -> TestResult<Vec<u8>> {
    let proposal = guest.next_frame()?;
    let decoded = er_kernel::current_proposal_v7::decode_current_proposal_v1(&proposal)?;
    assert_eq!(decoded.connection_generation, generation(2));
    let pending = guest.host.session()?.snapshot()?;
    assert_eq!(
        one_frame(&guest.frames(BrowserRequestV2::RetryCoopSetup)?)?,
        proposal
    );
    assert_eq!(guest.host.session()?.snapshot()?, pending);
    let reply = one_frame(&host.frames(BrowserRequestV2::NetworkFrame {
        generation: safe(2),
        bytes: proposal.clone(),
    })?)?;
    let receipt = er_kernel::current_proposal_v7::CurrentProposalMaterialReceiptV2::decode(&reply)?;
    assert_eq!(receipt.evidence()?.proposal_bytes, proposal);
    assert_eq!(
        receipt.authority_context.connection_generation,
        generation(2)
    );
    assert!(
        er_kernel::current_proposal_v7::CurrentProposalMaterialReceiptV1::decode(&reply).is_err()
    );
    let after = host.host.session()?.snapshot()?;
    assert_eq!(
        one_frame(&host.frames(BrowserRequestV2::NetworkFrame {
            generation: safe(2),
            bytes: proposal
        })?)?,
        reply
    );
    assert_eq!(host.host.session()?.snapshot()?, after);
    Ok(reply)
}

#[inline(never)]
fn receive_generation_two_reply(
    host: &mut Peer,
    guest: &mut Peer,
    reply: Vec<u8>,
) -> TestResult {
    guest.import()?;
    assert!(
        guest
            .frames(BrowserRequestV2::NetworkFrame {
                generation: safe(2),
                bytes: reply.clone()
            })?
            .is_empty()
    );
    assert!(guest.host.session()?.snapshot()?.current_proposal.is_none());
    let after = guest.host.session()?.snapshot()?;
    assert!(
        guest
            .frames(BrowserRequestV2::NetworkFrame {
                generation: safe(2),
                bytes: reply
            })?
            .is_empty()
    );
    assert_eq!(guest.host.session()?.snapshot()?, after);
    assert!(guest.settle()? > 0);
    host.settle()?;
    assert_eq!(
        host.host.session()?.kernel_ref()?.state(),
        guest.host.session()?.kernel_ref()?.state()
    );
    Ok(())
}

#[test]
fn browser_rebind_receive_response_and_cache_rejection_preserve_transaction() -> TestResult {
    let (mut host, mut guest) = pair()?;
    let offer = begin(&mut host, &mut guest)?;
    let request = guest.envelope(BrowserRequestV2::CoopRebind {
        control: CurrentCoopRebindEventV1::Receive {
            generation: generation(2),
            bytes: offer,
        },
    })?;
    let before = evidence(&guest.host)?;
    let before_snapshot = guest.host.session()?.snapshot()?;
    let position = guest
        .host
        .repro
        .as_ref()
        .ok_or("capture required")?
        .export()?
        .final_position;
    let mut reference = guest.host.clone();
    let expected = reference.process_bytes(&request)?;
    assert_ne!(
        reference.session()?.snapshot()?,
        before_snapshot,
        "genuine RECEIVE must change owned state before response admission"
    );
    assert!(expected.len() > 1);
    for cache_bound in [false, true] {
        let mut rejected = guest.host.clone();
        let result = if cache_bound {
            rejected.process_bytes_with_limits(
                &request,
                MAXIMUM_BROWSER_RESPONSE_BYTES_V2,
                expected.len() - 1,
            )
        } else {
            rejected.process_bytes_with_response_limit(&request, expected.len() - 1)
        };
        assert!(matches!(result, Err(BrowserWebErrorV2::Invalid)));
        assert_eq!(evidence(&rejected)?, before);
        assert!(
            matches!(rejected.capture_status(), Some(CurrentCaptureStatusV1::Unavailable { position: actual, .. }) if actual == position + 1)
        );
        assert_eq!(rejected.process_bytes(&request)?, expected);
        assert_eq!(evidence(&rejected)?, evidence(&reference)?);
        let mut resumed = Peer { host: rejected };
        let capsule = resumed.export()?;
        assert_eq!(capsule.base_position, position + 1);
        assert_eq!(capsule.final_position, position + 2);
        resumed.import()?;
    }
    Ok(())
}

#[test]
fn browser_rebind_duplicates_noops_and_wrong_generation_keep_capture_exact() -> TestResult {
    let (mut host, mut guest) = pair()?;
    for peer in [&mut host, &mut guest] {
        peer.frames(BrowserRequestV2::TransportChanged {
            generation: safe(1),
            connected: false,
        })?;
        peer.rebind(CurrentCoopRebindEventV1::Begin)?;
        let before = peer.host.session()?.snapshot()?;
        let position = peer.export()?.final_position;
        assert!(
            peer.rebind(CurrentCoopRebindEventV1::Begin)?
                .frames
                .is_empty()
        );
        assert_eq!(peer.host.session()?.snapshot()?, before);
        assert_eq!(peer.export()?.final_position, position + 1);
        assert_eq!(peer.host.generation, safe(1));
        peer.frames(BrowserRequestV2::TransportChanged {
            generation: safe(2),
            connected: true,
        })?;
    }
    let offer = one_frame(&host.rebind(CurrentCoopRebindEventV1::Retry)?.frames)?;
    let before = evidence(&guest.host)?;
    let position = guest
        .host
        .repro
        .as_ref()
        .ok_or("capture required")?
        .export()?
        .final_position;
    let wrong = guest.envelope(BrowserRequestV2::CoopRebind {
        control: CurrentCoopRebindEventV1::Receive {
            generation: generation(1),
            bytes: offer.clone(),
        },
    })?;
    assert!(matches!(
        guest.host.process_bytes(&wrong),
        Err(BrowserWebErrorV2::Kernel(_))
    ));
    assert_eq!(evidence(&guest.host)?, before);
    let rejected_capsule = guest.export()?;
    assert_eq!(rejected_capsule.final_position, position + 1);
    let last = rejected_capsule
        .attempts
        .last()
        .ok_or("rejected attempt required")?;
    assert!(matches!(
        last.outcome,
        CurrentReproOutcomeV1::KernelRejected { .. }
    ));
    assert_eq!(
        last.browser_transport
            .ok_or("transport evidence required")?
            .after_generation,
        safe(2)
    );
    guest.import()?;
    let control = CurrentCoopRebindEventV1::Receive {
        generation: generation(2),
        bytes: offer,
    };
    let bytes = guest.envelope(BrowserRequestV2::CoopRebind {
        control: control.clone(),
    })?;
    let response = guest.host.process_bytes(&bytes)?;
    let accepted = evidence(&guest.host)?;
    let capture = guest.host.capture_status();
    assert_eq!(guest.host.process_bytes(&bytes)?, response);
    assert_eq!(evidence(&guest.host)?, accepted);
    assert_eq!(
        guest.host.capture_status(),
        capture,
        "same envelope retry must not record another control"
    );
    let BrowserResponseEnvelopeV2 {
        response: BrowserResponseV2::Rebind { output, .. },
        ..
    } = serde_json::from_slice(&response)?
    else {
        return Err("actual rebind response required".into());
    };
    let after = guest.host.session()?.snapshot()?;
    let position = guest.export()?.final_position;
    assert_eq!(
        guest.rebind(control)?,
        output,
        "new envelope duplicate returns original immediate response"
    );
    assert_eq!(guest.host.session()?.snapshot()?, after);
    assert_eq!(guest.export()?.final_position, position + 1);
    let offer = one_frame(&host.rebind(CurrentCoopRebindEventV1::Retry)?.frames)?;
    handshake(&mut host, &mut guest, offer)?;
    host.export()?;
    guest.export()?;
    Ok(())
}

#[test]
fn browser_rebind_wire_decoding_rejects_unknown_control_fields() -> TestResult {
    let mut peer = Peer::natural(true)?;
    let mut cases = Vec::new();
    for control in [
        CurrentCoopRebindEventV1::Begin,
        CurrentCoopRebindEventV1::Retry,
        CurrentCoopRebindEventV1::Receive {
            generation: generation(2),
            bytes: vec![1],
        },
    ] {
        let bytes = peer.envelope(BrowserRequestV2::CoopRebind { control })?;
        let decoded: BrowserRequestEnvelopeV2 = serde_json::from_slice(&bytes)?;
        assert_eq!(canonical_bytes(&decoded)?, bytes);
        let mut value: serde_json::Value = serde_json::from_slice(&bytes)?;
        value["request"]["control"]["unknown"] = serde_json::json!(true);
        cases.push(canonical_bytes(&value)?);
    }
    for bytes in cases {
        let before = evidence(&peer.host)?;
        assert!(serde_json::from_slice::<BrowserRequestEnvelopeV2>(&bytes).is_err());
        assert!(matches!(
            peer.host.process_bytes(&bytes),
            Err(BrowserWebErrorV2::Invalid)
        ));
        assert_eq!(evidence(&peer.host)?, before);
    }
    Ok(())
}
