import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { loadState, saveState } from '../store.js';
import { checkAndAdvancePhase, canModifyWill } from '../state.js';
import { generateToken, hashToken } from '../crypto.js';
import { identifyCaller } from '../auth.js';
import { logAction } from '../audit.js';
import type { WakeState, TokenSet } from '../types.js';

const beneficiarySchema = z.object({
  name: z.string(), tier: z.enum(['executor', 'beneficiary', 'memorial']), contact: z.string().optional(),
});
const finalMessageSchema = z.object({ recipientName: z.string(), message: z.string(), releaseAfter: z.string().optional() });
const webhookSchema = z.object({ url: z.string(), events: z.array(z.string()) });
const willInputSchema = z.object({
  ownerName: z.string(), agentName: z.string(), beneficiaries: z.array(beneficiarySchema),
  redactions: z.array(z.string()), operationalDirectives: z.array(z.string()),
  finalMessages: z.array(finalMessageSchema), terminalState: z.enum(['archive', 'distill', 'delete']),
  gracePeriodDays: z.number().min(1), inactivityThresholdHours: z.number().min(1), verifierName: z.string(),
  webhooks: z.array(webhookSchema).optional(),
  deadManSwitchDays: z.number().min(1).optional(),
  noResurrection: z.boolean().optional().describe('If true (default), the agent must not be used to simulate or impersonate the deceased.'),
  resurrectionExceptions: z.array(z.string()).optional().describe('Permitted uses if noResurrection is true (e.g., "memorial video for family").'),
  jurisdiction: z.string().optional().describe('Governing jurisdiction (e.g., "California, US" or "EU-France").'),
});

function registerConfigureTools(server: McpServer): void {
  server.registerTool('configure_will', {
    description: 'Create or replace the WAKE Will. Generates auth tokens. SAVE the returned tokens.',
    inputSchema: willInputSchema.extend({ ownerId: z.string().optional().describe('Owner ID for multi-user. Defaults to "default".') }),
  }, async (input) => {
    const { ownerId: rawOwnerId, ...willFields } = input;
    const ownerId = rawOwnerId || 'default';
    const now = new Date().toISOString();
    const masterToken = generateToken();
    const verifierToken = generateToken();
    const beneficiaryTokens: Record<string, string> = {};
    const beneficiaryHashes: Record<string, string> = {};
    for (const b of willFields.beneficiaries) {
      const t = generateToken();
      beneficiaryTokens[b.name] = t;
      beneficiaryHashes[b.name] = hashToken(t);
    }
    const tokens: TokenSet = { masterHash: hashToken(masterToken), verifierHash: hashToken(verifierToken), beneficiaryHashes };
    const state: WakeState = { will: willFields, tokens, phase: 'ACTIVE', lastHeartbeat: now, createdAt: now, updatedAt: now };
    await saveState(state, ownerId);
    logAction('configure_will', 'owner', 'ACTIVE', true, `Will configured for ${willFields.ownerName}`, ownerId);
    const lines = [
      `WAKE Will configured for ${willFields.ownerName}. Agent "${willFields.agentName}" is now ACTIVE.`,
      '', 'SAVE THESE TOKENS — they will not be shown again:', '',
      `Master token (owner): ${masterToken}`,
      `Verifier token (${willFields.verifierName}): ${verifierToken}`,
      '', 'Beneficiary tokens:',
      ...willFields.beneficiaries.map((b) => `  ${b.name} (${b.tier}): ${beneficiaryTokens[b.name]}`),
    ];
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  });

  server.registerTool('update_will', {
    description: 'Update fields of the WAKE Will. Requires master token. Only in ACTIVE phase.',
    inputSchema: willInputSchema.partial().extend({ token: z.string(), ownerId: z.string().optional() }),
  }, async (input) => {
    const { token, ownerId: rawOwnerId, ...fields } = input;
    const ownerId = rawOwnerId || 'default';
    const state = await loadState(ownerId);
    if (!state) return { content: [{ type: 'text' as const, text: 'No WAKE Will configured.' }], isError: true };
    const caller = identifyCaller(token ?? '', state);
    if (caller.role !== 'owner') {
      logAction('update_will', caller.hashPrefix, state.phase, false, 'Unauthorized', ownerId);
      return { content: [{ type: 'text' as const, text: 'Unauthorized. Master token required.' }], isError: true };
    }
    checkAndAdvancePhase(state);
    if (!canModifyWill(state.phase)) {
      logAction('update_will', caller.hashPrefix, state.phase, false, 'Will sealed', ownerId);
      return { content: [{ type: 'text' as const, text: `Cannot modify will in ${state.phase} phase.` }], isError: true };
    }
    Object.assign(state.will, fields);
    await saveState(state, ownerId);
    logAction('update_will', caller.hashPrefix, state.phase, true, `Fields: ${Object.keys(fields).join(', ')}`, ownerId);
    return { content: [{ type: 'text' as const, text: `WAKE Will updated. Modified: ${Object.keys(fields).join(', ')}.` }] };
  });
}

export { registerConfigureTools };
