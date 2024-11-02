import type { Request as ExpressRequest, RequestHandler, Application } from 'express';
import express from 'express';
import { nanoid } from 'nanoid';
import { DateTime } from 'luxon';
import { LRUCache } from 'lru-cache';

import Debug from 'debug';

import { PDeps } from '../deps';
import { TwitchUser } from '../jwt';
import { assertSchema, sendError } from '../util';

const stateCache = new LRUCache({
  max: 1000,
  ttl: 5 * 60 * 1000,
});

export interface AuthFns {
  mount(app: Application, path: string): void;
  authRedirect: RequestHandler;
}

export const initAuthRoutes = async ({
  config,
  secrets,
  apiClient,
}: PDeps<'config' | 'secrets' | 'apiClient'>): Promise<AuthFns> => {
  const debug = Debug('vote:auth');
  const router = express.Router();

  const authBase = new URL(config.origin);
  const { twitch } = await secrets.load();

  const authUrl = (path: string): string => {
    const authUrl = new URL(path, authBase).toString();
    // debug({ authBase: authBase.toString(), authUrl });
    return authUrl;
  };

  const authRedirect: RequestHandler = (req, res, next) => {
    const { user, authRedirect } = req.session;

    if (user && authRedirect) {
      debug('have user and redirect, attempting to return to', authRedirect.returnTo);
      req.session.authRedirect = undefined;
      res.redirect(authRedirect.returnTo);
    } else if (user && !authRedirect) {
      debug('have user and no redirect, passing through');
      next();
    } else if (!user && !authRedirect) {
      debug('no user, attempting login with redirect back to', req.path);
      // attempt login
      req.session.authRedirect = {
        returnTo: req.path,
      };
      res.redirect(authUrl('login'));
    } else if (!user && authRedirect) {
      debug('no user, but redirect is set; clearing and sending to /');
      // if we have redirect set but no user, login failed
      // reset and redirect to /
      req.session.authRedirect = undefined;
      res.redirect('/');
    } else {
      next('impossiburu');
    }
  };

  const DunkOrSlam_uid = '241636';

  const fetchTwitchUser = async (req: ExpressRequest, code: string): Promise<TwitchUser> => {
    const url = new URL('https://id.twitch.tv/oauth2/token');
    const searchParams = new URLSearchParams();
    searchParams.set('client_id', twitch.app.clientId);
    searchParams.set('client_secret', twitch.app.clientSecret.unwrap());
    searchParams.set('grant_type', 'authorization_code');
    searchParams.set('code', code);
    searchParams.set('redirect_uri', authUrl('callback'));

    const token = await fetch(url, {
      method: 'POST',
      body: searchParams,
    }).then(res => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    });

    const validated = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: {
        Authorization: `OAuth ${token.access_token}`,
      },
    })
      .then(res => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then(data => assertSchema(TwitchUser, { ...data, followed_on: -1 }));

    const followAge = await apiClient.channels.getChannelFollowers(DunkOrSlam_uid, validated.user_id);
    if (followAge.data.length === 0) {
      debug('follow age check: user does not follow', validated.user_id, validated.login);
    } else if (followAge.data.length === 1) {
      validated.followed_on = followAge.data[0].followDate.getTime();
    } else {
      debug(
        'follow age check: got multiple results??',
        validated.user_id,
        followAge.data.map(({ userId, userName }) => ({ userId, userName }))
      );
    }

    return validated;
  };

  router.get('/login', (req, res) => {
    const state = nanoid(16);
    stateCache.set(state, 1);
    const twitchAuth = new URL('https://id.twitch.tv/oauth2/authorize');
    twitchAuth.searchParams.set('response_type', 'code');
    twitchAuth.searchParams.set('client_id', twitch.app.clientId);
    const callback = authUrl('callback');
    debug('login callback', callback);
    twitchAuth.searchParams.set('redirect_uri', callback);
    twitchAuth.searchParams.set('state', state);
    // twitchAuth.searchParams.set('scope', 'user:read:follows');
    res.redirect(twitchAuth.toString());
  });

  router.get('/logout', (req, res) => {
    res.clearCookie('twitch-user');
    req.session.destroy(() => {
      res.redirect('/');
    });
  });

  router.get(
    '/callback',
    async (req, res, next) => {
      debug('callback');
      const code = req.query.code as string;
      if (typeof code !== 'string' || !code) {
        debug('invalid oauth code', req.query);
        const error_description = req.query.error_description;
        const msg = typeof error_description === 'string' ? error_description : 'oauth failure';
        sendError(res, msg);
        return;
      }
      const state = req.query.state as string;
      if (typeof state !== 'string' || !stateCache.has(state)) {
        debug('invalid oauth state');
        sendError(res, 'oauth failure');
        return;
      }
      stateCache.delete(state);

      try {
        req.session.user = await fetchTwitchUser(req, code);
        next();
      } catch (err) {
        debug('oauth callback failed', err);
        next('oauth failure');
      }
    },
    authRedirect,
    (req, res) => {
      res.redirect('/');
    }
  );

  return {
    mount: (app, path) => {
      authBase.pathname = path.endsWith('/') ? path : `${path}/`;
      app.use(path, router);
    },
    authRedirect,
  };
};
