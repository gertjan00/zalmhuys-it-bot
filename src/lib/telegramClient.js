// src/lib/telegramClient.js
const TelegramBot = require("node-telegram-bot-api");

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("FOUT: TELEGRAM_BOT_TOKEN niet ingesteld in .env bestand!");
  process.exit(1);
}

const telegram = new TelegramBot(token, { polling: true });

console.log(" - Telegram client geïnitialiseerd en polling gestart.");

module.exports = telegram;
