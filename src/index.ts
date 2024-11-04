import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { initConfig } from './config';
import { initExpress } from './express';
import { initLiquid } from './express-liquid';
import { initSiteRoutes } from './routers/site';
import { initSecrets } from './config/secrets';
import { initAuthRoutes } from './routers/auth';
import { initTwurple } from './twurple';
import { initJWT } from './jwt';
import { initPoll } from './poll';
import { initDb } from './db';
import { initApiRoutes } from './routers/api';

(async () => {
  const dbfile = resolve(import.meta.dirname, '..', 'db.sqlite');

  const config = await initConfig();
  const secrets = initSecrets(config.secrets);
  await secrets.load();

  const kysely = await initDb(dbfile);

  const apiClient = await initTwurple({ secrets });
  // const res = await apiClient.channels.getChannelFollowers('241636', '25022069');

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
