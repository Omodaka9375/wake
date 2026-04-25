// @ts-check

/* ============================================================
   CONFIGURATION
   ============================================================ */
const API = '/api/tool';

/* ============================================================
   STATE
   ============================================================ */
/** @type {{ token: string, ownerId: string, role: string, name: string, tier: string, prevView: string }} */
const state = { token: '', ownerId: 'default', role: '', name: '', tier: '', prevView: 'login' };

/* ============================================================
   API HELPER
   ============================================================ */
async function callTool(tool, args = {}) {
  const body = { tool, args: { ...args, token: state.token, ownerId: state.ownerId } };
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

/* ============================================================
   VIEW MANAGEMENT
   ============================================================ */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + id);
  if (el) el.classList.add('active');
  document.getElementById('logoutBtn').style.display = (id === 'login' || id === 'public') ? 'none' : '';
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ============================================================
   STATUS RENDERING
   ============================================================ */
function renderStatus(data, targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  const phase = data.phase || 'UNCONFIGURED';
  let html = `<span class="phase-badge phase-${phase}">${phase}</span>`;
  html += '<div class="status-grid">';
  html += `<div class="status-item"><span class="form-label">Owner</span><div class="val">${esc(data.owner || '—')}</div></div>`;
  html += `<div class="status-item"><span class="form-label">Agent</span><div class="val">${esc(data.agent || '—')}</div></div>`;
  if (data.lastHeartbeat) html += `<div class="status-item"><span class="form-label">Last Heartbeat</span><div class="val" style="font-size:13px">${new Date(data.lastHeartbeat).toLocaleString()}</div></div>`;
  if (data.vigilTriggersInHours != null) html += `<div class="status-item"><span class="form-label">VIGIL In</span><div class="val">${data.vigilTriggersInHours}h</div></div>`;
  if (data.vigilStarted) html += `<div class="status-item"><span class="form-label">VIGIL Started</span><div class="val" style="font-size:13px">${new Date(data.vigilStarted).toLocaleString()}</div></div>`;
  if (data.eulogyStarted) html += `<div class="status-item"><span class="form-label">EULOGY Started</span><div class="val" style="font-size:13px">${new Date(data.eulogyStarted).toLocaleString()}</div></div>`;
  if (data.deathConfirmedBy) html += `<div class="status-item"><span class="form-label">Confirmed By</span><div class="val">${esc(data.deathConfirmedBy)}</div></div>`;
  if (data.terminalExecutedAt) html += `<div class="status-item"><span class="form-label">Terminal</span><div class="val" style="font-size:13px">${esc(data.terminalState || '')} @ ${new Date(data.terminalExecutedAt).toLocaleString()}</div></div>`;
  html += '</div>';
  el.innerHTML = html;
}

/* ============================================================
   APP METHODS
   ============================================================ */
