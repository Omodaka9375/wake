/**
 * WAKE MCP Server — Integration Test (Phase 2: SQLite + Multi-user + Backup)
 * Run: node build/test.js
 */

import { Client, StdioClientTransport } from '@modelcontextprotocol/client';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'index.js');
const DATA_DIR = resolve(__dirname, '..', 'data');

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  return (result.content as Array<{ type: string; text: string }>).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

function parseTokens(text: string): { master: string; verifier: string; beneficiaries: Record<string, string> } {
  const masterMatch = text.match(/Master token \(owner\): ([0-9a-f]{64})/);
  const verifierMatch = text.match(/Verifier token \([^)]+\): ([0-9a-f]{64})/);
  const beneficiaries: Record<string, string> = {};
  const benSection = text.split('Beneficiary tokens:')[1] ?? '';
  const benRegex = /^\s+(.+?) \([^)]+\): ([0-9a-f]{64})$/gm;
  let m: RegExpExecArray | null;
  while ((m = benRegex.exec(benSection)) !== null) beneficiaries[m[1]] = m[2];
  return { master: masterMatch?.[1] ?? '', verifier: verifierMatch?.[1] ?? '', beneficiaries };
}

const WILL_INPUT = {
  ownerName: 'Alex Chen', agentName: 'ARIA',
  beneficiaries: [
    { name: 'Jordan Chen', tier: 'executor' as const },
    { name: 'Sam Chen', tier: 'beneficiary' as const },
    { name: 'Riley Chen', tier: 'memorial' as const },
  ],
  redactions: ['Medical conversations', 'Therapy & mental health'],
  operationalDirectives: ['Continue paying rent for 90 days', 'Cancel streaming subscriptions'],
  finalMessages: [
    { recipientName: 'Jordan Chen', message: 'Take care of everyone. I love you.' },
    { recipientName: 'Riley Chen', message: 'Be brave. I am so proud of you.' },
  ],
  terminalState: 'distill' as const, gracePeriodDays: 90, inactivityThresholdHours: 1, verifierName: 'Jordan Chen',
};

