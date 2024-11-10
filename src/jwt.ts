import { Static, Type as T, TSchema } from '@sinclair/typebox';
import jwt from 'jsonwebtoken';
import { DateTime } from 'luxon';
import Debug from 'debug';

import { PDeps } from './deps.js';
import { assertSchema } from './util.js';

const Vote = T.Object({
  poll_id: T.Number(),
  option_id: T.Number(),
});

export type Vote = Static<typeof Vote>;

export const TwitchUser = T.Object({
  login: T.String(),
  user_id: T.String(),
  followed_on: T.Number(),
});

export type TwitchUser = Static<typeof TwitchUser>;

export interface JWT {
  signUser: (data: unknown) => [token: string, expires: DateTime];
  verifyUser: (token: string | undefined) => TwitchUser | undefined;
}

export const initJWT = async ({ secrets }: PDeps<'secrets'>): Promise<JWT> => {
  const debug = Debug('vote:jwt');

  const {
    jwt: { secret: jwtSecret },
  } = await secrets.load();

  const sign =
    <T extends TSchema>(schema: T) =>
    (data: unknown): [token: string, expiry: DateTime] => {
      const later = DateTime.utc().plus({ days: 7 });
      const exp = later.toMillis() / 1000;
      const token = jwt.sign(
        {
          exp,
          data: assertSchema(schema, data),
        },
        jwtSecret.unwrap()
      );
      return [token, later];
    };

  const verify =
    <T extends TSchema>(schema: T) =>
    (token: string | undefined): Static<T> | undefined => {
      if (!token) return undefined;
      try {
        const decoded = jwt.verify(token, jwtSecret.unwrap()) as jwt.JwtPayload;
        return assertSchema(schema, decoded.data);
      } catch (e) {
        debug('failed to verify jwt', e instanceof Error ? e.message : String(e));
      }
    };

  return { signUser: sign(TwitchUser), verifyUser: verify(TwitchUser) };
};
