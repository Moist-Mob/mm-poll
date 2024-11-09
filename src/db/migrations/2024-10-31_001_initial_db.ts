import { Kysely, sql } from 'kysely';
import { CheckEnum, GT, GTE, NotNull, PK, PK_Auto } from '../helpers';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('poll')
    .addColumn('poll_id', 'integer', PK_Auto)
    .addColumn('title', 'text', NotNull)
    .addColumn('created_on', 'integer', NotNull)
    .addColumn('closes_on', 'integer', NotNull)

    .modifyEnd(sql`STRICT`)
    .execute();

  await db.schema
    .createTable('option')
    .addColumn('option_id', 'integer', PK_Auto)
    .addColumn('poll_id', 'integer', cb => cb.references('poll.poll_id').onUpdate('cascade').onDelete('cascade'))
    .addColumn('name', 'text', NotNull)

    .modifyEnd(sql`STRICT`)
    .execute();

  await db.schema
    .createTable('vote')
    .addColumn('vote_id', 'integer', PK_Auto)
    .addColumn('poll_id', 'integer', NotNull)
    .addColumn('twitch_user_id', 'text', NotNull)
    .addColumn('option_id', 'integer', NotNull)
    .addColumn('vote_rank', 'integer', NotNull)

    // sqlite primary key implies unique
    // TODO: remove "vote_rank" from the unique constraint
    .addUniqueConstraint('player_flag_pk', ['poll_id', 'option_id', 'twitch_user_id', 'vote_rank'])

    .modifyEnd(sql`STRICT`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('poll').execute();
  await db.schema.dropTable('option').execute();
  await db.schema.dropTable('vote').execute();
}
