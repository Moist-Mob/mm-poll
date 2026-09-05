import { type Kysely } from 'kysely';

import { initDb } from './db.js';
import { testMigrationProvider } from './testing/migrations.js';
import {
  freshness,
  initNominations,
  NOMINATION_HALF_LIFE_DAYS,
  NOMINATION_MAX_AGE_DAYS,
  type NominationFns,
} from './nomination.js';
import { Config, Env } from './config.js';
import { type TwitchUser } from './user.js';
import { DAY_MS } from './util.js';
import { UserVisibleError } from './errors.js';
import { type Database } from './db/types.js';

const config: Config = {
  env: Env.Dev,
  port: 0,
  title: 't',
  origin: 'http://localhost',
  views: '',
  secrets: '',
  followAgeDays: 7,
};

const user = (id: string, followedDaysAgo = 30): TwitchUser => ({
  login: `user${id}`,
  user_id: id,
  followed_on: Date.now() - followedDaysAgo * DAY_MS,
});

describe('nominations (in-memory db)', () => {
  let kysely: Kysely<Database>;
  let nominations: NominationFns;

  beforeEach(async () => {
    kysely = await initDb(undefined, testMigrationProvider);
    nominations = initNominations({ kysely, config });
  });

  afterEach(async () => {
    await kysely.destroy();
  });

  // shift a game's nominations into the past
  const backdate = async (twitch_category_id: string, days: number) => {
    await kysely
      .updateTable('nomination')
      .set(eb => ({ nominated_on: eb('nominated_on', '-', days * DAY_MS) }))
      .where('twitch_category_id', '=', twitch_category_id)
      .execute();
  };

  it('records one nomination per viewer per game, refreshed on repeat', async () => {
    await nominations.nominate(user('1'), { id: '10', name: 'Celeste' });
    await backdate('10', NOMINATION_HALF_LIFE_DAYS); // an old first nomination...
    await nominations.nominate(user('1'), { id: '10', name: 'Celeste' }); // ...renewed
    await nominations.nominate(user('2'), { id: '10', name: 'Celeste' });

    const top = await nominations.top(10);
    expect(top).toHaveLength(1);
    expect(top[0]!.count).toBe(2);
    // both nominations are fresh again: the refresh replaced the old row
    expect(top[0]!.score).toBeCloseTo(2, 3);
  });

  it('weights each nomination by exponential decay, in sql', async () => {
    await nominations.nominate(user('1'), { id: '10', name: 'Celeste' });
    await nominations.nominate(user('2'), { id: '10', name: 'Celeste' });
    await backdate('10', NOMINATION_HALF_LIFE_DAYS);
    await nominations.nominate(user('3'), { id: '10', name: 'Celeste' });

    const [scored] = await nominations.top(10);
    expect(scored!.count).toBe(3);
    // two half-life-old halves plus one fresh whole
    expect(scored!.score).toBeCloseTo(2 * 0.5 + 1, 3);
  });

  it('many stale nominations lose to fewer fresh ones', async () => {
    for (const uid of ['1', '2', '3', '4']) {
      await nominations.nominate(user(uid), { id: 'old', name: 'Old Favorite' });
    }
    await backdate('old', 3 * NOMINATION_HALF_LIFE_DAYS); // 4 voices * 1/8 = 0.5
    await nominations.nominate(user('5'), { id: 'new', name: 'Fresh Pick' }); // 1

    const top = await nominations.top(10);
    expect(top.map(t => t.name)).toEqual(['Fresh Pick', 'Old Favorite']);
    // and the limit is applied after ordering
    expect((await nominations.top(1)).map(t => t.name)).toEqual(['Fresh Pick']);
  });

  it('shows the newest spelling of a renamed title', async () => {
    await nominations.nominate(user('1'), { id: '10', name: 'Okami' });
    await backdate('10', 10);
    await nominations.nominate(user('2'), { id: '10', name: 'Ōkami HD' });

    const [scored] = await nominations.top(10);
    expect(scored!.name).toBe('Ōkami HD');
  });

  it('prunes nominations too old to matter', async () => {
    await nominations.nominate(user('1'), { id: '10', name: 'Ancient' });
    await backdate('10', NOMINATION_MAX_AGE_DAYS + 1);
    expect(await nominations.top(10)).toEqual([]);
    expect(await kysely.selectFrom('nomination').select('nomination_id').execute()).toEqual([]);
  });

  it('viewers can list and withdraw their own nominations', async () => {
    await nominations.nominate(user('1'), { id: '1', name: 'A' });
    await nominations.nominate(user('1'), { id: '2', name: 'B' });
    await nominations.nominate(user('2'), { id: '1', name: 'A' });

    expect((await nominations.mine('1')).map(m => m.name)).toEqual(['B', 'A']);

    await nominations.remove(user('1'), '1');
    expect((await nominations.mine('1')).map(m => m.name)).toEqual(['B']);
    // the other viewer's nomination of the same game is untouched
    expect((await nominations.top(10)).find(t => t.twitch_category_id === '1')?.count).toBe(1);
  });

  it('grades each of a viewer\'s nominations by remaining weight', async () => {
    await nominations.nominate(user('1'), { id: '1', name: 'Fresh' });
    await nominations.nominate(user('1'), { id: '2', name: 'Aging' });
    await backdate('2', NOMINATION_HALF_LIFE_DAYS + 1);
    await nominations.nominate(user('1'), { id: '3', name: 'Stale' });
    await backdate('3', 2 * NOMINATION_HALF_LIFE_DAYS + 1);

    const mine = await nominations.mine('1');
    expect(mine.map(m => [m.name, m.freshness])).toEqual([
      ['Fresh', 'fresh'],
      ['Aging', 'aging'],
      ['Stale', 'stale'],
    ]);

    // the tier boundaries sit on whole half-lives
    const halfLife = NOMINATION_HALF_LIFE_DAYS * DAY_MS;
    expect(freshness(1000 - halfLife + 1, 1000)).toBe('fresh');
    expect(freshness(1000 - halfLife, 1000)).toBe('aging');
    expect(freshness(1000 - 2 * halfLife, 1000)).toBe('stale');
  });

  it('ineligible viewers cannot nominate', async () => {
    // does not follow
    await expect(
      nominations.nominate({ login: 'x', user_id: '9', followed_on: -1 }, { id: '1', name: 'A' })
    ).rejects.toThrow(UserVisibleError);
    // follows, but not long enough
    await expect(nominations.nominate(user('9', 1), { id: '1', name: 'A' })).rejects.toThrow(/Eligible/);
    expect(await nominations.top(10)).toEqual([]);
  });
});
