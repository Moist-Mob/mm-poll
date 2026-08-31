import { type SessionData } from 'express-session';
import { type Kysely } from 'kysely';

import { initDb } from './db.js';
import { testMigrationProvider } from './testing/migrations.js';
import { SqliteSessionStore } from './session-store.js';
import { type Database } from './db/types.js';

// a minimal session blob; express-session always includes `cookie`
const sess = (maxAge: number, extra: object = {}): SessionData =>
  ({ cookie: { originalMaxAge: maxAge, maxAge }, ...extra }) as unknown as SessionData;

const get = (store: SqliteSessionStore, sid: string): Promise<SessionData | null> =>
  new Promise((resolve, reject) => store.get(sid, (err, s) => (err ? reject(err) : resolve(s ?? null))));
const set = (store: SqliteSessionStore, sid: string, s: SessionData): Promise<void> =>
  new Promise((resolve, reject) => store.set(sid, s, err => (err ? reject(err) : resolve())));
const touch = (store: SqliteSessionStore, sid: string, s: SessionData): Promise<void> =>
  new Promise((resolve, reject) => store.touch(sid, s, err => (err ? reject(err) : resolve())));
const destroy = (store: SqliteSessionStore, sid: string): Promise<void> =>
  new Promise((resolve, reject) => store.destroy(sid, err => (err ? reject(err) : resolve())));

describe('SqliteSessionStore', () => {
  let kysely: Kysely<Database>;
  let store: SqliteSessionStore;

  beforeEach(async () => {
    kysely = await initDb(undefined, testMigrationProvider);
    store = new SqliteSessionStore(kysely);
  });

  afterEach(async () => {
    store.stop();
    await kysely.destroy();
  });

  it('round-trips a session', async () => {
    await set(store, 'a', sess(60_000, { user: { login: 'x', user_id: '1', followed_on: 1 } }));
    const got = await get(store, 'a');
    expect(got?.user?.login).toBe('x');
  });

  it('a miss is null, never {}', async () => {
    expect(await get(store, 'nope')).toBeNull();
  });

  it('an expired session is a miss', async () => {
    await set(store, 'a', sess(-1000));
    expect(await get(store, 'a')).toBeNull();
  });

  it('set overwrites in place', async () => {
    await set(store, 'a', sess(60_000, { localId: 'one' }));
    await set(store, 'a', sess(60_000, { localId: 'two' }));
    expect((await get(store, 'a'))?.localId).toBe('two');
    expect(await kysely.selectFrom('session').select('sid').execute()).toEqual([{ sid: 'a' }]);
  });

  it('touch extends the expiry without touching the data', async () => {
    await set(store, 'a', sess(-1000, { localId: 'kept' }));
    await touch(store, 'a', sess(60_000));
    expect((await get(store, 'a'))?.localId).toBe('kept');
  });

  it('destroy removes the session', async () => {
    await set(store, 'a', sess(60_000));
    await destroy(store, 'a');
    expect(await get(store, 'a')).toBeNull();
  });

  it('a corrupted blob degrades to a miss and the row is dropped', async () => {
    await set(store, 'a', sess(60_000));
    await kysely.updateTable('session').set({ data: 'not-json' }).where('sid', '=', 'a').execute();
    expect(await get(store, 'a')).toBeNull();
    expect(await kysely.selectFrom('session').select('sid').execute()).toEqual([]);
  });

  it('a blob that fails validation degrades to a miss', async () => {
    await set(store, 'a', sess(60_000));
    // e.g. a row written by an older deploy whose shape no longer fits
    await kysely.updateTable('session').set({ data: '{"no":"cookie"}' }).where('sid', '=', 'a').execute();
    expect(await get(store, 'a')).toBeNull();
  });

  it('prune removes only expired rows', async () => {
    await set(store, 'live', sess(60_000));
    await set(store, 'dead', sess(-1000));
    await store.prune();
    expect(await kysely.selectFrom('session').select('sid').execute()).toEqual([{ sid: 'live' }]);
  });
});
