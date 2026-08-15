/**
 * 에버라이징 설정 (토스 버전)
 * 2026-08-01 백서 기준
 */

const TICKERS = {
  TQQQ: { name: '나스닥100 3배', dailyKrw: 30000, leverage: 3 },
  SOXL: { name: '반도체 3배', dailyKrw: 30000, leverage: 3 },
  GDXU: { name: '금채굴주 3배', dailyKrw: 30000, leverage: 3 },
  AGQ:  { name: '은 2배', dailyKrw: 30000, leverage: 2 },
  DFEN: { name: '방산 3배', dailyKrw: 10000, leverage: 3 },
  UTSL: { name: '유틸리티 3배', dailyKrw: 10000, leverage: 3 },
  UBOT: { name: '로봇/AI 2배', dailyKrw: 10000, leverage: 2 },
};

const CASH_PARKING = 'TECL';

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

module.exports = {
  TICKERS,
  CASH_PARKING,
  RULES,
  MAIN_SYMBOLS,
};
