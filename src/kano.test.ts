import {
  classify,
  fongSignificant,
  kano,
  KanoAnswer,
  KanoRawAnswer,
  KanoShares,
  KANO_CATEGORY_ORDER,
  verdictFor,
  wilson,
} from './kano.js';
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

    // intensity splits each side into both-ways-extreme vs one-sided
    expect(a.intensity).toEqual({ strong_want: 0, mild_want: 0.75, mild_reject: 0, strong_reject: 0 });
    // B: O (strong want), 2x M (mild want), R via Dislike/Like (strong reject)
    expect(b.intensity).toEqual({ strong_want: 0.25, mild_want: 0.5, mild_reject: 0, strong_reject: 0.25 });
    expect(c.intensity).toEqual({ strong_want: 0, mild_want: 0, mild_reject: 0, strong_reject: 0 });
    // intensity always sums back to the bar's want/reject shares
    for (const f of [a, b, c]) {
      expect(f.intensity.strong_want + f.intensity.mild_want).toBeCloseTo(f.shares.want);
      expect(f.intensity.strong_reject + f.intensity.mild_reject).toBeCloseTo(f.shares.reject);
    }

    // sorted by category priority: M (B), A (A), Q (C)
    expect(res.features.map(f => f.option_id)).toEqual([B, A, C]);
  });

  it('one-sided rejects are mild, both-ways rejects are strong', () => {
    const answers: KanoRawAnswer[] = [
      answer('1', A, Dislike, Neutral), // R, one-sided
      answer('2', A, Neutral, Like), // R, one-sided
      answer('3', A, Dislike, Like), // R, both ways
      answer('4', A, Tolerate, Like), // R, one-sided
    ];
    const f = kano(answers, [options[0]!]).features[0]!;
    expect(f.counts.R).toEqual(4);
    expect(f.intensity).toEqual({ strong_want: 0, mild_want: 0, mild_reject: 0.75, strong_reject: 0.25 });
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

  describe('category strength and significance', () => {
    // n voters answering feature A with the given (functional, dysfunctional) pairs
    const bulk = (pairs: [KanoAnswer, KanoAnswer, number][]): KanoRawAnswer[] => {
      let uid = 0;
      return pairs.flatMap(([f, d, n]) => Array.from({ length: n }, () => answer(String(uid++), A, f, d)));
    };
    const only = (answers: KanoRawAnswer[]) => kano(answers, [options[0]!]).features[0]!;

    it('fong: a gap is significant relative to sample size', () => {
      expect(fongSignificant(5, 1, 6)).toBe(true);
      expect(fongSignificant(4, 3, 8)).toBe(false);
      expect(fongSignificant(300, 280, 800)).toBe(false);
      expect(fongSignificant(330, 280, 800)).toBe(true);
      expect(fongSignificant(0, 0, 0)).toBe(false);
    });

    it('a dominant category is clear', () => {
      // 60 M, 20 O, 20 I
      const f = only(
        bulk([
          [Expect, Dislike, 60],
          [Like, Dislike, 20],
          [Neutral, Neutral, 20],
        ])
      );
      expect(f.category).toEqual('M');
      expect(f.category_runner_up).toEqual('O');
      expect(f.category_strength).toBeCloseTo(0.4);
      expect(f.category_significant).toBe(true);
      expect(f.category_clear).toBe(true);
    });

    it('a near tie is flagged as not clear', () => {
      // 41 M, 39 O, 20 I -> strength 2pts, and fong fails at n=100
      const f = only(
        bulk([
          [Expect, Dislike, 41],
          [Like, Dislike, 39],
          [Neutral, Neutral, 20],
        ])
      );
      expect(f.category).toEqual('M');
      expect(f.category_runner_up).toEqual('O');
      expect(f.category_strength).toBeCloseTo(0.02);
      expect(f.category_clear).toBe(false);
    });

    it('no runner-up when only one category has responses', () => {
      const f = only(bulk([[Like, Dislike, 5]]));
      expect(f.category).toEqual('O');
      expect(f.category_runner_up).toBeNull();
      expect(f.category_clear).toBe(true);
    });
  });

  describe('shares, margin and verdict', () => {
    const shares = (want: number, indifferent: number, reject: number, unclear = 0): KanoShares => ({
      want,
      indifferent,
      reject,
      unclear,
    });

    it('wilson intervals stay in range and are asymmetric at small n', () => {
      const one_of_three = wilson(1, 3);
      expect(one_of_three.low).toBeCloseTo(0.0617, 3);
      expect(one_of_three.high).toBeCloseTo(0.7924, 3);
      const none_of_three = wilson(0, 3);
      expect(none_of_three.low).toEqual(0);
      expect(none_of_three.high).toBeCloseTo(0.5615, 3);
      const all_of_three = wilson(3, 3);
      expect(all_of_three.low).toBeCloseTo(0.4385, 3);
      expect(all_of_three.high).toEqual(1);
      // large n: approaches the familiar ±3.5% at p = 0.5
      const half_of_800 = wilson(400, 800);
      expect(half_of_800.low).toBeCloseTo(0.4655, 3);
      expect(half_of_800.high).toBeCloseTo(0.5345, 3);
      expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
    });

    it('computes shares and intervals; tiny samples are flagged', () => {
      const answers: KanoRawAnswer[] = [
        answer('1', A, Like, Dislike), // O  (want)
        answer('2', A, Neutral, Neutral), // I
        answer('3', A, Dislike, Like), // R
        answer('4', A, Like, Like), // Q
      ];
      const f = kano(answers, [options[0]!]).features[0]!;
      expect(f.shares).toEqual({ want: 0.25, indifferent: 0.25, reject: 0.25, unclear: 0.25 });
      expect(f.intervals.want).toEqual(wilson(1, 4));
      expect(f.small_sample).toBe(true);
      expect(f.split_close).toBe(true);
      expect(f.verdict.detail).toMatch(/Only 4 responses — too few to draw conclusions/);
      expect(f.verdict.detail).toMatch(/anywhere from 5%–70%/);
    });

    it('the 2-vs-1 test poll case reads as inconclusive, not ±57%', () => {
      const answers: KanoRawAnswer[] = [
        answer('1', A, Neutral, Neutral),
        answer('2', A, Neutral, Neutral),
        answer('3', A, Dislike, Like),
      ];
      const f = kano(answers, [options[0]!]).features[0]!;
      expect(f.small_sample).toBe(true);
      expect(f.verdict.kind).toEqual('vocal_minority');
      expect(f.verdict.detail).toMatch(/Only 3 responses/);
      expect(f.verdict.detail).toMatch(/not wanting it 6%–79%/);
    });

    it('margin is the widest half-interval and shrinks with sample size (~±3.5% at n=800)', () => {
      const answers = Array.from({ length: 800 }, (_, i) => answer(String(i), A, Like, Neutral));
      const f = kano(answers, [options[0]!]).features[0]!;
      expect(f.small_sample).toBe(false);
      expect(f.margin).toBeLessThan(0.036);
      expect(f.split_close).toBe(false);
      expect(f.verdict.kind).toEqual('clear_support');
    });

    it('closeness is decided by overlapping want/reject intervals', () => {
      const mk = (want: number, reject: number, meh: number) =>
        kano(
          [
            ...Array.from({ length: want }, (_, i) => answer(`w${i}`, A, Like, Dislike)),
            ...Array.from({ length: reject }, (_, i) => answer(`r${i}`, A, Dislike, Like)),
            ...Array.from({ length: meh }, (_, i) => answer(`m${i}`, A, Neutral, Neutral)),
          ],
          [options[0]!]
        ).features[0]!;
      // 42% vs 40% of 800: intervals overlap -> close
      expect(mk(336, 320, 144).split_close).toBe(true);
      // 48% vs 36% of 800: clearly apart
      expect(mk(384, 288, 128).split_close).toBe(false);
    });

    const input = (s: KanoShares, n = 800, split_close = false, small_sample = false) => ({
      shares: s,
      n,
      intervals: {
        want: wilson(Math.round(s.want * n), n),
        indifferent: wilson(Math.round(s.indifferent * n), n),
        reject: wilson(Math.round(s.reject * n), n),
      },
      small_sample,
      split_close,
    });

    it('picks the verdict from the split', () => {
      expect(verdictFor(input(shares(0, 0, 0), 0, true)).kind).toEqual('no_data');
      expect(verdictFor(input(shares(0.2, 0.2, 0.6))).kind).toEqual('unwanted');
      expect(verdictFor(input(shares(0.45, 0.15, 0.4))).kind).toEqual('divisive');
      expect(verdictFor(input(shares(0.7, 0.25, 0.05))).kind).toEqual('clear_support');
      expect(verdictFor(input(shares(0.2, 0.65, 0.15))).kind).toEqual('vocal_minority');
      expect(verdictFor(input(shares(0.25, 0.7, 0.05))).kind).toEqual('indifferent');
      expect(verdictFor(input(shares(0.3, 0.42, 0.28), 800, true)).kind).toEqual('mixed');
      expect(verdictFor(input(shares(0.55, 0.25, 0.2))).kind).toEqual('leans_want');
      expect(verdictFor(input(shares(0.2, 0.52, 0.28))).kind).toEqual('vocal_minority');
      expect(verdictFor(input(shares(0.2, 0.45, 0.35))).kind).toEqual('leans_reject');
    });

    it('explains closeness in the detail text', () => {
      const even = verdictFor(input(shares(0.42, 0.18, 0.4), 800, true));
      expect(even.detail).toMatch(/within the margin of error, so treat them as even/);
      const clear = verdictFor(input(shares(0.55, 0.15, 0.3)));
      expect(clear.detail).toMatch(/leads by 25 points, well beyond the margin of error/);
      const minority = verdictFor(input(shares(0.2, 0.65, 0.15)));
      expect(minority.detail).toMatch(/about 120 people out of 800/);
      // small samples never get the confident phrasing, whatever the shape
      const tiny = verdictFor(input(shares(0.7, 0.25, 0.05), 20, false, true));
      expect(tiny.detail).toMatch(/Only 20 responses/);
      expect(tiny.detail).not.toMatch(/Opposition is small/);
    });
  });
});
