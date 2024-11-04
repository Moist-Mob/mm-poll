import express from 'express';
import type { Application } from 'express';

import { type PDeps } from '../deps';

export interface ApiFns {
  mount(app: Application, path: string): void;
}

export const initApiRoutes = ({ poll }: PDeps<'poll'>): ApiFns => {
  const router = express.Router();

  router.get('/poll/:poll_id', async (req, res) => {
    const poll_id = parseInt(req.params.poll_id);
    if (isNaN(poll_id)) {
      res.status(400).json({ error: 'invalid poll_id' });
      res.redirect('/');
      return;
    }

    try {
      const results = await poll.getResults(poll_id);
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
