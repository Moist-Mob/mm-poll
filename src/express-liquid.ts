import path from 'node:path';

import { Liquid } from 'liquidjs';

import { Env } from './config';
import { ExpressContext, ExpressRenderer, PDeps } from './deps';

export const initLiquid = ({ config }: PDeps<'config'>): ExpressRenderer => {
  const engine = new Liquid({
    root: path.resolve(config.views),
    extname: '.liquid',
    cache: config.env === Env.Live,
    layouts: path.resolve(config.views, 'layouts'),
    partials: path.resolve(config.views, 'partials'),
  });

  const render: ExpressRenderer = (path, options, callback): void => {
    const { _locals, site, settings, ...rest } = options as ExpressContext;
    engine
      .renderFile(path, rest, { globals: site })
      .then(res => callback(null, res))
      .catch(callback);
  };

  return render;
};
