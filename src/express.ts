import { resolve } from 'node:path';

import express, { type Express } from 'express';
import bodyParser from 'body-parser';
import expressSession from 'express-session';
import Debug from 'debug';
import { nanoid } from 'nanoid';

import { Env } from './config.js';
import { ExpressContext, PDeps } from './deps.js';
import { type OauthFlow, type TwitchUser } from './user.js';
import { SqliteSessionStore } from './session-store.js';

declare module 'express-session' {
  interface SessionData {
    // per-session CSRF token, embedded in forms and checked on POST
    localId: string;
    user?: TwitchUser;
    // an oauth login in flight (see routers/auth.ts)
    oauth?: OauthFlow;
  }
}

export const initExpress = async ({
  config,
  liquid,
  secrets,
  kysely,
}: PDeps<'config' | 'liquid' | 'secrets' | 'kysely'>): Promise<Express> => {
  const debug = Debug('vote:express');

  const { session: sessionSecrets } = await secrets.load();

  const app = express();
  app.locals.site = {
    startTS: Date.now(),
    title: config.env === Env.Live ? config.title : `${Env[config.env]}> ${config.title}`,
  } as ExpressContext['site'];

  app.disable('x-powered-by');
  // we sit behind a reverse proxy that terminates TLS; trust its
  // X-Forwarded-* headers so `req.secure` (and thus cookie flags) is right
  app.set('trust proxy', 1);

  app.use(
    expressSession({
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
      store: new SqliteSessionStore(kysely),
      resave: false,
      secret: sessionSecrets.secret.unwrap(),
      saveUninitialized: false,
    })
  );

  app.use((req, res, next) => {
    // per-session CSRF token. Only logged-in sessions need one (every POST
    // requires a user), so anonymous visits never materialize a session row.
    // The login callback mints it; this is the backstop.
    if (req.session.user && !req.session.localId) {
      req.session.localId = nanoid();
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

  return app;
};
