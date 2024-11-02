import { type ApiClient } from '@twurple/api';
import { type Kysely } from 'kysely';
import { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { type Config } from './config';
import { type SecretsFileSource } from './config/secrets';
import { type JWT } from './jwt';
import { type Database } from './db/types';
import { PollFns } from './poll';

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
};
export type PDeps<Ks extends keyof Deps> = Pick<Deps, Ks>;
