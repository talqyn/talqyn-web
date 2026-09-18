import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  TalqynClientSignature,
  TalqynDeviceIdentity,
  TalqynDeviceToken,
  TalqynDeviceTokenCredentials,
  TalqynInMemoryUserIdStore,
  type TalqynConfiguration,
} from '../../src/sdk/index.js';
import type { TalqynDeviceTokenAuthorizer } from '../../src/sdk/auth/device-token-authorizer.js';
import {
  CLIENT_SECRET,
  FakeClock,
  LogCollector,
  StubTransport,
  TestFixtures,
  talqynFailure,
  waitUntil,
} from '../support/stub-transport.js';

const emptySearch = '{"search_id":"s","query":"x","locale":"ru","total":0,"results":[]}';

async function bearer(authorizer: TalqynDeviceTokenAuthorizer): Promise<string | undefined> {
  return (await authorizer.headers())['Authorization'];
}

function httpDate(ms: number): string {
  return new Date(ms).toUTCString();
}

function timestampOf(value: string | undefined): number {
  if (value === undefined) throw new Error('no timestamp');
  return Number(value);
}

describe('device token', () => {
  it('mints a token on the first request and uses it', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_abc' });
    transport.enqueue(emptySearch);

    const talqyn = TestFixtures.client({ transport });
    await talqyn.search.search('iphone');

    expect(transport.sent).toHaveLength(2);
    const [mint, search] = transport.sent;
    expect(mint?.path).toBe('/v1/consultant/token');
    expect(mint?.method).toBe('POST');
    expect(mint?.header('X-Client-Key')).toBe('ck_3f9a1c2b7d4e');
    expect(mint?.header('X-Client-Timestamp')).toBeDefined();
    expect(mint?.header('X-Client-Nonce')).toBeDefined();
    expect(mint?.header('X-Client-Sig')).toHaveLength(64);
    expect(mint?.header('Content-Type')).toBe('application/json');
    // The client secret never travels: only its id and the signature do.
    expect(mint?.bodyText).not.toContain('s3cr3t');
    expect(JSON.stringify(mint?.request.headers)).not.toContain('s3cr3t');

    expect(search?.path).toBe('/v1/search/');
    expect(search?.header('Authorization')).toBe('Bearer tlqd_abc');
    // The token names the shopper: no headers needed under it.
    expect(search?.header('X-User-ID')).toBeUndefined();
    expect(search?.header('X-User-Sig')).toBeUndefined();
  });

  /** The signature must cover exactly the bytes that went on the wire. */
  it('signs exactly the body it sends', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueue(emptySearch);

    const talqyn = TestFixtures.client({ transport });
    await talqyn.search.search('iphone');

    const mint = transport.sent[0];
    if (!mint?.request.body) throw new Error('the mint has no body');
    const expected = await TalqynClientSignature.sign({
      secret: CLIENT_SECRET,
      keyId: mint.header('X-Client-Key') ?? '',
      timestamp: mint.header('X-Client-Timestamp') ?? '',
      nonce: mint.header('X-Client-Nonce') ?? '',
      body: mint.request.body,
    });
    expect(mint.header('X-Client-Sig')).toBe(expected);
  });

  it('sends no user id in a guest mint', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueue(emptySearch);

    const talqyn = TestFixtures.client({ transport, credentials: TestFixtures.deviceToken(TalqynDeviceIdentity.guest) });
    await talqyn.search.search('iphone');

    expect(transport.sent[0]?.bodyText).toBe('{"storefront":"myshop"}');
    expect(transport.sent[0]?.bodyJson).not.toHaveProperty('user_id');
  });

  it('sends the user id of a named identity', async () => {
    const transport = new StubTransport();
    const identifier = crypto.randomUUID();
    transport.enqueueDeviceToken({ userId: identifier });
    transport.enqueue(emptySearch);

    const talqyn = TestFixtures.client({
      transport,
      credentials: TestFixtures.deviceToken(TalqynDeviceIdentity.user(identifier.toUpperCase())),
    });
    await talqyn.search.search('iphone');

    expect(transport.sent[0]?.bodyJson['user_id']).toBe(identifier);
    expect(talqyn.currentUserId()).toBe(identifier);
  });

  it('refuses a user id that is not a UUID', () => {
    expect(() => TalqynDeviceIdentity.user('42')).toThrowError(/UUID/);
  });

  /** The persistent anonymous id must survive a reload: chat history hangs on it. */
  it('stores the persistent anonymous id and reuses it', async () => {
    const store = new TalqynInMemoryUserIdStore();
    const first = new StubTransport();
    first.enqueueDeviceToken();
    first.enqueue(emptySearch);

    const talqyn = TestFixtures.client({
      transport: first,
      credentials: TestFixtures.deviceToken(TalqynDeviceIdentity.persistentAnonymous),
      userIdStore: store,
    });
    await talqyn.search.search('iphone');
    const generated = first.sent[0]?.bodyJson['user_id'];
    expect(typeof generated).toBe('string');
    expect(store.loadUserId()).toBe(generated);

    // A fresh SDK instance, the same shopper.
    const second = new StubTransport();
    second.enqueueDeviceToken();
    second.enqueue(emptySearch);
    const reloaded = TestFixtures.client({
      transport: second,
      credentials: TestFixtures.deviceToken(TalqynDeviceIdentity.persistentAnonymous),
      userIdStore: store,
    });
    await reloaded.search.search('iphone');
    expect(second.sent[0]?.bodyJson['user_id']).toBe(generated);
  });

  it('reuses the token across requests', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueue(emptySearch);
    transport.enqueue(emptySearch);

    const talqyn = TestFixtures.client({ transport });
    await talqyn.search.search('iphone');
    await talqyn.search.search('samsung');

    expect(transport.sent.filter((sent) => sent.path.endsWith('/consultant/token'))).toHaveLength(1);
  });

  /** Concurrent screens must not mint two tokens. */
  it('mints once for concurrent requests', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    for (let index = 0; index < 4; index++) transport.enqueue(emptySearch);

    const talqyn = TestFixtures.client({ transport });
    await Promise.allSettled(Array.from({ length: 4 }, () => talqyn.search.search('iphone')));

    expect(transport.sent.filter((sent) => sent.path.endsWith('/consultant/token'))).toHaveLength(1);
    expect(transport.sent).toHaveLength(5);
  });

  it('reissues once and retries on a 401', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_old' });
    transport.enqueue('{"detail":"Invalid device token"}', { status: 401 });
    transport.enqueueDeviceToken({ token: 'tlqd_new' });
    transport.enqueue(emptySearch);

    const talqyn = TestFixtures.client({ transport });
    await talqyn.search.search('iphone');

    expect(transport.sent).toHaveLength(4);
    expect(transport.sent[1]?.header('Authorization')).toBe('Bearer tlqd_old');
    expect(transport.sent[3]?.header('Authorization')).toBe('Bearer tlqd_new');
  });

  /** A second 401 in a row means expiry is not the cause: reissuing in a loop would never end. */
  it('surfaces a repeated 401', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();
    transport.enqueue('{"detail":"Invalid device token"}', { status: 401 });
    transport.enqueueDeviceToken();
    transport.enqueue('{"detail":"Invalid device token"}', { status: 401 });

    const talqyn = TestFixtures.client({ transport });
    const error = await talqynFailure(talqyn.search.search('iphone'));
    expect(error.kind).toBe('unauthorized');
    expect(error.detail).toBe('Invalid device token');
    expect(transport.sent).toHaveLength(4);
  });

  it('surfaces a disabled mint as forbidden and does not hammer the endpoint', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"Device token issuance is not enabled for this storefront"}', { status: 403 });

    const talqyn = TestFixtures.client({ transport });
    const first = await talqynFailure(talqyn.search.search('iphone'));
    expect(first.kind).toBe('forbidden');

    // Cooldown after an unrecoverable refusal.
    const second = await talqynFailure(talqyn.search.search('iphone'));
    expect(second.kind).toBe('forbidden');
    // The second mint must not reach the network.
    expect(transport.sent).toHaveLength(1);
  });

  it('has its own error for an installation without device tokens', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"Device tokens are not configured"}', { status: 501 });

    const talqyn = TestFixtures.client({ transport });
    const error = await talqynFailure(talqyn.search.search('iphone'));
    expect(error.kind).toBe('deviceTokensNotConfigured');
    expect(error.isRetryable).toBe(false);
  });

  it('reports a storefront without an anchor key as retryable', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"No active API key"}', { status: 503 });

    const talqyn = TestFixtures.client({ transport });
    const error = await talqynFailure(talqyn.search.search('iphone'));
    expect(error.kind).toBe('deviceTokensUnavailable');
    expect(error.isRetryable).toBe(true);
  });

  /** "No anchor key" is a support conversation. A platform 503 — or a bare one from a proxy — is not. */
  it('reports a platform 503 on the mint as an ordinary server error', async () => {
    for (const body of ['{"error":"overloaded","request_id":"r1"}', '']) {
      const transport = new StubTransport();
      transport.enqueue(body, { status: 503 });

      const talqyn = TestFixtures.client({ transport });
      const error = await talqynFailure(talqyn.search.search('iphone'));
      expect(error.kind, `body ${body}`).toBe('server');
      expect(error.statusCode).toBe(503);
      expect(error.isRetryable).toBe(true);
    }
  });

  it('reports an empty key as a configuration error without sending anything', async () => {
    const transport = new StubTransport();
    const talqyn = TestFixtures.client({
      transport,
      credentials: new TalqynDeviceTokenCredentials({ storefront: 'myshop', clientKeyId: 'ck_1', clientSecret: '' }),
    });
    const error = await talqynFailure(talqyn.search.search('iphone'));
    expect(error.kind).toBe('invalidConfiguration');
    expect(transport.sent).toEqual([]);
  });

  /** Changing the shopper must discard the token, or the new shopper's turns land in the previous one's history. */
  it('reissues the token when the identity changes', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_guest' });
    transport.enqueue(emptySearch);
    transport.enqueueDeviceToken({ token: 'tlqd_named' });
    transport.enqueue(emptySearch);

    const talqyn = TestFixtures.client({ transport });
    await talqyn.search.search('iphone');
    talqyn.setIdentity(TalqynDeviceIdentity.user(crypto.randomUUID()));
    await talqyn.search.search('iphone');

    expect(transport.sent).toHaveLength(4);
    expect(transport.sent[3]?.header('Authorization')).toBe('Bearer tlqd_named');
  });

  it('does not reissue for the same identity set again', async () => {
    const transport = new StubTransport();
    const shopper = crypto.randomUUID();
    transport.enqueueDeviceToken();
    transport.enqueue(emptySearch);
    transport.enqueue(emptySearch);

    const talqyn = TestFixtures.client({ transport, credentials: TestFixtures.deviceToken(TalqynDeviceIdentity.user(shopper)) });
    await talqyn.search.search('iphone');
    talqyn.setIdentity(TalqynDeviceIdentity.user(shopper));
    await talqyn.search.search('iphone');

    expect(transport.sent.filter((sent) => sent.path.endsWith('/consultant/token'))).toHaveLength(1);
  });

  it('reports the identity the site set', () => {
    const transport = new StubTransport();
    const talqyn = TestFixtures.client({ transport, credentials: TestFixtures.deviceToken(TalqynDeviceIdentity.guest) });
    expect(talqyn.currentIdentity().equals(TalqynDeviceIdentity.guest)).toBe(true);

    const shopper = crypto.randomUUID();
    talqyn.setIdentity(TalqynDeviceIdentity.user(shopper));
    expect(talqyn.currentIdentity().equals(TalqynDeviceIdentity.user(shopper))).toBe(true);
    expect(talqyn.currentIdentity().equals(TalqynDeviceIdentity.user(crypto.randomUUID()))).toBe(false);
    // Reading the identity mints nothing.
    expect(transport.sent).toEqual([]);
  });

  /** A mint in flight for the previous shopper must not install its token for the next one. */
  it('drops a mint that was in flight when the identity changed', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_previous' });
    transport.enqueueDeviceToken({ token: 'tlqd_next' });
    const authorizer = TestFixtures.authorizer({ transport, clock: new FakeClock() });

    const previous = authorizer.headers();
    authorizer.setIdentity(TalqynDeviceIdentity.user(crypto.randomUUID()));
    const failure = await talqynFailure(previous);
    expect(failure.kind).toBe('cancelled');
    expect(await bearer(authorizer)).not.toBe('Bearer tlqd_previous');
  });

  it('mints ahead on prepare', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken();

    const talqyn = TestFixtures.client({ transport });
    await talqyn.prepare();

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.path).toBe('/v1/consultant/token');
  });

  // Lifecycle, driven by a fake clock.

  /** Past the refresh mark the token is still good: it is served at once and the next one is fetched behind the request's back. */
  it('serves a stale token while reissuing in the background', async () => {
    const clock = new FakeClock();
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_first', expiresIn: 900 });
    const authorizer = TestFixtures.authorizer({ transport, clock });

    await authorizer.prepare();
    clock.advance(800_000); // refresh at 780 s, expiry at 900 s
    transport.enqueueDeviceToken({ token: 'tlqd_second', expiresIn: 900 });

    // No request waits for a reissue.
    expect(await bearer(authorizer)).toBe('Bearer tlqd_first');
    const installed = await waitUntil(async () => (await bearer(authorizer)) === 'Bearer tlqd_second');
    expect(installed, 'the background reissue must install its token').toBe(true);
    // One reissue, not one per request.
    expect(transport.sent).toHaveLength(2);
  });

  /** A reissue that fails costs nothing while the current token lasts. */
  it('keeps the live token when a reissue fails', async () => {
    const clock = new FakeClock();
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_live', expiresIn: 900 });
    const logs = new LogCollector();
    const authorizer = TestFixtures.authorizer({ transport, clock, logHandler: logs.handler });

    await authorizer.prepare();
    clock.advance(800_000);
    transport.enqueue('{"error":"overloaded"}', { status: 503 });

    expect(await bearer(authorizer)).toBe('Bearer tlqd_live');
    const warned = await waitUntil(() =>
      logs.events.some((event) => event.level === 'warning' && event.message.includes('reissue failed')),
    );
    // A failed reissue is a log line, not a failed request.
    expect(warned).toBe(true);

    clock.advance(99_000); // 899 s: still inside the lifetime
    expect(await bearer(authorizer)).toBe('Bearer tlqd_live');
  });

  /**
   * A transient failure must not turn every request into a mint attempt for the rest of the refresh
   * window: the background reissue pauses, while a request whose token has expired still gets its mint.
   */
  it('pauses background attempts after a transient reissue failure', async () => {
    const clock = new FakeClock();
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_live', expiresIn: 900 });
    const authorizer = TestFixtures.authorizer({ transport, clock });

    await authorizer.prepare();
    clock.advance(800_000);
    transport.enqueue('{"error":"overloaded"}', { status: 503 });
    expect(await bearer(authorizer)).toBe('Bearer tlqd_live');
    await waitUntil(() => transport.sent.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 20));

    clock.advance(2_000);
    for (let index = 0; index < 5; index++) expect(await bearer(authorizer)).toBe('Bearer tlqd_live');
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Five requests inside the pause must not mint five times.
    expect(transport.sent).toHaveLength(2);

    clock.advance(5_000);
    transport.enqueueDeviceToken({ token: 'tlqd_next', expiresIn: 900 });
    // Still served while the retry runs.
    expect(await bearer(authorizer)).toBe('Bearer tlqd_live');
    const installed = await waitUntil(async () => (await bearer(authorizer)) === 'Bearer tlqd_next');
    // After the pause the reissue is tried again.
    expect(installed).toBe(true);
  });

  /** Once the token has actually expired, the request waits for the mint. */
  it('waits for a fresh token once the current one expired', async () => {
    const clock = new FakeClock();
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_old', expiresIn: 900 });
    transport.enqueueDeviceToken({ token: 'tlqd_new', expiresIn: 900 });
    const authorizer = TestFixtures.authorizer({ transport, clock });

    await authorizer.prepare();
    clock.advance(901_000);

    expect(await bearer(authorizer)).toBe('Bearer tlqd_new');
    expect(transport.sent).toHaveLength(2);
  });

  /** A refusal during a background reissue must not lock out the token that still works — only the next mint after expiry sees the cooldown. */
  it('does not let a refused reissue block the live token', async () => {
    const clock = new FakeClock();
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_live', expiresIn: 900 });
    const authorizer = TestFixtures.authorizer({ transport, clock });

    await authorizer.prepare();
    clock.advance(800_000);
    transport.enqueue('{"detail":"Device token issuance is not enabled"}', { status: 403 });
    expect(await bearer(authorizer)).toBe('Bearer tlqd_live');
    await waitUntil(() => transport.sent.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 20));

    clock.advance(50_000); // 850 s: live, and inside the 60 s cooldown
    expect(await bearer(authorizer)).toBe('Bearer tlqd_live');
    // No second attempt during the cooldown.
    expect(transport.sent).toHaveLength(2);

    clock.advance(60_000); // 910 s: expired, cooldown over
    transport.enqueueDeviceToken({ token: 'tlqd_after', expiresIn: 900 });
    expect(await bearer(authorizer)).toBe('Bearer tlqd_after');
  });

  /** Two requests race past expiry and both see a 401. The second report arrives after the first has already minted a replacement: that replacement must survive. */
  it('does not drop the fresh token on a stale 401', async () => {
    const transport = new StubTransport();
    transport.enqueueDeviceToken({ token: 'tlqd_old' });
    transport.enqueueDeviceToken({ token: 'tlqd_new' });
    const authorizer = TestFixtures.authorizer({ transport, clock: new FakeClock() });

    await authorizer.prepare();
    authorizer.invalidate('Bearer tlqd_old');
    expect(await bearer(authorizer)).toBe('Bearer tlqd_new');

    authorizer.invalidate('Bearer tlqd_old'); // late report
    expect(await bearer(authorizer)).toBe('Bearer tlqd_new');
    // The fresh token must not be minted again.
    expect(transport.sent).toHaveLength(2);
  });

  // Device clock.

  /**
   * A computer with its clock set by hand signs with the wrong time and gets 401 for ever. The
   * response's own Date header says what time it is: the mint is signed once more with that, and the
   * correction sticks.
   */
  it('corrects a skewed clock from the server date', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"timestamp outside the acceptance window"}', {
      status: 401,
      headers: { Date: httpDate(Date.now() + 600_000) },
    });
    transport.enqueueDeviceToken({ token: 'tlqd_corrected' });
    const logs = new LogCollector();
    const authorizer = TestFixtures.authorizer({ transport, clock: new FakeClock(), logHandler: logs.handler });

    expect(await bearer(authorizer)).toBe('Bearer tlqd_corrected');
    expect(transport.sent).toHaveLength(2);

    const first = timestampOf(transport.sent[0]?.header('X-Client-Timestamp'));
    const second = timestampOf(transport.sent[1]?.header('X-Client-Timestamp'));
    // The retry is stamped with the server's time.
    expect(Math.abs(second - first - 600)).toBeLessThanOrEqual(3);
    expect(transport.sent[0]?.header('X-Client-Nonce')).not.toBe(transport.sent[1]?.header('X-Client-Nonce'));
    expect(logs.events.some((event) => event.level === 'info' && event.message.includes('clock'))).toBe(true);

    // The next mint signs with the corrected time from its first attempt.
    transport.enqueueDeviceToken({ token: 'tlqd_next' });
    authorizer.setIdentity(TalqynDeviceIdentity.user(crypto.randomUUID()));
    expect(await bearer(authorizer)).toBe('Bearer tlqd_next');
    const third = timestampOf(transport.sent[2]?.header('X-Client-Timestamp'));
    expect(Math.abs(third - first - 600)).toBeLessThanOrEqual(3);
  });

  /** The correction outlives the page: the next visit signs correctly from its first attempt instead of paying a rejected mint to learn it. */
  it('persists the clock correction', async () => {
    const store = new TalqynInMemoryUserIdStore();
    const transport = new StubTransport();
    transport.enqueue('{"detail":"timestamp outside the acceptance window"}', {
      status: 401,
      headers: { Date: httpDate(Date.now() - 900_000) },
    });
    transport.enqueueDeviceToken({ token: 'tlqd_first' });
    const first = TestFixtures.authorizer({ transport, clock: new FakeClock(), store });
    expect(await bearer(first)).toBe('Bearer tlqd_first');
    expect(Math.abs((store.loadClockOffsetMs() ?? 0) + 900_000)).toBeLessThanOrEqual(3_000);

    // "Next visit": a fresh authorizer over the same store.
    const reload = new StubTransport();
    reload.enqueueDeviceToken({ token: 'tlqd_reload' });
    const second = TestFixtures.authorizer({ transport: reload, clock: new FakeClock(), store });
    expect(await bearer(second)).toBe('Bearer tlqd_reload');
    // No rejected mint to learn the skew again.
    expect(reload.sent).toHaveLength(1);
    const stamp = timestampOf(reload.sent[0]?.header('X-Client-Timestamp'));
    expect(Math.abs(stamp - (Date.now() / 1000 - 900))).toBeLessThanOrEqual(3);
  });

  /** A clock that was fixed since the last visit: the stale correction earns one 401, the skew is measured again, and the store is cleared. */
  it('clears the stored correction once the clock is fixed', async () => {
    const store = new TalqynInMemoryUserIdStore();
    store.saveClockOffsetMs(600_000);
    const transport = new StubTransport();
    transport.enqueue('{"detail":"timestamp outside the acceptance window"}', {
      status: 401,
      headers: { Date: httpDate(Date.now()) },
    });
    transport.enqueueDeviceToken({ token: 'tlqd_fixed' });
    const authorizer = TestFixtures.authorizer({ transport, clock: new FakeClock(), store });

    expect(await bearer(authorizer)).toBe('Bearer tlqd_fixed');
    expect(transport.sent).toHaveLength(2);
    // An offset of zero is forgotten, not stored.
    expect(store.loadClockOffsetMs()).toBeUndefined();
  });

  /** A 401 with the clocks in agreement is about the key, not the time. */
  it('does not retry a 401 when the clocks agree', async () => {
    const transport = new StubTransport();
    transport.enqueue('{"detail":"Invalid client key"}', { status: 401, headers: { Date: httpDate(Date.now()) } });
    const authorizer = TestFixtures.authorizer({ transport, clock: new FakeClock() });

    const error = await talqynFailure(authorizer.headers());
    expect(error.kind).toBe('unauthorized');
    expect(transport.sent).toHaveLength(1);
  });

  // What prints.

  /**
   * Whatever prints a value — `String`, `JSON.stringify`, the console — must leave out the client
   * secret, the token, and the shopper's UUID: printed values end up in logs, error reports, and bug
   * trackers.
   */
  it('prints the credentials and the token without their secrets', () => {
    const shopper = crypto.randomUUID();
    const credentials = TestFixtures.deviceToken(TalqynDeviceIdentity.user(shopper));
    const token = TalqynDeviceToken.decode(
      JSON.parse(`{"token":"tlqd_eyJsecret","expires_at":"2026-08-26T12:15:00Z","expires_in":900,"user_id":"${shopper}"}`),
    );
    if (!token) throw new Error('the token did not decode');
    const configuration: TalqynConfiguration = {
      credentials,
      baseUrl: TestFixtures.baseUrl,
      userIdStore: new TalqynInMemoryUserIdStore(),
    };

    expect(String(credentials)).toBe(
      'TalqynDeviceTokenCredentials(storefront: myshop, clientKeyId: ck_3f9a1c2b7d4e, clientSecret: ***, identity: user(***))',
    );
    expect(String(token)).toBe('TalqynDeviceToken(expiresAt: 2026-08-26T12:15:00.000Z, expiresIn: 900, guest: false)');
    expect([TalqynDeviceIdentity.guest, TalqynDeviceIdentity.persistentAnonymous].map(String)).toEqual([
      'guest',
      'persistentAnonymous',
    ]);
    expect(token.token).toBe('tlqd_eyJsecret');
    expect(token.userId).toBe(shopper);

    const secrets = [CLIENT_SECRET, 'tlqd_eyJsecret', shopper, shopper.toUpperCase()];
    const subjects: readonly (readonly [string, object])[] = [
      ['credentials', credentials],
      ['identity', credentials.identity],
      ['token', token],
      ['configuration', configuration],
    ];
    for (const [name, value] of subjects) {
      const ownValues = Reflect.ownKeys(value).map((key) => String((value as Record<PropertyKey, unknown>)[key]));
      const renderings = [
        String(value),
        JSON.stringify(value),
        inspect(value, { depth: 10, showHidden: true }),
        ownValues.join('|'),
      ];
      for (const rendering of renderings) {
        for (const secret of secrets) {
          expect(rendering.includes(secret), `${name} prints a secret: ${rendering}`).toBe(false);
        }
      }
    }
  });
});
