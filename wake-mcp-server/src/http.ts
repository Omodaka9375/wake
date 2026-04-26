import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { isInitializeRequest } from '@modelcontextprotocol/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import { loadState, saveState } from './store.js';
import { identifyCaller } from './auth.js';
import { checkAndAdvancePhase, msUntilVigil, canAccessData } from './state.js';
import { logAction, readAuditLog } from './audit.js';
import { listEntries, getCompiledEntries, getLockedCount, addEntry, deleteEntry, isReleased } from './knowledge.js';
import { buildHandoffPackage } from './handoff.js';
import { formatLegalExport, loadDeletionCertificate, generateDeletionCertificate, purgeOwnerData } from './legal.js';
import { generateToken, hashToken } from './crypto.js';
import { getDb } from './db.js';
import { fireEvent } from './webhooks.js';
import type { WakeState, TokenSet } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = resolve(__dirname, '..', 'dashboard');

/** Default HTTP port. */
const DEFAULT_PORT = 3000;

/** MIME types for static files. */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Active transports by session ID. */
const transports = new Map<string, NodeStreamableHTTPServerTransport>();

/** Start the HTTP server. */
function startHttpServer(server: McpServer, port: number = DEFAULT_PORT): void {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Dashboard API — simple REST wrapper for tool calls
    if (req.url === '/api/tool' && req.method === 'POST') {
      await handleApiToolCall(server, req, res);
      return;
    }

    // MCP endpoint
    if (req.url === '/mcp' && req.method === 'POST') {
      await handleMcpRequest(server, req, res);
      return;
    }

    // MCP session DELETE
    if (req.url === '/mcp' && req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        transports.delete(sessionId);
        await transport.close();
      }
      res.writeHead(200);
      res.end();
      return;
    }

    // Static dashboard files
    await serveStatic(req, res);
  });

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.error(`Port ${port} in use, trying ${nextPort}...`);
      httpServer.listen(nextPort, () => {
        console.error(`WAKE Dashboard: http://localhost:${nextPort}`);
        console.error(`MCP HTTP endpoint: http://localhost:${nextPort}/mcp`);
      });
    } else {
      console.error('HTTP server error:', err.message);
    }
  });

  httpServer.listen(port, () => {
    console.error(`WAKE Dashboard: http://localhost:${port}`);
    console.error(`MCP HTTP endpoint: http://localhost:${port}/mcp`);
  });
}

/** Handle MCP JSON-RPC over HTTP. */
async function handleMcpRequest(server: McpServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Read body
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res, body);
  } else if (!sessionId && isInitializeRequest(body)) {
    const transport: NodeStreamableHTTPServerTransport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => { transports.set(sid, transport); },
    });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } else {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid request. Initialize first or provide session ID.' }));
  }
}

