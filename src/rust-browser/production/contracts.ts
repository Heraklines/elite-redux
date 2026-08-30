import type { BrowserKernelGenerationIdentityV1 } from "../hot-reload/contracts";

export const PRODUCTION_RELEASE_MANIFEST_VERSION_V2 = 2 as const;
export const SIGNED_PRODUCTION_ENVELOPE_VERSION_V1 = 1 as const;
export const PRODUCTION_AUTHORITY_PROTOCOL_V1 = "er-coop-47" as const;
export const RUST_PREVIEW_SAVE_NAMESPACE_V1 = "M9_RUST_PREVIEW_V1" as const;

export type ReleaseChannelV1 = "INTERNAL" | "PREVIEW" | "CANARY" | "STABLE" | "ROLLBACK" | "LEGACY_TRANSITION";
export type ProductionAuthorityRuntimeV1 =
  | "RUST_PRODUCTION"
  | "RUST_CANARY"
  | "RUST_SHADOW_SAMPLE"
  | "LEGACY_TRANSITION";

export interface ArtifactIdentityV1 {
  url: string;
  sha256: string;
  bytes: number;
  media_type: string;
}

export interface ProductionArtifactSetV1 {
  bootstrap_js: ArtifactIdentityV1;
  browser_js: ArtifactIdentityV1;
  worker_js: ArtifactIdentityV1;
  wasm_glue_js: ArtifactIdentityV1;
  wasm: ArtifactIdentityV1;
  content: ArtifactIdentityV1;
  asset_manifest: ArtifactIdentityV1;
  service_worker: ArtifactIdentityV1;
  session_template: ArtifactIdentityV1;
}

export interface MechanicalCompatibilityIdentityV1 {
  schema_version: 1;
  mechanics_sha256: string;
  content_hash: string;
  authority_protocol: typeof PRODUCTION_AUTHORITY_PROTOCOL_V1;
  active_model_identity: string;
}

export interface BuildDiagnosticIdentityV1 {
  schema_version: 1;
  toolchain: string;
  target: string;
  profile: "release";
  lockfile_sha256: string;
  build_config_sha256: string;
  debug_surfaces_absent: true;
}

export interface MaterialSchemaSetV1 {
  turn: number;
  replacement: number;
  recovery: number;
  presentation: number;
}

export interface PlatformApiVersionSetV1 {
  schema_version: 1;
  save_api: number;
  telemetry_api: number;
  signaling_api: number;
  showdown_api: number;
  achievement_api: number;
}

export interface ProductionQualificationEvidenceV1 {
  candidate_sha: string;
  workflow_run_id: number;
  workflow_name: string;
  conclusion: "SUCCESS";
  artifact_set_sha256: string;
}

export interface ProfileResultEnvelopeV1 {
  schema_version: 1;
  pseudonymous_account_id: string;
  release_id: string;
  profile_bytes: number[];
  profile_sha256: string;
  achievement_result_bytes: number[];
  achievement_result_sha256: string;
}

export interface ProductionReleaseManifestV2 {
  schema_version: 2;
  release_id: string;
  release_epoch: number;
  channel: ReleaseChannelV1;
  issued_at: number;
  expires_at: number;
  integration_sha: string;
  rust_base_sha: string;
  browser_base_sha: string;
  oracle_sha: string;
  qualified_asset_sha: string;
  mechanical_identity: MechanicalCompatibilityIdentityV1;
  build_identity: BuildDiagnosticIdentityV1;
  browser_kernel_abi: 1;
  worker_protocol: 1;
  authority_protocol: typeof PRODUCTION_AUTHORITY_PROTOCOL_V1;
  material_schemas: MaterialSchemaSetV1;
  save_schema: number;
  artifacts: ProductionArtifactSetV1;
  previous_rust_release: string | null;
  legacy_transition_release: string | null;
  platform_api_versions: PlatformApiVersionSetV1;
  qualification: ProductionQualificationEvidenceV1;
}

export interface SignedProductionManifestV1 {
  envelope_version: 1;
  key_id: string;
  payload: ProductionReleaseManifestV2;
  signature: number[];
}

export type RuntimeAssignmentScopeV1 =
  | { kind: "BROWSER_SESSION"; value: { session_id: string } }
  | { kind: "GAME_RUN"; value: { run_id: string } }
  | { kind: "ACCOUNT"; value: { pseudonymous_account_id: string } }
  | { kind: "COOP_PARTY"; value: { party_id: string } };

export interface RuntimeAssignmentV1 {
  schema_version: 1;
  assignment_id: string;
  release_id: string;
  authority: ProductionAuthorityRuntimeV1;
  cohort: string;
  sticky_scope: RuntimeAssignmentScopeV1;
  issued_at: number;
  expires_at: number;
  policy_version: number;
}

export interface SignedRuntimeAssignmentV1 {
  envelope_version: 1;
  key_id: string;
  payload: RuntimeAssignmentV1;
  signature: number[];
}

export interface SessionRuntimePinV1 {
  schema_version: 1;
  session_id: string;
  run_id: string | null;
  release_id: string;
  kernel_generation: BrowserKernelGenerationIdentityV1;
  mechanical_identity: MechanicalCompatibilityIdentityV1;
  authority: ProductionAuthorityRuntimeV1;
  created_sequence: number;
  latest_sequence: number;
}

