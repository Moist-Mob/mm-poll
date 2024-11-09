import { Kysely, sql } from 'kysely';
import { NotNull, PK_Auto } from '../helpers';

export async function up(db: Kysely<any>): Promise<void> {
  await db.transaction().execute(async trx => {
    await trx.schema
      .createTable('new_vote')
      .addColumn('vote_id', 'integer', PK_Auto)
      .addColumn('poll_id', 'integer', NotNull)
      .addColumn('twitch_user_id', 'text', NotNull)
      .addColumn('option_id', 'integer', NotNull)
      .addColumn('vote_rank', 'integer', NotNull)

      // sqlite primary key implies unique
      // TODO: remove "vote_rank" from the unique constraint
      .addUniqueConstraint('player_flag_pk', ['poll_id', 'option_id', 'twitch_user_id'])

      .modifyEnd(sql`STRICT`)
      .execute();

    await trx
      .insertInto('new_vote')
      .columns(['vote_id', 'poll_id', 'twitch_user_id', 'option_id', 'vote_rank'])
      .expression(eb =>
        eb.selectFrom('vote').select(['vote_id', 'poll_id', 'twitch_user_id', 'option_id', 'vote_rank'])
      )
      .execute();

    await trx.schema.dropTable('vote').execute();

    await trx.schema.alterTable('new_vote').renameTo('vote').execute();
  });
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.transaction().execute(async trx => {
    await trx.schema
      .createTable('new_vote')
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

    await trx
      .insertInto('new_vote')
      .columns(['vote_id', 'poll_id', 'twitch_user_id', 'option_id', 'vote_rank'])
      .expression(eb =>
        eb.selectFrom('vote').select(['vote_id', 'poll_id', 'twitch_user_id', 'option_id', 'vote_rank'])
      )
      .execute();

    await trx.schema.dropTable('vote').execute();

    await trx.schema.alterTable('new_vote').renameTo('vote').execute();
  });
}
