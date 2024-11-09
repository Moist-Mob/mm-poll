import { PollOption, PollRawRank } from './poll';

// given votes, an array of ordered choices:
// [
//   [first choice option_id, second choice option_id, ...]
// ]
// return a sum by option_id descending
// [
//   [option_id, tally],
//   ...
// ]
const tally = (votes: number[][]): [option_id: number, tally: number][] => {
  let most = -Infinity;
  let least = Infinity;

  const grouped: Map<number, number> = new Map();
  for (const [firstChoice] of votes) {
    grouped.set(firstChoice, (grouped.get(firstChoice) ?? 0) + 1);
  }
  // sort descending by count
  const tallied = [...grouped.entries()];
  for (const [_, tally] of tallied) {
    most = Math.max(most, tally);
    least = Math.min(least, tally);
  }
  // order by tally descending, option_id ascending
  tallied.sort((a, b) => (b[1] === a[1] ? a[0] - b[0] : b[1] - a[1]));
  return tallied;
};

type Entry = { option_id: number; name: string; votes: number };
export type IRVResult = {
  total_voters: number;
  winner: Entry;
  final_round: Entry[];
  eliminations: Entry[];
};

export const irv = (ranks: PollRawRank[], options: PollOption[]): IRVResult => {
  const optionNames: Map<number, string> = new Map();
  for (const { name, option_id } of options) {
    optionNames.set(option_id, name);
  }

  // group by voter id
  const grouped: Record<string, { option_id: number; rank: number }[]> = Object.create(null);
  for (const { twitch_user_id, option_id, rank } of ranks) {
    grouped[twitch_user_id] ??= [];
    grouped[twitch_user_id]!.push({ option_id, rank });
  }

  // map down to ordered votes:
  // [
  //   [first_choice, second_choice, ....]
  // ]
  const votes: number[][] = [];
  for (const arr of Object.values(grouped) as { option_id: number; rank: number }[][]) {
    // ascending by rank
    arr.sort((a, b) => a.rank - b.rank);
    votes.push(arr.map(({ option_id }) => option_id));
  }

  // run the rounds
  const totalVoters = votes.length;
  const eliminations: Entry[] = [];
  let filtered: number[][] = votes.slice();

  let tallied: [option_id: number, tally: number][] = [];

  const seenOptionIds = new Set<number>();
  const optionName = (id: number): string => {
    seenOptionIds.add(id);
    return optionNames.get(id) ?? '(unknown)';
  };

  while (filtered.length > 0) {
    tallied = tally(filtered);

    const best = tallied[0];
    const worst = tallied[tallied.length - 1];

    // tie across the board
    if (best[1] === worst[1]) break;

    // majority win
    if (best[1] > totalVoters / 2) break;

    // do a new round
    const loserOptionId = worst[0];
    eliminations.push({ option_id: loserOptionId, name: optionName(loserOptionId), votes: worst[1] });

    filtered = filtered.flatMap(ranks => {
      const removed = ranks.filter(optionId => optionId !== loserOptionId);
      return removed.length === 0 ? [] : [removed];
    });
  }

  // make "first eliminated" into "last place"
  eliminations.reverse();

  const final_round: Entry[] = tallied.map(([optionId, tally]) => ({
    option_id: optionId,
    name: optionName(optionId),
    votes: tally,
  }));

  const no_votes: Entry[] = [];
  for (const [option_id, name] of optionNames.entries()) {
    if (seenOptionIds.has(option_id)) continue;
    no_votes.push({ option_id, name, votes: 0 });
  }
  // sort by tiebreaker (id = streamer order) ascending
  // implies "last item on the list" was eliminated first
  // when 0 votes
  no_votes.sort((a, b) => a.option_id - b.option_id);

  const winner: Entry = final_round.splice(0, 1)[0] ?? { option_id: -1, name: '(error)', votes: 0 };
  return {
    total_voters: totalVoters,
    winner,
    final_round: eliminations.length === 0 ? final_round.concat(no_votes) : final_round,
    eliminations: eliminations.length > 0 ? eliminations.concat(no_votes) : [],
  };

  // const candidates = new Set<number>();
  // const voterPreferences = new Map<string, Omit<RankedVote, 'twitch_user_id'>[]>();

  // for (const { twitch_user_id, option_id, vote_rank } of ranks) {
  //   candidates.add(option_id);
  //   const arr = voterPreferences.get(twitch_user_id) ?? [];
  //   arr.push({ option_id, vote_rank });
  //   voterPreferences.set(twitch_user_id, arr);
  // }

  // for (const ranks of voterPreferences.values()) {
  //   ranks.sort((a, b) => a.vote_rank - b.vote_rank);
  // }

  // // degenerate cases
  // if (candidates.size === 0) {
  //   throw new Error('No ranks present');
  // }

  // // loop here
  // while (candidates.size > 1) {
  //   const votes = new Map<number, number>([...candidates.values()].map(option_id => [option_id, 0]));

  //   // add a vote to everyone's first preference
  //   for (const prefs of voterPreferences.values()) {
  //     const option_id = prefs[0].option_id!;
  //     votes.set(option_id, votes.get(option_id)! + 1);
  //   }

  //   // see if anyone won
  //   const target = voterPreferences.size / 2;
  //   let least = Infinity;
  //   let least_ids: number[] = [];
  //   for (const [option_id, tally] of votes.entries()) {
  //     if (tally > target) return option_id;
  //     if (tally < least) {
  //       least = tally;
  //       least_ids = [option_id];
  //     } else if (tally === least) {
  //       least_ids.push(option_id);
  //     }
  //   }

  //   if (least_ids.length === 0) {
  //     throw new Error('least_ids is empty but there was no winner...');
  //   }

  //   // nobody had > 50%, remove the worst performer
  //   // we use the initial poll ordering as a tie-breaker if
  //   // multiple options received the same least number of votes
  //   // the top entries will have lower autoincrement database
  //   // ids
  //   candidates.delete(Math.max(...least_ids));

  //   // remove votes for candidates that no longer exist
  //   for (const [twitch_user_id, ranks] of voterPreferences.entries()) {
  //     const filtered = ranks.filter(v => candidates.has(v.option_id));
  //     if (filtered.length === 0) {
  //       // no more votes from this user, remove them entirely
  //       voterPreferences.delete(twitch_user_id);
  //     } else {
  //       voterPreferences.set(twitch_user_id, filtered);
  //     }
  //   }
  // }

  // return candidates.values().next().value!;
};
