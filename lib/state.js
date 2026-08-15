/**
 * 상태 저장소 (Redis / 메모리 폴백)
 */

const DEFAULT_STATE = {
  positions: {},
  hostedLots: [],
  reinvestSchedules: [],
  tradeStats: {},
  positionMeta: {},
  trades: [],
  cashLedger: {
    entries: [],
    totalDepositKrw: 0,
    totalWithdrawKrw: 0,
    netInvestedKrw: 0,
  },
  pendingApprovals: {},
  lastEvalAt: null,
  lastEvalDate: null,
  lastHoldingsSnapshot: null,
};

let MEMORY = JSON.parse(JSON.stringify(DEFAULT_STATE));
let redis = null;

function setRedis(client) {
  redis = client;
}

async function loadState() {
  if (!redis) {
    return JSON.parse(JSON.stringify(MEMORY));
  }
  try {
    const raw = await redis.get('everizing:state');
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_STATE));
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...DEFAULT_STATE, ...parsed };
  } catch (e) {
    console.error('state load error:', e.message);
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

async function saveState(state) {
  const data = {
    positions: state.positions || {},
    hostedLots: state.hostedLots || [],
    reinvestSchedules: state.reinvestSchedules || [],
    tradeStats: state.tradeStats || {},
    positionMeta: state.positionMeta || {},
    trades: (state.trades || []).slice(-200),
    cashLedger: state.cashLedger || {
      entries: [],
      totalDepositKrw: 0,
      totalWithdrawKrw: 0,
      netInvestedKrw: 0,
    },
    pendingApprovals: state.pendingApprovals || {},
    lastEvalAt: state.lastEvalAt || new Date().toISOString(),
    lastEvalDate: state.lastEvalDate || null,
    lastHoldingsSnapshot: state.lastHoldingsSnapshot || null,
  };

  if (!redis) {
    MEMORY = JSON.parse(JSON.stringify(data));
    return;
  }
  try {
    await redis.set('everizing:state', JSON.stringify(data));
  } catch (e) {
    console.error('state save error:', e.message);
  }
}

async function getPendingApproval(id) {
  const state = await loadState();
  return state.pendingApprovals?.[id] || null;
}

async function setPendingApproval(id, payload) {
  const state = await loadState();
  state.pendingApprovals = state.pendingApprovals || {};
  state.pendingApprovals[id] = payload;
  await saveState(state);
}

async function clearPendingApproval(id) {
  const state = await loadState();
  if (state.pendingApprovals) {
    delete state.pendingApprovals[id];
    await saveState(state);
  }
}

function recordTrade(state, { symbol, side, rule, quantity, price, amount, note }) {
  const today = new Date().toISOString().slice(0, 10);
  state.trades = state.trades || [];
  state.trades.push({
    id: `${Date.now()}_${symbol}`,
    symbol,
    side,
    rule: rule || null,
    quantity: Number(quantity),
    price: Number(price),
    amount: Number(amount),
    note: note || '',
    at: new Date().toISOString(),
    date: today,
  });

  if (side === 'SELL') {
    state.tradeStats = state.tradeStats || {};
    const stats = state.tradeStats[symbol] || { count: 0, byRule: {} };
    stats.count = (stats.count || 0) + 1;
    stats.lastDate = today;
    stats.byRule = stats.byRule || {};
    if (rule) stats.byRule[rule] = (stats.byRule[rule] || 0) + 1;
    state.tradeStats[symbol] = stats;
  }

  if (side === 'BUY') {
    state.positionMeta = state.positionMeta || {};
    const meta = state.positionMeta[symbol] || {};
    if (!meta.startDate) meta.startDate = today;
    meta.lastBuyDate = today;
    state.positionMeta[symbol] = meta;
  }

  return state;
}

module.exports = {
  setRedis,
  loadState,
  saveState,
  getPendingApproval,
  setPendingApproval,
  clearPendingApproval,
  recordTrade,
  DEFAULT_STATE,
};
