use std::collections::BTreeSet;
use std::error::Error;
use std::fmt::{Display, Formatter};

use er_canonical::fixture_digest;
use serde_json::Value;

const MAP_FIXTURE: &str = include_str!("../../../../rust/fixtures/v1/authority-v2-test-map.json");
const SOURCE_ORACLE: &str =
    include_str!("../../../../schemas/kernel/source/authority-v2-map-v1.json");
const PARITY_FIXTURES: &str =
    include_str!("../../../../test/kernel-fixtures/v1/authority-v2/contracts.json");
const SOURCE_LOCK: &str = include_str!("../../../../rust/source-lock.toml");

const EVIDENCE_PATH: &str = "rust/crates/er-protocol/tests/authority_v2_contract_map.rs::";
const PARITY_FIXTURE_PATH: &str = "test/kernel-fixtures/v1/authority-v2/contracts.json#";
const PROJECT_NAME: &str = "PokéRogue Redux";
const ORACLE_GAME_SHA: &str = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const ORACLE_BRANCH: &str = "ci/coop/v2-showdown-command-coordinate-20260720";
const PROTOCOL_VERSION: &str = "er-coop-48";
const ORACLE_PROTOCOL_VERSION: &str = "er-coop-47";
const AUTHORITY_CONTRACT: &str = "authority-v2";
const FRAME_PROTOCOL_VERSION: u64 = 2;
const SOURCE_SCHEMA_VERSION: u64 = 1;
const EXPECTED_SOURCE_FILE_COUNT: usize = 66;
const EXPECTED_PRODUCTION_MODULE_COUNT: usize = 37;
const EXPECTED_NODE_TEST_COUNT: usize = 28;
const EXPECTED_SIMULATOR_TEST_COUNT: usize = 1;
const EXPECTED_SCHEMA_CONTRACT_COUNT: usize = 29;
const EXPECTED_CANONICAL_DIGEST: &str =
    "9072146d1587f78e03f5a14709bd60fab4d824203038a8b3b1abd221c96da850";
const FROZEN_RUST_TARGET_FILES: &[&str] = &[
    "rust/crates/er-types/src/authority.rs",
    "rust/crates/er-types/src/protocol.rs",
    "rust/crates/er-protocol/src/authority_log.rs",
    "rust/crates/er-protocol/src/proposal.rs",
    "rust/crates/er-protocol/src/recovery.rs",
    "rust/crates/er-protocol/src/replica.rs",
    "rust/crates/er-protocol/src/scheduler.rs",
    "rust/crates/er-protocol/src/successor.rs",
    "rust/crates/er-protocol/src/validation.rs",
];

#[derive(Debug, Clone, Copy)]
struct ExpectedSourceContract {
    id: &'static str,
    symbol: &'static str,
    source: &'static str,
    target_layer: &'static str,
    fixture_id: &'static str,
    semantic_class: &'static str,
}

const EXPECTED_SOURCE_CONTRACTS: &[ExpectedSourceContract] = &[
    ExpectedSourceContract {
        id: "runtime-context",
        symbol: "CoopRuntimeContext",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:67",
        target_layer: "rust_kernel",
        fixture_id: "runtime",
        semantic_class: "runtime-boundary",
    },
    ExpectedSourceContract {
        id: "frame-context",
        symbol: "CoopFrameContextV2",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:110",
        target_layer: "rust_types",
        fixture_id: "frames",
        semantic_class: "frame-identity",
    },
    ExpectedSourceContract {
        id: "authority-entry",
        symbol: "CoopAuthorityEntry",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:156",
        target_layer: "rust_types",
        fixture_id: "log",
        semantic_class: "entry-identity",
    },
    ExpectedSourceContract {
        id: "authoritative-material",
        symbol: "CoopAuthoritativeMaterial",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:150",
        target_layer: "rust_types",
        fixture_id: "turn",
        semantic_class: "opaque-material",
    },
    ExpectedSourceContract {
        id: "authority-receipt",
        symbol: "CoopAuthorityReceipt",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:172",
        target_layer: "rust_types",
        fixture_id: "duo-delivery",
        semantic_class: "receipt-stage",
    },
    ExpectedSourceContract {
        id: "next-control",
        symbol: "CoopNextControl",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:272",
        target_layer: "rust_types",
        fixture_id: "control",
        semantic_class: "successor-control",
    },
    ExpectedSourceContract {
        id: "command-control-target",
        symbol: "CoopCommandControlTarget",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:253",
        target_layer: "rust_types",
        fixture_id: "command-frontier",
        semantic_class: "command-ownership",
    },
    ExpectedSourceContract {
        id: "replacement-control-address",
        symbol: "CoopReplacementControlAddress",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:260",
        target_layer: "rust_types",
        fixture_id: "replacement",
        semantic_class: "replacement-address",
    },
    ExpectedSourceContract {
        id: "shared-interaction-control",
        symbol: "SharedInteractionControl",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:295",
        target_layer: "rust_types",
        fixture_id: "interaction-control-ledger",
        semantic_class: "interaction-control",
    },
    ExpectedSourceContract {
        id: "await-successor-control",
        symbol: "AwaitSuccessorControl",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:324",
        target_layer: "rust_types",
        fixture_id: "control",
        semantic_class: "ordered-wait",
    },
    ExpectedSourceContract {
        id: "terminal-control",
        symbol: "TerminalControl",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:371",
        target_layer: "rust_types",
        fixture_id: "wave",
        semantic_class: "terminal-control",
    },
    ExpectedSourceContract {
        id: "frame-v2",
        symbol: "CoopFrameV2",
        source: "src/data/elite-redux/coop/authority-v2/frame-codec.ts:146",
        target_layer: "rust_types",
        fixture_id: "frames",
        semantic_class: "wire-envelope",
    },
    ExpectedSourceContract {
        id: "recovery-request",
        symbol: "CoopRecoveryRequestV2",
        source: "src/data/elite-redux/coop/authority-v2/recovery-bundle.ts:41",
        target_layer: "rust_types",
        fixture_id: "recovery-channel",
        semantic_class: "recovery-request",
    },
    ExpectedSourceContract {
        id: "recovery-bundle",
        symbol: "CoopRecoveryBundle",
        source: "src/data/elite-redux/coop/authority-v2/recovery-bundle.ts:59",
        target_layer: "rust_types",
        fixture_id: "recovery",
        semantic_class: "recovery-bundle",
    },
    ExpectedSourceContract {
        id: "recovery-applied-proof",
        symbol: "CoopRecoveryAppliedProofV2",
        source: "src/data/elite-redux/coop/authority-v2/recovery-bundle.ts:48",
        target_layer: "rust_types",
        fixture_id: "recovery-channel",
        semantic_class: "recovery-proof",
    },
    ExpectedSourceContract {
        id: "turn-resolution-image",
        symbol: "TurnResolutionImage",
        source: "src/data/elite-redux/coop/authority-v2/adapters/turn-command.ts:83",
        target_layer: "browser_adapter",
        fixture_id: "turn",
        semantic_class: "turn-adapter-material",
    },
    ExpectedSourceContract {
        id: "replacement-proposal",
        symbol: "ReplacementProposal|ReplacementCommitImage",
        source: "src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts:65",
        target_layer: "browser_adapter",
        fixture_id: "replacement",
        semantic_class: "replacement-adapter-material",
    },
    ExpectedSourceContract {
        id: "wave-terminal-material",
        symbol: "CoopWaveTransitionMaterialV2|CoopTerminalMaterialV2",
        source: "src/data/elite-redux/coop/authority-v2/adapters/wave-terminal.ts:98",
        target_layer: "browser_adapter",
        fixture_id: "wave",
        semantic_class: "wave-terminal-material",
    },
    ExpectedSourceContract {
        id: "control-open-material",
        symbol: "CoopCommandOpenMaterialV2|CoopInteractionOpenMaterialV2",
        source: "src/data/elite-redux/coop/authority-v2/adapters/control-open.ts:27",
        target_layer: "browser_adapter",
        fixture_id: "control-open",
        semantic_class: "control-open-material",
    },
    ExpectedSourceContract {
        id: "interaction-envelope",
        symbol: "CoopV2InteractionEnvelopeMaterial",
        source: "src/data/elite-redux/coop/authority-v2/cutover-interaction.ts:101",
        target_layer: "browser_adapter",
        fixture_id: "cutover-interaction",
        semantic_class: "interaction-envelope",
    },
    ExpectedSourceContract {
        id: "interaction-material",
        symbol: "CoopInteractionMaterial families",
        source: "src/data/elite-redux/coop/authority-v2/adapters/interactions-learn.ts:96; src/data/elite-redux/coop/authority-v2/adapters/interactions-mystery.ts:219; src/data/elite-redux/coop/authority-v2/adapters/interactions-reward.ts:224",
        target_layer: "browser_adapter",
        fixture_id: "interactions-learn",
        semantic_class: "interaction-material-families",
    },
    ExpectedSourceContract {
        id: "interaction-projection-plan",
        symbol: "CoopV2InteractionProjectionPlan",
        source: "src/data/elite-redux/coop/authority-v2/interaction-projection.ts:41",
        target_layer: "browser_adapter",
        fixture_id: "interaction-projection",
        semantic_class: "closed-projection-plan",
    },
    ExpectedSourceContract {
        id: "proposal-admission-lease",
        symbol: "CoopV2ProposalAdmissionLedger|CoopV2ProposalLeaseManager",
        source: "src/data/elite-redux/coop/authority-v2/proposal-admission.ts:19; src/data/elite-redux/coop/authority-v2/proposal-lease.ts:32",
        target_layer: "rust_kernel",
        fixture_id: "proposal-admission",
        semantic_class: "proposal-identity-and-lease",
    },
    ExpectedSourceContract {
        id: "recovery-fence",
        symbol: "CoopRecoveryFence",
        source: "src/data/elite-redux/coop/authority-v2/recovery-fence.ts:41",
        target_layer: "rust_kernel",
        fixture_id: "recovery",
        semantic_class: "recovery-fence",
    },
    ExpectedSourceContract {
        id: "authority-ledger",
        symbol: "AuthorityLedger + BoundedRevisionWindow",
        source: "src/data/elite-redux/coop/authority-v2/authority-ledger.ts:50",
        target_layer: "rust_kernel",
        fixture_id: "log",
        semantic_class: "frontier-and-retention",
    },
    ExpectedSourceContract {
        id: "control-install-result",
        symbol: "CoopControlInstallResult + CoopV2InteractionSurfaceObservation",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:379; src/data/elite-redux/coop/authority-v2/control-ledger.ts:29",
        target_layer: "browser_adapter",
        fixture_id: "control",
        semantic_class: "control-install-boundary",
    },
    ExpectedSourceContract {
        id: "inbound-frame-result",
        symbol: "CoopInboundFrameResultV2",
        source: "src/data/elite-redux/coop/authority-v2/protocol-validator.ts:56",
        target_layer: "rust_kernel",
        fixture_id: "frames",
        semantic_class: "inbound-classification",
    },
    ExpectedSourceContract {
        id: "scheduler-timer-owner",
        symbol: "CoopScheduler + CoopTimerOwner",
        source: "src/data/elite-redux/coop/authority-v2/contract.ts:89; src/data/elite-redux/coop/authority-v2/scheduler.ts:119",
        target_layer: "rust_kernel",
        fixture_id: "runtime",
        semantic_class: "timer-ownership",
    },
    ExpectedSourceContract {
        id: "session-identity",
        symbol: "CoopV2SessionIdentity",
        source: "src/data/elite-redux/coop/authority-v2/session-identity.ts:32",
        target_layer: "browser_adapter",
        fixture_id: "session-identity",
        semantic_class: "session-binding",
    },
];

