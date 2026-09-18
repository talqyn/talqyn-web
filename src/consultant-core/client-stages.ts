import { TalqynFallbackReason } from '../sdk/index.js';

export const TalqynClientStage = {
  /**
   * Products are in, the first token of the text is not. Not a server stage: derived on the client so
   * the status line has something to say between the two.
   */
  composing: 'composing',
} as const;

export const TalqynFallbackPolicy = {
  /**
   * The reason without its detail: the wire value may carry a suffix after a `:`, and copy and
   * decisions key off what comes before it.
   */
  base(reason: TalqynFallbackReason): TalqynFallbackReason {
    const colon = reason.indexOf(':');
    return colon < 0 ? reason : reason.slice(0, colon);
  },

  /**
   * Whether asking the same question again could plausibly work.
   *
   * Not after a spent budget — the shopper's or the account's — nor after a turn that ran out of its
   * own budget or that the model refused: the repeat would meet the same wall. A timeout or an open
   * circuit may clear, and an unknown reason is given the benefit of the doubt.
   */
  invitesRetry(reason: TalqynFallbackReason): boolean {
    const base = TalqynFallbackPolicy.base(reason);
    return !(
      TalqynFallbackReason.isBudgetExhausted(base) ||
      base === TalqynFallbackReason.turnBudget ||
      base === TalqynFallbackReason.refusal
    );
  },
} as const;
