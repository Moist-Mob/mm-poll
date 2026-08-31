import { Store, type SessionData } from 'express-session';
import { Type as T } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { type Kysely } from 'kysely';
import Debug from 'debug';

import { type Database } from './db/types.js';
import { OauthFlow, TwitchUser } from './user.js';
import { DAY_MS } from './util.js';

// how long a session whose cookie has no maxAge lives; ours always carry one,
// so this is only a safety net
const FALLBACK_TTL_MS = DAY_MS;
const PRUNE_INTERVAL_MS = 3600_000;

// what we're willing to accept back out of the database. The blob is only
// ever written by express-session, but rows outlive deploys: a change to the
// session shape (or a corrupted row) must degrade to "logged out", not crash
// every request that presents that cookie
const SessionBlob = T.Object(
  {
    cookie: T.Object({}, { additionalProperties: true }),
    localId: T.Optional(T.String()),
    user: T.Optional(TwitchUser),
    oauth: T.Optional(OauthFlow),
  },
  { additionalProperties: true }
);

const debug = Debug('vote:session');

// express-session's storage contract on our own sqlite, via kysely. The one
// rule: `expires` is epoch milliseconds and is only ever compared to epoch
// milliseconds, because sqlite orders mismatched storage classes by class (INTEGER
// sorts before TEXT unconditionally), which is what broke the store this
// replaces: it wrote integers and compared them against datetime() text.
export class SqliteSessionStore extends Store {
  private kysely: Kysely<Database>;
  private timer: NodeJS.Timeout;

  public constructor(kysely: Kysely<Database>) {
    super();
    this.kysely = kysely;
    this.timer = setInterval(() => {
      this.prune().catch(err => debug('prune failed', err));
    }, PRUNE_INTERVAL_MS);
    // don't hold the process open for housekeeping
    this.timer.unref();
  }

  private expiresOf(session: SessionData): number {
    const maxAge = session.cookie?.maxAge;
    return Date.now() + (typeof maxAge === 'number' ? maxAge : FALLBACK_TTL_MS);
  }

  // bridge a promise into the callback style express-session expects
  private static done<V>(p: Promise<V>, callback?: (err: unknown, value?: V) => void): void {
    p.then(
      value => callback?.(null, value),
      err => callback?.(err)
    );
  }

  public get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    SqliteSessionStore.done(this.read(sid), callback);
  }

  // (not named `load`: the base Store class already has a public `load`)
  private async read(sid: string): Promise<SessionData | null> {
    const row = await this.kysely
      .selectFrom('session')
      .select('data')
      .where('sid', '=', sid)
      .where('expires', '>', Date.now())
      .executeTakeFirst();
    // a miss MUST be null/undefined, never {}: express-session dereferences
    // .cookie on any truthy result
    if (row === undefined) return null;

    try {
      const parsed: unknown = JSON.parse(row.data);
      if (Value.Check(SessionBlob, parsed)) return parsed as SessionData;
      debug('session blob failed validation; dropping session', sid);
    } catch {
      debug('session blob is not valid json; dropping session', sid);
    }
    await this.remove(sid);
    return null;
  }

  public set(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    const expires = this.expiresOf(session);
    const data = JSON.stringify(session);
    SqliteSessionStore.done(
      this.kysely
        .insertInto('session')
        .values({ sid, expires, data })
        .onConflict(oc => oc.column('sid').doUpdateSet({ expires, data }))
        .execute()
        .then(() => undefined),
      callback
    );
  }

  public touch(sid: string, session: SessionData, callback?: (err?: unknown) => void): void {
    SqliteSessionStore.done(
      this.kysely
        .updateTable('session')
        .set({ expires: this.expiresOf(session) })
        .where('sid', '=', sid)
        .execute()
        .then(() => undefined),
      callback
    );
  }

  public destroy(sid: string, callback?: (err?: unknown) => void): void {
    SqliteSessionStore.done(this.remove(sid), callback);
  }

  private async remove(sid: string): Promise<void> {
    await this.kysely.deleteFrom('session').where('sid', '=', sid).execute();
  }

  public async prune(): Promise<void> {
    await this.kysely.deleteFrom('session').where('expires', '<=', Date.now()).execute();
  }

  // for tests; in the app the interval is unref()ed and dies with the process
  public stop(): void {
    clearInterval(this.timer);
  }
}
