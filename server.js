require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration from Environment Variables
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'https://evo.infispark.in').replace(/\/+$/, '');
const API_KEY = process.env.WHATSAPP_API_KEY || process.env.EVOLUTION_API_KEY || 'vR39h6avY69g7kAU3YQbS6V6XEvudson';
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'zari';
const CATALOGUE_URL = process.env.CATALOGUE_URL || 'https://wa.me/c/919423185940';
const AUTO_READ_MESSAGES = process.env.AUTO_READ_MESSAGES !== 'false';
const REPLY_DELAY_MS = parseInt(process.env.REPLY_DELAY_MS || '1000', 10);
const WEBHOOK_PUBLIC_URL = process.env.WEBHOOK_PUBLIC_URL || process.env.WEBHOOK_URL || process.env.PUBLIC_URL || process.env.APP_URL || process.env.COOLIFY_URL || '';

// Persistent Rules Storage
const DATA_DIR = path.join(__dirname, 'data');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');

// Default Reply Message Template
const DEFAULT_CATALOGUE_MESSAGE = `Hello! Thank you for reaching out to us. 🌸

Here is our official product Catalogue:
👉 ${CATALOGUE_URL}

Please browse through our collection. Feel free to message us here if you have any questions or would like to place an order! 😊`;

function getDefaultRules() {
  return [
    {
      id: 'rule-default-catalogue',
      name: 'Catalogue Auto-Reply (Default)',
      instance: '*',
      phoneNumbers: [],
      keywords: [
        'catalogue',
        'catalog',
        'catlog',
        'catalouge',
        'katalog',
        'cataloog',
        'pricelist',
        'price list',
        'brochure',
        'collection',
      ],
      matchType: 'contains',
      replyMessage: DEFAULT_CATALOGUE_MESSAGE,
      enabled: true,
      createdAt: new Date().toISOString(),
    },
  ];
}

function loadRules() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(RULES_FILE)) {
      const defaults = getDefaultRules();
      fs.writeFileSync(RULES_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
      return defaults;
    }
    const raw = fs.readFileSync(RULES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return getDefaultRules();
  } catch (err) {
    console.error('⚠️ [Rules Load Error]:', err.message);
    return getDefaultRules();
  }
}

function saveRules(rules) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('❌ [Rules Save Error]:', err.message);
    return false;
  }
}

// Helper: Dynamic variable substitution in reply template
function renderReplyMessage(template, context = {}) {
  if (!template) return '';
  const { name = '', sender = '', catalogueUrl = CATALOGUE_URL, instance = INSTANCE_NAME } = context;
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, name || 'there')
    .replace(/\{\{\s*sender\s*\}\}/gi, sender || '')
    .replace(/\{\{\s*catalogue_url\s*\}\}/gi, catalogueUrl)
    .replace(/\{\{\s*instance\s*\}\}/gi, instance);
}

// Clean phone number helper
function cleanPhoneNumber(num) {
  if (!num) return '';
  return String(num).replace(/@.*$/, '').replace(/[^0-9]/g, '');
}

