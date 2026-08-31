import { Static, Type as T } from '@sinclair/typebox';

export const TwitchUser = T.Object({
  login: T.String(),
  user_id: T.String(),
  followed_on: T.Number(),
});

export type TwitchUser = Static<typeof TwitchUser>;

// an oauth login in flight: the state nonce we handed to twitch, and where to
// send the user once they come back from it
export const OauthFlow = T.Object({
  state: T.String(),
  returnTo: T.String(),
});

export type OauthFlow = Static<typeof OauthFlow>;
