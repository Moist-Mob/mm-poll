import express from 'express';
import type { Request, RequestHandler, Application } from 'express';

import { nanoid } from 'nanoid';
import { type PDeps } from '../deps';
import { type TwitchUser } from '../jwt';
import { asInt, assertInt, isEligible, sendError, shd, shuffle } from '../util';
import { UserVisibleError } from '../errors';

export interface SiteFns {
  mount(app: Application, path: string): void;
}

export const initSiteRoutes = ({ poll, authRedirect }: PDeps<'poll' | 'authRedirect'>): SiteFns => {
  const router = express.Router();

  type Context = {
    user?: TwitchUser;
    admin?: boolean;
    localId?: string;
  };

  const context = <T = {}>(req: Request, extra: T = {} as T): Context & T => ({
    user: req.session.user,
    admin: req.session.admin,
    localId: req.session.localId,
    ...extra,
  });

  router.get('/', (req, res) => {
    res.render('hello', context(req));
  });

  router.get('/error', (req, res) => {
    res.render('error', context(req, { error: req.query.msg }));
  });

  router.get('/create', authRedirect, (req, res) => {
    if (!req.session.admin) {
      sendError(res, 'Access denied');
      return;
    }
    res.render('poll-create', context(req));
  });

  router.get('/poll/:poll_id/results', async (req, res) => {
    const poll_id = parseInt(req.params.poll_id);
    if (isNaN(poll_id)) {
      res.redirect('/');
      return;
    }
    const poll_ = await poll.getPoll(poll_id);
    if (poll_.open) {
      res.redirect(`/poll/${poll_id}`);
      return;
    }

    const rawResults = await poll.getResults(poll_id);
    const ctx = context(req, rawResults);

    res.render('poll-results', ctx);
  });

  router.get('/poll/:poll_id', authRedirect, async (req, res) => {
    const poll_id = parseInt(req.params.poll_id);
    if (isNaN(poll_id)) {
      res.redirect('/');
      return;
    }
    const user = req.session.user!;
    const eligible = isEligible(user);
    try {
      const poll_ = await poll.getPoll(poll_id);
      const remaining = shd(poll_.closes_on.diffNow().toMillis());

      if (eligible !== true) {
        res.render('poll-show', context(req, { remaining, eligible_msg: eligible[1]! }));
        return;
      }

      const vote = await poll.getVote(poll_, user.user_id);
      if (!poll_.open) {
        res.redirect(`/poll/${poll_id}/results`);
      } else if (vote.length > 1) {
        res.render('poll-show', context(req, { remaining, poll: poll_, ranks: vote }));
      } else {
        res.render('poll-cast', context(req, { remaining, poll: poll_, ranks: vote }));
      }
    } catch (e) {
      console.error(e);
      res.status(404).render('error', context(req, { error: 'Poll not found' }));
    }
  });

  // check csrf-token and user
  const validatePost: RequestHandler = (req, res, next) => {
    const sessionToken = req.session.localId;
    const formToken = req.body['csrf-token'];

    if (!formToken || !sessionToken || formToken !== sessionToken) {
      console.error('bad csrf token');
      sendError(res, 'Invalid submission');
      return;
    }
    // we've used this token, make a new one
    req.session.localId = nanoid();

    const user = req.session.user;
    if (!user) {
      console.error('no user');
      sendError(res, 'Invalid submission');
      return;
    }

    next();
  };

  router.post('/vote', validatePost, async (req, res) => {
    const user = req.session.user!;

    const poll_id = asInt(req.body.poll_id);
    if (!poll_id) {
      console.error('no poll_id');
      sendError(res, 'Invalid submission');
      return;
    }

    const ranks = req.body.ranks;
    if (!Array.isArray(ranks) || ranks.length === 0) {
      console.error('no votes specified');
      sendError(res, 'You must select at least one option!');
      return;
    }

    try {
      const ranks_option_ids = ranks.map(assertInt);
      await poll.castVote(req.body.poll_id, user, ranks_option_ids);
    } catch (e) {
      if (e instanceof UserVisibleError) {
        sendError(res, e.message);
      } else {
        console.error('other error', e);
        sendError(res, '(Server error)');
      }
      return;
    }
    res.redirect(`/poll/${poll_id}`);
  });

  router.post('/create', validatePost, async (req, res) => {
    if (!req.session.admin) {
      console.error('refusing to create poll: non-admin');
      sendError(res, 'Access denied');
      return;
    }

    try {
      const poll_id = await poll.createPoll(req.body);
      console.log('created', poll_id);
      res.redirect(`/poll/${poll_id}`);
    } catch (e) {
      if (e instanceof UserVisibleError) {
        sendError(res, e.message);
      } else {
        console.log('failed', e);
        sendError(res, '(Server error)');
      }
    }
  });

  return {
    mount: (app, path) => {
      app.use(path, router);
    },
  };
};
