import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import type { WakeState } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');

/** Deletion certificate structure. */
type DeletionCertificate = {
  type: 'wake-deletion-certificate-v1';
  ownerId: string;
  ownerName: string;
  agentName: string;
  jurisdiction?: string;
  noResurrection: boolean;
  resurrectionExceptions: string[];
  deletedAt: string;
  stateHashBeforeDeletion: string;
  purgedItems: string[];
  attestation: string;
};

/** Generate and persist a deletion certificate. */
function generateDeletionCertificate(state: WakeState, ownerId: string): DeletionCertificate {
  const stateHash = createHash('sha256').update(JSON.stringify(state)).digest('hex');
  const now = new Date().toISOString();

  const cert: DeletionCertificate = {
    type: 'wake-deletion-certificate-v1',
    ownerId,
    ownerName: state.will.ownerName,
    agentName: state.will.agentName,
    jurisdiction: state.will.jurisdiction,
    noResurrection: state.will.noResurrection !== false,
    resurrectionExceptions: state.will.resurrectionExceptions ?? [],
    deletedAt: now,
    stateHashBeforeDeletion: stateHash,
    purgedItems: [
      'Will configuration and tokens',
      'Knowledge entries',
      'Audit log',
      'Backup snapshots',
      'Handoff log',
    ],
    attestation: `This certifies that all data belonging to "${state.will.ownerName}" (agent: "${state.will.agentName}") under owner ID "${ownerId}" has been permanently deleted per the owner's WAKE Will terminal state directive. The SHA-256 hash of the final state before deletion was ${stateHash}. This certificate is the sole remaining record.`,
  };

  // Persist certificate
  mkdirSync(DATA_DIR, { recursive: true });
  const certPath = resolve(DATA_DIR, `deletion-certificate-${ownerId}.json`);
  writeFileSync(certPath, JSON.stringify(cert, null, 2), 'utf-8');

  return cert;
}

/** Load a deletion certificate if it exists. */
function loadDeletionCertificate(ownerId: string): DeletionCertificate | null {
  try {
    const certPath = resolve(DATA_DIR, `deletion-certificate-${ownerId}.json`);
    return JSON.parse(readFileSync(certPath, 'utf-8')) as DeletionCertificate;
  } catch {
    return null;
  }
}

/** Purge ALL data for an owner from the database. */
function purgeOwnerData(ownerId: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM wills WHERE owner_id = ?').run(ownerId);
    db.prepare('DELETE FROM wills_backup WHERE owner_id = ?').run(ownerId);
    db.prepare('DELETE FROM audit_log WHERE owner_id = ?').run(ownerId);
    db.prepare('DELETE FROM knowledge_entries WHERE owner_id = ?').run(ownerId);
    db.prepare('DELETE FROM handoff_log WHERE owner_id = ?').run(ownerId);
  })();
}

/** Jurisdiction to applicable law mapping. */
const JURISDICTION_LAWS: Record<string, string[]> = {
  'california': ['RUFADAA', 'CA Civil Code §3344.1 (post-mortem publicity, 70 years)', 'CA AB 2602/AB 1836 (AI likeness consent)'],
  'new york': ['RUFADAA', 'NY Right of Publicity Law (2021)'],
  'tennessee': ['RUFADAA', 'ELVIS Act (2024, AI voice/likeness)'],
  'illinois': ['RUFADAA', 'IL Right of Publicity Act (AI-amended 2026)'],
  'washington': ['RUFADAA', 'WA Forged Digital Likeness Act (2026)'],
  'eu': ['GDPR (rights cease on death)', 'EU AI Act (biometric data)'],
  'france': ['GDPR', 'Digital Republic Act (2016, posthumous data instructions)'],
  'italy': ['GDPR', 'Italian Data Protection Code (heir data rights)'],
  'uk': ['UK GDPR (rights cease on death)', 'No statutory post-mortem publicity right'],
  'germany': ['GDPR', 'BGH Facebook ruling (2018, digital accounts inheritable)'],
};

