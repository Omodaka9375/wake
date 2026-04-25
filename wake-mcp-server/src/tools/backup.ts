import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadState, saveState } from '../store.js';
import { getDb } from '../db.js';
import { identifyCaller } from '../auth.js';
import { logAction } from '../audit.js';

function registerBackupTools(server: McpServer): void {
  server.registerTool('export_will', {
    description: 'Export the encrypted will state. Executor-only. Returns a portable blob.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    const isExec = caller.role === 'owner' || (caller.role === 'beneficiary' && state.will.beneficiaries.find((b) => b.name === caller.name)?.tier === 'executor');
    if (!isExec) return { content: [{ type: 'text' as const, text: 'Unauthorized. Executor access required.' }], isError: true };
    const db = getDb();
    const row = db.prepare('SELECT encrypted_state FROM wills WHERE owner_id = ?').get(ownerId) as { encrypted_state: string } | undefined;
    if (!row) return { content: [{ type: 'text' as const, text: 'No will found.' }], isError: true };
    logAction('export_will', caller.hashPrefix, state.phase, true, 'Exported', ownerId);
    return { content: [{ type: 'text' as const, text: row.encrypted_state }] };
  });

  server.registerTool('import_will', {
    description: 'Import a will from an exported encrypted blob. Replaces the current will for the ownerId.',
    inputSchema: z.object({ blob: z.string().describe('Encrypted state blob from export_will.'), ownerId: z.string().optional() }),
  }, async ({ blob, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const db = getDb();
    const now = new Date().toISOString();
    // Verify the blob is valid JSON
    try { JSON.parse(blob); } catch { return { content: [{ type: 'text' as const, text: 'Invalid blob format.' }], isError: true }; }
    const existing = db.prepare('SELECT 1 FROM wills WHERE owner_id = ?').get(ownerId);
    if (existing) {
      db.prepare('UPDATE wills SET encrypted_state = ?, updated_at = ? WHERE owner_id = ?').run(blob, now, ownerId);
    } else {
      db.prepare('INSERT INTO wills (owner_id, encrypted_state, created_at, updated_at) VALUES (?, ?, ?, ?)').run(ownerId, blob, now, now);
    }
    return { content: [{ type: 'text' as const, text: `Will imported for owner "${ownerId}".` }] };
  });

  server.registerTool('list_backups', {
    description: 'List available backup snapshots. Executor-only.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    const isExec = caller.role === 'owner' || (caller.role === 'beneficiary' && state.will.beneficiaries.find((b) => b.name === caller.name)?.tier === 'executor');
    if (!isExec) return { content: [{ type: 'text' as const, text: 'Unauthorized. Executor access required.' }], isError: true };
    const db = getDb();
    const rows = db.prepare('SELECT id, backed_up_at FROM wills_backup WHERE owner_id = ? ORDER BY id DESC').all(ownerId) as Array<{ id: number; backed_up_at: string }>;
    if (rows.length === 0) return { content: [{ type: 'text' as const, text: 'No backups available.' }] };
    const lines = rows.map((r) => `Backup #${r.id} — ${r.backed_up_at}`);
    return { content: [{ type: 'text' as const, text: `${rows.length} backup(s):\n${lines.join('\n')}` }] };
  });

  server.registerTool('restore_backup', {
    description: 'Restore a will from a backup snapshot. Executor-only.',
    inputSchema: z.object({ token: z.string(), backupId: z.number().describe('Backup ID from list_backups.'), ownerId: z.string().optional() }),
  }, async ({ token, backupId, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    const isExec = caller.role === 'owner' || (caller.role === 'beneficiary' && state.will.beneficiaries.find((b) => b.name === caller.name)?.tier === 'executor');
    if (!isExec) return { content: [{ type: 'text' as const, text: 'Unauthorized. Executor access required.' }], isError: true };
    const db = getDb();
    const backup = db.prepare('SELECT encrypted_state, backed_up_at FROM wills_backup WHERE id = ? AND owner_id = ?').get(backupId, ownerId) as { encrypted_state: string; backed_up_at: string } | undefined;
    if (!backup) return { content: [{ type: 'text' as const, text: `Backup #${backupId} not found.` }], isError: true };
    const now = new Date().toISOString();
    db.prepare('UPDATE wills SET encrypted_state = ?, updated_at = ? WHERE owner_id = ?').run(backup.encrypted_state, now, ownerId);
    logAction('restore_backup', caller.hashPrefix, state.phase, true, `Restored backup #${backupId} from ${backup.backed_up_at}`, ownerId);
    return { content: [{ type: 'text' as const, text: `Will restored from backup #${backupId} (${backup.backed_up_at}).` }] };
  });
}

export { registerBackupTools };
