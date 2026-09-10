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

bot.getMe().then((me) => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`✅ BOT CONNECTED`);
  console.log(`🤖 Bot Username: @${me.username}`);
  console.log(`🤖 Bot ID: ${me.id}`);
  console.log(`📍 Bot is listening for button clicks...`);
  console.log(`${"=".repeat(60)}\n`);
}).catch(err => {
  console.error("❌ Bot connection failed:", err.message);
});

// ============================================================================
// 🔘 DEBUG: ALL MESSAGE TYPES
// ============================================================================

bot.on("message", (msg) => {
  console.log(`\n💬 MESSAGE RECEIVED (DEBUG)`);
  console.log(`   Type: ${msg.chat.type}`);
  console.log(`   From: @${msg.from.username || msg.from.first_name}`);
  console.log(`   Text: ${msg.text}`);
});

bot.on("callback_query", async (query) => {
  const callbackId = query.id;
  
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔘🔘🔘 CALLBACK QUERY RECEIVED 🔘🔘🔘`);
  console.log(`${"=".repeat(60)}`);
  console.log(`   Callback ID: ${callbackId}`);
  console.log(`   Data: "${query.data}"`);
  console.log(`   From: @${query.from.username || query.from.first_name}`);
  console.log(`   Message ID: ${query.message?.message_id}`);
  console.log(`   Chat ID: ${query.message?.chat?.id}`);
  
  // Prevent duplicate processing
  if (handledCallbacks.has(callbackId)) {
    console.log(`   ⚠️ DUPLICATE - IGNORING`);
    return;
  }
  handledCallbacks.add(callbackId);
  console.log(`   ✅ Not a duplicate - processing...`);

  try {
    console.log(`\n   🔍 PARSING DATA...`);
    const data = query.data;
    console.log(`   Raw data: "${data}"`);
    
    const parts = data.split("|");
    console.log(`   Split parts: [${parts[0]}, ${parts[1]}]`);
    
    const action = parts[0];
    const email = parts[1];
    
    console.log(`   ✅ Parsed successfully!`);
    console.log(`      Action: "${action}"`);
    console.log(`      Email: "${email}"`);

    if (!action || !email) {
      console.log(`   ❌ ACTION or EMAIL is empty!`);
      return;
    }

    console.log(`\n   📤 SENDING TO BACKEND...`);
    console.log(`      URL: ${APP_URL}/update-status`);
    console.log(`      Method: POST`);
    console.log(`      Body: { email: "${email}", status: "${action}" }`);
    
    const response = await fetch(`${APP_URL}/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        status: action
      })
    });

    console.log(`\n   📥 BACKEND RESPONSE...`);
    console.log(`      Status Code: ${response.status}`);
    console.log(`      Status Text: ${response.statusText}`);
    
    const responseBody = await response.json();
    console.log(`      Body:`, responseBody);

    if (response.ok) {
      console.log(`   ✅✅✅ BACKEND UPDATED SUCCESSFULLY!`);
      console.log(`   Frontend should receive status: ${action === "page1" ? "accepted1" : action === "page2" ? "accepted2" : "rejected"}`);
      
      // ============================================================================
      // 📝 STEP 1: EDIT ORIGINAL MESSAGE - REMOVE BUTTONS
      // ============================================================================
      
      console.log(`\n   📝 STEP 1: REMOVING BUTTONS FROM ORIGINAL MESSAGE...`);
      
      try {
        const botToken = process.env.BOT_TOKEN;
        const chatId = process.env.ADMIN_CHAT_ID;
        const messageId = query.message?.message_id;
        const originalText = query.message?.text;
        
        if (!messageId || !originalText) {
          console.error(`      ❌ No message ID or text found!`);
          return;
        }
        
        // Edit message to remove buttons (keep text only)
        const editUrl = `https://api.telegram.org/bot${botToken}/editMessageText`;
        const editResponse = await fetch(editUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: originalText,
            parse_mode: "HTML"
            // No reply_markup = buttons removed!
          })
        });
        
        if (editResponse.ok) {
          console.log(`      ✅ Buttons removed from original message!`);
        } else {
          console.error(`      ❌ Failed to edit message`);
        }
      } catch (err) {
        console.error(`      ❌ Error editing message:`, err.message);
      }
      
      // ============================================================================
      // 📢 STEP 2: SEND SEPARATE STATUS REPLY MESSAGE
      // ============================================================================
      
      console.log(`\n   📢 STEP 2: SENDING STATUS REPLY MESSAGE...`);
      
      let statusMessage = "";
      if (action === "page1") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "page2") {
        statusMessage = `📧 <code>${email}</code> has been <b>ACCEPTED</b>! ✅`;
      } else if (action === "reject") {
        statusMessage = `📧 <code>${email}</code> has been <b>REJECTED</b>! ❌`;
      }
      
      try {
        const botToken = process.env.BOT_TOKEN;
        const chatId = process.env.ADMIN_CHAT_ID;
        const messageId = query.message?.message_id;
        
        // Send as a reply to the original message
        const replyUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const replyResponse = await fetch(replyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: statusMessage,
            parse_mode: "HTML",
            reply_to_message_id: messageId
          })
        });
        
        if (replyResponse.ok) {
          console.log(`      ✅ Status reply sent!`);
          console.log(`      Message: ${statusMessage}`);
        } else {
          console.error(`      ❌ Failed to send reply`);
        }
      } catch (err) {
        console.error(`      ❌ Error sending reply:`, err.message);
      }
    }

    console.log(`\n   🔔 ANSWERING CALLBACK QUERY...`);
    const answerText = `✅ ${action.toUpperCase()}`;
    console.log(`      Text: ${answerText}`);
    
    await bot.answerCallbackQuery(callbackId, {
      text: answerText,
      show_alert: false
    });
    
    console.log(`   ✅ Callback answered!`);
    console.log(`${"=".repeat(60)}\n`);

  } catch (err) {
    console.error(`\n   ❌❌❌ ERROR IN CALLBACK HANDLER!`);
    console.error(`      Error: ${err.message}`);
    console.error(`      Stack: ${err.stack}`);
    
    try {
      await bot.answerCallbackQuery(query.id, {
        text: "❌ Error processing request",
        show_alert: true
      });
    } catch (e) {
      console.error(`   ❌ Failed to answer callback:`, e.message);
    }
  }
});

const handledCallbacks = new Set();

bot.on("polling_error", (err) => {
  console.error(`\n❌ POLLING ERROR:`);
  console.error(`   Code: ${err.code}`);
  console.error(`   Message: ${err.message}`);
});

console.log(`${"=".repeat(60)}`);
console.log(`✅ BOT.JS READY - DEBUG MODE`);
console.log(`📍 Waiting for button clicks...`);
console.log(`${"=".repeat(60)}\n`);

module.exports = { bot };
