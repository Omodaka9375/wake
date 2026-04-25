import type { McpServer } from '@modelcontextprotocol/server';
import { loadState, saveState } from '../store.js';
import { checkAndAdvancePhase } from '../state.js';

function registerResources(server: McpServer): void {
  server.registerResource('wake-status', 'wake://status', {
    title: 'WAKE Protocol Status',
    description: 'Public status: phase and owner/agent names (default owner).',
    mimeType: 'application/json',
  }, async (uri) => {
    const state = await loadState();
    if (!state) return { contents: [{ uri: uri.href, text: '{"phase":"UNCONFIGURED"}' }] };
    checkAndAdvancePhase(state);
    await saveState(state);
    const status = { phase: state.phase, owner: state.will.ownerName, agent: state.will.agentName };
    return { contents: [{ uri: uri.href, text: JSON.stringify(status, null, 2) }] };
  });
}

export { registerResources };