export type ProductionGenerationStatusV1 =
  | "BUILT"
  | "QUALIFIED"
  | "INTERNAL"
  | "CANARY"
  | "STABLE"
  | "DRAINING"
  | "ROLLBACK"
  | "REVOKED";

export interface ReleaseHealthSnapshotV1 {
  schema_version: 1;
  observed_sessions: number;
  observed_minutes: number;
  worker_initialization_failure_basis_points: number;
  unrecoverable_kernel_fault_basis_points: number;
  deterministic_migration_failures: number;
  cloud_save_regression_basis_points: number;
  coop_relative_regression_percent: number;
  coop_absolute_regression_basis_points: number;
  input_latency_regression_percent: number;
  crash_free_regression_basis_points: number;
  hard_stop: boolean;
  hard_stop_fingerprint: string | null;
}

export interface ProductionGenerationEntryV1 {
  release: ProductionReleaseManifestV2;
  status: ProductionGenerationStatusV1;
  assigned_new_sessions: number;
  active_sessions: number;
  health: ReleaseHealthSnapshotV1;
}

export interface ProductionGenerationRegistryV1 {
  schema_version: 1;
  releases: ProductionGenerationEntryV1[];
}

export type SaveRuntimeOriginV1 = "LEGACY_TYPE_SCRIPT" | "RUST";

export interface SaveMigrationReceiptV1 {
  schema_version: 1;
  source_runtime: SaveRuntimeOriginV1;
  source_schema: number;
  source_hash: string;
  target_runtime: "RUST";
  target_schema: number;
  target_hash: string;
  migrator_id: string;
  validation_digest: string;
}

export interface ProductionSaveEnvelopeV2 {
  envelope_version: 2;
  save_namespace: typeof RUST_PREVIEW_SAVE_NAMESPACE_V1;
  slot: string;
  pseudonymous_account_id: string;
  cloud_generation: number;
  origin_runtime: SaveRuntimeOriginV1;
  release_id: string;
  kernel_generation: number;
  mechanical_identity: MechanicalCompatibilityIdentityV1;
  authority_protocol: typeof PRODUCTION_AUTHORITY_PROTOCOL_V1;
  save_schema: number;
  content_hash: string;
  payload_hash: string;
  payload: number[];
  migration: SaveMigrationReceiptV1 | null;
  legacy_backup: string | null;
}

export interface SaveLeaseV1 {
  schema_version: 1;
  slot: string;
  holder: string;
  generation: number;
  expires_at: number;
}

export interface ProductionCoopCompatibilityV1 {
  schema_version: 1;
  save_namespace: typeof RUST_PREVIEW_SAVE_NAMESPACE_V1;
  release_id: string;
  compatible_releases: string[];
  authority_runtime: Exclude<ProductionAuthorityRuntimeV1, "LEGACY_TRANSITION">;
  authority_protocol: typeof PRODUCTION_AUTHORITY_PROTOCOL_V1;
  mechanical_identity: MechanicalCompatibilityIdentityV1;
  content_hash: string;
  material_schemas: MaterialSchemaSetV1;
  browser_kernel_abi: 1;
  save_schema: number;
  active_model_identity: string;
}

export interface RolloutRingV1 {
  ring: string;
  percentage_basis_points: number;
  eligibility: "CI_LOCAL" | "INTERNAL_ALLOWLIST" | "PREVIEW_ALLOWLIST" | "PUBLIC";
  minimum_sessions: number;
  minimum_duration_minutes: number;
  required_health: Omit<
    ReleaseHealthSnapshotV1,
    "schema_version" | "observed_sessions" | "observed_minutes" | "hard_stop" | "hard_stop_fingerprint"
  >;
}

export interface RolloutPolicyV1 {
  schema_version: 1;
  policy_id: string;
  policy_version: number;
  candidate_release: string;
  stable_release: string;
  legacy_release: string | null;
  active_ring: string;
  rings: RolloutRingV1[];
  hard_stop_rules: string[];
  soft_stop_rules: string[];
  issued_at: number;
  expires_at: number;
}

export interface SignedRolloutPolicyV1 {
  envelope_version: 1;
  key_id: string;
  payload: RolloutPolicyV1;
  signature: number[];
}

export interface RollbackDirectiveV1 {
  schema_version: 1;
  directive_id: string;
  affected_release: string;
  target_release: string;
  target_runtime: ProductionAuthorityRuntimeV1;
  scope: "NEW_SESSIONS" | "UNSTARTED_ASSIGNED_SESSIONS" | "ALL_SAFE_BOUNDARY_SESSIONS";
  reason: "HARD_STOP" | "RATE_REGRESSION" | "OPERATOR_DRILL" | "RELEASE_REVOKED";
  issued_at: number;
  expires_at: number;
  policy_version: number;
}

export interface SignedRollbackDirectiveV1 {
  envelope_version: 1;
  key_id: string;
  payload: RollbackDirectiveV1;
  signature: number[];
}