/** Format a RUFADAA-compatible legal export. */
function formatLegalExport(state: WakeState, ownerId: string): string {
  const w = state.will;
  const noRes = w.noResurrection !== false;
  const jurisdiction = w.jurisdiction ?? 'Not specified';

  const applicableLaws: string[] = [];
  if (w.jurisdiction) {
    const key = w.jurisdiction.toLowerCase();
    for (const [k, laws] of Object.entries(JURISDICTION_LAWS)) {
      if (key.includes(k)) applicableLaws.push(...laws);
    }
  }

  const lines = [
    '═══════════════════════════════════════════════════════════',
    '  WAKE PROTOCOL — DIGITAL AGENT SUCCESSION INSTRUMENT',
    '  Will-Aware Knowledge Execution',
    '═══════════════════════════════════════════════════════════',
    '',
    `Date of creation:     ${state.createdAt}`,
    `Last updated:         ${state.updatedAt}`,
    `Current phase:        ${state.phase}`,
    `Owner ID:             ${ownerId}`,
    '',
    '───────────────────────────────────────────────────────────',
    '  SECTION 1: PRINCIPAL (Owner)',
    '───────────────────────────────────────────────────────────',
    `Name:                 ${w.ownerName}`,
    `AI Agent:             ${w.agentName}`,
    `Jurisdiction:         ${jurisdiction}`,
    '',
    '───────────────────────────────────────────────────────────',
    '  SECTION 2: FIDUCIARY DESIGNATIONS',
    '  (Per RUFADAA — Revised Uniform Fiduciary Access',
    '   to Digital Assets Act)',
    '───────────────────────────────────────────────────────────',
    `Death Event Verifier: ${w.verifierName}`,
    '',
  ];

  for (const b of w.beneficiaries) {
    const role = b.tier === 'executor' ? 'Fiduciary (Executor)' : b.tier === 'beneficiary' ? 'Designated Recipient' : 'Memorial Access';
    lines.push(`  ${b.name} — ${role}${b.contact ? ` (${b.contact})` : ''}`);
  }

  lines.push(
    '',
    '───────────────────────────────────────────────────────────',
    '  SECTION 3: SUCCESSION PARAMETERS',
    '───────────────────────────────────────────────────────────',
    `Inactivity threshold: ${w.inactivityThresholdHours} hours`,
    `Grace period:         ${w.gracePeriodDays} days`,
    `Terminal state:       ${w.terminalState.toUpperCase()}`,
    `Dead man's switch:    ${w.deadManSwitchDays ? `${w.deadManSwitchDays} days` : 'Not configured'}`,
    '',
    '───────────────────────────────────────────────────────────',
    '  SECTION 4: PRIVACY DIRECTIVES',
    '───────────────────────────────────────────────────────────',
    'Redacted categories (purged before any handoff):',
  );

  if (w.redactions.length > 0) {
    w.redactions.forEach((r) => lines.push(`  • ${r}`));
  } else {
    lines.push('  None specified.');
  }

  lines.push(
    '',
    '───────────────────────────────────────────────────────────',
    '  SECTION 5: NO-RESURRECTION DIRECTIVE',
    '───────────────────────────────────────────────────────────',
    `Directive:            ${noRes ? 'ACTIVE — Agent must NOT be used to simulate or impersonate the deceased.' : 'INACTIVE — No restriction on posthumous simulation.'}`,
  );

  if (noRes && w.resurrectionExceptions && w.resurrectionExceptions.length > 0) {
    lines.push('Permitted exceptions:');
    w.resurrectionExceptions.forEach((e) => lines.push(`  • ${e}`));
  }

  lines.push(
    '',
    '───────────────────────────────────────────────────────────',
    '  SECTION 6: OPERATIONAL DIRECTIVES',
    '───────────────────────────────────────────────────────────',
  );

  if (w.operationalDirectives.length > 0) {
    w.operationalDirectives.forEach((d, i) => lines.push(`  ${i + 1}. ${d}`));
  } else {
    lines.push('  None specified.');
  }

  lines.push(
    '',
    '───────────────────────────────────────────────────────────',
    '  SECTION 7: FINAL MESSAGES',
    '───────────────────────────────────────────────────────────',
    `${w.finalMessages.length} message(s) configured.`,
  );

  for (const m of w.finalMessages) {
    lines.push(`  To: ${m.recipientName}${m.releaseAfter ? ` (time-locked until ${m.releaseAfter})` : ''}`);
  }

  if (applicableLaws.length > 0) {
    lines.push(
      '',
      '───────────────────────────────────────────────────────────',
      '  SECTION 8: APPLICABLE LEGAL FRAMEWORK',
      '───────────────────────────────────────────────────────────',
      `Jurisdiction: ${jurisdiction}`,
      'Potentially applicable laws:',
    );
    applicableLaws.forEach((l) => lines.push(`  • ${l}`));
    lines.push('', 'NOTE: This document is generated by the WAKE protocol and is');
    lines.push('intended to supplement — not replace — a formal legal will.');
    lines.push('Consult a qualified attorney in your jurisdiction.');
  }

  lines.push(
    '',
    '═══════════════════════════════════════════════════════════',
    '  END OF WAKE SUCCESSION INSTRUMENT',
    '═══════════════════════════════════════════════════════════',
  );

  return lines.join('\n');
}

export { generateDeletionCertificate, loadDeletionCertificate, purgeOwnerData, formatLegalExport };
export type { DeletionCertificate };
