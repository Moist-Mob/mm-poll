import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { type ApiClient } from '@twurple/api';
import { type Kysely } from 'kysely';

import { Config, Env } from '../config.js';
import { initExpress } from '../express.js';
import { initDb } from '../db.js';
import { testMigrationProvider } from '../testing/migrations.js';
import { initAuthRoutes, sanitizeReturnTo } from './auth.js';
import { type SecretsFileSource } from '../config/secrets.js';
import { type Database } from '../db/types.js';

const secrets = {
  load: async () => ({
    session: { secret: { unwrap: () => 'test-secret' } },
    twitch: { app: { clientId: 'cid', clientSecret: { unwrap: () => 'shh' } } },
  }),
} as unknown as SecretsFileSource;

const apiClient = {
  channels: {
    getChannelFollowers: async () => ({ data: [{ followDate: new Date(Date.now() - 30 * 86400_000) }] }),
  },
} as unknown as ApiClient;

const liquid = (_path: string, _opts: object, cb: (e: unknown, rendered?: string) => void) => cb(null, 'ok');

const config: Config = {
  env: Env.Dev,
  port: 0,
  title: 't',
  origin: 'http://placeholder',
  views: '',
  secrets: '',
  followAgeDays: 7,
};

describe('auth flow', () => {
  let kysely: Kysely<Database>;
  let server: Server;
  let base: string;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    kysely = await initDb(undefined, testMigrationProvider);
    const app = await initExpress({ config, liquid, secrets, kysely });
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // the auth router derives its urls from config.origin, which we only
    // know once the server has picked a port
    config.origin = base;
    const { mount, authRedirect } = await initAuthRoutes({ config, secrets, apiClient });
    mount(app, '/auth');
    app.get('/poll/5', authRedirect, (req, res) => {
      res.json({ login: req.session.user!.login });
    });

    // twitch's endpoints answer canned responses; everything else (i.e. our
    // own test server) still goes through the real fetch
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const url =
        input instanceof URL ? input.href : typeof input === 'string' ? input : (input as { url: string }).url;
      if (url.startsWith('https://id.twitch.tv/oauth2/token')) return Response.json({ access_token: 'tok' });
      if (url.startsWith('https://id.twitch.tv/oauth2/validate')) {
        return Response.json({ login: 'someone', user_id: '99' });
      }
      return realFetch(input as string | URL, init);
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await kysely.destroy();
  });

  const sidOf = (res: Response): string | undefined =>
    res.headers
      .getSetCookie()
      .filter(c => c.startsWith('connect.sid='))
      .map(c => c.split(';')[0]!)
      .pop();

  // begin a login and capture the session cookie plus the state we sent along
  const startLogin = async (returnTo = encodeURIComponent('/poll/5')) => {
    const res = await fetch(`${base}/auth/login?returnTo=${returnTo}`, { redirect: 'manual' });
    const twitchUrl = new URL(res.headers.get('location')!);
    return { cookie: sidOf(res)!, state: twitchUrl.searchParams.get('state')!, twitchUrl };
  };

  it('sanitizeReturnTo only accepts local paths', () => {
    expect(sanitizeReturnTo('/poll/5')).toBe('/poll/5');
    expect(sanitizeReturnTo('/poll/5?a=1')).toBe('/poll/5?a=1');
    expect(sanitizeReturnTo('https://evil.example')).toBe('/');
    expect(sanitizeReturnTo('//evil.example')).toBe('/');
    expect(sanitizeReturnTo('/\\evil.example')).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
    expect(sanitizeReturnTo(['/a', '/b'])).toBe('/');
  });

  it('a protected page bounces anonymous visitors into login with a returnTo', async () => {
    const res = await fetch(`${base}/poll/5`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${base}/auth/login?returnTo=%2Fpoll%2F5`);
  });

  it('login redirects to twitch with a state nonce and our callback url', async () => {
    const { cookie, state, twitchUrl } = await startLogin();
    expect(cookie).toBeDefined();
    expect(twitchUrl.origin).toBe('https://id.twitch.tv');
    expect(twitchUrl.searchParams.get('client_id')).toBe('cid');
    expect(twitchUrl.searchParams.get('redirect_uri')).toBe(`${base}/auth/callback`);
    expect(state).toBeTruthy();
  });

  it('the callback logs the user in, rotates the session id, and returns them to the poll', async () => {
    const { cookie, state } = await startLogin();
    const cb = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
      redirect: 'manual',
      headers: { cookie },
    });
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/poll/5');

    // session fixation: authentication must come with a fresh session id
    const fresh = sidOf(cb);
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(cookie);

    const page = await fetch(`${base}/poll/5`, { headers: { cookie: fresh! } });
    expect(await page.json()).toEqual({ login: 'someone' });
  });

  it('a stale or forged state is not consumed: back to the poll, still logged out', async () => {
    const { cookie } = await startLogin();
    const cb = await fetch(`${base}/auth/callback?code=abc&state=WRONG`, { redirect: 'manual', headers: { cookie } });
    expect(cb.headers.get('location')).toBe('/poll/5');

    // not logged in: the poll bounces this session back into login
    const page = await fetch(`${base}/poll/5`, { redirect: 'manual', headers: { cookie } });
    expect(page.status).toBe(302);
  });

  it('a second login attempt in the same session wins over the first', async () => {
    const first = await startLogin();
    // second tab starts over in the same session; its state replaces the first
    const res = await fetch(`${base}/auth/login?returnTo=%2Fpoll%2F5`, {
      redirect: 'manual',
      headers: { cookie: first.cookie },
    });
    const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
    expect(state).not.toBe(first.state);

    const cb = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
      redirect: 'manual',
      headers: { cookie: first.cookie },
    });
    expect(cb.headers.get('location')).toBe('/poll/5');
  });

  it('a callback with no login in flight fails gracefully', async () => {
    const res = await fetch(`${base}/auth/callback?code=abc&state=x`, { redirect: 'manual' });
    expect(res.headers.get('location')).toMatch(/^\/error\?msg=/);
  });

  it("a denial from twitch shows twitch's message", async () => {
    const { cookie } = await startLogin();
    const res = await fetch(`${base}/auth/callback?error=access_denied&error_description=denied`, {
      redirect: 'manual',
      headers: { cookie },
    });
    expect(res.headers.get('location')).toBe('/error?msg=denied');
  });

  it('an external returnTo is replaced with home', async () => {
    const { cookie, state } = await startLogin(encodeURIComponent('https://evil.example'));
    const cb = await fetch(`${base}/auth/callback?code=abc&state=${state}`, {
      redirect: 'manual',
      headers: { cookie },
    });
    expect(cb.headers.get('location')).toBe('/');
  });
});
