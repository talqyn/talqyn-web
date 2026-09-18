/**
 * `@talqyn/web/ui` — the consultant screen drawn by the SDK, as custom elements.
 *
 * `mountTalqynConsultant` puts the whole screen on a page; `TalqynTheme` dresses it in the site's colors,
 * type, icons, and shapes. The comparison and the history the consultant presents over itself are also
 * available as elements of their own, for a site that shows them elsewhere.
 */
export {
  TalqynTheme,
  TalqynThemeColors,
  TalqynThemeFonts,
  TalqynThemeIcons,
  TalqynThemeMetrics,
  type TalqynAppearance,
  type TalqynIcon,
  type TalqynThemeColorsInit,
  type TalqynThemeInit,
} from './theme.js';
export { TalqynVectors } from './icons.js';
export { TalqynImageLoader, type TalqynImageRequest } from './support/image-loader.js';
export type { TalqynProductCardLayout, TalqynProductCardRenderer } from './components/product-card.js';
export { TalqynAdaptiveLayout, type TalqynLayoutMode } from './layout.js';
export {
  TalqynNavigation,
  type TalqynConsultantAppearanceOptions,
  type TalqynConsultantCallbacks,
  type TalqynConsultantOptions,
  type TalqynNavigationKind,
} from './consultant-options.js';
export {
  TALQYN_CONSULTANT_TAG,
  TalqynConsultantElement,
  defineTalqynConsultantElement,
  mountTalqynConsultant,
  type TalqynConsultantHandle,
} from './consultant-element.js';
export {
  TALQYN_COMPARISON_TAG,
  TalqynComparisonElement,
  defineTalqynComparisonElement,
  mountTalqynComparison,
  type TalqynComparisonHandle,
  type TalqynComparisonMountOptions,
} from './comparison-element.js';
export {
  TALQYN_CHAT_HISTORY_TAG,
  TalqynChatHistoryElement,
  defineTalqynChatHistoryElement,
  mountTalqynChatHistory,
  type TalqynChatHistoryHandle,
  type TalqynChatHistoryMountOptions,
} from './chat-history-element.js';
