import { getDb } from './db.js';
import { getCompiledEntries } from './knowledge.js';
import type { WakeState, AccessTier } from './types.js';

/** Versioned handoff package for agent-to-agent transfer. */
type HandoffPackage = {
  schema: 'wake-handoff-v1';
  owner: { name: string; agent: string };
  recipient: { name: string; tier: AccessTier };
  generatedAt: string;
  categories: string[];
  entries: Array<{ category: string; summary: string; details: string }>;
  operationalDirectives: string[];
  redactedCategories: string[];
    metadata: {
      phase: string;
      gracePeriodDays: number;
      eulogyStarted?: string;
      terminalState: string;
      noResurrection: boolean;
      jurisdiction?: string;
    };
  };

/** Build a handoff package for a specific beneficiary. */
function buildHandoffPackage(
  state: WakeState,
  ownerId: string,
  recipientName: string,
  tier: AccessTier,
): HandoffPackage {
  const entries = getCompiledEntries(ownerId, state.will.redactions, tier);
  const categories = [...new Set(entries.map((e) => e.category))];

  return {
    schema: 'wake-handoff-v1',
    owner: { name: state.will.ownerName, agent: state.will.agentName },
    recipient: { name: recipientName, tier },
    generatedAt: new Date().toISOString(),
    categories,
    entries: entries.map((e) => ({ category: e.category, summary: e.summary, details: e.details })),
    operationalDirectives: tier === 'executor' || tier === 'beneficiary' ? state.will.operationalDirectives : [],
    redactedCategories: state.will.redactions,
    metadata: {
      phase: state.phase,
      gracePeriodDays: state.will.gracePeriodDays,
      eulogyStarted: state.eulogyStarted,
      terminalState: state.will.terminalState,
      noResurrection: state.will.noResurrection !== false,
      jurisdiction: state.will.jurisdiction,
    },
  };
}

/** Log a handoff event. */
function logHandoff(ownerId: string, recipientName: string, tier: string, initiatedBy: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO handoff_log (owner_id, recipient_name, tier, initiated_by, initiated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(ownerId, recipientName, tier, initiatedBy, new Date().toISOString());
}

/** Get handoff history for an owner. */
function getHandoffHistory(ownerId: string): Array<{ recipientName: string; tier: string; initiatedBy: string; initiatedAt: string }> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT recipient_name, tier, initiated_by, initiated_at FROM handoff_log WHERE owner_id = ? ORDER BY id ASC',
  ).all(ownerId) as Array<{ recipient_name: string; tier: string; initiated_by: string; initiated_at: string }>;
  return rows.map((r) => ({ recipientName: r.recipient_name, tier: r.tier, initiatedBy: r.initiated_by, initiatedAt: r.initiated_at }));
}

export { buildHandoffPackage, logHandoff, getHandoffHistory };
export type { HandoffPackage };
