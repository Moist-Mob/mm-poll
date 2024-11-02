import express, { type Request, type Response, type Router } from 'express';
import { type PDeps } from '../deps';
import { type TwitchUser } from '../jwt';
import { asInt, assertInt, shuffle } from '../util';
import humanizeDuration from 'humanize-duration';

export const initSiteRoutes = ({ poll }: PDeps<'poll'>): Router => {
  const shd = humanizeDuration.humanizer({
    // language: 'shortEn',
    delimiter: ' ',
    spacer: ' ',
    units: ['d', 'h', 'm', 's'],
    round: true,
    // languages: {
    //   shortEn: {
    //     y: () => 'y',
    //     mo: () => 'mo',
    //     w: () => 'w',
    //     d: () => 'd',
    //     h: () => 'h',
    //     m: () => 'm',
    //     s: () => 's',
    //     ms: () => 'ms',
    //   },
    // },
  });

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

  router.get('/create', (req, res) => {
    if (!req.session.admin) {
      res.redirect('/');
      return;
    }
    res.render('create', context(req));
  });

  router.get('/poll/:poll_id', async (req, res) => {
    const poll_id = parseInt(req.params.poll_id);
    if (isNaN(poll_id)) {
      res.status(400).send('Invalid poll_id');
      return;
    }
    const user_id = req.session.user?.user_id;
    if (typeof user_id !== 'string') {
      res.status(403).send('Invalid session');
      return;
    }

    try {
      const vote = await poll.getVote(poll_id, user_id);
      const diff = vote.closes_on.getTime() - Date.now();
      const remaining = shd(diff);

      const ctx = context(req, { vote, remaining });
      if (!vote.open) {
        res.render('poll-results', ctx);
      } else if (vote.ranks.length === 0) {
        vote.options = shuffle(vote.options);
        res.render('poll-cast', ctx);
      } else {
        res.render('poll-show', ctx);
      }
    } catch (e) {
      console.error(e);
      res.status(404).render('error', context(req, { error: 'Poll not found' }));
    }
  });

  router.post('/vote', async (req, res) => {
    const sessionToken = req.session.localId;
    const formToken = req.body['csrf-token'];

    if (!formToken || !sessionToken || formToken !== sessionToken) {
      res.status(400).render('error', context(req, { error: 'Invalid submission' }));
      return;
    }

    const user = req.session.user;
    if (!user) {
      res.status(400).render('error', context(req, { error: 'Invalid submission' }));
      return;
    }

    const poll_id = asInt(req.body.poll_id);
    if (!poll_id) {
      res.status(400).render('error', context(req, { error: 'Invalid submission' }));
      return;
    }

    const ranks = req.body.ranks;
    if (!Array.isArray(ranks) || ranks.length === 0) {
      res.status(400).render('error', context(req, { error: 'Invalid submission' }));
      return;
    }

    try {
      const ranks_option_ids = ranks.map(assertInt);
      await poll.castVote(req.body.poll_id, user.user_id, ranks_option_ids);
    } catch (e) {
      res.status(400).render('error', context(req, { error: 'Invalid submission' }));
      return;
    }
    res.redirect(`/poll/${poll_id}`);
  });

  router.post('/create', (req, res) => {
    const sessionToken = req.session.localId;
    const formToken = req.body['csrf-token'];

    if (!formToken || !sessionToken || formToken !== sessionToken) {
      res.status(400).render('error', context(req, { error: 'Invalid CSRF token' }));
      return;
    }

    if (!req.session.admin) {
      res.status(400).render('error', context(req, { error: 'Access denied' }));
      return;
    }

    poll
      .createPoll(req.body)
      .then(poll_id => {
        console.log('created', poll_id);
        res.redirect(`/poll/${poll_id}`);
      })
      .catch(err => {
        console.log('failed', err);
        res.status(400).send('Create poll failed');
      });
  });

  return router;
};
