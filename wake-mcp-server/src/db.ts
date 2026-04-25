import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const DB_PATH = resolve(DATA_DIR, 'wake.db');

/** Max backup snapshots kept per owner. */
const MAX_BACKUPS = 5;

let _db: Database.Database | null = null;

/** Get or create the database singleton. */
function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS wills (
      owner_id TEXT PRIMARY KEY,
      encrypted_state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wills_backup (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      encrypted_state TEXT NOT NULL,
      backed_up_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      caller TEXT NOT NULL,
      phase TEXT NOT NULL,
      success INTEGER NOT NULL,
      detail TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      details TEXT NOT NULL,
      memorial_visible INTEGER NOT NULL DEFAULT 0,
      release_after TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_owner ON audit_log(owner_id);
    CREATE INDEX IF NOT EXISTS idx_backup_owner ON wills_backup(owner_id);
    CREATE TABLE IF NOT EXISTS handoff_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      tier TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      initiated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_owner ON knowledge_entries(owner_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_entries(owner_id, category);
    CREATE INDEX IF NOT EXISTS idx_handoff_owner ON handoff_log(owner_id);
  `);

  return _db;
}

/** Close the database (for clean shutdown). */
function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export { getDb, closeDb, MAX_BACKUPS };