// Match Rule Engine
function findMatchingRule(text, senderNumber, instanceName) {
  if (!text || typeof text !== 'string') {
    return { matched: false };
  }

  const normalizedText = text.toLowerCase().trim();
  const cleanedSender = cleanPhoneNumber(senderNumber);
  const currentInstance = (instanceName || INSTANCE_NAME).toLowerCase().trim();

  const rules = loadRules();
  const activeRules = rules.filter((r) => r.enabled !== false);

  // Group rules into: (1) Specific Phone Number Rules (higher priority), (2) Wildcard / All User Rules
  const specificUserRules = [];
  const globalRules = [];

  for (const rule of activeRules) {
    // Check instance match: '*' or matches currentInstance
    const ruleInstance = (rule.instance || '*').toLowerCase().trim();
    if (ruleInstance !== '*' && ruleInstance !== currentInstance) {
      continue;
    }

    const ruleNumbers = Array.isArray(rule.phoneNumbers)
      ? rule.phoneNumbers.map(cleanPhoneNumber).filter(Boolean)
      : [];

    if (ruleNumbers.length > 0 && !ruleNumbers.includes('*')) {
      specificUserRules.push({ rule, numbers: ruleNumbers });
    } else {
      globalRules.push(rule);
    }
  }

  // 1. Check specific user rules first
  for (const item of specificUserRules) {
    const isTargetUser = item.numbers.some((num) => {
      if (!num || !cleanedSender) return false;
      return cleanedSender === num || cleanedSender.endsWith(num) || num.endsWith(cleanedSender);
    });

    if (isTargetUser && isKeywordMatch(normalizedText, item.rule)) {
      return {
        matched: true,
        rule: item.rule,
        replyText: renderReplyMessage(item.rule.replyMessage, {
          sender: cleanedSender,
          instance: instanceName || INSTANCE_NAME,
        }),
      };
    }
  }

  // 2. Check global rules
  for (const rule of globalRules) {
    if (isKeywordMatch(normalizedText, rule)) {
      return {
        matched: true,
        rule: rule,
        replyText: renderReplyMessage(rule.replyMessage, {
          sender: cleanedSender,
          instance: instanceName || INSTANCE_NAME,
        }),
      };
    }
  }

  return { matched: false };
}

function isKeywordMatch(normalizedText, rule) {
  const keywords = Array.isArray(rule.keywords)
    ? rule.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean)
    : [];

  if (keywords.length === 0) return false;

  const matchType = rule.matchType || 'contains';

  if (matchType === 'exact') {
    return keywords.some((kw) => normalizedText === kw);
  }

  // Default: contains keyword
  return keywords.some((kw) => {
    if (!kw) return false;
    // Check if substring exists
    if (normalizedText.includes(kw)) return true;
    // Word boundary regex for clean match
    try {
      const regex = new RegExp(`(^|\\s|[^a-zA-Z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[^a-zA-Z0-9])`, 'i');
      return regex.test(normalizedText);
    } catch {
      return normalizedText.includes(kw);
    }
  });
}

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

// Deduplication Cache to prevent duplicate replies within 15 seconds
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
async function markMessageAsRead(remoteJid, messageId, fromMe = false, targetInstance = INSTANCE_NAME) {
  if (!AUTO_READ_MESSAGES || !messageId || !remoteJid) return;

  const instance = targetInstance || INSTANCE_NAME;
  const url = `${EVOLUTION_API_URL}/chat/markMessageAsRead/${instance}`;
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
      console.log(`[Read Receipt] Marked message ${messageId} as read on instance "${instance}".`);
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

  const cleanNumber = cleanPhoneNumber(number);
  const targetInstance = options.instance && options.instance !== '*' ? options.instance : INSTANCE_NAME;
  const url = `${EVOLUTION_API_URL}/message/sendText/${targetInstance}`;

  const payload = {
    number: cleanNumber,
    text: text,
    delay: options.delay || REPLY_DELAY_MS,
    linkPreview: options.linkPreview !== undefined ? options.linkPreview : true,
  };

  console.log(`\n📤 [OUTGOING REQUEST] Sending WhatsApp message to: ${cleanNumber} (Instance: ${targetInstance})`);
  console.log(`   URL: ${url}`);
  console.log(`   Text Preview: "${text.substring(0, 80).replace(/\n/g, ' ')}..."`);

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

  console.log(`✅ [OUTGOING SUCCESS] Message sent to ${cleanNumber}! Response ID: ${data?.key?.id || data?.id || 'OK'}`);
  serverStats.repliesSent++;
  return data;
}

