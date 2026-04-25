import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadState } from '../store.js';
import { checkAndAdvancePhase, canAccessData } from '../state.js';
import { identifyCaller } from '../auth.js';
import { logAction, readAuditLog } from '../audit.js';
import { fireEvent } from '../webhooks.js';
import { getCompiledEntries, getLockedCount, isReleased } from '../knowledge.js';

function registerEulogyTools(server: McpServer): void {
  server.registerTool('get_access_tier', {
    description: 'Check access tier for a token holder.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    if (caller.role === 'unknown') return { content: [{ type: 'text' as const, text: 'Invalid token. Access denied.' }], isError: true };
    return { content: [{ type: 'text' as const, text: `${caller.name}: ${caller.role} access.` }] };
  });

  server.registerTool('get_final_message', {
    description: 'Retrieve a final message. Requires valid token. Only in EULOGY/REST.',
    inputSchema: z.object({ token: z.string(), recipientName: z.string(), ownerId: z.string().optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ token, recipientName, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    if (caller.role === 'unknown') {
      logAction('get_final_message', caller.hashPrefix, state.phase, false, 'Invalid token', ownerId);
      return { content: [{ type: 'text' as const, text: 'Invalid token.' }], isError: true };
    }
    checkAndAdvancePhase(state);
    if (!canAccessData(state.phase)) return { content: [{ type: 'text' as const, text: `Messages sealed until EULOGY. Current: ${state.phase}.` }], isError: true };
    const msg = state.will.finalMessages.find((m) => m.recipientName.toLowerCase().trim() === recipientName.toLowerCase().trim());
    if (!msg) return { content: [{ type: 'text' as const, text: `No message for "${recipientName}".` }] };
    if (msg.releaseAfter && !isReleased(msg.releaseAfter)) {
      return { content: [{ type: 'text' as const, text: `Message for "${recipientName}" is time-locked until ${msg.releaseAfter}.` }] };
    }
    logAction('get_final_message', caller.hashPrefix, state.phase, true, `To: ${recipientName}`, ownerId);
    await fireEvent('eulogy.message', state, ownerId, `Final message delivered to ${recipientName}`);
    return { content: [{ type: 'text' as const, text: `Final message from ${state.will.ownerName} to ${msg.recipientName}:\n\n"${msg.message}"` }] };
  });

  server.registerTool('get_black_box', {
    description: 'Retrieve the Black Box. Content scoped by caller tier. Only in EULOGY/REST.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    if (caller.role === 'unknown') {
      logAction('get_black_box', caller.hashPrefix, state.phase, false, 'Invalid token', ownerId);
      return { content: [{ type: 'text' as const, text: 'Invalid token. Access denied.' }], isError: true };
    }
    checkAndAdvancePhase(state);
    if (!canAccessData(state.phase)) return { content: [{ type: 'text' as const, text: `Black Box sealed until EULOGY. Current: ${state.phase}.` }], isError: true };
    const tier = caller.role === 'owner' ? 'executor' : caller.role === 'verifier' ? 'beneficiary' :
      state.will.beneficiaries.find((b) => b.name === caller.name)?.tier ?? 'memorial';
    const s: string[] = [`=== BLACK BOX — ${state.will.ownerName} ===`, `Prepared by: ${state.will.agentName}`, `Access tier: ${tier}`, `Phase: ${state.phase}`, ''];
    if (state.will.redactions.length > 0) s.push(`[REDACTED CATEGORIES: ${state.will.redactions.join(', ')}]`, '');
    if (tier === 'executor' || tier === 'beneficiary') {
      s.push('OPERATIONAL DIRECTIVES:');
      state.will.operationalDirectives.length > 0 ? state.will.operationalDirectives.forEach((d, i) => s.push(`  ${i + 1}. ${d}`)) : s.push('  None configured.');
      s.push('');
    }
    if (tier === 'executor') {
      s.push('ALL BENEFICIARIES:');
      state.will.beneficiaries.forEach((b) => s.push(`  - ${b.name} (${b.tier})${b.contact ? ` — ${b.contact}` : ''}`));
      s.push('', `TERMINAL STATE: ${state.will.terminalState}`, `GRACE PERIOD: ${state.will.gracePeriodDays} days`);
      if (state.eulogyStarted) {
        const days = Math.round((Date.now() - new Date(state.eulogyStarted).getTime()) / (24 * 60 * 60 * 1000));
        s.push(`GRACE REMAINING: ${Math.max(0, state.will.gracePeriodDays - days)} days`);
      }
      s.push('');
    }
    if (tier === 'memorial') s.push(`Memorial-tier view. You have access to final messages addressed to you and curated memories from ${state.will.ownerName}.`, '');

    // Compiled knowledge entries
    const entries = getCompiledEntries(ownerId, state.will.redactions, tier as 'executor' | 'beneficiary' | 'memorial');
    if (entries.length > 0) {
      s.push('KNOWLEDGE ENTRIES:');
      for (const e of entries) {
        s.push(`  [${e.category}] ${e.summary}`);
        s.push(`    ${e.details}`);
      }
      s.push('');
    } else {
      s.push('KNOWLEDGE ENTRIES: None available for your tier.', '');
    }

    const lockInfo = getLockedCount(ownerId);
    if (lockInfo.locked > 0) {
      s.push(`TIME-LOCKED: ${lockInfo.locked} entry/entries sealed until their scheduled release dates.`, '');
    }
    logAction('get_black_box', caller.hashPrefix, state.phase, true, `Tier: ${tier}, ${entries.length} entries`, ownerId);
    return { content: [{ type: 'text' as const, text: s.join('\n') }] };
  });

  server.registerTool('get_audit_log', {
    description: 'Retrieve the audit log. Executor-only.',
    inputSchema: z.object({ token: z.string(), ownerId: z.string().optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ token, ownerId: rid }) => {
    const ownerId = rid || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token, state);
    const isExec = caller.role === 'owner' || (caller.role === 'beneficiary' && state.will.beneficiaries.find((b) => b.name === caller.name)?.tier === 'executor');
    if (!isExec) return { content: [{ type: 'text' as const, text: 'Unauthorized. Executor access required.' }], isError: true };
    const entries = readAuditLog(ownerId);
    if (entries.length === 0) return { content: [{ type: 'text' as const, text: 'Audit log is empty.' }] };
    const lines = entries.map((e) => `[${e.timestamp}] ${e.action} by ${e.caller} (${e.phase}) ${e.success ? '✓' : '✗'} ${e.detail}`);
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  });
}

export { registerEulogyTools };
