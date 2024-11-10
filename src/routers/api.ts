import express from 'express';
import type { Application, RequestHandler } from 'express';

import { type PDeps } from '../deps.js';

export interface ApiFns {
  mount(app: Application, path: string): void;
}

export const initApiRoutes = ({ poll }: PDeps<'poll'>): ApiFns => {
  const router = express.Router();

  const requirePollClosed: RequestHandler = async (req, res, next) => {
    const poll_id = parseInt(req.params.poll_id, 10);
    if (isNaN(poll_id)) {
      res.status(400).json({ error: 'invalid poll_id' });
      return;
    }

    const poll_ = await poll.getPoll(poll_id);
    if (poll_.open) {
      res.status(403).json({ error: 'poll is ongoing' });
      return;
    }

    next();
  };

  router.get('/poll/:poll_id/results', requirePollClosed, async (req, res) => {
    const poll_id = parseInt(req.params.poll_id, 10);
    if (isNaN(poll_id)) {
      res.status(400).json({ error: 'invalid poll_id' });
      return;
    }

    try {
      const results = await poll.getResults(poll_id);
      res.json(results);
    } catch (e) {
      res.status(404).json({ error: 'not found' });
    }
  });

  router.get('/poll/:poll_id/audit', requirePollClosed, async (req, res) => {
    const poll_id = parseInt(req.params.poll_id, 10);
    if (isNaN(poll_id)) {
      res.status(400).json({ error: 'invalid poll_id' });
      return;
    }

    try {
      const results = await poll.audit(poll_id);
      res.json(results);
    } catch (e) {
      res.status(404).json({ error: 'not found' });
    }
  });

  return {
    mount: (app, path) => {
      app.use(path, router);
    },
  };
};
