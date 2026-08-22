
const { SHARE_LOT_SYMBOLS, TICKERS, LOT_SKIP_IF_UP_PCT, LOT_LIMIT_TICK } = require("./config");
function emptySlot() {
  return { krw: 0, lastCreditDate: null, pendingOrderId: null, pendingClientId: null, lastBuyDate: null, lastSkip: null, reservedKrw: 0 };
}
function ensureBudget(state) {
  const lotBudget = Object.assign({}, state.lotBudget || {});
  for (const sym of SHARE_LOT_SYMBOLS) lotBudget[sym] = Object.assign(emptySlot(), lotBudget[sym] || {});
  return lotBudget;
}
function creditIfNeeded(lotBudget, tradingDate) {
  const logs = [];
  for (const sym of SHARE_LOT_SYMBOLS) {
    const slot = lotBudget[sym];
    if (slot.lastCreditDate === tradingDate) continue;
    const add = Number(TICKERS[sym].dailyBudgetKrw || 0);
    slot.krw = Number(slot.krw || 0) + add;
    slot.lastCreditDate = tradingDate;
    logs.push(sym + " 예산 +" + add + "원");
  }
  return logs;
}
function limitPrice(lastPrice) {
  const p = Number(lastPrice);
  if (!p) return null;
  const tick = p >= 1 ? LOT_LIMIT_TICK : 0.0001;
  const digits = p >= 1 ? 2 : 4;
  const v = Math.floor((p - tick) * Math.pow(10, digits)) / Math.pow(10, digits);
  return v > 0 ? v : Number(p.toFixed(digits));
}
function decideBuy({ lastPrice, prevClose, shareKrw, budgetKrw }) {
  if (!lastPrice || !shareKrw) return { action: "SKIP", reason: "시세 없음" };
  if (prevClose > 0 && lastPrice >= prevClose * (1 + LOT_SKIP_IF_UP_PCT)) {
    return { action: "SKIP", reason: "전일 대비 +3% 이상" };
  }
  if (budgetKrw + 1 < shareKrw) {
    return { action: "WAIT", reason: "예산 부족" };
  }
  return { action: "BUY", reason: "예산 충족", limit: limitPrice(lastPrice) };
}
module.exports = { ensureBudget, creditIfNeeded, decideBuy, limitPrice };
