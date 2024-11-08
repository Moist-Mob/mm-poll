import { Type as T } from '@sinclair/typebox';
import { DateTime } from 'luxon';

import { PDeps } from './deps';
import { assertSchema, isEligible } from './util';
import { irv, IRVResult } from './irv';
import { TwitchUser } from './jwt';
import { UserVisibleError } from './errors';
import { nanoid } from 'nanoid';

type RandId = string & { __brand: 'randid' };
const randId = () => nanoid(8) as RandId;

const Poll = T.Object({
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
  title: string;
  options: PollOption[];
  created_on: DateTime;
  closes_on: DateTime;
};
export type PollVote = { open: boolean; ranks: PollUserVote[] };
export type PollResults = Poll & { votes: PollAnonymizedVote[] };
export type PollResult = {
  poll: Poll;
  results: IRVResult;
};

export interface PollFns {
  getPoll(poll_id: number): Promise<Poll>;
  getVote(poll: Poll, user_id: string): Promise<PollVote>;
  getResults(poll_id: number): Promise<PollResult>;
  audit(poll_id: number): Promise<PollAnonymizedRank[]>;
  createPoll(poll_id: number): Promise<number>;
  castVote(poll_id: number, user: TwitchUser, ranks: number[]): Promise<void>;
}

export const initPoll = ({ kysely }: PDeps<'kysely'>): PollFns => {
  const getPoll = async (poll_id: number): Promise<Poll> => {
    const poll = await kysely
      .selectFrom('poll')
      .select(['poll_id', 'title', 'created_on', 'closes_on'])
      .where('poll_id', '=', poll_id)
      .executeTakeFirstOrThrow();
    const options = await kysely
      .selectFrom('option')
      .select(['option_id', 'name'])
      .where('poll_id', '=', poll_id)
      .execute();
    return {
      ...poll,
      created_on: DateTime.fromSeconds(poll.created_on, { locale: 'utc' }),
      closes_on: DateTime.fromSeconds(poll.closes_on, { locale: 'utc' }),
      options,
    };
  };

  const pollResults: Map<number, Promise<IRVResult>> = new Map();

  const getRawRanks = (poll_id: number): Promise<PollRawRank[]> =>
    kysely
      .selectFrom('vote')
      .select(['option_id', 'twitch_user_id', 'vote_rank as rank'])
      .where('poll_id', '=', poll_id)
      .orderBy(['twitch_user_id', 'vote_rank asc'])
      .execute();

  const audit = async (poll_id: number): Promise<PollAnonymizedRank[]> => {
    const idmap = new Map<string, RandId>();
    const newids = new Set<string>();
    const rawRanks = await getRawRanks(poll_id);
    return rawRanks.map(({ option_id, rank, twitch_user_id }): PollAnonymizedRank => {
      const id = idmap.get(twitch_user_id) ?? randId();
      idmap.set(twitch_user_id, id);
      return { id, option_id, rank };
    });
  };

  const calcResults = (poll: Poll): Promise<IRVResult> => {
    const cached = pollResults.get(poll.poll_id);
    if (cached) return cached;

    const results = getRawRanks(poll.poll_id).then(ranks => irv(ranks, poll.options));
    // pollResults.set(poll.poll_id, results);
    return results;
  };

  const getResults = async (poll_id: number): Promise<PollResult> => {
    const poll = await getPoll(poll_id);
    const results = await calcResults(poll);
    console.log(JSON.stringify({ poll, results }));
    return { poll, results };
  };

  const getVote = async (poll: Poll, user_id: string): Promise<PollVote> => {
    const ranks = await kysely
      .selectFrom('vote')
      .innerJoin('option', jb =>
        jb
          .onRef('vote.option_id', '=', 'option.option_id')
          .on('vote.poll_id', '=', poll.poll_id)
          .on('option.poll_id', '=', poll.poll_id)
      )
      .select(['option.name', 'vote_rank as rank'])
      .orderBy('rank asc')
      .where('twitch_user_id', '=', user_id)
      .execute();

    return {
      open: DateTime.utc().toMillis() < poll.closes_on.toMillis(),
      ranks,
    };
  };

  const castVote = async (poll_id: number, user: TwitchUser, ranks: number[]): Promise<void> => {
    const eligible = isEligible(user);
    if (eligible !== true) throw new UserVisibleError(eligible[1]);

    const twitch_user_id = user.user_id;
    await kysely.transaction().execute(async trx => {
      const { closes_on } = await trx
        .selectFrom('poll')
        .select('closes_on')
        .where('poll_id', '=', poll_id)
        .executeTakeFirstOrThrow();
      if (Date.now() >= closes_on * 1000) throw new UserVisibleError('Poll is closed');

      trx
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
  return { createPoll, getPoll, getResults, getVote, audit, castVote };
};
