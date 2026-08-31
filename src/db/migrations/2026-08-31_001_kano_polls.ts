import { Kysely, sql } from 'kysely';
import { CheckEnum, NotNull, PK_Auto } from '../helpers.js';

// Adds a poll "kind" (instant-runoff vs. Kano) and a table for Kano answers.
// Each Kano voter answers two questions per option (feature), on a 1..5 scale.

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('poll')
    .addColumn('kind', 'text', cb => CheckEnum('kind', 'irv', 'kano')(cb).defaultTo('irv'))
    .execute();

  await db.schema
    .createTable('kano_vote')
    .addColumn('kano_vote_id', 'integer', PK_Auto)
    .addColumn('poll_id', 'integer', NotNull)
    .addColumn('twitch_user_id', 'text', NotNull)
    .addColumn('option_id', 'integer', NotNull)
    .addColumn('functional', 'integer', CheckEnum('functional', 1, 2, 3, 4, 5))
    .addColumn('dysfunctional', 'integer', CheckEnum('dysfunctional', 1, 2, 3, 4, 5))

    .addUniqueConstraint('kano_vote_uniq', ['poll_id', 'option_id', 'twitch_user_id'])

    .modifyEnd(sql`STRICT`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('kano_vote').execute();
  await db.schema.alterTable('poll').dropColumn('kind').execute();
}
