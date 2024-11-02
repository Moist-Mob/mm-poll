import { PDeps } from './deps';
import { Type as T } from '@sinclair/typebox';
import { asInt, assertInt, assertSchema } from './util';
import { irv } from './irv';

const Poll = T.Object({
  title: T.String(),
  option: T.Array(T.String()),
});

export type PollOption = {
  option_id: number;
  name: string;
};
export type PollResult = {
  option_id: number;
  name: string;
  average_rank: number;
  user_rank?: number;
};
export type PollUserVote = {
  rank: number;
  name: string;
};
export type Poll = {
  poll_id: number;
  title: string;
  options: PollOption[];
  created_on: Date;
  closes_on: Date;
};
export type PollVote = Poll &
  (
    | {
        open: true;
        ranks: PollUserVote[];
      }
    | {
        open: false;
        results: PollResult[];
      }
  );
export interface PollFns {
  getPoll(poll_id: number): Promise<Poll>;
  getVote(poll_id: number, user_id: string): Promise<PollVote>;
  createPoll(poll_id: number): Promise<number>;
  castVote(poll_id: number, twitch_user_id: string, ranks: number[]): Promise<void>;
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
      created_on: new Date(poll.created_on * 1000),
      closes_on: new Date(poll.closes_on * 1000),
      options,
    };
  };

  const pollResults: Map<number, Promise<PollResult[]>> = new Map();

  const runoff = async (poll_id: number): Promise<PollResult[]> => {
    const allRanks = await kysely
      .selectFrom('vote')
      .select(['option_id', 'twitch_user_id', 'vote_rank'])
      .where('poll_id', '=', poll_id)
      .orderBy(['twitch_user_id', 'vote_rank asc'])
      .execute();

    const poll = await getPoll(poll_id);
    const pollOptions: Map<number, PollOption & { ranks: number[] }> = new Map();
    for (const option of poll.options) {
      pollOptions.set(option.option_id, { ...option, ranks: [] });
    }
    for (const rank of allRanks) {
      const option = pollOptions.get(rank.option_id);
      if (!option) continue;
      option.ranks.push(rank.vote_rank);
    }

    const result: PollResult[] = [];
    const winner_id = irv(allRanks);
    let winner: PollResult;
    for (const { ranks, ...option } of pollOptions.values()) {
      const average_rank =
        ranks.length === 0 ? pollOptions.size : ranks.reduce((acc, cur) => acc + cur, 0) / ranks.length;
      const pr: PollResult = { ...option, average_rank };
      if (pr.option_id === winner_id) winner = pr;
      else result.push(pr);
    }

    result.sort((a, b) => a.average_rank - b.average_rank);
    return [winner!, ...result];
  };

  const calcResults = (poll_id: number): Promise<PollResult[]> => {
    const results = pollResults.get(poll_id) ?? runoff(poll_id);
    pollResults.set(poll_id, results);
    return results;
  };

  const getVote = async (poll_id: number, user_id: string): Promise<PollVote> => {
    const poll = await getPoll(poll_id);
    const ranks = await kysely
      .selectFrom('vote')
      .innerJoin('option', jb =>
        jb
          .onRef('vote.option_id', '=', 'option.option_id')
          .on('vote.poll_id', '=', poll_id)
          .on('option.poll_id', '=', poll_id)
      )
      .select(['option.name', 'vote_rank as rank'])
      .orderBy('rank asc')
      .where('twitch_user_id', '=', user_id)
      .execute();

    if (Date.now() >= poll.closes_on.getTime()) {
      return { ...poll, open: false, results: await calcResults(poll_id) };
    }

    return { ...poll, open: true, ranks };
  };

  const castVote = async (poll_id: number, twitch_user_id: string, ranks: number[]): Promise<void> => {
    await kysely.transaction().execute(async trx => {
      const { closes_on } = await trx
        .selectFrom('poll')
        .select('closes_on')
        .where('poll_id', '=', poll_id)
        .executeTakeFirstOrThrow();
      if (Date.now() >= closes_on * 1000) throw new Error('Poll is closed');

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

    const now = new Date();
    const later = new Date(now);
    later.setDate(later.getDate() + 1);
    //later.setMinutes(later.getMinutes() + 10);

    const created_on = Math.floor(now.getTime() / 1000);
    const closes_on = Math.floor(later.getTime() / 1000);

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
  return { createPoll, getPoll, getVote, castVote };
};
