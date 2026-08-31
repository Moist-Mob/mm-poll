import { PollOption } from './poll.js';

// Kano model (Kano et al., 1984). Each respondent answers two questions per
// feature on the same 5-point scale:
//   functional:    "How would you feel if we HAD this?"
//   dysfunctional: "How would you feel if we did NOT have this?"
// The pair of answers is looked up in the evaluation table to classify the
// response, and the per-feature category is the most common classification.

export const KanoAnswer = {
  Like: 1,
  Expect: 2,
  Neutral: 3,
  Tolerate: 4,
  Dislike: 5,
} as const;
export type KanoAnswer = (typeof KanoAnswer)[keyof typeof KanoAnswer];

// Reaction phrasing rather than the textbook "I like it / I expect it / I'm
// neutral / I can tolerate it / I dislike it": each of these reads naturally
// as an answer to both "if we had this" and "if we didn't have this", which
// the textbook wording doesn't ("I expect it" on the negative question).
// Note the classification table only distinguishes positive / middle /
// negative, so the middle three exist to let people self-sort accurately.
export const KANO_ANSWER_LABELS: Record<KanoAnswer, string> = {
  1: 'Love it',
  2: 'As it should be',
  3: 'Neutral',
  4: 'Could live with it',
  5: 'Hate it',
};

export const KANO_ANSWER_EMOJI: Record<KanoAnswer, string> = {
  1: '😍',
  2: '🙂',
  3: '😐',
  4: '😕',
  5: '😡',
};

// scale entries in display order (for building forms)
export const KANO_SCALE = (Object.keys(KANO_ANSWER_LABELS) as unknown as KanoAnswer[]).map(k => {
  const value = Number(k) as KanoAnswer;
  return { value, label: KANO_ANSWER_LABELS[value], emoji: KANO_ANSWER_EMOJI[value] };
});

export const isKanoAnswer = (v: unknown): v is KanoAnswer =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;

export type KanoCategory = 'M' | 'O' | 'A' | 'I' | 'R' | 'Q';

export const KANO_CATEGORY_NAMES: Record<KanoCategory, string> = {
  M: 'Must-be',
  O: 'Performance',
  A: 'Attractive',
  I: 'Indifferent',
  R: 'Reverse',
  Q: 'Questionable',
};

// Display / tie-break priority. When two categories have the same number of
// responses, the one earlier in this list wins (M > O > A > I > R > Q).
export const KANO_CATEGORY_ORDER: KanoCategory[] = ['M', 'O', 'A', 'I', 'R', 'Q'];

// rows: functional answer (Like..Dislike), cols: dysfunctional answer (Like..Dislike)
const EVALUATION_TABLE: KanoCategory[][] = [
  ['Q', 'A', 'A', 'A', 'O'],
  ['R', 'I', 'I', 'I', 'M'],
  ['R', 'I', 'I', 'I', 'M'],
  ['R', 'I', 'I', 'I', 'M'],
  ['R', 'R', 'R', 'R', 'Q'],
];

export const classify = (functional: KanoAnswer, dysfunctional: KanoAnswer): KanoCategory =>
  EVALUATION_TABLE[functional - 1]![dysfunctional - 1]!;

export type KanoRawAnswer = {
  twitch_user_id: string;
  option_id: number;
  functional: KanoAnswer;
  dysfunctional: KanoAnswer;
};

// plain-language names for a non-technical audience, each defined by the two
// questions people actually answered (happier with it? upset without it?)
export const KANO_CATEGORY_PLAIN: Record<KanoCategory, string> = {
  M: 'Taken for granted',
  O: 'Wanted',
  A: 'Bonus',
  I: "Doesn't matter",
  R: 'Better without',
  Q: 'Mixed signals',
};

export const KANO_CATEGORY_MEANING: Record<KanoCategory, string> = {
  M: 'not exciting to have, but missed if it went',
  O: 'happier with it, unhappy without it',
  A: 'enjoyed when present, not missed when gone',
  I: 'few people care either way',
  R: 'people would rather not have it',
  Q: 'answers contradict each other',
};

