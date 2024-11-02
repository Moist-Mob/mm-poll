import { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const assertSchema = <T extends TSchema>(schema: T, data: unknown): Static<T> => {
  if (Value.Check(schema, data)) return data;
  const errs: string = [...Value.Errors(schema, data)].map(e => `${e.path}: ${e.message}`).join('\n');
  throw new Error('Invalid data:\n' + errs);
};

export const asInt = (v: string | undefined): number | undefined => {
  if (typeof v !== 'string') return undefined;
  const num = parseInt(v, 10);
  return isNaN(num) ? undefined : num;
};

export const assertInt = (v: string | undefined): number => {
  const num = typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (isNaN(num)) throw new Error('Invalid integer');
  return num;
};

export const shuffle = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
};
