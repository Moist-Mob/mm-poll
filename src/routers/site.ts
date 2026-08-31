import express from 'express';
import type { Request, RequestHandler, Application } from 'express';
import { nanoid } from 'nanoid';

import { Type as T } from '@sinclair/typebox';

import { type PDeps } from '../deps.js';
import { type TwitchUser } from '../jwt.js';
import { asInt, assertInt, assertSchema, followAgeText, isEligible, sendError, shd, shuffle } from '../util.js';
import { UserVisibleError } from '../errors.js';
import { KANO_SCALE, SMALL_SAMPLE } from '../kano.js';
import { type KanoUserAnswer } from '../poll.js';

// kano ballot form body: answers[o<option_id>][f|d] = "1".."5"
// (the "o" prefix keeps qs from treating numeric keys as array indices)
const KanoAnswers = T.Record(T.String({ pattern: '^o[0-9]+$' }), T.Object({ f: T.String(), d: T.String() }), {
  additionalProperties: false,
});

// parse the posted `answers` object into ballot rows; throws on malformed input
// (answer range and option ids are validated by castKanoVote)
export const parseKanoAnswers = (body: unknown): KanoUserAnswer[] =>
  Object.entries(assertSchema(KanoAnswers, body)).map(([key, { f, d }]) => ({
    option_id: assertInt(key.slice(1)),
    functional: assertInt(f) as KanoUserAnswer['functional'],
    dysfunctional: assertInt(d) as KanoUserAnswer['dysfunctional'],
  }));

export interface SiteFns {
  mount(app: Application, path: string): void;
}

export const initSiteRoutes = ({ poll, authRedirect, config }: PDeps<'poll' | 'authRedirect' | 'config'>): SiteFns => {
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

    try {
      const poll_ = await poll.getPoll(poll_id);
      if (poll_.open) {
        res.redirect(`/poll/${poll_id}`);
        return;
      }

      const rawResults = await poll.getResults(poll_id);
      const ctx = context(req, { ...rawResults, small_sample: SMALL_SAMPLE });

      res.render(rawResults.kind === 'kano' ? 'kano-results' : 'poll-results', ctx);
    } catch (e) {
      console.error(e);
      res.status(404).render('error', context(req, { error: 'Poll not found' }));
    }
  });

  router.get('/poll/:poll_id', authRedirect, async (req, res) => {
    const poll_id = parseInt(req.params.poll_id);
    if (isNaN(poll_id)) {
      res.redirect('/');
      return;
    }
    const user = req.session.user!;
    const eligible = isEligible(user, config.followAgeDays);
    try {
      const poll_ = await poll.getPoll(poll_id);
      const remaining = shd(poll_.closes_on.diffNow().toMillis());

      if (eligible !== true) {
        res.render(
          'poll-ineligible',
          context(req, {
            remaining,
            poll: poll_,
            eligible_msg: eligible[1],
            follow_age_days: config.followAgeDays,
            follow_age: followAgeText(config.followAgeDays),
          })
        );
        return;
      }

      if (!poll_.open) {
        res.redirect(`/poll/${poll_id}/results`);
        return;
      }

      if (poll_.kind === 'kano') {
        const answers = await poll.getKanoVote(poll_, user.user_id);
        if (answers.length > 0) {
          res.render('kano-show', context(req, { remaining, poll: poll_, answers }));
        } else {
          res.render('kano-cast', context(req, { remaining, poll: poll_, scale: KANO_SCALE }));
        }
        return;
      }

      const vote = await poll.getVote(poll_, user.user_id);
      if (vote.length > 0) {
        res.render('poll-show', context(req, { remaining, poll: poll_, ranks: vote }));
      } else {
        // present the options in a random order to avoid position bias; tie-breaks
        // in the count still use the streamer's order (option ids)
        const shuffled = { ...poll_, options: shuffle([...poll_.options]) };
        res.render('poll-cast', context(req, { remaining, poll: shuffled }));
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
      await poll.castVote(poll_id, user, ranks_option_ids);
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

  router.post('/vote/kano', validatePost, async (req, res) => {
    const user = req.session.user!;

    const poll_id = asInt(req.body.poll_id);
    if (!poll_id) {
      console.error('no poll_id');
      sendError(res, 'Invalid submission');
      return;
    }

    let answers: KanoUserAnswer[];
    try {
      answers = parseKanoAnswers(req.body.answers);
    } catch (e) {
      console.error('bad kano answers', e);
      sendError(res, 'You must answer both questions for every item!');
      return;
    }

    try {
      await poll.castKanoVote(poll_id, user, answers);
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

  router.post('/poll/:poll_id/close', validatePost, async (req, res) => {
    if (!req.session.admin) {
      console.error('refusing to close poll: non-admin');
      sendError(res, 'Access denied');
      return;
    }
    const poll_id = asInt(req.params.poll_id);
    if (!poll_id) {
      sendError(res, 'Invalid submission');
      return;
    }

    try {
      await poll.closePoll(poll_id);
      res.redirect(`/poll/${poll_id}/results`);
    } catch (e) {
      console.error('failed to close poll', e);
      sendError(res, '(Server error)');
    }
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
