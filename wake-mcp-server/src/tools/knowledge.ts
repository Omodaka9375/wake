import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadState } from '../store.js';
import { identifyCaller } from '../auth.js';
import { logAction } from '../audit.js';
import { addEntry, listEntries, deleteEntry } from '../knowledge.js';
import { canModifyWill } from '../state.js';

function registerKnowledgeTools(server: McpServer): void {
  server.registerTool('contribute_knowledge', {
    description: 'Add a knowledge entry to the Black Box. Requires master token. Only in ACTIVE phase. Categories: finances, contacts, accounts, documents, decisions, commitments, medical, other.',
    inputSchema: z.object({
      token: z.string(),
      category: z.string().describe('Entry category (e.g. finances, contacts, documents).'),
      summary: z.string().describe('Brief summary of the knowledge.'),
      details: z.string().describe('Full details.'),
      memorialVisible: z.boolean().optional().describe('If true, visible to memorial-tier beneficiaries.'),
      releaseAfter: z.string().optional().describe('ISO date. Entry is sealed until this date.'),
      ownerId: z.string().optional(),
    }),
  }, async ({ token, category, summary, details, memorialVisible, releaseAfter, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    if (caller.role !== 'owner') {
      logAction('contribute_knowledge', caller.hashPrefix, state.phase, false, 'Unauthorized', ownerId);
      return { content: [{ type: 'text' as const, text: 'Unauthorized. Master token required.' }], isError: true };
    }
    if (!canModifyWill(state.phase)) {
      return { content: [{ type: 'text' as const, text: `Cannot add knowledge in ${state.phase} phase.` }], isError: true };
    }
    const id = addEntry(ownerId, category, summary, details, memorialVisible ?? false, releaseAfter);
    logAction('contribute_knowledge', caller.hashPrefix, state.phase, true, `Entry #${id}: ${category}`, ownerId);
    return { content: [{ type: 'text' as const, text: `Knowledge entry #${id} added. Category: ${category}. Summary: ${summary}` }] };
  });

  server.registerTool('list_knowledge', {
    description: 'List knowledge entries. Requires master token. Optional category filter.',
    inputSchema: z.object({
      token: z.string(),
      category: z.string().optional().describe('Filter by category.'),
      ownerId: z.string().optional(),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ token, category, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    if (caller.role !== 'owner') {
      return { content: [{ type: 'text' as const, text: 'Unauthorized. Master token required.' }], isError: true };
    }
    const entries = listEntries(ownerId, category);
    if (entries.length === 0) return { content: [{ type: 'text' as const, text: category ? `No entries in "${category}".` : 'No knowledge entries.' }] };
    const lines = entries.map((e) => `#${e.id} [${e.category}] ${e.summary}${e.memorialVisible ? ' 🕊' : ''}`);
    return { content: [{ type: 'text' as const, text: `${entries.length} entries:\n${lines.join('\n')}` }] };
  });

  server.registerTool('delete_knowledge', {
    description: 'Delete a knowledge entry. Requires master token. Only in ACTIVE phase.',
    inputSchema: z.object({
      token: z.string(),
      entryId: z.number().describe('Entry ID to delete.'),
      ownerId: z.string().optional(),
    }),
  }, async ({ token, entryId, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    if (caller.role !== 'owner') {
      return { content: [{ type: 'text' as const, text: 'Unauthorized. Master token required.' }], isError: true };
    }
    if (!canModifyWill(state.phase)) {
      return { content: [{ type: 'text' as const, text: `Cannot delete knowledge in ${state.phase} phase.` }], isError: true };
    }
    const deleted = deleteEntry(ownerId, entryId);
    if (!deleted) return { content: [{ type: 'text' as const, text: `Entry #${entryId} not found.` }], isError: true };
    logAction('delete_knowledge', caller.hashPrefix, state.phase, true, `Deleted #${entryId}`, ownerId);
    return { content: [{ type: 'text' as const, text: `Entry #${entryId} deleted.` }] };
  });
}

export { registerKnowledgeTools };
