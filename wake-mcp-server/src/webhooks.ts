import type { WakeState, WebhookEvent } from './types.js';
import { logAction } from './audit.js';

/** Webhook POST timeout in milliseconds. */
const WEBHOOK_TIMEOUT_MS = 5000;

/** Payload sent to webhook endpoints. */
type WebhookPayload = {
  event: WebhookEvent;
  ownerId: string;
  ownerName: string;
  agentName: string;
  phase: string;
  timestamp: string;
  detail: string;
};

/** Fire a webhook event for a given will. Best-effort, no retries. */
async function fireEvent(
  event: WebhookEvent,
  state: WakeState,
  ownerId: string,
  detail: string,
): Promise<void> {
  const webhooks = state.will.webhooks;
  if (!webhooks || webhooks.length === 0) return;

  const payload: WebhookPayload = {
    event,
    ownerId,
    ownerName: state.will.ownerName,
    agentName: state.will.agentName,
    phase: state.phase,
    timestamp: new Date().toISOString(),
    detail,
  };

  for (const hook of webhooks) {
    if (!hook.events.includes(event)) continue;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

      await fetch(hook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      logAction('webhook', 'system', state.phase, true, `${event} → ${hook.url}`, ownerId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      logAction('webhook', 'system', state.phase, false, `${event} → ${hook.url}: ${msg}`, ownerId);
    }
  }
}

export { fireEvent };
export type { WebhookPayload };
