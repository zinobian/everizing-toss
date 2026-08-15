/**
 * 텔레그램 웹훅
 * - 승인/거부
 * - /port /in /out /cash
 */

const { TossClient } = require('../lib/toss');
const { TelegramBot } = require('../lib/telegram');
const {
  getPendingApproval,
  clearPendingApproval,
  loadState,
  saveState,
  recordTrade,
} = require('../lib/state');
const {
  createReinvestSchedule,
  createHostedLot,
  buildWaterfillTargets,
  waterfill,
} = require('../lib/hosted-lots');
const { buildPortfolioReport } = require('../lib/portfolio-report');
const {
  addCashEntry,
  calcAccountReturn,
  formatCashSummary,
  createEmptyLedger,
} = require('../lib/cash-ledger');
const { MAIN_SYMBOLS } = require('../lib/config');

async function sendPortReport(tg, toss) {
  const state = await loadState();
  const today = new Date().toISOString().slice(0, 10);

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
  try {
    const holdings = await toss.getHoldings();
    for (const item of holdings?.result?.items || []) {
      holdingsMap[item.symbol] = {
        quantity: Number(item.quantity || item.qty || 0),
        avgCost: Number(item.averagePrice || item.avgPrice || item.purchaseAvgPrice || 0),
        marketValue: Number(item.marketValue || item.evalAmount || 0),
        lastPrice: priceMap[item.symbol],
      };
    }
  } catch (_) {}

  let totalEquityKrw = 0;
  for (const sym of Object.keys(holdingsMap)) {
    const h = holdingsMap[sym];
    totalEquityKrw += (h.lastPrice || 0) * (h.quantity || 0) * (usdKrw || 0);
  }
  const ledger = state.cashLedger || createEmptyLedger();
  const accountReturn = calcAccountReturn(totalEquityKrw, ledger.netInvestedKrw);

  const text = buildPortfolioReport({
    signals: [],
    holdingsMap,
    priceMap,
    hostedLots: state.hostedLots || [],
    reinvestSchedules: state.reinvestSchedules || [],
    tradeStats: state.tradeStats || {},
    positionMeta: state.positionMeta || {},
    usdKrw,
    date: today,
    accountReturn,
    cashLedger: ledger,
  });

  await tg.sendMessage(text);
  await tg.sendMessage(formatCashSummary(ledger, accountReturn));
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  const update = req.body;
  const callback = update?.callback_query;
  const message = update?.message;

  const tg = new TelegramBot({
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  });

  const toss = new TossClient({
    clientId: process.env.TOSS_CLIENT_ID,
    clientSecret: process.env.TOSS_CLIENT_SECRET,
    accountSeq: Number(process.env.TOSS_ACCOUNT_SEQ || 1),
  });

  try {
    if (message?.text) {
      const text = message.text.trim();

      if (text === '/port' || text === '/portfolio' || text === '포트') {
        await sendPortReport(tg, toss);
        return res.status(200).json({ ok: true, action: 'port' });
      }

      if (text.startsWith('/in ') || text.startsWith('/입금 ')) {
        const parts = text.split(/\s+/);
        const amount = Number(parts[1]?.replace(/,/g, ''));
        const note = parts.slice(2).join(' ') || '';
        if (!amount || amount <= 0) {
          await tg.sendMessage('사용법: /in 금액 [메모]\n예: /in 1000000 월급이체');
          return res.status(200).json({ ok: false });
        }
        const state = await loadState();
        state.cashLedger = state.cashLedger || createEmptyLedger();
        addCashEntry(state.cashLedger, { type: 'DEPOSIT', amountKrw: amount, note });
        await saveState(state);
        await tg.sendMessage(
          `✅ 입금 기록 ${amount.toLocaleString('ko-KR')}원\n순입금: ${state.cashLedger.netInvestedKrw.toLocaleString('ko-KR')}원`
        );
        return res.status(200).json({ ok: true, action: 'deposit' });
      }

      if (text.startsWith('/out ') || text.startsWith('/출금 ')) {
        const parts = text.split(/\s+/);
        const amount = Number(parts[1]?.replace(/,/g, ''));
        const note = parts.slice(2).join(' ') || '';
        if (!amount || amount <= 0) {
          await tg.sendMessage('사용법: /out 금액 [메모]\n예: /out 500000 생활비');
          return res.status(200).json({ ok: false });
        }
        const state = await loadState();
        state.cashLedger = state.cashLedger || createEmptyLedger();
        addCashEntry(state.cashLedger, { type: 'WITHDRAW', amountKrw: amount, note });
        await saveState(state);
        await tg.sendMessage(
          `✅ 출금 기록 ${amount.toLocaleString('ko-KR')}원\n순입금: ${state.cashLedger.netInvestedKrw.toLocaleString('ko-KR')}원`
        );
        return res.status(200).json({ ok: true, action: 'withdraw' });
      }

      if (text === '/cash' || text === '/자금' || text === '자금') {
        const state = await loadState();
        const ledger = state.cashLedger || createEmptyLedger();
        let totalEquityKrw = 0;
        try {
          const fx = await toss.getExchangeRate();
          const rate = Number(fx?.result?.usdKrw || fx?.result?.rate || fx?.rate || 0);
          const holdings = await toss.getHoldings();
          for (const item of holdings?.result?.items || []) {
            const qty = Number(item.quantity || item.qty || 0);
            const px = Number(item.lastPrice || item.currentPrice || 0);
            totalEquityKrw += qty * px * rate;
          }
        } catch (_) {}
        const accountReturn = calcAccountReturn(totalEquityKrw, ledger.netInvestedKrw);
        await tg.sendMessage(formatCashSummary(ledger, accountReturn));
        return res.status(200).json({ ok: true, action: 'cash' });
      }

      return res.status(200).json({ ok: true });
    }

    if (!callback) {
      return res.status(200).json({ ok: true });
    }

    const data = callback.data || '';
    const [action, symbol, rule, approvalId] = data.split(':');

    if (action === 'reject') {
      await clearPendingApproval(approvalId);
      await tg.answerCallback(callback.id, '거부되었습니다.');
      await tg.editMessage(
        callback.message.chat.id,
        callback.message.message_id,
        `❌ 거부됨\n${symbol} / ${rule}`
      );
      return res.status(200).json({ ok: true, action: 'rejected' });
    }

    if (action !== 'approve') {
      await tg.answerCallback(callback.id, '알 수 없는 요청');
      return res.status(200).json({ ok: true });
    }

    const pending = await getPendingApproval(approvalId);
    if (!pending) {
      await tg.answerCallback(callback.id, '이미 처리되었거나 만료된 요청입니다.');
      return res.status(200).json({ ok: false, error: 'not_found' });
    }

    const orderResult = await toss.createSellOrder({
      symbol: pending.symbol,
      quantity: String(pending.quantity),
      orderType: 'MARKET',
      clientOrderId: `evz_${approvalId}`,
    });

    const state = await loadState();
    const approxProceeds = Number(pending.quantity) * Number(pending.lastPrice);

    if (pending.rule === 'RULE4_ATH_TRAIL') {
      const marketValues = {};
      for (const s of MAIN_SYMBOLS) {
        marketValues[s] = (state.positions?.[s]?.quantity || 0) * (pending.lastPrice || 0);
      }
      const targets = buildWaterfillTargets(pending.symbol, marketValues, {});
      const { allocations, remainder } = waterfill(approxProceeds, targets);

      state.hostedLots = state.hostedLots || [];
      state.reinvestSchedules = state.reinvestSchedules || [];

      for (const alloc of allocations) {
        const lot = createHostedLot({
          origin: pending.symbol,
          host: alloc.symbol,
          principal: alloc.amount,
        });
        state.hostedLots.push(lot);
        state.reinvestSchedules.push(
          createReinvestSchedule(alloc.amount, alloc.symbol, 'RULE4_HOSTED')
        );
      }
      if (remainder > 0) {
        state.reinvestSchedules.push(
          createReinvestSchedule(remainder, 'TECL', 'CASH_PARKING')
        );
      }
    } else {
      state.reinvestSchedules = state.reinvestSchedules || [];
      state.reinvestSchedules.push(
        createReinvestSchedule(approxProceeds, pending.symbol, pending.rule)
      );
    }

    recordTrade(state, {
      symbol: pending.symbol,
      side: 'SELL',
      rule: pending.rule,
      quantity: pending.quantity,
      price: pending.lastPrice,
      amount: approxProceeds,
      note: `승인매도 ${pending.rule}`,
    });

    state.positions = state.positions || {};
    state.positions[pending.symbol] = {
      avgCost: 0,
      quantity: 0,
      arms: { breakStopArmed: false, athArmed: false },
      breakStopCount: 0,
      athPrice: null,
    };
    if (state.positionMeta?.[pending.symbol]) {
      delete state.positionMeta[pending.symbol].startDate;
    }

    await saveState(state);
    await clearPendingApproval(approvalId);

    await tg.answerCallback(callback.id, '매도 주문 완료');
    await tg.editMessage(
      callback.message.chat.id,
      callback.message.message_id,
      `✅ 매도 실행 완료\n${pending.symbol} / ${pending.rule}\n주문: ${JSON.stringify(orderResult?.result || orderResult).slice(0, 180)}`
    );

    return res.status(200).json({ ok: true, action: 'approved', order: orderResult });
  } catch (err) {
    console.error('webhook error:', err);
    try {
      if (update?.callback_query) {
        await tg.answerCallback(update.callback_query.id, `오류: ${err.message.slice(0, 40)}`);
      }
    } catch (_) {}
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = handler;
