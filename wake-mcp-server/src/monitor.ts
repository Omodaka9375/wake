import { getDb } from './db.js';
import { loadState, saveState, getServerKey } from './store.js';
import { decrypt } from './crypto.js';
import { checkAndAdvancePhase } from './state.js';
import { logAction } from './audit.js';
import { fireEvent } from './webhooks.js';
import type { WakeState } from './types.js';

/** Default monitor check interval: 5 minutes. */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Start the background monitor. Returns the interval handle. */
function startMonitor(intervalMs: number = DEFAULT_INTERVAL_MS): ReturnType<typeof setInterval> {
  console.error(`[monitor] Started. Checking every ${intervalMs / 1000}s.`);

  return setInterval(async () => {
    try {
      await runMonitorCycle();
    } catch (err) {
      console.error('[monitor] Error:', err);
    }
  }, intervalMs);
}

/** Single monitor cycle — check all wills. */
async function runMonitorCycle(): Promise<void> {
  const db = getDb();
  const key = await getServerKey();

  const rows = db.prepare('SELECT owner_id, encrypted_state FROM wills').all() as Array<{
    owner_id: string;
    encrypted_state: string;
  }>;

  for (const row of rows) {
    let state: WakeState;
    try {
      const envelope = JSON.parse(row.encrypted_state);
      const plaintext = decrypt(envelope, key);
      state = JSON.parse(plaintext) as WakeState;
    } catch {
      continue;
    }

    const ownerId = row.owner_id;
    const prevPhase = state.phase;

    // Check heartbeat staleness (ACTIVE → VIGIL)
    if (state.phase === 'ACTIVE') {
      const newPhase = checkAndAdvancePhase(state);
      if (newPhase === 'VIGIL') {
        await saveState(state, ownerId);
        logAction('monitor', 'system', 'VIGIL', true, 'Inactivity detected, VIGIL triggered', ownerId);
        await fireEvent('vigil.triggered', state, ownerId, `${state.will.ownerName} has been inactive beyond threshold`);
      }
    }

    // Dead man's switch (VIGIL → EULOGY auto-escalation)
    if (state.phase === 'VIGIL' && state.will.deadManSwitchDays && state.vigilStarted) {
      const elapsed = Date.now() - new Date(state.vigilStarted).getTime();
      const thresholdMs = state.will.deadManSwitchDays * 24 * 60 * 60 * 1000;

      if (elapsed >= thresholdMs) {
        state.phase = 'EULOGY';
        state.eulogyStarted = new Date().toISOString();
        state.deathConfirmedBy = 'DEAD_MAN_SWITCH';
        await saveState(state, ownerId);
        logAction('monitor', 'system', 'EULOGY', true,
          `Dead man's switch: ${state.will.deadManSwitchDays} days without verification, auto-escalated`, ownerId);
        await fireEvent('eulogy.started', state, ownerId,
          `Auto-escalated by dead man's switch after ${state.will.deadManSwitchDays} days`);
      }
    }
  }
}

export { startMonitor, runMonitorCycle };
