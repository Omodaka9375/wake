import { getDb } from './db.js';
import type { AccessTier } from './types.js';

/** A knowledge entry row. */
type KnowledgeEntry = {
  id: number;
  category: string;
  summary: string;
  details: string;
  memorialVisible: boolean;
  releaseAfter?: string;
  createdAt: string;
  updatedAt: string;
};

/** Check if a time-locked item is currently released. */
function isReleased(releaseAfter?: string): boolean {
  if (!releaseAfter) return true;
  return new Date().getTime() >= new Date(releaseAfter).getTime();
}

/** Categories that the beneficiary tier can see. */
const BENEFICIARY_CATEGORIES = ['finances', 'accounts', 'documents', 'contacts'];

/** Add a knowledge entry. Returns the new row ID. */
function addEntry(
  ownerId: string,
  category: string,
  summary: string,
  details: string,
  memorialVisible: boolean = false,
  releaseAfter?: string,
): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO knowledge_entries (owner_id, category, summary, details, memorial_visible, release_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(ownerId, category, summary, details, memorialVisible ? 1 : 0, releaseAfter ?? null, now, now);
  return Number(result.lastInsertRowid);
}

/** List entries for an owner, optionally filtered by category. */
function listEntries(ownerId: string, category?: string): KnowledgeEntry[] {
  const db = getDb();
  const query = category
    ? db.prepare('SELECT * FROM knowledge_entries WHERE owner_id = ? AND category = ? ORDER BY id ASC')
    : db.prepare('SELECT * FROM knowledge_entries WHERE owner_id = ? ORDER BY id ASC');

  const rows = (category ? query.all(ownerId, category) : query.all(ownerId)) as Array<{
    id: number; category: string; summary: string; details: string;
    memorial_visible: number; release_after: string | null; created_at: string; updated_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    summary: r.summary,
    details: r.details,
    memorialVisible: r.memorial_visible === 1,
    releaseAfter: r.release_after ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** Delete a knowledge entry. Returns true if deleted. */
function deleteEntry(ownerId: string, entryId: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM knowledge_entries WHERE id = ? AND owner_id = ?').run(entryId, ownerId);
  return result.changes > 0;
}

/** Get entries compiled for the Black Box, filtered by redactions and scoped by tier. */
function getCompiledEntries(
  ownerId: string,
  redactions: string[],
  tier: AccessTier,
): KnowledgeEntry[] {
  const all = listEntries(ownerId);

  // Filter out redacted categories (case-insensitive partial match)
  const redactLower = redactions.map((r) => r.toLowerCase());
  const nonRedacted = all.filter((e) => {
    const cat = e.category.toLowerCase();
    return !redactLower.some((r) => cat.includes(r) || r.includes(cat));
  });

  // Filter out time-locked entries that haven't been released yet
  const released = nonRedacted.filter((e) => isReleased(e.releaseAfter));

  // Scope by tier
  if (tier === 'executor') return released;

  if (tier === 'beneficiary') {
    return released.filter((e) => BENEFICIARY_CATEGORIES.includes(e.category.toLowerCase()));
  }

  // Memorial: only entries marked as memorial-visible
  return released.filter((e) => e.memorialVisible);
}

/** Get count of still-locked entries for an owner. */
function getLockedCount(ownerId: string): { total: number; locked: number } {
  const all = listEntries(ownerId);
  const locked = all.filter((e) => e.releaseAfter && !isReleased(e.releaseAfter));
  return { total: all.length, locked: locked.length };
}

export { addEntry, listEntries, deleteEntry, getCompiledEntries, getLockedCount, isReleased };
export type { KnowledgeEntry };
