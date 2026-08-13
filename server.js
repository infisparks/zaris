require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration from Environment Variables
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'https://evo.infispark.in').replace(/\/+$/, '');
const API_KEY = process.env.WHATSAPP_API_KEY || process.env.EVOLUTION_API_KEY || 'vR39h6avY69g7kAU3YQbS6V6XEvudson';
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'zari';
const CATALOGUE_URL = process.env.CATALOGUE_URL || 'https://wa.me/c/919423185940';
const AUTO_READ_MESSAGES = process.env.AUTO_READ_MESSAGES !== 'false';
const REPLY_DELAY_MS = parseInt(process.env.REPLY_DELAY_MS || '1000', 10);

// Default Reply Message
const DEFAULT_CATALOGUE_MESSAGE = `Hello! Thank you for reaching out to us. 🌸

Here is our official product Catalogue:
👉 ${CATALOGUE_URL}

Please browse through our collection. Feel free to message us here if you have any questions or would like to place an order! 😊`;

// In-Memory Storage for Dashboard Analytics & Logs
const serverStats = {
  startedAt: new Date(),
  totalMessagesReceived: 0,
  catalogueTriggers: 0,
  repliesSent: 0,
  repliesFailed: 0,
  lastActivity: null,
};

const activityLogs = [];
const MAX_LOGS = 100;

function addActivityLog(log) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    timestamp: new Date().toISOString(),
    ...log,
  };
  activityLogs.unshift(entry);
  if (activityLogs.length > MAX_LOGS) {
    activityLogs.pop();
  }
  serverStats.lastActivity = entry.timestamp;
  return entry;
}

// Deduplication Cache to prevent duplicate replies within 10 seconds
const processedMessagesCache = new Map();
const DEDUPE_TTL_MS = 15000;

function isRecentlyProcessed(key) {
  if (!key) return false;
  const now = Date.now();
  if (processedMessagesCache.has(key)) {
    const expiresAt = processedMessagesCache.get(key);
    if (now < expiresAt) {
      return true;
    }
  }
  processedMessagesCache.set(key, now + DEDUPE_TTL_MS);
  // Cleanup old items
  if (processedMessagesCache.size > 2000) {
    for (const [k, exp] of processedMessagesCache.entries()) {
      if (now >= exp) processedMessagesCache.delete(k);
    }
  }
  return false;
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Evolution API Headers
function getApiHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': API_KEY,
  };
}