#[derive(Debug, Clone, Copy)]
struct ExpectedNodeContract {
    id: &'static str,
    source: &'static str,
    fixture_id: &'static str,
    semantic_class: &'static str,
    implementation_kind: &'static str,
}

const EXPECTED_NODE_CONTRACTS: &[ExpectedNodeContract] = &[
    ExpectedNodeContract {
        id: "command-frontier",
        source: "test/node/authority-v2-command-frontier.test.ts",
        fixture_id: "command-frontier",
        semantic_class: "mechanical-control",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "control-open",
        source: "test/node/authority-v2-control-open.test.ts",
        fixture_id: "control-open",
        semantic_class: "entry-material",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "control",
        source: "test/node/authority-v2-control.test.ts",
        fixture_id: "control",
        semantic_class: "control-identity-and-projection",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "cutover-interaction",
        source: "test/node/authority-v2-cutover-interaction.test.ts",
        fixture_id: "cutover-interaction",
        semantic_class: "adapter-cutover",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "cutover-replacement",
        source: "test/node/authority-v2-cutover-replacement.test.ts",
        fixture_id: "cutover-replacement",
        semantic_class: "adapter-cutover",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "cutover-turn",
        source: "test/node/authority-v2-cutover-turn.test.ts",
        fixture_id: "cutover-turn",
        semantic_class: "adapter-cutover",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "cutover-wave",
        source: "test/node/authority-v2-cutover-wave.test.ts",
        fixture_id: "cutover-wave",
        semantic_class: "adapter-cutover",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "duo-delivery",
        source: "test/node/authority-v2-duo-delivery.test.ts",
        fixture_id: "duo-delivery",
        semantic_class: "delivery-and-receipts",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "faint-replacement-command-open",
        source: "test/node/authority-v2-faint-replacement-command-open.test.ts",
        fixture_id: "faint-replacement-command-open",
        semantic_class: "successor-authorization",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "frames",
        source: "test/node/authority-v2-frames.test.ts",
        fixture_id: "frames",
        semantic_class: "raw-frame-boundary",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "interaction-control-ledger",
        source: "test/node/authority-v2-interaction-control-ledger.test.ts",
        fixture_id: "interaction-control-ledger",
        semantic_class: "control-claim-ownership",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "interaction-projection",
        source: "test/node/authority-v2-interaction-projection.test.ts",
        fixture_id: "interaction-projection",
        semantic_class: "closed-projection",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "interactions-learn",
        source: "test/node/authority-v2-interactions-learn.test.ts",
        fixture_id: "interactions-learn",
        semantic_class: "interaction-material",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "interactions-mystery",
        source: "test/node/authority-v2-interactions-mystery.test.ts",
        fixture_id: "interactions-mystery",
        semantic_class: "interaction-material",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "interactions-reward",
        source: "test/node/authority-v2-interactions-reward.test.ts",
        fixture_id: "interactions-reward",
        semantic_class: "interaction-material",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "log",
        source: "test/node/authority-v2-log.test.ts",
        fixture_id: "log",
        semantic_class: "authority-log",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "mutation-ledger",
        source: "test/node/authority-v2-mutation-ledger.test.ts",
        fixture_id: "mutation-ledger",
        semantic_class: "mutation-barrier-boundary",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "proposal-admission",
        source: "test/node/authority-v2-proposal-admission.test.ts",
        fixture_id: "proposal-admission",
        semantic_class: "proposal-admission",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "proposal-lease",
        source: "test/node/authority-v2-proposal-lease.test.ts",
        fixture_id: "proposal-lease",
        semantic_class: "proposal-lease",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "recovery-channel",
        source: "test/node/authority-v2-recovery-channel.test.ts",
        fixture_id: "recovery-channel",
        semantic_class: "recovery-channel",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "recovery",
        source: "test/node/authority-v2-recovery.test.ts",
        fixture_id: "recovery",
        semantic_class: "recovery-transaction",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "replacement",
        source: "test/node/authority-v2-replacement.test.ts",
        fixture_id: "replacement",
        semantic_class: "replacement-material-and-control",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "runtime",
        source: "test/node/authority-v2-runtime.test.ts",
        fixture_id: "runtime",
        semantic_class: "scheduler-and-lifecycle",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "scheduler-clock-seam",
        source: "test/node/authority-v2-scheduler-clock-seam.test.ts",
        fixture_id: "scheduler-clock-seam",
        semantic_class: "deterministic-clock-seam",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "session-identity",
        source: "test/node/authority-v2-session-identity.test.ts",
        fixture_id: "session-identity",
        semantic_class: "authenticated-identity",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "shadow",
        source: "test/node/authority-v2-shadow.test.ts",
        fixture_id: "shadow",
        semantic_class: "shadow-harness-boundary",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "simulator",
        source: "test/node/authority-v2-simulator.test.ts",
        fixture_id: "simulator",
        semantic_class: "reference-simulator",
        implementation_kind: "reference-simulator",
    },
    ExpectedNodeContract {
        id: "turn",
        source: "test/node/authority-v2-turn.test.ts",
        fixture_id: "turn",
        semantic_class: "turn-material-and-progression",
        implementation_kind: "production",
    },
    ExpectedNodeContract {
        id: "wave",
        source: "test/node/authority-v2-wave.test.ts",
        fixture_id: "wave",
        semantic_class: "wave-terminal-progression",
        implementation_kind: "production",
    },
];

