const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function getBotsFromEnv() {
  if (!process.env.BOTS_CONFIG_JSON) return [];
  try {
    const parsed = JSON.parse(process.env.BOTS_CONFIG_JSON);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return Object.values(parsed);
    return [];
  } catch (e) {
    return [];
  }
}

function getBotsFromLocalFile() {
  const filePath = path.join(__dirname, "bots_config.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && parsed.bots && Array.isArray(parsed.bots)) return parsed.bots;
    if (parsed && typeof parsed === "object") return Object.values(parsed);
    return [];
  } catch (e) {
    return [];
  }
}

async function getBotsFromRemotePhp() {
  const remoteUrl = process.env.REMOTE_BOTS_CONFIG_URL;
  if (!remoteUrl) return [];
  try {
    const res = await fetch(`${remoteUrl}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const parsed = await res.json();
    if (parsed && parsed.bots && Array.isArray(parsed.bots)) return parsed.bots;
    if (parsed && typeof parsed === "object") return Object.values(parsed);
    return [];
  } catch (e) {
    return [];
  }
}

async function getActiveBots(slots) {
  let bots = await getBotsFromRemotePhp();
  if (!bots.length) bots = getBotsFromEnv();
  if (!bots.length) bots = getBotsFromLocalFile();

  const allowedSlots = Array.isArray(slots) && slots.length
    ? slots.map((n) => Number(n))
    : Array.from({ length: 25 }, (_, i) => i + 1);

  return bots.filter((b) => {
    const num = Number(b.bot_number);
    const hasCreds = Boolean(b && b.token && String(b.token).trim() && b.chat_id && String(b.chat_id).trim());
    const isEnabled = b && (b.enabled === true || b.enabled === "true" || b.enabled === 1);
    return isEnabled && hasCreds && allowedSlots.includes(num);
  });
}

async function sendToTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${String(token).trim()}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: String(chatId).trim(),
      text,
      parse_mode: "HTML"
    })
  });
  return res.json();
}

app.get("/", (req, res) => {
  res.json({ ok: true, service: "Render Telegram Dispatcher Running" });
});

app.post("/api/dispatch", async (req, res) => {
  try {
    const { message, gateway, amount, slots, action } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ ok: false, error: "Message is required" });
    }

    const activeBots = await getActiveBots(slots);
    if (!activeBots.length) {
      return res.status(200).json({
        ok: false,
        error: "No active enabled bots with token and chat_id found"
      });
    }

    const formattedMessage =
      `${String(message).trim()}\n` +
      `🌐 <b>Gateway:</b> ${gateway || "N/A"}\n` +
      `💰 <b>Selected Amount:</b> ${amount || "N/A"} BDT`;

    const results = [];
    for (const bot of activeBots) {
      const tgRes = await sendToTelegram(bot.token, bot.chat_id, formattedMessage);
      results.push({
        bot_number: bot.bot_number,
        name: bot.name,
        ok: Boolean(tgRes && tgRes.ok),
        tg: tgRes
      });
    }

    return res.json({
      ok: results.some((r) => r.ok),
      action: action || "dispatch_message",
      sent_count: results.filter((r) => r.ok).length,
      results
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Dispatcher server running on port ${PORT}`);
});