// Helper: Mark Message As Read via Evolution API
async function markMessageAsRead(remoteJid, messageId, fromMe = false) {
  if (!AUTO_READ_MESSAGES || !messageId || !remoteJid) return;

  const url = `${EVOLUTION_API_URL}/chat/markMessageAsRead/${INSTANCE_NAME}`;
  const payload = {
    readMessages: [
      {
        remoteJid: remoteJid,
        fromMe: Boolean(fromMe),
        id: messageId,
      },
    ],
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[Read Receipt] Note: ${response.status} - ${errText}`);
    } else {
      console.log(`[Read Receipt] Marked message ${messageId} as read.`);
    }
  } catch (error) {
    console.error(`[Read Receipt Error]:`, error.message);
  }
}

// Helper: Send WhatsApp Text Message via Evolution API
async function sendWhatsAppMessage(number, text, options = {}) {
  if (!API_KEY) {
    throw new Error('WhatsApp API Key is missing. Check EVOLUTION_API_KEY / WHATSAPP_API_KEY environment variable.');
  }

  // Clean phone number (strip @s.whatsapp.net, +, spaces, dashes)
  const cleanNumber = number.toString().replace(/@.*$/, '').replace(/[^0-9]/g, '');
  const url = `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_NAME}`;

  const payload = {
    number: cleanNumber,
    text: text,
    delay: options.delay || REPLY_DELAY_MS,
    linkPreview: options.linkPreview !== undefined ? options.linkPreview : true,
  };

  console.log(`\n📤 [OUTGOING REQUEST] Sending WhatsApp message to: ${cleanNumber}`);
  console.log(`   URL: ${url}`);
  console.log(`   Text Preview: "${text.substring(0, 60).replace(/\n/g, ' ')}..."`);

  const response = await fetch(url, {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errMsg = data?.response?.message || data?.message || `HTTP ${response.status}`;
    const errFormatted = typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg;
    console.error(`❌ [OUTGOING ERROR] HTTP ${response.status} - ${errFormatted}`);
    serverStats.repliesFailed++;
    throw new Error(errFormatted);
  }

  console.log(`✅ [OUTGOING SUCCESS] Message sent to ${cleanNumber}! Response Message ID: ${data?.key?.id || data?.id || 'OK'}`);
  serverStats.repliesSent++;
  return data;
}

// Helper: Extract text & details from various Evolution API message formats
function parseIncomingMessage(body) {
  if (!body) return null;

  let payload = body;
  if (Array.isArray(payload)) {
    payload = payload[0] || {};
  }

  // Support both single message and event wrappers (messages.upsert)
  const event = payload.event || payload.type || 'MESSAGES_UPSERT';
  const instance = payload.instance || INSTANCE_NAME;

  // Extract raw message item
  let msgData = payload.data || payload;
  if (Array.isArray(msgData)) {
    msgData = msgData[0] || {};
  } else if (msgData.messages && Array.isArray(msgData.messages)) {
    msgData = msgData.messages[0] || {};
  }

  const key = msgData.key || payload.key || msgData.data?.key || {};
  let messageObj = msgData.message || payload.message || msgData.data?.message || {};

  // Recursively unwrap nested message containers (ephemeral, viewOnce, document, edited)
  let unwrapCount = 0;
  while (messageObj && typeof messageObj === 'object' && unwrapCount < 5) {
    unwrapCount++;
    if (messageObj.ephemeralMessage?.message) {
      messageObj = messageObj.ephemeralMessage.message;
    } else if (messageObj.viewOnceMessage?.message) {
      messageObj = messageObj.viewOnceMessage.message;
    } else if (messageObj.viewOnceMessageV2?.message) {
      messageObj = messageObj.viewOnceMessageV2.message;
    } else if (messageObj.viewOnceMessageV2Extension?.message) {
      messageObj = messageObj.viewOnceMessageV2Extension.message;
    } else if (messageObj.documentWithCaptionMessage?.message) {
      messageObj = messageObj.documentWithCaptionMessage.message;
    } else if (messageObj.editedMessage?.message?.protocolMessage?.editedMessage) {
      messageObj = messageObj.editedMessage.message.protocolMessage.editedMessage;
    } else {
      break;
    }
  }

  const rawRemoteJid = key.remoteJid || msgData.remoteJid || msgData.jid || msgData.from || payload.remoteJid || payload.from || '';
  const altRemoteJid = key.remoteJidAlt || key.participant || msgData.participant || msgData.author || '';
  
  // Prefer phone number over LID if remoteJid is @lid
  let remoteJid = rawRemoteJid;
  if (remoteJid.includes('@lid') && altRemoteJid.includes('@s.whatsapp.net')) {
    remoteJid = altRemoteJid;
  }

  const fromMe = Boolean(key.fromMe || msgData.fromMe || payload.fromMe);
  const messageId = key.id || msgData.id || payload.id || '';
  const pushName = msgData.pushName || payload.pushName || msgData.notifyName || '';

  // Extract text content from Baileys & WhatsApp message types
  let text = '';
  if (typeof messageObj === 'string') {
    text = messageObj;
  } else if (messageObj.conversation) {
    text = messageObj.conversation;
  } else if (messageObj.extendedTextMessage?.text) {
    text = messageObj.extendedTextMessage.text;
  } else if (messageObj.imageMessage?.caption) {
    text = messageObj.imageMessage.caption;
  } else if (messageObj.videoMessage?.caption) {
    text = messageObj.videoMessage.caption;
  } else if (messageObj.documentMessage?.caption) {
    text = messageObj.documentMessage.caption;
  } else if (messageObj.buttonsResponseMessage?.selectedDisplayText) {
    text = messageObj.buttonsResponseMessage.selectedDisplayText;
  } else if (messageObj.buttonsResponseMessage?.selectedButtonId) {
    text = messageObj.buttonsResponseMessage.selectedButtonId;
  } else if (messageObj.listResponseMessage?.title) {
    text = messageObj.listResponseMessage.title;
  } else if (messageObj.listResponseMessage?.singleSelectReply?.selectedRowId) {
    text = messageObj.listResponseMessage.singleSelectReply.selectedRowId;
  } else if (messageObj.templateButtonReplyMessage?.selectedDisplayText) {
    text = messageObj.templateButtonReplyMessage.selectedDisplayText;
  } else if (messageObj.interactiveResponseMessage?.body?.text) {
    text = messageObj.interactiveResponseMessage.body.text;
  } else if (messageObj.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
    try {
      const params = JSON.parse(messageObj.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
      text = params.id || params.title || params.text || '';
    } catch (e) {
      text = messageObj.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson;
    }
  } else if (messageObj.interactiveMessage?.body?.text) {
    text = messageObj.interactiveMessage.body.text;
  } else if (messageObj.viewCatalogMessage) {
    text = messageObj.viewCatalogMessage.caption || 'catalogue';
  } else if (messageObj.productMessage) {
    text = messageObj.productMessage.product?.title || messageObj.productMessage.product?.description || 'catalogue';
  } else if (messageObj.orderMessage) {
    text = messageObj.orderMessage.message || 'catalogue';
  } else if (msgData.messageText) {
    text = msgData.messageText;
  } else if (msgData.text) {
    text = msgData.text;
  } else if (msgData.body) {
    text = msgData.body;
  }

  const isGroup = remoteJid.includes('@g.us');
  const senderNumber = remoteJid.replace(/@.*$/, '');

  return {
    event,
    instance,
    remoteJid,
    senderNumber,
    messageId,
    fromMe,
    pushName,
    text: (text || '').trim(),
    isGroup,
    raw: msgData,
  };
}

// Helper: Check if message contains "catalogue" or "catalog" (case-insensitive & fuzzy variations)
function containsCatalogueKeyword(text) {
  if (!text || typeof text !== 'string') return false;
  const normalized = text.toLowerCase().trim();
  const catalogueRegex = /(catalogue|catalog|catlog|catalouge|cataloge|katalog|cataloog|pricelist|price\s*list)/i;
  return catalogueRegex.test(normalized) || normalized.includes('catalog') || normalized.includes('catalogue') || normalized.includes('catlog');
}

// ==========================================
// Webhook Route (Receives messages from Evolution API)
// ==========================================
app.post(['/webhook', '/api/webhook'], async (req, res) => {
  // Acknowledge webhook immediately to prevent timeouts
  res.status(200).json({ received: true });

  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n======================================================`);
  console.log(`📥 [WEBHOOK RECEIVED] ${timestamp}`);
  console.log(`------------------------------------------------------`);
  console.log(`RAW PAYLOAD RECEIVED IN TERMINAL:`);
  try {
    console.log(JSON.stringify(req.body, null, 2));
  } catch (err) {
    console.log(req.body);
  }
  console.log(`------------------------------------------------------`);

  try {
    const parsed = parseIncomingMessage(req.body);

    if (!parsed || (!parsed.remoteJid && !parsed.senderNumber)) {
      console.log(`⚠️ [WEBHOOK NOTICE] Received request but could not extract phone number / remoteJid.`);
      console.log(`======================================================\n`);
      return;
    }

    console.log(`📋 [PARSED MESSAGE DETAILS]:`);
    console.log(`   Event:      "${parsed.event}"`);
    console.log(`   Instance:   "${parsed.instance}"`);
    console.log(`   From User:  "${parsed.pushName || 'Unknown'}" (${parsed.senderNumber})`);
    console.log(`   RemoteJid:  "${parsed.remoteJid}"`);
    console.log(`   Text Content: "${parsed.text}"`);
    console.log(`   Message ID: "${parsed.messageId}" | fromMe: ${parsed.fromMe}`);

    const eventName = String(parsed.event || '').toUpperCase();
    
    // Process ONLY new incoming messages (MESSAGES_UPSERT or messages.upsert or empty event)
    const isUpsert = !eventName || eventName.includes('UPSERT') || eventName === 'MESSAGES.UPSERT' || eventName === 'MESSAGES_UPSERT';

    if (!isUpsert) {
      console.log(`ℹ️ [WEBHOOK SKIPPED] Event "${parsed.event}" is not an incoming message event (UPSERT).`);
      console.log(`======================================================\n`);
      return;
    }

    // Ignore messages sent by ourselves to avoid infinite loops
    if (parsed.fromMe) {
      console.log(`ℹ️ [WEBHOOK SKIPPED] Message was sent by bot itself (fromMe = true).`);
      console.log(`======================================================\n`);
      return;
    }

    serverStats.totalMessagesReceived++;

    const { remoteJid, senderNumber, messageId, pushName, text, isGroup } = parsed;

    // Deduplication check: ONLY on new incoming upsert messages
    const dedupeKey = `${remoteJid}_${messageId || text}`;
    if (isRecentlyProcessed(dedupeKey)) {
      console.log(`⚠️ [WEBHOOK SKIPPED] Duplicate message ignored for ${senderNumber} (ID: ${messageId})`);
      console.log(`======================================================\n`);
      return;
    }

    console.log(`\n📩 [MESSAGE ACCEPTED] From: ${pushName || 'User'} (${senderNumber}) | Text: "${text}"`);

    // Automatically mark the message as read
    if (messageId && remoteJid) {
      markMessageAsRead(remoteJid, messageId, false).catch((err) =>
        console.error('❌ [Auto-Read Error]:', err.message)
      );
    }

    // Check if the message contains the keyword "catalogue" or "catalog"
    const isCatalogueRequest = containsCatalogueKeyword(text);

    if (isCatalogueRequest) {
      serverStats.catalogueTriggers++;
      console.log(`🎯 [CATALOGUE KEYWORD MATCHED!] Keyword found in: "${text}" from ${senderNumber}`);

      try {
        const replyText = DEFAULT_CATALOGUE_MESSAGE;
        const result = await sendWhatsAppMessage(senderNumber, replyText);

        addActivityLog({
          type: 'CATALOGUE_AUTO_REPLY',
          status: 'SUCCESS',
          sender: senderNumber,
          senderName: pushName,
          incomingText: text,
          replyText: replyText,
          messageId: messageId,
          isGroup: isGroup,
        });

        console.log(`✅ [AUTO-REPLY SUCCESS] Successfully sent Catalogue to ${senderNumber}!`);
      } catch (sendErr) {
        console.error(`❌ [AUTO-REPLY FAILED] Error sending catalogue to ${senderNumber}:`, sendErr.message);

        addActivityLog({
          type: 'CATALOGUE_AUTO_REPLY',
          status: 'FAILED',
          sender: senderNumber,
          senderName: pushName,
          incomingText: text,
          error: sendErr.message,
          messageId: messageId,
        });
      }
    } else {
      // Regular incoming message log
      addActivityLog({
        type: 'INCOMING_MESSAGE',
        status: 'INFO',
        sender: senderNumber,
        senderName: pushName,
        incomingText: text,
        messageId: messageId,
        isGroup: isGroup,
      });
      console.log(`ℹ️ [MESSAGE LOGGED ONLY] Text "${text}" from ${senderNumber} did not match catalogue keywords.`);
    }

    console.log(`======================================================\n`);
  } catch (error) {
    console.error('❌ [WEBHOOK PROCESSING ERROR]:', error);
    console.log(`======================================================\n`);
  }
});

