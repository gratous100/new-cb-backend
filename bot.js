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
// 🤖 BOT INITIALIZATION
// ============================================================================

const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    autoStart: true,
    params: { timeout: 10 }
  }
});

bot.getMe().then(() => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`✅ BOT CONNECTED`);
  console.log(`📍 Bot is listening for button clicks...`);
  console.log(`${"=".repeat(60)}\n`);
}).catch(err => {
  console.error("❌ Bot connection failed:", err.message);
});

// ============================================================================
// 🔘 CALLBACK HANDLERS - Button clicks
// ============================================================================

const handledCallbacks = new Set();

bot.on("callback_query", async (query) => {
  const callbackId = query.id;
  
  // Prevent duplicate processing
  if (handledCallbacks.has(callbackId)) {
    console.log(`⚠️ Duplicate callback ignored`);
    return;
  }
  handledCallbacks.add(callbackId);

  try {
    const data = query.data;
    const [action, email] = data.split("|");

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔘 BUTTON CLICKED`);
    console.log(`${"=".repeat(60)}`);
    console.log(`   📧 Email: ${email}`);
    console.log(`   ⚙️  Action: ${action}`);
    console.log(`   👤 From: @${query.from.username || query.from.first_name}`);

    // Update status via backend
    console.log(`\n📤 UPDATING STATUS`);
    const response = await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        status: action
      })
    });

    if (response.ok) {
      console.log(`   ✅ Status updated successfully`);
      console.log(`${"=".repeat(60)}\n`);
    } else {
      console.error("   ❌ Failed to update status");
    }

    // Acknowledge callback with popup
    bot.answerCallbackQuery(callbackId, {
      text: `✅ ${action.toUpperCase()}`,
      show_alert: false
    }).catch(err => console.error("Failed to answer callback:", err.message));

  } catch (err) {
    console.error("❌ Callback error:", err.message);
    bot.answerCallbackQuery(query.id, {
      text: "❌ Error processing request",
      show_alert: true
    }).catch(() => {});
  }
});

console.log(`${"=".repeat(60)}`);
console.log(`✅ BOT.JS READY`);
console.log(`📍 Listening for Telegram callbacks...`);
console.log(`${"=".repeat(60)}\n`);

module.exports = { bot };
