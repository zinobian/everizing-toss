/**
 * 상태 저장소 (Upstash Redis / 메모리 폴백)
 * 키: everizing-toss:state  (한투 everizing:state 와 분리)
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
  lastRuleEvalDate: null,
  lastHoldingsSnapshot: null,
  lotBudget: {},
  lastCashSnap: null,
};

const STATE_KEY = 'everizing-toss:state';

let MEMORY = JSON.parse(JSON.stringify(DEFAULT_STATE));
let redis = null;
let redisInitTried = false;

function initRedis() {
  if (redisInitTried) return redis;
  redisInitTried = true;
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
      const { Redis } = require('@upstash/redis');
      redis = new Redis({ url, token });
    }
  } catch (e) {
    console.error('Redis init error:', e.message);
    redis = null;
  }
  return redis;
}

function setRedis(client) {
  redis = client;
  redisInitTried = true;
}

async function loadState() {
  initRedis();
  if (!redis) {
    return JSON.parse(JSON.stringify(MEMORY));
  }
  try {
    const raw = await redis.get(STATE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_STATE));
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ...DEFAULT_STATE, ...parsed };
  } catch (e) {
    console.error('state load error:', e.message);
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

async function saveState(state) {
  initRedis();
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
    lastRuleEvalDate: state.lastRuleEvalDate || null,
    lastHoldingsSnapshot: state.lastHoldingsSnapshot || null,
    lotBudget: state.lotBudget || {},
    lastCashSnap: state.lastCashSnap || null,
  };

  if (!redis) {
    MEMORY = JSON.parse(JSON.stringify(data));
    return;
  }
  try {
    await redis.set(STATE_KEY, JSON.stringify(data));
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
