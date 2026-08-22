
const { TossClient } = require("../lib/toss");
const { TelegramBot } = require("../lib/telegram");
const { loadState, saveState } = require("../lib/state");
const { isUsTradingDay } = require("../lib/trading-day");
const { SHARE_LOT_SYMBOLS } = require("../lib/config");
const { ensureBudget, creditIfNeeded, decideBuy } = require("../lib/lot-budget");

function parseUsdKrw(fx) {
  const v = fx?.result?.usdKrw || fx?.result?.rate || fx?.usdKrw || fx?.rate || null;
  return v ? Number(v) : null;
}

async function runLotBuy(phase = "first") {
  const logs = [];
  const toss = new TossClient({
    clientId: process.env.TOSS_CLIENT_ID,
    clientSecret: process.env.TOSS_CLIENT_SECRET,
    accountSeq: Number(process.env.TOSS_ACCOUNT_SEQ || 1),
  });
  const tg = new TelegramBot({
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  });
  const now = new Date();
  if (!isUsTradingDay(now) && phase === "first") {
    return { ok: true, phase, logs: ["미국 휴장 → 예산매수 스킵"] };
  }
  const state = await loadState();
  const lotBudget = ensureBudget(state);
  const tradingDate = now.toISOString().slice(0, 10);
  if (phase === "first") logs.push(...creditIfNeeded(lotBudget, tradingDate));
  let usdKrw = 1400;
  try { usdKrw = parseUsdKrw(await toss.getExchangeRate()) || usdKrw; } catch (e) { logs.push("환율 실패: " + e.message); }
  const prices = await toss.getPrices(SHARE_LOT_SYMBOLS);
  const priceMap = {};
  for (const p of prices?.result || []) priceMap[p.symbol] = Number(p.lastPrice);
  for (const sym of SHARE_LOT_SYMBOLS) {
    const slot = lotBudget[sym];
    const last = priceMap[sym];
    const shareKrw = last && usdKrw ? last * usdKrw : 0;
    let prevClose = 0;
    try {
      const candles = await toss.getDailyCandles(sym, 5);
      if (candles.length >= 2) prevClose = Number(candles[candles.length - 2].closePrice);
    } catch (e) { logs.push(sym + " 전일봉 실패: " + e.message); }
    if (phase === "retry") {
      if (!slot.pendingOrderId) { logs.push(sym + " 재시도 없음"); continue; }
      try {
        await toss.cancelOrder(slot.pendingOrderId);
        logs.push(sym + " 미체결 취소");
        if (slot.reservedKrw) { slot.krw += Number(slot.reservedKrw); slot.reservedKrw = 0; }
      } catch (e) {
        logs.push(sym + " 취소 실패: " + e.message);
        slot.pendingOrderId = null;
        continue;
      }
      slot.pendingOrderId = null;
    }
    if (phase === "first" && slot.lastBuyDate === tradingDate && slot.pendingOrderId) {
      logs.push(sym + " 오늘 이미 주문"); continue;
    }
    const decision = decideBuy({ lastPrice: last, prevClose, shareKrw, budgetKrw: slot.krw });
    logs.push(sym + " " + decision.action + " " + decision.reason);
    if (decision.action !== "BUY") { slot.lastSkip = decision.reason; continue; }
    const clientOrderId = ("lot-" + sym + "-" + tradingDate + "-" + phase).slice(0, 36);
    try {
      const order = await toss.createBuyLimitOrder({ symbol: sym, quantity: 1, price: decision.limit, clientOrderId });
      slot.pendingOrderId = order?.result?.orderId || order?.orderId || null;
      slot.lastBuyDate = tradingDate;
      slot.reservedKrw = shareKrw;
      slot.krw = Math.max(0, Number(slot.krw) - shareKrw);
      await tg.sendMessage("🛒 <b>" + sym + " 예산매수</b>\n1주 지정가 $" + decision.limit + "\n현재 $" + last + "\n예산잔액 " + Math.round(slot.krw).toLocaleString() + "원");
      logs.push(sym + " 주문 ok @" + decision.limit);
    } catch (e) {
      logs.push(sym + " 주문 실패: " + e.message);
      try { await tg.sendMessage("⚠️ " + sym + " 매수 실패: " + e.message); } catch (_) {}
    }
  }
  await saveState(Object.assign({}, state, { lotBudget }));
  return { ok: true, phase, logs };
}
async function handler(req, res) {
  try {
    const phase = String((req && req.query && req.query.phase) || "first");
    res.status(200).json(await runLotBuy(phase));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
module.exports = handler;
module.exports.runLotBuy = runLotBuy;
