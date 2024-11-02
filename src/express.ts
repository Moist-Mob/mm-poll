import { resolve } from 'node:path';

import express, { type Express } from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import expressSession from 'express-session';
import createMemoryStore from 'memorystore';

import Debug from 'debug';

import { Env } from './config';
import { ExpressContext, PDeps } from './deps';
import { TwitchUser } from './jwt';
import { nanoid } from 'nanoid';

const admins = Object.assign(Object.create(null), {
  '241636': true,
  '25022069': true,
});

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

  {
    // we're not using sessions for anything other than nonces...
    const MemoryStore = createMemoryStore(expressSession);
    const store = new MemoryStore({
      checkPeriod: 86400_000, // prune expired entries every 24h
    });
    const session = expressSession({
      cookie: { maxAge: 7 * 86400_000 },
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
    const user = req.session.user ?? JWT.verifyUser(req.cookies['twitch-user']);
    req.session.user = user;
    req.session.admin = user && user.user_id in admins;

    if (!user) {
      res.clearCookie('twitch-user');
    } else if (!Object.prototype.hasOwnProperty.call(req.cookies, 'twitch-user')) {
      const [cookie, expires] = JWT.signUser(user);
      console.log('setting cookie');
      res.cookie('twitch-user', cookie, { expires: expires.toJSDate() });
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
