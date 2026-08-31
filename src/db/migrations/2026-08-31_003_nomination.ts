import { Kysely, sql } from 'kysely';
import { NotNull, PK_Auto } from '../helpers.js';

// Game nominations feeding future "next variety game" polls. One row per
// (viewer, twitch category); re-nominating refreshes nominated_on (epoch ms).

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('nomination')
    .addColumn('nomination_id', 'integer', PK_Auto)
    .addColumn('twitch_category_id', 'text', NotNull)
    .addColumn('name', 'text', NotNull)
    .addColumn('twitch_user_id', 'text', NotNull)
    .addColumn('nominated_on', 'integer', NotNull)
    .addUniqueConstraint('nomination_uniq', ['twitch_category_id', 'twitch_user_id'])
    .modifyEnd(sql`STRICT`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('nomination').execute();
}
