/**
 * Reload-required settings may reset a solo scene immediately, but a live co-op/Showdown
 * runtime is ephemeral network state: resetting one client destroys the match. In that case
 * the saved setting takes effect on the next ordinary reload instead.
 */
export function shouldReloadSceneOnSettingsExit(reloadRequired: boolean, networkSessionActive: boolean): boolean {
  return reloadRequired && !networkSessionActive;
}
