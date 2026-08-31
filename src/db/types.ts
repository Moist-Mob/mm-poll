import type { Generated } from 'kysely';

export type PollKind = 'irv' | 'kano';

export interface PollTable {
  poll_id: Generated<number>;
  kind: PollKind;
  title: string;
  created_on: number;
  closes_on: number;
}
export interface OptionTable {
  option_id: Generated<number>;
  poll_id: number;
  name: string;
}
// instant-runoff ballots: one row per (voter, ranked option)
export interface VoteTable {
  vote_id: Generated<number>;
  poll_id: number;
  option_id: number;
  twitch_user_id: string;
  vote_rank: number;
}
// kano answers: one row per (voter, option), both questions on a 1..5 scale
export interface KanoVoteTable {
  kano_vote_id: Generated<number>;
  poll_id: number;
  option_id: number;
  twitch_user_id: string;
  functional: number;
  dysfunctional: number;
}

// express-session storage; `expires` is epoch ms, `data` the JSON session blob
export interface SessionTable {
  sid: string;
  expires: number;
  data: string;
}

export interface Database {
  poll: PollTable;
  option: OptionTable;
  vote: VoteTable;
  kano_vote: KanoVoteTable;
  session: SessionTable;
}
