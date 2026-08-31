import createSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { Migrator } from 'kysely/migration';

import { initDb } from './db.js';
import { initPoll, PollFns, RECENT_ENDED_DAYS, RECENT_ENDED_LIMIT } from './poll.js';
import { Database } from './db/types.js';
import { Config, Env } from './config.js';
import { TwitchUser } from './user.js';
import { KanoAnswer } from './kano.js';
import { UserVisibleError } from './errors.js';
import { testMigrationProvider } from './testing/migrations.js';

const { Like, Expect, Neutral, Tolerate, Dislike } = KanoAnswer;

// followed 30 days ago -> eligible
const user = (id: string): TwitchUser => ({
  login: `user${id}`,
  user_id: id,
  followed_on: Date.now() - 30 * 86400_000,
});

const config: Config = {
  env: Env.Dev,
  port: 0,
  title: 't',
  origin: 'http://localhost',
  views: '',
  secrets: '',
  followAgeDays: 7,
};

describe('poll (in-memory db)', () => {
  let poll: PollFns;
  let kysely: Kysely<Database>;

  beforeEach(async () => {
    kysely = await initDb(undefined, testMigrationProvider);
    poll = initPoll({ kysely, config });
  });

  it('defaults to an irv poll and still runs instant runoff', async () => {
    const poll_id = await poll.createPoll({ title: 'irv', option: ['A', 'B', ''] });
    const p = await poll.getPoll(poll_id);
    expect(p.kind).toEqual('irv');
    expect(p.open).toBe(true);
    expect(p.options.map(o => o.name)).toEqual(['A', 'B']);

    const [a, b] = p.options.map(o => o.option_id);
    await poll.castVote(poll_id, user('1'), [a!, b!]);
    await poll.castVote(poll_id, user('2'), [b!]);
    await poll.castVote(poll_id, user('3'), [a!]);

    const res = await poll.getResults(poll_id);
    expect(res.kind).toEqual('irv');
    if (res.kind !== 'irv') throw new Error('unreachable');
    expect(res.results.winner.option_id).toEqual(a);
    expect(res.results.total_voters).toEqual(3);

    const audit = await poll.audit(poll_id);
    expect(audit).toHaveLength(4);
    expect(audit[0]).toHaveProperty('rank');

    // kano ballots are refused on irv polls
    await expect(
      poll.castKanoVote(poll_id, user('4'), [{ option_id: a!, functional: Like, dysfunctional: Dislike }])
    ).rejects.toThrow('Wrong kind');
  });

  it('validates irv ballots server-side regardless of what the client sent', async () => {
    const poll_id = await poll.createPoll({ title: 'irv', option: ['A', 'B'] });
    const other_id = await poll.createPoll({ title: 'other', option: ['X'] });
    const p = await poll.getPoll(poll_id);
    const [a, b] = p.options.map(o => o.option_id);
    const [x] = (await poll.getPoll(other_id)).options.map(o => o.option_id);

    // empty
    await expect(poll.castVote(poll_id, user('1'), [])).rejects.toThrow(UserVisibleError);
    // an option from a different poll
    await expect(poll.castVote(poll_id, user('1'), [a!, x!])).rejects.toThrow('Invalid submission');
    // a made-up option
    await expect(poll.castVote(poll_id, user('1'), [9999])).rejects.toThrow('Invalid submission');
    // the same option twice
    await expect(poll.castVote(poll_id, user('1'), [a!, b!, a!])).rejects.toThrow('Invalid submission');
    // nothing partial was written by the failed attempts
    expect(await poll.getVote(p, '1')).toEqual([]);

    // a partial ballot (not every option ranked) is fine for irv
    await poll.castVote(poll_id, user('1'), [b!]);
    expect((await poll.getVote(p, '1')).map(v => v.name)).toEqual(['B']);
  });

  it('runs a kano poll end to end', async () => {
    const poll_id = await poll.createPoll({ kind: 'kano', title: 'kano', option: ['X', 'Y'] });
    const p = await poll.getPoll(poll_id);
    expect(p.kind).toEqual('kano');
    const [x, y] = p.options.map(o => o.option_id);

    await poll.castKanoVote(poll_id, user('1'), [
      { option_id: x!, functional: Like, dysfunctional: Dislike }, // O
      { option_id: y!, functional: Like, dysfunctional: Neutral }, // A
    ]);
    await poll.castKanoVote(poll_id, user('2'), [
      { option_id: y!, functional: Like, dysfunctional: Tolerate }, // A
      { option_id: x!, functional: Expect, dysfunctional: Dislike }, // M
    ]);

    // the voter can see their own answers, in streamer order, with labels
    const mine = await poll.getKanoVote(p, '2');
    expect(mine).toEqual([
      {
        option_id: x,
        name: 'X',
        functional: Expect,
        dysfunctional: Dislike,
        functional_label: 'As it should be',
        dysfunctional_label: 'Hate it',
        functional_emoji: '🙂',
        dysfunctional_emoji: '😡',
      },
      {
        option_id: y,
        name: 'Y',
        functional: Like,
        dysfunctional: Tolerate,
        functional_label: 'Love it',
        dysfunctional_label: 'Could live with it',
        functional_emoji: '😍',
        dysfunctional_emoji: '😕',
      },
    ]);
    expect(await poll.getKanoVote(p, '3')).toEqual([]);
    // irv-style lookup finds nothing for a kano poll
    expect(await poll.getVote(p, '2')).toEqual([]);

    // guards
    await expect(
      poll.castKanoVote(poll_id, user('1'), [
        { option_id: x!, functional: Like, dysfunctional: Dislike },
        { option_id: y!, functional: Like, dysfunctional: Dislike },
      ])
    ).rejects.toThrow('already voted');
    await expect(
      poll.castKanoVote(poll_id, user('3'), [{ option_id: x!, functional: Like, dysfunctional: Dislike }])
    ).rejects.toThrow('every item');
    await expect(
      poll.castKanoVote(poll_id, user('3'), [
        { option_id: x!, functional: Like, dysfunctional: Dislike },
        { option_id: 9999, functional: Like, dysfunctional: Dislike },
      ])
    ).rejects.toThrow(UserVisibleError);
    await expect(
      poll.castKanoVote(poll_id, user('3'), [
        { option_id: x!, functional: Like, dysfunctional: Dislike },
        { option_id: x!, functional: Like, dysfunctional: Dislike },
      ])
    ).rejects.toThrow(UserVisibleError);
    await expect(
      poll.castKanoVote(poll_id, user('3'), [
        { option_id: x!, functional: 0 as KanoAnswer, dysfunctional: Dislike },
        { option_id: y!, functional: Like, dysfunctional: Dislike },
      ])
    ).rejects.toThrow(UserVisibleError);
    await expect(poll.castVote(poll_id, user('3'), [x!])).rejects.toThrow('Wrong kind');
    // nothing partial was written by the failed attempts
    expect(await poll.getKanoVote(p, '3')).toEqual([]);

    const res = await poll.getResults(poll_id);
    expect(res.kind).toEqual('kano');
    if (res.kind !== 'kano') throw new Error('unreachable');
    expect(res.results.total_voters).toEqual(2);
    expect(res.results.features.map(f => [f.option_id, f.category])).toEqual([
      [x, 'M'], // tie M/O -> M
      [y, 'A'],
    ]);
    expect(res.results.features[0]!.counts).toEqual({ M: 1, O: 1, A: 0, I: 0, R: 0, Q: 0 });

    const audit = await poll.audit(poll_id);
    expect(audit).toHaveLength(4);
    for (const row of audit) {
      expect(row).not.toHaveProperty('twitch_user_id');
      expect(row).toHaveProperty('functional');
      expect(row).toHaveProperty('dysfunctional');
    }
    // same voter maps to the same anonymous id within one audit
    const ids = new Set(audit.map(r => r.id));
    expect(ids.size).toEqual(2);
  });

  it('rejects an unknown poll kind', async () => {
    await expect(poll.createPoll({ kind: 'approval', title: 'x', option: ['A'] })).rejects.toThrow('Invalid data');
  });

  it('closes a poll early and blocks further votes', async () => {
    const poll_id = await poll.createPoll({ kind: 'kano', title: 'k', option: ['X'] });
    const before = await poll.getPoll(poll_id);
    expect(before.open).toBe(true);
    const [x] = before.options.map(o => o.option_id);
    await poll.castKanoVote(poll_id, user('1'), [{ option_id: x!, functional: Like, dysfunctional: Dislike }]);

    await poll.closePoll(poll_id);
    const after = await poll.getPoll(poll_id);
    expect(after.open).toBe(false);
    expect(after.closes_on.toMillis()).toBeLessThanOrEqual(Date.now());

    await expect(
      poll.castKanoVote(poll_id, user('2'), [{ option_id: x!, functional: Like, dysfunctional: Dislike }])
    ).rejects.toThrow('Poll is closed');

    const res = await poll.getResults(poll_id);
    expect(res.results.total_voters).toEqual(1);

    // closing again is harmless and doesn't move the close time forward
    await poll.closePoll(poll_id);
    expect((await poll.getPoll(poll_id)).closes_on.toMillis()).toEqual(after.closes_on.toMillis());
  });

  // inserted directly so closes_on can be backdated / spread out
  const insertPoll = (title: string, closes_on: number) =>
    kysely
      .insertInto('poll')
      .values({ kind: 'irv', title, created_on: 0, closes_on })
      .execute();

  it('splits the index listing into open and ended, ordered for display', async () => {
    const now = Math.floor(Date.now() / 1000);
    await insertPoll('open later', now + 5000);
    await insertPoll('ended oldest', now - 5000);
    await insertPoll('open soon', now + 100);
    await insertPoll('ended newest', now - 100);
    await insertPoll('ended middle', now - 2000);
    // beyond the recency window: not "recently ended" no matter how few there are
    await insertPoll('ended ancient', now - (RECENT_ENDED_DAYS + 1) * 86400);

    const { open, ended } = await poll.listPolls();
    // open: soonest to close first
    expect(open.map(p => p.title)).toEqual(['open soon', 'open later']);
    expect(open.every(p => p.open)).toBe(true);
    // ended: most recently ended first
    expect(ended.map(p => p.title)).toEqual(['ended newest', 'ended middle', 'ended oldest']);
    expect(ended.every(p => !p.open)).toBe(true);
    expect(ended[0]!.closes_on.toSeconds()).toEqual(now - 100);
  });

  it('caps the ended listing at the most recent few', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < RECENT_ENDED_LIMIT + 2; i++) {
      await insertPoll(`p${i}`, now - 1 - i);
    }

    const { open, ended } = await poll.listPolls();
    expect(open).toEqual([]);
    expect(ended).toHaveLength(RECENT_ENDED_LIMIT);
    // the newest ones survive the cap
    expect(ended[0]!.title).toEqual('p0');
    expect(ended[ended.length - 1]!.title).toEqual(`p${RECENT_ENDED_LIMIT - 1}`);
  });
});

