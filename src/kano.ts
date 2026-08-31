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

export const KANO_ANSWER_LABELS: Record<KanoAnswer, string> = {
  1: 'I like it',
  2: 'I expect it',
  3: "I'm neutral",
  4: 'I can tolerate it',
  5: 'I dislike it',
};

// [value, label] pairs in display order (for building forms)
export const KANO_SCALE = (Object.entries(KANO_ANSWER_LABELS) as [string, string][]).map(([value, label]) => ({
  value: Number(value) as KanoAnswer,
  label,
}));

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

export type KanoCounts = Record<KanoCategory, number>;

export type KanoEntry = {
  option_id: number;
  name: string;
  responses: number;
  counts: KanoCounts;
  category: KanoCategory;
  category_name: string;
  // Berger et al. "better" / "worse" coefficients:
  //   better = (A + O) / (A + O + M + I)   (0..1: how much satisfaction rises if present)
  //   worse  = -(O + M) / (A + O + M + I)  (-1..0: how much satisfaction falls if absent)
  better: number;
  worse: number;
};

export type KanoResult = {
  total_voters: number;
  features: KanoEntry[];
};

const emptyCounts = (): KanoCounts => ({ M: 0, O: 0, A: 0, I: 0, R: 0, Q: 0 });

export const kano = (answers: KanoRawAnswer[], options: PollOption[]): KanoResult => {
  const counts: Map<number, KanoCounts> = new Map(options.map(opt => [opt.option_id, emptyCounts()]));
  const voters = new Set<string>();

  for (const { twitch_user_id, option_id, functional, dysfunctional } of answers) {
    const c = counts.get(option_id);
    // answers for options that no longer exist are ignored
    if (!c) continue;
    voters.add(twitch_user_id);
    c[classify(functional, dysfunctional)]++;
  }

  const features: KanoEntry[] = options.map(({ option_id, name }) => {
    const c = counts.get(option_id)!;
    const responses = KANO_CATEGORY_ORDER.reduce((acc, cat) => acc + c[cat], 0);

    // mode, ties broken by KANO_CATEGORY_ORDER (first wins)
    let category: KanoCategory = KANO_CATEGORY_ORDER[0]!;
    for (const cat of KANO_CATEGORY_ORDER) {
      if (c[cat] > c[category]) category = cat;
    }

    const denom = c.A + c.O + c.M + c.I;
    const better = denom === 0 ? 0 : (c.A + c.O) / denom;
    const worse = denom === 0 ? 0 : -(c.O + c.M) / denom;

    return {
      option_id,
      name,
      responses,
      counts: c,
      category,
      category_name: KANO_CATEGORY_NAMES[category],
      better,
      worse,
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
