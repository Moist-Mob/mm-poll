import { promises as fs } from 'node:fs';
import path from 'node:path';

import createSqlite3 from 'better-sqlite3';
import { FileMigrationProvider, Kysely, Migrator, ParseJSONResultsPlugin, SqliteDialect } from 'kysely';

import Debug from 'debug';

import { Database } from './db/types.js';

export const initDb = async (abspath?: string) => {
  const debugQuery = Debug('db:query');

  const dbFile = abspath ?? ':memory:';
  const sqlite = createSqlite3(dbFile);

  sqlite.exec('PRAGMA foreign_keys = ON;');

  const dialect = new SqliteDialect({
    database: sqlite,
  });
  const db = new Kysely<Database>({
    dialect,
    // plugins: [new ParseJSONResultsPlugin()],
    log(event) {
      if (event.level === 'error') {
        debugQuery(event.query.sql, event.query.parameters);
      }
    },
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.resolve(import.meta.dirname, 'db', 'migrations'),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach(it => {
    if (it.status === 'Success') {
      console.log(`migration "${it.migrationName}" was executed successfully`);
    } else if (it.status === 'Error') {
      console.error(`failed to execute migration "${it.migrationName}"`);
    }
  });

  if (error) {
    console.error('failed to run `migrateToLatest`');
    console.error(error);
    process.exit(1);
  }

  return db;
};