/** Serve static files from dashboard/. */
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let filePath = req.url === '/' ? '/index.html' : req.url ?? '/index.html';
  // Strip query string
  filePath = filePath.split('?')[0];
  const fullPath = resolve(DASHBOARD_DIR, '.' + filePath);

  // Security: prevent path traversal
  if (!fullPath.startsWith(DASHBOARD_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(fullPath);
    const ext = extname(fullPath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

/** Dashboard REST API. POST /api/tool { tool, args } → { text } */
async function handleApiToolCall(_server: McpServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const { tool, args = {} } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    const ownerId = args.ownerId || 'default';

    let text = '';
    let error = false;

    // Route to appropriate handler
    switch (tool) {
      case 'configure_will': {
        const now = new Date().toISOString();
        const masterToken = generateToken();
        const verifierToken = generateToken();
        const beneficiaryTokens: Record<string, string> = {};
        const beneficiaryHashes: Record<string, string> = {};
        for (const b of (args.beneficiaries || [])) {
          const t = generateToken();
          beneficiaryTokens[b.name] = t;
          beneficiaryHashes[b.name] = hashToken(t);
        }
        const tokens: TokenSet = { masterHash: hashToken(masterToken), verifierHash: hashToken(verifierToken), beneficiaryHashes };
        const { token: _t, ownerId: _o, ...willFields } = args;
        const newState: WakeState = { will: willFields, tokens, phase: 'ACTIVE', lastHeartbeat: now, createdAt: now, updatedAt: now };
        await saveState(newState, ownerId);
        logAction('configure_will', 'owner', 'ACTIVE', true, `Dashboard: ${willFields.ownerName}`, ownerId);
        const lines = [
          `WAKE Will configured for ${willFields.ownerName}. Agent "${willFields.agentName}" is now ACTIVE.`,
          '', 'SAVE THESE TOKENS — they will not be shown again:', '',
          `Master token (owner): ${masterToken}`,
          `Verifier token (${willFields.verifierName}): ${verifierToken}`,
          '', 'Beneficiary tokens:',
          ...(args.beneficiaries || []).map((b: any) => `  ${b.name} (${b.tier}): ${beneficiaryTokens[b.name]}`),
        ];
        text = JSON.stringify({ message: lines.join('\n') });
        break;
      }
      case 'get_status': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ phase: 'UNCONFIGURED' }); break; }
        checkAndAdvancePhase(state);
        await saveState(state, ownerId);
        const caller = args.token ? identifyCaller(args.token, state) : null;
        const auth = caller && caller.role !== 'unknown';
        const status: Record<string, unknown> = { phase: state.phase, owner: state.will.ownerName, agent: state.will.agentName };
        if (auth) {
          status.lastHeartbeat = state.lastHeartbeat;
          status.beneficiaries = state.will.beneficiaries;
          status.terminalState = state.will.terminalState;
          status.gracePeriodDays = state.will.gracePeriodDays;
          status.inactivityThresholdHours = state.will.inactivityThresholdHours;
          if (state.phase === 'ACTIVE') status.vigilTriggersInHours = Math.round(msUntilVigil(state) / 3600000 * 10) / 10;
          if (state.vigilStarted) status.vigilStarted = state.vigilStarted;
          if (state.eulogyStarted) status.eulogyStarted = state.eulogyStarted;
          if (state.deathConfirmedBy) status.deathConfirmedBy = state.deathConfirmedBy;
          if (state.terminalExecutedAt) status.terminalExecutedAt = state.terminalExecutedAt;
          status.role = caller!.role;
          status.callerName = caller!.name;
          // Tier for beneficiary
          if (caller!.role === 'beneficiary') {
            const b = state.will.beneficiaries.find((x: any) => x.name === caller!.name);
            status.tier = b?.tier;
          }
        }
        text = JSON.stringify(status);
        break;
      }
      case 'get_access_tier': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        const caller = identifyCaller(args.token || '', state);
        if (caller.role === 'unknown') { text = JSON.stringify({ error: 'Invalid token' }); error = true; break; }
        const b = state.will.beneficiaries.find((x: any) => x.name === caller.name);
        text = JSON.stringify({ role: caller.role, name: caller.name, tier: b?.tier || caller.role });
        break;
      }
      case 'heartbeat': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        const caller = identifyCaller(args.token || '', state);
        if (caller.role !== 'owner') { text = JSON.stringify({ error: 'Unauthorized' }); error = true; break; }
        checkAndAdvancePhase(state);
        if (state.phase !== 'ACTIVE') { text = JSON.stringify({ error: `Phase ${state.phase}` }); error = true; break; }
        state.lastHeartbeat = new Date().toISOString();
        await saveState(state, ownerId);
        text = JSON.stringify({ ok: true, vigilInHours: Math.round(msUntilVigil(state) / 3600000 * 10) / 10 });
        break;
      }
      case 'get_black_box': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        const caller = identifyCaller(args.token || '', state);
        if (caller.role === 'unknown') { text = JSON.stringify({ error: 'Invalid token' }); error = true; break; }
        checkAndAdvancePhase(state);
        if (!canAccessData(state.phase)) { text = JSON.stringify({ error: 'Sealed', phase: state.phase }); error = true; break; }
        const tier = caller.role === 'owner' ? 'executor' : caller.role === 'verifier' ? 'beneficiary' :
          state.will.beneficiaries.find((x: any) => x.name === caller.name)?.tier ?? 'memorial';
        const entries = getCompiledEntries(ownerId, state.will.redactions, tier as any);
        const lockInfo = getLockedCount(ownerId);
        text = JSON.stringify({
          owner: state.will.ownerName, agent: state.will.agentName, tier, phase: state.phase,
          redactions: state.will.redactions, directives: state.will.operationalDirectives,
          beneficiaries: tier === 'executor' ? state.will.beneficiaries : undefined,
          entries: entries.map(e => ({ category: e.category, summary: e.summary, details: e.details })),
          terminalState: tier === 'executor' ? state.will.terminalState : undefined,
          gracePeriodDays: tier === 'executor' ? state.will.gracePeriodDays : undefined,
          lockedCount: lockInfo.locked,
        });
        break;
      }
      case 'get_final_message': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        const caller = identifyCaller(args.token || '', state);
        if (caller.role === 'unknown') { text = JSON.stringify({ error: 'Invalid token' }); error = true; break; }
        if (!canAccessData(state.phase)) { text = JSON.stringify({ error: 'Sealed' }); error = true; break; }
        const msg = state.will.finalMessages.find((m: any) => m.recipientName.toLowerCase().trim() === (args.recipientName || '').toLowerCase().trim());
        if (!msg) { text = JSON.stringify({ error: 'No message' }); break; }
        if (msg.releaseAfter && !isReleased(msg.releaseAfter)) { text = JSON.stringify({ timeLocked: true, releaseAfter: msg.releaseAfter }); break; }
        text = JSON.stringify({ from: state.will.ownerName, to: msg.recipientName, message: msg.message });
        break;
      }
      case 'trigger_vigil': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        const caller = identifyCaller(args.token || '', state);
        if (caller.role !== 'owner') { text = JSON.stringify({ error: 'Unauthorized' }); error = true; break; }
        if (state.phase !== 'ACTIVE') { text = JSON.stringify({ error: `Phase ${state.phase}` }); error = true; break; }
        state.phase = 'VIGIL'; state.vigilStarted = new Date().toISOString();
        await saveState(state, ownerId);
        logAction('trigger_vigil', caller.hashPrefix, 'VIGIL', true, 'Dashboard', ownerId);
        text = JSON.stringify({ ok: true, phase: 'VIGIL' });
        break;
      }
      case 'verify_death': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        const caller = identifyCaller(args.token || '', state);
        if (caller.role !== 'verifier') { text = JSON.stringify({ error: 'Not verifier' }); error = true; break; }
        if (state.phase !== 'VIGIL') { text = JSON.stringify({ error: `Phase ${state.phase}` }); error = true; break; }
        state.phase = 'EULOGY'; state.eulogyStarted = new Date().toISOString(); state.deathConfirmedBy = state.will.verifierName;
        await saveState(state, ownerId);
        logAction('verify_death', caller.hashPrefix, 'EULOGY', true, 'Dashboard', ownerId);
        await fireEvent('eulogy.started', state, ownerId, 'Dashboard verification');
        text = JSON.stringify({ ok: true, phase: 'EULOGY' });
        break;
      }
      case 'execute_terminal_state': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        const caller = identifyCaller(args.token || '', state);
        const isExec = caller.role === 'owner' || (caller.role === 'beneficiary' && state.will.beneficiaries.find((b: any) => b.name === caller.name)?.tier === 'executor');
        if (!isExec) { text = JSON.stringify({ error: 'Not executor' }); error = true; break; }
        if (state.phase !== 'EULOGY') { text = JSON.stringify({ error: `Phase ${state.phase}` }); error = true; break; }
        state.phase = 'REST'; state.terminalExecutedAt = new Date().toISOString();
        await saveState(state, ownerId);
        logAction('execute_terminal_state', caller.hashPrefix, 'REST', true, state.will.terminalState, ownerId);
        if (state.will.terminalState === 'delete') generateDeletionCertificate(state, ownerId);
        text = JSON.stringify({ ok: true, phase: 'REST', terminalState: state.will.terminalState });
        break;
      }
      case 'get_audit_log': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        const caller = identifyCaller(args.token || '', state);
        const isExec = caller.role === 'owner' || (caller.role === 'beneficiary' && state.will.beneficiaries.find((b: any) => b.name === caller.name)?.tier === 'executor');
        if (!isExec) { text = JSON.stringify({ error: 'Unauthorized' }); error = true; break; }
        text = JSON.stringify(readAuditLog(ownerId));
        break;
      }
      case 'list_knowledge': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        const caller = identifyCaller(args.token || '', state);
        if (caller.role !== 'owner') { text = JSON.stringify({ error: 'Unauthorized' }); error = true; break; }
        text = JSON.stringify(listEntries(ownerId, args.category));
        break;
      }
      case 'export_legal_will': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        text = JSON.stringify({ document: formatLegalExport(state, ownerId) });
        break;
      }
      case 'get_handoff_package': {
        const state = await loadState(ownerId);
        if (!state) { text = JSON.stringify({ error: 'No will' }); error = true; break; }
        const caller = identifyCaller(args.token || '', state);
        if (caller.role === 'unknown') { text = JSON.stringify({ error: 'Invalid token' }); error = true; break; }
        if (!canAccessData(state.phase)) { text = JSON.stringify({ error: 'Sealed' }); error = true; break; }
        const b = state.will.beneficiaries.find((x: any) => x.name === caller.name);
        const tier = caller.role === 'owner' ? 'executor' as const : b?.tier ?? 'memorial' as const;
        text = JSON.stringify(buildHandoffPackage(state, ownerId, caller.name, tier));
        break;
      }
      default:
        text = JSON.stringify({ error: `Unknown tool: ${tool}` });
        error = true;
    }

    res.writeHead(error ? 400 : 200, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }));
  }
}

export { startHttpServer, DEFAULT_PORT };
