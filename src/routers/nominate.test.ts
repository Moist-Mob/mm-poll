import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { type RequestHandler } from 'express';
import { type ApiClient } from '@twurple/api';
import { type Kysely } from 'kysely';

import { Config, Env } from '../config.js';
import { initExpress } from '../express.js';
import { initDb } from '../db.js';
import { testMigrationProvider } from '../testing/migrations.js';
import { initNominations, type NominationFns } from '../nomination.js';
import { initNominateRoutes } from './nominate.js';
import { type SecretsFileSource } from '../config/secrets.js';
import { type Database } from '../db/types.js';
import { type TwitchUser } from '../user.js';
import { DAY_MS } from '../util.js';

const secrets = {
  load: async () => ({
    session: { secret: { unwrap: () => 'test-secret' } },
  }),
} as unknown as SecretsFileSource;

// a tiny stand-in for twitch's game catalog
const catalog: Record<string, string> = { '10': 'Celeste', '20': 'Ōkami HD' };
const apiClient = {
  search: {
    searchCategories: async (q: string) => ({
      data: Object.entries(catalog)
        .filter(([, name]) => name.toLowerCase().includes(q.toLowerCase()))
        .map(([id, name]) => ({ id, name, boxArtUrl: `http://art/${id}` })),
    }),
  },
  games: {
    getGameById: async (id: string) => (catalog[id] ? { id, name: catalog[id] } : null),
  },
} as unknown as ApiClient;

const liquid = (_path: string, _opts: object, cb: (e: unknown, rendered?: string) => void) => cb(null, 'ok');

const config: Config = {
  env: Env.Dev,
  port: 0,
  title: 't',
  origin: 'http://localhost',
  views: '',
  secrets: '',
  followAgeDays: 7,
};

const viewer: TwitchUser = { login: 'v', user_id: '777', followed_on: Date.now() - 30 * DAY_MS };
const admin: TwitchUser = { login: 'm', user_id: '25022069', followed_on: Date.now() - 30 * DAY_MS };

describe('nominate routes', () => {
  let kysely: Kysely<Database>;
  let nominations: NominationFns;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    kysely = await initDb(undefined, testMigrationProvider);
    nominations = initNominations({ kysely, config });
    const app = await initExpress({ config, liquid, secrets, kysely });

    // test login; the middleware then mints the csrf token, read via /token
    app.get('/test-login/:kind', (req, res) => {
      req.session.user = req.params.kind === 'admin' ? admin : viewer;
      res.json({ ok: true });
    });
    app.get('/token', (req, res) => {
      res.json({ localId: req.session.localId ?? null });
    });

    const authRedirect: RequestHandler = (req, res, next) => {
      if (req.session.user) next();
      else res.redirect('/auth/login');
    };
    const { mount } = initNominateRoutes({ nominations, authRedirect, apiClient, config });
    mount(app, '/nominate');

    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await kysely.destroy();
  });

  const login = async (kind: 'viewer' | 'admin'): Promise<{ cookie: string; localId: string }> => {
    const res = await fetch(`${base}/test-login/${kind}`);
    const cookie = res.headers
      .getSetCookie()
      .find(c => c.startsWith('connect.sid='))!
      .split(';')[0]!;
    const { localId } = (await (await fetch(`${base}/token`, { headers: { cookie } })).json()) as { localId: string };
    return { cookie, localId };
  };

  const post = (path: string, cookie: string, body: Record<string, string>) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });

  it('the page requires a login, search requires a login', async () => {
    const page = await fetch(`${base}/nominate`, { redirect: 'manual' });
    expect(page.status).toBe(302);
    expect((await fetch(`${base}/nominate/search?q=cel`)).status).toBe(403);
  });

  it('search proxies the catalog; short queries return nothing without asking twitch', async () => {
    const { cookie } = await login('viewer');
    const res = await fetch(`${base}/nominate/search?q=celeste`, { headers: { cookie } });
    expect(await res.json()).toEqual({ results: [{ id: '10', name: 'Celeste', box_art: 'http://art/10' }] });

    const short = await fetch(`${base}/nominate/search?q=c`, { headers: { cookie } });
    expect(await short.json()).toEqual({ results: [] });
  });

  it('a nomination stores the server-resolved name, ignoring any client text', async () => {
    const { cookie, localId } = await login('viewer');
    const res = await post('/nominate', cookie, { 'csrf-token': localId, category_id: '20', category_name: 'bald' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/nominate');
    expect((await nominations.mine('777')).map(m => m.name)).toEqual(['Ōkami HD']);
  });

  it('unknown ids, non-numeric ids and bad csrf tokens are rejected', async () => {
    const { cookie, localId } = await login('viewer');
    const before = await nominations.mine('777');

    const unknown = await post('/nominate', cookie, { 'csrf-token': localId, category_id: '999' });
    expect(unknown.headers.get('location')).toMatch(/^\/error\?msg=/);
    const nonNumeric = await post('/nominate', cookie, { 'csrf-token': localId, category_id: 'bald' });
    expect(nonNumeric.headers.get('location')).toMatch(/^\/error\?msg=/);
    const forged = await post('/nominate', cookie, { 'csrf-token': 'wrong', category_id: '10' });
    expect(forged.headers.get('location')).toMatch(/^\/error\?msg=/);

    expect(await nominations.mine('777')).toEqual(before);
  });

  it('withdrawing removes only your own nomination', async () => {
    const { cookie, localId } = await login('viewer');
    await post('/nominate', cookie, { 'csrf-token': localId, category_id: '10' });
    const res = await post('/nominate/remove', cookie, { 'csrf-token': localId, category_id: '10' });
    expect(res.headers.get('location')).toBe('/nominate');
    expect((await nominations.mine('777')).map(m => m.twitch_category_id)).not.toContain('10');
  });

  it('the top list is admin-only', async () => {
    await nominations.nominate(viewer, { id: '10', name: 'Celeste' });

    expect((await fetch(`${base}/nominate/top`)).status).toBe(403);
    const { cookie } = await login('viewer');
    expect((await fetch(`${base}/nominate/top`, { headers: { cookie } })).status).toBe(403);

    const adminLogin = await login('admin');
    const res = await fetch(`${base}/nominate/top?n=5`, { headers: { cookie: adminLogin.cookie } });
    const { nominations: list } = (await res.json()) as { nominations: { name: string }[] };
    expect(list.map(t => t.name)).toContain('Celeste');
  });
});
