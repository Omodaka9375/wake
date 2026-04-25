import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadState, saveState } from '../store.js';
import { identifyCaller } from '../auth.js';
import { logAction } from '../audit.js';
import { fireEvent } from '../webhooks.js';

function registerVerifyTool(server: McpServer): void {
  server.registerTool('verify_death', {
    description: 'Confirm the death event. Requires verifier token. Only in VIGIL phase.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    if (caller.role !== 'verifier') {
      logAction('verify_death', caller.hashPrefix, state.phase, false, 'Not verifier', ownerId);
      return { content: [{ type: 'text' as const, text: 'Unauthorized. Only the designated verifier can confirm death.' }], isError: true };
    }
    if (state.phase !== 'VIGIL') {
      logAction('verify_death', caller.hashPrefix, state.phase, false, `Phase ${state.phase}`, ownerId);
      return { content: [{ type: 'text' as const, text: `Verification only accepted during VIGIL. Current: ${state.phase}.` }], isError: true };
    }
    state.phase = 'EULOGY';
    state.eulogyStarted = new Date().toISOString();
    state.deathConfirmedBy = state.will.verifierName;
    await saveState(state, ownerId);
    logAction('verify_death', caller.hashPrefix, 'EULOGY', true, `Confirmed by ${state.will.verifierName}`, ownerId);
    await fireEvent('eulogy.started', state, ownerId, `Death confirmed by ${state.will.verifierName}`);
    const executors = state.will.beneficiaries.filter((b) => b.tier === 'executor').map((b) => b.name);
    return { content: [{ type: 'text' as const, text: [
      `Death confirmed. EULOGY phase initiated.`,
      `Executor access: ${executors.join(', ') || 'none'}.`,
      `Grace period: ${state.will.gracePeriodDays} days.`,
      `${state.will.finalMessages.length} final message(s) ready.`,
    ].join('\n') }] };
  });
}

export { registerVerifyTool };