describe('migrations', () => {
  it('migrates up and down cleanly', async () => {
    const sqlite = createSqlite3(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    const db = new Kysely<any>({ dialect: new SqliteDialect({ database: sqlite }) });
    const migrator = new Migrator({ db, provider: testMigrationProvider });

    const columns = async (table: string): Promise<string[]> => {
      const { rows } = await sql<{ name: string }>`select name from pragma_table_info(${sql.lit(table)})`.execute(db);
      return rows.map(r => r.name);
    };
    const tables = async (): Promise<string[]> => {
      const { rows } = await sql<{ name: string }>`select name from sqlite_master where type = 'table'`.execute(db);
      return rows.map(r => r.name);
    };

    const up = await migrator.migrateToLatest();
    expect(up.error).toBeUndefined();
    expect(await columns('poll')).toContain('kind');
    expect(await tables()).toContain('kano_vote');
    expect(await tables()).toContain('session');
    expect(await tables()).toContain('nomination');

    // existing rows get the default kind
    await sql`insert into poll (title, created_on, closes_on) values ('old', 0, 0)`.execute(db);
    const { rows } = await sql<{ kind: string }>`select kind from poll`.execute(db);
    expect(rows).toEqual([{ kind: 'irv' }]);
    await expect(
      sql`insert into poll (kind, title, created_on, closes_on) values ('nope', 'x', 0, 0)`.execute(db)
    ).rejects.toThrow();

    // migrateDown steps back one migration at a time
    const downNomination = await migrator.migrateDown();
    expect(downNomination.error).toBeUndefined();
    expect(downNomination.results?.map(r => r.migrationName)).toEqual(['2026-08-31_003_nomination']);
    expect(await tables()).not.toContain('nomination');

    const downSession = await migrator.migrateDown();
    expect(downSession.error).toBeUndefined();
    expect(downSession.results?.map(r => r.migrationName)).toEqual(['2026-08-31_002_session']);
    expect(await tables()).not.toContain('session');

    const downKano = await migrator.migrateDown();
    expect(downKano.error).toBeUndefined();
    expect(downKano.results?.map(r => r.migrationName)).toEqual(['2026-08-31_001_kano_polls']);
    expect(await columns('poll')).not.toContain('kind');
    expect(await tables()).not.toContain('kano_vote');

    // and back up again
    const again = await migrator.migrateToLatest();
    expect(again.error).toBeUndefined();
    expect(await columns('poll')).toContain('kind');
  });
});
