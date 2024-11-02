import { resolve } from 'node:path';
import { Static, Type as T } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

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
  const port = process.env.port ?? '3000';
  const origin = new URL(process.env.baseUrl ?? 'http://localhost');
  if (!process.env.port) {
    origin.port = port;
  }
  return origin;
}

export const initConfig = async (): Promise<Config> => {
  const origin = getOrigin();
  const env = process.env.env ?? 'Dev';

  const config: Config = {
    port: parseInt(process.env.port ?? '3000', 10),
    title: process.env.title ?? 'Vote',
    origin: noTrailingSlash(origin.toString()),
    env: HOP(Env, env) ? (Env as any)[env] : Env.Dev,
    views: process.env.views ?? resolve(import.meta.dirname, '..', 'views'),
    secrets: resolve(import.meta.dirname, '..', process.env.secrets ?? 'secrets.json'),
  };

  if (!Value.Check(Config, config)) {
    for (const err of Value.Errors(Config, config)) {
      console.error('Invalid config:');
      console.log(`${err.path}: ${err.message}`);
    }
    process.exit(1);
  }

  return config;
};
