import type { TalqynUiStrings } from '../../consultant-core/index.js';
import { h, iconSlot } from '../support/dom.js';
import type { TalqynTheme } from '../theme.js';
import { chip, chipFlow } from './controls.js';

/**
 * Who built the consultant. Not copy: the mark reads the same in every locale and on every storefront,
 * and a site that does not want it turns it off rather than rewrites it.
 */
export const TALQYN_POWERED_BY = 'Powered by Talqyn';

/** The screen before the first question: a title, a line about what the consultant does, and example questions to tap. */
export function emptyStateView(
  theme: TalqynTheme,
  strings: TalqynUiStrings,
  showsPoweredBy: boolean,
  onExample: (question: string) => void,
): HTMLDivElement {
  const icon = iconSlot(theme.icons.emptyState, 'tq-icon tq-empty-icon');
  const title = h('h2', 'tq-empty-title tq-font-title', [strings.title]);
  const subtitle = h('p', 'tq-empty-subtitle tq-font-callout', [strings.introSubtitle]);
  // A site with no examples of its own gets no gap where they were.
  const examples = chipFlow(
    strings.exampleQuestions.map((question) => chip(theme, question, { onTap: () => onExample(question) })),
    { centered: true },
  );
  examples.classList.add('tq-empty-examples');
  examples.hidden = strings.exampleQuestions.length === 0;
  // The mark is shown once, where the screen introduces itself, and nowhere else: the shopper reads it before
  // the first question and is not reminded of it under every answer.
  const poweredBy = h('div', 'tq-powered-by tq-font-micro', [TALQYN_POWERED_BY]);
  poweredBy.hidden = !showsPoweredBy;
  return h('div', 'tq-empty', [h('div', 'tq-empty-content', [icon, title, subtitle, examples, poweredBy])]);
}
