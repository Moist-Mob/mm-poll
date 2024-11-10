import { resolve } from 'node:path';

import { Static, Type as T } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import Debug from 'debug';

const ENV_ENVNAME = process.env.ENVNAME;
const ENV_HOSTNAME = process.env.HOSTNAME;
const ENV_BIND_PORT = process.env.BIND_PORT;
const ENV_ORIGIN = process.env.ORIGIN;
const ENV_TITLE = process.env.TITLE;
const ENV_VIEW_DIR = process.env.VIEW_DIR;
const ENV_SECRETS_FILE = process.env.SECRETS_FILE;

const debug = Debug('vote:config');

export type Config = Static<typeof Config>;

export enum Env {
  Dev,
  Live,
}

const Config = T.Object({
  port: T.Number({ exclusiveMinimum: 0, maximum: 65535 }),
  title: T.String(),
  origin: T.String(),
  env: T.Enum(Env),
  views: T.String(),
  secrets: T.String(),
});

const HOP = (obj: any, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const noTrailingSlash = (str: string) => (str.endsWith('/') ? str.slice(0, -1) : str);

const getOrigin = (): string => {
  if (ENV_ORIGIN) {
    try {
      return new URL(ENV_ORIGIN).toString();
    } catch (e) {
      debug(`Invalid ORIGIN set in env: '${ENV_ORIGIN}'`);
    }
  }

  return new URL(`http://${ENV_HOSTNAME ?? 'localhost'}:${ENV_BIND_PORT ?? '3000'}/`).toString();
};

export const initConfig = async (): Promise<{ config: Config; pretty: any }> => {
  const origin = getOrigin();
  const env = ENV_ENVNAME ?? 'Dev';

  const config: Config = {
    port: parseInt(ENV_BIND_PORT ?? '3000', 10),
    title: ENV_TITLE ?? 'Vote',
    origin: noTrailingSlash(origin.toString()),
    env: HOP(Env, env) ? (Env as any)[env] : Env.Dev,
    views: ENV_VIEW_DIR ?? resolve(import.meta.dirname, '..', 'views'),
    secrets: resolve(import.meta.dirname, '..', ENV_SECRETS_FILE ?? 'secrets.json'),
  };

  if (!Value.Check(Config, config)) {
    for (const err of Value.Errors(Config, config)) {
      debug('Invalid config:');
      debug(`${err.path}: ${err.message}`);
    }
    process.exit(1);
  }

  return {
    config,
    pretty: {
      ...config,
      env: Env[config.env],
    },
  };
};