#[derive(Debug, Clone, Copy)]
struct ExpectedFixture {
    id: &'static str,
    source: &'static str,
    symbols: &'static [&'static str],
    semantic_class: &'static str,
    case_ids: &'static [&'static str],
}

const EXPECTED_FIXTURES: &[ExpectedFixture] = &[
    ExpectedFixture {
        id: "command-frontier",
        source: "test/node/authority-v2-command-frontier.test.ts",
        symbols: &["CoopCommandControlTarget", "CoopNextControl"],
        semantic_class: "mechanical-control",
        case_ids: &["owned-coordinate-frontier", "showdown-coordinate-proof"],
    },
    ExpectedFixture {
        id: "control-open",
        source: "test/node/authority-v2-control-open.test.ts",
        symbols: &["CoopCommandOpenMaterialV2|CoopInteractionOpenMaterialV2"],
        semantic_class: "entry-material",
        case_ids: &["post-entry-effects-image"],
    },
    ExpectedFixture {
        id: "control",
        source: "test/node/authority-v2-control.test.ts",
        symbols: &[
            "CoopNextControl",
            "AwaitSuccessorControl",
            "CoopControlInstallResult + CoopV2InteractionSurfaceObservation",
        ],
        semantic_class: "control-identity-and-projection",
        case_ids: &["exact-control-address", "ordered-wait-frontier"],
    },
    ExpectedFixture {
        id: "cutover-interaction",
        source: "test/node/authority-v2-cutover-interaction.test.ts",
        symbols: &[
            "CoopV2InteractionEnvelopeMaterial",
            "CoopV2InteractionProjectionPlan",
        ],
        semantic_class: "adapter-cutover",
        case_ids: &["closed-interaction-envelope"],
    },
    ExpectedFixture {
        id: "cutover-replacement",
        source: "test/node/authority-v2-cutover-replacement.test.ts",
        symbols: &["ReplacementProposal|ReplacementCommitImage"],
        semantic_class: "adapter-cutover",
        case_ids: &["staged-replacement-carrier"],
    },
    ExpectedFixture {
        id: "cutover-turn",
        source: "test/node/authority-v2-cutover-turn.test.ts",
        symbols: &["TurnResolutionImage"],
        semantic_class: "adapter-cutover",
        case_ids: &["host-commit-context"],
    },
    ExpectedFixture {
        id: "cutover-wave",
        source: "test/node/authority-v2-cutover-wave.test.ts",
        symbols: &[
            "CoopWaveTransitionMaterialV2|CoopTerminalMaterialV2",
            "TerminalControl",
        ],
        semantic_class: "adapter-cutover",
        case_ids: &["wave-terminal-commit"],
    },
    ExpectedFixture {
        id: "duo-delivery",
        source: "test/node/authority-v2-duo-delivery.test.ts",
        symbols: &[
            "CoopAuthorityEntry",
            "CoopAuthorityReceipt",
            "AuthorityLedger + BoundedRevisionWindow",
        ],
        semantic_class: "delivery-and-receipts",
        case_ids: &["staged-receipt-delivery"],
    },
    ExpectedFixture {
        id: "faint-replacement-command-open",
        source: "test/node/authority-v2-faint-replacement-command-open.test.ts",
        symbols: &["CoopReplacementControlAddress", "AwaitSuccessorControl"],
        semantic_class: "successor-authorization",
        case_ids: &["replacement-to-command-open"],
    },
    ExpectedFixture {
        id: "frames",
        source: "test/node/authority-v2-frames.test.ts",
        symbols: &[
            "CoopFrameContextV2",
            "CoopFrameV2",
            "CoopInboundFrameResultV2",
        ],
        semantic_class: "raw-frame-boundary",
        case_ids: &["mandatory-context-and-classification"],
    },
    ExpectedFixture {
        id: "interaction-control-ledger",
        source: "test/node/authority-v2-interaction-control-ledger.test.ts",
        symbols: &[
            "SharedInteractionControl",
            "CoopControlInstallResult + CoopV2InteractionSurfaceObservation",
        ],
        semantic_class: "control-claim-ownership",
        case_ids: &["address-exact-interaction-claim"],
    },
    ExpectedFixture {
        id: "interaction-projection",
        source: "test/node/authority-v2-interaction-projection.test.ts",
        symbols: &["CoopV2InteractionProjectionPlan"],
        semantic_class: "closed-projection",
        case_ids: &["immutable-plan-decode"],
    },
    ExpectedFixture {
        id: "interactions-learn",
        source: "test/node/authority-v2-interactions-learn.test.ts",
        symbols: &["CoopInteractionMaterial families"],
        semantic_class: "interaction-material",
        case_ids: &["learn-material-digest-boundary", "family-nullability"],
    },
    ExpectedFixture {
        id: "interactions-mystery",
        source: "test/node/authority-v2-interactions-mystery.test.ts",
        symbols: &["CoopInteractionMaterial families"],
        semantic_class: "interaction-material",
        case_ids: &["mystery-window-boundary"],
    },
    ExpectedFixture {
        id: "interactions-reward",
        source: "test/node/authority-v2-interactions-reward.test.ts",
        symbols: &["CoopInteractionMaterial families"],
        semantic_class: "interaction-material",
        case_ids: &["reward-rollback-boundary"],
    },
    ExpectedFixture {
        id: "log",
        source: "test/node/authority-v2-log.test.ts",
        symbols: &[
            "CoopAuthorityEntry",
            "AuthorityLedger + BoundedRevisionWindow",
        ],
        semantic_class: "authority-log",
        case_ids: &["revision-retention-quorum"],
    },
    ExpectedFixture {
        id: "mutation-ledger",
        source: "test/node/authority-v2-mutation-ledger.test.ts",
        symbols: &["CoopRuntimeContext", "CoopAuthorityEntry"],
        semantic_class: "mutation-barrier-boundary",
        case_ids: &["mutation-token-gate"],
    },
    ExpectedFixture {
        id: "proposal-admission",
        source: "test/node/authority-v2-proposal-admission.test.ts",
        symbols: &["CoopV2ProposalAdmissionLedger|CoopV2ProposalLeaseManager"],
        semantic_class: "proposal-admission",
        case_ids: &["duplicate-conflict-capacity"],
    },
    ExpectedFixture {
        id: "proposal-lease",
        source: "test/node/authority-v2-proposal-lease.test.ts",
        symbols: &["CoopV2ProposalAdmissionLedger|CoopV2ProposalLeaseManager"],
        semantic_class: "proposal-lease",
        case_ids: &["bounded-retry-and-closure"],
    },
    ExpectedFixture {
        id: "recovery-channel",
        source: "test/node/authority-v2-recovery-channel.test.ts",
        symbols: &["CoopRecoveryRequestV2", "CoopRecoveryAppliedProofV2"],
        semantic_class: "recovery-channel",
        case_ids: &["correlated-request-proof"],
    },
    ExpectedFixture {
        id: "recovery",
        source: "test/node/authority-v2-recovery.test.ts",
        symbols: &["CoopRecoveryBundle", "CoopRecoveryFence"],
        semantic_class: "recovery-transaction",
        case_ids: &["fence-before-request", "revision-zero-nullability"],
    },
    ExpectedFixture {
        id: "replacement",
        source: "test/node/authority-v2-replacement.test.ts",
        symbols: &[
            "ReplacementProposal|ReplacementCommitImage",
            "CoopReplacementControlAddress",
        ],
        semantic_class: "replacement-material-and-control",
        case_ids: &["ordered-replacement-chain"],
    },
    ExpectedFixture {
        id: "runtime",
        source: "test/node/authority-v2-runtime.test.ts",
        symbols: &["CoopRuntimeContext", "CoopScheduler + CoopTimerOwner"],
        semantic_class: "scheduler-and-lifecycle",
        case_ids: &["timer-metadata-and-disposal"],
    },
    ExpectedFixture {
        id: "scheduler-clock-seam",
        source: "test/node/authority-v2-scheduler-clock-seam.test.ts",
        symbols: &["CoopScheduler + CoopTimerOwner"],
        semantic_class: "deterministic-clock-seam",
        case_ids: &["connected-time-retry"],
    },
    ExpectedFixture {
        id: "session-identity",
        source: "test/node/authority-v2-session-identity.test.ts",
        symbols: &["CoopV2SessionIdentity"],
        semantic_class: "authenticated-identity",
        case_ids: &["frame-identity-binding"],
    },
    ExpectedFixture {
        id: "shadow",
        source: "test/node/authority-v2-shadow.test.ts",
        symbols: &[
            "CoopAuthorityEntry",
            "CoopRecoveryBundle",
            "CoopV2InteractionEnvelopeMaterial",
        ],
        semantic_class: "shadow-harness-boundary",
        case_ids: &["tap-routing-and-disposal"],
    },
    ExpectedFixture {
        id: "simulator",
        source: "test/node/authority-v2-simulator.test.ts",
        symbols: &[
            "CoopAuthorityEntry",
            "CoopNextControl",
            "CoopRecoveryBundle",
        ],
        semantic_class: "reference-simulator",
        case_ids: &["seeded-fault-oracle"],
    },
    ExpectedFixture {
        id: "turn",
        source: "test/node/authority-v2-turn.test.ts",
        symbols: &[
            "TurnResolutionImage",
            "CoopAuthorityEntry",
            "CoopAuthoritativeMaterial",
        ],
        semantic_class: "turn-material-and-progression",
        case_ids: &["turn-entry-stages"],
    },
    ExpectedFixture {
        id: "wave",
        source: "test/node/authority-v2-wave.test.ts",
        symbols: &[
            "CoopWaveTransitionMaterialV2|CoopTerminalMaterialV2",
            "TerminalControl",
            "CoopAuthorityEntry",
        ],
        semantic_class: "wave-terminal-progression",
        case_ids: &["terminal-freeze-and-subsumption"],
    },
];

