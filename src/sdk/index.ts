// Networking, authorization, and models of the Talqyn public API. No UI.

export { Talqyn } from './talqyn.js';
export { TALQYN_CLIENT_HEADER, TALQYN_VERSION } from './version.js';
export { TalqynRetryPolicy } from './configuration.js';
export type { TalqynConfiguration } from './configuration.js';
export type { TalqynRequestOptions } from './request-options.js';

export { TalqynDeviceIdentity, TalqynDeviceTokenCredentials } from './credentials.js';
export type { TalqynDeviceIdentityKind, TalqynDeviceTokenCredentialsInit } from './credentials.js';
export { TalqynInMemoryUserIdStore, TalqynLocalStorageUserIdStore } from './auth/user-id-store.js';
export type {
  TalqynLocalStorageUserIdStoreOptions,
  TalqynStorageLike,
  TalqynUserIdStore,
} from './auth/user-id-store.js';
export { TalqynClientSignature } from './auth/client-signature.js';
export { TalqynDeviceToken } from './models/device-token.js';

export { TalqynLocale, TalqynSort } from './locale.js';
export type { TalqynLogEvent, TalqynLogHandler, TalqynLogLevel } from './log.js';

export { TalqynError } from './networking/error.js';
export type { TalqynErrorKind, TalqynTransportFailure } from './networking/error.js';
export { TalqynFetchTransport, TalqynHttpResponse } from './networking/http-transport.js';
export type {
  TalqynFetchTransportOptions,
  TalqynHeadersInit,
  TalqynHttpRequest,
  TalqynHttpResult,
  TalqynHttpStream,
  TalqynHttpTransport,
  TalqynLineStream,
} from './networking/http-transport.js';
export { TalqynLineSplitter, TalqynSseDecoder } from './networking/sse.js';
export type { TalqynSseMessage } from './networking/sse.js';

export { TalqynSearchApi } from './api/search-api.js';
export type { TalqynListingWithFilters, TalqynSearchOptions } from './api/search-api.js';
export { TalqynConsultantApi } from './api/consultant-api.js';
export type { TalqynAskOptions, TalqynChatOptions, TalqynChatsOptions } from './api/consultant-api.js';
export { TalqynEventsApi } from './api/events-api.js';
export type { TalqynEvent } from './api/events-api.js';

export { TalqynProduct } from './models/product.js';
export type { TalqynProductInit } from './models/product.js';
export { TalqynFullSearchResponse } from './models/search-models.js';
export type {
  TalqynBrand,
  TalqynCategory,
  TalqynChip,
  TalqynSearchResponse,
  TalqynSuggestion,
} from './models/search-models.js';
export {
  TalqynFilterGroup,
  TalqynFilterGroupKind,
  TalqynFilterOption,
  TalqynFilterOptionState,
  TalqynFiltersResponse,
} from './models/filter-models.js';
export { TalqynFullSearchQuery } from './models/queries.js';
export type {
  TalqynConsultantQuery,
  TalqynFilterCriteria,
  TalqynFiltersQuery,
  TalqynSearchQuery,
} from './models/queries.js';
export {
  TalqynActionFilters,
  TalqynConsultantAnswer,
  TalqynConsultantStage,
  TalqynFallbackReason,
} from './models/consultant-models.js';
export type {
  TalqynClarify,
  TalqynClarifyQuestion,
  TalqynComparisonRow,
  TalqynComparisonTable,
  TalqynConsultantAction,
  TalqynConsultantDone,
  TalqynConsultantProducts,
  TalqynProductGroup,
} from './models/consultant-models.js';
export { TalqynConsultantEvent } from './models/consultant-event.js';
export { TalqynChatMessage, TalqynChatRole, TalqynChatRoute, TalqynChatTranscript } from './models/chat-models.js';
export type { TalqynChatSummary } from './models/chat-models.js';
export { TalqynEventSource } from './models/event-models.js';
export type {
  TalqynCategoryClickEvent,
  TalqynProductClickEvent,
  TalqynSearchSubmitEvent,
} from './models/event-models.js';
export { TalqynFeedbackReason, TalqynFeedbackVerdict } from './models/feedback-models.js';
export type { TalqynFeedback } from './models/feedback-models.js';

export { TalqynAnswerMarkup } from './utilities/answer-markup.js';
export type { TalqynAnswerSegment } from './utilities/answer-markup.js';
