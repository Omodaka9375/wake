import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadState } from '../store.js';
import { identifyCaller } from '../auth.js';
import { logAction } from '../audit.js';
import { formatLegalExport, loadDeletionCertificate, generateDeletionCertificate, purgeOwnerData } from '../legal.js';

function registerLegalTools(server: McpServer): void {
  server.registerTool('export_legal_will', {
    description: 'Generate a RUFADAA-compatible, human-readable legal export of the WAKE Will. Can be printed and attached to a traditional estate plan. Executor-only.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    const isExec = caller.role === 'owner' || (caller.role === 'beneficiary' && state.will.beneficiaries.find((b) => b.name === caller.name)?.tier === 'executor');
    if (!isExec) return { content: [{ type: 'text' as const, text: 'Unauthorized. Executor access required.' }], isError: true };
    const doc = formatLegalExport(state, ownerId);
    logAction('export_legal_will', caller.hashPrefix, state.phase, true, 'Legal export generated', ownerId);
    return { content: [{ type: 'text' as const, text: doc }] };
  });

  server.registerTool('get_deletion_certificate', {
    description: 'Retrieve the deletion certificate for an owner whose data has been purged. Available after purge_owner_data is executed.',
    inputSchema: z.object({ ownerId: z.string().optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ ownerId: rid }) => {
    const ownerId = rid || 'default';
    const cert = loadDeletionCertificate(ownerId);
    if (!cert) return { content: [{ type: 'text' as const, text: `No deletion certificate found for owner "${ownerId}".` }] };
    return { content: [{ type: 'text' as const, text: JSON.stringify(cert, null, 2) }] };
  });

  server.registerTool('purge_owner_data', {
    description: 'Permanently delete ALL data for an owner. Generates a deletion certificate first. Executor-only, REST phase only. IRREVERSIBLE.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    const isExec = caller.role === 'owner' || (caller.role === 'beneficiary' && state.will.beneficiaries.find((b) => b.name === caller.name)?.tier === 'executor');
    if (!isExec) return { content: [{ type: 'text' as const, text: 'Unauthorized. Executor access required.' }], isError: true };
    if (state.phase !== 'REST') return { content: [{ type: 'text' as const, text: `Purge only available in REST phase. Current: ${state.phase}.` }], isError: true };

    // Generate certificate before purging
    const cert = generateDeletionCertificate(state, ownerId);
    // Purge everything
    purgeOwnerData(ownerId);

    return { content: [{ type: 'text' as const, text: [
      `ALL DATA PURGED for owner "${ownerId}".`,
      '',
      `Deletion certificate generated and saved.`,
      `Certificate hash: ${cert.stateHashBeforeDeletion}`,
      `No-resurrection: ${cert.noResurrection ? 'ACTIVE' : 'INACTIVE'}`,
      '',
      `This action is irreversible. The deletion certificate is the sole remaining record.`,
    ].join('\n') }] };
  });
}

export { registerLegalTools };