export type KanoCounts = Record<KanoCategory, number>;

// the audience split that matters for a decision: want it (A+O+M), don't mind
// (I), don't want it (R), contradictory (Q); fractions of all responses
export type KanoShares = {
  want: number;
  indifferent: number;
  reject: number;
  unclear: number;
};

export type KanoVerdictKind =
  | 'no_data'
  | 'clear_support'
  | 'leans_want'
  | 'divisive'
  | 'unwanted'
  | 'leans_reject'
  | 'indifferent'
  | 'vocal_minority'
  | 'mixed';

export type KanoVerdict = {
  kind: KanoVerdictKind;
  headline: string;
  detail: string;
};

export type KanoEntry = {
  option_id: number;
  name: string;
  responses: number;
  counts: KanoCounts;
  category: KanoCategory;
  category_name: string;
  category_plain: string;
  category_meaning: string;
  // Lee & Newcomb category strength: share of the top category minus the
  // runner-up's, and the runner-up itself. Below CATEGORY_STRENGTH_MIN the
  // classification should be read as mixed (e.g. "M/O").
  category_strength: number;
  category_runner_up: KanoCategory | null;
  category_runner_up_plain: string | null;
  // Fong's test: is the top-vs-runner-up gap larger than its sampling noise?
  category_significant: boolean;
  // both of the above: the category can be stated without a caveat
  category_clear: boolean;
  // Berger et al. "better" / "worse" coefficients:
  //   better = (A + O) / (A + O + M + I)   (0..1: how much satisfaction rises if present)
  //   worse  = -(O + M) / (A + O + M + I)  (-1..0: how much satisfaction falls if absent)
  better: number;
  worse: number;
  shares: KanoShares;
  // how strongly each side feels, as fractions of responses; splits
  // shares.want into strong_want + mild_want and shares.reject into
  // strong_reject + mild_reject. "Strong" = an extreme answer on BOTH
  // questions (😍 with & 😡 without, or the reverse); "mild" = one-sided.
  intensity: KanoIntensity;
  // 95% Wilson score intervals for the three decision shares
  intervals: KanoIntervals;
  // display-friendly margin: the widest half-interval of the three, as a
  // fraction. Only meaningful (and only shown) when !small_sample.
  margin: number;
  // too few responses for any of the confidence language to mean anything
  small_sample: boolean;
  // do the want and reject intervals overlap? (i.e. the poll can't separate them)
  split_close: boolean;
  verdict: KanoVerdict;
};

export type KanoIntensity = {
  strong_want: number;
  mild_want: number;
  mild_reject: number;
  strong_reject: number;
};

export type KanoInterval = { low: number; high: number };
export type KanoIntervals = { want: KanoInterval; indifferent: KanoInterval; reject: KanoInterval };

export type KanoResult = {
  total_voters: number;
  features: KanoEntry[];
};

export const CATEGORY_STRENGTH_MIN = 0.06;
// below this many responses, don't pretend to know how close anything is
export const SMALL_SAMPLE = 30;

const Z95 = 1.96;

const emptyCounts = (): KanoCounts => ({ M: 0, O: 0, A: 0, I: 0, R: 0, Q: 0 });

// Wilson score interval for k successes in n trials. Unlike the normal
// approximation it behaves at small n and near 0/1: bounds stay within [0, 1]
// and are asymmetric (1 of 3 -> roughly 6%..79%).
export const wilson = (k: number, n: number, z = Z95): KanoInterval => {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2n = (z * z) / n;
  const centre = (p + z2n / 2) / (1 + z2n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2n / (4 * n))) / (1 + z2n);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
};

const overlaps = (a: KanoInterval, b: KanoInterval): boolean => a.low <= b.high && b.low <= a.high;

