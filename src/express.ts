import { resolve } from 'node:path';

import express, { type Express, type Request, type Response } from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import expressSession from 'express-session';
import createMemoryStore from 'memorystore';
import Debug from 'debug';
import { nanoid } from 'nanoid';

import { Env } from './config.js';
import { ExpressContext, PDeps } from './deps.js';
import { JWT, TwitchUser } from './jwt.js';
import { admins } from './util.js';

// sessions live in memory, so the logged-in user is also stashed in a signed
// JWT cookie; the middleware below recovers the session from it as needed
export const USER_COOKIE = 'twitch-user';

export const setUserCookie = (JWT: JWT, req: Request, res: Response, user: TwitchUser): void => {
  // drop any Set-Cookie for this name already queued on the response (e.g. a
  // clear issued by the session middleware before login completed)
  const pending = res.getHeader('Set-Cookie');
  if (pending !== undefined) {
    const kept = (Array.isArray(pending) ? pending : [String(pending)]).filter(c => !c.startsWith(`${USER_COOKIE}=`));
    res.setHeader('Set-Cookie', kept);
  }

  const [cookie, expires] = JWT.signUser(user);
  res.cookie(USER_COOKIE, cookie, {
    expires: expires.toJSDate(),
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
  });
};

export const clearUserCookie = (res: Response): void => {
  res.clearCookie(USER_COOKIE);
};

declare module 'express-session' {
  interface SessionData {
    authRedirect?: {
      returnTo: string;
    };
    localId: string;
    user?: TwitchUser;
    admin: boolean;
  }
}

export const initExpress = async ({ config, liquid, JWT }: PDeps<'config' | 'liquid' | 'JWT'>): Promise<Express> => {
  const debug = Debug('vote:express');

  const app = express();
  app.locals.site = {
    startTS: Date.now(),
    title: config.env === Env.Live ? config.title : `${Env[config.env]}> ${config.title}`,
  } as ExpressContext['site'];

  app.disable('x-powered-by');
  // we sit behind a reverse proxy that terminates TLS; trust its
  // X-Forwarded-* headers so `req.secure` (and thus cookie flags) is right
  app.set('trust proxy', 1);

  {
    // we're not using sessions for anything other than nonces...
    const MemoryStore = createMemoryStore(expressSession);
    const store = new MemoryStore({
      checkPeriod: 86400_000, // prune expired entries every 24h
    });
    const session = expressSession({
      cookie: {
        maxAge: 7 * 86400_000,
        httpOnly: true,
        // NOT 'strict': the OAuth return from twitch is a cross-site
        // navigation and strict cookies aren't sent on it (nor on the
        // redirect that follows), which orphans the freshly logged-in session
        sameSite: 'lax',
        // secure when the (proxied) request is https, but still works on
        // plain http for local runs
        secure: 'auto',
      },
      store,
      resave: false,
      secret: 'hi',
      saveUninitialized: false,
    });
    app.use(session);
  }
  app.use(cookieParser());

  app.use((req, res, next) => {
    if (!Object.prototype.hasOwnProperty.call(req.session, 'localId')) {
      req.session.localId = nanoid();
    }

    // we're only using memory for session storage, so we stash the user
    // info in a JWT in a cookie for recovery
    const hasUserCookie = Object.prototype.hasOwnProperty.call(req.cookies, USER_COOKIE);
    const user = req.session.user ?? JWT.verifyUser(req.cookies[USER_COOKIE]);
    req.session.user = user;
    req.session.admin = user && user.user_id in admins;

    if (!user) {
      // only bother clearing a cookie that's actually there (and invalid)
      if (hasUserCookie) clearUserCookie(res);
    } else if (!hasUserCookie) {
      debug('re-issuing user cookie for', user.login);
      setUserCookie(JWT, req, res, user);
    }

    next();
  });

  if (debug.enabled) {
    app.use(async (req, res, next) => {
      debug(req.session.user?.login ?? 'anonymous', req.method, req.path);
      next();
    });
  }

  if (config.env === Env.Dev) {
    app.use(express.static(resolve(import.meta.dirname, '..', 'public')));
  }

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  app.engine('liquid', liquid);
  app.set('view engine', 'liquid');

  // const favicon = require('serve-favicon');
  // app.use(favicon(PATH.join(__dirname, '..', 'static', 'favicon.ico')));

  return app;
};
