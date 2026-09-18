# @talqyn/web

The web SDK for the public Talqyn API: smart search, facets, and the LLM
consultant. One package, three entry points, each imported separately:

| Entry point | What it is |
|---|---|
| `@talqyn/web` | the client: search, the consultant, ratings, chat history, events |
| `@talqyn/web/consultant-core` | the consultant screen's logic, for a screen of your own |
| `@talqyn/web/ui` | the ready-made consultant screen, as a custom element |

A page with no bundler takes `@talqyn/web/global` instead: one script, with
everything under `window.TalqynWeb`.

- **No runtime dependencies.** Only the platform: `fetch`, Web Crypto, the DOM.
- **ES modules with types**, a `.d.ts` next to every module; there is no CommonJS
  build.
- **Browsers:** the screen as designed in Chrome/Edge 111+, Firefox 113+, and
  Safari 16.2+; the client and the core from Chrome/Edge 80+, Firefox 75+, and
  Safari 14.1+. **Node 20+** for the client and the core, and all three entry points
  are safe to import under SSR.
- **Documented in place.** This README covers integration; every public type and
  function carries its full reference in the typings — hover over it in the editor.

## Quick start

The API host, the storefront slug, and the client key — an id and a secret — are
handed out at onboarding; nothing below works without them. Four steps from an
empty page to a working consultant, each unpacked in the section of the same name.

