import { Type as T } from '@sinclair/typebox';
import { type Transaction } from 'kysely';
import { DateTime } from 'luxon';
import { nanoid } from 'nanoid';

import { PDeps } from './deps.js';
import { assertSchema, isEligible } from './util.js';
import { irv, IRVResult } from './irv.js';
import {
  isKanoAnswer,
  kano,
  KanoAnswer,
  KanoRawAnswer,
  KanoResult,
  KANO_ANSWER_EMOJI,
  KANO_ANSWER_LABELS,
} from './kano.js';
import { TwitchUser } from './user.js';
import { UserVisibleError } from './errors.js';
import { Database, PollKind } from './db/types.js';

type RandId = string & { __brand: 'randid' };
const randId = () => nanoid(8) as RandId;

// maps real voter ids to random, per-call ids so audits can't identify users
const anonymizer = () => {
  const idmap = new Map<string, RandId>();
  return (twitch_user_id: string): RandId => {
    let id = idmap.get(twitch_user_id);
    if (!id) {
      id = randId();
      idmap.set(twitch_user_id, id);
    }
    return id;
  };
};

const Poll = T.Object({
  kind: T.Optional(T.Union([T.Literal('irv'), T.Literal('kano')])),
  title: T.String(),
  option: T.Array(T.String()),
});

export type PollRawRank = {
  twitch_user_id: string;
  option_id: number;
  rank: number;
};
export type PollAnonymizedRank = {
  id: RandId;
  option_id: number;
  rank: number;
};
export type PollOption = {
  option_id: number;
  name: string;
};
export type PollUserVote = {
  rank: number;
  name: string;
};
export type PollAnonymizedVote = {
  voter_id: number;
  option_id: number;
  rank: number;
};
export type Poll = {
  poll_id: number;
  kind: PollKind;
  open: boolean;
  title: string;
  options: PollOption[];
  created_on: DateTime;
  closes_on: DateTime;
};
export type PollResults = Poll & { votes: PollAnonymizedVote[] };
// a row on the index page; no options, they aren't shown there
export type PollListing = {
  poll_id: number;
  kind: PollKind;
  title: string;
  open: boolean;
  closes_on: DateTime;
};
export type PollResult =
  { kind: 'irv'; poll: Poll; results: IRVResult } | { kind: 'kano'; poll: Poll; results: KanoResult };

// a voter's answers for one kano feature
export type KanoUserAnswer = {
  option_id: number;
  functional: KanoAnswer;
  dysfunctional: KanoAnswer;
};
export type KanoUserVote = KanoUserAnswer & {
  name: string;
  functional_label: string;
  dysfunctional_label: string;
  functional_emoji: string;
  dysfunctional_emoji: string;
};
export type KanoAnonymizedAnswer = {
  id: RandId;
  option_id: number;
  functional: KanoAnswer;
  dysfunctional: KanoAnswer;
};
// one row per ranked option (irv) or per answered feature (kano); the poll's
// kind tells a consumer which shape to expect
export type PollAudit = PollAnonymizedRank[] | KanoAnonymizedAnswer[];

// "recently ended" is bounded both ways: at most this many polls, and none
// older than the window below
export const RECENT_ENDED_LIMIT = 10;
export const RECENT_ENDED_DAYS = 180;

export interface PollFns {
  getPoll(poll_id: number): Promise<Poll>;
  listPolls(): Promise<{ open: PollListing[]; ended: PollListing[] }>;
  getVote(poll: Poll, user_id: string): Promise<PollUserVote[]>;
  getKanoVote(poll: Poll, user_id: string): Promise<KanoUserVote[]>;
  getResults(poll_id: number): Promise<PollResult>;
  audit(poll_id: number): Promise<PollAudit>;
  createPoll(body: unknown): Promise<number>;
  closePoll(poll_id: number): Promise<void>;
  castVote(poll_id: number, user: TwitchUser, ranks: number[]): Promise<void>;
  castKanoVote(poll_id: number, user: TwitchUser, answers: KanoUserAnswer[]): Promise<void>;
}

