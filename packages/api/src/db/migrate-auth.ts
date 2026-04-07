// Auth migration is now consolidated into schema.sql and auto-migrate.ts.
// This file is kept for backward compatibility with the db:migrate:auth npm script.

import { runMigrations } from './auto-migrate.js';
import { closeDb } from './connection.js';

runMigrations()
  .then(() => {
    console.log('Auth migration complete (via auto-migrate).');
    return closeDb();
  })
  .catch((err) => {
    console.error('Auth migration failed:', err);
    process.exit(1);
  });
