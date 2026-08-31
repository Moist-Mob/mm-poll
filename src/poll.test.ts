import { promises as fs } from 'node:fs';
import path from 'node:path';

import createSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { type Migration, type MigrationProvider, Migrator } from 'kysely/migration';

import { initDb, migrationFolder } from './db.js';
import { initPoll, PollFns } from './poll.js';
import { Config, Env } from './config.js';
import { TwitchUser } from './jwt.js';
import { KanoAnswer } from './kano.js';
import { UserVisibleError } from './errors.js';

const { Like, Expect, Neutral, Tolerate, Dislike } = KanoAnswer;

// kysely's FileMigrationProvider imports with node's loader, which can't map
// the `.js` specifiers in the .ts migrations; import them via vitest instead
const provider: MigrationProvider = {
  async getMigrations() {
    const files = (await fs.readdir(migrationFolder)).filter(f => f.endsWith('.ts')).sort();
    const migrations: Record<string, Migration> = {};
    for (const file of files) {
      migrations[path.basename(file, '.ts')] = await import(path.join(migrationFolder, file));
    }
    return migrations;
  },
};

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

  beforeEach(async () => {
    const kysely = await initDb(undefined, provider);
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
});

describe('kano migration', () => {
  it('migrates up and down cleanly', async () => {
    const sqlite = createSqlite3(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    const db = new Kysely<any>({ dialect: new SqliteDialect({ database: sqlite }) });
    const migrator = new Migrator({ db, provider });

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

    // existing rows get the default kind
    await sql`insert into poll (title, created_on, closes_on) values ('old', 0, 0)`.execute(db);
    const { rows } = await sql<{ kind: string }>`select kind from poll`.execute(db);
    expect(rows).toEqual([{ kind: 'irv' }]);
    await expect(
      sql`insert into poll (kind, title, created_on, closes_on) values ('nope', 'x', 0, 0)`.execute(db)
    ).rejects.toThrow();

    const down = await migrator.migrateDown();
    expect(down.error).toBeUndefined();
    expect(down.results?.map(r => r.migrationName)).toEqual(['2026-08-31_001_kano_polls']);
    expect(await columns('poll')).not.toContain('kind');
    expect(await tables()).not.toContain('kano_vote');

    // and back up again
    const again = await migrator.migrateToLatest();
    expect(again.error).toBeUndefined();
    expect(await columns('poll')).toContain('kind');
  });
});
