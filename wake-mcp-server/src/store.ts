import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt } from './crypto.js';
import { getDb, MAX_BACKUPS } from './db.js';
import type { WakeState } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const KEY_FILE = resolve(DATA_DIR, '.server-key');

/** Default owner ID for single-user backward compatibility. */
const DEFAULT_OWNER = 'default';

/** Get or create the server-level encryption key. */
async function getServerKey(): Promise<string> {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    return (await readFile(KEY_FILE, 'utf-8')).trim();
  } catch {
    const key = randomBytes(32).toString('hex');
    await writeFile(KEY_FILE, key, 'utf-8');
    return key;
  }
}

/** Load state for an owner. Returns null if not found. */
async function loadState(ownerId: string = DEFAULT_OWNER): Promise<WakeState | null> {
  try {
    const db = getDb();
    const row = db.prepare('SELECT encrypted_state FROM wills WHERE owner_id = ?').get(ownerId) as
      | { encrypted_state: string }
      | undefined;
    if (!row) return null;

    const key = await getServerKey();
    const envelope = JSON.parse(row.encrypted_state);
    const plaintext = decrypt(envelope, key);
    return JSON.parse(plaintext) as WakeState;
  } catch {
    return null;
  }
}

/** Save state for an owner. Auto-backs up previous state. */
async function saveState(state: WakeState, ownerId: string = DEFAULT_OWNER): Promise<void> {
  const db = getDb();
  const key = await getServerKey();
  const now = new Date().toISOString();
  state.updatedAt = now;

  const plaintext = JSON.stringify(state, null, 2);
  const envelope = JSON.stringify({ encrypted: true, ...encrypt(plaintext, key) });

  // Backup previous state before overwriting
  const existing = db.prepare('SELECT encrypted_state FROM wills WHERE owner_id = ?').get(ownerId) as
    | { encrypted_state: string }
    | undefined;

  const upsert = db.transaction(() => {
    if (existing) {
      // Save backup
      db.prepare('INSERT INTO wills_backup (owner_id, encrypted_state, backed_up_at) VALUES (?, ?, ?)').run(
        ownerId,
        existing.encrypted_state,
        now,
      );
      // Prune old backups
      db.prepare(
        `DELETE FROM wills_backup WHERE owner_id = ? AND id NOT IN (
          SELECT id FROM wills_backup WHERE owner_id = ? ORDER BY id DESC LIMIT ?
        )`,
      ).run(ownerId, ownerId, MAX_BACKUPS);
      // Update
      db.prepare('UPDATE wills SET encrypted_state = ?, updated_at = ? WHERE owner_id = ?').run(envelope, now, ownerId);
    } else {
      // Insert new
      db.prepare('INSERT INTO wills (owner_id, encrypted_state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        ownerId,
        envelope,
        now,
        now,
      );
    }
  });

  upsert();
}

/** Check if a will exists for an owner. */
function willExists(ownerId: string = DEFAULT_OWNER): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM wills WHERE owner_id = ?').get(ownerId);
  return !!row;
}

export { loadState, saveState, willExists, getServerKey, DEFAULT_OWNER };