fn expected_fixture_source(id: &str) -> Result<&'static str, Box<dyn Error>> {
    EXPECTED_FIXTURES
        .iter()
        .find(|fixture| fixture.id == id)
        .map(|fixture| fixture.source)
        .ok_or_else(|| failure(format!("unknown expected fixture: {id}")))
}

const EXPECTED_COVERAGE_CATEGORIES: &[(&str, &[&str])] = &[
    (
        "absent-null",
        &[
            "interactions-learn#family-nullability",
            "recovery#revision-zero-nullability",
        ],
    ),
    ("enum-tag", &["wave#terminal-freeze-and-subsumption"]),
    (
        "timer-owner",
        &[
            "runtime#timer-metadata-and-disposal",
            "scheduler-clock-seam#connected-time-retry",
        ],
    ),
    (
        "canonicalization",
        &[
            "control#exact-control-address",
            "cutover-interaction#closed-interaction-envelope",
            "interactions-learn#learn-material-digest-boundary",
            "turn#turn-entry-stages",
        ],
    ),
    (
        "context",
        &[
            "cutover-turn#host-commit-context",
            "frames#mandatory-context-and-classification",
            "session-identity#frame-identity-binding",
        ],
    ),
    (
        "successor",
        &[
            "control#ordered-wait-frontier",
            "faint-replacement-command-open#replacement-to-command-open",
            "replacement#ordered-replacement-chain",
            "wave#terminal-freeze-and-subsumption",
        ],
    ),
    (
        "recovery",
        &[
            "recovery#fence-before-request",
            "recovery#revision-zero-nullability",
            "recovery-channel#correlated-request-proof",
        ],
    ),
    (
        "cleanup",
        &[
            "interactions-reward#reward-rollback-boundary",
            "log#revision-retention-quorum",
            "recovery-channel#correlated-request-proof",
            "runtime#timer-metadata-and-disposal",
            "shadow#tap-routing-and-disposal",
        ],
    ),
];

const EXPECTED_FUTURE_M2B_OWNERS: &[(&str, &str, &str)] = &[
    ("source_lock_contract", "turn-resolution-image", "M2B-04"),
    ("source_lock_contract", "replacement-proposal", "M2B-05"),
    ("source_lock_contract", "wave-terminal-material", "M2B-01"),
    ("source_lock_contract", "control-open-material", "M2B-01"),
    ("source_lock_contract", "interaction-envelope", "M2B-06"),
    ("source_lock_contract", "interaction-material", "M2B-06"),
    (
        "source_lock_contract",
        "interaction-projection-plan",
        "M2B-06",
    ),
    ("source_lock_contract", "control-install-result", "M2B-06"),
    ("source_lock_contract", "session-identity", "M2B-08"),
    ("node_contract", "cutover-interaction", "M2B-06"),
    ("node_contract", "cutover-replacement", "M2B-05"),
    ("node_contract", "cutover-turn", "M2B-04"),
    ("node_contract", "cutover-wave", "M2B-01"),
    ("node_contract", "interaction-control-ledger", "M2B-06"),
    ("node_contract", "interaction-projection", "M2B-06"),
    ("node_contract", "interactions-learn", "M2B-06"),
    ("node_contract", "interactions-mystery", "M2B-06"),
    ("node_contract", "interactions-reward", "M2B-06"),
    ("node_contract", "mutation-ledger", "M2B-01"),
    ("node_contract", "session-identity", "M2B-08"),
    ("node_contract", "shadow", "M2B-09"),
    ("node_contract", "simulator", "M2B-09"),
];

type TestResult = Result<(), Box<dyn Error>>;

#[derive(Debug)]
struct ContractMapError(String);

impl Display for ContractMapError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for ContractMapError {}

fn failure(message: impl Into<String>) -> Box<dyn Error> {
    Box::new(ContractMapError(message.into()))
}

fn parse_json(raw: &str) -> Result<Value, serde_json::Error> {
    serde_json::from_str(raw)
}

fn array<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>, Box<dyn Error>> {
    value
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| failure(format!("{field} must be a JSON array")))
}

fn string_field<'a>(value: &'a Value, field: &str) -> Result<&'a str, Box<dyn Error>> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| failure(format!("{field} must be a JSON string")))
}

fn fixture_id(reference: &str) -> Result<&str, Box<dyn Error>> {
    let Some((path, id)) = reference.split_once('#') else {
        return Err(failure(format!(
            "fixture reference has no fragment: {reference}"
        )));
    };
    if path != PARITY_FIXTURE_PATH.trim_end_matches('#') || id.is_empty() || id.contains('#') {
        return Err(failure(format!(
            "fixture reference has the wrong path: {reference}"
        )));
    }
    Ok(id)
}

fn fixture_record<'a>(fixtures: &'a [Value], id: &str) -> Result<&'a Value, Box<dyn Error>> {
    let mut found = None;
    for fixture in fixtures {
        if fixture.get("fixture_id").and_then(Value::as_str) != Some(id) {
            continue;
        }
        if found.is_some() {
            return Err(failure(format!("duplicate fixture ID: {id}")));
        }
        found = Some(fixture);
    }
    found.ok_or_else(|| failure(format!("fixture {id} is missing")))
}

fn expected_evidence_path(prefix: &str, id: &str) -> String {
    format!("{EVIDENCE_PATH}{prefix}_{}", id.replace('-', "_"))
}

fn assert_exact_string_array(value: &Value, field: &str, expected: &[&str]) -> TestResult {
    let actual = array(value, field)?;
    assert_exact_strings(actual, field, expected)
}

