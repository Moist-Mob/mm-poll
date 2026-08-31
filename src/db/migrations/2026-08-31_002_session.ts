import { Kysely, sql } from 'kysely';
import { NotNull, PK } from '../helpers.js';

// Server-side storage for express-session. `expires` is epoch milliseconds
// and must only ever be compared against epoch milliseconds — sqlite compares
// mismatched storage classes by class, not value (see session-store.ts).

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('session')
    .addColumn('sid', 'text', PK)
    .addColumn('expires', 'integer', NotNull)
    .addColumn('data', 'text', NotNull)
    .modifyEnd(sql`STRICT`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('session').execute();
}
