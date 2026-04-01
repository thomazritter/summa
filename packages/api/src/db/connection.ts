import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/summarizer.db');

let db: Database.Database | null = null;

export const getDb = (): Database.Database => {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
  }
  return db;
};

export const closeDb = (): void => {
  if (db) {
    db.close();
    db = null;
  }
};
