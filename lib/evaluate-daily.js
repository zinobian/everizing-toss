/**
 * 일일 규칙 평가 오케스트레이터
 */

const { TossClient } = require('./toss');
const { evaluateRules } = require('./rules');
const { MAIN_SYMBOLS, RULES } = require('./config');
const { isUsTradingDay } = require('./trading-day');
const { tickHostedLots } = require('./hosted-lots');

async function runDailyEvaluation({ toss, state, dryRun = true }) {
  const today = new Date();
  const tradingDay = isUsTradingDay(today);

  const report = {
    date: today.toISOString().slice(0, 10),
    isUsTradingDay: tradingDay,
    signals: [],
    stateUpdates: {},
    logs: [],
  };

  if (!tradingDay) {
    report.logs.push('미국 휴장일 → 규칙 평가 스킵');
    return report;
  }

  const pricesRes = await toss.getPrices(MAIN_SYMBOLS);
  const priceMap = {};
  for (const p of pricesRes?.result || []) {
    priceMap[p.symbol] = Number(p.lastPrice);
  }

  const candleMap = {};
  for (const sym of MAIN_SYMBOLS) {
    try {
      const candles = await toss.getDailyCandles(sym, 260);
      candleMap[sym] = candles;
    } catch (e) {
      report.logs.push(`${sym} 캔들 조회 실패: ${e.message}`);
      candleMap[sym] = [];
    }
  }

  let holdingsItems = [];
  try {
    const holdings = await toss.getHoldings();
    holdingsItems = holdings?.result?.items || [];
  } catch (e) {
    report.logs.push(`잔고 조회 실패: ${e.message}`);
  }

  const tradingDate = new Date().toISOString().slice(0, 10);
  const isTrading = require('./trading-day').isUsTradingDay();
  let updatedLots = state.hostedLots || [];
  if (isTrading && state.lastHostedTickDate !== tradingDate) {
    updatedLots = tickHostedLots(state.hostedLots || [], {}, true);
    report.stateUpdates.hostedLots = updatedLots;
    report.stateUpdates.lastHostedTickDate = tradingDate;
    report.logs.push('대여랏 age +1 (거래일 ' + tradingDate + ')');
  } else {
    report.stateUpdates.hostedLots = updatedLots;
    report.logs.push(isTrading ? '대여랏 age 이미 반영됨' : '대여랏 age 스킵 (휴장)');
  }

  const positions = state.positions || {};
  for (const sym of MAIN_SYMBOLS) {
    const pos = positions[sym] || {
      avgCost: 0,
      quantity: 0,
      arms: { breakStopArmed: true, athArmed: false },
      breakStopCount: 0,
      athPrice: null,
    };

    const held = holdingsItems.find(h => h.symbol === sym);
    if (held) {
      pos.quantity = Number(held.quantity || held.qty || 0);
      if (held.averagePrice || held.avgPrice || held.purchaseAvgPrice) {
        pos.avgCost = Number(held.averagePrice || held.avgPrice || held.purchaseAvgPrice);
      }
      if (pos.quantity > 0) {
        state.positionMeta = state.positionMeta || {};
        const meta = state.positionMeta[sym] || {};
        if (!meta.startDate) {
          meta.startDate = new Date().toISOString().slice(0, 10);
          state.positionMeta[sym] = meta;
          report.stateUpdates.positionMeta = state.positionMeta;
        }
      }
    }

    if (!pos.quantity || pos.quantity <= 0) continue;

    const lastPrice = priceMap[sym];
    const candles = candleMap[sym] || [];

    const result = evaluateRules({
      symbol: sym,
      avgCost: pos.avgCost,
      quantity: pos.quantity,
      lastPrice,
      candles,
      arms: pos.arms,
      breakStopCount: pos.breakStopCount || 0,
      athPrice: pos.athPrice,
    });

    if (!result) continue;

    if (result.action === 'UPDATE_COUNT') {
      pos.breakStopCount = result.meta.breakStopCount;
      report.logs.push(`${sym}: ${result.reason}`);
    } else if (result.action === 'RESET_BREAKSTOP') {
      pos.breakStopCount = 0;
      pos.arms.breakStopArmed = true;
      report.logs.push(`${sym}: ${result.reason}`);
    } else if (result.action === 'ARM_ATH') {
      pos.arms.athArmed = true;
      pos.athPrice = result.meta.newAth;
      report.logs.push(`${sym}: ${result.reason}`);
    } else if (result.action === 'SELL_ALL') {
      report.signals.push({
        symbol: sym,
        rule: result.rule,
        reason: result.reason,
        quantity: pos.quantity,
        lastPrice,
        avgCost: pos.avgCost,
        meta: result.meta,
        dryRun,
      });
      report.logs.push(`[신호] ${sym} ${result.rule}: ${result.reason}`);
    }

    positions[sym] = pos;
  }

  report.stateUpdates.positions = positions;
  return report;
}

module.exports = {
  runDailyEvaluation,
};