fn assert_exact_strings(actual: &[Value], label: &str, expected: &[&str]) -> TestResult {
    assert_eq!(
        actual.len(),
        expected.len(),
        "{label} count is stale or incomplete"
    );
    for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
        assert_eq!(
            actual.as_str(),
            Some(*expected),
            "{label}[{index}] is stale or out of order"
        );
    }
    Ok(())
}

fn assert_unique_field(records: &[Value], field: &str) -> TestResult {
    let mut values = BTreeSet::new();
    for record in records {
        let value = string_field(record, field)?;
        assert!(values.insert(value), "duplicate {field} entry: {value}");
    }
    Ok(())
}

fn assert_concrete_rust_targets(value: &Value, field: &str) -> TestResult {
    let targets = array(value, field)?;
    assert!(!targets.is_empty(), "{field} must not be empty");
    let mut seen = BTreeSet::new();
    for target in targets {
        let target = target
            .as_str()
            .ok_or_else(|| failure(format!("{field} contains a non-string target")))?;
        assert!(seen.insert(target), "duplicate {field} target: {target}");
        let Some((path, symbol)) = target.split_once("::") else {
            return Err(failure(format!("{field} target is module-only: {target}")));
        };
        assert!(
            path.starts_with("rust/crates/"),
            "non-Rust target: {target}"
        );
        assert!(
            path.ends_with(".rs"),
            "Rust target must name a source file: {target}"
        );
        assert!(
            FROZEN_RUST_TARGET_FILES.contains(&path),
            "Rust target is outside the frozen DTO/stub inventory: {target}"
        );
        assert!(
            !symbol.is_empty(),
            "Rust target must name a symbol: {target}"
        );
        assert!(
            symbol.split("::").all(|segment| !segment.is_empty()),
            "Rust target has an empty symbol segment: {target}"
        );
        assert!(
            !symbol.contains("placeholder"),
            "placeholder Rust target: {target}"
        );
        assert!(!symbol.contains("pending"), "pending Rust target: {target}");
    }
    Ok(())
}

fn assert_static_status(value: &Value, field: &str) -> TestResult {
    let status = string_field(value, field)?;
    for forbidden in ["pass", "green", "complete"] {
        assert!(
            !status.to_ascii_lowercase().contains(forbidden),
            "status must not claim unimplemented behavior: {status}"
        );
    }
    let reason = string_field(value, "reason")?;
    assert!(!reason.trim().is_empty(), "status reason must be explicit");
    Ok(())
}

fn assert_fixture_case_shape(fixture: &Value) -> TestResult {
    let cases = array(fixture, "cases")?;
    assert!(!cases.is_empty(), "fixture must contain concrete cases");
    assert_unique_field(cases, "case_id")?;
    for case in cases {
        let case_id = string_field(case, "case_id")?;
        assert!(!case_id.is_empty(), "fixture case ID must not be empty");
        let rust_types = array(case, "rust_types")?;
        assert!(
            !rust_types.is_empty(),
            "fixture case must name Rust types/symbols"
        );
        for rust_type in rust_types {
            let rust_type = rust_type.as_str().ok_or_else(|| {
                failure(format!(
                    "fixture case {case_id} has a non-string Rust target"
                ))
            })?;
            assert!(
                rust_type.contains("::"),
                "fixture case target is vague: {rust_type}"
            );
            assert!(
                rust_type.starts_with("er_types::") || rust_type.starts_with("er_protocol::"),
                "fixture case target is outside the frozen Rust crates: {rust_type}"
            );
        }
        assert!(!string_field(case, "rust_assertion")?.trim().is_empty());
        assert!(!string_field(case, "oracle_boundary")?.trim().is_empty());
    }
    Ok(())
}

fn validate_source_lock() -> TestResult {
    let expected = [
        ("oracle_game_sha", ORACLE_GAME_SHA),
        ("oracle_branch", ORACLE_BRANCH),
        ("protocol_version", ORACLE_PROTOCOL_VERSION),
        ("schema_version", "1"),
        ("input_repeat_delay_ms", "250"),
        ("input_repeat_interval_ms", "250"),
    ];
    let mut seen = BTreeSet::new();
    for line in SOURCE_LOCK.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, raw_value)) = line.split_once('=') else {
            return Err(failure(format!(
                "source-lock line is not a key/value: {line}"
            )));
        };
        let key = key.trim();
        let raw_value = raw_value.trim();
        let expected_value = expected
            .iter()
            .find(|(expected_key, _)| *expected_key == key)
            .map(|(_, value)| *value)
            .ok_or_else(|| failure(format!("unexpected source-lock key: {key}")))?;
        assert!(seen.insert(key), "duplicate source-lock key: {key}");
        let value = raw_value
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .unwrap_or(raw_value);
        assert_eq!(value, expected_value, "source-lock value drifted: {key}");
    }
    assert_eq!(
        seen.len(),
        expected.len(),
        "source-lock fields are incomplete"
    );
    Ok(())
}

fn coverage_case<'a>(fixtures: &'a [Value], reference: &str) -> Result<&'a Value, Box<dyn Error>> {
    let Some((fixture_id, case_id)) = reference.split_once('#') else {
        return Err(failure(format!(
            "coverage reference has no case: {reference}"
        )));
    };
    if fixture_id.is_empty() || case_id.is_empty() || case_id.contains('#') {
        return Err(failure(format!(
            "coverage reference is malformed: {reference}"
        )));
    }
    let fixture = fixture_record(fixtures, fixture_id)?;
    let cases = array(fixture, "cases")?;
    let mut found = None;
    for case in cases {
        if case.get("case_id").and_then(Value::as_str) != Some(case_id) {
            continue;
        }
        if found.is_some() {
            return Err(failure(format!("duplicate coverage case: {reference}")));
        }
        found = Some(case);
    }
    found.ok_or_else(|| failure(format!("coverage case is missing: {reference}")))
}

fn validate_coverage_categories(value: &Value, fixtures: &[Value]) -> TestResult {
    let categories = value
        .get("coverage_categories")
        .and_then(Value::as_object)
        .ok_or_else(|| failure("coverage_categories must be a JSON object"))?;
    assert_eq!(
        categories.len(),
        EXPECTED_COVERAGE_CATEGORIES.len(),
        "coverage category inventory is stale"
    );
    for (category, expected_references) in EXPECTED_COVERAGE_CATEGORIES {
        let actual = categories
            .get(*category)
            .ok_or_else(|| failure(format!("coverage category is missing: {category}")))?;
        let actual = actual
            .as_array()
            .ok_or_else(|| failure(format!("{category} must be a JSON array")))?;
        assert_exact_strings(actual, category, expected_references)?;
        let mut references = BTreeSet::new();
        for &reference in *expected_references {
            assert!(
                references.insert(reference),
                "duplicate expected coverage reference: {reference}"
            );
            let _ = coverage_case(fixtures, reference)?;
        }
    }
    for category in categories.keys() {
        assert!(
            EXPECTED_COVERAGE_CATEGORIES
                .iter()
                .any(|(expected, _)| *expected == category.as_str()),
            "stale coverage category: {category}"
        );
    }
    Ok(())
}

fn expected_future_owner(scope: &str, id: &str) -> Option<&'static str> {
    EXPECTED_FUTURE_M2B_OWNERS
        .iter()
        .find(|(expected_scope, expected_id, _)| *expected_scope == scope && *expected_id == id)
        .map(|(_, _, owner)| *owner)
}

