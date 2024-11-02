import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface PollTable {
  poll_id: Generated<number>;
  title: string;
  created_on: number;
  closes_on: number;
}
export interface OptionTable {
  option_id: Generated<number>;
  poll_id: number;
  name: string;
}
export interface VoteTable {
  vote_id: Generated<number>;
  poll_id: number;
  option_id: number;
  twitch_user_id: string;
  vote_rank: number;
}

export interface Database {
  poll: PollTable;
  option: OptionTable;
  vote: VoteTable;
}
