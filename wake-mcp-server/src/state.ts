import type { WakeState, Phase } from './types.js';

/**
 * Check if the current phase should advance based on elapsed time.
 * Automatically transitions ACTIVE → VIGIL when heartbeat is stale.
 * Returns the (possibly updated) phase.
 */
function checkAndAdvancePhase(state: WakeState): Phase {
  if (state.phase !== 'ACTIVE') return state.phase;

  const elapsed = Date.now() - new Date(state.lastHeartbeat).getTime();
  const thresholdMs = state.will.inactivityThresholdHours * 60 * 60 * 1000;

  if (elapsed >= thresholdMs) {
    state.phase = 'VIGIL';
    state.vigilStarted = new Date().toISOString();
  }

  return state.phase;
}

/** Milliseconds remaining before VIGIL triggers. Negative if already past. */
function msUntilVigil(state: WakeState): number {
  const elapsed = Date.now() - new Date(state.lastHeartbeat).getTime();
  const thresholdMs = state.will.inactivityThresholdHours * 60 * 60 * 1000;
  return thresholdMs - elapsed;
}

/** Whether the given phase allows will modifications. */
function canModifyWill(phase: Phase): boolean {
  return phase === 'ACTIVE';
}

/** Whether the given phase allows beneficiary data access. */
function canAccessData(phase: Phase): boolean {
  return phase === 'EULOGY' || phase === 'REST';
}

/** Validate a phase transition is legal. */
function isValidTransition(from: Phase, to: Phase): boolean {
  const transitions: Record<Phase, Phase[]> = {
    ACTIVE: ['VIGIL'],
    VIGIL: ['EULOGY'],
    EULOGY: ['REST'],
    REST: [],
  };
  return transitions[from].includes(to);
}

export { checkAndAdvancePhase, msUntilVigil, canModifyWill, canAccessData, isValidTransition };
