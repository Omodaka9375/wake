import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadState, saveState } from '../store.js';
import { checkAndAdvancePhase, msUntilVigil } from '../state.js';
import { identifyCaller } from '../auth.js';
import { logAction } from '../audit.js';

function registerVigilTools(server: McpServer): void {
  server.registerTool('get_status', {
    description: 'Get current WAKE protocol status. Optional token for details.',
    inputSchema: z.object({ token: z.string().optional(), ownerId: z.string().optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }] };
    checkAndAdvancePhase(state);
    await saveState(state, ownerId);
    const caller = token ? identifyCaller(token, state) : null;
    const auth = caller && caller.role !== 'unknown';
    const lines = [`Phase: ${state.phase}`, `Owner: ${state.will.ownerName}`, `Agent: ${state.will.agentName}`];
    if (auth) {
      lines.push(`Last heartbeat: ${state.lastHeartbeat}`);
      if (state.phase === 'ACTIVE') lines.push(`VIGIL triggers in: ${Math.round(msUntilVigil(state) / (60 * 60 * 1000) * 10) / 10}h`);
      if (state.vigilStarted) lines.push(`VIGIL started: ${state.vigilStarted}`);
      if (state.eulogyStarted) lines.push(`EULOGY started: ${state.eulogyStarted}`);
      if (state.deathConfirmedBy) lines.push(`Death confirmed by: ${state.deathConfirmedBy}`);
      if (state.terminalExecutedAt) lines.push(`Terminal state executed: ${state.terminalExecutedAt}`);
      lines.push(`Beneficiaries: ${state.will.beneficiaries.map((b) => `${b.name} (${b.tier})`).join(', ')}`);
      lines.push(`Terminal state: ${state.will.terminalState}`);
    } else {
      lines.push('(Provide a valid token for detailed status)');
    }
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  });

  server.registerTool('trigger_vigil', {
    description: 'Manually force VIGIL phase. Requires master token.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    if (caller.role !== 'owner') {
      logAction('trigger_vigil', caller.hashPrefix, state.phase, false, 'Unauthorized', ownerId);
      return { content: [{ type: 'text' as const, text: 'Unauthorized. Master token required.' }], isError: true };
    }
    if (state.phase !== 'ACTIVE') {
      logAction('trigger_vigil', caller.hashPrefix, state.phase, false, `Phase ${state.phase}`, ownerId);
      return { content: [{ type: 'text' as const, text: `Cannot trigger VIGIL from ${state.phase} phase.` }], isError: true };
    }
    state.phase = 'VIGIL';
    state.vigilStarted = new Date().toISOString();
    await saveState(state, ownerId);
    logAction('trigger_vigil', caller.hashPrefix, 'VIGIL', true, 'Manual trigger', ownerId);
    return { content: [{ type: 'text' as const, text: `VIGIL phase activated. Awaiting verification from: ${state.will.verifierName}.` }] };
  });
}

export { registerVigilTools };
