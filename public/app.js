// Dashboard Client Logic

const CATALOGUE_URL = 'https://wa.me/c/919423185940';

// Format uptime into human-readable string
function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

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

// Fetch Server Status & Logs
async function fetchStatusAndLogs() {
  try {
    const [statusRes, logsRes] = await Promise.all([
      fetch('/api/status').then(r => r.json()),
      fetch('/api/logs').then(r => r.json())
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

// Update Status Badges & Counters
function updateStatusUI(data) {
  const badge = document.getElementById('connection-status-badge');
  const badgeText = document.getElementById('connection-status-text');
  const instanceNameEl = document.getElementById('header-instance-name');

  const instanceName = data.evolution?.instanceName || 'zari';
  instanceNameEl.innerText = instanceName;

  const state = data.evolution?.connectionStatus || 'unknown';
  if (state === 'open' || state === 'connected') {
    badge.className = 'status-badge connected';
    badgeText.innerText = `Connected (${instanceName})`;
  } else {
    badge.className = 'status-badge disconnected';
    badgeText.innerText = `Instance Status: ${state}`;
  }

  if (data.server?.uptimeSeconds !== undefined) {
    document.getElementById('stat-uptime').innerText = formatUptime(data.server.uptimeSeconds);
  }
}

// Update Logs Table & Stat Counters
function updateLogsUI(logs, stats) {
  if (stats) {
    document.getElementById('stat-received').innerText = stats.totalMessagesReceived || 0;
    document.getElementById('stat-triggers').innerText = stats.catalogueTriggers || 0;
    document.getElementById('stat-sent').innerText = stats.repliesSent || 0;
  }

  const tbody = document.getElementById('logs-table-body');
  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No recent messages yet. Waiting for incoming WhatsApp messages...</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const initials = (log.senderName || log.sender || 'U').substring(0, 2).toUpperCase();
    const isCatalogue = log.type === 'CATALOGUE_AUTO_REPLY';

    let triggerBadge = isCatalogue
      ? `<span class="badge badge-indigo">🎯 Catalogue</span>`
      : `<span class="badge badge-neutral">Message</span>`;

    let statusBadge = '';
    if (log.status === 'SUCCESS') {
      statusBadge = `<span class="badge badge-success">✅ Replied</span>`;
    } else if (log.status === 'FAILED') {
      statusBadge = `<span class="badge badge-failed" title="${log.error || ''}">❌ Failed</span>`;
    } else {
      statusBadge = `<span class="badge badge-neutral">Received</span>`;
    }

    return `
      <tr>
        <td>
          <div class="sender-cell">
            <div class="sender-avatar">${initials}</div>
            <div class="sender-info">
              <span class="sender-name">${log.senderName || 'WhatsApp User'}</span>
              <span class="sender-phone">+${log.sender || '-'}</span>
            </div>
          </div>
        </td>
        <td>
          <div class="msg-snippet" title="${escapeHtml(log.incomingText || log.replyText || '')}">
            ${escapeHtml(log.incomingText || log.replyText || '-')}
          </div>
        </td>
        <td>${triggerBadge}</td>
        <td>${statusBadge}</td>
        <td>${formatTimestamp(log.timestamp)}</td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Test Trigger Simulator
async function runKeywordTest() {
  const input = document.getElementById('test-input-text');
  const resultBox = document.getElementById('test-result-box');
  const message = input.value.trim();

  if (!message) return;

  resultBox.className = 'test-result-box';
  resultBox.innerHTML = 'Testing message against catalogue rules...';
  resultBox.classList.remove('hidden');

  try {
    const res = await fetch('/api/test-trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testMessage: message }),
    });
    const data = await res.json();

    if (data.matched) {
      resultBox.className = 'test-result-box match';
      resultBox.innerHTML = `
        <strong>✅ Match Found!</strong> The message contains the keyword "catalogue/catalog".<br>
        <strong>Bot will send:</strong>
        <pre class="code-preview" style="margin-top:6px;">${escapeHtml(data.preparedReply)}</pre>
      `;
    } else {
      resultBox.className = 'test-result-box no-match';
      resultBox.innerHTML = `
        <strong>ℹ️ No Keyword Match</strong><br>
        Message does not contain "catalogue". Normal message flow will proceed.
      `;
    }
  } catch (err) {
    resultBox.className = 'test-result-box no-match';
    resultBox.innerHTML = `Error: ${err.message}`;
  }
}

// Message Type Switcher in Direct Sender Form
function onMessageTypeChange() {
  const type = document.getElementById('send-type').value;
  const paymentFields = document.getElementById('payment-fields');
  const messageTextGroup = document.getElementById('message-text-group');
  const sendText = document.getElementById('send-text');

  if (type === 'payment') {
    paymentFields.classList.remove('hidden');
    messageTextGroup.classList.add('hidden');
  } else if (type === 'catalogue') {
    paymentFields.classList.add('hidden');
    messageTextGroup.classList.remove('hidden');
    sendText.value = `Hello! 🌸 Here is our official catalogue:\n👉 ${CATALOGUE_URL}\n\nPlease let us know if you need any assistance!`;
  } else {
    paymentFields.classList.add('hidden');
    messageTextGroup.classList.remove('hidden');
    sendText.value = '';
  }
}

// Direct Message Send Form Handler
async function handleDirectSend(e) {
  e.preventDefault();
  const sendBtn = document.getElementById('btn-send-message');
  const statusMsg = document.getElementById('send-status-msg');
  const number = document.getElementById('send-number').value.trim();
  const type = document.getElementById('send-type').value;

  if (!number) return;

  sendBtn.disabled = true;
  statusMsg.className = 'send-status-msg';
  statusMsg.innerText = 'Sending...';

  try {
    let endpoint = '/api/message/send';
    let payload = {};

    if (type === 'payment') {
      endpoint = '/api/send-payment';
      payload = {
        patientMobile: number,
        patientName: document.getElementById('pay-name').value.trim() || 'Valued Customer',
        paymentAmount: Number(document.getElementById('pay-amount').value) || 0,
        amountType: document.getElementById('pay-type').value,
        updatedDeposit: Number(document.getElementById('pay-amount').value) || 0,
      };
    } else {
      payload = {
        number: number,
        text: document.getElementById('send-text').value.trim(),
      };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (data.success) {
      statusMsg.className = 'send-status-msg success';
      statusMsg.innerText = '✅ Message sent successfully!';
      fetchStatusAndLogs();
    } else {
      statusMsg.className = 'send-status-msg error';
      statusMsg.innerText = `❌ Failed: ${data.error || 'Unknown error'}`;
    }
  } catch (err) {
    statusMsg.className = 'send-status-msg error';
    statusMsg.innerText = `❌ Error: ${err.message}`;
  } finally {
    sendBtn.disabled = false;
    setTimeout(() => {
      statusMsg.innerText = '';
    }, 6000);
  }
}

// Webhook Configure Helper
async function configureWebhook() {
  const input = document.getElementById('webhook-url-input');
  const btn = document.getElementById('btn-save-webhook');
  const url = input.value.trim();

  if (!url) {
    alert('Please enter a valid webhook URL (e.g. https://your-server.com/webhook)');
    return;
  }

  btn.disabled = true;
  btn.innerText = 'Configuring...';

  try {
    const res = await fetch('/api/webhook/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: url }),
    });
    const data = await res.json();

    if (data.success) {
      alert(`✅ Webhook successfully configured on Evolution API for instance "${data.data?.instanceId || 'zari'}"!`);
    } else {
      alert(`❌ Failed to configure webhook: ${JSON.stringify(data.error)}`);
    }
  } catch (err) {
    alert(`❌ Request error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerText = 'Save & Sync';
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  fetchStatusAndLogs();
  // Poll every 5 seconds for live activity updates
  setInterval(fetchStatusAndLogs, 5000);
});