// Helper: Extract text & details from Evolution API message formats
function parseIncomingMessage(body) {
  if (!body) return null;

  let payload = body;
  if (Array.isArray(payload)) {
    payload = payload[0] || {};
  }

  const event = payload.event || payload.type || 'MESSAGES_UPSERT';
  const instance = payload.instance || INSTANCE_NAME;

  let msgData = payload.data || payload;
  if (Array.isArray(msgData)) {
    msgData = msgData[0] || {};
  } else if (msgData.messages && Array.isArray(msgData.messages)) {
    msgData = msgData.messages[0] || {};
  }

  const key = msgData.key || payload.key || msgData.data?.key || {};
  let messageObj = msgData.message || payload.message || msgData.data?.message || {};

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

  let remoteJid = rawRemoteJid;
  if (remoteJid.includes('@lid') && altRemoteJid.includes('@s.whatsapp.net')) {
    remoteJid = altRemoteJid;
  }

  const fromMe = Boolean(key.fromMe || msgData.fromMe || payload.fromMe);
  const messageId = key.id || msgData.id || payload.id || '';
  const pushName = msgData.pushName || payload.pushName || msgData.notifyName || '';

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
  } else if (msgData.conversation) {
    text = msgData.conversation;
  } else if (msgData.caption) {
    text = msgData.caption;
  } else if (msgData.content) {
    text = msgData.content;
  } else if (payload.conversation) {
    text = payload.conversation;
  } else if (payload.caption) {
    text = payload.caption;
  } else if (payload.text) {
    text = payload.text;
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
    const isUpsert = !eventName || eventName.includes('UPSERT') || eventName === 'MESSAGES.UPSERT' || eventName === 'MESSAGES_UPSERT';

    if (!isUpsert) {
      console.log(`ℹ️ [WEBHOOK SKIPPED] Event "${parsed.event}" is not an incoming message event (UPSERT).`);
      console.log(`======================================================\n`);
      return;
    }

    // Ignore messages sent by bot itself to avoid infinite loops
    if (parsed.fromMe) {
      console.log(`ℹ️ [WEBHOOK SKIPPED] Message was sent by bot itself (fromMe = true).`);
      console.log(`======================================================\n`);
      return;
    }

    serverStats.totalMessagesReceived++;

    const { remoteJid, senderNumber, messageId, pushName, text, isGroup, instance } = parsed;

    // Deduplication check
    const dedupeKey = `${remoteJid}_${messageId || text}`;
    if (isRecentlyProcessed(dedupeKey)) {
      console.log(`⚠️ [WEBHOOK SKIPPED] Duplicate message ignored for ${senderNumber} (ID: ${messageId})`);
      console.log(`======================================================\n`);
      return;
    }

    console.log(`\n📩 [MESSAGE ACCEPTED] From: ${pushName || 'User'} (${senderNumber}) | Text: "${text}"`);

    // Automatically mark the message as read
    if (messageId && remoteJid) {
      markMessageAsRead(remoteJid, messageId, false, instance).catch((err) =>
        console.error('❌ [Auto-Read Error]:', err.message)
      );
    }

    // Check matching rule via Rule Engine
    const matchResult = findMatchingRule(text, senderNumber, instance);

    if (matchResult.matched && matchResult.rule) {
      serverStats.catalogueTriggers++;
      const { rule, replyText } = matchResult;

      console.log(`🎯 [RULE MATCHED: "${rule.name}"] For sender: ${senderNumber} on instance "${instance}"`);
      console.log(`   Preparing reply: "${replyText.substring(0, 60).replace(/\n/g, ' ')}..."`);

      try {
        const targetInstance = rule.instance && rule.instance !== '*' ? rule.instance : instance;
        const result = await sendWhatsAppMessage(senderNumber, replyText, { instance: targetInstance });

        addActivityLog({
          type: 'AUTO_REPLY',
          ruleId: rule.id,
          ruleName: rule.name,
          status: 'SUCCESS',
          sender: senderNumber,
          senderName: pushName,
          incomingText: text,
          replyText: replyText,
          messageId: messageId,
          isGroup: isGroup,
          instance: targetInstance,
        });

        console.log(`✅ [AUTO-REPLY SUCCESS] Sent rule "${rule.name}" response to ${senderNumber}!`);
      } catch (sendErr) {
        console.error(`❌ [AUTO-REPLY FAILED] Error sending response to ${senderNumber}:`, sendErr.message);

        addActivityLog({
          type: 'AUTO_REPLY',
          ruleId: rule.id,
          ruleName: rule.name,
          status: 'FAILED',
          sender: senderNumber,
          senderName: pushName,
          incomingText: text,
          replyText: replyText,
          error: sendErr.message,
          messageId: messageId,
          instance: instance,
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
        instance: instance,
      });
      console.log(`ℹ️ [MESSAGE LOGGED ONLY] Text "${text}" from ${senderNumber} did not match any active rules.`);
    }

    console.log(`======================================================\n`);
  } catch (error) {
    console.error('❌ [WEBHOOK PROCESSING ERROR]:', error);
    console.log(`======================================================\n`);
  }
});