fn validate_future_m2b_owners(
    map: &Value,
    source_contracts: &[Value],
    node_contracts: &[Value],
) -> TestResult {
    let owners = array(map, "future_m2b_evidence_owners")?;
    assert_eq!(
        owners.len(),
        EXPECTED_FUTURE_M2B_OWNERS.len(),
        "future-M2B evidence ownership is incomplete"
    );
    let mut seen = BTreeSet::new();
    for (owner, expected) in owners.iter().zip(EXPECTED_FUTURE_M2B_OWNERS) {
        let scope = string_field(owner, "scope")?;
        let id = string_field(owner, "id")?;
        let value = string_field(owner, "owner")?;
        assert_eq!(scope, expected.0, "future-M2B owner scope is stale");
        assert_eq!(id, expected.1, "future-M2B owner ID is stale");
        assert_eq!(value, expected.2, "future-M2B owner lane is stale");
        let key = format!("{scope}#{id}");
        assert!(seen.insert(key), "duplicate future-M2B owner assignment");
        assert!(
            value.starts_with("M2B-"),
            "future evidence owner must be an M2B lane: {value}"
        );
    }
    let expected_keys: BTreeSet<String> = EXPECTED_FUTURE_M2B_OWNERS
        .iter()
        .map(|(scope, id, _)| format!("{scope}#{id}"))
        .collect();
    assert_eq!(seen, expected_keys, "future-M2B assignments are not exact");

    for contract in source_contracts {
        let id = string_field(contract, "id")?;
        let target_layer = string_field(contract, "target_layer")?;
        let expected_owner = expected_future_owner("source_lock_contract", id);
        assert_eq!(
            expected_owner.is_some(),
            target_layer == "browser_adapter",
            "source contract future ownership does not match target layer: {id}"
        );
    }
    for contract in node_contracts {
        let id = string_field(contract, "id")?;
        let status = string_field(contract, "status")?;
        let expected_owner = expected_future_owner("node_contract", id);
        let future_status =
            status.starts_with("boundary-") || status.starts_with("reference-only-");
        assert_eq!(
            expected_owner.is_some(),
            future_status,
            "node contract future ownership does not match status: {id}"
        );
    }
    Ok(())
}

fn validate_fixture_payload(map: &Value, fixture_root: &Value) -> TestResult {
    assert_eq!(
        fixture_root.get("schema_version").and_then(Value::as_u64),
        Some(SOURCE_SCHEMA_VERSION)
    );
    assert_eq!(string_field(fixture_root, "project_name")?, PROJECT_NAME);
    assert_eq!(
        string_field(fixture_root, "fixture_kind")?,
        "authority-v2-contract-evidence-v1"
    );
    assert_eq!(
        string_field(fixture_root, "authority_contract")?,
        AUTHORITY_CONTRACT
    );
    assert_eq!(
        string_field(fixture_root, "oracle_game_sha")?,
        ORACLE_GAME_SHA
    );
    assert_eq!(string_field(fixture_root, "oracle_branch")?, ORACLE_BRANCH);
    assert_eq!(
        string_field(fixture_root, "protocol_version")?,
        PROTOCOL_VERSION
    );
    assert_eq!(
        fixture_root
            .get("frame_protocol_version")
            .and_then(Value::as_u64),
        Some(FRAME_PROTOCOL_VERSION)
    );
    assert_eq!(
        string_field(fixture_root, "source_oracle")?,
        "schemas/kernel/source/authority-v2-map-v1.json"
    );

    let payload = fixture_root
        .get("payload")
        .ok_or_else(|| failure("fixture payload is missing"))?;
    let fixtures = payload
        .as_array()
        .ok_or_else(|| failure("fixture payload must be an array"))?;
    assert_eq!(fixtures.len(), EXPECTED_FIXTURES.len());
    assert_unique_field(fixtures, "fixture_id")?;
    assert_unique_field(fixtures, "typescript_source")?;
    let expected_digest = string_field(fixture_root, "canonical_digest")?;
    assert_eq!(expected_digest, EXPECTED_CANONICAL_DIGEST);
    let actual_digest = fixture_digest(payload)?;
    assert_eq!(actual_digest, EXPECTED_CANONICAL_DIGEST);

    let node_contracts = array(map, "node_contracts")?;
    assert_eq!(node_contracts.len(), EXPECTED_FIXTURES.len());
    for ((node, fixture), expected) in node_contracts.iter().zip(fixtures).zip(EXPECTED_FIXTURES) {
        assert_eq!(string_field(node, "id")?, expected.id);
        assert_eq!(string_field(node, "typescript_source")?, expected.source);
        let expected_fixture = format!("{PARITY_FIXTURE_PATH}{}", expected.id);
        assert_eq!(
            string_field(node, "parity_fixture")?,
            expected_fixture.as_str()
        );
        assert_eq!(string_field(fixture, "fixture_id")?, expected.id);
        assert_eq!(string_field(fixture, "typescript_source")?, expected.source);
        assert_eq!(
            string_field(fixture, "semantic_class")?,
            expected.semantic_class
        );
        assert_exact_string_array(fixture, "source_lock_symbols", expected.symbols)?;
        assert_fixture_case_shape(fixture)?;
        let cases = array(fixture, "cases")?;
        assert_eq!(cases.len(), expected.case_ids.len());
        for (case, expected_case_id) in cases.iter().zip(expected.case_ids) {
            assert_eq!(string_field(case, "case_id")?, *expected_case_id);
        }
    }

    let source_lock_contracts = array(map, "source_lock_contracts")?;
    for contract in source_lock_contracts {
        let reference = string_field(contract, "parity_fixture")?;
        let id = fixture_id(reference)?;
        let fixture = fixture_record(fixtures, id)?;
        let symbol = string_field(contract, "source_lock_symbol")?;
        let symbols = array(fixture, "source_lock_symbols")?;
        assert!(
            symbols
                .iter()
                .any(|candidate| candidate.as_str() == Some(symbol)),
            "fixture {id} does not carry source-lock symbol {symbol}"
        );
    }
    validate_coverage_categories(fixture_root, fixtures)?;
    Ok(())
}

fn validate_source_lock_contracts(map: &Value, oracle: &Value, fixtures: &[Value]) -> TestResult {
    let contracts = array(map, "source_lock_contracts")?;
    let schemas = array(oracle, "schemas")?;
    assert_eq!(contracts.len(), EXPECTED_SOURCE_CONTRACTS.len());
    assert_eq!(schemas.len(), EXPECTED_SCHEMA_CONTRACT_COUNT);

    let mut ids = BTreeSet::new();
    let mut symbols = BTreeSet::new();
    let mut sources = BTreeSet::new();
    let mut evidence = BTreeSet::new();
    for ((contract, schema), expected) in
        contracts.iter().zip(schemas).zip(EXPECTED_SOURCE_CONTRACTS)
    {
        let id = string_field(contract, "id")?;
        let symbol = string_field(contract, "source_lock_symbol")?;
        let source = string_field(contract, "typescript_source")?;
        assert_eq!(
            id, expected.id,
            "source-lock contract ID is stale or reordered"
        );
        assert_eq!(
            symbol, expected.symbol,
            "source-lock symbol is stale or reordered"
        );
        assert_eq!(
            source, expected.source,
            "source-lock path is stale or reordered"
        );
        assert_eq!(
            string_field(contract, "target_layer")?,
            expected.target_layer
        );
        assert_eq!(
            string_field(contract, "semantic_class")?,
            expected.semantic_class
        );
        assert!(ids.insert(id), "duplicate source-lock ID: {id}");
        assert!(
            symbols.insert(symbol),
            "duplicate source-lock symbol: {symbol}"
        );
        assert!(
            sources.insert(source),
            "duplicate source-lock node: {source}"
        );
        assert!(
            evidence.insert(string_field(contract, "rust_evidence")?),
            "duplicate source-lock evidence: {id}"
        );
        assert_eq!(symbol, string_field(schema, "symbol")?);
        assert_eq!(source, string_field(schema, "source")?);
        assert_eq!(string_field(schema, "symbol")?, expected.symbol);
        assert_eq!(string_field(schema, "source")?, expected.source);
        assert_eq!(string_field(schema, "target_layer")?, expected.target_layer);
        assert_concrete_rust_targets(contract, "rust_equivalent")?;
        assert_eq!(
            string_field(contract, "rust_evidence")?,
            expected_evidence_path("source_contract", expected.id)
        );
        let fixture = string_field(contract, "parity_fixture")?;
        let expected_fixture = format!("{PARITY_FIXTURE_PATH}{}", expected.fixture_id);
        assert_eq!(fixture, expected_fixture.as_str());
        assert_eq!(fixture_id(fixture)?, expected.fixture_id);
        let fixture = fixture_record(fixtures, expected.fixture_id)?;
        assert_eq!(
            string_field(fixture, "typescript_source")?,
            expected_fixture_source(expected.fixture_id)?
        );
        assert!(
            array(fixture, "source_lock_symbols")?
                .iter()
                .any(|candidate| candidate.as_str() == Some(expected.symbol)),
            "fixture {} does not carry source-lock symbol {}",
            expected.fixture_id,
            expected.symbol
        );
        assert_static_status(contract, "status")?;
        if expected.target_layer == "browser_adapter" {
            assert!(
                !contract
                    .get("nonportable_boundary")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .is_empty(),
                "browser adapter contract requires a boundary reason: {symbol}"
            );
        }
    }
    Ok(())
}

