// Dashboard Client Logic

let currentRules = [];
let defaultCatalogueUrl = 'https://wa.me/c/919423185940';
let defaultTemplateText = `Hello! Thank you for reaching out to us. 🌸

Here is our official product Catalogue:
👉 https://wa.me/c/919423185940

Please browse through our collection. Feel free to message us here if you have any questions or would like to place an order! 😊`;

// Format ISO timestamp into local readable time
function formatTimestamp(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' (' + d.toLocaleDateString() + ')';
  } catch {
    return isoStr;
  }
}

// Escape HTML utility
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==========================================
// 1. Fetch Server Status, Logs & Rules
// ==========================================
async function fetchStatusAndLogs() {
  try {
    const [statusRes, logsRes] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/logs').then(r => r.json()),
    ]);

    if (statusRes.success) {
      updateStatusUI(statusRes);
    }

    if (logsRes.success) {
      updateLogsUI(logsRes.logs, logsRes.stats);
    }
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
  }
}

async function fetchRules() {
  try {
    const res = await fetch('/api/rules');
    const data = await res.json();
    if (data.success && Array.isArray(data.rules)) {
      currentRules = data.rules;
      if (data.defaultCatalogueUrl) defaultCatalogueUrl = data.defaultCatalogueUrl;
      if (data.defaultTemplate) defaultTemplateText = data.defaultTemplate;
      renderRulesTable();
      const activeCount = currentRules.filter(r => r.enabled !== false).length;
      const countEl = document.getElementById('stat-rules-count');
      if (countEl) countEl.innerText = activeCount;
    }
  } catch (err) {
    console.error('Error fetching rules:', err);
  }
}

