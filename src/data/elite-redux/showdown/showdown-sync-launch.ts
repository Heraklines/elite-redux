import type { CoopNetcodeMode, CoopRole } from "#data/elite-redux/coop/coop-transport";
import { showdownTeamHash } from "#data/elite-redux/showdown/showdown-session";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";

export interface ShowdownLaunchSides {
  playerManifest: ShowdownMonManifest[];
  enemyManifest: ShowdownMonManifest[];
}

/** Only the authoritative guest boots from the host snapshot. Sync runs both engines locally. */
export function shouldAwaitShowdownLaunchSnapshot(role: CoopRole, netcodeMode: CoopNetcodeMode): boolean {
  return role === "guest" && netcodeMode === "authoritative";
}

/**
 * Sync keeps both engines in the host's canonical world: host team on the player side, guest team
 * on the enemy side. Logical account ownership remains unchanged in showdown-battle-state.
 */
export function showdownLaunchSides(
  role: CoopRole,
  netcodeMode: CoopNetcodeMode,
  ownManifest: ShowdownMonManifest[],
  opponentManifest: ShowdownMonManifest[],
): ShowdownLaunchSides {
  if (role === "guest" && netcodeMode === "lockstep") {
    return { playerManifest: opponentManifest, enemyManifest: ownManifest };
  }
  return { playerManifest: ownManifest, enemyManifest: opponentManifest };
}

/** A role-canonical seed derived from the two already-validated team commitments. */
export function showdownSyncBattleSeed(
  role: CoopRole,
  ownManifest: ShowdownMonManifest[],
  opponentManifest: ShowdownMonManifest[],
): string {
  const ownHash = showdownTeamHash(ownManifest);
  const opponentHash = showdownTeamHash(opponentManifest);
  const hostHash = role === "host" ? ownHash : opponentHash;
  const guestHash = role === "host" ? opponentHash : ownHash;
  return `showdown-sync:${hostHash}:${guestHash}`;
}