export const initPoll = ({ kysely, config }: PDeps<'kysely' | 'config'>): PollFns => {
  const getPoll = async (poll_id: number): Promise<Poll> => {
    const poll = await kysely
      .selectFrom('poll')
      .select(['poll_id', 'kind', 'title', 'created_on', 'closes_on'])
      .where('poll_id', '=', poll_id)
      .executeTakeFirstOrThrow();
    const options = await kysely
      .selectFrom('option')
      .select(['option_id', 'name'])
      .where('poll_id', '=', poll_id)
      .execute();
    const created_on = DateTime.fromSeconds(poll.created_on, { locale: 'utc' });
    const closes_on = DateTime.fromSeconds(poll.closes_on, { locale: 'utc' });

    return {
      ...poll,
      open: DateTime.utc().toMillis() < closes_on.toMillis(),
      options,
      created_on,
      closes_on,
    };
  };

  const listPolls = async (): Promise<{ open: PollListing[]; ended: PollListing[] }> => {
    const now = Math.floor(Date.now() / 1000);
    const listing = (open: boolean) => (row: { poll_id: number; kind: PollKind; title: string; closes_on: number }) => ({
      ...row,
      open,
      closes_on: DateTime.fromSeconds(row.closes_on, { locale: 'utc' }),
    });

    // soonest to close first
    const open = await kysely
      .selectFrom('poll')
      .select(['poll_id', 'kind', 'title', 'closes_on'])
      .where('closes_on', '>', now)
      .orderBy('closes_on', 'asc')
      .execute();

    // most recently ended first
    const oldest = now - RECENT_ENDED_DAYS * 86400;
    const ended = await kysely
      .selectFrom('poll')
      .select(['poll_id', 'kind', 'title', 'closes_on'])
      .where('closes_on', '<=', now)
      .where('closes_on', '>', oldest)
      .orderBy('closes_on', 'desc')
      .orderBy('poll_id', 'desc')
      .limit(RECENT_ENDED_LIMIT)
      .execute();

    return { open: open.map(listing(true)), ended: ended.map(listing(false)) };
  };

  const irvResults: Map<number, Promise<IRVResult>> = new Map();
  const kanoResults: Map<number, Promise<KanoResult>> = new Map();

  const getRawRanks = (poll_id: number): Promise<PollRawRank[]> =>
    kysely
      .selectFrom('vote')
      .select(['option_id', 'twitch_user_id', 'vote_rank as rank'])
      .where('poll_id', '=', poll_id)
      .orderBy('twitch_user_id')
      .orderBy('vote_rank', 'asc')
      .execute();

  const getRawKanoAnswers = async (poll_id: number): Promise<KanoRawAnswer[]> => {
    const rows = await kysely
      .selectFrom('kano_vote')
      .select(['option_id', 'twitch_user_id', 'functional', 'dysfunctional'])
      .where('poll_id', '=', poll_id)
      .orderBy('twitch_user_id')
      .orderBy('option_id', 'asc')
      .execute();
    // the db CHECK constraint guarantees the 1..5 range
    return rows as KanoRawAnswer[];
  };

  const audit = async (poll_id: number): Promise<PollAudit> => {
    const { kind } = await getPoll(poll_id);
    const anon = anonymizer();

    if (kind === 'kano') {
      const raw = await getRawKanoAnswers(poll_id);
      return raw.map(({ option_id, functional, dysfunctional, twitch_user_id }): KanoAnonymizedAnswer => ({
        id: anon(twitch_user_id),
        option_id,
        functional,
        dysfunctional,
      }));
    }

    const rawRanks = await getRawRanks(poll_id);
    return rawRanks.map(({ option_id, rank, twitch_user_id }): PollAnonymizedRank => ({
      id: anon(twitch_user_id),
      option_id,
      rank,
    }));
  };

  const calcIrvResults = (poll: Poll): Promise<IRVResult> => {
    const cached = irvResults.get(poll.poll_id);
    if (cached) return cached;

    const results = getRawRanks(poll.poll_id).then(ranks => irv(ranks, poll.options));
    irvResults.set(poll.poll_id, results);
    return results;
  };

  const calcKanoResults = (poll: Poll): Promise<KanoResult> => {
    const cached = kanoResults.get(poll.poll_id);
    if (cached) return cached;

    const results = getRawKanoAnswers(poll.poll_id).then(answers => kano(answers, poll.options));
    kanoResults.set(poll.poll_id, results);
    return results;
  };

  const getResults = async (poll_id: number): Promise<PollResult> => {
    const poll = await getPoll(poll_id);
    if (poll.kind === 'kano') {
      return { kind: 'kano', poll, results: await calcKanoResults(poll) };
    }
    return { kind: 'irv', poll, results: await calcIrvResults(poll) };
  };

  const getVote = (poll: Poll, user_id: string): Promise<PollUserVote[]> =>
    kysely
      .selectFrom('vote')
      .innerJoin('option', jb =>
        jb
          .onRef('vote.option_id', '=', 'option.option_id')
          .on('vote.poll_id', '=', poll.poll_id)
          .on('option.poll_id', '=', poll.poll_id)
      )
      .select(['option.name', 'vote_rank as rank'])
      .orderBy('rank', 'asc')
      .where('twitch_user_id', '=', user_id)
      .execute();

  const getKanoVote = async (poll: Poll, user_id: string): Promise<KanoUserVote[]> => {
    const rows = await kysely
      .selectFrom('kano_vote')
      .innerJoin('option', jb =>
        jb
          .onRef('kano_vote.option_id', '=', 'option.option_id')
          .on('kano_vote.poll_id', '=', poll.poll_id)
          .on('option.poll_id', '=', poll.poll_id)
      )
      .select(['option.option_id', 'option.name', 'kano_vote.functional', 'kano_vote.dysfunctional'])
      .orderBy('option.option_id', 'asc')
      .where('twitch_user_id', '=', user_id)
      .execute();

    return rows.map(({ option_id, name, functional, dysfunctional }) => ({
      option_id,
      name,
      functional: functional as KanoAnswer,
      dysfunctional: dysfunctional as KanoAnswer,
      functional_label: KANO_ANSWER_LABELS[functional as KanoAnswer],
      dysfunctional_label: KANO_ANSWER_LABELS[dysfunctional as KanoAnswer],
      functional_emoji: KANO_ANSWER_EMOJI[functional as KanoAnswer],
      dysfunctional_emoji: KANO_ANSWER_EMOJI[dysfunctional as KanoAnswer],
    }));
  };

  // common checks for casting any kind of vote; must run inside the insert transaction.
  // returns the poll's options.
  const prepareVote = async (
    trx: Transaction<Database>,
    poll_id: number,
    kind: PollKind,
    user: TwitchUser
  ): Promise<PollOption[]> => {
    const eligible = isEligible(user, config.followAgeDays);
    if (eligible !== true) throw new UserVisibleError(eligible[1]);

    const poll = await trx
      .selectFrom('poll')
      .select(['kind', 'closes_on'])
      .where('poll_id', '=', poll_id)
      .executeTakeFirstOrThrow();
    if (poll.kind !== kind) throw new UserVisibleError('Wrong kind of vote for this poll');
    if (Date.now() >= poll.closes_on * 1000) throw new UserVisibleError('Poll is closed');

    const table = kind === 'kano' ? 'kano_vote' : 'vote';
    const res = await trx
      .selectFrom(table)
      .select(eb => eb.fn.countAll().as('count'))
      .where(eb => eb.and([eb('poll_id', '=', poll_id), eb('twitch_user_id', '=', user.user_id)]))
      .executeTakeFirst()!;

    if (res && res.count && Number(res.count) > 0) {
      throw new UserVisibleError("You've already voted");
    }

    return trx.selectFrom('option').select(['option_id', 'name']).where('poll_id', '=', poll_id).execute();
  };

  const castVote = async (poll_id: number, user: TwitchUser, ranks: number[]): Promise<void> => {
    const twitch_user_id = user.user_id;
    await kysely.transaction().execute(async trx => {
      const options = await prepareVote(trx, poll_id, 'irv', user);

      // the ballot must be a non-empty list of this poll's options, each at most once
      if (ranks.length === 0) throw new UserVisibleError('You must select at least one option!');
      const valid = new Set(options.map(opt => opt.option_id));
      const seen = new Set<number>();
      for (const option_id of ranks) {
        if (!valid.has(option_id) || seen.has(option_id)) throw new UserVisibleError('Invalid submission');
        seen.add(option_id);
      }

      await trx
        .insertInto('vote')
        .values(
          ranks.map((option_id, vote_rank) => ({
            poll_id,
            twitch_user_id,
            vote_rank,
            option_id,
          }))
        )
        .execute();
    });
  };

  const castKanoVote = async (poll_id: number, user: TwitchUser, answers: KanoUserAnswer[]): Promise<void> => {
    const twitch_user_id = user.user_id;
    await kysely.transaction().execute(async trx => {
      const options = await prepareVote(trx, poll_id, 'kano', user);

      // every feature must be answered exactly once, with both questions
      const expected = new Set(options.map(opt => opt.option_id));
      const seen = new Set<number>();
      for (const { option_id, functional, dysfunctional } of answers) {
        if (!expected.has(option_id) || seen.has(option_id)) {
          throw new UserVisibleError('Invalid submission');
        }
        if (!isKanoAnswer(functional) || !isKanoAnswer(dysfunctional)) {
          throw new UserVisibleError('Invalid submission');
        }
        seen.add(option_id);
      }
      if (seen.size !== expected.size) {
        throw new UserVisibleError('You must answer both questions for every item!');
      }

      await trx
        .insertInto('kano_vote')
        .values(
          answers.map(({ option_id, functional, dysfunctional }) => ({
            poll_id,
            twitch_user_id,
            option_id,
            functional,
            dysfunctional,
          }))
        )
        .execute();
    });
  };

  const createPoll = async (body: unknown): Promise<number> => {
    const poll = assertSchema(Poll, body);

    const options = poll.option.filter(v => v.trim() !== '');
    if (options.length === 0) {
      throw new Error('No options!');
    }

    const now = DateTime.utc();
    const later = now.plus({ days: 1 });

    const created_on = Math.floor(now.toMillis() / 1000);
    const closes_on = Math.floor(later.toMillis() / 1000);

    return await kysely.transaction().execute(async trx => {
      const { poll_id } = await trx
        .insertInto('poll')
        .values({
          kind: poll.kind ?? 'irv',
          title: poll.title,
          created_on,
          closes_on,
        })
        .returning('poll_id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('option')
        .values(options.map(name => ({ poll_id, name })))
        .execute();

      return poll_id;
    });
  };
  // end an open poll now; a no-op if it's already closed
  const closePoll = async (poll_id: number): Promise<void> => {
    const now = Math.floor(Date.now() / 1000);
    await kysely
      .updateTable('poll')
      .set({ closes_on: now })
      .where(eb => eb.and([eb('poll_id', '=', poll_id), eb('closes_on', '>', now)]))
      .execute();
    // results are cached once computed; make sure nothing stale survives
    irvResults.delete(poll_id);
    kanoResults.delete(poll_id);
  };

  return { createPoll, closePoll, getPoll, listPolls, getResults, getVote, getKanoVote, audit, castVote, castKanoVote };
};
