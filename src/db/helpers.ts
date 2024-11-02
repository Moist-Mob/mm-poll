import { sql, type ColumnDefinitionBuilder } from 'kysely';

export const PK = (cb: ColumnDefinitionBuilder) => cb.notNull().primaryKey();
export const NotNull = (cb: ColumnDefinitionBuilder) => cb.notNull();
export const GTE = (cn: string, val: number) => (cb: ColumnDefinitionBuilder) =>
  cb.notNull().check(sql`${sql.id(cn)} >= ${sql.lit(val)}`);
export const GT = (cn: string, val: number) => (cb: ColumnDefinitionBuilder) =>
  cb.notNull().check(sql`${sql.id(cn)} > ${sql.lit(val)}`);
export const PK_Auto = (cb: ColumnDefinitionBuilder) => cb.notNull().primaryKey().autoIncrement();
export const CheckEnum =
  <T>(cn: string, ...vals: T[]) =>
  (cb: ColumnDefinitionBuilder) =>
    cb.notNull().check(sql`${sql.id(cn)} IN (${sql.join(vals.map(sql.lit))})`);
