import { promises as fs } from 'node:fs';
import path from 'node:path';

import { type Migration, type MigrationProvider } from 'kysely/migration';

import { migrationFolder } from '../db.js';

// kysely's FileMigrationProvider imports with node's loader, which can't map
// the `.js` specifiers in the .ts migrations; import them via vitest instead
export const testMigrationProvider: MigrationProvider = {
  async getMigrations() {
    const files = (await fs.readdir(migrationFolder)).filter(f => f.endsWith('.ts')).sort();
    const migrations: Record<string, Migration> = {};
    for (const file of files) {
      migrations[path.basename(file, '.ts')] = await import(path.join(migrationFolder, file));
    }
    return migrations;
  },
};
