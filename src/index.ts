import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { initConfig } from './config.js';
import { initExpress } from './express.js';
import { initLiquid } from './express-liquid.js';
import { initSiteRoutes } from './routers/site.js';
import { initSecrets } from './config/secrets.js';
import { initAuthRoutes } from './routers/auth.js';
import { initTwurple } from './twurple.js';
import { initJWT } from './jwt.js';
import { initPoll } from './poll.js';
import { initDb } from './db.js';
import { initApiRoutes } from './routers/api.js';

import Debug from 'debug';

(async () => {
  const debug = Debug('vote:index');

  const dbfile = resolve(import.meta.dirname, '..', 'db.sqlite');

  const { config, pretty } = await initConfig();
  debug('Running configuration', pretty);

  const secrets = initSecrets(config.secrets);
  await secrets.load();

  const kysely = await initDb(dbfile);

  const apiClient = await initTwurple({ secrets });

  const liquid = initLiquid({ config });
  const JWT = await initJWT({ secrets });
  const app = await initExpress({ config, liquid, JWT });
  const poll = initPoll({ kysely });

  const { mount: mountAuth, authRedirect } = await initAuthRoutes({ config, secrets, apiClient });
  mountAuth(app, '/auth');

  const { mount: mountApi } = initApiRoutes({ poll });
  mountApi(app, '/api');

  const { mount: mountSite } = initSiteRoutes({ poll, authRedirect });
  mountSite(app, '/');

  const server = createServer(app);
  server.listen(config.port, () => {
    console.log('listening on port', config.port, 'origin', config.origin);
  });
  server.on('error', err => {
    console.error(err);
    process.exit(1);
  });
})();
