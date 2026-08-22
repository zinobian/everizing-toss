/**
 * 텔레그램 알림 + 인라인 승인 버튼
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

class TelegramBot {
  constructor({ token, chatId }) {
    this.token = token;
    this.chatId = chatId;
  }

  async sendMessage(text, { replyMarkup = null, parseMode = 'HTML' } = {}) {
    const body = {
      chat_id: this.chatId,
      text,
      parse_mode: parseMode,
    };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const url = `${TELEGRAM_API}${this.token}/sendMessage`;
    const { stdout } = await execFileAsync('curl', [
      '-4', '-s', '--max-time', '20',
      '-X', 'POST', url,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify(body),
    ]);
    const data = JSON.parse(stdout);
    if (!data.ok) {
      throw new Error(`Telegram sendMessage 실패: ${data.description}`);
    }
    return data.result;
  }

  async sendSellSignal({ symbol, rule, reason, quantity, lastPrice, avgCost, approvalId }) {
    const profitPct = avgCost > 0 ? (((lastPrice - avgCost) / avgCost) * 100).toFixed(2) : '-';
    const text = [
      `🚨 <b>에버라이징 매도 신호</b>`,
      ``,
      `종목: <b>${symbol}</b>`,
      `규칙: <b>${rule}</b>`,
      `사유: ${reason}`,
      `수량: ${quantity}`,
      `종가: ${lastPrice}`,
      `평단: ${avgCost}`,
      `수익률: ${profitPct}%`,
      ``,
      `승인하시겠습니까?`,
    ].join('\n');

    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: '✅ 승인 (매도 실행)',
            callback_data: `approve:${symbol}:${rule}:${approvalId}`,
          },
          {
            text: '❌ 거부',
            callback_data: `reject:${symbol}:${rule}:${approvalId}`,
          },
        ],
      ],
    };

    return this.sendMessage(text, { replyMarkup });
  }

  async answerCallback(callbackQueryId, text) {
    const res = await fetch(`${TELEGRAM_API}${this.token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: false,
      }),
    });
    return res.json();
  }

  async editMessage(chatId, messageId, text) {
    const res = await fetch(`${TELEGRAM_API}${this.token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
      }),
    });
    return res.json();
  }
}

module.exports = { TelegramBot };