fn validate_node_contracts(map: &Value, oracle: &Value) -> TestResult {
    let contracts = array(map, "node_contracts")?;
    let tests = array(oracle, "tests")?;
    let source_files = array(oracle, "source_files")?;
    assert_eq!(contracts.len(), EXPECTED_NODE_CONTRACTS.len());
    assert_eq!(tests.len(), EXPECTED_NODE_CONTRACTS.len());

    let mut ids = BTreeSet::new();
    let mut sources = BTreeSet::new();
    let mut evidence = BTreeSet::new();
    let mut parity_fixtures = BTreeSet::new();
    let mut production = 0;
    let mut simulator = 0;
    for ((contract, oracle_test), expected) in
        contracts.iter().zip(tests).zip(EXPECTED_NODE_CONTRACTS)
    {
        let id = string_field(contract, "id")?;
        let source = string_field(contract, "typescript_source")?;
        assert_eq!(id, expected.id, "node contract ID is stale or reordered");
        assert_eq!(
            source, expected.source,
            "node source path is stale or reordered"
        );
        assert_eq!(
            string_field(contract, "semantic_class")?,
            expected.semantic_class
        );
        assert_eq!(
            string_field(contract, "implementation_kind")?,
            expected.implementation_kind
        );
        let expected_fixture = format!("{PARITY_FIXTURE_PATH}{}", expected.fixture_id);
        assert_eq!(
            string_field(contract, "parity_fixture")?,
            expected_fixture.as_str()
        );
        assert!(ids.insert(id), "duplicate node contract ID: {id}");
        assert!(sources.insert(source), "duplicate node source: {source}");
        assert_eq!(source, string_field(oracle_test, "path")?);
        assert_eq!(
            string_field(contract, "oracle_semantics")?,
            string_field(oracle_test, "semantics")?
        );
        assert_eq!(
            string_field(contract, "oracle_covers")?,
            string_field(oracle_test, "covers")?
        );

        let source_records: Vec<&Value> = source_files
            .iter()
            .filter(|record| record.get("path").and_then(Value::as_str) == Some(source))
            .collect();
        assert_eq!(
            source_records.len(),
            1,
            "node source must be pinned exactly once: {source}"
        );
        let source_record = source_records[0];
        let expected_kind = if source.ends_with("authority-v2-simulator.test.ts") {
            "simulator-test"
        } else {
            "node-pure-test"
        };
        assert_eq!(string_field(source_record, "kind")?, expected_kind);
        assert_eq!(
            array(contract, "source_nodes")?,
            array(source_record, "citations")?
        );

        let implementation_kind = string_field(contract, "implementation_kind")?;
        if expected_kind == "simulator-test" {
            assert_eq!(implementation_kind, "reference-simulator");
            simulator += 1;
        } else {
            assert_eq!(implementation_kind, "production");
            production += 1;
        }
        assert_concrete_rust_targets(contract, "rust_equivalent")?;
        assert!(
            evidence.insert(string_field(contract, "rust_evidence")?),
            "duplicate node evidence: {id}"
        );
        assert_eq!(
            string_field(contract, "rust_evidence")?,
            expected_evidence_path("node_contract", expected.id)
        );
        let fixture = string_field(contract, "parity_fixture")?;
        assert_eq!(fixture_id(fixture)?, expected.fixture_id);
        assert!(
            parity_fixtures.insert(fixture),
            "duplicate node fixture: {fixture}"
        );
        assert_static_status(contract, "status")?;
        let status = string_field(contract, "status")?;
        if expected_future_owner("node_contract", expected.id).is_some() {
            assert!(
                status.starts_with("boundary-") || status.starts_with("reference-only-"),
                "future-M2B node must remain boundary/reference-only: {id}"
            );
        } else {
            assert_eq!(status, "mapped-static-only");
        }
        let boundary = contract
            .get("nonportable_boundary")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if status.starts_with("boundary-") || status.starts_with("reference-only-") {
            assert!(
                !boundary.trim().is_empty(),
                "boundary mapping needs a reason"
            );
        }
    }
    assert_eq!(production, EXPECTED_NODE_TEST_COUNT);
    assert_eq!(simulator, EXPECTED_SIMULATOR_TEST_COUNT);
    Ok(())
}

fn validate_map() -> TestResult {
    let map = parse_json(MAP_FIXTURE)?;
    let oracle = parse_json(SOURCE_ORACLE)?;
    let fixture_root = parse_json(PARITY_FIXTURES)?;
    validate_source_lock()?;

    assert_eq!(
        map.get("schema_version").and_then(Value::as_u64),
        Some(SOURCE_SCHEMA_VERSION)
    );
    assert_eq!(string_field(&map, "project_name")?, PROJECT_NAME);
    assert_eq!(string_field(&map, "map_id")?, "authority-v2-test-map-v1");
    assert_eq!(string_field(&map, "oracle_game_sha")?, ORACLE_GAME_SHA);
    assert_eq!(string_field(&map, "oracle_branch")?, ORACLE_BRANCH);
    assert_eq!(string_field(&map, "protocol_version")?, PROTOCOL_VERSION);
    assert_eq!(
        string_field(&map, "authority_contract")?,
        AUTHORITY_CONTRACT
    );
    assert_eq!(
        map.get("frame_protocol_version").and_then(Value::as_u64),
        Some(FRAME_PROTOCOL_VERSION)
    );
    assert_eq!(
        map.get("status_policy")
            .and_then(|value| value.get("functional_claim"))
            .and_then(Value::as_bool),
        Some(false)
    );

    let source_oracle = map
        .get("source_oracle")
        .ok_or_else(|| failure("source_oracle metadata is missing"))?;
    assert_eq!(
        string_field(source_oracle, "path")?,
        "schemas/kernel/source/authority-v2-map-v1.json"
    );
    assert_eq!(
        source_oracle.get("schema_version").and_then(Value::as_u64),
        Some(SOURCE_SCHEMA_VERSION)
    );
    assert_eq!(
        source_oracle
            .get("source_file_count")
            .and_then(Value::as_u64),
        Some(EXPECTED_SOURCE_FILE_COUNT as u64)
    );
    assert_eq!(
        source_oracle
            .get("production_module_count")
            .and_then(Value::as_u64),
        Some(EXPECTED_PRODUCTION_MODULE_COUNT as u64)
    );
    assert_eq!(
        source_oracle.get("node_test_count").and_then(Value::as_u64),
        Some((EXPECTED_NODE_TEST_COUNT + EXPECTED_SIMULATOR_TEST_COUNT) as u64)
    );
    assert_eq!(
        source_oracle
            .get("schema_contract_count")
            .and_then(Value::as_u64),
        Some(EXPECTED_SCHEMA_CONTRACT_COUNT as u64)
    );

    assert_eq!(string_field(&oracle, "project_name")?, PROJECT_NAME);
    assert_eq!(string_field(&oracle, "oracle_game_sha")?, ORACLE_GAME_SHA);
    assert_eq!(string_field(&oracle, "oracle_branch")?, ORACLE_BRANCH);
    assert_eq!(string_field(&oracle, "protocol_version")?, PROTOCOL_VERSION);
    assert_eq!(
        oracle.get("frame_protocol_version").and_then(Value::as_u64),
        Some(FRAME_PROTOCOL_VERSION)
    );
    assert_eq!(
        string_field(&oracle, "authority_contract")?,
        AUTHORITY_CONTRACT
    );

    let source_lock = map
        .get("source_lock")
        .ok_or_else(|| failure("source_lock metadata is missing"))?;
    assert_eq!(string_field(source_lock, "path")?, "rust/source-lock.toml");
    assert_eq!(
        source_lock.get("schema_version").and_then(Value::as_u64),
        Some(SOURCE_SCHEMA_VERSION)
    );
    assert_eq!(
        string_field(source_lock, "oracle_game_sha")?,
        ORACLE_GAME_SHA
    );
    assert_eq!(string_field(source_lock, "oracle_branch")?, ORACLE_BRANCH);
    assert_eq!(
        string_field(source_lock, "protocol_version")?,
        ORACLE_PROTOCOL_VERSION
    );

    let source_files = array(&oracle, "source_files")?;
    assert_eq!(source_files.len(), EXPECTED_SOURCE_FILE_COUNT);
    let mut source_paths = BTreeSet::new();
    let mut production_modules = 0;
    let mut node_tests = 0;
    let mut simulator_tests = 0;
    for source_file in source_files {
        let path = string_field(source_file, "path")?;
        assert!(
            source_paths.insert(path),
            "duplicate pinned source path: {path}"
        );
        assert_eq!(
            source_file.get("represented").and_then(Value::as_bool),
            Some(true),
            "pinned source file is not represented: {path}"
        );
        match string_field(source_file, "kind")? {
            "production" => production_modules += 1,
            "node-pure-test" => node_tests += 1,
            "simulator-test" => simulator_tests += 1,
            kind => return Err(failure(format!("unknown source-file kind: {kind}"))),
        }
    }
    assert_eq!(production_modules, EXPECTED_PRODUCTION_MODULE_COUNT);
    assert_eq!(node_tests, EXPECTED_NODE_TEST_COUNT);
    assert_eq!(simulator_tests, EXPECTED_SIMULATOR_TEST_COUNT);

    let fixtures = array(&fixture_root, "payload")?;
    validate_source_lock_contracts(&map, &oracle, fixtures)?;
    validate_node_contracts(&map, &oracle)?;
    validate_fixture_payload(&map, &fixture_root)?;
    validate_coverage_categories(&map, fixtures)?;
    validate_future_m2b_owners(
        &map,
        array(&map, "source_lock_contracts")?,
        array(&map, "node_contracts")?,
    )?;
    Ok(())
}

