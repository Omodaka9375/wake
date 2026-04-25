import { hashToken } from './crypto.js';
import type { WakeState } from './types.js';

/** Caller identity resolved from a token. */
type CallerIdentity = {
  role: 'owner' | 'verifier' | 'beneficiary' | 'unknown';
  name: string;
  hashPrefix: string;
};

/** Validate a raw token against a stored hash. */
function validateToken(raw: string, storedHash: string): boolean {
  return hashToken(raw) === storedHash;
}

/** Identify who is calling based on their token. */
function identifyCaller(token: string, state: WakeState): CallerIdentity {
  const hash = hashToken(token);
  const prefix = hash.slice(0, 8);

  if (hash === state.tokens.masterHash) {
    return { role: 'owner', name: state.will.ownerName, hashPrefix: prefix };
  }

  if (hash === state.tokens.verifierHash) {
    return { role: 'verifier', name: state.will.verifierName, hashPrefix: prefix };
  }

  for (const [name, beneficiaryHash] of Object.entries(state.tokens.beneficiaryHashes)) {
    if (hash === beneficiaryHash) {
      return { role: 'beneficiary', name, hashPrefix: prefix };
    }
  }

  return { role: 'unknown', name: 'unknown', hashPrefix: prefix };
}

/** Get a short identifier from a raw token for audit logging. */
function tokenPrefix(token: string): string {
  return hashToken(token).slice(0, 8);
}

export { validateToken, identifyCaller, tokenPrefix };
export type { CallerIdentity };
