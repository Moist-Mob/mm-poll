export type RankedVote = {
  option_id: number;
  twitch_user_id: string;
  vote_rank: number;
};

export const irv = (ranks: RankedVote[]): number => {
  const candidates = new Set<number>();
  const voterPreferences = new Map<string, Omit<RankedVote, 'twitch_user_id'>[]>();

  for (const { twitch_user_id, option_id, vote_rank } of ranks) {
    candidates.add(option_id);
    const arr = voterPreferences.get(twitch_user_id) ?? [];
    arr.push({ option_id, vote_rank });
    voterPreferences.set(twitch_user_id, arr);
  }

  for (const ranks of voterPreferences.values()) {
    ranks.sort((a, b) => a.vote_rank - b.vote_rank);
  }

  // degenerate cases
  if (candidates.size === 0) {
    throw new Error('No ranks present');
  }

  // loop here
  while (candidates.size > 1) {
    const votes = new Map<number, number>([...candidates.values()].map(option_id => [option_id, 0]));

    // add a vote to everyone's first preference
    for (const prefs of voterPreferences.values()) {
      const option_id = prefs[0].option_id!;
      votes.set(option_id, votes.get(option_id)! + 1);
    }

    // see if anyone won
    const target = voterPreferences.size / 2;
    let least = Infinity;
    let least_ids: number[] = [];
    for (const [option_id, tally] of votes.entries()) {
      if (tally > target) return option_id;
      if (tally < least) {
        least = tally;
        least_ids = [option_id];
      } else if (tally === least) {
        least_ids.push(option_id);
      }
    }

    if (least_ids.length === 0) {
      throw new Error('least_ids is empty but there was no winner...');
    }

    // nobody had > 50%, remove the worst performer
    // we use the initial poll ordering as a tie-breaker if
    // multiple options received the same least number of votes
    // the top entries will have lower autoincrement database
    // ids
    candidates.delete(Math.max(...least_ids));

    // remove votes for candidates that no longer exist
    for (const [twitch_user_id, ranks] of voterPreferences.entries()) {
      const filtered = ranks.filter(v => candidates.has(v.option_id));
      if (filtered.length === 0) {
        // no more votes from this user, remove them entirely
        voterPreferences.delete(twitch_user_id);
      } else {
        voterPreferences.set(twitch_user_id, filtered);
      }
    }
  }

  return candidates.values().next().value!;
};
