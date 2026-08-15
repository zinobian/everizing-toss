/**
 * 재투자 스케줄 실행기
 */

const { TossClient } = require('../lib/toss');
const { loadState, saveState } = require('../lib/state');
const { isUsTradingDay } = require('../lib/trading-day');

async function handler(req, res) {
  try {
    if (!isUsTradingDay()) {
      return res.status(200).json({ ok: true, message: '휴장일 스킵' });
    }

    const toss = new TossClient({
      clientId: process.env.TOSS_CLIENT_ID,
      clientSecret: process.env.TOSS_CLIENT_SECRET,
      accountSeq: Number(process.env.TOSS_ACCOUNT_SEQ || 1),
    });

    const state = await loadState();
    const schedules = state.reinvestSchedules || [];
    const results = [];

    for (const sch of schedules) {
      if (sch.status !== 'ACTIVE') continue;

      const nextDay = sch.days.find(d => !d.executed);
      if (!nextDay) {
        sch.status = 'DONE';
        continue;
      }

      try {
        const order = await toss.createBuyOrderByAmount({
          symbol: sch.targetSymbol,
          orderAmount: nextDay.amount.toFixed(2),
          clientOrderId: `reinv_${sch.id}_${nextDay.dayIndex}`,
        });

        nextDay.executed = true;
        nextDay.executedAt = new Date().toISOString();
        nextDay.orderResult = order?.result || order;

        results.push({
          symbol: sch.targetSymbol,
          dayIndex: nextDay.dayIndex,
          amount: nextDay.amount,
          ok: true,
        });
      } catch (e) {
        results.push({
          symbol: sch.targetSymbol,
          dayIndex: nextDay.dayIndex,
          amount: nextDay.amount,
          ok: false,
          error: e.message,
        });
      }
    }

    state.reinvestSchedules = schedules.map(sch => {
      if (sch.days.every(d => d.executed)) sch.status = 'DONE';
      return sch;
    });

    await saveState(state);

    res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = handler;