async function main(): Promise<void> {
  try { await rm(DATA_DIR, { recursive: true }); } catch { /* ignore */ }

  console.log('Starting WAKE MCP Server v2 (SQLite)...');
  const transport = new StdioClientTransport({ command: 'node', args: [SERVER_PATH] });
  const client = new Client({ name: 'wake-test', version: '1.0.0' });
  await client.connect(transport);
  console.log('Connected.\n');

  // ── 1. Configure will (default owner) ──
  console.log('1. Configure will (default owner)');
  const configText = await callTool(client, 'configure_will', WILL_INPUT);
  const tokens = parseTokens(configText);
  assert(tokens.master.length === 64, 'Master token generated');
  assert(tokens.verifier.length === 64, 'Verifier token generated');
  assert(Object.keys(tokens.beneficiaries).length === 3, '3 beneficiary tokens');

  // ── 2. Knowledge ingestion (ACTIVE phase) ──
  console.log('\n2. Knowledge ingestion');
  const k1 = await callTool(client, 'contribute_knowledge', { token: tokens.master, category: 'finances', summary: 'Bank account at First National', details: 'Account #1234, routing #5678. Auto-pay rent.' });
  assert(k1.includes('entry #') && k1.includes('finances'), 'Finance entry added');
  const k2 = await callTool(client, 'contribute_knowledge', { token: tokens.master, category: 'contacts', summary: 'Lawyer: Jane Doe', details: 'jane@lawfirm.com, handles estate.' });
  assert(k2.includes('contacts'), 'Contact entry added');
  const k3 = await callTool(client, 'contribute_knowledge', { token: tokens.master, category: 'medical', summary: 'Dr. Smith records', details: 'Annual checkup files at clinic.' });
  assert(k3.includes('medical'), 'Medical entry added (will be redacted)');
  const k4 = await callTool(client, 'contribute_knowledge', { token: tokens.master, category: 'documents', summary: 'Family photo archive', details: 'NAS at home, folder /photos/family.', memorialVisible: true });
  assert(k4.includes('documents'), 'Memorial-visible entry added');

  const kList = await callTool(client, 'list_knowledge', { token: tokens.master });
  assert(kList.includes('4 entries'), '4 entries listed');

  // ── 3. Protocol lifecycle ──
  console.log('\n3. Heartbeat');
  assert((await callTool(client, 'heartbeat', { token: tokens.master })).includes('Heartbeat recorded'), 'Heartbeat OK');

  console.log('\n4. Auth checks');
  assert((await callTool(client, 'heartbeat', { token: 'bad' })).includes('Unauthorized'), 'Bad token rejected');
  assert((await callTool(client, 'get_status', { token: tokens.master })).includes('VIGIL triggers in'), 'Authed status detailed');
  assert((await callTool(client, 'get_status', {})).includes('Provide a valid token'), 'Public status limited');

  console.log('\n5. VIGIL → EULOGY → REST');
  assert((await callTool(client, 'trigger_vigil', { token: tokens.master })).includes('VIGIL phase activated'), 'VIGIL');
  assert((await callTool(client, 'verify_death', { token: tokens.verifier })).includes('EULOGY phase initiated'), 'EULOGY');
  assert((await callTool(client, 'get_final_message', { token: tokens.beneficiaries['Jordan Chen'], recipientName: 'Jordan Chen' })).includes('Take care of everyone'), 'Final message');

  const exBox = await callTool(client, 'get_black_box', { token: tokens.beneficiaries['Jordan Chen'] });
  assert(exBox.includes('ALL BENEFICIARIES') && exBox.includes('TERMINAL STATE: distill'), 'Executor Black Box');
  assert(exBox.includes('KNOWLEDGE ENTRIES'), 'Black Box has knowledge section');
  assert(exBox.includes('Bank account at First National'), 'Executor sees finance entry');
  assert(exBox.includes('Lawyer: Jane Doe'), 'Executor sees contact entry');
  assert(!exBox.includes('Dr. Smith'), 'Medical entry redacted from executor');
  assert(exBox.includes('Family photo archive'), 'Executor sees memorial-visible entry');

  const memBox = await callTool(client, 'get_black_box', { token: tokens.beneficiaries['Riley Chen'] });
  assert(memBox.includes('memorial') && !memBox.includes('ALL BENEFICIARIES'), 'Memorial Black Box limited');
  assert(memBox.includes('Family photo archive'), 'Memorial sees memorial-visible entry');
  assert(!memBox.includes('Bank account'), 'Memorial does not see finance entry');

  assert((await callTool(client, 'execute_terminal_state', { token: tokens.beneficiaries['Jordan Chen'] })).includes('DISTILL'), 'Terminal state');
  assert((await callTool(client, 'get_status', { token: tokens.master })).includes('Phase: REST'), 'Phase REST');

  // ── 5. Audit log ──
  console.log('\n5. Audit log');
  const audit = await callTool(client, 'get_audit_log', { token: tokens.beneficiaries['Jordan Chen'] });
  assert(audit.includes('configure_will') && audit.includes('verify_death'), 'Audit log populated');

  // ── 6. Backup & Restore ──
  console.log('\n6. Backup & restore');
  // Heartbeat twice to generate backups (each saveState creates one)
  // We already have backups from the protocol lifecycle
  const backups = await callTool(client, 'list_backups', { token: tokens.beneficiaries['Jordan Chen'] });
  assert(backups.includes('backup(s)'), 'Backups exist');

  const exported = await callTool(client, 'export_will', { token: tokens.beneficiaries['Jordan Chen'] });
  assert(exported.includes('encrypted'), 'Export returns encrypted blob');

  // ── 7. Multi-user: second owner ──
  console.log('\n7. Multi-user');
  const config2 = await callTool(client, 'configure_will', {
    ...WILL_INPUT,
    ownerName: 'Bob Smith',
    agentName: 'ZEUS',
    verifierName: 'Alice Smith',
    beneficiaries: [{ name: 'Alice Smith', tier: 'executor' }],
    finalMessages: [],
    ownerId: 'bob',
  });
  const tokens2 = parseTokens(config2);
  assert(tokens2.master.length === 64, 'Second owner master token');

  const status2 = await callTool(client, 'get_status', { token: tokens2.master, ownerId: 'bob' });
  assert(status2.includes('Bob Smith') && status2.includes('ZEUS'), 'Second owner status correct');

  // Verify first owner still works independently
  const status1 = await callTool(client, 'get_status', { token: tokens.master });
  assert(status1.includes('Alex Chen') && status1.includes('REST'), 'First owner still in REST');

  // Second owner heartbeat
  const hb2 = await callTool(client, 'heartbeat', { token: tokens2.master, ownerId: 'bob' });
  assert(hb2.includes('Heartbeat recorded'), 'Second owner heartbeat works');

  // Cross-owner rejection: first owner token on second owner
  const cross = await callTool(client, 'heartbeat', { token: tokens.master, ownerId: 'bob' });
  assert(cross.includes('Unauthorized'), 'Cross-owner token rejected');

  // ── 8. Import will ──
  console.log('\n8. Import will');
  const importResult = await callTool(client, 'import_will', { blob: exported, ownerId: 'imported' });
  assert(importResult.includes('imported'), 'Import succeeded');

  // ── 9. Dead man's switch ──
  console.log('\n9. Dead man\'s switch');
  // Configure a will with dead man's switch and very short inactivity
  const dmsConfig = await callTool(client, 'configure_will', {
    ...WILL_INPUT,
    ownerName: 'Charlie DMS',
    agentName: 'SENTINEL',
    verifierName: 'Dana DMS',
    beneficiaries: [{ name: 'Dana DMS', tier: 'executor' }],
    finalMessages: [],
    inactivityThresholdHours: 1,
    deadManSwitchDays: 1,
    webhooks: [{ url: 'http://localhost:19999/hook', events: ['vigil.triggered', 'eulogy.started'] }],
    ownerId: 'dms-test',
  });
  const dmsTokens = parseTokens(dmsConfig);
  assert(dmsTokens.master.length === 64, 'DMS will configured');

  // Manually trigger vigil
  const dmsVigil = await callTool(client, 'trigger_vigil', { token: dmsTokens.master, ownerId: 'dms-test' });
  assert(dmsVigil.includes('VIGIL phase activated'), 'DMS VIGIL activated');

  // Verify status shows VIGIL
  const dmsStatus = await callTool(client, 'get_status', { token: dmsTokens.master, ownerId: 'dms-test' });
  assert(dmsStatus.includes('Phase: VIGIL'), 'DMS in VIGIL');

  // ── 10. Inter-agent handoff ──
  console.log('\n10. Inter-agent handoff');
  // Use the default owner which is in REST phase with knowledge entries
  // Executor initiates handoff for memorial beneficiary
  const handoff1 = await callTool(client, 'initiate_handoff', { token: tokens.beneficiaries['Jordan Chen'], recipientName: 'Riley Chen' });
  assert(handoff1.includes('wake-handoff-v1'), 'Handoff package has schema version');
  assert(handoff1.includes('Riley Chen'), 'Package addressed to Riley');
  assert(handoff1.includes('memorial'), 'Package shows memorial tier');
  assert(handoff1.includes('Family photo archive'), 'Memorial handoff includes memorial-visible entry');
  assert(!handoff1.includes('Bank account'), 'Memorial handoff excludes finance entry');

  // Executor handoff for beneficiary tier
  const handoff2 = await callTool(client, 'initiate_handoff', { token: tokens.beneficiaries['Jordan Chen'], recipientName: 'Sam Chen' });
  assert(handoff2.includes('Sam Chen') && handoff2.includes('beneficiary'), 'Beneficiary handoff correct tier');
  assert(handoff2.includes('Bank account'), 'Beneficiary handoff includes finance entry');

  // Self-serve: beneficiary retrieves own package
  const selfHandoff = await callTool(client, 'get_handoff_package', { token: tokens.beneficiaries['Riley Chen'] });
  assert(selfHandoff.includes('wake-handoff-v1') && selfHandoff.includes('Riley Chen'), 'Self-serve handoff works');

  // Handoff rejected in wrong phase (use bob who is ACTIVE)
  const badHandoff = await callTool(client, 'initiate_handoff', { token: tokens2.master, recipientName: 'Alice Smith', ownerId: 'bob' });
  assert(badHandoff.includes('EULOGY/REST'), 'Handoff rejected in ACTIVE phase');

  // ── 11. Time-locks ──
  console.log('\n11. Time-locks');
  // Configure a will with a time-locked message (future) and an already-released message (past)
  const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year from now
  const pastDate = new Date(Date.now() - 1000).toISOString(); // 1 second ago
  const tlConfig = await callTool(client, 'configure_will', {
    ...WILL_INPUT,
    ownerName: 'Eve Timelock',
    agentName: 'CHRONO',
    verifierName: 'Frank TL',
    beneficiaries: [{ name: 'Frank TL', tier: 'executor' }, { name: 'Grace TL', tier: 'memorial' }],
    finalMessages: [
      { recipientName: 'Frank TL', message: 'This is immediate.' },
      { recipientName: 'Grace TL', message: 'Open when you turn 18.', releaseAfter: futureDate },
    ],
    ownerId: 'timelock-test',
  });
  const tlTokens = parseTokens(tlConfig);

  // Add a time-locked knowledge entry (future) and a released one (past)
  await callTool(client, 'contribute_knowledge', { token: tlTokens.master, category: 'documents', summary: 'Time capsule letter', details: 'Hidden until future.', releaseAfter: futureDate, memorialVisible: true, ownerId: 'timelock-test' });
  await callTool(client, 'contribute_knowledge', { token: tlTokens.master, category: 'documents', summary: 'Already released note', details: 'Available now.', releaseAfter: pastDate, memorialVisible: true, ownerId: 'timelock-test' });
  await callTool(client, 'contribute_knowledge', { token: tlTokens.master, category: 'finances', summary: 'No lock entry', details: 'Always visible.', ownerId: 'timelock-test' });

  // Walk through to EULOGY
  await callTool(client, 'trigger_vigil', { token: tlTokens.master, ownerId: 'timelock-test' });
  await callTool(client, 'verify_death', { token: tlTokens.verifier, ownerId: 'timelock-test' });

  // Test time-locked message
  const lockedMsg = await callTool(client, 'get_final_message', { token: tlTokens.beneficiaries['Grace TL'], recipientName: 'Grace TL', ownerId: 'timelock-test' });
  assert(lockedMsg.includes('time-locked'), 'Future message is sealed');

  // Immediate message works
  const immediateMsg = await callTool(client, 'get_final_message', { token: tlTokens.beneficiaries['Frank TL'], recipientName: 'Frank TL', ownerId: 'timelock-test' });
  assert(immediateMsg.includes('This is immediate'), 'Immediate message delivered');

  // Black Box: locked entry hidden, released entry visible
  const tlBox = await callTool(client, 'get_black_box', { token: tlTokens.beneficiaries['Frank TL'], ownerId: 'timelock-test' });
  assert(tlBox.includes('Already released note'), 'Released entry visible in Black Box');
  assert(tlBox.includes('No lock entry'), 'No-lock entry visible');
  assert(!tlBox.includes('Time capsule letter'), 'Future-locked entry hidden from Black Box');
  assert(tlBox.includes('TIME-LOCKED'), 'Black Box shows time-lock notice');

  // Memorial sees released memorial entry but not locked one
  const tlMemBox = await callTool(client, 'get_black_box', { token: tlTokens.beneficiaries['Grace TL'], ownerId: 'timelock-test' });
  assert(tlMemBox.includes('Already released note'), 'Memorial sees released entry');
  assert(!tlMemBox.includes('Time capsule letter'), 'Memorial cannot see locked entry');

  // ── 12. Legal compliance ──
  console.log('\n12. Legal compliance');
  // Configure a will with legal fields
  const legalConfig = await callTool(client, 'configure_will', {
    ...WILL_INPUT,
    ownerName: 'Hana Legal',
    agentName: 'SCALES',
    verifierName: 'Ivan Legal',
    beneficiaries: [{ name: 'Ivan Legal', tier: 'executor' }],
    finalMessages: [],
    terminalState: 'delete',
    noResurrection: true,
    resurrectionExceptions: ['Memorial video for family only'],
    jurisdiction: 'California, US',
    ownerId: 'legal-test',
  });
  const legalTokens = parseTokens(legalConfig);
  assert(legalTokens.master.length === 64, 'Legal will configured');

  // Legal export
  const legalExport = await callTool(client, 'export_legal_will', { token: legalTokens.beneficiaries['Ivan Legal'], ownerId: 'legal-test' });
  assert(legalExport.includes('SUCCESSION INSTRUMENT'), 'Legal export has header');
  assert(legalExport.includes('RUFADAA'), 'Legal export references RUFADAA');
  assert(legalExport.includes('California'), 'Legal export shows jurisdiction');
  assert(legalExport.includes('NO-RESURRECTION'), 'Legal export has no-resurrection section');
  assert(legalExport.includes('Memorial video'), 'Legal export shows resurrection exceptions');
  assert(legalExport.includes('CA Civil Code'), 'Legal export lists applicable CA law');

  // Walk to REST with delete terminal state
  await callTool(client, 'trigger_vigil', { token: legalTokens.master, ownerId: 'legal-test' });
  await callTool(client, 'verify_death', { token: legalTokens.verifier, ownerId: 'legal-test' });
  await callTool(client, 'execute_terminal_state', { token: legalTokens.beneficiaries['Ivan Legal'], ownerId: 'legal-test' });

  // Purge owner data
  const purgeResult = await callTool(client, 'purge_owner_data', { token: legalTokens.beneficiaries['Ivan Legal'], ownerId: 'legal-test' });
  assert(purgeResult.includes('ALL DATA PURGED'), 'Data purged');
  assert(purgeResult.includes('No-resurrection: ACTIVE'), 'Purge confirms no-resurrection');

  // Verify data is gone
  const afterPurge = await callTool(client, 'get_status', { ownerId: 'legal-test' });
  assert(afterPurge.includes('No WAKE Will'), 'Will is gone after purge');

  // Deletion certificate survives
  const cert = await callTool(client, 'get_deletion_certificate', { ownerId: 'legal-test' });
  assert(cert.includes('wake-deletion-certificate-v1'), 'Certificate exists');
  assert(cert.includes('Hana Legal'), 'Certificate has owner name');
  assert(cert.includes('noResurrection'), 'Certificate has no-resurrection field');

  // ── 13. Webhook config ──
  console.log('\n13. Webhook config');
  assert(dmsConfig.includes('SENTINEL'), 'Webhook-configured will accepted');

  // ── 14. update_will ──
  console.log('\n14. update_will');
  // Bob is ACTIVE — update his will
  const updateResult = await callTool(client, 'update_will', { token: tokens2.master, ownerId: 'bob', agentName: 'ZEUS-V2' });
  assert(updateResult.includes('Modified') && updateResult.includes('agentName'), 'update_will works');
  const updatedStatus = await callTool(client, 'get_status', { token: tokens2.master, ownerId: 'bob' });
  assert(updatedStatus.includes('ZEUS-V2'), 'Agent name updated');
  // Reject update with wrong token
  const badUpdate = await callTool(client, 'update_will', { token: tokens.master, ownerId: 'bob', agentName: 'HACK' });
  assert(badUpdate.includes('Unauthorized'), 'update_will rejects wrong token');
  // Reject update in non-ACTIVE phase (default owner is REST)
  const restUpdate = await callTool(client, 'update_will', { token: tokens.master, gracePeriodDays: 999 });
  assert(restUpdate.includes('Cannot modify') || restUpdate.includes('sealed'), 'update_will rejected in REST');

  // ── 15. delete_knowledge ──
  console.log('\n15. delete_knowledge');
  // Add and delete in bob's will (ACTIVE)
  const kAdd = await callTool(client, 'contribute_knowledge', { token: tokens2.master, ownerId: 'bob', category: 'finances', summary: 'Test delete', details: 'Will be deleted' });
  assert(kAdd.includes('entry #'), 'Entry added for deletion test');
  const entryId = parseInt(kAdd.match(/entry #(\d+)/)?.[1] || '0');
  const delResult = await callTool(client, 'delete_knowledge', { token: tokens2.master, ownerId: 'bob', entryId });
  assert(delResult.includes('deleted'), 'delete_knowledge works');
  // Delete non-existent entry
  const badDel = await callTool(client, 'delete_knowledge', { token: tokens2.master, ownerId: 'bob', entryId: 99999 });
  assert(badDel.includes('not found'), 'delete_knowledge rejects missing entry');

  // ── 16. restore_backup ──
  console.log('\n16. restore_backup');
  // Bob has backups from configure + update + knowledge operations
  const bobBackups = await callTool(client, 'list_backups', { token: tokens2.master, ownerId: 'bob' });
  assert(bobBackups.includes('backup(s)'), 'Bob has backups');
  // Extract first backup ID
  const backupIdMatch = bobBackups.match(/Backup #(\d+)/);
  if (backupIdMatch) {
    const bid = parseInt(backupIdMatch[1]);
    const restoreResult = await callTool(client, 'restore_backup', { token: tokens2.master, ownerId: 'bob', backupId: bid });
    assert(restoreResult.includes('restored'), 'restore_backup works');
  } else {
    assert(false, 'Could not extract backup ID');
  }
  // Restore non-existent backup
  const badRestore = await callTool(client, 'restore_backup', { token: tokens2.master, ownerId: 'bob', backupId: 99999 });
  assert(badRestore.includes('not found'), 'restore_backup rejects missing backup');

  // ── 17. Phase gating ──
  console.log('\n17. Phase gating');
  // contribute_knowledge rejected in non-ACTIVE (default owner is REST)
  const kReject = await callTool(client, 'contribute_knowledge', { token: tokens.master, category: 'finances', summary: 'Should fail', details: 'x' });
  assert(kReject.includes('Cannot add') || kReject.includes('REST'), 'Knowledge rejected in REST');
  // trigger_vigil rejected in non-ACTIVE
  const vigilReject = await callTool(client, 'trigger_vigil', { token: tokens.master });
  assert(vigilReject.includes('Cannot trigger'), 'VIGIL rejected in REST');
  // verify_death rejected in non-VIGIL (bob is ACTIVE)
  const verifyReject = await callTool(client, 'verify_death', { token: tokens2.verifier, ownerId: 'bob' });
  assert(verifyReject.includes('Verification only') || verifyReject.includes('Not verifier') || verifyReject.includes('VIGIL'), 'verify_death rejected in ACTIVE');
  // execute_terminal_state rejected in non-EULOGY (bob is ACTIVE)
  const termReject = await callTool(client, 'execute_terminal_state', { token: tokens2.master, ownerId: 'bob' });
  assert(termReject.includes('EULOGY') || termReject.includes('Terminal state only'), 'Terminal rejected in ACTIVE');

  // ── 18. Beneficiary tier Black Box ──
  console.log('\n18. Beneficiary tier Black Box');
  // Sam Chen is beneficiary tier on default owner (REST phase)
  const samBox = await callTool(client, 'get_black_box', { token: tokens.beneficiaries['Sam Chen'] });
  assert(samBox.includes('Bank account'), 'Beneficiary sees finance entry');
  assert(!samBox.includes('ALL BENEFICIARIES'), 'Beneficiary does not see full beneficiary list');
  assert(!samBox.includes('TERMINAL STATE'), 'Beneficiary does not see terminal state');
  assert(samBox.includes('OPERATIONAL DIRECTIVES'), 'Beneficiary sees directives');

  // ── 19. Handoff legal fields ──
  console.log('\n19. Handoff legal fields');
  // Use timelock owner which has default noResurrection
  const handoffLegal = await callTool(client, 'initiate_handoff', { token: tlTokens.beneficiaries['Frank TL'], recipientName: 'Frank TL', ownerId: 'timelock-test' });
  assert(handoffLegal.includes('noResurrection'), 'Handoff includes noResurrection');

  // ── 20. Non-executor terminal rejection ──
  console.log('\n20. Non-executor terminal rejection');
  // Sam (beneficiary tier) tries to execute terminal on default owner
  const samTerm = await callTool(client, 'execute_terminal_state', { token: tokens.beneficiaries['Sam Chen'] });
  assert(samTerm.includes('Unauthorized') || samTerm.includes('Not executor') || samTerm.includes('EULOGY'), 'Beneficiary tier cannot execute terminal');

  // ── 21. Audit log non-executor rejection ──
  console.log('\n21. Audit log access control');
  const samAudit = await callTool(client, 'get_audit_log', { token: tokens.beneficiaries['Sam Chen'] });
  assert(samAudit.includes('Unauthorized'), 'Non-executor cannot read audit');
  const rileyAudit = await callTool(client, 'get_audit_log', { token: tokens.beneficiaries['Riley Chen'] });
  assert(rileyAudit.includes('Unauthorized'), 'Memorial cannot read audit');

  // ── Summary ──
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}`);

  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error('Test error:', err); process.exit(1); });
