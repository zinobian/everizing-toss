
const TICKERS = {
  TQQQ: { name: "나스닥100 3배", dailyKrw: 60000, leverage: 3, lot: false },
  SOXL: { name: "반도체 3배", dailyKrw: 60000, leverage: 3, lot: false },
  GDXU: { name: "금채굴주 3배", dailyKrw: 0, leverage: 3, lot: true, dailyBudgetKrw: 60000 },
  AGQ:  { name: "은 2배", dailyKrw: 60000, leverage: 2, lot: false },
  DFEN: { name: "방산 3배", dailyKrw: 20000, leverage: 3, lot: false },
  UTSL: { name: "유틸리티 3배", dailyKrw: 20000, leverage: 3, lot: false },
  UBOT: { name: "로봇/AI 2배", dailyKrw: 0, leverage: 2, lot: true, dailyBudgetKrw: 20000 },
};
const FRACTIONAL_SYMBOLS = ["TQQQ", "SOXL", "AGQ", "DFEN", "UTSL"];
const SHARE_LOT_SYMBOLS = ["GDXU", "UBOT"];
const LOT_FULL_RULES_MIN_SHARES = 15;
const LOT_SKIP_IF_UP_PCT = 0.03;
const LOT_LIMIT_TICK = 0.01;
const CASH_PARKING = "TECL";
const RULES = {
  costAveragingPct: 0.15,
  boostAveragingPct: 0.25,
  breakStopDays: 10,
  breakStopMa: 240,
  athTrailMa: 35,
  reinvestDays: 15,
  hostedLotMinHoldDays: 80,
};
const MAIN_SYMBOLS = Object.keys(TICKERS);
function isShareLot(symbol) { return SHARE_LOT_SYMBOLS.includes(symbol); }
function canApplyFullRules(symbol, quantity) {
  if (!isShareLot(symbol)) return true;
  return Number(quantity) >= LOT_FULL_RULES_MIN_SHARES;
}
module.exports = {
  TICKERS, CASH_PARKING, RULES, MAIN_SYMBOLS,
  FRACTIONAL_SYMBOLS, SHARE_LOT_SYMBOLS, LOT_FULL_RULES_MIN_SHARES,
  LOT_SKIP_IF_UP_PCT, LOT_LIMIT_TICK, isShareLot, canApplyFullRules,
};
