import { runMigrations } from './auto-migrate.js';
import { closeDb } from './connection.js';

runMigrations()
  .then(() => {
    console.log('Migration complete.');
    return closeDb();
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