// ==========================================
// 2. Render Rules Table
// ==========================================
function renderRulesTable() {
  const tbody = document.getElementById('rules-table-body');
  if (!tbody) return;

  if (!currentRules || currentRules.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="table-empty">
          No auto-reply rules configured yet. Click <strong>"+ Add Rule"</strong> to create one.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = currentRules.map((rule) => {
    const isEnabled = rule.enabled !== false;
    const instance = rule.instance && rule.instance !== '*' ? rule.instance : 'All Instances (*)';

    // Instance Badge
    const instanceBadge = rule.instance && rule.instance !== '*'
      ? `<span class="badge badge-indigo">⚡ ${escapeHtml(rule.instance)}</span>`
      : `<span class="badge badge-neutral">🌐 All Instances (*)</span>`;

    // Keywords Display
    const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
    const keywordsDisplay = keywords.length > 0
      ? `<div class="tag-group">${keywords.map(k => `<span class="tag tag-purple">${escapeHtml(k)}</span>`).join('')}</div>`
      : `<span class="tag">No keywords</span>`;

    // Message snippet
    const messagePreview = escapeHtml(rule.replyMessage || '');

    // Status Badge
    const statusBadge = isEnabled
      ? `<span class="badge badge-success" style="cursor:pointer;" onclick="toggleRuleState('${rule.id}', false)" title="Click to pause">Active</span>`
      : `<span class="badge badge-neutral" style="cursor:pointer;" onclick="toggleRuleState('${rule.id}', true)" title="Click to activate">Paused</span>`;

    return `
      <tr>
        <td>
          <div style="font-weight:600; font-size:14px; color:var(--text-main);">
            ${instanceBadge}
          </div>
        </td>
        <td>${keywordsDisplay}</td>
        <td>
          <div class="msg-snippet-box" title="${messagePreview}">${messagePreview}</div>
        </td>
        <td>${statusBadge}</td>
        <td>
          <div class="action-buttons-wrap" style="justify-content: flex-end;">
            <button class="btn-icon-action" onclick="openEditRuleModal('${rule.id}')" title="Edit Rule">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="btn-icon-action delete" onclick="deleteRule('${rule.id}')" title="Delete Rule">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================
// 3. Add / Edit Rule Modal Handling
// ==========================================
function openAddRuleModal() {
  document.getElementById('modal-title').innerText = 'Configure Instance Auto-Reply';
  document.getElementById('rule-id').value = '';
  document.getElementById('rule-instance').value = 'zari';
  document.getElementById('rule-keywords').value = '';
  document.getElementById('rule-reply-message').value = defaultTemplateText;
  document.getElementById('rule-enabled').checked = true;

  document.getElementById('rule-modal').classList.remove('hidden');
}

function openEditRuleModal(ruleId) {
  const rule = currentRules.find(r => r.id === ruleId);
  if (!rule) return;

  document.getElementById('modal-title').innerText = `Edit Instance Rule (${rule.instance || '*'})`;
  document.getElementById('rule-id').value = rule.id;
  document.getElementById('rule-instance').value = rule.instance || '*';
  
  const kws = Array.isArray(rule.keywords) ? rule.keywords.join(', ') : (rule.keywords || '');
  document.getElementById('rule-keywords').value = kws;
  
  document.getElementById('rule-reply-message').value = rule.replyMessage || '';
  document.getElementById('rule-enabled').checked = rule.enabled !== false;

  document.getElementById('rule-modal').classList.remove('hidden');
}

function closeRuleModal() {
  document.getElementById('rule-modal').classList.add('hidden');
}

function handleModalBackdropClick(event) {
  if (event.target.id === 'rule-modal') {
    closeRuleModal();
  }
}

function insertDefaultCatalogueTemplate() {
  const textarea = document.getElementById('rule-reply-message');
  textarea.value = defaultTemplateText;
}

// Save Rule Form (Create or Update)
async function saveRuleForm(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('btn-save-rule');
  saveBtn.disabled = true;
  saveBtn.innerText = 'Saving...';

  const ruleId = document.getElementById('rule-id').value.trim();
  const payload = {
    id: ruleId || undefined,
    instance: document.getElementById('rule-instance').value.trim() || 'zari',
    keywords: document.getElementById('rule-keywords').value.trim(),
    replyMessage: document.getElementById('rule-reply-message').value.trim(),
    enabled: document.getElementById('rule-enabled').checked,
  };

  try {
    const res = await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.success) {
      closeRuleModal();
      await fetchRules();
      await fetchStatusAndLogs();
    } else {
      alert(`Error saving rule: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    alert(`Failed to save rule: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerText = 'Save Rule';
  }
}

// Toggle Rule Enable / Disable
async function toggleRuleState(ruleId, newEnabledState) {
  try {
    const res = await fetch(`/api/rules/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newEnabledState }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchRules();
    }
  } catch (err) {
    console.error('Error toggling rule state:', err);
  }
}

// Delete Rule
async function deleteRule(ruleId) {
  const rule = currentRules.find(r => r.id === ruleId);
  const ruleName = rule ? `rule for instance "${rule.instance}"` : 'this rule';

  if (!confirm(`Are you sure you want to delete ${ruleName}?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/rules/${ruleId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (data.success) {
      await fetchRules();
      await fetchStatusAndLogs();
    } else {
      alert(`Error deleting rule: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    alert(`Failed to delete rule: ${err.message}`);
  }
}

// Reset Rules to Default
async function resetToDefaultRules() {
  if (!confirm('Are you sure you want to reset all rules to the default Catalogue auto-reply rule?')) {
    return;
  }

  try {
    const res = await fetch('/api/rules/reset', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await fetchRules();
      await fetchStatusAndLogs();
      alert('✅ Rules reset to default Catalogue auto-reply!');
    } else {
      alert(`Error resetting rules: ${data.error}`);
    }
  } catch (err) {
    alert(`Failed to reset rules: ${err.message}`);
  }
}

// ==========================================
// 4. Status UI & Metric Counters
// ==========================================
function updateStatusUI(data) {
  const badge = document.getElementById('connection-status-badge');
  const badgeText = document.getElementById('connection-status-text');
  const instanceNameEl = document.getElementById('header-instance-name');

  const instanceName = data.evolution?.instanceName || 'zari';
  if (instanceNameEl) instanceNameEl.innerText = instanceName;

  const state = data.evolution?.connectionStatus || 'unknown';
  if (state === 'open' || state === 'connected') {
    badge.className = 'status-badge connected';
    badgeText.innerText = `Connected (${instanceName})`;
  } else {
    badge.className = 'status-badge disconnected';
    badgeText.innerText = `Instance: ${state}`;
  }

  if (data.server?.rulesCount !== undefined) {
    const countEl = document.getElementById('stat-rules-count');
    if (countEl) countEl.innerText = data.server.activeRulesCount || 0;
  }
}

// ==========================================
// 5. Update Activity Logs
// ==========================================
function updateLogsUI(logs, stats) {
  if (stats) {
    document.getElementById('stat-received').innerText = stats.totalMessagesReceived || 0;
    document.getElementById('stat-triggers').innerText = stats.catalogueTriggers || 0;
    document.getElementById('stat-sent').innerText = stats.repliesSent || 0;
  }

  const tbody = document.getElementById('logs-table-body');
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No recent messages yet. Waiting for incoming WhatsApp messages...</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const initials = (log.senderName || log.sender || 'U').substring(0, 2).toUpperCase();
    const isAutoReply = log.type === 'AUTO_REPLY' || log.type === 'CATALOGUE_AUTO_REPLY';

    let statusBadge = '';
    if (log.status === 'SUCCESS') {
      statusBadge = `<span class="badge badge-success">✅ Replied</span>`;
    } else if (log.status === 'FAILED') {
      statusBadge = `<span class="badge badge-failed" title="${escapeHtml(log.error || '')}">❌ Failed</span>`;
    } else {
      statusBadge = `<span class="badge badge-neutral">Received</span>`;
    }

    return `
      <tr>
        <td>
          <div class="sender-cell">
            <div class="sender-avatar">${initials}</div>
            <div class="sender-info">
              <span class="sender-name">${escapeHtml(log.senderName || 'WhatsApp User')}</span>
              <span class="sender-phone">+${escapeHtml(log.sender || '-')}</span>
            </div>
          </div>
        </td>
        <td>
          <span class="badge badge-indigo">⚡ ${escapeHtml(log.instance || 'zari')}</span>
        </td>
        <td>
          <div class="msg-snippet" title="${escapeHtml(log.incomingText || log.replyText || '')}">
            ${escapeHtml(log.incomingText || log.replyText || '-')}
          </div>
        </td>
        <td>${statusBadge}</td>
        <td>${formatTimestamp(log.timestamp)}</td>
      </tr>
    `;
  }).join('');
}

// ==========================================
// 6. Initialize on page load
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  fetchRules();
  fetchStatusAndLogs();
  setInterval(fetchStatusAndLogs, 5000);
});
