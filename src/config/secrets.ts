import { StaticDecode, StaticEncode, Type as T } from '@sinclair/typebox';

import { TSecret } from './secret.js';
import { FileSource } from './file_source.js';

const AppCredentials = T.Object({
  clientId: T.String(),
  clientSecret: TSecret('twitch.clientSecret', T.String()),
});

const UserCredentials = T.Object({
  accessToken: TSecret('twitch.accessToken', T.String()),
  refreshToken: TSecret('twitch.refreshToken', T.Union([T.Null(), T.String()])),
  scope: T.Array(T.String()),
  obtainmentTimestamp: T.Number(),
  expiresIn: T.Union([T.Null(), T.Number()]),
});

const TwitchSecrets = T.Object({
  app: AppCredentials,
  user: UserCredentials,
});

const JWTSecrets = T.Object({
  secret: TSecret('jwt.secret', T.String()),
});
export const Secrets = T.Object({
  twitch: TwitchSecrets,
  jwt: JWTSecrets,
});

export type AppCredentials = StaticDecode<typeof AppCredentials>;
export type UserCredentials = StaticDecode<typeof UserCredentials>;
export type UpdateUserCredentials = StaticEncode<typeof UserCredentials>;
export type TwitchSecrets = StaticDecode<typeof TwitchSecrets>;
export type SecretsFileSource = FileSource<typeof Secrets>;

export const initSecrets = (abspath: string) => new FileSource(abspath, Secrets);