**1. Install the package.** All three entry points come in it, and the site's
bundler keeps only what the site imports — see [Installation](#installation).

```bash
npm install @talqyn/web
```

**2. Make one client for the whole site** and warm it up at start, so the first
search is as fast as the rest.

```ts
// talqyn.ts — imported wherever the client is needed.
import { Talqyn, TalqynDeviceIdentity, TalqynDeviceTokenCredentials } from '@talqyn/web';

export const talqyn = new Talqyn({
  baseUrl: buildConfig.talqynBaseUrl, // the API host
  credentials: new TalqynDeviceTokenCredentials({
    storefront: 'myshop', // storefront slug
    clientKeyId: 'client_key_id', // client key id
    clientSecret: buildConfig.talqynClientSecret, // client key secret
    identity: TalqynDeviceIdentity.persistentAnonymous, // a shopper id that survives reloads
  }),
  defaultLocale: 'en',
  defaultCityId: '10', // city id in your catalog's numbering
});

talqyn.prepare().catch(() => undefined);
```

The API has to allow the site's origin, or the browser blocks the very first
request — see [CORS](#cors).

**3. Search.** `externalId` is your own SKU: the site opens its own product page by
it.

```ts
const found = await talqyn.search.search('iphone 15');
found.results.map((product) => [product.title, product.externalId]);
```

**4. Show the consultant.** The screen is a custom element; the default theme needs
no setup, and the callbacks are the three actions that lead out of the screen.

```ts
import { mountTalqynConsultant } from '@talqyn/web/ui';

const consultant = mountTalqynConsultant(document.querySelector('#consultant')!, {
  talqyn,
  onOpenProduct: (product) => {
    if (product.externalId) router.push(`/p/${product.externalId}`);
  },
  onOpenSearch: (query) => router.push(`/search?q=${encodeURIComponent(query)}`),
  onApplyFilters: (criteria) => router.push(listingUrl(criteria)),
});
```

That is the whole integration: tokens, retries, and the consultant's stream are
the SDK's business, not the site's.

## Installation

The package is on npm.

```bash
npm install @talqyn/web
```

```ts
import { Talqyn } from '@talqyn/web';
import { TalqynConversation } from '@talqyn/web/consultant-core'; // a consultant screen of your own
import { mountTalqynConsultant } from '@talqyn/web/ui'; // the ready-made screen
```

Without a bundler — one script, `dist/talqyn.global.js`, from the site's own files
or from a CDN that mirrors npm. Pin the exact version, so the SDK changes only
when the site does:

```html
<script src="https://cdn.jsdelivr.net/npm/@talqyn/web@1.0.0/dist/talqyn.global.js"></script>
<script>
  const { Talqyn, TalqynDeviceTokenCredentials, mountTalqynConsultant } = window.TalqynWeb;
</script>
```

To build against the sources instead, run `npm run build` in `talqyn-web` and
`npm install ../talqyn-web` in the site: the folder stands in for the package
under the same name.

## Initialization

**One client for the whole site** — `talqyn` from the [quick start](#quick-start).
It holds what every request shares — the shopper, the city, the language — so there
must be exactly one, living as long as the page. The SDK keeps no singleton of its
own: the module that exports the client is enough, or a provider in your
framework's DI. The constructor sends nothing, reads no storage, and touches
neither `window` nor `document`, so that module is safe to import under SSR.

### The API host

`baseUrl` is required and has no default. Keep it in the site's build configuration
next to the client key: both change together when the site moves between stands,
and each host allows its own origins — see [CORS](#cors). A path prefix is kept as
given, so `https://gateway.example.com/talqyn` works too.

The host cannot change for the life of a client: another stand means another
`Talqyn`, and the consultant mounted again over it.

### The client key in the bundle

The client key secret ships in the site's JavaScript, and anyone can read it in the
page source. That is by design: the key does nothing but mint short-lived tokens
for this storefront. Keep it in the build configuration rather than in the
repository, and rotate the key if it leaks. A tenant key `tlq_` never goes on a
page — the SDK does not accept one.

### The shopper

The shopper id has to survive a reload and the next visit: chat history rests on
it. `TalqynDeviceIdentity.persistentAnonymous` creates one on the first request and
keeps it in `localStorage`; where storage is unavailable, the id lives as long as
the page. When the shopper signs in or out, tell the client:

```ts
import { TalqynDeviceIdentity } from '@talqyn/web';

talqyn.setIdentity(TalqynDeviceIdentity.user(accountUuid)); // signed in: history follows the account
talqyn.setIdentity(TalqynDeviceIdentity.persistentAnonymous); // back to this browser's anonymous shopper
talqyn.setIdentity(TalqynDeviceIdentity.guest); // no history is kept; the consultant still works
```

For a signed-in shopper, pass the same UUID every time — the account's id from
your backend, say; `user` takes a UUID only, so map a CRM number to one first. Skip
the call when the account changes, and the next conversation lands in the previous
shopper's history.

### Defaults

```ts
talqyn.setPlace('10'); // changing the city RESETS the store
talqyn.setLocale('kk');
talqyn.setVariant('exp-b'); // A/B bucket: echoed into analytics
```

Every request that names no city, store, or language of its own takes these.

## Search

```ts
import { TalqynFiltersResponse, TalqynFullSearchQuery, TalqynSort } from '@talqyn/web';

// Instant search — the search field with its dropdown.
const found = await talqyn.search.search('iphone 15');
found.results; // TalqynProduct[] — externalId is YOUR SKU
found.suggestions; // suggestions; highlightFrom is the boundary of the typed text
found.categories; // categories worth navigating to for the query
found.showcase; // showcase queries (these are suggestions, not products)
found.history; // the shopper's past queries (needs events, see below)
found.correctedFrom; // set if the server quietly searched for corrected text
found.searchId; // travels into the click event

// A listing with filters and sorting, a page at a time.
const query: TalqynFullSearchQuery = {
  query: 'smartphone',
  limit: 24,
  sort: TalqynSort.priceAscending,
  filters: { brand: ['apple'] },
};
const listing = await talqyn.search.full(query);
const next = TalqynFullSearchQuery.nextPage(query, listing);
if (next) {
  const more = await talqyn.search.full(next);
}

// The filter panel and the results together, for the same selection.
const { listing: page, filters: panel } = await talqyn.search.listingWithFilters(query);
TalqynFiltersResponse.panelGroups(panel); // the filters, without the city and store groups
TalqynFiltersResponse.cityGroup(panel); // the city picker: option.id goes into cityId
TalqynFiltersResponse.locationGroup(panel); // the store picker: option.id goes into locationId
TalqynFiltersResponse.selectedFilters(panel); // what is selected now, in the shape of the next request
```

`talqynId` is Talqyn's internal id and does not exist in your catalog. Everything
you do on your side, do by `externalId` — it is optional, and whether to show a
product that came without one is the site's call. Open products by `externalId`
too: `productUrl` comes from your feed as written, and a `javascript:` URL put into
`location.href` or an `<a href>` runs.

### Search as the shopper types

Cancel the previous request before starting the next one, or answers arrive out of
order. Every networking call takes an `AbortSignal`:

```ts
let inFlight: AbortController | undefined;

async function onInput(text: string): Promise<void> {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  const found = await talqyn.search.search(text, { signal: controller.signal }).catch(() => undefined);
  if (found && !controller.signal.aborted) render(found);
}
```

## The consultant

`@talqyn/web/ui` and `@talqyn/web/consultant-core` do everything in this section and
the next two — the stream, ratings, chat history — on their own (see
[The consultant screen](#the-consultant-screen)). Read on if you work with the
consultant's answers directly.

```ts
// Kept between questions: the conversation to continue, and the turn to rate.
let sessionId: string | undefined;
let turnId: string | undefined;

for await (const event of talqyn.consultant.ask('need a laptop for school under 300000', { sessionId })) {
  switch (event.type) {
    case 'status': // event.stage: 'thinking' → 'searching'
      break;
    case 'products': // cards; event.products.searchId — for clicks
      break;
    case 'delta': // event.text — an increment of the answer, see the markers below
      break;
    case 'clarify': // event.clarify.questions — chips; the reply is sent as a question
      break;
    case 'redirectToSearch': // event.query — this was a search query, replay it as a search
      break;
    case 'fallback': // event.reason — there will be no text, the products are there
      break;
    case 'action': // event.action: 'applyFilters' / 'showComparison'
      break;
    case 'followUps': // event.items — 2–3 follow-up lines, send them VERBATIM
      break;
    case 'error': // the turn failed on Talqyn's side
      break;
    case 'done': // always last
      sessionId = event.done.sessionId; // the next question continues this conversation
      turnId = event.done.turnId; // the key for rating this answer
      break;
    default: // an event type from a newer SDK version
      break;
  }
}
```

The stream always ends with `done`. If the connection drops before it, the loop
throws after the events already delivered: show that turn as failed, not as
finished. Keep the `default` branch, and do not check the `switch` for
exhaustiveness through `never` — a newer SDK version can add event types.

The request goes out when the loop starts. Leaving the loop — a `return`, an
exception, a `break` to a label outside the `switch` — or aborting a `signal`
passed to `ask` stops the turn.

Every question is a paid call to the model, so do not ask again on your own after
an error: offer the shopper a retry instead.

For a place with no room for a stream — a widget, an answer prepared in the
background — `answer` waits for the whole turn:

```ts
const answer = await talqyn.consultant.answer('a quiet dishwasher');
```

### Product markers

The text of a `delta` may contain `[p:1234]` markers — references to cards from a
`products` event that has already arrived. Every marker that reaches you has its
card.

```ts
import { TalqynAnswerMarkup } from '@talqyn/web';

TalqynAnswerMarkup.segments(text); // [{ type: 'text', text: 'Take ' }, { type: 'product', talqynId: 1234 }]
TalqynAnswerMarkup.stripped(text); // if you do not want inline mentions
```

### Actions

```ts
import { TalqynActionFilters } from '@talqyn/web';

if (event.type === 'action' && event.action.type === 'applyFilters') {
  // Open a listing the consultant put together.
  const criteria = TalqynActionFilters.criteria(event.action.filters, { query: lastQuery, cityId });
  const page = await talqyn.search.full(criteria);
}
if (event.type === 'action' && event.action.type === 'showComparison') {
  // A column per product, a row per characteristic.
  showComparison(event.action.table.titles, event.action.table.rows);
}
```

### Fallback

`fallback` means the products are there and the text is not:

- `TalqynFallbackReason.userBudgetExceeded` — this shopper has used up their budget
  for the next few hours; search works as usual;
- `TalqynFallbackReason.budgetExceeded` — the storefront's monthly budget is used
  up: a matter for Talqyn, not for the site.

The list is open: treat a reason you do not know as "no text", not as an error.
Products are not always there either.

## Rating an answer

A thumb up or down under a finished turn — an answer, a clarification, a fallback —
keyed by the `turnId` from its `done`:

```ts
import { TalqynFeedbackReason } from '@talqyn/web';

await talqyn.consultant.submitFeedback({
  turnId,
  sessionId,
  verdict: 'down',
  reasons: [TalqynFeedbackReason.notRelevant], // down only
  comment: 'was looking for a fridge', // down only, up to 500 characters
  talqynIds: [1234], // down only: which cards do not belong
});
await talqyn.consultant.withdrawFeedback(turnId); // the shopper un-pressed the thumb
```

Rating the same turn again **overwrites** the rating, and a rating already given
comes back with the chat from history (`TalqynChatMessage.feedback`). `notFound`
from `withdrawFeedback` means the rating is already gone — the state you wanted.

## Chat history

```ts
import { TalqynChatTranscript } from '@talqyn/web';

const chats = await talqyn.consultant.chats({ limit: 20, offset: 0 });
const chat = await talqyn.consultant.chat(chats[0]!.sessionId);
TalqynChatTranscript.productsFor(chat, chat.messages[1]!); // the cards of one particular message
await talqyn.consultant.deleteChat(chats[0]!.sessionId);
```

- **History needs a shopper.** Under `TalqynDeviceIdentity.guest` the list rejects
  with `forbidden` rather than coming back empty.
- **Somebody else's chat answers like a missing one** — `notFound`.
- **Anonymous conversations stay anonymous**: signing in later does not move them
  into the account's history.

## Events

Search learns from what shoppers do, and only the storefront can report it. The
shopper's own query history (`found.history`), click-through, and ranking all rest
on these three events:

| Event | Report it when | Carries |
|---|---|---|
| a submitted query | the shopper submits a query — Enter in the field, or opening a listing | the query, `source` (`instant` or `full`, never `consultant`), `resultsCount` when it is known |
| a product click | a product card is clicked in your own search UI | the `searchId` of the results it was shown in, `talqynId` (not your SKU), the zero-based `position`, the `source` |
| a category click | a category from `found.categories` is clicked | the category id and the query it was shown for |

```ts
import { TalqynEventSource } from '@talqyn/web';

talqyn.events.track({ query: text, source: TalqynEventSource.instant, resultsCount: found.total });
talqyn.events.track({
  searchId: found.searchId,
  talqynId: product.talqynId,
  position: index,
  source: TalqynEventSource.instant,
});
talqyn.events.track({ categoryId: category.id, query: text });
```

`track` tells the three apart by their fields: `talqynId` makes a product click,
`categoryId` a category click, and anything else a submitted query.

Where the `searchId` comes from:

- **Instant search** — `found.searchId`, one per response.
- **A listing** — `listing.searchId`, on the **first** page only: later pages
  continue the same results, so keep the id for the whole listing.
- **The consultant** — the `searchId` of the turn's `products`, with
  `source: TalqynEventSource.consultant` and `position` counted across all of the
  turn's products.

**Consultant clicks are reported for you**: the ready-made screen does it before
calling `onOpenProduct`, and a screen of your own calls
`conversation.trackProductTap`. Do not report them again.

`track` returns at once and never throws. There is no offline queue: an event not
yet sent when the tab is closed is lost.

## The consultant screen

Two ways, from the least work to the most.

### The ready-made screen

`@talqyn/web/ui` draws the whole consultant: the empty state with example questions,
the streaming answer, product cards inline and in a carousel, clarifying questions,
comparison, chat history, ratings, copying, retry — and reports its own clicks.
Step 4 of the quick start shows it on the default theme; on top of that, the site
can bring its brand, its title and example questions, and its own product cards.

```ts
import { mountTalqynConsultant, TalqynTheme, TalqynThemeFonts } from '@talqyn/web/ui';

const brand = TalqynTheme.create({
  colors: {
    // The page's own custom properties: they follow the site's dark mode.
    accent: 'var(--brand-accent)',
    background: 'var(--brand-background)',
    surface: 'var(--brand-surface)',
    surfaceSecondary: 'var(--brand-surface-secondary)',
    border: 'var(--brand-border)',
    textPrimary: 'var(--brand-text-primary)',
    textSecondary: 'var(--brand-text-secondary)',
    textTertiary: 'var(--brand-text-tertiary)',
  },
  fonts: TalqynThemeFonts.custom({ regular: '"Museo Sans Cyrl"', regularWeight: 500, boldWeight: 700 }),
});

mountTalqynConsultant(document.querySelector('#consultant')!, {
  talqyn,
  theme: brand,
  title: 'Shop AI',
  exampleQuestions: ['A quiet dishwasher under 250 000 ₸', 'What to give as a housewarming gift?'],
  // Your own card; null keeps the SDK's.
  renderProductCard: (product, layout) => (layout === 'horizontal' ? rowCard(product) : tileCard(product)),
  // onOpenProduct, onOpenSearch, and onApplyFilters — as in step 4.
});
```

In markup or in a framework the same screen is the `<talqyn-consultant>` element:

```ts
import { defineTalqynConsultantElement, type TalqynConsultantElement } from '@talqyn/web/ui';

defineTalqynConsultantElement();
const element = document.querySelector<TalqynConsultantElement>('talqyn-consultant')!;
element.configure({ talqyn, theme: brand });
element.update({ onOpenProduct: openProduct, onOpenSearch: openSearch, onApplyFilters: openListing });
```

`configure` builds the screen, `update` swaps the callbacks without rebuilding it,
and `dispose` takes it down. In React, configure the element once in an effect and
pass the new closures of every render through `update`.

What you can set:

| | |
|---|---|
| `theme` | colors by role — any CSS color, the page's custom properties included — with a second palette for dark mode, fonts, icons (SVG markup or an image URL), corner radii, a pinned light or dark appearance, haptics |
| `title` | the name in the header and above the examples |
| `exampleQuestions` | the chips on the empty screen; `[]` removes them |
| `navigation` | the way out: `TalqynNavigation.back(…)` draws an arrow, `TalqynNavigation.close(…)` a cross; without it there is none |
| `strings` | the en/ru/kk copy, any line replaceable: `{ ...TalqynUiStrings.en, placeholder: '…' }` |
| `showsHeader` | `false` keeps your own header; "new conversation" is then `conversation.reset()`, and history is `mountTalqynChatHistory` |
| `showsPoweredBy` | `false` removes "Powered by Talqyn" from the empty screen |
| `priceFormatter` | `449 990 ₸` by default |
| `imageLoader` | your CDN's resized image addresses in place of the originals |
| `layout` | the element width where the roomy shape starts, 640 px by default — or one shape, pinned |
| `conversation` | a conversation of your own in place of `talqyn` — to put a question into the field (`conversation.setDraft('…')`) or keep the transcript when the screen comes off the page |

- **Your own product cards.** `renderProductCard` returns your element: `'horizontal'`
  for a product cited in the text, at full width; `'vertical'` for a tile in the
  carousel. It stays in the page's DOM, shown through a `<slot>`, so the site's
  styles reach it. The SDK sets the width and handles the click — it reports the
  event and calls `onOpenProduct` — so the element must not open the product itself;
  buttons, links, and fields inside it work as usual.
- **The element's box.** The screen fills the box it is given: set its height — a
  dialog's, a panel's, or `100dvh` for a page of its own. It adapts to that box
  rather than to the window: from 640 px wide, history, comparison, and clarifying
  questions open as centered panels and dialogs. At the full height of a phone,
  pass the safe areas: `--talqyn-safe-area-top` and `--talqyn-safe-area-bottom`,
  usually `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
- **Styles stay apart.** The screen lives in a shadow root: the page's CSS does not
  get in, and the theme is the way to dress it.
- **The screen's lifetime.** `mountTalqynConsultant` returns a handle: `update(…)`
  swaps the callbacks, `destroy()` takes the screen down. Taking the element off the
  page stops an answer in flight; moving it or hiding it does not.
- **Dark mode, wide screens, and accessibility** come with the screen: the second
  palette follows `prefers-color-scheme`, the conversation keeps to a readable column
  on a wide screen, `prefers-reduced-motion` is respected, dialogs keep the focus, and
  small controls take a tap over at least 44×44 px.

### A screen of your own

`@talqyn/web/consultant-core` is the same screen's logic with no DOM and no
framework. `TalqynConversation` runs the conversation — streaming, clarifying
questions, retry, ratings, reopening a chat, click events — and publishes the state
for your view to draw:

```ts
import { TalqynAnswerRating, TalqynAnswerRenderer, TalqynConversation } from '@talqyn/web/consultant-core';

const conversation = new TalqynConversation(talqyn);

conversation.subscribe((state) => render(state.turns)); // updated as the answer streams

conversation.send('A quiet dishwasher under 250 000 ₸');
conversation.stop(); // the stop button — and when the screen goes away
conversation.retry(turn.id);
conversation.rate(turn.id, TalqynAnswerRating.helpful);
conversation.trackProductTap(product, turn); // before opening the product
conversation.restore(chat.sessionId); // a chat picked from history

// An answer as paragraphs, headings, lists, and bold, with each product's card
// right after the sentence that cites it.
const blocks = TalqynAnswerRenderer.blocks(turn.text, conversation.state.productsById);
```

`subscribe` fits React's `useSyncExternalStore` as it is:
`useSyncExternalStore(conversation.subscribe, () => conversation.state)`.
`TalqynChatHistory` does the same for the list of past chats, and
`TalqynUiStrings` holds the en/ru/kk copy.

## Errors

Errors come as `TalqynError`, with the kind of failure in `error.kind`:

| `kind` | What it means |
|---|---|
| `unauthorized` | the client key is revoked or wrong |
| `forbidden` | the SDK is not enabled for the storefront; reading chat history as a guest |
| `notFound` | no such chat or turn — or it belongs to somebody else |
| `validation` | the request failed validation; `fields` names what failed |
| `rateLimited` | too many requests for now |
| `server` | Talqyn cannot answer right now |
| `deviceTokensNotConfigured` / `deviceTokensUnavailable` | the storefront is not set up on Talqyn's side: a matter for support, not a retry |
| `invalidConfiguration` | an empty client key or storefront slug, a `baseUrl` that does not parse, or a shopper id that is not a UUID |
| `transport` | the network — or CORS, which the page cannot tell apart from it |
| `decoding` / `encoding` | the response, the request |
| `cancelled` | the request was aborted through its `AbortSignal` |

Before an error reaches you, the SDK has already retried whatever was safe to
retry. `error.isRetryable` says whether a "Try again" button makes sense, and
`error.requestId` is what to quote to support. `TalqynError.is(value)` recognizes
an error from another copy of the SDK on the same page, where `instanceof` misses;
in a `catch` that sees other errors too, `TalqynError.wrap(error)` brings anything
to a `TalqynError`, and an `AbortError` to `cancelled`.

## Diagnostics

```ts
import type { TalqynConfiguration } from '@talqyn/web';

const configuration: TalqynConfiguration = {
  baseUrl: buildConfig.talqynBaseUrl,
  credentials,
  logHandler: (event) => console.debug(`[Talqyn] ${event.message}`, event.requestId ?? ''),
};
```

Nothing secret reaches a log: the client secret, the token, and the shopper id never
appear in `logHandler`, printed objects show them masked, and the DevTools
inspector does not see them at all.

Quote `Talqyn.version` together with `error.requestId` when contacting support. A
proxy or a traffic logger plugs in as your own `transport` — `TalqynFetchTransport`
takes a `fetch` of your own.

## Tests

```bash
npm test            # vitest: 30 files, 351 tests
npm run typecheck   # tsc over src and test
npm run build       # dist/: ES modules, typings, and talqyn.global.js
```

The DOM tests (happy-dom) check the screen's behavior; its look is checked live on
the `/sdk` page of the `talqyn-demo` site.

## CORS

In a browser every request to the API is cross-origin: until the site's origin is
allowed on the API side, every call fails with `transport`, and nothing works. Ask
for it at onboarding — for production and for every stand, since each host allows
its own origins.

A gateway of your own in `baseUrl` has to answer the preflight itself:

- **Methods:** `GET`, `POST`, `DELETE`.
- **Request headers:** `Authorization`, `Content-Type`, `Accept`, `X-Request-ID`,
  `X-Talqyn-SDK`, `X-Client-Key`, `X-Client-Timestamp`, `X-Client-Nonce`, and
  `X-Client-Sig`. Name `Authorization` explicitly: `*` does not cover it.
- **Origin:** the site's origin or `*`. The SDK sends no cookies, so
  `Access-Control-Allow-Credentials` is not needed.
- **Exposed response headers:** `Date`, `Retry-After`, `X-Request-ID` — without
  `Date` a device whose clock is off gets no token.
- **`Access-Control-Max-Age`**, or a search field pays for every keystroke with a
  second request.

The consultant's answer is a `text/event-stream`: a proxy must not buffer it, or
the whole answer arrives at once when the turn ends.

## Differences from iOS and Android

The screen and the core follow the iOS SDK; here the web differs on purpose, where
the platform asks for it.

- **A custom element in a shadow root**, with the site's product cards left in the
  page's DOM behind a `<slot>`: the page's CSS must not break the screen, and the
  site's card needs the site's CSS.
- **The site's card is requested again only when its product changes**, so a React
  or Vue root inside it keeps its state through a rating or a new paragraph.
- **The site names the way out** (`navigation`): a page cannot know whether the
  consultant was opened as a route, a dialog, or a panel.
- **Two shapes by the width of the element, not the window**: the consultant is as
  often a narrow drawer on a wide page as a page of its own.
- **A turn stops when the element leaves the page**; a node moved by a framework or
  hidden with `display: none` keeps its turn.
- **`AbortSignal` instead of cancelling a `Task`, `subscribe` instead of Combine**,
  and `ask()` sends the request when the loop starts, not when it is called.
- **Events go out with `keepalive`**: a click on a card is almost always followed by
  leaving the page.
- **The browser's HTTP cache is the image cache**: `imageLoader` only picks the
  address.
- **`TalqynChatHistory` has `cancel()`**: a list you drive yourself has to be told
  when it leaves the page.
- **Haptics through `navigator.vibrate`**, where it exists — not in Safari on iOS.
- **Sizes in CSS pixels**, independent of the page's `rem`; the browser's zoom takes
  the place of Dynamic Type.
- **Numbers and dates in Kazakh fall back to ru-KZ** where the browser has no Kazakh
  data, and prices always take a comma for the fraction, whatever the browser's
  language.
- **Product ids end at 2⁵³ − 1**, JavaScript's exact-integer ceiling: a card with a
  larger `talqyn_id` is dropped.