// Fong (1996): |a - b| > sqrt((a + b)(2n - a - b) / n), a/b = top two counts
export const fongSignificant = (a: number, b: number, n: number): boolean =>
  n > 0 && Math.abs(a - b) > Math.sqrt(((a + b) * (2 * n - a - b)) / n);

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const people = (v: number, n: number): string => {
  const k = Math.round(v * n);
  return `${k} ${k === 1 ? 'person' : 'people'}`;
};

// thresholds for the plain-language verdict (fractions of responses)
const V = {
  majority: 0.5,
  divisive_each_side: 0.3,
  negligible_reject: 0.15,
  notable_minority: 0.1,
};

export type KanoVerdictInput = {
  shares: KanoShares;
  n: number;
  intervals: KanoIntervals;
  small_sample: boolean;
  split_close: boolean;
};

export const verdictFor = ({ shares, n, intervals, small_sample, split_close }: KanoVerdictInput): KanoVerdict => {
  const { want, indifferent, reject } = shares;
  if (n === 0) return { kind: 'no_data', headline: 'No responses yet', detail: '' };

  const split = `${pct(want)} want it, ${pct(indifferent)} don't mind, ${pct(reject)} don't want it.`;
  const gap = Math.abs(want - reject);
  const leader = want >= reject ? 'wanting it' : 'not wanting it';
  const range = (i: KanoInterval) => `${pct(i.low)}–${pct(i.high)}`;
  const closeness = small_sample
    ? `Only ${n} ${n === 1 ? 'response' : 'responses'} — too few to draw conclusions (the real share wanting it could be anywhere from ${range(intervals.want)}, not wanting it ${range(intervals.reject)}).`
    : split_close
      ? `The gap between the two sides (${Math.round(gap * 100)} points) is within the margin of error, so treat them as even.`
      : `The side ${leader} leads by ${Math.round(gap * 100)} points, well beyond the margin of error.`;

  if (reject >= V.majority) {
    return { kind: 'unwanted', headline: "Most don't want this", detail: `${split} ${closeness}` };
  }
  if (want >= V.divisive_each_side && reject >= V.divisive_each_side) {
    return { kind: 'divisive', headline: 'Divisive', detail: `${split} ${closeness}` };
  }
  if (want >= V.majority && reject < V.negligible_reject) {
    return {
      kind: 'clear_support',
      headline: 'Clear support',
      detail: small_sample ? `${split} ${closeness}` : `${split} Opposition is small (about ${people(reject, n)}).`,
    };
  }
  if (indifferent >= V.majority) {
    if (reject >= V.notable_minority) {
      return {
        kind: 'vocal_minority',
        headline: "Most don't care; a minority object",
        detail: small_sample
          ? `${split} ${closeness}`
          : `${split} The objectors are about ${people(reject, n)} out of ${n} — real, but not the crowd.`,
      };
    }
    return {
      kind: 'indifferent',
      headline: 'Nobody minds either way',
      detail: small_sample ? `${split} ${closeness}` : `${split} Few people feel strongly in either direction.`,
    };
  }
  if (split_close) {
    return { kind: 'mixed', headline: 'No clear lean', detail: `${split} ${closeness}` };
  }
  if (want > reject) {
    return { kind: 'leans_want', headline: 'Leans in favor', detail: `${split} ${closeness}` };
  }
  return { kind: 'leans_reject', headline: 'Leans against', detail: `${split} ${closeness}` };
};

