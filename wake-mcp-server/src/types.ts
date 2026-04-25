/** Protocol phases in order of progression. */
type Phase = 'ACTIVE' | 'VIGIL' | 'EULOGY' | 'REST';

/** Terminal state the agent enters at the end of the protocol. */
type TerminalState = 'archive' | 'distill' | 'delete';

/** Tiered access levels for beneficiaries. */
type AccessTier = 'executor' | 'beneficiary' | 'memorial';

/** A named beneficiary with an access tier. */
type Beneficiary = {
  name: string;
  tier: AccessTier;
  contact?: string;
};

/** A final message addressed to a specific recipient. */
type FinalMessage = {
  recipientName: string;
  message: string;
  releaseAfter?: string;
};

/** Webhook configuration. */
type WebhookConfig = {
  url: string;
  events: string[];
};

/** Webhook event types. */
type WebhookEvent = 'vigil.triggered' | 'eulogy.started' | 'eulogy.message' | 'rest.executed' | 'timelock.released';

/** The owner-configured WAKE Will. */
type WakeWill = {
  ownerName: string;
  agentName: string;
  beneficiaries: Beneficiary[];
  redactions: string[];
  operationalDirectives: string[];
  finalMessages: FinalMessage[];
  terminalState: TerminalState;
  gracePeriodDays: number;
  inactivityThresholdHours: number;
  verifierName: string;
  webhooks?: WebhookConfig[];
  deadManSwitchDays?: number;
  noResurrection?: boolean;
  resurrectionExceptions?: string[];
  jurisdiction?: string;
};

/** Hashed tokens for authentication. */
type TokenSet = {
  masterHash: string;
  verifierHash: string;
  beneficiaryHashes: Record<string, string>;
};

/** Audit log entry. */
type AuditEntry = {
  timestamp: string;
  action: string;
  caller: string;
  phase: Phase;
  success: boolean;
  detail: string;
};

/** Full persisted state of the WAKE protocol. */
type WakeState = {
  will: WakeWill;
  tokens: TokenSet;
  phase: Phase;
  lastHeartbeat: string;
  vigilStarted?: string;
  eulogyStarted?: string;
  deathConfirmedBy?: string;
  terminalExecutedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type {
  Phase,
  TerminalState,
  AccessTier,
  Beneficiary,
  FinalMessage,
  WebhookConfig,
  WebhookEvent,
  WakeWill,
  WakeState,
  TokenSet,
  AuditEntry,
};
