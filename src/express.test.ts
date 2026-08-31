import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { type Kysely } from 'kysely';

import { Config, Env } from './config.js';
import { initExpress } from './express.js';
import { initDb } from './db.js';
import { testMigrationProvider } from './testing/migrations.js';
import { type SecretsFileSource } from './config/secrets.js';
import { type Database } from './db/types.js';
import { type TwitchUser } from './user.js';

const secrets = {
  load: async () => ({
    session: { secret: { unwrap: () => 'test-secret' } },
  }),
} as unknown as SecretsFileSource;

const config: Config = {
  env: Env.Dev,
  port: 0,
  title: 't',
  origin: 'http://localhost',
  views: '',
  secrets: '',
  followAgeDays: 7,
};

const user: TwitchUser = { login: 'someone', user_id: '1', followed_on: Date.now() - 30 * 86400_000 };

const liquid = (_path: string, _opts: object, cb: (e: unknown, rendered?: string) => void) => cb(null, 'ok');

const cookieNamed = (setCookies: string[], name: string): string | undefined =>
  setCookies.find(c => c.startsWith(`${name}=`));

type WhoAmI = { login: string | null; localId: string | null };

describe('express sessions (sqlite-backed)', () => {
  let kysely: Kysely<Database>;
  let server: Server;
  let base: string;

  const start = async (): Promise<{ server: Server; base: string }> => {
    const app = await initExpress({ config, liquid, secrets, kysely });
    app.get('/whoami', (req, res) => {
      res.json({ login: req.session.user?.login ?? null, localId: req.session.localId ?? null });
    });
    app.get('/login', (req, res) => {
      req.session.user = user;
      res.redirect('/whoami');
    });
    const srv = createServer(app);
    await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve));
    return { server: srv, base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
  };

  const loginCookie = async (at = base): Promise<string> => {
    const res = await fetch(`${at}/login`, { redirect: 'manual' });
    return cookieNamed(res.headers.getSetCookie(), 'connect.sid')!.split(';')[0]!;
  };

  beforeAll(async () => {
    kysely = await initDb(undefined, testMigrationProvider);
    ({ server, base } = await start());
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await kysely.destroy();
  });

  it('anonymous requests create no session and set no cookie', async () => {
    const res = await fetch(`${base}/whoami`, { redirect: 'manual' });
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await res.json()).toEqual({ login: null, localId: null });
    expect(await kysely.selectFrom('session').select('sid').execute()).toEqual([]);
  });

  it('login sets a lax, httponly session cookie (not secure over plain http)', async () => {
    const res = await fetch(`${base}/login`, { redirect: 'manual' });
    const sid = cookieNamed(res.headers.getSetCookie(), 'connect.sid');
    expect(sid).toBeDefined();
    expect(sid).toMatch(/HttpOnly/);
    expect(sid).toMatch(/SameSite=Lax/);
    expect(sid).not.toMatch(/Secure/);
  });

  it('the cookie is secure when the proxy says the request was https', async () => {
    const res = await fetch(`${base}/login`, { redirect: 'manual', headers: { 'x-forwarded-proto': 'https' } });
    expect(cookieNamed(res.headers.getSetCookie(), 'connect.sid')).toMatch(/Secure/);
  });

  it('the session identifies the user on later requests, with a stable csrf token', async () => {
    const cookie = await loginCookie();

    const first = (await (await fetch(`${base}/whoami`, { headers: { cookie } })).json()) as WhoAmI;
    expect(first.login).toBe('someone');
    expect(first.localId).toBeTruthy();

    // not rotated between requests: open tabs must keep working
    const second = (await (await fetch(`${base}/whoami`, { headers: { cookie } })).json()) as WhoAmI;
    expect(second).toEqual(first);
  });

  it('sessions survive a server restart (rows live in sqlite)', async () => {
    const cookie = await loginCookie();

    // same database, fresh express instance, as after a deploy
    const restarted = await start();
    try {
      const res = await fetch(`${restarted.base}/whoami`, { headers: { cookie } });
      expect(((await res.json()) as WhoAmI).login).toBe('someone');
    } finally {
      await new Promise<void>(resolve => restarted.server.close(() => resolve()));
    }
  });
});