// ==========================================
// Rules CRUD API Routes
// ==========================================

// Get all rules
app.get('/api/rules', (req, res) => {
  const rules = loadRules();
  res.json({
    success: true,
    rules: rules,
    defaultCatalogueUrl: CATALOGUE_URL,
    defaultTemplate: DEFAULT_CATALOGUE_MESSAGE,
  });
});

// Create or update a rule
app.post('/api/rules', (req, res) => {
  const { id, name, instance, phoneNumbers, keywords, matchType, replyMessage, enabled } = req.body;

  if (!name || !keywords || !replyMessage) {
    return res.status(400).json({
      success: false,
      error: 'Rule "name", "keywords", and "replyMessage" are required fields.',
    });
  }

  const rules = loadRules();
  const ruleId = id || `rule-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

  // Normalize keywords (array or comma-separated string)
  let parsedKeywords = [];
  if (Array.isArray(keywords)) {
    parsedKeywords = keywords.map((k) => String(k).trim()).filter(Boolean);
  } else if (typeof keywords === 'string') {
    parsedKeywords = keywords.split(',').map((k) => k.trim()).filter(Boolean);
  }

  // Normalize phone numbers (array or comma-separated string)
  let parsedNumbers = [];
  if (Array.isArray(phoneNumbers)) {
    parsedNumbers = phoneNumbers.map(cleanPhoneNumber).filter(Boolean);
  } else if (typeof phoneNumbers === 'string') {
    parsedNumbers = phoneNumbers
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n && n !== '*')
      .map(cleanPhoneNumber)
      .filter(Boolean);
  }

  const existingIndex = rules.findIndex((r) => r.id === ruleId);
  const ruleObj = {
    id: ruleId,
    name: name.trim(),
    instance: (instance || '*').trim(),
    phoneNumbers: parsedNumbers,
    keywords: parsedKeywords,
    matchType: matchType === 'exact' ? 'exact' : 'contains',
    replyMessage: replyMessage.trim(),
    enabled: enabled !== undefined ? Boolean(enabled) : true,
    updatedAt: new Date().toISOString(),
    createdAt: existingIndex >= 0 ? rules[existingIndex].createdAt || new Date().toISOString() : new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    rules[existingIndex] = ruleObj;
  } else {
    rules.push(ruleObj);
  }

  if (saveRules(rules)) {
    res.json({
      success: true,
      message: existingIndex >= 0 ? 'Rule updated successfully' : 'Rule created successfully',
      rule: ruleObj,
    });
  } else {
    res.status(500).json({ success: false, error: 'Failed to persist rules file.' });
  }
});

// Update specific rule by ID
app.put('/api/rules/:id', (req, res) => {
  const { id } = req.params;
  const rules = loadRules();
  const existingIndex = rules.findIndex((r) => r.id === id);

  if (existingIndex === 0 && !rules[existingIndex]) {
    return res.status(404).json({ success: false, error: `Rule with ID "${id}" not found.` });
  }

  const current = rules[existingIndex] || {};
  const { name, instance, phoneNumbers, keywords, matchType, replyMessage, enabled } = req.body;

  let parsedKeywords = current.keywords || [];
  if (keywords !== undefined) {
    parsedKeywords = Array.isArray(keywords)
      ? keywords.map((k) => String(k).trim()).filter(Boolean)
      : String(keywords).split(',').map((k) => k.trim()).filter(Boolean);
  }

  let parsedNumbers = current.phoneNumbers || [];
  if (phoneNumbers !== undefined) {
    parsedNumbers = Array.isArray(phoneNumbers)
      ? phoneNumbers.map(cleanPhoneNumber).filter(Boolean)
      : String(phoneNumbers)
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n && n !== '*')
          .map(cleanPhoneNumber)
          .filter(Boolean);
  }

  const updatedRule = {
    ...current,
    id: id,
    name: name !== undefined ? String(name).trim() : current.name,
    instance: instance !== undefined ? String(instance).trim() : current.instance || '*',
    phoneNumbers: parsedNumbers,
    keywords: parsedKeywords,
    matchType: matchType !== undefined ? (matchType === 'exact' ? 'exact' : 'contains') : current.matchType || 'contains',
    replyMessage: replyMessage !== undefined ? String(replyMessage).trim() : current.replyMessage,
    enabled: enabled !== undefined ? Boolean(enabled) : current.enabled !== false,
    updatedAt: new Date().toISOString(),
  };

  rules[existingIndex] = updatedRule;

  if (saveRules(rules)) {
    res.json({ success: true, message: 'Rule updated successfully', rule: updatedRule });
  } else {
    res.status(500).json({ success: false, error: 'Failed to update rule.' });
  }
});

// Delete a rule by ID
app.delete('/api/rules/:id', (req, res) => {
  const { id } = req.params;
  let rules = loadRules();
  const initialLength = rules.length;
  rules = rules.filter((r) => r.id !== id);

  if (rules.length === initialLength) {
    return res.status(404).json({ success: false, error: `Rule "${id}" not found.` });
  }

  if (saveRules(rules)) {
    res.json({ success: true, message: 'Rule deleted successfully' });
  } else {
    res.status(500).json({ success: false, error: 'Failed to save rules file after deletion.' });
  }
});

// Reset rules to default
app.post('/api/rules/reset', (req, res) => {
  const defaults = getDefaultRules();
  if (saveRules(defaults)) {
    res.json({ success: true, message: 'Rules reset to default successfully', rules: defaults });
  } else {
    res.status(500).json({ success: false, error: 'Failed to reset rules.' });
  }
});

// ==========================================
// Standard API Routes
// ==========================================

// 1. Direct Message Sender API (General)
app.post('/api/message/send', async (req, res) => {
  const { number, text, delay, linkPreview, instance } = req.body;

  if (!number || !text) {
    return res.status(400).json({
      success: false,
      error: 'Both "number" and "text" fields are required.',
    });
  }

  try {
    const result = await sendWhatsAppMessage(number, text, { delay, linkPreview, instance });

    addActivityLog({
      type: 'MANUAL_SEND',
      status: 'SUCCESS',
      sender: number,
      replyText: text,
      instance: instance || INSTANCE_NAME,
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

// 2. Patient / Customer Payment Notification API
app.post('/api/send-payment', async (req, res) => {
  const { patientName, patientMobile, paymentAmount, amountType, updatedDeposit, instance } = req.body;

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
    const result = await sendWhatsAppMessage(patientMobile, message, { instance });
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

  const rules = loadRules();
  const activeRulesCount = rules.filter((r) => r.enabled !== false).length;

  res.json({
    success: true,
    server: {
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt: serverStats.startedAt,
      stats: serverStats,
      rulesCount: rules.length,
      activeRulesCount: activeRulesCount,
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

// 5. Test Trigger Simulator (Test custom keyword rules for any number and instance)
app.post('/api/test-trigger', async (req, res) => {
  const {
    testMessage = 'Can you send the catalogue?',
    testSender = '919876543210',
    testInstance = INSTANCE_NAME,
    sendRealMessage = false,
  } = req.body;

  const matchResult = findMatchingRule(testMessage, testSender, testInstance);

  let replySent = false;
  let replyError = null;

  if (matchResult.matched && sendRealMessage) {
    try {
      await sendWhatsAppMessage(testSender, matchResult.replyText, { instance: testInstance });
      replySent = true;
    } catch (err) {
      replyError = err.message;
    }
  }

  res.json({
    success: true,
    matched: matchResult.matched,
    matchedRule: matchResult.rule || null,
    testMessage,
    testSender,
    testInstance,
    preparedReply: matchResult.replyText || null,
    sentRealMessage: replySent,
    error: replyError,
  });
});

// 6. Webhook Configuration Assistant
app.post('/api/webhook/configure', async (req, res) => {
  const { webhookUrl, instanceName } = req.body;

  if (!webhookUrl) {
    return res.status(400).json({ success: false, error: 'webhookUrl is required.' });
  }

  const targetInstance = instanceName || INSTANCE_NAME;

  try {
    const response = await fetch(`${EVOLUTION_API_URL}/webhook/set/${targetInstance}`, {
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
      message: `Webhook successfully configured for instance "${targetInstance}"`,
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
  console.log(`🌸 Zari WhatsApp Automation Server`);
  console.log(`======================================================`);
  console.log(`🚀 Server Running on: http://0.0.0.0:${PORT}`);
  console.log(`📡 Evolution API URL: ${EVOLUTION_API_URL}`);
  console.log(`📱 Instance Name:    ${INSTANCE_NAME}`);
  console.log(`🔑 API Key Config:   ${API_KEY ? 'Configured ✅' : 'Missing ❌'}`);
  console.log(`🛍️  Catalogue URL:    ${CATALOGUE_URL}`);
  console.log(`📋 Rules Loaded:     ${loadRules().length} rule(s) configured`);
  console.log(`👀 Auto Mark Read:   ${AUTO_READ_MESSAGES ? 'Enabled ✅' : 'Disabled'}`);
  console.log(`🔗 Webhook Public:   ${WEBHOOK_PUBLIC_URL || 'Not configured in env (use WEBHOOK_PUBLIC_URL)'}`);
  console.log(`🖥️  Admin Dashboard:  http://0.0.0.0:${PORT}/`);
  console.log(`======================================================\n`);

  // Auto-sync Webhook URL with Evolution API on startup if WEBHOOK_PUBLIC_URL is configured
  if (WEBHOOK_PUBLIC_URL) {
    let targetWebhookUrl = WEBHOOK_PUBLIC_URL.trim();
    if (!targetWebhookUrl.endsWith('/webhook') && !targetWebhookUrl.endsWith('/api/webhook')) {
      targetWebhookUrl = `${targetWebhookUrl.replace(/\/+$/, '')}/webhook`;
    }
    console.log(`📡 Auto-configuring Webhook in Evolution API to: ${targetWebhookUrl}...`);
    try {
      const setRes = await fetch(`${EVOLUTION_API_URL}/webhook/set/${INSTANCE_NAME}`, {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: targetWebhookUrl,
            byEvents: false,
            base64: false,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE'],
          },
        }),
      });
      const setData = await setRes.json().catch(() => ({}));
      if (setRes.ok) {
        console.log(`✅ Webhook URL successfully registered in Evolution API!`);
      } else {
        console.warn(`⚠️ Could not auto-register webhook in Evolution API (HTTP ${setRes.status}):`, setData);
      }
    } catch (whErr) {
      console.warn(`⚠️ Error auto-registering webhook in Evolution API: ${whErr.message}`);
    }
  }

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
