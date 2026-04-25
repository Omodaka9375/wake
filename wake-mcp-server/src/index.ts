#!/usr/bin/env node

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import { getDb } from './db.js';
import { startMonitor } from './monitor.js';
import { startHttpServer } from './http.js';
import { registerConfigureTools } from './tools/configure.js';
import { registerHeartbeatTool } from './tools/heartbeat.js';
import { registerVigilTools } from './tools/vigil.js';
import { registerVerifyTool } from './tools/verify.js';
import { registerEulogyTools } from './tools/eulogy.js';
import { registerRestTool } from './tools/rest.js';
import { registerBackupTools } from './tools/backup.js';
import { registerKnowledgeTools } from './tools/knowledge.js';
import { registerHandoffTools } from './tools/handoff.js';
import { registerLegalTools } from './tools/legal.js';
import { registerResources } from './resources/index.js';

// Initialize database on import
getDb();

const server = new McpServer(
  { name: 'wake-protocol', version: '2.0.0' },
  {
    instructions: [
      'WAKE — Will-Aware Knowledge Execution.',
      'A post-mortem protocol for AI agents.',
      '',
      'AUTHENTICATION: Most tools require a token parameter.',
      'Tokens are generated once during configure_will.',
      'Multi-user: pass ownerId to scope operations.',
      '',
      'Phases: ACTIVE → VIGIL → EULOGY → REST.',
    ].join('\n'),
  },
);

registerConfigureTools(server);
registerHeartbeatTool(server);
registerVigilTools(server);
registerVerifyTool(server);
registerEulogyTools(server);
registerRestTool(server);
registerBackupTools(server);
registerKnowledgeTools(server);
registerHandoffTools(server);
registerLegalTools(server);
registerResources(server);

const httpOnly = process.argv.includes('--http');
const dashboardPort = parseInt(process.env.WAKE_PORT || '3000', 10);

async function main(): Promise<void> {
  startMonitor();

  // Always start the HTTP dashboard
  startHttpServer(server, dashboardPort);

  // Also connect stdio unless --http only mode
  if (!httpOnly) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('WAKE MCP Server v2.0.0 running on stdio + dashboard');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
