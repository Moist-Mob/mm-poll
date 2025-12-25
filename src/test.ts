import { resolve } from 'node:path';
import { initPoll } from './poll.js';
import { initConfig } from './config.js';

import Debug from 'debug';
import { initDb } from './db.js';

(async () => {
  const debug = Debug('vote:index');
  const dbfile = resolve(import.meta.dirname, '..', 'db.sqlite');

  const { config, pretty } = await initConfig();
  debug('Running configuration', pretty);

  const kysely = await initDb(dbfile);

  const poll = initPoll({ kysely });

  await poll.getResults(2);
})();
