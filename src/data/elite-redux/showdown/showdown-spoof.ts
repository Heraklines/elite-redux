/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 PvP (D0): the vs-CPU spoof OPPONENT. Stands in for a second human over the
// guest endpoint of the local loopback pair so the ENTIRE friendly showdown flow - team
// exchange (negotiate), the wager screen's both-ready commit, and the live battle's enemy
// commands - plays end-to-end with a SINGLE human. The real second player drops in behind the
// same transport interface (connectCoopSession) with nothing else changing.
//
// It is the showdown analogue of {@linkcode SpoofGuest} (which speaks the co-op wire): a real
// showdown opponent answers three things, and this does exactly those, engine-free:
//   1. NEGOTIATE - runs its OWN {@linkcode ShowdownSession} with a fixed legal team, so the
//      human's session validates it + both reach the `showdown-ready` barrier. Crucially it
//      only SENDS its team once it has SEEN the human's `showdownTeam` (its own session listener
//      is live from construction, so it has already buffered the human's team by then); sending
//      earlier would land before the human's session exists and be lost.
//   2. WAGER - always plays FRIENDLY: sends a friendly stake offer + crosses the
//      `showdown-wager-commit` rendezvous so the human's lock resolves.
//   3. BATTLE - answers the host's enemy-command relay with a legal move (every spoof mon
//      carries TACKLE in slot 0, so the reply is legal whichever mon the host has active; on
//      any edge case the host's own AI fallback covers it).
// =============================================================================

import { speciesStarterCosts } from "#balance/starters";
import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import type { CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import { SHOWDOWN_WAGER_COMMIT_POINT, ShowdownSession } from "#data/elite-redux/showdown/showdown-session";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";

/** Six distinct, cheap, structurally-legal mons. Every one carries TACKLE at slot 0. */
const SPOOF_SPECIES: SpeciesId[] = [
  SpeciesId.CATERPIE,
  SpeciesId.WEEDLE,
  SpeciesId.PIDGEY,
  SpeciesId.RATTATA,
  SpeciesId.SPEAROW,
  SpeciesId.ZUBAT,
];

/** The move every spoof mon leads with (so the relayed enemy command is legal for any active mon). */
const SPOOF_LEAD_MOVE = MoveId.TACKLE;

function buildSpoofTeam(): ShowdownMonManifest[] {
  return SPOOF_SPECIES.map(speciesId => ({
    speciesId,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex: 0,
    nature: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: [SPOOF_LEAD_MOVE, MoveId.GROWL, MoveId.QUICK_ATTACK, MoveId.TAIL_WHIP],
    item: "LEFTOVERS",
    rootSpeciesId: speciesId,
    erBlackShiny: false,
    baseCost: speciesStarterCosts[speciesId] ?? 4,
  }));
}

/**
 * The vs-CPU showdown opponent, bound to the guest endpoint of a loopback pair. Construct it in the
 * local (vs-CPU) versus session; it self-triggers off the human's team send. Dispose it on teardown.
 */
export class ShowdownSpoof {
  private readonly team: ShowdownMonManifest[];
  private readonly rendezvous: CoopRendezvous;
  private readonly session: ShowdownSession;
  private readonly relay: ShowdownCommandRelay;
  private readonly transport: CoopTransport;
  private readonly offTrigger: () => void;
  private begun = false;
  private disposed = false;

  constructor(transport: CoopTransport) {
    this.transport = transport;
    this.team = buildSpoofTeam();
    // Own rendezvous on the guest endpoint (the human's runtime owns the host-side one). The session
    // reuses it for the `showdown-ready` barrier; we reuse it for the `showdown-wager-commit` barrier.
    this.rendezvous = new CoopRendezvous(transport);
    // Constructed NOW so its listener buffers the human's `showdownTeam`/`showdownReady` even though we
    // don't reply (negotiate) until the trigger fires - see the file header.
    this.session = new ShowdownSession(transport, { rendezvous: this.rendezvous });
    this.relay = new ShowdownCommandRelay(transport);
    this.relay.onCommandRequest(() => ({
      command: Command.FIGHT,
      cursor: 0,
      moveId: SPOOF_LEAD_MOVE,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    }));
    // Reply to the human's negotiate the instant it ships its team (its session is live by then).
    this.offTrigger = transport.onMessage(msg => {
      if (msg.t === "showdownTeam" && !this.begun) {
        this.begin();
      }
    });
  }

  private begin(): void {
    this.begun = true;
    this.offTrigger();
    // Defer off the human's send re-entrancy; our session already buffered the human's team, so
    // negotiate() gates + resolves against it, then we commit the friendly wager.
    void Promise.resolve().then(() =>
      this.session
        .negotiate(this.team, null)
        .then(() => {
          // The negotiate promise settles asynchronously; if we were disposed meanwhile (teardown /
          // abort), the transport + rendezvous are already torn down, so DO NOT send onto a dead channel.
          if (this.disposed) {
            return;
          }
          this.transport.send({
            t: "showdownStakeOffer",
            offer: { speciesId: 0, shiny: false, variant: 0, erBlackShiny: false, cost: 0 },
          });
          this.rendezvous.arrive(SHOWDOWN_WAGER_COMMIT_POINT);
        })
        .catch(() => {
          // A rejected negotiation (should not happen for the fixed legal team) simply ends the CPU
          // side; the human's own session surfaces the rejection + aborts to the title.
        }),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.offTrigger();
    this.session.dispose();
    this.relay.dispose();
    this.rendezvous.dispose();
  }
}
