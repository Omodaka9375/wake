import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadState, saveState } from '../store.js';
import { identifyCaller } from '../auth.js';
import { logAction } from '../audit.js';
import { fireEvent } from '../webhooks.js';
import { generateDeletionCertificate } from '../legal.js';

function registerRestTool(server: McpServer): void {
  server.registerTool('execute_terminal_state', {
    description: 'Execute terminal state (archive/distill/delete). Requires executor token. Only in EULOGY.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    const isExec = caller.role === 'owner' || (caller.role === 'beneficiary' && state.will.beneficiaries.find((b) => b.name === caller.name)?.tier === 'executor');
    if (!isExec) {
      logAction('execute_terminal_state', caller.hashPrefix, state.phase, false, 'Not executor', ownerId);
      return { content: [{ type: 'text' as const, text: 'Unauthorized. Executor access required.' }], isError: true };
    }
    if (state.phase !== 'EULOGY') {
      logAction('execute_terminal_state', caller.hashPrefix, state.phase, false, `Phase ${state.phase}`, ownerId);
      return { content: [{ type: 'text' as const, text: `Terminal state only in EULOGY. Current: ${state.phase}.` }], isError: true };
    }
    state.phase = 'REST';
    state.terminalExecutedAt = new Date().toISOString();
    await saveState(state, ownerId);
    logAction('execute_terminal_state', caller.hashPrefix, 'REST', true, state.will.terminalState, ownerId);
    await fireEvent('rest.executed', state, ownerId, `Terminal state: ${state.will.terminalState}`);
    // Auto-generate deletion certificate if terminal state is delete
    if (state.will.terminalState === 'delete') {
      generateDeletionCertificate(state, ownerId);
    }
    const desc: Record<string, string> = {
      archive: `${state.will.agentName} has been fully preserved, encrypted and access-controlled.`,
      distill: `${state.will.agentName} has extracted structured knowledge. Raw memory purged.`,
      delete: `${state.will.agentName} has been permanently terminated. All data gone.`,
    };
    return { content: [{ type: 'text' as const, text: [
      `Terminal state: ${state.will.terminalState.toUpperCase()}`, '', desc[state.will.terminalState], '',
      `WAKE protocol complete. ${state.will.ownerName}'s wishes honored.`,
    ].join('\n') }] };
  });
}

export { registerRestTool };
