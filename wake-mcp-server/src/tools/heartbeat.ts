import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadState, saveState } from '../store.js';
import { checkAndAdvancePhase, msUntilVigil } from '../state.js';
import { identifyCaller } from '../auth.js';
import { logAction } from '../audit.js';

function registerHeartbeatTool(server: McpServer): void {
  server.registerTool('heartbeat', {
    description: 'Signal the owner is alive. Requires master token.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    if (caller.role !== 'owner') {
      logAction('heartbeat', caller.hashPrefix, state.phase, false, 'Unauthorized', ownerId);
      return { content: [{ type: 'text' as const, text: 'Unauthorized. Master token required.' }], isError: true };
    }
    checkAndAdvancePhase(state);
    if (state.phase !== 'ACTIVE') {
      logAction('heartbeat', caller.hashPrefix, state.phase, false, `Phase ${state.phase}`, ownerId);
      return { content: [{ type: 'text' as const, text: `Protocol is in ${state.phase} phase. Heartbeat not accepted.` }], isError: true };
    }
    state.lastHeartbeat = new Date().toISOString();
    await saveState(state, ownerId);
    const hours = Math.round(msUntilVigil(state) / (60 * 60 * 1000) * 10) / 10;
    logAction('heartbeat', caller.hashPrefix, state.phase, true, `Next VIGIL in ${hours}h`, ownerId);
    return { content: [{ type: 'text' as const, text: `Heartbeat recorded. VIGIL triggers in ${hours}h.` }] };
  });
}

export { registerHeartbeatTool };
