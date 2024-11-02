import express, { type Router } from 'express';
import type { Request as ExpressRequest } from 'express-serve-static-core';

import { PDeps } from '../deps';
import { TwitchUser, Vote } from '../jwt';
import { nanoid } from 'nanoid';
import { LRUCache } from 'lru-cache';
import { assertSchema } from '../util';

const stateCache = new LRUCache({
  max: 1000,
  ttl: 5 * 60 * 1000,
});

export const initAuthRoutes = async ({
  config,
  secrets,
  apiClient,
  JWT,
}: PDeps<'config' | 'secrets' | 'apiClient' | 'JWT'>): Promise<Router> => {
  const router = express.Router();

  const { twitch } = await secrets.load();

  const authUrl = (path: string, req: ExpressRequest): string => {
    let baseUrl = `${config.origin}${req.baseUrl}`;
    if (!baseUrl.endsWith('/')) baseUrl += '/';

    return new URL(path, baseUrl).toString();
  };

  const fetchTwitchUser = async (req: ExpressRequest, code: string): Promise<TwitchUser> => {
    const url = new URL('https://id.twitch.tv/oauth2/token');
    const searchParams = new URLSearchParams();
    searchParams.set('client_id', twitch.app.clientId);
    searchParams.set('client_secret', twitch.app.clientSecret.unwrap());
    searchParams.set('grant_type', 'authorization_code');
    searchParams.set('code', code);
    searchParams.set('redirect_uri', authUrl('callback', req));

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
      .then(data => assertSchema(TwitchUser, data));

    return validated;
  };

  router.get('/login', (req, res) => {
    const state = nanoid(16);
    stateCache.set(state, 1);
    const twitchAuth = new URL('https://id.twitch.tv/oauth2/authorize');
    twitchAuth.searchParams.set('response_type', 'code');
    twitchAuth.searchParams.set('client_id', twitch.app.clientId);
    twitchAuth.searchParams.set('redirect_uri', authUrl('callback', req));
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

  router.get('/callback', async (req, res) => {
    const code = req.query.code as string;
    if (typeof code !== 'string' || !code) {
      console.error('invalid code in callback:', code);
      res.status(400).end('invalid oauth code');
      return;
    }
    const state = req.query.state as string;
    if (typeof state !== 'string' || !stateCache.has(state)) {
      console.error('invalid state in callback:', state);
      res.status(400).end('invalid oauth state');
      return;
    }
    stateCache.delete(state);

    await fetchTwitchUser(req, code)
      .then(twitchUser => {
        req.session.user = twitchUser;
      })
      .catch(err => {
        console.error('oauth callback failed', err);
      });

    res.redirect('/');
  });

  return router;
};
