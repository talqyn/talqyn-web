import type { TalqynAssistantTurn } from '../../consultant-core/index.js';

/** How a turn's clarification is shown once its answer has settled. */
export type TalqynClarifyDecision =
  /** Nothing to show — no question, already answered, or already shown. */
  | 'none'
  /** A card in the transcript. */
  | 'inline'
  /** A sheet over the transcript. */
  | 'sheet';

/**
 * When a clarifying question comes up as a sheet and when it stays a card in the transcript.
 *
 * The policy on its own, apart from the screen that presents: which turns already asked, which sheet the
 * shopper dismissed, and whether this question of theirs has had its sheet.
 */
export class TalqynClarifyPresentation {
  private readonly inline = new Set<string>();
  private readonly decided = new Set<string>();
  private hasShownSheetForRequest = false;

  /** Turns whose question stays inline: the sheet was dismissed, or never came up. */
  get inlineTurns(): ReadonlySet<string> {
    return this.inline;
  }

  /** The shopper typed a new question: it may have a sheet of its own. */
  beginRequest(): void {
    this.hasShownSheetForRequest = false;
  }

  /**
   * Decides once per turn, when its answer has settled.
   *
   * One sheet per question the shopper typed. A clarification that follows a clarify answer shows inline:
   * a second sheet in a row is an interrogation. So does one that cannot be presented right now —
   * something else is already on screen.
   *
   * @param canPresent Whether a sheet can come up at all.
   */
  decide(turn: TalqynAssistantTurn, canPresent: boolean): TalqynClarifyDecision {
    if (turn.clarify === undefined || turn.clarifyAnswer !== undefined || this.decided.has(turn.id)) return 'none';
    this.decided.add(turn.id);
    if (this.hasShownSheetForRequest || !canPresent) {
      this.inline.add(turn.id);
      return 'inline';
    }
    this.hasShownSheetForRequest = true;
    return 'sheet';
  }

  /** The shopper dismissed a turn's sheet: the question moves into the transcript. */
  sheetDismissed(turnId: string): void {
    this.inline.add(turnId);
  }

  /** Forgets turns that left the conversation. */
  forget(turnIds: Iterable<string>): void {
    for (const id of turnIds) {
      this.decided.delete(id);
      this.inline.delete(id);
    }
  }

  /** Forgets everything: a new or restored conversation. */
  forgetAll(): void {
    this.decided.clear();
    this.inline.clear();
    this.hasShownSheetForRequest = false;
  }
}
