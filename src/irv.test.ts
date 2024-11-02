import { describe, expect, it } from '@jest/globals';
import { irv, RankedVote } from './irv';

describe('irv', () => {
  const A = 1;
  const B = 2;
  const C = 3;

  const ballot = (twitch_user_id: string, ...votes: number[]): RankedVote[] =>
    votes.map((option_id, vote_rank) => ({
      twitch_user_id,
      option_id,
      vote_rank,
    }));

  it('immediate win', () => {
    // A > B > C (5 votes), B > A > C (3 votes), C > A > B (2 votes)
    const votes: RankedVote[] = [
      ...ballot('1', A, B, C),
      ...ballot('2', A, B, C),
      ...ballot('3', A, B, C),
      ...ballot('4', A, B, C),
      ...ballot('5', A, B, C),

      ...ballot('6', B, A, C),
      ...ballot('7', B, A, C),
      ...ballot('8', B, A, C),

      ...ballot('9', C, A, B),
      ...ballot('10', C, A, B),
    ];
    expect(irv(votes)).toEqual(A);
  });

  it('elimination 1', () => {
    // A > B > C (4 votes), B > C > A (3 votes), C > A > B (3 votes)
    const votes: RankedVote[] = [
      ...ballot('1', A, B, C),
      ...ballot('2', A, B, C),
      ...ballot('3', A, B, C),
      ...ballot('4', A, B, C),

      ...ballot('5', B, C, A),
      ...ballot('6', B, C, A),
      ...ballot('7', B, C, A),

      ...ballot('8', C, A, B),
      ...ballot('9', C, A, B),
      ...ballot('10', C, A, B),
    ];
    // C gets removed (tie breaker - streamer order)
    // A wins over B
    expect(irv(votes)).toEqual(A);
  });

  it('elimination 2', () => {
    // A > B > C (4 votes), B > C > A (3 votes), C > A > B (3 votes)
    const votes: RankedVote[] = [
      ...ballot('1', A, B, C),
      ...ballot('2', A, B, C),
      ...ballot('3', A, B, C),
      ...ballot('4', A, B, C),

      ...ballot('5', B, C, A),
      ...ballot('6', B, C, A),
      ...ballot('7', B, C, A),

      ...ballot('8', C, B, A),
      ...ballot('9', C, B, A),
      ...ballot('10', C, B, A),
    ];
    // C gets removed (tie breaker - streamer order)
    // B wins over A
    expect(irv(votes)).toEqual(B);
  });

  it('tie 1', () => {
    //  A > B (4 votes), B > A (4 votes), C > A (2 votes)
    const votes: RankedVote[] = [
      ...ballot('1', A, B),
      ...ballot('2', A, B),
      ...ballot('3', A, B),
      ...ballot('4', A, B),

      ...ballot('5', B, A),
      ...ballot('6', B, A),
      ...ballot('7', B, A),
      ...ballot('8', B, A),
      ...ballot('9', B, A),

      ...ballot('10', C, A),
    ];
    // C gets removed (fewest votes)
    // A wins over B (streamer order)
    expect(irv(votes)).toEqual(A);
  });

  it('tie 2', () => {
    // circular
    const votes: RankedVote[] = [...ballot('1', A, B, C), ...ballot('2', B, C, A), ...ballot('3', C, A, B)];
    // C gets removed (streamer order)
    // B gets removed (streamer order)
    expect(irv(votes)).toEqual(A);
  });

  it('no votes', () => {
    expect(() => {
      irv([]);
    }).toThrow('No ranks present');
  });

  it('only one option chosen', () => {
    const votes: RankedVote[] = [...ballot('1', A), ...ballot('2', A), ...ballot('3', A)];
    // C gets removed (fewest votes)
    // A wins over B (streamer order)
    expect(irv(votes)).toEqual(A);
  });

  it('short vote removed', () => {
    const votes: RankedVote[] = [
      //
      ...ballot('1', A, C, B),
      ...ballot('2', C, A, B),
      ...ballot('3', A, C, B),
      ...ballot('4', C, A, B),
      ...ballot('7', B),
    ];
    // B gets removed (least first-choices)
    // user '3' entered no more preferences and is removed
    // // remainder is tied between A and C - A wins (streamer order)
    // remainder is tied - A wins (streamer order)
    expect(irv(votes)).toEqual(A);
  });
});
