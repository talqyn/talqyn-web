// The logic of the consultant screen with no view attached: the conversation, answer rendering, chat
// history, copy. For a storefront that draws its own screen — in React, Vue, or anything else — and must
// not ship somebody else's.

export { TalqynConversation, TalqynConversationState } from './conversation.js';
export type { TalqynConversationOptions } from './conversation.js';
export {
  TalqynAnswerRating,
  TalqynAssistantTurn,
  TalqynClarifyDraft,
  TalqynConversationLimits,
  TalqynUserTurn,
} from './turn.js';
export type { TalqynTurn } from './turn.js';
export { TalqynAnswerLine, TalqynAnswerRenderer } from './answer-renderer.js';
export type { TalqynAnswerBlock, TalqynAnswerLineKind, TalqynTextRun } from './answer-renderer.js';
export { TalqynChatHistory } from './chat-history.js';
export type { TalqynChatHistoryOptions, TalqynChatHistoryState } from './chat-history.js';
export { TalqynUiStrings } from './ui-strings.js';
export { TalqynPriceFormatter } from './price-formatter.js';
export { TalqynClientStage, TalqynFallbackPolicy } from './client-stages.js';
export { TalqynStore } from './store.js';
export type { TalqynListener } from './store.js';
