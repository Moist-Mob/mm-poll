import type { RequestHandler, Application } from 'express';
import express from 'express';
import { nanoid } from 'nanoid';

import Debug from 'debug';

import { PDeps } from '../deps.js';
import { TwitchUser } from '../user.js';
import { assertSchema, DunkOrSlam_uid, sendError } from '../util.js';

export interface AuthFns {
  mount(app: Application, path: string): void;
  authRedirect: RequestHandler;
}

// only ever send users back to a local path; anything else falls back to home
export const sanitizeReturnTo = (v: unknown): string =>
  typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/';

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

  // pages that need a logged-in user: pass through if we have one, otherwise
  // run the oauth dance and come back to this same url
  const authRedirect: RequestHandler = (req, res, next) => {
    if (req.session.user) {
      next();
      return;
    }
    debug('no user, attempting login with redirect back to', req.originalUrl);
    res.redirect(`${authUrl('login')}?returnTo=${encodeURIComponent(req.originalUrl)}`);
  };

  const fetchTwitchUser = async (code: string): Promise<TwitchUser> => {
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
    // a fresh state nonce and destination for this attempt, stored in the
    // session: it survives server restarts (the store is on disk), and a
    // retry or a second tab simply overwrites it
    const oauth = { state: nanoid(16), returnTo: sanitizeReturnTo(req.query.returnTo) };
    req.session.oauth = oauth;

    const twitchAuth = new URL('https://id.twitch.tv/oauth2/authorize');
    twitchAuth.searchParams.set('response_type', 'code');
    twitchAuth.searchParams.set('client_id', twitch.app.clientId);
    const callback = authUrl('callback');
    debug('login callback', callback);
    twitchAuth.searchParams.set('redirect_uri', callback);
    twitchAuth.searchParams.set('state', oauth.state);
    // twitchAuth.searchParams.set('scope', 'user:read:follows');
    res.redirect(twitchAuth.toString());
  });

  router.get('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/');
    });
  });

  router.get('/callback', async (req, res) => {
    debug('callback');
    // the state we issued is one-shot: consume it no matter how this goes
    const oauth = req.session.oauth;
    req.session.oauth = undefined;

    if (!oauth) {
      // no login in flight: a direct visit, or the session cookie didn't
      // come back (e.g. an in-app browser blocking cookies)
      debug('callback without an oauth flow in the session');
      sendError(res, 'Login failed. Please try the link again.');
      return;
    }

    const code = req.query.code;
    if (typeof code !== 'string' || !code) {
      debug('invalid oauth code', req.query);
      const error_description = req.query.error_description;
      const msg = typeof error_description === 'string' ? error_description : 'oauth failure';
      sendError(res, msg);
      return;
    }

    if (req.query.state !== oauth.state) {
      // a stale attempt (an older tab, a replay); don't consume the code.
      // Send them where they were headed, which restarts login if needed
      debug('oauth state mismatch');
      res.redirect(oauth.returnTo);
      return;
    }

    try {
      const user = await fetchTwitchUser(code);
      // fresh session id for the freshly authenticated user (fixation)
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate(err => (err ? reject(err) : resolve()));
      });
      req.session.user = user;
      req.session.localId = nanoid();
      res.redirect(oauth.returnTo);
    } catch (err) {
      debug('oauth callback failed', err);
      sendError(res, 'oauth failure');
    }
  });

  return {
    mount: (app, path) => {
      authBase.pathname = path.endsWith('/') ? path : `${path}/`;
      app.use(path, router);
    },
    authRedirect,
  };
};
