import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";

export class MessagePhase extends Phase {
  public readonly phaseName = "MessagePhase";
  private text: string;
  // TODO: Remove null from signatures
  private callbackDelay?: number | null | undefined;
  private prompt?: boolean | null | undefined;
  private promptDelay?: number | null | undefined;
  private speaker?: string | undefined;

  constructor(
    text: string,
    callbackDelay?: number | null,
    prompt?: boolean | null,
    promptDelay?: number | null,
    speaker?: string,
  ) {
    super();

    this.text = text;
    this.callbackDelay = callbackDelay;
    this.prompt = prompt;
    this.promptDelay = promptDelay;
    this.speaker = speaker;
  }

  start() {
    super.start();

    if (this.text.indexOf("$") > -1) {
      const pokename: string[] = [];
      const repname = ["#POKEMON1", "#POKEMON2"];
      for (let p = 0; p < globalScene.getPlayerField().length; p++) {
        pokename.push(globalScene.getPlayerField()[p].getNameToRender());
        this.text = this.text.split(pokename[p]).join(repname[p]);
      }
      const pageIndex = this.text.indexOf("$");
      if (pageIndex === -1) {
        for (let p = 0; p < globalScene.getPlayerField().length; p++) {
          this.text = this.text.split(repname[p]).join(pokename[p]);
        }
      } else {
        let page0 = this.text.slice(0, pageIndex);
        let page1 = this.text.slice(pageIndex + 1);
        // Pokemon names must be re-inserted _after_ the split, otherwise the index will be wrong
        for (let p = 0; p < globalScene.getPlayerField().length; p++) {
          page0 = page0.split(repname[p]).join(pokename[p]);
          page1 = page1.split(repname[p]).join(pokename[p]);
        }
        globalScene.phaseManager.unshiftNew(
          "MessagePhase",
          page1,
          this.callbackDelay,
          this.prompt,
          this.promptDelay,
          this.speaker,
        );
        this.text = page0.trim();
      }
    }

    // Co-op animations-off FAST-FORWARD (replay pacing): when a co-op run has move animations
    // disabled, collapse the per-message DWELL - reveal the whole line INSTANTLY (char-reveal
    // delay 0) instead of the ~20ms/char typewriter + the trailing read-hold. Mirrors the
    // `globalScene.moveAnimations` gate the co-op replay ANIM phases use, so the guest's per-event
    // narration (and the host turn narration it replays) stops paying human-pace text dwell on BOTH
    // seats. PRESENTATION ONLY: delay 0 still routes through the SAME showText/showDialogue path,
    // still shows any PROMPT (the instant branch invokes the wrapped callback that calls showPrompt)
    // and never removes/reorders a phase or an interaction-counter advance - it only removes the
    // human-pace WAIT. Solo (isCoop false) and animations-on runs are byte-identical (textDelay stays
    // null -> the default typewriter reveal).
    const textDelay = globalScene.gameMode.isCoop && !globalScene.moveAnimations ? 0 : null;
    if (this.speaker) {
      globalScene.ui.showDialogue(
        this.text,
        this.speaker,
        textDelay,
        () => this.end(),
        this.callbackDelay || (this.prompt ? 0 : 1500),
        this.promptDelay ?? 0,
      );
    } else {
      globalScene.ui.showText(
        this.text,
        textDelay,
        () => this.end(),
        this.callbackDelay || (this.prompt ? 0 : 1500),
        this.prompt,
        this.promptDelay,
      );
    }
  }
}