export const kano = (answers: KanoRawAnswer[], options: PollOption[]): KanoResult => {
  const counts: Map<number, KanoCounts> = new Map(options.map(opt => [opt.option_id, emptyCounts()]));
  // R responses that were extreme on both questions (😡 with, 😍 without);
  // the strong-want equivalent is simply the O category
  const strongReject: Map<number, number> = new Map(options.map(opt => [opt.option_id, 0]));
  const voters = new Set<string>();

  for (const { twitch_user_id, option_id, functional, dysfunctional } of answers) {
    const c = counts.get(option_id);
    // answers for options that no longer exist are ignored
    if (!c) continue;
    voters.add(twitch_user_id);
    c[classify(functional, dysfunctional)]++;
    if (functional === KanoAnswer.Dislike && dysfunctional === KanoAnswer.Like) {
      strongReject.set(option_id, strongReject.get(option_id)! + 1);
    }
  }

  const features: KanoEntry[] = options.map(({ option_id, name }) => {
    const c = counts.get(option_id)!;
    const responses = KANO_CATEGORY_ORDER.reduce((acc, cat) => acc + c[cat], 0);

    const strong_reject_n = strongReject.get(option_id)!;
    const intensity: KanoIntensity =
      responses === 0
        ? { strong_want: 0, mild_want: 0, mild_reject: 0, strong_reject: 0 }
        : {
            strong_want: c.O / responses,
            mild_want: (c.A + c.M) / responses,
            mild_reject: (c.R - strong_reject_n) / responses,
            strong_reject: strong_reject_n / responses,
          };

    // mode, ties broken by KANO_CATEGORY_ORDER (first wins); runner-up likewise
    let category: KanoCategory = KANO_CATEGORY_ORDER[0]!;
    for (const cat of KANO_CATEGORY_ORDER) {
      if (c[cat] > c[category]) category = cat;
    }
    let runner_up: KanoCategory | null = null;
    for (const cat of KANO_CATEGORY_ORDER) {
      if (cat === category) continue;
      if (runner_up === null || c[cat] > c[runner_up]) runner_up = cat;
    }
    const top = c[category];
    const second = runner_up === null ? 0 : c[runner_up];
    const category_strength = responses === 0 ? 0 : (top - second) / responses;
    const category_significant = fongSignificant(top, second, responses);
    const category_clear = category_significant && category_strength >= CATEGORY_STRENGTH_MIN;

    const denom = c.A + c.O + c.M + c.I;
    const better = denom === 0 ? 0 : (c.A + c.O) / denom;
    const worse = denom === 0 ? 0 : -(c.O + c.M) / denom;

    const shares: KanoShares =
      responses === 0
        ? { want: 0, indifferent: 0, reject: 0, unclear: 0 }
        : {
            want: (c.A + c.O + c.M) / responses,
            indifferent: c.I / responses,
            reject: c.R / responses,
            unclear: c.Q / responses,
          };
    const intervals: KanoIntervals = {
      want: wilson(c.A + c.O + c.M, responses),
      indifferent: wilson(c.I, responses),
      reject: wilson(c.R, responses),
    };
    const margin =
      responses === 0
        ? 0
        : Math.max(...[intervals.want, intervals.indifferent, intervals.reject].map(i => (i.high - i.low) / 2));
    const small_sample = responses < SMALL_SAMPLE;
    const split_close = responses === 0 || overlaps(intervals.want, intervals.reject);

    return {
      option_id,
      name,
      responses,
      counts: c,
      category,
      category_name: KANO_CATEGORY_NAMES[category],
      category_plain: KANO_CATEGORY_PLAIN[category],
      category_meaning: KANO_CATEGORY_MEANING[category],
      category_strength,
      category_runner_up: runner_up === null || second === 0 ? null : runner_up,
      category_runner_up_plain: runner_up === null || second === 0 ? null : KANO_CATEGORY_PLAIN[runner_up],
      category_significant,
      category_clear,
      better,
      worse,
      shares,
      intensity,
      intervals,
      margin,
      small_sample,
      split_close,
      verdict: verdictFor({ shares, n: responses, intervals, small_sample, split_close }),
    };
  });

  // group by category priority; within a category, strongest total effect
  // (better - worse) first; then streamer order
  features.sort((a, b) => {
    const ca = KANO_CATEGORY_ORDER.indexOf(a.category);
    const cb = KANO_CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    const ea = a.better - a.worse;
    const eb = b.better - b.worse;
    if (ea !== eb) return eb - ea;
    return a.option_id - b.option_id;
  });

  return { total_voters: voters.size, features };
};
