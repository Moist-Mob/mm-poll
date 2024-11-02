import { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Request, Response } from 'express';
import humanizeDuration from 'humanize-duration';

import type { TwitchUser } from './jwt';

export const assertSchema = <T extends TSchema>(schema: T, data: unknown): Static<T> => {
  if (Value.Check(schema, data)) return data;
  const errs: string = [...Value.Errors(schema, data)].map(e => `${e.path}: ${e.message}`).join('\n');
  throw new Error('Invalid data:\n' + errs);
};

export const asInt = (v: string | undefined): number | undefined => {
  if (typeof v !== 'string') return undefined;
  const num = parseInt(v, 10);
  return isNaN(num) ? undefined : num;
};

export const assertInt = (v: string | undefined): number => {
  const num = typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (isNaN(num)) throw new Error('Invalid integer');
  return num;
};

export const shuffle = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
};

export type Context = {
  user?: TwitchUser;
  admin?: boolean;
  localId?: string;
};

export const context = <T = {}>(req: Request, extra: T = {} as T): Context & T => ({
  user: req.session.user,
  admin: req.session.admin,
  localId: req.session.localId,
  ...extra,
});

export const sendError = (res: Response, error: string) => {
  res.redirect(`/error?msg=${encodeURIComponent(error)}`);
};

export const shd = humanizeDuration.humanizer({
  // language: 'shortEn',
  delimiter: ' ',
  spacer: ' ',
  units: ['d', 'h', 'm', 's'],
  round: true,
  // languages: {
  //   shortEn: {
  //     y: () => 'y',
  //     mo: () => 'mo',
  //     w: () => 'w',
  //     d: () => 'd',
  //     h: () => 'h',
  //     m: () => 'm',
  //     s: () => 's',
  //     ms: () => 'ms',
  //   },
  // },
});

export type Eligibility = true | [ms_to_wait: number, human_msg: string];

export const isEligible = (user: TwitchUser): Eligibility => {
  const followed_on = user.followed_on < 0 ? -Infinity : Date.now() - user.followed_on;
  const eligible_on = followed_on + 86400_000 * 7;
  const diff = Date.now() - eligible_on;

  if (isFinite(eligible_on) && diff > 0) return true;

  const msg = isFinite(diff)
    ? 'Eligible to participate in ' + shd(diff)
    : 'Must be a follower for 7 days to participate';
  return [diff, msg];
};
