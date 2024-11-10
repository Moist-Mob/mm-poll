import { type ApiClient } from '@twurple/api';
import { type Kysely } from 'kysely';
import { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { type RequestHandler } from 'express';

import { type Config } from './config.js';
import { type SecretsFileSource } from './config/secrets.js';
import { type JWT } from './jwt.js';
import { type Database } from './db/types.js';
import { type PollFns } from './poll.js';

export type ExpressContext = {
  settings: any;
  site: {
    startTS: number;
    title: string;
  };
  _locals: Record<string, any>;
};

export type ExpressRenderer = (path: string, options: object, callback: (e: any, rendered?: string) => void) => void;

export type Deps = {
  config: Config;
  liquid: ExpressRenderer;
  secrets: SecretsFileSource;
  apiClient: ApiClient;
  JWT: JWT;
  sqlite: BetterSqlite3Database;
  kysely: Kysely<Database>;
  poll: PollFns;
  authRedirect: RequestHandler;
};
export type PDeps<Ks extends keyof Deps> = Pick<Deps, Ks>;
