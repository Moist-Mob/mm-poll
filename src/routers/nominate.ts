import express from 'express';
import type { Application } from 'express';

import { type PDeps } from '../deps.js';
import { asInt, context, followRuleText, isAdmin, isEligible, sendError, validatePost } from '../util.js';
import { UserVisibleError } from '../errors.js';

export interface NominateFns {
  mount(app: Application, path: string): void;
}

export const initNominateRoutes = ({
  nominations,
  authRedirect,
  apiClient,
  config,
}: PDeps<'nominations' | 'authRedirect' | 'apiClient' | 'config'>): NominateFns => {
  const router = express.Router();

  router.get('/', authRedirect, async (req, res) => {
    const user = req.session.user!;
    const eligible = isEligible(user, config.followAgeDays);
    const mine = eligible === true ? await nominations.mine(user.user_id) : [];
    res.render(
      'nominate',
      context(req, {
        eligible: eligible === true,
        eligible_msg: eligible === true ? '' : eligible[1],
        follow_rule: followRuleText(config.followAgeDays),
        mine,
      })
    );
  });

  // autocomplete against twitch's game catalog (igdb-backed). Login required
  // so the proxy can't be hammered anonymously
  router.get('/search', async (req, res) => {
    if (!req.session.user) {
      res.status(403).json({ error: 'login required' });
      return;
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }
    try {
      const found = await apiClient.search.searchCategories(q);
      res.json({
        results: found.data.slice(0, 10).map(g => ({ id: g.id, name: g.name, box_art: g.boxArtUrl })),
      });
    } catch (e) {
      console.error('category search failed', e);
      res.status(502).json({ error: 'search failed' });
    }
  });

  router.post('/', validatePost, async (req, res) => {
    const user = req.session.user!;
    const category_id = typeof req.body.category_id === 'string' ? req.body.category_id.trim() : '';
    if (!/^[0-9]+$/.test(category_id)) {
      sendError(res, 'Invalid submission');
      return;
    }
    try {
      // resolve the category server-side: the client only names an id, so a
      // hand-crafted POST can't invent a title
      const game = await apiClient.games.getGameById(category_id);
      if (!game) {
        sendError(res, 'Unknown game');
        return;
      }
      await nominations.nominate(user, { id: game.id, name: game.name });
    } catch (e) {
      if (e instanceof UserVisibleError) {
        sendError(res, e.message);
      } else {
        console.error('nomination failed', e);
        sendError(res, '(Server error)');
      }
      return;
    }
    res.redirect('/nominate');
  });

  router.post('/remove', validatePost, async (req, res) => {
    const user = req.session.user!;
    const category_id = typeof req.body.category_id === 'string' ? req.body.category_id : '';
    await nominations.remove(user, category_id);
    res.redirect('/nominate');
  });

  // the scored candidate list the create-poll page fills from
  router.get('/top', async (req, res) => {
    if (!isAdmin(req.session.user)) {
      res.status(403).json({ error: 'admin only' });
      return;
    }
    const n = (typeof req.query.n === 'string' ? asInt(req.query.n) : undefined) ?? 25;
    res.json({ nominations: await nominations.top(Math.min(Math.max(n, 1), 100)) });
  });

  return {
    mount: (app, path) => {
      app.use(path, router);
    },
  };
};
