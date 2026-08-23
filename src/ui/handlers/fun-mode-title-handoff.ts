export interface FunModeTitleHandoff {
  toTitleScreen: () => void;
  endCurrentPhase: () => void;
  playSelect: () => void;
}

export function handoffFunModeToTitle(handoff: FunModeTitleHandoff): void {
  handoff.toTitleScreen();
  handoff.endCurrentPhase();
  handoff.playSelect();
}
