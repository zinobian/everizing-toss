/**
 * 대여랏 + 워터필링 + 재투자 스케줄
 */

const { RULES, TICKERS, MAIN_SYMBOLS } = require('./config');

function calcCap(marketValue, hostedPrincipalSum) {
  const cap = Number(marketValue) - Number(hostedPrincipalSum || 0);
  return Math.max(0, cap);
}

function waterfill(amount, targets) {
  let remaining = Number(amount);
  const allocations = [];
  const active = targets
    .filter(t => t.cap > 0 && t.weight > 0)
    .map(t => ({ ...t }));

  while (remaining > 1e-6 && active.length > 0) {
    const totalWeight = active.reduce((s, t) => s + t.weight, 0);
    if (totalWeight <= 0) break;

    let distributed = 0;
    const nextActive = [];

    for (const t of active) {
      const share = (remaining * t.weight) / totalWeight;
      const give = Math.min(share, t.cap);
      if (give > 1e-8) {
        allocations.push({ symbol: t.symbol, amount: give });
        t.cap -= give;
        distributed += give;
      }
      if (t.cap > 1e-8) nextActive.push(t);
    }

    remaining -= distributed;
    if (distributed < 1e-8) break;
    active.length = 0;
    active.push(...nextActive);
  }

  const merged = {};
  for (const a of allocations) {
    merged[a.symbol] = (merged[a.symbol] || 0) + a.amount;
  }
  const finalAlloc = Object.entries(merged).map(([symbol, amount]) => ({
    symbol,
    amount,
  }));

  return { allocations: finalAlloc, remainder: Math.max(0, remaining) };
}

function buildWaterfillTargets(soldSymbol, marketValues, hostedSums = {}) {
  const targets = [];
  for (const sym of MAIN_SYMBOLS) {
    if (sym === soldSymbol) continue;
    const weight = TICKERS[sym]?.dailyKrw || 0;
    const cap = calcCap(marketValues[sym] || 0, hostedSums[sym] || 0);
    targets.push({ symbol: sym, weight, cap });
  }
  return targets;
}

function createHostedLot({ origin, host, principal, createdAt }) {
  return {
    id: `${origin}_${host}_${Date.now()}`,
    origin,
    host,
    principal: Number(principal),
    remainingPrincipal: Number(principal),
    createdAt: createdAt || new Date().toISOString(),
    ageTradingDays: 0,
    status: 'ACCUMULATING',
    settleStartedAt: null,
    settleDaysDone: 0,
  };
}

function tickHostedLots(lots, hostLotValues = {}, isTradingDay = true) {
  if (!isTradingDay) return lots;

  return lots.map(lot => {
    if (lot.status === 'SETTLED' || lot.status === 'ABSORBED') return lot;

    const updated = { ...lot, ageTradingDays: lot.ageTradingDays + 1 };

    if (updated.ageTradingDays < RULES.hostedLotMinHoldDays) {
      return updated;
    }

    if (updated.status === 'HOLDING' || updated.status === 'ACCUMULATING') {
      const currentValue = hostLotValues[updated.id] ?? hostLotValues[updated.host] ?? 0;
      if (currentValue >= updated.principal) {
        updated.status = 'SETTLING';
        updated.settleStartedAt = new Date().toISOString();
        updated.settleDaysDone = 0;
      } else {
        updated.status = 'HOLDING';
      }
      return updated;
    }

    if (updated.status === 'SETTLING') {
      updated.settleDaysDone = (updated.settleDaysDone || 0) + 1;
      if (updated.settleDaysDone >= RULES.reinvestDays) {
        updated.status = 'SETTLED';
        updated.remainingPrincipal = 0;
      }
      return updated;
    }

    return updated;
  });
}

function createReinvestSchedule(totalAmount, targetSymbol, reason = '') {
  const daily = Number(totalAmount) / RULES.reinvestDays;
  const days = [];
  for (let i = 0; i < RULES.reinvestDays; i++) {
    days.push({
      dayIndex: i + 1,
      amount: daily,
      executed: false,
      executedAt: null,
    });
  }
  return {
    id: `reinvest_${targetSymbol}_${Date.now()}`,
    targetSymbol,
    totalAmount: Number(totalAmount),
    reason,
    createdAt: new Date().toISOString(),
    days,
    status: 'ACTIVE',
  };
}

module.exports = {
  calcCap,
  waterfill,
  buildWaterfillTargets,
  createHostedLot,
  tickHostedLots,
  createReinvestSchedule,
};