const app = {
  async login() {
    const token = document.getElementById('loginToken').value.trim();
    const ownerId = document.getElementById('loginOwnerId').value.trim() || 'default';
    if (!token) { toast('Token required'); return; }

    state.token = token;
    state.ownerId = ownerId;

    // Identify role
    const access = await callTool('get_access_tier');
    if (access.error) { toast(access.error); state.token = ''; return; }

    state.role = access.role;
    state.name = access.name;
    state.tier = access.tier || access.role;

    // Route to appropriate view
    if (state.role === 'owner') { await app.loadOwner(); showView('owner'); }
    else if (state.role === 'verifier') { await app.loadVerifier(); showView('verifier'); }
    else { await app.loadAccess(); showView('access'); }

    toast(`Authenticated as ${state.name} (${state.tier})`);
  },

  async viewPublic() {
    const ownerId = document.getElementById('loginOwnerId').value.trim() || 'default';
    state.ownerId = ownerId;
    state.token = '';
    const data = await callTool('get_status', {});
    const el = document.getElementById('publicStatus');
    const phase = data.phase || 'UNCONFIGURED';
    el.innerHTML = `<span class="phase-badge phase-${phase}">${phase}</span>` +
      (data.owner ? `<p style="margin-top:12px">${esc(data.owner)} · ${esc(data.agent || '')}</p>` : '<p style="margin-top:12px;color:var(--text-muted)">No will configured for this owner.</p>');
    showView('public');
  },

  logout() { state.token = ''; state.role = ''; showView('login'); },

  showView,

  /* ── OWNER ── */
  async loadOwner() {
    const data = await callTool('get_status');
    renderStatus(data, 'ownerStatus');
    await app.loadKnowledge();
  },

  async loadKnowledge() {
    const entries = await callTool('list_knowledge');
    const el = document.getElementById('knowledgeList');
    if (Array.isArray(entries) && entries.length > 0) {
      el.innerHTML = '<div class="entry-list">' + entries.map(e =>
        `<div class="entry-item"><div><span class="cat">${esc(e.category)}</span> ${esc(e.summary)}<div class="meta">${esc(e.details)}</div></div><button class="del" onclick="app.deleteKnowledge(${e.id})">×</button></div>`
      ).join('') + '</div>';
    } else {
      el.innerHTML = '<p style="color:var(--text-muted)">No knowledge entries yet.</p>';
    }
  },

  async addKnowledge() {
    const category = document.getElementById('kCategory').value;
    const summary = document.getElementById('kSummary').value.trim();
    const details = document.getElementById('kDetails').value.trim();
    if (!summary) { toast('Summary required'); return; }
    await callTool('contribute_knowledge', { category, summary, details: details || summary });
    document.getElementById('kSummary').value = '';
    document.getElementById('kDetails').value = '';
    await app.loadKnowledge();
    toast('Entry added');
  },

  async deleteKnowledge(id) {
    await callTool('delete_knowledge', { entryId: id });
    await app.loadKnowledge();
    toast('Entry deleted');
  },

  async heartbeat() {
    const r = await callTool('heartbeat');
    if (r.error) { toast(r.error); return; }
    toast(`Heartbeat sent. VIGIL in ${r.vigilInHours}h`);
    await app.loadOwner();
  },

  async triggerVigil() {
    if (!confirm('This will trigger VIGIL phase. Are you sure?')) return;
    const r = await callTool('trigger_vigil');
    if (r.error) { toast(r.error); return; }
    toast('VIGIL activated');
    await app.loadOwner();
  },

  /* ── VERIFIER ── */
  async loadVerifier() {
    const data = await callTool('get_status');
    renderStatus(data, 'verifierStatus');
  },

  async verifyDeath() {
    if (!confirm('You are confirming a death event. This is irreversible. Proceed?')) return;
    const r = await callTool('verify_death');
    if (r.error) { toast(r.error); return; }
    toast('Death confirmed. EULOGY initiated.');
    await app.loadVerifier();
  },

  /* ── ACCESS (executor/beneficiary/memorial) ── */
  async loadAccess() {
    const data = await callTool('get_status');
    renderStatus(data, 'accessStatus');

    // Black Box
    const box = await callTool('get_black_box');
    const bbEl = document.getElementById('blackBoxContent');
    if (box.error) {
      bbEl.innerHTML = `<p style="color:var(--text-muted)">${esc(box.error === 'Sealed' ? 'Black Box is sealed until EULOGY phase.' : box.error)}</p>`;
    } else {
      let html = '';
      if (box.redactions && box.redactions.length) html += `<div class="card"><span class="card-label">Redacted</span><p style="color:var(--text-muted)">${box.redactions.map(esc).join(', ')}</p></div>`;
      if (box.directives && box.directives.length) html += `<div class="card"><span class="card-label">Operational Directives</span>${box.directives.map((d,i) => `<p>${i+1}. ${esc(d)}</p>`).join('')}</div>`;
      if (box.entries && box.entries.length) {
        html += '<div class="card"><span class="card-label">Knowledge Entries</span><div class="entry-list">';
        box.entries.forEach(e => { html += `<div class="entry-item"><div><span class="cat">${esc(e.category)}</span> ${esc(e.summary)}<div class="meta">${esc(e.details)}</div></div></div>`; });
        html += '</div></div>';
      }
      if (box.lockedCount > 0) html += `<p style="color:var(--gold)">🔒 ${box.lockedCount} time-locked entries sealed.</p>`;
      if (box.beneficiaries) {
        html += '<div class="card"><span class="card-label">All Beneficiaries</span>';
        box.beneficiaries.forEach(b => { html += `<p>${esc(b.name)} — ${esc(b.tier)}</p>`; });
        html += '</div>';
      }
      bbEl.innerHTML = html || '<p style="color:var(--text-muted)">No entries available for your tier.</p>';
    }

    // Final messages
    const msgEl = document.getElementById('messagesContent');
    const msg = await callTool('get_final_message', { recipientName: state.name });
    if (msg.error) {
      msgEl.innerHTML = msg.error === 'Sealed' ? '<p style="color:var(--text-muted)">Messages sealed until EULOGY.</p>' : `<p style="color:var(--text-muted)">No message addressed to you.</p>`;
    } else if (msg.timeLocked) {
      msgEl.innerHTML = `<div class="message-card"><p class="locked">🔒 A message is time-locked until ${new Date(msg.releaseAfter).toLocaleDateString()}.</p></div>`;
    } else {
      msgEl.innerHTML = `<div class="message-card"><div class="from">From ${esc(msg.from)}</div><div class="body">"${esc(msg.message)}"</div></div>`;
    }

    // Executor-only sections
    const isExec = state.tier === 'executor' || state.role === 'owner';
    document.getElementById('auditSection').style.display = isExec ? '' : 'none';
    document.getElementById('executorActions').style.display = isExec ? '' : 'none';
  },

  async loadAudit() {
    const entries = await callTool('get_audit_log');
    const el = document.getElementById('auditContent');
    if (Array.isArray(entries)) {
      el.innerHTML = entries.map(e =>
        `<div class="audit-entry">[${new Date(e.timestamp).toLocaleString()}] <span class="action">${esc(e.action)}</span> by ${esc(e.caller)} <span class="${e.success ? 'ok' : 'fail'}">${e.success ? '✓' : '✗'}</span> ${esc(e.detail)}</div>`
      ).join('');
    } else {
      el.innerHTML = '<p style="color:var(--text-muted)">Could not load audit log.</p>';
    }
  },

  async executeTerminal() {
    if (!confirm('Execute the terminal state? This is the owner\'s final directive and cannot be undone.')) return;
    const r = await callTool('execute_terminal_state');
    if (r.error) { toast(r.error); return; }
    toast(`Terminal state: ${r.terminalState}`);
    await app.loadAccess();
  },

  async getHandoff() {
    const r = await callTool('get_handoff_package');
    if (r.error) { toast(r.error); return; }
    state.prevView = 'access';
    document.getElementById('outputTitle').textContent = 'Handoff Package (wake-handoff-v1)';
    document.getElementById('outputContent').textContent = JSON.stringify(r, null, 2);
    showView('output');
  },

  async exportLegal() {
    const r = await callTool('export_legal_will');
    if (r.error) { toast(r.error); return; }
    const prevView = state.role === 'owner' ? 'owner' : 'access';
    state.prevView = prevView;
    document.getElementById('outputTitle').textContent = 'Legal Export — WAKE Succession Instrument';
    document.getElementById('outputContent').textContent = r.document || JSON.stringify(r, null, 2);
    showView('output');
  },

  back() {
    showView(state.prevView || 'login');
  },
};

// Enter key on login
document.getElementById('loginToken').addEventListener('keydown', e => { if (e.key === 'Enter') app.login(); });
