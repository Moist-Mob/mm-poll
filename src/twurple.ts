import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';

import { PDeps } from './deps';
import { UpdateUserCredentials } from './config/secrets';
import { Secret } from './config/secret';

export const initTwurple = async ({ secrets }: PDeps<'secrets'>): Promise<ApiClient> => {
  const { app: appCreds, user: userCreds } = (await secrets.load()).twitch;

  const updateUserCredentials = async (newCredentials: UpdateUserCredentials): Promise<void> => {
    const accessToken = new Secret('accessToken', newCredentials.accessToken);
    const refreshToken = new Secret('accessToken', newCredentials.refreshToken);

    await secrets.update(({ twitch: { user, ...rest }, ...others }) => ({
      twitch: {
        ...rest,
        user: {
          ...newCredentials,
          accessToken,
          refreshToken,
        },
      },
      ...others,
    }));
  };

  const authProvider = new RefreshingAuthProvider({
    clientId: appCreds.clientId,
    clientSecret: appCreds.clientSecret.unwrap(),
  });

  const tokenUserId = await authProvider.addUserForToken({
    accessToken: userCreds.accessToken.unwrap(),
    refreshToken: userCreds.refreshToken.unwrap(),
    scope: userCreds.scope,
    obtainmentTimestamp: userCreds.obtainmentTimestamp,
    expiresIn: userCreds.expiresIn,
  });
  console.log(`[init] addUserForToken: ${tokenUserId}`);

  authProvider.onRefresh(async (userId, token) => {
    try {
      await updateUserCredentials({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        scope: token.scope,
        obtainmentTimestamp: token.obtainmentTimestamp,
        expiresIn: token.expiresIn,
      });
      console.log(`[authProvider]: saved user credentials for userid=${userId}`);
    } catch (e) {
      console.log(
        `[authProvider]: failed to save user credentials for userid=${userId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  });

  authProvider.onRefreshFailure(reason => {
    console.log(`[authProvider]: failed to refresh token: ${reason}`);
  });

  const apiClient = new ApiClient({ authProvider });

  return apiClient;
};
