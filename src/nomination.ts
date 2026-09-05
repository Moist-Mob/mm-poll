import { sql } from 'kysely';

import { type PDeps } from './deps.js';
import { type TwitchUser } from './user.js';
import { DAY_MS, isEligible } from './util.js';
import { UserVisibleError } from './errors.js';

// Game votes happen every 3-12 months, so nominations decay slowly: worth
// half at two months, ~12% at six. There's no cap on how many games a viewer
// nominates; the falloff plus one-voice-per-game is the moderation. The
// scored list only surfaces candidates; the vote itself decides preference.
export const NOMINATION_HALF_LIFE_DAYS = 60;
// beyond ~4 half-lives (6%) a nomination is noise; the rows get deleted
export const NOMINATION_MAX_AGE_DAYS = 4 * NOMINATION_HALF_LIFE_DAYS;

// the traffic-light dot on a viewer's own list: how much weight a nomination
// still carries, in half-lives. Fresh under one (> 50% weight), aging under
// two (> 25%), stale beyond that until the prune at four. There's no bump
// button on purpose (it would just get mashed); re-nominating refreshes.
export type Freshness = 'fresh' | 'aging' | 'stale';
export const freshness = (nominated_on: number, now: number = Date.now()): Freshness => {
  const halfLives = (now - nominated_on) / (NOMINATION_HALF_LIFE_DAYS * DAY_MS);
  if (halfLives < 1) return 'fresh';
  if (halfLives < 2) return 'aging';
  return 'stale';
};

export type ScoredNomination = {
  twitch_category_id: string;
  name: string;
  count: number;
  score: number;
  newest_on: number;
};

export interface NominationFns {
  nominate(user: TwitchUser, category: { id: string; name: string }): Promise<void>;
  remove(user: TwitchUser, twitch_category_id: string): Promise<void>;
  mine(
    user_id: string
  ): Promise<{ twitch_category_id: string; name: string; nominated_on: number; freshness: Freshness }[]>;
  top(n: number): Promise<ScoredNomination[]>;
}

export const initNominations = ({ kysely, config }: PDeps<'kysely' | 'config'>): NominationFns => {
  const assertEligible = (user: TwitchUser): void => {
    const eligible = isEligible(user, config.followAgeDays);
    if (eligible !== true) throw new UserVisibleError(eligible[1]);
  };

  return {
    // one voice per (viewer, game): nominating again refreshes the timestamp
    async nominate(user, category) {
      assertEligible(user);
      const now = Date.now();
      await kysely
        .insertInto('nomination')
        .values({
          twitch_category_id: category.id,
          name: category.name,
          twitch_user_id: user.user_id,
          nominated_on: now,
        })
        .onConflict(oc =>
          oc.columns(['twitch_category_id', 'twitch_user_id']).doUpdateSet({ nominated_on: now, name: category.name })
        )
        .execute();
    },

    async remove(user, twitch_category_id) {
      await kysely
        .deleteFrom('nomination')
        .where('twitch_user_id', '=', user.user_id)
        .where('twitch_category_id', '=', twitch_category_id)
        .execute();
    },

    async mine(user_id) {
      const rows = await kysely
        .selectFrom('nomination')
        .select(['twitch_category_id', 'name', 'nominated_on'])
        .where('twitch_user_id', '=', user_id)
        .orderBy('nominated_on', 'desc')
        .orderBy('nomination_id', 'desc')
        .execute();
      const now = Date.now();
      return rows.map(row => ({ ...row, freshness: freshness(row.nominated_on, now) }));
    },

    async top(n) {
      const now = Date.now();
      // housekeeping: drop rows too old to matter
      await kysely
        .deleteFrom('nomination')
        .where('nominated_on', '<', now - NOMINATION_MAX_AGE_DAYS * DAY_MS)
        .execute();

      // score in sql: each nomination is weighted by exponential decay, one
      // group per game. The `* 1.0` keeps the division out of integer land,
      // and the bare `name` column resolves (per sqlite's bare-column rule)
      // to the MAX(nominated_on) row, i.e. the newest spelling of the title.
      const half_life_ms = NOMINATION_HALF_LIFE_DAYS * DAY_MS;
      return kysely
        .selectFrom('nomination')
        .select(eb => [
          'twitch_category_id',
          'name',
          eb.fn.countAll<number>().as('count'),
          sql<number>`sum(pow(0.5, (${now} - nominated_on) * 1.0 / ${half_life_ms}))`.as('score'),
          sql<number>`max(nominated_on)`.as('newest_on'),
        ])
        .groupBy('twitch_category_id')
        .orderBy('score', 'desc')
        .orderBy('newest_on', 'desc')
        .limit(n)
        .execute();
    },
  };
};
