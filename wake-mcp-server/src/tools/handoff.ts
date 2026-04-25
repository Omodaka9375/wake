import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadState } from '../store.js';
import { canAccessData } from '../state.js';
import { identifyCaller } from '../auth.js';
import { logAction } from '../audit.js';
import { buildHandoffPackage, logHandoff } from '../handoff.js';

function registerHandoffTools(server: McpServer): void {
  server.registerTool('initiate_handoff', {
    description: 'Initiate an agent-to-agent handoff for a beneficiary. Returns a structured JSON package. Executor-only. EULOGY/REST only.',
    inputSchema: z.object({
      token: z.string().describe('Executor authentication token.'),
      recipientName: z.string().describe('Name of the beneficiary to generate a handoff package for.'),
      ownerId: z.string().optional(),
    }),
  }, async ({ token, recipientName, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };

    const caller = identifyCaller(token, state);
    const isExec = caller.role === 'owner' || (caller.role === 'beneficiary' && state.will.beneficiaries.find((b) => b.name === caller.name)?.tier === 'executor');
    if (!isExec) {
      logAction('initiate_handoff', caller.hashPrefix, state.phase, false, 'Not executor', ownerId);
      return { content: [{ type: 'text' as const, text: 'Unauthorized. Executor access required.' }], isError: true };
    }

    if (!canAccessData(state.phase)) {
      return { content: [{ type: 'text' as const, text: `Handoff only available in EULOGY/REST. Current: ${state.phase}.` }], isError: true };
    }

    const beneficiary = state.will.beneficiaries.find((b) => b.name.toLowerCase().trim() === recipientName.toLowerCase().trim());
    if (!beneficiary) {
      return { content: [{ type: 'text' as const, text: `"${recipientName}" is not a registered beneficiary.` }], isError: true };
    }

    const pkg = buildHandoffPackage(state, ownerId, beneficiary.name, beneficiary.tier);
    logHandoff(ownerId, beneficiary.name, beneficiary.tier, caller.name);
    logAction('initiate_handoff', caller.hashPrefix, state.phase, true, `Handoff to ${beneficiary.name} (${beneficiary.tier})`, ownerId);

    return { content: [{ type: 'text' as const, text: JSON.stringify(pkg, null, 2) }] };
  });

  server.registerTool('get_handoff_package', {
    description: 'Retrieve your own handoff package. Requires your beneficiary token. EULOGY/REST only. Returns structured JSON for agent ingestion.',
    inputSchema: z.object({
      token: z.string().describe('Your beneficiary authentication token.'),
      ownerId: z.string().optional(),
    }),
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };

    const caller = identifyCaller(token, state);
    if (caller.role === 'unknown') {
      return { content: [{ type: 'text' as const, text: 'Invalid token.' }], isError: true };
    }

    if (!canAccessData(state.phase)) {
      return { content: [{ type: 'text' as const, text: `Handoff only available in EULOGY/REST. Current: ${state.phase}.` }], isError: true };
    }

    // Determine tier
    const beneficiary = state.will.beneficiaries.find((b) => b.name === caller.name);
    const tier = caller.role === 'owner' ? 'executor' as const : caller.role === 'verifier' ? 'beneficiary' as const : beneficiary?.tier ?? 'memorial' as const;

    const pkg = buildHandoffPackage(state, ownerId, caller.name, tier);
    logHandoff(ownerId, caller.name, tier, caller.name);
    logAction('get_handoff_package', caller.hashPrefix, state.phase, true, `Self-serve handoff (${tier})`, ownerId);

    return { content: [{ type: 'text' as const, text: JSON.stringify(pkg, null, 2) }] };
  });
}

export { registerHandoffTools };
