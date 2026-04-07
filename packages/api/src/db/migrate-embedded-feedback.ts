// Embedded feedback migration is now consolidated into schema.sql and auto-migrate.ts.
// This file is kept for backward compatibility with the db:migrate:feedback npm script.

import { runMigrations } from './auto-migrate.js';
import { closeDb } from './connection.js';

runMigrations()
  .then(() => {
    console.log('Embedded feedback migration complete (via auto-migrate).');
    return closeDb();
  })
  .catch((err) => {
    console.error('Embedded feedback migration failed:', err);
    process.exit(1);
  });