#[test]
fn authority_v2_contract_map_is_complete_and_exactly_pinned() -> TestResult {
    validate_map()
}

macro_rules! source_contract_test {
    ($name:ident) => {
        #[test]
        fn $name() -> TestResult {
            validate_map()?;
            let map = parse_json(MAP_FIXTURE)?;
            let oracle = parse_json(SOURCE_ORACLE)?;
            let contracts = array(&map, "source_lock_contracts")?;
            let schemas = array(&oracle, "schemas")?;
            let evidence = format!("{EVIDENCE_PATH}{}", stringify!($name));
            let contract = contracts
                .iter()
                .find(|record| {
                    record.get("rust_evidence").and_then(Value::as_str) == Some(evidence.as_str())
                })
                .ok_or_else(|| {
                    failure(format!("source contract evidence is missing: {evidence}"))
                })?;
            let id = string_field(contract, "id")?;
            let schema = schemas
                .iter()
                .find(|record| {
                    record.get("symbol").and_then(Value::as_str)
                        == contract.get("source_lock_symbol").and_then(Value::as_str)
                })
                .ok_or_else(|| failure(format!("source schema is missing for: {id}")))?;
            assert_eq!(string_field(contract, "rust_evidence")?, evidence);
            assert_eq!(
                string_field(contract, "typescript_source")?,
                string_field(schema, "source")?
            );
            assert_concrete_rust_targets(contract, "rust_equivalent")?;
            assert_static_status(contract, "status")?;
            Ok(())
        }
    };
}

macro_rules! node_contract_test {
    ($name:ident) => {
        #[test]
        fn $name() -> TestResult {
            validate_map()?;
            let map = parse_json(MAP_FIXTURE)?;
            let fixture_root = parse_json(PARITY_FIXTURES)?;
            let contracts = array(&map, "node_contracts")?;
            let fixtures = array(&fixture_root, "payload")?;
            let evidence = format!("{EVIDENCE_PATH}{}", stringify!($name));
            let contract = contracts
                .iter()
                .find(|record| {
                    record.get("rust_evidence").and_then(Value::as_str) == Some(evidence.as_str())
                })
                .ok_or_else(|| failure(format!("node contract evidence is missing: {evidence}")))?;
            let id = string_field(contract, "id")?;
            assert_eq!(string_field(contract, "rust_evidence")?, evidence);
            let fixture = fixture_record(fixtures, id)?;
            assert_eq!(
                string_field(contract, "typescript_source")?,
                string_field(fixture, "typescript_source")?
            );
            assert_eq!(fixture_id(string_field(contract, "parity_fixture")?)?, id);
            assert_concrete_rust_targets(contract, "rust_equivalent")?;
            assert_fixture_case_shape(fixture)?;
            assert_static_status(contract, "status")?;
            Ok(())
        }
    };
}

source_contract_test!(source_contract_runtime_context);
source_contract_test!(source_contract_frame_context);
source_contract_test!(source_contract_authority_entry);
source_contract_test!(source_contract_authoritative_material);
source_contract_test!(source_contract_authority_receipt);
source_contract_test!(source_contract_next_control);
source_contract_test!(source_contract_command_control_target);
source_contract_test!(source_contract_replacement_control_address);
source_contract_test!(source_contract_shared_interaction_control);
source_contract_test!(source_contract_await_successor_control);
source_contract_test!(source_contract_terminal_control);
source_contract_test!(source_contract_frame_v2);
source_contract_test!(source_contract_recovery_request);
source_contract_test!(source_contract_recovery_bundle);
source_contract_test!(source_contract_recovery_applied_proof);
source_contract_test!(source_contract_turn_resolution_image);
source_contract_test!(source_contract_replacement_proposal);
source_contract_test!(source_contract_wave_terminal_material);
source_contract_test!(source_contract_control_open_material);
source_contract_test!(source_contract_interaction_envelope);
source_contract_test!(source_contract_interaction_material);
source_contract_test!(source_contract_interaction_projection_plan);
source_contract_test!(source_contract_proposal_admission_lease);
source_contract_test!(source_contract_recovery_fence);
source_contract_test!(source_contract_authority_ledger);
source_contract_test!(source_contract_control_install_result);
source_contract_test!(source_contract_inbound_frame_result);
source_contract_test!(source_contract_scheduler_timer_owner);
source_contract_test!(source_contract_session_identity);

node_contract_test!(node_contract_command_frontier);
node_contract_test!(node_contract_control_open);
node_contract_test!(node_contract_control);
node_contract_test!(node_contract_cutover_interaction);
node_contract_test!(node_contract_cutover_replacement);
node_contract_test!(node_contract_cutover_turn);
node_contract_test!(node_contract_cutover_wave);
node_contract_test!(node_contract_duo_delivery);
node_contract_test!(node_contract_faint_replacement_command_open);
node_contract_test!(node_contract_frames);
node_contract_test!(node_contract_interaction_control_ledger);
node_contract_test!(node_contract_interaction_projection);
node_contract_test!(node_contract_interactions_learn);
node_contract_test!(node_contract_interactions_mystery);
node_contract_test!(node_contract_interactions_reward);
node_contract_test!(node_contract_log);
node_contract_test!(node_contract_mutation_ledger);
node_contract_test!(node_contract_proposal_admission);
node_contract_test!(node_contract_proposal_lease);
node_contract_test!(node_contract_recovery_channel);
node_contract_test!(node_contract_recovery);
node_contract_test!(node_contract_replacement);
node_contract_test!(node_contract_runtime);
node_contract_test!(node_contract_scheduler_clock_seam);
node_contract_test!(node_contract_session_identity);
node_contract_test!(node_contract_shadow);
node_contract_test!(node_contract_simulator);
node_contract_test!(node_contract_turn);
node_contract_test!(node_contract_wave);