// ==========================================
// API Routes
// ==========================================

// 1. Direct Message Sender API (General)
app.post('/api/message/send', async (req, res) => {
  const { number, text, delay, linkPreview } = req.body;

  if (!number || !text) {
    return res.status(400).json({
      success: false,
      error: 'Both "number" and "text" fields are required.',
    });
  }

  try {
    const result = await sendWhatsAppMessage(number, text, { delay, linkPreview });

    addActivityLog({
      type: 'MANUAL_SEND',
      status: 'SUCCESS',
      sender: number,
      replyText: text,
    });

    res.json({
      success: true,
      message: 'WhatsApp message sent successfully',
      result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 2. Patient / Customer Payment Notification API (User's specific pattern)
app.post('/api/send-payment', async (req, res) => {
  const { patientName, patientMobile, paymentAmount, amountType, updatedDeposit } = req.body;

  if (!patientMobile) {
    return res.status(400).json({ success: false, error: 'patientMobile is required.' });
  }

  let message = '';
  const formattedAmount = Number(paymentAmount || 0).toLocaleString();
  const formattedDeposit = Number(updatedDeposit || 0).toLocaleString();

  if (amountType === 'advance' || amountType === 'deposit' || amountType === 'settlement') {
    message = `Dear ${patientName || 'Customer'}, your payment of Rs ${formattedAmount} has been successfully added to your account. Your updated total deposit is Rs ${formattedDeposit}. Thank you for choosing our service.`;
  } else if (amountType === 'refund') {
    message = `Dear ${patientName || 'Customer'}, a refund of Rs ${formattedAmount} has been processed to your account. Your updated total deposit is Rs ${formattedDeposit}.`;
  } else {
    message = `Dear ${patientName || 'Customer'}, your transaction of Rs ${formattedAmount} has been processed. Total balance: Rs ${formattedDeposit}.`;
  }

  try {
    const result = await sendWhatsAppMessage(patientMobile, message);
    res.json({ success: true, message: 'Payment notification sent successfully', result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Status & Health Check API
app.get('/api/status', async (req, res) => {
  let instanceState = 'unknown';
  let instanceData = null;

  try {
    const response = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${INSTANCE_NAME}`, {
      headers: getApiHeaders(),
    });
    if (response.ok) {
      instanceData = await response.json();
      instanceState = instanceData?.instance?.state || 'open';
    }
  } catch (err) {
    instanceState = 'unreachable';
  }

  res.json({
    success: true,
    server: {
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: serverStats.startedAt,
      stats: serverStats,
    },
    evolution: {
      apiUrl: EVOLUTION_API_URL,
      instanceName: INSTANCE_NAME,
      connectionStatus: instanceState,
      apiKeyConfigured: Boolean(API_KEY),
      catalogueUrl: CATALOGUE_URL,
      autoReadMessages: AUTO_READ_MESSAGES,
    },
  });
});

// 4. Activity Logs API
app.get('/api/logs', (req, res) => {
  res.json({
    success: true,
    logs: activityLogs,
    stats: serverStats,
  });
});

// 5. Test Trigger Simulator (Test the Catalogue auto-reply logic locally)
app.post('/api/test-trigger', async (req, res) => {
  const { testMessage = 'Can you send the catalogue?', testSender = '919876543210', senderName = 'Test User' } = req.body;
  const isMatch = containsCatalogueKeyword(testMessage);

  let replySent = false;
  let replyError = null;

  if (isMatch && req.body.sendRealMessage) {
    try {
      await sendWhatsAppMessage(testSender, DEFAULT_CATALOGUE_MESSAGE);
      replySent = true;
    } catch (err) {
      replyError = err.message;
    }
  }

  res.json({
    success: true,
    matched: isMatch,
    testMessage,
    catalogueUrl: CATALOGUE_URL,
    preparedReply: isMatch ? DEFAULT_CATALOGUE_MESSAGE : null,
    sentRealMessage: replySent,
    error: replyError,
  });
});

// 6. Webhook Configuration Assistant
app.post('/api/webhook/configure', async (req, res) => {
  const { webhookUrl } = req.body;

  if (!webhookUrl) {
    return res.status(400).json({ success: false, error: 'webhookUrl is required.' });
  }

  try {
    const response = await fetch(`${EVOLUTION_API_URL}/webhook/set/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          base64: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE'],
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: data });
    }

    res.json({
      success: true,
      message: `Webhook successfully configured for instance "${INSTANCE_NAME}"`,
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Root Route fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n======================================================`);
  console.log(`🌸 Zari WhatsApp Catalogue Auto-Reply Server`);
  console.log(`======================================================`);
  console.log(`🚀 Server Running on: http://localhost:${PORT}`);
  console.log(`📡 Evolution API URL: ${EVOLUTION_API_URL}`);
  console.log(`📱 Instance Name:    ${INSTANCE_NAME}`);
  console.log(`🔑 API Key Config:   ${API_KEY ? 'Configured ✅' : 'Missing ❌'}`);
  console.log(`🛍️  Catalogue URL:    ${CATALOGUE_URL}`);
  console.log(`👀 Auto Mark Read:   ${AUTO_READ_MESSAGES ? 'Enabled ✅' : 'Disabled'}`);
  console.log(`🔗 Webhook Endpoint: http://localhost:${PORT}/webhook`);
  console.log(`🖥️  Admin Dashboard:  http://localhost:${PORT}/`);
  console.log(`======================================================\n`);

  // Quick verify instance connection on startup
  try {
    const checkRes = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${INSTANCE_NAME}`, {
      headers: getApiHeaders(),
    });
    if (checkRes.ok) {
      const stateData = await checkRes.json();
      console.log(`🟢 WhatsApp Instance "${INSTANCE_NAME}" Status: ${stateData?.instance?.state || 'open'}`);
    } else {
      console.warn(`⚠️ Could not verify instance "${INSTANCE_NAME}" status (HTTP ${checkRes.status})`);
    }
  } catch (e) {
    console.warn(`⚠️ Instance check warning: ${e.message}`);
  }
});
