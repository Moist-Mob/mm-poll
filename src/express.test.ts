import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { DateTime } from 'luxon';

import { Env } from './config.js';
import { initExpress, setUserCookie, USER_COOKIE } from './express.js';
import { JWT, TwitchUser } from './jwt.js';

// minimal stand-in for the real JWT: the "token" is just the JSON
const fakeJWT: JWT = {
  signUser: data => [encodeURIComponent(JSON.stringify(data)), DateTime.utc().plus({ days: 7 })],
  verifyUser: token => {
    try {
      return token ? (JSON.parse(decodeURIComponent(token)) as TwitchUser) : undefined;
    } catch {
      return undefined;
    }
  },
};

const user: TwitchUser = { login: 'someone', user_id: '1', followed_on: 1 };

const cookieNamed = (setCookies: string[], name: string): string | undefined =>
  setCookies.find(c => c.startsWith(`${name}=`));

describe('express cookies', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = await initExpress({
      config: {
        env: Env.Dev,
        port: 0,
        title: 't',
        origin: 'http://localhost',
        views: '',
        secrets: '',
        followAgeDays: 7,
      },
      liquid: (_path, _opts, cb) => cb(null, 'ok'),
      JWT: fakeJWT,
    });
    app.get('/whoami', (req, res) => {
      res.json({ login: req.session.user?.login ?? null });
    });
    app.get('/login', (req, res) => {
      req.session.user = user;
      setUserCookie(fakeJWT, req, res, user);
      res.redirect('/whoami');
    });
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('session cookie is lax + httponly, and not secure over plain http', async () => {
    const res = await fetch(`${base}/whoami`, { redirect: 'manual' });
    const sid = cookieNamed(res.headers.getSetCookie(), 'connect.sid')!;
    expect(sid).toMatch(/HttpOnly/);
    expect(sid).toMatch(/SameSite=Lax/);
    expect(sid).not.toMatch(/Secure/);
  });

  it('cookies are secure when the proxy says the request was https', async () => {
    const res = await fetch(`${base}/login`, { redirect: 'manual', headers: { 'x-forwarded-proto': 'https' } });
    const cookies = res.headers.getSetCookie();
    expect(cookieNamed(cookies, 'connect.sid')).toMatch(/Secure/);
    expect(cookieNamed(cookies, USER_COOKIE)).toMatch(/Secure/);
  });

  it('login issues the user cookie immediately, and it alone identifies the user', async () => {
    const login = await fetch(`${base}/login`, { redirect: 'manual' });
    const cookies = login.headers.getSetCookie();
    // exactly one Set-Cookie for the user cookie (no stray "clear" before it)
    expect(cookies.filter(c => c.startsWith(`${USER_COOKIE}=`))).toHaveLength(1);
    const userCookie = cookieNamed(cookies, USER_COOKIE)!;
    expect(userCookie).toMatch(/HttpOnly/);
    expect(userCookie).toMatch(/SameSite=Lax/);

    // present only the user cookie (as if the session were lost)
    const res = await fetch(`${base}/whoami`, { headers: { cookie: userCookie.split(';')[0]! } });
    expect(await res.json()).toEqual({ login: 'someone' });
  });

  it('anonymous requests clear a stale user cookie, and only then', async () => {
    const stale = await fetch(`${base}/whoami`, { headers: { cookie: `${USER_COOKIE}=garbage` } });
    expect(await stale.json()).toEqual({ login: null });
    expect(cookieNamed(stale.headers.getSetCookie(), USER_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);

    const none = await fetch(`${base}/whoami`);
    expect(await none.json()).toEqual({ login: null });
    expect(cookieNamed(none.headers.getSetCookie(), USER_COOKIE)).toBeUndefined();
  });
});
