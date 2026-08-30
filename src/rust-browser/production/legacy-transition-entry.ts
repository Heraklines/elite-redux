import type { VerifiedProductionRuntimeSelectionV1 } from "./runtime-selector";

export async function startVerifiedLegacyTransitionV1(
  selection: VerifiedProductionRuntimeSelectionV1,
): Promise<{ dispose(): Promise<void> }> {
  const authority = selection.existingPin?.authority ?? selection.assignment?.authority;
  if (
    authority !== "LEGACY_TRANSITION"
    || selection.release.channel !== "LEGACY_TRANSITION"
    || (selection.release.legacy_transition_release != null
      && selection.release.legacy_transition_release !== selection.release.release_id)
  ) {
    throw new Error("legacy transition entry requires an exact signed legacy assignment");
  }
  const legacy = await import("./legacy-transition-main");
  return {
    async dispose() {
      legacy.disposeLegacyTransitionV1();
    },
  };
}
