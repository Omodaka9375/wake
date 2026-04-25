import { getDb } from './db.js';
import type { AuditEntry, Phase } from './types.js';
import { DEFAULT_OWNER } from './store.js';

/** Append an audit entry. */
function logAction(
  action: string,
  caller: string,
  phase: Phase,
  success: boolean,
  detail: string,
  ownerId: string = DEFAULT_OWNER,
): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO audit_log (owner_id, timestamp, action, caller, phase, success, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(ownerId, new Date().toISOString(), action, caller, phase, success ? 1 : 0, detail);
}

/** Read audit entries for an owner. */
function readAuditLog(ownerId: string = DEFAULT_OWNER): AuditEntry[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT timestamp, action, caller, phase, success, detail FROM audit_log WHERE owner_id = ? ORDER BY id ASC')
    .all(ownerId) as Array<{ timestamp: string; action: string; caller: string; phase: string; success: number; detail: string }>;

  return rows.map((r) => ({
    timestamp: r.timestamp,
    action: r.action,
    caller: r.caller,
    phase: r.phase as Phase,
    success: r.success === 1,
    detail: r.detail,
  }));
}

export { logAction, readAuditLog };
