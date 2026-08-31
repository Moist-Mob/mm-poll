import { classify, kano, KanoAnswer, KanoRawAnswer, KANO_CATEGORY_ORDER } from './kano.js';
import { PollOption } from './poll.js';

const { Like, Expect, Neutral, Tolerate, Dislike } = KanoAnswer;

describe('kano', () => {
  const A = 1;
  const B = 2;
  const C = 3;

  const options: PollOption[] = [
    { name: 'A', option_id: A },
    { name: 'B', option_id: B },
    { name: 'C', option_id: C },
  ];

  const answer = (
    twitch_user_id: string,
    option_id: number,
    functional: KanoAnswer,
    dysfunctional: KanoAnswer
  ): KanoRawAnswer => ({ twitch_user_id, option_id, functional, dysfunctional });

  describe('classify', () => {
    it('matches the standard evaluation table', () => {
      // functional Like
      expect(classify(Like, Like)).toEqual('Q');
      expect(classify(Like, Expect)).toEqual('A');
      expect(classify(Like, Neutral)).toEqual('A');
      expect(classify(Like, Tolerate)).toEqual('A');
      expect(classify(Like, Dislike)).toEqual('O');
      // functional Expect / Neutral / Tolerate
      for (const f of [Expect, Neutral, Tolerate]) {
        expect(classify(f, Like)).toEqual('R');
        expect(classify(f, Expect)).toEqual('I');
        expect(classify(f, Neutral)).toEqual('I');
        expect(classify(f, Tolerate)).toEqual('I');
        expect(classify(f, Dislike)).toEqual('M');
      }
      // functional Dislike
      expect(classify(Dislike, Like)).toEqual('R');
      expect(classify(Dislike, Expect)).toEqual('R');
      expect(classify(Dislike, Neutral)).toEqual('R');
      expect(classify(Dislike, Tolerate)).toEqual('R');
      expect(classify(Dislike, Dislike)).toEqual('Q');
    });
  });

  it('no votes', () => {
    const res = kano([], options);
    expect(res.total_voters).toEqual(0);
    expect(res.features.map(f => f.option_id)).toEqual([A, B, C]);
    for (const f of res.features) {
      expect(f.responses).toEqual(0);
      expect(f.category).toEqual('M'); // tie at zero -> highest priority
      expect(f.better).toEqual(0);
      expect(f.worse).toEqual(0);
    }
  });

  it('classifies by mode and computes coefficients', () => {
    const answers: KanoRawAnswer[] = [
      // A: 3x attractive, 1x indifferent
      answer('1', A, Like, Neutral),
      answer('2', A, Like, Tolerate),
      answer('3', A, Like, Expect),
      answer('4', A, Neutral, Neutral),
      // B: 2x must-be, 1x performance, 1x reverse
      answer('1', B, Neutral, Dislike),
      answer('2', B, Expect, Dislike),
      answer('3', B, Like, Dislike),
      answer('4', B, Dislike, Like),
      // C: 4x questionable (excluded from coefficients)
      answer('1', C, Like, Like),
      answer('2', C, Like, Like),
      answer('3', C, Dislike, Dislike),
      answer('4', C, Dislike, Dislike),
    ];
    const res = kano(answers, options);
    expect(res.total_voters).toEqual(4);

    const byId = new Map(res.features.map(f => [f.option_id, f]));

    const a = byId.get(A)!;
    expect(a.category).toEqual('A');
    expect(a.counts).toEqual({ M: 0, O: 0, A: 3, I: 1, R: 0, Q: 0 });
    expect(a.better).toBeCloseTo(3 / 4);
    expect(a.worse).toBeCloseTo(0);

    const b = byId.get(B)!;
    expect(b.category).toEqual('M');
    expect(b.counts).toEqual({ M: 2, O: 1, A: 0, I: 0, R: 1, Q: 0 });
    expect(b.better).toBeCloseTo(1 / 3);
    expect(b.worse).toBeCloseTo(-1);

    const c = byId.get(C)!;
    expect(c.category).toEqual('Q');
    expect(c.responses).toEqual(4);
    expect(c.better).toEqual(0);
    expect(c.worse).toEqual(0);

    // sorted by category priority: M (B), A (A), Q (C)
    expect(res.features.map(f => f.option_id)).toEqual([B, A, C]);
  });

  it('breaks ties by category priority', () => {
    const answers: KanoRawAnswer[] = [
      // A: 1x I, 1x O -> O wins (O before I)
      answer('1', A, Neutral, Neutral),
      answer('2', A, Like, Dislike),
      // B: 1x A, 1x M -> M wins
      answer('1', B, Like, Neutral),
      answer('2', B, Neutral, Dislike),
      // C: 1x R, 1x I -> I wins
      answer('1', C, Dislike, Neutral),
      answer('2', C, Neutral, Neutral),
    ];
    const res = kano(answers, options);
    const byId = new Map(res.features.map(f => [f.option_id, f]));
    expect(byId.get(A)!.category).toEqual('O');
    expect(byId.get(B)!.category).toEqual('M');
    expect(byId.get(C)!.category).toEqual('I');
    expect(res.features.map(f => f.option_id)).toEqual([B, A, C]);
  });

  it('orders within a category by total effect, then streamer order', () => {
    const answers: KanoRawAnswer[] = [
      // all attractive, but B has a stronger "better" coefficient than A
      answer('1', A, Like, Neutral),
      answer('2', A, Neutral, Neutral),
      answer('1', B, Like, Neutral),
      answer('2', B, Like, Neutral),
      // C ties with A exactly
      answer('1', C, Like, Neutral),
      answer('2', C, Neutral, Neutral),
    ];
    const res = kano(answers, options);
    expect(res.features.map(f => f.option_id)).toEqual([B, A, C]);
  });

  it('ignores answers for unknown options', () => {
    const res = kano([answer('1', 999, Like, Dislike)], options);
    expect(res.total_voters).toEqual(0);
    expect(res.features.every(f => f.responses === 0)).toBe(true);
  });

  it('category order covers every category exactly once', () => {
    expect([...KANO_CATEGORY_ORDER].sort()).toEqual(['A', 'I', 'M', 'O', 'Q', 'R']);
  });
});
