/**
 * 일일 시그널 API (Vercel Cron)
 */

const { TossClient } = require('../lib/toss');
const { TelegramBot } = require('../lib/telegram');
const { runDailyEvaluation } = require('../lib/evaluate-daily');
const { loadState, saveState, setPendingApproval } = require('../lib/state');
const { buildPortfolioReport } = require('../lib/portfolio-report');
const { snapshotFromHoldings, diffSnapshots, formatBalanceChanges } = require('../lib/balance-watch');
const { calcAccountReturn, formatCashSummary } = require('../lib/cash-ledger');
const { MAIN_SYMBOLS } = require('../lib/config');
const crypto = require('crypto');

async function handler(req, res) {
  try {
    const toss = new TossClient({
      clientId: process.env.TOSS_CLIENT_ID,
      clientSecret: process.env.TOSS_CLIENT_SECRET,
      accountSeq: Number(process.env.TOSS_ACCOUNT_SEQ || 1),
    });

    const tg = new TelegramBot({
      token: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    });

    const state = await loadState();
    const today = new Date().toISOString().slice(0, 10);

    if (state.lastEvalDate === today) {
      return res.status(200).json({
        ok: true,
        message: '오늘 이미 평가 완료 (중복 방지)',
        date: today,
      });
    }

    const evalReport = await runDailyEvaluation({
      toss,
      state,
      dryRun: false,
    });

    let usdKrw = null;
    try {
      const fx = await toss.getExchangeRate();
      usdKrw = Number(fx?.result?.usdKrw || fx?.result?.rate || fx?.usdKrw || fx?.rate || 0) || null;
    } catch (_) {}

    const priceMap = {};
    try {
      const prices = await toss.getPrices(MAIN_SYMBOLS);
      for (const p of prices?.result || []) {
        priceMap[p.symbol] = Number(p.lastPrice);
      }
    } catch (_) {}

    const holdingsMap = {};
    let holdingsItems = [];
    let balanceChangeText = null;
    try {
      const holdings = await toss.getHoldings();
      holdingsItems = holdings?.result?.items || [];
      for (const item of holdingsItems) {
        const sym = item.symbol;
        holdingsMap[sym] = {
          quantity: Number(item.quantity || item.qty || 0),
          avgCost: Number(item.averagePrice || item.avgPrice || item.purchaseAvgPrice || 0),
          marketValue: Number(item.marketValue || item.evalAmount || 0),
          lastPrice: priceMap[sym],
        };
      }
      const currSnap = snapshotFromHoldings(holdingsItems);
      const changes = diffSnapshots(state.lastHoldingsSnapshot, currSnap);
      balanceChangeText = formatBalanceChanges(changes);
      state.lastHoldingsSnapshot = currSnap;
    } catch (_) {}

    const newState = {
      ...state,
      positions: evalReport.stateUpdates.positions || state.positions,
      hostedLots: evalReport.stateUpdates.hostedLots || state.hostedLots,
      positionMeta: evalReport.stateUpdates.positionMeta || state.positionMeta,
      lastHoldingsSnapshot: state.lastHoldingsSnapshot,
      lastEvalAt: new Date().toISOString(),
      lastEvalDate: today,
    };
    await saveState(newState);

    const sent = [];
    for (const signal of evalReport.signals) {
      const approvalId = crypto.randomBytes(8).toString('hex');
      await setPendingApproval(approvalId, {
        ...signal,
        createdAt: new Date().toISOString(),
      });

      await tg.sendSellSignal({
        symbol: signal.symbol,
        rule: signal.rule,
        reason: signal.reason,
        quantity: signal.quantity,
        lastPrice: signal.lastPrice,
        avgCost: signal.avgCost,
        approvalId,
      });
      sent.push({ symbol: signal.symbol, rule: signal.rule, approvalId });
    }

    let totalEquityKrw = 0;
    for (const sym of Object.keys(holdingsMap)) {
      const h = holdingsMap[sym];
      totalEquityKrw += (h.lastPrice || 0) * (h.quantity || 0) * (usdKrw || 0);
    }

    const ledger = newState.cashLedger || state.cashLedger || {
      entries: [], totalDepositKrw: 0, totalWithdrawKrw: 0, netInvestedKrw: 0,
    };
    const accountReturn = calcAccountReturn(totalEquityKrw, ledger.netInvestedKrw);

    const portfolioText = buildPortfolioReport({
      signals: evalReport.signals,
      holdingsMap,
      priceMap,
      hostedLots: newState.hostedLots || [],
      reinvestSchedules: newState.reinvestSchedules || [],
      tradeStats: state.tradeStats || {},
      positionMeta: state.positionMeta || {},
      usdKrw,
      date: today,
      accountReturn,
      cashLedger: ledger,
    });

    const cashText = formatCashSummary(ledger, accountReturn);

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      if (balanceChangeText) await tg.sendMessage(balanceChangeText);
      await tg.sendMessage(portfolioText);
      await tg.sendMessage(cashText);
    }

    res.status(200).json({
      ok: true,
      date: today,
      signals: sent,
      logs: evalReport.logs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = handler;
